import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantActor } from '@dop/auth';
import { createTenantWithOwner, createTicket, overdueFlag, reconcileAlerts, staffBoardTickets, transitionTicket } from '../src/index.js';
import { makeTestDeps, type TestDeps } from '../src/testing.js';

// CSD07: the "not collected — call out" state survives a board reload. The overdue-flag job records the flagged
// ready round; the staff projection (and so the board snapshot) carries it, and a later round is never flagged.
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
  const r = await createTenantWithOwner(
    deps,
    { ownerName: 'O', email: `ov${n}@x.test`, password: 'a-long-unique-passphrase', restaurantName: `Ov ${n}`, slug: `ov-${n}`, country: 'SA', locale: 'ar' },
    { ip: '1.1.1.1' },
  );
  const actor: TenantActor = { kind: 'staff_device', deviceId: 'd', tenantId: r.tenantId, venueId: r.venueId, deviceName: 'iPad' };
  const { ticket } = await createTicket(deps, actor, r.venueId, {});
  await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: 1 });
  deps.jobs.take();
  return { ...r, actor, ticket };
}
const boardTicket = async (x: Awaited<ReturnType<typeof readyTicket>>) => {
  const b = await staffBoardTickets(deps, x.tenantId, x.venueId);
  return [...b.open, ...b.recent].find((s) => s.id === x.ticket.id)!;
};
const overdueEvents = (id: string) => deps.kv.published.map((p) => JSON.parse(p.message)).filter((e) => e.topic === 'ticket.overdue' && e.ticketId === id);

describe('overdue call-out in the staff snapshot (CSD07, TR-ALR-21)', () => {
  it('a fresh snapshot after the overdue flag carries the flagged round', async () => {
    const x = await readyTicket();
    expect((await boardTicket(x)).overdueRound).toBeNull();
    expect(await overdueFlag(deps, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1 })).toBe(true);
    const s = await boardTicket(x);
    expect(s).toMatchObject({ status: 'ready', readyRound: 1, overdueRound: 1, acknowledgedAt: null });
    // The flag does not move seq/version, so clients applying events by sequence see no gap.
    expect(s.seq).toBe(x.ticket.seq + 1);
    expect(overdueEvents(x.ticket.id)).toHaveLength(1);
  });

  it('a later ready round is not flagged by the earlier one', async () => {
    const x = await readyTicket();
    await overdueFlag(deps, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1 });
    await transitionTicket(deps, x.actor, x.ticket.id, { to: 'collected', version: 2 });
    await transitionTicket(deps, x.actor, x.ticket.id, { to: 'ready', version: 3 });
    const s = await boardTicket(x);
    expect(s.readyRound).toBe(2);
    expect(s.overdueRound).toBe(1);
    // A stale job for the old round changes nothing.
    expect(await overdueFlag(deps, { tenantId: x.tenantId, ticketId: x.ticket.id, round: 1 })).toBe(false);
    expect((await boardTicket(x)).overdueRound).toBe(1);
  });

  it('reconciliation records the flag itself once the deadline passed (no reliance on a deduplicated job), once', async () => {
    const x = await readyTicket();
    // All automatic alerts sent (default schedule): the next step is the overdue flag.
    await t.clients.forTenant(x.tenantId).updateTable('tickets').set({ auto_alerts_sent: 99 }).where('id', '=', x.ticket.id).execute();
    deps.clock.advance(60 * 60_000);
    await reconcileAlerts(deps);
    expect((await boardTicket(x)).overdueRound).toBe(1);
    expect(overdueEvents(x.ticket.id)).toHaveLength(1);
    await reconcileAlerts(deps);
    expect(overdueEvents(x.ticket.id)).toHaveLength(1);
  });
});
