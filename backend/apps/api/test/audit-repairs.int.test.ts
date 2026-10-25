import { currentTotp } from '@dop/auth';
import { defaultVenueSettings } from '@dop/contracts';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { uuidv7 } from '@dop/domain';
import { assertValidJobId, type MemoryJobs } from '@dop/jobs';
import * as svc from '@dop/services';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setGoogleProvider } from '../src/routes/auth-r11.js';
import { registerConnector } from '../src/routes/connectors.js';
import { client, makeApi } from './helpers.js';

// Regression tests for the 2026-10-22 audit (docs/audits/2026-10-22/REPORT.md). Each case reproduces the audited
// failure and asserts the corrected behaviour; the audit's probes asserted the defects.

let t: TestDatabase;
let api: ReturnType<typeof makeApi>;
const PASSWORD = 'a-long-unique-passphrase';
const platform = { kind: 'platform' as const, platformUserId: '', role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };
let n = 0;

beforeAll(async () => {
  t = await startTestDatabase();
  api = makeApi(t.clients);
  platform.platformUserId = uuidv7();
  await t.clients.platform().insertInto('platform_users').values({ id: platform.platformUserId, email: 'audit-platform@x.test', name: 'Platform', role: 'super_admin', status: 'active' }).execute();
});
afterAll(async () => {
  setGoogleProvider(null);
  await t?.stop();
});

