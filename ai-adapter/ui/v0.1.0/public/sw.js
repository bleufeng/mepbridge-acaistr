const CACHE_NAME = 'mepbridge-acaistr-v38';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/help.html',
  '/help.en-US.html',
  '/feedback.html',
  '/feedback.en-US.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Use network-first for HTML and built assets to avoid stale UI after rebuilds.
  const isHTML = event.request.mode === 'navigate' || url.pathname.endsWith('.html');
  const isJSModule = url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js');
  const isCSS = url.pathname.startsWith('/assets/') && url.pathname.endsWith('.css');

  if (isHTML || isJSModule || isCSS) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Other static assets use stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
