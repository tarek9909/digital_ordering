import { AppError } from '@dop/contracts';
import { finishPosConnect, handlePosWebhook } from '@dop/services';
import { z } from 'zod';
import { defineRoutes, route } from '../http/router.js';
// POS connector webhooks on api.{domain}/connectors/{provider}/webhook (TR-INT-04, R2). Signature-verified by
// the connector; tickets go through the same service as the integration API.
const connectors = new Map();
export const registerConnector = (c) => connectors.set(c.provider, c);
export const registeredConnectors = () => connectors;
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
            if (!conn || !Buffer.isBuffer(c.req.body))
                throw new AppError('NOT_FOUND');
            return handlePosWebhook(c.deps, conn, c.req.body, c.req.headers);
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
            const r = await finishPosConnect(c.deps, connectors, c.params.provider, c.query);
            c.res.redirect(302, r.redirect);
        },
    }),
]);
