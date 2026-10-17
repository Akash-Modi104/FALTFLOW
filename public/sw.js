const CACHE='flatflow-v13';
const ASSETS=['./','./index.html','./style.css?v=13','./app.js?v=13','./core.js?v=13','./sync.js?v=13','./session.js?v=13','./config.js?v=13','./splitwise.js?v=13','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('flatflow-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(async()=>await caches.match(e.request)||((e.request.mode==='navigate')?await caches.match('./index.html'):Response.error())));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const c=clients.find(c=>c.url.startsWith(self.registration.scope));if(c)return c.focus();return self.clients.openWindow(self.registration.scope);}));});

// Daily chore reminders arrive empty; expense notifications carry an encrypted message.
self.addEventListener('push',e=>{let m=null;try{m=e.data&&e.data.json();}catch{}
  const title=typeof m?.title==='string'?m.title.slice(0,120):'Flatflow · Your home is calling',body=typeof m?.body==='string'?m.body.slice(0,400):'Open Flatflow to check your chores and your household’s latest routine.';
  e.waitUntil(self.registration.showNotification(title,{body,icon:'./icon-192.png',badge:'./icon-192.png',tag:typeof m?.tag==='string'?m.tag:'flatflow-reminder',renotify:!!m,data:{url:self.registration.scope}}));});
