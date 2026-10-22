import { pickLocale } from '@dop/client-sdk';
import { i18next } from '@dop/i18n';

const KEY = 'dop.site.lang';

export function initialLanguage(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch {
    /* storage blocked */
  }
  return pickLocale(['ar', 'en']);
}

export function setLanguage(lng: 'ar' | 'en') {
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    /* storage blocked */
  }
  void i18next.changeLanguage(lng);
}
