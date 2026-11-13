const CACHE = 'abs-shell-v1';
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

  if (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/group/')) {
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
  let data = { title: 'abs', body: 'Time to study together' };
  if (e.data) {
    try { data = e.data.json(); } catch (e) {}
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'abs', {
      body: data.body || 'Time to study together',
      icon: data.icon || '/icon.svg',
      data: data.data || {},
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;
  if (!url) return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
