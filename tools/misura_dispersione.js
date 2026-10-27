/* La FORMA dei gol: il Poisson ha ragione su quante volte si resta a secco?

   Tutte le prove di prima chiedevano "chi vince" e "quanti gol", e la
   risposta era sempre la stessa: le quote lo sanno gia'. Ma l'app non mostra
   solo l'1X2 e l'Over 2.5. Mostra Gol/NoGol, segna la casa, segna l'ospite,
   multigol, risultati esatti — e tutti quelli escono dalla FORMA della
   distribuzione dei gol, che le quote non toccano. Il modello si ancora al
   mercato su due numeri, la forma la mette il Poisson.

   E qui la domanda e' giusta, perche' il Poisson si puo' sbagliare senza
   che nessuna prova sull'1X2 se ne accorga: con la stessa media, una
   distribuzione piu' stretta fa meno zeri e piu' uno e due. Le quote di
   chiusura restano identiche, il Gol/NoGol no.

   Il conto e' fatto esattamente come lo fa l'app: per ogni partita i due gol
   attesi che rifanno le quote dell'1X2 e dell'Over 2.5 (ancoraggio a peso
   uno, come in tutti e cinque i campionati), la correzione dei punteggi bassi
   (rho) e l'effetto dei rossi stimati SOLO sulle stagioni di stima, poi la
   matrice dei risultati. Si sceglie la forma su 2021-22 .. 2023-24 e la si
   verifica sulle tre stagioni dopo, mai viste.

   IL RISULTATO, 27 ottobre 2026: 9205 partite, stima su 5404, verifica su
   3801. La distribuzione vera, a parita' di gol attesi:

                  0 gol   1 gol   2 gol   5 o piu'
     casa  vero   22.9    32.1    24.2    2.4
        Poisson   23.5    31.5    23.3    3.4
     osp.  vero   28.3    35.1    22.8    1.4
        Poisson   31.2    33.9    20.5    1.6

   Meno zeri, meno goleade: piu' stretta del Poisson, in tutte e due le
   meta' dell'archivio. La versione stretta del Poisson (Conway-Maxwell,
   comandata con la media) col nu scelto sulle stagioni di stima, 1.10:

     risultato esatto, chiusura   +0.17% (z 5.5)
     risultato esatto, apertura   +0.15% (z 4.6)
     Gol/Gol                      detto 51.9 -> 53.3, vero 54.9 (+0.19%, z 2.8)
     segna l'ospite               detto 68.5 -> 69.6, vero 71.7 (+0.24%, z 3.7)
     casa a zero                  detto 24.3 -> 23.8, vero 22.2 (+0.12%, z 2.9)
     Over 0.5, Over 1.5           76.8 -> 77.4 sull'1.5, vero 77.4
     multigol 1-4, 2-5            piu' vicini al vero, guadagno positivo
     Over 3.5                     l'unico che scivola: 31.4 -> 30.7, vero
                                  31.4 (-0.02%, z -0.4: rumore)
     primo e secondo tempo        meglio anche loro, con lo stesso nu

   E sulla giocata che l'app propone davvero — "la piu' solida" coi mercati
   di base, soglia 82%, su tutte le 9205 partite dei cinque campionati
   (sezione 5): col Poisson prometteva 76.5% e prendeva 77.2%, con la forma
   stretta promette 76.8% e prende 76.7%. Adesso dice il vero. Prende mezzo
   punto in meno per un motivo preciso: in 640 partite su 9205 la gamba di
   prima (Over 1.5, Under 4.5 intorno all'80%) letta giusta sta sopra l'82%,
   oltre il tetto della prudenza "Equilibrata", e la scelta scende alla
   gamba dopo, che paga di piu'. E' la manopola che fa il suo mestiere con
   numeri piu' giusti. In Serie A, col modello vero rigiocato giornata per
   giornata (tools/ottimizza_regola.js, 67 giornate mai viste, soglia 82%):
   prima 76.0% prese su 75.9% promesse, adesso 75.9% su 76.1%. Uguale.

   Provati e scartati, sempre scelti sulla stima e visti sulla verifica:
     - spostare rho (i punteggi bassi): il rho di ogni campionato e' gia'
       il migliore, in tutte e due le direzioni si perde;
     - una scossa comune ai due attacchi (partite "aperte" e "chiuse"),
       con un nu piu' alto a compensare: sistema l'Over 3.5, ma sulle
       stagioni nuove il risultato esatto non si muove (meno dello 0.01%,
       con le quote di chiusura e con quelle di apertura). Un secondo
       numero da tenere in piedi per niente;
     - un nu per campionato: la Serie A ne vorrebbe uno piu' alto (1.25),
       la Bundesliga quasi niente (1.05), ma sulla verifica uno per
       campionato fa esattamente come uno solo: quello che si guadagna in
       Italia si perde in Inghilterra e in Francia. Uno solo.

   Entra nel modello: modello.js, DISPERSIONE = 1.10.

   C'e' un secondo risultato, piu' piccolo e da guardare a parte. L'app tira
   a sorte i rossi dentro la simulazione, e quel tiro allarga la forma invece
   di stringerla: il rosso e' gia' dentro le quote e dentro le partite su cui
   il modello e' stimato, quindi conta due volte. Toglierlo varrebbe ancora
   +0.05% (z 3.7). Non entra qui perche' negli altri quattro campionati e'
   l'unica cosa che da' una fascia alla simulazione, e la "piu' solida" si
   sceglie proprio dalla fascia: si cambia solo dopo aver rigiocato quella
   scelta.

   uso: node tools/misura_dispersione.js
*/
var fs = require('fs');
var path = require('path');
var R = path.join(__dirname, '..');
var M = require(path.join(R, 'modello.js'));

