// WristLog — Service Worker
// Enables "Add to Home Screen" (PWA) and offline fallback

const CACHE = 'wristlog-v5';
const PRECACHE = ['/wristlog/app.html', '/wristlog/manifest.json', '/wristlog/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Never intercept API calls — always go to the network
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Return cached version if available; also refresh cache in background
      const networkFetch = fetch(e.request).then(res => {
        if (res && res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached); // network failed → serve cached
      return cached || networkFetch;
    })
  );
});
