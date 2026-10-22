import type { TenantStatus } from '@dop/contracts';

// Tenant lifecycle (TRD §8.2; BRD BR-16, BR-18, BR-23, BR-25, BR-29).

export type SuspendCause = 'billing' | 'platform';

const EDGES: Array<[TenantStatus, TenantStatus]> = [
  ['trial', 'active'],
  ['trial', 'trial_expired'],
  ['active', 'past_due'],
  ['active', 'cancelled'],
  ['active', 'trial_expired'],
  ['past_due', 'active'],
  ['past_due', 'suspended'],
  ['trial', 'suspended'],
  ['active', 'suspended'],
  ['suspended', 'active'],
  ['suspended', 'cancelled'],
  ['suspended', 'trial'],
  ['suspended', 'past_due'],
  ['trial_expired', 'active'],
  ['cancelled', 'active'],
  ['trial_expired', 'deleted'],
  ['cancelled', 'deleted'],
  ['trial', 'deleted'],
  ['active', 'deleted'],
  ['past_due', 'deleted'],
  ['suspended', 'deleted'],
];

export const canTenantTransition = (from: TenantStatus, to: TenantStatus) =>
  EDGES.some(([f, t]) => f === from && t === to);

export interface SuspensionState {
  status: TenantStatus;
  suspendedBy: SuspendCause | null;
  statusBeforeSuspension: 'trial' | 'active' | 'past_due' | null;
}

/** Paying lifts only a billing suspension (§8.2). */
export function statusAfterPayment(s: SuspensionState): TenantStatus | null {
  if (s.status === 'trial' || s.status === 'past_due' || s.status === 'trial_expired' || s.status === 'cancelled') return 'active';
  if (s.status === 'suspended' && s.suspendedBy === 'billing') return 'active';
  return null;
}

/** A platform reactivation restores the status held before the suspension. */
export function statusAfterReactivation(s: SuspensionState): TenantStatus | null {
  if (s.status !== 'suspended') return null;
  if (s.suspendedBy === 'billing') return null; // only payment lifts billing suspensions
  return s.statusBeforeSuspension ?? 'active';
}

export type StaffAccess = 'full' | 'close_only' | 'off';
export type AdminAccess = 'full' | 'limited' | 'none';
export type CustomerAccess = 'all' | 'closed_only' | 'gone';
export type ApiAccess = 'plan' | 'read_only' | 'none' | 'unauthenticated';

export interface TenantAccess {
  admin: AdminAccess;
  staff: StaffAccess;
  newTickets: boolean;
  display: boolean;
  customer: CustomerAccess;
  api: ApiAccess;
  paymentBanner: boolean;
}

/** Access matrix (§8.2 table; BR-18, BR-23). */
export function tenantAccess(status: TenantStatus): TenantAccess {
  switch (status) {
    case 'trial':
      return { admin: 'full', staff: 'full', newTickets: true, display: true, customer: 'all', api: 'none', paymentBanner: false };
    case 'active':
      return { admin: 'full', staff: 'full', newTickets: true, display: true, customer: 'all', api: 'plan', paymentBanner: false };
    case 'past_due':
      return { admin: 'full', staff: 'full', newTickets: true, display: true, customer: 'all', api: 'plan', paymentBanner: true };
    case 'suspended':
      return { admin: 'limited', staff: 'close_only', newTickets: false, display: true, customer: 'all', api: 'read_only', paymentBanner: true };
    case 'trial_expired':
    case 'cancelled':
      return { admin: 'limited', staff: 'off', newTickets: false, display: false, customer: 'closed_only', api: 'none', paymentBanner: true };
    case 'deleted':
      return { admin: 'none', staff: 'off', newTickets: false, display: false, customer: 'gone', api: 'unauthenticated', paymentBanner: false };
  }
}

/** Staff operations while suspended (BR-18): only Ready, Collected and Cancel on open tickets. */
export function staffOperationAllowed(
  status: TenantStatus,
  op: 'create' | 'transition' | 'edit' | 'alert',
  to?: string,
): { ok: true } | { ok: false; code: 'TENANT_SUSPENDED' | 'TENANT_INACTIVE' } {
  const a = tenantAccess(status);
  if (a.staff === 'full') return { ok: true };
  if (a.staff === 'off') return { ok: false, code: 'TENANT_INACTIVE' };
  if (op === 'transition' && (to === 'ready' || to === 'collected' || to === 'cancelled')) return { ok: true };
  return { ok: false, code: 'TENANT_SUSPENDED' };
}

/** Admin sections reachable with limited access (§8.2: billing, export, team only). */
export const LIMITED_ADMIN_SECTIONS = ['billing', 'export', 'team', 'account', 'tenant'] as const;

/** Grace window after a failed renewal (BR-29): retry days + grace days. */
export function graceEndsAt(failedAt: Date, retryDays: number, graceDays: number): Date {
  return new Date(failedAt.getTime() + (retryDays + graceDays) * 86_400_000);
}
