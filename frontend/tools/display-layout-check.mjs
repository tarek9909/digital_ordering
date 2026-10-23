// Display layout check in real Chromium (CSD03, FR-DSP-02/03/07). Starts the display app's Vite dev server, serves
// a controlled board snapshot, and for each viewport/setting asserts that:
//   - every rendered Ready (and Preparing) tile lies completely inside its visible list, and its number fits the tile;
//   - when not every Ready ticket is on screen, the overflow is indicated ("Page x of y", "+n more");
//   - rotating through the pages shows every Ready number (oldest-first fairness);
//   - a promo never overlaps the Ready column and stays on screen.
// Screenshots and per-scenario geometry go to docs/audits/2026-10-22-completeness/after/ (or the folder given as
// the first argument). Exits non-zero when any assertion fails.
//
// Usage (from frontend/): node tools/display-layout-check.mjs [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const outDir = path.resolve(process.argv[2] ?? path.join(frontend, '..', 'docs', 'audits', '2026-10-22-completeness', 'after'));
const require = createRequire(path.join(frontend, 'package.json'));
const { chromium } = require('@playwright/test');
const { createServer } = await import('vite');

const PAGE_MS = 8_000; // READY_PAGE_MS in apps/web-display/src/lib/board.ts

const server = await createServer({
  configFile: path.join(frontend, 'apps', 'web-display', 'vite.config.ts'),
  root: path.join(frontend, 'apps', 'web-display'),
  logLevel: 'warn',
  server: { port: 5295, strictPort: false, host: '127.0.0.1' },
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
await fs.mkdir(outDir, { recursive: true });

const promo = { text: { en: 'Coffee of the day: cardamom latte' }, imageUrl: null };
const scenarios = [];
for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1080, height: 1920 },
]) {
  for (const showPreparing of [false, true]) {
    scenarios.push({ size, showPreparing, ready: 24, preparing: showPreparing ? 14 : 0, promo: null, tag: '' });
  }
  // Promo: with Preparing it sits in that column; without, a strip only while everything fits above it.
  scenarios.push({ size, showPreparing: true, ready: 24, preparing: 6, promo, tag: '-promo' });
  scenarios.push({ size, showPreparing: false, ready: 4, preparing: 0, promo, tag: '-promo-few' });
  scenarios.push({ size, showPreparing: false, ready: 24, preparing: 0, promo, tag: '-promo-many' });
}
// Long display numbers (counter prefix) at the narrowest tile.
scenarios.push({ size: { width: 1280, height: 720 }, showPreparing: true, ready: 30, preparing: 3, promo: null, tag: '-prefixed', prefix: 'B' });

