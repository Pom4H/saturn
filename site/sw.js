/* Public Saturn landing assets only. Never cache plant routes, APIs or authenticated responses. */
const CACHE = '__SATURN_CACHE__';
const ROOT_URL = new URL('./', self.location.href);
const ROOT = ROOT_URL.pathname;
const ASSETS = __SATURN_ASSETS__.map(path => new URL(path || './', ROOT_URL).pathname);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('saturn-landing-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && url.pathname === ROOT) {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(ROOT))));
    return;
  }
  if (!ASSETS.includes(url.pathname) || url.pathname === ROOT) return;
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
    const client = clients.find(client => new URL(client.url).pathname === ROOT);
    if (client) return client.focus();
    return self.clients.openWindow(ROOT);
  }));
});