var FILES = ['serie-a.json', 'leghe/E0.json', 'leghe/D1.json', 'leghe/SP1.json', 'leghe/F1.json'];
var STIMA = { '2021-22': 1, '2022-23': 1, '2023-24': 1 };
var NU = [1, 1.05, 1.1, 1.15, 1.2, 1.25];

function equa3(q) {
  if (!q || q.length < 3 || !(q[0] > 1 && q[1] > 1 && q[2] > 1)) return null;
  return M.daQuote(q);
}
function equa2(q) {
  if (!q || q.length < 2 || !(q[0] > 1 && q[1] > 1)) return null;
  return M.daQuoteOU(q);
}

/* le partite con le due letture del mercato, e quello che ogni campionato
   sapeva di se' alla fine delle stagioni di stima */
var righe = [];
FILES.forEach(function (f) {
  var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', f), 'utf8'));
  var tutte = doc.partite.filter(function (p) { return p.gc != null; });
  var stima = tutte.filter(function (p) { return STIMA[p.s]; });
  var mod = M.costruisci(stima, { primoTempo: false });
  var rossi = M.effettoRosso(stima, mod);
  tutte.forEach(function (p) {
    var ch = equa3(p.qex || p.q), chOU = equa2(p.qou || p.qoumax);
    var ap = equa3(p.qap), apOU = equa2(p.qapou);
    righe.push({ f: f, stima: !!STIMA[p.s], gc: p.gc, gv: p.gv,
                 ch: ch && chOU != null ? [ch, chOU] : null,
                 ap: ap && apOU != null ? [ap, apOU] : null,
                 rho: mod.gol.rho, rossi: rossi });
  });
});

/* la matrice come la vede l'app: ancorata, e mescolata coi quattro casi dei
   rossi (nessuno, casa, ospite, tutti e due) — il conto esatto di quello che
   la simulazione fa a sorte */
function matriceApp(r, mercato, nu, conRossi) {
  var q = r[mercato][0], pOU = r[mercato][1];
  var a = M.ancoraMercato(1.4, 1.1, r.rho, { q: [1 / q[0], 1 / q[1], 1 / q[2]], qou: [1 / pOU, 1 / (1 - pOU)],
                                             peso1x2: 1, pesoOU: 1, dispersione: nu });
  var p = conRossi ? r.rossi.prob : 0, at = r.rossi.attacco, di = r.rossi.difesa, L = M.limita;
  var casi = [[(1 - p) * (1 - p), a.lam, a.mu], [p * (1 - p), a.lam * at, a.mu * di],
              [(1 - p) * p, a.lam * di, a.mu * at], [p * p, a.lam * at * di, a.mu * di * at]];
  var m = null;
  casi.forEach(function (c) {
    if (!(c[0] > 0)) return;
    var x = M.matriceRisultati(L(c[1], 0.05, 7), L(c[2], 0.05, 7), r.rho, 11, nu);
    if (!m) m = x.map(function (riga) { return riga.map(function (v) { return v * c[0]; }); });
    else for (var i = 0; i < 11; i++) for (var j = 0; j < 11; j++) m[i][j] += x[i][j] * c[0];
  });
  return m;
}
function perdita(m, r) { return -Math.log(Math.max(1e-12, m[Math.min(10, r.gc)][Math.min(10, r.gv)])); }
function confronto(a, b) {
  var d = a.map(function (x, i) { return x - b[i]; });
  var md = M.media(d), base = M.media(a);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - md) * (x - md); }, 0) / Math.max(1, d.length - 1));
  return { guadagno: 100 * md / base, z: md / (sd / Math.sqrt(d.length)) };
}

