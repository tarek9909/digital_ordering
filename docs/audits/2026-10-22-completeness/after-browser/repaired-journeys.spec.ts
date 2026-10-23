import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, request, test, type APIRequestContext } from '../../../../frontend/node_modules/@playwright/test';

// Post-repair browser journeys (REMEDIATION.md: AS01, AS11, CSD10) on the isolated stack (stack.mts + Vite 5273–5278).
// Seeded demo data only; no external provider; nothing touches the developer's live stack.

const DOMAIN = 'dop.localhost';
const SLUG = 'burger-house';
const PASSWORD = 'dev-password-123'; // seeded demo password (services/src/seed.ts)
const OWNER = `owner@${SLUG}.localhost`;
const admin = (p = '') => `http://${SLUG}.${DOMAIN}:5276/admin${p}`;
const staff = (p = '') => `http://${SLUG}.${DOMAIN}:5274/staff${p}`;
const info = JSON.parse(readFileSync(process.env.STACK_INFO!, 'utf8')) as { platformUsers: Array<{ email: string; role: string; totpSecret: string }> };

/** RFC 6238 code for a base32 secret, `step` 30-second steps from now. */
function totp(secret: string, step = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + step));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function api(host: string) {
  return request.newContext({ baseURL: 'http://127.0.0.1:4400', extraHTTPHeaders: { Host: host } });
}
async function csrf(c: APIRequestContext) {
  return ((await (await c.get('/api/auth/v1/me')).json()) as { csrfToken: string }).csrfToken;
}
async function consoleAs(role: 'support' | 'super_admin', step: number) {
  const u = info.platformUsers.find((p) => p.role === role)!;
  const c = await api(`admin.${DOMAIN}`);
  // Codes are single-use (L-1): an earlier run may have spent this step's code, so try the next steps of the window.
  let ok = false;
  for (const s of [step, step + 1, step - 1]) {
    const first = await (await c.post('/api/auth/v1/sign-in', { data: { email: u.email, password: PASSWORD } })).json();
    if ((await c.post('/api/auth/v1/sign-in/mfa', { data: { mfaToken: first.mfaToken, code: totp(u.totpSecret, s) } })).ok()) {
      ok = true;
      break;
    }
  }
  expect(ok).toBeTruthy();
  return { c, token: await csrf(c) };
}
async function ownerApi() {
  const c = await api(`${SLUG}.${DOMAIN}`);
  expect((await c.post('/api/auth/v1/sign-in', { data: { email: OWNER, password: PASSWORD } })).ok()).toBeTruthy();
  const token = await csrf(c);
  const venueId = ((await (await c.get('/api/admin/v1/venues')).json()) as { items: Array<{ id: string }> }).items[0]!.id;
  return { c, token, venueId };
}

test('AS01 + CSD10: approved support → handoff → admin → live staff board, then access ends', async ({ browser }) => {
  const agent = await consoleAs('support', 0);
  const owner = await ownerApi();
  const purpose = { 'X-CSRF-Token': agent.token, 'X-Purpose': 'support' };
  const tenants = (await (await agent.c.get(`/api/console/v1/tenants?q=${SLUG}`, { headers: purpose })).json()) as { items: Array<{ id: string; slug: string }> };
  const tenantId = tenants.items.find((x) => x.slug === SLUG)!.id;
  const req = await agent.c.post(`/api/console/v1/tenants/${tenantId}/support-sessions`, { headers: purpose, data: { reason: 'Browser verification of support access', durationMinutes: 30 } });
  expect(req.status(), await req.text()).toBe(201);
  const sessionId = ((await req.json()) as { id: string }).id;
  expect((await owner.c.post(`/api/admin/v1/support-sessions/${sessionId}/approve`, { headers: { 'X-CSRF-Token': owner.token } })).ok()).toBeTruthy();
  const enter = (await (await agent.c.post(`/api/console/v1/support-sessions/${sessionId}/enter`, { headers: purpose })).json()) as { url: string };
  const handoff = new URL(enter.url);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(admin(`/support-handoff${handoff.search}`));
  // AS01: the admin area renders for the support identity instead of crashing.
  await expect(page.getByText('You are in an approved support session for this account.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Leave support/i })).toBeVisible();
  expect(errors).toEqual([]);

  // CSD10: the staff board connects live with the support cookie and receives a new ticket without reloading.
  const board = await ctx.newPage();
  await board.goto(staff(`/?venueId=${owner.venueId}`));
  await expect(board.getByRole('heading', { name: /Preparing|Received|New/i }).first()).toBeVisible();
  await expect(board.getByText(/offline|reconnect/i)).toHaveCount(0, { timeout: 15_000 });
  const created = await owner.c.post(`/api/staff/v1/tickets?venueId=${owner.venueId}`, { headers: { 'X-CSRF-Token': owner.token }, data: { note: 'support-live-check' } });
  expect(created.status(), await created.text()).toBe(201);
  const number = ((await created.json()) as { ticket: { displayNumber: string } }).ticket.displayNumber;
  await expect(board.getByText(number, { exact: true }).first()).toBeVisible();

  // The agent ends the session: the board loses live access and the admin area no longer accepts the cookie.
  expect((await agent.c.post(`/api/console/v1/support-sessions/${sessionId}/end`, { headers: purpose })).ok()).toBeTruthy();
  await expect(board.getByText(/offline|signed out|sign in|reconnect/i).first()).toBeVisible({ timeout: 30_000 });
  // The kept support cookie is refused by the API too (Node cannot resolve *.localhost, so go to the loopback).
  const sup = (await ctx.cookies()).find((k) => k.name === 'dop_sup')!;
  const check = await request.newContext({ baseURL: 'http://127.0.0.1:4400', extraHTTPHeaders: { Host: `${SLUG}.${DOMAIN}`, Cookie: `dop_sup=${sup.value}` } });
  expect((await check.get('/api/auth/v1/me')).status()).toBe(401);
  expect((await check.get(`/api/staff/v1/board?venueId=${owner.venueId}`)).status()).toBe(401);
  await ctx.close();
});

test('AS11: owner enrols and removes two-factor through the Account form, with the required proof', async ({ page }) => {
  await page.goto(admin('/sign-in'));
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/admin') && !u.pathname.includes('sign-in'));
  await page.goto(admin('/account'));
  // A wrong password stays on the field and can be corrected.
  await page.getByLabel('Confirm with your password').fill('not-the-password');
  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  await expect(page.getByText('The password is incorrect.')).toBeVisible();
  await page.getByLabel('Confirm with your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  const secret = (await page.locator('code').filter({ hasText: /^[A-Z2-7]{16,}$/ }).first().textContent())!.trim();
  await page.getByLabel('6-digit code').fill(totp(secret, -1));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('Two-factor is on')).toBeVisible();
  // Removal needs a current code: a wrong one is refused on the field, a right one turns it off.
  await page.getByLabel('6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Turn off two-factor' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off two-factor' }).click();
  await expect(page.getByText('Enter the 6-digit code.')).toBeVisible();
  await page.getByLabel('6-digit code').fill(totp(secret, 0));
  await page.getByRole('button', { name: 'Turn off two-factor' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off two-factor' }).click();
  await expect(page.getByText('Two-factor is off')).toBeVisible();
});
