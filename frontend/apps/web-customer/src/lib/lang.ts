import { pickLocale } from '@dop/client-sdk';
import { i18next } from '@dop/i18n';

// Page language (TR-L10N-02). The venue/browser default is applied once per venue; a language the customer picks
// with the header switch is kept for the rest of the visit (it is not undone by later ticket updates).

let chosen: string | null = null;

/** Explicit choice from the language switch. */
export function chooseLanguage(lng: string) {
  chosen = lng;
  void i18next.changeLanguage(lng);
}

/** Default for a venue: the explicit choice, otherwise the browser's best match among the venue's languages. */
export function applyVenueLanguage(locales: string[]) {
  // Arabic and English are always available, so an explicit choice is kept even where the venue lists only one.
  const lng = chosen === 'ar' || chosen === 'en' ? chosen : pickLocale(locales);
  if (i18next.language !== lng) void i18next.changeLanguage(lng);
}

/** Test hook. */
export const resetLanguageChoice = () => {
  chosen = null;
};
