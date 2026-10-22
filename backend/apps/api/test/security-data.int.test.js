import { createHmac } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { startTestDatabase } from '@dop/db/testing';
import { json } from '@dop/db';
import * as svc from '@dop/services';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerConnector } from '../src/routes/connectors.js';
import { client, makeApi } from './helpers.js';
// Regression tests for the 2026-10-22 security audit (docs/security/2026-10-22/SECURITY-AUDIT.md):
// M-8 CSV formula neutralisation, L-14 push/alert retention, L-17 POS webhook replay, L-18 outbox dead-letter,
// M-12 outgoing webhook limits. Disposable MySQL; no network, email or payment provider is contacted.
let t;
let api;
const PASSWORD = 'a-long-unique-passphrase';
let n = 0;
beforeAll(async () => {
    t = await startTestDatabase();
    api = makeApi(t.clients);
});
afterAll(async () => {
    await t?.stop();
});
async function tenant(plan) {
    n++;
    const slug = `sec-${n}-${Math.random().toString(36).slice(2, 6)}`;
    const email = `${slug}@x.test`;
    const x = await svc.createTenantWithOwner(api.deps, { ownerName: 'Owner', email, password: PASSWORD, restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
    const pdb = t.clients.platform();
    await pdb.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', x.userId).execute();
    if (plan) {
        const p = await pdb.selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow();
        await pdb.updateTable('tenants').set({ status: 'active', complimentary: true, plan_id: p.id }).where('id', '=', x.tenantId).execute();
        await api.deps.kv.del(`t:${x.tenantId}:flags`);
    }
    const owner = { kind: 'user', userId: x.userId, tenantId: x.tenantId, role: 'owner', sessionId: 's', mfaVerified: false };
    const device = { kind: 'staff_device', deviceId: 'd', tenantId: x.tenantId, venueId: x.venueId, deviceName: 'iPad' };
    return { ...x, slug, email, owner, device };
}
async function signedIn(x) {
    const admin = client(api.app, `${x.slug}.dop.test`);
    expect((await admin.post('/api/auth/v1/sign-in', { email: x.email, password: PASSWORD })).status).toBe(200);
    admin.setCsrf((await admin.get('/api/auth/v1/me')).body.csrfToken);
    return admin;
}
/** Reads the files of a ZIP written by buildZip (local headers carry the sizes). */
function unzip(zip) {
    const out = new Map();
    let o = 0;
    while (zip.readUInt32LE(o) === 0x04034b50) {
        const method = zip.readUInt16LE(o + 8);
        const size = zip.readUInt32LE(o + 18);
        const nameLen = zip.readUInt16LE(o + 26);
        const extraLen = zip.readUInt16LE(o + 28);
        const name = zip.subarray(o + 30, o + 30 + nameLen).toString('utf8');
        const start = o + 30 + nameLen + extraLen;
        const data = zip.subarray(start, start + size);
        out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
        o = start + size;
    }
    return out;
}
const clientId = (c) => c.repeat(22);
const fcm = (e) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${e}`, keys: { p256dh: 'x'.repeat(40), auth: 'y'.repeat(16) } });
describe('M-8 spreadsheet-safe CSV', () => {
    it('encodes cells', () => {
        expect(svc.csvCell('=1+1')).toBe("'=1+1");
        expect(svc.csvCell('+cmd')).toBe("'+cmd");
        expect(svc.csvCell('-2+3')).toBe("'-2+3");
        expect(svc.csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(svc.csvCell('  =HYPERLINK("x")')).toBe(`"'  =HYPERLINK(""x"")"`);
        expect(svc.csvCell('\t=1')).toBe("'\t=1");
        expect(svc.csvCell('\r=1')).toBe(`"'\r=1"`);
        expect(svc.csvCell('＝1+1')).toBe("'＝1+1");
        expect(svc.csvCell('a,b')).toBe('"a,b"');
        expect(svc.csvCell('line\rbreak')).toBe('"line\rbreak"');
        expect(svc.csvCell('say "hi"')).toBe('"say ""hi"""');
        expect(svc.csvCell('plain text')).toBe('plain text');
        expect(svc.csvCell(-5)).toBe('-5');
        expect(svc.csvCell('-12.50')).toBe('-12.50');
        expect(svc.csvCell(42n)).toBe('42');
        expect(svc.csvCell(null)).toBe('');
        expect(svc.csvCell(new Date('2026-10-22T00:00:00Z'))).toBe('2026-10-22T00:00:00.000Z');
        expect(svc.csvDocument([{ a: '=x', b: 3 }])).toBe("﻿a,b\n'=x,3\n");
    });
    it('neutralises a customer rating comment and a receipt in the export ZIP and the report CSV', async () => {
        const x = await tenant('pro');
        const tk = (await svc.createTicket(api.deps, x.device, x.venueId, { externalRef: '+cmd', note: '@SUM(1)' })).ticket;
        await svc.follow(api.deps, tk.token, { clientId: clientId('Q'), joinedVia: 'ticket_qr', uaFamily: 'other' });
        await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'ready', version: 1 });
        await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'collected', version: 2 });
        await svc.rateTicket(api.deps, tk.token, { clientId: clientId('Q'), stars: 5, comment: '=1+1' });
        const { id } = await svc.requestExport(api.deps, x.owner, x.tenantId);
        let zip = null;
        const capture = { put: async (_b, _k, body) => void (zip = body), get: async () => null, signedUrl: async () => '', deletePrefix: async () => 0 };
        await svc.buildExport(api.deps, x.tenantId, id, capture);
        const files = unzip(zip);
        const ratings = files.get('ratings.csv');
        expect(ratings.startsWith('﻿ticket_id,stars,comment,created_at\n')).toBe(true);
        expect(ratings).toContain(",5,'=1+1,");
        expect(ratings).not.toMatch(/,=1\+1/);
        const tickets = files.get('tickets.csv');
        expect(tickets).toContain(",'+cmd,");
        expect(tickets).toContain(",'@SUM(1),");
        let csv = '';
        const today = api.deps.now().toISOString().slice(0, 10);
        for await (const chunk of svc.ticketsCsv(api.deps, x.tenantId, { from: '2020-01-01', to: today }))
            csv += chunk;
        expect(csv.startsWith('﻿venue,business_date')).toBe(true);
        expect(csv).toContain(",'+cmd,");
        expect(csv).not.toMatch(/,\+cmd/);
    });
});
describe('L-14 push subscription and alert retention', () => {
    it('tenant purge removes subscriptions only that tenant used and keeps shared ones', async () => {
        const a = await tenant();
        const b = await tenant();
        const pdb = t.clients.platform();
        const a1 = (await svc.createTicket(api.deps, a.device, a.venueId, {})).ticket;
        const a2 = (await svc.createTicket(api.deps, a.device, a.venueId, {})).ticket;
        const b1 = (await svc.createTicket(api.deps, b.device, b.venueId, {})).ticket;
        const shared = fcm(`shared-${n}`);
        const onlyA = fcm(`only-a-${n}`);
        await svc.follow(api.deps, a1.token, { clientId: clientId('S'), joinedVia: 'ticket_qr', uaFamily: 'other' });
        await svc.savePushSubscription(api.deps, a1.token, { clientId: clientId('S'), subscription: shared }, 'fcm');
        await svc.follow(api.deps, b1.token, { clientId: clientId('S'), joinedVia: 'ticket_qr', uaFamily: 'other' });
        await svc.savePushSubscription(api.deps, b1.token, { clientId: clientId('S'), subscription: shared }, 'fcm');
        await svc.follow(api.deps, a2.token, { clientId: clientId('T'), joinedVia: 'ticket_qr', uaFamily: 'other' });
        await svc.savePushSubscription(api.deps, a2.token, { clientId: clientId('T'), subscription: onlyA }, 'fcm');
        const subs = await pdb.selectFrom('push_subscriptions').select(['id', 'endpoint']).where('endpoint', 'in', [shared.endpoint, onlyA.endpoint]).execute();
        expect(subs).toHaveLength(2);
        const subOf = (e) => subs.find((s) => s.endpoint === e).id;
        await pdb.insertInto('alert_attempts').values({ tenant_id: a.tenantId, ticket_id: a1.id, round: 1, attempt: '1' }).execute();
        await pdb.insertInto('alert_deliveries').values({ tenant_id: a.tenantId, ticket_id: a1.id, round: 1, attempt: '1', subscription_id: subOf(shared.endpoint), outcome: 'sent' }).execute();
        await svc.markDeleted(api.deps, a.tenantId, { kind: 'system' });
        expect((await svc.purgeTenant(api.deps, a.tenantId, null)).done).toBe(true);
        const left = await pdb.selectFrom('push_subscriptions').select('endpoint').where('endpoint', 'in', [shared.endpoint, onlyA.endpoint]).execute();
        expect(left.map((s) => s.endpoint)).toEqual([shared.endpoint]);
        expect(await pdb.selectFrom('alert_attempts').select('ticket_id').where('ticket_id', '=', a1.id).execute()).toEqual([]);
        expect(await pdb.selectFrom('alert_deliveries').select('ticket_id').where('ticket_id', '=', a1.id).execute()).toEqual([]);
        // B's follower still uses it.
        expect(await pdb.selectFrom('ticket_followers').select('push_subscription_id').where('ticket_id', '=', b1.id).executeTakeFirst()).toEqual({ push_subscription_id: subOf(shared.endpoint) });
    });
    it('ticket retention removes the tickets alert records and now-orphaned subscriptions', async () => {
        const x = await tenant();
        const pdb = t.clients.platform();
        const old = (await svc.createTicket(api.deps, x.device, x.venueId, {})).ticket;
        const fresh = (await svc.createTicket(api.deps, x.device, x.venueId, {})).ticket;
        const gone = fcm(`retained-gone-${n}`);
        const kept = fcm(`retained-kept-${n}`);
        await svc.follow(api.deps, old.token, { clientId: clientId('U'), joinedVia: 'ticket_qr', uaFamily: 'other' });
        await svc.savePushSubscription(api.deps, old.token, { clientId: clientId('U'), subscription: gone }, 'fcm');
        await svc.follow(api.deps, old.token, { clientId: clientId('V'), joinedVia: 'ticket_qr', uaFamily: 'other' });
        await svc.savePushSubscription(api.deps, old.token, { clientId: clientId('V'), subscription: kept }, 'fcm');
        await svc.follow(api.deps, fresh.token, { clientId: clientId('V'), joinedVia: 'ticket_qr', uaFamily: 'other' });
        await svc.savePushSubscription(api.deps, fresh.token, { clientId: clientId('V'), subscription: kept }, 'fcm');
        await pdb.insertInto('alert_attempts').values({ tenant_id: x.tenantId, ticket_id: old.id, round: 1, attempt: '1' }).execute();
        const goneId = (await pdb.selectFrom('push_subscriptions').select('id').where('endpoint', '=', gone.endpoint).executeTakeFirstOrThrow()).id;
        await pdb.insertInto('alert_deliveries').values({ tenant_id: x.tenantId, ticket_id: old.id, round: 1, attempt: '1', subscription_id: goneId, outcome: 'sent' }).execute();
        await svc.rollupVenueDay(api.deps, x.tenantId, x.venueId, old.business_date);
        await pdb.updateTable('tickets').set({ created_at: new Date(api.deps.now().getTime() - 100 * 86_400_000) }).where('id', '=', old.id).execute();
        expect(await svc.retentionTickets(api.deps)).toBeGreaterThanOrEqual(1);
        expect(await pdb.selectFrom('tickets').select('id').where('id', '=', old.id).executeTakeFirst()).toBeUndefined();
        expect(await pdb.selectFrom('alert_attempts').select('ticket_id').where('ticket_id', '=', old.id).execute()).toEqual([]);
        expect(await pdb.selectFrom('alert_deliveries').select('ticket_id').where('ticket_id', '=', old.id).execute()).toEqual([]);
        const left = await pdb.selectFrom('push_subscriptions').select('endpoint').where('endpoint', 'in', [gone.endpoint, kept.endpoint]).execute();
        expect(left.map((s) => s.endpoint)).toEqual([kept.endpoint]);
    });
});
describe('L-17 POS webhook replay', () => {
    it('acknowledges a replayed Foodics delivery without re-applying it', async () => {
        const x = await tenant('pro');
        await svc.savePosConnection(api.deps, x.owner, x.tenantId, x.venueId, 'foodics', `BIZ-R${n}`, { access_token: 'tok' });
        registerConnector(svc.createFoodicsConnector({ clientId: 'c', clientSecret: 's', webhookSecret: 'whs' }));
        const send = (raw) => request(api.app).post('/connectors/foodics/webhook').set('Host', 'api.dop.test').set('Content-Type', 'application/json').set('X-Foodics-Signature', createHmac('sha256', 'whs').update(raw).digest('hex')).send(raw);
        const ref = `R-${n}`;
        const created = JSON.stringify({ business: { reference: `BIZ-R${n}` }, order: { reference: ref, status: 1 } });
        const ready = JSON.stringify({ business: { reference: `BIZ-R${n}` }, order: { reference: ref, status: 3 } });
        const collected = JSON.stringify({ business: { reference: `BIZ-R${n}` }, order: { reference: ref, status: 4 } });
        expect((await send(created)).body).toMatchObject({ handled: true });
        const replay = await send(created);
        expect(replay.status).toBe(200);
        expect(replay.body).toEqual({ handled: false, duplicate: true });
        expect((await send(ready)).body).toMatchObject({ handled: true });
        expect((await send(collected)).body).toMatchObject({ handled: true });
        // Replaying the original "created" after collection would otherwise open a second ticket.
        expect((await send(created)).body).toEqual({ handled: false, duplicate: true });
        expect((await send(ready)).body).toEqual({ handled: false, duplicate: true });
        const rows = await t.clients.forTenant(x.tenantId).selectFrom('tickets').select(['status']).where('external_ref', '=', ref).execute();
        expect(rows).toEqual([{ status: 'collected' }]);
    });
    it('releases the claim when processing fails so the provider retry is applied', async () => {
        let fail = true;
        let applied = 0;
        const stub = {
            provider: 'replaystub',
            connectUrl: () => 'https://pos.example/',
            exchange: async () => ({ credentials: {}, locationId: 'x' }),
            verifyWebhook: () => true,
            mapOrder: () => {
                if (fail) {
                    fail = false;
                    throw new Error('transient');
                }
                applied++;
                return null;
            },
            disconnect: async () => undefined,
        };
        const raw = Buffer.from(JSON.stringify({ any: `body-${n}` }));
        await expect(svc.handlePosWebhook(api.deps, stub, raw, {})).rejects.toThrow('transient');
        expect(await svc.handlePosWebhook(api.deps, stub, raw, {})).toEqual({ handled: false });
        expect(await svc.handlePosWebhook(api.deps, stub, raw, {})).toEqual({ handled: false, duplicate: true });
        expect(applied).toBe(1);
    });
});
describe('L-18 outbox dead-letter', () => {
    it('parks a row that keeps failing for over a day and keeps transient failures on retry', async () => {
        const pdb = t.clients.platform();
        const poison = { emit: {}, jobs: [{ name: 'email.send', data: { not: 'valid' } }] };
        const insert = async (attempts, ageMs) => Number((await pdb.insertInto('outbox').values({ tenant_id: null, topic: svc.JOBS_TOPIC, payload: json(poison), attempts, created_at: new Date(Date.now() - ageMs) }).executeTakeFirstOrThrow()).insertId);
        const oldPoison = await insert(svc.OUTBOX_MAX_ATTEMPTS - 1, 2 * 86_400_000);
        const youngFailing = await insert(svc.OUTBOX_MAX_ATTEMPTS - 1, 60_000);
        const firstFailure = await insert(0, 2 * 86_400_000);
        await svc.flushOutbox(api.deps, [oldPoison, youngFailing, firstFailure]);
        const rows = await pdb.selectFrom('outbox').select(['id', 'attempts', 'parked_at', 'next_attempt_at', 'last_error']).where('id', 'in', [oldPoison, youngFailing, firstFailure]).orderBy('id').execute();
        expect(rows[0]).toMatchObject({ attempts: svc.OUTBOX_MAX_ATTEMPTS, next_attempt_at: null });
        expect(rows[0].parked_at).toBeInstanceOf(Date);
        expect(rows[0].last_error).toBeTruthy();
        expect(rows[1]).toMatchObject({ attempts: svc.OUTBOX_MAX_ATTEMPTS, parked_at: null });
        expect(rows[1].next_attempt_at).toBeInstanceOf(Date);
        expect(rows[2]).toMatchObject({ attempts: 1, parked_at: null });
        // The relay never picks the parked row again, even when its retry time would have passed.
        await pdb.updateTable('outbox').set({ next_attempt_at: null }).where('id', '=', oldPoison).execute();
        await svc.relayOutbox(api.deps, 10_000);
        expect(await pdb.selectFrom('outbox').select('attempts').where('id', '=', oldPoison).executeTakeFirstOrThrow()).toEqual({ attempts: svc.OUTBOX_MAX_ATTEMPTS });
        expect(svc.shouldParkOutboxRow(svc.OUTBOX_MAX_ATTEMPTS, new Date(Date.now() - 3600_000))).toBe(false);
    });
});
describe('M-12 outgoing webhook limits', () => {
    it('caps endpoints per tenant', async () => {
        const x = await tenant('pro');
        for (let i = 0; i < svc.MAX_WEBHOOK_ENDPOINTS_PER_TENANT; i++)
            await svc.createWebhook(api.deps, x.owner, x.tenantId, { url: `https://hooks.example.com/${i}`, events: ['ticket.ready'] });
        await expect(svc.createWebhook(api.deps, x.owner, x.tenantId, { url: 'https://hooks.example.com/over', events: ['ticket.ready'] })).rejects.toMatchObject({ code: 'PLAN_LIMIT' });
    });
    it('rate-limits manual test sends per user and redeliveries', async () => {
        const x = await tenant('pro');
        const admin = await signedIn(x);
        const { id } = await svc.createWebhook(api.deps, x.owner, x.tenantId, { url: 'https://hooks.example.com/t', events: ['ticket.ready'] });
        const codes = [];
        for (let i = 0; i < 11; i++)
            codes.push((await admin.post(`/api/admin/v1/webhooks/${id}/test`)).status);
        expect(codes.slice(0, 10).every((c) => c === 202)).toBe(true);
        expect(codes[10]).toBe(429);
        const delivery = (await t.clients.forTenant(x.tenantId).selectFrom('webhook_deliveries').select('id').where('endpoint_id', '=', id).executeTakeFirstOrThrow()).id;
        const re = [];
        for (let i = 0; i < 31; i++)
            re.push((await admin.post(`/api/admin/v1/webhook-deliveries/${delivery}/redeliver`)).status);
        expect(re.slice(0, 30).every((c) => c === 202)).toBe(true);
        expect(re[30]).toBe(429);
        api.deps.jobs.take('webhook.deliver');
    });
    it('rate-limits manual sends per tenant across users', async () => {
        const x = await tenant('pro');
        const { id } = await svc.createWebhook(api.deps, x.owner, x.tenantId, { url: 'https://hooks.example.com/u', events: ['ticket.ready'] });
        // Spend the tenant budget directly (other users of the tenant), then one more request from the owner fails.
        for (let i = 0; i < 30; i++)
            await api.deps.rateLimit('webhook-test-tenant', x.tenantId, 30, 3600);
        const admin = await signedIn(x);
        expect((await admin.post(`/api/admin/v1/webhooks/${id}/test`)).status).toBe(429);
    });
});
