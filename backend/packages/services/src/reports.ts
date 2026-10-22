import { AppError, CANCEL_REASONS } from '@dop/contracts';
import { json, scope } from '@dop/db';
import {
  addDays,
  addToHistogram,
  businessDate,
  emptyHistogram,
  histogramPercentile,
  mergeHistograms,
  percentile,
  prepSeconds,
  toZoned,
  type Histogram,
} from '@dop/domain';
import type { Deps } from './deps.js';
import { keys } from './kv.js';

// Reports (TRD §20): Today live from tickets (TR-RPT-01), everything else from report_daily roll-ups
// (TR-RPT-02, TR-RPT-07). The pilot report covers FR-RPT-10 / TR-RPT-08. Wording: "push sent", "page open",
// "acknowledged" — never "heard" (FR-ALR-11).

const secs = (a: Date | null, b: Date | null) => (a && b ? Math.max(0, (b.getTime() - a.getTime()) / 1000) : null);

export async function todayReport(deps: Deps, tenantId: string, venueId: string) {
  const cacheKey = keys.todayCache(tenantId, venueId);
  const cached = await deps.kv.get(cacheKey);
  if (cached) return JSON.parse(cached) as unknown;
  const db = deps.db.forTenant(tenantId);
  const v = await db.selectFrom('venues').select(['time_zone', 'reset_time', 'pending_reset_time', 'pending_time_zone', 'pending_from_date']).where('id', '=', venueId).executeTakeFirst();
  if (!v) throw new AppError('NOT_FOUND');
  const bd = businessDate(deps.now(), v.time_zone, { resetTime: v.reset_time, pendingResetTime: v.pending_reset_time, pendingTimeZone: v.pending_time_zone, pendingFromDate: v.pending_from_date });
  const rows = await db
    .selectFrom('tickets')
    .select(['status', 'created_at', 'preparing_at', 'first_ready_at', 'ready_at', 'collected_at', 'alert_level_at_ready', 'acknowledged_at'])
    .where('venue_id', '=', venueId)
    .where('business_date', '=', bd)
    .execute();
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const ready = rows.filter((r) => r.first_ready_at);
  const reach = { push: 0, live: 0, closed: 0, none: 0 };
  for (const r of ready) reach[r.alert_level_at_ready ?? 'none']++;
  const prep = ready.map((r) => prepSeconds(r.created_at, r.preparing_at, r.first_ready_at)!).filter((x) => x !== null);
  const pickup = rows.filter((r) => r.collected_at).map((r) => secs(r.ready_at, r.collected_at)!);
  const out = {
    businessDate: bd,
    tickets: rows.length,
    byStatus,
    open: (byStatus.received ?? 0) + (byStatus.preparing ?? 0) + (byStatus.ready ?? 0),
    alertReach: reach,
    reachPushOrLivePct: ready.length ? Math.round(((reach.push + reach.live) / ready.length) * 100) : null,
    acknowledgedPct: ready.length ? Math.round((ready.filter((r) => r.acknowledged_at).length / ready.length) * 100) : null,
    prepSecondsP50: percentile(prep, 50),
    pickupSecondsP50: percentile(pickup, 50),
    prepLabel: 'from ticket creation', // TR-RPT-05
  };
  await deps.kv.set(cacheKey, JSON.stringify(out), 15);
  return out;
}

interface Bucket {
  created: number;
  collected: number;
  cancelled: number;
  expired: number;
  expiredUncollectedReady: number;
  reach: Record<'push' | 'live' | 'closed' | 'none', number>;
  acknowledged: number;
  neededRepeat: number;
  readyUndone: number;
  ratingsCount: number;
  ratingsSum: number;
  ratingDist: number[];
  prep: Histogram;
  pickup: Histogram;
  total: Histogram;
  prepRaw: number[];
  pickupRaw: number[];
  totalRaw: number[];
  cancelReasons: Record<string, number>;
  uaReach: Record<string, Record<string, number>>;
}

const newBucket = (): Bucket => ({
  created: 0,
  collected: 0,
  cancelled: 0,
  expired: 0,
  expiredUncollectedReady: 0,
  reach: { push: 0, live: 0, closed: 0, none: 0 },
  acknowledged: 0,
  neededRepeat: 0,
  readyUndone: 0,
  ratingsCount: 0,
  ratingsSum: 0,
  ratingDist: [0, 0, 0, 0, 0],
  prep: emptyHistogram(),
  pickup: emptyHistogram(),
  total: emptyHistogram(),
  prepRaw: [],
  pickupRaw: [],
  totalRaw: [],
  cancelReasons: Object.fromEntries(CANCEL_REASONS.map((r) => [r, 0])),
  uaReach: {},
});

