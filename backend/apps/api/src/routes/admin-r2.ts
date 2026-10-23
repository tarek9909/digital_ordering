import { AppError, dateRange, uuidSchema } from '@dop/contracts';
import {
  archiveVenue,
  createApiKey,
  createStaffMember,
  createVenue,
  createWebhook,
  deactivateStaffMember,
  deleteWebhook,
  listApiKeys,
  listDeliveries,
  listPosConnections,
  removePosConnection,
  startPosConnect,
  listStaffMembers,
  listWebhooks,
  redeliver,
  revokeApiKey,
  testWebhook,
  ticketsCsv,
  updateWebhook,
} from '@dop/services';
import { z } from 'zod';
import { defineRoutes, route, type Ctx } from '../http/router.js';
import { posBindingCookie, posBindingOpts, registeredConnectors } from './connectors.js';

// Tenant admin API, R2 additions (TRD §12.7): venues (multi-site), API keys, webhooks, POS connections, named
// staff, CSV export.

const idP = z.object({ id: uuidSchema }).strict();
function owner(c: Ctx) {
  if (c.actor.kind !== 'user') throw new AppError('FORBIDDEN');
  return c.actor;
}
function tenant(c: Ctx) {
  if (c.actor.kind !== 'user' && c.actor.kind !== 'support') throw new AppError('UNAUTHENTICATED');
  return c.actor;
}

