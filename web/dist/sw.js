const SW_VERSION = 'sw-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only intercept non-HTML static assets for caching
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isHTML = e.request.headers.get('Accept')?.includes('text/html');
  if (isHTML) return;  // HTML pages are auth-dependent — always go to network
  e.respondWith(fetch(e.request));
});

self.addEventListener('push', (e) => {
  let title = 'GrandBlue';
  let body = 'Time to study together';
  let icon = '/icon.svg';
  let data = {};

  if (e.data) {
    try {
      const parsed = e.data.json();
      if (parsed && typeof parsed === 'object') {
        title = parsed.title || title;
        body = parsed.body || body;
        icon = parsed.icon || icon;
        data = parsed.data || data;
      }
    } catch (_) {}
  }

  e.waitUntil(
    self.registration.showNotification(title, { body, icon, data })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});