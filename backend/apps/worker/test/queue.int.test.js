import { startTestDatabase } from '@dop/db/testing';
import { BullJobs, QUEUES } from '@dop/jobs';
import { createTenantWithOwner, flushOutbox, jobIds, markDeleted, suspendTenant } from '@dop/services';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, makeApi } from '../../api/test/helpers.js';
import { createProcessor } from '../src/processor.js';
// The production queue path (A01): the BullMQ adapter, a real Redis ≥ 5 and the worker's own processor.
// Runs when TEST_REDIS_URL points at Redis 5 or later (CI: redis:7); the in-memory queue applies the same
// job-ID rules, but only this suite proves that jobs are accepted, run, retried and finish.
const REDIS_URL = process.env.TEST_REDIS_URL;
async function redisMajor(url) {
    if (!url)
        return 0;
    const r = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 2000 });
    try {
        await r.connect();
        return Number(/redis_version:(\d+)/.exec(await r.info('server'))?.[1] ?? 0);
    }
    catch {
        return 0;
    }
    finally {
        r.disconnect();
    }
}
const major = await redisMajor(REDIS_URL);
if (major < 5)
    console.warn(`queue.int.test: skipped — set TEST_REDIS_URL to Redis ≥ 5 (found ${major || 'none'})`);
const PASSWORD = 'a-long-unique-passphrase';
async function waitFor(what, fn, timeoutMs = 20_000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const v = await fn();
        if (v)
            return v;
        if (Date.now() > end)
            throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 100));
    }
}
describe.skipIf(major < 5)('real queue (BullMQ on Redis ≥ 5)', () => {
    let t;
    let api;
    let jobs;
    let redis;
    const workers = [];
    const connections = [];
    const prefix = `dopt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const mails = [];
    const pushes = [];
    /** Push-service answers per endpoint suffix, consumed in order; then 201. */
    const plan = new Map();
    beforeAll(async () => {
        t = await startTestDatabase();
        api = makeApi(t.clients);
        redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
        jobs = new BullJobs(redis, { prefix });
        api.deps.jobs = jobs;
        const mailer = { send: async (m) => void mails.push(m) };
        const push = async (m) => {
            const suffix = m.endpoint.split('/').pop();
            const status = plan.get(suffix)?.shift() ?? 201;
            pushes.push({ suffix, attempt: JSON.parse(m.payload).attempt, status });
            return status;
        };
        const deps = { ...api.deps, push, mailer, storage: api.deps.storage };
        const processor = createProcessor(deps, redis);
        for (const q of QUEUES) {
            const c = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
            connections.push(c);
            workers.push(new Worker(q, processor, { connection: c, prefix, concurrency: 4 }));
        }
    });
    afterAll(async () => {
        await Promise.all(workers.map((w) => w.close()));
        await jobs?.close();
        // Remove only this suite's keys.
        if (redis) {
            const keys = await redis.keys(`${prefix}:*`);
            for (const k of keys)
                if (k.startsWith(`${prefix}:`))
                    await redis.del(k);
            redis.disconnect();
        }
        for (const c of connections)
            c.disconnect();
        await t?.stop();
    });
    async function onboard(slug) {
        const r = await createTenantWithOwner(api.deps, { ownerName: 'Owner', email: `${slug}@x.test`, password: PASSWORD, restaurantName: `Cafe ${slug}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
        await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
        const admin = client(api.app, `${slug}.dop.test`);
        expect((await admin.post('/api/auth/v1/sign-in', { email: `${slug}@x.test`, password: PASSWORD })).status).toBe(200);
        const me = await admin.get('/api/auth/v1/me');
        admin.setCsrf(me.body.csrfToken);
        const venueId = (await admin.get('/api/admin/v1/venues')).body.items[0].id;
        return { admin, venueId, tenantId: me.body.currentTenantId };
    }
    async function readyTicketWithFollowers(a, endpoints) {
        const created = await a.admin.post(`/api/staff/v1/tickets?venueId=${a.venueId}`, {});
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const ticket = created.body.ticket;
        const token = created.body.qr.split('/').pop();
        const phone = client(api.app, 't.dop.test');
        for (const [i, suffix] of endpoints.entries()) {
            const clientId = String.fromCharCode(65 + i).repeat(22);
            expect((await phone.post(`/api/public/v1/tickets/${token}/follow`, { clientId, joinedVia: 'ticket_qr', uaFamily: 'other' })).status).toBe(200);
            const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys: { p256dh: 'x'.repeat(40), auth: 'y'.repeat(16) } };
            expect((await phone.put(`/api/public/v1/tickets/${token}/push-subscription`, { clientId, subscription: sub })).status).toBe(204);
        }
        const ready = await a.admin.post(`/api/staff/v1/tickets/${ticket.id}/transitions?venueId=${a.venueId}`, { to: 'ready', version: 1 });
        expect(ready.status, JSON.stringify(ready.body)).toBe(200);
        return { ticketId: ticket.id, token };
    }
    it('signs up, emails, publishes ticket events and sends the first alert through the queue', async () => {
        const a = await onboard('queue-one');
        await waitFor('verification email', async () => mails.find((m) => m.to === 'queue-one@x.test'));
        const { ticketId } = await readyTicketWithFollowers(a, ['one']);
        const topics = api.deps.kv.published.map((p) => JSON.parse(p.message)).filter((e) => e.ticketId === ticketId).map((e) => e.topic);
        expect(topics).toEqual(expect.arrayContaining(['ticket.created', 'ticket.updated']));
        const pending = await t.clients.platform().selectFrom('outbox').select('id').where('published_at', 'is', null).execute();
        expect(pending).toEqual([]);
        await waitFor('first push', async () => pushes.find((p) => p.suffix === 'one' && p.attempt === 1));
        const repeat = await jobs.queue('alerts').getJob(jobIds.repeat(ticketId, 1, 2));
        expect(await repeat?.getState()).toBe('delayed');
    });
    it('retries only the failing recipient of an alert and continues a failed repeat (A08, A31)', async () => {
        const a = await onboard('queue-two');
        plan.set('flaky', [503]);
        const { ticketId } = await readyTicketWithFollowers(a, ['steady', 'flaky']);
        await waitFor('retried push', async () => pushes.filter((p) => p.suffix === 'flaky' && p.attempt === 1).length === 2);
        expect(pushes.filter((p) => p.suffix === 'steady' && p.attempt === 1)).toHaveLength(1);
        const db = t.clients.forTenant(a.tenantId);
        // The fake push service answers before the worker records the outcome, so wait for the record itself.
        const outcomes = async (attempt) => (await db.selectFrom('alert_deliveries').select('outcome').where('ticket_id', '=', ticketId).where('attempt', '=', attempt).orderBy('subscription_id').execute()).map((d) => d.outcome);
        await waitFor('both recipients delivered', async () => JSON.stringify(await outcomes('1')) === '["sent","sent"]');
        const alerts = () => api.deps.kv.published.filter((p) => { const e = JSON.parse(p.message); return e.topic === 'ticket.alert' && e.ticketId === ticketId; }).length;
        expect(alerts()).toBe(1);
        // Repeat 2 meets a push-service error, is retried by the queue and reaches the flaky phone.
        plan.set('flaky', [503]);
        await jobs.add('alert.repeat', { tenantId: a.tenantId, ticketId, round: 1, n: 2 }, { jobId: `${jobIds.repeat(ticketId, 1, 2)}-now` });
        await waitFor('retried repeat', async () => pushes.filter((p) => p.suffix === 'flaky' && p.attempt === 2).length === 2);
        await waitFor('repeat delivered to both', async () => JSON.stringify(await outcomes('2')) === '["sent","sent"]');
        expect(pushes.filter((p) => p.suffix === 'steady' && p.attempt === 2)).toHaveLength(1);
        const ticket = await db.selectFrom('tickets').select('auto_alerts_sent').where('id', '=', ticketId).executeTakeFirstOrThrow();
        expect(ticket.auto_alerts_sent).toBe(2);
        expect(alerts()).toBe(2);
    });
    it('builds an export, survives a queue outage for a status email and purges a deleted tenant', async () => {
        const a = await onboard('queue-three');
        const exp = await a.admin.post('/api/admin/v1/exports', {});
        expect(exp.status, JSON.stringify(exp.body)).toBe(202);
        const db = t.clients.forTenant(a.tenantId);
        await waitFor('export ready', async () => (await db.selectFrom('data_exports').select('status').where('id', '=', exp.body.id).executeTakeFirst())?.status === 'ready');
        await waitFor('export email', async () => mails.find((m) => m.to === 'queue-three@x.test' && /export/i.test(m.subject)));
        // A09: the queue is down when a status change sends its email. The job waits in the outbox and the relay
        // enqueues it once the queue is back.
        const pdb = t.clients.platform();
        const down = { add: async () => Promise.reject(new Error('queue unavailable')) };
        const real = api.deps.jobs;
        api.deps.jobs = down;
        await suspendTenant(api.deps, a.tenantId, { kind: 'system' }, 'Queue outage drill');
        api.deps.jobs = real;
        const stuck = await pdb.selectFrom('outbox').select(['id', 'attempts']).where('topic', '=', 'jobs').where('published_at', 'is', null).execute();
        expect(stuck.length).toBeGreaterThan(0);
        await flushOutbox(api.deps, stuck.map((r) => r.id)); // what the relay does
        await waitFor('suspension email', async () => mails.find((m) => m.to === 'queue-three@x.test' && /suspended/i.test(m.subject)));
        await markDeleted(api.deps, a.tenantId, { kind: 'system' });
        await waitFor('tenant purged', async () => !(await pdb.selectFrom('tenants').select('id').where('id', '=', a.tenantId).executeTakeFirst()), 30_000);
        await waitFor('deletion email', async () => mails.filter((m) => m.to === 'queue-three@x.test').length >= 3);
    });
});