/* ── 1. la forma vera contro quella del Poisson, a parita' di gol attesi ── */
console.log('=== 1. QUANTI GOL FA UNA SQUADRA: VERO CONTRO POISSON (chiusura) ===');
['stima', 'verifica'].forEach(function (parte) {
  var vero = { c: [0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0] }, detto = { c: [0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0, 0] }, n = 0;
  righe.forEach(function (r) {
    if (!r.ch || r.stima !== (parte === 'stima')) return;
    var m = matriceApp(r, 'ch', 1, false);
    vero.c[Math.min(5, r.gc)]++; vero.v[Math.min(5, r.gv)]++; n++;
    for (var i = 0; i < 11; i++) for (var j = 0; j < 11; j++) {
      detto.c[Math.min(5, i)] += m[i][j]; detto.v[Math.min(5, j)] += m[i][j];
    }
  });
  var fmt = function (l) { return l.map(function (x) { return (100 * x / n).toFixed(1).padStart(5); }).join(' '); };
  console.log(parte + ' (' + n + ' partite)          0     1     2     3     4    5+');
  console.log('  casa    vero    ' + fmt(vero.c) + '\n          Poisson ' + fmt(detto.c));
  console.log('  ospite  vero    ' + fmt(vero.v) + '\n          Poisson ' + fmt(detto.v));
});

/* ── 2. quale nu, scelto sulle stagioni di stima ── */
console.log('\n=== 2. LA FORMA SCELTA SULLA STIMA (perdita sul risultato esatto, piu\' bassa e\' meglio) ===');
console.log('      nu    stima      verifica');
var migliore = null;
NU.forEach(function (nu) {
  var st = [], ve = [];
  righe.forEach(function (r) { if (r.ch) (r.stima ? st : ve).push(perdita(matriceApp(r, 'ch', nu, true), r)); });
  var ms = M.media(st);
  if (!migliore || ms < migliore.stima) migliore = { nu: nu, stima: ms };
  console.log('    ' + nu.toFixed(2) + '   ' + ms.toFixed(5) + '    ' + M.media(ve).toFixed(5));
});
console.log('  scelto sulla stima: nu = ' + migliore.nu.toFixed(2) + '  (nel modello: ' + M.DISPERSIONE.toFixed(2) + ')');

/* ── 3. la verifica, mercato per mercato ── */
var NU_SCELTO = migliore.nu;
var MERCATI = [['casa', '1'], ['pari', 'X'], ['via', '2'], ['c1x', '1X'], ['cx2', 'X2'], ['gol', 'Gol/Gol'],
               ['o05', 'Over 0.5'], ['o15', 'Over 1.5'], ['o25', 'Over 2.5'], ['o35', 'Over 3.5'], ['o45', 'Over 4.5'],
               ['mg13', 'Multigol 1-3'], ['mg14', 'Multigol 1-4'], ['mg24', 'Multigol 2-4'], ['mg25', 'Multigol 2-5'],
               ['segnaC', 'segna la casa'], ['segnaV', 'segna l\'ospite'], ['cSecca', 'casa a zero'], ['vSecca', 'ospite a zero']];
['ch', 'ap'].forEach(function (mercato) {
  var vecchia = [], nuova = [], per = {}, n = 0;
  MERCATI.forEach(function (x) { per[x[0]] = { a: [], b: [], pa: 0, pb: 0, y: 0 }; });
  righe.forEach(function (r) {
    if (r.stima || !r[mercato]) return;
    var ma = matriceApp(r, mercato, 1, true), mb = matriceApp(r, mercato, NU_SCELTO, true);
    vecchia.push(perdita(ma, r)); nuova.push(perdita(mb, r)); n++;
    var sa = M.mercatiDaMatrice(ma), sb = M.mercatiDaMatrice(mb);
    var y = M.mercatiDaMatrice(M.matriceSecca(r.gc, r.gv, 11));
    MERCATI.forEach(function (x) {
      var k = x[0], o = per[k], v = y[k] > 0.5;
      var la = function (p) { p = Math.min(1 - 1e-9, Math.max(1e-9, p)); return -(v ? Math.log(p) : Math.log(1 - p)); };
      o.a.push(la(sa[k])); o.b.push(la(sb[k])); o.pa += sa[k]; o.pb += sb[k]; o.y += v ? 1 : 0;
    });
  });
  var c = confronto(vecchia, nuova);
  console.log('\n=== 3. VERIFICA, quote di ' + (mercato === 'ch' ? 'CHIUSURA' : 'APERTURA') + ': ' + n + ' partite mai viste ===');
  console.log('risultato esatto: guadagno ' + c.guadagno.toFixed(3) + '%  (z ' + c.z.toFixed(2) + ')');
  console.log('  mercato           vero   Poisson   stretto   guadagno      z');
  MERCATI.forEach(function (x) {
    var o = per[x[0]], cc = confronto(o.a, o.b);
    console.log('  ' + x[1].padEnd(16) + (100 * o.y / n).toFixed(1).padStart(5) + (100 * o.pa / n).toFixed(1).padStart(10) +
                (100 * o.pb / n).toFixed(1).padStart(10) + (cc.guadagno.toFixed(3) + '%').padStart(11) + cc.z.toFixed(2).padStart(7));
  });
});

