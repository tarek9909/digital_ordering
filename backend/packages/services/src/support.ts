import type { Actor } from '@dop/auth';
import { tokenHash } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { newSecretToken, newSupportCode, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { urls, type Deps } from './deps.js';
import { sendEmail } from './email.js';
import { addOutbox, flushOutbox } from './outbox.js';

// Support access (FR-SUP-02 – FR-SUP-07, §8.3, TR-AUTH-10). Platform users act inside a tenant only through an
// approved session (owner/manager approval or a one-time phone code) or emergency access with a reason (BR-19).

type PlatformActor = Actor & { kind: 'platform' };
const hash = (deps: Deps, s: string) => tokenHash(deps.config.pepper, s);

async function tenantContacts(deps: Deps, tenantId: string) {
  return deps.db
    .platform()
    .selectFrom('tenant_memberships')
    .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
    .select(['users.email', 'users.locale', 'tenant_memberships.role'])
    .where('tenant_memberships.tenant_id', '=', tenantId)
    .where('tenant_memberships.status', '=', 'active')
    .execute();
}

async function announce(deps: Deps, tenantId: string, active: boolean, agentName: string | null, expiresAt: Date | null) {
  const id = await addOutbox(deps.db.platform(), 'support.session', tenantId, { emit: { active, agentName, expiresAt: expiresAt?.toISOString() ?? null } });
  await flushOutbox(deps, [id]);
}

export async function requestSupport(deps: Deps, actor: PlatformActor, tenantId: string, reason: string, durationMinutes: number) {
  const id = uuidv7();
  await deps.db.platform().transaction().execute(async (tx) => {
    const t = await tx.selectFrom('tenants').select('id').where('id', '=', tenantId).where('status', '!=', 'deleted').executeTakeFirst();
    if (!t) throw new AppError('NOT_FOUND');
    await tx.insertInto('support_sessions').values({ id, tenant_id: tenantId, platform_user_id: actor.platformUserId, reason, status: 'requested', duration_minutes: durationMinutes, requested_at: deps.now() }).execute();
    await writeAudit(tx, { actor, action: 'support.requested', tenantId, entityType: 'support_session', entityId: id, after: { reason, durationMinutes }, purpose: 'support', visibleToTenant: true });
  });
  for (const c of await tenantContacts(deps, tenantId)) {
    await sendEmail(deps, { template: 'support_requested', to: c.email, locale: c.locale, tenantId, data: { reason }, key: `supreq:${id}:${c.email}` });
  }
  return { id };
}

/**
 * Emergency access (FR-SUP-06): super admin only, reason recorded, owner notified at once. `confirm` is the
 * tenant's slug typed by the agent; the server checks it as well as the console (I-7).
 */
export async function emergencySupport(deps: Deps, actor: PlatformActor, tenantId: string, reason: string, confirm?: string) {
  if (actor.role !== 'super_admin') throw new AppError('FORBIDDEN');
  if (confirm !== undefined) {
    const t = await deps.db.platform().selectFrom('tenants').select('slug').where('id', '=', tenantId).executeTakeFirst();
    if (!t) throw new AppError('NOT_FOUND');
    if (confirm.trim() !== t.slug) throw new AppError('VALIDATION_FAILED', 'Type the tenant address to confirm', { errors: [{ path: 'confirm', message: 'mismatch' }] });
  }
  const id = uuidv7();
  const now = deps.now();
  const minutes = 60;
  await deps.db.platform().transaction().execute(async (tx) => {
    await tx
      .insertInto('support_sessions')
      .values({ id, tenant_id: tenantId, platform_user_id: actor.platformUserId, reason, kind: 'emergency', status: 'active', duration_minutes: minutes, requested_at: now, decided_at: now, expires_at: new Date(now.getTime() + minutes * 60_000) })
      .execute();
    await writeAudit(tx, { actor, action: 'support.emergency_opened', tenantId, entityType: 'support_session', entityId: id, after: { reason }, purpose: 'security', visibleToTenant: true });
  });
  deps.log.warn({ security: true, event: 'EMERGENCY_SUPPORT', tenantId, by: actor.platformUserId }, 'emergency support access opened');
  for (const c of (await tenantContacts(deps, tenantId)).filter((x) => x.role === 'owner')) {
    await sendEmail(deps, { template: 'emergency_access', to: c.email, locale: c.locale, tenantId, data: { reason }, key: `emerg:${id}` });
  }
  return { id };
}

async function activate(deps: Deps, sessionId: string, decidedBy: string | null, actor: Actor) {
  const now = deps.now();
  let tenantId = '';
  let expires: Date = now;
  let agent = '';
  await deps.db.platform().transaction().execute(async (tx) => {
    const s = await tx
      .selectFrom('support_sessions')
      .innerJoin('platform_users', 'platform_users.id', 'support_sessions.platform_user_id')
      .select(['support_sessions.id', 'support_sessions.status', 'support_sessions.tenant_id', 'support_sessions.duration_minutes', 'support_sessions.requested_at', 'platform_users.name'])
      .where('support_sessions.id', '=', sessionId)
      .forUpdate()
      .executeTakeFirst();
    if (!s || s.status !== 'requested') throw new AppError('NOT_FOUND');
    if (now.getTime() - s.requested_at.getTime() > 24 * 3600_000) throw new AppError('INVITATION_EXPIRED', 'Request expired');
    tenantId = s.tenant_id;
    agent = s.name;
    expires = new Date(now.getTime() + s.duration_minutes * 60_000);
    await tx.updateTable('support_sessions').set({ status: 'active', decided_at: now, decided_by_user_id: decidedBy, expires_at: expires }).where('id', '=', sessionId).execute();
    await writeAudit(tx, { actor, action: 'support.approved', tenantId, entityType: 'support_session', entityId: sessionId, visibleToTenant: true, purpose: 'support' });
  });
  await announce(deps, tenantId, true, agent, expires);
  for (const c of await tenantContacts(deps, tenantId)) await sendEmail(deps, { template: 'support_started', to: c.email, locale: c.locale, tenantId, data: {}, key: `supstart:${sessionId}:${c.email}` });
}

/** Owner or manager approves in the admin area (FR-ADM-14). */
export async function approveSupport(deps: Deps, actor: Actor & { kind: 'user' }, sessionId: string) {
  const s = await deps.db.forTenant(actor.tenantId).selectFrom('support_sessions').select('id').where('id', '=', sessionId).executeTakeFirst();
  if (!s) throw new AppError('NOT_FOUND');
  await activate(deps, sessionId, actor.userId, actor);
}

export async function refuseSupport(deps: Deps, actor: Actor & { kind: 'user' }, sessionId: string) {
  const db = deps.db.forTenant(actor.tenantId);
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('support_sessions').set({ status: 'refused', decided_at: deps.now(), decided_by_user_id: actor.userId }).where('id', '=', sessionId).where('status', '=', 'requested').executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    await writeAudit(tx, { actor, action: 'support.refused', tenantId: actor.tenantId, entityType: 'support_session', entityId: sessionId });
  });
}

