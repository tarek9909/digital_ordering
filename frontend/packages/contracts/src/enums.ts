// GENERATED from backend/packages/contracts/src by `npm run sync:contracts` in backend/. Do not edit.
export const TICKET_STATUSES = ['received', 'preparing', 'ready', 'collected', 'cancelled', 'expired'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const OPEN_STATUSES: readonly TicketStatus[] = ['received', 'preparing', 'ready'];

export const TENANT_STATUSES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'trial_expired',
  'cancelled',
  'deleted',
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const ALERT_LEVELS = ['push', 'live', 'closed', 'none'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export const CANCEL_REASONS = ['customer_left', 'refunded', 'out_of_stock', 'duplicate', 'mistake', 'other'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const TICKET_ACTOR_TYPES = [
  'staff_device',
  'staff_member',
  'user',
  'api_key',
  'system',
  'support',
  'customer',
] as const;
export type TicketActorType = (typeof TICKET_ACTOR_TYPES)[number];

export const UA_FAMILIES = [
  'ios-safari',
  'ios-webapp',
  'ios-other',
  'android-chrome',
  'android-samsung',
  'android-firefox',
  'android-other',
  'desktop',
  'inapp-instagram',
  'inapp-facebook',
  'inapp-whatsapp',
  'inapp-tiktok',
  'other',
] as const;
export type UaFamily = (typeof UA_FAMILIES)[number];

export const JOINED_VIA = ['ticket_qr', 'link', 'claim_code', 'staff_approval', 'home_screen'] as const;
export type JoinedVia = (typeof JOINED_VIA)[number];

export const MEMBER_ROLES = ['owner', 'manager'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PLATFORM_ROLES = ['super_admin', 'support', 'finance'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLAN_CODES = ['trial', 'standard', 'pro', 'multisite'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
