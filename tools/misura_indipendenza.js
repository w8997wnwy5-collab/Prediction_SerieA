/* Le dieci giocate di una schedina cadono insieme?

   Tutta la sezione "quante ne prendi" moltiplica le probabilità, e quella
   moltiplicazione vale SOLO se le selezioni sono indipendenti. Non è ovvio che
   lo siano: dieci Over della stessa giornata dipendono tutte da quanti gol si
   fanno quel weekend, e se il weekend è avaro cadono in blocco. Se fosse così,
   il conto sarebbe sbagliato in modo sistematico — direbbe che dieci su dieci
   è più raro di quanto è, e che zero su dieci pure.

   Il modo di scoprirlo senza teorie: rigiocare le giornate passate scegliendo
   "la più solida" con il modello allenato solo sul passato, contare quante ne
   escono, e confrontare la VARIANZA osservata di quel numero con quella che
   avrebbero prove indipendenti. Se le giocate cadessero insieme, la varianza
   osservata sarebbe più larga: giornate da 10 su 10 e giornate da 3 su 10 al
   posto di tante giornate da 7 e 8.

   uso: node tools/misura_indipendenza.js
*/
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
  .sort(function (a, b) { return a.d < b.d ? -1 : 1; });
var VISTI = ['1', 'X', '2', 'O05', 'O15', 'U15', 'O25', 'U25', 'O35', 'U35', 'O45', 'U45', 'DISP', 'PARI'];

var per = {};
tutte.forEach(function (p) {
  if (!p.giornata) return;
  (per[p.s + '|' + p.giornata] = per[p.s + '|' + p.giornata] || []).push(p);
});
var chiavi = Object.keys(per).filter(function (k) { return per[k].length >= 8; }).sort();

var mod = null, ultimo = null, giornate = [];
chiavi.forEach(function (k) {
  var l = per[k].slice().sort(function (a, b) { return a.d < b.d ? -1 : 1; });
  var d0 = l[0].d;
  var prima = tutte.filter(function (x) { return x.d < d0; });
  if (prima.length < 600) return;
  if (!ultimo || M.giorni(ultimo, d0) > 6) {
    mod = M.costruisci(prima, { fino: d0, primoTempo: false, iterazioni: 110 });
    ultimo = d0;
  }
  if (!mod) return;
  var ps = [], esiti = [];
  l.forEach(function (p) {
    if (mod.indice[p.c] == null || mod.indice[p.v] == null) return;
    var sim = M.simula(mod, p.c, p.v, { N: 900, q: p.q || null, qou: p.qou || null });
    if (!sim) return;
    var medie = {};
    for (var kk in sim.fasce) medie[kk] = sim.fasce[kk].p;
    var voci = M.elencoMercati(medie, [p.c, p.v]).filter(function (m) {
      return VISTI.indexOf(m.id) >= 0 && m.p >= 0.12 && m.p <= 0.88;
    });
    if (!voci.length) return;
    voci.sort(function (a, b) { return b.p - a.p; });
    var pag = voci.filter(function (m) { return m.p <= 0.78; });
    var m = pag[0] || voci[0];
    var e = M.haVinto(m.id, p.gc, p.gv, p.ptc, p.ptv);
    if (e === null) return;
    ps.push(m.p); esiti.push(e ? 1 : 0);
  });
  if (ps.length >= 8) {
    giornate.push({ ps: ps, n: ps.length, presi: esiti.reduce(function (a, b) { return a + b; }, 0) });
  }
});

if (giornate.length < 20) {
  console.log('Servono almeno 20 giornate complete, ce ne sono ' + giornate.length + '.');
  process.exit(0);
}

var varOss = 0, varInd = 0, presi = 0, attesi = 0, tot = 0;
giornate.forEach(function (g) {
  var a = g.ps.reduce(function (s, p) { return s + p; }, 0);
  varOss += (g.presi - a) * (g.presi - a);
  varInd += g.ps.reduce(function (s, p) { return s + p * (1 - p); }, 0);
  presi += g.presi; attesi += a; tot += g.n;
});
varOss /= giornate.length; varInd /= giornate.length;

console.log(giornate.length + ' giornate rigiocate senza sapere come erano finite, ' +
  tot + ' selezioni\n');
console.log('prese     ' + presi + ' su ' + tot + '  (' + (100 * presi / tot).toFixed(1) + '%)');
console.log('promesse  ' + attesi.toFixed(0) + '        (' + (100 * attesi / tot).toFixed(1) + '%)');
console.log('scarto    ' + (presi - attesi >= 0 ? '+' : '') + (presi - attesi).toFixed(1) +
  ' esiti, z = ' + ((presi - attesi) / Math.sqrt(varInd * giornate.length)).toFixed(2));

console.log('\nvarianza del numero di esiti presi, per giornata');
console.log('  osservata        ' + varOss.toFixed(3));
console.log('  da indipendenza  ' + varInd.toFixed(3));
var rap = varOss / varInd;
console.log('  rapporto         ' + rap.toFixed(2));
console.log('\n' + (rap > 1.2
  ? 'LE GIOCATE CADONO INSIEME. Moltiplicare le probabilita sottostima\n' +
    'sia le giornate perfette sia quelle disastrose: il conto va rifatto.'
  : (rap < 0.8
    ? 'Le giocate si compensano fra loro: piu regolari di quanto ci si aspetti.'
    : 'Compatibile con l\'indipendenza: moltiplicare le probabilita e lecito,\n' +
      'ed e quello che fa la sezione "quante ne prendi".')));

var dist = {};
giornate.forEach(function (g) { dist[g.presi] = (dist[g.presi] || 0) + 1; });
console.log('\nquante ne uscivano davvero, per giornata:');
Object.keys(dist).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) {
  console.log('  ' + String(k).padStart(2) + '  ' + '#'.repeat(dist[k]) + ' ' + dist[k]);
});
