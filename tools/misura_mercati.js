/* A cosa serve davvero questo modello?

   Il risultato che ha fatto nascere questo strumento e' scomodo. Sull'1X2 —
   chi vince — il peso migliore da dare al mercato non e' 0.85, e' UNO:

     peso mercato 0     0.19049      (il modello da solo)
     peso mercato 0.85  0.18402      (come faceva l'app)
     peso mercato 1     0.18359      (il modello zitto)

   Monotona fino al bordo. Sull'esito della partita l'opinione del modello vale
   zero, e ogni grammo che le si concede peggiora la previsione.

   Verrebbe da concludere che il modello e' inutile, e sarebbe la conclusione
   sbagliata. Il mercato quota tre cose: 1X2, Over/Under 2.5, handicap. L'app
   ne mostra quaranta — Gol/Nogol, i mercati del primo tempo, i risultati
   esatti, quante ne segna una squadra sola. Su quelle il mercato non dice
   niente, e non c'e' niente a cui ancorarsi.

   Quindi la domanda giusta non e' "il modello batte il mercato?" (no, e non lo
   fara' mai) ma: IL PESO GIUSTO E' LO STESSO SU TUTTI I MERCATI? Perche' se
   sull'1X2 conviene stare zitti ma su Gol/Nogol conviene parlare, allora un
   peso solo per tutti e' sbagliato per costruzione — e nessuno lo controlla,
   perche' tutti tarano l'ancoraggio sull'1X2, che e' l'unico su cui il
   confronto e' facile.

   Qui si misura mercato per mercato, con Brier invece di RPS (sono esiti si'/no)
   e con la solita disciplina: si sceglie su una meta' delle stagioni e si
   verifica sull'altra.

   uso: node tools/misura_mercati.js
*/
var fs = require('fs'), path = require('path');
var R = '/home/user/Prediction_SerieA';
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var PESI = [0, 0.3, 0.5, 0.7, 0.85, 1];
var PESO_TIRI = 0.60, OGNI = 10;

/* I mercati che l'app mostra davvero e di cui l'archivio sa com'e' finita.
   Divisi in due famiglie, perche' e' quella la domanda:
     ancorati  = il mercato li quota, l'ancoraggio ci punta dritto
     orfani    = il mercato non li quota, ci arrivano solo di rimbalzo */
var MERCATI = [
  {campo:'casa',  nome:'Vince Casa',        anc:true},
  {campo:'pari',  nome:'Pareggio',          anc:true},
  {campo:'o25',   nome:'Over 2.5',          anc:true},
  {campo:'gol',   nome:'Gol/Gol',           anc:false},
  {campo:'o15',   nome:'Over 1.5',          anc:false},
  {campo:'o35',   nome:'Over 3.5',          anc:false},
  {campo:'c1x',   nome:'Casa non perde',    anc:false},
  {campo:'c12',   nome:'Non finisce pari',  anc:false},
  {campo:'tc15',  nome:'Casa segna 2+',     anc:false},
  {campo:'tv15',  nome:'Via segna 2+',      anc:false},
  {campo:'h1c',   nome:'Casa avanti al 45\'', anc:false, pt:true},
  {campo:'h1x',   nome:'Pari al 45\'',      anc:false, pt:true},
  {campo:'m1',    nome:'Gol nel 1° tempo',  anc:false, pt:true}
];

function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }
function z(a, b) {
  var d = a.map(function (x, i) { return x - b[i]; }), m = media(d);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / Math.max(1, d.length - 1));
  return m / (sd / Math.sqrt(d.length));
}

var dati = M.prepara(tutte);
var stagioni = (doc.stagioni || []).slice().sort();
var inizio = parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10) + '-08-01';
var confine = parseInt(stagioni[Math.max(0, stagioni.length - 2)].slice(0, 4), 10) + '-08-01';

/* Per ogni partita e ogni peso: la previsione di OGNI mercato, e l'esito vero.
   Una passata sola, poi si taglia come si vuole. */
