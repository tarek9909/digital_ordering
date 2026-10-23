import { createHash, createHmac } from 'node:crypto';
import {
  SESSION_TTL,
  checkPassword,
  decrypt,
  dummyVerify,
  encrypt,
  hashSecret,
  newTotpSecret,
  tokenHash,
  totpStepOf,
  totpUri,
  verifySecret,
  type Actor,
} from '@dop/auth';
import { AppError, type BusEvent, type MemberRole, type PlatformRole, type TenantStatus } from '@dop/contracts';
import { newSecretToken, tenantAccess, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import type { Deps } from './deps.js';
import { sendEmail } from './email.js';
import { EVENTS_CHANNEL, keys } from './kv.js';
import { urls } from './deps.js';

// Credentials and sessions (TRD §14.1, TR-AUTH-01 – TR-AUTH-08, TR-AUTH-11).

const hash = (deps: Deps, token: string) => tokenHash(deps.config.pepper, token);
export const csrfFor = (deps: Deps, sessionId: string) => createHmac('sha256', deps.config.pepper).update(`csrf:${sessionId}`).digest('base64url');

// ---- throttling (TR-AUTH-03)
const LOCKED = () => new AppError('ACCOUNT_LOCKED', 'Too many attempts. Try again in 15 minutes.');
/** Wrong passwords per account from all addresses together in 15 minutes (M-5). */
const ACCOUNT_FAILURES = 20;

/**
 * Per account and address (5 / 15 min), per address (50 / hour) and per account overall (M-5). Past the overall
 * budget only an address the account has signed in from before may keep trying, so guesses spread over many
 * addresses stop without letting a stranger lock the owner out.
 */
async function checkThrottle(deps: Deps, account: string, ip: string, familiar?: () => Promise<boolean>) {
  const [acct, ipCount, total] = await Promise.all([deps.kv.get(`signin:acct:${account}:${ip}`), deps.kv.get(`signin:ip:${ip}`), deps.kv.get(`signin:acct:${account}`)]);
  if (Number(acct ?? 0) >= 5 || Number(ipCount ?? 0) >= 50) throw LOCKED();
  if (Number(total ?? 0) >= ACCOUNT_FAILURES && !(familiar && (await familiar()))) throw LOCKED();
}
async function recordFailure(deps: Deps, account: string, ip: string) {
  await deps.kv.incr(`signin:acct:${account}:${ip}`, 15 * 60);
  await deps.kv.incr(`signin:acct:${account}`, 15 * 60);
  await deps.kv.incr(`signin:ip:${ip}`, 3600);
}

/** A password check outside sign-in that shares its lockout (linking Google to an account, M-1). */
export async function checkAccountPassword(deps: Deps, email: string, passwordHash: string | null, password: string, ip: string) {
  await checkThrottle(deps, email, ip, () => familiarAddress(deps, 'user', email, ip));
  if (!passwordHash || !(await verifySecret(passwordHash, password))) {
    if (!passwordHash) await dummyVerify(password);
    await recordFailure(deps, email, ip);
    throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
  }
}

/** True when the account opened a session from this address in the last 30 days. */
async function familiarAddress(deps: Deps, kind: 'user' | 'platform', email: string, ip: string): Promise<boolean> {
  const since = new Date(deps.now().getTime() - 30 * 86_400_000);
  const db = deps.db.platform();
  const row =
    kind === 'user'
      ? await db.selectFrom('user_sessions').innerJoin('users', 'users.id', 'user_sessions.user_id').select('user_sessions.id').where('users.email', '=', email).where('user_sessions.ip', '=', ip).where('user_sessions.created_at', '>', since).executeTakeFirst()
      : await db.selectFrom('platform_sessions').innerJoin('platform_users', 'platform_users.id', 'platform_sessions.platform_user_id').select('platform_sessions.id').where('platform_users.email', '=', email).where('platform_sessions.ip', '=', ip).where('platform_sessions.created_at', '>', since).executeTakeFirst();
  return Boolean(row);
}

// ---- second factor (H-1, M-2, L-1)
/** Wrong codes per account in 15 minutes, all addresses and flows together. */
const MFA_ACCOUNT_FAILURES = 10;
/** Wrong codes one sign-in challenge survives; then the password step starts again. */
const MFA_CHALLENGE_TRIES = 5;

/** An accepted code's time step is used once: later or concurrent use of the same or an older code fails. */
async function acceptStep(deps: Deps, principal: string, step: number): Promise<boolean> {
  if (step <= Number((await deps.kv.get(`totp:last:${principal}`)) ?? -1)) return false;
  if (!(await deps.kv.setNx(`totp:used:${principal}:${step}`, '1', 120))) return false;
  await deps.kv.set(`totp:last:${principal}`, String(step), 120);
  return true;
}

/**
 * Checks a TOTP code for `principal` (`u:<userId>` or `p:<platformUserId>`). Every flow that accepts a code goes
 * through here: one failure budget per account, an optional per-challenge budget, and single use of the code.
 * A wrong code throws UNAUTHENTICATED; `data.locked` says the account budget is now used up.
 */
async function checkSecondFactor(deps: Deps, principal: string, secret: string | null, code: string, ip: string, challengeKey?: string): Promise<void> {
  const failKey = `mfa:fail:${principal}`;
  const [fails, ipCount] = await Promise.all([deps.kv.get(failKey), deps.kv.get(`signin:ip:${ip}`)]);
  if (Number(fails ?? 0) >= MFA_ACCOUNT_FAILURES || Number(ipCount ?? 0) >= 50) throw LOCKED();
  const step = secret ? totpStepOf(secret, code) : null;
  // Replay is per secret: a code from a newly enrolled authenticator is not "older" than the old one's.
  if (step !== null && (await acceptStep(deps, `${principal}:${createHash('sha256').update(secret!).digest('hex').slice(0, 16)}`, step))) {
    await deps.kv.del(failKey);
    return;
  }
  const n = await deps.kv.incr(failKey, 15 * 60);
  await deps.kv.incr(`signin:ip:${ip}`, 3600);
  if (challengeKey && (await deps.kv.incr(`${challengeKey}:tries`, SESSION_TTL.mfaTokenMs / 1000)) >= MFA_CHALLENGE_TRIES) await deps.kv.del(challengeKey);
  throw new AppError('UNAUTHENTICATED', 'Code is incorrect', { data: { locked: n >= MFA_ACCOUNT_FAILURES } });
}

const isLockedOut = (e: unknown) => e instanceof AppError && (e.code === 'ACCOUNT_LOCKED' || (e.data as { locked?: boolean } | undefined)?.locked === true);

export interface ClientInfo {
  ip: string;
  userAgent: string;
  host: string;
}

export type SignInResult =
  | { kind: 'session'; token: string; sessionId: string; userId: string }
  | { kind: 'mfa'; mfaToken: string }
  | { kind: 'enroll_mfa'; mfaToken: string };

// ---------------------------------------------------------------- tenant users

/** `tenantId` is the host's tenant; null on www (tenant chooser). */
export async function signInUser(deps: Deps, email: string, password: string, tenantId: string | null, client: ClientInfo): Promise<SignInResult> {
  await checkThrottle(deps, email, client.ip, () => familiarAddress(deps, 'user', email, client.ip));
  const db = deps.db.platform();
  const user = await db.selectFrom('users').selectAll().where('email', '=', email).where('disabled_at', 'is', null).executeTakeFirst();
  if (!user?.password_hash) {
    await dummyVerify(password);
    await recordFailure(deps, email, client.ip);
    throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect');
  }
  if (!(await verifySecret(user.password_hash, password))) {
    await recordFailure(deps, email, client.ip);
    throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect');
  }
  if (tenantId) {
    const m = await db.selectFrom('tenant_memberships').select('id').where('tenant_id', '=', tenantId).where('user_id', '=', user.id).where('status', '=', 'active').executeTakeFirst();
    // Same message as a wrong password: never confirm which tenants an account belongs to.
    if (!m) throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect');
  }
  if (user.totp_secret_enc) return issueUserMfaChallenge(deps, user.id, tenantId);
  return createUserSession(deps, user.id, tenantId, client, false);
}

/**
 * Second step for a user with an enrolled authenticator, whatever the first factor was (password or Google, A03).
 * The token is single-use and short-lived; `signInUserMfa` completes it.
 */
export async function issueUserMfaChallenge(deps: Deps, userId: string, tenantId: string | null, invitationId?: string): Promise<SignInResult> {
  const mfaToken = newSecretToken();
  await deps.kv.set(keys.mfaToken(hash(deps, mfaToken)), JSON.stringify({ kind: 'user', userId, tenantId, invitationId: invitationId ?? null }), SESSION_TTL.mfaTokenMs / 1000);
  return { kind: 'mfa', mfaToken };
}

export async function signInUserMfa(deps: Deps, mfaToken: string, code: string, client: ClientInfo): Promise<SignInResult> {
  const k = keys.mfaToken(hash(deps, mfaToken));
  const raw = await deps.kv.get(k);
  if (!raw) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  const p = JSON.parse(raw) as { kind: string; userId: string; tenantId: string | null; invitationId?: string | null };
  if (p.kind !== 'user') throw new AppError('UNAUTHENTICATED');
  const user = await deps.db.platform().selectFrom('users').select(['totp_secret_enc', 'disabled_at']).where('id', '=', p.userId).executeTakeFirstOrThrow();
  if (user.disabled_at) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  await checkSecondFactor(deps, `u:${p.userId}`, user.totp_secret_enc ? await decrypt(deps.keys, user.totp_secret_enc) : null, code, client.ip, k);
  // Single use even under concurrent requests (L-2).
  if (!(await deps.kv.take(k))) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  // An invitation accepted by an account with an authenticator completes only now (H-4).
  if (p.invitationId && p.tenantId) await redeemInvitation(deps, p.invitationId, p.userId);
  return createUserSession(deps, p.userId, p.tenantId, client, true);
}

/** `mfa`: true when the second factor was just verified, or the time it was verified (carried by a handoff). */
/** `authenticatedAt`: when the user proved who they are; now for a sign-in, the original sign-in for a handoff. */
export async function createUserSession(deps: Deps, userId: string, tenantId: string | null, client: ClientInfo, mfa: boolean | Date, authenticatedAt?: Date): Promise<SignInResult> {
  const token = newSecretToken();
  const id = uuidv7();
  const now = deps.now();
  const mfaAt = mfa instanceof Date ? mfa : mfa ? now : null;
  await deps.db
    .platform()
    .insertInto('user_sessions')
    .values({
      id,
      user_id: userId,
      tenant_id: tenantId,
      host: client.host,
      token_hash: hash(deps, token),
      mfa_verified_at: mfaAt,
      authenticated_at: authenticatedAt ?? now,
      ip: client.ip,
      user_agent: client.userAgent.slice(0, 300),
      expires_at: new Date(now.getTime() + SESSION_TTL.userAbsoluteMs),
    })
    .execute();
  return { kind: 'session', token, sessionId: id, userId };
}

export interface UserSession {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  host: string;
  mfaVerified: boolean;
  mfaVerifiedAt: Date | null;
}

/** Resolves a session cookie; sessions are bound to the host that issued them (TR-TEN-13). */
export async function resolveUserSession(deps: Deps, token: string, host: string): Promise<UserSession | null> {
  const now = deps.now();
  const db = deps.db.platform();
  const s = await db
    .selectFrom('user_sessions')
    .innerJoin('users', 'users.id', 'user_sessions.user_id')
    .selectAll('user_sessions')
    .select(['users.disabled_at', 'users.mfa_enrolled_at'])
    .where('user_sessions.token_hash', '=', hash(deps, token))
    .where('user_sessions.revoked_at', 'is', null)
    .executeTakeFirst();
  if (!s || s.host !== host || s.disabled_at) return null;
  if (s.expires_at <= now || now.getTime() - s.last_seen_at.getTime() > SESSION_TTL.userIdleMs) return null;
  if (now.getTime() - s.last_seen_at.getTime() > 60_000) {
    await db.updateTable('user_sessions').set({ last_seen_at: now }).where('id', '=', s.id).execute();
  }
  // Assurance counts only for the authenticator enrolled now: proving an older or removed factor does not (M-16).
  const mfaAt = s.mfa_verified_at && s.mfa_enrolled_at && s.mfa_verified_at >= s.mfa_enrolled_at ? s.mfa_verified_at : null;
  return { sessionId: s.id, userId: s.user_id, tenantId: s.tenant_id, host: s.host, mfaVerified: mfaAt !== null, mfaVerifiedAt: mfaAt };
}

/**
 * Step-up (A04): an enrolled user whose session was opened without the second factor proves it in place, instead
 * of signing out. Failures count towards the sign-in lockout like any wrong code.
 */
export async function verifySessionMfa(deps: Deps, userId: string, sessionId: string, code: string, ip: string) {
  const u = await deps.db.platform().selectFrom('users').select('totp_secret_enc').where('id', '=', userId).executeTakeFirstOrThrow();
  if (!u.totp_secret_enc) throw new AppError('NOT_FOUND', 'No authenticator is set up');
  try {
    await checkSecondFactor(deps, `u:${userId}`, await decrypt(deps.keys, u.totp_secret_enc), code, ip);
  } catch (e) {
    // A session that used up the account's code budget is signed out (M-2 for tenant step-up).
    if (isLockedOut(e)) await revokeSession(deps, sessionId);
    throw e;
  }
  await deps.db.platform().updateTable('user_sessions').set({ mfa_verified_at: deps.now() }).where('id', '=', sessionId).where('user_id', '=', userId).execute();
}

export async function revokeSession(deps: Deps, sessionId: string) {
  await deps.db.platform().updateTable('user_sessions').set({ revoked_at: deps.now() }).where('id', '=', sessionId).execute();
  await revalidateUserSockets(deps, { sessionId });
}

/** TR-AUTH-07: password reset, email/MFA/role change and ownership transfer revoke the user's other sessions. */
export async function revokeOtherSessions(deps: Deps, userId: string, keepSessionId?: string) {
  let q = deps.db.platform().updateTable('user_sessions').set({ revoked_at: deps.now() }).where('user_id', '=', userId).where('revoked_at', 'is', null);
  if (keepSessionId) q = q.where('id', '!=', keepSessionId);
  await q.execute();
  await revalidateUserSockets(deps, { userId });
}

/**
 * Tells every realtime instance to re-check the board sockets of a user or session now (H-7): after sign-out,
 * revocation, membership, role or second-factor changes. Instances also re-check every minute, so a lost
 * message only delays the cut-off.
 */
export async function revalidateUserSockets(deps: Deps, ref: { userId?: string; sessionId?: string; supportSessionId?: string }) {
  const event: BusEvent = { outboxId: 0, topic: 'user.revalidate', tenantId: null, payload: ref };
  await deps.kv.publish(EVENTS_CHANNEL, JSON.stringify(event)).catch((err: unknown) => deps.log.warn({ err }, 'socket revalidation publish failed'));
}

/**
 * The single board-access rule for a signed-in owner or manager, used by the realtime handshake and its periodic
 * re-check (M-10, H-7) with the same conditions as the HTTP staff API: a live session on this host, an active
 * membership, the tenant's staff access, the venue, and two-factor assurance when the tenant has several venues.
 */
export async function resolveBoardUser(deps: Deps, sessionToken: string, host: string, venueId: string): Promise<{ userId: string; sessionId: string; tenantId: string; venueId: string } | null> {
  const s = await resolveUserSession(deps, sessionToken, host);
  if (!s?.tenantId || !(await membershipFor(deps, s.userId, s.tenantId))) return null;
  const tenant = await deps.db.platform().selectFrom('tenants').select('status').where('id', '=', s.tenantId).executeTakeFirst();
  if (!tenant || tenantAccess(tenant.status as TenantStatus).staff === 'off') return null;
  const v = await deps.db.forTenant(s.tenantId).selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst();
  if (!v) return null;
  if (!s.mfaVerified && (await activeVenueCount(deps, s.tenantId)) > 1) return null;
  return { userId: s.userId, sessionId: s.sessionId, tenantId: s.tenantId, venueId: v.id };
}

const activeVenueCount = async (deps: Deps, tenantId: string) =>
  Number((await deps.db.forTenant(tenantId).selectFrom('venues').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').executeTakeFirstOrThrow()).n);

export async function membershipFor(deps: Deps, userId: string, tenantId: string): Promise<{ id: string; role: MemberRole } | null> {
  const m = await deps.db.platform().selectFrom('tenant_memberships').select(['id', 'role']).where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('status', '=', 'active').executeTakeFirst();
  return m ?? null;
}

export async function me(deps: Deps, userId: string, tenantId: string | null, sessionId: string) {
  const db = deps.db.platform();
  const user = await db.selectFrom('users').select(['id', 'email', 'name', 'locale', 'email_verified_at', 'mfa_enrolled_at']).where('id', '=', userId).executeTakeFirstOrThrow();
  const memberships = await db
    .selectFrom('tenant_memberships')
    .innerJoin('tenants', 'tenants.id', 'tenant_memberships.tenant_id')
    .select(['tenants.id', 'tenants.slug', 'tenants.name', 'tenants.status', 'tenant_memberships.role', 'tenant_memberships.weekly_summary'])
    .where('tenant_memberships.user_id', '=', userId)
    .where('tenant_memberships.status', '=', 'active')
    .where('tenants.status', '!=', 'deleted')
    .execute();
  const pending = await db.selectFrom('email_tokens').select('new_email').where('user_id', '=', userId).where('purpose', '=', 'change_email').where('used_at', 'is', null).where('expires_at', '>', deps.now()).orderBy('created_at', 'desc').executeTakeFirst();
  const current = memberships.find((m) => m.id === tenantId);
  return {
    user: { id: user.id, email: user.email, name: user.name, locale: user.locale, emailVerified: user.email_verified_at !== null, mfaEnrolled: user.mfa_enrolled_at !== null, pendingEmail: pending?.new_email ?? null },
    preferences: current ? { weeklySummary: Boolean(current.weekly_summary) } : null,
    memberships: memberships.map((m) => ({ tenantId: m.id, slug: m.slug, name: m.name, status: m.status, role: m.role })),
    currentTenantId: tenantId,
    currentRole: memberships.find((m) => m.id === tenantId)?.role ?? null,
    csrfToken: csrfFor(deps, sessionId),
  };
}

// ---- email tokens
async function issueEmailToken(deps: Deps, userId: string, purpose: 'verify_email' | 'reset_password' | 'change_email', ttlMs: number, newEmail: string | null = null) {
  const token = newSecretToken();
  await deps.db
    .platform()
    .insertInto('email_tokens')
    .values({ id: uuidv7(), user_id: userId, purpose, token_hash: hash(deps, token), new_email: newEmail, expires_at: new Date(deps.now().getTime() + ttlMs) })
    .execute();
  return token;
}

/**
 * Email change (W05, FR-ADM-18): the current password confirms the request; a link valid 24 hours goes to the new
 * address, and only that link changes the sign-in email. The old address is told about the request.
 */
export async function requestEmailChange(deps: Deps, actor: { userId: string; tenantId?: string | null }, newEmail: string, password: string) {
  await verifyUserPassword(deps, actor.userId, password);
  const db = deps.db.platform();
  const email = newEmail.trim().toLowerCase();
  const u = await db.selectFrom('users').select(['email', 'name', 'locale']).where('id', '=', actor.userId).executeTakeFirstOrThrow();
  if (u.email === email) throw new AppError('VALIDATION_FAILED', 'This is already your email', { errors: [{ path: 'newEmail', message: 'same' }] });
  if (await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()) throw new AppError('EMAIL_TAKEN', 'An account with this email exists', { errors: [{ path: 'newEmail', message: 'taken' }] });
  // Only the latest request is valid.
  await db.updateTable('email_tokens').set({ used_at: deps.now() }).where('user_id', '=', actor.userId).where('purpose', '=', 'change_email').where('used_at', 'is', null).execute();
  const token = await issueEmailToken(deps, actor.userId, 'change_email', SESSION_TTL.verifyEmailMs, email);
  await writeAudit(db, { actor: { kind: 'user', userId: actor.userId, tenantId: actor.tenantId ?? '', role: 'owner', sessionId: '', mfaVerified: false }, action: 'account.email_change_requested', tenantId: actor.tenantId ?? null, entityType: 'user', entityId: actor.userId, after: { email } });
  await sendEmail(deps, { template: 'email_change', to: email, locale: u.locale, data: { name: u.name, link: urls(deps.config).www(`/confirm-email?token=${token}`) } });
  await sendEmail(deps, { template: 'email_changed', to: u.email, locale: u.locale, data: { name: u.name, newEmail: email, requested: true }, key: `email-change-requested:${actor.userId}:${email}` });
  return { pendingEmail: email };
}

/** Completes an email change from the link; other sessions are signed out. */
export async function confirmEmailChange(deps: Deps, token: string) {
  const row = await useEmailToken(deps, token, 'change_email');
  const db = deps.db.platform();
  const email = row.new_email!;
  const u = await db.selectFrom('users').select(['email', 'name', 'locale']).where('id', '=', row.user_id).executeTakeFirstOrThrow();
  try {
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('users').set({ email, email_verified_at: deps.now() }).where('id', '=', row.user_id).execute();
      await writeAudit(tx, { actor: { kind: 'user', userId: row.user_id, tenantId: '', role: 'owner', sessionId: '', mfaVerified: false }, action: 'account.email_changed', tenantId: null, entityType: 'user', entityId: row.user_id, before: { email: u.email }, after: { email } });
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError('EMAIL_TAKEN', 'An account with this email exists');
    throw e;
  }
  await revokeOtherSessions(deps, row.user_id);
  await sendEmail(deps, { template: 'email_changed', to: u.email, locale: u.locale, data: { name: u.name, newEmail: email, requested: false }, key: `email-changed:${row.user_id}:${email}` });
  return { email };
}

/** The signed-in member's preferences in the current tenant (W06, FR-RPT-05). */
export async function setMemberPreferences(deps: Deps, actor: { userId: string; tenantId: string; role: string; sessionId: string; mfaVerified: boolean }, b: { weeklySummary: boolean }) {
  const db = deps.db.platform();
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('tenant_memberships').set({ weekly_summary: b.weeklySummary }).where('tenant_id', '=', actor.tenantId).where('user_id', '=', actor.userId).where('status', '=', 'active').executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
    await writeAudit(tx, { actor: { kind: 'user', ...actor, role: actor.role as 'owner' }, action: 'member.preferences_changed', tenantId: actor.tenantId, entityType: 'member', entityId: actor.userId, after: b });
  });
}

export async function sendVerifyEmail(deps: Deps, userId: string, tenantSlug: string | null) {
  const u = await deps.db.platform().selectFrom('users').select(['email', 'locale', 'name']).where('id', '=', userId).executeTakeFirstOrThrow();
  const token = await issueEmailToken(deps, userId, 'verify_email', SESSION_TTL.verifyEmailMs);
  await sendEmail(deps, { template: 'verify_email', to: u.email, locale: u.locale, data: { name: u.name, link: urls(deps.config).www(`/verify-email?token=${token}`), tenantSlug } });
}

async function useEmailToken(deps: Deps, token: string, purpose: 'verify_email' | 'reset_password' | 'change_email') {
  const db = deps.db.platform();
  const row = await db.selectFrom('email_tokens').selectAll().where('token_hash', '=', hash(deps, token)).where('purpose', '=', purpose).executeTakeFirst();
  if (!row || row.used_at || row.expires_at <= deps.now()) throw new AppError('INVITATION_EXPIRED', 'This link has expired');
  // Conditional update: of two concurrent uses only one changes the row (L-2).
  const r = await db.updateTable('email_tokens').set({ used_at: deps.now() }).where('id', '=', row.id).where('used_at', 'is', null).executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new AppError('INVITATION_EXPIRED', 'This link has expired');
  return row;
}

export async function verifyEmail(deps: Deps, token: string) {
  const row = await useEmailToken(deps, token, 'verify_email');
  const db = deps.db.platform();
  await db.updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', row.user_id).where('email_verified_at', 'is', null).execute();
  const u = await db.selectFrom('users').select(['email', 'locale', 'name']).where('id', '=', row.user_id).executeTakeFirstOrThrow();
  await sendEmail(deps, { template: 'welcome', to: u.email, locale: u.locale, data: { name: u.name }, key: `welcome:${row.user_id}` });
}

/** Always succeeds from the caller's view (no account enumeration). */
export async function forgotPassword(deps: Deps, email: string) {
  const u = await deps.db.platform().selectFrom('users').select(['id', 'locale', 'name']).where('email', '=', email).where('disabled_at', 'is', null).executeTakeFirst();
  if (!u) return;
  const token = await issueEmailToken(deps, u.id, 'reset_password', SESSION_TTL.resetPasswordMs);
  await sendEmail(deps, { template: 'password_reset', to: email, locale: u.locale, data: { name: u.name, link: urls(deps.config).www(`/reset-password?token=${token}`) } });
}

/**
 * Password reset (FR-ADM-18, AS03). The new password is checked before the link is touched, so a rejected choice
 * can be corrected with the same link; on success the link is consumed and the password changed in one transaction
 * (single use under concurrency, L-2), then every session is signed out.
 */
export async function resetPassword(deps: Deps, token: string, password: string) {
  const db = deps.db.platform();
  const expired = () => new AppError('INVITATION_EXPIRED', 'This link has expired');
  const row = await db.selectFrom('email_tokens').innerJoin('users', 'users.id', 'email_tokens.user_id').select(['email_tokens.id', 'email_tokens.user_id', 'email_tokens.used_at', 'email_tokens.expires_at', 'users.email']).where('email_tokens.token_hash', '=', hash(deps, token)).where('email_tokens.purpose', '=', 'reset_password').executeTakeFirst();
  if (!row || row.used_at || row.expires_at <= deps.now()) throw expired();
  const problem = checkPassword(password, [row.email]);
  if (problem) throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
  const passwordHash = await hashSecret(password);
  await db.transaction().execute(async (tx) => {
    const r = await tx.updateTable('email_tokens').set({ used_at: deps.now() }).where('id', '=', row.id).where('used_at', 'is', null).where('expires_at', '>', deps.now()).executeTakeFirst();
    if (Number(r.numUpdatedRows) !== 1) throw expired();
    await tx.updateTable('users').set({ password_hash: passwordHash }).where('id', '=', row.user_id).execute();
  });
  await revokeOtherSessions(deps, row.user_id);
}

export async function changePassword(deps: Deps, userId: string, sessionId: string, current: string, next: string) {
  const db = deps.db.platform();
  const u = await db.selectFrom('users').select(['password_hash', 'email']).where('id', '=', userId).executeTakeFirstOrThrow();
  if (!u.password_hash || !(await verifySecret(u.password_hash, current))) throw new AppError('UNAUTHENTICATED', 'Current password is incorrect');
  const problem = checkPassword(next, [u.email]);
  if (problem) throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'newPassword', message: problem }] });
  await db.updateTable('users').set({ password_hash: await hashSecret(next) }).where('id', '=', userId).execute();
  await revokeOtherSessions(deps, userId, sessionId);
}

