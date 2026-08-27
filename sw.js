/* Rete prima, cache come riserva: offline funziona, e quando pubblichi una
   versione nuova la vedi subito. I dati (data/*.json) non vengono mai serviti
   dalla cache se la rete c'è: un modello che gira su numeri vecchi è peggio
   di un modello che non gira. */
var CACHE = 'seriea-v1';
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
  e.respondWith(
    fetch(e.request).then(function(resp){
      var copia = resp.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copia); }).catch(function(){});
      return resp;
    }).catch(function(){
      return caches.match(e.request).then(function(hit){ return hit || caches.match('./index.html'); });
    })
  );
});
