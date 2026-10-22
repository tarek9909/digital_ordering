export function followerLevel(f) {
    if (f.hasActivePush)
        return 'push';
    if (f.present)
        return 'live';
    if (f.wasLive)
        return 'closed';
    return 'none';
}
const RANK = { push: 3, live: 2, closed: 1, none: 0 };
export function ticketLevel(levels) {
    return levels.reduce((best, l) => (RANK[l] > RANK[best] ? l : best), 'none');
}
export const PRESENCE_TTL_SEC = 60;
export const HEARTBEAT_INTERVAL_SEC = 20;
// Exact Web Push service hosts (L-15). This is the only destination check for subscription endpoints, so it pins
// the hosts browsers actually hand out instead of whole provider domains (e.g. storage.googleapis.com):
// - Chrome / Chromium-based (FCM): fcm.googleapis.com
// - Firefox (autopush): updates.push.services.mozilla.com
// - Safari / iOS web apps (APNs): web.push.apple.com — one label under push.apple.com
// - Edge on Windows (WNS): e.g. wns2-par02p.notify.windows.com — one label under notify.windows.com
const PUSH_EXACT = { 'fcm.googleapis.com': 'fcm', 'updates.push.services.mozilla.com': 'mozilla' };
const PUSH_ONE_LABEL = [
    [/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.push\.apple\.com$/, 'apns'],
    [/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.notify\.windows\.com$/, 'wns'],
];
/**
 * Push service of an endpoint, from its host (TR-ALR-09 bookkeeping; endpoint must be a known push service).
 * Requires https on the default port (443) and no URL credentials.
 */
export function pushServiceOf(endpoint) {
    let u;
    try {
        u = new URL(endpoint);
    }
    catch {
        return null;
    }
    // `new URL` normalises an explicit :443 to '' for https, so any other port is refused.
    if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password)
        return null;
    const host = u.hostname.toLowerCase();
    const exact = PUSH_EXACT[host];
    if (exact)
        return exact;
    for (const [re, service] of PUSH_ONE_LABEL)
        if (re.test(host))
            return service;
    return null;
}
/** Push send result handling (TR-ALR-09). */
export function classifyPushResult(statusCode) {
    if (statusCode >= 200 && statusCode < 300)
        return 'success';
    if (statusCode === 404 || statusCode === 410)
        return 'revoke';
    if (statusCode === 413)
        return 'payload_bug';
    if (statusCode === 429 || statusCode >= 500)
        return 'retry';
    return 'fail';
}
export const PUSH_MAX_CONSECUTIVE_FAILURES = 5;
