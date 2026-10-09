/* PROD-17 (auditoria 2026-10-07): service worker do Commandah.
   Guarda SÓ o próprio aplicativo (a página, os ícones e as bibliotecas dos CDNs) para
   que, ao recarregar sem internet, o sistema abra e mostre o aviso de conexão (que
   tenta de novo sozinho) em vez da página de erro do navegador.
   NUNCA guarda dados: nada do Supabase (vendas, comandas, login) passa pelo cache.

   - Página: rede primeiro (sempre a versão mais nova); sem rede, ou se a rede
     demorar mais de 6 s, usa a última cópia guardada.
   - Ícones e bibliotecas com versão fixa: cópia guardada primeiro, atualizada por trás.

   Desligar em emergência: trocar o conteúdo deste arquivo por
     self.addEventListener('install',()=>self.skipWaiting());
     self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.map(c=>caches.delete(c)))).then(()=>self.registration.unregister())));
   e publicar. */
const CACHE = 'commandah-app-v1';
const SHELL = new URL('./', self.registration.scope).href;
const PRECACHE = ['./', 'manifest.webmanifest', 'assets/marca/favicon.svg', 'assets/marca/icon-192.png'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('commandah-app-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function pageFromNetwork(request){
  return fetch(request, { cache: 'no-store' }).then(res => {
    if(res && res.ok){
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(SHELL, copy)).catch(() => {});
    }
    return res;
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(req.mode === 'navigate' && url.origin === self.location.origin){
    event.respondWith((async () => {
      const network = pageFromNetwork(req);
      const cached = await caches.match(SHELL);
      if(!cached) return network; // primeira visita: só a rede
      const slow = new Promise(resolve => setTimeout(() => resolve(cached), 6000));
      try{ return await Promise.race([network, slow]); }
      catch(e){ return cached; }
    })());
    return;
  }

  const sameOriginAsset = url.origin === self.location.origin && /\/(assets\/|manifest\.webmanifest$)/.test(url.pathname);
  if(sameOriginAsset || CDN_HOSTS.includes(url.hostname)){
    event.respondWith(caches.open(CACHE).then(async c => {
      const cached = await c.match(req);
      const fresh = fetch(req).then(res => {
        if(res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
        return res;
      });
      if(cached){ fresh.catch(() => {}); return cached; }
      return fresh;
    }));
  }
});
