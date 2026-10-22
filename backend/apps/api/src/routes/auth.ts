import { COOKIES, SESSION_TTL } from '@dop/auth';
import {
  AppError,
  acceptInvitationBody,
  emailTokenBody,
  forgotPasswordBody,
  handoffBody,
  handoffExchangeBody,
  passwordSchema,
  resetPasswordBody,
  signInBody,
  signInMfaBody,
  totpConfirmBody,
  totpEnrollBody,
  totpRemoveBody,
} from '@dop/contracts';
import {
  acceptInvitation,
  acceptPlatformInvitation,
  confirmTotp,
  createHandoff,
  csrfFor,
  enrollTotp,
  exchangeHandoff,
  forgotPassword,
  invitationDetails,
  leaveSupport,
  me,
  revokeSupportToken,
  platformEnrollStart,
  refreshPlatformMfa,
  removeTotp,
  resetPassword,
  revokePlatformSession,
  revokeSession,
  sendVerifyEmail,
  signInPlatform,
  signInPlatformMfa,
  signInUser,
  signInUserMfa,
  verifyEmail,
  verifySessionMfa,
  confirmEmailChange,
  type SignInResult,
  type UserSession,
} from '@dop/services';
import { z } from 'zod';
import { cookieName, defineRoutes, route, type Ctx } from '../http/router.js';

// Auth API (TRD §12.4). Sessions are per host (TR-TEN-13); sign-in throttling in the service (TR-AUTH-03).

const signInLimit = { name: 'signin', points: 30, durationSec: 900, key: 'ip' as const };
/** Authenticator changes from a session (H-5); the service also counts wrong passwords and codes per account. */
const mfaManageLimit = { name: 'mfa-manage', points: 10, durationSec: 900, key: 'actor' as const };

function client(c: Ctx) {
  return { ip: c.ip, userAgent: c.userAgent, host: c.host };
}

const supportCookie = (c: Ctx) => (c.req.cookies as Record<string, string> | undefined)?.[cookieName(c.deps, COOKIES.support)];

function finishSignIn(c: Ctx, r: SignInResult, cookie: 'sid' | 'psid') {
  if (r.kind !== 'session') return { mfaRequired: r.kind === 'mfa', mfaEnrollmentRequired: r.kind === 'enroll_mfa', mfaToken: r.mfaToken };
  c.setCookie(COOKIES[cookie === 'sid' ? 'user' : 'platform'], r.token, cookie === 'sid' ? SESSION_TTL.userAbsoluteMs : SESSION_TTL.platformAbsoluteMs);
  return { ok: true };
}

const wwwSession = (c: Ctx): UserSession => {
  const s = c.res.locals.wwwSession as UserSession | undefined;
  if (!s) throw new AppError('UNAUTHENTICATED');
  return s;
};

