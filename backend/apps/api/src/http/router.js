import { authorize } from '@dop/auth';
import { AppError } from '@dop/contracts';
import { tenantAccess } from '@dop/domain';
import { mfaRequiredFor } from '@dop/services';
export const defineRoutes = (prefix, defs) => ({ prefix, defs });
export const route = (d) => d;
/** Validates request input; failures are 400 VALIDATION_FAILED with field paths (TR-API-03). */
export function parseInput(schema, value, where) {
    if (!schema)
        return undefined;
    const r = schema.safeParse(value ?? {});
    if (!r.success) {
        throw new AppError('VALIDATION_FAILED', `Invalid ${where}`, {
            errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
    }
    return r.data;
}
const STATE_CHANGING = new Set(['post', 'put', 'patch', 'delete']);
export function mount(router, prefix, defs, deps, csrfCheck) {
    for (const d of defs) {
        router[d.method](`${prefix}${d.path}`, async (req, res) => {
            const surface = res.locals.surface;
            if (!d.surfaces.includes(surface.kind))
                throw new AppError('NOT_FOUND');
            const c = {
                req,
                res,
                deps,
                actor: res.locals.actor,
                surface,
                tenant: res.locals.tenant ?? null,
                body: undefined,
                query: undefined,
                params: undefined,
                ip: req.ip ?? '0.0.0.0',
                requestId: res.locals.requestId,
                userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
                host: res.locals.host,
                setCookie: (name, value, maxAgeMs) => res.cookie(cookieName(deps, name), value, cookieOpts(deps, maxAgeMs)),
                clearCookie: (name) => res.clearCookie(cookieName(deps, name), cookieOpts(deps)),
            };
            authorize(c.actor, d.permission);
            // Multi-venue tenants: owners and managers must sign in with two factors (TR-AUTH-11, NFR-SEC-04).
            // Account routes stay open so the user can enrol.
            if (c.actor.kind === 'user' && !c.actor.mfaVerified && d.permission !== 'account.self' && (prefix.startsWith('/api/admin/') || prefix.startsWith('/api/staff/')) && (await mfaRequiredFor(deps, c.actor.tenantId))) {
                throw new AppError('MFA_REQUIRED', 'Set up two-factor sign-in to manage several venues');
            }
            // §8.2: with limited access the admin area offers billing, export and team only.
            if (prefix.startsWith('/api/admin/') && c.tenant) {
                const access = tenantAccess(c.tenant.status).admin;
                if (access === 'none')
                    throw new AppError('NOT_FOUND');
                if (access === 'limited' && !d.limitedAccessOk)
                    throw new AppError(c.tenant.status === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_INACTIVE');
            }
            if (STATE_CHANGING.has(d.method) && !d.csrfExempt && !csrfCheck(c))
                throw new AppError('CSRF_FAILED');
            if (d.rateLimit) {
                const key = d.rateLimit.key === 'ip' ? c.ip : d.rateLimit.key === 'actor' ? actorKey(c.actor) : `${c.ip}:${Object.values(req.params).join(':')}`;
                await deps.rateLimit(d.rateLimit.name, key, d.rateLimit.points, d.rateLimit.durationSec);
            }
            c.params = parseInput(d.params, req.params, 'path');
            c.query = parseInput(d.query, req.query, 'query');
            c.body = parseInput(d.body, req.body, 'body');
            const result = await d.handler(c);
            if (res.headersSent)
                return;
            if (result === undefined)
                res.status(d.status ?? 204).end();
            else
                res.status(d.status ?? 200).json(result);
        });
    }
}
function actorKey(a) {
    switch (a.kind) {
        case 'user':
            return `u:${a.sessionId}`;
        case 'platform':
            return `p:${a.sessionId}`;
        case 'staff_device':
            return `d:${a.deviceId}`;
        case 'display':
            return `x:${a.displayId}`;
        case 'support':
            return `s:${a.supportSessionId}`;
        case 'api_key':
            return `k:${a.apiKeyId}`;
        default:
            return 'anon';
    }
}
/** `__Host-` cookies: Secure, Path=/, no Domain (TR-AUTH-01). Plain names when developing over http. */
export const cookieName = (deps, name) => (deps.insecureCookies ? `dop_${name}` : `__Host-${name}`);
export function cookieOpts(deps, maxAgeMs) {
    return { httpOnly: true, secure: !deps.insecureCookies, sameSite: 'lax', path: '/', ...(maxAgeMs && { maxAge: maxAgeMs }) };
}
