import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { createTenantWithOwner, slugAvailability } from '@dop/services';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTE_GROUPS } from '../src/app.js';
import { clearTenantCache } from '../src/http/middleware.js';
import request from 'supertest';
import { client, makeApi } from './helpers.js';

let t: TestDatabase;
let api: ReturnType<typeof makeApi>;

beforeAll(async () => {
  t = await startTestDatabase();
  api = makeApi(t.clients);
});
afterAll(async () => {
  await t?.stop();
});

const PASSWORD = 'a-long-unique-passphrase';

/** Creates a tenant with a verified owner, signs in on the tenant host and sets the staff PIN. */
async function onboardTenant(slug: string) {
  clearTenantCache();
  const r = await createTenantWithOwner(api.deps, { ownerName: 'Owner', email: `${slug}@x.test`, password: PASSWORD, restaurantName: `Cafe ${slug}`, slug, country: 'SA', locale: 'ar' }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();

  const admin = client(api.app, `${slug}.dop.test`);
  const signIn = await admin.post('/api/auth/v1/sign-in', { email: `${slug}@x.test`, password: PASSWORD });
  expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);
  const me = await admin.get('/api/auth/v1/me');
  expect(me.body.currentRole).toBe('owner');
  admin.setCsrf(me.body.csrfToken);
  const venues = await admin.get('/api/admin/v1/venues');
  const venueId = venues.body.items[0].id as string;
  expect((await admin.put(`/api/admin/v1/venues/${venueId}/staff-access/pin`, { pin: '4821' })).status).toBe(204);
  const access = await admin.get(`/api/admin/v1/venues/${venueId}/staff-access`);
  const staffKey = (access.body.link as string).split('/staff/')[1]!;

  const staff = client(api.app, `${slug}.dop.test`);
  const s = await staff.post('/api/staff/v1/sessions', { staffKey, pin: '4821', deviceName: 'Counter iPad' });
  expect(s.status, JSON.stringify(s.body)).toBe(201);
  const board = await staff.get('/api/staff/v1/board');
  staff.setCsrf(board.body.csrfToken);
  const tenantId = me.body.currentTenantId as string;
  return { slug, admin, staff, venueId, tenantId, staffKey };
}

