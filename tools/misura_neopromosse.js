/* Il modello sbaglia di piu' sulle neopromosse?

   Ogni estate tre squadre salgono dalla Serie B, e per il modello sono
   praticamente vuote: nessuna partita in archivio, o quelle di due anni prima
   se e' un rimbalzo. Il ridge le tira verso la media della lega, che e' il
   meno peggio che si possa fare quando non si sa niente — ma "il meno peggio"
   non e' una misura.

   Sono 114 partite a stagione, il 30% del calendario: se lo sbaglio fosse
   grosso, varrebbe la pena andare a prendere l'archivio di Serie B. Questo
   strumento serve a decidere se vale la pena PRIMA di scaricare qualcosa.

   Tre domande, in ordine:

     1. l'errore sulle partite con una neopromossa e' peggiore delle altre?
     2. se si', quanto dura? (settembre e' peggio di aprile?)
     3. e' il MODELLO a sbagliare, o e' proprio una partita piu' imprevedibile?
        La differenza si vede confrontandosi col mercato sulle stesse partite:
        se sbaglia anche lui, non e' ignoranza mia, e' che sono partite strane.

   La terza e' la domanda che conta. Se il mercato ci prende e io no, mi manca
   un dato. Se sbagliamo tutti e due, non c'e' niente da scaricare.

   uso: node tools/misura_neopromosse.js
*/
var fs = require('fs'), path = require('path');
var R = '/home/user/Prediction_SerieA';
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

function rpsTre(pr, e) { var c = 0, s = 0; for (var i = 0; i < 2; i++) { c += pr[i]; s += (c - ((e <= i) ? 1 : 0)) * (c - ((e <= i) ? 1 : 0)); } return s / 2; }
function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }
/* Due gruppi diversi di partite, non due misure sulla stessa partita: serve
   Welch, non l'appaiato. Nella prima stesura qui c'era un appaiato applicato a
   due liste tagliate alla stessa lunghezza, che e' un modo elegante di
   confrontare partite che non c'entrano niente fra loro. */
function welch(a, b) {
  var ma = media(a), mb = media(b);
  var va = a.reduce(function (s, x) { return s + (x - ma) * (x - ma); }, 0) / Math.max(1, a.length - 1);
  var vb = b.reduce(function (s, x) { return s + (x - mb) * (x - mb); }, 0) / Math.max(1, b.length - 1);
  return (ma - mb) / Math.sqrt(va / a.length + vb / b.length);
}

/* Chi e' neopromossa in che stagione: c'era l'anno prima o no. */
var perStagione = {};
tutte.forEach(function (p) {
  (perStagione[p.s] = perStagione[p.s] || {})[p.c] = 1;
  perStagione[p.s][p.v] = 1;
});
var stagioni = Object.keys(perStagione).sort();
var nuova = {};                          /* "stagione|squadra" -> 1 */
stagioni.forEach(function (s, i) {
  if (!i) return;
  Object.keys(perStagione[s]).forEach(function (sq) {
    if (!perStagione[stagioni[i - 1]][sq]) nuova[s + '|' + sq] = 1;
  });
});
console.log('neopromosse per stagione:');
stagioni.slice(1).forEach(function (s) {
  var l = Object.keys(perStagione[s]).filter(function (sq) { return nuova[s + '|' + sq]; });
  console.log('  ' + s + '  ' + l.sort().join(', '));
});
console.log('');

/* Quante partite ha gia' giocato in questa Serie A, alla data della partita. */
function giocate(sq, stagione, data) {
  var n = 0;
  for (var i = 0; i < tutte.length; i++) {
    var x = tutte[i];
    if (x.s !== stagione || x.d >= data) continue;
    if (x.c === sq || x.v === sq) n++;
  }
  return n;
}

var da = (parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10)) + '-08-01';
var mod = null, ultimo = null;
var righe = [];
tutte.forEach(function (p) {
  if (p.d < da) return;
  if (!ultimo || M.giorni(ultimo, p.d) > 10) {
    var prima = tutte.filter(function (x) { return x.d < p.d; });
    if (prima.length < 600) return;
    mod = M.costruisci(prima, { fino: p.d, primoTempo: false, iterazioni: 120 });
    ultimo = p.d;
  }
  if (!mod) return;
  if (mod.indice[p.c] == null || mod.indice[p.v] == null) return;
  var e = p.gc > p.gv ? 0 : (p.gc === p.gv ? 1 : 2);
  var quote = p.qex || p.q || null;

  /* Il modello NUDO, senza ancoraggio: e' l'unico modo di vedere quanto sa di
     suo. Con l'ancoraggio si guarderebbe il mercato rispondere a se stesso. */
  var nudo = M.simula(mod, p.c, p.v, { N: 900 });
  if (!nudo) return;
  var eNudo = rpsTre([nudo.fasce.casa.p, nudo.fasce.pari.p, nudo.fasce.via.p], e);

  var eMercato = null;
  if (quote && quote[0] > 1 && quote[1] > 1 && quote[2] > 1) {
    var s = 1 / quote[0] + 1 / quote[1] + 1 / quote[2];
    eMercato = rpsTre([1 / quote[0] / s, 1 / quote[1] / s, 1 / quote[2] / s], e);
  }

  var neoC = !!nuova[p.s + '|' + p.c], neoV = !!nuova[p.s + '|' + p.v];
  righe.push({
    neo: neoC || neoV, s: p.s, d: p.d,
    /* quante ne ha gia' giocate la neopromossa: se sono due, si sa poco */
    esperienza: (neoC || neoV) ? giocate(neoC ? p.c : p.v, p.s, p.d) : null,
    modello: eNudo, mercato: eMercato
  });
});

