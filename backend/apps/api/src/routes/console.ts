import { requireFreshMfa } from '@dop/auth';
import {
  AppError,
  auditQuery,
  complimentaryBody,
  consoleCreateTenantBody,
  consoleTenantsQuery,
  deleteTenantBody,
  planDatesBody,
  platformUserCreateBody,
  platformUserPatch,
  purposeHeader,
  reasonBody,
  settingPutBody,
  uuidSchema,
  dateRange,
} from '@dop/contracts';
import {
  auditSearch,
  cancelTenant,
  consolePilotReport,
  createTenantByPlatform,
  deleteTenantByPlatform,
  setPlanDates,
  uploadTenantLogo,
  invitePlatformUser,
  listChimes,
  updateChime,
  uploadChime,
  listLanguages,
  listPlatformUsers,
  listSettings,
  listTenants,
  putSetting,
  reactivateTenant,
  resetPlatformMfa,
  setComplimentary,
  subscriptionReport,
  suspendTenant,
  tenantBillingView,
  tenantDetail,
  updateLanguage,
  updatePlatformUser,
  writeAudit,
} from '@dop/services';
import express from 'express';
import { z } from 'zod';
import { defineRoutes, route, type Ctx } from '../http/router.js';

// Console API (TRD §12.8), MVP scope. Destructive actions need a fresh MFA check (TR-FE-23).

const idP = z.object({ id: uuidSchema }).strict();
type PlatformActor = Extract<Ctx['actor'], { kind: 'platform' }>;

function pa(c: Ctx): PlatformActor {
  if (c.actor.kind !== 'platform') throw new AppError('UNAUTHENTICATED');
  return c.actor;
}

/** The purpose the console asked for (FR-SUP-07), sent as `X-Purpose`. */
function purpose(c: Ctx) {
  const r = purposeHeader.safeParse(c.req.headers['x-purpose']);
  if (!r.success) throw new AppError('VALIDATION_FAILED', 'Choose a purpose before opening tenant data', { errors: [{ path: 'X-Purpose', message: 'required' }] });
  return r.data;
}

const consoleLimit = { name: 'console', points: 20, durationSec: 1, key: 'actor' as const };

