/* La Champions si puo' prevedere? E come?

   Il modello di quest'app stima attacco e difesa dal campionato di ogni
   squadra, dove tutte incontrano tutte. In Champions non si puo': trentasei
   squadre di sedici paesi che si incontrano otto volte in tutto.

   E c'e' un guaio piu' grosso, che e' il punto di questo file: un attacco di
   0.5 in Eredivisie NON vale un attacco di 0.5 in Premier, perche' sono
   misurati contro difese diverse. Confrontarli e' come sommare Celsius e
   Fahrenheit — e il bello e' che il conto viene lo stesso, dà numeri
   plausibili, e sono sbagliati.

   La soluzione non e' un fattore di conversione scritto a mano: e' mettere
   campionati e coppe nella STESSA stima. Le partite europee sono le uniche in
   cui leghe diverse si incontrano, e fanno da ponte.

   Qui si misura se serve davvero, confrontando tre cose sulle stesse partite:
   il modello coi ponti, il modello senza (cioe' solo campionati, che e' la
   cosa che verrebbe naturale), e chi tira a indovinare con le frequenze
   storiche della Champions.

   uso: node tools/misura_champions.js
*/
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var FILE = path.join(__dirname, '..', 'data', 'europa.json');
if (!fs.existsSync(FILE)) {
  console.log('Manca data/europa.json: lo scrive scripts/build_europa.py.');
  process.exit(0);
}
var doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
var nomi = doc.nomi || {};

var tutte = [], coppe = [];
(doc.partite || []).forEach(function (p) {
  tutte.push({ d: p.d, c: p.c, v: p.v, gc: p.gc, gv: p.gv, dove: p.p });
});
var conCampionato = {};
(doc.partite || []).forEach(function (p) { conCampionato[p.c] = 1; conCampionato[p.v] = 1; });
(doc.coppe || []).forEach(function (p) {
  if (p.gc == null || !p.d) return;
  var m = { d: p.d, c: nomi[p.c] || p.c, v: nomi[p.v] || p.v, gc: p.gc, gv: p.gv, dove: 'CL' };
  m.noto = !!conCampionato[m.c] && !!conCampionato[m.v];
  tutte.push(m);
  coppe.push(m);
});
tutte.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
console.log(tutte.length + ' partite in tutto, ' + coppe.length + ' di coppa, ' +
  coppe.filter(function (x) { return x.noto; }).length + ' fra squadre di cui so il campionato\n');

function rpsTre(pr, e) {
  var c = 0, s = 0;
  for (var i = 0; i < 2; i++) { c += pr[i]; var x = (e <= i) ? 1 : 0; s += (c - x) * (c - x); }
  return s / 2;
}
function frequenze(prima) {
  var c = 0, p = 0, v = 0;
  prima.forEach(function (m) { if (m.gc > m.gv) c++; else if (m.gc === m.gv) p++; else v++; });
  var n = Math.max(1, c + p + v);
  return [c / n, p / n, v / n];
}
function media(l) { return l.reduce(function (a, b) { return a + b; }, 0) / l.length; }

/* Si valuta l'ultima stagione disponibile, con il modello allenato solo su
   quello che si sapeva prima di ogni partita. */
var stagioni = {};
coppe.forEach(function (m) { stagioni[m.d.slice(0, 4)] = 1; });
var anni = Object.keys(stagioni).sort();
var da = anni[Math.max(0, anni.length - 2)] + '-08-01';
var bersaglio = coppe.filter(function (m) { return m.d >= da && m.noto; });
console.log('valuto ' + bersaglio.length + ' partite di Champions dal ' + da + '\n');
if (bersaglio.length < 40) { console.log('Troppo poche per dire qualcosa.'); process.exit(0); }

var mod = null, modSenza = null, ultimo = null;
var res = { ponti: [], senza: [], caso: [] };
var t0 = Date.now();
bersaglio.forEach(function (m) {
  if (!ultimo || M.giorni(ultimo, m.d) > 10) {
    var prima = tutte.filter(function (x) { return x.d < m.d; });
    if (prima.length < 2000) return;
    mod = M.costruisci(prima, { fino: m.d, primoTempo: false, iterazioni: 130 });
    modSenza = M.costruisci(prima.filter(function (x) { return x.dove !== 'CL'; }),
                            { fino: m.d, primoTempo: false, iterazioni: 130 });
    ultimo = m.d;
  }
  if (!mod || mod.indice[m.c] == null || mod.indice[m.v] == null) return;
  var sim = M.simula(mod, m.c, m.v, { N: 900 });
  if (!sim) return;
  var e = m.gc > m.gv ? 0 : (m.gc === m.gv ? 1 : 2);
  res.ponti.push(rpsTre([sim.fasce.casa.p, sim.fasce.pari.p, sim.fasce.via.p], e));
  var fr = frequenze(coppe.filter(function (x) { return x.d < m.d; }));
  res.caso.push(rpsTre(fr, e));
  var s2 = (modSenza.indice[m.c] != null && modSenza.indice[m.v] != null)
    ? M.simula(modSenza, m.c, m.v, { N: 900 }) : null;
  res.senza.push(s2 ? rpsTre([s2.fasce.casa.p, s2.fasce.pari.p, s2.fasce.via.p], e)
                    : rpsTre(fr, e));
});

console.log('valutate ' + res.ponti.length + ' partite in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's\n');
console.log('  con i ponti (coppe dentro la stima)   errore ' + media(res.ponti).toFixed(5));
console.log('  chi tira a indovinare                 errore ' + media(res.caso).toFixed(5));
console.log('  senza i ponti (solo campionati)       errore ' + media(res.senza).toFixed(5));

function confronta(t, a, b) {
  var d = a.map(function (x, i) { return x - b[i]; });
  var m = media(d);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (d.length - 1));
  var z = m / (sd / Math.sqrt(d.length));
  console.log('\n  ' + t + ': ' + (100 * m / media(a)).toFixed(1) + '%  z=' + z.toFixed(2));
  return z;
}
var zPonti = confronta('i ponti valgono', res.senza, res.ponti);
var zCaso = confronta('e il modello batte il caso di', res.caso, res.ponti);

console.log('');
console.log(zPonti > 1.9
  ? 'I ponti servono: le partite di coppa non sono un dato in piu, sono cio che rende\n' +
    'confrontabili forze misurate in campionati diversi. Senza, si confronta un attacco\n' +
    'di Eredivisie con uno di Premier come se fossero la stessa unita.'
  : 'I ponti non si distinguono dal rumore: i soli campionati basterebbero.');
console.log(zCaso > 1.9
  ? 'E il modello batte chi tira a indovinare, che e la soglia minima per esistere.'
  : 'Ma il modello NON batte chi tira a indovinare in modo distinguibile dal caso:\n' +
    'su queste partite non c\'e abbastanza segnale per fidarsi.');
console.log('\nDue cautele, che valgono comunque. Le partite sono poche — un backtest di\n' +
  'Serie A ne ha ottocento, qui ' + res.ponti.length + ' — e soprattutto NON ci sono le quote:\n' +
  'manca l\'ancoraggio al mercato, che in Serie A vale meta del lavoro.');
