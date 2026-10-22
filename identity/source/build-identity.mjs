// Builds the Tanbeeh identity kit into identity/: logo files (SVG, PNG, vector PDF), app icons, social images,
// colour files and the brand guidelines PDF (plus each page as a PNG).
// Run from anywhere: `node identity/source/build-identity.mjs` (uses Playwright from frontend/node_modules).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { C, FRONTEND, IDENTITY, VARIANTS, cmyk, fontCss, hexToRgb, lockup, mark } from './brand.mjs';
import { guidelinesHtml } from './guidelines.mjs';

const { chromium } = createRequire(join(FRONTEND, 'package.json'))('playwright');
const out = (...p) => join(IDENTITY, ...p);
for (const dir of ['logo', 'app-icons', 'social', 'colors', 'guidelines-pages']) rmSync(out(dir), { recursive: true, force: true });
for (const dir of ['logo/svg', 'logo/png', 'logo/pdf', 'app-icons', 'social', 'colors', 'guidelines-pages']) mkdirSync(out(dir), { recursive: true });

const FONTS = fontCss();
const doc = (body, bg = 'transparent') =>
  `<!doctype html><meta charset="utf-8"><style>${FONTS}html,body{margin:0;background:${bg}}#x{display:inline-block}svg{display:block}</style><body><div id="x">${body}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const log = (p) => console.log(p.replace(IDENTITY, 'identity'));

/** Screenshot the #x element (sized by its content) to a PNG, transparent unless the content paints a background. */
async function png(body, file, bg) {
  await page.setViewportSize({ width: 4000, height: 2400 });
  await page.setContent(doc(body, bg));
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#x').screenshot({ path: file, omitBackground: !bg });
  log(file);
}

/** A single-page vector PDF the exact size of the #x element. */
async function pdf(body, file) {
  await page.setContent(doc(body));
  await page.evaluate(() => document.fonts.ready);
  const { width, height } = await page.locator('#x').boundingBox();
  await page.pdf({ path: file, width: `${Math.ceil(width)}px`, height: `${Math.ceil(height)}px`, printBackground: true, pageRanges: '1' });
  log(file);
}

// ---- Logo: marks
const MARKS = {
  'tanbeeh-mark': VARIANTS.primary,
  'tanbeeh-mark-light': VARIANTS.light,
  'tanbeeh-mark-ember': VARIANTS.ember,
  'tanbeeh-symbol': VARIANTS.symbol,
  'tanbeeh-symbol-white': VARIANTS.symbolWhite,
  'tanbeeh-symbol-mono-ink': VARIANTS.monoInk,
  'tanbeeh-symbol-mono-white': VARIANTS.monoWhite,
};
for (const [name, v] of Object.entries(MARKS)) {
  writeFileSync(out('logo/svg', `${name}.svg`), mark({ ...v, size: 64 }).replace(' width="64" height="64"', ''));
  log(out('logo/svg', `${name}.svg`));
  for (const size of [256, 512, 1024, 2048]) await png(mark({ ...v, size }), out('logo/png', `${name}-${size}.png`));
  await pdf(mark({ ...v, size: 256 }), out('logo/pdf', `${name}.pdf`));
}

// ---- Logo: lockups (mark + name). PNG and vector PDF; the PDF keeps the type as vector glyphs for print.
for (const lang of ['en', 'ar']) {
  for (const onDark of [false, true]) {
    const name = `tanbeeh-lockup-${lang}${onDark ? '-white' : ''}`;
    for (const h of [128, 256, 512]) await png(lockup({ lang, height: h, onDark }), out('logo/png', `${name}-${h}h.png`));
    await pdf(lockup({ lang, height: 128, onDark }), out('logo/pdf', `${name}.pdf`));
  }
}

// ---- App icons. Store icons are full-bleed squares (iOS and Android round the corners themselves); the
// notification badge is white on transparent because Android uses only its alpha channel.
const appIcon = (size) => mark({ ...VARIANTS.primary, size, square: true });
for (const [file, size] of [['ios-app-store-1024.png', 1024], ['android-play-store-512.png', 512], ['pwa-icon-512.png', 512], ['pwa-icon-192.png', 192], ['apple-touch-icon-180.png', 180]])
  await png(appIcon(size), out('app-icons', file));
for (const size of [16, 32, 48, 96]) await png(mark({ ...VARIANTS.primary, size }), out('app-icons', `favicon-${size}.png`));
for (const size of [72, 96]) await png(mark({ ...VARIANTS.monoWhite, size: size * 0.75 }).replace('<svg ', `<svg style="margin:${size * 0.125}px" `), out('app-icons', `notification-badge-${size}.png`));
writeFileSync(out('app-icons', 'favicon.svg'), mark({ ...VARIANTS.primary, size: 64 }).replace(' width="64" height="64"', ''));
log(out('app-icons', 'favicon.svg'));

// ---- Social
const glow = `radial-gradient(circle at 88% -10%, rgb(251 146 60 / .55), rgb(194 65 12 / .22) 38%, transparent 62%)`;
const box = (w, h, bg, inner, extra = '') => `<div style="width:${w}px;height:${h}px;background:${bg};position:relative;overflow:hidden;${extra}">${inner}</div>`;
await png(box(1080, 1080, C.ink, `<div style="position:absolute;inset:0;display:grid;place-items:center">${mark({ ...VARIANTS.symbolWhite, dot: C.ember, size: 560 })}</div>`), out('social', 'profile-avatar-1080.png'), C.ink);
await png(box(1080, 1080, C.surface, `<div style="position:absolute;inset:0;display:grid;place-items:center">${mark({ ...VARIANTS.primary, size: 640 })}</div>`), out('social', 'profile-avatar-light-1080.png'), C.surface);

const headline = {
  en: { kicker: 'The pager for restaurants and cafés', title: 'Your customer’s phone is the buzzer now.' },
  ar: { kicker: 'جهاز النداء للمطاعم والمقاهي', title: 'تلفون زبونك صار هو الجرس.' },
};
for (const lang of ['en', 'ar']) {
  const h = headline[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const kicker = lang === 'ar' ? 'font:600 26px Plex' : 'font:500 20px Mono;letter-spacing:.14em;text-transform:uppercase';
  await png(
    box(1200, 630, C.ink, `<div dir="${dir}" style="position:absolute;inset:72px 80px;display:flex;flex-direction:column;justify-content:space-between">${lockup({ lang, height: 72, onDark: true })}<div><div style="${kicker};color:${C.glow};margin-bottom:22px">${h.kicker}</div><div style="font:800 ${lang === 'ar' ? 70 : 64}px/1.12 Alexandria;color:#fff;letter-spacing:${lang === 'ar' ? 0 : '-0.03em'};max-width:900px">${h.title}</div></div></div>`, `background-image:${glow}`),
    out('social', `og-share-image-${lang}-1200x630.png`),
    C.ink,
  );
  await png(
    box(1500, 500, C.ink, `<div dir="${dir}" style="position:absolute;inset:0 96px;display:flex;align-items:center;justify-content:space-between;gap:60px">${lockup({ lang, height: 88, onDark: true })}<div style="font:800 ${lang === 'ar' ? 50 : 44}px/1.15 Alexandria;color:#fff;letter-spacing:${lang === 'ar' ? 0 : '-0.02em'};max-width:640px">${h.title}</div></div>`, `background-image:${glow}`),
    out('social', `cover-banner-${lang}-1500x500.png`),
    C.ink,
  );
}

// ---- Colours
const SWATCHES = [
  ['Ember', 'ember', C.ember, 'Primary accent: main action, live numbers, the dot'],
  ['Ember deep', 'ember-deep', C.emberDeep, 'Hover and pressed'],
  ['Glow', 'glow', C.glow, 'Ember on ink surfaces only'],
  ['Ember soft', 'ember-soft', C.emberSoft, 'Focus halo, badges'],
  ['Ember wash', 'ember-wash', C.emberWash, 'Row hover, quiet fills'],
  ['Ink', 'ink', C.ink, 'Text, the tile, dark surfaces'],
  ['Ink 2', 'ink-2', C.ink2, 'Secondary text'],
  ['Muted', 'muted', C.muted, 'Labels, hints'],
  ['Line', 'line', C.line, 'Borders, dividers'],
  ['Canvas', 'canvas', C.canvas, 'Page background'],
  ['Surface', 'surface', C.surface, 'Cards, white base'],
];
const STATUS = [['OK', 'ok', C.ok], ['Warning', 'warn', C.warn], ['Danger', 'danger', C.danger], ['Info', 'info', C.info]];
writeFileSync(
  out('colors', 'tanbeeh-colors.json'),
  JSON.stringify(
    Object.fromEntries([...SWATCHES, ...STATUS.map(([n, k, h]) => [n, k, h, 'Status only'])].map(([name, key, hex, use]) => [key, { name, hex, rgb: hexToRgb(hex), cmykApprox: cmyk(hex), use }])),
    null,
    2,
  ) + '\n',
);
writeFileSync(out('colors', 'tanbeeh-colors.css'), `/* Tanbeeh brand colours (Ember). Source of truth: frontend/packages/ui/src/ember.css */\n:root {\n${[...SWATCHES, ...STATUS].map(([, k, h]) => `  --tanbeeh-${k}: ${h};`).join('\n')}\n}\n`);
log(out('colors', 'tanbeeh-colors.json'));
log(out('colors', 'tanbeeh-colors.css'));
const chip = ([name, , hex]) => {
  const [r, g, b] = hexToRgb(hex);
  const dark = 0.299 * r + 0.587 * g + 0.114 * b < 150;
  return `<div style="background:${hex};border-radius:22px;padding:22px;height:170px;display:flex;flex-direction:column;justify-content:flex-end;color:${dark ? '#fff' : C.ink};box-shadow:inset 0 0 0 1px rgb(28 25 23 / .08)"><div style="font:700 24px Alexandria">${name}</div><div style="font:500 17px Mono;opacity:.8;margin-top:6px">${hex}</div></div>`;
};
await png(
  `<div style="width:1600px;padding:72px;box-sizing:border-box;background:${C.canvas}"><div style="display:flex;align-items:center;gap:20px;margin-bottom:40px">${mark({ size: 56 })}<span style="font:700 32px Alexandria;color:${C.ink}">Tanbeeh colour palette</span></div><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:18px">${[SWATCHES[0], SWATCHES[1], SWATCHES[2], SWATCHES[5], SWATCHES[6]].map(chip).join('')}</div><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:18px;margin-top:18px">${[SWATCHES[3], SWATCHES[4], SWATCHES[7], SWATCHES[8], SWATCHES[9], SWATCHES[10]].map(chip).join('')}</div></div>`,
  out('colors', 'tanbeeh-palette.png'),
  C.canvas,
);

// ---- Guidelines: one PDF, plus every page as a PNG for sharing in chats.
const guide = guidelinesHtml({ fonts: FONTS, swatches: SWATCHES, status: STATUS });
await page.setViewportSize({ width: 1123, height: 794 });
await page.setContent(guide);
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: out('Tanbeeh-Brand-Guidelines.pdf'), preferCSSPageSize: true, printBackground: true });
log(out('Tanbeeh-Brand-Guidelines.pdf'));
const shotPage = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1123, height: 794 } });
await shotPage.setContent(guide);
await shotPage.evaluate(() => document.fonts.ready);
const pages = shotPage.locator('.page');
for (let i = 0; i < (await pages.count()); i++) {
  const file = out('guidelines-pages', `page-${String(i + 1).padStart(2, '0')}.png`);
  await pages.nth(i).screenshot({ path: file });
  log(file);
}
await browser.close();
