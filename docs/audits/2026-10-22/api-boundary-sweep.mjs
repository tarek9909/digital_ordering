// Runs every declared route anonymously against the disposable API on :4400.
// This checks route/error/auth boundaries, not successful business workflows.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { request } = require('@playwright/test');
const groups = JSON.parse((await readFile(new URL('backend-route-registry.json', import.meta.url), 'utf8')).replace(/^\ufeff/, ''));
const host = { customer: 't.dop.localhost', www: 'www.dop.localhost', tenant: 'burger-house.dop.localhost', console: 'admin.dop.localhost', integration: 'api.dop.localhost' };
const value = { token: 'X'.repeat(22), venueCode: 'AAAAAA', slug: 'available-audit-slug', kind: 'terms', key: 'maintenance', provider: 'foodics', code: 'en', deliveryId: '1', template: 'welcome', locale: 'en' };
const rows = [];
for (const group of groups) for (const route of group.routes) {
  const path = (group.prefix + route.path).replace(/:([A-Za-z_]+)/g, (_, k) => value[k] ?? '00000000-0000-7000-8000-000000000001');
  // A fresh cookie jar ensures even public sign-out cannot affect a different probe.
  const api = await request.newContext({ baseURL: 'http://127.0.0.1:4400', extraHTTPHeaders: { Host: host[route.surfaces[0]] } });
  try {
    const response = await api.fetch(path, { method: route.method.toUpperCase(), ...(route.method !== 'get' && { data: {} }), failOnStatusCode: false });
    const body = await response.json().catch(() => null);
    rows.push({ method: route.method.toUpperCase(), path: group.prefix + route.path, surface: route.surfaces[0], permission: route.permission, status: response.status(), code: body?.code ?? null, scope: 'anonymous boundary only' });
  } catch (e) { rows.push({ method: route.method.toUpperCase(), path, error: String(e) }); }
  await api.dispose();
}
await writeFile(new URL('api-boundary-results.json', import.meta.url), JSON.stringify(rows, null, 2) + '\n');
console.log(JSON.stringify({ routes: rows.length, byStatus: rows.reduce((a, r) => ({ ...a, [r.status ?? 'error']: (a[r.status ?? 'error'] ?? 0) + 1 }), {}), unexpected: rows.filter((r) => r.error || r.status >= 500 || (r.permission !== 'public' && r.status < 400)) }, null, 2));
