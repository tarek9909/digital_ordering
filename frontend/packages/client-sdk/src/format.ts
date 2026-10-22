// Locale helpers (TR-L10N-02 – TR-L10N-04, TR-FE-08).

export const RTL_LOCALES = new Set(['ar', 'fa', 'he', 'ur']);
export const dirOf = (locale: string) => (RTL_LOCALES.has(locale.split('-')[0]!) ? 'rtl' : 'ltr');

/** Venue languages ∩ browser languages, else the venue primary (TR-L10N-02). */
export function pickLocale(venueLocales: string[], preferred: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages : []): string {
  for (const p of preferred) {
    const base = p.toLowerCase().split('-')[0];
    const hit = venueLocales.find((v) => v.toLowerCase() === p.toLowerCase()) ?? venueLocales.find((v) => v.split('-')[0] === base);
    if (hit) return hit;
  }
  return venueLocales[0] ?? 'ar';
}

/** Times in the venue zone; ticket numbers always keep Western digits (TR-L10N-01). */
export function formatTime(iso: string | Date, locale: string, timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone, numberingSystem: 'latn' }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatDateTime(iso: string | Date, locale: string, timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatMoney(minor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}

export const minutesSince = (iso: string, now = Date.now()) => Math.floor((now - new Date(iso).getTime()) / 60_000);