var righe = [], mod = null, ultimo = null;
tutte.forEach(function (p) {
  if (p.d < inizio) return;
  var q1x2 = p.qex || p.q || null;
  if (!q1x2) return;
  if (!ultimo || M.giorni(ultimo, p.d) >= OGNI) {
    mod = M.costruisci(tutte, { dati: dati, fino: p.d, iterazioni: 160, pesoTiri: PESO_TIRI });
    ultimo = p.d;
  }
  if (!mod || !mod.ok) return;
  var i = mod.indice[p.c], j = mod.indice[p.v];
  if (i == null || j == null) return;
  var veri = M.esitiReali(p.gc, p.gv, p.ptc, p.ptv);
  if (!veri) return;
  var g = M.golAttesiModello(mod, i, j, { pesoTiri: PESO_TIRI });
  var quotePT = M.quotePrimoTempo(mod, i, j, {});
  var perPeso = PESI.map(function (w) {
    var am = M.ancoraMercato(g[0], g[1], mod.gol.rho,
      { q: q1x2, qou: p.qou || null, peso1x2: w, pesoOU: w });
    var mt = M.matriceRisultati(am.lam, am.mu, mod.gol.rho, 11);
    var s = M.mercatiDaMatrice(mt);
    if (quotePT) {
      var pf = M.primoFinale(am.lam, am.mu, mod.gol.rho, quotePT);
      if (pf) M.tempiDaMatrici(
        M.matriceRisultati(am.lam * quotePT[0], am.mu * quotePT[1], mod.gol.rho, 8),
        M.matriceRisultati(am.lam * (1 - quotePT[0]), am.mu * (1 - quotePT[1]), mod.gol.rho, 8), s);
    }
    return s;
  });
  righe.push({ d: p.d, prev: perPeso, veri: veri, haPT: p.ptc != null && p.ptv != null });
});

var train = righe.filter(function (r) { return r.d < confine; });
var test  = righe.filter(function (r) { return r.d >= confine; });
console.log('partite: ' + righe.length + '   scelgo su ' + train.length +
            ', verifico su ' + test.length + ' mai viste\n');

function serie(l, campo, k) {
  var out = [];
  l.forEach(function (r) {
    var p = r.prev[k][campo], v = r.veri[campo];
    if (p == null || v == null) return;
    out.push((p - (v > 0.5 ? 1 : 0)) * (p - (v > 0.5 ? 1 : 0)));
  });
  return out;
}

console.log('mercato               n     peso migliore   sul train   sul test   contro peso=1');
console.log('─────────────────────────────────────────────────────────────────────────────────');
var diversi = 0, provati = 0;
MERCATI.forEach(function (mk) {
  var l = mk.pt ? train.filter(function (r) { return r.haPT; }) : train;
  var lt = mk.pt ? test.filter(function (r) { return r.haPT; }) : test;
  if (l.length < 100 || lt.length < 100) return;
  var best = 0, bm = Infinity;
  PESI.forEach(function (w, k) {
    var m = media(serie(l, mk.campo, k));
    if (m < bm) { bm = m; best = k; }
  });
  var uno = PESI.length - 1;                       /* peso = 1, il modello zitto */
  var sTest = serie(lt, mk.campo, best), sUno = serie(lt, mk.campo, uno);
  var gua = 100 * (media(sUno) - media(sTest)) / media(sUno);
  /* Quando il peso migliore E' 1 le due serie sono la stessa serie: non c'e'
     nessuna differenza da testare, e uno z su differenze tutte nulle e' 0/0. */
  var zz = (best === uno || sTest.length !== sUno.length) ? 0 : z(sUno, sTest);
  provati++;
  /* "Diverso" non e' aver scelto un peso diverso sul train: e' che quella
     scelta REGGA sul test. Senza questa riga bastava un pareggio fortunato in
     una fascia per far dire allo strumento il contrario di quello che i dati
     dicono — ed e' esattamente cosi' che aveva risposto la prima volta. */
  if (PESI[best] < 1 && zz > 1.9) diversi++;
  console.log('  ' + (mk.nome + (mk.anc ? ' *' : '')).padEnd(22) +
              String(l.length).padStart(4) + '      ' +
              String(PESI[best]).padEnd(12) +
              bm.toFixed(5) + '     ' + media(sTest).toFixed(5) + '    ' +
              (best === uno ? '  (e\' 1)      '
                            : (gua >= 0 ? '+' : '') + gua.toFixed(2) + '%  z=' + zz.toFixed(2)));
});
console.log('\n  * = mercato che il banco quota, e a cui l\'ancoraggio punta dritto\n');
console.log('  mercati in cui conviene NON zittire il modello: ' + diversi + ' su ' + provati);
console.log('');
if (diversi === 0) {
  console.log('Su tutti i mercati conviene stare zitti e lasciar parlare il mercato: il');
  console.log('modello serve solo a PROPAGARE i due numeri che il banco quota (supremazia');
  console.log('e gol totali) a tutti gli altri, tenendo insieme le correlazioni. Non e\'');
  console.log('poco — e\' esattamente quello che il banco non ti da\' — ma non e\' avere');
  console.log('un\'opinione.');
} else {
  console.log('Il peso NON e\' lo stesso ovunque. Sui mercati che il banco quota conviene');
  console.log('stare zitti; su alcuni di quelli che non quota, l\'opinione del modello');
  console.log('vale ancora qualcosa — ed e\' li\' che vive il valore di quest\'app.');
  console.log('Tarare un ancoraggio solo sull\'1X2, come si fa di solito, butta via');
  console.log('proprio quel pezzo.');
}
