/*
  Il modello ritrova i parametri veri?

  Su un campionato finto la risposta giusta esiste — l'ha scritta
  genera_dati_sintetici.py — quindi si può controllare, invece di guardare i
  numeri e dire che sembrano ragionevoli.

      python3 tools/genera_dati_sintetici.py /tmp/finto
      node tools/test_modello.js /tmp/finto
*/
'use strict';
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var CARTELLA = process.argv[2] || '/tmp/finto';
var esiti = [];
function prova(nome, ok, dettaglio) { esiti.push([nome, !!ok, dettaglio == null ? '' : String(dettaglio)]); }
function correlazione(a, b) {
  var n = a.length, ma = 0, mb = 0, i;
  for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  var sa = 0, sb = 0, sab = 0;
  for (i = 0; i < n; i++) { sa += (a[i]-ma)*(a[i]-ma); sb += (b[i]-mb)*(b[i]-mb); sab += (a[i]-ma)*(b[i]-mb); }
  return sab / Math.sqrt(sa * sb);
}

if (!fs.existsSync(path.join(CARTELLA, 'serie-a.json'))) {
  console.error('Prima serve il campionato finto:\n  python3 tools/genera_dati_sintetici.py ' + CARTELLA);
  process.exit(2);
}
var doc = JSON.parse(fs.readFileSync(path.join(CARTELLA, 'serie-a.json'), 'utf8'));
var vero = JSON.parse(fs.readFileSync(path.join(CARTELLA, 'verita.json'), 'utf8'));

/* ── il modello ritrova le forze vere? ──────────────────────────────────── */
var dati = M.prepara(doc.partite);
prova('gli xG veri vengono preferiti al conto sui tiri',
      dati.xgVeri === doc.partite.length && dati.xgDaTiri === 0,
      'veri=' + dati.xgVeri + ' proxy=' + dati.xgDaTiri);

var mod = M.costruisci(doc.partite, { dati: dati, iterazioni: 600, pesoTiri: 0.3 });
prova('la stima converge', mod.ok);

var attV = [], attS = [], difV = [], difS = [];
mod.squadre.forEach(function (s, i) {
  if (!vero.forza[s]) return;
  attV.push(vero.forza[s].att); attS.push(mod.gol.att[i]);
  difV.push(vero.forza[s].dif); difS.push(mod.gol.dif[i]);
});
var cAtt = correlazione(attV, attS), cDif = correlazione(difV, difS);
prova('ritrova gli attacchi veri (corr > 0.85)', cAtt > 0.85, 'corr=' + cAtt.toFixed(3));
prova('ritrova le difese vere (corr > 0.80)', cDif > 0.80, 'corr=' + cDif.toFixed(3));

var dGamma = Math.abs(mod.gol.gamma - vero.parametri.gamma);
prova('ritrova il vantaggio del campo (± 0.08)', dGamma < 0.08,
      'stimato ' + mod.gol.gamma.toFixed(3) + ' vero ' + vero.parametri.gamma.toFixed(3));
prova('ritrova il segno della correzione sui punteggi bassi',
      mod.gol.rho * vero.parametri.rho > 0 || Math.abs(vero.parametri.rho) < 0.02,
      'stimato ' + mod.gol.rho.toFixed(4) + ' vero ' + vero.parametri.rho.toFixed(4));

var golVeri = doc.partite.reduce(function (t, p) { return t + p.gc + p.gv; }, 0) / doc.partite.length;
var somma = 0, n = 0;
mod.squadre.forEach(function (a) { mod.squadre.forEach(function (b) {
  if (a === b) return;
  var pr = M.prevedi(mod, a, b, {});
  if (pr) { somma += pr.totale; n++; }
}); });
prova('il livello dei gol torna (± 6%)', Math.abs(somma / n / golVeri - 1) < 0.06,
      'previsti ' + (somma/n).toFixed(3) + ' reali ' + golVeri.toFixed(3));

