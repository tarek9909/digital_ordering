import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from '../apps/api/src/openapi.js';

// `npm run openapi`: writes docs/openapi/v1.json (published at https://docs.{domain}, TR-API-08).
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'openapi', 'v1.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`wrote ${out}`);
