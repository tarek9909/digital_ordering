import { expect, test, type Page } from '@playwright/test';
import { staffDevice, url } from './support';

// Browser journeys for the customer-page recovery fixes (docs/audits/2026-10-22 A24, A28, A29, W13, W14).

const card = (staff: Page, number: string) => staff.getByRole('article').filter({ has: staff.getByText(number, { exact: true }) });

async function showColumn(staff: Page, name: 'Preparing' | 'Ready') {
  const tab = staff.getByRole('tab', { name: new RegExp(`^${name}`) });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

async function createTicket(staff: Page): Promise<{ number: string; ticketUrl: string }> {
  await staff.getByRole('button', { name: 'New ticket' }).click();
  const created = staff.waitForResponse((r) => r.url().endsWith('/api/staff/v1/tickets') && r.request().method() === 'POST');
  await staff.getByRole('button', { name: 'Create ticket' }).click();
  const body = await (await created).json();
  return { number: body.ticket.displayNumber as string, ticketUrl: body.qr as string };
}

const customerUrl = (ticketUrl: string) => ticketUrl.replace(/^https?:\/\/[^/]+/, url.customer(''));

test('A24 + W13: a staff reopen reaches the still-open page after collection; the closed page links to the venue', async ({ browser }) => {
  const staffCtx = await browser.newContext(await staffDevice(browser));
  const staff = await staffCtx.newPage();
  await staff.goto(url.staff('/'));
  const { number, ticketUrl } = await createTicket(staff);
  await staff.keyboard.press('Escape');

  const phoneCtx = await browser.newContext({ locale: 'en-US' });
  const phone = await phoneCtx.newPage();
  await phone.goto(customerUrl(ticketUrl));
  await expect(phone.getByText('Your order is being prepared').first()).toBeVisible();

  await card(staff, number).getByRole('button', { name: 'Ready' }).click();
  await expect(phone.getByText('Your order is ready!').first()).toBeVisible({ timeout: 5_000 });
  await showColumn(staff, 'Ready');
  await card(staff, number).getByRole('button', { name: 'Collected' }).click();
  await expect(phone.getByText('Enjoy!').first()).toBeVisible({ timeout: 5_000 });

  // FR-CUS-11: final status plus a way back to the venue page.
  const back = phone.getByRole('link', { name: /^Back to / });
  await expect(back).toBeVisible();
  expect(await back.getAttribute('href')).toMatch(/^\/v\/[^/]+$/);

  // Staff reopen from Recent: no push on this page, so only the kept socket can deliver it.
  await staff.getByRole('button', { name: 'Recent' }).click();
  const recent = staff.getByRole('dialog', { name: 'Recent' });
  await recent.getByRole('button', { name: 'Reopen' }).first().click();
  await expect(phone.getByText('Your order is ready!').first()).toBeVisible({ timeout: 5_000 });

  await staffCtx.close();
  await phoneCtx.close();
});

test('W14: the ticket manifest is linked after SPA navigation from /tickets', async ({ browser }) => {
  const staffCtx = await browser.newContext(await staffDevice(browser));
  const staff = await staffCtx.newPage();
  await staff.goto(url.staff('/'));
  const { number, ticketUrl } = await createTicket(staff);
  await staffCtx.close();

  const phoneCtx = await browser.newContext({ locale: 'en-US' });
  const phone = await phoneCtx.newPage();
  const token = new URL(ticketUrl).pathname.slice(1);
  await phone.goto(customerUrl(ticketUrl));
  await expect(phone.getByText(number, { exact: true }).first()).toBeVisible();
  // Start from the list page (no manifest), then open the ticket in-app.
  await phone.goto(url.customer('/tickets'));
  await expect(phone.locator('link[rel="manifest"]')).toHaveCount(0);
  await phone.getByRole('link', { name: new RegExp(number) }).first().click();
  await expect(phone.getByText(number, { exact: true }).first()).toBeVisible();
  await expect(phone.locator('link[rel="manifest"]')).toHaveAttribute('href', `/m/${token}.webmanifest`);
  // Fetched from the page: Node does not resolve *.localhost on every OS (see support.ts).
  const manifest = await phone.evaluate(async (href) => {
    const r = await fetch(href);
    const m = (await r.json()) as { id: string; icons: Array<{ src: string }> };
    const icons = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).headers.get('content-type')));
    return { ok: r.ok, id: m.id, icons };
  }, `/m/${token}.webmanifest`);
  expect(manifest.ok).toBeTruthy();
  expect(manifest.id).toBe(`/${token}`);
  for (const type of manifest.icons) expect(type).toContain('image/png');
  await phoneCtx.close();
});

test('A28: a failing ticket API shows an error with retry instead of loading forever', async ({ browser }) => {
  const phoneCtx = await browser.newContext({ locale: 'en-US' });
  const phone = await phoneCtx.newPage();
  let fail = true;
  await phone.route('**/api/public/v1/tickets/*', (route) =>
    fail && route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{"code":"INTERNAL_ERROR","status":500,"title":"x","type":"about:blank"}' }) : route.continue(),
  );
  await phone.goto(url.customer('/AAAAAAAAAAAAAAAAAAAAAA'));
  await expect(phone.getByText('Could not load your order')).toBeVisible({ timeout: 15_000 });
  fail = false;
  await phone.getByRole('button', { name: 'Try again' }).click();
  // The token does not exist, so the honest outcome after the retry is "not found", not a spinner.
  await expect(phone.getByText('Ticket not found')).toBeVisible();
  await phoneCtx.close();
});

test('A29: icons are served as real PNG images', async ({ page }) => {
  await page.goto(url.customer('/privacy'));
  for (const name of ['icon-192.png', 'icon-512.png', 'badge-72.png']) {
    const r = await page.evaluate(async (p) => {
      const res = await fetch(p);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { ok: res.ok, type: res.headers.get('content-type') ?? '', magic: String.fromCharCode(...bytes.slice(1, 4)) };
    }, `/${name}`);
    expect(r.ok, name).toBeTruthy();
    expect(r.type, name).toContain('image/png');
    expect(r.magic, name).toBe('PNG');
  }
});

test('W12: the privacy page shows the published notice, or the built-in text when none is published', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  const legal = page.waitForResponse((r) => r.url().includes('/api/public/v1/legal/customer_privacy'));
  await page.goto(url.customer('/privacy'));
  const res = await legal;
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible();
  if (res.ok() && (await res.json()).html) await expect(page.getByText(/^Version .+ · published /)).toBeVisible();
  else await expect(page.getByText(/This page shows your order status/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await ctx.close();
});
