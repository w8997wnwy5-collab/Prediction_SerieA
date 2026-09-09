/* L'ancoraggio deve stringere di piu' quando il modello alza la voce?

   Oggi il modello si fonde col mercato con UN peso solo, uguale per tutte le
   partite: 0.85 di mercato, 0.15 di me, sempre. Quel numero e' scelto dal
   backtest, quindi non e' inventato — ma e' UNO, e questo e' il punto.

   Perche' e' sospetto. Nella sezione Precisione c'e' una misura che fa paura:
   dove il modello crede di avere piu' vantaggio sul mercato, li' perde di piu'.
   Edge dichiarato oltre il +20% -> reso -35%. E' la maledizione del vincitore,
   ed e' monotona: peggiora man mano che il disaccordo cresce.

   Ma se il disaccordo grande e' PIU' velenoso di quello piccolo, allora il peso
   giusto non puo' essere lo stesso nei due casi. Dove il modello sussurra,
   ascoltarlo un po' costa poco. Dove urla, e' quasi sempre perche' gli manca
   un'informazione che il mercato ha — un'assenza, una formazione — e li' andava
   zittito di piu'.

   Detta in statistica: il peso ottimo di una combinazione lineare fra due
   previsori non e' una costante se la loro affidabilita' relativa dipende dallo
   stato. Qui lo stato e' quanto le due previsioni distano fra loro.

   La prova, con la sola disciplina che conta: si SCEGLIE il peso per fascia su
   una meta' delle stagioni e si VERIFICA sull'altra, che nella scelta non e'
   mai entrata. Se il guadagno non passa di la', era rumore.

   uso: node tools/misura_stringimento.js
*/
var fs = require('fs'), path = require('path');
var R = '/home/user/Prediction_SerieA';
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var PESI = [0, 0.3, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 1];
var PESO_TIRI = 0.60, OGNI = 10, NFASCE = 4;

function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }
function rpsTre(pr, e) {
  var c = 0, s = 0;
  for (var i = 0; i < 2; i++) { c += pr[i]; var x = (e <= i) ? 1 : 0; s += (c - x) * (c - x); }
  return s / 2;
}
function z(a, b) {
  var d = a.map(function (x, i) { return x - b[i]; }), m = media(d);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / Math.max(1, d.length - 1));
  return m / (sd / Math.sqrt(d.length));
}

/* Quanto le due previsioni distano: variazione totale sui tre esiti. Simmetrica,
   sta fra 0 e 1, e non privilegia nessuno dei due — che e' quello che serve,
   visto che la domanda e' proprio "chi dei due ha ragione qui". */
function distanza(a, b) {
  return (Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2])) / 2;
}

/* Una passata sola: per ogni partita si registra la distanza fra modello e
   mercato e l'errore che si sarebbe fatto con OGNI peso. Cosi' la griglia si
   calcola una volta e poi si taglia in tutti i modi che si vuole. */
var dati = M.prepara(tutte);
var stagioni = (doc.stagioni || []).slice().sort();
var inizio = parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10) + '-08-01';
var confine = parseInt(stagioni[Math.max(0, stagioni.length - 2)].slice(0, 4), 10) + '-08-01';

var righe = [], mod = null, ultimo = null;
tutte.forEach(function (p) {
  if (p.d < inizio) return;
  var q1x2 = p.qex || p.q || null;
  if (!q1x2) return;
  if (!ultimo || M.giorni(ultimo, p.d) >= OGNI) {
    mod = M.costruisci(tutte, { dati: dati, fino: p.d, primoTempo: false,
                                iterazioni: 160, pesoTiri: PESO_TIRI });
    ultimo = p.d;
  }
  if (!mod || !mod.ok) return;
  var i = mod.indice[p.c], j = mod.indice[p.v];
  if (i == null || j == null) return;
  var e = p.gc > p.gv ? 0 : (p.gc === p.gv ? 1 : 2);
  var g = M.golAttesiModello(mod, i, j, { pesoTiri: PESO_TIRI });
  var nudo = M.esiti(M.matriceRisultati(g[0], g[1], mod.gol.rho, 11));
  var mio = [nudo.casa, nudo.pari, nudo.via];
  var mer = M.daQuote(q1x2);
  if (!mer) return;
  var err = PESI.map(function (w) {
    var am = M.ancoraMercato(g[0], g[1], mod.gol.rho,
      { q: q1x2, qou: p.qou || null, peso1x2: w, pesoOU: w });
    var es = M.esiti(M.matriceRisultati(am.lam, am.mu, mod.gol.rho, 11));
    return rpsTre([es.casa, es.pari, es.via], e);
  });
  righe.push({ d: p.d, dist: distanza(mio, mer), err: err });
});

