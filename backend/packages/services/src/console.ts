import type { Actor } from '@dop/auth';
import { AppError, BUILTIN_CHIMES, PLATFORM_SETTING_DEFAULTS, siteContactSchema, sitePricingSchema, siteLandingSchema, chimeAudioKey, type AuditPurpose, type PlatformSettingKey } from '@dop/contracts';
import { parseIpRules, type IpRules } from '@dop/config';
import { json } from '@dop/db';
import { uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { issuePlatformInvitation } from './auth.js';
import { listPayments } from './billing.js';
import { urls, type Deps } from './deps.js';
import { sendEmail } from './email.js';
import { clearSettingCache, getSetting } from './platform.js';
import { markDeleted } from './privacy.js';
import { pilotReport } from './reports.js';
import type { ObjectStorage } from './storage.js';
import { endSupportForPlatformUser } from './support.js';
import { changeTenantStatus } from './tenants.js';
import type { ZodType } from 'zod';

// Super admin console services (FR-SA-01 – FR-SA-14 MVP part, FR-SUP-01, FR-SUP-07). Cross-tenant reads use
// the platform client from console routes only (TR-TEN-06); every write is audited.

type PlatformActor = Actor & { kind: 'platform' };

export async function listTenants(deps: Deps, q: { q?: string; status?: string; plan?: string; limit: number; cursor?: string }) {
  const db = deps.db.platform();
  let query = db
    .selectFrom('tenants')
    .innerJoin('plans', 'plans.id', 'tenants.plan_id')
    .select(['tenants.id', 'tenants.name', 'tenants.slug', 'tenants.status', 'tenants.complimentary', 'tenants.created_at', 'tenants.last_activity_at', 'tenants.plan_starts_at', 'tenants.paid_until', 'plans.code as plan'])
    .where('tenants.status', '!=', 'deleted');
  if (q.q) {
    const term = `%${q.q.replace(/[%_]/g, '')}%`;
    // Name, address or the email of the owner or a manager (FR-SA-04, A15), filtered before paging.
    query = query.where((eb) =>
      eb.or([
        eb('tenants.name', 'like', term),
        eb('tenants.slug', 'like', term),
        eb.exists(
          eb
            .selectFrom('tenant_memberships as m')
            .innerJoin('users as u', 'u.id', 'm.user_id')
            .select('m.id')
            .whereRef('m.tenant_id', '=', 'tenants.id')
            .where('m.status', '=', 'active')
            .where('u.email', 'like', term),
        ),
      ]),
    );
  }
  if (q.status) query = query.where('tenants.status', '=', q.status as never);
  if (q.plan) query = query.where('plans.code', '=', q.plan);
  if (q.cursor) query = query.where('tenants.id', '<', q.cursor);
  const rows = await query.orderBy('tenants.id', 'desc').limit(q.limit + 1).execute();
  const page = rows.slice(0, q.limit);
  const monthStart = deps.now().toISOString().slice(0, 8) + '01';
  const ids = page.map((r) => r.id);
  const counts = ids.length
    ? await db
        .selectFrom('report_daily')
        .select(['tenant_id', (eb) => eb.fn.sum<number>('tickets_created').as('n')])
        .where('tenant_id', 'in', ids)
        .where('counter_key', '=', '')
        .where('hour_local', '=', 24)
        .where('business_date', '>=', monthStart)
        .groupBy('tenant_id')
        .execute()
    : [];
  const owners = ids.length
    ? await db
        .selectFrom('tenant_memberships')
        .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
        .select(['tenant_memberships.tenant_id', 'users.email'])
        .where('tenant_memberships.tenant_id', 'in', ids)
        .where('tenant_memberships.role', '=', 'owner')
        .where('tenant_memberships.status', '=', 'active')
        .execute()
    : [];
  return {
    items: page.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      plan: r.plan,
      complimentary: Boolean(r.complimentary),
      createdAt: r.created_at.toISOString(),
      lastActivityAt: r.last_activity_at?.toISOString() ?? null,
      planStartsAt: r.plan_starts_at?.toISOString() ?? null,
      planEndsAt: r.paid_until?.toISOString() ?? null,
      ticketsThisMonth: Number(counts.find((c) => c.tenant_id === r.id)?.n ?? 0),
      ownerEmail: owners.find((o) => o.tenant_id === r.id)?.email ?? null,
    })),
    nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
  };
}

