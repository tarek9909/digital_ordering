import { COOKIES, SESSION_TTL, tokenHash } from '@dop/auth';
import { AppError, claimDecisionBody, createTicketBody, editTicketBody, searchQuery, staffDevicePatch, staffSessionBody, transitionBody, uuidSchema, type StaffBoard } from '@dop/contracts';
import {
  alertAgain,
  branding,
  createTicket,
  csrfFor,
  decideClaim,
  namedStaffOn,
  pendingClaims,
  staffMemberUnlock,
  editTicket,
  getTenantStatus,
  isEnabled,
  loadVenue,
  searchTickets,
  staffBoardTickets,
  staffSignIn,
  staffTicket,
  transitionTicket,
  urls,
} from '@dop/services';
import QRCode from 'qrcode';
import { z } from 'zod';
import { defineRoutes, parseInput, route, type Ctx } from '../http/router.js';

// Staff API (TRD §12.5). Devices use their own cookie; owners, managers and support use their session with
// ?venueId= (FR-STF-17, TR-AUTH-12).

const idParam = z.object({ id: uuidSchema }).strict();
const venueQuery = z.object({ venueId: uuidSchema.optional() }).strict();
const staffLimit = { name: 'staff', points: 30, durationSec: 1, key: 'actor' as const };

type StaffActor = Extract<Ctx['actor'], { kind: 'staff_device' | 'user' | 'support' }>;

async function venueOf(c: Ctx): Promise<{ actor: StaffActor; venueId: string }> {
  const a = c.actor;
  if (a.kind === 'staff_device') {
    // Named staff (R2): writes need a personal PIN first (FR-ACC-07).
    if (c.req.method !== 'GET' && !a.member && (await namedStaffOn(c.deps, a.tenantId))) {
      const any = await c.deps.db.forTenant(a.tenantId).selectFrom('staff_members').select('id').where('venue_id', '=', a.venueId).where('active', '=', true).limit(1).executeTakeFirst();
      if (any) throw new AppError('FORBIDDEN', 'Enter your personal PIN');
    }
    return { actor: a, venueId: a.venueId };
  }
  if (a.kind === 'user' || a.kind === 'support') {
    const q = parseInput(venueQuery, { venueId: (c.req.query as Record<string, unknown>).venueId }, 'query') as { venueId?: string };
    if (!q.venueId) throw new AppError('VALIDATION_FAILED', 'venueId is required', { errors: [{ path: 'venueId', message: 'required' }] });
    await loadVenue(c.deps.db.forTenant(a.tenantId), q.venueId); // 404 for another tenant's venue
    return { actor: a, venueId: q.venueId };
  }
  throw new AppError('UNAUTHENTICATED');
}

