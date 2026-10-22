// Smaller rules: wait estimate, plans and flags, slugs, PINs, passwords, trial limit.
// ---- Wait estimate (TR-ALG-08)
export const WAIT_MIN = 0;
export const WAIT_MAX = 240;
export const clampWait = (m) => Math.min(WAIT_MAX, Math.max(WAIT_MIN, Math.round(m)));
export function waitRemaining(waitMinutes, waitBaseAt, now) {
    if (waitMinutes == null || !waitBaseAt)
        return { remainingMinutes: null, overdue: false };
    const remainingMs = waitBaseAt.getTime() + waitMinutes * 60_000 - now.getTime();
    if (remainingMs <= 0)
        return { remainingMinutes: 0, overdue: true };
    return { remainingMinutes: Math.ceil(remainingMs / 60_000), overdue: false };
}
// ---- Plans and feature flags (TR-ALG-15, TR-ALG-17)
export function isFeatureEnabled(override, planFeatures, flag, defaultOn = false) {
    if (override !== undefined)
        return override;
    if (planFeatures.includes(flag))
        return true;
    return defaultOn;
}
export const withinLimit = (limits, key, currentCount) => currentCount < limits[key];
/** Items that exceed the target plan; empty means the downgrade may proceed (EX-21). */
export function downgradeExcess(usage, target) {
    const pairs = [
        ['maxVenues', usage.venues],
        ['maxCountersPerVenue', usage.maxCountersInAVenue],
        ['maxLanguages', usage.maxLanguagesInAVenue],
        ['maxDisplaysPerVenue', usage.maxDisplaysInAVenue],
        ['maxStaffDevicesPerVenue', usage.maxStaffDevicesInAVenue],
        ['maxApiKeysPerVenue', usage.maxApiKeysInAVenue],
    ];
    return pairs.filter(([k, v]) => v > target[k]).map(([k, v]) => ({ limit: k, current: v, allowed: target[k] }));
}
/** Trial daily limit (TR-ALG-14). `countAfterIncrement` is the value returned by INCR. */
export const trialLimitExceeded = (status, countAfterIncrement, limit) => status === 'trial' && countAfterIncrement > limit;
// ---- Slugs (TR-URL-04)
export const RESERVED_SLUGS = new Set([
    'admin', 'api', 'app', 'www', 't', 'rt', 'cdn', 'status', 'mail', 'support', 'help', 'docs',
    'staging', 'dev', 'test', 'static', 'assets', 'auth', 'billing', 'files', // files: the storage host (L-22)
]);
export function checkSlug(slug) {
    if (slug.length < 3 || slug.length > 40)
        return 'invalid';
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug))
        return 'invalid';
    if (RESERVED_SLUGS.has(slug))
        return 'reserved';
    return 'ok';
}
/** Suggests a slug from a restaurant name (sign-up helper). */
export function suggestSlug(name) {
    const s = name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '');
    return s.length >= 3 ? s : '';
}
// ---- Staff PIN (TR-SEC-06)
export function checkPin(pin) {
    if (!/^\d{4,6}$/.test(pin))
        return 'format';
    const digits = [...pin].map(Number);
    if (digits.every((d) => d === digits[0]))
        return 'weak';
    const asc = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
    const desc = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
    if (asc || desc)
        return 'weak';
    return 'ok';
}
// ---- Passwords (TR-AUTH-04): length only, plus the breached-password list check done in packages/auth.
export const checkPasswordLength = (p) => p.length >= 10 && p.length <= 128;
// ---- Locale choice (TR-L10N-02)
export function chooseLocale(venueLocales, preferred) {
    for (const p of preferred) {
        const base = p.toLowerCase().split('-')[0];
        const hit = venueLocales.find((v) => v.toLowerCase() === p.toLowerCase()) ?? venueLocales.find((v) => v.toLowerCase().split('-')[0] === base);
        if (hit)
            return hit;
    }
    return venueLocales[0] ?? 'en';
}
/** Venue messages fall back to the primary locale (TR-L10N-03). */
export function messagesFor(all, locale, primary) {
    return { ...(all[primary] ?? {}), ...(all[locale] ?? {}) };
}
/** Links in venue texts are shown as plain domains (NFR-SEC-06). */
export function plainDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return null;
    }
}
