/*
 * Betty's service worker: makes the app installable and lets it open with no signal.
 * - Pages: network first (always the newest version when online), the last good copy when offline.
 * - /assets/*: file names change with every build, so a copy is good forever: cache first. Old ones are trimmed.
 * - /api/* and other sites are never touched: Claude, voices, weather and traffic always go to the network.
 */
const SHELL = 'betty-shell-v1';
const ASSETS = 'betty-assets-v1';
const KEEP_ASSETS = 40;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'])).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== ASSETS) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim() {
  const c = await caches.open(ASSETS);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_ASSETS))) await c.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match('/').then((hit) => hit || Response.error())));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)).then(trim); }
      return res;
    })));
  }
});
