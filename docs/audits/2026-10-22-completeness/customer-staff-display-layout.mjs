import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1080, height: 1920 }]) {
    for (const showPreparing of [false, true]) {
      const page = await browser.newPage({ viewport: size, locale: 'en-US' });
      const ready = Array.from({ length: 24 }, (_, i) => ({ id: 't' + i, displayNumber: String(100 + i), status: 'ready', seq: 1, version: 1, counterId: null, readyAt: new Date(Date.now() - i * 60_000).toISOString() }));
      const board = { ready, preparing: [], counterIds: null, csrfToken: 'test', tenantStatus: 'active', serverTime: new Date().toISOString(), displayName: 'Audit TV', voices: {}, venueUrl: 'http://t.dop.localhost/v/AUDIT', venue: { name: 'Audit Venue', logoUrl: null, brandColor: '#1F6FEB', timeZone: 'Asia/Beirut' }, settings: { showPreparing, announce: { enabled: true, languages: ['en'], quietHours: [] }, qr: { show: true }, message: { en: 'Layout probe' }, promo: null } };
      await page.route('**/api/display/v1/board', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) }));
      await page.goto('http://127.0.0.1:5275/display/');
      await page.getByText('100', { exact: true }).waitFor();
      const enable = page.getByRole('button', { name: /enable sound/i });
      if (await enable.isVisible()) await enable.click();
      await page.evaluate(() => document.fonts.ready);
      // Current display styling animates the newest tile for 600ms; inspect settled geometry.
      await page.waitForTimeout(900);
      const geometry = await page.locator('[aria-labelledby="col-ready"] ul').evaluate((ul) => {
        const u = ul.getBoundingClientRect();
        const children = [...ul.children].map((c) => { const r = c.getBoundingClientRect(); return { number: c.textContent, top: r.top, bottom: r.bottom, left: r.left, right: r.right, fullyVisible: r.top >= u.top && r.bottom <= u.bottom && r.left >= u.left && r.right <= u.right }; });
        return { grid: { top: u.top, bottom: u.bottom, height: u.height, scrollHeight: ul.scrollHeight, overflow: getComputedStyle(ul).overflow }, fullyVisible: children.filter((c) => c.fullyVisible).length, clipped: children.filter((c) => !c.fullyVisible), children: children.length };
      });
      const name = `${size.width}x${size.height}-${showPreparing ? 'with-preparing' : 'ready-only'}`;
      await page.screenshot({ path: fileURLToPath(new URL(`./display-layout-${name}.png`, import.meta.url)) });
      results.push({ name, ...geometry, moreIndicatorPresent: await page.getByText(/\+\d+ more/).count() });
      await page.close();
    }
  }
} finally { await browser.close(); }
await fs.writeFile(new URL('./customer-staff-display-layout-results.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ name, fullyVisible, children, grid, moreIndicatorPresent }) => ({ name, fullyVisible, children, grid, moreIndicatorPresent })), null, 2));