/** Wrong password re-entries per account in 15 minutes (slug change, deletion, ownership transfer, email change). */
const PASSWORD_RECHECK_FAILURES = 10;

/**
 * Password re-entry by a signed-in user. Each try takes a place in a per-account budget before the hash is checked,
 * and only a correct password gives it back, so a stolen session cannot guess the password (nor tie up the server
 * with hashing) faster than 10 tries per 15 minutes, even with parallel requests.
 */
export async function verifyUserPassword(deps: Deps, userId: string, password: string): Promise<void> {
  const key = `pwcheck:${userId}`;
  if ((await deps.kv.incr(key, 15 * 60)) > PASSWORD_RECHECK_FAILURES) throw LOCKED();
  const u = await deps.db.platform().selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirstOrThrow();
  if (!u.password_hash || !(await verifySecret(u.password_hash, password))) throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
  await deps.kv.incrBy(key, -1);
}

// ---- TOTP for tenant users (optional in MVP, TR-AUTH-11)
/** A session that changes the second factor re-proves the account first (H-5). */
const REAUTH_FRESH_MS = 15 * 60_000;

async function reauthenticate(deps: Deps, userId: string, sessionId: string, proof: { password?: string; currentCode?: string }, ip: string) {
  const db = deps.db.platform();
  const u = await db.selectFrom('users').select(['password_hash', 'totp_secret_enc']).where('id', '=', userId).executeTakeFirstOrThrow();
  if (u.password_hash) {
    await checkThrottle(deps, `reauth:${userId}`, ip);
    if (!proof.password || !(await verifySecret(u.password_hash, proof.password))) {
      await recordFailure(deps, `reauth:${userId}`, ip);
      throw new AppError('UNAUTHENTICATED', 'Password is incorrect', { errors: [{ path: 'password', message: 'incorrect' }] });
    }
  } else {
    // Google-only account: no password to re-check, so the sign-in itself must be recent.
    // The time of the sign-in itself: a session opened by a handoff carries the www sign-in's time, not its own.
    const s = await db.selectFrom('user_sessions').select(['created_at', 'authenticated_at']).where('id', '=', sessionId).executeTakeFirstOrThrow();
    if (deps.now().getTime() - (s.authenticated_at ?? s.created_at).getTime() > REAUTH_FRESH_MS) throw new AppError('FORBIDDEN', 'Sign in again to change two-factor settings');
  }
  // Replacing a factor needs the factor being replaced; a code from the new one never authorises that.
  if (u.totp_secret_enc) await checkSecondFactor(deps, `u:${userId}`, await decrypt(deps.keys, u.totp_secret_enc), proof.currentCode ?? '', ip);
}

