// Read-only security reachability probes. No database, SMTP or network I/O.
// Run from backend/: node --import tsx ../docs/security/2026-10-22/supplychain-probes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../../../', import.meta.url);
const { uploadLogo } = await import(new URL('backend/packages/services/src/assets.ts', root));
const { createS3Storage } = await import(new URL('backend/packages/services/src/aws.ts', root));
const { emailSchema } = await import(new URL('backend/packages/contracts/src/api.ts', root));
const results = { context: 'Local, synthetic inputs; no external services used', checks: [] };
const record = (name, passed, detail) => {
  assert.equal(passed, true, name);
  results.checks.push({ name, passed, detail });
};

const avif = Buffer.alloc(32);
avif.writeUInt32BE(32, 0);
avif.write('ftypavif', 4);
const rejectedFormats = {
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
  gif: Buffer.from('GIF89a0101010101'),
  tiff: Buffer.from('49492a000800000000000000', 'hex'),
  avif,
  malformedPng: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
};
for (const [format, buffer] of Object.entries(rejectedFormats)) {
  let code;
  try { await uploadLogo({}, {}, {}, 'synthetic-tenant', 'synthetic-venue', buffer); }
  catch (error) { code = error.code; }
  record(`logo rejects ${format}`, code === 'UPLOAD_INVALID', { resultCode: code });
}

const storage = await createS3Storage({
  region: 'us-east-1', assetsBucket: 'synthetic-assets', exportsBucket: 'synthetic-exports',
  endpoint: 'https://internal.invalid', publicEndpoint: 'https://files.invalid',
  accessKeyId: 'SYNTHETIC_ROOT_ACCESS_ID', secretAccessKey: 'synthetic-not-a-secret',
  cdnBaseUrl: 'https://files.invalid/synthetic-assets',
});
const signed = new URL(await storage.signedUrl('exports', 'exports/synthetic-tenant/test.zip', 900));
record('presigned export reveals configured access ID',
  signed.searchParams.get('X-Amz-Credential')?.startsWith('SYNTHETIC_ROOT_ACCESS_ID/') === true,
  { scope: 'Access identifier only; query signature and synthetic secret are not recorded' });

for (const [name, value] of Object.entries({
  longAddressParserPayload: 'a'.repeat(273000),
  rawObject: { raw: { path: 'synthetic-file' } },
  nestedRecipientArray: [[['attacker@example.invalid']]],
  commentRecipient: 'user@example.invalid (comment)',
})) {
  record(`API email validation rejects ${name}`, !emailSchema.safeParse(value).success, { result: 'rejected' });
}

for (const dir of ['backend', 'frontend']) {
  const lock = JSON.parse(readFileSync(new URL(`${dir}/package-lock.json`, root), 'utf8'));
  const dependencies = Object.fromEntries(Object.entries(lock.packages)
    .filter(([path]) => ['sharp', 'nodemailer', 'vitest', 'tinypool', '@vitest/mocker'].some(name => path.endsWith(`node_modules/${name}`)))
    .map(([path, value]) => [path, { version: value.version, developmentOnly: value.dev === true }]));
  results[`${dir}AuditedPackages`] = dependencies;
}

const output = new URL('supplychain-probes-results.json', import.meta.url);
writeFileSync(output, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ checks: results.checks.length, passed: true, output: fileURLToPath(output) }));
