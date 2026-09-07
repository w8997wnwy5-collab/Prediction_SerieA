/* L'arbitro sposta i gol?

   L'idea è buona e vale la pena averla scritta: un arbitro che fischia tanto
   spezzetta la partita, il gioco effettivo cala, e con meno gioco si fanno meno
   gol. Se fosse vera, sapere chi dirige varrebbe punti di previsione — e le
   designazioni escono due o tre giorni prima, cioè in tempo per giocarci.

   Questo file la mette alla prova in tre modi, dal più indulgente al più
   severo. Serve tenerli tutti e tre, perché i primi due possono dire "forse" e
   solo il terzo dice se conviene.

     1. Il residuo per arbitro. Si allena il modello senza sapere niente di
        arbitri, si guardano i gol in più o in meno rispetto agli attesi, e si
        raggruppa per direttore di gara. Se l'arbitro conta, la dispersione dei
        punteggi z deve essere più larga di 1.

     2. La correlazione. Quanto un arbitro è severo di suo, contro quanti gol
        si fanno quando dirige lui. Con l'intervallo di confidenza, perché su
        venticinque arbitri un r di 0.1 non vuol dire niente.

     3. La prova che decide. Si dà al modello un aggiustamento imparato
        sull'arbitro — stimato solo sul passato di ogni partita, mai sul
        futuro — e si guarda se l'errore di previsione scende o sale.

   Un effetto può essere reale e vero e comunque non valere la pena: se è più
   piccolo dell'incertezza con cui lo si stima, metterlo dentro un modello
   aggiunge rumore, non informazione. È esattamente cosa succede qui.

   uso: node tools/misura_arbitri.js
*/
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
  .sort(function (a, b) { return a.d < b.d ? -1 : 1; });
var conArb = tutte.filter(function (p) { return p.arb; });
if (conArb.length < 200) {
  console.log('Servono almeno 200 partite con l\'arbitro, ce ne sono ' + conArb.length + '.');
  process.exit(0);
}
console.log('partite con arbitro: ' + conArb.length +
  '  (di ' + tutte.length + ' in archivio)\n');

function media(l) { return l.reduce(function (a, b) { return a + b; }, 0) / l.length; }
function corr(xs, ys) {
  var n = xs.length, mx = media(xs), my = media(ys), sx = 0, sy = 0, sxy = 0;
  for (var i = 0; i < n; i++) {
    var a = xs[i] - mx, b = ys[i] - my;
    sx += a * a; sy += b * b; sxy += a * b;
  }
  var r = sxy / Math.sqrt(sx * sy);
  var z = 0.5 * Math.log((1 + r) / (1 - r)), e = 1.96 / Math.sqrt(n - 3);
  return { r: r, lo: Math.tanh(z - e), hi: Math.tanh(z + e) };
}
function riga(t, c) {
  var zero = c.lo < 0 && c.hi > 0;
  console.log('  ' + t.padEnd(46) + ' r = ' + (c.r >= 0 ? '+' : '') + c.r.toFixed(3) +
    '  (' + (c.lo >= 0 ? '+' : '') + c.lo.toFixed(3) + ' … ' + (c.hi >= 0 ? '+' : '') + c.hi.toFixed(3) + ')  ' +
    (zero ? 'comprende lo zero: niente' : 'effetto reale'));
}

/* ── 1. residuo per arbitro, walk-forward ── */
var mod = null, ultimo = null, oss = [];
conArb.forEach(function (p) {
  if (!ultimo || M.giorni(ultimo, p.d) > 14) {
    var prima = tutte.filter(function (x) { return x.d < p.d; });
    if (prima.length < 300) return;
    mod = M.costruisci(prima, { fino: p.d, primoTempo: false, iterazioni: 110 });
    ultimo = p.d;
  }
  if (!mod) return;
  var i = mod.indice[p.c], j = mod.indice[p.v];
  if (i == null || j == null) return;
  var a = M.attesi(mod.gol, i, j);
  if (!a) return;
  oss.push({
    arb: p.arb, res: (p.gc + p.gv) - (a[0] + a[1]),
    gialli: (p.gic || 0) + (p.giv || 0), falli: (p.fc || 0) + (p.fv || 0)
  });
});

var per = {};
oss.forEach(function (x) { (per[x.arb] = per[x.arb] || []).push(x); });
var arbitri = Object.keys(per).filter(function (a) { return per[a].length >= 25; }).map(function (a) {
  var l = per[a], m = media(l.map(function (x) { return x.res; }));
  var v = l.reduce(function (s, x) { return s + (x.res - m) * (x.res - m); }, 0) / (l.length - 1);
  var es = Math.sqrt(v / l.length);
  return { a: a, n: l.length, res: m, z: m / es, g: media(l.map(function (x) { return x.gialli; })),
           f: media(l.map(function (x) { return x.falli; })) };
}).sort(function (x, y) { return y.res - x.res; });

console.log('1. GOL IN PIÙ O IN MENO, PER ARBITRO  (' + oss.length + ' partite, ' +
  arbitri.length + ' arbitri con almeno 25)');
