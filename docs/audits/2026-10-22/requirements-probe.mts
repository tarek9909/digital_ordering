import assert from 'node:assert/strict';
import { currentTotp } from '../../../backend/packages/auth/src/index.js';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.js';
import { uuidv7 } from '../../../backend/packages/domain/src/index.js';
import { addPrice, changeSlug, createApiKey, createTicket, deleteRatingComment, follow, listRatings, listTenants, platformDailyRollup, rateTicket, rollupVenueDay, setFlagOverride, signup, slugAvailability, slugRedirect, transitionTicket, trendsReport } from '../../../backend/packages/services/src/index.js';
import request from '../../../backend/node_modules/supertest/index.js';
import { client, makeApi } from '../../../backend/apps/api/test/helpers.js';
import { setGoogleProvider } from '../../../backend/apps/api/src/routes/auth-r11.js';

// Regression probe (converted after the repairs): asserts the CORRECTED behaviour of each audited case.
// Isolated throwaway MySQL database; no external services. Vitest equivalent: backend/apps/api/test/audit-repairs.int.test.ts
const database = await startTestDatabase();
const api = makeApi(database.clients);
const password = 'audit-long-unique-passphrase';
const results: unknown[] = [];
try {
  async function tenant(slug: string, plan: 'pro' | 'multisite') {
    const email = `${slug}@audit.test`;
    const x = await signup(api.deps, { ownerName: 'Audit Owner', email, password, restaurantName: 'Audit Restaurant', slug, country: 'SA', locale: 'en', acceptTerms: true }, { ip: '1.1.1.1' });
    const db = database.clients.platform();
    const p = await db.selectFrom('plans').select('id').where('code', '=', plan).executeTakeFirstOrThrow();
    await db.updateTable('tenants').set({ status: 'active', complimentary: true, plan_id: p.id }).where('id', '=', x.tenantId).execute();
    await db.updateTable('users').set({ email_verified_at: api.deps.now() }).where('id', '=', x.userId).execute();
    const tenantClient = client(api.app, `${slug}.dop.test`);
    const login = await tenantClient.post('/api/auth/v1/sign-in', { email, password });
    assert.equal(login.status, 200);
    const me = await tenantClient.get('/api/auth/v1/me');
    tenantClient.setCsrf(me.body.csrfToken);
    return { ...x, email, tenantClient };
  }
  async function enroll(x: Awaited<ReturnType<typeof tenant>>) {
    const enrollment = await x.tenantClient.post('/api/auth/v1/mfa/totp/enroll');
    assert.equal(enrollment.status, 200);
    const secret = enrollment.body.secret as string;
    const confirmed = await x.tenantClient.post('/api/auth/v1/mfa/totp/confirm', { code: currentTotp(secret) });
    assert.equal(confirmed.status, 204);
    return secret;
  }
  async function handoff(www: ReturnType<typeof client>, slug: string) {
    const me = await www.get('/api/auth/v1/me');
    assert.equal(me.status, 200);
    www.setCsrf(me.body.csrfToken);
    const hand = await www.post('/api/auth/v1/handoff', { tenantSlug: slug });
    assert.equal(hand.status, 200);
    const tenantHost = client(api.app, `${slug}.dop.test`);
    const exchange = await tenantHost.post('/api/auth/v1/handoff/exchange', { code: hand.body.code });
    assert.equal(exchange.status, 200);
    return tenantHost;
  }

  const multi = await tenant('audit-mfa-handoff', 'multisite');
  const secret = await enroll(multi);
  const venue = await multi.tenantClient.post('/api/admin/v1/venues', { name: 'Second venue' });
  assert.equal(venue.status, 201);
  const direct = await multi.tenantClient.get('/api/admin/v1/venues');
  assert.equal(direct.status, 200);
  const www = client(api.app, 'www.dop.test');
  const initial = await www.post('/api/auth/v1/sign-in', { email: multi.email, password });
  assert.equal(initial.body.mfaRequired, true);
  const mfa = await www.post('/api/auth/v1/sign-in/mfa', { mfaToken: initial.body.mfaToken, code: currentTotp(secret) });
  assert.equal(mfa.body.ok, true);
  const viaHandoff = await handoff(www, 'audit-mfa-handoff');
  const management = await viaHandoff.get('/api/admin/v1/venues');
  assert.equal(management.status, 200);
  results.push({ finding: 'MFA proof kept through the www-to-tenant handoff', passwordLoginRequiresMfa: initial.body.mfaRequired, wwwMfaCompleted: mfa.body.ok, directTenantManagement: direct.status, afterHandoffManagement: management.status, code: management.body.code });

  const single = await tenant('audit-google-mfa', 'pro');
  await enroll(single);
  const baseline = client(api.app, 'www.dop.test');
  const passwordChallenge = await baseline.post('/api/auth/v1/sign-in', { email: single.email, password });
  assert.equal(passwordChallenge.body.mfaRequired, true);
  setGoogleProvider({
    authorizationUrl: async ({ state }) => `https://stub-provider.test/authorize?state=${encodeURIComponent(state)}`,
    callback: async () => ({ sub: 'audit-stub-subject', email: single.email, emailVerified: true, name: 'Audit Owner' }),
  });
  const google = client(api.app, 'www.dop.test');
  const start = await google.get('/api/auth/v1/oauth/google/start');
  assert.equal(start.status, 302);
  const state = new URL(start.headers.location).searchParams.get('state');
  const callback = await google.get(`/api/auth/v1/oauth/google/callback?code=stub-code&state=${state}`);
  assert.equal(callback.status, 302);
  assert.match(String(callback.headers.location), /#mfa=/);
  const googleMe = await google.get('/api/auth/v1/me');
  assert.equal(googleMe.status, 401); // no session before the code
  results.push({ finding: 'Google sign-in now requires the enrolled TOTP', passwordLoginRequiresMfa: passwordChallenge.body.mfaRequired, googleCallback: callback.status, redirectsToCode: true, sessionBeforeCode: googleMe.status });

  const downgrade = await tenant('audit-key-downgrade', 'pro');
  const key = await createApiKey(api.deps, { kind: 'user', userId: downgrade.userId, tenantId: downgrade.tenantId, role: 'owner', sessionId: 'audit', mfaVerified: false }, downgrade.tenantId, downgrade.venueId, 'Existing integration');
  // The active key exceeds Standard's limit of zero, so the downgrade is refused with the excess listed (A05).
  const changed = await downgrade.tenantClient.post('/api/admin/v1/billing/change-plan', { planCode: 'standard' });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'PLAN_DOWNGRADE_BLOCKED');
  const std = await database.clients.platform().selectFrom('plans').select('id').where('code', '=', 'standard').executeTakeFirstOrThrow();
  await database.clients.platform().updateTable('tenants').set({ plan_id: std.id }).where('id', '=', downgrade.tenantId).execute();
  await api.deps.kv.del(`t:${downgrade.tenantId}:flags`);
  const keyWrite = await request(api.app).post('/v1/tickets').set('Host', 'api.dop.test').set('Authorization', `Bearer ${key.key}`).send({ externalRef: 'audit-after-downgrade' });
  assert.equal(keyWrite.status, 403);
  results.push({ finding: 'Kept API key stops working on a plan without the API', changeStatus: changed.status, retainedKeyWriteStatus: keyWrite.status, retainedKeyWriteCode: keyWrite.body.code ?? null });

  const platformId = uuidv7();
  await database.clients.platform().insertInto('platform_users').values({ id: platformId, email: 'audit-platform@audit.test', name: 'Audit Platform', role: 'super_admin', status: 'active' }).execute();
  const platform = { kind: 'platform' as const, platformUserId: platformId, role: 'super_admin' as const, sessionId: 'audit-platform', mfaVerifiedAt: api.deps.now() };
  await setFlagOverride(api.deps, platform, downgrade.tenantId, 'reports_trends', false);
  const disabledReports = await downgrade.tenantClient.get('/api/admin/v1/reports/trends?from=2026-01-01&to=2026-12-31');
  assert.equal(disabledReports.status, 403);
  results.push({ finding: 'reports_trends override now disables trends', override: false, responseStatus: disabledReports.status });

  const byName = await listTenants(api.deps, { q: 'audit-key-downgrade', limit: 20 });
  const byEmail = await listTenants(api.deps, { q: downgrade.email, limit: 20 });
  assert.equal(byName.items.length, 1);
  assert.equal(byEmail.items.length, 1);
  results.push({ finding: 'Console tenant search finds owner email', slugSearchCount: byName.items.length, ownerEmailSearchCount: byEmail.items.length });

  const rating = await tenant('audit-rating-stars', 'pro');
  const owner = { kind: 'user' as const, userId: rating.userId, tenantId: rating.tenantId, role: 'owner' as const, sessionId: 'audit', mfaVerified: false };
  const ticket = (await createTicket(api.deps, owner, rating.venueId, {})).ticket;
  const browserId = 'AuditRatingBrowser0001';
  await follow(api.deps, ticket.token, { clientId: browserId, joinedVia: 'ticket_qr', uaFamily: 'other' });
  await transitionTicket(api.deps, owner, ticket.id, { to: 'ready', version: 1 });
  await transitionTicket(api.deps, owner, ticket.id, { to: 'collected', version: 2 });
  await rateTicket(api.deps, ticket.token, { clientId: browserId, stars: 5, comment: 'Delete only this comment' });
  await rollupVenueDay(api.deps, rating.tenantId, rating.venueId, ticket.business_date);
  const ratingBefore = await trendsReport(api.deps, rating.tenantId, { venueId: rating.venueId, from: ticket.business_date, to: ticket.business_date });
  const row = (await listRatings(api.deps, rating.tenantId))[0]!;
  await deleteRatingComment(api.deps, owner, rating.tenantId, row.id);
  await rollupVenueDay(api.deps, rating.tenantId, rating.venueId, ticket.business_date);
  const ratingAfter = await trendsReport(api.deps, rating.tenantId, { venueId: rating.venueId, from: ticket.business_date, to: ticket.business_date });
  assert.equal(ratingBefore.current.ratingsCount, 1);
  assert.equal(ratingAfter.current.ratingsCount, 1);
  assert.equal(ratingAfter.current.ratingAvg, 5);
  results.push({ finding: 'Deleting a rating comment keeps the stars', before: { count: ratingBefore.current.ratingsCount, average: ratingBefore.current.ratingAvg }, after: { count: ratingAfter.current.ratingsCount, average: ratingAfter.current.ratingAvg } });

  await changeSlug(api.deps, owner, rating.tenantId, 'audit-slug-second', password);
  const firstRedirectBefore = await slugRedirect(api.deps, 'audit-rating-stars');
  await changeSlug(api.deps, owner, rating.tenantId, 'audit-slug-third', password);
  const firstRedirectAfter = await slugRedirect(api.deps, 'audit-rating-stars');
  const firstAvailable = await slugAvailability(api.deps, 'audit-rating-stars');
  assert.equal(firstRedirectBefore, 'audit-slug-second');
  assert.equal(firstRedirectAfter, 'audit-slug-third');
  assert.equal(firstAvailable.available, false);
  results.push({ finding: 'Every old slug keeps its 180-day redirect', firstRedirectBefore, firstRedirectAfter, originalSlugAvailableAfterSecondRename: firstAvailable.available });

  const pro = await database.clients.platform().selectFrom('plans').select('id').where('code', '=', 'pro').executeTakeFirstOrThrow();
  await database.clients.forTenant(rating.tenantId).insertInto('subscriptions').values({ id: uuidv7(), tenant_id: rating.tenantId, stripe_subscription_id: 'sub_audit_original_price', plan_id: pro.id, period: 'month', venue_quantity: 1, amount_minor: 17900, currency: 'SAR', stripe_status: 'active', current_period_start: api.deps.now(), current_period_end: new Date(api.deps.now().getTime() + 30 * 86_400_000) }).execute();
  const date = api.deps.now().toISOString().slice(0, 10);
  const beforePrice = await platformDailyRollup(api.deps, date);
  const callsBeforePrice = api.deps.billing.calls.length;
  await addPrice(api.deps, platform, pro.id, { period: 'month', currency: 'SAR', amountMinor: 29900, stripePriceId: 'price_audit_new_subscribers' });
  const afterPrice = await platformDailyRollup(api.deps, date);
  assert.equal(beforePrice.mrr.SAR, 17900);
  assert.equal(afterPrice.mrr.SAR, 17900);
  assert.equal(api.deps.billing.calls.length, callsBeforePrice);
  results.push({ finding: 'MRR keeps the contracted price after a catalogue change', mrrBeforeMinor: beforePrice.mrr.SAR, mrrAfterMinor: afterPrice.mrr.SAR, providerCallsDuringPriceChange: api.deps.billing.calls.length - callsBeforePrice });
  console.log(JSON.stringify(results, null, 2));
} finally {
  setGoogleProvider(null);
  await database.stop();
}
