import { AppError } from '@dop/contracts';
import type { Actor } from './context.js';

// RBAC (TRD §14.2). One authorize() for every route (TR-AUTH-09); routes declare their permission.

export const PERMISSIONS = [
  'tickets.write', // create, transition, edit, alert
  'board.view',
  'display.view',
  'venue.settings',
  'venue.staff_access', // staff access, devices, displays
  'venue.staff_credentials', // reveal or rotate the staff link, set the PIN, add or pair displays (M-13)
  'ratings.moderate', // delete customer comments (L-10)
  'team.invite_managers',
  'team.manage', // remove, change roles, transfer ownership
  'reports.view', // reports, ratings, activity
  'billing.view',
  'billing.manage',
  'integrations.view',
  'integrations.manage', // API keys, webhooks, POS
  'tenant.export',
  'tenant.delete',
  'support.decide', // approve, refuse, generate support code
  'account.self',
  // platform
  'console.notes',
  'console.tenants.read',
  'console.tenants.lifecycle',
  'console.commercial',
  'console.ownership',
  'console.devices',
  'console.settings', // plans, prices, coupons, flags, settings
  'console.support', // request, enter support access
  'console.support.emergency',
  'console.reports',
  'console.billing.read',
  'console.audit',
  'console.platform_users',
  'public', // no actor needed
] as const;
export type Permission = (typeof PERMISSIONS)[number];

type Grant = Partial<Record<Permission, true>>;
const g = (...ps: Permission[]): Grant => Object.fromEntries(ps.map((p) => [p, true]));

const OWNER = g(
  'tickets.write', 'board.view', 'venue.settings', 'venue.staff_access', 'venue.staff_credentials', 'team.invite_managers',
  'team.manage', 'reports.view', 'ratings.moderate', 'billing.view', 'billing.manage', 'integrations.view',
  'integrations.manage', 'tenant.export', 'tenant.delete', 'support.decide', 'account.self',
);
const MANAGER = g(
  'tickets.write', 'board.view', 'venue.settings', 'venue.staff_access', 'venue.staff_credentials', 'team.invite_managers',
  'reports.view', 'support.decide', 'account.self',
);
// TR-AUTH-10: support sessions cannot change billing, create API keys, transfer ownership, delete, export
// or approve support sessions; billing and integrations are view only. They see and can revoke staff devices
// and displays but never obtain staff credentials that would outlive the session (M-13).
const SUPPORT_SESSION = g('tickets.write', 'board.view', 'venue.settings', 'venue.staff_access', 'reports.view', 'billing.view', 'integrations.view');
const STAFF_DEVICE = g('tickets.write', 'board.view');
const DISPLAY = g('display.view');
const API_KEY = g('tickets.write');

const PLATFORM: Record<'super_admin' | 'support' | 'finance', Grant> = {
  super_admin: g(
    'console.notes', 'console.tenants.read', 'console.tenants.lifecycle', 'console.commercial',
    'console.ownership', 'console.devices', 'console.settings', 'console.support', 'console.support.emergency',
    'console.reports', 'console.billing.read', 'console.audit', 'console.platform_users',
  ),
  support: g('console.notes', 'console.tenants.read', 'console.support'),
  finance: g('console.tenants.read', 'console.reports', 'console.billing.read'),
};

export function can(actor: Actor, permission: Permission): boolean {
  if (permission === 'public') return true;
  switch (actor.kind) {
    case 'user':
      return Boolean((actor.role === 'owner' ? OWNER : MANAGER)[permission]);
    case 'support':
      return Boolean(SUPPORT_SESSION[permission]);
    case 'staff_device':
      return Boolean(STAFF_DEVICE[permission]);
    case 'display':
      return Boolean(DISPLAY[permission]);
    case 'api_key':
      return Boolean(API_KEY[permission]);
    case 'platform':
      return Boolean(PLATFORM[actor.role][permission]);
    default:
      return false;
  }
}

/** Throws UNAUTHENTICATED for anonymous callers and FORBIDDEN for authenticated ones without the permission. */
export function authorize(actor: Actor, permission: Permission): void {
  if (can(actor, permission)) return;
  if (actor.kind === 'anonymous') throw new AppError('UNAUTHENTICATED');
  throw new AppError('FORBIDDEN');
}

/** Destructive console actions need an MFA check within the last 15 minutes (TR-FE-23, §14.1). */
export const FRESH_MFA_MS = 15 * 60_000;
export function requireFreshMfa(actor: Actor, now = new Date()): void {
  if (actor.kind !== 'platform') return;
  if (!actor.mfaVerifiedAt || now.getTime() - actor.mfaVerifiedAt.getTime() > FRESH_MFA_MS) {
    throw new AppError('MFA_REQUIRED', 'Confirm with your second factor');
  }
}
