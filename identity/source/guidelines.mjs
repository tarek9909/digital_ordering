// The Tanbeeh brand guidelines as print HTML: A4 landscape pages, rendered to PDF and PNG by build-identity.mjs.
import { C, DOT, RING, VARIANTS, cmyk, hexToRgb, lockup, mark } from './brand.mjs';

const VERSION = 'v1.0 · October 2026';
const glow = `radial-gradient(circle at 92% -8%, rgb(251 146 60 / .5), rgb(194 65 12 / .2) 36%, transparent 60%)`;

const css = `
@page { size: 1123px 794px; margin: 0 }
* { box-sizing: border-box }
svg { display: block }
.lockup svg, .inline svg { display: block }
html, body { margin: 0; background: #fff; color: ${C.ink}; font: 400 13px/1.55 Plex }
.page { width: 1123px; height: 794px; position: relative; overflow: hidden; break-after: page; padding: 54px 64px 0; background: #fff }
.page.ink { background: ${C.ink} ${glow}; color: #fff }
.page.canvas { background: ${C.canvas} }
.top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px }
.eyebrow { font: 500 10.5px Mono; letter-spacing: .14em; text-transform: uppercase; color: ${C.muted} }
.ink .eyebrow { color: #a8a29e }
.num { color: ${C.ember} }
.ink .num { color: ${C.glow} }
h1 { font: 800 44px/1.08 Alexandria; letter-spacing: -.03em; margin: 0 0 12px }
h2 { font: 700 20px/1.2 Alexandria; letter-spacing: -.01em; margin: 0 0 6px }
.lead { font-size: 15px; color: ${C.ink2}; max-width: 560px; margin: 0 }
.ink .lead { color: #d6d3d1 }
.ar { font-family: Plex; direction: rtl }
.foot { position: absolute; left: 64px; right: 64px; bottom: 26px; display: flex; justify-content: space-between; font: 500 9.5px Mono; letter-spacing: .1em; text-transform: uppercase; color: #a8a29e }
.card { background: #fff; border-radius: 22px; box-shadow: 0 1px 2px rgb(28 25 23 / .04), 0 12px 32px -12px rgb(28 25 23 / .14) }
.tile { border-radius: 22px; display: grid; place-items: center; position: relative }
.label { font: 600 12.5px Plex; margin-top: 10px }
.sub { font-size: 11.5px; color: ${C.muted}; line-height: 1.45 }
.grid { display: grid; gap: 18px }
.x { position: absolute; top: 10px; right: 10px; width: 26px; height: 26px; border-radius: 50%; background: ${C.danger}; color: #fff; display: grid; place-items: center; font: 700 15px Plex }
.ok { position: absolute; top: 10px; right: 10px; width: 26px; height: 26px; border-radius: 50%; background: ${C.ok}; color: #fff; display: grid; place-items: center; font: 700 13px Plex }
.mono { font-family: Mono; font-weight: 500 }
.pill { display: inline-block; border-radius: 999px; padding: 4px 12px; font: 600 11px Plex }
`;

const page = (n, section, body, cls = '') =>
  `<section class="page ${cls}"><div class="top"><span class="eyebrow"><span class="num">${n}</span> &nbsp;${section}</span>${mark({ ...(cls.includes('ink') ? VARIANTS.light : VARIANTS.primary), size: 28 })}</div>${body}<div class="foot"><span>Tanbeeh · Brand guidelines</span><span>${VERSION}</span></div></section>`;

// Signal waves and a closed ring are drawn only to show what not to do.
const WAVES = `<path d="M11.4 21.9A9 9 0 0 1 21.4 16.1M7.7 20.6A13 13 0 0 1 22.1 12.2" fill="none" stroke="${C.ember}" stroke-width="2.5" stroke-linecap="round"/>`;
const closedRing = (svg) => svg.replace(`d="${RING}"`, 'd="M32 18a14 14 0 1 1 0 28a14 14 0 1 1 0-28"');

