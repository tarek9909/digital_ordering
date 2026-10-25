import { createHash } from 'node:crypto';
import type { Actor } from '@dop/auth';
import { AppError, type PlanLimits } from '@dop/contracts';
import { json, sql } from '@dop/db';
import { downgradeExcess, uuidv7, type Usage } from '@dop/domain';
import { writeAudit } from './audit.js';
import { revokeOtherSessions } from './auth.js';
import type { Deps } from './deps.js';
import { sendEmail } from './email.js';
import { addOutbox, flushOutbox } from './outbox.js';
import { currentLegalDocument } from './public.js';
import { uaReachKey } from './reports.js';
import { sanitizeLegalHtml } from './sanitize.js';
import type { ObjectStorage } from './storage.js';

// R1.1 platform team tools (FR-SA-07/08/10/11/12/13/15/16, FR-BIL-10, FR-RPT-07, TR-ALG-17, TR-RPT-06).

type PlatformActor = Actor & { kind: 'platform' };

// ---- notes (FR-SA-15): console only, never visible to the tenant
export async function listNotes(deps: Deps, tenantId: string) {
  const rows = await deps.db
    .platform()
    .selectFrom('tenant_notes')
    .innerJoin('platform_users', 'platform_users.id', 'tenant_notes.author_id')
    .select(['tenant_notes.id', 'tenant_notes.body', 'tenant_notes.created_at', 'platform_users.name'])
    .where('tenant_notes.tenant_id', '=', tenantId)
    .orderBy('tenant_notes.created_at', 'desc')
    .execute();
  return rows.map((r) => ({ id: r.id, body: r.body, author: r.name, createdAt: r.created_at.toISOString() }));
}

export async function addNote(deps: Deps, actor: PlatformActor, tenantId: string, body: string) {
  const id = uuidv7();
  await deps.db.platform().insertInto('tenant_notes').values({ id, tenant_id: tenantId, author_id: actor.platformUserId, body }).execute();
  return { id };
}

// ---- ownership transfer by the platform (FR-SA-08)
export async function platformTransferOwnership(deps: Deps, actor: PlatformActor, tenantId: string, email: string, verificationNote: string) {
  const db = deps.db.platform();
  const user = await db.selectFrom('users').select(['id', 'email', 'locale']).where('email', '=', email).where('disabled_at', 'is', null).executeTakeFirst();
  if (!user) throw new AppError('NOT_FOUND', 'The new owner must have an account; invite them as a manager first');
  let oldOwner: string | null = null;
  await db.transaction().execute(async (tx) => {
    const owner = await tx.selectFrom('tenant_memberships').select(['id', 'user_id']).where('tenant_id', '=', tenantId).where('role', '=', 'owner').where('status', '=', 'active').forUpdate().executeTakeFirst();
    oldOwner = owner?.user_id ?? null;
    if (owner) await tx.updateTable('tenant_memberships').set({ role: 'manager' }).where('id', '=', owner.id).execute();
    const m = await tx.selectFrom('tenant_memberships').select('id').where('tenant_id', '=', tenantId).where('user_id', '=', user.id).executeTakeFirst();
    if (m) await tx.updateTable('tenant_memberships').set({ role: 'owner', status: 'active' }).where('id', '=', m.id).execute();
    else await tx.insertInto('tenant_memberships').values({ id: uuidv7(), tenant_id: tenantId, user_id: user.id, role: 'owner' }).execute();
    await writeAudit(tx, { actor, action: 'tenant.ownership_transferred', tenantId, entityType: 'tenant', entityId: tenantId, before: { owner: oldOwner }, after: { owner: user.id, verificationNote }, purpose: 'support', visibleToTenant: true });
  });
  if (oldOwner) await revokeOtherSessions(deps, oldOwner);
  const tenant = await db.selectFrom('tenants').select('name').where('id', '=', tenantId).executeTakeFirstOrThrow();
  await sendEmail(deps, { template: 'ownership_transferred', to: user.email, locale: user.locale, tenantId, data: { tenantName: tenant.name } });
}

