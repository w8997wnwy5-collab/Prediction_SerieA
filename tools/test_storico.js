/* Lo storico della Consigliata: le regole con cui si sceglie QUANDO e COSA
   rigiocare, e come si conta. Il rigioco vero (il browser) non gira qui: gira
   nel giro dei dati. Qui si controlla tutto quello che gli sta intorno.

     node tools/test_storico.js
*/
'use strict';
var fs = require('fs');
var path = require('path');
var R = path.join(__dirname, '..');
var S = require(path.join(R, 'scripts', 'storico_consigliata.js'));
var esiti = [];
function prova(nome, ok, dettaglio) { esiti.push([nome, !!ok, dettaglio == null ? '' : String(dettaglio)]); }

/* l'ora di Roma, con l'ora legale che finisce l'ultima domenica di ottobre */
prova('le 9 di venerdi 23 ottobre 2026 sono le 7 UTC (ora legale)',
      new Date(S.alleNove('2026-10-23')).toISOString() === '2026-10-23T07:00:00.000Z');
prova('le 9 di martedi 27 ottobre 2026 sono le 8 UTC (ora solare)',
      new Date(S.alleNove('2026-10-27')).toISOString() === '2026-10-27T08:00:00.000Z');
prova('e a fine marzo si torna all\'ora legale',
      new Date(S.alleNove('2027-03-29')).toISOString() === '2027-03-29T07:00:00.000Z');

/* si gioca il venerdi' se la giornata comincia nel fine settimana */
prova('una giornata che comincia sabato si gioca venerdi', S.quandoSiGioca('2026-10-31') === '2026-10-30');
prova('una che comincia domenica, venerdi', S.quandoSiGioca('2026-11-01') === '2026-10-30');
prova('una che comincia venerdi o martedi, quel giorno',
      S.quandoSiGioca('2026-10-23') === '2026-10-23' && S.quandoSiGioca('2026-10-27') === '2026-10-27');

/* le giornate come le raggruppa l'app */
var finte = [];
for (var i = 0; i < 10; i++) finte.push({ d: '2026-10-' + (24 + (i > 4 ? 1 : 0)), o: '15:00', c: 'a' + i, v: 'b' + i });
for (i = 0; i < 3; i++) finte.push({ d: '2026-10-27', o: '20:45', c: 'c' + i, v: 'd' + i });
var gr = S.raggruppa(finte);
prova('dieci partite fanno una giornata, anche se la successiva e\' a due giorni',
      gr.length === 2 && gr[0].partite.length === 10 && gr[1].partite.length === 3,
      gr.map(function (g) { return g.partite.length; }).join('+'));

/* sui dati veri: la giornata del 31 ottobre e' pronta, e il calendario non ha risultati */
var indice = JSON.parse(fs.readFileSync(path.join(R, 'data', 'leghe.json'), 'utf8'));
var docs = {};
indice.leghe.forEach(function (l) { docs[l.id] = JSON.parse(fs.readFileSync(path.join(R, 'data', l.file), 'utf8')); });
var serie = docs.I1.partite.filter(function (p) { return p.s === '2026-27' && p.gc != null; })
  .sort(function (a, b) { return (a.d + (a.o || '')) < (b.d + (b.o || '')) ? -1 : 1; });
var giornate = S.raggruppa(serie).filter(function (g) { return g.partite.length >= 8; });
var ott31 = giornate.filter(function (g) { return g.inizio === '2026-10-31'; })[0];
if (ott31) {
  var g = S.preparaGiornata(ott31, indice.leghe, docs, '2026-11-04');
  var cal = g.calendari.I1 || [];
  prova('la giornata del 31 ottobre si rigioca venerdi 30 alle 9', g.giorno === '2026-10-30' && g.pronta, g.motivo);
  prova('il calendario di Serie A ha le dieci partite, senza risultato',
        cal.length === 10 && cal.every(function (p) { return p.gc == null && p.q && p.qou; }), cal.length);
  prova('e le quote sono quelle del venerdi\', non di chiusura',
        cal.every(function (p) {
          var vera = docs.I1.partite.filter(function (x) { return x.d === p.d && x.c === p.c && x.v === p.v; })[0];
          return vera && p.q === vera.qap && p.qou === vera.qapou;
        }));
  var nessuna = Object.keys(g.calendari).every(function (id) {
    return g.calendari[id].every(function (p) { return Date.parse(p.d + 'T23:59:59Z') > g.adesso; });
  });
  prova('nessuna partita del calendario e\' gia\' cominciata alle 9', nessuna);
  /* una giornata a cui manca ancora una partita (qui: l'ultima di Ligue 1,
     tolta apposta) aspetta, finche' il campionato non va oltre o passano
     cinque giorni */
  var meno = {};
  Object.keys(docs).forEach(function (id) { meno[id] = docs[id]; });
  var f1 = docs.F1.partite.slice().sort(function (a, b) { return (a.d + (a.o || '')) < (b.d + (b.o || '')) ? -1 : 1; });
  meno.F1 = Object.assign({}, docs.F1, { partite: f1.slice(0, -1) });
  var presto = S.preparaGiornata(ott31, indice.leghe, meno, f1[f1.length - 1].d);
  prova('una giornata a cui manca ancora una partita aspetta', presto.pronta === false, presto.motivo);
  var tardi = S.preparaGiornata(ott31, indice.leghe, meno, '2026-11-20');
  prova('ma dopo cinque giorni si rigioca con quelle che ci sono', tardi.pronta === true, tardi.motivo);
} else {
  prova('c\'e\' la giornata del 31 ottobre nei dati', false);
}

