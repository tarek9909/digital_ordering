import type { Actor } from '@dop/auth';
import { freezeActor } from '@dop/auth';
import { AppError, ERROR_CODES, isAppError, type ProblemDetails, type TenantStatus } from '@dop/contracts';
import { tenantAccess, uuidv7 } from '@dop/domain';
import { enforceConsoleAllowList, getSetting, getTenantStatus, membershipFor, resolveApiKey, staffMemberFor, resolvePlatformSession, resolveStaffDevice, resolveSupport, resolveUserSession, resolveDisplay, slugRedirect } from '@dop/services';
import type { IpRules } from '@dop/config';
import type { NextFunction, Request, Response } from 'express';
import { redactPath } from './redact.js';
import { cookieName, type ApiDeps, type TenantInfo } from './router.js';
import { bareHost, surfaceOf } from './surface.js';

// Middleware in TRD order (TR-API-07): requestId → logger → helmet → compression → json → cookies →
// (rate limits per route) → resolveActor → resolveTenant → tenant status (per route / service) → csrf (per route).

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : uuidv7();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

const tenantCache = new Map<string, { t: TenantInfo | null; at: number }>();

async function tenantBySlug(deps: ApiDeps, slug: string): Promise<TenantInfo | null> {
  const hit = tenantCache.get(slug);
  const now = Date.now();
  if (hit && now - hit.at < 10_000) {
    if (!hit.t) return null;
    const status = (await getTenantStatus(deps, hit.t.id)) ?? hit.t.status;
    return { ...hit.t, status };
  }
  const row = await deps.db.platform().selectFrom('tenants').select(['id', 'slug', 'name', 'status']).where('slug', '=', slug).executeTakeFirst();
  const t = row && row.status !== 'deleted' ? { id: row.id, slug: row.slug, name: row.name, status: row.status as TenantStatus } : null;
  tenantCache.set(slug, { t, at: now });
  return t;
}

export const clearTenantCache = () => tenantCache.clear();

function mismatch(deps: ApiDeps, req: Request, credentialTenant: string, hostTenant: string): never {
  // TR-TEN-02: never confirm the resource exists; log as a security event (TR-SEC-14).
  deps.log.warn({ security: true, event: 'TENANT_MISMATCH', credentialTenant, hostTenant, path: redactPath(req.path) }, 'tenant mismatch');
  throw new AppError('NOT_FOUND');
}

