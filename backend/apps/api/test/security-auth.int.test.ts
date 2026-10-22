import { Writable } from 'node:stream';
import { can, currentTotp, encrypt, hashSecret, newTotpSecret, tokenHash } from '@dop/auth';
import { parseIpRules } from '@dop/config';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { newSecretToken, uuidv7 } from '@dop/domain';
import * as svc from '@dop/services';
import pino from 'pino';
import type { Test } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { setGoogleProvider } from '../src/routes/auth-r11.js';
import { client, makeApi } from './helpers.js';

// Regression tests for the 2026-10-22 security repairs (docs/security/2026-10-22/REMEDIATION.md): sessions, second
// factor, support access, Google sign-in, the console allow-list, request logs and billing webhooks. Each case
// asserts the repaired behaviour; the audit's probes demonstrated the defects.

let t: TestDatabase;
let api: ReturnType<typeof makeApi>;
const PASSWORD = 'a-long-unique-passphrase';
let n = 0;

beforeAll(async () => {
  t = await startTestDatabase();
  api = makeApi(t.clients);
});
afterAll(async () => {
  setGoogleProvider(null);
  await t?.stop();
});

type Api = ReturnType<typeof makeApi>;

async function tenant(a: Api = api, plan?: 'multisite') {
  n++;
  const slug = `sec-${n}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@x.test`;
  const x = await svc.createTenantWithOwner(a.deps, { ownerName: 'Owner', email, password: PASSWORD, restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
  const pdb = t.clients.platform();
  await pdb.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', x.userId).execute();
  if (plan) {
    const p = await pdb.selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow();
    await pdb.updateTable('tenants').set({ status: 'active', complimentary: true, plan_id: p.id }).where('id', '=', x.tenantId).execute();
    await a.deps.kv.del(`t:${x.tenantId}:flags`);
  }
  const admin = await signIn(a, `${slug}.dop.test`, email);
  const owner = { kind: 'user' as const, userId: x.userId, tenantId: x.tenantId, role: 'owner' as const, sessionId: 's', mfaVerified: true };
  return { ...x, slug, email, admin, owner, host: `${slug}.dop.test` };
}

async function signIn(a: Api, host: string, email: string, code?: () => string) {
  const c = client(a.app, host);
  const r = await c.post('/api/auth/v1/sign-in', { email, password: PASSWORD });
  expect(r.status).toBe(200);
  if (r.body.mfaRequired) expect((await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: r.body.mfaToken, code: code!() })).body.ok).toBe(true);
  const me = await c.get('/api/auth/v1/me');
  c.setCsrf(me.body.csrfToken);
  return c;
}

/** Enrols TOTP for the signed-in user; the confirm code uses step −1 so step 0 / +1 stay free for the test. */
async function enroll(c: ReturnType<typeof client>) {
  const e = await c.post('/api/auth/v1/mfa/totp/enroll', { password: PASSWORD });
  expect(e.status).toBe(200);
  expect((await c.post('/api/auth/v1/mfa/totp/confirm', { code: currentTotp(e.body.secret, -1) })).status).toBe(204);
  return e.body.secret as string;
}

function lastLink(a: Api, template: string) {
  const job = a.deps.jobs.added.filter((j) => j.name === 'email.send' && (j.data as { template: string }).template === template).at(-1);
  return new URL((job!.data as { data: { link: string } }).data.link);
}

async function platformUser(role: 'super_admin' | 'support' | 'finance' = 'super_admin') {
  const id = uuidv7();
  const secret = newTotpSecret();
  const email = `p-${id.slice(-8)}@x.test`;
  await t.clients
    .platform()
    .insertInto('platform_users')
    .values({ id, email, name: 'Agent', role, status: 'active', password_hash: await hashSecret(PASSWORD), totp_secret_enc: await encrypt(api.deps.keys, secret), mfa_enrolled_at: new Date() })
    .execute();
  return { id, email, secret, actor: { kind: 'platform' as const, platformUserId: id, role, sessionId: 's', mfaVerifiedAt: new Date() } };
}