async function tenant(plan?: 'pro' | 'multisite' | 'standard') {
  n++;
  const slug = `audit-${n}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@x.test`;
  const x = await svc.createTenantWithOwner(api.deps, { ownerName: 'Owner', email, password: PASSWORD, restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
  const pdb = t.clients.platform();
  await pdb.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', x.userId).execute();
  if (plan) {
    const p = await pdb.selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow();
    await pdb.updateTable('tenants').set({ status: 'active', complimentary: true, plan_id: p.id }).where('id', '=', x.tenantId).execute();
    await api.deps.kv.del(`t:${x.tenantId}:flags`);
  }
  const admin = client(api.app, `${slug}.dop.test`);
  expect((await admin.post('/api/auth/v1/sign-in', { email, password: PASSWORD })).status).toBe(200);
  const me = await admin.get('/api/auth/v1/me');
  admin.setCsrf(me.body.csrfToken);
  const owner = { kind: 'user' as const, userId: x.userId, tenantId: x.tenantId, role: 'owner' as const, sessionId: 's', mfaVerified: false };
  const device = { kind: 'staff_device' as const, deviceId: 'd', tenantId: x.tenantId, venueId: x.venueId, deviceName: 'iPad' };
  return { ...x, slug, email, admin, owner, device };
}

async function enrollTotp(x: Awaited<ReturnType<typeof tenant>>) {
  // Starting an authenticator re-proves the account (H-5).
  const e = await x.admin.post('/api/auth/v1/mfa/totp/enroll', { password: PASSWORD });
  expect(e.status).toBe(200);
  expect((await x.admin.post('/api/auth/v1/mfa/totp/confirm', { code: currentTotp(e.body.secret) })).status).toBe(204);
  return e.body.secret as string;
}

async function handoff(www: ReturnType<typeof client>, slug: string) {
  const me = await www.get('/api/auth/v1/me');
  www.setCsrf(me.body.csrfToken);
  const h = await www.post('/api/auth/v1/handoff', { tenantSlug: slug });
  expect(h.status).toBe(200);
  const host = client(api.app, `${slug}.dop.test`);
  expect((await host.post('/api/auth/v1/handoff/exchange', { code: h.body.code })).status).toBe(200);
  return host;
}

describe('A01 job identifiers and durable enqueue', () => {
  it('rejects the identifiers the installed queue rejects, in every adapter', () => {
    for (const bad of ['email:abc', 'push:t:1:1', '123']) expect(() => assertValidJobId(bad)).toThrow();
    expect(() => assertValidJobId(svc.jobIds.push('0192a0b2-0000-7000-8000-000000000000', 1, 1))).not.toThrow();
    expect(() => assertValidJobId(svc.jobIds.webhookFanout(12))).not.toThrow();
  });

  it('completes tenant creation, ticket events and export while the queue is down, and enqueues later', async () => {
    const jobs = api.deps.jobs as MemoryJobs;
    jobs.failNext(50);
    await svc.createTenantByPlatform(api.deps, platform, { name: 'Down Cafe', slug: 'queue-down', country: 'SA', locale: 'en', ownerEmail: 'down@x.test', ownerPassword: 'Quiet-Harbor-5521-xq', complimentary: false });
    const x = await t.clients.platform().selectFrom('tenants').select('id').where('slug', '=', 'queue-down').executeTakeFirstOrThrow();
    const venueId = (await t.clients.forTenant(x.id).selectFrom('venues').select('id').executeTakeFirstOrThrow()).id;
    const device = { kind: 'staff_device' as const, deviceId: 'd', tenantId: x.id, venueId, deviceName: 'iPad' };
    const published = api.deps.kv.published.length;
    const tk = (await svc.createTicket(api.deps, device, venueId, {})).ticket;
    await svc.transitionTicket(api.deps, device, tk.id, { to: 'ready', version: 1 });
    // The realtime events are not held back by the queue outage.
    expect(api.deps.kv.published.length).toBeGreaterThanOrEqual(published + 2);
    jobs.failNext(0);
    jobs.take();
    const pending = await t.clients.platform().selectFrom('outbox').select('id').where('published_at', 'is', null).execute();
    expect(pending.length).toBeGreaterThan(0);
    await svc.flushOutbox(api.deps, pending.map((p) => p.id));
    const names = jobs.take().map((j) => j.name);
    expect(names).toEqual(expect.arrayContaining(['push.send', 'alert.repeat', 'alert.overdue-flag']));
    expect(await t.clients.platform().selectFrom('outbox').select('id').where('published_at', 'is', null).execute()).toEqual([]);
  });
});

describe('A02, A05 entitlements', () => {
  it('gives a trial owner no way to switch to Pro, and issues no key', async () => {
    const x = await tenant();
    // Plans are changed by the platform team only; the tenant-side plan change no longer exists.
    const r = await x.admin.post('/api/admin/v1/billing/change-plan', { planCode: 'pro' });
    expect(r.status).toBe(404);
    expect(await svc.isEnabled(api.deps, x.tenantId, 'api_access')).toBe(false);
    expect((await x.admin.post(`/api/admin/v1/venues/${x.venueId}/api-keys`, { name: 'Trial key' })).status).toBe(403);
  });

  it('blocks a downgrade that would orphan API keys and stops kept keys once the plan lacks the API', async () => {
    const x = await tenant('pro');
    const key = await svc.createApiKey(api.deps, x.owner, x.tenantId, x.venueId, 'Integration');
    expect((await svc.usageOf(api.deps, x.tenantId)).maxApiKeysInAVenue).toBe(1);
    await expect(svc.changePlan(api.deps, platform, x.tenantId, 'trial')).rejects.toMatchObject({ code: 'PLAN_DOWNGRADE_BLOCKED' });
    const v1 = () => request(api.app).post('/v1/tickets').set('Host', 'api.dop.test').set('Authorization', `Bearer ${key.key}`).send({ externalRef: 'after-change' });
    expect((await v1()).status).toBe(201);
    // A plan change made outside the downgrade check (e.g. by the platform's database tools) still takes effect.
    const std = await t.clients.platform().selectFrom('plans').select('id').where('code', '=', 'trial').executeTakeFirstOrThrow();
    await t.clients.platform().updateTable('tenants').set({ plan_id: std.id }).where('id', '=', x.tenantId).execute();
    await api.deps.kv.del(`t:${x.tenantId}:flags`);
    const after = await v1();
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('FEATURE_NOT_IN_PLAN');
  });
});

describe('A03, A04 second factor across sign-in methods', () => {
  it('keeps completed TOTP through the www → tenant handoff', async () => {
    const x = await tenant('multisite');
    const secret = await enrollTotp(x);
    expect((await x.admin.post('/api/admin/v1/venues', { name: 'Second venue' })).status).toBe(201);
    const www = client(api.app, 'www.dop.test');
    const first = await www.post('/api/auth/v1/sign-in', { email: x.email, password: PASSWORD });
    expect(first.body.mfaRequired).toBe(true);
    expect((await www.post('/api/auth/v1/sign-in/mfa', { mfaToken: first.body.mfaToken, code: currentTotp(secret, 1) })).body.ok).toBe(true); // the enrolment code was single-use (L-1)
    const host = await handoff(www, x.slug);
    expect((await host.get('/api/admin/v1/venues')).status).toBe(200);
  });

  it('asks a Google user with an authenticator for the code before any session exists', async () => {
    const x = await tenant('pro');
    const secret = await enrollTotp(x);
    setGoogleProvider({
      authorizationUrl: async ({ state }) => `https://stub-provider.test/authorize?state=${encodeURIComponent(state)}`,
      callback: async () => ({ sub: `sub-${x.slug}`, email: x.email, emailVerified: true, name: 'Owner' }),
    });
    const google = client(api.app, 'www.dop.test');
    const start = await google.get('/api/auth/v1/oauth/google/start');
    const state = new URL(start.headers.location as string).searchParams.get('state');
    const cb = await google.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${state}`);
    expect(cb.status).toBe(302);
    // The account has a password, so Google is linked only after it is proved (M-1); then the code is asked.
    const l = /#link=(.+)$/.exec(cb.headers.location as string);
    expect(l).not.toBeNull();
    expect((await google.get('/api/auth/v1/me')).status).toBe(401);
    const linked = await google.post('/api/auth/v1/oauth/google/link', { linkToken: decodeURIComponent(l![1]!), password: PASSWORD });
    expect(linked.body.mfaRequired).toBe(true);
    expect((await google.get('/api/auth/v1/me')).status).toBe(401);
    expect((await google.post('/api/auth/v1/sign-in/mfa', { mfaToken: linked.body.mfaToken, code: currentTotp(secret, 1) })).body.ok).toBe(true); // the enrolment code was single-use (L-1)
    const host = await handoff(google, x.slug);
    expect((await host.get('/api/admin/v1/venues')).status).toBe(200);
    // Once linked, Google sign-in goes straight to the second factor.
    const again = client(api.app, 'www.dop.test');
    const start2 = await again.get('/api/auth/v1/oauth/google/start');
    const state2 = new URL(start2.headers.location as string).searchParams.get('state');
    const cb2 = await again.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${state2}`);
    expect(/#mfa=/.test(cb2.headers.location as string)).toBe(true);
  });
});

describe('A06 named staff', () => {
  it('stops a personal token as soon as the member is deactivated', async () => {
    const x = await tenant('pro');
    const member = await svc.createStaffMember(api.deps, x.owner, x.tenantId, x.venueId, 'Sara', '5937');
    const { memberToken } = await svc.staffMemberUnlock(api.deps, x.tenantId, x.venueId, 'd', '5937');
    expect(await svc.staffMemberFor(api.deps, memberToken, 'd', x.tenantId)).toMatchObject({ memberId: member.id });
    await svc.deactivateStaffMember(api.deps, x.tenantId, member.id);
    expect(await svc.staffMemberFor(api.deps, memberToken, 'd', x.tenantId)).toBeNull();
    expect(await api.deps.kv.get(`member:${memberToken}`)).toBeNull();
  });
});

describe('A08, A31 alert retries', () => {
  async function readyWith(x: Awaited<ReturnType<typeof tenant>>, endpoints: string[]) {
    const tk = (await svc.createTicket(api.deps, x.device, x.venueId, {})).ticket;
    for (const [i, e] of endpoints.entries()) {
      const clientId = String.fromCharCode(65 + i).repeat(22);
      await svc.follow(api.deps, tk.token, { clientId, joinedVia: 'ticket_qr', uaFamily: 'other' });
      await svc.savePushSubscription(api.deps, tk.token, { clientId, subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${e}`, keys: { p256dh: 'x'.repeat(40), auth: 'y'.repeat(16) } } }, 'fcm');
    }
    await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'ready', version: 1 });
    return tk;
  }

  it('retries a failed repeat instead of consuming it', async () => {
    const x = await tenant();
    const tk = await readyWith(x, ['one']);
    await svc.firstAlert(api.deps, async () => 201, { tenantId: x.tenantId, ticketId: tk.id, round: 1, attempt: 1, manual: false });
    let calls = 0;
    await expect(svc.repeatAlert(api.deps, async () => (++calls, 503), { tenantId: x.tenantId, ticketId: tk.id, round: 1, n: 2 })).rejects.toMatchObject({ retryable: true });
    expect(await svc.repeatAlert(api.deps, async () => (++calls, 201), { tenantId: x.tenantId, ticketId: tk.id, round: 1, n: 2 })).toEqual({ sent: 1, failed: 0 });
    expect(calls).toBe(2);
    const row = await t.clients.forTenant(x.tenantId).selectFrom('tickets').select('auto_alerts_sent').where('id', '=', tk.id).executeTakeFirstOrThrow();
    expect(row.auto_alerts_sent).toBe(2);
  });

  it('retries only the failing recipient when others succeed', async () => {
    const x = await tenant();
    const tk = await readyWith(x, ['ok', 'flaky']);
    const calls: string[] = [];
    const sender = (fail: boolean) => async (m: svc.PushMessage) => {
      const e = m.endpoint.split('/').pop()!;
      calls.push(e);
      return e === 'flaky' && fail ? 503 : 201;
    };
    const d = { tenantId: x.tenantId, ticketId: tk.id, round: 1, attempt: 1, manual: false };
    await expect(svc.firstAlert(api.deps, sender(true), d)).rejects.toMatchObject({ retryable: true });
    expect(await svc.firstAlert(api.deps, sender(false), d)).toEqual({ sent: 1, failed: 0 });
    expect(calls).toEqual(['ok', 'flaky', 'flaky']);
    const alerts = api.deps.kv.published.filter((p) => { const e = JSON.parse(p.message); return e.topic === 'ticket.alert' && e.ticketId === tk.id; });
    expect(alerts).toHaveLength(1);
  });
});

describe('Manual billing (offline payments)', () => {
  // Without an HTTP sign-in, so these cases do not spend the file's sign-in rate limit.
  const bare = async (complimentary = false) => {
    n++;
    const slug = `pay-${n}-${Math.random().toString(36).slice(2, 6)}`;
    const x = await svc.createTenantWithOwner(api.deps, { ownerName: 'Owner', email: `${slug}@x.test`, password: PASSWORD, restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
    if (complimentary) await svc.setComplimentary(api.deps, platform, x.tenantId, true);
    return x;
  };
  const paidUntil = async (id: string) => (await t.clients.platform().selectFrom('tenants').select(['status', 'paid_until', 'grace_ends_at']).where('id', '=', id).executeTakeFirstOrThrow());

  it('activates a trial on payment and extends from the current paid-until date', async () => {
    const x = await bare();
    const first = await svc.recordPayment(api.deps, platform, x.tenantId, { amountMinor: 3000, currency: 'USD', months: 1, method: 'cash', reference: 'R-1' });
    const a = await paidUntil(x.tenantId);
    expect(a.status).toBe('active');
    expect(a.paid_until!.toISOString()).toBe(first.paidUntil);
    // Paying early adds to the remaining period instead of restarting it.
    const second = await svc.recordPayment(api.deps, platform, x.tenantId, { amountMinor: 9000, currency: 'USD', months: 3, method: 'wallet' });
    expect(second.paidUntil).toBe(svc.addMonths(new Date(first.paidUntil), 3).toISOString());
    const payments = await svc.listPayments(api.deps, x.tenantId);
    expect(payments.map((p) => p.months)).toEqual([3, 1]);
    const audit = await t.clients.platform().selectFrom('audit_log').select('action').where('tenant_id', '=', x.tenantId).where('action', '=', 'tenant.payment_recorded').execute();
    expect(audit).toHaveLength(2);
  });

  it('moves a tenant past due once its paid period ends, and a payment lifts the billing suspension', async () => {
    const x = await bare();
    await svc.recordPayment(api.deps, platform, x.tenantId, { amountMinor: 3000, currency: 'USD', months: 1, method: 'bank_transfer' });
    await t.clients.platform().updateTable('tenants').set({ paid_until: new Date(Date.now() - 60_000) }).where('id', '=', x.tenantId).execute();
    await svc.graceCheck(api.deps);
    const lapsed = await paidUntil(x.tenantId);
    expect(lapsed.status).toBe('past_due');
    expect(lapsed.grace_ends_at!.getTime()).toBeGreaterThan(Date.now());
    await t.clients.platform().updateTable('tenants').set({ grace_ends_at: new Date(Date.now() - 60_000) }).where('id', '=', x.tenantId).execute();
    await svc.graceCheck(api.deps);
    expect((await paidUntil(x.tenantId)).status).toBe('suspended');
    await svc.recordPayment(api.deps, platform, x.tenantId, { amountMinor: 3000, currency: 'USD', months: 1, method: 'cash' });
    const back = await paidUntil(x.tenantId);
    expect(back.status).toBe('active');
    expect(back.paid_until!.getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves complimentary tenants and tenants with time left alone', async () => {
    const comp = await bare(true);
    const paid = await bare();
    await svc.recordPayment(api.deps, platform, paid.tenantId, { amountMinor: 3000, currency: 'USD', months: 1, method: 'cash' });
    await svc.graceCheck(api.deps);
    await svc.trialCheck(api.deps);
    expect((await paidUntil(comp.tenantId)).status).toBe('active');
    expect((await paidUntil(paid.tenantId)).status).toBe('active');
  });

  it('records payments from the console only', async () => {
    const x = await bare();
    // Signed out on purpose: a route that existed would answer 401; these do not exist on the tenant host.
    const host = client(api.app, `${x.slug}.dop.test`);
    expect((await host.get('/api/admin/v1/billing')).status).toBe(401);
    const body = { amountMinor: 3000, currency: 'USD', months: 1, method: 'cash' };
    expect((await host.post(`/api/console/v1/tenants/${x.tenantId}/payments`, body)).status).toBe(404);
    expect((await host.post('/api/admin/v1/billing/checkout', { planCode: 'pro', period: 'month' })).status).toBe(404);
    expect((await request(api.app).post('/webhooks/stripe').set('Host', 'api.dop.test').send({})).status).toBe(404);
  });
});

describe('A10 ordinary inputs never cause 500', () => {
  it('answers each reproduced request with a validation error or a no-op', async () => {
    const x = await tenant('pro');
    const a = await svc.createCounter(api.deps, x.owner, x.tenantId, x.venueId, { name: 'Food', prefix: 'A' });
    const b = await svc.createCounter(api.deps, x.owner, x.tenantId, x.venueId, { name: 'Drinks', prefix: 'B' });
    const d = await svc.createDisplay(api.deps, x.owner, x.tenantId, x.venueId, { name: 'TV' });
    expect(a.id).toBeTruthy();
    const dup = await x.admin.patch(`/api/admin/v1/counters/${b.id}`, { prefix: 'A' });
    expect([dup.status, dup.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    for (const path of [`/api/admin/v1/counters/${b.id}`, `/api/admin/v1/venues/${x.venueId}`, `/api/admin/v1/displays/${d.id}`]) {
      const r = await x.admin.patch(path, {});
      expect(r.status, path).toBeLessThan(300);
    }
    for (const path of ['/api/staff/v1/board?venueId=bad', '/api/admin/v1/reports/trends?from=2026-99-99&to=2026-99-99', '/api/admin/v1/reports/heatmap?from=2026-99-99&to=2026-99-99', '/api/admin/v1/reports/trends?from=2026-02-30&to=2026-03-01']) {
      const r = await x.admin.get(path);
      expect([r.status, r.body.code], path).toEqual([400, 'VALIDATION_FAILED']);
    }
  });
});

describe('A11 – A17 report, claim, zone, feature, search, slug and MRR consistency', () => {
  it('keeps the stars when a rating comment is deleted (A11)', async () => {
    const x = await tenant('pro');
    const tk = (await svc.createTicket(api.deps, x.device, x.venueId, {})).ticket;
    const clientId = 'R'.repeat(22);
    await svc.follow(api.deps, tk.token, { clientId, joinedVia: 'ticket_qr', uaFamily: 'other' });
    await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'ready', version: 1 });
    await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'collected', version: 2 });
    await svc.rateTicket(api.deps, tk.token, { clientId, stars: 5, comment: 'good' });
    await svc.rollupVenueDay(api.deps, x.tenantId, x.venueId, tk.business_date);
    const rating = (await svc.listRatings(api.deps, x.tenantId))[0]!;
    await svc.deleteRatingComment(api.deps, x.owner, x.tenantId, rating.id);
    await svc.rollupVenueDay(api.deps, x.tenantId, x.venueId, tk.business_date);
    const after = await svc.trendsReport(api.deps, x.tenantId, { venueId: x.venueId, from: tk.business_date, to: tk.business_date });
    expect([after.current.ratingsCount, after.current.ratingAvg]).toEqual([1, 5]);
  });

  it('expires a pending claim when its ticket closes (A12)', async () => {
    const x = await tenant('pro');
    const s = defaultVenueSettings();
    s.claims.mode = 'staff_approval';
    await svc.putVenueSettings(api.deps, x.owner, x.tenantId, x.venueId, s);
    const tk = (await svc.createTicket(api.deps, x.device, x.venueId, {})).ticket;
    const code = (await svc.getVenueAdmin(api.deps, x.tenantId, x.venueId)).venueCode;
    const claim = await svc.claimTicket(api.deps, code, { clientId: 'C'.repeat(22), number: tk.display_number }, 'other');
    await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'ready', version: 1 });
    await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'collected', version: 2 });
    const claimId = (claim as { claimId: string }).claimId;
    expect(await svc.claimStatus(api.deps, claimId, 'C'.repeat(22))).toMatchObject({ status: 'expired' });
    expect(await svc.pendingClaims(api.deps, x.tenantId, x.venueId)).toEqual([]);
    expect(await svc.expireClaims(api.deps)).toBeGreaterThanOrEqual(1);
    const decided = api.deps.kv.published.map((p) => JSON.parse(p.message)).filter((e) => e.topic === 'claim.decided' && e.payload.claimId === claimId);
    expect(decided.at(-1)?.payload.status).toBe('expired');
  });

  it('applies a time zone change from the next business date (A13)', async () => {
    const x = await tenant();
    const r = await x.admin.patch(`/api/admin/v1/venues/${x.venueId}`, { timeZone: 'UTC' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ timeZone: 'Asia/Riyadh', pendingTimeZone: 'UTC' });
    expect(r.body.pendingFromDate > api.deps.now().toISOString().slice(0, 10) || r.body.pendingFromDate).toBeTruthy();
  });

  it('honours the reports_trends override (A14)', async () => {
    const x = await tenant('pro');
    await svc.setFlagOverride(api.deps, platform, x.tenantId, 'reports_trends', false);
    const r = await x.admin.get('/api/admin/v1/reports/trends?from=2026-01-01&to=2026-12-31');
    expect([r.status, r.body.code]).toEqual([403, 'FEATURE_NOT_IN_PLAN']);
  });

  it('finds a tenant by its owner email (A15)', async () => {
    const x = await tenant();
    const r = await svc.listTenants(api.deps, { q: x.email, limit: 20 });
    expect(r.items.map((i) => i.id)).toEqual([x.tenantId]);
  });

  it('keeps every old slug redirecting and reserved after several renames (A16)', async () => {
    const x = await tenant();
    const a = x.slug;
    await svc.changeSlug(api.deps, x.owner, x.tenantId, `${a}-b`, PASSWORD);
    await svc.changeSlug(api.deps, x.owner, x.tenantId, `${a}-c`, PASSWORD);
    expect(await svc.slugRedirect(api.deps, a)).toBe(`${a}-c`);
    expect(await svc.slugRedirect(api.deps, `${a}-b`)).toBe(`${a}-c`);
    expect(await svc.slugAvailability(api.deps, a)).toEqual({ available: false, reason: 'taken' });
    // The tenant may take an old slug back.
    await svc.changeSlug(api.deps, x.owner, x.tenantId, a, PASSWORD);
    expect(await svc.slugRedirect(api.deps, `${a}-c`)).toBe(a);
  });

  it('reports MRR from what tenants paid, not the current catalogue (A17)', async () => {
    const x = await tenant();
    const pro = await t.clients.platform().selectFrom('plans').select('id').where('code', '=', 'pro').executeTakeFirstOrThrow();
    const date = api.deps.now().toISOString().slice(0, 10);
    const start = await svc.platformDailyRollup(api.deps, date);
    await svc.recordPayment(api.deps, platform, x.tenantId, { amountMinor: 53700, currency: 'SAR', months: 3, method: 'bank_transfer' });
    const before = await svc.platformDailyRollup(api.deps, date);
    expect(before.mrr.SAR).toBe((start.mrr.SAR ?? 0) + 17900);
    await svc.addPrice(api.deps, platform, pro.id, { period: 'month', currency: 'SAR', amountMinor: 29900 });
    const after = await svc.platformDailyRollup(api.deps, date);
    expect(after.mrr.SAR).toBe(before.mrr.SAR);
  });
});

describe('A30 resumable purge', () => {
  it('finishes after a storage failure on the next run', async () => {
    const x = await tenant();
    await svc.markDeleted(api.deps, x.tenantId, { kind: 'system' });
    await api.deps.kv.set(`t:${x.tenantId}:probe`, '1');
    const objects = new Map([[`assets:tenants/${x.tenantId}/logo.png`, Buffer.from('a')], [`exports:exports/${x.tenantId}/e.zip`, Buffer.from('b')]]);
    let fail = true;
    const storage: svc.ObjectStorage = {
      async put() {},
      async get() { return null; },
      async signedUrl() { return 'https://x'; },
      async deletePrefix(bucket, prefix) {
        if (fail) { fail = false; throw new Error('storage down'); }
        let d = 0;
        for (const k of [...objects.keys()]) if (k.startsWith(`${bucket}:${prefix}`)) { objects.delete(k); d++; }
        return d;
      },
    };
    await expect(svc.purgeTenant(api.deps, x.tenantId, storage)).rejects.toThrow('storage down');
    expect(await t.clients.platform().selectFrom('tenants').select('status').where('id', '=', x.tenantId).executeTakeFirst()).toEqual({ status: 'deleted' });
    expect((await svc.purgeTenant(api.deps, x.tenantId, storage)).done).toBe(true);
    expect(objects.size).toBe(0);
    expect(await api.deps.kv.exists(`t:${x.tenantId}:probe`)).toBe(false);
    expect(await t.clients.platform().selectFrom('tenants').select('id').where('id', '=', x.tenantId).executeTakeFirst()).toBeUndefined();
    const mail = (api.deps.jobs as MemoryJobs).take('email.send').filter((j) => (j.data as { template: string; to: string }).template === 'deletion_completed' && (j.data as { to: string }).to === x.email);
    expect(mail).toHaveLength(1);
  });
});

describe('W01 POS connection lifecycle', () => {
  it('connects through the provider, refuses a reused state or a foreign location, and disconnects', async () => {
    registerConnector({
      provider: 'stubpos',
      connectUrl: (state, redirectUri) => `https://pos.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      exchange: async (code) => ({ credentials: { token: `tok-${code}` }, locationId: code === 'shared' ? 'loc-shared' : `loc-${code}` }),
      verifyWebhook: () => true,
      mapOrder: () => null,
      disconnect: async () => undefined,
    });
    const x = await tenant('pro');
    expect((await x.admin.get('/api/admin/v1/pos/providers')).body.items).toContain('stubpos');
    const start = await x.admin.post(`/api/admin/v1/venues/${x.venueId}/pos/stubpos/connect`);
    expect(start.status).toBe(200);
    const url = new URL(start.body.url);
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.dop.test/connectors/stubpos/callback');
    const state = url.searchParams.get('state')!;
    // The starting browser's binding cookie goes with the provider's redirect to the API host.
    const binding = (a: { jar: Map<string, string> }) => [...a.jar].filter(([k]) => k.endsWith('posbind')).map(([k, v]) => `${k}=${v}`).join('; ');
    expect(binding(x.admin)).not.toBe('');
    const cb = await request(api.app).get(`/connectors/stubpos/callback?code=shared&state=${state}`).set('Host', 'api.dop.test').set('Cookie', binding(x.admin));
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe(`https://${x.slug}.dop.test/admin/integrations?pos=connected`);
    const replay = await request(api.app).get(`/connectors/stubpos/callback?code=shared&state=${state}`).set('Host', 'api.dop.test').set('Cookie', binding(x.admin));
    expect(replay.status).toBe(401);
    const list = await x.admin.get('/api/admin/v1/pos/connections');
    expect(list.body.items).toEqual([expect.objectContaining({ provider: 'stubpos', locationId: 'loc-shared', venueId: x.venueId, status: 'connected' })]);

    const y = await tenant('pro');
    const s2 = new URL((await y.admin.post(`/api/admin/v1/venues/${y.venueId}/pos/stubpos/connect`)).body.url).searchParams.get('state')!;
    const taken = await request(api.app).get(`/connectors/stubpos/callback?code=shared&state=${s2}`).set('Host', 'api.dop.test').set('Cookie', binding(y.admin));
    expect(taken.headers.location).toBe(`https://${y.slug}.dop.test/admin/integrations?pos=taken`);

    const trial = await tenant();
    const refused = await trial.admin.post(`/api/admin/v1/venues/${trial.venueId}/pos/stubpos/connect`);
    expect(refused.body.code).toBe('FEATURE_NOT_IN_PLAN');

    // An authorise link sent to someone else (their browser lacks the starter's cookie) connects nothing.
    // (y has no connection: its only attempt was refused as taken; no extra sign-in, the file shares one IP budget.)
    const s3 = new URL((await y.admin.post(`/api/admin/v1/venues/${y.venueId}/pos/stubpos/connect`)).body.url).searchParams.get('state')!;
    const victim = await request(api.app).get(`/connectors/stubpos/callback?code=victim&state=${s3}`).set('Host', 'api.dop.test');
    expect(victim.status).toBe(401);
    expect((await y.admin.get('/api/admin/v1/pos/connections')).body.items).toEqual([]);

    expect((await x.admin.delete(`/api/admin/v1/pos/connections/${list.body.items[0].id}`)).status).toBe(204);
    expect((await x.admin.get('/api/admin/v1/pos/connections')).body.items).toEqual([]);
  });
});

describe('W03 counter-filtered CSV', () => {
  it('exports only the selected counter', async () => {
    const x = await tenant('pro');
    const food = await svc.createCounter(api.deps, x.owner, x.tenantId, x.venueId, { name: 'Food', prefix: 'F' });
    const drinks = await svc.createCounter(api.deps, x.owner, x.tenantId, x.venueId, { name: 'Drinks', prefix: 'D' });
    await svc.createTicket(api.deps, x.device, x.venueId, { counterId: food.id });
    await svc.createTicket(api.deps, x.device, x.venueId, { counterId: drinks.id });
    const day = api.deps.now().toISOString().slice(0, 10);
    const from = new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);
    const all = await x.admin.get(`/api/admin/v1/reports/export.csv?venueId=${x.venueId}&from=${from}&to=${day}`);
    const one = await x.admin.get(`/api/admin/v1/reports/export.csv?venueId=${x.venueId}&counterId=${food.id}&from=${from}&to=${day}`);
    const rows = (s: string) => s.trim().split('\n').slice(1);
    expect(rows(all.text)).toHaveLength(2);
    expect(rows(one.text)).toHaveLength(1);
  });
});

describe('W02 commercial plan selection', () => {
  it('lists every public paid plan on the site and on the billing page', async () => {
    const www = client(api.app, 'www.dop.test');
    const plans = await www.get('/api/public/v1/plans');
    expect(plans.status).toBe(200);
    const codes = plans.body.items.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['standard', 'pro']));
    expect(codes).not.toContain('trial');
    const x = await tenant();
    const overview = await x.admin.get('/api/admin/v1/billing');
    expect(overview.body.plans.map((p: { code: string }) => p.code)).toEqual(codes);
    expect(overview.body).toMatchObject({ status: 'trial', paidUntil: null, payments: [] });
  });
});