/* il conto: una gamba presa e una no fanno una schedina persa */
var finta = { inizio: '2026-10-31', giorno: '2026-10-30',
              veri: { 'I1|2026-10-31|A|B': { gc: 2, gv: 1, ptc: 1, ptv: 0 }, 'I1|2026-11-01|C|D': { gc: 0, gv: 0, ptc: 0, ptv: 0 } } };
var r = { solide: [{ lega: 'I1', d: '2026-10-31', c: 'A', v: 'B', id: 'O15', p: 0.8 }],
          dieci: [{ lega: 'I1', d: '2026-10-31', c: 'A', v: 'B', id: 'O15', p: 0.8, quota: 1.18 },
                  { lega: 'I1', d: '2026-11-01', c: 'C', v: 'D', id: 'O15', p: 0.7, quota: 1.35 }],
          livelli: [{ id: 'facile', nome: 'Facile', quota: 1.6, p: 0.56,
                      gambe: [{ lega: 'I1', d: '2026-10-31', c: 'A', v: 'B', id: '1', p: 0.8, quota: 1.18 },
                              { lega: 'I1', d: '2026-11-01', c: 'C', v: 'D', id: 'U25', p: 0.7, quota: 1.35 }] },
                    { id: 'media', nome: 'Media', quota: 3, p: 0.3,
                      gambe: [{ lega: 'I1', d: '2026-10-31', c: 'A', v: 'B', id: '2', p: 0.3, quota: 3 }] }],
          sicure: [{ n: 7, gambe: [{ lega: 'I1', d: '2026-10-31', c: 'A', v: 'B', id: 'O05', p: 0.9, quota: 1.05 }] }] };
var x = S.conta(finta, r);
prova('una schedina con tutte le gambe prese e\' presa', x.livelli[0].vinta === true);
prova('una con una gamba persa e\' persa', x.livelli[1].vinta === false);
prova('le 10 contano quante ne entrano', x.dieci.prese === 1 && x.dieci.n === 2 && Math.abs(x.dieci.attese - 1.5) < 1e-9);
prova('e le singole: promesse e prese', x.solide.n === 1 && x.solide.prese === 1 && Math.abs(x.solide.promesse - 0.8) < 1e-9);

/* il file pubblicato e l'app */
var file = path.join(R, 'data', 'storico-consigliata.json');
if (fs.existsSync(file)) {
  var st = JSON.parse(fs.readFileSync(file, 'utf8'));
  prova('lo storico pubblicato ha le giornate, dalla piu\' recente', st.giornate.length > 0 &&
        st.giornate.every(function (y, k) { return k === 0 || y.inizio < st.giornate[k - 1].inizio; }));
  prova('e racconta solo partite gia\' giocate', st.giornate.every(function (y) {
    return y.livelli.every(function (l) { return l.gambe.every(function (q) { return q.ris != null; }); });
  }));
}
var html = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
prova('la Consigliata mostra lo storico', /h \+= cardStorico\(\);/.test(html) && /function cardStorico\(\)/.test(html));
prova('e lo legge dal file del giro dei dati', /data\/storico-consigliata\.json/.test(html));

var falliti = 0;
esiti.forEach(function (e) {
  if (!e[1]) falliti++;
  console.log((e[1] ? 'ok   ' : 'NO   ') + ' ' + e[0].padEnd(86) + (e[1] ? '' : '  ' + e[2]));
});
console.log('\n' + esiti.length + ' prove, ' + falliti + ' fallite');
process.exitCode = falliti ? 1 : 0;
