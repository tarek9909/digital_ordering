const EDGES = [
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
export const canTenantTransition = (from, to) => EDGES.some(([f, t]) => f === from && t === to);
/** Paying lifts only a billing suspension (§8.2). */
export function statusAfterPayment(s) {
    if (s.status === 'trial' || s.status === 'past_due' || s.status === 'trial_expired' || s.status === 'cancelled')
        return 'active';
    if (s.status === 'suspended' && s.suspendedBy === 'billing')
        return 'active';
    return null;
}
/** A platform reactivation restores the status held before the suspension. */
export function statusAfterReactivation(s) {
    if (s.status !== 'suspended')
        return null;
    if (s.suspendedBy === 'billing')
        return null; // only payment lifts billing suspensions
    return s.statusBeforeSuspension ?? 'active';
}
/** Access matrix (§8.2 table; BR-18, BR-23). */
export function tenantAccess(status) {
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
export function staffOperationAllowed(status, op, to) {
    const a = tenantAccess(status);
    if (a.staff === 'full')
        return { ok: true };
    if (a.staff === 'off')
        return { ok: false, code: 'TENANT_INACTIVE' };
    if (op === 'transition' && (to === 'ready' || to === 'collected' || to === 'cancelled'))
        return { ok: true };
    return { ok: false, code: 'TENANT_SUSPENDED' };
}
/** Admin sections reachable with limited access (§8.2: billing, export, team only). */
export const LIMITED_ADMIN_SECTIONS = ['billing', 'export', 'team', 'account', 'tenant'];
/** Grace window after a failed renewal (BR-29): retry days + grace days. */
export function graceEndsAt(failedAt, retryDays, graceDays) {
    return new Date(failedAt.getTime() + (retryDays + graceDays) * 86_400_000);
}
