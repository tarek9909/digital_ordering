import { AppError } from '@dop/contracts';
import { finishPosConnect, handlePosWebhook, type PosConnector } from '@dop/services';
import type { CookieOptions } from 'express';
import { z } from 'zod';
import { defineRoutes, route, type ApiDeps } from '../http/router.js';

// POS connector webhooks on api.{domain}/connectors/{provider}/webhook (TR-INT-04, R2). Signature-verified by
// the connector; tickets go through the same service as the integration API.

const connectors = new Map<string, PosConnector>();
export const registerConnector = (c: PosConnector) => connectors.set(c.provider, c);
export const registeredConnectors = () => connectors;

/**
 * Browser binding of a POS connection: set on the tenant host when the owner starts, read on the API host when the
 * provider sends them back, so it is a cookie of the platform domain limited to the callback paths (no `__Host-`).
 */
export const posBindingCookie = (deps: Pick<ApiDeps, 'insecureCookies'>) => (deps.insecureCookies ? 'dop_posbind' : '__Secure-posbind');
export const posBindingOpts = (deps: Pick<ApiDeps, 'insecureCookies' | 'config'>, maxAgeMs?: number): CookieOptions => ({
  httpOnly: true,
  secure: !deps.insecureCookies,
  sameSite: 'lax',
  domain: deps.config.domain,
  path: '/connectors/',
  ...(maxAgeMs && { maxAge: maxAgeMs }),
});

export const connectorRoutes = defineRoutes('/connectors', [
  route({
    method: 'post',
    path: '/:provider/webhook',
    surfaces: ['integration'],
    permission: 'public',
    params: z.object({ provider: z.string().regex(/^[a-z0-9-]{2,40}$/) }).strict(),
    csrfExempt: true,
    rateLimit: { name: 'pos-webhook', points: 600, durationSec: 60, key: 'ip' },
    handler: async (c) => {
      const conn = connectors.get(c.params.provider);
      if (!conn || !Buffer.isBuffer(c.req.body)) throw new AppError('NOT_FOUND');
      return handlePosWebhook(c.deps, conn, c.req.body, c.req.headers as Record<string, string | undefined>);
    },
  }),
  // OAuth return (W01): the state carries the tenant, venue and owner; the owner lands back on the admin page.
  route({
    method: 'get',
    path: '/:provider/callback',
    surfaces: ['integration'],
    permission: 'public',
    params: z.object({ provider: z.string().regex(/^[a-z0-9-]{2,40}$/) }).strict(),
    query: z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).passthrough(),
    rateLimit: { name: 'pos-callback', points: 30, durationSec: 600, key: 'ip' },
    handler: async (c) => {
      const binding = (c.req.cookies as Record<string, string> | undefined)?.[posBindingCookie(c.deps)];
      c.res.clearCookie(posBindingCookie(c.deps), posBindingOpts(c.deps));
      const r = await finishPosConnect(c.deps, connectors, c.params.provider, c.query, binding);
      c.res.redirect(302, r.redirect);
    },
  }),
]);