/** Idempotent hourly + whole-day roll-up for one venue and business date (TR-RPT-02). */
export async function rollupVenueDay(deps: Deps, tenantId: string, venueId: string, bd: string): Promise<number> {
  const db = deps.db.forTenant(tenantId);
  const v = await db.selectFrom('venues').select(['time_zone']).where('id', '=', venueId).executeTakeFirst();
  if (!v) return 0;
  const tickets = await db.selectFrom('tickets').selectAll().where('venue_id', '=', venueId).where('business_date', '=', bd).execute();
  if (tickets.length === 0) return 0;
  const ids = tickets.map((t) => t.id);
  const [undos, ratings, followers] = await Promise.all([
    db.selectFrom('ticket_events').select(['ticket_id', 'data']).where('ticket_id', 'in', ids).where('type', '=', 'transition').where('to_status', '=', 'preparing').where('from_status', '=', 'ready').execute(),
    db.selectFrom('ratings').select(['ticket_id', 'stars']).where('ticket_id', 'in', ids).where('deleted_at', 'is', null).execute(),
    db.selectFrom('ticket_followers').select(['ticket_id', 'ua_family']).where('ticket_id', 'in', ids).execute(),
  ]);
  const undone = new Set(undos.map((u) => u.ticket_id));
  const ratingBy = new Map(ratings.map((r) => [r.ticket_id, r.stars]));
  const uaBy = new Map<string, string>();
  for (const f of followers) if (!uaBy.has(f.ticket_id)) uaBy.set(f.ticket_id, f.ua_family);

  const buckets = new Map<string, Bucket>(); // `${counterKey}|${hour}`
  const get = (counter: string, hour: number) => {
    const k = `${counter}|${hour}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = newBucket()));
    return b;
  };
  for (const t of tickets) {
    const hour = Number(toZoned(t.created_at, v.time_zone).time.slice(0, 2));
    for (const counter of ['', ...(t.counter_id ? [t.counter_id] : [])]) {
      for (const b of [get(counter, hour), get(counter, 24)]) {
        b.created++;
        if (t.status === 'collected') b.collected++;
        if (t.status === 'cancelled') {
          b.cancelled++;
          if (t.cancel_reason) b.cancelReasons[t.cancel_reason] = (b.cancelReasons[t.cancel_reason] ?? 0) + 1;
        }
        if (t.status === 'expired') {
          b.expired++;
          if (t.first_ready_at) b.expiredUncollectedReady++;
        }
        if (t.first_ready_at) {
          const level = t.alert_level_at_ready ?? 'none';
          b.reach[level]++;
          const ua = uaBy.get(t.id) ?? 'none';
          b.uaReach[ua] ??= {};
          b.uaReach[ua]![level] = (b.uaReach[ua]![level] ?? 0) + 1;
          if (t.acknowledged_at) b.acknowledged++;
          if (t.auto_alerts_sent >= 2) b.neededRepeat++;
          if (undone.has(t.id)) b.readyUndone++;
          const p = prepSeconds(t.created_at, t.preparing_at, t.first_ready_at);
          if (p !== null) {
            addToHistogram(b.prep, p);
            b.prepRaw.push(p);
          }
        }
        if (t.collected_at && t.ready_at) {
          const pk = secs(t.ready_at, t.collected_at)!;
          addToHistogram(b.pickup, pk);
          b.pickupRaw.push(pk);
          const tot = secs(t.created_at, t.collected_at)!;
          addToHistogram(b.total, tot);
          b.totalRaw.push(tot);
        }
        const stars = ratingBy.get(t.id);
        if (stars) {
          b.ratingsCount++;
          b.ratingsSum += stars;
          b.ratingDist[stars - 1]!++;
        }
      }
    }
  }
  for (const [k, b] of buckets) {
    const [counterKey, hourStr] = k.split('|') as [string, string];
    const row = {
      tenant_id: tenantId,
      venue_id: venueId,
      counter_key: counterKey,
      business_date: bd,
      hour_local: Number(hourStr),
      tickets_created: b.created,
      tickets_collected: b.collected,
      tickets_cancelled: b.cancelled,
      tickets_expired: b.expired,
      tickets_expired_uncollected_ready: b.expiredUncollectedReady,
      prep_seconds_p50: percentile(b.prepRaw, 50),
      prep_seconds_p90: percentile(b.prepRaw, 90),
      pickup_seconds_p50: percentile(b.pickupRaw, 50),
      pickup_seconds_p90: percentile(b.pickupRaw, 90),
      total_seconds_p50: percentile(b.totalRaw, 50),
      reach_push: b.reach.push,
      reach_live: b.reach.live,
      reach_closed: b.reach.closed,
      reach_none: b.reach.none,
      acknowledged: b.acknowledged,
      needed_repeat: b.neededRepeat,
      ready_undone: b.readyUndone,
      ratings_count: b.ratingsCount,
      ratings_sum: b.ratingsSum,
      rating_dist: json(b.ratingDist),
      prep_hist: json(b.prep),
      pickup_hist: json(b.pickup),
      total_hist: json(b.total),
      cancel_reasons: json(b.cancelReasons),
      ua_reach: json(b.uaReach),
    };
    const { tenant_id: _t, venue_id: _v, counter_key: _c, business_date: _d, hour_local: _h, ...update } = row;
    await db.insertInto('report_daily').values(row).onDuplicateKeyUpdate(update).execute();
  }
  return buckets.size;
}

const round = (x: number | null) => (x === null ? null : Math.round(x));

/** Pilot report (FR-RPT-10, TR-RPT-08): per day and for the range, from roll-ups (read replica, TR-RPT-03). */
export async function pilotReport(deps: Deps, tenantId: string, venueId: string | undefined, from: string, to: string) {
  if (to < from) throw new AppError('VALIDATION_FAILED', '`to` is before `from`');
  let q = scope(deps.db.replica(), tenantId)
    .selectFrom('report_daily')
    .selectAll()
    .where('counter_key', '=', '')
    .where('hour_local', '=', 24)
    .where('business_date', '>=', from)
    .where('business_date', '<=', to);
  if (venueId) q = q.where('venue_id', '=', venueId);
  const rows = await q.orderBy('business_date').execute();
  const summarise = (rs: typeof rows) => {
    const sum = (f: (r: (typeof rows)[number]) => number) => rs.reduce((a, r) => a + f(r), 0);
    const readyTotal = sum((r) => r.reach_push + r.reach_live + r.reach_closed + r.reach_none);
    const prep = mergeHistograms(rs.map((r) => r.prep_hist as unknown as number[]));
    const pickup = mergeHistograms(rs.map((r) => r.pickup_hist as unknown as number[]));
    return {
      tickets: sum((r) => r.tickets_created),
      readyTickets: readyTotal,
      alertReach: { push: sum((r) => r.reach_push), live: sum((r) => r.reach_live), closed: sum((r) => r.reach_closed), none: sum((r) => r.reach_none) },
      reachPushOrLivePct: readyTotal ? round(((sum((r) => r.reach_push) + sum((r) => r.reach_live)) / readyTotal) * 100) : null,
      acknowledgedPct: readyTotal ? round((sum((r) => r.acknowledged) / readyTotal) * 100) : null,
      prepSecondsP50: histogramPercentile(prep, 50),
      prepSecondsP90: histogramPercentile(prep, 90),
      pickupSecondsP50: histogramPercentile(pickup, 50),
      pickupSecondsP90: histogramPercentile(pickup, 90),
      uncollected: sum((r) => r.tickets_expired_uncollected_ready),
      undoPct: readyTotal ? round((sum((r) => r.ready_undone) / readyTotal) * 100) : null,
    };
  };
  const days = [...new Set(rows.map((r) => r.business_date))];
  return {
    from,
    to,
    prepLabel: 'from ticket creation',
    total: summarise(rows),
    days: days.map((d) => ({ date: d, ...summarise(rows.filter((r) => r.business_date === d)) })),
  };
}

/** Venues and business dates to roll up: today and yesterday in each venue's zone (corrections within +1 day). */
export async function rollupTargets(deps: Deps) {
  const venues = await deps.db.platform().selectFrom('venues').select(['id', 'tenant_id', 'time_zone', 'reset_time', 'pending_reset_time', 'pending_time_zone', 'pending_from_date']).where('status', '=', 'active').execute();
  return venues.flatMap((v) => {
    const today = businessDate(deps.now(), v.time_zone, { resetTime: v.reset_time, pendingResetTime: v.pending_reset_time, pendingTimeZone: v.pending_time_zone, pendingFromDate: v.pending_from_date });
    return [today, addDays(today, -1)].map((bd) => ({ tenantId: v.tenant_id, venueId: v.id, businessDate: bd }));
  });
}
