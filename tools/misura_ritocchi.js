/* Tre ritocchi che si vedono solo guardando da vicino: l'1X2, i rossi e il
   ricarico tolto bene.

   1. L'1X2. Il modello si ancora al mercato su due numeri: quanto e'
      squilibrata la partita (vittoria in casa meno vittoria fuori) e quanti
      gol si fanno (l'Over 2.5). Il pareggio NON e' uno dei due: lo decide la
      forma della matrice dei risultati. E la forma lo da' sotto il vero —
      24.3% contro il 24.9% che succede — mentre il mercato, tolto il margine,
      dice 25.1%. Quindi l'app mostrava un 1X2 un filo peggiore di quello che
      aveva in mano, e diverso da quello con cui il server prezza la
      classifica (che usa le quote vere).

   2. I rossi. La simulazione tira a sorte chi resta in dieci, ed e' giusto
      per la FASCIA: un rosso cambia davvero la partita. Ma la media dei giri
      li conteneva, e il rischio di un rosso e' gia' dentro le quote e dentro
      le partite su cui il modello e' stimato: contato due volte, allargava la
      forma dei gol proprio dove va stretta (tools/misura_dispersione.js).

   3. Il ricarico. Per passare da una quota a una probabilita' bisogna
      togliere il margine del banco, e "in proporzione" (dividere per la
      somma) vuol dire credere che il banco carichi uguale sui tre esiti. Non
      lo fa: carica di piu' sull'esito improbabile. Il metodo di Shin lo
      toglie come lo mette davvero. Conta solo dove manca Betfair (ricarico
      mezzo punto, i due metodi danno lo stesso numero), cioe' sulla quota
      media dei bookmaker (ricarico ~5%): in Ligue 1 e' meta' delle partite.

   La prova e' quella di sempre: tutto stimato sulle stagioni 2021-22 ..
   2023-24 (rho e rossi di ogni campionato), guardato sulle stagioni dopo,
   cinque campionati, con le quote di chiusura e con quelle del venerdi'.

   IL RISULTATO, 4 novembre 2026: stima 5404 partite, verifica 3956.

     1X2 del mercato, log-loss a tre esiti   chiusura           venerdi'
       stima                                 +0.051% (z 1.2)    +0.046% (z 1.1)
       verifica                              +0.075% (z 1.2)    +0.085% (z 1.8)
     pareggio, verifica: vero 24.9%, matrice 24.3%, mercato 25.1%

     senza i rossi nella media, risultato esatto
       stima                                 +0.030% (z 2.7)    +0.027% (z 2.5)
       verifica                              +0.044% (z 3.5)    +0.041% (z 3.3)

     Shin invece della proporzione, sulla quota media (1X2, log-loss)
       stima                                 +0.042% (z 1.7)    +0.045% (z 1.9)
       verifica                              +0.083% (z 2.5)    +0.082% (z 2.3)

   E sulla giocata che l'app propone davvero — "la piu' solida", mercati di
   base, soglia 82% — su tutte le 9360 partite dei cinque campionati:
                          chiusura                 venerdi'
     27 ottobre           promesse 76.8 prese 76.7  promesse 77.0 prese 77.4
     con i tre ritocchi   promesse 76.8 prese 76.8  promesse 77.0 prese 77.4

   Piccoli tutti e tre, e tutti e dodici i numeri dalla stessa parte. Entrano:
   modello.js, daQuote (Shin), ancoraMercato (bersaglio1x2), simula, prevedi
   e il backtest; server/worker.js prezza l'1X2 della classifica con Shin.

   uso: node tools/misura_ritocchi.js
*/
var fs = require('fs');
var path = require('path');
var R = path.join(__dirname, '..');
var M = require(path.join(R, 'modello.js'));

var FILES = ['serie-a.json', 'leghe/E0.json', 'leghe/D1.json', 'leghe/SP1.json', 'leghe/F1.json'];
var STIMA = { '2021-22': 1, '2022-23': 1, '2023-24': 1 };

var righe = [];
FILES.forEach(function (f) {
  var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', f), 'utf8'));
  var tutte = doc.partite.filter(function (p) { return p.gc != null; });
  var stima = tutte.filter(function (p) { return STIMA[p.s]; });
  var mod = M.costruisci(stima, { primoTempo: false });
  var rossi = M.effettoRosso(stima, mod);
  tutte.forEach(function (p) {
    var ok = function (q, n) { return q && q.length >= n && q.every(function (x) { return x > 1; }); };
    righe.push({ stima: !!STIMA[p.s], gc: p.gc, gv: p.gv, rho: mod.gol.rho, rossi: rossi,
                 ch: ok(p.qex || p.q, 3) && ok(p.qou || p.qoumax, 2) ? [p.qex || p.q, p.qou || p.qoumax] : null,
                 ap: ok(p.qap, 3) && ok(p.qapou, 2) ? [p.qap, p.qapou] : null });
  });
});

/* la partita come la vede l'app: ancorata a peso uno, e i quattro casi dei
   rossi (nessuno, casa, ospite, tutti e due) pesati come li pesca la
   simulazione — il conto esatto di quello che lei fa a sorte */
