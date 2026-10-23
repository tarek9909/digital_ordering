import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { BullJobs, QUEUES, type Jobs } from '@dop/jobs';
import { createTenantWithOwner, createWebhook, type HttpPoster } from '@dop/services';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApi } from '../../api/test/helpers.js';
import type { WorkerDeps } from '../src/handlers.js';
import { createProcessor } from '../src/processor.js';

// BW09 on the production queue path: a webhook fan-out job that fails after queueing only some deliver jobs is
// retried by BullMQ, and every subscribed endpoint still receives the event exactly once from one original delivery.
// Runs when TEST_REDIS_URL points at Redis ≥ 5; keys use a private prefix and are removed afterwards.

const REDIS_URL = process.env.TEST_REDIS_URL;

async function redisMajor(url: string | undefined): Promise<number> {
  if (!url) return 0;
  const r = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 2000 });
  try {
    await r.connect();
    return Number(/redis_version:(\d+)/.exec(await r.info('server'))?.[1] ?? 0);
  } catch {
    return 0;
  } finally {
    r.disconnect();
  }
}

const major = await redisMajor(REDIS_URL);
if (major < 5) console.warn(`webhook-fanout-queue.int.test: skipped — set TEST_REDIS_URL to Redis ≥ 5 (found ${major || 'none'})`);

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(major < 5)('BW09 partial webhook fan-out retried by BullMQ', () => {
  let t: TestDatabase;
  let api: ReturnType<typeof makeApi>;
  let jobs: BullJobs;
  let redis: Redis;
  const workers: Worker[] = [];
  const connections: Redis[] = [];
  const prefix = `dopwh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  /** Requests the fake receivers got: URL and event ID. No request leaves the process. */
  const received: Array<{ url: string; eventId: string }> = [];
  let failNextDeliverEnqueue = 0;
  let fanoutRuns = 0;

  beforeAll(async () => {
    t = await startTestDatabase();
    api = makeApi(t.clients);
    redis = new Redis(REDIS_URL!, { maxRetriesPerRequest: null });
    jobs = new BullJobs(redis, { prefix });
    (api.deps as unknown as { jobs: BullJobs }).jobs = jobs;
    // The worker's queue client fails one deliver enqueue on demand: the fan-out job then fails half-way.
    let deliverAdds = 0;
    const flaky: Jobs = {
      add: async (name, data, opts) => {
        if (name === 'webhook.fanout') fanoutRuns++;
        if (name === 'webhook.deliver' && ++deliverAdds === failNextDeliverEnqueue) throw new Error('queue unavailable (injected)');
        return jobs.add(name, data, opts);
      },
    } as Jobs;
    const poster: HttpPoster = async (url, _body, headers) => {
      received.push({ url, eventId: headers['X-Pager-Event-Id']! });
      return { status: 200 };
    };
    const deps: WorkerDeps = {
      ...api.deps,
      jobs: flaky,
      push: async () => 201,
      mailer: { send: async () => undefined },
      storage: api.deps.storage,
      webhookPoster: poster,
      webhookResolver: async () => ['93.184.216.34'],
    };
    const processor = createProcessor(deps, redis);
    for (const q of QUEUES) {
      const c = new Redis(REDIS_URL!, { maxRetriesPerRequest: null });
      connections.push(c);
      workers.push(new Worker(q, processor, { connection: c, prefix, concurrency: 4 }));
    }
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await jobs?.close();
    if (redis) {
      const keys = await redis.keys(`${prefix}:*`);
      for (const k of keys) if (k.startsWith(`${prefix}:`)) await redis.del(k);
      redis.disconnect();
    }
    for (const c of connections) c.disconnect();
    await t?.stop();
  });

  it('delivers once per endpoint after the fan-out job is retried', async () => {
    const r = await createTenantWithOwner(api.deps, { ownerName: 'Owner', email: 'wh-queue@x.test', password: 'a-long-unique-passphrase', restaurantName: 'Cafe hooks', slug: 'wh-queue', country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
    const pdb = t.clients.platform();
    const pro = await pdb.selectFrom('plans').select('id').where('code', '=', 'pro').executeTakeFirstOrThrow();
    await pdb.updateTable('tenants').set({ plan_id: pro.id, status: 'active', complimentary: true }).where('id', '=', r.tenantId).execute();
    await api.deps.kv.del(`t:${r.tenantId}:status`, `t:${r.tenantId}:flags`);
    const owner = { kind: 'user' as const, userId: r.userId, tenantId: r.tenantId, role: 'owner' as const, sessionId: 's', mfaVerified: false };
    const urls = ['https://one.example/hook', 'https://two.example/hook', 'https://three.example/hook'];
    for (const url of urls) await createWebhook(api.deps, owner, r.tenantId, { url, events: ['ticket.created'] });

    // The second deliver enqueue of the first run fails: one deliver job is queued, the fan-out job fails and retries.
    failNextDeliverEnqueue = 2;
    await jobs.add('webhook.fanout', { tenantId: r.tenantId, venueId: r.venueId, type: 'ticket.created', eventKey: 'outbox:bw09-partial', data: { ticket: { id: 'x' } } }, { jobId: 'whf-bw09-partial' });

    await waitFor('every endpoint received the event', async () => new Set(received.map((x) => x.url)).size === urls.length);
    const job = await jobs.queue('webhooks').getJob('whf-bw09-partial');
    await waitFor('fan-out job completed', async () => (await job?.getState()) === 'completed');
    expect(job!.attemptsMade).toBeGreaterThanOrEqual(2); // it really failed once and was retried by the queue
    // Let any duplicate deliver job surface before counting.
    await new Promise((res) => setTimeout(res, 1500));

    const db = t.clients.forTenant(r.tenantId);
    const rows = await db.selectFrom('webhook_deliveries').select(['endpoint_id', 'event_id', 'status', 'attempt', 'is_original']).execute();
    expect(rows).toHaveLength(urls.length); // one original delivery per subscribed endpoint
    expect(rows.every((x) => x.status === 'succeeded' && x.attempt === 1 && x.is_original === true)).toBe(true);
    expect(new Set(rows.map((x) => x.event_id)).size).toBe(1);
    expect(received.map((x) => x.url).sort()).toEqual([...urls].sort()); // each receiver called exactly once
    expect(new Set(received.map((x) => x.eventId))).toEqual(new Set([rows[0]!.event_id]));
    expect(fanoutRuns).toBe(0); // the worker itself never re-enqueued the fan-out; the retry came from BullMQ
  });
});
