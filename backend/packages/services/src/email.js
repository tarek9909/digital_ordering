import { createHash } from 'node:crypto';
import { enqueueJobs, jobIds } from './outbox.js';
// Email requests go through the `email.send` job (TR-EML-01); the worker renders and sends them.
// Templates: TRD §19. The message key makes retries and duplicate triggers idempotent.
export const EMAIL_TEMPLATES = [
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
];
export async function sendEmail(deps, e, tx) {
    // Hashed so any caller key is a valid queue job ID (A01).
    const messageKey = createHash('sha256').update(e.key ?? `${e.template}|${e.to}|${JSON.stringify(e.data)}`).digest('hex').slice(0, 32);
    // Durable: a queue outage never fails the request that triggered the email (A01).
    return enqueueJobs(deps, [{ name: 'email.send', data: { template: e.template, to: e.to, locale: e.locale, tenantId: e.tenantId ?? null, data: e.data, messageKey }, opts: { jobId: jobIds.email(messageKey) } }], tx);
}
