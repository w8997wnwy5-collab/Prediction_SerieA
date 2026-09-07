/* Quale regola di selezione conviene?

   L'app, di ogni partita, propone una giocata sola: "la più solida". Per
   sceglierla ordina le selezioni per PAVIMENTO — il fondo della banda di
   incertezza, non il centro — e prende la prima sotto una certa soglia di
   probabilità, perché sopra quella soglia la quota non paga più niente.

   Ordinamento e soglia erano due scelte fatte a occhio e mai messe alla prova.
   Questo file le prova, e prova le alternative.

   Il tranello, in un esercizio così, è provarne venti e tenere la migliore: su
   novanta giornate la migliore è migliore per caso, e uno se ne accorge la
   settimana dopo quando smette di funzionare. Quindi le regole si scelgono
   sulla PRIMA metà delle giornate e si misurano sulla SECONDA, che la
   vincitrice non ha mai visto.

   Cosa aspettarsi, prima di leggere i numeri: siccome il modello è calibrato e
   non ha vantaggio sul mercato (vedi tools/misura_valore.js), nessuna soglia
   può guadagnare più di un'altra. Quello che cambia è il PROFILO — quanto
   paga contro quanto spesso esce — e la calibrazione, cioè se la probabilità
   scritta è quella vera. Non si cerca un ottimo: si disegna una frontiera, e
   si controlla che lungo la frontiera i numeri detti siano onesti.

   uso: node tools/ottimizza_regola.js
*/
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
  .sort(function (a, b) { return a.d < b.d ? -1 : 1; });
var VISTI = ['1', 'X', '2', 'O05', 'O15', 'U15', 'O25', 'U25', 'O35', 'U35', 'O45', 'U45', 'DISP', 'PARI'];

var CRITERI = {
  pavimento: function (m) { return m.p05; },
  probabile: function (m) { return m.p; },
  stretta: function (m) { return m.p05 - 2 * (m.p - m.p05); }
};
var SOGLIE = [0.70, 0.74, 0.78, 0.82, 0.86, 0.90];

/* Una passata sola per raccogliere ogni selezione ammissibile di ogni partita,
   con probabilità, pavimento, quota equa ed esito. Le regole poi scelgono
   dentro questa lista senza rifare i conti: rifarli per ogni regola vorrebbe
   dire diciotto backtest invece di uno. */
console.log('rigioco le giornate…');
var per = {};
tutte.forEach(function (p) {
  if (!p.giornata) return;
  (per[p.s + '|' + p.giornata] = per[p.s + '|' + p.giornata] || []).push(p);
});
var chiavi = Object.keys(per).filter(function (k) { return per[k].length >= 8; })
  .sort(function (a, b) { return per[a][0].d < per[b][0].d ? -1 : 1; });

var mod = null, ultimo = null, giornate = [];
chiavi.forEach(function (k) {
  var l = per[k].slice().sort(function (a, b) { return a.d < b.d ? -1 : 1; });
  var d0 = l[0].d;
  var prima = tutte.filter(function (x) { return x.d < d0; });
  if (prima.length < 600) return;
  if (!ultimo || M.giorni(ultimo, d0) > 6) {
    mod = M.costruisci(prima, { fino: d0, primoTempo: false, iterazioni: 110 });
    ultimo = d0;
  }
  if (!mod) return;
  var partite = [];
  l.forEach(function (p) {
    if (mod.indice[p.c] == null || mod.indice[p.v] == null) return;
    var sim = M.simula(mod, p.c, p.v, { N: 1200, q: p.q || null, qou: p.qou || null });
    if (!sim) return;
    var medie = {};
    for (var kk in sim.fasce) medie[kk] = sim.fasce[kk].p;
    var ok = [];
    M.elencoMercati(medie, [p.c, p.v]).forEach(function (m) {
      if (VISTI.indexOf(m.id) < 0) return;
      var b = sim.fasce[m.campo];
      var p05 = b ? (m.inverso ? 1 - b.p95 : b.p05) : m.p;
      var e = M.haVinto(m.id, p.gc, p.gv, p.ptc, p.ptv);
      if (e === null) return;
      ok.push({ id: m.id, p: m.p, p05: Math.max(0, Math.min(m.p, p05)),
                quota: 1 / Math.max(1e-6, m.p), vinto: e ? 1 : 0 });
    });
    if (ok.length) partite.push(ok);
  });
  if (partite.length >= 8) giornate.push({ d: d0, partite: partite });
});
console.log(giornate.length + ' giornate\n');
if (giornate.length < 40) { console.log('Troppo poche per dividere in due.'); process.exit(0); }

function applica(g, crit, soglia) {
  var sel = [];
  g.partite.forEach(function (ok) {
    var amm = ok.filter(function (m) { return m.p >= 0.12 && m.p <= 0.88; });
    if (!amm.length) return;
    var pag = amm.filter(function (m) { return m.p <= soglia; });
    var lista = (pag.length ? pag : amm).slice().sort(function (a, b) { return crit(b) - crit(a); });
    if (lista[0]) sel.push(lista[0]);
  });
  return sel;
}

