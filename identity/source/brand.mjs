// Tanbeeh brand primitives shared by the identity exports and the guidelines PDF. Colours mirror the Ember theme
// in frontend/packages/ui/src/ember.css; the mark geometry mirrors frontend/packages/ui/src/BrandMark.tsx.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IDENTITY = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FRONTEND = join(IDENTITY, '..', 'frontend');

export const C = {
  ink: '#1C1917',
  ink2: '#44403C',
  muted: '#6F6863',
  line: '#EEEBE8',
  surface: '#FFFFFF',
  canvas: '#FAF9F7',
  ember: '#C2410C',
  emberDeep: '#9A3412',
  emberSoft: '#FFEDD5',
  emberWash: '#FFF7ED',
  glow: '#FB923C',
  ok: '#15803D',
  warn: '#A16207',
  danger: '#BE123C',
  info: '#1D4ED8',
};

// The mark on a 64-unit grid: a ring 300° closed (centre 32,32, r 14, stroke 6) starting at 12 o'clock and running
// clockwise, with the ember dot (r 5.5) sitting on its leading tip at 210°. Tile radius 16.
export const RING = 'M32 18a14 14 0 1 1-12.124 7';
export const DOT = { cx: 19.876, cy: 25, r: 5.5 };

/**
 * One mark as an SVG string. `tile` is a fill colour or null (symbol only, cropped to the ring's bounds);
 * `square` drops the tile's corner radius (app stores crop it themselves).
 */
export function mark({ tile = C.ink, ring = C.surface, dot = C.ember, size = 64, square = false, extra = '' } = {}) {
  const vb = tile ? '0 0 64 64' : '14 14 36 36';
  const bg = tile ? `<rect width="64" height="64" rx="${square ? 0 : 16}" fill="${tile}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${size}" height="${size}">${bg}<path d="${RING}" fill="none" stroke="${ring}" stroke-width="6" stroke-linecap="round"/><circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${dot}"/>${extra}</svg>`;
}

export const VARIANTS = {
  primary: { tile: C.ink, ring: C.surface, dot: C.ember },
  light: { tile: C.surface, ring: C.ink, dot: C.ember },
  ember: { tile: C.ember, ring: C.surface, dot: C.ink },
  symbol: { tile: null, ring: C.ink, dot: C.ember },
  symbolWhite: { tile: null, ring: C.surface, dot: C.glow },
  monoInk: { tile: null, ring: C.ink, dot: C.ink },
  monoWhite: { tile: null, ring: C.surface, dot: C.surface },
};

/** Mark plus name. Arabic puts the mark on the right (start of an RTL line). `onDark` swaps to the white set. */
export function lockup({ lang = 'en', height = 64, onDark = false } = {}) {
  const m = mark({ ...(onDark ? VARIANTS.light : VARIANTS.primary), size: height });
  const name = lang === 'ar' ? 'تنبيه' : 'Tanbeeh';
  const color = onDark ? C.surface : C.ink;
  return `<div class="lockup" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" style="display:inline-flex;align-items:center;gap:${height * 0.25}px;color:${color}">${m}<span style="font:700 ${height * 0.56}px/1 Alexandria;letter-spacing:${lang === 'ar' ? 0 : '-0.02em'};padding-bottom:${lang === 'ar' ? height * 0.08 : 0}px">${name}</span></div>`;
}

const FONTS = [
  ['Alexandria', 600, 'alexandria/files/alexandria-latin-600-normal.woff2'],
  ['Alexandria', 700, 'alexandria/files/alexandria-latin-700-normal.woff2'],
  ['Alexandria', 800, 'alexandria/files/alexandria-latin-800-normal.woff2'],
  ['Alexandria', 600, 'alexandria/files/alexandria-arabic-600-normal.woff2', true],
  ['Alexandria', 700, 'alexandria/files/alexandria-arabic-700-normal.woff2', true],
  ['Alexandria', 800, 'alexandria/files/alexandria-arabic-800-normal.woff2', true],
  ['Plex', 400, 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-400-normal.woff2'],
  ['Plex', 500, 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-500-normal.woff2'],
  ['Plex', 600, 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-latin-600-normal.woff2'],
  ['Plex', 400, 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2', true],
  ['Plex', 500, 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-500-normal.woff2', true],
  ['Plex', 600, 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2', true],
  ['Mono', 500, 'jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2'],
];

/** @font-face rules with the self-hosted fonts inlined, so renders never depend on the network. */
export function fontCss() {
  return FONTS.map(([family, weight, file, arabic]) => {
    const data = readFileSync(join(FRONTEND, 'node_modules/@fontsource', file)).toString('base64');
    const range = arabic ? ';unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF,U+200C-200F' : '';
    return `@font-face{font-family:${family};font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2')${range}}`;
  }).join('\n');
}

export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Naive device CMYK, only a starting point: the printer should proof against the hex/RGB values. */
export function cmyk(h) {
  const [r, g, b] = hexToRgb(h).map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return [0, 0, 0, 100];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 100));
}
