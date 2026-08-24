const CACHE = 'cnpdrrmo-v1';
const SHELL = ['/PDRRMO.jpg', '/baranggays.geojson'];

self.addEventListener('install', event => {
  event.waitUntil(Promise.all([caches.open(CACHE), fetch('/')]).then(async ([cache, response]) => {
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(url => url.startsWith('/assets/'));
    await cache.put('/', response);
    await cache.addAll([...SHELL, ...assets]);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // ponytail: browser-managed runtime cache; add tile LRU only if field devices hit storage quotas.
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      caches.open(CACHE).then(cache => cache.put('/', response.clone()));
      return response;
    }).catch(() => caches.match('/').then(response => response || Response.error())));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok || response.type === 'opaque') caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => Response.error())));
});