describe('HTTP flow (MVP journeys 1–3, API level)', () => {
  it('signs up, sets up staff access, runs a ticket through the customer page and a display', async () => {
    const a = await onboardTenant('burger-house');
    // CSRF is required for cookie sessions (TR-AUTH-02)
    const noCsrf = client(api.app, 'burger-house.dop.test');
    for (const [k, v] of a.staff.jar) noCsrf.jar.set(k, v);
    expect((await noCsrf.post('/api/staff/v1/tickets', {})).body.code).toBe('CSRF_FAILED');

    const created = await a.staff.post('/api/staff/v1/tickets', { note: 'no onions' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const ticket = created.body.ticket;
    const token = (created.body.qr as string).split('/').pop()!;

    const phone = client(api.app, 't.dop.test');
    const view = await phone.get(`/api/public/v1/tickets/${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ displayNumber: '1', status: 'preparing', venue: { name: 'Cafe burger-house' } });
    expect(view.body.note).toBeUndefined(); // projection: no note for customers
    expect(view.headers['referrer-policy']).toBe('no-referrer');
    expect((await phone.post(`/api/public/v1/tickets/${token}/follow`, { clientId: 'A'.repeat(22), joinedVia: 'ticket_qr', uaFamily: 'ios-safari' })).body).toEqual({ firstFollower: true });
    // Push endpoint must be a known push service
    const badSub = await phone.put(`/api/public/v1/tickets/${token}/push-subscription`, {
      clientId: 'A'.repeat(22),
      subscription: { endpoint: 'https://169.254.169.254/latest', keys: { p256dh: 'x'.repeat(40), auth: 'y'.repeat(16) } },
    });
    expect(badSub.body.code).toBe('VALIDATION_FAILED');

    const ready = await a.staff.post(`/api/staff/v1/tickets/${ticket.id}/transitions`, { to: 'ready', version: ticket.version });
    expect(ready.body.ticket.status).toBe('ready');
    const stale = await a.staff.post(`/api/staff/v1/tickets/${ticket.id}/transitions`, { to: 'preparing', version: ticket.version });
    expect(stale.status).toBe(409);
    expect(stale.headers['content-type']).toContain('application/problem+json');
    expect(stale.body).toMatchObject({ code: 'TICKET_VERSION_CONFLICT', detail: 'Already changed by Counter iPad' });

    expect((await phone.post(`/api/public/v1/tickets/${token}/acknowledge`)).status).toBe(204);
    const manifest = await phone.get(`/m/${token}.webmanifest`);
    expect(manifest.body).toMatchObject({ short_name: 'Order 1', start_url: `/${token}?src=hs` });

    // Display pairing (journey 6)
    const disp = await a.admin.post(`/api/admin/v1/venues/${a.venueId}/displays`, { name: 'Pickup TV' });
    expect(disp.status, JSON.stringify(disp.body)).toBe(201);
    const code = await a.admin.post(`/api/admin/v1/displays/${disp.body.id}/pairing-code`);
    const tv = client(api.app, 'burger-house.dop.test');
    expect((await tv.post('/api/display/v1/pair', { code: code.body.code })).status).toBe(200);
    const board = await tv.get('/api/display/v1/board');
    expect(board.body.ready.map((x: { displayNumber: string }) => x.displayNumber)).toEqual(['1']);
    expect(board.body.ready[0].note).toBeUndefined();

    // Reports
    const today = await a.admin.get(`/api/admin/v1/reports/today?venueId=${a.venueId}`);
    expect(today.body).toMatchObject({ tickets: 1, prepLabel: 'from ticket creation' });
  });

  it('returns the Problem Details shape for validation and unknown routes', async () => {
    const www = client(api.app, 'www.dop.test');
    const bad = await www.post('/api/auth/v1/sign-in', { email: 'nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(bad.body.errors.length).toBeGreaterThan(0);
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect((await www.get('/api/nope')).body.code).toBe('NOT_FOUND');
    // Reserved slug (TR-URL-04)
    expect(await slugAvailability(api.deps, 'admin')).toEqual({ available: false, reason: 'reserved' });
    // No public self-signup: tenants are created from the console.
    expect((await www.post('/api/public/v1/signup', {})).status).toBe(404);
    expect((await www.get('/api/public/v1/slugs/new-cafe/availability')).status).toBe(404);
  });
});

describe('on-demand TLS allow-list (deploy/Caddyfile)', () => {
  it('allows platform hosts and existing tenants only', async () => {
    const ask = (d: string) => request(api.app).get(`/internal/tls-allowed?domain=${d}`).then((r) => r.status);
    expect(await ask('t.dop.test')).toBe(200);
    expect(await ask('files.dop.test')).toBe(200);
    expect(await ask('burger-house.dop.test')).toBe(200);
    expect(await ask('no-such-tenant.dop.test')).toBe(404);
    expect(await ask('evil.example.com')).toBe(404);
  });
});

describe('route table (TR-AUTH-09)', () => {
  it('declares a permission and surfaces on every route; admin and console routes are never public', () => {
    for (const g of ROUTE_GROUPS) {
      for (const d of g.defs) {
        expect(d.permission, `${g.prefix}${d.path}`).toBeTruthy();
        expect(d.surfaces.length, `${g.prefix}${d.path}`).toBeGreaterThan(0);
        if (g.prefix.startsWith('/api/admin') || g.prefix.startsWith('/api/console')) expect(d.permission, `${g.prefix}${d.path}`).not.toBe('public');
      }
    }
  });
});

describe('cross-tenant suite (TR-TEN-08, generated from the route list)', () => {
  it('returns 404 for every tenant resource of tenant B when signed in to tenant A', async () => {
    const a = await onboardTenant('tenant-a');
    const b = await onboardTenant('tenant-b');
    const tb = await b.staff.post('/api/staff/v1/tickets', {});
    const bDisplay = await b.admin.post(`/api/admin/v1/venues/${b.venueId}/displays`, { name: 'B TV' });
    const bDevice = (await b.admin.get(`/api/admin/v1/venues/${b.venueId}/devices`)).body.items[0].id as string;
    const bInvite = await b.admin.post('/api/admin/v1/invitations', { email: 'mgr@b.test', role: 'manager' });
    const bMember = (await b.admin.get('/api/admin/v1/members')).body.members[0].id as string;
    const bExport = await b.admin.post('/api/admin/v1/exports');
    const bCounter = await b.admin.post(`/api/admin/v1/venues/${b.venueId}/counters`, { name: 'Food' });
    // R1.1 resources: a pending claim, a rating and a support request on tenant B.
    const { claimTicket, follow, rateTicket, requestSupport, transitionTicket } = await import('@dop/services');
    const settings = (await b.admin.get(`/api/admin/v1/venues/${b.venueId}`)).body.settings;
    await b.admin.put(`/api/admin/v1/venues/${b.venueId}/settings`, { ...settings, claims: { mode: 'staff_approval' } });
    const venueCode = (await b.admin.get(`/api/admin/v1/venues/${b.venueId}`)).body.venueCode as string;
    const tb2 = await b.staff.post('/api/staff/v1/tickets', {});
    const claim = (await claimTicket(api.deps, venueCode, { clientId: 'Z'.repeat(22), number: tb2.body.ticket.displayNumber }, 'other')) as { claimId: string };
    const tb3 = (await b.staff.post('/api/staff/v1/tickets', {})).body.ticket;
    await follow(api.deps, tb3.token, { clientId: 'Y'.repeat(22), joinedVia: 'ticket_qr', uaFamily: 'other' });
    await transitionTicket(api.deps, { kind: 'system', tenantId: b.tenantId } as never, tb3.id, { to: 'ready' }).catch(() => undefined);
    const tenantBActor = { kind: 'staff_device' as const, deviceId: 'x', tenantId: b.tenantId, venueId: b.venueId, deviceName: 'x' };
    await transitionTicket(api.deps, tenantBActor, tb3.id, { to: 'ready', version: 1 });
    await transitionTicket(api.deps, tenantBActor, tb3.id, { to: 'collected', version: 2 });
    await rateTicket(api.deps, tb3.token, { clientId: 'Y'.repeat(22), stars: 4 });
    const bRating = (await b.admin.get('/api/admin/v1/ratings')).body.items[0].id as string;
    await api.deps.db.platform().insertInto('platform_users').values({ id: 'pu-x', email: 'x@p.test', name: 'P', role: 'support', status: 'active' }).execute();
    const bSupport = await requestSupport(api.deps, { kind: 'platform', platformUserId: 'pu-x', role: 'support', sessionId: 's', mfaVerifiedAt: new Date() }, b.tenantId, 'Investigate an issue', 60);
    // R2 rows for B inserted directly (B is on trial, which cannot create them through the API).
    const bdb = api.deps.db.forTenant(b.tenantId);
    await bdb.insertInto('api_keys').values({ id: 'aaaaaaaa-0000-7000-8000-00000000000a', tenant_id: b.tenantId, venue_id: b.venueId, name: 'k', key_prefix: 'pk_test_ZZZZ', secret_hash: 'x'.repeat(64), created_by: 'u' }).execute();
    await bdb.insertInto('webhook_endpoints').values({ id: 'aaaaaaaa-0000-7000-8000-00000000000b', tenant_id: b.tenantId, url: 'https://x.example', events: '["ticket.ready"]', secret_enc: Buffer.from('x') }).execute();
    await bdb.insertInto('staff_members').values({ id: 'aaaaaaaa-0000-7000-8000-00000000000c', tenant_id: b.tenantId, venue_id: b.venueId, name: 'S', pin_hash: 'x' }).execute();
    // IDs of B's resources by path parameter, keyed by the route path.
    const idFor = (path: string): string => {
      if (path.startsWith('/tickets/')) return tb.body.ticket.id;
      if (path.startsWith('/venues/')) return b.venueId;
      if (path.startsWith('/displays/')) return bDisplay.body.id;
      if (path.startsWith('/devices/')) return bDevice;
      if (path.startsWith('/invitations/')) return bInvite.body.id;
      if (path.startsWith('/members/')) return bMember;
      if (path.startsWith('/exports/')) return bExport.body.id;
      if (path.startsWith('/claims/')) return claim.claimId;
      if (path.startsWith('/counters/')) return bCounter.body.id;
      if (path.startsWith('/ratings/')) return bRating;
      if (path.startsWith('/support-sessions/')) return bSupport.id;
      if (path.startsWith('/api-keys/')) return 'aaaaaaaa-0000-7000-8000-00000000000a';
      if (path.startsWith('/webhooks/')) return 'aaaaaaaa-0000-7000-8000-00000000000b';
      if (path.startsWith('/staff-members/')) return 'aaaaaaaa-0000-7000-8000-00000000000c';
      if (path.startsWith('/pos/connections/')) return 'aaaaaaaa-0000-7000-8000-00000000000d';
      throw new Error(`no id for ${path}`);
    };
    const bodies: Record<string, object> = {
      'post /tickets/:id/transitions': { to: 'ready', version: 1 },
      'patch /tickets/:id': { version: 1, note: 'x' },
      'patch /venues/:id': { name: 'Hacked' },
      'put /venues/:id/messages': {},
      'put /venues/:id/settings': {},
      'put /venues/:id/staff-access/pin': { pin: '5937' },
      'post /venues/:id/displays': { name: 'x' },
      'patch /displays/:id': { name: 'x' },
      'post /claims/:id/decision': { approve: true },
      'post /venues/:id/counters': { name: 'x' },
      'patch /counters/:id': { name: 'x' },
      'post /venues/:id/api-keys': { name: 'x' },
      'post /venues/:id/staff-members': { name: 'x', pin: '5937' },
      'patch /webhooks/:id': { enabled: false },
    };
    let checked = 0;
    for (const g of ROUTE_GROUPS) {
      if (!['/api/admin/v1', '/api/staff/v1'].includes(g.prefix)) continue;
      for (const d of g.defs.filter((x) => x.tenantResource)) {
        const path = d.path.replace(':id', idFor(d.path)).replace(':kind', 'a4.pdf').replace(':provider', 'foodics');
        const as = g.prefix === '/api/staff/v1' ? a.staff : a.admin;
        const res = await as[d.method](`${g.prefix}${path}`, bodies[`${d.method} ${d.path}`]);
        expect(res.status, `${d.method.toUpperCase()} ${g.prefix}${d.path} → ${res.status} ${JSON.stringify(res.body)}`).toBe(404);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
    // A's session cookie on B's host is not valid there (sessions are per host, TR-TEN-13).
    const replay = client(api.app, 'tenant-b.dop.test');
    for (const [k, v] of a.admin.jar) replay.jar.set(k, v);
    expect((await replay.get('/api/admin/v1/venues')).status).toBe(401);
    // B's ticket is untouched.
    const still = await b.staff.get('/api/staff/v1/board');
    expect(still.body.open[0].version).toBe(1);
  });
});
