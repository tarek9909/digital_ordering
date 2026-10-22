import { i18next } from '@dop/i18n';

export const LANG_KEY = 'dop.console.lang';

export function storedLang(): string {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch {
    // ignore
  }
  return 'en'; // console defaults to English
}

export function switchLang(lng: 'ar' | 'en') {
  try {
    localStorage.setItem(LANG_KEY, lng);
  } catch {
    // ignore
  }
  void i18next.changeLanguage(lng);
}