export const staffRoutes = defineRoutes('/api/staff/v1', [
  route({
    method: 'post',
    path: '/sessions',
    surfaces: ['tenant'],
    permission: 'public',
    body: staffSessionBody,
    csrfExempt: true,
    status: 201,
    rateLimit: { name: 'staff-signin', points: 20, durationSec: 600, key: 'ip' },
    handler: async (c) => {
      // Lockout counts by the address the server sees, never by a cookie the client could change (L-4).
      const r = await staffSignIn(c.deps, c.body, { ip: c.ip, userAgent: c.userAgent, host: c.host });
      if (r.tenantId !== c.tenant?.id) throw new AppError('NOT_FOUND');
      c.setCookie(COOKIES.device, r.token, SESSION_TTL.deviceSlidingMs);
      return { deviceId: r.deviceId };
    },
  }),
  route({
    method: 'get',
    path: '/sessions/counters',
    surfaces: ['tenant'],
    permission: 'public',
    query: z.object({ staffKey: z.string().regex(/^[0-9A-Za-z]{32}$/) }).strict(),
    rateLimit: { name: 'staff-counters', points: 60, durationSec: 600, key: 'ip' },
    // The counter names a device can pick on the sign-in screen; the secret staff link is the only credential needed.
    handler: async (c) => {
      const pdb = c.deps.db.platform();
      const sa = await pdb.selectFrom('staff_access').select(['venue_id', 'tenant_id']).where('staff_key_hash', '=', tokenHash(c.deps.config.pepper, c.query.staffKey)).executeTakeFirst();
      if (!sa || sa.tenant_id !== c.tenant?.id) throw new AppError('NOT_FOUND');
      const rows = await c.deps.db
        .forTenant(sa.tenant_id)
        .selectFrom('counters')
        .select(['id', 'name'])
        .where('venue_id', '=', sa.venue_id)
        .where('archived_at', 'is', null)
        .orderBy('sort_order')
        .execute();
      return { counters: rows };
    },
  }),
  route({
    method: 'delete',
    path: '/sessions/current',
    surfaces: ['tenant'],
    permission: 'board.view',
    handler: async (c) => {
      if (c.actor.kind === 'staff_device') {
        await c.deps.db.forTenant(c.actor.tenantId).updateTable('staff_devices').set({ revoked_at: c.deps.now(), revoked_reason: 'removed' }).where('id', '=', c.actor.deviceId).execute();
      }
      c.clearCookie(COOKIES.device);
    },
  }),
  route({
    method: 'patch',
    path: '/device',
    surfaces: ['tenant'],
    permission: 'board.view',
    body: staffDevicePatch,
    handler: async (c) => {
      if (c.actor.kind !== 'staff_device') throw new AppError('FORBIDDEN');
      await c.deps.db
        .forTenant(c.actor.tenantId)
        .updateTable('staff_devices')
        .set({ ...(c.body.name && { name: c.body.name }), ...(c.body.mode && { mode: c.body.mode }) })
        .where('id', '=', c.actor.deviceId)
        .execute();
    },
  }),
  route({
    method: 'get',
    path: '/board',
    surfaces: ['tenant'],
    permission: 'board.view',
    handler: async (c): Promise<StaffBoard & { csrfToken: string; venueUrl: string }> => {
      const { actor, venueId } = await venueOf(c);
      const db = c.deps.db.forTenant(actor.tenantId);
      const venue = await loadVenue(db, venueId);
      const [tickets, counters, status, removePoweredBy, claims] = await Promise.all([
        staffBoardTickets(c.deps, actor.tenantId, venueId),
        db.selectFrom('counters').select(['id', 'name', 'prefix']).where('venue_id', '=', venueId).where('archived_at', 'is', null).orderBy('sort_order').execute(),
        getTenantStatus(c.deps, actor.tenantId),
        isEnabled(c.deps, actor.tenantId, 'remove_powered_by'),
        pendingClaims(c.deps, actor.tenantId, venueId),
      ]);
      const device =
        actor.kind === 'staff_device'
          ? await db.selectFrom('staff_devices').select(['id', 'name', 'mode']).where('id', '=', actor.deviceId).executeTakeFirstOrThrow()
          : null;
      const csrfSeed = actor.kind === 'staff_device' ? `dev:${actor.deviceId}` : actor.kind === 'user' ? actor.sessionId : actor.supportSessionId;
      return {
        venue: { ...branding(c.deps.config, venue, { removePoweredBy }), id: venueId, settings: venue.settings },
        device: device ? { id: device.id, name: device.name, mode: device.mode } : null,
        counters,
        open: tickets.open,
        recent: tickets.recent,
        collectedToday: tickets.collectedToday,
        businessDate: tickets.businessDate,
        pendingClaims: claims,
        tenantStatus: status ?? 'active',
        serverTime: c.deps.now().toISOString(),
        csrfToken: csrfFor(c.deps, csrfSeed),
        venueUrl: urls(c.deps.config).venue(venue.row.venue_code),
      };
    },
  }),
  route({
    method: 'post',
    path: '/tickets',
    surfaces: ['tenant'],
    permission: 'tickets.write',
    body: createTicketBody,
    status: 201,
    rateLimit: staffLimit,
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      const { ticket } = await createTicket(c.deps, actor, venueId, c.body);
      return { ticket: staffTicket(ticket), qr: urls(c.deps.config).ticket(ticket.token) };
    },
  }),
  route({
    method: 'get',
    path: '/tickets/search',
    surfaces: ['tenant'],
    permission: 'board.view',
    query: searchQuery.extend({ venueId: uuidSchema.optional() }),
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      return { items: await searchTickets(c.deps, actor.tenantId, venueId, c.query.q) };
    },
  }),
  route({
    method: 'get',
    path: '/tickets/:id/qr.svg',
    surfaces: ['tenant'],
    permission: 'board.view',
    params: idParam,
    tenantResource: true,
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      const t = await c.deps.db.forTenant(actor.tenantId).selectFrom('tickets').select(['token']).where('id', '=', c.params.id).where('venue_id', '=', venueId).executeTakeFirst();
      if (!t) throw new AppError('NOT_FOUND');
      const svg = await QRCode.toString(urls(c.deps.config).ticket(t.token), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      c.res.setHeader('Cache-Control', 'no-store');
      c.res.type('image/svg+xml').send(svg);
    },
  }),
  route({
    method: 'post',
    path: '/tickets/:id/transitions',
    surfaces: ['tenant'],
    permission: 'tickets.write',
    params: idParam,
    body: transitionBody,
    rateLimit: staffLimit,
    tenantResource: true,
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      const r = await transitionTicket(c.deps, actor, c.params.id, c.body, { venueId });
      return { ticket: staffTicket(r.ticket), changed: r.changed };
    },
  }),
  route({
    method: 'patch',
    path: '/tickets/:id',
    surfaces: ['tenant'],
    permission: 'tickets.write',
    params: idParam,
    body: editTicketBody,
    rateLimit: staffLimit,
    tenantResource: true,
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      return { ticket: staffTicket(await editTicket(c.deps, actor, c.params.id, c.body, { venueId })) };
    },
  }),
  route({
    method: 'post',
    path: '/tickets/:id/alerts',
    surfaces: ['tenant'],
    permission: 'tickets.write',
    params: idParam,
    status: 202,
    tenantResource: true,
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      return { ticket: staffTicket(await alertAgain(c.deps, actor, c.params.id, { venueId })) };
    },
  }),
  route({
    method: 'post',
    path: '/members/unlock',
    surfaces: ['tenant'],
    permission: 'board.view',
    body: z.object({ pin: z.string().regex(/^\d{4,6}$/) }).strict(),
    rateLimit: { name: 'member-pin', points: 20, durationSec: 600, key: 'actor' },
    handler: async (c) => {
      if (c.actor.kind !== 'staff_device') throw new AppError('FORBIDDEN');
      return staffMemberUnlock(c.deps, c.actor.tenantId, c.actor.venueId, c.actor.deviceId, c.body.pin);
    },
  }),
  route({
    method: 'get',
    path: '/claims',
    surfaces: ['tenant'],
    permission: 'board.view',
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      return { items: await pendingClaims(c.deps, actor.tenantId, venueId) };
    },
  }),
  route({
    method: 'post',
    path: '/claims/:id/decision',
    surfaces: ['tenant'],
    permission: 'tickets.write',
    params: idParam,
    body: claimDecisionBody,
    tenantResource: true,
    handler: async (c) => {
      const { actor, venueId } = await venueOf(c);
      return decideClaim(c.deps, actor, c.params.id, c.body.approve, venueId);
    },
  }),
]);
