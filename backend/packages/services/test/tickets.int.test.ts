import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantActor } from '@dop/auth';
import {
  acknowledge,
  alertsEnabled,
  autoCloseVenue,
  createTicket,
  editTicket,
  follow,
  publicTicketView,
  recomputeAlertLevel,
  createTenantWithOwner,
  suspendTenant,
  reactivateTenant,
  transitionTicket,
  keys,
} from '../src/index.js';
import type { BusEvent } from '@dop/contracts';
import { makeTestDeps, type TestDeps } from '../src/testing.js';

let t: TestDatabase;
let deps: TestDeps;

beforeAll(async () => {
  t = await startTestDatabase();
});
afterAll(async () => {
  await t?.stop();
});
beforeEach(() => {
  deps = makeTestDeps(t.clients);
});

let n = 0;
async function newTenant(verified = true) {
  n++;
  const r = await createTenantWithOwner(
    deps,
    { ownerName: 'Owner', email: `owner${n}@x.test`, password: 'a-long-unique-passphrase', restaurantName: `Cafe ${n}`, slug: `cafe-${n}`, country: 'SA', locale: 'ar' },
    { ip: '127.0.0.1' },
  );
  if (verified) await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  const actor: TenantActor = { kind: 'staff_device', deviceId: 'dev-1', tenantId: r.tenantId, venueId: r.venueId, deviceName: 'Counter iPad' };
  return { ...r, actor };
}

const events = () => deps.kv.published.map((p) => JSON.parse(p.message) as BusEvent);

describe('ticket life cycle (Phase 2 gate, service level)', () => {
  it('runs create → follow → alerts → ready → repeats → acknowledge → collected → reopen → expire', async () => {
    const { tenantId, venueId, actor } = await newTenant();
    const { ticket } = await createTicket(deps, actor, venueId, {});
    expect(ticket.display_number).toBe('1');
    expect(ticket.status).toBe('preparing');
    expect(ticket.token).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(events().at(-1)?.topic).toBe('ticket.created');

    const clientId = 'C'.repeat(22);
    expect(await follow(deps, ticket.token, { clientId, joinedVia: 'ticket_qr', uaFamily: 'android-chrome' })).toEqual({ firstFollower: true });
    expect(events().some((e) => e.topic === 'ticket.followed')).toBe(true);
    // Presence → live (TR-ALG-11)
    await deps.kv.set(keys.presence(ticket.id, clientId), '1', 60);
    await deps.kv.set(keys.wasLive(ticket.id, clientId), '1', 86400);
    await alertsEnabled(deps, ticket.token, clientId);
    let view = await publicTicketView(deps, ticket.token);
    const staffRow = await t.clients.forTenant(tenantId).selectFrom('tickets').selectAll().where('id', '=', ticket.id).executeTakeFirstOrThrow();
    expect(staffRow.alert_level).toBe('live');
    expect(staffRow.version).toBe(1); // customer changes never bump version (TR-TKT-04)

    const ready = await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 1 });
    expect(ready.ticket.ready_round).toBe(1);
    expect(ready.ticket.alert_level_at_ready).toBe('live');
    deps.jobs.take('email.send');
    deps.jobs.take('webhook.fanout');
    const jobs = deps.jobs.take();
    expect(jobs.map((j) => j.opts.jobId)).toEqual([`push.${ticket.id}.1.1`, `repeat.${ticket.id}.1.2`, `repeat.${ticket.id}.1.3`, `overdue.${ticket.id}.1`]);
    expect(jobs.map((j) => j.opts.delayMs ?? 0)).toEqual([0, 120_000, 300_000, 360_000]);

    // Idempotent same-status request (TR-TKT-02)
    expect((await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 2 })).changed).toBe(false);

    await acknowledge(deps, ticket.token);
    view = await publicTicketView(deps, ticket.token);
    expect(view.acknowledged).toBe(true);

    const collected = await transitionTicket(deps, actor, ticket.id, { to: 'collected', version: 2 });
    expect(collected.ticket.status).toBe('collected');
    // Reopen within 30 minutes, without automatic alerts (BR-22)
    deps.clock.advance(10 * 60_000);
    const reopened = await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 3 });
    expect(reopened.ticket.collected_at).toBeNull();
    expect(deps.jobs.take().filter((j) => j.name !== 'email.send' && j.name !== 'webhook.fanout')).toEqual([]);

    // Auto-close sweep expires open tickets (TR-ALG-10)
    deps.clock.advance(24 * 3600_000);
    expect(await autoCloseVenue(deps, tenantId, venueId)).toBe(1);
    const expired = await t.clients.forTenant(tenantId).selectFrom('tickets').select(['status', 'expired_at']).where('id', '=', ticket.id).executeTakeFirstOrThrow();
    expect(expired.status).toBe('expired');
  });

  it('refuses reopen after 30 minutes and stale versions with the other device named', async () => {
    const { venueId, actor } = await newTenant();
    const { ticket } = await createTicket(deps, actor, venueId, {});
    await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 1 });
    const other = { ...actor, deviceId: 'dev-2', deviceName: 'Kitchen tablet' };
    await expect(transitionTicket(deps, other, ticket.id, { to: 'preparing', version: 1 })).rejects.toMatchObject({ code: 'TICKET_VERSION_CONFLICT', message: 'Already changed by Counter iPad' });
    await transitionTicket(deps, actor, ticket.id, { to: 'collected', version: 2 });
    deps.clock.advance(31 * 60_000);
    await expect(transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 3 })).rejects.toMatchObject({ code: 'REOPEN_WINDOW_PASSED' });
  });

  it('gives 50 parallel creates distinct numbers (TR-ALG-02)', async () => {
    const { venueId, actor } = await newTenant();
    const results = await Promise.all(Array.from({ length: 50 }, () => createTicket(deps, actor, venueId, {})));
    const numbers = results.map((r) => r.ticket.number);
    expect(new Set(numbers).size).toBe(50);
    expect(Math.max(...numbers)).toBe(50);
  });

  it('refuses a receipt number already on an open ticket (EX-20, TR-TKT-05)', async () => {
    const { venueId, actor } = await newTenant();
    await createTicket(deps, actor, venueId, { externalRef: '1042' });
    await expect(createTicket(deps, actor, venueId, { externalRef: '1042' })).rejects.toMatchObject({ code: 'EXTERNAL_REF_IN_USE' });
  });

  it('adjusts wait without moving the base time (TR-ALG-08)', async () => {
    const { venueId, actor } = await newTenant();
    const { ticket } = await createTicket(deps, actor, venueId, {});
    const t2 = await editTicket(deps, actor, ticket.id, { version: 1, waitDeltaMinutes: 5 });
    expect(t2.wait_minutes).toBe(15);
    expect(t2.wait_base_at?.getTime()).toBe(ticket.wait_base_at?.getTime());
    const t3 = await editTicket(deps, actor, ticket.id, { version: 2, waitDeltaMinutes: -300 });
    expect(t3.wait_minutes).toBe(0);
  });
});

