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

  // Never cache API or WebSocket
  if (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/group/')) {
    return;
  }

  // Only cache same-origin GET requests for the static shell
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
