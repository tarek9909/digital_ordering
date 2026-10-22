import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, staffDevice, url } from './support';

// Journeys 1 and 3 (TRD §26.1) across the staff board and the customer page, in separate browser contexts
// (different devices). Journeys 2, 4–12 are covered at API level in backend/apps/api/test and
// backend/packages/services/test; their browser versions are added as the screens stabilise.

const card = (staff: Page, number: string) => staff.getByRole('article').filter({ has: staff.getByText(number, { exact: true }) });

/** On phones the board shows one column at a time (tabs with counts). */
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

test('journey 1: ticket → customer page → Ready → acknowledgement → Collected', async ({ browser }) => {
  const staffCtx = await browser.newContext(await staffDevice(browser));
  const staff = await staffCtx.newPage();
  await staff.goto(url.staff('/'));
  await expect(staff.getByRole('button', { name: 'New ticket' })).toBeVisible();
  await expectAccessible(staff);

  const { number, ticketUrl } = await createTicket(staff);
  // The full-screen QR closes when the phone follows the ticket (FR-QR-01).
  await expect(staff.getByRole('dialog', { name: new RegExp(`QR code for order ${number}`) })).toBeVisible();

  const phoneCtx = await browser.newContext({ locale: 'en-US' });
  const phone = await phoneCtx.newPage();
  await phone.goto(ticketUrl.replace(/^https?:\/\/[^/]+/, url.customer('')));
  await expect(phone.getByText(number, { exact: true }).first()).toBeVisible();
  await expect(phone.getByText('Your order is being prepared').first()).toBeVisible();
  await expect(staff.getByRole('dialog', { name: new RegExp(`QR code for order ${number}`) })).toBeHidden();
  await expectAccessible(phone);

  // Ready on the board → the phone switches to the Ready screen within a second or two (TR-NFR-01).
  await card(staff, number).getByRole('button', { name: 'Ready' }).click();
  await expect(phone.getByText('Your order is ready!').first()).toBeVisible({ timeout: 5_000 });
  const tap = phone.getByRole('button', { name: /Tap to hear your alert/ });
  if (await tap.isVisible().catch(() => false)) await tap.click();
  await phone.getByRole('button', { name: "I'm coming" }).click();
  await expect(phone.getByText('See you at the counter').first()).toBeVisible();
  await showColumn(staff, 'Ready');
  await expect(card(staff, number).getByText('Coming')).toBeVisible();

  await card(staff, number).getByRole('button', { name: 'Collected' }).click();
  await expect(phone.getByText('Enjoy!').first()).toBeVisible({ timeout: 5_000 });
  await staffCtx.close();
  await phoneCtx.close();
});

test('journey 3: Undo Ready within 10 s; the customer sees "not ready yet"', async ({ browser }) => {
  const staffCtx = await browser.newContext(await staffDevice(browser));
  const staff = await staffCtx.newPage();
  await staff.goto(url.staff('/'));
  const { number, ticketUrl } = await createTicket(staff);
  await staff.keyboard.press('Escape');
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(ticketUrl.replace(/^https?:\/\/[^/]+/, url.customer('')));
  await card(staff, number).getByRole('button', { name: 'Ready' }).click();
  await expect(phone.getByText('Your order is ready!').first()).toBeVisible({ timeout: 5_000 });
  await staff.getByRole('button', { name: 'Undo' }).click();
  await expect(phone.getByText('Your order is being prepared').first()).toBeVisible({ timeout: 5_000 });
  await expect(phone.getByText('The order went back to preparing').first()).toBeVisible();
  await staffCtx.close();
});
