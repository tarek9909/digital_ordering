// Controlled security reproductions. Uses a disposable MySQL database; no external requests/messages.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { inflateRawSync } from 'node:zlib';
import { S3Client } from '../../../backend/node_modules/@aws-sdk/client-s3/dist-cjs/index.js';
import { startTestDatabase } from '../../../backend/packages/db/src/testing.ts';
import { makeTestDeps } from '../../../backend/packages/services/src/testing.ts';
import { signup } from '../../../backend/packages/services/src/signup.ts';
import { createTicket, follow, transitionTicket } from '../../../backend/packages/services/src/tickets.ts';
import { rateTicket } from '../../../backend/packages/services/src/venue-features.ts';
import { ticketsCsv } from '../../../backend/packages/services/src/r2.ts';
import { requestExport, buildExport } from '../../../backend/packages/services/src/privacy.ts';
import { createS3Storage } from '../../../backend/packages/services/src/aws.ts';
import { resolvePublic } from '../../../backend/packages/services/src/webhooks.ts';
import { JOB_HANDLERS } from '../../../backend/apps/worker/src/handlers.ts';

const results: unknown[] = [];
const emit = (v: unknown) => { results.push(v); console.log(JSON.stringify(v)); };

// Test actual S3 adapter semantics with an in-process AWS client stub: never performs a network request.
const originalSend = S3Client.prototype.send;
(S3Client.prototype as any).send = async function(command: any) {
  if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [{ Key: 'tenants/disposable/protected.txt' }] };
  if (command.constructor.name === 'DeleteObjectsCommand') return { Errors: [{ Key: 'tenants/disposable/protected.txt', Code: 'AccessDenied', Message: 'controlled fixture' }] };
  throw new Error(`Unexpected command ${command.constructor.name}`);
};
try {
  const storage = await createS3Storage({ region: 'test', assetsBucket: 'test-assets', exportsBucket: 'test-exports', cdnBaseUrl: 'https://cdn.invalid' });
  const deleted = await storage.deletePrefix('assets', 'tenants/disposable');
  assert.equal(deleted, 1);
  emit({ probe: 's3-delete-errors-ignored', confirmed: true, returnedDeletedCount: deleted, actualDeleted: 0, objectError: 'AccessDenied' });
} finally { S3Client.prototype.send = originalSend; }

for (const address of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', 'fe81::1', 'febf::1']) {
  const accepted = await resolvePublic('controlled.invalid', async () => [address]);
  const canonicalLookup = await lookup(address).catch((e: Error) => ({ error: e.message }));
  emit({ probe: 'webhook-special-ip-classification', address, accepted, canonicalLookup, caveat: 'Injected resolver only; does not establish route reachability or production DNS formatting.' });
}

const t = await startTestDatabase();
try {
  const deps = makeTestDeps(t.clients);
  const tenant = await signup(deps, { ownerName: 'Security fixture', email: 'security-csv@controlled.invalid', password: 'long-security-fixture-123', restaurantName: 'CSV fixture', slug: 'security-csv-fixture', country: 'SA', locale: 'en', acceptTerms: true }, { ip: '127.0.0.1' });
  const plan = await t.clients.platform().selectFrom('plans').select('id').where('code', '=', 'pro').executeTakeFirstOrThrow();
  await t.clients.platform().updateTable('tenants').set({ plan_id: plan.id }).where('id', '=', tenant.tenantId).execute();
  await t.clients.platform().updateTable('users').set({ email_verified_at: deps.now() }).where('id', '=', tenant.userId).execute();
  const actor = { kind: 'user' as const, userId: tenant.userId, tenantId: tenant.tenantId, role: 'owner' as const, sessionId: 'security-fixture', mfaVerified: true };
  const formula = '=1+1';
  const ticket = (await createTicket(deps, actor, tenant.venueId, { externalRef: formula })).ticket;
  const clientId = 'A'.repeat(22);
  await follow(deps, ticket.token, { clientId, joinedVia: 'ticket_qr', uaFamily: 'other' });
  const ready = await transitionTicket(deps, actor, ticket.id, { to: 'ready', version: ticket.version });
  await transitionTicket(deps, actor, ticket.id, { to: 'collected', version: ready.ticket.version });
  await rateTicket(deps, ticket.token, { clientId, stars: 5, comment: formula });
  let csv = '';
  for await (const chunk of ticketsCsv(deps, tenant.tenantId, { from: '2026-10-01', to: '2026-10-31' })) csv += chunk;
  assert.match(csv, /,=1\+1,/);
  emit({ probe: 'report-csv-formula', confirmed: true, formulaPreservedAsCell: true, csv });
  const e = await requestExport(deps, actor, tenant.tenantId);
  let zip: Buffer | null = null;
  const storage = { put: async (_b: unknown, _k: unknown, body: Buffer) => { zip = body; }, get: async () => null, signedUrl: async () => '', deletePrefix: async () => 0 };
  await buildExport(deps, tenant.tenantId, e.id, storage);
  assert.ok(zip);
  // Read the actual CSV from the controlled ZIP, decompressing deflated entries.
  const marker = Buffer.from('ratings.csv');
  const raw = zip as Buffer;
  let offset = 0;
  let ratingsCsv = '';
  while (raw.readUInt32LE(offset) === 0x04034b50) {
    const size = raw.readUInt32LE(offset + 18);
    const nameLen = raw.readUInt16LE(offset + 26);
    const extraLen = raw.readUInt16LE(offset + 28);
    const name = raw.subarray(offset + 30, offset + 30 + nameLen);
    const start = offset + 30 + nameLen + extraLen;
    if (name.equals(marker)) {
      const data = raw.subarray(start, start + size);
      ratingsCsv = (raw.readUInt16LE(offset + 8) === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset = start + size;
  }
  assert.match(ratingsCsv, /,=1\+1,/);
  emit({ probe: 'anonymous-rating-export-formula', confirmed: true, formulaPreservedAsCell: true, ratingsCsv, noRealMessagesSent: true });
  // A transient provider failure must not erase the only local pointer needed to retry erasure/cancellation.
  await t.clients.platform().updateTable('tenants').set({ status: 'deleted', stripe_customer_id: 'cus_controlled_fixture', deleted_at: deps.now() }).where('id', '=', tenant.tenantId).execute();
  let providerCalls = 0;
  const worker = { ...deps, storage, billing: { deleteCustomer: async () => { providerCalls++; throw new Error('controlled transient provider failure'); } } } as any;
  await JOB_HANDLERS['tenant.purge'](worker, { tenantId: tenant.tenantId });
  const remainingTenant = await t.clients.platform().selectFrom('tenants').select('id').where('id', '=', tenant.tenantId).executeTakeFirst();
  assert.equal(remainingTenant, undefined);
  await JOB_HANDLERS['tenant.purge'](worker, { tenantId: tenant.tenantId });
  assert.equal(providerCalls, 1);
  emit({ probe: 'provider-deletion-error-loses-retry', confirmed: true, handlerResolvedAfterProviderError: true, tenantRemoved: !remainingTenant, providerCallsAfterTwoJobRuns: providerCalls, noRealMessagesSent: true });
} finally { await t.stop(); }

await writeFile(new URL('./backend-security-probe-results.json', import.meta.url), JSON.stringify(results, null, 2));
