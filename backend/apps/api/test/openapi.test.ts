import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/openapi.js';
import { v1Routes } from '../src/routes/v1.js';

// Contract test (TR-API-08, TR-INT-05): the committed document must match the implementation. Regenerate with
// `npm run openapi` and review the diff; removing or changing a field is a breaking change that needs /v2.
describe('integration API contract', () => {
  const doc = buildOpenApi();

  it('documents every /v1 route', () => {
    for (const d of v1Routes.defs) {
      const path = `/v1${d.path}`.replace(/:(\w+)/g, '{$1}');
      expect(doc.paths?.[path]?.[d.method], `${d.method} ${path}`).toBeTruthy();
    }
  });

  it('matches docs/openapi/v1.json', () => {
    const committed = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'openapi', 'v1.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify(doc))).toEqual(committed);
  });
});
