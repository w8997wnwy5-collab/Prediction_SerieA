/* Le 10 della giornata: quante volte escono davvero? E a quota 10, cosa esce
   piu' spesso?

   Il 10-12 ottobre 2026 la piu' solida di ogni partita di Serie A e' entrata
   dieci volte su dieci, e la domanda giusta dopo una giornata cosi' e': e'
   la regola, o e' stata una giornata? Una giornata sola non lo dice. Qui si
   rigiocano tutte quelle dell'archivio, ognuna col modello stimato SOLO
   sulle partite di prima e ancorato alle quote di allora — esattamente come
   l'app l'avrebbe vista il venerdi'.

   Due domande, con la regola che l'app usa adesso (la piu' solida per
   pavimento sotto l'82%, pari e dispari esclusi):

     1. quante ne prende, giornata per giornata: 10 su 10, 9, 8... — e se le
        percentuali promesse sono quelle vere (calibrazione)
     2. a una quota di banco intorno a 10, esce piu' spesso la multipla delle
        dieci o la combinazione PIU' PROBABILE di poche gambe a quella quota?
        La matematica dice la seconda — il ricarico si paga una volta per
        gamba — e qui si guarda se i fatti sono d'accordo.

   La quota "di banco" e' quella equa meno il 5.6% a gamba (bet365 misurato,
   il default dell'app): la stessa che l'app mostra.

   IL RISULTATO, 14 ottobre 2026: 133 giornate, 1327 gambe
     ogni gamba: promessa 76.0%, presa 76.0% — calibrato al decimale
     dieci su dieci: 12 giornate (9.0%), attese 8.6 (6.5%)
     il caso piu' comune: sbagliarne due (27%)
     quota di banco delle dieci insieme: mediana 8.7
     alla stessa quota: le dieci promettono 6.5% ed escono 12 volte;
     la piu' probabile corta (2 gambe in media) promette 11.0% ed esce 15

   DI NUOVO, 27 ottobre 2026, con la forma stretta dei gol nel modello
   (DISPERSIONE 1.10, tools/misura_dispersione.js): stesse 133 giornate
     ogni gamba: promessa 76.3%, presa 75.3% — dentro il rumore (+-1.2)
     dieci su dieci: 8 giornate (6.0%), attese 9.0 (6.7%)
     alla stessa quota: le dieci promettono 6.7% ed escono 8 volte;
     la piu' probabile corta promette 11.5% ed esce 15
   Le dieci giuste sono passate da 12 a 8 senza che l'attesa cambiasse
   (8.6 prima, 9.0 adesso): 12 era stata fortuna, 8 e' un po' di sfortuna,
   tutte e due a meno di un sigma e mezzo dall'atteso. La conclusione
   sulla quota 10 resta la stessa, e piu' netta.

   uso: node tools/misura_dieci.js
*/
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
  .sort(function (a, b) { return a.d < b.d ? -1 : 1; });
var VISTI = ['1', 'X', '2', 'O05', 'O15', 'U15', 'O25', 'U25', 'O35', 'U35', 'O45', 'U45'];
var SOGLIA = 0.82, RICARICO = 0.056;
var quotaBanco = function (p) { return (1 / p) * (1 - RICARICO); };

console.log('rigioco le giornate…');
var per = {};
tutte.forEach(function (p) {
  if (!p.giornata) return;
  (per[p.s + '|' + p.giornata] = per[p.s + '|' + p.giornata] || []).push(p);
});
var chiavi = Object.keys(per).filter(function (k) { return per[k].length >= 9; })
  .sort(function (a, b) { return per[a][0].d < per[b][0].d ? -1 : 1; });

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
  var partite = [];
  l.forEach(function (p, ip) {
    if (mod.indice[p.c] == null || mod.indice[p.v] == null) return;
    var sim = M.simula(mod, p.c, p.v, { N: 1200, q: p.q || null, qou: p.qou || null });
    if (!sim) return;
    var medie = {};
    for (var kk in sim.fasce) medie[kk] = sim.fasce[kk].p;
    var ok = [];
    M.elencoMercati(medie, [p.c, p.v]).forEach(function (m) {
      if (VISTI.indexOf(m.id) < 0) return;
      if (!(m.p >= 0.12 && m.p <= 0.88)) return;
      var b = sim.fasce[m.campo];
      var p05 = b ? (m.inverso ? 1 - b.p95 : b.p05) : m.p;
      var e = M.haVinto(m.id, p.gc, p.gv, p.ptc, p.ptv);
      if (e === null) return;
      ok.push({ partita: ip, id: m.id, p: m.p, p05: Math.max(0, Math.min(m.p, p05)), vinto: e ? 1 : 0 });
    });
    if (ok.length) partite.push(ok);
  });
  if (partite.length >= 9) giornate.push({ d: d0, partite: partite });
});
console.log(giornate.length + ' giornate rigiocate\n');

/* la regola dell'app: per ogni partita la piu' solida (pavimento) sotto la soglia */
function dieci(g) {
  return g.partite.map(function (ok) {
    var pag = ok.filter(function (m) { return m.p <= SOGLIA; });
    var lista = (pag.length ? pag : ok).slice().sort(function (a, b) { return b.p05 - a.p05; });
    return lista[0];
  }).filter(Boolean);
}

/* la combinazione piu' probabile con quota di banco in [lo, hi], gambe da 2 a 6,
   una per partita: ricerca esatta per numero di gambe e casella di quota */