/** One-time 8-digit code, 15 minutes, read to the agent by phone (FR-SUP-02). */
export async function createSupportCode(deps: Deps, actor: Actor & { kind: 'user' }) {
  const code = newSupportCode();
  await deps.kv.set(`supcode:${actor.tenantId}:${hash(deps, code)}`, actor.userId, 15 * 60);
  return { code, expiresAt: new Date(deps.now().getTime() + 15 * 60_000).toISOString() };
}

export async function verifySupportCode(deps: Deps, actor: PlatformActor, sessionId: string, code: string) {
  const s = await deps.db.platform().selectFrom('support_sessions').select(['tenant_id', 'platform_user_id']).where('id', '=', sessionId).where('status', '=', 'requested').executeTakeFirst();
  if (!s || s.platform_user_id !== actor.platformUserId) throw new AppError('NOT_FOUND');
  const userId = await deps.kv.take(`supcode:${s.tenant_id}:${hash(deps, code)}`); // single use (L-2)
  if (!userId) throw new AppError('SUPPORT_CODE_INVALID');
  await activate(deps, sessionId, userId, actor);
}

export async function endSupport(deps: Deps, actor: Actor, sessionId: string, by: 'platform' | 'tenant', tenantId?: string) {
  const db = tenantId ? deps.db.forTenant(tenantId) : deps.db.platform();
  let tid = '';
  await db.transaction().execute(async (tx) => {
    const s = await tx.selectFrom('support_sessions').select(['tenant_id', 'platform_user_id']).where('id', '=', sessionId).where('status', '=', 'active').executeTakeFirst();
    if (!s) throw new AppError('NOT_FOUND');
    if (actor.kind === 'platform' && s.platform_user_id !== actor.platformUserId && actor.role !== 'super_admin') throw new AppError('FORBIDDEN');
    tid = s.tenant_id;
    await tx.updateTable('support_sessions').set({ status: 'ended', ended_at: deps.now(), ended_by: by }).where('id', '=', sessionId).execute();
    await writeAudit(tx, { actor, action: 'support.ended', tenantId: s.tenant_id, entityType: 'support_session', entityId: sessionId, visibleToTenant: true });
  });
  for (const k of await deps.kv.keys(`sup:${sessionId}:`)) await deps.kv.del(k);
  await announce(deps, tid, false, null, null);
}

