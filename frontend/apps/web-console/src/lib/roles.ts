import type { PlatformRole } from '@dop/contracts';

// Mirror of the console permission grants (backend packages/auth permissions.ts, TRD §14.2) used only to hide
// navigation and actions; the API enforces them.

export type ConsolePermission =
  | 'tenants.read'
  | 'tenants.lifecycle'
  | 'settings'
  | 'reports'
  | 'billing.read'
  | 'audit'
  | 'platform_users'
  | 'notes'
  | 'support'
  | 'support.emergency'
  | 'commercial'
  | 'ownership'
  | 'devices'
  | 'announcements';

const GRANTS: Record<PlatformRole, readonly ConsolePermission[]> = {
  super_admin: [
    'tenants.read',
    'tenants.lifecycle',
    'settings',
    'reports',
    'billing.read',
    'audit',
    'platform_users',
    'notes',
    'support',
    'support.emergency',
    'commercial',
    'ownership',
    'devices',
    'announcements',
  ],
  support: ['tenants.read', 'notes', 'support'],
  finance: ['tenants.read', 'reports', 'billing.read'],
};

export const can = (role: PlatformRole | undefined, p: ConsolePermission) => Boolean(role && GRANTS[role]?.includes(p));
