import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { sql } from '@dop/db';
import type { TenantActor } from '@dop/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  approveSupport,
  changePlan,
  changeSlug,
  createAnnouncement,
  announcementsFor,
  createCounter,
  createSupportCode,
  createTicket,
  endSupport,
  enterSupport,
  exchangeSupportHandoff,
  heatmapReport,
  maintainPartitions,
  platformDailyRollup,
  requestSupport,
  resolveSupport,
  rollupVenueDay,
  setFlagOverride,
  isEnabled,
  createTenantWithOwner,
  slugAvailability,
  slugRedirect,
  transitionTicket,
  trendsReport,
  verifySupportCode,
  deleteOwnAccount,
  inviteMember,
  acceptInvitation,
} from '../src/index.js';
import { makeTestDeps, type TestDeps } from '../src/testing.js';

let t: TestDatabase;
let deps: TestDeps;
const platform = { kind: 'platform' as const, platformUserId: '', role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };

beforeAll(async () => {
  t = await startTestDatabase();
  deps = makeTestDeps(t.clients);
  platform.platformUserId = 'pu-1';
  await t.clients.platform().insertInto('platform_users').values({ id: 'pu-1', email: 'agent@x.test', name: 'Agent Sam', role: 'super_admin', status: 'active' }).execute();
});
afterAll(async () => {
  await t?.stop();
});

let n = 0;
async function tenant() {
  n++;
  const r = await createTenantWithOwner(deps, { ownerName: 'O', email: `p${n}@x.test`, password: 'a-long-unique-passphrase', restaurantName: `P ${n}`, slug: `plat-${n}`, country: 'SA', locale: 'ar' }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  const owner = { kind: 'user' as const, userId: r.userId, tenantId: r.tenantId, role: 'owner' as const, sessionId: 's', mfaVerified: false };
  const device: TenantActor = { kind: 'staff_device', deviceId: 'd', tenantId: r.tenantId, venueId: r.venueId, deviceName: 'iPad' };
  return { ...r, owner, device };
}

describe('support access (FR-SUP-02 – FR-SUP-05)', () => {
  it('starts only after a valid phone code, works through the handoff cookie and ends', async () => {
    const x = await tenant();
    const { id } = await requestSupport(deps, platform, x.tenantId, 'Owner cannot pair the TV', 120);
    await expect(verifySupportCode(deps, platform, id, '12345678')).rejects.toMatchObject({ code: 'SUPPORT_CODE_INVALID' });
    const { code } = await createSupportCode(deps, x.owner);
    await verifySupportCode(deps, platform, id, code);
    const { url } = await enterSupport(deps, platform, id);
    const handoff = new URL(url).searchParams.get('code')!;
    const { token } = await exchangeSupportHandoff(deps, handoff, x.tenantId);
    const actor = await resolveSupport(deps, token, x.tenantId);
    expect(actor).toMatchObject({ kind: 'support', agentName: 'Agent Sam', supportSessionId: id });
    expect(await resolveSupport(deps, token, 'another-tenant')).toBeNull();
    // Banner event for the tenant admin (FR-SUP-04)
    expect(deps.kv.published.some((p) => JSON.parse(p.message).topic === 'support.session')).toBe(true);
    await endSupport(deps, x.owner, id, 'tenant', x.tenantId);
    expect(await resolveSupport(deps, token, x.tenantId)).toBeNull();
    const audit = await t.clients.platform().selectFrom('audit_log').select('action').where('tenant_id', '=', x.tenantId).where('action', 'like', 'support.%').execute();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['support.requested', 'support.approved', 'support.ended']));
  });

  it('can be approved in the admin area', async () => {
    const x = await tenant();
    const { id } = await requestSupport(deps, platform, x.tenantId, 'Check reports', 60);
    await approveSupport(deps, x.owner, id);
    const s = await t.clients.platform().selectFrom('support_sessions').select(['status', 'expires_at']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(s.status).toBe('active');
    expect(s.expires_at!.getTime() - deps.now().getTime()).toBe(60 * 60_000);
  });
});

describe('plans and flags (FR-BIL-10, FR-SA-11, TR-ALG-17)', () => {
  it('refuses a downgrade while usage exceeds the target and lists the excess', async () => {
    const x = await tenant(); // trial plan allows 10 counters
    await createCounter(deps, x.owner, x.tenantId, x.venueId, { name: 'Food' });
    await createCounter(deps, x.owner, x.tenantId, x.venueId, { name: 'Drinks' });
    await expect(changePlan(deps, platform, x.tenantId, 'standard')).rejects.toMatchObject({
      code: 'PLAN_DOWNGRADE_BLOCKED',
      data: { excess: [{ limit: 'maxCountersPerVenue', current: 2, allowed: 1 }] },
    });
    // Only the platform team changes plans (payment is offline); an upgrade applies now.
    expect(await changePlan(deps, platform, x.tenantId, 'pro')).toEqual({ effective: 'now' });
  });

  it('overrides a flag for one tenant only', async () => {
    const a = await tenant();
    const b = await tenant();
    await t.clients.platform().updateTable('tenants').set({ plan_id: (await t.clients.platform().selectFrom('plans').select('id').where('code', '=', 'standard').executeTakeFirstOrThrow()).id }).where('id', 'in', [a.tenantId, b.tenantId]).execute();
    await setFlagOverride(deps, platform, a.tenantId, 'remove_powered_by', true);
    expect(await isEnabled(deps, a.tenantId, 'remove_powered_by')).toBe(true);
    expect(await isEnabled(deps, b.tenantId, 'remove_powered_by')).toBe(false);
  });
});