/** `support.expire` every minute (§8.3): requested > 24 h and active past expires_at. */
export async function expireSupport(deps: Deps) {
  const now = deps.now();
  const db = deps.db.platform();
  await db.updateTable('support_sessions').set({ status: 'expired' }).where('status', '=', 'requested').where('requested_at', '<', new Date(now.getTime() - 24 * 3600_000)).execute();
  const ended = await db.selectFrom('support_sessions').select(['id', 'tenant_id']).where('status', '=', 'active').where('expires_at', '<', now).execute();
  for (const s of ended) {
    await db.updateTable('support_sessions').set({ status: 'expired', ended_at: now, ended_by: 'system' }).where('id', '=', s.id).execute();
    await announce(deps, s.tenant_id, false, null, null);
  }
  return ended.length;
}

/**
 * "Enter" the tenant: a one-time handoff URL that sets the support cookie on the tenant host (TR-AUTH-06). Like the
 * user handoff it is bound to the agent's browser (I-8): `userAgent` must match when the link is used.
 */
export async function enterSupport(deps: Deps, actor: PlatformActor, sessionId: string, userAgent?: string) {
  const s = await deps.db
    .platform()
    .selectFrom('support_sessions')
    .innerJoin('tenants', 'tenants.id', 'support_sessions.tenant_id')
    .select(['support_sessions.platform_user_id', 'support_sessions.expires_at', 'tenants.slug', 'support_sessions.tenant_id'])
    .where('support_sessions.id', '=', sessionId)
    .where('support_sessions.status', '=', 'active')
    .executeTakeFirst();
  if (!s || s.platform_user_id !== actor.platformUserId) throw new AppError('NOT_FOUND');
  const code = newSecretToken();
  await deps.kv.set(`suphand:${hash(deps, code)}`, JSON.stringify({ sessionId, tenantId: s.tenant_id, ua: userAgent ?? null }), 60);
  return { url: urls(deps.config).admin(s.slug, `/support-handoff?code=${code}`) };
}

/** Tenant host side of the handoff: returns the cookie token for `__Host-sup`. */
export async function exchangeSupportHandoff(deps: Deps, code: string, tenantId: string, userAgent?: string): Promise<{ token: string; maxAgeMs: number }> {
  const raw = await deps.kv.take(`suphand:${hash(deps, code)}`); // single use, atomically (L-2)
  if (!raw) throw new AppError('UNAUTHENTICATED', 'Link expired');
  const p = JSON.parse(raw) as { sessionId: string; tenantId: string; ua?: string | null };
  if (p.tenantId !== tenantId || (p.ua && p.ua !== userAgent)) throw new AppError('UNAUTHENTICATED', 'Link expired');
  const s = await deps.db
    .platform()
    .selectFrom('support_sessions')
    .innerJoin('platform_users', 'platform_users.id', 'support_sessions.platform_user_id')
    .select(['support_sessions.expires_at', 'support_sessions.tenant_id', 'platform_users.status', 'platform_users.role'])
    .where('support_sessions.id', '=', p.sessionId)
    .where('support_sessions.status', '=', 'active')
    .executeTakeFirst();
  // The agent must still be allowed to act when the link is used (H-6).
  if (!s?.expires_at || s.tenant_id !== tenantId || s.status !== 'active' || !SUPPORT_ROLES.has(s.role)) throw new AppError('UNAUTHENTICATED');
  const token = newSecretToken();
  const ttl = Math.max(60, Math.floor((s.expires_at.getTime() - deps.now().getTime()) / 1000));
  await deps.kv.set(`sup:${p.sessionId}:${hash(deps, token)}`, '1', ttl);
  await deps.kv.set(`suptok:${hash(deps, token)}`, p.sessionId, ttl);
  return { token, maxAgeMs: ttl * 1000 };
}