// ---- sign out all staff devices of a venue (FR-SA-16)
export async function signOutVenueDevices(deps: Deps, actor: PlatformActor, venueId: string) {
  const v = await deps.db.platform().selectFrom('venues').select(['tenant_id']).where('id', '=', venueId).executeTakeFirst();
  if (!v) throw new AppError('NOT_FOUND');
  const db = deps.db.forTenant(v.tenant_id);
  let id = 0;
  await db.transaction().execute(async (tx) => {
    const devices = await tx.selectFrom('staff_devices').select('id').where('venue_id', '=', venueId).where('revoked_at', 'is', null).execute();
    await tx.updateTable('staff_devices').set({ revoked_at: deps.now(), revoked_reason: 'platform' }).where('venue_id', '=', venueId).where('revoked_at', 'is', null).execute();
    await writeAudit(tx, { actor, action: 'device.removed', tenantId: v.tenant_id, entityType: 'venue', entityId: venueId, after: { all: true, count: devices.length }, purpose: 'security', visibleToTenant: true });
    id = await addOutbox(tx, 'device.revoked', v.tenant_id, { venueId, emit: { deviceIds: devices.map((d) => d.id) } });
  });
  await flushOutbox(deps, [id]);
}

// ---- feature flags (FR-SA-11, TR-ALG-15)
export async function listFlags(deps: Deps, tenantId?: string) {
  const flags = await deps.db.platform().selectFrom('feature_flags').selectAll().orderBy('flag_key').execute();
  const overrides = tenantId ? await deps.db.platform().selectFrom('tenant_feature_overrides').select(['flag_key', 'enabled']).where('tenant_id', '=', tenantId).execute() : [];
  return flags.map((f) => ({ key: f.flag_key, description: f.description, defaultOn: Boolean(f.default_on), override: overrides.find((o) => o.flag_key === f.flag_key)?.enabled ?? null }));
}

export async function setFlagOverride(deps: Deps, actor: PlatformActor, tenantId: string, flag: string, enabled: boolean | null) {
  const db = deps.db.platform();
  await db.transaction().execute(async (tx) => {
    if (!(await tx.selectFrom('feature_flags').select('flag_key').where('flag_key', '=', flag).executeTakeFirst())) throw new AppError('NOT_FOUND');
    if (enabled === null) await tx.deleteFrom('tenant_feature_overrides').where('tenant_id', '=', tenantId).where('flag_key', '=', flag).execute();
    else await tx.insertInto('tenant_feature_overrides').values({ tenant_id: tenantId, flag_key: flag, enabled, set_by: actor.platformUserId }).onDuplicateKeyUpdate({ enabled, set_by: actor.platformUserId }).execute();
    await writeAudit(tx, { actor, action: 'flag.overridden', tenantId, entityType: 'flag', entityId: flag, after: { enabled }, visibleToTenant: false });
  });
  await deps.kv.del(`t:${tenantId}:flags`);
}

// ---- plans and prices (FR-SA-10)
export async function listPlans(deps: Deps) {
  const db = deps.db.platform();
  const [plans, prices] = await Promise.all([db.selectFrom('plans').selectAll().orderBy('sort_order').execute(), db.selectFrom('plan_prices').selectAll().execute()]);
  return plans.map((p) => ({ id: p.id, code: p.code, name: p.name, description: p.description ?? '', isPublic: Boolean(p.is_public), limits: p.limits, features: p.features, archived: p.archived_at !== null, prices: prices.filter((x) => x.plan_id === p.id).map((x) => ({ id: x.id, period: x.period, currency: x.currency, amountMinor: x.amount_minor, active: Boolean(x.active) })) }));
}

/**
 * Plan codes and names for filters and labels (FR-SA-04, AS10): every console role that can list tenants may read
 * them; prices, limits and features stay behind `console.settings`. Archived plans are included (tenants may still
 * be on them) and flagged.
 */
export async function listPlanOptions(deps: Deps) {
  const rows = await deps.db.platform().selectFrom('plans').select(['code', 'name', 'archived_at']).orderBy('sort_order').orderBy('code').execute();
  return rows.map((p) => ({ code: p.code, name: p.name, archived: p.archived_at !== null }));
}

export async function createPlan(deps: Deps, actor: PlatformActor, p: { code: string; name: string; description?: string; isPublic: boolean; limits: Record<string, number>; features: string[]; sortOrder: number }) {
  const id = uuidv7();
  try {
    await deps.db.platform().insertInto('plans').values({ id, code: p.code, name: p.name, description: p.description || null, is_public: p.isPublic, limits: json(p.limits), features: json(p.features), sort_order: p.sortOrder }).execute();
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError('VALIDATION_FAILED', 'Plan code exists', { errors: [{ path: 'code', message: 'taken' }] });
    throw e;
  }
  await writeAudit(deps.db.platform(), { actor, action: 'plan.created', tenantId: null, entityType: 'plan', entityId: id, after: p, visibleToTenant: false });
  return { id };
}