/** True when the user owns or manages a tenant that makes two-factor sign-in mandatory (TR-AUTH-11). */
async function mfaMandatoryForUser(deps: Deps, userId: string): Promise<boolean> {
  const rows = await deps.db.platform().selectFrom('tenant_memberships').select('tenant_id').where('user_id', '=', userId).where('status', '=', 'active').execute();
  for (const r of rows) if ((await activeVenueCount(deps, r.tenant_id)) > 1) return true;
  return false;
}

async function notifyMfaChange(deps: Deps, userId: string, removed: boolean) {
  const u = await deps.db.platform().selectFrom('users').select(['email', 'name', 'locale']).where('id', '=', userId).executeTakeFirstOrThrow();
  await sendEmail(deps, { template: 'mfa_changed', to: u.email, locale: u.locale, data: { name: u.name, removed }, key: `mfa-changed:${userId}:${deps.now().getTime()}` });
}

export async function enrollTotp(deps: Deps, userId: string, sessionId: string, proof: { password?: string; currentCode?: string }, ip: string) {
  await reauthenticate(deps, userId, sessionId, proof, ip);
  const u = await deps.db.platform().selectFrom('users').select(['email']).where('id', '=', userId).executeTakeFirstOrThrow();
  const secret = newTotpSecret();
  // Bound to the session that re-authenticated; another session cannot confirm it.
  await deps.kv.set(`totp:pending:${userId}`, JSON.stringify({ secret, sessionId }), 600);
  return { secret, uri: totpUri(secret, u.email, 'Tanbeeh') };
}