export const adminR2Routes = defineRoutes('/api/admin/v1', [
  // Venues (FR-TEN-07/10, FR-ADM-17)
  // A venue changes the subscription quantity, so only the owner creates one, as with archiving (M-9).
  route({ method: 'post', path: '/venues', surfaces: ['tenant'], permission: 'billing.manage', body: z.object({ name: z.string().trim().min(1).max(120) }).strict(), status: 201, handler: async (c) => createVenue(c.deps, owner(c), owner(c).tenantId, c.body.name) }),
  route({
    method: 'post',
    path: '/venues/:id/archive',
    surfaces: ['tenant'],
    permission: 'billing.manage',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await archiveVenue(c.deps, owner(c), owner(c).tenantId, c.params.id);
    },
  }),

  // API keys (owner; FR-INT-01, TR-INT-03)
  route({ method: 'get', path: '/venues/:id/api-keys', surfaces: ['tenant'], permission: 'integrations.view', params: idP, tenantResource: true, handler: async (c) => ({ items: await listApiKeys(c.deps, tenant(c).tenantId, c.params.id) }) }),
  route({
    method: 'post',
    path: '/venues/:id/api-keys',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: idP,
    body: z.object({ name: z.string().trim().min(1).max(60) }).strict(),
    status: 201,
    tenantResource: true,
    handler: async (c) => createApiKey(c.deps, owner(c), owner(c).tenantId, c.params.id, c.body.name),
  }),
  route({
    method: 'delete',
    path: '/api-keys/:id',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await revokeApiKey(c.deps, owner(c), owner(c).tenantId, c.params.id);
    },
  }),

  // Webhooks (FR-INT-07/08)
  route({ method: 'get', path: '/webhooks', surfaces: ['tenant'], permission: 'integrations.view', handler: async (c) => ({ items: await listWebhooks(c.deps, tenant(c).tenantId) }) }),
  route({
    method: 'post',
    path: '/webhooks',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    body: z.object({ url: z.string().url().max(2048), events: z.array(z.string()).min(1).max(10), venueId: uuidSchema.nullable().optional() }).strict(),
    status: 201,
    handler: async (c) => createWebhook(c.deps, owner(c), owner(c).tenantId, c.body),
  }),
  route({
    method: 'patch',
    path: '/webhooks/:id',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: idP,
    body: z.object({ url: z.string().url().max(2048).optional(), events: z.array(z.string()).min(1).max(10).optional(), enabled: z.boolean().optional(), rotateSecret: z.boolean().optional() }).strict(),
    tenantResource: true,
    handler: async (c) => updateWebhook(c.deps, owner(c), owner(c).tenantId, c.params.id, c.body),
  }),
  route({
    method: 'delete',
    path: '/webhooks/:id',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await deleteWebhook(c.deps, owner(c), owner(c).tenantId, c.params.id);
    },
  }),
  // Manual sends are limited per user (route limit) and per tenant across its users (M-12).
  route({
    method: 'post',
    path: '/webhooks/:id/test',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: idP,
    status: 202,
    tenantResource: true,
    rateLimit: { name: 'webhook-test', points: 10, durationSec: 600, key: 'actor' },
    handler: async (c) => {
      await c.deps.rateLimit('webhook-test-tenant', owner(c).tenantId, 30, 3600);
      return testWebhook(c.deps, owner(c).tenantId, c.params.id);
    },
  }),
  route({ method: 'get', path: '/webhooks/:id/deliveries', surfaces: ['tenant'], permission: 'integrations.view', params: idP, tenantResource: true, handler: async (c) => ({ items: await listDeliveries(c.deps, tenant(c).tenantId, c.params.id) }) }),
  route({
    method: 'post',
    path: '/webhook-deliveries/:deliveryId/redeliver',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: z.object({ deliveryId: z.coerce.number().int().min(1) }).strict(),
    status: 202,
    rateLimit: { name: 'webhook-redeliver', points: 30, durationSec: 600, key: 'actor' },
    handler: async (c) => {
      await c.deps.rateLimit('webhook-redeliver-tenant', owner(c).tenantId, 100, 3600);
      return redeliver(c.deps, owner(c).tenantId, c.params.deliveryId);
    },
  }),

  // POS connections (FR-INT-09)
  route({ method: 'get', path: '/pos/connections', surfaces: ['tenant'], permission: 'integrations.view', handler: async (c) => ({ items: await listPosConnections(c.deps, tenant(c).tenantId) }) }),
  // Providers this platform has credentials for; Connect is offered only for these.
  route({ method: 'get', path: '/pos/providers', surfaces: ['tenant'], permission: 'integrations.view', handler: async () => ({ items: [...registeredConnectors().keys()] }) }),
  route({
    method: 'post',
    path: '/venues/:id/pos/:provider/connect',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: z.object({ id: uuidSchema, provider: z.string().regex(/^[a-z0-9-]{2,40}$/) }).strict(),
    tenantResource: true,
    handler: async (c) => {
      const { url, binding } = await startPosConnect(c.deps, registeredConnectors(), owner(c), owner(c).tenantId, c.params.id, c.params.provider);
      c.res.cookie(posBindingCookie(c.deps), binding, posBindingOpts(c.deps, 10 * 60_000));
      return { url };
    },
  }),
  route({
    method: 'delete',
    path: '/pos/connections/:id',
    surfaces: ['tenant'],
    permission: 'integrations.manage',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await removePosConnection(c.deps, registeredConnectors(), owner(c), owner(c).tenantId, c.params.id);
    },
  }),

  // Named staff (FR-ACC-07)
  route({ method: 'get', path: '/venues/:id/staff-members', surfaces: ['tenant'], permission: 'venue.staff_access', params: idP, tenantResource: true, handler: async (c) => ({ items: await listStaffMembers(c.deps, tenant(c).tenantId, c.params.id) }) }),
  route({
    method: 'post',
    path: '/venues/:id/staff-members',
    surfaces: ['tenant'],
    permission: 'venue.staff_access',
    params: idP,
    body: z.object({ name: z.string().trim().min(1).max(60), pin: z.string().regex(/^\d{4,6}$/) }).strict(),
    status: 201,
    tenantResource: true,
    handler: async (c) => createStaffMember(c.deps, tenant(c), tenant(c).tenantId, c.params.id, c.body.name, c.body.pin),
  }),
  route({
    method: 'delete',
    path: '/staff-members/:id',
    surfaces: ['tenant'],
    permission: 'venue.staff_access',
    params: idP,
    tenantResource: true,
    handler: async (c) => {
      await deactivateStaffMember(c.deps, tenant(c).tenantId, c.params.id);
    },
  }),

  // CSV export (Pro; FR-RPT-04, TR-RPT-04)
  route({
    method: 'get',
    path: '/reports/export.csv',
    surfaces: ['tenant'],
    permission: 'reports.view',
    query: dateRange({ venueId: z.union([uuidSchema, z.literal('all')]).optional(), counterId: uuidSchema.optional() }),
    handler: async (c) => {
      const gen = ticketsCsv(c.deps, tenant(c).tenantId, { venueId: c.query.venueId === 'all' ? undefined : c.query.venueId, counterId: c.query.counterId, from: c.query.from, to: c.query.to });
      const first = await gen.next(); // runs the feature check before headers are sent
      c.res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="tickets-${c.query.from}-${c.query.to}.csv"`);
      if (!first.done) c.res.write(first.value);
      for await (const chunk of gen) c.res.write(chunk);
      c.res.end();
    },
  }),
]);
