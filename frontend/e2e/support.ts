import AxeBuilder from '@axe-core/playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { expect, request, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

// Shared helpers for the journeys. Uses the seeded tenant `burger-house` (backend `npm run db:seed`).

export const DOMAIN = process.env.E2E_DOMAIN ?? 'dop.localhost';
const local = DOMAIN.endsWith('localhost');
const port = (p: number) => (local ? `:${p}` : '');
const scheme = local ? 'http' : 'https';
export const SLUG = process.env.E2E_SLUG ?? 'burger-house';
export const OWNER = { email: process.env.E2E_OWNER ?? `owner@${SLUG}.localhost`, password: process.env.E2E_PASSWORD ?? 'dev-password-123' };
export const PIN = process.env.E2E_PIN ?? '4821';

export const url = {
  customer: (path = '') => `${scheme}://t.${DOMAIN}${port(5173)}${path}`,
  staff: (path = '') => `${scheme}://${SLUG}.${DOMAIN}${port(5174)}/staff${path}`,
  display: (path = '') => `${scheme}://${SLUG}.${DOMAIN}${port(5175)}/display${path}`,
  admin: (path = '') => `${scheme}://${SLUG}.${DOMAIN}${port(5176)}/admin${path}`,
};

/** Signs in as the owner through the API and returns the staff link (journey 1 setup step). */
export async function staffLink(): Promise<string> {
  // Node does not resolve *.localhost on every OS (browsers do), so connect to the loopback with the tenant Host.
  const base = new URL(url.admin(''));
  const api = await request.newContext(
    local ? { baseURL: `http://127.0.0.1:${base.port}`, extraHTTPHeaders: { Host: base.host } } : { baseURL: base.origin },
  );
  const signIn = await api.post('/api/auth/v1/sign-in', { data: OWNER });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  const venues = await (await api.get('/api/admin/v1/venues')).json();
  const access = await (await api.get(`/api/admin/v1/venues/${venues.items[0].id}/staff-access`)).json();
  await api.dispose();
  return access.link as string;
}

/** Automated accessibility check for the current screen (TR-A11Y-05). */
export async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export async function signInStaff(page: Page, link: string, deviceName: string) {
  await page.goto(link.replace(/^https?:\/\/[^/]+/, url.staff('').replace(/\/staff$/, '')));
  const name = page.getByLabel('Device name');
  if (await name.isVisible().catch(() => false)) await name.fill(deviceName);
  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Open board' }).click();
  await expect(page.getByRole('button', { name: 'New ticket' })).toBeVisible();
}

const STATE = 'e2e/.auth/staff.json';

/**
 * A signed-in staff device, created once and reused like a real tablet (device sign-in is rate-limited,
 * TR-SEC-06/07). Returns context options carrying the device cookie.
 */
export async function staffDevice(browser: Browser): Promise<BrowserContextOptions> {
  if (!existsSync(STATE)) {
    mkdirSync('e2e/.auth', { recursive: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signInStaff(page, await staffLink(), 'E2E counter');
    await ctx.storageState({ path: STATE });
    await ctx.close();
  }
  return { storageState: STATE };
}
