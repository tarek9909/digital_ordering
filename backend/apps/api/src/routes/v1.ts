import { AppError, CANCEL_REASONS, uuidSchema } from '@dop/contracts';
import { createTicket, getTenantSettings, idempotent, integrationTicket, logUnknownReference, transitionTicket, alertAgain, urls } from '@dop/services';
import QRCode from 'qrcode';
import { z } from 'zod';
import { defineRoutes, route, type Ctx } from '../http/router.js';

// Integration API on api.{domain}/v1 (TRD §12.9, R2; FR-INT-01 – FR-INT-06). Authenticated by API key; scoped
// to the key's venue. Rate limits: 10/s with a burst of 20 per key, 300/min per tenant (TR-INT-02).

const idP = z.object({ id: uuidSchema }).strict();
const createBody = z
  .object({
    externalRef: z.string().trim().min(1).max(100).optional(),
    counter: z.string().max(60).optional(),
    note: z.string().max(280).optional(),
    waitMinutes: z.number().int().min(0).max(240).optional(),
    status: z.enum(['received', 'preparing']).optional(),
  })
  .strict();
const statusBody = z.object({ status: z.enum(['preparing', 'ready', 'collected', 'cancelled']), cancelReason: z.enum(CANCEL_REASONS).optional() }).strict();

function key(c: Ctx) {
  if (c.actor.kind !== 'api_key') throw new AppError('UNAUTHENTICATED');
  return c.actor;
}

async function limits(c: Ctx) {
  const k = key(c);
  await c.deps.rateLimit('v1-key', k.apiKeyId, 20, 2);
  await c.deps.rateLimit('v1-tenant', k.tenantId, 300, 60);
  return k;
}

async function findTicket(c: Ctx, id: string) {
  const k = key(c);
  const t = await c.deps.db.forTenant(k.tenantId).selectFrom('tickets').selectAll().where('id', '=', id).where('venue_id', '=', k.venueId).executeTakeFirst();
  if (!t) {
    await logUnknownReference(c.deps, k, id);
    throw new AppError('NOT_FOUND');
  }
  return t;
}

const v1 = { surfaces: ['integration' as const], csrfExempt: true, tenantResource: true };