var train = righe.filter(function (r) { return r.d < confine; });
var test  = righe.filter(function (r) { return r.d >= confine; });
console.log('partite: ' + righe.length + '   scelgo su ' + train.length +
            ' (fino al ' + confine + '), verifico su ' + test.length + '\n');

function migliorPeso(l) {
  var best = 0, bm = Infinity;
  PESI.forEach(function (w, k) {
    var m = media(l.map(function (r) { return r.err[k]; }));
    if (m < bm) { bm = m; best = k; }
  });
  return best;
}

/* Le fasce si tagliano sui quantili del TRAIN: i bordi non devono sapere
   niente del test, nemmeno dove stanno. */
var ordinate = train.map(function (r) { return r.dist; }).sort(function (a, b) { return a - b; });
var bordi = [];
for (var f = 1; f < NFASCE; f++) bordi.push(ordinate[Math.floor(f * ordinate.length / NFASCE)]);
function fasciaDi(r) { var k = 0; while (k < bordi.length && r.dist > bordi[k]) k++; return k; }

var globale = migliorPeso(train);
console.log('con un peso solo:  ' + PESI[globale] + '\n');
console.log('   la curva intera, sul train — quanto vale ascoltare il modello:');
PESI.forEach(function (w, k) {
  console.log('     peso mercato ' + String(w).padEnd(6) +
              media(train.map(function (r) { return r.err[k]; })).toFixed(5) +
              (k === globale ? '   ← migliore' : ''));
});
console.log('');
console.log('   fascia di disaccordo        n     peso migliore   errore');
var pesoFascia = [];
for (var k = 0; k < NFASCE; k++) {
  var l = train.filter(function (r) { return fasciaDi(r) === k; });
  var b = migliorPeso(l);
  pesoFascia.push(b);
  var da = k === 0 ? 0 : bordi[k-1], a = k === NFASCE-1 ? 1 : bordi[k];
  console.log('   ' + (da.toFixed(3) + '–' + a.toFixed(3)).padEnd(16) +
              String(l.length).padStart(5) + '         ' + String(PESI[b]).padEnd(8) +
              media(l.map(function (r) { return r.err[b]; })).toFixed(5));
}
var cresce = pesoFascia.every(function (w, i) { return i === 0 || w >= pesoFascia[i-1]; });
console.log('\n   il peso ' + (cresce ? 'CRESCE' : 'non cresce') + ' col disaccordo' +
            (cresce ? ': e\' quello che diceva l\'ipotesi.' : '.') + '\n');

/* la verifica, sulla meta' che non ha scelto niente */
var fisso = test.map(function (r) { return r.err[globale]; });
var mobile = test.map(function (r) { return r.err[pesoFascia[fasciaDi(r)]]; });
console.log('══ verifica su ' + test.length + ' partite mai viste');
console.log('   peso unico (come adesso)   ' + media(fisso).toFixed(5));
console.log('   peso per fascia            ' + media(mobile).toFixed(5));
var zz = z(fisso, mobile);
console.log('   guadagno                   ' +
  (100 * (media(fisso) - media(mobile)) / media(fisso)).toFixed(2) + '%   z=' + zz.toFixed(2));

var gTrain = 100 * (media(train.map(function (r) { return r.err[globale]; })) -
                    media(train.map(function (r) { return r.err[pesoFascia[fasciaDi(r)]]; }))) /
             media(train.map(function (r) { return r.err[globale]; }));
console.log('   (dove ha scelto era ' + gTrain.toFixed(2) + '%)\n');

if (zz > 1.9) {
  console.log('Regge. Il peso dell\'ancoraggio non e\' una costante: dipende da quanto');
  console.log('il modello sta dissentendo. Dove sussurra lo si puo\' ascoltare, dove');
  console.log('urla va zittito — ed e\' misurato, non predicato.');
} else if (zz < -1.9) {
  console.log('Peggiora fuori campione: il peso per fascia era rumore adattato al');
  console.log('passato. Un peso solo, e via.');
} else {
  console.log('Non si distingue dal caso. La maledizione del vincitore e\' vera sul');
  console.log('RENDIMENTO di una giocata, ma sull\'errore di previsione il peso unico');
  console.log('gia\' fa quasi tutto il lavoro: le due cose non sono la stessa cosa.');
}