function vista(r, mercato, conRossi) {
  var q = r[mercato][0], qou = r[mercato][1];
  var a = M.ancoraMercato(1.4, 1.1, r.rho, { q: q, qou: qou, peso1x2: 1, pesoOU: 1 });
  var p = conRossi ? r.rossi.prob : 0, at = r.rossi.attacco, di = r.rossi.difesa, L = M.limita;
  var casi = [[(1 - p) * (1 - p), a.lam, a.mu], [p * (1 - p), a.lam * at, a.mu * di],
              [(1 - p) * p, a.lam * di, a.mu * at], [p * p, a.lam * at * di, a.mu * di * at]];
  var m = null;
  casi.forEach(function (c) {
    if (!(c[0] > 0)) return;
    var x = M.matriceRisultati(L(c[1], 0.05, 7), L(c[2], 0.05, 7), r.rho, 11);
    if (!m) m = x.map(function (riga) { return riga.map(function (v) { return v * c[0]; }); });
    else for (var i = 0; i < 11; i++) for (var j = 0; j < 11; j++) m[i][j] += x[i][j] * c[0];
  });
  return { m: m, mira: a.bersaglio1x2 };
}
function confronto(a, b) {
  var d = a.map(function (x, i) { return x - b[i]; });
  var md = M.media(d), base = M.media(a);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - md) * (x - md); }, 0) / Math.max(1, d.length - 1));
  return { guadagno: 100 * md / base, z: md / (sd / Math.sqrt(d.length)) };
}

/* ── 3. il ricarico: proporzione contro Shin, sulla quota media ── */
function proporzione(q) {
  var a = q.map(function (x) { return 1 / x; }), t = a[0] + a[1] + a[2];
  return a.map(function (x) { return x / t; });
}
console.log('=== il ricarico tolto con Shin invece che in proporzione (quota media, 1X2) ===');
['q', 'qap'].forEach(function (campo) {
  ['stima', 'verifica'].forEach(function (parte) {
    var a = [], b = [];
    FILES.forEach(function (f) {
      JSON.parse(fs.readFileSync(path.join(R, 'data', f), 'utf8')).partite.forEach(function (p) {
        var q = p[campo];
        if (p.gc == null || !q || !q.every(function (x) { return x > 1; })) return;
        if (!!STIMA[p.s] !== (parte === 'stima')) return;
        var y = p.gc > p.gv ? 0 : (p.gc === p.gv ? 1 : 2);
        a.push(-Math.log(proporzione(q)[y])); b.push(-Math.log(M.daQuote(q)[y]));
      });
    });
    var c = confronto(a, b);
    console.log('  ' + (campo === 'q' ? 'chiusura' : 'venerdi\'') + ', ' + parte + ' (' + a.length + '): ' +
                (c.guadagno >= 0 ? '+' : '') + c.guadagno.toFixed(3) + '% (z ' + c.z.toFixed(2) + ')');
  });
});

['ch', 'ap'].forEach(function (mercato) {
  console.log('\n=== quote di ' + (mercato === 'ch' ? 'CHIUSURA' : 'VENERDI\' (prima delle formazioni)') + ' ===');
  ['stima', 'verifica'].forEach(function (parte) {
    var matr = [], merc = [], conR = [], senzaR = [], n = 0, vero = [0, 0, 0], dm = [0, 0, 0], dq = [0, 0, 0];
    righe.forEach(function (r) {
      if (!r[mercato] || r.stima !== (parte === 'stima')) return;
      var y = r.gc > r.gv ? 0 : (r.gc === r.gv ? 1 : 2);
      var con = vista(r, mercato, true), senza = vista(r, mercato, false);
      var e = M.esiti(con.m), pm = [e.casa, e.pari, e.via];
      matr.push(-Math.log(pm[y])); merc.push(-Math.log(con.mira[y]));
      var cella = function (m) { return -Math.log(Math.max(1e-12, m[Math.min(10, r.gc)][Math.min(10, r.gv)])); };
      conR.push(cella(con.m)); senzaR.push(cella(senza.m));
      n++; vero[y]++;
      for (var k = 0; k < 3; k++) { dm[k] += pm[k]; dq[k] += con.mira[k]; }
    });
    var c1 = confronto(matr, merc), c2 = confronto(conR, senzaR);
    var pc = function (l) { return l.map(function (x) { return (100 * x / n).toFixed(1); }).join('/'); };
    console.log(parte + ' (' + n + ' partite)');
    console.log('  1X2 del mercato invece che della matrice: ' + (c1.guadagno >= 0 ? '+' : '') + c1.guadagno.toFixed(3) +
                '% (z ' + c1.z.toFixed(2) + ')   1/X/2 vero ' + pc(vero) + ', matrice ' + pc(dm) + ', mercato ' + pc(dq));
    console.log('  senza i rossi nella media, risultato esatto: ' + (c2.guadagno >= 0 ? '+' : '') + c2.guadagno.toFixed(3) +
                '% (z ' + c2.z.toFixed(2) + ')');
  });
});