export async function updatePlan(deps: Deps, actor: PlatformActor, id: string, p: { name?: string; description?: string; isPublic?: boolean; limits?: Record<string, number>; features?: string[]; sortOrder?: number }) {
  const patch = { ...(p.name && { name: p.name }), ...(p.description !== undefined && { description: p.description || null }), ...(p.isPublic !== undefined && { is_public: p.isPublic }), ...(p.limits && { limits: json(p.limits) }), ...(p.features && { features: json(p.features) }), ...(p.sortOrder !== undefined && { sort_order: p.sortOrder }) };
  // An empty change is a no-op (A10, API01); the plan must still exist.
  if (Object.keys(patch).length === 0) {
    if (!(await deps.db.platform().selectFrom('plans').select('id').where('id', '=', id).executeTakeFirst())) throw new AppError('NOT_FOUND');
    return;
  }
  const r = await deps.db.platform().updateTable('plans').set(patch).where('id', '=', id).executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
  await writeAudit(deps.db.platform(), { actor, action: 'plan.updated', tenantId: null, entityType: 'plan', entityId: id, after: p, visibleToTenant: false });
  for (const k of await deps.kv.keys('t:')) if (k.endsWith(':flags')) await deps.kv.del(k);
}

/** A new price deactivates the previous active one for the same plan, period and currency. */
export async function addPrice(deps: Deps, actor: PlatformActor, planId: string, p: { period: 'month' | 'quarter' | 'year'; currency: string; amountMinor: number }) {
  const id = uuidv7();
  await deps.db.platform().transaction().execute(async (tx) => {
    await tx.updateTable('plan_prices').set({ active: false }).where('plan_id', '=', planId).where('period', '=', p.period).where('currency', '=', p.currency).execute();
    await tx.insertInto('plan_prices').values({ id, plan_id: planId, period: p.period, currency: p.currency, amount_minor: p.amountMinor }).execute();
    await writeAudit(tx, { actor, action: 'price.created', tenantId: null, entityType: 'price', entityId: id, after: p, visibleToTenant: false });
  });
  return { id };
}

export async function deactivatePrice(deps: Deps, priceId: string) {
  const r = await deps.db.platform().updateTable('plan_prices').set({ active: false }).where('id', '=', priceId).executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
}

// ---- plan change with downgrade check (FR-BIL-10, TR-ALG-17, TR-BIL-05)
export async function usageOf(deps: Deps, tenantId: string): Promise<Usage> {
  const db = deps.db.forTenant(tenantId);
  const venues = await db.selectFrom('venues').select(['id', 'locales']).where('status', '=', 'active').execute();
  const ids = venues.map((v) => v.id);
  const maxPerVenue = (rows: Array<{ venue_id: string; n: number | string }>) => Math.max(0, ...rows.map((r) => Number(r.n)));
  if (ids.length === 0) return { venues: 0, maxCountersInAVenue: 0, maxLanguagesInAVenue: 0, maxDisplaysInAVenue: 0, maxStaffDevicesInAVenue: 0, maxApiKeysInAVenue: 0 };
  const [counters, displays, devices, apiKeys] = await Promise.all([
    db.selectFrom('counters').select(['venue_id', (eb) => eb.fn.countAll<number>().as('n')]).where('venue_id', 'in', ids).where('archived_at', 'is', null).groupBy('venue_id').execute(),
    db.selectFrom('displays').select(['venue_id', (eb) => eb.fn.countAll<number>().as('n')]).where('venue_id', 'in', ids).where('revoked_at', 'is', null).groupBy('venue_id').execute(),
    db.selectFrom('staff_devices').select(['venue_id', (eb) => eb.fn.countAll<number>().as('n')]).where('venue_id', 'in', ids).where('revoked_at', 'is', null).groupBy('venue_id').execute(),
    db.selectFrom('api_keys').select(['venue_id', (eb) => eb.fn.countAll<number>().as('n')]).where('venue_id', 'in', ids).where('revoked_at', 'is', null).groupBy('venue_id').execute(),
  ]);
  return {
    venues: venues.length,
    maxCountersInAVenue: maxPerVenue(counters),
    maxLanguagesInAVenue: Math.max(0, ...venues.map((v) => (v.locales as unknown as string[]).length)),
    maxDisplaysInAVenue: maxPerVenue(displays),
    maxStaffDevicesInAVenue: maxPerVenue(devices),
    maxApiKeysInAVenue: maxPerVenue(apiKeys),
  };
}

