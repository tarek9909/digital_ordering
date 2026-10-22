import { createHmac } from 'node:crypto';
import { startTestDatabase } from '@dop/db/testing';
import { calculatedWait, createFoodicsConnector, createStaffMember, createTicket, createVenue, createWebhook, deliverWebhook, fanOutWebhook, checkWebhookUrl, resolvePublic, signPayload, createTenantWithOwner, staffMemberUnlock, ticketsCsv, transitionTicket, mfaRequiredFor, } from '@dop/services';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearTenantCache } from '../src/http/middleware.js';
import { registerConnector } from '../src/routes/connectors.js';
import { makeApi } from './helpers.js';
let t;
let api;
beforeAll(async () => {
    t = await startTestDatabase();
    api = makeApi(t.clients);
});
afterAll(async () => {
    await t?.stop();
});
let n = 0;
async function tenant(plan = 'pro') {
    n++;
    clearTenantCache();
    const r = await createTenantWithOwner(api.deps, { ownerName: 'O', email: `r2-${n}@x.test`, password: 'a-long-unique-passphrase', restaurantName: `R2 ${n}`, slug: `rtwo-${n}`, country: 'SA', locale: 'ar' }, { ip: '1.1.1.1' });
    const db = t.clients.platform();
    await db.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
    const planId = (await db.selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow()).id;
    await db.updateTable('tenants').set({ plan_id: planId, status: 'active', complimentary: true }).where('id', '=', r.tenantId).execute();
    await api.deps.kv.del(`t:${r.tenantId}:status`, `t:${r.tenantId}:flags`);
    const owner = { kind: 'user', userId: r.userId, tenantId: r.tenantId, role: 'owner', sessionId: 's', mfaVerified: false };
    return { ...r, owner };
}
async function apiKey(x) {
    const { createApiKey } = await import('@dop/services');
    return (await createApiKey(api.deps, x.owner, x.tenantId, x.venueId, 'POS')).key;
}
const v1 = (key) => ({
    post: (p, body, headers = {}) => request(api.app).post(`/v1${p}`).set('Host', 'api.dop.test').set('Authorization', `Bearer ${key}`).set(headers).send(body),
    get: (p) => request(api.app).get(`/v1${p}`).set('Host', 'api.dop.test').set('Authorization', `Bearer ${key}`),
});
describe('integration API (TRD §12.9)', () => {
    it('creates tickets idempotently, returns open tickets by reference and updates status', async () => {
        const x = await tenant();
        const c = v1(await apiKey(x));
        expect((await c.get('/me')).body.venue.id).toBe(x.venueId);
        const first = await c.post('/tickets', { externalRef: '1042', note: 'no onions' }, { 'Idempotency-Key': 'k1' });
        expect(first.status).toBe(201);
        expect(first.body).toMatchObject({ displayNumber: '1', externalRef: '1042', status: 'preparing' });
        expect(first.body.ticketUrl).toMatch(/^https:\/\/t\.dop\.test\/[0-9A-Za-z]{22}$/);
        expect(first.body.token).toBeUndefined();
        // Same key and body → same response; same key, other body → 422
        expect((await c.post('/tickets', { externalRef: '1042', note: 'no onions' }, { 'Idempotency-Key': 'k1' })).body.id).toBe(first.body.id);
        expect((await c.post('/tickets', { externalRef: '9' }, { 'Idempotency-Key': 'k1' })).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
        // An open ticket with the reference is returned (FR-INT-05)
        const again = await c.post('/tickets', { externalRef: '1042' });
        expect(again.status).toBe(200);
        expect(again.body.id).toBe(first.body.id);
        const ready = await c.post('/tickets/by-external-ref/1042/status', { status: 'ready' });
        expect(ready.body.status).toBe('ready');
        expect((await c.post('/tickets/by-external-ref/nope/status', { status: 'ready' })).status).toBe(404);
        // Check codes do not apply to the POS (BR-15)
        expect((await c.post(`/tickets/${first.body.id}/status`, { status: 'collected' })).body.status).toBe('collected');
        expect((await c.post(`/tickets/${first.body.id}/status`, { status: 'preparing' })).body.code).toBe('INVALID_TRANSITION');
        const png = await c.get(`/tickets/${first.body.id}/qr.png`);
        expect(png.headers['content-type']).toBe('image/png');
        expect((await request(api.app).get('/v1/me').set('Host', 'api.dop.test').set('Authorization', 'Bearer pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).status).toBe(401);
    });
    it('never reaches another tenant’s tickets and refuses keys without the feature', async () => {
        const a = await tenant();
        const b = await tenant();
        const ka = v1(await apiKey(a));
        const tb = await v1(await apiKey(b)).post('/tickets', {});
        expect((await ka.get(`/tickets/${tb.body.id}`)).status).toBe(404);
        expect((await ka.post(`/tickets/${tb.body.id}/status`, { status: 'ready' })).status).toBe(404);
        const trial = await tenant('trial');
        await t.clients.platform().updateTable('tenants').set({ status: 'trial', complimentary: false }).where('id', '=', trial.tenantId).execute();
        await expect(apiKey(trial)).rejects.toMatchObject({ code: 'FEATURE_NOT_IN_PLAN' });
    });
});
describe('webhooks (TRD §13)', () => {
    it('signs, retries on the schedule, refuses private addresses and disables after repeated failures', async () => {
        const x = await tenant();
        const { secret } = await createWebhook(api.deps, x.owner, x.tenantId, { url: 'https://hooks.example.com/pager', events: ['ticket.ready'] });
        expect(() => checkWebhookUrl('http://hooks.example.com')).toThrow();
        expect(() => checkWebhookUrl('https://169.254.169.254/latest/meta-data')).toThrow();
        await expect(resolvePublic('internal.example', async () => ['10.0.0.5'])).rejects.toThrow(/private/);
        const ids = await fanOutWebhook(api.deps, x.tenantId, x.venueId, 'ticket.ready', { ticket: { id: 't1' } });
        expect(ids).toHaveLength(1);
        expect(await fanOutWebhook(api.deps, x.tenantId, x.venueId, 'ticket.created', {})).toEqual([]); // not subscribed
        let seen = null;
        const ok = async (_u, body, headers) => ((seen = { body, sig: headers['X-Pager-Signature'] }), { status: 204 });
        const publicDns = async () => ['93.184.216.34'];
        expect((await deliverWebhook(api.deps, x.tenantId, ids[0], ok, publicDns)).status).toBe('succeeded');
        const tPart = /t=(\d+)/.exec(seen.sig)[1];
        expect(seen.sig).toBe(signPayload([secret], seen.body, Number(tPart)));
        expect(createHmac('sha256', secret).update(`${tPart}.${seen.body}`).digest('hex')).toBe(/v1=([0-9a-f]+)/.exec(seen.sig)[1]);
        // Failing endpoint: retry schedule, then disabled after ≥ 10 failures in 24 h with none succeeding (TR-WH-03).
        const failing = async () => ({ status: 500 });
        const y = await tenant();
        await createWebhook(api.deps, y.owner, y.tenantId, { url: 'https://down.example.com/h', events: ['ticket.ready'] });
        const first = (await fanOutWebhook(api.deps, y.tenantId, y.venueId, 'ticket.ready', {}))[0];
        const r1 = await deliverWebhook(api.deps, y.tenantId, first, failing, publicDns);
        expect(r1.status).toBe('failed');
        expect(r1.nextAttemptAt.getTime() - api.deps.now().getTime()).toBeLessThanOrEqual(60_000);
        for (let i = 0; i < 10; i++) {
            const id = (await fanOutWebhook(api.deps, y.tenantId, y.venueId, 'ticket.ready', {}))[0];
            if (id)
                await deliverWebhook(api.deps, y.tenantId, id, failing, publicDns);
        }
        const ep = await t.clients.forTenant(y.tenantId).selectFrom('webhook_endpoints').select(['status', 'disabled_reason']).executeTakeFirstOrThrow();
        expect(ep).toEqual({ status: 'disabled', disabled_reason: 'failing' });
    });
});
describe('multi-site, named staff, calculated wait, CSV (R2)', () => {
    it('needs the multi-site plan for a second venue and then two-factor sign-in', async () => {
        const pro = await tenant('pro');
        await expect(createVenue(api.deps, pro.owner, pro.tenantId, 'Second')).rejects.toMatchObject({ code: 'PLAN_LIMIT' });
        const multi = await tenant('multisite');
        expect(await mfaRequiredFor(api.deps, multi.tenantId)).toBe(false);
        await createVenue(api.deps, multi.owner, multi.tenantId, 'Mall branch');
        expect(await mfaRequiredFor(api.deps, multi.tenantId)).toBe(true);
    });
    it('records the named staff member as the actor', async () => {
        const x = await tenant();
        await createStaffMember(api.deps, x.owner, x.tenantId, x.venueId, 'Sara', '5937');
        await expect(createStaffMember(api.deps, x.owner, x.tenantId, x.venueId, 'Omar', '5937')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        const { name } = await staffMemberUnlock(api.deps, x.tenantId, x.venueId, 'dev-1', '5937');
        expect(name).toBe('Sara');
        const member = (await t.clients.forTenant(x.tenantId).selectFrom('staff_members').select('id').executeTakeFirstOrThrow()).id;
        const actor = { kind: 'staff_device', deviceId: 'dev-1', tenantId: x.tenantId, venueId: x.venueId, deviceName: 'iPad', member: { id: member, name: 'Sara' } };
        const tk = (await createTicket(api.deps, actor, x.venueId, {})).ticket;
        const ev = await t.clients.forTenant(x.tenantId).selectFrom('ticket_events').select(['actor_type', 'actor_id']).where('ticket_id', '=', tk.id).executeTakeFirstOrThrow();
        expect(ev).toEqual({ actor_type: 'staff_member', actor_id: member });
    });
    it('estimates wait from recent tickets and streams CSV with a BOM', async () => {
        const x = await tenant();
        const actor = { kind: 'staff_device', deviceId: 'd', tenantId: x.tenantId, venueId: x.venueId, deviceName: 'iPad' };
        for (let i = 0; i < 6; i++) {
            const tk = (await createTicket(api.deps, actor, x.venueId, {})).ticket;
            api.deps.clock.advance(8 * 60_000);
            await transitionTicket(api.deps, actor, tk.id, { to: 'ready', version: 1 });
        }
        const w = await calculatedWait(api.deps, x.tenantId, x.venueId, null, 10);
        expect(w.minutes).toBe(8);
        expect(w.range).toEqual([6, 10]);
        let csv = '';
        const today = api.deps.now().toISOString().slice(0, 10);
        for await (const chunk of ticketsCsv(api.deps, x.tenantId, { from: '2020-01-01', to: today }))
            csv += chunk;
        expect(csv.startsWith('﻿venue,business_date')).toBe(true);
        expect(csv.trim().split('\n')).toHaveLength(7);
    });
});
describe('Foodics connector (TR-INT-04)', () => {
    it('turns signed POS webhooks into tickets and status changes', async () => {
        const x = await tenant();
        const { savePosConnection } = await import('@dop/services');
        await savePosConnection(api.deps, x.owner, x.tenantId, x.venueId, 'foodics', 'BIZ-1', { access_token: 'tok' });
        registerConnector(createFoodicsConnector({ clientId: 'c', clientSecret: 's', webhookSecret: 'whs' }));
        const send = (payload, secret = 'whs') => {
            const raw = JSON.stringify(payload);
            return request(api.app)
                .post('/connectors/foodics/webhook')
                .set('Host', 'api.dop.test')
                .set('Content-Type', 'application/json')
                .set('X-Foodics-Signature', createHmac('sha256', secret).update(raw).digest('hex'))
                .send(raw);
        };
        expect((await send({ business: { reference: 'BIZ-1' }, order: { reference: 'F-77', status: 1 } }, 'wrong')).status).toBe(401);
        const created = await send({ business: { reference: 'BIZ-1' }, order: { reference: 'F-77', status: 1, kitchen_notes: 'extra cheese' } });
        expect(created.body).toMatchObject({ handled: true });
        await send({ business: { reference: 'BIZ-1' }, order: { reference: 'F-77', status: 3 } });
        const tk = await t.clients.forTenant(x.tenantId).selectFrom('tickets').select(['status', 'source', 'note']).where('external_ref', '=', 'F-77').executeTakeFirstOrThrow();
        expect(tk).toEqual({ status: 'ready', source: 'connector', note: 'extra cheese' });
    });
});
