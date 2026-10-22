// Brand colour theming with WCAG contrast (TR-FE-07): text on the brand colour switches to black or white to keep
// ≥ 4.5:1; a colour that cannot reach 3:1 against the page background is darkened for borders and bands.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

export const textOn = (bg: string) => (contrast(bg, '#000000') >= contrast(bg, '#ffffff') ? '#000000' : '#ffffff');

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.max(0, Math.round(c * (1 - amount)))) as [number, number, number];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function brandTokens(brand: string, background = '#ffffff') {
  let band = brand;
  for (let i = 0; i < 10 && contrast(band, background) < 3; i++) band = darken(band, 0.12);
  return { '--brand': brand, '--brand-band': band, '--on-brand': textOn(brand), '--on-band': textOn(band) };
}

/** Applies brand tokens to an element (CSS variables). */
export function applyBrand(el: HTMLElement, brand: string) {
  for (const [k, v] of Object.entries(brandTokens(brand))) el.style.setProperty(k, v);
}