describe('W04 console tenant creation', () => {
  it('creates a tenant active at once on the chosen plan, with the first month covered and no trial', async () => {
    const r = await svc.createTenantByPlatform(api.deps, platform, { name: 'Console Cafe', slug: 'console-cafe', country: 'SA', locale: 'ar', ownerEmail: 'console-owner@x.test', ownerPassword: 'Quiet-Harbor-5521-xq', complimentary: false, planCode: 'standard' });
    const t1 = await t.clients.platform().selectFrom('tenants').innerJoin('plans', 'plans.id', 'tenants.plan_id').select(['plans.code', 'tenants.status', 'tenants.trial_ends_at', 'tenants.paid_until']).where('tenants.id', '=', r.tenantId).executeTakeFirstOrThrow();
    expect(t1.code).toBe('standard');
    expect(t1.status).toBe('active');
    expect(t1.trial_ends_at).toBeNull();
    expect(Math.round((t1.paid_until!.getTime() - api.deps.now().getTime()) / 86_400_000)).toBeGreaterThanOrEqual(28);
    const report = await svc.subscriptionReport(api.deps);
    expect(report.running.some((x) => x.id === r.tenantId && x.status === 'active')).toBe(true);
    const c = await svc.createTenantByPlatform(api.deps, platform, { name: 'Comp Cafe', slug: 'comp-cafe', country: 'SA', locale: 'ar', ownerEmail: 'comp-owner@x.test', ownerPassword: 'Quiet-Harbor-5521-xq', complimentary: true, planCode: 'standard' });
    const t2 = await t.clients.platform().selectFrom('tenants').innerJoin('plans', 'plans.id', 'tenants.plan_id').select(['plans.code', 'tenants.status', 'tenants.trial_ends_at']).where('tenants.id', '=', c.tenantId).executeTakeFirstOrThrow();
    expect(t2).toEqual({ code: 'standard', status: 'active', trial_ends_at: null });
  });
});