const browser = await chromium.launch({ headless: true });
const results = [];
let failures = 0;
try {
  for (const sc of scenarios) {
    const name = `${sc.size.width}x${sc.size.height}-${sc.showPreparing ? 'with-preparing' : 'ready-only'}${sc.tag}`;
    const page = await browser.newPage({ viewport: sc.size, locale: 'en-US' });
    await page.clock.install({ time: new Date('2026-10-22T12:00:00Z') });
    const now = Date.parse('2026-10-22T12:00:00Z');
    const num = (i) => `${sc.prefix ?? ''}${100 + i}`;
    // t0 became ready just now (highlighted and pinned for 10 s); the rest are older.
    const ready = Array.from({ length: sc.ready }, (_, i) => ({ id: 't' + String(i).padStart(2, '0'), displayNumber: num(i), status: 'ready', seq: 1, version: 1, counterId: null, readyAt: new Date(now - i * 60_000).toISOString() }));
    const preparing = Array.from({ length: sc.preparing }, (_, i) => ({ id: 'p' + i, displayNumber: `${sc.prefix ?? ''}${200 + i}`, status: 'preparing', seq: 1, version: 1, counterId: null, readyAt: null }));
    const board = {
      ready,
      preparing,
      counterIds: null,
      csrfToken: 'test',
      tenantStatus: 'active',
      serverTime: new Date(now).toISOString(),
      displayName: 'Layout TV',
      voices: {},
      venueUrl: 'http://t.dop.localhost/v/LAYOUT',
      venue: { name: 'Layout Venue', logoUrl: null, brandColor: '#1F6FEB', timeZone: 'Asia/Beirut', chime: 'default', chimeUrl: null },
      settings: { showPreparing: sc.showPreparing, announce: { enabled: true, languages: ['en'], quietHours: [] }, qr: { show: true }, message: { en: 'Layout check' }, promo: sc.promo },
    };
    await page.route('**/api/display/v1/board', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) }));
    // No realtime server: the socket is refused (the board shows its reconnecting badge, as an offline TV would).
    await page.route('**/rt/**', (r) => r.abort());
    await page.routeWebSocket('**/rt/**', (ws) => ws.close());
    await page.goto(`${base}/display/`);
    await page.locator('[aria-labelledby="col-ready"] li').first().waitFor();
    const enable = page.getByRole('button', { name: /enable sound/i });
    if (await enable.isVisible()) await enable.click();
    await page.evaluate(() => document.fonts.ready);
    // Let the 600 ms Ready animation and the post-layout re-measure settle.
    await page.clock.runFor(2_000);
    await page.waitForTimeout(300);

    const measure = () =>
      page.evaluate(() => {
        // Inspect settled geometry: the one-shot 600 ms "ready-pop" of the newest tile overshoots to 104 %.
        for (const a of document.getAnimations()) if (a.animationName === 'ready-pop') a.finish();
        const inside = (r, u) => r.top >= u.top - 0.5 && r.bottom <= u.bottom + 0.5 && r.left >= u.left - 0.5 && r.right <= u.right + 0.5;
        const list = (sel) => {
          const ul = document.querySelector(sel);
          if (!ul) return null;
          const u = ul.getBoundingClientRect();
          const tiles = [...ul.children].map((c) => {
            const r = c.getBoundingClientRect();
            // The number's own glyph box (not scrollWidth, which counts the highlight's decorative glow).
            const range = document.createRange();
            range.selectNodeContents(c);
            const g = range.getBoundingClientRect();
            const box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
            return { number: c.textContent, top: r.top, bottom: r.bottom, left: r.left, right: r.right, fullyVisible: inside(r, u) && inside(r, { top: 0, left: 0, bottom: innerHeight, right: innerWidth }), textFits: g.left >= box.left - 0.5 && g.right <= box.right + 0.5 };
          });
          return { grid: { top: u.top, bottom: u.bottom, height: u.height, scrollHeight: ul.scrollHeight }, tiles };
        };
        const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
        return {
          ready: list('[aria-labelledby="col-ready"] ul'),
          preparing: list('[aria-labelledby="col-preparing"] ul'),
          overflow: document.querySelector('[data-testid="ready-overflow"]')?.textContent ?? null,
          preparingMore: document.querySelector('[aria-labelledby="col-preparing"] > p')?.textContent ?? null,
          readySection: rect(document.querySelector('[aria-labelledby="col-ready"]')),
          promo: rect(document.querySelector('aside')),
        };
      });

    const first = await measure();
    await page.screenshot({ path: path.join(outDir, `display-${name}.png`) });
    const errors = [];
    const r = first.ready;
    const clipped = r.tiles.filter((x) => !x.fullyVisible);
    if (clipped.length) errors.push(`${clipped.length} Ready tile(s) not fully visible: ${clipped.map((x) => `${x.number}@${[x.top, x.left, x.bottom, x.right].map((v) => v.toFixed(1))}`).join(',')} in ${JSON.stringify(r.grid)}`);
    const textOver = r.tiles.filter((x) => !x.textFits);
    if (textOver.length) errors.push(`number wider than its tile: ${textOver.map((x) => x.number).join(',')}`);
    const hidden = sc.ready - r.tiles.length;
    if (hidden > 0 && !(first.overflow && first.overflow.includes(`+${hidden} more`) && /Page 1 of \d+/.test(first.overflow))) errors.push(`overflow not indicated (hidden ${hidden}, indicator ${JSON.stringify(first.overflow)})`);
    if (hidden === 0 && first.overflow) errors.push(`indicator shown although all fit: ${first.overflow}`);
    if (first.preparing) {
      const pc = first.preparing.tiles.filter((x) => !x.fullyVisible);
      if (pc.length) errors.push(`${pc.length} Preparing tile(s) not fully visible`);
      const ph = sc.preparing - first.preparing.tiles.length;
      if (ph > 0 && first.preparingMore !== `+${ph} more`) errors.push(`Preparing overflow not indicated (hidden ${ph})`);
    }
    if (first.promo) {
      const p = first.promo;
      const s = first.readySection;
      const overlap = !(p.right <= s.left || p.left >= s.right || p.bottom <= s.top || p.top >= s.bottom);
      if (overlap) errors.push('promo overlaps the Ready column');
      if (p.bottom > sc.size.height + 0.5 || p.right > sc.size.width + 0.5) errors.push('promo outside the screen');
    }

    // Rotate through every page and collect the numbers seen.
    const seen = new Set(r.tiles.map((x) => x.number));
    const pagesMatch = first.overflow?.match(/Page \d+ of (\d+)/);
    const pageCount = pagesMatch ? Number(pagesMatch[1]) : 1;
    const perPage = [{ page: 1, numbers: r.tiles.map((x) => x.number) }];
    for (let i = 1; i < pageCount + 2 && seen.size < sc.ready; i++) {
      await page.clock.runFor(PAGE_MS);
      await page.waitForTimeout(150);
      const m = await measure();
      const bad = m.ready.tiles.filter((x) => !x.fullyVisible || !x.textFits);
      if (bad.length) errors.push(`page ${i + 1}: ${bad.length} tile(s) do not fit`);
      if (i === 1) await page.screenshot({ path: path.join(outDir, `display-${name}-page2.png`) });
      perPage.push({ page: i + 1, indicator: m.overflow, numbers: m.ready.tiles.map((x) => x.number) });
      for (const x of m.ready.tiles) seen.add(x.number);
    }
    if (seen.size !== sc.ready) errors.push(`only ${seen.size}/${sc.ready} Ready numbers became visible across the rotation`);

    failures += errors.length ? 1 : 0;
    results.push({
      name,
      viewport: sc.size,
      showPreparing: sc.showPreparing,
      promo: Boolean(sc.promo),
      readyTotal: sc.ready,
      readyFullyVisible: r.tiles.filter((x) => x.fullyVisible).length,
      readyRendered: r.tiles.length,
      indicator: first.overflow,
      pages: pageCount,
      seenAcrossRotation: seen.size,
      preparingRendered: first.preparing?.tiles.length ?? 0,
      preparingTotal: sc.preparing,
      preparingIndicator: first.preparingMore,
      promoRect: first.promo,
      grid: r.grid,
      perPage,
      ok: errors.length === 0,
      errors,
    });
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${name}: ${r.tiles.length}/${sc.ready} on page 1, ${pageCount} page(s), seen ${seen.size}${errors.length ? ' — ' + errors.join('; ') : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
await fs.writeFile(path.join(outDir, 'display-layout-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`${results.length - failures}/${results.length} scenarios passed; results in ${outDir}`);
process.exit(failures ? 1 : 0);
