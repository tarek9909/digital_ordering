import { currentTotp, encrypt, hashSecret, newTotpSecret } from '@dop/auth';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { uuidv7 } from '@dop/domain';
import * as svc from '@dop/services';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, makeApi } from './helpers.js';

// HTTP regressions for the 2026-10-22 completeness repairs AS04/AS05 (exact legal acceptance), AS08 (rating
// distribution) and AS10 (plan options for every console role that lists tenants). They assert repaired behaviour.

let t: TestDatabase;
let api: ReturnType<typeof makeApi>;
const PASSWORD = 'a-long-unique-passphrase';
let n = 0;

beforeAll(async () => {
  t = await startTestDatabase();
  api = makeApi(t.clients);
});
afterAll(async () => {
  await t?.stop();
});

async function signIn(host: string, email: string, code?: () => string) {
  const c = client(api.app, host);
  const r = await c.post('/api/auth/v1/sign-in', { email, password: PASSWORD });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  if (r.body.mfaRequired) expect((await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: r.body.mfaToken, code: code!() })).body.ok).toBe(true);
  const me = await c.get('/api/auth/v1/me');
  c.setCsrf(me.body.csrfToken);
  return c;
}

async function owner() {
  n++;
  const slug = `cmp-${n}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@x.test`;
  const x = await svc.createTenantWithOwner(api.deps, { ownerName: 'Owner', email, password: PASSWORD, restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', x.userId).execute();
  return { ...x, admin: await signIn(`${slug}.dop.test`, email) };
}

async function platformUser(role: 'super_admin' | 'support' | 'finance') {
  const id = uuidv7();
  const secret = newTotpSecret();
  const email = `pc-${id.slice(-8)}@x.test`;
  await t.clients
    .platform()
    .insertInto('platform_users')
    .values({ id, email, name: 'Agent', role, status: 'active', password_hash: await hashSecret(PASSWORD), totp_secret_enc: await encrypt(api.deps.keys, secret), mfa_enrolled_at: new Date() })
    .execute();
  return { id, email, secret, actor: { kind: 'platform' as const, platformUserId: id, role, sessionId: 's', mfaVerifiedAt: new Date() } };
}

describe('AS10 plan filter options', () => {
  it('every console role that lists tenants reads plan codes, including custom plans; prices stay restricted', async () => {
    const admin = await platformUser('super_admin');
    const c = await signIn('admin.dop.test', admin.email, () => currentTotp(admin.secret));
    const created = await c.post('/api/console/v1/plans', { code: 'enterprise', name: 'Enterprise', isPublic: false, limits: { maxVenues: 50, maxCountersPerVenue: 10, maxDisplaysPerVenue: 20, maxStaffDevicesPerVenue: 50, trialTicketsPerDay: 200 }, features: [], sortOrder: 90 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    for (const role of ['support', 'finance', 'super_admin'] as const) {
      const u = await platformUser(role);
      const b = await signIn('admin.dop.test', u.email, () => currentTotp(u.secret));
      const r = await b.get('/api/console/v1/plan-options');
      expect(r.status, role).toBe(200);
      expect(r.body.items.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['trial', 'standard', 'pro', 'multisite', 'enterprise']));
      expect(r.body.items[0]).not.toHaveProperty('prices');
      if (role !== 'super_admin') expect((await b.get('/api/console/v1/plans')).status, role).toBe(403);
    }
  });
});

describe('AS04/AS05 legal gate over HTTP', () => {
  it('serves the exact pending versions with content and records only that set', async () => {
    const x = await owner();
    const p = (await platformUser('super_admin')).actor;
    const make = async (kind: 'terms' | 'privacy' | 'dpa', version: string, locale: string, html: string) => {
      const { id } = await svc.createLegalDocument(api.deps, api.deps.storage, p, { kind, version, locale, html });
      await svc.publishLegalDocument(api.deps, p, id);
      return id;
    };
    const terms = await make('terms', 'http-en-1', 'en', '<p>Terms EN</p>');
    api.deps.clock.advance(1000);
    const arTerms = await make('terms', 'http-ar-2', 'ar', '<p>Terms AR</p>');
    api.deps.clock.advance(1000);
    const privacy = await make('privacy', 'http-p-1', 'en', '<p>Privacy EN</p>');
    api.deps.clock.advance(1000);
    const dpa = await make('dpa', 'http-d-1', 'en', '<p>DPA EN</p>');

    const pending = await x.admin.get('/api/admin/v1/legal/pending?locale=en');
    expect(pending.status).toBe(200);
    expect(pending.body.items.map((d: { id: string; kind: string; html: string }) => [d.kind, d.id, d.html])).toEqual([
      ['terms', terms, '<p>Terms EN</p>'],
      ['privacy', privacy, '<p>Privacy EN</p>'],
      ['dpa', dpa, '<p>DPA EN</p>'],
    ]);
    // The gate's link for one exact version.
    const exact = await client(api.app, `www.dop.test`).get(`/api/public/v1/legal/terms?locale=ar&document=${terms}`);
    expect(exact.body).toMatchObject({ id: terms, version: 'http-en-1', locale: 'en', html: '<p>Terms EN</p>' });

    const wrong = await x.admin.post('/api/admin/v1/legal/accept', { documentIds: [arTerms, privacy, dpa], locale: 'en' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors).toEqual([{ path: 'documentIds', message: 'stale' }]);
    const ok = await x.admin.post('/api/admin/v1/legal/accept', { documentIds: [terms, privacy, dpa], locale: 'en' });
    expect(ok.status).toBeLessThan(300);
    expect((await x.admin.get('/api/admin/v1/legal/pending?locale=en')).body.items).toEqual([]);
    const recorded = await t.clients.platform().selectFrom('legal_acceptances').select('document_id').where('tenant_id', '=', x.tenantId).execute();
    expect(recorded.map((r) => r.document_id).sort()).toEqual([terms, privacy, dpa].sort());
  });
});

describe('AS08 rating distribution', () => {
  it('returns the distribution with the ratings list', async () => {
    const x = await owner();
    const r = await x.admin.get(`/api/admin/v1/ratings?venueId=${x.venueId}`);
    expect(r.status).toBe(200);
    expect(r.body.summary).toEqual({ count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
  });
});
