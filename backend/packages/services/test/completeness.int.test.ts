import { mkdtempSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@dop/db/testing';
import type { TenantActor } from '@dop/auth';
import { json } from '@dop/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptLegal,
  createLegalDocument,
  createTenantWithOwner,
  createTicket,
  follow,
  legalDocument,
  listPlanOptions,
  pendingLegalAcceptance,
  pilotReport,
  platformDailyRollup,
  platformReport,
  publishLegalDocument,
  rateTicket,
  ratingSummary,
  rollupTargets,
  rollupVenueDay,
  todayReport,
  transitionTicket,
  trendsReport,
  LocalStorage,
  type ObjectStorage,
} from '../src/index.js';
import { makeTestDeps, type TestDeps } from '../src/testing.js';

// Regressions for the 2026-10-22 completeness repairs API02, AS04, AS05, AS08, AS10 and BW07. They assert the
// repaired behaviour (the audit's characterization probes under docs/ assert the old defects and stay unchanged).

let t: TestDatabase;
let deps: TestDeps;
let root: string;
let storage: LocalStorage;
const platform = { kind: 'platform' as const, platformUserId: 'pu-c', role: 'super_admin' as const, sessionId: 's', mfaVerifiedAt: new Date() };

beforeAll(async () => {
  t = await startTestDatabase();
  deps = makeTestDeps(t.clients);
  root = mkdtempSync(join(tmpdir(), 'dop-legal-'));
  storage = new LocalStorage(root, 'https://cdn.dop.test');
  await t.clients.platform().insertInto('platform_users').values({ id: 'pu-c', email: 'legal@x.test', name: 'Legal', role: 'super_admin', status: 'active' }).execute();
});
afterAll(async () => {
  await t?.stop();
});

let n = 0;
async function tenant(locale = 'en') {
  n++;
  const r = await createTenantWithOwner(deps, { ownerName: 'O', email: `c${n}@x.test`, password: 'a-long-unique-passphrase', restaurantName: `C ${n}`, slug: `compl-${n}`, country: 'SA', locale }, { ip: '1.1.1.1' });
  await t.clients.platform().updateTable('users').set({ email_verified_at: new Date() }).where('id', '=', r.userId).execute();
  const device: TenantActor = { kind: 'staff_device', deviceId: 'd', tenantId: r.tenantId, venueId: r.venueId, deviceName: 'iPad' };
  return { ...r, device };
}

const legalFiles = async () => (await readdir(join(root, 'assets', 'legal'), { recursive: true, withFileTypes: true }).catch(() => [])).filter((e) => e.isFile()).length;
let minute = 0;
/** Publication times increase in test order, so "latest published" is deterministic. */
async function publish(id: string) {
  deps.clock.set(new Date(Date.parse('2026-10-01T00:00:00Z') + ++minute * 60_000));
  await publishLegalDocument(deps, platform, id);
}
async function createAndPublish(kind: 'terms' | 'privacy' | 'dpa', version: string, locale: string, html: string) {
  const { id } = await createLegalDocument(deps, storage, platform, { kind, version, locale, html });
  await publish(id);
  return id;
}

