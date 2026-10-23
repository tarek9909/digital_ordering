import { currentTotp, encrypt, hashSecret, newTotpSecret } from '@dop/auth';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { uuidv7 } from '@dop/domain';
import * as svc from '@dop/services';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearTenantCache } from '../src/http/middleware.js';
import { client, makeApi } from './helpers.js';

// Regression tests for the 2026-10-23 security review: tenant-status gates on the staff and integration APIs, fresh
// MFA on commercial console actions, the password re-entry budget, the handoff sign-in time, the display pairing
// budget, sealed email links and generic webhook errors.

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

async function tenant(plan?: 'pro') {
  n++;
  const slug = `s23-${n}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@x.test`;
  const x = await svc.createTenantWithOwner(api.deps, { ownerName: 'Owner', email, password: PASSWORD, restaurantName: `Cafe ${n}`, slug, country: 'SA', locale: 'en' }, { ip: '1.1.1.1' });
  const pdb = t.clients.platform();
  await pdb.updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', x.userId).execute();
  if (plan) {
    const p = await pdb.selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow();
    await pdb.updateTable('tenants').set({ status: 'active', complimentary: true, plan_id: p.id }).where('id', '=', x.tenantId).execute();
    await api.deps.kv.del(`t:${x.tenantId}:flags`);
  }
  const host = `${slug}.dop.test`;
  const admin = client(api.app, host);
  expect((await admin.post('/api/auth/v1/sign-in', { email, password: PASSWORD })).status).toBe(200);
  admin.setCsrf((await admin.get('/api/auth/v1/me')).body.csrfToken);
  const owner = { kind: 'user' as const, userId: x.userId, tenantId: x.tenantId, role: 'owner' as const, sessionId: 's', mfaVerified: true };
  return { ...x, slug, email, host, admin, owner };
}

/** Sets a tenant status directly and drops the caches that hold it. */
async function setStatus(tenantId: string, status: 'trial_expired' | 'cancelled' | 'suspended' | 'active') {
  await t.clients.platform().updateTable('tenants').set({ status }).where('id', '=', tenantId).execute();
  await api.deps.kv.del(`t:${tenantId}:status`);
  clearTenantCache();
}

