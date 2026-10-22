import i18next, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import arCommon from '../locales/ar/common.json';
import enCommon from '../locales/en/common.json';

// i18n (TR-L10N-01): every user-visible string is a key; English is the source language; Arabic is primary on
// customer pages and right-to-left. Each app keeps its own namespace in locales/{lng}/{app}.json.

export type Lng = 'ar' | 'en';
export const LANGUAGES: Lng[] = ['ar', 'en'];

export function initI18n(app: string, appResources: Record<Lng, Record<string, unknown>>, lng: string) {
  const resources: Resource = {
    ar: { common: arCommon, [app]: appResources.ar },
    en: { common: enCommon, [app]: appResources.en },
  };
  void i18next.use(initReactI18next).init({
    resources,
    lng: LANGUAGES.includes(lng as Lng) ? lng : 'ar',
    fallbackLng: 'en',
    ns: ['common', app],
    defaultNS: app,
    fallbackNS: 'common',
    interpolation: { escapeValue: false }, // React escapes
    returnNull: false,
  });
  applyDir(i18next.language);
  i18next.on('languageChanged', applyDir);
  return i18next;
}

/** `dir` and `lang` on <html> from the locale (TR-FE-08). */
export function applyDir(lng: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lng;
  document.documentElement.dir = lng.startsWith('ar') ? 'rtl' : 'ltr';
}

export { i18next };
export { useTranslation, Trans } from 'react-i18next';
