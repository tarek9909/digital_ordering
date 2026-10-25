import { checkPassword, hashSecret, type Actor } from '@dop/auth';
import { AppError, defaultVenueSettings } from '@dop/contracts';
import { checkSlug, isValidTimeZone, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import type { Deps } from './deps.js';
import { addMonths } from './billing.js';
import { getSetting } from './platform.js';
import { createVenueRow } from './venues.js';

// Tenant creation. Tenants are created by the platform team, who invite the owner (FR-SA-05); there is no public
// self-signup. `createTenantWithOwner` creates the owner account directly, for the seed script and tests.

export async function slugAvailability(deps: Deps, slug: string): Promise<{ available: boolean; reason?: 'invalid' | 'reserved' | 'taken' }> {
  const v = checkSlug(slug);
  if (v !== 'ok') return { available: false, reason: v };
  const db = deps.db.platform();
  // A previous slug stays blocked for 180 days after a change (TR-URL-03).
  const clash =
    (await db.selectFrom('tenants').select('id').where((eb) => eb.or([eb('slug', '=', slug), eb('previous_slug', '=', slug)])).executeTakeFirst()) ??
    (await db.selectFrom('tenant_slug_aliases').select('tenant_id as id').where('slug', '=', slug).where('expires_at', '>', deps.now()).executeTakeFirst());
  return clash ? { available: false, reason: 'taken' } : { available: true };
}

async function requireSlug(deps: Deps, slug: string) {
  const a = await slugAvailability(deps, slug);
  if (!a.available) throw new AppError(a.reason === 'reserved' ? 'SLUG_RESERVED' : a.reason === 'taken' ? 'SLUG_TAKEN' : 'VALIDATION_FAILED', undefined, { errors: [{ path: 'slug', message: a.reason ?? 'invalid' }] });
}

async function createTenantCore(
  deps: Deps,
  b: { name: string; slug: string; country: string; locale: string; complimentary?: boolean; planCode?: string; trial?: boolean; planStartsAt?: string; planEndsAt?: string },
  actor: Actor,
  owner: { userId: string; create?: { email: string; name: string; passwordHash: string; locale: string; verified?: boolean } } | null,
  extra?: { ip?: string; requestId?: string },
): Promise<{ tenantId: string; venueId: string; initialPin: string }> {
  await requireSlug(deps, b.slug);
  const defaults = await getSetting(deps, 'tenant.defaults');
  // Only the seed script and tests start a trial; a tenant created in the console is active at once.
  const trial = Boolean(b.trial) && !b.complimentary;
  const trialDays = trial ? await getSetting(deps, 'trial.days') : 0;
  const tz = isValidTimeZone(defaults.timeZone) ? defaults.timeZone : 'Asia/Riyadh';
  const now = deps.now();
  const pdb = deps.db.platform();
  // FR-SA-05: the console chooses the plan; default Standard.
  const planCode = b.planCode ?? (trial ? 'trial' : 'standard');
  const trialPlan = await pdb.selectFrom('plans').select('id').where('code', '=', planCode).where('archived_at', 'is', null).executeTakeFirst();
  if (!trialPlan) throw new AppError('VALIDATION_FAILED', 'Unknown plan', { errors: [{ path: 'planCode', message: 'unknown' }] });
  const tenantId = uuidv7();
  const locales = [...defaults.locales];
  const settings = defaultVenueSettings();
  settings.wait = { mode: defaults.wait.mode, defaultMinutes: defaults.wait.defaultMinutes };
  settings.alerts = { ...settings.alerts, repeatOffsetsSec: defaults.alerts.repeatOffsetsSec, maxAutoAlerts: defaults.alerts.maxAutoAlerts, chime: defaults.chime };
  let venueId = '';
  let initialPin = '';
  try {
    await pdb.transaction().execute(async (tx) => {
      await tx
        .insertInto('tenants')
        .values({
          id: tenantId,
          name: b.name,
          slug: b.slug,
          status: trial ? 'trial' : 'active',
          plan_id: trialPlan.id,
          complimentary: Boolean(b.complimentary),
          trial_ends_at: trial ? new Date(now.getTime() + trialDays * 86_400_000) : null,
          plan_starts_at: b.planStartsAt ? new Date(`${b.planStartsAt}T00:00:00Z`) : now,
          // Without a paid period the billing sweep would put the tenant past due at once; default is one month.
          paid_until: trial || b.complimentary ? null : b.planEndsAt ? new Date(`${b.planEndsAt}T23:59:59.999Z`) : addMonths(now, 1),
          country: b.country,
          default_locale: b.locale,
        })
        .execute();
      // A directly created owner is inserted in the same transaction, so a failure leaves no partial account (A01).
      if (owner?.create) {
        await tx.insertInto('users').values({ id: owner.userId, email: owner.create.email, name: owner.create.name, password_hash: owner.create.passwordHash, locale: owner.create.locale, ...(owner.create.verified ? { email_verified_at: now } : {}) }).execute();
      }
      if (owner) {
        await tx.insertInto('tenant_memberships').values({ id: uuidv7(), tenant_id: tenantId, user_id: owner.userId, role: 'owner' }).execute();
      }
      const r = await createVenueRow(tx, deps, tenantId, { name: b.name, timeZone: tz, locales, resetTime: defaults.resetTime, autoCloseTime: defaults.autoCloseTime, settings });
      venueId = r.venueId;
      initialPin = r.initialPin;
      // No legal acceptance is recorded here (AS05): the owner never saw a document at this point. Every owner
      // (console-invited or created directly) accepts the terms, privacy policy and DPA in the admin legal gate,
      // which records the exact versions it displayed (FR-ADM-16, TR-PRV-09).
      await writeAudit(tx, { actor, action: 'tenant.created', tenantId, entityType: 'tenant', entityId: tenantId, after: { name: b.name, slug: b.slug }, ip: extra?.ip, requestId: extra?.requestId });
    });
  } catch (e) {
    if ((e as { code?: string; sqlMessage?: string }).code === 'ER_DUP_ENTRY') {
      if (owner?.create && /users\.|'email'/.test((e as { sqlMessage?: string }).sqlMessage ?? '')) throw new AppError('EMAIL_TAKEN', 'An account with this email exists.');
      throw new AppError('SLUG_TAKEN');
    }
    throw e;
  }
  return { tenantId, venueId, initialPin };
}

export interface TenantWithOwnerInput {
  ownerName: string;
  email: string;
  password: string;
  restaurantName: string;
  slug: string;
  country: string;
  locale: string;
}

/** A tenant with its owner account created directly (email not yet verified). Seed data and tests only; no route reaches it. */
export async function createTenantWithOwner(deps: Deps, b: TenantWithOwnerInput, client: { ip: string; requestId?: string }) {
  const problem = checkPassword(b.password, [b.email, b.restaurantName, b.slug]);
  if (problem) throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
  const pdb = deps.db.platform();
  if (await pdb.selectFrom('users').select('id').where('email', '=', b.email).executeTakeFirst()) {
    throw new AppError('EMAIL_TAKEN', 'An account with this email exists.');
  }
  const userId = uuidv7();
  const passwordHash = await hashSecret(b.password);
  const r = await createTenantCore(
    deps,
    { name: b.restaurantName, slug: b.slug, country: b.country, locale: b.locale, trial: true },
    { kind: 'user', userId, tenantId: '', role: 'owner', sessionId: '', mfaVerified: false },
    { userId, create: { email: b.email, name: b.ownerName, passwordHash, locale: b.locale } },
    client,
  );
  return { ...r, userId, slug: b.slug };
}

/** Console "create tenant" (FR-SA-05): the platform team sets the owner's credentials; no invitation is sent. */
export async function createTenantByPlatform(
  deps: Deps,
  actor: Actor & { kind: 'platform' },
  b: { name: string; slug: string; country: string; locale: string; ownerEmail: string; ownerName?: string; ownerPassword: string; complimentary: boolean; planCode?: string; planStartsAt?: string; planEndsAt?: string },
  requestId?: string,
) {
  // The address counts as verified since the platform team vouches for it.
  const problem = checkPassword(b.ownerPassword, [b.ownerEmail, b.name, b.slug]);
  if (problem) throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'ownerPassword', message: problem }] });
  if (await deps.db.platform().selectFrom('users').select('id').where('email', '=', b.ownerEmail).executeTakeFirst()) {
    throw new AppError('EMAIL_TAKEN', 'An account with this email exists.');
  }
  const userId = uuidv7();
  const passwordHash = await hashSecret(b.ownerPassword);
  return createTenantCore(
    deps,
    { name: b.name, slug: b.slug, country: b.country, locale: b.locale, complimentary: b.complimentary, planCode: b.planCode, planStartsAt: b.planStartsAt, planEndsAt: b.planEndsAt },
    actor,
    { userId, create: { email: b.ownerEmail, name: b.ownerName ?? b.ownerEmail, passwordHash, locale: b.locale, verified: true } },
    { requestId },
  );
}
