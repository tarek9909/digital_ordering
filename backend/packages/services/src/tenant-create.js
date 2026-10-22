import { checkPassword, hashSecret } from '@dop/auth';
import { AppError, defaultVenueSettings } from '@dop/contracts';
import { checkSlug, isValidTimeZone, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { inviteMember } from './auth.js';
import { getSetting } from './platform.js';
import { createVenueRow } from './venues.js';
// Tenant creation. Tenants are created by the platform team, who invite the owner (FR-SA-05); there is no public
// self-signup. `createTenantWithOwner` creates the owner account directly, for the seed script and tests.
export async function slugAvailability(deps, slug) {
    const v = checkSlug(slug);
    if (v !== 'ok')
        return { available: false, reason: v };
    const db = deps.db.platform();
    // A previous slug stays blocked for 180 days after a change (TR-URL-03).
    const clash = (await db.selectFrom('tenants').select('id').where((eb) => eb.or([eb('slug', '=', slug), eb('previous_slug', '=', slug)])).executeTakeFirst()) ??
        (await db.selectFrom('tenant_slug_aliases').select('tenant_id as id').where('slug', '=', slug).where('expires_at', '>', deps.now()).executeTakeFirst());
    return clash ? { available: false, reason: 'taken' } : { available: true };
}
async function requireSlug(deps, slug) {
    const a = await slugAvailability(deps, slug);
    if (!a.available)
        throw new AppError(a.reason === 'reserved' ? 'SLUG_RESERVED' : a.reason === 'taken' ? 'SLUG_TAKEN' : 'VALIDATION_FAILED', undefined, { errors: [{ path: 'slug', message: a.reason ?? 'invalid' }] });
}
async function createTenantCore(deps, b, actor, owner, extra) {
    await requireSlug(deps, b.slug);
    const defaults = await getSetting(deps, 'tenant.defaults');
    const trialDays = b.trialDays ?? (await getSetting(deps, 'trial.days'));
    const tz = isValidTimeZone(defaults.timeZone) ? defaults.timeZone : 'Asia/Riyadh';
    const now = deps.now();
    const pdb = deps.db.platform();
    // FR-SA-05: the console chooses the plan; default Trial, or Standard when complimentary.
    const planCode = b.planCode ?? (b.complimentary ? 'standard' : 'trial');
    const trialPlan = await pdb.selectFrom('plans').select('id').where('code', '=', planCode).where('archived_at', 'is', null).executeTakeFirst();
    if (!trialPlan)
        throw new AppError('VALIDATION_FAILED', 'Unknown plan', { errors: [{ path: 'planCode', message: 'unknown' }] });
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
                status: b.complimentary ? 'active' : 'trial',
                plan_id: trialPlan.id,
                complimentary: Boolean(b.complimentary),
                trial_ends_at: b.complimentary ? null : new Date(now.getTime() + trialDays * 86_400_000),
                country: b.country,
                default_locale: b.locale,
            })
                .execute();
            // A directly created owner is inserted in the same transaction, so a failure leaves no partial account (A01).
            if (owner?.create) {
                await tx.insertInto('users').values({ id: owner.userId, email: owner.create.email, name: owner.create.name, password_hash: owner.create.passwordHash, locale: owner.create.locale }).execute();
            }
            if (owner) {
                await tx.insertInto('tenant_memberships').values({ id: uuidv7(), tenant_id: tenantId, user_id: owner.userId, role: 'owner' }).execute();
            }
            const r = await createVenueRow(tx, deps, tenantId, { name: b.name, timeZone: tz, locales, resetTime: defaults.resetTime, autoCloseTime: defaults.autoCloseTime, settings });
            venueId = r.venueId;
            initialPin = r.initialPin;
            // Legal acceptance of the published documents (TR-PRV-09).
            if (owner) {
                const docs = await tx
                    .selectFrom('legal_documents')
                    .select(['id', 'kind', 'version', 'locale'])
                    .where('kind', 'in', ['terms', 'privacy', 'dpa'])
                    .where('published_at', 'is not', null)
                    .orderBy('published_at', 'desc')
                    .execute();
                const latest = new Map();
                for (const d of docs)
                    if (!latest.has(d.kind))
                        latest.set(d.kind, d.id);
                for (const id of latest.values()) {
                    await tx.insertInto('legal_acceptances').values({ id: uuidv7(), tenant_id: tenantId, user_id: owner.userId, document_id: id, ip: extra?.ip ?? '0.0.0.0' }).execute();
                }
            }
            await writeAudit(tx, { actor, action: 'tenant.created', tenantId, entityType: 'tenant', entityId: tenantId, after: { name: b.name, slug: b.slug }, ip: extra?.ip, requestId: extra?.requestId });
        });
    }
    catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            if (owner?.create && /users\.|'email'/.test(e.sqlMessage ?? ''))
                throw new AppError('EMAIL_TAKEN', 'An account with this email exists.');
            throw new AppError('SLUG_TAKEN');
        }
        throw e;
    }
    return { tenantId, venueId, initialPin };
}
/** A tenant with its owner account created directly (email not yet verified). Seed data and tests only; no route reaches it. */
export async function createTenantWithOwner(deps, b, client) {
    const problem = checkPassword(b.password, [b.email, b.restaurantName, b.slug]);
    if (problem)
        throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
    const pdb = deps.db.platform();
    if (await pdb.selectFrom('users').select('id').where('email', '=', b.email).executeTakeFirst()) {
        throw new AppError('EMAIL_TAKEN', 'An account with this email exists.');
    }
    const userId = uuidv7();
    const passwordHash = await hashSecret(b.password);
    const r = await createTenantCore(deps, { name: b.restaurantName, slug: b.slug, country: b.country, locale: b.locale }, { kind: 'user', userId, tenantId: '', role: 'owner', sessionId: '', mfaVerified: false }, { userId, create: { email: b.email, name: b.ownerName, passwordHash, locale: b.locale } }, client);
    return { ...r, userId, slug: b.slug };
}
/** Console "create tenant and invite owner" (FR-SA-05). */
export async function createTenantByPlatform(deps, actor, b, requestId) {
    const r = await createTenantCore(deps, { name: b.name, slug: b.slug, country: b.country, locale: b.locale, complimentary: b.complimentary, planCode: b.planCode, trialDays: b.trialDays }, actor, null, { requestId });
    await inviteMember(deps, actor, r.tenantId, b.ownerEmail, 'owner');
    return r;
}
