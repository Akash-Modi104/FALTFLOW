// Flatflow moved to a new address. Devices that still have the old service worker fetch this
// file on their next update check; it clears the offline cache, retires itself and reloads any
// open page, which then gets the redirect page from the network.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  try{for(const k of await caches.keys())await caches.delete(k);}catch{}
  await self.clients.claim();
  await self.registration.unregister();
  for(const c of await self.clients.matchAll({type:'window'}))c.navigate(c.url).catch(()=>{});
})()));
