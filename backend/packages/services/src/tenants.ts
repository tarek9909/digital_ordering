import type { Actor } from '@dop/auth';
import { AppError, type TenantStatus } from '@dop/contracts';
import type { Tenant, Tx } from '@dop/db';
import { canTenantTransition, statusAfterPayment, statusAfterReactivation } from '@dop/domain';
import { writeAudit } from './audit.js';
import type { Deps } from './deps.js';
import { sendEmail, type EmailTemplate } from './email.js';
import { keys } from './kv.js';
import { addOutbox, flushOutbox } from './outbox.js';
import { getSetting } from './platform.js';

// TenantLifecycleService (TRD §8.2, TR-TEN-15, TR-TEN-16, TR-TEN-18). The only code that changes tenant status.

export interface StatusChange {
  to: TenantStatus;
  actor: Actor;
  reason?: string | null;
  suspendedBy?: 'billing' | 'platform';
  requestId?: string | null;
  ip?: string | null;
  /** Extra columns written with the change (e.g. past_due_since). */
  extra?: Partial<Record<'past_due_since' | 'grace_ends_at' | 'purge_after' | 'trial_ends_at', Date | null>>;
  email?: EmailTemplate | null;
  /**
   * Precondition checked on the locked row (BW02): when it is false the change is skipped and the current row is
   * returned. Sweeps and post-payment updates pass the condition they decided on, so a decision made before a
   * concurrent payment, free months or other change never overwrites the newer state.
   */
  onlyIf?: (t: Tenant) => boolean;
}

const STATUS_EMAIL: Partial<Record<TenantStatus, EmailTemplate>> = {
  trial_expired: 'trial_ended',
  past_due: 'payment_failed',
  cancelled: 'subscription_cancelled',
};

export async function getTenantStatus(deps: Pick<Deps, 'db' | 'kv'>, tenantId: string): Promise<TenantStatus | null> {
  const k = keys.tenantStatus(tenantId);
  const cached = await deps.kv.get(k);
  if (cached) return cached as TenantStatus;
  const row = await deps.db.platform().selectFrom('tenants').select('status').where('id', '=', tenantId).executeTakeFirst();
  if (!row) return null;
  await deps.kv.set(k, row.status, 60);
  return row.status;
}

async function lockTenant(tx: Tx, tenantId: string): Promise<Tenant> {
  const t = await tx.selectFrom('tenants').selectAll().where('id', '=', tenantId).forUpdate().executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  return t;
}

