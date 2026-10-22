/* global fetch, Buffer */
// Refreshes packages/auth/data/breached-passwords.txt (TR-AUTH-04, L-3) from the top-100,000 list of the
// SecLists project at a pinned commit, checked against a pinned SHA-256. Only entries of 10+ characters are kept:
// shorter ones are already refused by the length rule. The output is committed, so builds never download it.
// Usage: node tools/fetch-breached-list.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '4c0fd59432ab8508edc23b3c880127edb12e34d5';
const URL_ = `https://raw.githubusercontent.com/danielmiessler/SecLists/${COMMIT}/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt`;
const SHA256 = '1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b';

const res = await fetch(URL_);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const body = Buffer.from(await res.arrayBuffer());
const got = createHash('sha256').update(body).digest('hex');
if (got !== SHA256) throw new Error(`checksum mismatch: expected ${SHA256}, got ${got}`);

const words = [...new Set(body.toString('utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l.length >= 10 && l.length <= 128))].sort();
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'auth', 'data', 'breached-passwords.txt');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${words.join('\n')}\n`);
console.log(`wrote ${words.length} entries to ${out}`);