/**
 * Plan change by the platform team (FR-SA-07, FR-SA-10, FR-BIL-10). Applies now; the venues, counters and devices in
 * use must fit the target plan (TR-ALG-17). Tenants ask the platform team to change plans, as payment is offline.
 */
export async function changePlan(deps: Deps, actor: PlatformActor, tenantId: string, planCode: string) {
  const pdb = deps.db.platform();
  const target = await pdb.selectFrom('plans').select(['id', 'limits']).where('code', '=', planCode).where('archived_at', 'is', null).executeTakeFirst();
  if (!target) throw new AppError('NOT_FOUND');
  const excess = downgradeExcess(await usageOf(deps, tenantId), target.limits as unknown as PlanLimits);
  if (excess.length) throw new AppError('PLAN_DOWNGRADE_BLOCKED', 'Remove the listed items first', { data: { excess } });
  const t = await pdb.selectFrom('tenants').innerJoin('plans', 'plans.id', 'tenants.plan_id').select(['plans.code']).where('tenants.id', '=', tenantId).executeTakeFirstOrThrow();
  await pdb.updateTable('tenants').set({ plan_id: target.id }).where('id', '=', tenantId).execute();
  await deps.kv.del(`t:${tenantId}:flags`);
  await writeAudit(pdb, { actor, action: 'tenant.plan_changed', tenantId, entityType: 'tenant', entityId: tenantId, before: { plan: t.code }, after: { plan: planCode, effective: 'now' } });
  return { effective: 'now' as const };
}

/// ---- legal documents (FR-SA-12, TR-PRV-09)

/** A reservation still 'uploading' after this long was abandoned (process crash) and may be reclaimed. */
const LEGAL_RESERVATION_STALE_MIN = 10;

const versionTaken = () => new AppError('VALIDATION_FAILED', 'That version exists', { errors: [{ path: 'version', message: 'taken' }] });

/**
 * Creates a draft legal version (API02). Published bytes are immutable: the version is first reserved as a unique
 * 'uploading' row, so a duplicate kind/version/locale is rejected before anything is written; the content then goes
 * to a new key containing the document id, which no other row uses; only after that write is the row 'ready'. A
 * storage or database failure removes only this attempt's row and object. No existing object is ever overwritten.
 */
export async function createLegalDocument(deps: Deps, storage: ObjectStorage, actor: PlatformActor, d: { kind: 'terms' | 'privacy' | 'dpa' | 'customer_privacy'; version: string; locale: string; html: string }) {
  const db = deps.db.platform();
  const id = uuidv7();
  const key = `legal/${d.kind}/${id}.html`;
  // Stored sanitised, so every app can show it as formatted text (W12).
  const body = Buffer.from(sanitizeLegalHtml(d.html), 'utf8');
  const reserve = () => db.insertInto('legal_documents').values({ id, kind: d.kind, version: d.version, locale: d.locale, content_key: key, status: 'uploading' }).execute();
  try {
    await reserve();
  } catch (e) {
    if ((e as { code?: string }).code !== 'ER_DUP_ENTRY') throw e;
    // An abandoned reservation (crash between reserve and ready) must not block the version for ever.
    if (!(await reclaimStaleLegalReservation(deps, storage, d))) throw versionTaken();
    try {
      await reserve();
    } catch (e2) {
      if ((e2 as { code?: string }).code === 'ER_DUP_ENTRY') throw versionTaken();
      throw e2;
    }
  }
  try {
    await storage.put('assets', key, body, 'text/html; charset=utf-8');
    const r = await db.updateTable('legal_documents').set({ status: 'ready' }).where('id', '=', id).where('status', '=', 'uploading').executeTakeFirst();
    if (Number(r.numUpdatedRows) !== 1) throw new AppError('INTERNAL_ERROR', 'Legal version reservation was lost before it was ready');
  } catch (e) {
    await discardLegalReservation(deps, storage, id, key);
    throw e;
  }
  await writeAudit(db, { actor, action: 'legal.published', tenantId: null, entityType: 'legal_document', entityId: id, after: { kind: d.kind, version: d.version, locale: d.locale, draft: true }, visibleToTenant: false });
  return { id };
}

