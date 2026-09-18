/* Build replaces these constants. Only explicitly public demo assets are cached. */
const VERSION='__VERSION__', ASSETS=__ASSETS__;
const CACHE=`scada-public-${VERSION}`;
const absolute=path=>new URL(path,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(path=>new Request(absolute(path),{cache:'reload',credentials:'omit'}))))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('scada-public-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin)return;
  const path=url.href.slice(self.registration.scope.length);
  // Never intercept login, authenticated application HTML, API, SSE or report artifacts.
  if(!url.href.startsWith(self.registration.scope)||url.search||!ASSETS.includes(path))return;
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(req))??fetch(req)));
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let payload={};try{payload=event.data?.json()??{};}catch{}
  const target=new URL(typeof payload.url==='string'?payload.url:'app/',self.registration.scope);
  const url=target.origin===self.location.origin&&target.href.startsWith(self.registration.scope)?target.href:absolute('app/');
  await self.registration.showNotification(typeof payload.title==='string'?payload.title.slice(0,100):'SCADA · Уведомление',{body:typeof payload.body==='string'?payload.body.slice(0,200):'Откройте установку для подробностей.',tag:typeof payload.tag==='string'?payload.tag.slice(0,128):'scada',icon:absolute('assets/icon-192.png'),badge:absolute('assets/icon-192.png'),data:{url}});
})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
  const url=new URL(event.notification.data?.url??'app/',self.registration.scope);if(url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>w.url===url.href);if(existing){await existing.focus();return;}await self.clients.openWindow(url.href);
})());});
