import { COOKIES, SESSION_TTL } from '@dop/auth';
import { AppError, deleteMeBody } from '@dop/contracts';
import { newSecretToken } from '@dop/domain';
import { deleteOwnAccount, exchangeSupportHandoff, finishOidc, linkGoogleIdentity, startOidc, type OidcProvider } from '@dop/services';
import { z } from 'zod';
import { cookieName, defineRoutes, route } from '../http/router.js';

/** Host-only cookie on www that ties a Google sign-in to the browser that started it (M-17). */
const OIDC_COOKIE = 'oidc';
const OIDC_TTL_MS = 10 * 60_000;

// Auth API, R1.1 additions (TRD §12.4): Google sign-in, account deletion, support-session handoff.

let google: OidcProvider | null = null;
/** Set at start-up when GOOGLE_CLIENT_ID/SECRET exist; tests inject a fake provider. */
export const setGoogleProvider = (p: OidcProvider | null) => {
  google = p;
};

export const authR11Routes = defineRoutes('/api/auth/v1', [
  route({
    method: 'get',
    path: '/oauth/google/start',
    surfaces: ['www', 'tenant'],
    permission: 'public',
    rateLimit: { name: 'oauth', points: 30, durationSec: 600, key: 'ip' },
    query: z.object({ from: z.string().max(100).optional() }).strict(),
    handler: async (c) => {
      if (!google) throw new AppError('NOT_FOUND', 'Google sign-in is not configured');
      const www = `www.${c.deps.config.domain}`;
      const base = `${c.deps.config.scheme}://${www}/api/auth/v1/oauth/google`;
      // The browser binding cookie must live on www, where the callback lands (M-17): a start on a tenant host
      // passes through www first.
      if (c.surface.kind !== 'www') return void c.res.redirect(302, `${base}/start?from=${encodeURIComponent(c.host)}`);
      const from = c.query.from;
      const returnHost = from && (from === www || new RegExp(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.${c.deps.config.domain.replace(/\./g, '\\.')}$`).test(from)) ? from : www;
      const binding = newSecretToken();
      c.setCookie(OIDC_COOKIE, binding, OIDC_TTL_MS);
      c.res.redirect(302, await startOidc(c.deps, google, `${base}/callback`, returnHost, binding));
    },
  }),
  route({
    method: 'get',
    path: '/oauth/google/callback',
    surfaces: ['www'],
    permission: 'public',
    rateLimit: { name: 'oauth', points: 30, durationSec: 600, key: 'ip' },
    handler: async (c) => {
      if (!google) throw new AppError('NOT_FOUND');
      const redirectUri = `${c.deps.config.scheme}://www.${c.deps.config.domain}/api/auth/v1/oauth/google/callback`;
      const current = new URL(`${redirectUri}?${new URLSearchParams(c.req.query as Record<string, string>).toString()}`);
      const binding = (c.req.cookies as Record<string, string> | undefined)?.[cookieName(c.deps, OIDC_COOKIE)];
      c.clearCookie(OIDC_COOKIE);
      const r = await finishOidc(c.deps, google, current, redirectUri, { ip: c.ip, userAgent: c.userAgent, host: c.host }, binding);
      if (r.kind === 'no_account') {
        // No Tanbeeh account uses this Google address; nothing was created (AS02).
        c.res.redirect(302, '/sign-in?google=no-account');
        return;
      }
      if (r.kind === 'link_required') {
        // An account with this email has a password: the sign-in page asks for it before linking (M-1).
        c.res.redirect(302, `/sign-in?link=google#link=${encodeURIComponent(r.linkToken)}`);
        return;
      }
      if (r.kind === 'mfa') {
        // Enrolled authenticator (A03): the sign-in page asks for the code. The single-use, short-lived token
        // travels in the fragment, which is never sent to a server or in a Referer header.
        c.res.redirect(302, `/sign-in#mfa=${encodeURIComponent(r.mfaToken)}`);
        return;
      }
      if (r.kind === 'session') c.setCookie(COOKIES.user, r.token, SESSION_TTL.userAbsoluteMs);
      // The www session leads to the tenant chooser, which hands off to the tenant host (TR-AUTH-06).
      c.res.redirect(302, '/sign-in?chooser=1');
    },
  }),
  route({
    method: 'post',
    path: '/oauth/google/link',
    surfaces: ['www'],
    permission: 'public',
    body: z.object({ linkToken: z.string().min(16).max(100), password: z.string().min(1).max(128) }).strict(),
    csrfExempt: true,
    rateLimit: { name: 'signin', points: 30, durationSec: 900, key: 'ip' },
    handler: async (c) => {
      const r = await linkGoogleIdentity(c.deps, c.body.linkToken, c.body.password, { ip: c.ip, userAgent: c.userAgent, host: c.host });
      if (r.kind !== 'session') return { mfaRequired: r.kind === 'mfa', mfaEnrollmentRequired: false, mfaToken: r.mfaToken };
      c.setCookie(COOKIES.user, r.token, SESSION_TTL.userAbsoluteMs);
      return { ok: true };
    },
  }),
  route({
    method: 'delete',
    path: '/me',
    surfaces: ['tenant', 'www'],
    permission: 'public',
    body: deleteMeBody,
    // On www the session is not an actor, so the address is the key; the password itself has a per-account budget.
    rateLimit: { name: 'account-deletion', points: 10, durationSec: 3600, key: 'ip' },
    handler: async (c) => {
      const userId = c.actor.kind === 'user' ? c.actor.userId : (c.res.locals.wwwSession as { userId?: string } | undefined)?.userId;
      if (!userId) throw new AppError('UNAUTHENTICATED');
      await deleteOwnAccount(c.deps, userId, c.body.password);
      c.clearCookie(COOKIES.user);
    },
  }),
  route({
    method: 'post',
    path: '/support/exchange',
    surfaces: ['tenant'],
    permission: 'public',
    body: z.object({ code: z.string().min(16).max(100) }).strict(),
    csrfExempt: true,
    handler: async (c) => {
      const r = await exchangeSupportHandoff(c.deps, c.body.code, c.tenant!.id, c.userAgent);
      c.setCookie(COOKIES.support, r.token, r.maxAgeMs);
      return { ok: true };
    },
  }),
]);
