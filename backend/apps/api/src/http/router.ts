import type { Actor, Permission } from '@dop/auth';
import { authorize } from '@dop/auth';
import { AppError, type TenantStatus } from '@dop/contracts';
import { tenantAccess } from '@dop/domain';
import { mfaRequiredFor, type Deps, type ObjectStorage } from '@dop/services';
import type { CookieOptions, Request, Response, Router } from 'express';
import type { ZodTypeAny, z } from 'zod';
import type { Surface } from './surface.js';

// Route registry (TR-CODE-02, TR-AUTH-09): route → validation → handler → service. Every route declares its
// permission and surfaces; a test asserts none lacks one and generates the cross-tenant suite from this list.

export type SurfaceKind = Surface['kind'];

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
}

export interface Ctx<B = unknown, Q = unknown, P = unknown> {
  req: Request;
  res: Response;
  deps: ApiDeps;
  actor: Actor;
  surface: Surface;
  tenant: TenantInfo | null;
  body: B;
  query: Q;
  params: P;
  ip: string;
  requestId: string;
  userAgent: string;
  host: string;
  setCookie(name: string, value: string, maxAgeMs?: number): void;
  clearCookie(name: string): void;
}

export interface ApiDeps extends Deps {
  insecureCookies: boolean;
  storage: ObjectStorage;
  rateLimit(name: string, key: string, points: number, durationSec: number): Promise<void>;
}

export interface RouteDef<B extends ZodTypeAny | undefined, Q extends ZodTypeAny | undefined, P extends ZodTypeAny | undefined> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  surfaces: SurfaceKind[];
  permission: Permission;
  body?: B;
  query?: Q;
  params?: P;
  status?: number;
  /** Admin sections reachable while the tenant has limited access (§8.2: billing, export, team). */
  limitedAccessOk?: boolean;
  /** State-changing requests from cookie sessions need X-CSRF-Token unless exempt (sign-in, pairing). */
  csrfExempt?: boolean;
  rateLimit?: { name: string; points: number; durationSec: number; key: 'ip' | 'actor' | 'ip+param' };
  /** Marks a route as reaching a tenant resource by ID/token: included in the cross-tenant suite. */
  tenantResource?: boolean;
  handler: (
    c: Ctx<B extends ZodTypeAny ? z.infer<B> : undefined, Q extends ZodTypeAny ? z.infer<Q> : undefined, P extends ZodTypeAny ? z.infer<P> : undefined>,
  ) => Promise<unknown>;
}

// Using `any` for the registry is deliberate: each def keeps its own generic types at definition time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRoute = RouteDef<any, any, any>;

export interface RouteGroup {
  prefix: string;
  defs: AnyRoute[];
}

export const defineRoutes = (prefix: string, defs: AnyRoute[]): RouteGroup => ({ prefix, defs });

export const route = <B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined, P extends ZodTypeAny | undefined = undefined>(
  d: RouteDef<B, Q, P>,
): AnyRoute => d as AnyRoute;

/** Validates request input; failures are 400 VALIDATION_FAILED with field paths (TR-API-03). */
export function parseInput<T extends ZodTypeAny>(schema: T | undefined, value: unknown, where: string): unknown {
  if (!schema) return undefined;
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw new AppError('VALIDATION_FAILED', `Invalid ${where}`, {
      errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

const STATE_CHANGING = new Set(['post', 'put', 'patch', 'delete']);

export function mount(router: Router, prefix: string, defs: AnyRoute[], deps: ApiDeps, csrfCheck: (c: Ctx) => boolean) {
  for (const d of defs) {
    router[d.method](`${prefix}${d.path}`, async (req: Request, res: Response) => {
      const surface = res.locals.surface as Surface;
      if (!d.surfaces.includes(surface.kind)) throw new AppError('NOT_FOUND');
      const c: Ctx = {
        req,
        res,
        deps,
        actor: res.locals.actor as Actor,
        surface,
        tenant: (res.locals.tenant as TenantInfo | null) ?? null,
        body: undefined,
        query: undefined,
        params: undefined,
        ip: req.ip ?? '0.0.0.0',
        requestId: res.locals.requestId as string,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        host: res.locals.host as string,
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
        if (access === 'none') throw new AppError('NOT_FOUND');
        if (access === 'limited' && !d.limitedAccessOk) throw new AppError(c.tenant.status === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_INACTIVE');
      }
      // §8.2: with staff access off (trial expired, cancelled) the board, search, QR codes and claims are closed too,
      // not only ticket changes; signing a device out stays possible. Same rule as the realtime handshake.
      if (prefix.startsWith('/api/staff/') && c.tenant && tenantAccess(c.tenant.status).staff === 'off' && d.method !== 'delete') {
        throw new AppError('TENANT_INACTIVE');
      }
      if (STATE_CHANGING.has(d.method) && !d.csrfExempt && !csrfCheck(c)) throw new AppError('CSRF_FAILED');
      if (d.rateLimit) {
        const key = d.rateLimit.key === 'ip' ? c.ip : d.rateLimit.key === 'actor' ? actorKey(c.actor) : `${c.ip}:${Object.values(req.params).join(':')}`;
        await deps.rateLimit(d.rateLimit.name, key, d.rateLimit.points, d.rateLimit.durationSec);
      }
      c.params = parseInput(d.params, req.params, 'path');
      c.query = parseInput(d.query, req.query, 'query');
      c.body = parseInput(d.body, req.body, 'body');
      const result = await d.handler(c as never);
      if (res.headersSent) return;
      if (result === undefined) res.status(d.status ?? 204).end();
      else res.status(d.status ?? 200).json(result);
    });
  }
}

function actorKey(a: Actor): string {
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
export const cookieName = (deps: Pick<ApiDeps, 'insecureCookies'>, name: string) => (deps.insecureCookies ? `dop_${name}` : `__Host-${name}`);

export function cookieOpts(deps: Pick<ApiDeps, 'insecureCookies'>, maxAgeMs?: number): CookieOptions {
  return { httpOnly: true, secure: !deps.insecureCookies, sameSite: 'lax', path: '/', ...(maxAgeMs && { maxAge: maxAgeMs }) };
}
