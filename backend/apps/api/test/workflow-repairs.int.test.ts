import { currentTotp, encrypt, hashSecret, newTotpSecret } from '@dop/auth';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { uuidv7 } from '@dop/domain';
import * as svc from '@dop/services';
import { makeTestDeps, type TestDeps } from '@dop/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearTenantCache } from '../src/http/middleware.js';
import { client, makeApi } from './helpers.js';

// Regressions for the 2026-10-22 completeness repairs BW01, BW02, BW04, BW05, BW06, BW09 and API01
// (docs/audits/2026-10-22-completeness). Each case asserts the repaired behaviour; the audit's probes in that folder
// characterised the defects and are left unchanged.

let t: TestDatabase;
let api: ReturnType<typeof makeApi>;
/** Service-level deps with a clock the tests control. */
let d: TestDeps;
const PASSWORD = 'a-long-unique-passphrase';
const platform = { kind: 'platform' as const, platformUserId: '', role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };
const publicDns = async () => ['93.184.216.34'];
let n = 0;

beforeAll(async () => {
  t = await startTestDatabase();
  api = makeApi(t.clients);
  d = makeTestDeps(t.clients, new Date());
});
afterAll(async () => {
  await t?.stop();
});

async function tenant(plan: 'pro' | 'multisite' | 'trial' = 'pro', opts: { status?: 'active' | 'trial'; complimentary?: boolean } = {}) {
  n++;
  clearTenantCache();
  const slug = `wf-${n}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@x.test`;
  const r = await svc.createTenantWithOwner(d, { ownerName: 'Owner', email, password: PASSWORD, restaurantName: `Workflow ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
  const db = t.clients.platform();
  await db.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  const planId = (await db.selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow()).id;
  await db
    .updateTable('tenants')
    .set({ plan_id: planId, status: opts.status ?? 'active', complimentary: opts.complimentary ?? true })
    .where('id', '=', r.tenantId)
    .execute();
  for (const kv of [d.kv, api.deps.kv]) await kv.del(`t:${r.tenantId}:status`, `t:${r.tenantId}:flags`);
  const owner = { kind: 'user' as const, userId: r.userId, tenantId: r.tenantId, role: 'owner' as const, sessionId: 's', mfaVerified: false };
  const device = { kind: 'staff_device' as const, tenantId: r.tenantId, venueId: r.venueId, deviceId: 'dev', deviceName: 'iPad' };
  return { ...r, slug, email, owner, device };
}

const endpointRow = (tenantId: string, id: string) => t.clients.forTenant(tenantId).selectFrom('webhook_endpoints').select(['status', 'disabled_reason', 'failure_streak']).where('id', '=', id).executeTakeFirstOrThrow();
const deliveries = (tenantId: string, endpointId: string) =>
  t.clients.forTenant(tenantId).selectFrom('webhook_deliveries').select(['id', 'event_id', 'status', 'attempt', 'is_original']).where('endpoint_id', '=', endpointId).orderBy('id').execute();

// ---------------------------------------------------------------- BW01

describe('BW01 endpoint auto-disable counts attempted failures only (TR-WH-03)', () => {
  it('one 503 among ten queued deliveries leaves the endpoint active and the other nine still deliver', async () => {
    const x = await tenant();
    const ep = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://receiver.example/hook', events: ['ticket.created'] });
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(...(await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { i })));
    expect(ids).toHaveLength(10);
    let calls = 0;
    const fail: svc.HttpPoster = async () => (calls++, { status: 503 });
    const ok: svc.HttpPoster = async () => (calls++, { status: 200 });
    expect((await svc.deliverWebhook(d, x.tenantId, ids[0]!, fail, publicDns)).status).toBe('failed');
    expect(await endpointRow(x.tenantId, ep.id)).toEqual({ status: 'active', disabled_reason: null, failure_streak: 1 });
    for (const id of ids.slice(1)) expect((await svc.deliverWebhook(d, x.tenantId, id, ok, publicDns)).status).toBe('succeeded');
    expect(calls).toBe(10);
    const rows = await deliveries(x.tenantId, ep.id);
    expect(rows.filter((r) => r.status === 'succeeded')).toHaveLength(9);
    expect(rows.filter((r) => r.status === 'abandoned')).toHaveLength(0);
    expect((await endpointRow(x.tenantId, ep.id)).status).toBe('active');
  });

  it('a genuine run of ten failed deliveries still disables it, once, and re-enabling resets its health', async () => {
    const x = await tenant();
    const ep = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://receiver.example/hook', events: ['ticket.created'] });
    const fail: svc.HttpPoster = async () => ({ status: 500 });
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(...(await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { i })));
    for (const id of ids.slice(0, 9)) await svc.deliverWebhook(d, x.tenantId, id, fail, publicDns);
    expect((await endpointRow(x.tenantId, ep.id)).status).toBe('active'); // nine attempted failures are not enough
    await svc.deliverWebhook(d, x.tenantId, ids[9]!, fail, publicDns);
    expect(await endpointRow(x.tenantId, ep.id)).toEqual({ status: 'disabled', disabled_reason: 'failing', failure_streak: 10 });

    // Re-enabled by the owner: the ten old failures no longer count, so the next failure does not disable it again.
    d.clock.advance(1000);
    await svc.updateWebhook(d, x.owner, x.tenantId, ep.id, { enabled: true });
    const next = (await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { again: true }))[0]!;
    await svc.deliverWebhook(d, x.tenantId, next, fail, publicDns);
    expect(await endpointRow(x.tenantId, ep.id)).toEqual({ status: 'active', disabled_reason: null, failure_streak: 1 });
  });

  it('concurrent failures keep an exact streak and disable exactly once; a concurrent success prevents it', async () => {
    const x = await tenant();
    const ep = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://receiver.example/hook', events: ['ticket.created'] });
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push(...(await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { i })));
    const fail: svc.HttpPoster = async () => ({ status: 503 });
    await Promise.all(ids.slice(0, 10).map((id) => svc.deliverWebhook(d, x.tenantId, id, fail, publicDns)));
    expect(await endpointRow(x.tenantId, ep.id)).toEqual({ status: 'disabled', disabled_reason: 'failing', failure_streak: 10 });

    const y = await tenant();
    const ep2 = await svc.createWebhook(d, y.owner, y.tenantId, { url: 'https://receiver.example/hook', events: ['ticket.created'] });
    const ids2: number[] = [];
    for (let i = 0; i < 11; i++) ids2.push(...(await svc.fanOutWebhook(d, y.tenantId, y.venueId, 'ticket.created', { i })));
    // Ten failures race one success: whichever order the locks give, the success is seen and the endpoint stays up.
    await Promise.all(ids2.map((id, i) => svc.deliverWebhook(d, y.tenantId, id, i === 5 ? async () => ({ status: 204 }) : fail, publicDns)));
    expect((await endpointRow(y.tenantId, ep2.id)).status).toBe('active');
  });
});

// ---------------------------------------------------------------- BW09

describe('BW09 fan-out creates one original delivery per (event, endpoint)', () => {
  it('a replayed fan-out reuses the stored delivery; an explicit redelivery is still possible', async () => {
    const x = await tenant();
    const a = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://a.example/hook', events: ['ticket.created'] });
    const b = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://b.example/hook', events: ['ticket.created'] });
    const eventId = uuidv7();
    const first = await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { n: 1 }, eventId);
    const replay = await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { n: 1 }, eventId);
    expect(first).toHaveLength(2);
    // Never attempted yet: the replay hands the same IDs back so their deliver jobs can be queued (deterministic job IDs).
    expect([...replay].sort()).toEqual([...first].sort());
    expect(await deliveries(x.tenantId, a.id)).toHaveLength(1);
    expect(await deliveries(x.tenantId, b.id)).toHaveLength(1);

    // Once attempted, a further replay neither adds a row nor re-queues it.
    const da = (await deliveries(x.tenantId, a.id))[0]!;
    await svc.deliverWebhook(d, x.tenantId, da.id, async () => ({ status: 200 }), publicDns);
    const third = await svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.created', { n: 1 }, eventId);
    expect(third).toEqual(first.filter((id) => id !== da.id));
    expect(await deliveries(x.tenantId, a.id)).toHaveLength(1);

    // The admin's redelivery is deliberate and may repeat; it never counts as the original.
    const r1 = await svc.redeliver(d, x.tenantId, da.id);
    const r2 = await svc.redeliver(d, x.tenantId, da.id);
    const rows = await deliveries(x.tenantId, a.id);
    expect(rows.map((r) => r.id)).toEqual([da.id, r1.id, r2.id]);
    expect(rows.map((r) => r.is_original)).toEqual([true, null, null]);
    expect(new Set(rows.map((r) => r.event_id))).toEqual(new Set([eventId]));
  });

  it('the database refuses a second original even when two fan-outs race', async () => {
    const x = await tenant();
    const ep = await svc.createWebhook(d, x.owner, x.tenantId, { url: 'https://a.example/hook', events: ['ticket.ready'] });
    const eventId = uuidv7();
    await Promise.all([1, 2, 3, 4].map(() => svc.fanOutWebhook(d, x.tenantId, x.venueId, 'ticket.ready', {}, eventId)));
    expect(await deliveries(x.tenantId, ep.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- BW02

/** Holds the tenant row lock in its own transaction while `during` starts work that must wait for it. */
async function whileLocked(tenantId: string, change: Record<string, unknown>, during: () => Promise<unknown>) {
  const pdb = t.clients.platform();
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => (locked = r));
  const holder = pdb.transaction().execute(async (tx) => {
    await tx.selectFrom('tenants').select('id').where('id', '=', tenantId).forUpdate().execute();
    locked();
    await released;
    await tx.updateTable('tenants').set(change).where('id', '=', tenantId).execute();
  });
  await isLocked;
  const work = during();
  // Wait until the work is blocked on the row lock, i.e. it read its candidates before the change below commits.
  // The work cannot finish while the row is locked: still pending after a second means it is waiting on the lock,
  // having read its candidates before the change below commits.
  let finished = false;
  void work.then(() => (finished = true));
  await new Promise((r) => setTimeout(r, 1000));
  const waited = !finished;
  release();
  await holder;
  await work;
  expect(waited, 'the sweep reached the locked row before the change committed').toBe(true);
}

describe('BW02 offline payments and billing sweeps are replay- and race-safe', () => {
  const state = async (id: string) => t.clients.platform().selectFrom('tenants').select(['status', 'paid_until', 'suspended_by']).where('id', '=', id).executeTakeFirstOrThrow();

  it('a lapse sweep that read its candidates before a payment does not mark the paid tenant past due', async () => {
    const x = await tenant('pro', { complimentary: false });
    await t.clients.platform().updateTable('tenants').set({ paid_until: new Date(Date.now() - 60_000) }).where('id', '=', x.tenantId).execute();
    // The payment's extension commits while the sweep waits on the row it decided to change.
    await whileLocked(x.tenantId, { paid_until: svc.addMonths(new Date(), 1) }, () => svc.graceCheck(api.deps));
    expect((await state(x.tenantId)).status).toBe('active');
  });

  it('a suspension sweep that read a past-due tenant before its payment leaves it active', async () => {
    const x = await tenant('pro', { complimentary: false });
    await t.clients.platform().updateTable('tenants').set({ status: 'past_due', past_due_since: new Date(Date.now() - 9 * 86_400_000), grace_ends_at: new Date(Date.now() - 60_000), paid_until: new Date(Date.now() - 86_400_000) }).where('id', '=', x.tenantId).execute();
    await whileLocked(x.tenantId, { status: 'active', past_due_since: null, grace_ends_at: null, paid_until: svc.addMonths(new Date(), 1) }, () => svc.graceCheck(api.deps));
    expect((await state(x.tenantId)).status).toBe('active');
  });

  it('a trial-expiry sweep honours free months granted meanwhile', async () => {
    const x = await tenant('trial', { status: 'trial', complimentary: false });
    await t.clients.platform().updateTable('tenants').set({ trial_ends_at: new Date(Date.now() - 60_000) }).where('id', '=', x.tenantId).execute();
    await whileLocked(x.tenantId, { trial_ends_at: svc.addMonths(new Date(), 1) }, () => svc.trialCheck(api.deps));
    expect((await state(x.tenantId)).status).toBe('trial');
  });

  it('a double-submitted payment request is recorded and applied once', async () => {
    const x = await tenant('pro', { complimentary: false });
    const requestId = uuidv7();
    const body = { amountMinor: 3000, currency: 'SAR', months: 1, method: 'cash' as const, requestId };
    const [a, b] = await Promise.all([svc.recordPayment(api.deps, platform, x.tenantId, body), svc.recordPayment(api.deps, platform, x.tenantId, body)]);
    expect(a.id).toBe(b.id);
    expect(a.paidUntil).toBe(b.paidUntil);
    const again = await svc.recordPayment(api.deps, platform, x.tenantId, body);
    expect(again.id).toBe(a.id);
    const rows = await t.clients.forTenant(x.tenantId).selectFrom('tenant_payments').select(['id', 'covers_until']).execute();
    expect(rows).toHaveLength(1);
    expect((await state(x.tenantId)).paid_until!.toISOString()).toBe(a.paidUntil);
    // A different request for the same receipt number is refused instead of paying twice.
    await svc.recordPayment(api.deps, platform, x.tenantId, { ...body, requestId: uuidv7(), reference: 'RCPT-77' });
    await expect(svc.recordPayment(api.deps, platform, x.tenantId, { ...body, requestId: uuidv7(), reference: 'RCPT-77' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await t.clients.forTenant(x.tenantId).selectFrom('tenant_payments').select('id').execute()).toHaveLength(2);
  });

  it('a payment whose status step was lost is applied by the next grace check; a cancellation is not undone', async () => {
    const x = await tenant('pro', { complimentary: false });
    // As if the process stopped after the payment committed and before markPaid ran.
    await t.clients.platform().updateTable('tenants').set({ status: 'suspended', suspended_by: 'billing', suspended_at: new Date(), paid_until: svc.addMonths(new Date(), 1) }).where('id', '=', x.tenantId).execute();
    await svc.graceCheck(api.deps);
    expect((await state(x.tenantId)).status).toBe('active');
    const y = await tenant('pro', { complimentary: false });
    await svc.recordPayment(api.deps, platform, y.tenantId, { amountMinor: 3000, currency: 'SAR', months: 1, method: 'cash' });
    await svc.cancelTenant(api.deps, platform, y.tenantId, 'Closing the account');
    await svc.graceCheck(api.deps);
    expect((await state(y.tenantId)).status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------- BW04

describe('BW04 venue create and archive are single local transactions with safe retries', () => {
  it('a retried or parallel create cannot add a duplicate branch', async () => {
    const x = await tenant('multisite');
    await svc.createVenue(d, x.owner, x.tenantId, 'Mall branch');
    await expect(svc.createVenue(d, x.owner, x.tenantId, 'Mall branch')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const results = await Promise.allSettled([1, 2, 3].map(() => svc.createVenue(d, x.owner, x.tenantId, 'Airport branch')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const names = (await svc.listVenues(d, x.tenantId)).map((v) => v.name);
    expect(names.filter((v) => v === 'Airport branch')).toHaveLength(1);
    expect(names.filter((v) => v === 'Mall branch')).toHaveLength(1);
  });

  it('archiving again is a no-op and parallel archives keep at least one venue', async () => {
    const x = await tenant('multisite');
    const second = await svc.createVenue(d, x.owner, x.tenantId, 'Second');
    await svc.archiveVenue(d, x.owner, x.tenantId, second.id);
    await svc.archiveVenue(d, x.owner, x.tenantId, second.id); // client retry after a timeout
    expect((await svc.listVenues(d, x.tenantId)).map((v) => v.id)).toEqual([x.venueId]);
    await expect(svc.archiveVenue(d, x.owner, x.tenantId, uuidv7())).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const y = await tenant('multisite');
    const other = await svc.createVenue(d, y.owner, y.tenantId, 'Other');
    const r = await Promise.allSettled([svc.archiveVenue(d, y.owner, y.tenantId, y.venueId), svc.archiveVenue(d, y.owner, y.tenantId, other.id)]);
    expect(r.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'FORBIDDEN' });
    expect(await svc.listVenues(d, y.tenantId)).toHaveLength(1);
  });

  it('no ticket can be created in a venue once it is archived', async () => {
    const x = await tenant('multisite');
    const second = await svc.createVenue(d, x.owner, x.tenantId, 'Second');
    await svc.archiveVenue(d, x.owner, x.tenantId, second.id);
    await expect(svc.createTicket(d, { ...x.device, venueId: second.id }, second.id, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------- BW05

describe('BW05 a changed auto-close time applies from its first effective day', () => {
  it('22:00 → 10:00 saved today expires tomorrow’s 09:00 ticket at 10:00', async () => {
    const x = await tenant();
    const real = d.now();
    try {
      d.clock.set('2026-10-22T09:00:00Z'); // Riyadh 12:00
      await t.clients.forTenant(x.tenantId).updateTable('venues').set({ time_zone: 'Asia/Riyadh', reset_time: '04:00:00', auto_close_time: '22:00:00', next_auto_close_at: new Date('2026-10-22T19:00:00Z') }).where('id', '=', x.venueId).execute();
      const saved = await svc.updateVenue(d, x.owner, x.tenantId, x.venueId, { autoCloseTime: '10:00' });
      expect(saved.pendingFromDate).toBe('2026-10-23');
      const schedule = () => t.clients.forTenant(x.tenantId).selectFrom('venues').select(['auto_close_time', 'pending_auto_close_time', 'next_auto_close_at']).where('id', '=', x.venueId).executeTakeFirstOrThrow();
      expect((await schedule()).next_auto_close_at!.toISOString()).toBe('2026-10-22T19:00:00.000Z'); // today keeps 22:00

      const tonight = (await svc.createTicket(d, x.device, x.venueId, {})).ticket;
      d.clock.set('2026-10-22T19:00:00Z'); // today's 22:00 close
      expect((await svc.venuesDueForAutoClose(d)).some((v) => v.id === x.venueId)).toBe(true);
      await svc.autoCloseVenue(d, x.tenantId, x.venueId);
      expect((await t.clients.forTenant(x.tenantId).selectFrom('tickets').select('status').where('id', '=', tonight.id).executeTakeFirstOrThrow()).status).toBe('expired');
      expect((await schedule()).next_auto_close_at!.toISOString()).toBe('2026-10-23T07:00:00.000Z'); // tomorrow 10:00

      d.clock.set('2026-10-23T06:00:00Z'); // 09:00 on the first effective day
      const morning = (await svc.createTicket(d, x.device, x.venueId, {})).ticket;
      expect(morning.business_date).toBe('2026-10-23');
      d.clock.set('2026-10-23T07:00:00Z'); // 10:00
      expect((await svc.venuesDueForAutoClose(d)).some((v) => v.id === x.venueId)).toBe(true);
      expect(await svc.autoCloseVenue(d, x.tenantId, x.venueId)).toBe(1);
      expect((await t.clients.forTenant(x.tenantId).selectFrom('tickets').select('status').where('id', '=', morning.id).executeTakeFirstOrThrow()).status).toBe('expired');
      const after = await schedule();
      expect(after.auto_close_time).toBe('10:00:00');
      expect(after.pending_auto_close_time).toBeNull();
      expect(after.next_auto_close_at!.toISOString()).toBe('2026-10-24T07:00:00.000Z');
    } finally {
      d.clock.set(real);
    }
  });

  it('a zone change closes the first effective day at the new zone’s time', async () => {
    const x = await tenant();
    const real = d.now();
    try {
      d.clock.set('2026-10-22T09:00:00Z');
      await t.clients.forTenant(x.tenantId).updateTable('venues').set({ time_zone: 'Asia/Riyadh', reset_time: '04:00:00', auto_close_time: '22:00:00', next_auto_close_at: new Date('2026-10-22T19:00:00Z') }).where('id', '=', x.venueId).execute();
      await svc.updateVenue(d, x.owner, x.tenantId, x.venueId, { timeZone: 'Asia/Dubai' });
      d.clock.set('2026-10-22T19:00:00Z');
      await svc.autoCloseVenue(d, x.tenantId, x.venueId);
      const v = await t.clients.forTenant(x.tenantId).selectFrom('venues').select(['time_zone', 'next_auto_close_at']).where('id', '=', x.venueId).executeTakeFirstOrThrow();
      expect(v.time_zone).toBe('Asia/Riyadh'); // promoted only on its date
      expect(v.next_auto_close_at!.toISOString()).toBe('2026-10-23T18:00:00.000Z'); // 22:00 in Dubai
    } finally {
      d.clock.set(real);
    }
  });
});

// ---------------------------------------------------------------- BW06

describe('BW06 the trial quota counts committed tickets only', () => {
  async function trialTenant(limit: number) {
    const db = t.clients.platform();
    const code = `tq${n + 1}${Math.random().toString(36).slice(2, 6)}`;
    const trial = await db.selectFrom('plans').select(['limits', 'features']).where('code', '=', 'trial').executeTakeFirstOrThrow();
    const id = uuidv7();
    await db
      .insertInto('plans')
      .values({ id, code, name: code, is_public: false, limits: JSON.stringify({ ...(trial.limits as object), trialTicketsPerDay: limit }) as never, features: JSON.stringify(trial.features) as never, sort_order: 99 })
      .execute();
    const x = await tenant('trial', { status: 'trial', complimentary: false });
    await db.updateTable('tenants').set({ plan_id: id }).where('id', '=', x.tenantId).execute();
    return x;
  }
  const bind = (o: object, v: unknown) => (typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(o) : v);
  const counter = async (x: { tenantId: string }, bd: string) => Number((await d.kv.get(`t:${x.tenantId}:tickets:${bd}`)) ?? 0);
  const count = async (x: { tenantId: string }) => (await t.clients.forTenant(x.tenantId).selectFrom('tickets').select('id').execute()).length;

  it('failed validation and failed transactions do not spend it', async () => {
    const x = await trialTenant(2);
    for (let i = 0; i < 3; i++) await expect(svc.createTicket(d, x.device, x.venueId, { counterId: uuidv7() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A transaction that fails after the reservation was taken gives it back.
    const failing = {
      ...d,
      db: {
        ...d.db,
        forTenant: (id: string) => {
          const real = d.db.forTenant(id);
          return new Proxy(real, { get: (o, p) => (p === 'transaction' ? () => ({ execute: async () => Promise.reject(new Error('injected transaction failure')) }) : bind(o, Reflect.get(o, p, o))) });
        },
      },
    } as TestDeps;
    await expect(svc.createTicket(failing, x.device, x.venueId, {})).rejects.toThrow('injected transaction failure');
    const first = (await svc.createTicket(d, x.device, x.venueId, {})).ticket;
    expect(await counter(x, first.business_date)).toBe(1);
    await svc.createTicket(d, x.device, x.venueId, {});
    await expect(svc.createTicket(d, x.device, x.venueId, {})).rejects.toMatchObject({ code: 'TRIAL_DAILY_LIMIT' });
    expect(await count(x)).toBe(2);
    expect(await counter(x, first.business_date)).toBe(2); // the refused create does not hold a place either
  });

  it('concurrent creates neither overspend nor wrongly refuse', async () => {
    const x = await trialTenant(3);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => svc.createTicket(d, x.device, x.venueId, {})));
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<svc.CreateResult>[];
    const refused = results.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as { code?: string }).code);
    expect(ok.length).toBeLessThanOrEqual(3);
    expect(await count(x)).toBe(ok.length);
    const bd = ok[0]!.value.ticket.business_date;
    expect(await counter(x, bd)).toBe(ok.length);
    // Whatever lost a race for another reason gave its place back: the remaining quota is usable.
    for (let i = ok.length; i < 3; i++) await svc.createTicket(d, x.device, x.venueId, {});
    await expect(svc.createTicket(d, x.device, x.venueId, {})).rejects.toMatchObject({ code: 'TRIAL_DAILY_LIMIT' });
    expect(await count(x)).toBe(3);
    expect(refused.every((c) => c === 'TRIAL_DAILY_LIMIT' || c === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------- API01

async function signIn(host: string, email: string, code?: () => string) {
  const c = client(api.app, host);
  const r = await c.post('/api/auth/v1/sign-in', { email, password: PASSWORD });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  if (r.body.mfaRequired) expect((await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: r.body.mfaToken, code: code!() })).body.ok).toBe(true);
  const me = await c.get('/api/auth/v1/me');
  c.setCsrf(me.body.csrfToken);
  return c;
}

describe('API01 empty PATCH requests are validated no-ops, not 500s', () => {
  it('webhook PATCH {} and {rotateSecret:false} keep the endpoint unchanged; a missing one is 404', async () => {
    const x = await tenant();
    const admin = await signIn(`${x.slug}.dop.test`, x.email);
    const ep = await svc.createWebhook(api.deps, x.owner, x.tenantId, { url: 'https://receiver.example/hook', events: ['ticket.created'] });
    const before = await t.clients.forTenant(x.tenantId).selectFrom('webhook_endpoints').selectAll().where('id', '=', ep.id).executeTakeFirstOrThrow();
    for (const body of [{}, { rotateSecret: false }]) {
      const r = await admin.patch(`/api/admin/v1/webhooks/${ep.id}`, body);
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      expect(r.body?.secret).toBeUndefined();
    }
    const after = await t.clients.forTenant(x.tenantId).selectFrom('webhook_endpoints').selectAll().where('id', '=', ep.id).executeTakeFirstOrThrow();
    expect(after.secret_next_enc).toEqual(before.secret_next_enc);
    expect(after.status).toBe('active');
    expect((await admin.patch(`/api/admin/v1/webhooks/${uuidv7()}`, {})).status).toBe(404);
    // A real change still works.
    expect((await admin.patch(`/api/admin/v1/webhooks/${ep.id}`, { rotateSecret: true })).body.secret).toMatch(/^whsec_/);
  });

  it('plan, platform user and language PATCH {} return a no-op for existing resources and 404 otherwise', async () => {
    const id = uuidv7();
    const secret = newTotpSecret();
    const email = `wf-admin-${id.slice(-8)}@x.test`;
    await t.clients
      .platform()
      .insertInto('platform_users')
      .values({ id, email, name: 'Admin', role: 'super_admin', status: 'active', password_hash: await hashSecret(PASSWORD), totp_secret_enc: await encrypt(api.deps.keys, secret), mfa_enrolled_at: new Date() })
      .execute();
    const c = await signIn('admin.dop.test', email, () => currentTotp(secret));
    const pro = await t.clients.platform().selectFrom('plans').select(['id', 'name']).where('code', '=', 'pro').executeTakeFirstOrThrow();
    for (const path of [`/api/console/v1/plans/${pro.id}`, `/api/console/v1/platform-users/${id}`, '/api/console/v1/languages/en']) {
      const r = await c.patch(path, {});
      expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBeLessThan(300);
    }
    for (const path of [`/api/console/v1/plans/${uuidv7()}`, `/api/console/v1/platform-users/${uuidv7()}`, '/api/console/v1/languages/zz']) {
      expect((await c.patch(path, {})).status, path).toBe(404);
    }
    expect((await t.clients.platform().selectFrom('plans').select('name').where('id', '=', pro.id).executeTakeFirstOrThrow()).name).toBe(pro.name);
    expect((await t.clients.platform().selectFrom('platform_users').select(['role', 'status']).where('id', '=', id).executeTakeFirstOrThrow())).toEqual({ role: 'super_admin', status: 'active' });
    // Real changes still apply.
    expect((await c.patch(`/api/console/v1/plans/${pro.id}`, { sortOrder: 31 })).status).toBeLessThan(300);
    expect((await t.clients.platform().selectFrom('plans').select('sort_order').where('id', '=', pro.id).executeTakeFirstOrThrow()).sort_order).toBe(31);
  });

  it('the console accepts a payment request id and records a repeated submit once', async () => {
    const id = uuidv7();
    const secret = newTotpSecret();
    const email = `wf-pay-${id.slice(-8)}@x.test`;
    await t.clients
      .platform()
      .insertInto('platform_users')
      .values({ id, email, name: 'Finance', role: 'super_admin', status: 'active', password_hash: await hashSecret(PASSWORD), totp_secret_enc: await encrypt(api.deps.keys, secret), mfa_enrolled_at: new Date() })
      .execute();
    const c = await signIn('admin.dop.test', email, () => currentTotp(secret));
    const x = await tenant('pro', { complimentary: false });
    const body = { amountMinor: 10000, currency: 'SAR', months: 1, method: 'bank_transfer', requestId: uuidv7() };
    const a = await c.post(`/api/console/v1/tenants/${x.tenantId}/payments`, body);
    const b = await c.post(`/api/console/v1/tenants/${x.tenantId}/payments`, body);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await t.clients.forTenant(x.tenantId).selectFrom('tenant_payments').select('id').execute()).toHaveLength(1);
  });
});
