import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { MemoryJobs } from '@dop/jobs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantActor } from '@dop/auth';
import {
  acknowledge,
  createTicket,
  firstAlert,
  follow,
  overdueFlag,
  pushCleanup,
  reconcileAlerts,
  renderEmail,
  repeatAlert,
  savePushSubscription,
  createTenantWithOwner,
  transitionTicket,
  integrityCheck,
  type PushMessage,
} from '../src/index.js';
import { makeTestDeps, type TestDeps } from '../src/testing.js';

let t: TestDatabase;
let deps: TestDeps;
beforeAll(async () => {
  t = await startTestDatabase();
  deps = makeTestDeps(t.clients);
});
afterAll(async () => {
  await t?.stop();
});

let n = 0;
async function readyTicket() {
  n++;
  const r = await createTenantWithOwner(deps, { ownerName: 'O', email: `al${n}@x.test`, password: 'a-long-unique-passphrase', restaurantName: `Al ${n}`, slug: `al-${n}`, country: 'SA', locale: 'ar' }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  const actor: TenantActor = { kind: 'staff_device', deviceId: 'd', tenantId: r.tenantId, venueId: r.venueId, deviceName: 'iPad' };
  const { ticket } = await createTicket(deps, actor, r.venueId, {});
  const clientId = `${'P'.repeat(20)}${String(n).padStart(2, '0')}`;
  await follow(deps, ticket.token, { clientId, joinedVia: 'ticket_qr', uaFamily: 'android-chrome', locale: 'ar' });
  await savePushSubscription(deps, ticket.token, { clientId, subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'k'.repeat(40), auth: 'a'.repeat(16) } } }, 'fcm');
  await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 1 });
  deps.jobs.take();
  return { ...r, actor, ticket, clientId };
}

describe('alert pipeline (TRD §11.3, §11.6)', () => {
  it('sends the Ready push in the follower language, then repeats, and stops on acknowledgement', async () => {
    const x = await readyTicket();
    const sent: PushMessage[] = [];
    const sender = async (m: PushMessage) => (sent.push(m), 201);
    const level = await t.clients.forTenant(x.tenantId).selectFrom('tickets').select(['alert_level', 'ready_round']).where('id', '=', x.ticket.id).executeTakeFirstOrThrow();
    expect(level.alert_level).toBe('push');
    await firstAlert(deps, sender, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1, attempt: 1, manual: false });
    expect(sent).toHaveLength(1);
    const payload = JSON.parse(sent[0]!.payload);
    expect(payload).toMatchObject({ type: 'ticket.ready', ticketToken: x.ticket.token, round: 1, attempt: 1 });
    expect(payload.title).toContain('جاهز');
    expect(sent[0]!.ttlSec).toBe(600);
    expect(deps.kv.published.some((p) => JSON.parse(p.message).topic === 'ticket.alert')).toBe(true);

    await repeatAlert(deps, sender, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1, n: 2 });
    expect(sent).toHaveLength(2);
    // Same repeat twice sends nothing more: the attempt is already delivered to every recipient (A08)
    const alertsBefore = deps.kv.published.filter((p) => JSON.parse(p.message).topic === 'ticket.alert').length;
    expect(await repeatAlert(deps, sender, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1, n: 2 })).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(deps.kv.published.filter((p) => JSON.parse(p.message).topic === 'ticket.alert')).toHaveLength(alertsBefore);

    await acknowledge(deps, x.ticket.token);
    expect(await repeatAlert(deps, sender, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1, n: 3 })).toEqual({ skipped: true });
    expect(sent).toHaveLength(2);
  });

  it('revokes gone subscriptions and drops the level (TR-ALR-09)', async () => {
    const x = await readyTicket();
    await firstAlert(deps, async () => 410, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1, attempt: 1, manual: false });
    const tk = await t.clients.forTenant(x.tenantId).selectFrom('tickets').select('alert_level').where('id', '=', x.ticket.id).executeTakeFirstOrThrow();
    expect(tk.alert_level).toBe('none');
  });

  it('reconciles missing repeat jobs after the queue store is lost (TR-JOB-05)', async () => {
    const x = await readyTicket();
    await firstAlert(deps, async () => 201, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1, attempt: 1, manual: false });
    deps.jobs = new MemoryJobs(); // the queue store and its job IDs are lost
    deps.clock.advance(151_000); // 120 s offset + more than 30 s grace
    await reconcileAlerts(deps);
    const jobs = deps.jobs.take().filter((j) => (j.data as { ticketId: string }).ticketId === x.ticket.id);
    expect(jobs.map((j) => j.opts.jobId)).toEqual([`repeat.${x.ticket.id}.1.2`]);
  });

  it('never re-alerts a reopened ticket automatically (BR-22)', async () => {
    const x = await readyTicket();
    await transitionTicket(deps, x.actor, x.ticket.id, { to: 'collected', version: 2 });
    await transitionTicket(deps, x.actor, x.ticket.id, { to: 'ready', version: 3 });
    deps.jobs.take();
    deps.clock.advance(60_000);
    await reconcileAlerts(deps);
    expect(deps.jobs.take().filter((j) => (j.data as { ticketId: string }).ticketId === x.ticket.id)).toEqual([]);
  });

  it('flags overdue only while still ready in the same round', async () => {
    const x = await readyTicket();
    expect(await overdueFlag(deps, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1 })).toBe(true);
    await transitionTicket(deps, x.actor, x.ticket.id, { to: 'collected', version: 2 });
    expect(await overdueFlag(deps, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1 })).toBe(false);
  });

  it('cleans up push subscriptions 30 minutes after the last ticket closes (TR-PRV-03)', async () => {
    const x = await readyTicket();
    await transitionTicket(deps, x.actor, x.ticket.id, { to: 'collected', version: 2 });
    const before = await pushCleanup(deps);
    const kept = await t.clients.platform().selectFrom('push_subscriptions').select('id').where('endpoint', '=', `https://fcm.googleapis.com/fcm/send/${n}`).executeTakeFirst();
    expect(kept).toBeTruthy();
    deps.clock.advance(31 * 60_000);
    expect(before + (await pushCleanup(deps))).toBeGreaterThan(0);
    const gone = await t.clients.platform().selectFrom('push_subscriptions').select('id').where('endpoint', '=', `https://fcm.googleapis.com/fcm/send/${n}`).executeTakeFirst();
    expect(gone).toBeUndefined();
  });

  it('finds no tenant mismatches (TR-TEN-09) and renders emails in both languages', async () => {
    expect((await integrityCheck(deps)).every((c) => c.rows === 0)).toBe(true);
    const ar = renderEmail('verify_email', 'ar', { name: 'سارة', link: 'https://www.dop.test/verify?token=x' });
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.text).toContain('https://www.dop.test/verify?token=x');
    const en = renderEmail('suspended_platform', 'en', { tenantName: '<b>X</b>', reason: 'r' });
    expect(en.html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });
});
