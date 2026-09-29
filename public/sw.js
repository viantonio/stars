// Offline support. On install, precache the app shell (including the hashed
// JS/CSS it references) plus the bundled catalogues and textures, so the
// observatory works offline after the first visit. Navigations are
// network-first; other assets are served from the cache and refreshed in the
// background.
const CACHE = 'stars-v2';

const DATA = [
  'data/stars.bin', 'data/stars-meta.json', 'data/constellations.json', 'data/dso.json',
  'data/milkyway-outline.json', 'data/CometEls.txt', 'data/asteroids.json', 'data/satellites.tle',
];
const TEXTURES = ['milkyway', 'moon', 'moon_normal', 'sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].map(
  (t) => `tex/${t}.jpg`,
);
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([...SHELL, ...DATA, ...TEXTURES]).catch(() => undefined);
      // Also cache the hashed bundles referenced by the page.
      try {
        const html = await (await fetch('./', { cache: 'no-cache' })).text();
        const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
        await cache.addAll(assets);
      } catch {
        /* offline during install: the runtime cache fills in later */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || Response.error())),
    );
    return;
  }
  // Stale-while-revalidate.
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        if (hit) {
          e.waitUntil(refresh);
          return hit;
        }
        return refresh;
      }),
    ),
  );
});
