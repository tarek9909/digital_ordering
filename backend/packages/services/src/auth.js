import { createHash, createHmac } from 'node:crypto';
import { SESSION_TTL, checkPassword, decrypt, dummyVerify, encrypt, hashSecret, newTotpSecret, tokenHash, totpStepOf, totpUri, verifySecret, } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { newSecretToken, tenantAccess, uuidv7 } from '@dop/domain';
import { writeAudit } from './audit.js';
import { sendEmail } from './email.js';
import { EVENTS_CHANNEL, keys } from './kv.js';
import { urls } from './deps.js';
// Credentials and sessions (TRD §14.1, TR-AUTH-01 – TR-AUTH-08, TR-AUTH-11).
const hash = (deps, token) => tokenHash(deps.config.pepper, token);
export const csrfFor = (deps, sessionId) => createHmac('sha256', deps.config.pepper).update(`csrf:${sessionId}`).digest('base64url');
// ---- throttling (TR-AUTH-03)
const LOCKED = () => new AppError('ACCOUNT_LOCKED', 'Too many attempts. Try again in 15 minutes.');
/** Wrong passwords per account from all addresses together in 15 minutes (M-5). */
const ACCOUNT_FAILURES = 20;
/**
 * Per account and address (5 / 15 min), per address (50 / hour) and per account overall (M-5). Past the overall
 * budget only an address the account has signed in from before may keep trying, so guesses spread over many
 * addresses stop without letting a stranger lock the owner out.
 */
async function checkThrottle(deps, account, ip, familiar) {
    const [acct, ipCount, total] = await Promise.all([deps.kv.get(`signin:acct:${account}:${ip}`), deps.kv.get(`signin:ip:${ip}`), deps.kv.get(`signin:acct:${account}`)]);
    if (Number(acct ?? 0) >= 5 || Number(ipCount ?? 0) >= 50)
        throw LOCKED();
    if (Number(total ?? 0) >= ACCOUNT_FAILURES && !(familiar && (await familiar())))
        throw LOCKED();
}
async function recordFailure(deps, account, ip) {
    await deps.kv.incr(`signin:acct:${account}:${ip}`, 15 * 60);
    await deps.kv.incr(`signin:acct:${account}`, 15 * 60);
    await deps.kv.incr(`signin:ip:${ip}`, 3600);
}
/** A password check outside sign-in that shares its lockout (linking Google to an account, M-1). */
export async function checkAccountPassword(deps, email, passwordHash, password, ip) {
    await checkThrottle(deps, email, ip, () => familiarAddress(deps, 'user', email, ip));
    if (!passwordHash || !(await verifySecret(passwordHash, password))) {
        if (!passwordHash)
            await dummyVerify(password);
        await recordFailure(deps, email, ip);
        throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
    }
}
/** True when the account opened a session from this address in the last 30 days. */
async function familiarAddress(deps, kind, email, ip) {
    const since = new Date(deps.now().getTime() - 30 * 86_400_000);
    const db = deps.db.platform();
    const row = kind === 'user'
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
async function acceptStep(deps, principal, step) {
    if (step <= Number((await deps.kv.get(`totp:last:${principal}`)) ?? -1))
        return false;
    if (!(await deps.kv.setNx(`totp:used:${principal}:${step}`, '1', 120)))
        return false;
    await deps.kv.set(`totp:last:${principal}`, String(step), 120);
    return true;
}
/**
 * Checks a TOTP code for `principal` (`u:<userId>` or `p:<platformUserId>`). Every flow that accepts a code goes
 * through here: one failure budget per account, an optional per-challenge budget, and single use of the code.
 * A wrong code throws UNAUTHENTICATED; `data.locked` says the account budget is now used up.
 */
async function checkSecondFactor(deps, principal, secret, code, ip, challengeKey) {
    const failKey = `mfa:fail:${principal}`;
    const [fails, ipCount] = await Promise.all([deps.kv.get(failKey), deps.kv.get(`signin:ip:${ip}`)]);
    if (Number(fails ?? 0) >= MFA_ACCOUNT_FAILURES || Number(ipCount ?? 0) >= 50)
        throw LOCKED();
    const step = secret ? totpStepOf(secret, code) : null;
    // Replay is per secret: a code from a newly enrolled authenticator is not "older" than the old one's.
    if (step !== null && (await acceptStep(deps, `${principal}:${createHash('sha256').update(secret).digest('hex').slice(0, 16)}`, step))) {
        await deps.kv.del(failKey);
        return;
    }
    const n = await deps.kv.incr(failKey, 15 * 60);
    await deps.kv.incr(`signin:ip:${ip}`, 3600);
    if (challengeKey && (await deps.kv.incr(`${challengeKey}:tries`, SESSION_TTL.mfaTokenMs / 1000)) >= MFA_CHALLENGE_TRIES)
        await deps.kv.del(challengeKey);
    throw new AppError('UNAUTHENTICATED', 'Code is incorrect', { data: { locked: n >= MFA_ACCOUNT_FAILURES } });
}
const isLockedOut = (e) => e instanceof AppError && (e.code === 'ACCOUNT_LOCKED' || e.data?.locked === true);
// ---------------------------------------------------------------- tenant users
/** `tenantId` is the host's tenant; null on www (tenant chooser). */
export async function signInUser(deps, email, password, tenantId, client) {
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
        if (!m)
            throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect');
    }
    if (user.totp_secret_enc)
        return issueUserMfaChallenge(deps, user.id, tenantId);
    return createUserSession(deps, user.id, tenantId, client, false);
}
/**
 * Second step for a user with an enrolled authenticator, whatever the first factor was (password or Google, A03).
 * The token is single-use and short-lived; `signInUserMfa` completes it.
 */