export async function changeTenantStatus(deps: Deps, tenantId: string, c: StatusChange): Promise<Tenant> {
  const now = deps.now();
  let outboxId = 0;
  let owner: { email: string; locale: string } | undefined;
  const closedDays = await getSetting(deps, 'retention.closedTenantDays');
  const updated = await deps.db.platform().transaction().execute(async (tx) => {
    const t = await lockTenant(tx, tenantId);
    if (c.onlyIf && !c.onlyIf(t)) return t;
    if (t.status === c.to && c.to !== 'suspended') return t;
    if (!canTenantTransition(t.status, c.to)) {
      throw new AppError('INVALID_TRANSITION', `Tenant cannot move from ${t.status} to ${c.to}`);
    }
    const patch: Record<string, unknown> = { status: c.to, status_reason: c.reason ?? null, ...c.extra };
    if (c.to === 'suspended') {
      patch.suspended_by = c.suspendedBy ?? 'platform';
      patch.suspended_at = now;
      if (t.status === 'trial' || t.status === 'active' || t.status === 'past_due') patch.status_before_suspension = t.status;
    } else {
      patch.suspended_by = null;
      patch.suspended_at = null;
      patch.status_before_suspension = null;
    }
    if (c.to === 'active') {
      patch.past_due_since = null;
      patch.grace_ends_at = null;
      patch.purge_after = null;
    }
    if (c.to === 'cancelled') patch.cancelled_at = now;
    if (c.to === 'cancelled' || c.to === 'trial_expired') {
      patch.purge_after = c.extra?.purge_after ?? new Date(now.getTime() + closedDays * 86_400_000);
    }
    if (c.to === 'deleted') patch.deleted_at = now;
    await tx.updateTable('tenants').set(patch).where('id', '=', tenantId).execute();
    await writeAudit(tx, {
      actor: c.actor,
      action: c.to === 'suspended' ? 'tenant.suspended' : t.status === 'suspended' ? 'tenant.reactivated' : c.to === 'deleted' ? 'tenant.deleted' : c.to === 'cancelled' ? 'tenant.cancelled' : 'tenant.status_changed',
      tenantId,
      entityType: 'tenant',
      entityId: tenantId,
      before: { status: t.status },
      after: { status: c.to, reason: c.reason ?? null },
      requestId: c.requestId,
      ip: c.ip,
      visibleToTenant: true,
    });
    outboxId = await addOutbox(tx, 'tenant.status_changed', tenantId, { emit: { status: c.to } });
    owner = await tx
      .selectFrom('tenant_memberships')
      .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
      .select(['users.email', 'users.locale'])
      .where('tenant_memberships.tenant_id', '=', tenantId)
      .where('tenant_memberships.role', '=', 'owner')
      .where('tenant_memberships.status', '=', 'active')
      .executeTakeFirst();
    return { ...t, ...patch } as Tenant;
  });
  await deps.kv.del(keys.tenantStatus(tenantId), keys.tenantFlags(tenantId));
  await flushOutbox(deps, [outboxId]);
  const template =
    c.email === null
      ? null
      : (c.email ??
        (c.to === 'suspended'
          ? c.suspendedBy === 'billing'
            ? 'suspended_billing'
            : 'suspended_platform'
          : updated.status === 'active' && c.actor.kind === 'platform'
            ? 'reactivated'
            : STATUS_EMAIL[c.to]));
  if (template && owner) {
    await sendEmail(deps, {
      template,
      to: owner.email,
      locale: owner.locale,
      tenantId,
      data: { tenantName: updated.name, reason: c.reason ?? null },
      key: `${template}:${tenantId}:${now.toISOString().slice(0, 16)}`,
    });
  }
  return updated;
}

/** Super admin suspension (EX-14): no new tickets, open ones can finish (BR-18). */
export const suspendTenant = (deps: Deps, tenantId: string, actor: Actor, reason: string, requestId?: string) =>
  changeTenantStatus(deps, tenantId, { to: 'suspended', suspendedBy: 'platform', actor, reason, requestId });

export async function reactivateTenant(deps: Deps, tenantId: string, actor: Actor, requestId?: string): Promise<Tenant> {
  const t = await deps.db.platform().selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirstOrThrow();
  const to = statusAfterReactivation({ status: t.status, suspendedBy: t.suspended_by, statusBeforeSuspension: t.status_before_suspension });
  if (!to) throw new AppError('INVALID_TRANSITION', 'Only a platform suspension can be lifted here; billing suspensions end on payment');
  return changeTenantStatus(deps, tenantId, { to, actor, requestId });
}

/**
 * Applies a payment's status effect (lifting a trial, past due or billing suspension). The target is computed from the
 * row and re-checked under its lock, so a sweep that moved the tenant meanwhile is honoured (BW02): the target is
 * recomputed from the newer status instead of being applied to a status it was not computed for.
 */
export async function markPaid(deps: Deps, tenantId: string): Promise<Tenant | null> {
  for (let i = 0; i < 3; i++) {
    const t = await deps.db.platform().selectFrom('tenants').selectAll().where('id', '=', tenantId).executeTakeFirstOrThrow();
    const to = statusAfterPayment({ status: t.status, suspendedBy: t.suspended_by, statusBeforeSuspension: t.status_before_suspension });
    if (!to || to === t.status) return null;
    const r = await changeTenantStatus(deps, tenantId, {
      to,
      actor: { kind: 'system' },
      email: t.status === 'suspended' || t.status === 'cancelled' ? 'subscription_reactivated' : null,
      onlyIf: (cur) => cur.status === t.status && cur.suspended_by === t.suspended_by,
    });
    if (r.status === to) return r;
  }
  return null;
}