/** Opening a tenant asks for a purpose, stored with the audit entry (FR-SUP-07, TR-FE-25). */
export async function tenantDetail(deps: Deps, actor: PlatformActor, tenantId: string, purpose: AuditPurpose, requestId?: string) {
  const db = deps.db.platform();
  const t = await db.selectFrom('tenants').innerJoin('plans', 'plans.id', 'tenants.plan_id').selectAll('tenants').select(['plans.code as plan']).where('tenants.id', '=', tenantId).executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  const tdb = deps.db.forTenant(tenantId);
  const [venues, devices, displays, members, payments] = await Promise.all([
    tdb.selectFrom('venues').select(['id', 'name', 'venue_code', 'status', 'time_zone', 'logo_key']).orderBy('created_at').execute(),
    tdb.selectFrom('staff_devices').select(['id', 'venue_id', 'name', 'last_seen_at']).where('revoked_at', 'is', null).execute(),
    tdb.selectFrom('displays').select(['id', 'venue_id', 'name', 'last_seen_at', 'sound_enabled', 'paired_at']).where('revoked_at', 'is', null).execute(),
    tdb
      .selectFrom('tenant_memberships')
      .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
      .select(['tenant_memberships.id', 'tenant_memberships.role', 'users.name', 'users.email', 'users.email_verified_at'])
      .where('tenant_memberships.status', '=', 'active')
      .execute(),
    listPayments(deps, tenantId, 10),
  ]);
  await writeAudit(db, { actor, action: 'tenant.viewed', tenantId, entityType: 'tenant', entityId: tenantId, purpose, requestId, visibleToTenant: false });
  return {
    tenant: {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      statusReason: t.status_reason,
      suspendedBy: t.suspended_by,
      plan: t.plan,
      complimentary: Boolean(t.complimentary),
      logoUrl: urls(deps.config).logo(venues[0]?.logo_key ?? null),
      planStartsAt: t.plan_starts_at?.toISOString() ?? null,
      planEndsAt: t.paid_until?.toISOString() ?? null,
      paidUntil: t.paid_until?.toISOString() ?? null,
      graceEndsAt: t.grace_ends_at?.toISOString() ?? null,
      deletionRequestedAt: t.deletion_requested_at?.toISOString() ?? null,
      country: t.country,
      defaultLocale: t.default_locale,
      createdAt: t.created_at.toISOString(),
      lastActivityAt: t.last_activity_at?.toISOString() ?? null,
    },
    venues: venues.map(({ logo_key: _k, ...v }) => v),
    devices: devices.map((d) => ({ ...d, last_seen_at: d.last_seen_at.toISOString() })),
    displays,
    members: members.map((m) => ({ id: m.id, role: m.role, name: m.name, email: m.email, verified: m.email_verified_at !== null })),
    payments,
  };
}

/** Sets the plan's start and end dates (the end is the paid-until date the billing sweep checks). */
export async function setPlanDates(deps: Deps, actor: PlatformActor, tenantId: string, startsAt: string, endsAt: string) {
  const db = deps.db.platform();
  const from = new Date(`${startsAt}T00:00:00Z`);
  const until = new Date(`${endsAt}T23:59:59.999Z`);
  await db.transaction().execute(async (tx) => {
    const t = await tx.selectFrom('tenants').select(['status', 'plan_starts_at', 'paid_until']).where('id', '=', tenantId).forUpdate().executeTakeFirst();
    if (!t) throw new AppError('NOT_FOUND');
    if (t.status === 'deleted') throw new AppError('INVALID_TRANSITION', 'A deleted tenant has no plan');
    await tx.updateTable('tenants').set({ plan_starts_at: from, paid_until: until }).where('id', '=', tenantId).execute();
    await writeAudit(tx, {
      actor,
      action: 'tenant.plan_dates_set',
      tenantId,
      entityType: 'tenant',
      entityId: tenantId,
      before: { planStartsAt: t.plan_starts_at?.toISOString() ?? null, planEndsAt: t.paid_until?.toISOString() ?? null },
      after: { planStartsAt: from.toISOString(), planEndsAt: until.toISOString() },
    });
  });
}

