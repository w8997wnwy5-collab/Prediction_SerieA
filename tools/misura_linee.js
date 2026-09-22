/* L'ancoraggio tiene su TUTTE le linee, o solo su quella a cui e' agganciato?

   Questa domanda viene da una constatazione banale: guardando cosa l'app
   propone davvero, su dieci partite ne escono cinque fra Over 1.5 e Under 3.5.
   Sono quelle le giocate che uno fa.

   Ma il modello si ancora al mercato su DUE assi soli: chi vince (dall'1X2) e
   quanti gol (dall'Over/Under 2.5). Le altre linee — 1.5, 3.5, 4.5 — non sono
   ancorate a niente: escono dalla forma della distribuzione di Poisson, che il
   modello impone.

   L'ancoraggio sistema la MEDIA dei gol. Non dice niente sulla FORMA. E se la
   forma vera fosse diversa da quella di Poisson — piu' schiacciata, piu' larga
   — allora la media sarebbe giusta e le code sbagliate. Cioe' il 2.5 preciso e
   l'1.5 e il 3.5 storti: esattamente le linee che si giocano.

   Il conto e' diretto e non serve nessun dato nuovo: per ogni partita si
   prende la probabilita' che il modello da' a ogni linea, e si guarda quante
   volte e' poi successo davvero. Se a una linea dice 74% e succede il 74%,
   quella linea e' onesta. Se dice 74% e succede il 70%, no.

   uso: node tools/misura_linee.js
*/
var fs = require('fs'), path = require('path');
var R = '/home/user/Prediction_SerieA';
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var PESO_TIRI = 0.60, OGNI = 10, ANCORA = 1;
var LINEE = [
  { id: 'o05', nome: 'Over 0.5',  campo: 'o05', soglia: 0 },
  { id: 'o15', nome: 'Over 1.5',  campo: 'o15', soglia: 1 },
  { id: 'o25', nome: 'Over 2.5',  campo: 'o25', soglia: 2, ancorata: true },
  { id: 'o35', nome: 'Over 3.5',  campo: 'o35', soglia: 3 },
  { id: 'o45', nome: 'Over 4.5',  campo: 'o45', soglia: 4 }
];

function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }

var dati = M.prepara(tutte);
var stagioni = (doc.stagioni || []).slice().sort();
var da = parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10) + '-08-01';

var righe = [], mod = null, ultimo = null;
tutte.forEach(function (p) {
  if (p.d < da) return;
  var q = p.qex || p.q || null;
  if (!q || !p.qou) return;
  if (!ultimo || M.giorni(ultimo, p.d) >= OGNI) {
    mod = M.costruisci(tutte, { dati: dati, fino: p.d, primoTempo: false,
                                iterazioni: 160, pesoTiri: PESO_TIRI });
    ultimo = p.d;
  }
  if (!mod || !mod.ok) return;
  var i = mod.indice[p.c], j = mod.indice[p.v];
  if (i == null || j == null) return;
  var g = M.golAttesiModello(mod, i, j, { pesoTiri: PESO_TIRI });
  var am = M.ancoraMercato(g[0], g[1], mod.gol.rho,
    { q: q, qou: p.qou, peso1x2: ANCORA, pesoOU: ANCORA });
  /* mercatiDaMatrice, non esiti(): esiti() porta solo la linea 2.5, ed e'
     proprio l'insieme delle ALTRE linee che qui si vuole guardare. */
  var es = M.mercatiDaMatrice(M.matriceRisultati(am.lam, am.mu, mod.gol.rho, 11));
  var gol = p.gc + p.gv;
  var r = { gol: gol, atteso: am.lam + am.mu };
  LINEE.forEach(function (L) { r[L.id] = { p: es[L.campo], vero: gol > L.soglia ? 1 : 0 }; });
  righe.push(r);
});

console.log('partite: ' + righe.length + '   (ancoraggio ' + ANCORA + ', solo la linea 2.5 e\' agganciata)\n');
console.log('  linea        dice     succede    scarto        n     Brier');
console.log('  ────────────────────────────────────────────────────────────');
LINEE.forEach(function (L) {
  var ps = righe.map(function (r) { return r[L.id].p; });
  var vs = righe.map(function (r) { return r[L.id].vero; });
  var dice = media(ps), succede = media(vs);
  var sc = succede - dice;
  /* errore standard della differenza fra previsto e osservato */
  var va = ps.reduce(function (s, x) { return s + x * (1 - x); }, 0);
  var es = Math.sqrt(va) / ps.length;
  var z = sc / Math.max(1e-9, es);
  var brier = media(ps.map(function (x, k) { return (x - vs[k]) * (x - vs[k]); }));
  console.log('  ' + (L.nome + (L.ancorata ? ' *' : '')).padEnd(12) +
              (100 * dice).toFixed(1) + '%   ' + (100 * succede).toFixed(1) + '%   ' +
              (sc >= 0 ? '+' : '') + (100 * sc).toFixed(1) + ' punti' +
              ('  z=' + (z >= 0 ? '+' : '') + z.toFixed(1)).padEnd(10) +
              String(ps.length).padStart(5) + '   ' + brier.toFixed(4));
});
console.log('\n  * = la linea a cui l\'ancoraggio e\' agganciato\n');

var anc = LINEE.filter(function (L) { return L.ancorata; })[0];
function scarto(L) {
  var ps = righe.map(function (r) { return r[L.id].p; });
  var vs = righe.map(function (r) { return r[L.id].vero; });
  var va = ps.reduce(function (s, x) { return s + x * (1 - x); }, 0);
  return (media(vs) - media(ps)) / Math.max(1e-9, Math.sqrt(va) / ps.length);
}
var zAnc = Math.abs(scarto(anc));
var fuori = LINEE.filter(function (L) { return !L.ancorata && Math.abs(scarto(L)) > 2; });

console.log('la linea ancorata sta a ' + zAnc.toFixed(1) + 'σ dal vero.');
console.log('delle altre quattro, ' + fuori.length + ' stanno oltre 2σ' +
            (fuori.length ? ': ' + fuori.map(function (L) { return L.nome; }).join(', ') : '') + '.\n');

if (fuori.length >= 2 && zAnc < 2) {
  console.log('L\'ancoraggio sistema la MEDIA dei gol, non la FORMA. Al 2.5, dove e\'');
  console.log('agganciato, il modello e\' onesto; sulle altre linee no — e sono quelle');
  console.log('che si giocano. Ancorarsi anche alle altre linee, dove il mercato le');
  console.log('quota, dovrebbe recuperare proprio quello scarto.');
} else if (!fuori.length) {
  console.log('Tutte le linee tengono. La forma di Poisson, una volta sistemata la');
  console.log('media, descrive bene anche le code: ancorarsi alle altre linee non');
  console.log('avrebbe niente da recuperare.');
} else {
  console.log('Una linea sola fuori: puo\' essere il caso. Serve piu\' materiale prima');
  console.log('di chiamarlo un difetto della forma.');
}
