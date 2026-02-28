// WristLog — Service Worker
// Enables "Add to Home Screen" (PWA) and offline fallback

const CACHE = 'wristlog-v18';
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
  const url = new URL(e.request.url);

  // Only cache same-origin requests (odrunner.github.io).
  // Everything else — Supabase API/auth, CDN scripts, Google OAuth —
  // must always go to the network. Caching Supabase responses causes
  // stale data and broken auth after page refresh.
  if (url.hostname !== self.location.hostname) return;

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