export const v1Routes = defineRoutes('/v1', [
  route({
    ...v1,
    method: 'get',
    path: '/me',
    permission: 'tickets.write',
    handler: async (c) => {
      const k = await limits(c);
      const [t, v, ak] = await Promise.all([
        getTenantSettings(c.deps, k.tenantId),
        c.deps.db.forTenant(k.tenantId).selectFrom('venues').select(['id', 'name', 'time_zone']).where('id', '=', k.venueId).executeTakeFirstOrThrow(),
        c.deps.db.forTenant(k.tenantId).selectFrom('api_keys').select(['name', 'key_prefix']).where('id', '=', k.apiKeyId).executeTakeFirstOrThrow(),
      ]);
      return { tenant: { name: t.name }, venue: { id: v.id, name: v.name, timeZone: v.time_zone }, key: { name: ak.name, prefix: ak.key_prefix } };
    },
  }),
  route({
    ...v1,
    method: 'post',
    path: '/tickets',
    permission: 'tickets.write',
    body: createBody,
    handler: async (c) => {
      const k = await limits(c);
      let counterId: string | undefined;
      if (c.body.counter) {
        const ctr = await c.deps.db
          .forTenant(k.tenantId)
          .selectFrom('counters')
          .select('id')
          .where('venue_id', '=', k.venueId)
          .where('archived_at', 'is', null)
          .where((eb) => eb.or([eb('id', '=', c.body.counter!), eb('name', '=', c.body.counter!)]))
          .executeTakeFirst();
        if (!ctr) throw new AppError('NOT_FOUND', 'Unknown counter');
        counterId = ctr.id;
      }
      const r = await idempotent(c.deps, k, c.req.headers['idempotency-key'] as string | undefined, { method: 'POST', path: '/v1/tickets', body: c.body }, async () => {
        const { ticket, existing } = await createTicket(
          c.deps,
          k,
          k.venueId,
          { externalRef: c.body.externalRef, counterId, note: c.body.note, waitMinutes: c.body.waitMinutes, startStatus: c.body.status },
          { source: 'api', viaApi: true },
        );
        const base = `https://api.${c.deps.config.domain}/v1/tickets/${ticket.id}`;
        return {
          status: existing ? 200 : 201, // FR-INT-05: an open ticket with this reference is returned
          body: { ...integrationTicket(c.deps, ticket), qrPngUrl: `${base}/qr.png`, qrSvgUrl: `${base}/qr.svg` },
        };
      });
      c.res.status(r.status).json(r.body);
    },
  }),
  route({
    ...v1,
    method: 'get',
    path: '/tickets/:id',
    permission: 'tickets.write',
    params: idP,
    handler: async (c) => {
      await limits(c);
      return integrationTicket(c.deps, await findTicket(c, c.params.id));
    },
  }),
  route({
    ...v1,
    method: 'get',
    path: '/tickets',
    permission: 'tickets.write',
    query: z
      .object({ externalRef: z.string().max(100).optional(), status: z.enum(['received', 'preparing', 'ready', 'collected', 'cancelled', 'expired']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(40).optional() })
      .strict(),
    handler: async (c) => {
      const k = await limits(c);
      let q = c.deps.db.forTenant(k.tenantId).selectFrom('tickets').selectAll().where('venue_id', '=', k.venueId);
      if (c.query.externalRef) q = q.where('external_ref', '=', c.query.externalRef);
      if (c.query.status) q = q.where('status', '=', c.query.status);
      if (c.query.cursor) q = q.where('id', '<', c.query.cursor);
      const rows = await q.orderBy('id', 'desc').limit(c.query.limit + 1).execute();
      const page = rows.slice(0, c.query.limit);
      return { items: page.map((t) => integrationTicket(c.deps, t)), nextCursor: rows.length > c.query.limit ? page[page.length - 1]!.id : null };
    },
  }),
  route({
    ...v1,
    method: 'post',
    path: '/tickets/:id/status',
    permission: 'tickets.write',
    params: idP,
    body: statusBody,
    handler: async (c) => {
      const k = await limits(c);
      const t = await findTicket(c, c.params.id);
      const r = await idempotent(c.deps, k, c.req.headers['idempotency-key'] as string | undefined, { method: 'POST', path: `/v1/tickets/${t.id}/status`, body: c.body }, async () => {
        // Last write wins without a version; invalid transitions → 409 (TR-TKT-01). Check codes exempt (BR-15).
        const res = await transitionTicket(c.deps, k, t.id, { to: c.body.status, cancelReason: c.body.cancelReason }, { venueId: k.venueId, viaApi: true });
        return { status: 200, body: integrationTicket(c.deps, res.ticket) };
      });
      c.res.status(r.status).json(r.body);
    },
  }),
  route({
    ...v1,
    method: 'post',
    path: '/tickets/by-external-ref/:externalRef/status',
    permission: 'tickets.write',
    params: z.object({ externalRef: z.string().min(1).max(100) }).strict(),
    body: statusBody,
    handler: async (c) => {
      const k = await limits(c);
      const t = await c.deps.db.forTenant(k.tenantId).selectFrom('tickets').select('id').where('venue_id', '=', k.venueId).where('open_external_ref', '=', c.params.externalRef).executeTakeFirst();
      if (!t) {
        await logUnknownReference(c.deps, k, c.params.externalRef); // EX-12, TR-INT-06
        throw new AppError('NOT_FOUND', 'No open ticket with this reference');
      }
      const res = await transitionTicket(c.deps, k, t.id, { to: c.body.status, cancelReason: c.body.cancelReason }, { venueId: k.venueId, viaApi: true });
      return integrationTicket(c.deps, res.ticket);
    },
  }),
  route({
    ...v1,
    method: 'post',
    path: '/tickets/:id/alert',
    permission: 'tickets.write',
    params: idP,
    status: 202,
    handler: async (c) => {
      const k = await limits(c);
      await findTicket(c, c.params.id);
      await alertAgain(c.deps, k, c.params.id, { venueId: k.venueId });
      return { accepted: true };
    },
  }),
  route({
    ...v1,
    method: 'get',
    path: '/tickets/:id/qr.png',
    permission: 'tickets.write',
    params: idP,
    query: z.object({ size: z.coerce.number().int().min(128).max(1024).default(512) }).strict(),
    handler: async (c) => {
      await limits(c);
      const t = await findTicket(c, c.params.id);
      c.res.type('image/png').send(await QRCode.toBuffer(urls(c.deps.config).ticket(t.token), { width: c.query.size, margin: 1 }));
    },
  }),
  route({
    ...v1,
    method: 'get',
    path: '/tickets/:id/qr.svg',
    permission: 'tickets.write',
    params: idP,
    handler: async (c) => {
      await limits(c);
      const t = await findTicket(c, c.params.id);
      c.res.type('image/svg+xml').send(await QRCode.toString(urls(c.deps.config).ticket(t.token), { type: 'svg', margin: 1 }));
    },
  }),
]);