export const authRoutes = defineRoutes('/api/auth/v1', [
  route({
    method: 'post',
    path: '/sign-in',
    surfaces: ['tenant', 'www', 'console'],
    permission: 'public',
    body: signInBody,
    csrfExempt: true,
    rateLimit: signInLimit,
    handler: async (c) => {
      if (c.surface.kind === 'console') return finishSignIn(c, await signInPlatform(c.deps, c.body.email, c.body.password, client(c)), 'psid');
      return finishSignIn(c, await signInUser(c.deps, c.body.email, c.body.password, c.tenant?.id ?? null, client(c)), 'sid');
    },
  }),
  route({
    method: 'post',
    path: '/sign-in/mfa',
    surfaces: ['tenant', 'www', 'console'],
    permission: 'public',
    body: signInMfaBody,
    csrfExempt: true,
    rateLimit: signInLimit,
    handler: async (c) => {
      if (c.surface.kind === 'console') return finishSignIn(c, await signInPlatformMfa(c.deps, c.body.mfaToken, c.body.code, client(c)), 'psid');
      return finishSignIn(c, await signInUserMfa(c.deps, c.body.mfaToken, c.body.code, client(c)), 'sid');
    },
  }),
  route({
    method: 'post',
    path: '/sign-in/mfa/enroll',
    surfaces: ['console'],
    permission: 'public',
    body: z.object({ mfaToken: z.string().min(16).max(100) }).strict(),
    csrfExempt: true,
    rateLimit: signInLimit,
    handler: async (c) => platformEnrollStart(c.deps, c.body.mfaToken),
  }),
  route({
    method: 'post',
    path: '/sign-out',
    surfaces: ['tenant', 'www', 'console'],
    permission: 'public',
    // CSRF-checked like any other change (L-8): a page elsewhere cannot sign people out.
    handler: async (c) => {
      if (c.actor.kind === 'user') await revokeSession(c.deps, c.actor.sessionId);
      if (c.actor.kind === 'platform') await revokePlatformSession(c.deps, c.actor.sessionId);
      const s = c.res.locals.wwwSession as UserSession | undefined;
      if (s) await revokeSession(c.deps, s.sessionId);
      // A support cookie on this browser stops working too; the support session itself is ended by "leave".
      const sup = supportCookie(c);
      if (sup) await revokeSupportToken(c.deps, sup);
      c.clearCookie(COOKIES.user);
      c.clearCookie(COOKIES.platform);
      c.clearCookie(COOKIES.support);
    },
  }),
  route({
    method: 'post',
    path: '/support/leave',
    surfaces: ['tenant'],
    permission: 'public',
    // M-23: leaving support mode ends the approved support session on the server, not only in the page.
    handler: async (c) => {
      if (c.actor.kind !== 'support') throw new AppError('UNAUTHENTICATED');
      const sup = supportCookie(c);
      if (sup) await leaveSupport(c.deps, sup, c.actor.tenantId);
      c.clearCookie(COOKIES.support);
    },
  }),
  route({
    method: 'get',
    path: '/me',
    surfaces: ['tenant', 'www', 'console'],
    permission: 'public',
    handler: async (c) => {
      if (c.actor.kind === 'user') return me(c.deps, c.actor.userId, c.actor.tenantId, c.actor.sessionId);
      // Platform support inside an approved session (TR-AUTH-12): identity, tenant and the CSRF token.
      if (c.actor.kind === 'support') {
        return {
          support: { agentName: c.actor.agentName, supportSessionId: c.actor.supportSessionId },
          currentTenantId: c.actor.tenantId,
          currentRole: 'support',
          csrfToken: csrfFor(c.deps, c.actor.supportSessionId),
        };
      }
      if (c.actor.kind === 'platform') {
        return {
          platformUser: { id: c.actor.platformUserId, role: c.actor.role, name: c.res.locals.platformName as string },
          mfaVerifiedAt: c.actor.mfaVerifiedAt?.toISOString() ?? null,
          csrfToken: csrfFor(c.deps, c.actor.sessionId),
          environment: c.deps.config.appEnv,
        };
      }
      const s = c.res.locals.wwwSession as UserSession | undefined;
      if (s) return me(c.deps, s.userId, null, s.sessionId);
      throw new AppError('UNAUTHENTICATED');
    },
  }),
  route({
    method: 'post',
    path: '/email/verify',
    surfaces: ['www', 'tenant'],
    permission: 'public',
    body: emailTokenBody,
    csrfExempt: true,
    handler: async (c) => {
      await verifyEmail(c.deps, c.body.token);
    },
  }),
  route({
    method: 'post',
    path: '/email/change/confirm',
    surfaces: ['www', 'tenant'],
    permission: 'public',
    body: emailTokenBody,
    csrfExempt: true,
    rateLimit: { name: 'email-confirm', points: 20, durationSec: 600, key: 'ip' },
    handler: async (c) => confirmEmailChange(c.deps, c.body.token),
  }),
  route({
    method: 'post',
    path: '/email/resend',
    surfaces: ['tenant'],
    permission: 'account.self',
    rateLimit: { name: 'verify-resend', points: 3, durationSec: 3600, key: 'actor' },
    handler: async (c) => {
      if (c.actor.kind === 'user') await sendVerifyEmail(c.deps, c.actor.userId, c.tenant?.slug ?? null);
    },
  }),
  route({
    method: 'post',
    path: '/password/forgot',
    surfaces: ['www', 'tenant'],
    permission: 'public',
    body: forgotPasswordBody,
    csrfExempt: true,
    status: 202,
    rateLimit: { name: 'forgot', points: 5, durationSec: 3600, key: 'ip' },
    handler: async (c) => {
      await forgotPassword(c.deps, c.body.email);
      return { accepted: true };
    },
  }),
  route({
    method: 'post',
    path: '/password/reset',
    surfaces: ['www', 'tenant'],
    permission: 'public',
    body: resetPasswordBody,
    csrfExempt: true,
    rateLimit: { name: 'reset', points: 10, durationSec: 3600, key: 'ip' },
    handler: async (c) => {
      await resetPassword(c.deps, c.body.token, c.body.password);
    },
  }),
  route({
    method: 'get',
    path: '/invitations/:token',
    surfaces: ['tenant'],
    permission: 'public',
    params: z.object({ token: z.string().min(16).max(100) }).strict(),
    handler: async (c) => {
      const inv = await invitationDetails(c.deps, c.params.token);
      if (inv.tenantId !== c.tenant?.id) throw new AppError('INVITATION_EXPIRED');
      return { email: inv.email, role: inv.role, tenantName: inv.name, userExists: inv.userExists };
    },
  }),
  route({
    method: 'post',
    path: '/invitations/:token/accept',
    surfaces: ['tenant'],
    permission: 'public',
    params: z.object({ token: z.string().min(16).max(100) }).strict(),
    body: acceptInvitationBody,
    csrfExempt: true,
    rateLimit: signInLimit,
    handler: async (c) => {
      const inv = await invitationDetails(c.deps, c.params.token);
      if (inv.tenantId !== c.tenant?.id) throw new AppError('INVITATION_EXPIRED');
      const r = await acceptInvitation(c.deps, c.params.token, c.body, client(c));
      return finishSignIn(c, r, 'sid');
    },
  }),
  route({
    method: 'get',
    path: '/tenants',
    surfaces: ['www'],
    permission: 'public',
    handler: async (c) => {
      const s = wwwSession(c);
      const m = await me(c.deps, s.userId, null, s.sessionId);
      return { tenants: m.memberships };
    },
  }),
  route({
    method: 'post',
    path: '/handoff',
    surfaces: ['www'],
    permission: 'public',
    body: handoffBody,
    handler: async (c) => {
      const s = wwwSession(c);
      return createHandoff(c.deps, s.userId, c.body.tenantSlug, c.userAgent, s.mfaVerifiedAt);
    },
  }),
  route({
    method: 'post',
    path: '/handoff/exchange',
    surfaces: ['tenant'],
    permission: 'public',
    body: handoffExchangeBody,
    csrfExempt: true,
    handler: async (c) => finishSignIn(c, await exchangeHandoff(c.deps, c.body.code, client(c), c.tenant!.id), 'sid'),
  }),
  route({
    method: 'post',
    path: '/mfa/totp/enroll',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: totpEnrollBody,
    rateLimit: mfaManageLimit,
    handler: async (c) => (c.actor.kind === 'user' ? enrollTotp(c.deps, c.actor.userId, c.actor.sessionId, c.body, c.ip) : undefined),
  }),
  route({
    method: 'post',
    path: '/mfa/totp/confirm',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: totpConfirmBody,
    rateLimit: mfaManageLimit,
    handler: async (c) => {
      if (c.actor.kind === 'user') await confirmTotp(c.deps, c.actor.userId, c.actor.sessionId, c.body.code, c.ip);
    },
  }),
  route({
    method: 'post',
    path: '/mfa/verify',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: totpConfirmBody,
    rateLimit: signInLimit,
    handler: async (c) => {
      if (c.actor.kind !== 'user') throw new AppError('FORBIDDEN');
      await verifySessionMfa(c.deps, c.actor.userId, c.actor.sessionId, c.body.code, c.ip);
    },
  }),
  route({
    method: 'delete',
    path: '/mfa/totp',
    surfaces: ['tenant'],
    permission: 'account.self',
    body: totpRemoveBody,
    rateLimit: mfaManageLimit,
    handler: async (c) => {
      if (c.actor.kind === 'user') await removeTotp(c.deps, c.actor.userId, c.actor.sessionId, c.body.code, c.ip);
    },
  }),
  route({
    method: 'post',
    path: '/mfa/refresh',
    surfaces: ['console'],
    permission: 'console.tenants.read',
    body: totpConfirmBody,
    // Per session on top of the account's code budget in the service (M-2).
    rateLimit: { name: 'mfa-refresh', points: 10, durationSec: 900, key: 'actor' },
    handler: async (c) => {
      if (c.actor.kind === 'platform') await refreshPlatformMfa(c.deps, c.actor.sessionId, c.actor.platformUserId, c.body.code, c.ip);
    },
  }),
  route({
    method: 'post',
    path: '/platform-invitations/:token/accept',
    surfaces: ['console'],
    permission: 'public',
    params: z.object({ token: z.string().min(16).max(100) }).strict(),
    body: z.object({ password: passwordSchema }).strict(),
    csrfExempt: true,
    rateLimit: signInLimit,
    handler: async (c) => {
      await acceptPlatformInvitation(c.deps, c.params.token, c.body.password);
    },
  }),
]);
