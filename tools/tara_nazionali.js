/* La memoria del modello, tarata sul ritmo delle NAZIONALI.
   ══════════════════════════════════════════════════════════════════════════
   Il modello dimentica i risultati vecchi con xi = 0.0028, cioe' mezza vita
   250 giorni. Quel numero e' stato misurato sulla Serie A, dove in 250 giorni
   una squadra gioca ventisei partite. Una nazionale, nello stesso tempo, ne
   gioca sette.

   Quindi il modello sulle nazionali sta stimando attacco e difesa con un
   QUARTO delle informazioni, e con la stessa fiducia. Ed e' il sospetto
   naturale dietro al difetto trovato: prevede 2.78 gol dove ne escono 3.13,
   e una correzione costante non lo raddrizza.

   C'e' pero' una tensione, ed e' il motivo per cui la risposta non si
   indovina: allungare la memoria da' piu' partite e stime piu' stabili, ma
   rende il modello piu' lento ad accorgersi che in questo ciclo si segna di
   piu'. Piu' dati contro dati piu' freschi. Non si decide a tavolino.

   Tre pezzi, come sempre: si allena sul primo, si SCEGLIE sul secondo, si
   VERIFICA sul terzo. Con quaranta combinazioni provate, la migliore vince
   anche quando sono tutte uguali — e se il guadagno non sopravvive al terzo
   pezzo, era rumore.

   uso: node tools/tara_nazionali.js
   ══════════════════════════════════════════════════════════════════════════ */
var fs = require('fs'), path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var CSV = process.argv[2] || '/tmp/naz.csv';
var DA = '2010-01-01';
var TARA = '2023-07-01';
var TAGLIO = '2025-01-01';

var UEFA = {};
('Albania|Andorra|Armenia|Austria|Azerbaijan|Belarus|Belgium|Bosnia and Herzegovina|Bulgaria|' +
 'Croatia|Cyprus|Czech Republic|Czechia|Denmark|England|Estonia|Faroe Islands|Finland|France|' +
 'Georgia|Germany|Gibraltar|Greece|Hungary|Iceland|Israel|Italy|Kazakhstan|Kosovo|Latvia|' +
 'Liechtenstein|Lithuania|Luxembourg|Malta|Moldova|Montenegro|Netherlands|North Macedonia|' +
 'Northern Ireland|Norway|Poland|Portugal|Republic of Ireland|Romania|Russia|San Marino|' +
 'Scotland|Serbia|Slovakia|Slovenia|Spain|Sweden|Switzerland|Turkey|Ukraine|Wales')
  .split('|').forEach(function (s) { UEFA[s] = 1; });

function carica() {
  var testo = fs.readFileSync(CSV, 'utf8').split('\n');
  var intest = testo[0].split(','), fuori = [];
  for (var i = 1; i < testo.length; i++) {
    if (!testo[i].trim()) continue;
    var c = testo[i].split(',');
    if (c.length < 9) continue;
    var r = {};
    for (var j = 0; j < intest.length && j < c.length; j++) r[intest[j].trim()] = c[j];
    if (!r.date || r.date < DA) continue;
    if (!UEFA[r.home_team] || !UEFA[r.away_team]) continue;
    var gc = parseInt(r.home_score, 10), gv = parseInt(r.away_score, 10);
    if (!(gc >= 0) || !(gv >= 0)) continue;
    fuori.push({d: r.date, c: r.home_team, v: r.away_team, gc: gc, gv: gv,
                amichevole: /friendly/i.test(r.tournament || ''), s: r.date.slice(0, 4)});
  }
  return fuori;
}

function misura(mod, prove) {
  var somma = 0, n = 0, attesi = 0, veri = 0;
  for (var i = 0; i < prove.length; i++) {
    var p = prove[i];
    var e = M.prevedi(mod, p.c, p.v, {});
    if (!e || e.casa == null) continue;
    somma += M.rps([e.casa, e.pari, e.via], M.esitoReale(p.gc, p.gv));
    attesi += e.totale; veri += p.gc + p.gv;
    n++;
  }
  if (!n) return null;
  return {rps: somma / n, n: n, gol: veri / attesi};
}