/* ── il primo tempo ─────────────────────────────────────────────────────── */
prova('stima anche il modello del primo tempo', !!mod.primoTempo);
if (mod.primoTempo) {
  var i0 = mod.indice[mod.squadre[0]], j0 = mod.indice[mod.squadre[1]];
  var q = M.quotePrimoTempo(mod, i0, j0, {});
  var quotaVera = vero.parametri.quota_primo_tempo;
  prova('la quota di gol nel primo tempo è quella vera (± 0.08)',
        Math.abs((q[0] + q[1]) / 2 - quotaVera) < 0.08,
        'stimata ' + ((q[0]+q[1])/2).toFixed(3) + ' vera ' + quotaVera.toFixed(3));
  var pf = M.primoFinale(1.6, 1.2, mod.gol.rho, q);
  var tot = 0; pf.forEach(function (r) { r.forEach(function (x) { tot += x; }); });
  prova('primo tempo / finale somma a 1', Math.abs(tot - 1) < 1e-6, tot.toFixed(9));
  var pr = M.prevedi(mod, mod.squadre[0], mod.squadre[1], {});
  var casaDaHtFt = pr.primoFinale[0][0] + pr.primoFinale[1][0] + pr.primoFinale[2][0];
  prova('i due tempi rimessi insieme danno il risultato finale',
        Math.abs(casaDaHtFt - pr.casa) < 0.01,
        'da HT/FT ' + casaDaHtFt.toFixed(4) + ' dal modello ' + pr.casa.toFixed(4));
}

/* ── i mercati non possono contraddirsi ─────────────────────────────────── */
var m = M.matriceRisultati(1.7, 1.15, -0.05, 11);
var s = M.mercatiDaMatrice(m);
var voci = M.elencoMercati(s, ['Casa', 'Ospite']);
function P(id) { var v = voci.filter(function (x) { return x.id === id; })[0]; return v ? v.p : NaN; }
prova('1 + X + 2 fa 1', Math.abs(P('1') + P('X') + P('2') - 1) < 1e-9);
prova('gli Under sono il complemento degli Over', Math.abs(P('O25') + P('U25') - 1) < 1e-9);
prova('una combo non supera nessuno dei suoi pezzi', P('1O25') <= P('1') + 1e-12 && P('1O25') <= P('O25') + 1e-12);
prova('le due metà di una combo ricompongono il tutto', Math.abs(P('1O25') + P('1U25') - P('1')) < 1e-9);
prova('i gol esatti sommano a 1', Math.abs(P('G0')+P('G1')+P('G2')+P('G3')+P('G4P') - 1) < 1e-9);
prova('vincere senza subire implica vincere', P('CSECCA') <= P('1') + 1e-12);
prova('vincere di due implica vincere', P('H1C') <= P('1') + 1e-12);
prova('la doppia chance è la somma dei due esiti', Math.abs(P('1X') - (P('1') + P('X'))) < 1e-9);
prova('ogni mercato è una probabilità', voci.every(function (v) { return v.p >= -1e-12 && v.p <= 1 + 1e-12; }));
prova('ogni mercato dichiara da dove viene', voci.every(function (v) { return s[v.campo] != null; }));

/* ── la scorciatoia dell'ancoraggio è esatta ────────────────────────────── */
var peggio = 0;
for (var t = 0; t < 2000; t++) {
  var lam = 0.1 + Math.random() * 4, mu2 = 0.1 + Math.random() * 4, rho = (Math.random() - 0.5) * 0.4;
  var e = M.esiti(M.matriceRisultati(lam, mu2, rho, 11)), sc = M._sintesi(lam, mu2, rho);
  peggio = Math.max(peggio, Math.abs(sc.squilibrio - (e.casa - e.via)), Math.abs(sc.over - e.over25));
}
prova('la scorciatoia dà gli stessi numeri della matrice intera', peggio < 1e-12, peggio.toExponential(2));

/* ── l'ancoraggio raggiunge davvero il mercato ──────────────────────────── */
var quote = [1.55, 4.20, 6.00], quoteOU = [1.80, 2.00];
var anc = M.ancoraMercato(1.8, 0.9, -0.05, { q: quote, qou: quoteOU, peso1x2: 1, pesoOU: 1 });
var ris = M.esiti(M.matriceRisultati(anc.lam, anc.mu, -0.05, 11));
var pq = M.daQuote(quote), pou = M.daQuoteOU(quoteOU);
prova('con peso 1 riproduce l\'1X2 del mercato (± 0.5 punti)',
      Math.abs(ris.casa - pq[0]) < 0.005 && Math.abs(ris.via - pq[2]) < 0.005,
      ris.casa.toFixed(4) + ' vs ' + pq[0].toFixed(4));