/** A sample QR-like pattern (not scannable): finder squares plus a deterministic module field. */
function sampleQr(size) {
  const n = 25;
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="${C.ink}"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="${C.ink}"/>`;
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  let cells = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!inFinder(x, y) && rnd() > 0.5) cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${C.ink}"/>`;
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/>${cells}${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
}

/** Construction drawing: the 64-unit grid, the ring's guide circle and lettered callouts. */
function construction(size) {
  let grid = '';
  for (let i = 8; i < 64; i += 8) grid += `<line x1="${i}" y1="0" x2="${i}" y2="64" stroke="#fff" stroke-opacity=".14" stroke-width=".25"/><line x1="0" y1="${i}" x2="64" y2="${i}" stroke="#fff" stroke-opacity=".14" stroke-width=".25"/>`;
  const tag = (x, y, t) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${C.glow}"/><text x="${x}" y="${y + 1.05}" text-anchor="middle" font-family="Mono" font-size="3" font-weight="500" fill="${C.ink}">${t}</text>`;
  const guides = `${grid}<circle cx="32" cy="32" r="14" fill="none" stroke="${C.glow}" stroke-width=".3" stroke-dasharray="1 1"/><line x1="32" y1="32" x2="32" y2="18" stroke="${C.glow}" stroke-width=".3"/><line x1="32" y1="32" x2="${DOT.cx}" y2="${DOT.cy}" stroke="${C.glow}" stroke-width=".3"/><circle cx="32" cy="32" r=".8" fill="${C.glow}"/>`;
  const tags = `${tag(50, 46, 'A')}${tag(26, 10.5, 'B')}${tag(9, 30, 'C')}${tag(36.5, 26, 'D')}${tag(58, 6, 'E')}`;
  return mark({ ...VARIANTS.primary, size }).replace('</svg>', `${guides}${tags}</svg>`);
}

function phone(inner, bg = C.ink) {
  return `<div style="width:230px;height:430px;border-radius:38px;background:${C.ink};padding:9px;box-shadow:0 20px 40px -18px rgb(28 25 23 / .45)"><div style="height:100%;border-radius:30px;background:${bg};overflow:hidden;position:relative">${inner}</div></div>`;
}

export function guidelinesHtml({ fonts, swatches, status }) {
  const S = Object.fromEntries(swatches.map((s) => [s[1], s]));
  const pages = [];

  // 1. Cover
  pages.push(`<section class="page ink" style="padding:64px 72px">
    <div style="position:absolute;right:-40px;bottom:-90px;opacity:.95">${mark({ ...VARIANTS.symbolWhite, dot: C.ember, size: 560 })}</div>
    <div class="eyebrow" style="color:#a8a29e">Brand guidelines · ${VERSION}</div>
    <div style="position:absolute;left:72px;bottom:120px">
      ${lockup({ lang: 'en', height: 84, onDark: true })}
      <div style="font:700 40px Alexandria;color:${C.glow};margin:26px 0 0;direction:rtl;text-align:left">تنبيه</div>
      <p class="lead" style="margin-top:22px;font-size:17px">The pager for restaurants and cafés. Identity, logo, colour and type.</p>
    </div></section>`);

  // 2. At a glance
  pages.push(
    page('01', 'Brand at a glance', `
    <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:56px">
      <div>
        <h1>Your customer’s phone is the buzzer now.</h1>
        <p class="ar" style="font:700 28px/1.3 Alexandria;margin:6px 0 18px;text-align:right">تلفون زبونك صار هو الجرس.</p>
        <p class="lead">Tanbeeh (تنبيه, “alert”) replaces the plastic restaurant buzzer. Customers scan a code at the counter, and their phone rings the moment staff tap Ready. No app, no devices to lose, nothing to charge.</p>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;align-content:start">
        ${[
          ['Premium', 'White space, a confident ink, one warm accent. Never busy.'],
          ['Warm', 'Ember orange is hospitality: a kitchen, a lit stove, a welcome.'],
          ['Clear', 'One message per screen. Numbers big, labels small.'],
          ['Alive', 'Small moments of play: a pulsing dot, a tilted sticker. Used once.'],
        ]
          .map(([t, d]) => `<div class="card" style="padding:20px"><div style="width:10px;height:10px;border-radius:50%;background:${C.ember};margin-bottom:12px"></div><h2>${t}</h2><div class="sub">${d}</div></div>`)
          .join('')}
      </div>
    </div>
    <div style="margin-top:34px;display:flex;gap:16px;align-items:center">
      <span class="eyebrow">Mix</span>
      <div style="flex:1;display:flex;height:22px;border-radius:999px;overflow:hidden;border:1px solid ${C.line}"><div style="width:80%;background:#fff"></div><div style="width:15%;background:${C.ink}"></div><div style="width:5%;background:${C.ember}"></div></div>
      <span class="sub mono">80 white · 15 ink · 5 ember</span>
    </div>
    <div style="margin-top:34px"><div class="eyebrow" style="margin-bottom:12px">How we sound</div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr)">
        ${[
          ['Say it like staff would', 'Your order is ready.', 'طلبك جاهز.'],
          ['Local, not formal', 'Arabic in a Lebanese voice, English kept plain.', 'منحكي متل ما بيحكي الزبون.'],
          ['Short beats clever', 'No app. Nothing to charge.', 'بلا تطبيق. بلا شحن.'],
        ]
          .map(([t, en, ar]) => `<div style="border-top:2px solid ${C.ink};padding-top:12px"><h2 style="font-size:15px">${t}</h2><div class="sub" style="font-size:12.5px">${en}</div><div class="sub ar" style="font-size:13px;text-align:right">${ar}</div></div>`)
          .join('')}
      </div>
    </div>`),
  );

  // 3. The idea
  pages.push(
    page('02', 'The mark · “Almost ready”', `
    <div style="display:grid;grid-template-columns:420px 1fr;gap:60px;align-items:center">
      <div class="tile" style="height:470px;background:${C.canvas};border-radius:28px">${mark({ ...VARIANTS.symbol, size: 300 })}</div>
      <div>
        <h1>Almost ready.</h1>
        <p class="ar" style="font:700 26px Alexandria;margin:0 0 18px;text-align:left;direction:rtl">تقريباً جاهز.</p>
        <p class="lead" style="margin-bottom:26px">The mark is the one moment Tanbeeh exists for: the order is nearly done and the customer is about to be called. It reads as a progress ring, and it is drawn from simple, ownable geometry.</p>
        ${[
          ['The ring', 'An order in progress. It runs clockwise from 12 o’clock, like a timer filling.'],
          ['The gap', 'Not finished yet. The gap is what makes it a moment, not a static circle.'],
          ['The ember dot', 'The call. The only ember in the mark, sitting on the ring’s leading tip.'],
        ]
          .map(([t, d], i) => `<div style="display:flex;gap:16px;margin-bottom:16px"><span class="mono" style="color:${C.ember};font-size:12px;padding-top:3px">0${i + 1}</span><div><h2 style="font-size:17px">${t}</h2><div class="sub" style="font-size:12.5px">${d}</div></div></div>`)
          .join('')}
      </div>
    </div>`),
  );

  // 4. Logo versions
  const versions = [
    ['Primary', 'Ink tile. The default everywhere: apps, favicon, documents.', mark({ ...VARIANTS.primary, size: 120 }), C.canvas],
    ['Light', 'White tile for ink or photo backgrounds.', mark({ ...VARIANTS.light, size: 120 }), C.ink],
    ['Ember', 'For merchandise and campaign moments only. The dot turns ink.', mark({ ...VARIANTS.ember, size: 120 }), C.canvas],
    ['Symbol', 'No tile. When the logo sits inside other UI or next to the name.', mark({ ...VARIANTS.symbol, size: 104 }), '#fff'],
    ['Symbol on dark', 'White ring with a glow dot, for ink surfaces.', mark({ ...VARIANTS.symbolWhite, size: 104 }), C.ink],
    ['One colour', 'Stamps, receipts, thermal printers, engraving, embossing.', mark({ ...VARIANTS.monoInk, size: 104 }), '#fff'],
  ];
  pages.push(
    page('03', 'Logo versions', `
    <h1 style="font-size:34px">Six versions, one shape.</h1><p class="lead" style="margin-bottom:24px">Use the primary mark unless the background calls for another. Never rebuild the mark: use the master files in <span class="mono">identity/logo</span>.</p>
    <div class="grid" style="grid-template-columns:repeat(6,1fr)">
      ${versions.map(([t, d, m, bg]) => `<div><div class="tile" style="height:170px;background:${bg};box-shadow:inset 0 0 0 1px ${C.line}">${m}</div><div class="label">${t}</div><div class="sub">${d}</div></div>`).join('')}
    </div>`),
  );

  // 5. Lockups
  pages.push(
    page('04', 'Logo with name', `
    <h1 style="font-size:34px">The name sits beside the mark.</h1><p class="lead" style="margin-bottom:26px">The name is set in Alexandria Bold. In Arabic the mark leads on the right, as the start of the line. Keep the gap between mark and name at a quarter of the tile.</p>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <div class="tile" style="height:190px;background:${C.canvas}">${lockup({ lang: 'en', height: 76 })}</div>
      <div class="tile" style="height:190px;background:${C.canvas}">${lockup({ lang: 'ar', height: 76 })}</div>
      <div class="tile" style="height:190px;background:${C.ink} ${glow}">${lockup({ lang: 'en', height: 76, onDark: true })}</div>
      <div class="tile" style="height:190px;background:${C.ink} ${glow}">${lockup({ lang: 'ar', height: 76, onDark: true })}</div>
    </div>`),
  );

  // 6. Construction, clear space, minimum size
  pages.push(
    page('05', 'Construction, clear space and size', `
    <div style="display:grid;grid-template-columns:330px 1fr 1fr;gap:40px;align-items:start">
      <div><div class="tile" style="height:330px;background:${C.ink};border-radius:28px">${construction(270)}</div></div>
      <div>
        <h2>Construction</h2><p class="sub" style="margin:0 0 14px">Drawn on a 64-unit grid.</p>
        ${[
          ['A', 'Ring: radius 14, stroke 6, round caps'],
          ['B', 'Starts at 12 o’clock, runs 300° clockwise'],
          ['C', 'Dot: radius 5.5, centred on the ring’s end at 210°'],
          ['D', 'Ring centred in the tile'],
          ['E', 'Tile: 64 × 64, corner radius 16 (25%)'],
        ]
          .map(([l, d]) => `<div style="display:flex;gap:12px;margin-bottom:10px;align-items:center"><span style="width:22px;height:22px;border-radius:50%;background:${C.glow};font:500 11px Mono;display:grid;place-items:center;flex:none">${l}</span><span style="font-size:12.5px">${d}</span></div>`)
          .join('')}
      </div>
      <div>
        <h2>Clear space</h2><p class="sub" style="margin:0 0 14px">Keep a margin of <b>x</b> on every side, where x is a quarter of the tile.</p>
        <div style="display:inline-block;padding:30px;border:1.5px dashed ${C.ember};border-radius:12px;position:relative;background:${C.emberWash}">${mark({ size: 120 })}<span class="mono" style="position:absolute;top:6px;left:50%;transform:translateX(-50%);font-size:10px;color:${C.ember}">x</span><span class="mono" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:10px;color:${C.ember}">x</span></div>
        <h2 style="margin-top:26px">Minimum size</h2>
        <table style="border-collapse:collapse;font-size:12.5px;margin-top:6px">
          ${[['Mark', '16 px', '6 mm'], ['Name with mark', '96 px wide', '25 mm wide']].map(([a, b, c]) => `<tr><td style="padding:6px 22px 6px 0;border-bottom:1px solid ${C.line}">${a}</td><td style="padding:6px 22px 6px 0;border-bottom:1px solid ${C.line}" class="mono">${b}</td><td style="padding:6px 0;border-bottom:1px solid ${C.line}" class="mono">${c}</td></tr>`).join('')}
        </table>
        <div style="display:flex;gap:16px;align-items:end;margin-top:16px">${[64, 32, 24, 16].map((s) => `<div style="text-align:center">${mark({ size: s })}<div class="sub mono" style="margin-top:4px">${s}</div></div>`).join('')}</div>
      </div>
    </div>`),
  );

  // 7. Misuse
  const dont = [
    ['Don’t rotate', `<div style="transform:rotate(90deg)">${mark({ size: 96 })}</div>`, C.canvas],
    ['Don’t stretch', mark({ size: 96 }).replace('width="96"', 'width="140" preserveAspectRatio="none"'), C.canvas],
    ['Don’t recolour', mark({ ...VARIANTS.primary, tile: '#0F766E', dot: '#FACC15', size: 96 }), C.canvas],
    ['Don’t add signal waves', mark({ size: 96, extra: WAVES }), C.canvas],
    ['Don’t close the ring', closedRing(mark({ size: 96 })), C.canvas],
    ['Don’t outline the tile', mark({ ...VARIANTS.primary, tile: 'none', ring: C.ink, size: 96 }).replace('fill="none"/>', `fill="none" stroke="${C.ink}" stroke-width="2"/>`), C.canvas],
    ['Don’t lose contrast', mark({ ...VARIANTS.ember, size: 96 }), C.ember],
    ['Don’t add effects', `<div style="filter:drop-shadow(6px 8px 0 ${C.glow}) blur(.4px)">${mark({ size: 96 })}</div>`, C.canvas],
  ];
  pages.push(
    page('06', 'Misuse', `
    <h1 style="font-size:34px">Keep it exactly as drawn.</h1><p class="lead" style="margin-bottom:24px">The mark only works because it is simple. These changes break it. Signal waves and a smile-shaped curve also belong to another brand in our market, so keep well clear of them.</p>
    <div class="grid" style="grid-template-columns:repeat(4,1fr)">
      ${dont.map(([t, m, bg]) => `<div><div class="tile" style="height:150px;background:${bg};box-shadow:inset 0 0 0 1px ${C.line}"><span class="x">×</span>${m}</div><div class="label">${t}</div></div>`).join('')}
    </div>`),
  );

  // 8. Colour
  const big = (s, dark) => {
    const [name, , hex, use] = s;
    const [r, g, b] = hexToRgb(hex);
    const [c, m, y, k] = cmyk(hex);
    return `<div style="border-radius:22px;overflow:hidden;box-shadow:inset 0 0 0 1px ${C.line}"><div style="background:${hex};height:150px;padding:18px;border-bottom:1px solid ${C.line};color:${dark ? '#fff' : C.ink};display:flex;align-items:flex-end;font:700 22px Alexandria">${name}</div><div style="padding:14px 18px;font-size:11.5px;line-height:1.7"><div class="mono">HEX ${hex}</div><div class="mono">RGB ${r} ${g} ${b}</div><div class="mono">CMYK ${c} ${m} ${y} ${k}*</div><div class="sub" style="margin-top:6px">${use}</div></div></div>`;
  };
  const small = (s) => `<div><div style="height:56px;border-radius:14px;background:${s[2]};box-shadow:inset 0 0 0 1px rgb(28 25 23 / .08)"></div><div class="label" style="margin-top:6px;font-size:11.5px">${s[0]}</div><div class="sub mono">${s[2]}</div></div>`;
  pages.push(
    page('07', 'Colour', `
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:20px">
      ${big(S.ember, true)}${big(S.ink, true)}${big(S.surface, false)}${big(S.glow, false)}
    </div>
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:40px">
      <div><div class="eyebrow" style="margin-bottom:10px">Supporting</div><div class="grid" style="grid-template-columns:repeat(7,1fr);gap:12px">${['ember-deep', 'ember-soft', 'ember-wash', 'ink-2', 'muted', 'line', 'canvas'].map((k) => small(S[k])).join('')}</div></div>
      <div><div class="eyebrow" style="margin-bottom:10px">Status (product only, never decoration)</div><div class="grid" style="grid-template-columns:repeat(4,1fr);gap:12px">${status.map(small).join('')}</div></div>
    </div>
    <p class="sub" style="margin-top:14px">One ember element per view. Ember text fails contrast on ink, so use Glow there. * CMYK values are a starting point: proof against the hex and RGB values with your printer.</p>`),
  );

  // 9. Typography
  pages.push(
    page('08', 'Typography', `
    <div style="display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:28px">
      <div class="card" style="padding:26px">
        <div class="eyebrow">Display · Alexandria 600–800</div>
        <div style="font:800 72px/1.35 Alexandria;letter-spacing:-.04em;margin:22px 0 0">Aa أب</div>
        <div style="font:800 26px/1.2 Alexandria;letter-spacing:-.02em;margin-top:16px">Order 42 is ready.</div>
        <div style="font:800 26px/1.3 Alexandria;direction:rtl;text-align:right">طلبك رقم ٤٢ جاهز.</div>
        <div class="sub" style="margin-top:14px">Headings, big numbers and the name. Tight tracking in Latin, none in Arabic.</div>
      </div>
      <div class="card" style="padding:26px">
        <div class="eyebrow">Text · IBM Plex Sans Arabic</div>
        <div style="font:500 56px/1.35 Plex;margin:22px 0 10px">Aa أب</div>
        <p style="font-size:13.5px;margin:0 0 10px">They scan a code at the counter, and their phone rings the moment you tap Ready.</p>
        <p class="ar" style="font-size:14.5px;margin:0;text-align:right">بيمسح الكود عالكاونتر، وبيرنّ تلفونه أوّل ما تكبس «جاهز».</p>
        <div class="sub" style="margin-top:14px">Body copy and interface, 400 to 700.</div>
      </div>
      <div class="card" style="padding:26px">
        <div class="eyebrow">Labels · JetBrains Mono 500</div>
        <div style="font:500 52px/1.35 Mono;margin:22px 0 10px">Aa 42</div>
        <div class="eyebrow" style="color:${C.ink}">Ticket · A-042</div>
        <div class="eyebrow" style="margin-top:6px">Live · 3 waiting</div>
        <div class="sub" style="margin-top:14px">Small uppercase labels, IDs and codes. Latin only: Arabic labels use Plex.</div>
      </div>
    </div>
    <p class="sub" style="margin-top:18px">All three families are open source (SIL Open Font License) and cover Arabic or fall back to Plex. The apps are right-to-left first.</p>`),
  );

  // 10. Digital
  const homeIcons = [C.line, '#E7E5E4', '#D6D3D1', C.line, '#E7E5E4', '#D6D3D1', C.line];
  pages.push(
    page('09', 'App icon and notifications', `
    <div style="display:grid;grid-template-columns:auto auto 1fr;gap:44px;align-items:start">
      ${phone(`<div style="padding:48px 20px;display:grid;grid-template-columns:repeat(4,41px);justify-content:space-between;gap:18px 0">${homeIcons.map((c) => `<div style="width:41px;height:41px;border-radius:11px;background:${c}"></div>`).join('')}<div style="text-align:center;width:41px"><div style="border-radius:11px;overflow:hidden">${mark({ ...VARIANTS.primary, size: 41, square: true })}</div><div style="font-size:8px;margin-top:4px;margin-inline:-8px">Tanbeeh</div></div></div>`, C.canvas)}
      ${phone(`<div style="padding:54px 12px 0;text-align:center;color:#fff"><div style="font:600 52px Alexandria;letter-spacing:-.03em">9:41</div><div style="font-size:11px;opacity:.7">Thursday 22 October</div><div style="margin-top:34px;background:rgb(255 255 255 / .92);color:${C.ink};border-radius:18px;padding:12px;text-align:left;display:flex;gap:10px"><div style="flex:none">${mark({ size: 30 })}</div><div><div style="font-size:9.5px;color:${C.muted}">TANBEEH · now</div><div style="font:700 12.5px Alexandria;margin:2px 0">Your order is ready</div><div style="font-size:10.5px;line-height:1.35">Order A-042 at Café Nour. Pick it up at the counter.</div></div></div></div>`, `${C.ink} ${glow}`)}
      <div>
        <h1 style="font-size:32px">On the phone</h1>
        <p class="lead" style="margin-bottom:22px">The app icon is the primary mark on a full square: iOS and Android round the corners themselves. Android notifications use the white one-colour symbol.</p>
        <div style="display:flex;gap:22px;align-items:end">
          <div style="text-align:center"><div style="border-radius:22px;overflow:hidden">${mark({ size: 96, square: true })}</div><div class="sub mono" style="margin-top:6px">App icon</div></div>
          <div style="text-align:center"><div style="background:${C.ink2};border-radius:12px;padding:10px">${mark({ ...VARIANTS.monoWhite, size: 30 })}</div><div class="sub mono" style="margin-top:6px">Badge</div></div>
          <div style="text-align:center">${mark({ size: 32 })}<div class="sub mono" style="margin-top:6px">32</div></div>
          <div style="text-align:center">${mark({ size: 16 })}<div class="sub mono" style="margin-top:6px">16</div></div>
        </div>
        <p class="sub" style="margin-top:22px">Sample content. Venue names and order numbers are illustrative.</p>
      </div>
    </div>`, 'canvas'),
  );

  // 11. In the venue
  pages.push(
    page('10', 'In the venue', `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:56px;align-items:center">
      <div style="display:flex;gap:26px;align-items:stretch">
        <div class="card" style="width:250px;border-radius:24px;overflow:hidden;align-self:stretch">
          <div style="background:${C.ink} ${glow};padding:22px;color:#fff">${lockup({ lang: 'en', height: 34, onDark: true })}<div style="font:800 23px/1.15 Alexandria;letter-spacing:-.02em;margin-top:18px">Scan. Sit back. We’ll call you.</div></div>
          <div style="padding:20px;display:flex;gap:14px;align-items:center">${sampleQr(84)}<div class="sub" style="font-size:11px">Your phone rings when your order is ready. No app needed.</div></div>
        </div>
        <div class="card" style="width:250px;border-radius:24px;overflow:hidden;direction:rtl;align-self:stretch">
          <div style="background:${C.ember};padding:20px;color:#fff">${lockup({ lang: 'ar', height: 30, onDark: true })}<div style="font:800 21px/1.35 Alexandria;margin-top:14px">امسح الكود، ومنرنّلك أوّل ما يجهز طلبك.</div></div>
          <div style="padding:18px;display:flex;gap:12px;align-items:center">${sampleQr(84)}<div class="sub" style="font-size:11px">بلا تطبيق، وبلا أجهزة بتضيع.</div></div>
        </div>
      </div>
      <div>
        <h1 style="font-size:32px">Counter cards and stickers</h1>
        <p class="lead" style="margin-bottom:18px">Printed pieces lead with an ink or ember panel, then a large QR code on white. One message only.</p>
        <div class="sub" style="font-size:12.5px;line-height:1.8">• QR codes always on white, at least 25 mm square<br>• Ember panels sparingly: one per piece<br>• The venue’s own logo can sit on the white area<br>• Print the mark from <span class="mono">logo/pdf</span>, never from screenshots</div>
        <p class="sub" style="margin-top:18px">QR codes and copy are samples.</p>
      </div>
    </div>`, 'canvas'),
  );

  // 12. Back cover
  pages.push(`<section class="page ink" style="display:grid;place-items:center;text-align:center">
    <div>${mark({ ...VARIANTS.symbolWhite, dot: C.ember, size: 150 })}
    <div style="font:800 34px Alexandria;letter-spacing:-.02em;margin-top:30px">Your customer’s phone is the buzzer now.</div>
    <div style="font:700 26px Alexandria;color:${C.glow};margin-top:10px;direction:rtl">تلفون زبونك صار هو الجرس.</div>
    <div class="eyebrow" style="margin-top:40px">Tanbeeh · Brand guidelines · ${VERSION}</div></div></section>`);

  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Tanbeeh brand guidelines</title><style>${fonts}${css}</style><body>${pages.join('')}</body></html>`;
}
