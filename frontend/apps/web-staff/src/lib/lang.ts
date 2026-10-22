import { pickLocale } from '@dop/client-sdk';
import { i18next } from '@dop/i18n';

const KEY = 'dop.staff.lang';

export function storedLang(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch {
    /* storage blocked */
  }
  return pickLocale(['ar', 'en']);
}

export function setLang(lng: 'ar' | 'en') {
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    /* storage blocked */
  }
  void i18next.changeLanguage(lng);
}

const NAME_KEY = 'dop.staff.deviceName';

export function storedDeviceName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function storeDeviceName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage blocked */
  }
}
