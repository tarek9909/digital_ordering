import { publicApi } from './api';
import { clientId } from './storage';

// Web Push subscription (TRD §11.2 step 4). One service worker and one subscription per browser for all tenants.

const urlB64ToUint8Array = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

let vapidKey: string | null = null;
async function vapid(): Promise<string> {
  if (vapidKey !== null) return vapidKey;
  const c = await publicApi.get<{ vapidPublicKey: string }>('/config');
  vapidKey = c.vapidPublicKey;
  return vapidKey;
}

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js', { scope: '/', type: import.meta.env.DEV ? 'module' : 'classic' });
  } catch {
    return null;
  }
}

/** Asks for permission (must follow a tap on iOS) and saves the subscription for this ticket. */
export async function enablePush(token: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('Notification' in window) || !('PushManager' in window)) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const key = await vapid();
  if (!key) return 'unsupported';
  const reg = (await registerWorker()) ?? (await navigator.serviceWorker.ready);
  let sub = await reg.pushManager.getSubscription();
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await publicApi.put(`/tickets/${token}/push-subscription`, { clientId: clientId(), subscription: { endpoint: json.endpoint, keys: json.keys } });
  return 'granted';
}

export const notificationsBlocked = () => 'Notification' in window && Notification.permission === 'denied';

/**
 * A browser that already has a push subscription (from an earlier ticket) still has to link it to this ticket's
 * follower, or this ticket never sends background alerts (TRD §11.2 step 4). Returns 'none' when the browser has
 * no subscription, 'linked' once the server accepted it, and throws when linking failed.
 */
export async function linkExistingSubscription(token: string): Promise<'none' | 'linked'> {
  if (!('serviceWorker' in navigator)) return 'none';
  if ('Notification' in window && Notification.permission !== 'granted') return 'none';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager?.getSubscription();
  if (!sub) return 'none';
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  if (!json.endpoint || !json.keys) return 'none';
  await publicApi.put(`/tickets/${token}/push-subscription`, { clientId: clientId(), subscription: { endpoint: json.endpoint, keys: json.keys } });
  return 'linked';
}