/**
 * Removes this attempt's unready reservation and then its own object (the key contains this attempt's id, so no
 * other version's content can be touched). A row that became 'ready' keeps its object. Best effort: a reservation
 * left behind is reclaimed when stale.
 */
async function discardLegalReservation(deps: Deps, storage: ObjectStorage, id: string, key: string) {
  const db = deps.db.platform();
  try {
    await db.deleteFrom('legal_documents').where('id', '=', id).where('status', '=', 'uploading').execute();
    if (await db.selectFrom('legal_documents').select('id').where('id', '=', id).executeTakeFirst()) return;
  } catch (err) {
    deps.log.warn({ err, id }, 'legal reservation not removed; it is reclaimed when stale');
    return;
  }
  try {
    await storage.deletePrefix('assets', key);
  } catch (err) {
    deps.log.warn({ err, key }, 'unreferenced legal object not removed');
  }
}

async function reclaimStaleLegalReservation(deps: Deps, storage: ObjectStorage, d: { kind: 'terms' | 'privacy' | 'dpa' | 'customer_privacy'; version: string; locale: string }) {
  const db = deps.db.platform();
  const stale = await db
    .selectFrom('legal_documents')
    .select(['id', 'content_key'])
    .where('kind', '=', d.kind)
    .where('version', '=', d.version)
    .where('locale', '=', d.locale)
    .where('status', '=', 'uploading')
    .where('created_at', '<', sql<Date>`NOW(3) - INTERVAL ${LEGAL_RESERVATION_STALE_MIN} MINUTE`)
    .executeTakeFirst();
  if (!stale) return false;
  const r = await db.deleteFrom('legal_documents').where('id', '=', stale.id).where('status', '=', 'uploading').executeTakeFirst();
  if (Number(r.numDeletedRows) !== 1) return false;
  try {
    await storage.deletePrefix('assets', stale.content_key);
  } catch (err) {
    deps.log.warn({ err, key: stale.content_key }, 'abandoned legal object not removed');
  }
  return true;
}

export async function listLegalDocuments(deps: Deps) {
  const rows = await deps.db.platform().selectFrom('legal_documents').selectAll().orderBy('kind').orderBy('version', 'desc').execute();
  return rows.map((r) => ({ id: r.id, kind: r.kind, version: r.version, locale: r.locale, status: r.status, publishedAt: r.published_at?.toISOString() ?? null }));
}

export async function publishLegalDocument(deps: Deps, actor: PlatformActor, id: string) {
  // Only a version whose content was written completely can be published (API02).
  const r = await deps.db.platform().updateTable('legal_documents').set({ published_at: deps.now() }).where('id', '=', id).where('published_at', 'is', null).where('status', '=', 'ready').executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
  await writeAudit(deps.db.platform(), { actor, action: 'legal.published', tenantId: null, entityType: 'legal_document', entityId: id, visibleToTenant: false });
}

/** The documents a tenant user accepts (FR-ADM-16): terms, privacy policy and DPA, each one that is published. */
export const ACCEPTANCE_KINDS = ['terms', 'privacy', 'dpa'] as const;

/**
 * Acceptance policy (FR-ADM-16, TR-PRV-09, AS04). For each kind, the document a user must accept is the one the
 * public reader shows in the user's chosen language: the latest published version in that locale, else the latest
 * published version in any locale (`currentLegalDocument`). The exact document id shown is what is recorded. A kind
 * counts as accepted when the user accepted that document, or another locale of the same kind and version label
 * (a translation of the same version); a newer version in the chosen locale is pending again.
 */
