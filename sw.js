// WristLog — Service Worker
// Enables "Add to Home Screen" (PWA) and offline fallback

const CACHE = 'wristlog-v223';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icon.svg', '/profile/', '/p/'];

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

  // Only cache same-origin requests.
  // Everything else — Supabase API/auth, CDN scripts, Google OAuth —
  // must always go to the network.
  if (url.hostname !== self.location.hostname) return;

  // Navigation requests (HTML document): network-first with 3s timeout.
  // Ensures returning users always get fresh HTML unless offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      Promise.race([
        fetch(e.request).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        }),
        new Promise(resolve => setTimeout(() => resolve(null), 1500))
      ]).then(res => res || caches.match(e.request))
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Other same-origin assets (icon, manifest): stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res && res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
