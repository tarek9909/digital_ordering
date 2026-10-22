// From repository root: node docs/audits/2026-10-22/browser-crawl.mjs
// Requires runtime-server.mts on :4400 and the six Vite dev servers on :5173-5178.
// All browser API requests are forwarded to the disposable audit API, not the user's database.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const requireFrontend = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const requireBackend = createRequire(new URL('../../../backend/package.json', import.meta.url));
const { chromium, request } = requireFrontend('@playwright/test');
const { authenticator } = requireBackend('otplib');
const evidence = new URL('../../../frontend/test-results/application-audit-crawl/', import.meta.url);
await mkdir(evidence, { recursive: true });
const out = [];
const browser = await chromium.launch();
const proxy = await request.newContext();
const contexts = [];
const clients = [];
const password = 'dev-password-123';

async function apiClient(host) {
  const client = await request.newContext({ baseURL: 'http://127.0.0.1:4400', extraHTTPHeaders: { Host: host } });
  clients.push(client);
  return client;
}
async function login(host, email, secret) {
  const client = await apiClient(host);
  const first = await client.post('/api/auth/v1/sign-in', { data: { email, password } });
  const body = await first.json();
  if (!first.ok()) throw new Error(`Sign-in failed ${host}: ${first.status()} ${JSON.stringify(body)}`);
  if (body.mfaRequired) {
    const second = await client.post('/api/auth/v1/sign-in/mfa', { data: { mfaToken: body.mfaToken, code: authenticator.generate(secret) } });
    if (!second.ok()) throw new Error(`MFA failed ${second.status()}`);
  }
  const me = await (await client.get('/api/auth/v1/me')).json();
  client.csrf = me.csrfToken;
  return client;
}
async function context(client, host) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  contexts.push(ctx);
  await ctx.addInitScript(() => {
    for (const app of ['admin', 'console', 'site', 'staff']) localStorage.setItem(`dop.${app}.lang`, 'en');
  });
  if (client) {
    const state = await client.storageState();
    await ctx.addCookies(state.cookies.map((c) => ({ ...c, domain: host, secure: false })));
  }
  await ctx.route('**/api/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const headers = { ...req.headers(), host: u.host, 'x-forwarded-host': u.host, cookie: req.headers().cookie ?? '' };
    delete headers['content-length'];
    try {
      const response = await proxy.fetch(`http://127.0.0.1:4400${u.pathname}${u.search}`, {
        method: req.method(), headers, data: req.postDataBuffer() ?? undefined, failOnStatusCode: false,
      });
      await route.fulfill({ response });
    } catch (e) { await route.abort().catch(() => {}); }
  });
  return ctx;
}
async function inspect(ctx, name, url, options = {}) {
  const page = await ctx.newPage();
  const errors = [];
  const failures = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    if (options.action) await options.action(page);
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, evidence)), fullPage: true });
    const text = await page.locator('body').innerText();
    const result = { name, url: new URL(page.url()).pathname, headings: await page.getByRole('heading').allTextContents(), errors, failures, text: text.slice(0, 5500) };
    out.push(result);
    console.log(JSON.stringify({ name, headings: result.headings, errors, failures }));
    if (options.keep) return page;
  } catch (e) { out.push({ name, error: String(e), errors, failures }); console.log(JSON.stringify({ name, error: String(e) })); }
  await page.close();
}