async function pendingLegalDocuments(deps: Deps, tenantId: string, userId: string, locale: string) {
  const current = (await Promise.all(ACCEPTANCE_KINDS.map((k) => currentLegalDocument(deps, k, locale)))).filter((d) => d !== undefined);
  if (current.length === 0) return [];
  const accepted = await deps.db
    .platform()
    .selectFrom('legal_acceptances')
    .innerJoin('legal_documents', 'legal_documents.id', 'legal_acceptances.document_id')
    .select(['legal_documents.id', 'legal_documents.kind', 'legal_documents.version'])
    .where('legal_acceptances.tenant_id', '=', tenantId)
    .where('legal_acceptances.user_id', '=', userId)
    .execute();
  return current.filter((d) => !accepted.some((a) => a.id === d.id || (a.kind === d.kind && a.version === d.version)));
}

async function viewerLocale(deps: Deps, userId: string, locale: string | undefined) {
  if (locale) return locale;
  const u = await deps.db.platform().selectFrom('users').select('locale').where('id', '=', userId).executeTakeFirst();
  return u?.locale ?? 'ar';
}

/**
 * New versions require re-acceptance at the next sign-in (TR-PRV-09): the documents this user has not accepted yet,
 * in the chosen locale, each with its exact id, version, locale and sanitised content, so the gate shows exactly
 * what is recorded. Fails (SERVICE_UNAVAILABLE) rather than hiding a pending document whose content cannot be read.
 */
export async function pendingLegalAcceptance(deps: Deps, tenantId: string, userId: string, opts: { locale?: string; storage?: ObjectStorage | null } = {}) {
  const docs = await pendingLegalDocuments(deps, tenantId, userId, await viewerLocale(deps, userId, opts.locale));
  return Promise.all(
    docs.map(async (d) => {
      let html: string | null = null;
      if (opts.storage) {
        const body = await opts.storage.get('assets', d.content_key).catch(() => null);
        if (!body) throw new AppError('SERVICE_UNAVAILABLE', 'Legal document content is unavailable');
        html = sanitizeLegalHtml(body.toString('utf8'));
      }
      return { id: d.id, kind: d.kind as (typeof ACCEPTANCE_KINDS)[number], version: d.version, locale: d.locale, publishedAt: d.published_at?.toISOString() ?? null, html };
    }),
  );
}

/**
 * Records acceptance of exactly the pending documents shown for `locale` (AS04/AS05). The ids must be the whole
 * pending set (terms, privacy and DPA as published); anything else (a stale list after a new publication, another
 * locale's version, a document the gate did not show) is refused and nothing is recorded. Re-sending documents
 * already accepted is a no-op.
 */
export async function acceptLegal(deps: Deps, tenantId: string, userId: string, documentIds: string[], ip: string, locale?: string) {
  const db = deps.db.platform();
  const ids = [...new Set(documentIds)];
  const already = new Set(
    ids.length === 0
      ? []
      : (await db.selectFrom('legal_acceptances').select('document_id').where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('document_id', 'in', ids).execute()).map((a) => a.document_id),
  );
  const fresh = ids.filter((id) => !already.has(id));
  const pending = new Set((await pendingLegalDocuments(deps, tenantId, userId, await viewerLocale(deps, userId, locale))).map((d) => d.id));
  if (fresh.length !== pending.size || fresh.some((id) => !pending.has(id))) {
    throw new AppError('VALIDATION_FAILED', 'The documents shown are no longer the current versions', { errors: [{ path: 'documentIds', message: 'stale' }] });
  }
  if (fresh.length === 0) return;
  await db.transaction().execute(async (tx) => {
    for (const id of fresh) await tx.insertInto('legal_acceptances').values({ id: uuidv7(), tenant_id: tenantId, user_id: userId, document_id: id, ip }).execute();
  });
}

// ---- email template texts (TR-EML-03)
export async function getEmailTemplate(deps: Deps, key: string, locale: string) {
  const r = await sql<{ subject: string; blocks: string[] }>`SELECT subject, blocks FROM email_template_texts WHERE template_key = ${key} AND locale = ${locale}`.execute(deps.db.platform());
  return r.rows[0] ?? null;
}

// ---- push key status (FR-SA-12): view only
export async function pushKeyStatus(deps: Deps) {
  const key = deps.config.vapidPublicKey;
  const r = await deps.db.platform().selectFrom('push_subscriptions').select((eb) => [eb.fn.countAll<number>().as('n')]).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
  return { configured: Boolean(key), publicKeyFingerprint: key ? createHash('sha256').update(key).digest('hex').slice(0, 16) : null, activeSubscriptions: Number(r.n) };
}

