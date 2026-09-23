/* Rete prima, cache come riserva. La pagina e gli script vengono chiesti alla
   rete SALTANDO la cache del browser: GitHub Pages dice ai browser di tenersi
   index.html per dieci minuti, e senza questo si finisce a guardare la versione
   di ieri chiedendosi perché non è cambiato niente. */
var CACHE = 'seriea-v5';
var ASSETS = ['./', './index.html', './modello.js', './worker.js', './manifest.webmanifest'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); })
    .then(function(){ return self.skipWaiting(); }).catch(function(){}));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k !== CACHE; })
      .map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  var url = e.request.url;
  /* Saltare la cache del browser costa una richiesta intera, e per i file
     grossi si sente. La pagina, gli script e i file piccoli e deperibili —
     il campionato di casa, il meta, l'indice — vanno sempre chiesti freschi:
     GitHub Pages dice ai browser di tenersi index.html per dieci minuti, e
     senza questo si finisce a guardare la versione di ieri.

     Gli archivi degli ALTRI campionati no: sono 2.9 MB in quattro file, e
     ri-scaricarli a ogni apertura vorrebbe dire tre megabyte di traffico
     ogni volta che si apre l'app sul telefono. Cambiano tre volte al giorno,
     non tre volte al minuto. Per loro basta la normale rivalidazione: il
     browser chiede "e' cambiato?" e si sente rispondere 304, che non costa
     niente, e li riscarica solo quando serve davvero. */
  var grosso = /\/data\/leghe\//.test(url);
  var sempreFresco = !grosso && (e.request.mode === 'navigate' ||
                     /\.(html|js|json|webmanifest)(\?|$)/.test(url));
  var richiesta = sempreFresco
    ? new Request(e.request, { cache: 'reload' })
    : e.request;
  e.respondWith(
    fetch(richiesta).then(function(resp){
      var copia = resp.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copia); }).catch(function(){});
      return resp;
    }).catch(function(){
      return caches.match(e.request).then(function(hit){ return hit || caches.match('./index.html'); });
    })
  );
});