console.log('   ' + 'arbitro'.padEnd(17) + '  n   residuo      z   gialli');
arbitri.forEach(function (r) {
  console.log('   ' + r.a.padEnd(17) + String(r.n).padStart(3) + '   ' +
    (r.res >= 0 ? '+' : '') + r.res.toFixed(3) + '  ' +
    (r.z >= 0 ? '+' : '') + r.z.toFixed(2) + '   ' + r.g.toFixed(2));
});
var zs = arbitri.map(function (r) { return r.z; });
var mz = media(zs);
var sdz = Math.sqrt(zs.reduce(function (s, z) { return s + (z - mz) * (z - mz); }, 0) / (zs.length - 1));
console.log('\n   dispersione dei punteggi z: ' + sdz.toFixed(2) +
  '   (se l\'arbitro non conta vale circa 1.00)');
console.log('   ' + (sdz > 1.25 ? 'più larga del caso: qualcosa c\'è'
  : 'indistinguibile dal caso: gli arbitri si comportano tutti uguale'));

/* ── 2. correlazioni ── */
console.log('\n2. SEVERITÀ CONTRO GOL');
riga('gialli di quella partita ↔ gol in più/meno',
  corr(oss.map(function (x) { return x.gialli; }), oss.map(function (x) { return x.res; })));
riga('falli di quella partita ↔ gol in più/meno',
  corr(oss.map(function (x) { return x.falli; }), oss.map(function (x) { return x.res; })));
riga('quanto è severo di suo ↔ gol in più/meno',
  corr(arbitri.map(function (r) { return r.g; }), arbitri.map(function (r) { return r.res; })));

/* ── 3. la prova che decide ── */
console.log('\n3. SE LO DO AL MODELLO, PREVEDE MEGLIO?');
var da = conArb[Math.floor(conArb.length * 0.4)].d;
console.log('   valutato dal ' + da + ' in poi, con l\'effetto stimato solo sul passato');
function rpsTre(pr, e) {
  var c = 0, s = 0;
  for (var i = 0; i < 2; i++) { c += pr[i]; var x = (e <= i) ? 1 : 0; s += (c - x) * (c - x); }
  return s / 2;
}
mod = null; ultimo = null;
var senza = [], con = [];
conArb.forEach(function (p) {
  if (p.d < da) return;
  if (!ultimo || M.giorni(ultimo, p.d) > 14) {
    var prima = tutte.filter(function (x) { return x.d < p.d; });
    if (prima.length < 400) return;
    mod = M.costruisci(prima, { fino: p.d, primoTempo: false, iterazioni: 110 });
    ultimo = p.d;
    var somma = {}, quante = {};
    prima.filter(function (x) { return x.arb; }).forEach(function (x) {
      var i = mod.indice[x.c], j = mod.indice[x.v];
      if (i == null || j == null) return;
      var a = M.attesi(mod.gol, i, j);
      if (!a) return;
      somma[x.arb] = (somma[x.arb] || 0) + Math.log((x.gc + x.gv + 0.5) / (a[0] + a[1] + 0.5));
      quante[x.arb] = (quante[x.arb] || 0) + 1;
    });
    mod._eff = {};
    /* tirato verso zero: con poche partite non ci si fida della media */
    Object.keys(somma).forEach(function (a) { mod._eff[a] = somma[a] / (quante[a] + 20); });
  }
  if (!mod) return;
  var i = mod.indice[p.c], j = mod.indice[p.v];
  if (i == null || j == null) return;
  var e = p.gc > p.gv ? 0 : (p.gc === p.gv ? 1 : 2);
  var k = mod._eff[p.arb] || 0;
  [[senza, 0], [con, 1]].forEach(function (par) {
    var s = M.simula(mod, p.c, p.v, { N: 900, agg: { attC: par[1] * k / 2, attV: par[1] * k / 2 } });
    if (s) par[0].push(rpsTre([s.fasce.casa.p, s.fasce.pari.p, s.fasce.via.p], e));
  });
});
var rSenza = media(senza), rCon = media(con);
console.log('   senza l\'arbitro   errore ' + rSenza.toFixed(5) + '   (' + senza.length + ' partite)');
console.log('   con  l\'arbitro    errore ' + rCon.toFixed(5));
var d = senza.map(function (x, i) { return x - con[i]; });
var md = media(d);
var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - md) * (x - md); }, 0) / (d.length - 1));
var z = md / (sd / Math.sqrt(d.length));
console.log('   differenza ' + (md >= 0 ? '+' : '') + md.toFixed(5) + '  →  z = ' + z.toFixed(2));
console.log('\n   ' + (Math.abs(z) < 2 ? 'Dentro il rumore: metterlo o non metterlo è uguale.'
  : (md > 0 ? 'L\'arbitro MIGLIORA il modello: va messo dentro.'
            : 'L\'arbitro PEGGIORA il modello. Un dato vero ma debole, dato in pasto\n   a un modello, non è informazione in più: è rumore in più.')));
