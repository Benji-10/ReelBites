// Service Worker for RealBites
// Handles push notifications for expiry alerts

const CACHE_NAME = 'realbites-v1';

// Install — skip waiting to activate immediately.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate — claim clients immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push event — show a notification when a push message is received.
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'RealBites', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'RealBites';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || 'realbites-notification',
    data: data.data || { url: '/' },
    vibrate: data.vibrate || [100, 50, 100],
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — focus or open the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If the app is already open, focus it.
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open a new window.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
