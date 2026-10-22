import { AppError } from '@dop/contracts';
import { graceEndsAt, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { sendEmail } from './email.js';
import { getSetting } from './platform.js';
import { changeTenantStatus, markPaid } from './tenants.js';
/** Calendar months after `from`, clamped to the last day of a shorter month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(from, months) {
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
async function extendPaidPeriod(tx, now, tenantId, months) {
    const t = await tx.selectFrom('tenants').select(['paid_until', 'status']).where('id', '=', tenantId).forUpdate().executeTakeFirst();
    if (!t)
        throw new AppError('NOT_FOUND');
    if (t.status === 'deleted')
        throw new AppError('INVALID_TRANSITION', 'The tenant is deleted');
    const from = t.paid_until && t.paid_until > now ? t.paid_until : now;
    const until = addMonths(from, months);
    await tx.updateTable('tenants').set({ paid_until: until }).where('id', '=', tenantId).execute();
    return { from, until };
}
/** Console "record payment": stores the payment, extends paid_until and lifts a trial, past due or billing suspension. */
export async function recordPayment(deps, actor, tenantId, p) {
    const id = uuidv7();
    const period = await deps.db
        .platform()
        .transaction()
        .execute(async (tx) => {
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
            reference: p.reference || null,
            note: p.note || null,
            covers_from: r.from,
            covers_until: r.until,
            recorded_by: actor.platformUserId,
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
        return r;
    });
    await markPaid(deps, tenantId);
    return { id, paidUntil: period.until.toISOString() };
}
/** Free months (FR-SA-07, TR-BIL-09): a running trial gets a longer trial; any other tenant a longer paid period. */
export async function grantFreeMonths(deps, actor, tenantId, months) {
    const now = deps.now();
    const lift = await deps.db
        .platform()
        .transaction()
        .execute(async (tx) => {
        const t = await tx.selectFrom('tenants').select(['status', 'trial_ends_at', 'suspended_by']).where('id', '=', tenantId).forUpdate().executeTakeFirst();
        if (!t)
            throw new AppError('NOT_FOUND');
        let after;
        if (t.status === 'trial') {
            const until = addMonths(t.trial_ends_at && t.trial_ends_at > now ? t.trial_ends_at : now, months);
            await tx.updateTable('tenants').set({ trial_ends_at: until }).where('id', '=', tenantId).execute();
            after = { freeMonths: months, trialEndsAt: until.toISOString() };
        }
        else if (t.status === 'active' || t.status === 'past_due' || (t.status === 'suspended' && t.suspended_by === 'billing')) {
            const r = await extendPaidPeriod(tx, now, tenantId, months);
            after = { freeMonths: months, paidUntil: r.until.toISOString() };
        }
        else
            throw new AppError('INVALID_TRANSITION', 'Free months need a trial or a paying tenant');
        await writeAudit(tx, { actor, action: 'tenant.trial_extended', tenantId, entityType: 'tenant', entityId: tenantId, after, purpose: 'billing' });
        return t.status !== 'trial' && t.status !== 'active';
    });
    if (lift)
        await markPaid(deps, tenantId);
}
export async function listPayments(deps, tenantId, limit = 50) {
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
export async function billingOverview(deps, tenantId) {
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
export async function publicCatalogue(deps) {
    const pdb = deps.db.platform();
    const plans = await pdb.selectFrom('plans').select(['id', 'code', 'name', 'limits', 'features', 'sort_order']).where('is_public', '=', true).where('archived_at', 'is', null).where('code', '!=', 'trial').orderBy('sort_order').execute();
    const prices = plans.length
        ? await pdb.selectFrom('plan_prices').select(['plan_id', 'period', 'currency', 'amount_minor']).where('active', '=', true).where('plan_id', 'in', plans.map((p) => p.id)).execute()
        : [];
    return plans
        .map((p) => ({
        code: p.code,
        name: p.name,
        limits: p.limits,
        features: p.features,
        prices: prices.filter((x) => x.plan_id === p.id).map((x) => ({ period: x.period, currency: x.currency, amountMinor: x.amount_minor })),
    }))
        .filter((p) => p.prices.length > 0);
}
// ---------------------------------------------------------------- scheduled checks
/**
 * `billing.grace-check` every 15 min (TR-BIL-07). An active, non-complimentary tenant whose paid period ended goes
 * past due with the usual grace window; after it, a billing suspension; after a long suspension, cancellation.
 */
export async function graceCheck(deps) {
    const db = deps.db.platform();
    const now = deps.now();
    const lapsed = await db
        .selectFrom('tenants')
        .select(['id'])
        .where('status', '=', 'active')
        .where('complimentary', '=', false)
        .where((eb) => eb.or([eb('paid_until', 'is', null), eb('paid_until', '<', now)]))
        .execute();
    if (lapsed.length) {
        const [retry, grace] = await Promise.all([getSetting(deps, 'billing.retryDays'), getSetting(deps, 'billing.graceDays')]);
        for (const t of lapsed) {
            await changeTenantStatus(deps, t.id, { to: 'past_due', actor: { kind: 'system' }, reason: 'Paid period ended', extra: { past_due_since: now, grace_ends_at: graceEndsAt(now, retry, grace) } });
        }
    }
    const pastDue = await db.selectFrom('tenants').select(['id']).where('status', '=', 'past_due').where('grace_ends_at', '<', now).execute();
    for (const t of pastDue)
        await changeTenantStatus(deps, t.id, { to: 'suspended', suspendedBy: 'billing', actor: { kind: 'system' }, reason: 'Payment overdue' });
    const days = await getSetting(deps, 'billing.suspendedToCancelDays');
    const longSuspended = await db
        .selectFrom('tenants')
        .select(['id'])
        .where('status', '=', 'suspended')
        .where('suspended_by', '=', 'billing')
        .where('suspended_at', '<', new Date(now.getTime() - days * 86_400_000))
        .execute();
    for (const t of longSuspended) {
        await changeTenantStatus(deps, t.id, { to: 'cancelled', actor: { kind: 'system' }, reason: 'Unpaid for 30 days' });
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
        for (const t of due)
            await remind(deps, t.id, t.name, 'payment_reminder', `remind:${t.id}:${day}`);
    }
    return { lapsed: lapsed.length, suspended: pastDue.length, cancelled: longSuspended.length };
}
async function remind(deps, tenantId, tenantName, template, key) {
    const owner = await deps.db
        .platform()
        .selectFrom('tenant_memberships')
        .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
        .select(['users.email', 'users.locale'])
        .where('tenant_memberships.tenant_id', '=', tenantId)
        .where('tenant_memberships.role', '=', 'owner')
        .where('tenant_memberships.status', '=', 'active')
        .executeTakeFirst();
    if (owner)
        await sendEmail(deps, { template, to: owner.email, locale: owner.locale, tenantId, data: { tenantName }, key });
}
/** `tenants.trial-check` every 15 min: trial end → trial_expired; 3-day reminder (TR-BIL-08). */
export async function trialCheck(deps) {
    const db = deps.db.platform();
    const now = deps.now();
    const ended = await db.selectFrom('tenants').select(['id']).where('status', '=', 'trial').where('trial_ends_at', '<', now).execute();
    for (const t of ended)
        await changeTenantStatus(deps, t.id, { to: 'trial_expired', actor: { kind: 'system' }, reason: 'Trial ended' });
    const soon = await db
        .selectFrom('tenants')
        .select(['id', 'name'])
        .where('status', '=', 'trial')
        .where('trial_ends_at', '<=', new Date(now.getTime() + 3 * 86_400_000))
        .where('trial_ends_at', '>', new Date(now.getTime() + 3 * 86_400_000 - 15 * 60_000))
        .execute();
    for (const t of soon)
        await remind(deps, t.id, t.name, 'trial_ending', `trialend:${t.id}`);
    return { expired: ended.length };
}
