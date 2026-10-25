// GENERATED from backend/packages/contracts/src by `npm run sync:contracts` in backend/. Do not edit.
// Complete list of audit actions (TRD appendix 30.2).
export const AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'tenant.slug_changed',
  'tenant.status_changed',
  'tenant.suspended',
  'tenant.reactivated',
  'tenant.trial_extended',
  'tenant.complimentary_set',
  'tenant.plan_changed',
  'tenant.coupon_applied', // historical: Stripe coupons
  'tenant.payment_recorded',
  'tenant.cancelled',
  'tenant.deletion_requested',
  'tenant.deletion_cancelled',
  'tenant.deleted',
  'tenant.ownership_transferred',
  'tenant.viewed',
  'member.invited',
  'member.added',
  'member.role_changed',
  'member.removed',
  'member.preferences_changed',
  'account.email_change_requested',
  'account.email_changed',
  'account.mfa_enrolled',
  'account.mfa_replaced',
  'account.mfa_removed',
  'venue.created',
  'venue.updated',
  'venue.settings_changed',
  'venue.archived',
  'staff.link_rotated',
  'staff.pin_changed',
  'device.removed',
  'display.created',
  'display.paired',
  'display.revoked',
  'apikey.created',
  'apikey.revoked',
  'webhook.created',
  'webhook.updated',
  'webhook.deleted',
  'pos.connected',
  'pos.disconnected',
  'support.requested',
  'support.approved',
  'support.refused',
  'support.started',
  'support.ended',
  'support.emergency_opened',
  'plan.created',
  'plan.updated',
  'price.created',
  'flag.overridden',
  'setting.changed',
  'chime.created',
  'legal.published',
  'platform_user.invited',
  'platform_user.role_changed',
  'platform_user.mfa_reset',
  'platform_user.removed',
  'export.requested',
  'export.downloaded',
  'rating.deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_PURPOSES = ['support', 'security', 'billing', 'legal', 'operations'] as const;
export type AuditPurpose = (typeof AUDIT_PURPOSES)[number];

export type AuditActorType =
  | 'platform_user'
  | 'user'
  | 'staff_device'
  | 'staff_member'
  | 'api_key'
  | 'system'
  | 'support';