/* ── 4. i rossi tirati a sorte: allargano la forma che andrebbe stretta ── */
var conR = [], senzaR = [];
righe.forEach(function (r) {
  if (r.stima || !r.ch) return;
  conR.push(perdita(matriceApp(r, 'ch', NU_SCELTO, true), r));
  senzaR.push(perdita(matriceApp(r, 'ch', NU_SCELTO, false), r));
});
var cr = confronto(conR, senzaR);
console.log('\n=== 4. SENZA IL TIRO A SORTE DEI ROSSI (verifica, chiusura) ===');
console.log('risultato esatto: guadagno ' + cr.guadagno.toFixed(3) + '%  (z ' + cr.z.toFixed(2) + ')');

/* ── 5. la giocata che l'app propone: "la piu' solida", mercati di base ──
   Come in Giornata: 1X2 e Over/Under, fra il 12% e l'88%, pari e dispari
   fuori, la piu' alta per pavimento fra quelle sotto l'82%. La fascia qui
   viene dai quattro casi dei rossi, come negli altri quattro campionati
   (che non hanno il bootstrap della Serie A). */
var BASE = ['1', 'X', '2', 'O05', 'O15', 'U15', 'O25', 'U25', 'O35', 'U35', 'O45', 'U45'];
function quantile(valori, pesi, q) {
  var o = valori.map(function (v, i) { return [v, pesi[i]]; }).sort(function (a, b) { return a[0] - b[0]; });
  for (var i = 0, c = 0; i < o.length; i++) { c += o[i][1]; if (c > q) return o[i][0]; }
  return o[o.length - 1][0];
}
function piuSolida(r, nu) {
  var q = r.ch[0], pOU = r.ch[1];
  var a = M.ancoraMercato(1.4, 1.1, r.rho, { q: [1 / q[0], 1 / q[1], 1 / q[2]], qou: [1 / pOU, 1 / (1 - pOU)],
                                             peso1x2: 1, pesoOU: 1, dispersione: nu });
  var p = r.rossi.prob, at = r.rossi.attacco, di = r.rossi.difesa, L = M.limita;
  var casi = [[(1 - p) * (1 - p), a.lam, a.mu], [p * (1 - p), a.lam * at, a.mu * di],
              [(1 - p) * p, a.lam * di, a.mu * at], [p * p, a.lam * at * di, a.mu * di * at]];
  var pesi = casi.map(function (c) { return c[0]; });
  var sim = casi.map(function (c) { return M.mercatiDaMatrice(M.matriceRisultati(L(c[1], 0.05, 7), L(c[2], 0.05, 7), r.rho, 11, nu)); });
  var medie = {};
  for (var k in sim[0]) { medie[k] = 0; for (var i = 0; i < 4; i++) medie[k] += pesi[i] * sim[i][k]; }
  var voci = M.elencoMercati(medie, ['casa', 'ospite']).filter(function (m) {
    return BASE.indexOf(m.id) >= 0 && m.p >= 0.12 && m.p <= 0.88;
  });
  voci.forEach(function (m) {
    var v = sim.map(function (s) { return s[m.campo]; });
    m.p05 = Math.min(m.p, m.inverso ? 1 - quantile(v, pesi, 0.95) : quantile(v, pesi, 0.05));
  });
  voci.sort(function (x, y) { return y.p05 - x.p05; });
  return voci.filter(function (m) { return m.p <= 0.82; })[0] || voci[0];
}
console.log('\n=== 5. "LA PIU\' SOLIDA", MERCATI DI BASE, TUTTE LE PARTITE (chiusura) ===');
[1, NU_SCELTO].forEach(function (nu) {
  var n = 0, promessa = 0, presa = 0;
  righe.forEach(function (r) {
    if (!r.ch) return;
    var m = piuSolida(r, nu);
    if (!m) return;
    n++; promessa += m.p; presa += M.haVinto(m.id, r.gc, r.gv) ? 1 : 0;
  });
  console.log('  ' + (nu === 1 ? 'Poisson      ' : 'forma stretta') + '  gambe ' + n + '   promessa ' + (100 * promessa / n).toFixed(1) +
              '%   presa ' + (100 * presa / n).toFixed(1) + '%   (z ' + ((presa - promessa) / Math.sqrt(promessa * (1 - promessa / n))).toFixed(2) + ')');
});