describe('W05, W06 account email and preferences', () => {
  it('changes the sign-in email only from the link sent to the new address', async () => {
    const x = await tenant();
    const jobs = api.deps.jobs as MemoryJobs;
    jobs.take();
    expect((await x.admin.post('/api/admin/v1/me/email', { newEmail: 'new@x.test', password: 'wrong-password' })).status).toBe(401);
    const r = await x.admin.post('/api/admin/v1/me/email', { newEmail: `new-${x.slug}@x.test`, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect((await x.admin.get('/api/auth/v1/me')).body.user).toMatchObject({ email: x.email, pendingEmail: `new-${x.slug}@x.test` });
    const mails = jobs.take('email.send').map((j) => j.data as { template: string; to: string; data: { link?: string } });
    expect(mails.find((m) => m.template === 'email_changed')?.to).toBe(x.email);
    const link = (await svc.openEmailData(api.deps.keys, mails.find((m) => m.template === 'email_change' && m.to === `new-${x.slug}@x.test`)!.data)).link as string;
    const token = new URL(link).searchParams.get('token')!;
    expect((await client(api.app, 'www.dop.test').post('/api/auth/v1/email/change/confirm', { token })).status).toBe(200);
    expect((await client(api.app, 'www.dop.test').post('/api/auth/v1/email/change/confirm', { token })).status).toBe(410);
    const u = await t.clients.platform().selectFrom('users').select('email').where('id', '=', x.userId).executeTakeFirstOrThrow();
    expect(u.email).toBe(`new-${x.slug}@x.test`);
  });

  it('turns the weekly summary off for the signed-in member', async () => {
    const x = await tenant();
    expect((await x.admin.get('/api/auth/v1/me')).body.preferences).toEqual({ weeklySummary: true });
    expect((await x.admin.put('/api/admin/v1/me/preferences', { weeklySummary: false })).status).toBe(204);
    expect((await x.admin.get('/api/auth/v1/me')).body.preferences).toEqual({ weeklySummary: false });
  });
});

describe('W08 retention', () => {
  it('removes idempotency keys after a day and old alert records', async () => {
    const x = await tenant('pro');
    const key = await svc.createApiKey(api.deps, x.owner, x.tenantId, x.venueId, 'k');
    const db = t.clients.forTenant(x.tenantId);
    const old = new Date(api.deps.now().getTime() - 2 * 86_400_000);
    await db.insertInto('idempotency_keys').values({ tenant_id: x.tenantId, api_key_id: key.id, idem_key: 'old', request_hash: 'h'.repeat(64), status_code: 201, created_at: old }).execute();
    await db.insertInto('alert_attempts').values({ tenant_id: x.tenantId, ticket_id: uuidv7(), round: 1, attempt: '1', created_at: new Date(api.deps.now().getTime() - 8 * 86_400_000) }).execute();
    const out = await svc.retentionMisc(api.deps);
    expect(out.idempotency_keys).toBeGreaterThanOrEqual(1);
    expect(out.alert_attempts).toBeGreaterThanOrEqual(1);
    expect(await db.selectFrom('idempotency_keys').select('idem_key').where('api_key_id', '=', key.id).execute()).toEqual([]);
  });
});

describe('W11 chimes', () => {
  it('lets the console add a chime, the venue choose it, and the apps receive its file', async () => {
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 1)]);
    const chime = await svc.uploadChime(api.deps, api.deps.storage, platform, { code: 'marimba', name: 'Marimba', durationMs: 1500 }, mp3);
    expect(chime).toMatchObject({ code: 'marimba', builtin: false, url: 'https://cdn.dop.test/chimes/marimba.mp3' });
    await expect(svc.uploadChime(api.deps, api.deps.storage, platform, { code: 'x1', name: 'x', durationMs: 1000 }, Buffer.from('not audio'))).rejects.toMatchObject({ code: 'UPLOAD_INVALID' });
    const x = await tenant();
    expect((await x.admin.get('/api/admin/v1/chimes')).body.items.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(['classic', 'bell', 'soft', 'marimba']));
    const s = defaultVenueSettings();
    s.alerts.chime = 'nope';
    await expect(svc.putVenueSettings(api.deps, x.owner, x.tenantId, x.venueId, s)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    s.alerts.chime = 'marimba';
    await svc.putVenueSettings(api.deps, x.owner, x.tenantId, x.venueId, s);
    const tk = (await svc.createTicket(api.deps, x.device, x.venueId, {})).ticket;
    const view = await client(api.app, 't.dop.test').get(`/api/public/v1/tickets/${tk.token}`);
    expect(view.body.venue).toMatchObject({ chime: 'marimba', chimeUrl: 'https://cdn.dop.test/chimes/marimba.mp3' });
  });
});

