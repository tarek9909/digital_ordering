import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import { uuidv7 } from '@dop/domain';
import { PLATFORM_SETTING_DEFAULTS } from '@dop/contracts';
import * as svc from '@dop/services';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { client, makeApi } from './helpers.js';

// The public contact and the packages section on the sign-up site are platform settings edited by super admins
// (`site.contact`, `site.pricing`).

let t: TestDatabase;
let api: ReturnType<typeof makeApi>;
const platform = { kind: 'platform' as const, platformUserId: '', role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };

beforeAll(async () => {
  t = await startTestDatabase();
  api = makeApi(t.clients);
  platform.platformUserId = uuidv7();
  await t.clients.platform().insertInto('platform_users').values({ id: platform.platformUserId, email: 'site-admin@x.test', name: 'Admin', role: 'super_admin', status: 'active' }).execute();
});
afterAll(async () => {
  await t?.stop();
});

it('serves the default contact, then what the console saved', async () => {
  const www = client(api.app, 'www.dop.test');
  expect((await www.get('/api/public/v1/site')).body.contact).toEqual({ email: 'support@tanbeeh.app', whatsapp: null, whatsappUrl: null });
  await svc.putSetting(api.deps, platform, 'site.contact', { email: 'Hello@Tanbeeh.app', whatsapp: '+966500000000' });
  expect((await www.get('/api/public/v1/site')).body.contact).toEqual({ email: 'hello@tanbeeh.app', whatsapp: '+966500000000', whatsappUrl: 'https://wa.me/966500000000' });
});

it('rejects a malformed contact', async () => {
  await expect(svc.putSetting(api.deps, platform, 'site.contact', { email: 'nope', whatsapp: '0500' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  await expect(svc.putSetting(api.deps, platform, 'site.contact', { email: '', whatsapp: '', extra: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

const pricing = (over: Record<string, unknown> = {}) => ({ ...PLATFORM_SETTING_DEFAULTS['site.pricing'], ...over });
const plan = (featured = false) => ({ name: { ar: 'برو', en: ' Pro ' }, tagline: { ar: '', en: 'For busy counters' }, featured });

it('serves the packages wording, then what the console saved', async () => {
  const www = client(api.app, 'www.dop.test');
  expect((await www.get('/api/public/v1/site')).body.pricing).toEqual(PLATFORM_SETTING_DEFAULTS['site.pricing']);
  await svc.putSetting(api.deps, platform, 'site.pricing', pricing({ periods: ['month', 'year'], plans: { pro: plan(true) } }));
  const body = (await www.get('/api/public/v1/site')).body.pricing;
  expect(body.periods).toEqual(['month', 'year']);
  expect(body.plans.pro).toEqual({ name: { ar: 'برو', en: 'Pro' }, tagline: { ar: '', en: 'For busy counters' }, featured: true });
});

it('rejects a malformed packages section', async () => {
  const bad = [
    pricing({ periods: [] }),
    pricing({ periods: ['month', 'month'] }),
    pricing({ periods: ['week'] }),
    pricing({ plans: { pro: plan(true), standard: plan(true) } }),
    pricing({ plans: { 'Not A Code': plan() } }),
    pricing({ included: { ar: [''], en: [] } }),
    pricing({ extra: 1 }),
  ];
  for (const v of bad) await expect(svc.putSetting(api.deps, platform, 'site.pricing', v)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
});

it('is only served on the public site host', async () => {
  expect((await client(api.app, 't.dop.test').get('/api/public/v1/site')).status).toBe(404);
});