// ---- platform reports (FR-RPT-07, TR-RPT-06)
export async function platformDailyRollup(deps: Deps, date: string) {
  const db = deps.db.platform();
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  const next = new Date(day(date).getTime() + 86_400_000);
  const byStatus = await db.selectFrom('tenants').select(['status', (eb) => eb.fn.countAll<number>().as('n')]).groupBy('status').execute();
  const byPlan = await db.selectFrom('tenants').innerJoin('plans', 'plans.id', 'tenants.plan_id').select(['plans.code', (eb) => eb.fn.countAll<number>().as('n')]).where('tenants.status', '!=', 'deleted').groupBy('plans.code').execute();
  const signups = await db.selectFrom('tenants').select((eb) => eb.fn.countAll<number>().as('n')).where('created_at', '>=', day(date)).where('created_at', '<', next).executeTakeFirstOrThrow();
  const statusChanges = await db
    .selectFrom('audit_log')
    .select(['after_data', 'before_data', 'action'])
    .where('occurred_at', '>=', day(date))
    .where('occurred_at', '<', next)
    .where('action', 'in', ['tenant.status_changed', 'tenant.cancelled'])
    .execute();
  const cancellations = statusChanges.filter((c) => (c.after_data as { status?: string } | null)?.status === 'cancelled').length;
  // MRR = Σ recorded payments covering the day (amount paid ÷ months covered), per currency. The amount is what the
  // tenant actually paid, so a catalogue change never reprices existing customers (A17, FR-RPT-07).
  const paid = await db
    .selectFrom('tenant_payments')
    .select(['amount_minor', 'currency', 'months'])
    .where('covers_from', '<', next)
    .where('covers_until', '>', day(date))
    .execute();
  const mrr: Record<string, number> = {};
  for (const p of paid) mrr[p.currency] = (mrr[p.currency] ?? 0) + Math.round(p.amount_minor / p.months);
  // Delivery health (BRD §12.2): push outcomes recorded per recipient, webhook deliveries that failed.
  const pushRows = await db
    .selectFrom('alert_deliveries')
    .select(['outcome', (eb) => eb.fn.countAll<number>().as('n')])
    .where('updated_at', '>=', day(date))
    .where('updated_at', '<', next)
    .groupBy('outcome')
    .execute();
  const pushCount = (o: string) => Number(pushRows.find((r) => r.outcome === o)?.n ?? 0);
  const pushSent = pushCount('sent');
  const pushFailed = pushCount('retry') + pushCount('gone');
  const webhookFailures = await db
    .selectFrom('webhook_deliveries')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('created_at', '>=', day(date))
    .where('created_at', '<', next)
    .where('status', 'in', ['failed', 'abandoned'])
    .executeTakeFirstOrThrow();
  const reports = await db
    .selectFrom('report_daily')
    .select([(eb) => eb.fn.sum<number>('tickets_created').as('tickets'), (eb) => eb.fn.sum<number>('reach_push').as('push')])
    .where('business_date', '=', date)
    .where('counter_key', '=', '')
    .where('hour_local', '=', 24)
    .executeTakeFirstOrThrow();
  const uaRows = await db.selectFrom('report_daily').select('ua_reach').where('business_date', '=', date).where('counter_key', '=', '').where('hour_local', '=', 24).execute();
  const reachByUa: Record<string, Record<string, number>> = {};
  for (const r of uaRows)
    for (const [raw, levels] of Object.entries(r.ua_reach as unknown as Record<string, Record<string, number>>)) {
      const ua = uaReachKey(raw); // rows rolled up before keys were normalised may hold any client string
      for (const [l, n] of Object.entries(levels)) (reachByUa[ua] ??= {})[l] = (reachByUa[ua][l] ?? 0) + n;
    }
  await sql`INSERT INTO platform_metrics_daily (metric_date, tenants_by_status, tenants_by_plan, signups, conversions, cancellations, mrr_minor, tickets, alerts_sent, push_failures, webhook_failures, reach_by_ua)
    VALUES (${date}, ${json(Object.fromEntries(byStatus.map((s) => [s.status, Number(s.n)])))}, ${json(Object.fromEntries(byPlan.map((p) => [p.code, Number(p.n)])))}, ${Number(signups.n)}, 0, ${cancellations}, ${json(mrr)}, ${Number(reports.tickets ?? 0)}, ${pushSent}, ${pushFailed}, ${Number(webhookFailures.n)}, ${json(reachByUa)})
    ON DUPLICATE KEY UPDATE tenants_by_status = VALUES(tenants_by_status), tenants_by_plan = VALUES(tenants_by_plan), signups = VALUES(signups), conversions = VALUES(conversions),
      cancellations = VALUES(cancellations), mrr_minor = VALUES(mrr_minor), tickets = VALUES(tickets), alerts_sent = VALUES(alerts_sent),
      push_failures = VALUES(push_failures), webhook_failures = VALUES(webhook_failures), reach_by_ua = VALUES(reach_by_ua)`.execute(db);
  return { date, mrr, signups: Number(signups.n), cancellations };
}