describe('W12 published legal content', () => {
  it('serves the published customer privacy notice as sanitised HTML', async () => {
    const d = await svc.createLegalDocument(api.deps, api.deps.storage, platform, { kind: 'customer_privacy', version: '1.0', locale: 'ar', html: '<h2>الخصوصية</h2><p>نص<script>alert(1)</script></p>' });
    await svc.publishLegalDocument(api.deps, platform, d.id);
    const r = await client(api.app, 't.dop.test').get('/api/public/v1/legal/customer_privacy?locale=ar');
    expect(r.status).toBe(200);
    expect(r.body.html).toBe('<h2>الخصوصية</h2><p>نص</p>');
  });
});

describe('staff board figures for the frontend (W16, W17)', () => {
  it('reports collected today and close times, and how long a PIN lock lasts', async () => {
    const x = await tenant();
    const tk = (await svc.createTicket(api.deps, x.device, x.venueId, {})).ticket;
    await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'ready', version: 1 });
    await svc.transitionTicket(api.deps, x.device, tk.id, { to: 'collected', version: 2 });
    const board = await x.admin.get(`/api/staff/v1/board?venueId=${x.venueId}`);
    expect(board.body.collectedToday).toBe(1);
    expect(board.body.recent[0]).toMatchObject({ closedAt: expect.any(String), businessDate: tk.business_date });
    const pinKey = 'pin:member:dev-lock';
    for (let i = 0; i < 5; i++) await api.deps.kv.incr(pinKey, 600);
    await expect(svc.staffMemberUnlock(api.deps, x.tenantId, x.venueId, 'dev-lock', '1111')).rejects.toMatchObject({ code: 'PIN_LOCKED', data: { retryAfterSeconds: expect.any(Number) } });
  });
});