/** Complimentary (BR-25, TR-BIL-08): on → active without paying; off → paid for at least 14 more days, then the paid-until checks apply. */
export async function setComplimentary(deps: Deps, actor: PlatformActor, tenantId: string, enabled: boolean) {
  const db = deps.db.platform();
  const t = await db.selectFrom('tenants').select(['status', 'complimentary', 'paid_until']).where('id', '=', tenantId).executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  const notice = new Date(deps.now().getTime() + 14 * 86_400_000);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('tenants')
      .set({ complimentary: enabled, ...(!enabled && (!t.paid_until || t.paid_until < notice) ? { paid_until: notice } : {}) })
      .where('id', '=', tenantId)
      .execute();
    await writeAudit(tx, { actor, action: 'tenant.complimentary_set', tenantId, entityType: 'tenant', entityId: tenantId, after: { enabled } });
  });
  if (enabled && (t.status === 'trial' || t.status === 'trial_expired' || t.status === 'cancelled')) {
    await changeTenantStatus(deps, tenantId, { to: 'active', actor, reason: 'Complimentary', email: null });
  }
}

export async function cancelTenant(deps: Deps, actor: PlatformActor, tenantId: string, reason: string) {
  await changeTenantStatus(deps, tenantId, { to: 'cancelled', actor, reason });
}

export async function deleteTenantByPlatform(deps: Deps, actor: PlatformActor, tenantId: string, confirmSlug: string) {
  const t = await deps.db.platform().selectFrom('tenants').select(['slug']).where('id', '=', tenantId).executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  if (t.slug !== confirmSlug) throw new AppError('VALIDATION_FAILED', 'Type the tenant address to confirm', { errors: [{ path: 'confirmSlug', message: 'mismatch' }] });
  await markDeleted(deps, tenantId, actor);
}

export async function auditSearch(deps: Deps, q: { tenantId?: string; actorId?: string; action?: string; from?: string; to?: string; limit: number; cursor?: string }) {
  let query = deps.db.platform().selectFrom('audit_log').selectAll();
  if (q.tenantId) query = query.where('tenant_id', '=', q.tenantId);
  if (q.actorId) query = query.where('actor_id', '=', q.actorId);
  if (q.action) query = query.where('action', '=', q.action);
  if (q.from) query = query.where('occurred_at', '>=', new Date(q.from));
  if (q.to) query = query.where('occurred_at', '<=', new Date(q.to));
  if (q.cursor) query = query.where('id', '<', Number(q.cursor));
  const rows = await query.orderBy('id', 'desc').limit(q.limit + 1).execute();
  const page = rows.slice(0, q.limit);
  return {
    items: page.map((r) => ({ ...r, occurred_at: r.occurred_at.toISOString() })),
    nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
  };
}

/** Tenant activity log (own tenant, visible entries only). */
export async function tenantActivity(deps: Deps, tenantId: string, limit = 100) {
  const rows = await deps.db
    .platform()
    .selectFrom('audit_log')
    .select(['id', 'occurred_at', 'actor_type', 'action', 'entity_type', 'entity_id'])
    .where('tenant_id', '=', tenantId)
    .where('visible_to_tenant', '=', true)
    .orderBy('id', 'desc')
    .limit(limit)
    .execute();
  return rows.map((r) => ({ ...r, occurred_at: r.occurred_at.toISOString() }));
}

// ---- platform users
export async function listPlatformUsers(deps: Deps) {
  const rows = await deps.db.platform().selectFrom('platform_users').select(['id', 'email', 'name', 'role', 'status', 'mfa_enrolled_at', 'last_sign_in_at']).orderBy('created_at').execute();
  return rows.map((r) => ({ ...r, mfa_enrolled_at: r.mfa_enrolled_at?.toISOString() ?? null, last_sign_in_at: r.last_sign_in_at?.toISOString() ?? null }));
}

export async function updatePlatformUser(deps: Deps, actor: PlatformActor, id: string, b: { role?: 'super_admin' | 'support' | 'finance'; status?: 'active' | 'disabled' }) {
  if (id === actor.platformUserId && (b.status === 'disabled' || (b.role && b.role !== 'super_admin'))) throw new AppError('FORBIDDEN', 'You cannot demote or disable yourself');
  const db = deps.db.platform();
  const patch = { ...(b.role !== undefined && { role: b.role }), ...(b.status !== undefined && { status: b.status }) };
  // An empty change is a no-op (A10, API01); the platform user must still exist.
  if (Object.keys(patch).length === 0) {
    if (!(await db.selectFrom('platform_users').select('id').where('id', '=', id).executeTakeFirst())) throw new AppError('NOT_FOUND');
    return;
  }
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('platform_users').set(patch).where('id', '=', id).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    if (b.status === 'disabled') await tx.updateTable('platform_sessions').set({ revoked_at: deps.now() }).where('platform_user_id', '=', id).where('revoked_at', 'is', null).execute();
    await writeAudit(tx, { actor, action: b.status === 'disabled' ? 'platform_user.removed' : 'platform_user.role_changed', tenantId: null, entityType: 'platform_user', entityId: id, after: b, visibleToTenant: false });
  });
  // Tenant support access derived from this account ends with it (H-6).
  if (b.status === 'disabled' || b.role === 'finance') await endSupportForPlatformUser(deps, id);
}

