import type { UaFamily } from '@dop/contracts';

// Platform detection (TR-ALR-04): feature detection first; the user agent only picks guide text and ua_family.

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function inAppBrowser(): 'instagram' | 'facebook' | 'whatsapp' | 'tiktok' | null {
  const u = ua();
  if (/Instagram/i.test(u)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(u)) return 'facebook';
  if (/WhatsApp/i.test(u)) return 'whatsapp';
  if (/TikTok|musical_ly|BytedanceWebview/i.test(u)) return 'tiktok';
  return null;
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function uaFamily(): UaFamily {
  const inApp = inAppBrowser();
  if (inApp) return `inapp-${inApp}` as UaFamily;
  const u = ua();
  if (isIOS()) {
    if (isStandalone()) return 'ios-webapp';
    if (/CriOS|FxiOS|EdgiOS/.test(u)) return 'ios-other';
    return 'ios-safari';
  }
  if (/Android/.test(u)) {
    if (/SamsungBrowser/.test(u)) return 'android-samsung';
    if (/Firefox/.test(u)) return 'android-firefox';
    if (/Chrome/.test(u)) return 'android-chrome';
    return 'android-other';
  }
  if (/Windows|Macintosh|Linux/.test(u)) return 'desktop';
  return 'other';
}

/** iOS Safari tab without Home Screen install: Web Push needs "Add to Home Screen" first (iOS 16.4+). */
export const needsHomeScreen = () => isIOS() && !isStandalone() && !pushSupported();
