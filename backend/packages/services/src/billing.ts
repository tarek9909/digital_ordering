import type { Actor } from '@dop/auth';
import { AppError, type PlanLimits } from '@dop/contracts';
import type { Tx } from '@dop/db';
import { graceEndsAt, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import type { Deps } from './deps.js';
import { sendEmail } from './email.js';
import { getSetting } from './platform.js';
import { changeTenantStatus, markPaid } from './tenants.js';

// Billing (TRD §17), without a payment processor. Venues pay offline and the platform team records each payment,
// which extends the tenant's paid-until date. Trials are run by the application (TR-BIL-02); a lapsed paid period
// goes through past due, grace and billing suspension (TR-BIL-07).

type PlatformActor = Actor & { kind: 'platform' };

export type PaymentMethod = 'cash' | 'bank_transfer' | 'wallet' | 'other';

/** Calendar months after `from`, clamped to the last day of a shorter month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * Moves paid_until forward by `months`: from the current paid-until date while it is still ahead, else from now, so
 * paying early never loses days. Returns the covered period. Runs in the caller's transaction.
 */
async function extendPaidPeriod(tx: Tx, now: Date, tenantId: string, months: number) {
  const t = await tx.selectFrom('tenants').select(['paid_until', 'status']).where('id', '=', tenantId).forUpdate().executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  if (t.status === 'deleted') throw new AppError('INVALID_TRANSITION', 'The tenant is deleted');
  const from = t.paid_until && t.paid_until > now ? t.paid_until : now;
  const until = addMonths(from, months);
  await tx.updateTable('tenants').set({ paid_until: until }).where('id', '=', tenantId).execute();
  return { from, until };
}

/** Console "record payment": stores the payment, extends paid_until and lifts a trial, past due or billing suspension. */
export async function recordPayment(
  deps: Deps,
  actor: PlatformActor,
  tenantId: string,
  p: { amountMinor: number; currency: string; months: number; method: PaymentMethod; reference?: string; note?: string; requestId?: string },
) {
  const newId = uuidv7();
  const reference = p.reference || null;
  const recorded = await deps.db
    .platform()
    .transaction()
    .execute(async (tx) => {
      // The tenant row lock serialises payments of one tenant, so the checks below see every earlier payment (BW02).
      const locked = await tx.selectFrom('tenants').select('id').where('id', '=', tenantId).forUpdate().executeTakeFirst();
      if (!locked) throw new AppError('NOT_FOUND');
      // A repeated request (double submit, client retry after a timeout) returns the payment it already recorded.
      if (p.requestId) {
        const same = await tx.selectFrom('tenant_payments').select(['id', 'covers_until']).where('tenant_id', '=', tenantId).where('request_id', '=', p.requestId).executeTakeFirst();
        if (same) return { id: same.id, until: same.covers_until, replay: true };
      }
      // One receipt or transfer number pays once.
      if (reference && (await tx.selectFrom('tenant_payments').select('id').where('tenant_id', '=', tenantId).where('reference', '=', reference).executeTakeFirst())) {
        throw new AppError('VALIDATION_FAILED', 'A payment with this reference is already recorded', { errors: [{ path: 'reference', message: 'taken' }] });
      }
      const id = newId;
      const r = await extendPaidPeriod(tx, deps.now(), tenantId, p.months);
      await tx
        .insertInto('tenant_payments')
        .values({
          id,
          tenant_id: tenantId,
          amount_minor: p.amountMinor,
          currency: p.currency,
          months: p.months,
          method: p.method,
          reference,
          note: p.note || null,
          covers_from: r.from,
          covers_until: r.until,
          recorded_by: actor.platformUserId,
          request_id: p.requestId ?? null,
        })
        .execute();
      await writeAudit(tx, {
        actor,
        action: 'tenant.payment_recorded',
        tenantId,
        entityType: 'tenant_payment',
        entityId: id,
        after: { amountMinor: p.amountMinor, currency: p.currency, months: p.months, method: p.method, paidUntil: r.until.toISOString() },
        purpose: 'billing',
      });
      return { id, until: r.until, replay: false };
    });
  // After the commit; should this step not run, the grace check's reconciliation applies it (BW02).
  await markPaid(deps, tenantId);
  return { id: recorded.id, paidUntil: recorded.until.toISOString(), ...(recorded.replay && { replayed: true }) };
}

/** Free months (FR-SA-07, TR-BIL-09): a running trial gets a longer trial; any other tenant a longer paid period. */
export async function grantFreeMonths(deps: Deps, actor: PlatformActor, tenantId: string, months: number, requestId?: string) {
  const now = deps.now();
  // A repeated submit of the same form (double click, retry after a lost response) grants once (BW02).
  const claim = requestId ? `freemonths:${tenantId}:${requestId}` : null;
  if (claim && !(await deps.kv.setNx(claim, '1', 86_400))) return;
  try {
    await grantFreeMonthsOnce(deps, actor, tenantId, months, now);
  } catch (e) {
    if (claim) await deps.kv.del(claim); // nothing was granted: the same form may try again
    throw e;
  }
}

async function grantFreeMonthsOnce(deps: Deps, actor: PlatformActor, tenantId: string, months: number, now: Date) {
  const lift = await deps.db
    .platform()
    .transaction()
    .execute(async (tx) => {
      const t = await tx.selectFrom('tenants').select(['status', 'trial_ends_at', 'suspended_by']).where('id', '=', tenantId).forUpdate().executeTakeFirst();
      if (!t) throw new AppError('NOT_FOUND');
      let after: Record<string, unknown>;
      if (t.status === 'trial') {
        const until = addMonths(t.trial_ends_at && t.trial_ends_at > now ? t.trial_ends_at : now, months);
        await tx.updateTable('tenants').set({ trial_ends_at: until }).where('id', '=', tenantId).execute();
        after = { freeMonths: months, trialEndsAt: until.toISOString() };
      } else if (t.status === 'active' || t.status === 'past_due' || (t.status === 'suspended' && t.suspended_by === 'billing')) {
        const r = await extendPaidPeriod(tx, now, tenantId, months);
        after = { freeMonths: months, paidUntil: r.until.toISOString() };
      } else throw new AppError('INVALID_TRANSITION', 'Free months need a trial or a paying tenant');
      await writeAudit(tx, { actor, action: 'tenant.trial_extended', tenantId, entityType: 'tenant', entityId: tenantId, after, purpose: 'billing' });
      return t.status !== 'trial' && t.status !== 'active';
    });
  if (lift) await markPaid(deps, tenantId);
}

export async function listPayments(deps: Deps, tenantId: string, limit = 50) {
  const rows = await deps.db.forTenant(tenantId).selectFrom('tenant_payments').selectAll().orderBy('recorded_at', 'desc').limit(limit).execute();
  return rows.map((r) => ({
    id: r.id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    months: r.months,
    method: r.method,
    reference: r.reference,
    note: r.note,
    coversFrom: r.covers_from.toISOString(),
    coversUntil: r.covers_until.toISOString(),
    recordedAt: r.recorded_at.toISOString(),
  }));
}

// ---------------------------------------------------------------- tenant-facing billing (§12.7)

export async function billingOverview(deps: Deps, tenantId: string) {
  const pdb = deps.db.platform();
  const tenant = await pdb
    .selectFrom('tenants')
    .innerJoin('plans', 'plans.id', 'tenants.plan_id')
    .select(['tenants.status', 'tenants.trial_ends_at', 'tenants.paid_until', 'tenants.complimentary', 'tenants.grace_ends_at', 'plans.code', 'plans.name'])
    .where('tenants.id', '=', tenantId)
    .executeTakeFirstOrThrow();
  const payments = await listPayments(deps, tenantId, 24);
  const catalogue = await publicCatalogue(deps);
  return {
    status: tenant.status,
    plan: { code: tenant.code, name: tenant.name },
    complimentary: Boolean(tenant.complimentary),
    trialEndsAt: tenant.trial_ends_at?.toISOString() ?? null,
    paidUntil: tenant.paid_until?.toISOString() ?? null,
    graceEndsAt: tenant.grace_ends_at?.toISOString() ?? null,
    payments,
    // The public price list, for the "contact us to subscribe or renew" panel.
    plans: catalogue,
    prices: catalogue.flatMap((p) => p.prices.map((x) => ({ plan: p.code, name: p.name, period: x.period, currency: x.currency, amountMinor: x.amountMinor }))),
  };
}

/** Public, unarchived, paid plans with their active prices, in catalogue order (site pricing and the billing page). */
export async function publicCatalogue(deps: Pick<Deps, 'db'>) {
  const pdb = deps.db.platform();
  const plans = await pdb.selectFrom('plans').select(['id', 'code', 'name', 'description', 'limits', 'features', 'sort_order']).where('is_public', '=', true).where('archived_at', 'is', null).where('code', '!=', 'trial').orderBy('sort_order').execute();
  const prices = plans.length
    ? await pdb.selectFrom('plan_prices').select(['plan_id', 'period', 'currency', 'amount_minor']).where('active', '=', true).where('plan_id', 'in', plans.map((p) => p.id)).execute()
    : [];
  return plans
    .map((p) => ({
      code: p.code,
      name: p.name,
      description: p.description ?? '',
      limits: p.limits as unknown as PlanLimits,
      features: p.features as unknown as string[],
      prices: prices.filter((x) => x.plan_id === p.id).map((x) => ({ period: x.period, currency: x.currency, amountMinor: x.amount_minor })),
    }))
    .filter((p) => p.prices.length > 0);
}

// ---------------------------------------------------------------- scheduled checks

/**
 * `billing.grace-check` every 15 min (TR-BIL-07). An active, non-complimentary tenant whose paid period ended goes
 * past due with the usual grace window; after it, a billing suspension; after a long suspension, cancellation.
 */
export async function graceCheck(deps: Deps) {
  const db = deps.db.platform();
  const now = deps.now();
  const paid = (t: { paid_until: Date | null }) => t.paid_until !== null && t.paid_until > now;
  // A payment whose status step did not run after its commit (a crash between the two) is applied here, before any
  // lapse is considered (BW02): a past-due or billing-suspended tenant paid beyond now, or a trial with a recorded
  // payment covering now. A cancellation is left to the console.
  const unlifted = await db
    .selectFrom('tenants')
    .select(['id'])
    .where('paid_until', '>', now)
    .where((eb) =>
      eb.or([
        eb('status', '=', 'past_due'),
        eb.and([eb('status', '=', 'suspended'), eb('suspended_by', '=', 'billing')]),
        eb.and([
          eb('status', 'in', ['trial', 'trial_expired']),
          eb.exists(eb.selectFrom('tenant_payments').select('tenant_payments.id').whereRef('tenant_payments.tenant_id', '=', 'tenants.id').where('tenant_payments.covers_until', '>', now)),
        ]),
      ]),
    )
    .execute();
  for (const t of unlifted) await markPaid(deps, t.id);
  // Each step below re-checks its condition on the locked row (onlyIf), so a payment, free months or console change
  // committed after the candidate list was read is never overwritten by this sweep (BW02).
  let lapsed = 0;
  const lapsedRows = await db
    .selectFrom('tenants')
    .select(['id'])
    .where('status', '=', 'active')
    .where('complimentary', '=', false)
    .where((eb) => eb.or([eb('paid_until', 'is', null), eb('paid_until', '<', now)]))
    .execute();
  if (lapsedRows.length) {
    const [retry, grace] = await Promise.all([getSetting(deps, 'billing.retryDays'), getSetting(deps, 'billing.graceDays')]);
    for (const t of lapsedRows) {
      const r = await changeTenantStatus(deps, t.id, {
        to: 'past_due',
        actor: { kind: 'system' },
        reason: 'Paid period ended',
        extra: { past_due_since: now, grace_ends_at: graceEndsAt(now, retry, grace) },
        onlyIf: (cur) => cur.status === 'active' && !cur.complimentary && !paid(cur),
      });
      if (r.status === 'past_due') lapsed++;
    }
  }
  let suspended = 0;
  const pastDue = await db.selectFrom('tenants').select(['id']).where('status', '=', 'past_due').where('grace_ends_at', '<', now).execute();
  for (const t of pastDue) {
    const r = await changeTenantStatus(deps, t.id, {
      to: 'suspended',
      suspendedBy: 'billing',
      actor: { kind: 'system' },
      reason: 'Payment overdue',
      onlyIf: (cur) => cur.status === 'past_due' && cur.grace_ends_at !== null && cur.grace_ends_at < now && !paid(cur),
    });
    if (r.status === 'suspended') suspended++;
  }
  const days = await getSetting(deps, 'billing.suspendedToCancelDays');
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  let cancelled = 0;
  const longSuspended = await db.selectFrom('tenants').select(['id']).where('status', '=', 'suspended').where('suspended_by', '=', 'billing').where('suspended_at', '<', cutoff).execute();
  for (const t of longSuspended) {
    const r = await changeTenantStatus(deps, t.id, {
      to: 'cancelled',
      actor: { kind: 'system' },
      reason: 'Unpaid for 30 days',
      onlyIf: (cur) => cur.status === 'suspended' && cur.suspended_by === 'billing' && cur.suspended_at !== null && cur.suspended_at < cutoff && !paid(cur),
    });
    if (r.status === 'cancelled') cancelled++;
  }
  // Payment reminders on day 3 and day 6 of past due (§19).
  for (const day of [3, 6]) {
    const due = await db
      .selectFrom('tenants')
      .select(['id', 'name'])
      .where('status', '=', 'past_due')
      .where('past_due_since', '<=', new Date(now.getTime() - day * 86_400_000))
      .where('past_due_since', '>', new Date(now.getTime() - (day + 1) * 86_400_000))
      .execute();
    for (const t of due) await remind(deps, t.id, t.name, 'payment_reminder', `remind:${t.id}:${day}`);
  }
  return { lapsed, suspended, cancelled, reconciled: unlifted.length };
}

async function remind(deps: Deps, tenantId: string, tenantName: string, template: 'payment_reminder' | 'trial_ending', key: string) {
  const owner = await deps.db
    .platform()
    .selectFrom('tenant_memberships')
    .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
    .select(['users.email', 'users.locale'])
    .where('tenant_memberships.tenant_id', '=', tenantId)
    .where('tenant_memberships.role', '=', 'owner')
    .where('tenant_memberships.status', '=', 'active')
    .executeTakeFirst();
  if (owner) await sendEmail(deps, { template, to: owner.email, locale: owner.locale, tenantId, data: { tenantName }, key });
}

/** `tenants.trial-check` every 15 min: trial end → trial_expired; 3-day reminder (TR-BIL-08). */
export async function trialCheck(deps: Deps) {
  const db = deps.db.platform();
  const now = deps.now();
  const ended = await db.selectFrom('tenants').select(['id']).where('status', '=', 'trial').where('trial_ends_at', '<', now).execute();
  // Re-checked on the locked row: free months or a payment recorded meanwhile keep the tenant out of expiry (BW02).
  for (const t of ended) {
    await changeTenantStatus(deps, t.id, {
      to: 'trial_expired',
      actor: { kind: 'system' },
      reason: 'Trial ended',
      onlyIf: (cur) => cur.status === 'trial' && cur.trial_ends_at !== null && cur.trial_ends_at < now && !(cur.paid_until !== null && cur.paid_until > now),
    });
  }
  const soon = await db
    .selectFrom('tenants')
    .select(['id', 'name'])
    .where('status', '=', 'trial')
    .where('trial_ends_at', '<=', new Date(now.getTime() + 3 * 86_400_000))
    .where('trial_ends_at', '>', new Date(now.getTime() + 3 * 86_400_000 - 15 * 60_000))
    .execute();
  for (const t of soon) await remind(deps, t.id, t.name, 'trial_ending', `trialend:${t.id}`);
  return { expired: ended.length };
}

// ---------------------------------------------------------------- subscription report (monthly review)

/**
 * Who is active and who is not, and when each one stops or stopped: the paid-until date for running tenants, the
 * suspension or cancellation date for the rest. Sorted so the next to end comes first.
 */
export async function subscriptionReport(deps: Deps) {
  const now = deps.now();
  const rows = await deps.db
    .platform()
    .selectFrom('tenants')
    .select(['id', 'name', 'slug', 'status', 'complimentary', 'paid_until', 'trial_ends_at', 'grace_ends_at', 'suspended_at', 'suspended_by', 'cancelled_at'])
    .where('status', 'in', ['trial', 'active', 'past_due', 'trial_expired', 'suspended', 'cancelled'])
    .orderBy('name')
    .execute();
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const items = rows.map((r) => {
    const running = r.status === 'trial' || r.status === 'active' || r.status === 'past_due';
    // Active tenants end when the paid period does; a complimentary one never lapses.
    const endsAt = r.status === 'trial' ? r.trial_ends_at : r.complimentary && r.status === 'active' ? null : r.status === 'active' ? r.paid_until : r.status === 'past_due' ? r.grace_ends_at : null;
    const stoppedAt = running ? null : (r.status === 'cancelled' ? r.cancelled_at : r.suspended_at);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      complimentary: Boolean(r.complimentary),
      suspendedBy: r.suspended_by,
      endsAt: iso(endsAt),
      stoppedAt: iso(stoppedAt),
      endsInDays: endsAt ? Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000) : null,
    };
  });
  const byEnd = (a: { endsAt: string | null }, b: { endsAt: string | null }) => (a.endsAt ?? '9').localeCompare(b.endsAt ?? '9');
  const running = items.filter((i) => i.status === 'active' || i.status === 'past_due' || i.status === 'trial').sort(byEnd);
  const stopped = items.filter((i) => !running.includes(i)).sort((a, b) => (b.stoppedAt ?? '').localeCompare(a.stoppedAt ?? ''));
  return {
    generatedAt: now.toISOString(),
    counts: { running: running.length, stopped: stopped.length, endingIn30Days: running.filter((i) => i.endsInDays !== null && i.endsInDays <= 30).length },
    running,
    stopped,
  };
}

/** `reports.subscriptions-monthly` on the 1st of each month: the same report, emailed to every active console user. */
export async function sendSubscriptionDigest(deps: Deps) {
  const report = await subscriptionReport(deps);
  const month = report.generatedAt.slice(0, 7);
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
  const data = {
    month,
    running: report.counts.running,
    stopped: report.counts.stopped,
    endingSoon: report.running.filter((i) => i.endsInDays !== null && i.endsInDays <= 30).map((i) => `${i.name}: ${day(i.endsAt)}`),
    stoppedList: report.stopped.map((i) => `${i.name} (${i.status}): ${day(i.stoppedAt)}`),
  };
  const users = await deps.db.platform().selectFrom('platform_users').select(['id', 'email']).where('status', '=', 'active').execute();
  for (const u of users) await sendEmail(deps, { template: 'subscription_digest', to: u.email, locale: 'en', data, key: `subdigest:${month}:${u.id}` });
  return users.length;
}
