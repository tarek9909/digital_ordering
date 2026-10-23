// Renders the Tanbeeh brand SVGs (packages/ui/brand) into the PNG icons the apps serve, and copies the SVG favicon
// into each Tanbeeh-branded app. Run after changing the mark: `node tools/render-brand-icons.mjs` from frontend/.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = (name) => join(root, 'packages/ui/brand', name);

// [source svg, output png, size]. The app icon is full-bleed so it also survives Android's maskable crop; the
// notification badge is white on transparent because Android uses only its alpha channel.
const PNGS = [
  ['tanbeeh-app-icon.svg', 'apps/web-customer/public/icon-192.png', 192],
  ['tanbeeh-app-icon.svg', 'apps/web-customer/public/icon-512.png', 512],
  ['tanbeeh-badge.svg', 'apps/web-customer/public/badge-72.png', 72],
];
const FAVICON_APPS = ['web-site', 'web-console', 'web-staff', 'web-display', 'web-admin'];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of PNGS) {
  const svg = readFileSync(brand(src), 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  await page.screenshot({ path: join(root, out), omitBackground: true });
  console.log(`${out} (${size}px)`);
}
await browser.close();

for (const app of FAVICON_APPS) {
  mkdirSync(join(root, 'apps', app, 'public'), { recursive: true });
  copyFileSync(brand('tanbeeh-mark.svg'), join(root, 'apps', app, 'public/favicon.svg'));
  console.log(`apps/${app}/public/favicon.svg`);
}