export async function confirmTotp(deps: Deps, userId: string, sessionId: string, code: string, ip: string) {
  const k = `totp:pending:${userId}`;
  const raw = await deps.kv.get(k);
  const pending = raw?.startsWith('{') ? (JSON.parse(raw) as { secret: string; sessionId: string }) : null;
  const incorrect = () => new AppError('VALIDATION_FAILED', 'Code is incorrect', { errors: [{ path: 'code', message: 'incorrect' }] });
  if (!pending || pending.sessionId !== sessionId) throw incorrect();
  try {
    await checkSecondFactor(deps, `u:${userId}`, pending.secret, code, ip);
  } catch (e) {
    if (e instanceof AppError && e.code === 'UNAUTHENTICATED') throw incorrect();
    throw e;
  }
  if (!(await deps.kv.take(k))) throw incorrect();
  const db = deps.db.platform();
  const before = await db.selectFrom('users').select('totp_secret_enc').where('id', '=', userId).executeTakeFirstOrThrow();
  const enrolledAt = deps.now();
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('users').set({ totp_secret_enc: await encrypt(deps.keys, pending.secret), mfa_enrolled_at: enrolledAt }).where('id', '=', userId).execute();
    // The current session has just proved the new factor (mandatory two-factor for multi-venue tenants).
    await tx.updateTable('user_sessions').set({ mfa_verified_at: enrolledAt }).where('id', '=', sessionId).execute();
    await writeAudit(tx, { actor: { kind: 'user', userId, tenantId: '', role: 'owner', sessionId, mfaVerified: true }, action: before.totp_secret_enc ? 'account.mfa_replaced' : 'account.mfa_enrolled', tenantId: null, entityType: 'user', entityId: userId });
  });
  await revokeOtherSessions(deps, userId, sessionId);
  await notifyMfaChange(deps, userId, false);
}

