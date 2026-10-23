import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import * as svc from '@dop/services';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setGoogleProvider } from '../src/routes/auth-r11.js';
import { client, makeApi } from './helpers.js';

// Regression tests for the 2026-10-22 completeness repairs AS02, AS03 and the AS01 server shape
// (docs/audits/2026-10-22-completeness/REMEDIATION.md). They assert the repaired behaviour.

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

async function owner() {
  n++;
  const slug = `cmp-${n}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@x.test`;
  const r = await svc.createTenantWithOwner(api.deps, { ownerName: 'Owner', email, password: PASSWORD, restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  return { ...r, email, slug };
}

describe('AS03 a rejected reset password keeps the link usable', () => {
  it('corrects a breached password with the same link, then the link is spent', async () => {
    const x = await owner();
    await svc.forgotPassword(api.deps, x.email);
    const job = api.deps.jobs.added.filter((j) => j.name === 'email.send' && (j.data as { template: string }).template === 'password_reset').at(-1)!;
    const token = new URL((await svc.openEmailData(api.deps.keys, (job.data as { data: Record<string, unknown> }).data)).link as string).searchParams.get('token')!;
    const www = client(api.app, 'www.dop.test');
    const weak = await www.post('/api/auth/v1/password/reset', { token, password: 'password123' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('VALIDATION_FAILED');
    expect((await www.post('/api/auth/v1/password/reset', { token, password: 'a-new-unique-passphrase-2' })).status).toBe(204);
    expect((await www.post('/api/auth/v1/password/reset', { token, password: 'a-third-unique-passphrase' })).status).toBe(410);
    expect((await client(api.app, `${x.slug}.dop.test`).post('/api/auth/v1/sign-in', { email: x.email, password: 'a-new-unique-passphrase-2' })).status).toBe(200);
  });

  it('spends the link once under concurrent valid resets', async () => {
    const x = await owner();
    await svc.forgotPassword(api.deps, x.email);
    const job = api.deps.jobs.added.filter((j) => j.name === 'email.send' && (j.data as { template: string }).template === 'password_reset').at(-1)!;
    const token = new URL((await svc.openEmailData(api.deps.keys, (job.data as { data: Record<string, unknown> }).data)).link as string).searchParams.get('token')!;
    const www = client(api.app, 'www.dop.test');
    const [a, b] = await Promise.all([www.post('/api/auth/v1/password/reset', { token, password: 'a-new-unique-passphrase-3' }), www.post('/api/auth/v1/password/reset', { token, password: 'a-new-unique-passphrase-4' })]);
    expect([a.status, b.status].sort()).toEqual([204, 410]);
  });
});

describe('AS02 Google sign-in without a Tanbeeh account', () => {
  afterEach(() => setGoogleProvider(null));
  it('creates no account or session for an unknown Google address and says so', async () => {
    n++;
    const email = `unknown-${n}@x.test`;
    setGoogleProvider({
      authorizationUrl: async ({ state }) => `https://stub-provider.test/authorize?state=${encodeURIComponent(state)}`,
      callback: async () => ({ sub: `sub-unknown-${n}`, email, emailVerified: true, name: 'Someone' }),
    });
    const www = client(api.app, 'www.dop.test');
    const state = new URL((await www.get('/api/auth/v1/oauth/google/start')).headers.location as string).searchParams.get('state');
    const cb = await www.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${state}`);
    expect(cb.headers.location).toBe('/sign-in?google=no-account');
    expect((await www.get('/api/auth/v1/me')).status).toBe(401);
    expect(await t.clients.platform().selectFrom('users').select('id').where('email', '=', email).execute()).toEqual([]);
    expect(await t.clients.platform().selectFrom('user_identities').select('id').where('subject', '=', `sub-unknown-${n}`).execute()).toEqual([]);
  });

  it('signs an invited owner in with Google once the account is linked', async () => {
    const x = await owner();
    setGoogleProvider({
      authorizationUrl: async ({ state }) => `https://stub-provider.test/authorize?state=${encodeURIComponent(state)}`,
      callback: async () => ({ sub: `sub-owner-${n}`, email: x.email, emailVerified: true, name: 'Owner' }),
    });
    const www = client(api.app, 'www.dop.test');
    const state = new URL((await www.get('/api/auth/v1/oauth/google/start')).headers.location as string).searchParams.get('state');
    const link = /#link=(.+)$/.exec((await www.get(`/api/auth/v1/oauth/google/callback?code=stub&state=${state}`)).headers.location as string)![1]!;
    expect((await www.post('/api/auth/v1/oauth/google/link', { linkToken: decodeURIComponent(link), password: PASSWORD })).body.ok).toBe(true);
    const tenants = await www.get('/api/auth/v1/tenants');
    expect(tenants.body.tenants.map((m: { slug: string }) => m.slug)).toEqual([x.slug]);
  });
});

describe('BW02 a repeated free-months submit grants once', () => {
  it('extends the trial once for the same request id, again for a new one', async () => {
    const x = await owner();
    const admin = { kind: 'platform' as const, platformUserId: '00000000-0000-7000-8000-000000000001', role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };
    const trialEnd = async () => (await t.clients.platform().selectFrom('tenants').select('trial_ends_at').where('id', '=', x.tenantId).executeTakeFirstOrThrow()).trial_ends_at!.getTime();
    const before = await trialEnd();
    const requestId = '0193f000-0000-7000-8000-0000000000aa';
    await Promise.all([svc.grantFreeMonths(api.deps, admin, x.tenantId, 1, requestId), svc.grantFreeMonths(api.deps, admin, x.tenantId, 1, requestId)]);
    const once = await trialEnd();
    expect(once).toBeGreaterThan(before);
    await svc.grantFreeMonths(api.deps, admin, x.tenantId, 1, requestId);
    expect(await trialEnd()).toBe(once);
    await svc.grantFreeMonths(api.deps, admin, x.tenantId, 1, '0193f000-0000-7000-8000-0000000000ab');
    expect(await trialEnd()).toBeGreaterThan(once);
  });
});
