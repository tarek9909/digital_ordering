import { pickLocale } from '@dop/client-sdk';
import { i18next } from '@dop/i18n';

export const LANG_KEY = 'dop.admin.lang';

export function storedLang(): string {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch {
    // storage unavailable
  }
  return pickLocale(['ar', 'en']);
}

export function switchLang(lng: 'ar' | 'en') {
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {
    // storage unavailable
  }
  void i18next.changeLanguage(lng);
}
