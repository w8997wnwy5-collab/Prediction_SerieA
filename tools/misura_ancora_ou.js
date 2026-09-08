/* Il secondo asse dell'ancoraggio, alla quota giusta.

   Il modello si ancora al mercato su due assi: chi vince (dalle quote 1X2) e
   quanti gol si faranno (dall'Over/Under 2.5). Il primo asse e' gia' passato
   dalla quota media a Betfair Exchange e ci ha guadagnato lo 0.28%, per un
   motivo che val la pena ripetere: NON e' che Betfair ci prenda di piu'. E'
   che porta dentro meno ricarico.

   Una quota di mercato non e' una probabilita': e' una probabilita' PIU' il
   margine del banco. Per tornare indietro si divide per la somma delle tre
   (o due) probabilita' implicite, ed e' un'approssimazione: assume che il
   banco carichi in proporzione su tutti gli esiti, cosa che non fa. L'errore
   di quell'approssimazione cresce col margine. Con un margine dello 0.5% non
   c'e' quasi niente da togliere, quindi non c'e' quasi niente da sbagliare.

   Il secondo asse usa ancora la quota MEDIA dei bookmaker, che di ricarico ne
   porta il 5.2%. Betfair sull'Over/Under nel file non c'e', ma la quota
   MIGLIORE del mercato si', e li' il ricarico e' lo 0.57%. Stessa medicina.

   uso: node tools/misura_ancora_ou.js
*/
var fs = require('fs'), path = require('path');
var R = '/home/user/Prediction_SerieA';
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }
function rpsTre(pr, e) {
  var c = 0, s = 0;
  for (var i = 0; i < 2; i++) { c += pr[i]; var x = (e <= i) ? 1 : 0; s += (c - x) * (c - x); }
  return s / 2;
}
function brierOver(p, vero) { return (p - vero) * (p - vero); }
function z(a, b) {
  var d = a.map(function (x, i) { return x - b[i]; }), m = media(d);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / Math.max(1, d.length - 1));
  return m / (sd / Math.sqrt(d.length));
}

/* Prima di tutto: quanto ricarico portano dentro le due letture? */
function ricarico(campo) {
  var l = [];
  tutte.forEach(function (p) {
    var q = p[campo];
    if (q && q[0] > 1 && q[1] > 1) l.push(1 / q[0] + 1 / q[1] - 1);
  });
  return { m: media(l), n: l.length };
}
var rMedia = ricarico('qou'), rMax = ricarico('qoumax');
console.log('il ricarico che le due letture portano dentro:');
console.log('  quota media dei bookmaker   ' + (100 * rMedia.m).toFixed(2) + '%   (n=' + rMedia.n + ')');
console.log('  quota migliore del mercato  ' + (100 * rMax.m).toFixed(2) + '%   (n=' + rMax.n + ')');
console.log('');

var dati = M.prepara(tutte);
var stagioni = (doc.stagioni || []).slice().sort();
var da = parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10) + '-08-01';
var ANCORA = 0.50, PESO_TIRI = 0.60, OGNI = 10;

var mod = null, ultimo = null;
var res = { qou: { rps: [], brier: [] }, qoumax: { rps: [], brier: [] } };
var nEntrambe = 0;
tutte.forEach(function (p) {
  if (p.d < da) return;
  if (!p.qou || !p.qoumax) return;                 /* solo dove si possono confrontare */
  if (!ultimo || M.giorni(ultimo, p.d) >= OGNI) {
    mod = M.costruisci(tutte, { dati: dati, fino: p.d, primoTempo: false,
                                iterazioni: 160, pesoTiri: PESO_TIRI });
    ultimo = p.d;
  }
  if (!mod || !mod.ok) return;
  var i = mod.indice[p.c], j = mod.indice[p.v];
  if (i == null || j == null) return;
  var e = p.gc > p.gv ? 0 : (p.gc === p.gv ? 1 : 2);
  var over = (p.gc + p.gv) > 2.5 ? 1 : 0;
  var g = M.golAttesiModello(mod, i, j, { pesoTiri: PESO_TIRI });
  var q1x2 = p.qex || p.q || null;
  nEntrambe++;
  ['qou', 'qoumax'].forEach(function (campo) {
    var am = M.ancoraMercato(g[0], g[1], mod.gol.rho,
      { q: q1x2, qou: p[campo], peso1x2: ANCORA, pesoOU: ANCORA });
    var es = M.esiti(M.matriceRisultati(am.lam, am.mu, mod.gol.rho, 11));
    res[campo].rps.push(rpsTre([es.casa, es.pari, es.via], e));
    res[campo].brier.push(brierOver(es.over25, over));
  });
});

console.log('partite valutate: ' + nEntrambe + '  (dal ' + da + ', ancoraggio ' + ANCORA + ')\n');
console.log('                              errore 1X2   errore Over/Under');
console.log('  con la quota media          ' + media(res.qou.rps).toFixed(5) + '      ' + media(res.qou.brier).toFixed(5));
console.log('  con la migliore del mercato ' + media(res.qoumax.rps).toFixed(5) + '      ' + media(res.qoumax.brier).toFixed(5));
var zr = z(res.qou.rps, res.qoumax.rps), zb = z(res.qou.brier, res.qoumax.brier);
console.log('  guadagno                    ' +
  (100 * (media(res.qou.rps) - media(res.qoumax.rps)) / media(res.qou.rps)).toFixed(2) + '%  z=' + zr.toFixed(2) +
  '   ' + (100 * (media(res.qou.brier) - media(res.qoumax.brier)) / media(res.qou.brier)).toFixed(2) + '%  z=' + zb.toFixed(2));
console.log('');

if (zb > 1.9 || zr > 1.9) {
  console.log('La quota migliore del mercato batte la media anche sul secondo asse.');
  console.log('Stesso motivo del primo: meno ricarico dentro, meno approssimazione');
  console.log('nel toglierlo. Va messa nell\'ancoraggio.');
} else if (zb < -1.9 || zr < -1.9) {
  console.log('La quota migliore PEGGIORA: la media dei bookmaker, pur carica di');
  console.log('ricarico, e\' una stima piu\' stabile del banco piu\' generoso — che e\'');
  console.log('spesso un solo operatore, e magari quello che ha sbagliato il prezzo.');
} else {
  console.log('Le due letture non si distinguono. Sul secondo asse il ricarico non');
  console.log('fa la differenza che faceva sul primo, e la ragione e\' aritmetica: su');
  console.log('due esiti invece che tre, dividere per la somma sbaglia molto meno.');
}