export async function resetPlatformMfa(deps: Deps, actor: PlatformActor, id: string) {
  const db = deps.db.platform();
  let user: { email: string; name: string } | undefined;
  await db.transaction().execute(async (tx) => {
    user = await tx.selectFrom('platform_users').select(['email', 'name']).where('id', '=', id).executeTakeFirst();
    if (!user) throw new AppError('NOT_FOUND');
    // The password goes too: whoever presented it first after the reset would otherwise enrol their own
    // authenticator. The agent sets a new password from the emailed single-use link (mailbox proof), then enrols.
    await tx.updateTable('platform_users').set({ totp_secret_enc: null, mfa_enrolled_at: null, password_hash: null, status: 'invited' }).where('id', '=', id).execute();
    await tx.updateTable('platform_sessions').set({ revoked_at: deps.now() }).where('platform_user_id', '=', id).where('revoked_at', 'is', null).execute();
    await writeAudit(tx, { actor, action: 'platform_user.mfa_reset', tenantId: null, entityType: 'platform_user', entityId: id, visibleToTenant: false });
  });
  // A security reset also ends tenant support access issued to the account (H-6).
  await endSupportForPlatformUser(deps, id);
  deps.log.warn({ security: true, event: 'MFA_RESET', by: actor.platformUserId, target: id }, 'platform MFA reset');
  await sendEmail(deps, { template: 'platform_mfa_reset', to: user!.email, locale: 'en', data: { name: user!.name } });
  await issuePlatformInvitation(deps, id, user!.email, user!.name);
}

// ---- console IP allow-list (TR-SEC-12, M-18)
/**
 * Validates and normalises the allow-list: IPv4/IPv6 addresses and CIDR ranges only. A list that would shut out
 * the administrator saving it is refused, so a typo cannot lock the console. Empty means no restriction.
 */
/** Docker gateway and Caddy of the compose network (deploy/docker-compose.yml, 172.30.0.0/24) and loopback. */
const INTERNAL_ADDRESSES = ['172.30.0.1', '172.30.0.10', '127.0.0.1', '::1'];

function validConsoleAllowList(value: unknown[], ip: string | undefined): string[] {
  if (value.length > 100 || !value.every((v) => typeof v === 'string' && v.length <= 64)) throw new AppError('VALIDATION_FAILED', 'Up to 100 addresses or ranges');
  let rules;
  try {
    rules = parseIpRules(value as string[]);
  } catch (e) {
    throw new AppError('VALIDATION_FAILED', (e as Error).message);
  }
  if (rules.rules.includes('loopback')) throw new AppError('VALIDATION_FAILED', 'List addresses or ranges, not keywords');
  // Connections Docker relays (IPv6 clients when the compose network is IPv4-only, see deploy/README) arrive from the
  // network's gateway: an entry covering it, or loopback, would admit every such client, not one network.
  if (INTERNAL_ADDRESSES.some((a) => rules.has(a))) {
    throw new AppError('VALIDATION_FAILED', 'The list covers the server’s internal network or loopback, which would admit every relayed connection (for example all IPv6 clients); list your public addresses');
  }
  if (rules.rules.length > 0 && (!ip || !rules.has(ip))) throw new AppError('VALIDATION_FAILED', `This list does not include your current address (${ip ?? 'unknown'}); saving it would lock you out`);
  return rules.rules;
}

let allowListCache: { raw: string; rules: IpRules } | null = null;

/**
 * Throws FORBIDDEN when a non-empty console allow-list does not contain `ip` (the client address as seen through
 * TRUST_PROXY only). Applies to every console API request — sign-in, existing sessions and actions alike.
 */
export async function enforceConsoleAllowList(deps: Deps, ip: string) {
  const list = (await getSetting(deps, 'console.ipAllowList')) as string[];
  if (!list.length) return;
  const raw = JSON.stringify(list);
  if (allowListCache?.raw !== raw) allowListCache = { raw, rules: parseIpRules(list) };
  if (!allowListCache.rules.has(ip)) {
    deps.log.warn({ security: true, event: 'CONSOLE_IP_DENIED', ip }, 'console request from an address outside the allow-list');
    throw new AppError('FORBIDDEN', 'The console is not available from this network');
  }
}

