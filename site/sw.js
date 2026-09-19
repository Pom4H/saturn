/* Public landing assets only. Never cache plant routes, APIs or authenticated responses. */
const CACHE = '__SATURN_CACHE__';
const ASSETS = __SATURN_ASSETS__;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('saturn-landing-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match('/'))));
    return;
  }
  if (!ASSETS.includes(url.pathname) || url.pathname === '/') return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    return (await cache.match(url.pathname)) || fetch(event.request);
  }));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SATURN_SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(client => new URL(client.url).pathname === '/');
    if (client) return client.focus();
    return self.clients.openWindow('/');
  }));
});