export const consoleRoutes = defineRoutes('/api/console/v1', [
  route({
    method: 'get',
    path: '/tenants',
    surfaces: ['console'],
    permission: 'console.tenants.read',
    query: consoleTenantsQuery,
    rateLimit: consoleLimit,
    handler: async (c) => listTenants(c.deps, c.query),
  }),
  route({
    method: 'get',
    path: '/tenants/:id',
    surfaces: ['console'],
    permission: 'console.tenants.read',
    params: idP,
    handler: async (c) => tenantDetail(c.deps, pa(c), c.params.id, purpose(c), c.requestId),
  }),
  route({
    method: 'post',
    path: '/tenants',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    body: consoleCreateTenantBody,
    status: 201,
    handler: async (c) => createTenantByPlatform(c.deps, pa(c), c.body, c.requestId),
  }),
  route({
    method: 'patch',
    path: '/tenants/:id',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    body: z.object({ name: z.string().trim().min(1).max(120) }).strict(),
    handler: async (c) => {
      const a = pa(c);
      await c.deps.db.platform().transaction().execute(async (tx) => {
        const r = await tx.updateTable('tenants').set({ name: c.body.name }).where('id', '=', c.params.id).executeTakeFirst();
        if (Number(r.numUpdatedRows) === 0) throw new AppError('NOT_FOUND');
        await writeAudit(tx, { actor: a, action: 'tenant.updated', tenantId: c.params.id, entityType: 'tenant', entityId: c.params.id, after: c.body, requestId: c.requestId });
      });
    },
  }),
  route({
    method: 'post',
    path: '/tenants/:id/suspend',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    body: reasonBody,
    handler: async (c) => {
      await suspendTenant(c.deps, c.params.id, pa(c), c.body.reason, c.requestId);
    },
  }),
  route({
    method: 'post',
    path: '/tenants/:id/reactivate',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    handler: async (c) => {
      await reactivateTenant(c.deps, c.params.id, pa(c), c.requestId);
    },
  }),
  route({
    method: 'post',
    path: '/tenants/:id/plan-dates',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    body: planDatesBody,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // moving the end date grants or removes access time, like free months (L-6)
      await setPlanDates(c.deps, pa(c), c.params.id, c.body.planStartsAt, c.body.planEndsAt);
    },
  }),
  route({
    method: 'post',
    path: '/tenants/:id/logo',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    rateLimit: { name: 'logo', points: 10, durationSec: 600, key: 'actor' },
    handler: async (c) => {
      // The image is the raw request body (Content-Type image/png | image/jpeg | image/webp, ≤ 2 MB).
      const body: unknown = await new Promise((resolve, reject) =>
        express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' })(c.req, c.res, (err?: unknown) => (err ? reject(err) : resolve(c.req.body))),
      ).catch(() => {
        throw new AppError('UPLOAD_INVALID', 'Logo must be a PNG, JPEG or WebP image of 2 MB or less');
      });
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('UPLOAD_INVALID', 'Send the image as the request body');
      return uploadTenantLogo(c.deps, c.deps.storage, pa(c), c.params.id, body);
    },
  }),
  route({
    method: 'post',
    path: '/tenants/:id/complimentary',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    body: complimentaryBody,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // unlimited free access (L-6)
      await setComplimentary(c.deps, pa(c), c.params.id, c.body.enabled);
    },
  }),
  route({
    method: 'post',
    path: '/tenants/:id/cancel',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    body: reasonBody,
    handler: async (c) => {
      // Privilege and lifecycle changes need a recent second factor too (L-6).
      requireFreshMfa(pa(c), c.deps.now());
      await cancelTenant(c.deps, pa(c), c.params.id, c.body.reason);
    },
  }),
  route({
    method: 'delete',
    path: '/tenants/:id',
    surfaces: ['console'],
    permission: 'console.tenants.lifecycle',
    params: idP,
    body: deleteTenantBody,
    handler: async (c) => {
      const a = pa(c);
      requireFreshMfa(a, c.deps.now());
      await deleteTenantByPlatform(c.deps, a, c.params.id, c.body.confirmSlug);
    },
  }),
  route({
    method: 'get',
    path: '/tenants/:id/billing',
    surfaces: ['console'],
    permission: 'console.billing.read',
    params: idP,
    handler: async (c) => {
      purpose(c);
      return tenantBillingView(c.deps, c.params.id);
    },
  }),
  route({ method: 'get', path: '/reports/subscriptions', surfaces: ['console'], permission: 'console.reports', handler: async (c) => subscriptionReport(c.deps) }),
  route({
    method: 'get',
    path: '/reports/pilot',
    surfaces: ['console'],
    permission: 'console.reports',
    query: dateRange({ tenantIds: z.string().max(4000).transform((s) => s.split(',').filter(Boolean)) }),
    handler: async (c) => ({ items: await consolePilotReport(c.deps, c.query.tenantIds, c.query.from, c.query.to) }),
  }),
  route({ method: 'get', path: '/audit', surfaces: ['console'], permission: 'console.audit', query: auditQuery, handler: async (c) => auditSearch(c.deps, c.query) }),

  // ---- platform users
  route({ method: 'get', path: '/platform-users', surfaces: ['console'], permission: 'console.platform_users', handler: async (c) => ({ items: await listPlatformUsers(c.deps) }) }),
  route({
    method: 'post',
    path: '/platform-users',
    surfaces: ['console'],
    permission: 'console.platform_users',
    body: platformUserCreateBody,
    status: 201,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // granting console access (L-6)
      return invitePlatformUser(c.deps, pa(c), c.body.email, c.body.name, c.body.role, c.body.password);
    },
  }),
  route({
    method: 'patch',
    path: '/platform-users/:id',
    surfaces: ['console'],
    permission: 'console.platform_users',
    params: idP,
    body: platformUserPatch,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // role and status changes (L-6)
      await updatePlatformUser(c.deps, pa(c), c.params.id, c.body);
    },
  }),
  route({
    method: 'post',
    path: '/platform-users/:id/reset-mfa',
    surfaces: ['console'],
    permission: 'console.platform_users',
    params: idP,
    handler: async (c) => {
      const a = pa(c);
      requireFreshMfa(a, c.deps.now());
      await resetPlatformMfa(c.deps, a, c.params.id);
    },
  }),

  // ---- settings, chimes, languages
  route({ method: 'get', path: '/settings', surfaces: ['console'], permission: 'console.settings', handler: async (c) => ({ items: await listSettings(c.deps) }) }),
  route({
    method: 'put',
    path: '/settings/:key',
    surfaces: ['console'],
    permission: 'console.settings',
    params: z.object({ key: z.string().min(1).max(80) }).strict(),
    body: settingPutBody,
    handler: async (c) => {
      requireFreshMfa(pa(c), c.deps.now()); // platform-wide settings, maintenance mode and the IP allow-list (L-6)
      await putSetting(c.deps, pa(c), c.params.key, c.body.value, { ip: c.ip });
    },
  }),
  route({ method: 'get', path: '/chimes', surfaces: ['console'], permission: 'console.settings', handler: async (c) => ({ items: await listChimes(c.deps) }) }),
  // Chime library (FR-SA-12, W11): the MP3 is the raw request body; name and length come in the query.
  route({
    method: 'put',
    path: '/chimes/:code',
    surfaces: ['console'],
    permission: 'console.settings',
    params: z.object({ code: z.string().regex(/^[a-z0-9-]{2,40}$/) }).strict(),
    query: z.object({ name: z.string().trim().min(1).max(80), durationMs: z.coerce.number().int().min(100).max(3000) }).strict(),
    rateLimit: { name: 'chime', points: 20, durationSec: 600, key: 'actor' },
    handler: async (c) => {
      const body: unknown = await new Promise((resolve, reject) =>
        express.raw({ type: ['audio/mpeg', 'audio/mp3'], limit: '512kb' })(c.req, c.res, (err?: unknown) => (err ? reject(err) : resolve(c.req.body))),
      ).catch(() => {
        throw new AppError('UPLOAD_INVALID', 'A chime must be an MP3 of 512 KB or less');
      });
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError('UPLOAD_INVALID', 'Send the MP3 as the request body');
      return uploadChime(c.deps, c.deps.storage, pa(c), { code: c.params.code, name: c.query.name, durationMs: c.query.durationMs }, body);
    },
  }),
  route({
    method: 'patch',
    path: '/chimes/:id',
    surfaces: ['console'],
    permission: 'console.settings',
    params: z.object({ id: uuidSchema }).strict(),
    body: z.object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() }).strict(),
    handler: async (c) => {
      await updateChime(c.deps, pa(c), c.params.id, c.body);
    },
  }),
  route({ method: 'get', path: '/languages', surfaces: ['console'], permission: 'console.settings', handler: async (c) => ({ items: await listLanguages(c.deps) }) }),
  route({
    method: 'patch',
    path: '/languages/:code',
    surfaces: ['console'],
    permission: 'console.settings',
    params: z.object({ code: z.string().min(2).max(10) }).strict(),
    body: z.object({ customerEnabled: z.boolean().optional(), ttsLang: z.string().max(10).nullable().optional() }).strict(),
    handler: async (c) => {
      await updateLanguage(c.deps, pa(c), c.params.code, c.body);
    },
  }),
]);
