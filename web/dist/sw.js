const CACHE = 'abs-shell-v2';
const SW_VERSION = 'sw-v2';
const ASSETS = ['/', '/login', '/register'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/group/') || url.pathname.startsWith('/push/') || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      });
      return cached || fetchPromise;
    })
  );
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