/**
 * Turning two-factor off (H-5, M-16): needs a code from the current authenticator, is refused while a tenant the
 * user owns or manages requires it, and leaves no session — including this one — with second-factor assurance.
 */
export async function removeTotp(deps: Deps, userId: string, sessionId: string, code: string, ip: string) {
  const db = deps.db.platform();
  const u = await db.selectFrom('users').select('totp_secret_enc').where('id', '=', userId).executeTakeFirstOrThrow();
  if (!u.totp_secret_enc) throw new AppError('NOT_FOUND', 'No authenticator is set up');
  if (await mfaMandatoryForUser(deps, userId)) throw new AppError('FORBIDDEN', 'Two-factor sign-in is required while you manage several venues');
  await checkSecondFactor(deps, `u:${userId}`, await decrypt(deps.keys, u.totp_secret_enc), code, ip);
  await db.transaction().execute(async (tx) => {
    await tx.updateTable('users').set({ totp_secret_enc: null, mfa_enrolled_at: null }).where('id', '=', userId).execute();
    await tx.updateTable('user_sessions').set({ mfa_verified_at: null }).where('id', '=', sessionId).execute();
    await writeAudit(tx, { actor: { kind: 'user', userId, tenantId: '', role: 'owner', sessionId, mfaVerified: true }, action: 'account.mfa_removed', tenantId: null, entityType: 'user', entityId: userId });
  });
  await revokeOtherSessions(deps, userId, sessionId);
  await notifyMfaChange(deps, userId, true);
}

