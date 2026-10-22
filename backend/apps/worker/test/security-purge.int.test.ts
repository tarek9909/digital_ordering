import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import type { MemoryJobs } from '@dop/jobs';
import * as svc from '@dop/services';
import { DelayedError, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeApi } from '../../api/test/helpers.js';
import { JOB_HANDLERS, type WorkerDeps } from '../src/handlers.js';
import { createProcessor } from '../src/processor.js';

// 2026-10-22 security audit: M-20 (object-store per-key errors stop the purge), M-12 (per-tenant fairness for webhook
// deliveries), and the purge of offline payment records. Controlled stubs only: no S3 or network.

let t: TestDatabase;
let api: ReturnType<typeof makeApi>;
let n = 0;

beforeAll(async () => {
  t = await startTestDatabase();
  api = makeApi(t.clients);
});
afterAll(async () => {
  await t?.stop();
});
afterEach(() => vi.restoreAllMocks());

function workerDeps(storage: svc.ObjectStorage): WorkerDeps {
  return { ...api.deps, storage, push: async () => 201, mailer: { send: async () => undefined } };
}

async function deletedTenant(withPayment = false) {
  n++;
  const slug = `purge-${n}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@x.test`;
  const x = await svc.createTenantWithOwner(api.deps, { ownerName: 'Owner', email, password: 'a-long-unique-passphrase', restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
  if (withPayment) {
    const platform = { kind: 'platform' as const, platformUserId: 'pu-purge', role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };
    await svc.recordPayment(api.deps, platform, x.tenantId, { amountMinor: 3000, currency: 'USD', months: 1, method: 'cash' });
  }
  await svc.markDeleted(api.deps, x.tenantId, { kind: 'system' });
  (api.deps.jobs as MemoryJobs).take('tenant.purge');
  return { ...x, email };
}

const tenantRow = (id: string) => t.clients.platform().selectFrom('tenants').select(['status']).where('id', '=', id).executeTakeFirst();
const completionMails = (email: string) =>
  (api.deps.jobs as MemoryJobs).take('email.send').filter((j) => (j.data as { template: string; to: string }).template === 'deletion_completed' && (j.data as { to: string }).to === email);
const memory: svc.ObjectStorage = { put: async () => undefined, get: async () => null, signedUrl: async () => '', deletePrefix: async () => 0 };

describe('tenant purge', () => {
  it('removes the tenant with its payment records and sends one completion email', async () => {
    const x = await deletedTenant(true);
    const payments = () => t.clients.platform().selectFrom('tenant_payments').select('id').where('tenant_id', '=', x.tenantId).execute();
    expect(await payments()).toHaveLength(1);
    await JOB_HANDLERS['tenant.purge'](workerDeps(memory), { tenantId: x.tenantId });
    expect(await tenantRow(x.tenantId)).toBeUndefined();
    expect(await payments()).toEqual([]);
    expect(completionMails(x.email)).toHaveLength(1);
    // A further run is a no-op: no second email.
    await JOB_HANDLERS['tenant.purge'](workerDeps(memory), { tenantId: x.tenantId });
    expect(completionMails(x.email)).toHaveLength(0);
  });
});

describe('M-20 object-store per-key errors stop the purge', () => {
  it('keeps the tenant and sends no completion while a key is refused, then completes', async () => {
    const x = await deletedTenant();
    const objects = new Set([`tenants/${x.tenantId}/logo.png`, `exports/${x.tenantId}/e.zip`]);
    let deny = true;
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        const keys = [...objects].filter((k) => k.startsWith(cmd.input.Prefix ?? ''));
        return { Contents: keys.map((Key) => ({ Key })), KeyCount: keys.length, IsTruncated: false };
      }
      if (cmd instanceof DeleteObjectsCommand) {
        const keys = cmd.input.Delete!.Objects!.map((o) => o.Key!);
        if (deny) return { Deleted: [], Errors: keys.map((Key) => ({ Key, Code: 'AccessDenied', Message: 'Access Denied' })) };
        for (const k of keys) objects.delete(k);
        return { Deleted: keys.map((Key) => ({ Key })) };
      }
      throw new Error('unexpected command');
    });
    const s3 = await svc.createS3Storage({ region: 'us-east-1', assetsBucket: 'a', exportsBucket: 'e', endpoint: 'http://127.0.0.1:1', accessKeyId: 'k', secretAccessKey: 's', cdnBaseUrl: 'https://cdn' });
    const d = workerDeps(s3);
    await expect(JOB_HANDLERS['tenant.purge'](d, { tenantId: x.tenantId })).rejects.toBeInstanceOf(svc.StorageDeleteError);
    expect(await tenantRow(x.tenantId)).toMatchObject({ status: 'deleted' });
    expect(completionMails(x.email)).toHaveLength(0);
    deny = false;
    await JOB_HANDLERS['tenant.purge'](d, { tenantId: x.tenantId });
    expect(objects.size).toBe(0);
    expect(await tenantRow(x.tenantId)).toBeUndefined();
    expect(completionMails(x.email)).toHaveLength(1);
  });
});

describe('M-12 webhook delivery fairness', () => {
  it('delays a webhook.deliver job when the tenant has no token left', async () => {
    let allow = false;
    const evals: string[] = [];
    const cache = { eval: async (_lua: string, _n: number, key: string) => (evals.push(key), allow ? 1 : 0) } as unknown as Redis;
    const ran: string[] = [];
    const d = workerDeps(memory);
    const processJob = createProcessor(d, cache);
    const original = JOB_HANDLERS['webhook.deliver'];
    JOB_HANDLERS['webhook.deliver'] = async () => void ran.push('deliver');
    try {
      const moved: number[] = [];
      const job = { name: 'webhook.deliver', data: { tenantId: '00000000-0000-7000-8000-000000000001', deliveryId: 1 }, moveToDelayed: async (ts: number) => void moved.push(ts) } as unknown as Job;
      await expect(processJob(job, 'tok')).rejects.toBeInstanceOf(DelayedError);
      expect(moved).toHaveLength(1);
      expect(ran).toEqual([]);
      expect(evals[0]).toBe('rl:webhook:00000000-0000-7000-8000-000000000001');
      allow = true;
      await processJob(job, 'tok');
      expect(ran).toEqual(['deliver']);
    } finally {
      JOB_HANDLERS['webhook.deliver'] = original;
    }
  });
});