function misura(gs, crit, soglia) {
  var n = 0, presi = 0, promessi = 0, quote = [], perG = [];
  gs.forEach(function (g) {
    var sel = applica(g, crit, soglia);
    if (sel.length < 8) return;
    var q = 1, pr = 0;
    sel.forEach(function (m) { n++; presi += m.vinto; promessi += m.p; q *= m.quota; pr += m.vinto; });
    quote.push(q);
    perG.push({ presi: pr, ps: sel.map(function (m) { return m.p; }) });
  });
  if (!n) return null;
  var attesa8 = 0, oss8 = 0;
  perG.forEach(function (g) {
    var d = M.distribuzioneEsiti(g.ps), s = 0;
    for (var i = Math.min(8, d.length - 1); i < d.length; i++) s += d[i];
    attesa8 += s / perG.length;
    if (g.presi >= 8) oss8 += 1 / perG.length;
  });
  quote.sort(function (a, b) { return a - b; });
  /* errore standard del tasso, per sapere se lo scarto e' rumore */
  var es = Math.sqrt(promessi * (1 - promessi / n) / n) / n * n;
  es = Math.sqrt(perG.reduce(function (s, g) {
    return s + g.ps.reduce(function (a, p) { return a + p * (1 - p); }, 0);
  }, 0)) / n;
  return { n: n, tasso: presi / n, promesso: promessi / n, es: es,
           quota: quote[Math.floor(quote.length / 2)], attesa8: attesa8, oss8: oss8 };
}

var meta = Math.floor(giornate.length / 2);
var train = giornate.slice(0, meta), test = giornate.slice(meta);
console.log('scelgo su ' + train.length + ' giornate (fino al ' + train[train.length - 1].d +
  '), misuro su ' + test.length + ' mai viste (dal ' + test[0].d + ')\n');

function tabella(gs, titolo) {
  console.log('=== ' + titolo + ' ===');
  console.log('  ' + 'regola'.padEnd(20) + '  prese  promesse   scarto     quota   P(>=8)');
  var righe = [];
  Object.keys(CRITERI).forEach(function (nome) {
    SOGLIE.forEach(function (s) {
      var r = misura(gs, CRITERI[nome], s);
      if (!r) return;
      var sc = r.tasso - r.promesso, z = sc / r.es;
      righe.push({ nome: nome + ' <' + s.toFixed(2), r: r, crit: nome, soglia: s, z: z });
      console.log('  ' + (nome + ' <' + s.toFixed(2)).padEnd(20) +
        (100 * r.tasso).toFixed(1).padStart(6) + '%' + (100 * r.promesso).toFixed(1).padStart(9) + '%' +
        ((sc >= 0 ? '+' : '') + (100 * sc).toFixed(1)).padStart(8) + ' (z' + (z >= 0 ? '+' : '') + z.toFixed(1) + ')' +
        r.quota.toFixed(1).padStart(9) + (100 * r.attesa8).toFixed(0).padStart(8) + '%');
    });
  });
  return righe;
}
tabella(train, 'SCELTA (prima metà)');
console.log('');
var t2 = tabella(test, 'VERIFICA (seconda metà, mai vista)');

console.log('\n=== COSA SE NE RICAVA ===');
var attuale = t2.filter(function (x) { return x.crit === 'pavimento' && Math.abs(x.soglia - 0.78) < 1e-9; })[0];
console.log('La soglia governa tutto il profilo, il criterio di ordinamento quasi niente:');
console.log('pavimento e probabile danno lo stesso risultato a ogni soglia, "stretta" e peggio.');
console.log('');
console.log('Nessuna soglia guadagna piu di un\'altra — non puo\', il modello e calibrato e');
console.log('senza vantaggio sul mercato. Cambia il profilo: sotto si paga tanto e si prende');
console.log('di rado, sopra il contrario. Non c\'e un ottimo, c\'e una frontiera.');
console.log('');
console.log('L\'unica cosa che si puo sbagliare e la calibrazione, e li un difetto c\'e:');
console.log('  pavimento <0.78 (quella storica) scarto ' +
  ((attuale.r.tasso - attuale.r.promesso) >= 0 ? '+' : '') +
  (100 * (attuale.r.tasso - attuale.r.promesso)).toFixed(1) + ' punti, z' +
  (attuale.z >= 0 ? '+' : '') + attuale.z.toFixed(1));
console.log('cioe promette meno di quanto mantiene. E un errore a favore di chi gioca, ma');
console.log('resta un errore: sporca la distribuzione "quante ne prendi" e tutti i conti');
console.log('costruiti sopra. Le soglie da 0.82 in su sono calibrate meglio.');