// ---- host handoff (TR-AUTH-06): www → tenant host
/**
 * `mfaVerifiedAt` is the www session's verified second factor; the tenant session keeps it, so a user who
 * completed TOTP on www is not asked again on the tenant host (A04, TR-AUTH-06, TR-AUTH-11).
 */
export async function createHandoff(deps: Deps, userId: string, tenantSlug: string, userAgent: string, mfaVerifiedAt: Date | null = null, fromSessionId?: string) {
  const db = deps.db.platform();
  // The www sign-in's time travels with the handoff, so the new tenant session is never "freshly signed in" (H-5).
  const from = fromSessionId ? await db.selectFrom('user_sessions').select(['created_at', 'authenticated_at']).where('id', '=', fromSessionId).executeTakeFirst() : undefined;
  const authAt = from ? (from.authenticated_at ?? from.created_at) : null;
  const t = await db
    .selectFrom('tenants')
    .innerJoin('tenant_memberships', 'tenant_memberships.tenant_id', 'tenants.id')
    .select(['tenants.id'])
    .where('tenants.slug', '=', tenantSlug)
    .where('tenant_memberships.user_id', '=', userId)
    .where('tenant_memberships.status', '=', 'active')
    .where('tenants.status', '!=', 'deleted')
    .executeTakeFirst();
  if (!t) throw new AppError('NOT_FOUND');
  const code = newSecretToken();
  const host = `${tenantSlug}.${deps.config.domain}`;
  await deps.kv.set(keys.handoff(hash(deps, code)), JSON.stringify({ userId, tenantId: t.id, host, ua: userAgent, mfaAt: mfaVerifiedAt?.toISOString() ?? null, authAt: authAt?.toISOString() ?? null }), SESSION_TTL.handoffMs / 1000);
  return { code, url: `${urls(deps.config).admin(tenantSlug, `/handoff?code=${code}`)}` };
}

export async function exchangeHandoff(deps: Deps, code: string, client: ClientInfo, tenantId: string): Promise<SignInResult> {
  const raw = await deps.kv.take(keys.handoff(hash(deps, code))); // single use, atomically (L-2)
  if (!raw) throw new AppError('UNAUTHENTICATED', 'Link expired');
  const p = JSON.parse(raw) as { userId: string; tenantId: string; host: string; ua: string; mfaAt?: string | null; authAt?: string | null };
  if (p.host !== client.host || p.tenantId !== tenantId || p.ua !== client.userAgent) throw new AppError('UNAUTHENTICATED', 'Link expired');
  // Assurance is carried only while the account still has its authenticator (removing it revokes sessions).
  const user = await deps.db.platform().selectFrom('users').select(['totp_secret_enc', 'disabled_at']).where('id', '=', p.userId).executeTakeFirst();
  if (!user || user.disabled_at) throw new AppError('UNAUTHENTICATED', 'Link expired');
  const mfaAt = p.mfaAt && user.totp_secret_enc ? new Date(p.mfaAt) : false;
  // Without a recorded sign-in time the session counts as signed in long ago, never as fresh.
  return createUserSession(deps, p.userId, tenantId, client, mfaAt, p.authAt ? new Date(p.authAt) : new Date(0));
}

// ---- invitations
export async function inviteMember(deps: Deps, actor: Actor & { kind: 'user' | 'platform' }, tenantId: string, email: string, role: MemberRole) {
  const db = deps.db.platform();
  const tenant = await db.selectFrom('tenants').select(['name', 'slug', 'default_locale']).where('id', '=', tenantId).executeTakeFirstOrThrow();
  const existing = await db
    .selectFrom('tenant_memberships')
    .innerJoin('users', 'users.id', 'tenant_memberships.user_id')
    .select('tenant_memberships.id')
    .where('tenant_memberships.tenant_id', '=', tenantId)
    .where('users.email', '=', email)
    .where('tenant_memberships.status', '=', 'active')
    .executeTakeFirst();
  if (existing) throw new AppError('EMAIL_TAKEN', 'Already a member');
  const token = newSecretToken();
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('invitations')
      .set({ revoked_at: deps.now() })
      .where('tenant_id', '=', tenantId)
      .where('email', '=', email)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
    await tx
      .insertInto('invitations')
      .values({
        id,
        tenant_id: tenantId,
        email,
        role,
        token_hash: hash(deps, token),
        invited_by_type: actor.kind === 'user' ? 'user' : 'platform_user',
        invited_by: actor.kind === 'user' ? actor.userId : actor.platformUserId,
        expires_at: new Date(deps.now().getTime() + SESSION_TTL.invitationMs),
      })
      .execute();
    await writeAudit(tx, { actor, action: 'member.invited', tenantId, entityType: 'invitation', entityId: id, after: { email, role } });
  });
  await sendEmail(deps, {
    template: role === 'owner' ? 'invitation_owner' : 'invitation_manager',
    to: email,
    locale: tenant.default_locale,
    tenantId,
    data: { tenantName: tenant.name, link: urls(deps.config).admin(tenant.slug, `/invitation?token=${token}`) },
  });
  return { id };
}

