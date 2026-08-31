/*
  Il backtest dice la verità?

  Qui non si controlla che il modello sia bravo — si controlla che il metro con
  cui lo si misura non sia truccato. Le tre domande sono: batte chi tira a
  indovinare, è calibrato (quando dice 30% succede il 30%), e l'ancoraggio al
  mercato migliora davvero le cose invece di limitarsi a sembrare più preciso.

      node tools/test_backtest.js               # sui dati veri in data/
      node tools/test_backtest.js /tmp/finto    # sul campionato finto
*/
'use strict';
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var CARTELLA = process.argv[2] || path.join(__dirname, '..', 'data');
var esiti = [];
function prova(nome, ok, dettaglio) { esiti.push([nome, !!ok, dettaglio == null ? '' : String(dettaglio)]); }

var file = path.join(CARTELLA, 'serie-a.json');
if (!fs.existsSync(file)) {
  console.error('Non trovo ' + file);
  process.exit(2);
}
var doc = JSON.parse(fs.readFileSync(file, 'utf8'));
var dati = M.prepara(doc.partite);
var stagioni = (doc.stagioni || []).slice().sort();
var da = stagioni.length >= 3
  ? (parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10) + '-08-01') : null;

var t0 = Date.now();
var res = M.campionaBacktest(dati, { da: da, refitOgniGiorni: 3, iterazioni: 110 });
var back = M.valutaBacktest(res, {});
var secondi = (Date.now() - t0) / 1000;

console.log('partite provate: ' + back.partite + ' dal ' + back.da + ' al ' + back.a +
            '  (' + secondi.toFixed(1) + 's)');
console.log('peso ai tiri ' + back.pesoMigliore + ' · stiro ' + back.stiroMigliore +
            ' · ancoraggio ' + back.ancoraMigliore + '\n');

prova('il backtest gira in un tempo accettabile su un telefono (< 25s qui)', secondi < 25,
      secondi.toFixed(1) + 's');
prova('prova su abbastanza partite', back.partite > 300, back.partite);

/* ── niente sbirciate nel futuro ────────────────────────────────────────── */
var fuoriOrdine = 0;
for (var i = 1; i < res.campioni.length; i++) {
  if (res.campioni[i].d < res.campioni[i - 1].d) fuoriOrdine++;
}
prova('le partite sono provate in ordine di data', fuoriOrdine === 0, fuoriOrdine);

/* ── batte il caso ──────────────────────────────────────────────────────── */
var mio = back.modello.rps, caso = back.baselineTutte.rps;
prova('batte chi indovina con le frequenze storiche', mio < caso,
      'modello ' + mio.toFixed(5) + ' vs caso ' + caso.toFixed(5));
prova('il guadagno sul caso è sostanziale (> 5%)', (1 - mio / caso) > 0.05,
      ((1 - mio / caso) * 100).toFixed(1) + '%');

/* ── calibrazione ───────────────────────────────────────────────────────── */
var bins = back.modello.calibrazione.filter(function (b) { return b.n >= 40; });
var scarto = 0, peso = 0;
bins.forEach(function (b) { scarto += b.n * Math.abs(b.osservato - b.previsto); peso += b.n; });
var errCal = peso ? scarto / peso : 1;
prova('è calibrato (scarto medio < 4 punti percentuali)', errCal < 0.04,
      (errCal * 100).toFixed(2) + ' punti');
prova('nessuna fascia è fuori di più di 12 punti',
      bins.every(function (b) { return Math.abs(b.osservato - b.previsto) < 0.12; }),
      bins.map(function (b) { return (Math.abs(b.osservato-b.previsto)*100).toFixed(0); }).join(' '));

/* ── ogni pezzo aggiunto deve guadagnarsi il posto ──────────────────────── */
var senzaStiro = back.perStiro.filter(function (x) { return x.stiro === 1; })[0];
var conStiro = back.perStiro.filter(function (x) { return x.stiro === back.stiroMigliore; })[0];
prova('allargare lo squilibrio non peggiora', conStiro.rps <= senzaStiro.rps + 1e-9,
      senzaStiro.rps.toFixed(5) + ' → ' + conStiro.rps.toFixed(5));

if (back.perAncora && back.perAncora.length) {
  var senza = back.perAncora.filter(function (x) { return x.ancoraggio === 0; })[0];
  var con = back.perAncora.filter(function (x) { return x.ancoraggio === back.ancoraMigliore; })[0];
  prova('ancorarsi al mercato migliora davvero', con.rps < senza.rps,
        senza.rps.toFixed(5) + ' → ' + con.rps.toFixed(5));
  prova('il guadagno dell\'ancoraggio è visibile (> 1%)', (1 - con.rps / senza.rps) > 0.01,
        ((1 - con.rps / senza.rps) * 100).toFixed(2) + '%');
}

if (back.confronto) {
  var c = back.confronto;
  console.log('confronto su ' + c.n + ' partite con quote:');
  ['modello', 'ancorato', 'mercato', 'baseline'].forEach(function (k) {
    if (c[k]) console.log('  ' + k.padEnd(9) + ' RPS ' + c[k].rps.toFixed(5) +
                          '  logloss ' + c[k].logloss.toFixed(5) +
                          '  azzeccate ' + (c[k].accuratezza * 100).toFixed(1) + '%');
  });
  console.log('');
  prova('il modello da solo NON batte il mercato (se lo battesse, sarebbe un errore di conto)',
        c.modello.rps > c.mercato.rps,
        'modello ' + c.modello.rps.toFixed(5) + ' mercato ' + c.mercato.rps.toFixed(5));
  prova('il modello ancorato arriva vicino al mercato (entro l\'1%)',
        c.ancorato.rps < c.mercato.rps * 1.01,
        'ancorato ' + c.ancorato.rps.toFixed(5) + ' mercato ' + c.mercato.rps.toFixed(5));
  prova('l\'ancoraggio migliora il modello puro',
        c.ancorato.rps < c.modello.rps,
        c.modello.rps.toFixed(5) + ' → ' + c.ancorato.rps.toFixed(5));
  prova('tutti confrontati sulle stesse partite',
        c.modello.n === c.mercato.n && c.mercato.n === c.baseline.n && c.modello.n === c.ancorato.n);
}

/* ── le probabilità restano probabilità ─────────────────────────────────── */
var storte = 0;
res.campioni.slice(0, 400).forEach(function (cam) {
  var pr = M.probabilitaDaCampione(cam, back.pesoMigliore,
    { stiro: back.stiroMigliore, ancoraggio: back.ancoraMigliore });
  var s = pr.p[0] + pr.p[1] + pr.p[2];
  if (Math.abs(s - 1) > 1e-6 || pr.p.some(function (x) { return x < 0 || x > 1; })) storte++;
});
prova('ogni previsione è una distribuzione valida', storte === 0, storte);

var largh = esiti.reduce(function (a, e) { return Math.max(a, e[0].length); }, 0);
var falliti = 0;
esiti.forEach(function (e) {
  console.log((e[1] ? 'ok    ' : 'FALLITO ') + e[0].padEnd(largh) + (e[1] ? '' : '   → ' + e[2]));
  if (!e[1]) falliti++;
});
console.log('\n' + esiti.length + ' prove, ' + falliti + ' fallite');
process.exit(falliti ? 1 : 0);