describe('staff access off closes the staff API reads too', () => {
  it('serves the board while staff access is on and refuses it after the trial expired', async () => {
    const x = await tenant();
    expect((await x.admin.get(`/api/staff/v1/board?venueId=${x.venueId}`)).status).toBe(200);
    await setStatus(x.tenantId, 'trial_expired');
    const r = await x.admin.get(`/api/staff/v1/board?venueId=${x.venueId}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('TENANT_INACTIVE');
    expect((await x.admin.get(`/api/staff/v1/tickets/search?venueId=${x.venueId}&q=1`)).body.code).toBe('TENANT_INACTIVE');
  });
});

describe('integration API access follows the tenant status for reads', () => {
  it('is read-only while suspended and closed after cancellation', async () => {
    const x = await tenant('pro');
    const key = await svc.createApiKey(api.deps, x.owner, x.tenantId, x.venueId, 'POS');
    const get = () => request(api.app).get('/v1/tickets').set('Host', 'api.dop.test').set('Authorization', `Bearer ${key.key}`);
    const post = () => request(api.app).post('/v1/tickets').set('Host', 'api.dop.test').set('Authorization', `Bearer ${key.key}`).send({ externalRef: `r-${n}` });
    expect((await get()).status).toBe(200);
    await setStatus(x.tenantId, 'suspended');
    expect((await get()).status).toBe(200);
    expect((await post()).body.code).toBe('TENANT_SUSPENDED');
    await setStatus(x.tenantId, 'cancelled');
    const r = await get();
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('TENANT_INACTIVE');
  });
});

describe('commercial console actions need a recent second factor', () => {
  it('refuses complimentary access, trial extension, plan change and email texts on a stale check', async () => {
    const id = uuidv7();
    const secret = newTotpSecret();
    const email = `p-${id.slice(-8)}@x.test`;
    await t.clients
      .platform()
      .insertInto('platform_users')
      .values({ id, email, name: 'Agent', role: 'super_admin', status: 'active', password_hash: await hashSecret(PASSWORD), totp_secret_enc: await encrypt(api.deps.keys, secret), mfa_enrolled_at: new Date() })
      .execute();
    const c = client(api.app, 'admin.dop.test');
    const s = await c.post('/api/auth/v1/sign-in', { email, password: PASSWORD });
    expect((await c.post('/api/auth/v1/sign-in/mfa', { mfaToken: s.body.mfaToken, code: currentTotp(secret) })).body.ok).toBe(true);
    c.setCsrf((await c.get('/api/auth/v1/me')).body.csrfToken);
    await t.clients.platform().updateTable('platform_sessions').set({ mfa_verified_at: new Date(Date.now() - 20 * 60_000) }).where('platform_user_id', '=', id).execute();
    const x = await tenant();
    for (const [path, body] of [
      [`/api/console/v1/tenants/${x.tenantId}/complimentary`, { enabled: true }],
      [`/api/console/v1/tenants/${x.tenantId}/extend-trial`, { days: 30 }],
      [`/api/console/v1/tenants/${x.tenantId}/plan`, { planCode: 'pro' }],
    ] as const) {
      const r = await c.post(path, body);
      expect(r.body.code, path).toBe('MFA_REQUIRED');
    }
    expect((await c.put('/api/console/v1/email-templates/password_reset/en', { subject: 'Reset', blocks: ['Click {{link}}'] })).body.code).toBe('MFA_REQUIRED');
    const row = await t.clients.platform().selectFrom('tenants').select(['complimentary']).where('id', '=', x.tenantId).executeTakeFirstOrThrow();
    expect(row.complimentary).toBe(false);
  });
});

describe('password re-entry has an attempt budget', () => {
  it('locks password checks after 10 wrong tries, the right password included', async () => {
    const x = await tenant();
    for (let i = 0; i < 10; i++) await expect(svc.verifyUserPassword(api.deps, x.userId, 'wrong-password-guess')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(svc.verifyUserPassword(api.deps, x.userId, PASSWORD)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('answers an owner deleting their account the same way whatever the password', async () => {
    const x = await tenant();
    const wrong = await x.admin.delete('/api/auth/v1/me', { password: 'wrong-password-guess' });
    const right = await x.admin.delete('/api/auth/v1/me', { password: PASSWORD });
    expect([wrong.status, wrong.body.code]).toEqual([403, 'FORBIDDEN']);
    expect([right.status, right.body.code]).toEqual([403, 'FORBIDDEN']);
  });
});

describe('a handoff keeps the time of the www sign-in', () => {
  async function tenantSession(signedInAgoMs: number) {
    const x = await tenant();
    await t.clients.platform().updateTable('users').set({ password_hash: null }).where('id', '=', x.userId).execute(); // Google-only
    const ua = 'test-browser';
    const www = await svc.createUserSession(api.deps, x.userId, null, { ip: '1.1.1.1', userAgent: ua, host: 'www.dop.test' }, false, new Date(Date.now() - signedInAgoMs));
    if (www.kind !== 'session') throw new Error('no session');
    const { code } = await svc.createHandoff(api.deps, x.userId, x.slug, ua, null, www.sessionId);
    const s = await svc.exchangeHandoff(api.deps, code, { ip: '1.1.1.1', userAgent: ua, host: x.host }, x.tenantId);
    if (s.kind !== 'session') throw new Error('no session');
    const c = client(api.app, x.host);
    c.jar.set('dop_sid', s.token);
    c.setCsrf((await c.get('/api/auth/v1/me')).body.csrfToken);
    return c;
  }

  it('refuses two-factor enrolment on a fresh tenant session from an old Google sign-in', async () => {
    const c = await tenantSession(60 * 60_000);
    const r = await c.post('/api/auth/v1/mfa/totp/enroll', {});
    expect(r.status).toBe(403);
  });

  it('allows it right after the Google sign-in', async () => {
    const c = await tenantSession(60_000);
    expect((await c.post('/api/auth/v1/mfa/totp/enroll', {})).status).toBe(200);
  });
});

describe('display pairing has a budget per tenant host', () => {
  it('refuses pairing once the host has used up its wrong codes, whatever the address', async () => {
    const x = await tenant();
    const tv = client(api.app, x.host);
    expect((await tv.post('/api/display/v1/pair', { code: '000000' })).body.code).toBe('PAIRING_CODE_INVALID');
    expect(Number(await api.deps.kv.get(`pairfail:${x.host}`))).toBe(1);
    await api.deps.kv.set(`pairfail:${x.host}`, '50', 600);
    expect((await tv.post('/api/display/v1/pair', { code: '000001' })).status).toBe(429);
  });
});

describe('emailed links are stored sealed', () => {
  it('keeps the reset token out of the outbox and the queue, and the worker can open it', async () => {
    const x = await tenant();
    await svc.forgotPassword(api.deps, x.email);
    const job = api.deps.jobs.added.filter((j) => j.name === 'email.send' && (j.data as { template: string }).template === 'password_reset').at(-1)!;
    expect(JSON.stringify(job.data)).not.toContain('token=');
    const rows = await t.clients.platform().selectFrom('outbox').select('payload').execute();
    expect(rows.some((r) => JSON.stringify(r.payload).includes('reset-password?token='))).toBe(false);
    const opened = await svc.openEmailData(api.deps.keys, (job.data as { data: Record<string, unknown> }).data);
    expect(opened.link).toMatch(/^https:\/\/www\.dop\.test\/reset-password\?token=/);
    expect(opened.sealedLink).toBeUndefined();
  });
});

describe('webhook delivery errors shown to tenants', () => {
  it('do not tell a blocked internal name from an unknown one', () => {
    expect(svc.deliveryErrorCategory('Destination resolves to a private address')).toBe(svc.deliveryErrorCategory('getaddrinfo ENOTFOUND minio'));
    expect(svc.deliveryErrorCategory('connect ECONNREFUSED 203.0.113.9:443')).toBe('Connection failed');
  });
});

describe('console allow-list never covers the internal network', () => {
  it('refuses entries that include the Docker gateway or loopback', async () => {
    const actor = { kind: 'platform' as const, platformUserId: uuidv7(), role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };
    for (const list of [['172.30.0.0/16'], ['172.30.0.1'], ['127.0.0.0/8'], ['::1']]) {
      await expect(svc.putSetting(api.deps, actor, 'console.ipAllowList', list, { ip: '172.30.0.1' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});

describe('a platform MFA reset needs the mailbox, not only the old password', () => {
  it('clears the password and sends a single-use set-password link', async () => {
    const mk = async (role: 'super_admin' | 'support') => {
      const id = uuidv7();
      await t.clients
        .platform()
        .insertInto('platform_users')
        .values({ id, email: `p-${id.slice(-8)}@x.test`, name: 'Agent', role, status: 'active', password_hash: await hashSecret(PASSWORD), totp_secret_enc: await encrypt(api.deps.keys, newTotpSecret()), mfa_enrolled_at: new Date() })
        .execute();
      return { id, email: `p-${id.slice(-8)}@x.test`, actor: { kind: 'platform' as const, platformUserId: id, role, sessionId: 's', mfaVerifiedAt: new Date() } };
    };
    const admin = await mk('super_admin');
    const agent = await mk('support');
    await svc.resetPlatformMfa(api.deps, admin.actor, agent.id);
    // Someone holding the phished old password cannot get as far as enrolling an authenticator.
    const old = await client(api.app, 'admin.dop.test').post('/api/auth/v1/sign-in', { email: agent.email, password: PASSWORD });
    expect(old.status).toBe(401);
    const job = api.deps.jobs.added.filter((j) => j.name === 'email.send' && (j.data as { template: string; to: string }).template === 'platform_user_invitation' && (j.data as { to: string }).to === agent.email).at(-1)!;
    const token = new URL((await svc.openEmailData(api.deps.keys, (job.data as { data: Record<string, unknown> }).data)).link as string).searchParams.get('token')!;
    await svc.acceptPlatformInvitation(api.deps, token, 'a-brand-new-agent-passphrase');
    const row = await t.clients.platform().selectFrom('platform_users').select(['status', 'totp_secret_enc']).where('id', '=', agent.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'active', totp_secret_enc: null });
    await expect(svc.acceptPlatformInvitation(api.deps, token, 'another-agent-passphrase')).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
  });
});