function main() {
  var tutte = carica();
  var alleno0 = tutte.filter(function (p) { return p.d < TARA; });
  var scelta = tutte.filter(function (p) { return p.d >= TARA && p.d < TAGLIO; });
  var verifica = tutte.filter(function (p) { return p.d >= TAGLIO; });
  console.log('partite UEFA dal ' + DA + ': ' + tutte.length +
              '  (alleno ' + alleno0.length + ', scelgo ' + scelta.length +
              ', verifico ' + verifica.length + ')');
  console.log('');

  var XI = [0.0005, 0.0010, 0.0018, 0.0028, 0.0045];
  var RIDGE = [0.15, 0.30, 0.60, 1.20];
  var AMICHE = [true, false];

  var righe = [];
  AMICHE.forEach(function (conAmiche) {
    var alleno = conAmiche ? alleno0 : alleno0.filter(function (p) { return !p.amichevole; });
    XI.forEach(function (xi) {
      RIDGE.forEach(function (ridge) {
        var mod = M.costruisci(alleno, {xi: xi, ridge: ridge, primoTempo: false});
        var m = misura(mod, scelta);
        if (!m) return;
        righe.push({xi: xi, ridge: ridge, amiche: conAmiche, rps: m.rps, gol: m.gol,
                    storto: Math.abs(m.gol - 1)});
      });
    });
  });

  /* La memoria in GIORNI non dice niente su una nazionale: quello che conta e'
     quante partite ci stanno dentro. */
  function mezzaVita(xi) { return Math.round(Math.log(2) / xi); }

  righe.sort(function (a, b) { return a.rps - b.rps; });
  console.log('=== SCELTA (sul pezzo di mezzo): le dieci migliori per RPS ===');
  console.log('  xi      mezza vita   ridge  amichevoli   RPS      gol veri/previsti');
  righe.slice(0, 10).forEach(function (r) {
    console.log('  ' + r.xi.toFixed(4) + '  ' + String(mezzaVita(r.xi) + 'gg').padEnd(11) +
      '  ' + String(r.ridge).padEnd(5) + '  ' + (r.amiche ? 'dentro' : 'FUORI ').padEnd(11) +
      '  ' + r.rps.toFixed(5) + '  ' + r.gol.toFixed(3));
  });
  console.log('');
  console.log('=== e le dieci meno storte sui GOL ===');
  righe.slice().sort(function (a, b) { return a.storto - b.storto; }).slice(0, 6).forEach(function (r) {
    console.log('  xi ' + r.xi.toFixed(4) + '  ridge ' + String(r.ridge).padEnd(5) +
      '  amichevoli ' + (r.amiche ? 'dentro' : 'FUORI ') +
      '  gol ' + r.gol.toFixed(3) + '  RPS ' + r.rps.toFixed(5));
  });
  console.log('');

  /* ── LA VERIFICA ── */
  var vince = righe[0];
  var predef = righe.filter(function (r) {
    return r.xi === 0.0028 && r.ridge === 0.30 && r.amiche;
  })[0];

  console.log('=== VERIFICA (sul pezzo che nessuno dei due ha visto) ===');
  [['come oggi (xi 0.0028, ridge 0.30, amichevoli dentro)', predef],
   ['la migliore della scelta', vince]].forEach(function (coppia) {
    var r = coppia[1];
    if (!r) { console.log('  ' + coppia[0] + ': non provata'); return; }
    var alleno = r.amiche ? alleno0 : alleno0.filter(function (p) { return !p.amichevole; });
    var mod = M.costruisci(alleno, {xi: r.xi, ridge: r.ridge, primoTempo: false});
    var m = misura(mod, verifica);
    console.log('  ' + coppia[0]);
    console.log('     xi ' + r.xi.toFixed(4) + ' (mezza vita ' + mezzaVita(r.xi) + 'gg), ridge ' +
                r.ridge + ', amichevoli ' + (r.amiche ? 'dentro' : 'fuori'));
    console.log('     RPS ' + m.rps.toFixed(5) + '   gol veri/previsti ' + m.gol.toFixed(3) +
                (Math.abs(m.gol - 1) < 0.05 ? '  ← i gol tornano' : '  ← i gol restano storti'));
  });
}

main();