prova('con peso 1 riproduce anche l\'Over del mercato (± 0.5 punti)',
      Math.abs(ris.over25 - pou) < 0.005, ris.over25.toFixed(4) + ' vs ' + pou.toFixed(4));
var anc0 = M.ancoraMercato(1.8, 0.9, -0.05, { q: quote, qou: quoteOU, peso1x2: 0, pesoOU: 0 });
prova('con peso 0 non tocca niente', !anc0.usato && anc0.lam === 1.8 && anc0.mu === 0.9);
var ancM = M.ancoraMercato(1.8, 0.9, -0.05, { q: quote, qou: quoteOU, peso1x2: 0.5, pesoOU: 0.5 });
var risM = M.esiti(M.matriceRisultati(ancM.lam, ancM.mu, -0.05, 11));
var puro = M.esiti(M.matriceRisultati(1.8, 0.9, -0.05, 11));
prova('con peso intermedio finisce in mezzo',
      risM.casa > Math.min(puro.casa, pq[0]) - 1e-9 && risM.casa < Math.max(puro.casa, pq[0]) + 1e-9,
      puro.casa.toFixed(3) + ' < ' + risM.casa.toFixed(3) + ' < ' + pq[0].toFixed(3));
prova('senza quote non succede niente', !M.ancoraMercato(1.8, 0.9, -0.05, { peso1x2: 1 }).usato);

/* ── Kelly ──────────────────────────────────────────────────────────────── */
prova('Kelly su p=0.6 a quota 2 dà 0.20', Math.abs(M.kelly(0.6, 2) - 0.2) < 1e-12);
prova('Kelly non propone mai una puntata in perdita', M.kelly(0.3, 2) === 0 && M.kelly(0.5, 1.9) === 0);
var val = M.valore({ p: 0.62, p05: 0.55 }, 1.85, { cassa: 100 });
prova('la puntata parte dal pavimento della fascia, non dalla media',
      val.puntata < 100 * M.kelly(0.62, 1.85), val.puntata.toFixed(3));

/* ── arbitri e corner ───────────────────────────────────────────────────── */
var arb = M.statisticheArbitri(doc.partite, { k: 12 });
prova('trova gli arbitri', arb && arb.arbitri.length === Object.keys(vero.severita).length,
      arb ? arb.arbitri.length : 0);
if (arb) {
  var sevV = [], sevS = [];
  arb.arbitri.forEach(function (a) {
    if (vero.severita[a.nome] == null) return;
    sevV.push(vero.severita[a.nome]); sevS.push(a.severita);
  });
  prova('ritrova chi fischia stretto (corr > 0.85)', correlazione(sevV, sevS) > 0.85,
        'corr=' + correlazione(sevV, sevS).toFixed(3));
}
var co = M.statisticheCorner(doc.partite, { k: 10 });
prova('conta i corner', co && co.squadre.length === 20, co ? co.squadre.length : 0);
if (co) {
  var ca = M.cornerAttesi(co, mod.squadre[0], mod.squadre[1], M.vantaggioCornerCasa(doc.partite));
  prova('i corner attesi stanno intorno alla media della lega',
        Math.abs(ca.totali - co.mediaPartita) < 2.5,
        ca.totali.toFixed(2) + ' vs media ' + co.mediaPartita.toFixed(2));
  prova('le soglie dei corner sono decrescenti',
        ca.oltre75 > ca.oltre85 && ca.oltre85 > ca.oltre95 && ca.oltre95 > ca.oltre105);
}

var largh = esiti.reduce(function (a, e) { return Math.max(a, e[0].length); }, 0);
var falliti = 0;
esiti.forEach(function (e) {
  console.log((e[1] ? 'ok    ' : 'FALLITO ') + e[0].padEnd(largh) + (e[1] ? '' : '   → ' + e[2]));
  if (!e[1]) falliti++;
});
console.log('\n' + esiti.length + ' prove, ' + falliti + ' fallite');
process.exit(falliti ? 1 : 0);
