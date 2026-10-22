// Copies backend/packages/contracts/src to frontend/packages/contracts/src (Implementation Plan §18).
// `--check` exits non-zero when the copy differs, so CI fails on drift.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'backend', 'packages', 'contracts', 'src');
const dst = join(root, 'frontend', 'packages', 'contracts', 'src');
const HEADER = '// GENERATED from backend/packages/contracts/src by `npm run sync:contracts` in backend/. Do not edit.\n';
const check = process.argv.includes('--check');

const files = readdirSync(src).filter((f) => f.endsWith('.ts'));
let drift = [];
if (!check) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
}
for (const f of files) {
  const want = HEADER + readFileSync(join(src, f), 'utf8');
  if (check) {
    let have = '';
    try {
      have = readFileSync(join(dst, f), 'utf8');
    } catch {}
    if (have !== want) drift.push(f);
  } else {
    writeFileSync(join(dst, f), want);
  }
}
if (check) {
  const extra = (() => {
    try {
      return readdirSync(dst).filter((f) => !files.includes(f));
    } catch {
      return [];
    }
  })();
  drift = drift.concat(extra);
  if (drift.length) {
    console.error(`frontend contracts differ from backend: ${drift.join(', ')}. Run \`npm run sync:contracts\` in backend/.`);
    process.exit(1);
  }
  console.log('contracts in sync');
} else {
  console.log(`copied ${files.length} files to ${dst}`);
}