// ---- settings (appendix 30.4), chimes, languages
export async function listSettings(deps: Deps) {
  const rows = await deps.db.platform().selectFrom('platform_settings').select(['setting_key', 'value', 'updated_at']).execute();
  return Object.keys(PLATFORM_SETTING_DEFAULTS).map((k) => {
    const r = rows.find((x) => x.setting_key === k);
    return { key: k, value: r?.value ?? PLATFORM_SETTING_DEFAULTS[k as PlatformSettingKey], updatedAt: r?.updated_at.toISOString() ?? null };
  });
}

/** Website settings edited through their own console forms, checked in full rather than by shape. */
const SITE_SETTINGS: Record<string, { schema: ZodType; message: string }> = {
  'site.contact': { schema: siteContactSchema, message: 'Check the email and WhatsApp number' },
  'site.pricing': { schema: sitePricingSchema, message: 'Check the packages section' },
  'site.landing': { schema: siteLandingSchema, message: 'Check the landing page content' },
};

export async function putSetting(deps: Deps, actor: PlatformActor, key: string, value: unknown, context: { ip?: string } = {}) {
  if (!(key in PLATFORM_SETTING_DEFAULTS)) throw new AppError('NOT_FOUND', 'Unknown setting');
  const def = PLATFORM_SETTING_DEFAULTS[key as PlatformSettingKey];
  // Same JSON shape as the default: numbers stay numbers, objects stay objects.
  if (typeof def !== typeof value || Array.isArray(def) !== Array.isArray(value)) throw new AppError('VALIDATION_FAILED', `Setting ${key} expects ${Array.isArray(def) ? 'an array' : typeof def}`);
  if (key === 'console.ipAllowList') value = validConsoleAllowList(value as unknown[], context.ip);
  const site = SITE_SETTINGS[key];
  if (site) {
    const r = site.schema.safeParse(value);
    if (!r.success)
      throw new AppError('VALIDATION_FAILED', site.message, {
        errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    value = r.data;
  }
  await deps.db.platform().transaction().execute(async (tx) => {
    await tx.insertInto('platform_settings').values({ setting_key: key, value: json(value), updated_by: actor.platformUserId }).onDuplicateKeyUpdate({ value: json(value), updated_by: actor.platformUserId }).execute();
    await writeAudit(tx, { actor, action: 'setting.changed', tenantId: null, entityType: 'setting', entityId: key, after: value, visibleToTenant: false });
  });
  clearSettingCache();
}

export const listLanguages = (deps: Deps) => deps.db.platform().selectFrom('languages').selectAll().orderBy('code').execute();

export async function updateLanguage(deps: Deps, actor: PlatformActor, code: string, b: { customerEnabled?: boolean; ttsLang?: string | null }) {
  const patch = { ...(b.customerEnabled !== undefined && { customer_enabled: b.customerEnabled }), ...(b.ttsLang !== undefined && { tts_lang: b.ttsLang }) };
  // An empty change is a no-op (A10, API01); the language must still exist.
  if (Object.keys(patch).length === 0) {
    if (!(await deps.db.platform().selectFrom('languages').select('code').where('code', '=', code).executeTakeFirst())) throw new AppError('NOT_FOUND');
    return;
  }
  const r = await deps.db.platform().updateTable('languages').set(patch).where('code', '=', code).executeTakeFirst();
  if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
  await writeAudit(deps.db.platform(), { actor, action: 'setting.changed', tenantId: null, entityType: 'language', entityId: code, after: b, visibleToTenant: false });
}

/** Speech voice per customer language (FR-SA-12): the platform language list's tts tags. */
export async function languageVoices(deps: Pick<Deps, 'db'>): Promise<Record<string, string>> {
  const rows = await deps.db.platform().selectFrom('languages').select(['code', 'tts_lang']).where('tts_lang', 'is not', null).execute();
  return Object.fromEntries(rows.map((l) => [l.code, l.tts_lang!]));
}

export async function listChimes(deps: Deps, opts: { activeOnly?: boolean } = {}) {
  let q = deps.db.platform().selectFrom('chimes').selectAll().orderBy('name');
  if (opts.activeOnly) q = q.where('active', '=', true);
  const rows = await q.execute();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    active: Boolean(r.active),
    builtin: r.file_key.startsWith('builtin/'),
    durationMs: r.duration_ms,
    url: r.file_key.startsWith('builtin/') ? null : `${deps.config.cdnBaseUrl}/${r.file_key}`,
  }));
}