/** An approved support session and a browser holding its support cookie on the tenant host. */
async function supportBrowser(x: Awaited<ReturnType<typeof tenant>>, agent: Awaited<ReturnType<typeof platformUser>>) {
  const { id } = await svc.requestSupport(api.deps, agent.actor, x.tenantId, 'Investigate an issue', 60);
  await svc.approveSupport(api.deps, x.owner, id);
  const code = new URL((await svc.enterSupport(api.deps, agent.actor, id)).url).searchParams.get('code')!;
  const b = client(api.app, x.host);
  expect((await b.post('/api/auth/v1/support/exchange', { code })).status).toBe(200);
  const me = await b.get('/api/auth/v1/me');
  expect(me.body.currentRole).toBe('support');
  b.setCsrf(me.body.csrfToken);
  return { b, sessionId: id };
}

describe('H-4 invitation acceptance follows the account’s sign-in policy', () => {
  it('gives an existing account with an authenticator an MFA challenge, not a session or membership', async () => {
    const a = await tenant();
    const b = await tenant();
    const secret = await enroll(b.admin);
    await svc.inviteMember(api.deps, a.owner, a.tenantId, b.email, 'manager');
    const token = lastLink(api, 'invitation_manager').searchParams.get('token')!;
    const browser = client(api.app, a.host);
    const r = await browser.post(`/api/auth/v1/invitations/${token}/accept`, { password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.mfaRequired).toBe(true);
    expect((await browser.get('/api/auth/v1/me')).status).toBe(401);
    expect(await svc.membershipFor(api.deps, b.userId, a.tenantId)).toBeNull();
    // A wrong code grants nothing; the right one completes the invitation and the session.
    expect((await browser.post('/api/auth/v1/sign-in/mfa', { mfaToken: r.body.mfaToken, code: '000000' })).status).toBe(401);
    expect(await svc.membershipFor(api.deps, b.userId, a.tenantId)).toBeNull();
    expect((await browser.post('/api/auth/v1/sign-in/mfa', { mfaToken: r.body.mfaToken, code: currentTotp(secret) })).body.ok).toBe(true);
    expect((await svc.membershipFor(api.deps, b.userId, a.tenantId))?.role).toBe('manager');
    expect((await browser.get('/api/auth/v1/me')).body.currentRole).toBe('manager');
    // Single use: the invitation cannot be accepted again.
    expect((await client(api.app, a.host).post(`/api/auth/v1/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(410);
  });

  it('refuses a disabled account and still lets a new user accept', async () => {
    const a = await tenant();
    const b = await tenant();
    await t.clients.platform().updateTable('users').set({ disabled_at: new Date() }).where('id', '=', b.userId).execute();
    await svc.inviteMember(api.deps, a.owner, a.tenantId, b.email, 'manager');
    const token = lastLink(api, 'invitation_manager').searchParams.get('token')!;
    expect((await client(api.app, a.host).post(`/api/auth/v1/invitations/${token}/accept`, { password: PASSWORD })).status).toBe(401);
    await svc.inviteMember(api.deps, a.owner, a.tenantId, `new-${a.slug}@x.test`, 'manager');
    const fresh = lastLink(api, 'invitation_manager').searchParams.get('token')!;
    const browser = client(api.app, a.host);
    expect((await browser.post(`/api/auth/v1/invitations/${fresh}/accept`, { name: 'New', password: PASSWORD })).body.ok).toBe(true);
    expect((await browser.get('/api/auth/v1/me')).body.currentRole).toBe('manager');
  });
});

describe('H-1, L-1 second-factor attempt budgets and single-use codes', () => {
  it('ends a challenge after 5 wrong codes and locks the account after 10, from any address', async () => {
    const a = makeApi(t.clients); // own KV and rate limiter
    const x = await tenant(a);
    const secret = await enroll(x.admin);
    const start = async () => (await client(a.app, x.host).post('/api/auth/v1/sign-in', { email: x.email, password: PASSWORD })).body.mfaToken as string;
    const c = client(a.app, x.host);
    const first = await start();
    for (let i = 0; i < 5; i++) expect((await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: first, code: '000000' })).status).toBe(401);
    const dead = await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: first, code: currentTotp(secret) });
    expect(dead.status).toBe(401);
    expect(dead.body.detail).toMatch(/expired/i);
    const second = await start();
    for (let i = 0; i < 5; i++) await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: second, code: '000000' });
    const third = await start();
    const locked = await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: third, code: currentTotp(secret) });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('accepts each code once', async () => {
    const a = makeApi(t.clients);
    const x = await tenant(a);
    const secret = await enroll(x.admin);
    const code = currentTotp(secret);
    const one = await client(a.app, x.host).post('/api/auth/v1/sign-in', { email: x.email, password: PASSWORD });
    expect((await client(a.app, x.host).post('/api/auth/v1/sign-in/mfa', { mfaToken: one.body.mfaToken, code })).body.ok).toBe(true);
    const two = await client(a.app, x.host).post('/api/auth/v1/sign-in', { email: x.email, password: PASSWORD });
    expect((await client(a.app, x.host).post('/api/auth/v1/sign-in/mfa', { mfaToken: two.body.mfaToken, code })).status).toBe(401);
  });
});

describe('M-5 account-wide sign-in budget', () => {
  it('stops guesses spread over many addresses, but not the owner on a familiar address', async () => {
    const a = makeApi(t.clients);
    const x = await tenant(a); // signs in once from the test client's address, which becomes familiar
    const familiar = (await t.clients.platform().selectFrom('user_sessions').select('ip').where('user_id', '=', x.userId).executeTakeFirstOrThrow()).ip;
    const at = (ip: string) => ({ ip, userAgent: 'test', host: x.host });
    for (let i = 0; i < 20; i++) await expect(svc.signInUser(a.deps, x.email, 'wrong-password-123', x.tenantId, at(`198.51.100.${i % 4}`))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(svc.signInUser(a.deps, x.email, PASSWORD, x.tenantId, at('203.0.113.50'))).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    await expect(svc.signInUser(a.deps, x.email, PASSWORD, x.tenantId, at(familiar))).resolves.toMatchObject({ kind: 'session' });
  });
});

describe('L-4 staff PIN lockout', () => {
  it('counts by address whatever the client fingerprint, and keeps familiar boards working during a venue lock', async () => {
    const a = makeApi(t.clients);
    const x = await tenant(a);
    await svc.setStaffPin(a.deps, { kind: 'system' }, x.tenantId, x.venueId, '4821');
    const staffKey = (await svc.staffAccessInfo(a.deps, x.tenantId, x.venueId)).link.split('/staff/')[1]!;
    const sign = (ip: string, pin: string, fingerprint = String(Math.random())) => svc.staffSignIn(a.deps, { staffKey, pin, deviceName: 'iPad' }, { ip, userAgent: 'test', fingerprint, host: x.host });
    await sign('192.0.2.1', '4821'); // the restaurant's own board
    for (let i = 0; i < 5; i++) await expect(sign('198.51.100.7', '0000')).rejects.toBeTruthy();
    await expect(sign('198.51.100.7', '4821')).rejects.toMatchObject({ code: 'PIN_LOCKED' }); // a new fingerprint does not help
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) await sign(`198.51.101.${i}`, '0000').catch(() => undefined); // 20+ failures: venue lock
    await expect(sign('203.0.113.9', '4821')).rejects.toMatchObject({ code: 'PIN_LOCKED' });
    await expect(sign('192.0.2.1', '4821')).resolves.toMatchObject({ venueId: x.venueId });
  });
});

describe('H-5, M-16 changing or removing the authenticator', () => {
  it('needs the password and the current factor to replace it, and revokes other sessions', async () => {
    const a = makeApi(t.clients);
    const x = await tenant(a);
    const secret = await enroll(x.admin);
    expect((await x.admin.post('/api/auth/v1/mfa/totp/enroll', {})).status).toBe(401); // no password
    expect((await x.admin.post('/api/auth/v1/mfa/totp/enroll', { password: 'wrong-password-123' })).status).toBe(401);
    expect((await x.admin.post('/api/auth/v1/mfa/totp/enroll', { password: PASSWORD })).status).toBe(401); // no current code
    const other = await signIn(a, x.host, x.email, () => currentTotp(secret));
    const e = await x.admin.post('/api/auth/v1/mfa/totp/enroll', { password: PASSWORD, currentCode: currentTotp(secret, 1) });
    expect(e.status).toBe(200);
    // The new secret's code confirms enrolment only from the session that re-authenticated.
    expect((await other.post('/api/auth/v1/mfa/totp/confirm', { code: currentTotp(e.body.secret) })).status).toBe(400);
    expect((await x.admin.post('/api/auth/v1/mfa/totp/confirm', { code: currentTotp(e.body.secret) })).status).toBe(204);
    expect((await other.get('/api/auth/v1/me')).status).toBe(401);
    expect(a.deps.jobs.added.some((j) => j.name === 'email.send' && (j.data as { template: string }).template === 'mfa_changed')).toBe(true);
  });

  it('needs a current code to turn it off and leaves the calling session without assurance', async () => {
    const a = makeApi(t.clients);
    const x = await tenant(a);
    const secret = await enroll(x.admin);
    expect((await x.admin.delete('/api/auth/v1/mfa/totp')).status).toBe(400);
    expect((await x.admin.delete('/api/auth/v1/mfa/totp', { code: '000000' })).status).toBe(401);
    expect((await x.admin.delete('/api/auth/v1/mfa/totp', { code: currentTotp(secret) })).status).toBe(204);
    const me = await x.admin.get('/api/auth/v1/me');
    expect(me.body.user.mfaEnrolled).toBe(false);
    const s = await t.clients.platform().selectFrom('user_sessions').select('mfa_verified_at').where('user_id', '=', x.userId).where('revoked_at', 'is', null).execute();
    expect(s.every((r) => r.mfa_verified_at === null)).toBe(true);
  });

  it('refuses removal while a tenant needs two factors, and ignores assurance from before the current enrolment', async () => {
    const a = makeApi(t.clients);
    const x = await tenant(a, 'multisite');
    const secret = await enroll(x.admin);
    expect((await x.admin.post('/api/admin/v1/venues', { name: 'Second venue' })).status).toBe(201);
    const r = await x.admin.delete('/api/auth/v1/mfa/totp', { code: currentTotp(secret) });
    expect(r.status).toBe(403);
    expect((await x.admin.get('/api/admin/v1/venues')).status).toBe(200);
    // Assurance proved before the authenticator now enrolled (e.g. replaced elsewhere) no longer counts.
    await t.clients.platform().updateTable('users').set({ mfa_enrolled_at: new Date(Date.now() + 60_000) }).where('id', '=', x.userId).execute();
    const blocked = await x.admin.get('/api/admin/v1/venues');
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('MFA_REQUIRED');
  });
});

describe('H-6, M-23 support access ends with the agent’s authority and on leaving', () => {
  for (const change of ['disabled', 'mfa reset', 'role removed'] as const) {
    it(`rejects existing support cookies and pending handoffs once the agent is ${change}`, async () => {
      const x = await tenant();
      const agent = await platformUser('support');
      const admin = await platformUser('super_admin');
      const { b, sessionId } = await supportBrowser(x, agent);
      expect((await b.get('/api/admin/v1/venues')).status).toBe(200);
      const pending = new URL((await svc.enterSupport(api.deps, agent.actor, sessionId)).url).searchParams.get('code')!;
      if (change === 'disabled') await svc.updatePlatformUser(api.deps, admin.actor, agent.id, { status: 'disabled' });
      if (change === 'mfa reset') await svc.resetPlatformMfa(api.deps, admin.actor, agent.id);
      if (change === 'role removed') await svc.updatePlatformUser(api.deps, admin.actor, agent.id, { role: 'finance' });
      expect((await b.get('/api/admin/v1/venues')).status).toBe(401);
      expect((await b.get('/api/auth/v1/me')).status).toBe(401);
      expect((await client(api.app, x.host).post('/api/auth/v1/support/exchange', { code: pending })).status).toBe(401);
      const s = await t.clients.platform().selectFrom('support_sessions').select('status').where('id', '=', sessionId).executeTakeFirstOrThrow();
      expect(s.status).toBe('ended');
    });
  }

  it('leaving support mode ends the session on the server; a kept cookie no longer works', async () => {
    const x = await tenant();
    const agent = await platformUser('support');
    const { b, sessionId } = await supportBrowser(x, agent);
    const kept = new Map(b.jar);
    expect((await b.post('/api/auth/v1/support/leave')).status).toBe(204);
    expect(b.jar.size).toBe(0);
    expect((await b.get('/api/auth/v1/me')).status).toBe(401);
    for (const [k, v] of kept) b.jar.set(k, v); // a copy of the cookie taken before leaving
    expect((await b.get('/api/admin/v1/venues')).status).toBe(401);
    expect((await t.clients.platform().selectFrom('support_sessions').select('status').where('id', '=', sessionId).executeTakeFirstOrThrow()).status).toBe('ended');
  });

  it('ordinary sign-out drops this browser’s support credential but leaves the session to the agent', async () => {
    const x = await tenant();
    const agent = await platformUser('support');
    const { b, sessionId } = await supportBrowser(x, agent);
    const kept = new Map(b.jar);
    expect((await b.post('/api/auth/v1/sign-out')).status).toBe(204);
    for (const [k, v] of kept) b.jar.set(k, v);
    expect((await b.get('/api/auth/v1/me')).status).toBe(401);
    expect((await t.clients.platform().selectFrom('support_sessions').select('status').where('id', '=', sessionId).executeTakeFirstOrThrow()).status).toBe('active');
  });

  it('a support session never obtains the staff link, PIN or display pairing (M-13)', async () => {
    const x = await tenant();
    const { b } = await supportBrowser(x, await platformUser('support'));
    expect((await b.get(`/api/admin/v1/venues/${x.venueId}/staff-access`)).status).toBe(403);
    expect((await b.put(`/api/admin/v1/venues/${x.venueId}/staff-access/pin`, { pin: '4821' })).status).toBe(403);
    expect((await b.post(`/api/admin/v1/venues/${x.venueId}/staff-access/rotate-link`)).status).toBe(403);
    expect((await b.get(`/api/admin/v1/venues/${x.venueId}/devices`)).status).toBe(200);
    expect((await b.post('/api/admin/v1/venues', { name: 'More' })).status).toBe(403); // M-9
  });
});

describe('M-9, L-10 billing-affecting changes are the owner’s', () => {
  it('a manager cannot create venues, edit billing details or delete ratings', async () => {
    const x = await tenant();
    await svc.inviteMember(api.deps, x.owner, x.tenantId, `mgr-${x.slug}@x.test`, 'manager');
    const token = lastLink(api, 'invitation_manager').searchParams.get('token')!;
    const mgr = client(api.app, x.host);
    expect((await mgr.post(`/api/auth/v1/invitations/${token}/accept`, { name: 'Mgr', password: PASSWORD })).body.ok).toBe(true);
    mgr.setCsrf((await mgr.get('/api/auth/v1/me')).body.csrfToken);
    expect((await mgr.post('/api/admin/v1/venues', { name: 'Second' })).status).toBe(403);
    expect((await mgr.patch('/api/admin/v1/tenant', { billingEmail: 'evil@x.test' })).status).toBe(403);
    expect((await mgr.patch('/api/admin/v1/tenant', { name: 'Renamed Cafe' })).status).toBe(204);
    expect((await mgr.delete(`/api/admin/v1/ratings/${uuidv7()}`)).status).toBe(403);
  });
});

describe('L-8 sign-out needs the CSRF token', () => {
  it('refuses a cross-site sign-out', async () => {
    const x = await tenant();
    x.admin.setCsrf('');
    expect((await x.admin.post('/api/auth/v1/sign-out')).status).toBe(403);
    x.admin.setCsrf((await x.admin.get('/api/auth/v1/me')).body.csrfToken);
    expect((await x.admin.post('/api/auth/v1/sign-out')).status).toBe(204);
  });
});

describe('L-2 single-use links under concurrency', () => {
  it('hands off once when the same code arrives twice at the same moment', async () => {
    const x = await tenant();
    const www = await signIn(api, 'www.dop.test', x.email);
    const h = await www.post('/api/auth/v1/handoff', { tenantSlug: x.slug });
    const [r1, r2] = await Promise.all([client(api.app, x.host).post('/api/auth/v1/handoff/exchange', { code: h.body.code }), client(api.app, x.host).post('/api/auth/v1/handoff/exchange', { code: h.body.code })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 401]);
  });
});

describe('M-17, M-1 Google sign-in', () => {
  afterEach(() => setGoogleProvider(null));
  const stub = (email: string, sub: string) =>
    setGoogleProvider({
      authorizationUrl: async ({ state }) => `https://stub-provider.test/authorize?state=${encodeURIComponent(state)}`,
      callback: async () => ({ sub, email, emailVerified: true, name: 'Google User' }),
    });
  const begin = async (b: ReturnType<typeof client>) => new URL((await b.get('/api/auth/v1/oauth/google/start')).headers.location as string).searchParams.get('state')!;

  it('finishes only in the browser that started it, once', async () => {
    stub(`g-${n}@x.test`, `sub-bind-${n}`);
    const victim = client(api.app, 'www.dop.test');
    const attacker = client(api.app, 'www.dop.test');
    const stolen = await begin(attacker);
    expect((await victim.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${stolen}`)).status).toBe(401);
    const own = await begin(victim);
    const ok = await victim.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${own}`);
    expect(ok.headers.location).toBe('/sign-in?chooser=1');
    expect((await victim.get('/api/auth/v1/me')).status).toBe(200);
    expect((await victim.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${own}`)).status).toBe(401);
  });

  it('a tenant-host start passes through www so the binding cookie lands where the callback arrives', async () => {
    const x = await tenant();
    stub(`g2-${n}@x.test`, `sub-host-${n}`);
    const r = await client(api.app, x.host).get('/api/auth/v1/oauth/google/start');
    expect(r.headers.location).toBe(`https://www.dop.test/api/auth/v1/oauth/google/start?from=${encodeURIComponent(x.host)}`);
  });

  it('never silently joins a Google identity to an account someone registered first with a password', async () => {
    n++;
    const email = `victim-${n}@x.test`;
    // The attacker registers the victim's address with their own password; the address is never verified.
    await svc.createTenantWithOwner(api.deps, { ownerName: 'Attacker', email, password: 'attacker-chosen-pass-1', restaurantName: `Trap ${n}`, slug: `trap-${n}`, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
    stub(email, `sub-victim-${n}`);
    const victim = client(api.app, 'www.dop.test');
    const cb = await victim.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${await begin(victim)}`);
    const link = /#link=(.+)$/.exec(cb.headers.location as string)![1]!;
    expect((await victim.get('/api/auth/v1/me')).status).toBe(401);
    expect((await t.clients.platform().selectFrom('user_identities').select('id').where('subject', '=', `sub-victim-${n}`).execute()).length).toBe(0);
    // The victim does not know the attacker's password, so cannot link; the reset link (their mailbox) takes over.
    expect((await victim.post('/api/auth/v1/oauth/google/link', { linkToken: decodeURIComponent(link), password: PASSWORD })).status).toBe(401);
    await svc.forgotPassword(api.deps, email);
    await svc.resetPassword(api.deps, lastLink(api, 'password_reset').searchParams.get('token')!, PASSWORD);
    const linked = await victim.post('/api/auth/v1/oauth/google/link', { linkToken: decodeURIComponent(link), password: PASSWORD });
    expect(linked.body.ok).toBe(true);
    // The attacker's password no longer works anywhere.
    expect((await client(api.app, 'www.dop.test').post('/api/auth/v1/sign-in', { email, password: 'attacker-chosen-pass-1' })).status).toBe(401);
  });
});

describe('M-18 console IP allow-list', () => {
  // The app sits behind a proxy at loopback (as Caddy), so X-Forwarded-For carries the evaluated address.
  const viaProxy = () => createApp(api.deps, { trustProxy: parseIpRules(['loopback']), logRequests: false });
  afterAll(async () => {
    await t.clients.platform().deleteFrom('platform_settings').where('setting_key', '=', 'console.ipAllowList').execute();
    svc.clearSettingCache();
  });

  it('validates entries, refuses a list that locks out its author, and then enforces it for every console request', async () => {
    const app = viaProxy();
    const admin = await platformUser('super_admin');
    const request = (await import('supertest')).default;
    const send = (ip: string, cookie = '', csrf = '') => (r: Test) => r.set('Host', 'admin.dop.test').set('X-Forwarded-For', ip).set('Cookie', cookie).set('X-CSRF-Token', csrf);
    const signin = await send('203.0.113.5')(request(app).post('/api/auth/v1/sign-in').send({ email: admin.email, password: PASSWORD }));
    const mfa = await send('203.0.113.5')(request(app).post('/api/auth/v1/sign-in/mfa').send({ mfaToken: signin.body.mfaToken, code: currentTotp(admin.secret) }));
    const cookie = ([] as string[]).concat(mfa.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
    const csrf = (await send('203.0.113.5', cookie)(request(app).get('/api/auth/v1/me'))).body.csrfToken as string;
    const put = (ip: string, value: unknown) => send(ip, cookie, csrf)(request(app).put('/api/console/v1/settings/console.ipAllowList').send({ value }));
    expect((await put('203.0.113.5', ['not-an-ip'])).status).toBe(400);
    expect((await put('203.0.113.5', ['198.51.100.0/24'])).status).toBe(400); // would lock the author out
    expect((await put('203.0.113.5', ['203.0.113.0/24', '2001:db8::/32'])).status).toBe(204);
    expect((await send('203.0.113.77', cookie)(request(app).get('/api/auth/v1/me'))).status).toBe(200);
    expect((await send('2001:db8::5', cookie)(request(app).get('/api/auth/v1/me'))).status).toBe(200);
    // Outside the list: the existing session and a new sign-in are both refused.
    expect((await send('198.51.100.9', cookie)(request(app).get('/api/auth/v1/me'))).status).toBe(403);
    expect((await send('198.51.100.9')(request(app).post('/api/auth/v1/sign-in').send({ email: admin.email, password: PASSWORD }))).status).toBe(403);
    // Without a trusted proxy the header is ignored: the evaluated address is the real peer (loopback here).
    expect((await send('203.0.113.5', cookie)(request(api.app).get('/api/auth/v1/me'))).status).toBe(403);
    // The operator's recovery switch.
    const recovery = createApp(api.deps, { trustProxy: false, logRequests: false, consoleIpPolicy: 'off' });
    expect((await send('198.51.100.9', cookie)(request(recovery).get('/api/auth/v1/me'))).status).toBe(200);
  });
});

describe('L-6 privilege grants need a recent second factor', () => {
  it('refuses to invite a platform user on a session whose MFA check is stale', async () => {
    const admin = await platformUser('super_admin');
    const c = await signIn(api, 'admin.dop.test', admin.email, () => currentTotp(admin.secret));
    await t.clients.platform().updateTable('platform_sessions').set({ mfa_verified_at: new Date(Date.now() - 20 * 60_000) }).where('platform_user_id', '=', admin.id).execute();
    const r = await c.post('/api/console/v1/platform-users', { email: `new-${admin.id.slice(-6)}@x.test`, name: 'New', role: 'super_admin' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('MFA_REQUIRED');
    expect((await c.post('/api/auth/v1/mfa/refresh', { code: currentTotp(admin.secret, 1) })).status).toBe(204);
    expect((await c.post('/api/console/v1/platform-users', { email: `new-${admin.id.slice(-6)}@x.test`, name: 'New', role: 'support' })).status).toBe(201);
  });

  it('revokes the console session that uses up the fresh-MFA code budget (M-2)', async () => {
    const a = makeApi(t.clients);
    const admin = await platformUser('super_admin');
    const c = await signIn(a, 'admin.dop.test', admin.email, () => currentTotp(admin.secret));
    for (let i = 0; i < 10; i++) await c.post('/api/auth/v1/mfa/refresh', { code: '000000' });
    expect((await c.get('/api/auth/v1/me')).status).toBe(401);
  });
});

describe('L-7 display sessions expire on the server', () => {
  it('stops a display token a year after it was last seen', async () => {
    const x = await tenant();
    const token = newSecretToken();
    const id = uuidv7();
    await t.clients.platform().insertInto('displays').values({ id, tenant_id: x.tenantId, venue_id: x.venueId, name: 'TV', settings: '{}', session_hash: tokenHash(api.deps.config.pepper, token), paired_at: new Date(Date.now() - 400 * 86_400_000), last_seen_at: new Date(Date.now() - 10 * 86_400_000) }).execute();
    expect(await svc.resolveDisplay(api.deps, token)).not.toBeNull();
    await t.clients.platform().updateTable('displays').set({ last_seen_at: new Date(Date.now() - 366 * 86_400_000) }).where('id', '=', id).execute();
    expect(await svc.resolveDisplay(api.deps, token)).toBeNull();
  });
});

describe('M-3 request logs carry no URL secrets', () => {
  it('masks manifest, invitation and OAuth callback values in captured logs', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const app = createApp({ ...api.deps, log: pino({ level: 'info' }, sink) }, { trustProxy: false, logRequests: true });
    const x = await tenant();
    const { ticket } = await svc.createTicket(api.deps, { kind: 'staff_device', deviceId: 'd', tenantId: x.tenantId, venueId: x.venueId, deviceName: 'iPad' }, x.venueId, {});
    await svc.inviteMember(api.deps, x.owner, x.tenantId, `log-${x.slug}@x.test`, 'manager');
    const invite = lastLink(api, 'invitation_manager').searchParams.get('token')!;
    const marker = 'SECRET0CODE0MARKER0123456789';
    const request = (await import('supertest')).default;
    expect((await request(app).get(`/m/${ticket.token}.webmanifest`).set('Host', 't.dop.test')).status).toBe(200);
    expect((await request(app).get(`/api/auth/v1/invitations/${invite}`).set('Host', x.host)).status).toBe(200);
    await request(app).get(`/api/auth/v1/oauth/google/callback?code=${marker}&state=${marker}`).set('Host', 'www.dop.test');
    const text = lines.join('');
    expect(text).toContain('/api/auth/v1/invitations/');
    for (const secret of [ticket.token, invite, marker]) expect(text).not.toContain(secret);
  });
});

describe('Billing writes (no payment processor)', () => {
  it('lets only the super admin record payments, and never for a deleted tenant', async () => {
    const pa = (role: 'super_admin' | 'support' | 'finance') => ({ kind: 'platform' as const, platformUserId: uuidv7(), role, sessionId: 's', mfaVerifiedAt: new Date() });
    expect(can(pa('super_admin'), 'console.commercial')).toBe(true);
    expect(can(pa('finance'), 'console.commercial')).toBe(false);
    expect(can(pa('support'), 'console.commercial')).toBe(false);
    const x = await tenant();
    await svc.markDeleted(api.deps, x.tenantId, { kind: 'system' });
    await expect(svc.recordPayment(api.deps, pa('super_admin'), x.tenantId, { amountMinor: 100, currency: 'USD', months: 1, method: 'cash' })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await t.clients.platform().selectFrom('tenant_payments').select('id').where('tenant_id', '=', x.tenantId).execute()).toEqual([]);
  });

  it('has no Stripe webhook endpoint', async () => {
    const raw = JSON.stringify({ id: 'evt_off', type: 'invoice.paid', data: { object: {} } });
    const r = await (await import('supertest')).default(api.app).post('/webhooks/stripe').set('Host', 'api.dop.test').set('Content-Type', 'application/json').send(raw);
    expect(r.status).toBe(404);
  });
});