export async function invitationDetails(deps: Deps, token: string) {
  const inv = await deps.db
    .platform()
    .selectFrom('invitations')
    .innerJoin('tenants', 'tenants.id', 'invitations.tenant_id')
    .select(['invitations.id', 'invitations.email', 'invitations.role', 'invitations.expires_at', 'invitations.accepted_at', 'invitations.revoked_at', 'tenants.name', 'tenants.slug', 'tenants.id as tenantId'])
    .where('invitations.token_hash', '=', hash(deps, token))
    .executeTakeFirst();
  if (!inv || inv.accepted_at || inv.revoked_at || inv.expires_at <= deps.now()) throw new AppError('INVITATION_EXPIRED');
  const userExists = Boolean(await deps.db.platform().selectFrom('users').select('id').where('email', '=', inv.email).executeTakeFirst());
  return { ...inv, userExists };
}

/**
 * Marks the invitation accepted and grants the membership in one transaction. The conditional update makes the
 * invitation single-use under concurrent requests (L-2); a used, revoked or expired one fails.
 */
async function redeemInvitation(deps: Deps, invitationId: string, userId: string) {
  await deps.db.platform().transaction().execute(async (tx) => {
    const now = deps.now();
    const inv = await tx.selectFrom('invitations').select(['tenant_id', 'role', 'email']).where('id', '=', invitationId).executeTakeFirst();
    const r = await tx.updateTable('invitations').set({ accepted_at: now }).where('id', '=', invitationId).where('accepted_at', 'is', null).where('revoked_at', 'is', null).where('expires_at', '>', now).executeTakeFirst();
    if (!inv || Number(r.numUpdatedRows) !== 1) throw new AppError('INVITATION_EXPIRED');
    const m = await tx.selectFrom('tenant_memberships').select(['id']).where('tenant_id', '=', inv.tenant_id).where('user_id', '=', userId).executeTakeFirst();
    if (m) await tx.updateTable('tenant_memberships').set({ status: 'active', role: inv.role }).where('id', '=', m.id).execute();
    else await tx.insertInto('tenant_memberships').values({ id: uuidv7(), tenant_id: inv.tenant_id, user_id: userId, role: inv.role }).execute();
  });
}

/**
 * Accepting an invitation is a sign-in (H-4): an existing account proves its password under the sign-in
 * throttle, a disabled account is refused, and an account with an authenticator gets the MFA challenge — the
 * invitation completes only when the code is right (`signInUserMfa`). New accounts are created verified.
 */
export async function acceptInvitation(deps: Deps, token: string, b: { name?: string; password?: string }, client: ClientInfo): Promise<SignInResult & { tenantSlug: string }> {
  const inv = await invitationDetails(deps, token);
  const db = deps.db.platform();
  const existing = await db.selectFrom('users').select(['id', 'password_hash', 'totp_secret_enc', 'disabled_at']).where('email', '=', inv.email).executeTakeFirst();
  let userId: string;
  if (existing) {
    await checkThrottle(deps, inv.email, client.ip, () => familiarAddress(deps, 'user', inv.email, client.ip));
    // Existing account: the password proves it is theirs.
    if (existing.disabled_at || !b.password || !existing.password_hash || !(await verifySecret(existing.password_hash, b.password))) {
      await recordFailure(deps, inv.email, client.ip);
      throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
    }
    if (existing.totp_secret_enc) return { ...(await issueUserMfaChallenge(deps, existing.id, inv.tenantId, inv.id)), tenantSlug: inv.slug };
    userId = existing.id;
  } else {
    if (!b.name || !b.password) throw new AppError('VALIDATION_FAILED', 'Name and password are required');
    const problem = checkPassword(b.password, [inv.email]);
    if (problem) throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
    userId = uuidv7();
    // Accepting an emailed invitation proves the address.
    await db.insertInto('users').values({ id: userId, email: inv.email, name: b.name, password_hash: await hashSecret(b.password), email_verified_at: deps.now() }).execute();
  }
  await redeemInvitation(deps, inv.id, userId);
  const s = await createUserSession(deps, userId, inv.tenantId, client, false);
  return { ...s, tenantSlug: inv.slug };
}

// ---------------------------------------------------------------- platform users (mandatory MFA)

export interface PlatformSession {
  sessionId: string;
  platformUserId: string;
  role: PlatformRole;
  name: string;
  mfaVerifiedAt: Date | null;
}

export async function signInPlatform(deps: Deps, email: string, password: string, client: ClientInfo): Promise<SignInResult> {
  await checkThrottle(deps, `p:${email}`, client.ip, () => familiarAddress(deps, 'platform', email, client.ip));
  const db = deps.db.platform();
  const u = await db.selectFrom('platform_users').selectAll().where('email', '=', email).where('status', '=', 'active').executeTakeFirst();
  if (!u?.password_hash || !(await verifySecret(u.password_hash, password))) {
    if (!u?.password_hash) await dummyVerify(password);
    await recordFailure(deps, `p:${email}`, client.ip);
    throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect');
  }
  const mfaToken = newSecretToken();
  await deps.kv.set(keys.mfaToken(hash(deps, mfaToken)), JSON.stringify({ kind: 'platform', platformUserId: u.id }), SESSION_TTL.mfaTokenMs / 1000);
  // No second factor yet: the user must enrol before any session exists (FR-SA-02).
  return u.totp_secret_enc ? { kind: 'mfa', mfaToken } : { kind: 'enroll_mfa', mfaToken };
}

export async function platformEnrollStart(deps: Deps, mfaToken: string) {
  const raw = await deps.kv.get(keys.mfaToken(hash(deps, mfaToken)));
  if (!raw) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  const p = JSON.parse(raw) as { platformUserId: string };
  const u = await deps.db.platform().selectFrom('platform_users').select(['email', 'totp_secret_enc']).where('id', '=', p.platformUserId).executeTakeFirstOrThrow();
  if (u.totp_secret_enc) throw new AppError('FORBIDDEN', 'Already enrolled');
  const secret = newTotpSecret();
  await deps.kv.set(`totp:pending:p:${p.platformUserId}`, secret, 600);
  return { secret, uri: totpUri(secret, u.email, 'Tanbeeh Console') };
}

