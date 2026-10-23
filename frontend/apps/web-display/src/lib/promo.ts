import type { DisplaySettings } from '@dop/contracts';

// Promo slot (FR-DSP-07). The promo never covers or shrinks the Ready list: with the Preparing column it is a band
// at the bottom of that column; without it, a strip under the board that is only shown while the Ready numbers
// still fit above it. Pure so the layout decision can be unit-tested.

export type Promo = NonNullable<DisplaySettings['promo']>;

export type PromoLayout = { placement: 'hidden' } | { placement: 'preparing' | 'strip'; text: string; imageUrl: string | null };

export interface PromoInput {
  promo: DisplaySettings['promo'];
  lang: string;
  showPreparing: boolean;
  /** Ready tiles on screen (after the "+n more" cap). */
  readyShown: number;
  /** A "+n more" line is shown under the tiles. */
  readyMore: boolean;
  viewportW: number;
  viewportH: number;
}

/** Strip height in vh (BoardView uses the same value). */
export const PROMO_STRIP_VH = 14;

/** Promo text for the screen language, else the first one set. */
export function promoText(promo: Promo, lang: string): string {
  const base = lang.split('-')[0] ?? lang;
  const pick = promo.text[lang] ?? promo.text[base] ?? Object.values(promo.text).find((v) => v.trim()) ?? '';
  return pick.trim();
}

/**
 * Height (px) the Ready column needs for `shown` tiles when it is the only column, mirroring BoardView: tiles at
 * least 28vmin wide and 15.4vmin tall (13vmin number + 1.2vmin padding), 1.8vmin gaps, a 7.5vmin heading, 3vmin
 * padding, plus the page/"+n more" line. Slightly generous, so the strip never forces the list into pages.
 */
export function readyHeightNeeded(shown: number, more: boolean, w: number, h: number): number {
  const vmin = Math.min(w, h) / 100;
  const gap = 1.8 * vmin;
  const innerW = w - 8 * vmin - 6 * vmin;
  const cols = Math.max(1, Math.floor((innerW + gap) / (28 * vmin + gap)));
  const rows = Math.max(1, Math.ceil(shown / cols));
  const tiles = rows * 15.4 * vmin + (rows - 1) * gap;
  return 7.5 * vmin + tiles + 6 * vmin + (more ? 5 * vmin : 0) + 2 * vmin;
}

/** Space (px) under the header for the board, mirroring BoardView (15vmin QR + caption, paddings). */
export function boardHeightAvailable(w: number, h: number): number {
  const vmin = Math.min(w, h) / 100;
  const header = 15 * vmin + 1.6 * vmin + 2.3 * vmin + 4 * vmin;
  return h - header - 3 * vmin;
}

export function promoLayout(i: PromoInput): PromoLayout {
  if (!i.promo) return { placement: 'hidden' };
  const text = promoText(i.promo, i.lang);
  const imageUrl = i.promo.imageUrl ?? null;
  if (!text && !imageUrl) return { placement: 'hidden' };
  if (i.showPreparing) return { placement: 'preparing', text, imageUrl };
  const vmin = Math.min(i.viewportW, i.viewportH) / 100;
  const strip = (PROMO_STRIP_VH * i.viewportH) / 100 + 2 * vmin;
  const fits = boardHeightAvailable(i.viewportW, i.viewportH) - strip >= readyHeightNeeded(i.readyShown, i.readyMore, i.viewportW, i.viewportH);
  return fits ? { placement: 'strip', text, imageUrl } : { placement: 'hidden' };
}
