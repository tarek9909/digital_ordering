import { safeEqual } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { csrfFor, slugRedirect } from '@dop/services';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, {} from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFound, requestId, resolveContext } from './http/middleware.js';
import { redactUrl } from './http/redact.js';
import { mount } from './http/router.js';
import { adminRoutes } from './routes/admin.js';
import { adminR11Routes } from './routes/admin-r11.js';
import { adminR2Routes } from './routes/admin-r2.js';
import { v1Routes } from './routes/v1.js';
import { connectorRoutes } from './routes/connectors.js';
import { authR11Routes } from './routes/auth-r11.js';
import { consoleR11Routes } from './routes/console-r11.js';
import { authRoutes } from './routes/auth.js';
import { consoleRoutes } from './routes/console.js';
import { displayRoutes } from './routes/display.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';
export const ROUTE_GROUPS = [publicRoutes, authRoutes, authR11Routes, staffRoutes, displayRoutes, adminRoutes, adminR11Routes, adminR2Routes, consoleRoutes, consoleR11Routes, v1Routes];
/** Synchroniser-token CSRF check for cookie sessions (TR-AUTH-02); SameSite=Lax is the second layer. */
function csrfCheck(c) {
    const header = c.req.headers['x-csrf-token'];
    const sent = typeof header === 'string' ? header : '';
    const a = c.actor;
    let seed = null;
    if (a.kind === 'user')
        seed = a.sessionId;
    else if (a.kind === 'platform')
        seed = a.sessionId;
    else if (a.kind === 'staff_device')
        seed = `dev:${a.deviceId}`;
    else if (a.kind === 'display')
        seed = `dsp:${a.displayId}`;
    else if (a.kind === 'support')
        seed = a.supportSessionId;
    else {
        const s = c.res.locals.wwwSession;
        if (s)
            seed = s.sessionId;
    }
    if (seed === null)
        return true; // no cookie session: nothing to forge
    return sent.length > 0 && safeEqual(sent, csrfFor(c.deps, seed));
}
export function createApp(deps, opts) {
    const app = express();
    app.disable('x-powered-by');
    // Only the listed proxies' forwarding headers are believed; `req.ip` is then the nearest untrusted hop (M-7).
    const trusted = opts.trustProxy;
    app.set('trust proxy', trusted ? (addr) => trusted.has(addr) : false);
    app.use(requestId);
    if (opts.logRequests !== false) {
        app.use(pinoHttp({
            logger: deps.log,
            genReqId: (_req, res) => res.getHeader('X-Request-Id'),
            // TR-SEC-10: no cookies, tokens or ticket tokens in logs.
            redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
            serializers: { req: (r) => ({ method: r.method, url: redactUrl(r.url) }) },
        }));
    }
    app.use(helmet({
        // TR-SEC-02. API responses are JSON; the static apps get their CSP from CloudFront.
        contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } },
        strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        crossOriginOpenerPolicy: { policy: 'same-origin' },
    }));
    app.use((_req, res, next) => {
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
        next();
    });
    app.use(compression());
    // POS webhooks need the raw body for signature checks; mounted before the JSON parser.
    app.use('/connectors', express.raw({ type: '*/*', limit: '1mb' }));
    app.use(express.json({ limit: '100kb' }));
    app.use(cookieParser());
    app.get('/healthz', (_req, res) => {
        res.json({ ok: true });
    });
    app.get('/readyz', async (_req, res) => {
        try {
            await deps.db.platform().selectFrom('plans').select('id').limit(1).execute();
            res.json({ ok: true });
        }
        catch {
            res.status(503).json({ ok: false });
        }
    });
    // Caddy on-demand TLS asks here before issuing a certificate for a host (deploy/Caddyfile). Only the platform
    // hosts and existing tenant slugs get certificates, so nobody can make the server request certificates for
    // arbitrary names. The reverse proxy does not expose /internal publicly.
    app.get('/internal/tls-allowed', async (req, res) => {
        const host = String(req.query.domain ?? '').toLowerCase();
        const d = deps.config.domain;
        const fixed = [d, `www.${d}`, `t.${d}`, `admin.${d}`, `api.${d}`, `files.${d}`];
        if (fixed.includes(host))
            return void res.status(200).end();
        const slug = host.endsWith(`.${d}`) ? host.slice(0, -(d.length + 1)) : '';
        if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug))
            return void res.status(404).end();
        const t = (await deps.db.platform().selectFrom('tenants').select('id').where('slug', '=', slug).where('status', '!=', 'deleted').executeTakeFirst()) ??
            (await slugRedirect(deps, slug));
        res.status(t ? 200 : 404).end();
    });
    app.use(resolveContext(deps, { trustProxy: opts.trustProxy, consoleIpPolicy: opts.consoleIpPolicy }));
    // Per-ticket manifest at its public path (TR-ALR-02).
    app.get('/m/:token.webmanifest', (req, res, next) => {
        req.url = `/api/public/v1/tickets/${req.params.token}/manifest`;
        next();
    });
    const router = express.Router();
    for (const g of ROUTE_GROUPS)
        mount(router, g.prefix, g.defs, deps, csrfCheck);
    mount(router, connectorRoutes.prefix, connectorRoutes.defs, deps, () => true);
    app.use(router);
    app.use(notFound);
    app.use(errorHandler(deps));
    return app;
}
export { AppError };
