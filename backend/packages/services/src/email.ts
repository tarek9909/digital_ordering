import { createHash } from 'node:crypto';
import { decrypt, encrypt, type KeyProvider } from '@dop/auth';
import type { Db, Tx } from '@dop/db';
import type { Deps } from './deps.js';
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
  'subscription_digest',
  'webhook_disabled',
  'email_change',
  'email_changed',
  'mfa_changed',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/**
 * A `link` carries a credential (password reset, invitation, email confirmation). The job is stored in the outbox
 * table, in Redis and so in backups, so the link is kept there only encrypted with the data key (`sealedLink`); the
 * worker opens it when it renders the message.
 */
async function sealEmailData(keys: KeyProvider, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { link, ...rest } = data;
  return typeof link === 'string' ? { ...rest, sealedLink: (await encrypt(keys, link)).toString('base64') } : data;
}

/** The email data as the template expects it, with a sealed link opened again. */
export async function openEmailData(keys: KeyProvider, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { sealedLink, ...rest } = data;
  return typeof sealedLink === 'string' ? { ...rest, link: await decrypt(keys, Buffer.from(sealedLink, 'base64')) } : data;
}

export async function sendEmail(
  deps: Pick<Deps, 'jobs' | 'kv' | 'db' | 'log' | 'keys'>,
  e: { template: EmailTemplate; to: string; locale: string; tenantId?: string | null; data: Record<string, unknown>; key?: string },
  tx?: Tx | Db,
): Promise<number> {
  // Hashed so any caller key is a valid queue job ID (A01).
  const messageKey = createHash('sha256').update(e.key ?? `${e.template}|${e.to}|${JSON.stringify(e.data)}`).digest('hex').slice(0, 32);
  // Durable: a queue outage never fails the request that triggered the email (A01).
  return enqueueJobs(
    deps,
    [{ name: 'email.send', data: { template: e.template, to: e.to, locale: e.locale, tenantId: e.tenantId ?? null, data: await sealEmailData(deps.keys, e.data), messageKey }, opts: { jobId: jobIds.email(messageKey) } }],
    tx,
  );
}