describe('announcements (FR-SA-13)', () => {
  it('shows targeted banners to targeted tenants only', async () => {
    const a = await tenant();
    const b = await tenant();
    await createAnnouncement(deps, platform, { message: { en: 'Maintenance tonight' }, severity: 'warning', target: { tenantIds: [a.tenantId] }, startsAt: new Date(deps.now().getTime() - 1000).toISOString(), endsAt: new Date(deps.now().getTime() + 3600_000).toISOString() });
    expect((await announcementsFor(deps, a.tenantId)).length).toBe(1);
    expect((await announcementsFor(deps, b.tenantId)).length).toBe(0);
  });
});

describe('slug change (TR-URL-03)', () => {
  it('redirects the old slug for 180 days and blocks it meanwhile', async () => {
    const x = await tenant();
    const old = `plat-${n}`;
    await changeSlug(deps, x.owner, x.tenantId, 'renamed-cafe', 'a-long-unique-passphrase');
    expect(await slugRedirect(deps, old)).toBe('renamed-cafe');
    expect(await slugAvailability(deps, old)).toEqual({ available: false, reason: 'taken' });
    deps.clock.advance(181 * 86_400_000);
    expect(await slugRedirect(deps, old)).toBeNull();
    deps.clock.advance(-181 * 86_400_000);
  });
});

describe('account deletion (FR-ADM-20, TR-PRV-11)', () => {
  it('refuses the only owner and deletes a manager', async () => {
    const x = await tenant();
    await expect(deleteOwnAccount(deps, x.userId, 'a-long-unique-passphrase')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await inviteMember(deps, x.owner, x.tenantId, 'mgr@x.test', 'manager');
    const link = (deps.jobs.added.filter((j) => j.name === 'email.send').at(-1)!.data as { data: { link: string } }).data.link;
    const token = new URL(link).searchParams.get('token')!;
    const accepted = await acceptInvitation(deps, token, { name: 'Mgr', password: 'another-long-passphrase' }, { ip: '1', userAgent: 'x', host: 'h' });
    expect(accepted.kind).toBe('session');
    const mgr = await t.clients.platform().selectFrom('users').select('id').where('email', '=', 'mgr@x.test').executeTakeFirstOrThrow();
    await deleteOwnAccount(deps, mgr.id, 'another-long-passphrase');
    expect(await t.clients.platform().selectFrom('users').select('id').where('id', '=', mgr.id).executeTakeFirst()).toBeUndefined();
  });
});

describe('trends, heatmap, platform metrics and partitions (FR-RPT-02/03/07, TR-DB-11)', () => {
  it('compares with the previous period and fills the heatmap from roll-ups', async () => {
    const x = await tenant();
    const bd1 = '2026-10-15';
    deps.clock.set('2026-10-15T09:00:00Z');
    for (let i = 0; i < 2; i++) {
      const tk = (await createTicket(deps, x.device, x.venueId, {})).ticket;
      await transitionTicket(deps, x.device, tk.id, { to: 'ready', version: 1 });
    }
    deps.clock.set('2026-10-22T09:00:00Z');
    for (let i = 0; i < 3; i++) await createTicket(deps, x.device, x.venueId, {});
    await rollupVenueDay(deps, x.tenantId, x.venueId, bd1);
    await rollupVenueDay(deps, x.tenantId, x.venueId, '2026-10-22');
    const tr = await trendsReport(deps, x.tenantId, { from: '2026-10-22', to: '2026-10-28' });
    expect(tr.current.tickets).toBe(3);
    expect(tr.previous.tickets).toBe(2);
    const hm = await heatmapReport(deps, x.tenantId, { from: '2026-10-15', to: '2026-10-22' });
    // 09:00 UTC = 12:00 Riyadh; 2026-10-22 is a Thursday (4), 2026-10-15 also Thursday.
    expect(hm.grid[4]![12]).toBe(5);
    const m = await platformDailyRollup(deps, '2026-10-22');
    expect(m.signups).toBeGreaterThanOrEqual(0);
  });

  it('keeps monthly partitions ahead of time', async () => {
    deps.clock.set('2026-10-22T09:00:00Z');
    const r = await maintainPartitions(deps);
    expect(r.created).toEqual(['p202610', 'p202611', 'p202612', 'p202701']);
    const parts = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_events'`.execute(t.clients.platform());
    expect(Number(parts.rows[0]!.n)).toBe(6);
    expect((await maintainPartitions(deps)).created).toEqual([]);
  });
});