var conMercato = righe.filter(function (r) { return r.mercato != null; });
var neo = conMercato.filter(function (r) { return r.neo; });
var vet = conMercato.filter(function (r) { return !r.neo; });

console.log('partite valutate: ' + conMercato.length +
            '   di cui con una neopromossa: ' + neo.length +
            ' (' + (100 * neo.length / conMercato.length).toFixed(0) + '%)\n');

console.log('                            modello   mercato   scarto');
function riga(nome, l) {
  var m = media(l.map(function (r) { return r.modello; }));
  var q = media(l.map(function (r) { return r.mercato; }));
  console.log('  ' + nome.padEnd(24) + m.toFixed(5) + '   ' + q.toFixed(5) +
              '   ' + (m - q >= 0 ? '+' : '') + (m - q).toFixed(5));
  return { m: m, q: q };
}
var a = riga('con una neopromossa', neo);
var b = riga('fra due squadre note', vet);
console.log('');
console.log('  il modello peggiora di ' + (100 * (a.m - b.m) / b.m).toFixed(1) + '% sulle neopromosse,  z=' +
            welch(neo.map(function (r) { return r.modello; }), vet.map(function (r) { return r.modello; })).toFixed(2));
console.log('  il mercato  peggiora di ' + (100 * (a.q - b.q) / b.q).toFixed(1) + '% sulle stesse,       z=' +
            welch(neo.map(function (r) { return r.mercato; }), vet.map(function (r) { return r.mercato; })).toFixed(2));
console.log('');

/* Il confronto appaiato che conta: sulla STESSA partita, quanto perdo dal
   mercato? Se il buco e' piu' largo sulle neopromosse, mi manca un dato. */
function buco(l) { return media(l.map(function (r) { return r.modello - r.mercato; })); }
var bn = buco(neo), bv = buco(vet);
console.log('quanto sto DIETRO al mercato, sulla stessa partita:');
console.log('  con una neopromossa   ' + (bn >= 0 ? '+' : '') + bn.toFixed(5));
console.log('  fra due squadre note  ' + (bv >= 0 ? '+' : '') + bv.toFixed(5));
var zz = welch(neo.map(function (r) { return r.modello - r.mercato; }),
               vet.map(function (r) { return r.modello - r.mercato; }));
console.log('  differenza fra i due  ' + (bn - bv >= 0 ? '+' : '') + (bn - bv).toFixed(5) + '   z=' + zz.toFixed(2));
console.log('');

/* Dura tutta la stagione o passa? */
console.log('e con quante partite in Serie A gia\' giocate:');
[[0, 3], [4, 9], [10, 19], [20, 99]].forEach(function (f) {
  var l = neo.filter(function (r) { return r.esperienza >= f[0] && r.esperienza <= f[1]; });
  if (l.length < 15) return;
  console.log('  ' + (f[0] + '-' + f[1]).padEnd(8) + 'n=' + String(l.length).padEnd(5) +
              ' modello ' + media(l.map(function (r) { return r.modello; })).toFixed(5) +
              '  dietro al mercato ' + (buco(l) >= 0 ? '+' : '') + buco(l).toFixed(5));
});
console.log('');

if (zz > 1.9) {
  console.log('Sulle neopromosse il modello perde dal mercato piu\' che altrove: il');
  console.log('mercato sa qualcosa che io non ho. E\' il caso in cui vale la pena');
  console.log('andare a prendere l\'archivio di Serie B.');
} else if (a.q - b.q > 0.004) {
  console.log('Le neopromosse sono partite piu\' difficili PER TUTTI: sbaglia di piu\'');
  console.log('anche il mercato, che di dati ne ha piu\' di me. Non e\' ignoranza mia,');
  console.log('e\' che una squadra al primo anno e\' davvero meno prevedibile — e');
  console.log('scaricare la Serie B non riempirebbe un buco che non c\'e\'.');
} else {
  console.log('Nessuna differenza distinguibile dal caso.');
}
