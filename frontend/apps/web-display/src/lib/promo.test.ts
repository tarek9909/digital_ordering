import { describe, expect, it } from 'vitest';
import { promoLayout, promoText, readyHeightNeeded, type PromoInput } from './promo';

const promo = { text: { ar: 'قهوة اليوم', en: 'Coffee of the day' }, imageUrl: null };
const input = (over: Partial<PromoInput> = {}): PromoInput => ({
  promo,
  lang: 'en',
  showPreparing: false,
  readyShown: 3,
  readyMore: false,
  viewportW: 1920,
  viewportH: 1080,
  ...over,
});

describe('promoText', () => {
  it('uses the screen language, then its base, then the first text set', () => {
    expect(promoText(promo, 'ar')).toBe('قهوة اليوم');
    expect(promoText(promo, 'en-US')).toBe('Coffee of the day');
    expect(promoText({ text: { en: 'Hi' }, imageUrl: null }, 'ar')).toBe('Hi');
  });
});

describe('promoLayout', () => {
  it('is hidden without a promo or without content', () => {
    expect(promoLayout(input({ promo: null })).placement).toBe('hidden');
    expect(promoLayout(input({ promo: { text: {}, imageUrl: null } })).placement).toBe('hidden');
  });

  it('sits in the Preparing column when that column is shown, whatever the Ready count', () => {
    expect(promoLayout(input({ showPreparing: true, readyShown: 24, readyMore: true }))).toEqual({ placement: 'preparing', text: 'Coffee of the day', imageUrl: null });
  });

  it('uses a bottom strip when the Ready list still fits above it', () => {
    expect(promoLayout(input({ readyShown: 3 })).placement).toBe('strip');
    expect(promoLayout(input({ promo: { text: {}, imageUrl: 'https://x.example/p.png' }, readyShown: 0 }))).toEqual({ placement: 'strip', text: '', imageUrl: 'https://x.example/p.png' });
  });

  it('hides the promo rather than shrink a full Ready list', () => {
    expect(promoLayout(input({ readyShown: 24, readyMore: true })).placement).toBe('hidden');
    expect(promoLayout(input({ readyShown: 9, viewportW: 1080, viewportH: 1920 })).placement).toBe('hidden');
  });

  it('needs more height for more rows', () => {
    expect(readyHeightNeeded(20, false, 1920, 1080)).toBeGreaterThan(readyHeightNeeded(5, false, 1920, 1080));
  });
});
