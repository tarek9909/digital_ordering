export const TICKET_STATUSES = ['received', 'preparing', 'ready', 'collected', 'cancelled', 'expired'];
export const OPEN_STATUSES = ['received', 'preparing', 'ready'];
export const TENANT_STATUSES = [
    'trial',
    'active',
    'past_due',
    'suspended',
    'trial_expired',
    'cancelled',
    'deleted',
];
export const ALERT_LEVELS = ['push', 'live', 'closed', 'none'];
export const CANCEL_REASONS = ['customer_left', 'refunded', 'out_of_stock', 'duplicate', 'mistake', 'other'];
export const TICKET_ACTOR_TYPES = [
    'staff_device',
    'staff_member',
    'user',
    'api_key',
    'system',
    'support',
    'customer',
];
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
];
export const JOINED_VIA = ['ticket_qr', 'link', 'claim_code', 'staff_approval', 'home_screen'];
export const MEMBER_ROLES = ['owner', 'manager'];
export const PLATFORM_ROLES = ['super_admin', 'support', 'finance'];
export const PLAN_CODES = ['trial', 'standard', 'pro', 'multisite'];
