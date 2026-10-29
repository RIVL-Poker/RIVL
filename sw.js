// Offline helper for the installed app: keeps a copy of the site on the phone so RIVL opens instantly.
// scripts/build-site.mjs fills in VERSION (a hash of the site files) and CORE (the files to keep), so each
// deploy installs a fresh, complete copy and the old one is deleted. Online play, sign-in and every /api or
// /ws call always go to the server.
const VERSION='dev';
const CORE=['/'];
const CACHE='rivl-'+VERSION;

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('rivl-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

// Pages that are their own files; every other address is the single-page app (index.html).
const PAGES=new Set(['/stats.html','/privacy.html','/terms.html']);

self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin)return;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/ws/')||url.pathname==='/sw.js')return;
  // Sounds are streamed in ranges, which a cached copy cannot answer, so they stay with the browser cache.
  if(req.headers.has('range')||req.destination==='audio'||req.destination==='video')return;
  if(req.mode==='navigate'){
    const key=PAGES.has(url.pathname)?url.pathname:'/';
    event.respondWith(caches.match(key,{cacheName:CACHE}).then(hit=>hit||fetch(req)));
    return;
  }
  // Site files are matched without their ?v= tags: the cached copy is always the one this deploy shipped.
  // Anything not kept up front (backgrounds, avatars) is saved the first time it loads.
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(req,{ignoreSearch:true}).then(hit=>hit||fetch(req).then(res=>{
    if(res.ok&&res.type==='basic')cache.put(url.pathname,res.clone());
    return res;
  }))));
});