export async function signInPlatformMfa(deps: Deps, mfaToken: string, code: string, client: ClientInfo): Promise<SignInResult> {
  const k = keys.mfaToken(hash(deps, mfaToken));
  const raw = await deps.kv.get(k);
  if (!raw) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  const p = JSON.parse(raw) as { kind: string; platformUserId: string };
  if (p.kind !== 'platform') throw new AppError('UNAUTHENTICATED');
  const db = deps.db.platform();
  const u = await db.selectFrom('platform_users').select(['id', 'totp_secret_enc', 'status']).where('id', '=', p.platformUserId).executeTakeFirstOrThrow();
  if (u.status !== 'active') throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  let secret: string | null = u.totp_secret_enc ? await decrypt(deps.keys, u.totp_secret_enc) : await deps.kv.get(`totp:pending:p:${u.id}`);
  await checkSecondFactor(deps, `p:${u.id}`, secret, code, client.ip, k);
  // Single use even under concurrent requests (L-2).
  if (!(await deps.kv.take(k))) throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
  if (!u.totp_secret_enc) {
    await db.updateTable('platform_users').set({ totp_secret_enc: await encrypt(deps.keys, secret!), mfa_enrolled_at: deps.now() }).where('id', '=', u.id).execute();
    await deps.kv.del(`totp:pending:p:${u.id}`);
  }
  secret = null;
  const token = newSecretToken();
  const id = uuidv7();
  const now = deps.now();
  await db
    .insertInto('platform_sessions')
    .values({ id, platform_user_id: u.id, token_hash: hash(deps, token), mfa_verified_at: now, ip: client.ip, user_agent: client.userAgent.slice(0, 300), expires_at: new Date(now.getTime() + SESSION_TTL.platformAbsoluteMs) })
    .execute();
  await db.updateTable('platform_users').set({ last_sign_in_at: now }).where('id', '=', u.id).execute();
  return { kind: 'session', token, sessionId: id, userId: u.id };
}

/**
 * Re-check MFA inside a session for destructive actions (TR-FE-23). Shares the account's code budget with
 * sign-in; the session that uses it up is revoked (M-2).
 */
export async function refreshPlatformMfa(deps: Deps, sessionId: string, platformUserId: string, code: string, ip: string) {
  const db = deps.db.platform();
  const u = await db.selectFrom('platform_users').select(['totp_secret_enc']).where('id', '=', platformUserId).executeTakeFirstOrThrow();
  try {
    await checkSecondFactor(deps, `p:${platformUserId}`, u.totp_secret_enc ? await decrypt(deps.keys, u.totp_secret_enc) : null, code, ip);
  } catch (e) {
    if (isLockedOut(e)) {
      await revokePlatformSession(deps, sessionId);
      deps.log.warn({ security: true, event: 'MFA_REFRESH_LOCKED', platformUserId }, 'fresh-MFA budget used up; session revoked');
    }
    throw e;
  }
  await db.updateTable('platform_sessions').set({ mfa_verified_at: deps.now() }).where('id', '=', sessionId).execute();
}

export async function resolvePlatformSession(deps: Deps, token: string): Promise<PlatformSession | null> {
  const now = deps.now();
  const db = deps.db.platform();
  const s = await db
    .selectFrom('platform_sessions')
    .innerJoin('platform_users', 'platform_users.id', 'platform_sessions.platform_user_id')
    .select(['platform_sessions.id', 'platform_sessions.platform_user_id', 'platform_sessions.mfa_verified_at', 'platform_sessions.last_seen_at', 'platform_sessions.expires_at', 'platform_users.role', 'platform_users.name', 'platform_users.status'])
    .where('platform_sessions.token_hash', '=', hash(deps, token))
    .where('platform_sessions.revoked_at', 'is', null)
    .executeTakeFirst();
  if (!s || s.status !== 'active' || !s.mfa_verified_at) return null;
  if (s.expires_at <= now || now.getTime() - s.last_seen_at.getTime() > SESSION_TTL.platformIdleMs) return null;
  await db.updateTable('platform_sessions').set({ last_seen_at: now }).where('id', '=', s.id).execute();
  return { sessionId: s.id, platformUserId: s.platform_user_id, role: s.role, name: s.name, mfaVerifiedAt: s.mfa_verified_at };
}

export async function revokePlatformSession(deps: Deps, sessionId: string) {
  await deps.db.platform().updateTable('platform_sessions').set({ revoked_at: deps.now() }).where('id', '=', sessionId).execute();
}

/** Platform user invitation: a 7-day token kept in the KV store; accepting sets the password. */
export async function invitePlatformUser(deps: Deps, actor: Actor & { kind: 'platform' }, email: string, name: string, role: PlatformRole) {
  const db = deps.db.platform();
  if (await db.selectFrom('platform_users').select('id').where('email', '=', email).executeTakeFirst()) throw new AppError('EMAIL_TAKEN');
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    await tx.insertInto('platform_users').values({ id, email, name, role }).execute();
    await writeAudit(tx, { actor, action: 'platform_user.invited', tenantId: null, entityType: 'platform_user', entityId: id, after: { email, role }, visibleToTenant: false });
  });
  await issuePlatformInvitation(deps, id, email, name);
  return { id };
}

/** Single-use set-password link for an `invited` platform user: a new invitation or after an MFA reset. */
export async function issuePlatformInvitation(deps: Deps, id: string, email: string, name: string) {
  const token = newSecretToken();
  await deps.kv.set(`pinvite:${hash(deps, token)}`, id, SESSION_TTL.invitationMs / 1000);
  await sendEmail(deps, { template: 'platform_user_invitation', to: email, locale: 'en', data: { name, link: urls(deps.config).console(`/accept?token=${token}`) } });
}

export async function acceptPlatformInvitation(deps: Deps, token: string, password: string) {
  const k = `pinvite:${hash(deps, token)}`;
  if (!(await deps.kv.exists(k))) throw new AppError('INVITATION_EXPIRED');
  const problem = checkPassword(password);
  if (problem) throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
  const id = await deps.kv.take(k); // single use, atomically (L-2)
  if (!id) throw new AppError('INVITATION_EXPIRED');
  const r = await deps.db.platform().updateTable('platform_users').set({ password_hash: await hashSecret(password), status: 'active' }).where('id', '=', id).where('status', '=', 'invited').executeTakeFirst();
  if (Number(r.numUpdatedRows) !== 1) throw new AppError('INVITATION_EXPIRED');
}