describe('API02 legal versions are immutable', () => {
  it('a rejected duplicate leaves the published bytes, id, version and public output unchanged', async () => {
    const id = await createAndPublish('terms', 'api02-v1', 'en', '<p>Original accepted terms</p>');
    const before = await legalDocument(deps, 'terms', 'en', storage, id);
    expect(before.html).toBe('<p>Original accepted terms</p>');
    const files = await legalFiles();
    await expect(createLegalDocument(deps, storage, platform, { kind: 'terms', version: 'api02-v1', locale: 'en', html: '<p>Replacement rejected by API</p>' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const after = await legalDocument(deps, 'terms', 'en', storage, id);
    expect(after).toEqual(before);
    expect(await legalFiles()).toBe(files); // no new object was written for the rejected attempt
  });

  it('concurrent creation of one version: exactly one wins and its row serves its own content', async () => {
    const files = await legalFiles();
    const results = await Promise.allSettled(['<p>A</p>', '<p>B</p>', '<p>C</p>'].map((html) => createLegalDocument(deps, storage, platform, { kind: 'privacy', version: 'api02-race', locale: 'en', html })));
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'VALIDATION_FAILED' });
    const winnerId = (ok[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    const row = await t.clients.platform().selectFrom('legal_documents').selectAll().where('id', '=', winnerId).executeTakeFirstOrThrow();
    expect(row.status).toBe('ready');
    expect(row.content_key).toContain(winnerId);
    const body = (await storage.get('assets', row.content_key))!.toString('utf8');
    expect(['<p>A</p>', '<p>B</p>', '<p>C</p>']).toContain(body);
    expect(await legalFiles()).toBe(files + 1);
  });

  it('a storage failure removes only its own reservation, and the version can be created afterwards', async () => {
    const original = await createAndPublish('dpa', 'api02-dpa-1', 'en', '<p>DPA one</p>');
    const before = await legalDocument(deps, 'dpa', 'en', storage, original);
    const failing: ObjectStorage = { ...storage, get: storage.get.bind(storage), signedUrl: storage.signedUrl.bind(storage), deletePrefix: storage.deletePrefix.bind(storage), put: async () => Promise.reject(new Error('storage down')) };
    await expect(createLegalDocument(deps, failing, platform, { kind: 'dpa', version: 'api02-dpa-2', locale: 'en', html: '<p>DPA two</p>' })).rejects.toThrow('storage down');
    expect(await t.clients.platform().selectFrom('legal_documents').select('id').where('version', '=', 'api02-dpa-2').execute()).toEqual([]);
    expect(await legalDocument(deps, 'dpa', 'en', storage, original)).toEqual(before);
    const retry = await createLegalDocument(deps, storage, platform, { kind: 'dpa', version: 'api02-dpa-2', locale: 'en', html: '<p>DPA two</p>' });
    expect((await storage.get('assets', `legal/dpa/${retry.id}.html`))!.toString('utf8')).toBe('<p>DPA two</p>');
  });

  it('a failure after the write removes the new object and leaves the old version untouched', async () => {
    const original = await createAndPublish('terms', 'api02-db-1', 'en', '<p>Kept</p>');
    const before = await legalDocument(deps, 'terms', 'en', storage, original);
    const files = await legalFiles();
    let written = '';
    // The reservation disappears while the content is written (e.g. a lost connection): marking it ready fails.
    const racing: ObjectStorage = {
      ...storage,
      get: storage.get.bind(storage),
      signedUrl: storage.signedUrl.bind(storage),
      deletePrefix: storage.deletePrefix.bind(storage),
      put: async (bucket, key, body) => {
        await storage.put(bucket, key, body);
        written = key;
        await t.clients.platform().deleteFrom('legal_documents').where('content_key', '=', key).execute();
      },
    };
    await expect(createLegalDocument(deps, racing, platform, { kind: 'terms', version: 'api02-db-2', locale: 'en', html: '<p>Lost</p>' })).rejects.toThrow();
    expect(written).not.toBe('');
    expect(await storage.get('assets', written)).toBeNull(); // only the new object is removed
    expect(await legalDocument(deps, 'terms', 'en', storage, original)).toEqual(before);
    expect(await legalFiles()).toBe(files);
  });

  it('reclaims an abandoned reservation, keeps a fresh one, and never publishes an unready row', async () => {
    const pdb = t.clients.platform();
    await pdb.insertInto('legal_documents').values({ id: '00000000-0000-7000-8000-00000000a001', kind: 'terms', version: 'api02-stale', locale: 'en', content_key: 'legal/terms/stale.html', status: 'uploading' }).execute();
    await pdb.updateTable('legal_documents').set({ created_at: new Date(Date.now() - 3600_000) }).where('id', '=', '00000000-0000-7000-8000-00000000a001').execute();
    const r = await createLegalDocument(deps, storage, platform, { kind: 'terms', version: 'api02-stale', locale: 'en', html: '<p>Fresh</p>' });
    expect(r.id).not.toBe('00000000-0000-7000-8000-00000000a001');
    await pdb.insertInto('legal_documents').values({ id: '00000000-0000-7000-8000-00000000a002', kind: 'terms', version: 'api02-busy', locale: 'en', content_key: 'legal/terms/busy.html', status: 'uploading' }).execute();
    await expect(createLegalDocument(deps, storage, platform, { kind: 'terms', version: 'api02-busy', locale: 'en', html: '<p>x</p>' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(publishLegalDocument(deps, platform, '00000000-0000-7000-8000-00000000a002')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pdb.deleteFrom('legal_documents').where('id', '=', '00000000-0000-7000-8000-00000000a002').execute();
  });
});

describe('AS04/AS05 acceptance records exactly the displayed versions', () => {
  it('the gate shows the locale version the public page shows, and records that exact id', async () => {
    const x = await tenant('en');
    // No acceptance is recorded for documents the owner was never shown (AS05).
    expect(await t.clients.platform().selectFrom('legal_acceptances').select('id').where('tenant_id', '=', x.tenantId).execute()).toEqual([]);
    const enTerms = await createAndPublish('terms', 'english-v1', 'en', '<p>English terms</p>');
    const arTerms = await createAndPublish('terms', 'arabic-v2', 'ar', '<p>شروط</p>');
    const privacy = await createAndPublish('privacy', 'as04-p1', 'en', '<p>Privacy</p>');
    const dpa = await createAndPublish('dpa', 'as04-d1', 'en', '<p>DPA</p>');

    const pub = await legalDocument(deps, 'terms', 'en', storage);
    expect(pub).toMatchObject({ id: enTerms, version: 'english-v1', locale: 'en' });
    const pending = await pendingLegalAcceptance(deps, x.tenantId, x.userId, { locale: 'en', storage });
    expect(pending.map((d) => [d.kind, d.id, d.locale])).toEqual([
      ['terms', enTerms, 'en'],
      ['privacy', privacy, 'en'],
      ['dpa', dpa, 'en'],
    ]);
    expect(pending[0]!.html).toBe('<p>English terms</p>');

    // A document that was not shown (newer Arabic version) and partial sets are refused; nothing is recorded.
    await expect(acceptLegal(deps, x.tenantId, x.userId, [arTerms, privacy, dpa], '1.1.1.1', 'en')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(acceptLegal(deps, x.tenantId, x.userId, [enTerms, privacy], '1.1.1.1', 'en')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await t.clients.platform().selectFrom('legal_acceptances').select('id').where('tenant_id', '=', x.tenantId).execute()).toEqual([]);

    await acceptLegal(deps, x.tenantId, x.userId, [enTerms, privacy, dpa], '1.1.1.1', 'en');
    const rows = await t.clients.platform().selectFrom('legal_acceptances').innerJoin('legal_documents', 'legal_documents.id', 'legal_acceptances.document_id').select(['legal_documents.kind', 'legal_documents.version', 'legal_documents.locale']).where('legal_acceptances.tenant_id', '=', x.tenantId).execute();
    expect(rows.sort((p, q) => p.kind.localeCompare(q.kind))).toEqual([
      { kind: 'dpa', version: 'as04-d1', locale: 'en' },
      { kind: 'privacy', version: 'as04-p1', locale: 'en' },
      { kind: 'terms', version: 'english-v1', locale: 'en' },
    ]);
    expect(await pendingLegalAcceptance(deps, x.tenantId, x.userId, { locale: 'en', storage })).toEqual([]);
    // Re-sending the accepted set is a no-op; in Arabic the newer Arabic terms are a different version and pending.
    await acceptLegal(deps, x.tenantId, x.userId, [enTerms, privacy, dpa], '1.1.1.1', 'en');
    expect((await pendingLegalAcceptance(deps, x.tenantId, x.userId, { locale: 'ar' })).map((d) => d.id)).toEqual([arTerms]);
  });

  it('refuses a stale list after a newer version is published, and fails closed when content is missing', async () => {
    const x = await tenant('en');
    const shown = (await pendingLegalAcceptance(deps, x.tenantId, x.userId, { locale: 'en', storage })).map((d) => d.id);
    expect(shown).toHaveLength(3);
    const newer = await createAndPublish('privacy', 'as04-p2', 'en', '<p>Privacy 2</p>');
    await expect(acceptLegal(deps, x.tenantId, x.userId, shown, '1.1.1.1', 'en')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const now = (await pendingLegalAcceptance(deps, x.tenantId, x.userId, { locale: 'en', storage })).map((d) => d.id);
    expect(now).toContain(newer);
    const key = (await t.clients.platform().selectFrom('legal_documents').select('content_key').where('id', '=', newer).executeTakeFirstOrThrow()).content_key;
    await storage.deletePrefix('assets', key);
    await expect(pendingLegalAcceptance(deps, x.tenantId, x.userId, { locale: 'en', storage })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('BW07 late ratings reach their historical report', () => {
  it('rebuilds the rated ticket business date, and the hourly targets include it', async () => {
    const x = await tenant();
    deps.clock.set('2026-10-01T09:00:00Z');
    const tk = (await createTicket(deps, x.device, x.venueId, {})).ticket;
    await follow(deps, tk.token, { clientId: 'L000000000000000000001', joinedVia: 'ticket_qr', uaFamily: 'other' });
    await transitionTicket(deps, x.device, tk.id, { to: 'ready', version: 1 });
    await transitionTicket(deps, x.device, tk.id, { to: 'collected', version: 2 });
    await rollupVenueDay(deps, x.tenantId, x.venueId, tk.business_date);
    const whole = () => t.clients.forTenant(x.tenantId).selectFrom('report_daily').select(['ratings_count', 'ratings_sum']).where('venue_id', '=', x.venueId).where('business_date', '=', tk.business_date).where('counter_key', '=', '').where('hour_local', '=', 24).executeTakeFirstOrThrow();
    expect(await whole()).toEqual({ ratings_count: 0, ratings_sum: 0 });

    deps.clock.set(new Date());
    await rateTicket(deps, tk.token, { clientId: 'L000000000000000000001', stars: 5 });
    expect(await whole()).toEqual({ ratings_count: 1, ratings_sum: 5 });
    expect(await rollupTargets(deps)).toContainEqual({ tenantId: x.tenantId, venueId: x.venueId, businessDate: tk.business_date });
    // The scheduled roll-up (worker `reports.rollup-hour`) repairs a day whose inline rebuild failed.
    await t.clients.forTenant(x.tenantId).updateTable('report_daily').set({ ratings_count: 0, ratings_sum: 0 }).where('venue_id', '=', x.venueId).where('business_date', '=', tk.business_date).execute();
    for (const target of await rollupTargets(deps)) if (target.venueId === x.venueId) await rollupVenueDay(deps, target.tenantId, target.venueId, target.businessDate);
    expect(await whole()).toEqual({ ratings_count: 1, ratings_sum: 5 });
  });
});

describe('AS08 report outputs match their source events', () => {
  it('Today lists the longest-waiting open tickets oldest first', async () => {
    const x = await tenant();
    deps.clock.set('2026-10-20T09:00:00Z');
    const a = (await createTicket(deps, x.device, x.venueId, {})).ticket;
    deps.clock.set('2026-10-20T09:05:00Z');
    const b = (await createTicket(deps, x.device, x.venueId, {})).ticket;
    deps.clock.set('2026-10-20T09:06:00Z');
    const c = (await createTicket(deps, x.device, x.venueId, {})).ticket;
    await transitionTicket(deps, x.device, c.id, { to: 'ready', version: 1 });
    await transitionTicket(deps, x.device, c.id, { to: 'collected', version: 2 });
    await transitionTicket(deps, x.device, b.id, { to: 'ready', version: 1 });
    deps.clock.set('2026-10-20T09:10:00Z');
    const r = (await todayReport(deps, x.tenantId, x.venueId)) as { longestWaiting: Array<{ displayNumber: string; status: string; waitingSeconds: number }> };
    expect(r.longestWaiting).toEqual([
      expect.objectContaining({ displayNumber: a.display_number, status: a.status, waitingSeconds: 600 }),
      expect.objectContaining({ displayNumber: b.display_number, status: 'ready', waitingSeconds: 300 }),
    ]);
  });

  it('pilot p90s, trends total wait and cancellation reasons, rating distribution and reach by phone type', async () => {
    const x = await tenant();
    const day = '2026-10-18';
    const make = async (at: string, prepSec: number, pickupSec: number | null, ua: string, stars?: number) => {
      deps.clock.set(at);
      const tk = (await createTicket(deps, x.device, x.venueId, {})).ticket;
      await follow(deps, tk.token, { clientId: `U${String(++n).padStart(21, '0')}`, joinedVia: 'ticket_qr', uaFamily: ua as 'other' });
      deps.clock.advance(prepSec * 1000);
      await transitionTicket(deps, x.device, tk.id, { to: 'ready', version: 1 });
      if (pickupSec !== null) {
        deps.clock.advance(pickupSec * 1000);
        await transitionTicket(deps, x.device, tk.id, { to: 'collected', version: 2 });
        if (stars) {
          const f = await t.clients.forTenant(x.tenantId).selectFrom('ticket_followers').select('client_id').where('ticket_id', '=', tk.id).executeTakeFirstOrThrow();
          await rateTicket(deps, tk.token, { clientId: f.client_id, stars });
        }
      }
      return tk;
    };
    // Ten Ready tickets: prep 60…600 s, pickup 30…300 s (p50 ≈ 300/150, p90 ≈ 540/270 from the histograms).
    for (let i = 1; i <= 10; i++) await make(`${day}T0${Math.floor(i / 10) + 7}:${String((i * 5) % 60).padStart(2, '0')}:00Z`, i * 60, i * 30, i % 2 ? 'ios-safari' : 'android-chrome', i <= 3 ? i + 2 : undefined);
    deps.clock.set(`${day}T10:00:00Z`);
    const cancelled = [(await createTicket(deps, x.device, x.venueId, {})).ticket, (await createTicket(deps, x.device, x.venueId, {})).ticket];
    await transitionTicket(deps, x.device, cancelled[0]!.id, { to: 'cancelled', version: 1, cancelReason: 'customer_left' });
    await transitionTicket(deps, x.device, cancelled[1]!.id, { to: 'cancelled', version: 1, cancelReason: 'out_of_stock' });
    await rollupVenueDay(deps, x.tenantId, x.venueId, day);

    const pilot = await pilotReport(deps, x.tenantId, x.venueId, day, day);
    expect(pilot.total.prepSecondsP90).not.toBeNull();
    expect(pilot.total.pickupSecondsP90).not.toBeNull();
    expect(pilot.total.prepSecondsP90!).toBeGreaterThan(pilot.total.prepSecondsP50!);
    expect(pilot.total.pickupSecondsP90!).toBeGreaterThan(pilot.total.pickupSecondsP50!);
    expect(pilot.total.prepSecondsP90!).toBeGreaterThanOrEqual(480);
    expect(pilot.total.prepSecondsP90!).toBeLessThanOrEqual(660);

    const trends = await trendsReport(deps, x.tenantId, { venueId: x.venueId, from: day, to: day });
    expect(trends.current.cancelled).toBe(2);
    expect(trends.current.cancelReasons).toMatchObject({ customer_left: 1, out_of_stock: 1, refunded: 0 });
    // Total wait = created → collected = prep + pickup = 90 s × i; the median of 90…900 s is ≈ 450–540 s.
    expect(trends.current.totalSecondsP50).toBeGreaterThanOrEqual(400);
    expect(trends.current.totalSecondsP50).toBeLessThanOrEqual(600);

    expect(await ratingSummary(deps, x.tenantId, x.venueId)).toEqual({ count: 3, average: 4, distribution: [0, 0, 1, 1, 1] });

    await platformDailyRollup(deps, day);
    const plat = await platformReport(deps, day, day);
    expect(plat.reachByUa['ios-safari']).toBeDefined();
    expect(Object.values(plat.reachByUa['ios-safari']!).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5);
    expect(Object.values(plat.reachByUa['android-chrome']!).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5);
  });
});

describe('AS10 plan options', () => {
  it('lists every catalogue plan code, including a newly created custom plan', async () => {
    await t.clients.platform().insertInto('plans').values({ id: '00000000-0000-7000-8000-0000000000e1', code: 'enterprise', name: 'Enterprise', is_public: false, limits: json({}), features: json([]), sort_order: 99 }).execute();
    const items = await listPlanOptions(deps);
    expect(items.map((p) => p.code)).toEqual(expect.arrayContaining(['trial', 'standard', 'enterprise']));
    expect(items.find((p) => p.code === 'enterprise')).toEqual({ code: 'enterprise', name: 'Enterprise', archived: false });
  });
});
