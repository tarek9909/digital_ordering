import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tokenHash } from '../../../backend/packages/auth/src/index.js';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.js';
import { uuidv7 } from '../../../backend/packages/domain/src/index.js';
import { signup, pendingLegalAcceptance } from '../../../backend/packages/services/src/index.js';
import { setGoogleProvider } from '../../../backend/apps/api/src/routes/auth-r11.js';
import { client, makeApi } from '../../../backend/apps/api/test/helpers.js';

// Characterization probe: assertions reproduce current defects, not repaired acceptance behavior.
// Real MySQL + real HTTP handlers; fake Google claims, in-memory queue, local temporary object storage.
const database = await startTestDatabase();
const api = makeApi(database.clients);
const db = database.clients.platform();
const results: unknown[] = [];
const password = 'a-unique-robust-audit-passphrase';
try {
  const enId = uuidv7();
  const arId = uuidv7();
  for (const d of [
    { id: enId, locale: 'en', version: 'english-v1', html: '<p>English terms version 1</p>', date: new Date('2026-01-01T00:00:00Z') },
    { id: arId, locale: 'ar', version: 'arabic-v2', html: '<p>Arabic terms version 2</p>', date: new Date('2026-02-01T00:00:00Z') },
  ]) {
    const key = `legal/terms/${d.version}/${d.locale}.html`;
    await api.deps.storage!.put('assets', key, Buffer.from(d.html), 'text/html');
    await db.insertInto('legal_documents').values({ id: d.id, kind: 'terms', version: d.version, locale: d.locale, content_key: key, published_at: d.date }).execute();
  }
  const publicClient = client(api.app, 'www.dop.test');
  const seenTerms = await publicClient.get('/api/public/v1/legal/terms?locale=en');
  assert.equal(seenTerms.status, 200);
  assert.equal(seenTerms.body.version, 'english-v1');
  const owner = await signup(api.deps, { ownerName: 'Owner', email: 'legal-owner@audit.test', password, restaurantName: 'Legal audit', slug: 'legal-completeness', country: 'SA', locale: 'en', acceptTerms: true }, { ip: '127.0.0.1' });
  const accepted = await db.selectFrom('legal_acceptances').innerJoin('legal_documents', 'legal_documents.id', 'legal_acceptances.document_id').select(['legal_documents.locale', 'legal_documents.version']).where('tenant_id', '=', owner.tenantId).execute();
  assert.equal(accepted[0]?.locale, 'ar');
  assert.equal(accepted[0]?.version, 'arabic-v2');
  const nextEn = uuidv7();
  await db.insertInto('legal_documents').values({ id: nextEn, kind: 'privacy', version: 'en-privacy', locale: 'en', content_key: 'privacy-en', published_at: new Date('2026-03-01T00:00:00Z') }).execute();
  const nextAr = uuidv7();
  await db.insertInto('legal_documents').values({ id: nextAr, kind: 'privacy', version: 'ar-privacy', locale: 'ar', content_key: 'privacy-ar', published_at: new Date('2026-04-01T00:00:00Z') }).execute();
  const pending = await pendingLegalAcceptance(api.deps, owner.tenantId, owner.userId);
  assert.equal(pending.find((d) => d.kind === 'privacy')?.id, nextAr);
  results.push({ finding: 'English signup/acceptance records a different locale and version than the English public document', publicLocale: seenTerms.body.locale, publicVersion: seenTerms.body.version, recordedAcceptance: accepted, pendingPrivacyIdMatchesNewerArabic: true });

  // Supply one valid password-reset token, exactly as the email link would carry it.
  const resetToken = 'audit-reset-token-long-enough-to-validate';
  await db.insertInto('email_tokens').values({ id: uuidv7(), user_id: owner.userId, purpose: 'reset_password', token_hash: tokenHash(api.deps.config.pepper, resetToken), expires_at: new Date(api.deps.now().getTime() + 3_600_000) }).execute();
  const rejected = await publicClient.post('/api/auth/v1/password/reset', { token: resetToken, password: 'password123' });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'VALIDATION_FAILED');
  const corrected = await publicClient.post('/api/auth/v1/password/reset', { token: resetToken, password: 'a-corrected-unique-audit-passphrase' });
  assert.equal(corrected.body.code, 'INVITATION_EXPIRED');
  results.push({ finding: 'A rejected password consumes the reset link before the user can correct it', firstStatus: rejected.status, firstCode: rejected.body.code, retryStatus: corrected.status, retryCode: corrected.body.code });

  setGoogleProvider({
    authorizationUrl: async ({ state }) => `https://stub-provider.test/authorize?state=${encodeURIComponent(state)}`,
    callback: async () => ({ sub: 'completeness-new-google-user', email: 'new-google@audit.test', emailVerified: true, name: 'Google owner' }),
  });
  const google = client(api.app, 'www.dop.test');
  const started = await google.get('/api/auth/v1/oauth/google/start');
  assert.equal(started.status, 302);
  const state = new URL(started.headers.location).searchParams.get('state');
  const callback = await google.get(`/api/auth/v1/oauth/google/callback?code=stub-code&state=${state}`);
  assert.equal(callback.status, 302);
  const me = await google.get('/api/auth/v1/me');
  assert.equal(me.status, 200);
  const memberships = await google.get('/api/auth/v1/tenants');
  assert.equal(memberships.status, 200);
  assert.deepEqual(memberships.body.tenants, []);
  const signupAttempt = await google.post('/api/public/v1/signup', { ownerName: 'Google owner', email: 'new-google@audit.test', password, restaurantName: 'Google restaurant', slug: 'google-completeness', country: 'SA', locale: 'en', acceptTerms: true });
  assert.equal(signupAttempt.body.code, 'EMAIL_TAKEN');
  results.push({ finding: 'A new Google sign-in creates an account with no tenant; suggested regular signup rejects that same account', callbackStatus: callback.status, redirect: callback.headers.location, memberships: memberships.body.tenants.length, signupStatus: signupAttempt.status, signupCode: signupAttempt.body.code });

  const report = { generatedAt: new Date().toISOString(), evidence: 'real MySQL / real service and HTTP code; fake identity provider', results };
  writeFileSync(new URL('./admin-site-backend-results.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  setGoogleProvider(null);
  await database.stop();
}