export async function issueUserMfaChallenge(deps, userId, tenantId, invitationId) {
    const mfaToken = newSecretToken();
    await deps.kv.set(keys.mfaToken(hash(deps, mfaToken)), JSON.stringify({ kind: 'user', userId, tenantId, invitationId: invitationId ?? null }), SESSION_TTL.mfaTokenMs / 1000);
    return { kind: 'mfa', mfaToken };
}
export async function signInUserMfa(deps, mfaToken, code, client) {
    const k = keys.mfaToken(hash(deps, mfaToken));
    const raw = await deps.kv.get(k);
    if (!raw)
        throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
    const p = JSON.parse(raw);
    if (p.kind !== 'user')
        throw new AppError('UNAUTHENTICATED');
    const user = await deps.db.platform().selectFrom('users').select(['totp_secret_enc', 'disabled_at']).where('id', '=', p.userId).executeTakeFirstOrThrow();
    if (user.disabled_at)
        throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
    await checkSecondFactor(deps, `u:${p.userId}`, user.totp_secret_enc ? await decrypt(deps.keys, user.totp_secret_enc) : null, code, client.ip, k);
    // Single use even under concurrent requests (L-2).
    if (!(await deps.kv.take(k)))
        throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
    // An invitation accepted by an account with an authenticator completes only now (H-4).
    if (p.invitationId && p.tenantId)
        await redeemInvitation(deps, p.invitationId, p.userId);
    return createUserSession(deps, p.userId, p.tenantId, client, true);
}
/** `mfa`: true when the second factor was just verified, or the time it was verified (carried by a handoff). */
export async function createUserSession(deps, userId, tenantId, client, mfa) {
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
        ip: client.ip,
        user_agent: client.userAgent.slice(0, 300),
        expires_at: new Date(now.getTime() + SESSION_TTL.userAbsoluteMs),
    })
        .execute();
    return { kind: 'session', token, sessionId: id, userId };
}
/** Resolves a session cookie; sessions are bound to the host that issued them (TR-TEN-13). */
export async function resolveUserSession(deps, token, host) {
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
    if (!s || s.host !== host || s.disabled_at)
        return null;
    if (s.expires_at <= now || now.getTime() - s.last_seen_at.getTime() > SESSION_TTL.userIdleMs)
        return null;
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
export async function verifySessionMfa(deps, userId, sessionId, code, ip) {
    const u = await deps.db.platform().selectFrom('users').select('totp_secret_enc').where('id', '=', userId).executeTakeFirstOrThrow();
    if (!u.totp_secret_enc)
        throw new AppError('NOT_FOUND', 'No authenticator is set up');
    try {
        await checkSecondFactor(deps, `u:${userId}`, await decrypt(deps.keys, u.totp_secret_enc), code, ip);
    }
    catch (e) {
        // A session that used up the account's code budget is signed out (M-2 for tenant step-up).
        if (isLockedOut(e))
            await revokeSession(deps, sessionId);
        throw e;
    }
    await deps.db.platform().updateTable('user_sessions').set({ mfa_verified_at: deps.now() }).where('id', '=', sessionId).where('user_id', '=', userId).execute();
}
export async function revokeSession(deps, sessionId) {
    await deps.db.platform().updateTable('user_sessions').set({ revoked_at: deps.now() }).where('id', '=', sessionId).execute();
    await revalidateUserSockets(deps, { sessionId });
}
/** TR-AUTH-07: password reset, email/MFA/role change and ownership transfer revoke the user's other sessions. */
export async function revokeOtherSessions(deps, userId, keepSessionId) {
    let q = deps.db.platform().updateTable('user_sessions').set({ revoked_at: deps.now() }).where('user_id', '=', userId).where('revoked_at', 'is', null);
    if (keepSessionId)
        q = q.where('id', '!=', keepSessionId);
    await q.execute();
    await revalidateUserSockets(deps, { userId });
}
/**
 * Tells every realtime instance to re-check the board sockets of a user or session now (H-7): after sign-out,
 * revocation, membership, role or second-factor changes. Instances also re-check every minute, so a lost
 * message only delays the cut-off.
 */
export async function revalidateUserSockets(deps, ref) {
    const event = { outboxId: 0, topic: 'user.revalidate', tenantId: null, payload: ref };
    await deps.kv.publish(EVENTS_CHANNEL, JSON.stringify(event)).catch((err) => deps.log.warn({ err }, 'socket revalidation publish failed'));
}
/**
 * The single board-access rule for a signed-in owner or manager, used by the realtime handshake and its periodic
 * re-check (M-10, H-7) with the same conditions as the HTTP staff API: a live session on this host, an active
 * membership, the tenant's staff access, the venue, and two-factor assurance when the tenant has several venues.
 */
export async function resolveBoardUser(deps, sessionToken, host, venueId) {
    const s = await resolveUserSession(deps, sessionToken, host);
    if (!s?.tenantId || !(await membershipFor(deps, s.userId, s.tenantId)))
        return null;
    const tenant = await deps.db.platform().selectFrom('tenants').select('status').where('id', '=', s.tenantId).executeTakeFirst();
    if (!tenant || tenantAccess(tenant.status).staff === 'off')
        return null;
    const v = await deps.db.forTenant(s.tenantId).selectFrom('venues').select('id').where('id', '=', venueId).executeTakeFirst();
    if (!v)
        return null;
    if (!s.mfaVerified && (await activeVenueCount(deps, s.tenantId)) > 1)
        return null;
    return { userId: s.userId, sessionId: s.sessionId, tenantId: s.tenantId, venueId: v.id };
}
const activeVenueCount = async (deps, tenantId) => Number((await deps.db.forTenant(tenantId).selectFrom('venues').select((eb) => eb.fn.countAll().as('n')).where('status', '=', 'active').executeTakeFirstOrThrow()).n);
export async function membershipFor(deps, userId, tenantId) {
    const m = await deps.db.platform().selectFrom('tenant_memberships').select(['id', 'role']).where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('status', '=', 'active').executeTakeFirst();
    return m ?? null;
}
export async function me(deps, userId, tenantId, sessionId) {
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
async function issueEmailToken(deps, userId, purpose, ttlMs, newEmail = null) {
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
export async function requestEmailChange(deps, actor, newEmail, password) {
    await verifyUserPassword(deps, actor.userId, password);
    const db = deps.db.platform();
    const email = newEmail.trim().toLowerCase();
    const u = await db.selectFrom('users').select(['email', 'name', 'locale']).where('id', '=', actor.userId).executeTakeFirstOrThrow();
    if (u.email === email)
        throw new AppError('VALIDATION_FAILED', 'This is already your email', { errors: [{ path: 'newEmail', message: 'same' }] });
    if (await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst())
        throw new AppError('EMAIL_TAKEN', 'An account with this email exists', { errors: [{ path: 'newEmail', message: 'taken' }] });
    // Only the latest request is valid.
    await db.updateTable('email_tokens').set({ used_at: deps.now() }).where('user_id', '=', actor.userId).where('purpose', '=', 'change_email').where('used_at', 'is', null).execute();
    const token = await issueEmailToken(deps, actor.userId, 'change_email', SESSION_TTL.verifyEmailMs, email);
    await writeAudit(db, { actor: { kind: 'user', userId: actor.userId, tenantId: actor.tenantId ?? '', role: 'owner', sessionId: '', mfaVerified: false }, action: 'account.email_change_requested', tenantId: actor.tenantId ?? null, entityType: 'user', entityId: actor.userId, after: { email } });
    await sendEmail(deps, { template: 'email_change', to: email, locale: u.locale, data: { name: u.name, link: urls(deps.config).www(`/confirm-email?token=${token}`) } });
    await sendEmail(deps, { template: 'email_changed', to: u.email, locale: u.locale, data: { name: u.name, newEmail: email, requested: true }, key: `email-change-requested:${actor.userId}:${email}` });
    return { pendingEmail: email };
}
/** Completes an email change from the link; other sessions are signed out. */
export async function confirmEmailChange(deps, token) {
    const row = await useEmailToken(deps, token, 'change_email');
    const db = deps.db.platform();
    const email = row.new_email;
    const u = await db.selectFrom('users').select(['email', 'name', 'locale']).where('id', '=', row.user_id).executeTakeFirstOrThrow();
    try {
        await db.transaction().execute(async (tx) => {
            await tx.updateTable('users').set({ email, email_verified_at: deps.now() }).where('id', '=', row.user_id).execute();
            await writeAudit(tx, { actor: { kind: 'user', userId: row.user_id, tenantId: '', role: 'owner', sessionId: '', mfaVerified: false }, action: 'account.email_changed', tenantId: null, entityType: 'user', entityId: row.user_id, before: { email: u.email }, after: { email } });
        });
    }
    catch (e) {
        if (e.code === 'ER_DUP_ENTRY')
            throw new AppError('EMAIL_TAKEN', 'An account with this email exists');
        throw e;
    }
    await revokeOtherSessions(deps, row.user_id);
    await sendEmail(deps, { template: 'email_changed', to: u.email, locale: u.locale, data: { name: u.name, newEmail: email, requested: false }, key: `email-changed:${row.user_id}:${email}` });
    return { email };
}
/** The signed-in member's preferences in the current tenant (W06, FR-RPT-05). */
export async function setMemberPreferences(deps, actor, b) {
    const db = deps.db.platform();
    await db.transaction().execute(async (tx) => {
        const r = await tx.updateTable('tenant_memberships').set({ weekly_summary: b.weeklySummary }).where('tenant_id', '=', actor.tenantId).where('user_id', '=', actor.userId).where('status', '=', 'active').executeTakeFirst();
        if (Number(r.numUpdatedRows) === 0)
            throw new AppError('NOT_FOUND');
        await writeAudit(tx, { actor: { kind: 'user', ...actor, role: actor.role }, action: 'member.preferences_changed', tenantId: actor.tenantId, entityType: 'member', entityId: actor.userId, after: b });
    });
}
export async function sendVerifyEmail(deps, userId, tenantSlug) {
    const u = await deps.db.platform().selectFrom('users').select(['email', 'locale', 'name']).where('id', '=', userId).executeTakeFirstOrThrow();
    const token = await issueEmailToken(deps, userId, 'verify_email', SESSION_TTL.verifyEmailMs);
    await sendEmail(deps, { template: 'verify_email', to: u.email, locale: u.locale, data: { name: u.name, link: urls(deps.config).www(`/verify-email?token=${token}`), tenantSlug } });
}
async function useEmailToken(deps, token, purpose) {
    const db = deps.db.platform();
    const row = await db.selectFrom('email_tokens').selectAll().where('token_hash', '=', hash(deps, token)).where('purpose', '=', purpose).executeTakeFirst();
    if (!row || row.used_at || row.expires_at <= deps.now())
        throw new AppError('INVITATION_EXPIRED', 'This link has expired');
    // Conditional update: of two concurrent uses only one changes the row (L-2).
    const r = await db.updateTable('email_tokens').set({ used_at: deps.now() }).where('id', '=', row.id).where('used_at', 'is', null).executeTakeFirst();
    if (Number(r.numUpdatedRows) !== 1)
        throw new AppError('INVITATION_EXPIRED', 'This link has expired');
    return row;
}
export async function verifyEmail(deps, token) {
    const row = await useEmailToken(deps, token, 'verify_email');
    const db = deps.db.platform();
    await db.updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', row.user_id).where('email_verified_at', 'is', null).execute();
    const u = await db.selectFrom('users').select(['email', 'locale', 'name']).where('id', '=', row.user_id).executeTakeFirstOrThrow();
    await sendEmail(deps, { template: 'welcome', to: u.email, locale: u.locale, data: { name: u.name }, key: `welcome:${row.user_id}` });
}
/** Always succeeds from the caller's view (no account enumeration). */
export async function forgotPassword(deps, email) {
    const u = await deps.db.platform().selectFrom('users').select(['id', 'locale', 'name']).where('email', '=', email).where('disabled_at', 'is', null).executeTakeFirst();
    if (!u)
        return;
    const token = await issueEmailToken(deps, u.id, 'reset_password', SESSION_TTL.resetPasswordMs);
    await sendEmail(deps, { template: 'password_reset', to: email, locale: u.locale, data: { name: u.name, link: urls(deps.config).www(`/reset-password?token=${token}`) } });
}
export async function resetPassword(deps, token, password) {
    const row = await useEmailToken(deps, token, 'reset_password');
    const problem = checkPassword(password);
    if (problem)
        throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
    await deps.db.platform().updateTable('users').set({ password_hash: await hashSecret(password) }).where('id', '=', row.user_id).execute();
    await revokeOtherSessions(deps, row.user_id);
}
export async function changePassword(deps, userId, sessionId, current, next) {
    const db = deps.db.platform();
    const u = await db.selectFrom('users').select(['password_hash', 'email']).where('id', '=', userId).executeTakeFirstOrThrow();
    if (!u.password_hash || !(await verifySecret(u.password_hash, current)))
        throw new AppError('UNAUTHENTICATED', 'Current password is incorrect');
    const problem = checkPassword(next, [u.email]);
    if (problem)
        throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'newPassword', message: problem }] });
    await db.updateTable('users').set({ password_hash: await hashSecret(next) }).where('id', '=', userId).execute();
    await revokeOtherSessions(deps, userId, sessionId);
}
export async function verifyUserPassword(deps, userId, password) {
    const u = await deps.db.platform().selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirstOrThrow();
    if (!u.password_hash || !(await verifySecret(u.password_hash, password)))
        throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
}
// ---- TOTP for tenant users (optional in MVP, TR-AUTH-11)
/** A session that changes the second factor re-proves the account first (H-5). */
const REAUTH_FRESH_MS = 15 * 60_000;
async function reauthenticate(deps, userId, sessionId, proof, ip) {
    const db = deps.db.platform();
    const u = await db.selectFrom('users').select(['password_hash', 'totp_secret_enc']).where('id', '=', userId).executeTakeFirstOrThrow();
    if (u.password_hash) {
        await checkThrottle(deps, `reauth:${userId}`, ip);
        if (!proof.password || !(await verifySecret(u.password_hash, proof.password))) {
            await recordFailure(deps, `reauth:${userId}`, ip);
            throw new AppError('UNAUTHENTICATED', 'Password is incorrect', { errors: [{ path: 'password', message: 'incorrect' }] });
        }
    }
    else {
        // Google-only account: no password to re-check, so the sign-in itself must be recent.
        const s = await db.selectFrom('user_sessions').select('created_at').where('id', '=', sessionId).executeTakeFirstOrThrow();
        if (deps.now().getTime() - s.created_at.getTime() > REAUTH_FRESH_MS)
            throw new AppError('FORBIDDEN', 'Sign in again to change two-factor settings');
    }
    // Replacing a factor needs the factor being replaced; a code from the new one never authorises that.
    if (u.totp_secret_enc)
        await checkSecondFactor(deps, `u:${userId}`, await decrypt(deps.keys, u.totp_secret_enc), proof.currentCode ?? '', ip);
}
/** True when the user owns or manages a tenant that makes two-factor sign-in mandatory (TR-AUTH-11). */
async function mfaMandatoryForUser(deps, userId) {
    const rows = await deps.db.platform().selectFrom('tenant_memberships').select('tenant_id').where('user_id', '=', userId).where('status', '=', 'active').execute();
    for (const r of rows)
        if ((await activeVenueCount(deps, r.tenant_id)) > 1)
            return true;
    return false;
}
async function notifyMfaChange(deps, userId, removed) {
    const u = await deps.db.platform().selectFrom('users').select(['email', 'name', 'locale']).where('id', '=', userId).executeTakeFirstOrThrow();
    await sendEmail(deps, { template: 'mfa_changed', to: u.email, locale: u.locale, data: { name: u.name, removed }, key: `mfa-changed:${userId}:${deps.now().getTime()}` });
}
export async function enrollTotp(deps, userId, sessionId, proof, ip) {
    await reauthenticate(deps, userId, sessionId, proof, ip);
    const u = await deps.db.platform().selectFrom('users').select(['email']).where('id', '=', userId).executeTakeFirstOrThrow();
    const secret = newTotpSecret();
    // Bound to the session that re-authenticated; another session cannot confirm it.
    await deps.kv.set(`totp:pending:${userId}`, JSON.stringify({ secret, sessionId }), 600);
    return { secret, uri: totpUri(secret, u.email, 'Tanbeeh') };
}
export async function confirmTotp(deps, userId, sessionId, code, ip) {
    const k = `totp:pending:${userId}`;
    const raw = await deps.kv.get(k);
    const pending = raw?.startsWith('{') ? JSON.parse(raw) : null;
    const incorrect = () => new AppError('VALIDATION_FAILED', 'Code is incorrect', { errors: [{ path: 'code', message: 'incorrect' }] });
    if (!pending || pending.sessionId !== sessionId)
        throw incorrect();
    try {
        await checkSecondFactor(deps, `u:${userId}`, pending.secret, code, ip);
    }
    catch (e) {
        if (e instanceof AppError && e.code === 'UNAUTHENTICATED')
            throw incorrect();
        throw e;
    }
    if (!(await deps.kv.take(k)))
        throw incorrect();
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
export async function removeTotp(deps, userId, sessionId, code, ip) {
    const db = deps.db.platform();
    const u = await db.selectFrom('users').select('totp_secret_enc').where('id', '=', userId).executeTakeFirstOrThrow();
    if (!u.totp_secret_enc)
        throw new AppError('NOT_FOUND', 'No authenticator is set up');
    if (await mfaMandatoryForUser(deps, userId))
        throw new AppError('FORBIDDEN', 'Two-factor sign-in is required while you manage several venues');
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
export async function createHandoff(deps, userId, tenantSlug, userAgent, mfaVerifiedAt = null) {
    const db = deps.db.platform();
    const t = await db
        .selectFrom('tenants')
        .innerJoin('tenant_memberships', 'tenant_memberships.tenant_id', 'tenants.id')
        .select(['tenants.id'])
        .where('tenants.slug', '=', tenantSlug)
        .where('tenant_memberships.user_id', '=', userId)
        .where('tenant_memberships.status', '=', 'active')
        .where('tenants.status', '!=', 'deleted')
        .executeTakeFirst();
    if (!t)
        throw new AppError('NOT_FOUND');
    const code = newSecretToken();
    const host = `${tenantSlug}.${deps.config.domain}`;
    await deps.kv.set(keys.handoff(hash(deps, code)), JSON.stringify({ userId, tenantId: t.id, host, ua: userAgent, mfaAt: mfaVerifiedAt?.toISOString() ?? null }), SESSION_TTL.handoffMs / 1000);
    return { code, url: `${urls(deps.config).admin(tenantSlug, `/handoff?code=${code}`)}` };
}
export async function exchangeHandoff(deps, code, client, tenantId) {
    const raw = await deps.kv.take(keys.handoff(hash(deps, code))); // single use, atomically (L-2)
    if (!raw)
        throw new AppError('UNAUTHENTICATED', 'Link expired');
    const p = JSON.parse(raw);
    if (p.host !== client.host || p.tenantId !== tenantId || p.ua !== client.userAgent)
        throw new AppError('UNAUTHENTICATED', 'Link expired');
    // Assurance is carried only while the account still has its authenticator (removing it revokes sessions).
    const user = await deps.db.platform().selectFrom('users').select(['totp_secret_enc', 'disabled_at']).where('id', '=', p.userId).executeTakeFirst();
    if (!user || user.disabled_at)
        throw new AppError('UNAUTHENTICATED', 'Link expired');
    const mfaAt = p.mfaAt && user.totp_secret_enc ? new Date(p.mfaAt) : false;
    return createUserSession(deps, p.userId, tenantId, client, mfaAt);
}
// ---- invitations
export async function inviteMember(deps, actor, tenantId, email, role) {
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
    if (existing)
        throw new AppError('EMAIL_TAKEN', 'Already a member');
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
export async function invitationDetails(deps, token) {
    const inv = await deps.db
        .platform()
        .selectFrom('invitations')
        .innerJoin('tenants', 'tenants.id', 'invitations.tenant_id')
        .select(['invitations.id', 'invitations.email', 'invitations.role', 'invitations.expires_at', 'invitations.accepted_at', 'invitations.revoked_at', 'tenants.name', 'tenants.slug', 'tenants.id as tenantId'])
        .where('invitations.token_hash', '=', hash(deps, token))
        .executeTakeFirst();
    if (!inv || inv.accepted_at || inv.revoked_at || inv.expires_at <= deps.now())
        throw new AppError('INVITATION_EXPIRED');
    const userExists = Boolean(await deps.db.platform().selectFrom('users').select('id').where('email', '=', inv.email).executeTakeFirst());
    return { ...inv, userExists };
}
/**
 * Marks the invitation accepted and grants the membership in one transaction. The conditional update makes the
 * invitation single-use under concurrent requests (L-2); a used, revoked or expired one fails.
 */
async function redeemInvitation(deps, invitationId, userId) {
    await deps.db.platform().transaction().execute(async (tx) => {
        const now = deps.now();
        const inv = await tx.selectFrom('invitations').select(['tenant_id', 'role', 'email']).where('id', '=', invitationId).executeTakeFirst();
        const r = await tx.updateTable('invitations').set({ accepted_at: now }).where('id', '=', invitationId).where('accepted_at', 'is', null).where('revoked_at', 'is', null).where('expires_at', '>', now).executeTakeFirst();
        if (!inv || Number(r.numUpdatedRows) !== 1)
            throw new AppError('INVITATION_EXPIRED');
        const m = await tx.selectFrom('tenant_memberships').select(['id']).where('tenant_id', '=', inv.tenant_id).where('user_id', '=', userId).executeTakeFirst();
        if (m)
            await tx.updateTable('tenant_memberships').set({ status: 'active', role: inv.role }).where('id', '=', m.id).execute();
        else
            await tx.insertInto('tenant_memberships').values({ id: uuidv7(), tenant_id: inv.tenant_id, user_id: userId, role: inv.role }).execute();
    });
}
/**
 * Accepting an invitation is a sign-in (H-4): an existing account proves its password under the sign-in
 * throttle, a disabled account is refused, and an account with an authenticator gets the MFA challenge — the
 * invitation completes only when the code is right (`signInUserMfa`). New accounts are created verified.
 */
export async function acceptInvitation(deps, token, b, client) {
    const inv = await invitationDetails(deps, token);
    const db = deps.db.platform();
    const existing = await db.selectFrom('users').select(['id', 'password_hash', 'totp_secret_enc', 'disabled_at']).where('email', '=', inv.email).executeTakeFirst();
    let userId;
    if (existing) {
        await checkThrottle(deps, inv.email, client.ip, () => familiarAddress(deps, 'user', inv.email, client.ip));
        // Existing account: the password proves it is theirs.
        if (existing.disabled_at || !b.password || !existing.password_hash || !(await verifySecret(existing.password_hash, b.password))) {
            await recordFailure(deps, inv.email, client.ip);
            throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
        }
        if (existing.totp_secret_enc)
            return { ...(await issueUserMfaChallenge(deps, existing.id, inv.tenantId, inv.id)), tenantSlug: inv.slug };
        userId = existing.id;
    }
    else {
        if (!b.name || !b.password)
            throw new AppError('VALIDATION_FAILED', 'Name and password are required');
        const problem = checkPassword(b.password, [inv.email]);
        if (problem)
            throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
        userId = uuidv7();
        // Accepting an emailed invitation proves the address.
        await db.insertInto('users').values({ id: userId, email: inv.email, name: b.name, password_hash: await hashSecret(b.password), email_verified_at: deps.now() }).execute();
    }
    await redeemInvitation(deps, inv.id, userId);
    const s = await createUserSession(deps, userId, inv.tenantId, client, false);
    return { ...s, tenantSlug: inv.slug };
}
export async function signInPlatform(deps, email, password, client) {
    await checkThrottle(deps, `p:${email}`, client.ip, () => familiarAddress(deps, 'platform', email, client.ip));
    const db = deps.db.platform();
    const u = await db.selectFrom('platform_users').selectAll().where('email', '=', email).where('status', '=', 'active').executeTakeFirst();
    if (!u?.password_hash || !(await verifySecret(u.password_hash, password))) {
        if (!u?.password_hash)
            await dummyVerify(password);
        await recordFailure(deps, `p:${email}`, client.ip);
        throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect');
    }
    const mfaToken = newSecretToken();
    await deps.kv.set(keys.mfaToken(hash(deps, mfaToken)), JSON.stringify({ kind: 'platform', platformUserId: u.id }), SESSION_TTL.mfaTokenMs / 1000);
    // No second factor yet: the user must enrol before any session exists (FR-SA-02).
    return u.totp_secret_enc ? { kind: 'mfa', mfaToken } : { kind: 'enroll_mfa', mfaToken };
}
export async function platformEnrollStart(deps, mfaToken) {
    const raw = await deps.kv.get(keys.mfaToken(hash(deps, mfaToken)));
    if (!raw)
        throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
    const p = JSON.parse(raw);
    const u = await deps.db.platform().selectFrom('platform_users').select(['email', 'totp_secret_enc']).where('id', '=', p.platformUserId).executeTakeFirstOrThrow();
    if (u.totp_secret_enc)
        throw new AppError('FORBIDDEN', 'Already enrolled');
    const secret = newTotpSecret();
    await deps.kv.set(`totp:pending:p:${p.platformUserId}`, secret, 600);
    return { secret, uri: totpUri(secret, u.email, 'Tanbeeh Console') };
}
export async function signInPlatformMfa(deps, mfaToken, code, client) {
    const k = keys.mfaToken(hash(deps, mfaToken));
    const raw = await deps.kv.get(k);
    if (!raw)
        throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
    const p = JSON.parse(raw);
    if (p.kind !== 'platform')
        throw new AppError('UNAUTHENTICATED');
    const db = deps.db.platform();
    const u = await db.selectFrom('platform_users').select(['id', 'totp_secret_enc', 'status']).where('id', '=', p.platformUserId).executeTakeFirstOrThrow();
    if (u.status !== 'active')
        throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
    let secret = u.totp_secret_enc ? await decrypt(deps.keys, u.totp_secret_enc) : await deps.kv.get(`totp:pending:p:${u.id}`);
    await checkSecondFactor(deps, `p:${u.id}`, secret, code, client.ip, k);
    // Single use even under concurrent requests (L-2).
    if (!(await deps.kv.take(k)))
        throw new AppError('UNAUTHENTICATED', 'Sign-in expired, start again');
    if (!u.totp_secret_enc) {
        await db.updateTable('platform_users').set({ totp_secret_enc: await encrypt(deps.keys, secret), mfa_enrolled_at: deps.now() }).where('id', '=', u.id).execute();
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
export async function refreshPlatformMfa(deps, sessionId, platformUserId, code, ip) {
    const db = deps.db.platform();
    const u = await db.selectFrom('platform_users').select(['totp_secret_enc']).where('id', '=', platformUserId).executeTakeFirstOrThrow();
    try {
        await checkSecondFactor(deps, `p:${platformUserId}`, u.totp_secret_enc ? await decrypt(deps.keys, u.totp_secret_enc) : null, code, ip);
    }
    catch (e) {
        if (isLockedOut(e)) {
            await revokePlatformSession(deps, sessionId);
            deps.log.warn({ security: true, event: 'MFA_REFRESH_LOCKED', platformUserId }, 'fresh-MFA budget used up; session revoked');
        }
        throw e;
    }
    await db.updateTable('platform_sessions').set({ mfa_verified_at: deps.now() }).where('id', '=', sessionId).execute();
}
export async function resolvePlatformSession(deps, token) {
    const now = deps.now();
    const db = deps.db.platform();
    const s = await db
        .selectFrom('platform_sessions')
        .innerJoin('platform_users', 'platform_users.id', 'platform_sessions.platform_user_id')
        .select(['platform_sessions.id', 'platform_sessions.platform_user_id', 'platform_sessions.mfa_verified_at', 'platform_sessions.last_seen_at', 'platform_sessions.expires_at', 'platform_users.role', 'platform_users.name', 'platform_users.status'])
        .where('platform_sessions.token_hash', '=', hash(deps, token))
        .where('platform_sessions.revoked_at', 'is', null)
        .executeTakeFirst();
    if (!s || s.status !== 'active' || !s.mfa_verified_at)
        return null;
    if (s.expires_at <= now || now.getTime() - s.last_seen_at.getTime() > SESSION_TTL.platformIdleMs)
        return null;
    await db.updateTable('platform_sessions').set({ last_seen_at: now }).where('id', '=', s.id).execute();
    return { sessionId: s.id, platformUserId: s.platform_user_id, role: s.role, name: s.name, mfaVerifiedAt: s.mfa_verified_at };
}
export async function revokePlatformSession(deps, sessionId) {
    await deps.db.platform().updateTable('platform_sessions').set({ revoked_at: deps.now() }).where('id', '=', sessionId).execute();
}
/** Platform user invitation: a 7-day token kept in the KV store; accepting sets the password. */
export async function invitePlatformUser(deps, actor, email, name, role) {
    const db = deps.db.platform();
    if (await db.selectFrom('platform_users').select('id').where('email', '=', email).executeTakeFirst())
        throw new AppError('EMAIL_TAKEN');
    const id = uuidv7();
    await db.transaction().execute(async (tx) => {
        await tx.insertInto('platform_users').values({ id, email, name, role }).execute();
        await writeAudit(tx, { actor, action: 'platform_user.invited', tenantId: null, entityType: 'platform_user', entityId: id, after: { email, role }, visibleToTenant: false });
    });
    const token = newSecretToken();
    await deps.kv.set(`pinvite:${hash(deps, token)}`, id, SESSION_TTL.invitationMs / 1000);
    await sendEmail(deps, { template: 'platform_user_invitation', to: email, locale: 'en', data: { name, link: urls(deps.config).console(`/accept?token=${token}`) } });
    return { id };
}
export async function acceptPlatformInvitation(deps, token, password) {
    const k = `pinvite:${hash(deps, token)}`;
    if (!(await deps.kv.exists(k)))
        throw new AppError('INVITATION_EXPIRED');
    const problem = checkPassword(password);
    if (problem)
        throw new AppError('VALIDATION_FAILED', 'Choose a different password', { errors: [{ path: 'password', message: problem }] });
    const id = await deps.kv.take(k); // single use, atomically (L-2)
    if (!id)
        throw new AppError('INVITATION_EXPIRED');
    const r = await deps.db.platform().updateTable('platform_users').set({ password_hash: await hashSecret(password), status: 'active' }).where('id', '=', id).where('status', '=', 'invited').executeTakeFirst();
    if (Number(r.numUpdatedRows) !== 1)
        throw new AppError('INVITATION_EXPIRED');
}