/**
 * Platform report (FR-RPT-07, BRD §12.2): daily metrics, churn against the tenants active when the range started
 * (the snapshot taken at the end of the day before `from`), retention by sign-up cohort (month), and
 * delivery health (W09).
 */
export async function platformReport(deps: Deps, from: string, to: string) {
  const db = deps.db.platform();
  const r = await sql<Record<string, unknown>>`SELECT * FROM platform_metrics_daily WHERE metric_date BETWEEN ${from} AND ${to} ORDER BY metric_date`.execute(db);
  const days = r.rows;
  const dayBefore = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const start = (await sql<{ tenants_by_status: unknown }>`SELECT tenants_by_status FROM platform_metrics_daily WHERE metric_date = ${dayBefore}`.execute(db)).rows[0];
  const startSnapshot = (start?.tenants_by_status ?? days[0]?.tenants_by_status ?? null) as Record<string, number> | null;
  const activeAtStart = startSnapshot ? Number(startSnapshot.active ?? 0) + Number(startSnapshot.past_due ?? 0) : 0;
  const cancellations = days.reduce((a, d) => a + Number(d.cancellations ?? 0), 0);

  // Cohorts: tenants that signed up in each month of the range, and how many of them are still on a plan today
  // (there is no trial: a tenant is active from creation until its plan ends or it cancels).
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toNext = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000);
  const signedUp = await db.selectFrom('tenants').select(['created_at', 'complimentary', 'status']).where('created_at', '>=', fromDate).where('created_at', '<', toNext).execute();
  const byMonth = new Map<string, { signups: number; active: number; complimentary: number }>();
  for (const t of signedUp) {
    const m = t.created_at.toISOString().slice(0, 7);
    const c = byMonth.get(m) ?? { signups: 0, active: 0, complimentary: 0 };
    c.signups++;
    if (t.complimentary) c.complimentary++;
    else if (t.status === 'active' || t.status === 'past_due') c.active++;
    byMonth.set(m, c);
  }
  const cohorts = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, c]) => ({ month, ...c, retentionPct: c.signups - c.complimentary > 0 ? Math.round((c.active / (c.signups - c.complimentary)) * 1000) / 10 : null }));

  const pushSent = days.reduce((a, d) => a + Number(d.alerts_sent ?? 0), 0);
  const pushFailures = days.reduce((a, d) => a + Number(d.push_failures ?? 0), 0);
  const webhookFailures = days.reduce((a, d) => a + Number(d.webhook_failures ?? 0), 0);
  const deliveryHealth = {
    pushSent,
    pushFailures,
    pushFailurePct: pushSent + pushFailures > 0 ? Math.round((pushFailures / (pushSent + pushFailures)) * 1000) / 10 : null,
    webhookFailures,
  };
  // Alert reach by phone type (BRD §12.2): alert level at Ready per operating system/browser family, over the range.
  const reachByUa: Record<string, Record<string, number>> = {};
  for (const d of days) {
    const raw = typeof d.reach_by_ua === 'string' ? (JSON.parse(d.reach_by_ua) as unknown) : d.reach_by_ua;
    for (const [key, levels] of Object.entries((raw ?? {}) as Record<string, Record<string, number>>)) {
      const ua = uaReachKey(key);
      for (const [level, n] of Object.entries(levels ?? {})) (reachByUa[ua] ??= {})[level] = (reachByUa[ua][level] ?? 0) + Number(n);
    }
  }
  return { days, activeAtStart, churnPct: activeAtStart ? Math.round((cancellations / activeAtStart) * 1000) / 10 : null, cohorts, deliveryHealth, reachByUa };
}