function piuProbabileAQuota(g, lo, hi) {
  var PASSO = 0.01, MAXB = Math.ceil(Math.log(hi * 1.02) / PASSO);
  var tab = [];
  for (var n = 0; n <= 6; n++) tab.push({});
  tab[0][0] = { v: 0, sc: [] };
  g.partite.forEach(function (ok) {
    var prima = tab.map(function (t) { var x = {}; for (var b in t) x[b] = t[b]; return x; });
    ok.forEach(function (m) {
      var passi = Math.max(1, Math.round(Math.log(quotaBanco(m.p)) / PASSO));
      for (var n = 0; n < 6; n++) {
        for (var b in prima[n]) {
          var nb = +b + passi;
          if (nb > MAXB) continue;
          var v = prima[n][b].v + Math.log(m.p);
          if (!tab[n + 1][nb] || v > tab[n + 1][nb].v) tab[n + 1][nb] = { v: v, sc: prima[n][b].sc.concat([m]) };
        }
      }
    });
  });
  var meglio = null;
  for (var n2 = 2; n2 <= 6; n2++) {
    for (var b2 in tab[n2]) {
      var sc = tab[n2][b2].sc, q = 1, pr = 1;
      sc.forEach(function (m) { q *= quotaBanco(m.p); pr *= m.p; });
      if (q < lo || q > hi) continue;
      if (!meglio || pr > meglio.p) meglio = { sc: sc, p: pr, q: q };
    }
  }
  return meglio;
}

/* ── 1. quante ne prende ── */
var conteggi = {}, attesi = {}, nG = 0, presi = 0, promessi = 0, gambe = 0, quote = [];
giornate.forEach(function (g) {
  var sel = dieci(g);
  if (sel.length < 9) return;
  nG++;
  var k = sel.reduce(function (s, m) { return s + m.vinto; }, 0);
  var mancati = sel.length - k;
  conteggi[mancati] = (conteggi[mancati] || 0) + 1;
  var d = M.distribuzioneEsiti(sel.map(function (m) { return m.p; }));
  for (var j = 0; j < d.length; j++) {
    var mj = sel.length - j;
    attesi[mj] = (attesi[mj] || 0) + d[j];
  }
  sel.forEach(function (m) { gambe++; presi += m.vinto; promessi += m.p; });
  quote.push(sel.reduce(function (t, m) { return t * quotaBanco(m.p); }, 1));
});
quote.sort(function (a, b) { return a - b; });
console.log('=== 1. LA PIU\' SOLIDA DI OGNI PARTITA, GIORNATA PER GIORNATA ===');
console.log('giornate: ' + nG + ', gambe: ' + gambe);
console.log('ogni gamba: promessa ' + (100 * promessi / gambe).toFixed(1) + '%, presa davvero ' +
            (100 * presi / gambe).toFixed(1) + '%');
console.log('quota di banco delle dieci insieme: mediana ' + quote[Math.floor(quote.length / 2)].toFixed(1) +
            ' (dal ' + quote[Math.floor(quote.length * 0.1)].toFixed(1) + ' al ' +
            quote[Math.floor(quote.length * 0.9)].toFixed(1) + ' nel 10-90%)');
console.log('  sbagliate   giornate osservate   attese dal modello');
for (var e = 0; e <= 4; e++) {
  var oss = conteggi[e] || 0, att = attesi[e] || 0;
  console.log('  ' + String(e).padStart(5) + '      ' + String(oss).padStart(4) + ' (' + (100 * oss / nG).toFixed(1).padStart(4) +
              '%)        ' + att.toFixed(1).padStart(5) + ' (' + (100 * att / nG).toFixed(1).padStart(4) + '%)');
}
var resto = 0, restoA = 0;
Object.keys(conteggi).forEach(function (x) { if (+x > 4) resto += conteggi[x]; });
Object.keys(attesi).forEach(function (x) { if (+x > 4) restoA += attesi[x]; });
console.log('  5 o piu\'    ' + String(resto).padStart(4) + ' (' + (100 * resto / nG).toFixed(1).padStart(4) + '%)        ' +
            restoA.toFixed(1).padStart(5) + ' (' + (100 * restoA / nG).toFixed(1).padStart(4) + '%)');

/* ── 2. a quota 10 ── */
var A = { n: 0, presi: 0, pr: 0 }, B = { n: 0, presi: 0, pr: 0, gambe: 0 };
giornate.forEach(function (g) {
  var sel = dieci(g);
  if (sel.length < 9) return;
  var q10 = sel.reduce(function (t, m) { return t * quotaBanco(m.p); }, 1);
  /* si confronta alla stessa quota: la combinazione corta si cerca nella
     fascia della quota che le dieci hanno avuto quella giornata */
  var lo = q10 * 0.92, hi = q10 * 1.08;
  var corta = piuProbabileAQuota(g, lo, hi);
  if (!corta) return;
  A.n++; B.n++;
  A.pr += sel.reduce(function (t, m) { return t * m.p; }, 1);
  A.presi += sel.every(function (m) { return m.vinto; }) ? 1 : 0;
  B.pr += corta.p;
  B.presi += corta.sc.every(function (m) { return m.vinto; }) ? 1 : 0;
  B.gambe += corta.sc.length;
});
console.log('\n=== 2. ALLA STESSA QUOTA DI BANCO: LE DIECI O POCHE GAMBE? ===');
console.log('giornate confrontate: ' + A.n + ' (stessa quota, +-8%)');
console.log('  le dieci insieme          promesse ' + (100 * A.pr / A.n).toFixed(1) + '%   uscite ' + A.presi +
            ' volte (' + (100 * A.presi / A.n).toFixed(1) + '%)');
console.log('  la piu\' probabile corta   promesse ' + (100 * B.pr / B.n).toFixed(1) + '%   uscite ' + B.presi +
            ' volte (' + (100 * B.presi / B.n).toFixed(1) + '%)   gambe in media ' + (B.gambe / B.n).toFixed(1));
