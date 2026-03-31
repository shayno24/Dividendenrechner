// Cache name stays fixed – no more manual version bumping needed.
// Updates are detected by comparing the ETag/Last-Modified of index.html.
const CACHE = 'dividenden-app';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

// Install: pre-cache all assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up any old differently-named caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - For index.html: network-first with cache fallback.
//   If the network returns a fresh response, update the cache and
//   tell all open tabs to reload so they pick up the new version.
// - For everything else: cache-first (icons, manifest are stable).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isHTML = url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(networkRes => {
        if (networkRes.ok) {
          const clone = networkRes.clone();
          caches.open(CACHE).then(async c => {
            const cached = await c.match(e.request);
            // Compare ETags to detect a real change
            const oldEtag = cached ? cached.headers.get('etag') : null;
            const newEtag = networkRes.headers.get('etag');
            const oldModified = cached ? cached.headers.get('last-modified') : null;
            const newModified = networkRes.headers.get('last-modified');
            const changed =
              (newEtag && oldEtag && newEtag !== oldEtag) ||
              (newModified && oldModified && newModified !== oldModified) ||
              (!oldEtag && !oldModified); // first load – always cache
            if (changed) {
              await c.put(e.request, clone);
              // Notify all tabs: new version available, please reload
              const clients = await self.clients.matchAll({ type: 'window' });
              clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
            }
          });
        }
        return networkRes;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        });
      })
    );
  }
});
