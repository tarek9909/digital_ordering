import { AppError, CANCEL_REASONS } from '@dop/contracts';
import { scope } from '@dop/db';
import { addDays, histogramPercentile, mergeHistograms, toZoned } from '@dop/domain';
import type { Deps } from './deps.js';
import { sendEmail } from './email.js';
import { isEnabled, requireFeature } from './platform.js';

// R1.1 reports (FR-RPT-02 – FR-RPT-05): trends with previous-period comparison, weekday × hour heatmap, filters
// by venue, counter and date range; weekly summary email. All from report_daily (TR-RPT-02) on the replica.

interface Filter {
  venueId?: string;
  counterId?: string;
  from: string;
  to: string;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

async function rows(deps: Deps, tenantId: string, f: Filter, wholeDay: boolean) {
  let q = scope(deps.db.replica(), tenantId)
    .selectFrom('report_daily')
    .selectAll()
    .where('counter_key', '=', f.counterId ?? '')
    .where('business_date', '>=', f.from)
    .where('business_date', '<=', f.to);
  q = wholeDay ? q.where('hour_local', '=', 24) : q.where('hour_local', '<', 24);
  if (f.venueId) q = q.where('venue_id', '=', f.venueId);
  return q.execute();
}

function summarise(rs: Awaited<ReturnType<typeof rows>>) {
  const sum = (k: keyof (typeof rs)[number]) => rs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const ready = sum('reach_push') + sum('reach_live') + sum('reach_closed') + sum('reach_none');
  const prep = mergeHistograms(rs.map((r) => r.prep_hist as unknown as number[]));
  const pickup = mergeHistograms(rs.map((r) => r.pickup_hist as unknown as number[]));
  const total = mergeHistograms(rs.map((r) => r.total_hist as unknown as number[]));
  const ratingsCount = sum('ratings_count');
  // Cancellations by reason (BRD §12.1): every reason, zero when unused, so periods compare key by key.
  const cancelReasons: Record<string, number> = Object.fromEntries(CANCEL_REASONS.map((r) => [r, 0]));
  for (const r of rs) for (const [k, n] of Object.entries((r.cancel_reasons ?? {}) as unknown as Record<string, number>)) cancelReasons[k] = (cancelReasons[k] ?? 0) + Number(n);
  return {
    tickets: sum('tickets_created'),
    collected: sum('tickets_collected'),
    cancelled: sum('tickets_cancelled'),
    cancelReasons,
    uncollected: sum('tickets_expired_uncollected_ready'),
    reachPushOrLivePct: ready ? Math.round(((sum('reach_push') + sum('reach_live')) / ready) * 100) : null,
    acknowledgedPct: ready ? Math.round((sum('acknowledged') / ready) * 100) : null,
    repeatPct: ready ? Math.round((sum('needed_repeat') / ready) * 100) : null,
    undoPct: ready ? Math.round((sum('ready_undone') / ready) * 100) : null,
    prepSecondsP50: histogramPercentile(prep, 50),
    pickupSecondsP50: histogramPercentile(pickup, 50),
    totalSecondsP50: histogramPercentile(total, 50),
    ratingAvg: ratingsCount ? Math.round((sum('ratings_sum') / ratingsCount) * 10) / 10 : null,
    ratingsCount,
  };
}

/**
 * Plan features of R1.1 reports (A14, FR-SA-11): trends, heatmap and the weekly summary need `reports_trends`;
 * a report across all venues of a tenant with several venues needs `combined_reports`.
 */
async function requireReportAccess(deps: Deps, tenantId: string, f: Filter) {
  await requireFeature(deps, tenantId, 'reports_trends');
  if (!f.venueId) {
    const n = Number((await deps.db.forTenant(tenantId).selectFrom('venues').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').executeTakeFirstOrThrow()).n);
    if (n > 1) await requireFeature(deps, tenantId, 'combined_reports');
  }
}

/** Trends for the range and the previous period of equal length (FR-RPT-02). */
export async function trendsReport(deps: Deps, tenantId: string, f: Filter) {
  if (f.to < f.from) throw new AppError('VALIDATION_FAILED', '`to` is before `from`');
  await requireReportAccess(deps, tenantId, f);
  const len = daysBetween(f.from, f.to) + 1;
  const prev = { ...f, from: addDays(f.from, -len), to: addDays(f.from, -1) };
  const [cur, before] = await Promise.all([rows(deps, tenantId, f, true), rows(deps, tenantId, prev, true)]);
  const dates = [...new Set(cur.map((r) => r.business_date))].sort();
  return {
    from: f.from,
    to: f.to,
    prepLabel: 'from ticket creation',
    current: summarise(cur),
    previous: { from: prev.from, to: prev.to, ...summarise(before) },
    series: dates.map((d) => ({ date: d, ...summarise(cur.filter((r) => r.business_date === d)) })),
  };
}

/** Tickets by weekday (0 = Sunday) × local hour (FR-RPT-03). */
export async function heatmapReport(deps: Deps, tenantId: string, f: Filter) {
  await requireReportAccess(deps, tenantId, f);
  const rs = await rows(deps, tenantId, f, false);
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rs) {
    const weekday = new Date(`${r.business_date}T12:00:00Z`).getUTCDay();
    grid[weekday]![r.hour_local]! += r.tickets_created;
  }
  return { from: f.from, to: f.to, grid };
}

/**
 * `reports.weekly-email` (FR-RPT-05): 08:00 venue local on the first day of the venue's week (Sunday in Saudi
 * Arabia). Runs hourly; the message key makes it once per tenant per week. Owners can opt out.
 */
export async function weeklySummaries(deps: Deps) {
  const venues = await deps.db.platform().selectFrom('venues').innerJoin('tenants', 'tenants.id', 'venues.tenant_id').select(['venues.id', 'venues.tenant_id', 'venues.time_zone', 'tenants.name', 'tenants.status']).where('venues.status', '=', 'active').where('tenants.status', 'in', ['trial', 'active', 'past_due']).execute();
  let sent = 0;
  for (const v of venues) {
    const local = toZoned(deps.now(), v.time_zone);
    const weekday = new Date(`${local.date}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 || local.time.slice(0, 2) !== '08') continue;
    if (!(await isEnabled(deps, v.tenant_id, 'reports_trends'))) continue;
    const to = addDays(local.date, -1);
    const from = addDays(local.date, -7);
    const t = await trendsReport(deps, v.tenant_id, { venueId: v.id, from, to });
    const owners = await deps.db
      .platform()
      .selectFrom('tenant_memberships')
      .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
      .select(['users.email', 'users.locale'])
      .where('tenant_memberships.tenant_id', '=', v.tenant_id)
      .where('tenant_memberships.role', '=', 'owner')
      .where('tenant_memberships.status', '=', 'active')
      .where('tenant_memberships.weekly_summary', '=', true)
      .execute();
    const c = t.current;
    // Figures, not a sentence: each owner's email is written in their language (W07, FR-ADM-19).
    const data = { venue: v.name, from, to, tickets: c.tickets, previousTickets: t.previous.tickets, reachPct: c.reachPushOrLivePct, ackPct: c.acknowledgedPct, pickupSeconds: c.pickupSecondsP50 };
    for (const o of owners) {
      await sendEmail(deps, { template: 'weekly_summary', to: o.email, locale: o.locale, tenantId: v.tenant_id, data, key: `weekly:${v.id}:${from}` });
      sent++;
    }
  }
  return sent;
}