/** Sign-out with a support cookie: this browser's support credential stops working; the session itself stays. */
export async function revokeSupportToken(deps: Deps, token: string) {
  const sessionId = await deps.kv.take(`suptok:${hash(deps, token)}`);
  if (sessionId) await deps.kv.del(`sup:${sessionId}:${hash(deps, token)}`);
}

/**
 * "Leave support" in the admin area (M-23): ends the whole support session, so every browser credential and
 * pending handoff for it stops working and the tenant sees it end. Returns false when nothing was active.
 */
export async function leaveSupport(deps: Deps, token: string, tenantId: string): Promise<boolean> {
  const actor = await resolveSupport(deps, token, tenantId);
  await revokeSupportToken(deps, token);
  if (!actor) return false;
  try {
    await endSupport(deps, actor, actor.supportSessionId, 'platform', tenantId);
  } catch (e) {
    if (!(e instanceof AppError && e.code === 'NOT_FOUND')) throw e;
  }
  return true;
}

/**
 * Ends every active support session of a platform user (H-6): called when the account is disabled, its MFA is
 * reset or it loses the support role. Their cookies and handoffs fail from then on.
 */
export async function endSupportForPlatformUser(deps: Deps, platformUserId: string) {
  const db = deps.db.platform();
  const active = await db.selectFrom('support_sessions').select(['id', 'tenant_id']).where('platform_user_id', '=', platformUserId).where('status', '=', 'active').execute();
  for (const s of active) {
    await db.updateTable('support_sessions').set({ status: 'ended', ended_at: deps.now(), ended_by: 'system' }).where('id', '=', s.id).where('status', '=', 'active').execute();
    for (const k of await deps.kv.keys(`sup:${s.id}:`)) await deps.kv.del(k);
    await announce(deps, s.tenant_id, false, null, null);
  }
  // Requests not yet approved can no longer be approved into access either.
  await db.updateTable('support_sessions').set({ status: 'cancelled' }).where('platform_user_id', '=', platformUserId).where('status', '=', 'requested').execute();
  return active.length;
}

/** Platform roles that may hold tenant support access (the `console.support` grant). */
const SUPPORT_ROLES = new Set(['super_admin', 'support']);

/**
 * Resolves the support cookie into a support actor (TR-AUTH-12), checking the session is still active and the
 * agent behind it still may act: an active account with a support role (H-6).
 */
export async function resolveSupport(deps: Deps, token: string, tenantId: string): Promise<Extract<Actor, { kind: 'support' }> | null> {
  const sessionId = await deps.kv.get(`suptok:${hash(deps, token)}`);
  if (!sessionId || !(await deps.kv.exists(`sup:${sessionId}:${hash(deps, token)}`))) return null;
  const s = await deps.db
    .platform()
    .selectFrom('support_sessions')
    .innerJoin('platform_users', 'platform_users.id', 'support_sessions.platform_user_id')
    .select(['support_sessions.tenant_id', 'support_sessions.expires_at', 'support_sessions.platform_user_id', 'platform_users.name', 'platform_users.status', 'platform_users.role'])
    .where('support_sessions.id', '=', sessionId)
    .where('support_sessions.status', '=', 'active')
    .executeTakeFirst();
  if (!s || s.tenant_id !== tenantId || !s.expires_at || s.expires_at <= deps.now()) return null;
  if (s.status !== 'active' || !SUPPORT_ROLES.has(s.role)) return null;
  return { kind: 'support', platformUserId: s.platform_user_id, tenantId, supportSessionId: sessionId, agentName: s.name };
}

export async function listSupportSessions(deps: Deps, tenantId: string) {
  const rows = await deps.db
    .forTenant(tenantId)
    .selectFrom('support_sessions')
    .innerJoin('platform_users', 'platform_users.id', 'support_sessions.platform_user_id')
    .select(['support_sessions.id', 'support_sessions.status', 'support_sessions.kind', 'support_sessions.reason', 'support_sessions.requested_at', 'support_sessions.expires_at', 'support_sessions.ended_at', 'platform_users.name'])
    .orderBy('support_sessions.requested_at', 'desc')
    .limit(50)
    .execute();
  return rows.map((r) => ({ id: r.id, status: r.status, kind: r.kind, reason: r.reason, agentName: r.name, requestedAt: r.requested_at.toISOString(), expiresAt: r.expires_at?.toISOString() ?? null, endedAt: r.ended_at?.toISOString() ?? null }));
}