/** MP3 frame sync or an ID3 tag. */
const isMp3 = (b: Buffer) => (b.length > 3 && b.toString('latin1', 0, 3) === 'ID3') || (b.length > 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0);

/** Adds or replaces an uploaded chime (FR-SA-12, W11): MP3, ≤ 512 KB, ≤ 3 s, stored at a fixed key per code. */
export async function uploadChime(deps: Deps, storage: ObjectStorage, actor: PlatformActor, b: { code: string; name: string; durationMs: number }, file: Buffer) {
  if ((BUILTIN_CHIMES as readonly string[]).includes(b.code)) throw new AppError('VALIDATION_FAILED', 'Built-in chimes cannot be replaced', { errors: [{ path: 'code', message: 'builtin' }] });
  if (file.length === 0 || file.length > 512 * 1024) throw new AppError('UPLOAD_INVALID', 'A chime must be an MP3 of 512 KB or less');
  if (!isMp3(file)) throw new AppError('UPLOAD_INVALID', 'Upload an MP3 file');
  if (b.durationMs > 3000) throw new AppError('UPLOAD_INVALID', 'A chime lasts at most 3 seconds');
  const key = chimeAudioKey(b.code);
  await storage.put('assets', key, file, 'audio/mpeg');
  const db = deps.db.platform();
  await db
    .insertInto('chimes')
    .values({ id: uuidv7(), code: b.code, name: b.name, file_key: key, duration_ms: b.durationMs, loudness_lufs: '-14.0' })
    .onDuplicateKeyUpdate({ name: b.name, file_key: key, duration_ms: b.durationMs, active: true })
    .execute();
  await writeAudit(db, { actor, action: 'chime.created', tenantId: null, entityType: 'chime', entityId: b.code, after: { name: b.name, durationMs: b.durationMs }, visibleToTenant: false });
  return (await listChimes(deps)).find((c) => c.code === b.code)!;
}

/** Rename, or withdraw from the picker; venues already using a withdrawn chime keep it. */
export async function updateChime(deps: Deps, actor: PlatformActor, id: string, b: { name?: string; active?: boolean }) {
  const db = deps.db.platform();
  const c = await db.selectFrom('chimes').select(['code', 'file_key']).where('id', '=', id).executeTakeFirst();
  if (!c) throw new AppError('NOT_FOUND');
  if (b.active === false && c.code === 'classic') throw new AppError('VALIDATION_FAILED', 'The default chime stays available', { errors: [{ path: 'active', message: 'default' }] });
  const patch = { ...(b.name && { name: b.name }), ...(b.active !== undefined && { active: b.active }) };
  if (Object.keys(patch).length) await db.updateTable('chimes').set(patch).where('id', '=', id).execute();
  await writeAudit(db, { actor, action: 'setting.changed', tenantId: null, entityType: 'chime', entityId: c.code, after: b, visibleToTenant: false });
}

/** Pilot report per tenant (FR-RPT-10 console version). */
export async function consolePilotReport(deps: Deps, tenantIds: string[], from: string, to: string) {
  const db = deps.db.platform();
  const tenants = await db.selectFrom('tenants').select(['id', 'name', 'slug']).where('id', 'in', tenantIds.length ? tenantIds : ['-']).execute();
  return Promise.all(tenants.map(async (t) => ({ tenant: t, report: await pilotReport(deps, t.id, undefined, from, to) })));
}

export async function tenantBillingView(deps: Deps, tenantId: string) {
  const t = await deps.db.platform().selectFrom('tenants').select(['paid_until', 'trial_ends_at', 'grace_ends_at', 'complimentary']).where('id', '=', tenantId).executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  return {
    paidUntil: t.paid_until?.toISOString() ?? null,
    trialEndsAt: t.trial_ends_at?.toISOString() ?? null,
    graceEndsAt: t.grace_ends_at?.toISOString() ?? null,
    complimentary: Boolean(t.complimentary),
    payments: await listPayments(deps, tenantId),
  };
}

/** Records tenant activity at most every 10 minutes (FR-SA-04). */
export async function touchTenantActivity(deps: Deps, tenantId: string) {
  if (!(await deps.kv.setNx(`t:${tenantId}:activity`, '1', 600))) return;
  await deps.db.platform().updateTable('tenants').set({ last_activity_at: deps.now() }).where('id', '=', tenantId).execute();
}