describe('tenant rules', () => {
  it('lets a suspended tenant finish open tickets but not create new ones (BR-18, EX-14)', async () => {
    const { tenantId, venueId, actor } = await newTenant();
    const { ticket } = await createTicket(deps, actor, venueId, {});
    await suspendTenant(deps, tenantId, { kind: 'platform', platformUserId: 'p', role: 'super_admin', sessionId: 's', mfaVerifiedAt: new Date() }, 'Abuse report');
    await expect(createTicket(deps, actor, venueId, {})).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' });
    const r = await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 1 });
    expect(r.ticket.status).toBe('ready');
    await transitionTicket(deps, actor, r.ticket.id, { to: 'collected', version: 2 });
    await expect(transitionTicket(deps, actor, r.ticket.id, { to: 'ready', version: 3 })).resolves.toBeTruthy();
    await reactivateTenant(deps, tenantId, { kind: 'platform', platformUserId: 'p', role: 'super_admin', sessionId: 's', mfaVerifiedAt: new Date() });
    const tenant = await t.clients.platform().selectFrom('tenants').select(['status']).where('id', '=', tenantId).executeTakeFirstOrThrow();
    expect(tenant.status).toBe('trial');
    await expect(createTicket(deps, actor, venueId, {})).resolves.toBeTruthy();
    expect(deps.jobs.added.some((j) => j.name === 'email.send' && (j.data as { template: string }).template === 'suspended_platform')).toBe(true);
  });

  it('requires a verified email after the first ticket (TR-AUTH-05)', async () => {
    const { venueId, actor } = await newTenant(false);
    await createTicket(deps, actor, venueId, {});
    await expect(createTicket(deps, actor, venueId, {})).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('enforces the trial daily limit (TR-ALG-14)', async () => {
    const { tenantId, venueId, actor } = await newTenant();
    const bdKeyPrefix = `t:${tenantId}:tickets:`;
    await createTicket(deps, actor, venueId, {});
    const key = (await deps.kv.keys(bdKeyPrefix))[0]!;
    await deps.kv.set(key, '200', 3600);
    await expect(createTicket(deps, actor, venueId, {})).rejects.toMatchObject({ code: 'TRIAL_DAILY_LIMIT' });
  });

  it('never resolves another tenant’s ticket by ID (TR-TEN-08)', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const { ticket } = await createTicket(deps, b.actor, b.venueId, {});
    await expect(transitionTicket(deps, a.actor, ticket.id, { to: 'ready', version: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(editTicket(deps, a.actor, ticket.id, { version: 1, note: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createTicket(deps, a.actor, b.venueId, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await recomputeAlertLevel(deps, a.tenantId, ticket.id); // silently nothing
  });
});

describe('seed (TR-TST-01)', () => {
  it('creates platform users and three tenants with tickets in every status', async () => {
    const { seedDemo } = await import('../src/seed.js');
    const r = await seedDemo(deps);
    expect(r.platformUsers.map((u) => u.role).sort()).toEqual(['finance', 'super_admin', 'support']);
    expect(r.tenants.map((x) => x.status)).toEqual(['trial', 'active', 'suspended']);
    const statuses = await t.clients.platform().selectFrom('tickets').innerJoin('tenants', 'tenants.id', 'tickets.tenant_id').select('tickets.status').where('tenants.slug', '=', 'burger-house').execute();
    expect(new Set(statuses.map((s) => s.status))).toEqual(new Set(['preparing', 'ready', 'collected', 'cancelled', 'expired']));
    const again = await seedDemo(deps); // idempotent
    expect(again.tenants).toEqual([]);
  });
});