export function resolveContext(deps: ApiDeps, opts: { trustProxy: IpRules | false; consoleIpPolicy?: 'enforce' | 'off' }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // X-Forwarded-Host only from a configured proxy (the Vite dev proxy locally); anyone else's is ignored (M-7).
    const viaProxy = opts.trustProxy !== false && opts.trustProxy.has(req.socket.remoteAddress ?? '');
    const rawHost = (viaProxy && typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : req.headers.host) ?? '';
    const host = bareHost(rawHost);
    const surface = surfaceOf(host, deps.config.domain);
    res.locals.host = host;
    res.locals.surface = surface;
    let actor: Actor = { kind: 'anonymous' };
    let tenant: TenantInfo | null = null;
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    const cookie = (n: string) => cookies[cookieName(deps, n)];
    const path = req.path;

    if (path === '/healthz' || path === '/readyz') return next();

    // Console allow-list (M-18) before anything else on the console host, sign-in included; `req.ip` honours only
    // configured proxies, so a client cannot choose the address that is checked.
    if (surface.kind === 'console' && opts.consoleIpPolicy !== 'off') await enforceConsoleAllowList(deps, req.ip ?? '');

    // Planned maintenance: every app shows the maintenance message; the console keeps working (TR-OPS-01).
    const maintenance = await getSetting(deps, 'maintenance');
    if (maintenance.enabled && surface.kind !== 'console') {
      throw new AppError('MAINTENANCE', undefined, { data: { message: maintenance.message, until: maintenance.until } });
    }

    if (surface.kind === 'tenant') {
      tenant = await tenantBySlug(deps, surface.slug);
      if (!tenant) {
        // A changed slug redirects for 180 days (TR-URL-03); API calls get 404 so clients re-resolve.
        const to = req.method === 'GET' && !path.startsWith('/api/') ? await slugRedirect(deps, surface.slug) : null;
        if (to) return res.redirect(301, `${req.protocol}://${to}.${deps.config.domain}${req.originalUrl}`);
        throw new AppError('NOT_FOUND');
      }
      const t = tenant;
      if (path.startsWith('/api/staff/') && cookie('dev')) {
        const d = await resolveStaffDevice(deps, cookie('dev')!);
        if (d) {
          if (d.tenant_id !== t.id) mismatch(deps, req, d.tenant_id, t.id);
          actor = { kind: 'staff_device', deviceId: d.id, tenantId: d.tenant_id, venueId: d.venue_id, deviceName: d.name };
          // Named staff (R2): a personal-PIN token identifies the person for this action group (TR-AUTH-12).
          const mt = req.headers['x-staff-member'];
          if (typeof mt === 'string' && mt) {
            const m = await staffMemberFor(deps, mt, d.id, d.tenant_id);
            if (m) actor = { ...actor, member: { id: m.memberId, name: m.name } };
          }
        }
      }
      if (actor.kind === 'anonymous' && path.startsWith('/api/display/') && cookie('dsp')) {
        const d = await resolveDisplay(deps, cookie('dsp')!);
        if (d) {
          if (d.tenant_id !== t.id) mismatch(deps, req, d.tenant_id, t.id);
          actor = { kind: 'display', displayId: d.id, tenantId: d.tenant_id, venueId: d.venue_id };
        }
      }
      // Platform support inside an approved session (BR-19, TR-AUTH-12); the cookie is set by the handoff. Sign-out
      // too when there is no user session, so dropping the support credential is CSRF-checked like the rest (L-8).
      const supportPath = path.startsWith('/api/admin/') || path.startsWith('/api/staff/') || path === '/api/auth/v1/me' || path === '/api/auth/v1/support/leave' || (path === '/api/auth/v1/sign-out' && !cookie('sid'));
      if (actor.kind === 'anonymous' && cookie('sup') && supportPath) {
        const s = await resolveSupport(deps, cookie('sup')!, t.id);
        if (s) actor = s;
      }
      if (actor.kind === 'anonymous' && cookie('sid')) {
        const s = await resolveUserSession(deps, cookie('sid')!, host);
        if (s) {
          if (s.tenantId !== t.id) mismatch(deps, req, s.tenantId ?? 'none', t.id);
          const m = await membershipFor(deps, s.userId, t.id);
          if (m) actor = { kind: 'user', userId: s.userId, tenantId: t.id, role: m.role, sessionId: s.sessionId, mfaVerified: s.mfaVerified };
        }
      }
    } else if (surface.kind === 'www' && cookie('sid')) {
      const s = await resolveUserSession(deps, cookie('sid')!, host);
      // On www the session has no tenant: it can only list tenants and hand off (TR-TEN-13).
      if (s && s.tenantId === null) res.locals.wwwSession = s;
    } else if (surface.kind === 'integration') {
      // Integration API: `Authorization: Bearer pk_live_…` (§6.2). Webhook and connector routes use signatures.
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        const k = await resolveApiKey(deps, auth.slice(7).trim());
        if (!k) throw new AppError('UNAUTHENTICATED', 'Invalid API key');
        const status = await getTenantStatus(deps, k.tenantId);
        if (!status || status === 'deleted') throw new AppError('UNAUTHENTICATED');
        // §8.2 API access by status, for reads as well as writes: none in a trial, after it expired or after
        // cancellation; read-only while suspended.
        const api = tenantAccess(status).api;
        if (api === 'none' || api === 'unauthenticated') throw new AppError('TENANT_INACTIVE');
        if (api === 'read_only' && req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('TENANT_SUSPENDED');
        actor = k;
      }
    } else if (surface.kind === 'console' && cookie('psid')) {
      const s = await resolvePlatformSession(deps, cookie('psid')!);
      if (s) {
        actor = { kind: 'platform', platformUserId: s.platformUserId, role: s.role, sessionId: s.sessionId, mfaVerifiedAt: s.mfaVerifiedAt };
        res.locals.platformName = s.name;
      }
    }
    res.locals.actor = freezeActor(actor);
    res.locals.tenant = tenant;
    next();
  };
}

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError('NOT_FOUND'));
}

/** RFC 9457 problem+json (TR-API-03). Unknown errors become INTERNAL_ERROR with the request ID only. */
export function errorHandler(deps: ApiDeps) {
  // Express recognises error middleware by its four parameters.
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = res.locals.requestId as string | undefined;
    let problem: ProblemDetails;
    if (isAppError(err)) {
      problem = {
        type: `https://docs.${deps.config.domain}/errors/${err.code}`,
        title: ERROR_CODES[err.code].title,
        status: err.status,
        code: err.code,
        detail: err.message,
        requestId,
        ...(err.data !== undefined && { data: err.data }),
        ...(err.errors && { errors: err.errors }),
      };
      if (err.code === 'RATE_LIMITED' && typeof (err.data as { retryAfterSec?: number })?.retryAfterSec === 'number') {
        res.setHeader('Retry-After', String((err.data as { retryAfterSec: number }).retryAfterSec));
      }
    } else if ((err as { type?: string }).type === 'entity.too.large' || (err as { type?: string }).type === 'entity.parse.failed') {
      problem = { type: `https://docs.${deps.config.domain}/errors/VALIDATION_FAILED`, title: ERROR_CODES.VALIDATION_FAILED.title, status: 400, code: 'VALIDATION_FAILED', detail: 'Malformed or too large body', requestId };
    } else {
      deps.log.error({ err, requestId, path: redactPath(req.path) }, 'unhandled error');
      problem = { type: `https://docs.${deps.config.domain}/errors/INTERNAL_ERROR`, title: ERROR_CODES.INTERNAL_ERROR.title, status: 500, code: 'INTERNAL_ERROR', requestId };
    }
    res.status(problem.status).type('application/problem+json').send(JSON.stringify(problem));
  };
}
