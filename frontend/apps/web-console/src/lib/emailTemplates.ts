// Template keys of the backend (services/email.ts EMAIL_TEMPLATES); texts are edited per key and locale (TR-EML-03).
export const EMAIL_TEMPLATE_KEYS = [
  'verify_email',
  'welcome',
  'password_reset',
  'invitation_manager',
  'invitation_owner',
  'ownership_transferred',
  'trial_ending',
  'trial_ended',
  'payment_failed',
  'payment_reminder',
  'suspended_billing',
  'suspended_platform',
  'reactivated',
  'subscription_cancelled',
  'subscription_reactivated',
  'deletion_requested',
  'deletion_completed',
  'staff_pin_lock',
  'export_ready',
  'platform_user_invitation',
  'platform_mfa_reset',
  'support_requested',
  'support_started',
  'emergency_access',
  'weekly_summary',
  'webhook_disabled',
  'email_change',
  'email_changed',
  'mfa_changed',
] as const;

/** Text blocks: one per paragraph (blank line separated) ↔ textarea. */
export const blocksToText = (blocks: readonly string[]) => blocks.join('\n\n');
export const textToBlocks = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

/** `{{name}}` placeholders used in a text, for the hint next to the editor. */
export const placeholdersIn = (text: string) => [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!))];