try {
  const adminHost = 'burger-house.dop.localhost';
  const owner = await login(adminHost, 'owner@burger-house.localhost');
  const admin = await context(owner, adminHost);
  const venues = await (await owner.get('/api/admin/v1/venues')).json();
  const venue = venues.items[0];
  const adminPaths = ['', 'venues', 'venue', 'counters', 'staff-access', 'displays', 'posters', 'reports', 'reports?tab=heatmap', 'reports?tab=daily', 'ratings', 'team', 'integrations', 'support', 'billing', 'settings', 'account', 'posters/print?venueId=' + venue.id];
  for (const path of adminPaths) await inspect(admin, `admin-${path.split('?')[0].replaceAll('/', '-') || 'home'}${path.includes('tab=') ? '-' + path.split('tab=')[1] : ''}`, `http://${adminHost}:5176/admin/${path}`);

  const consoleHost = 'admin.dop.localhost';
  const superAdmin = await login(consoleHost, 'super@dop.localhost', 'JBSWY3DPEHPK3PXP');
  const consoleCtx = await context(superAdmin, consoleHost);
  const tenants = await (await superAdmin.get('/api/console/v1/tenants')).json();
  const tenant = tenants.items.find((t) => t.slug === 'burger-house') ?? tenants.items[0];
  await consoleCtx.addInitScript((id) => sessionStorage.setItem(`dop.console.purpose.${id}`, JSON.stringify({ purpose: 'support', at: Date.now() })), tenant.id);
  for (const path of ['tenants', 'tenants/new', `tenants/${tenant.id}`, 'platform-users', 'settings', 'audit', 'reports/pilot', 'reports/platform', 'plans', 'announcements', 'content']) await inspect(consoleCtx, `console-${path.replaceAll('/', '-')}`, `http://${consoleHost}:5177/${path}`);
  const detail = await inspect(consoleCtx, 'console-tenant-tabs', `http://${consoleHost}:5177/tenants/${tenant.id}`, { keep: true });
  if (detail) {
    for (const tab of ['Venues', 'Billing', 'Notes', 'Support', 'Feature flags', 'Audit']) {
      const target = detail.getByRole('tab', { name: tab, exact: true });
      if (await target.count()) {
        await target.click();
        await detail.waitForLoadState('networkidle');
        out.push({ name: 'console-tab-' + tab, text: (await detail.locator('body').innerText()).slice(0, 5000) });
      }
    }
    await detail.close();
  }

  const site = await context(null);
  for (const path of ['', 'pricing', 'contact', 'sign-up', 'sign-in', 'forgot-password', 'reset-password', 'verify-email', 'legal/terms', 'legal/privacy', 'legal/dpa', 'unknown-page']) await inspect(site, 'site-' + (path.replaceAll('/', '-') || 'home'), `http://www.dop.localhost:5178/${path}`);

  const access = await (await owner.get(`/api/admin/v1/venues/${venue.id}/staff-access`)).json();
  const staffClient = await apiClient(adminHost);
  const signIn = await staffClient.post('/api/staff/v1/sessions', { data: { staffKey: access.link.split('/staff/')[1], pin: '4821', deviceName: 'Audit counter' } });
  if (!signIn.ok()) throw new Error(`Staff sign-in ${signIn.status()}`);
  const staffCtx = await context(staffClient, adminHost);
  await inspect(staffCtx, 'staff-board', `http://${adminHost}:5174/staff/`);
  await inspect(staffCtx, 'staff-device', `http://${adminHost}:5174/staff/device`);
  const unauth = await context(null);
  await inspect(unauth, 'staff-sign-in', access.link);

  const displayClient = await apiClient(adminHost);
  const displays = await (await owner.get(`/api/admin/v1/venues/${venue.id}/displays`)).json();
  const code = await (await owner.post(`/api/admin/v1/displays/${displays.items[0].id}/pairing-code`, { headers: { 'X-CSRF-Token': owner.csrf }, data: {} })).json();
  const pair = await displayClient.post('/api/display/v1/pair', { data: { code: code.code } });
  if (!pair.ok()) throw new Error(`Display pair ${pair.status()}`);
  const displayCtx = await context(displayClient, adminHost);
  await inspect(unauth, 'display-pairing', `http://${adminHost}:5175/display/`);
  await inspect(displayCtx, 'display-board', `http://${adminHost}:5175/display/`);

  const board = await (await staffClient.get('/api/staff/v1/board')).json();
  const customer = await context(null);
  for (const t of [...board.open, ...board.recent]) await inspect(customer, `customer-${t.status}-${t.id.slice(-5)}`, `http://t.dop.localhost:5173/${t.token}`);
  await inspect(customer, 'customer-my-tickets', 'http://t.dop.localhost:5173/tickets');
  await inspect(customer, 'customer-privacy', 'http://t.dop.localhost:5173/privacy');
  await inspect(customer, 'customer-venue', `http://t.dop.localhost:5173/v/${venue.venue_code}`);
  await inspect(customer, 'customer-invalid-token', 'http://t.dop.localhost:5173/invalid');
  for (const icon of ['icon-192.png', 'icon-512.png', 'badge-72.png']) {
    const response = await proxy.get('http://127.0.0.1:5173/' + icon, { headers: { Host: 't.dop.localhost' } });
    out.push({ name: 'asset-' + icon, status: response.status(), contentType: response.headers()['content-type'] });
  }
  const failedCustomer = await context(null);
  await failedCustomer.route('**/api/public/v1/tickets/*', (route) => route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', title: 'Unexpected error' }) }));
  await inspect(failedCustomer, 'customer-initial-api-500', 'http://t.dop.localhost:5173/' + 'A'.repeat(22), { action: async (page) => {
    await page.waitForResponse((r) => r.url().includes('/api/public/v1/tickets/') && r.status() === 500).catch(() => {});
  } });
} catch (e) { out.push({ name: 'crawl-fatal', error: String(e) }); console.error(e); }
finally {
  await writeFile(new URL('browser-crawl.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  for (const ctx of contexts) await ctx.close();
  for (const client of clients) await client.dispose();
  await proxy.dispose();
  await browser.close();
}
