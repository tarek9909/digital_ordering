// Initial-route JS budgets (TR-FE-05), gzipped: customer ≤ 120 KB, staff ≤ 200 KB, display ≤ 150 KB,
// admin and console ≤ 350 KB. Measures the entry chunk(s) referenced by each app's dist/index.html.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGETS = { 'web-customer': 120, 'web-staff': 200, 'web-display': 150, 'web-admin': 350, 'web-console': 350, 'web-site': 200 };
let failed = false;
for (const [app, kb] of Object.entries(BUDGETS)) {
  const dist = join(root, 'apps', app, 'dist');
  const html = join(dist, 'index.html');
  if (!existsSync(html)) {
    console.log(`${app}: not built, skipped`);
    continue;
  }
  const scripts = [...readFileSync(html, 'utf8').matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  let total = 0;
  for (const src of scripts) {
    const file = join(dist, src.replace(/^\/(staff|display|admin)\//, '/').replace(/^\//, ''));
    if (existsSync(file)) total += gzipSync(readFileSync(file)).length;
  }
  const size = total / 1024;
  const ok = size <= kb;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${app}: ${size.toFixed(1)} KB gzipped (budget ${kb} KB)`);
}
process.exit(failed ? 1 : 0);
