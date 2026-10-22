/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

// Service worker (TR-ALR-01, TR-ALR-08): precaches the app shell only — ticket data is network only — and
// handles push and notificationclick for every tenant on this origin.
declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

interface PushPayload {
  v: number;
  type: string;
  ticketToken: string;
  title: string;
  body: string;
  icon?: string;
  tag: string;
  renotify: boolean;
  round: number;
  attempt: number;
}

self.addEventListener('push', (event) => {
  let p: PushPayload;
  try {
    p = event.data!.json() as PushPayload;
  } catch {
    return;
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(p.title, {
        body: p.body,
        icon: p.icon ?? '/icon-192.png',
        badge: '/badge-72.png',
        tag: p.tag,
        // renotify, requireInteraction and vibrate are not in every lib.dom version; set them where supported.
        ...({ renotify: p.renotify, requireInteraction: true, vibrate: [300, 150, 300, 150, 600] } as object),
        data: { token: p.ticketToken },
      });
      // Tell open pages to start their live alert.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) c.postMessage({ type: 'ticket.alert', token: p.ticketToken, round: p.round, attempt: p.attempt });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const token = (event.notification.data as { token?: string } | undefined)?.token;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clients.find((c) => token && new URL(c.url).pathname === `/${token}`);
      if (existing) return existing.focus();
      return self.clients.openWindow(token ? `/${token}` : '/tickets');
    })(),
  );
});

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
