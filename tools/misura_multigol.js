/* Accendendo i multigol, l'app propone Multigol 1-4 dappertutto. E' un bug?

   Prima di rispondere conviene sapere una cosa che rende la domanda legittima:
   quando la regola di selezione e' stata tarata (tools/ottimizza_regola.js) i
   multigol NON ERANO NELL'ELENCO. La manopola della prudenza, con i suoi numeri
   misurati, descrive un mondo senza multigol. Accendendoli, l'app esce dal
   proprio collaudo — e nessuno se ne accorge, perche' continua a mostrare gli
   stessi numeri di prima.

   Il meccanismo e' chiaro guardando il codice: "la piu' solida" ordina per
   PAVIMENTO (il fondo della banda) e prende la prima sotto la soglia di
   prudenza. Multigol 1-4 vuol dire "fra uno e quattro gol": sta al 78-81% in
   ogni partita di ogni giornata, e il suo pavimento e' altissimo perche' e'
   una previsione facile. Sotto la soglia dello 0.82 ci sta, e vince ovunque.

   E' lo STESSO inciampo che il codice dice di aver gia' corretto una volta:
   "Almeno un gol al 93% e' una constatazione, non una giocata". La correzione
   era un tetto sulla probabilita'. Multigol 1-4 passa sotto il tetto.

   Qui si misurano tre cose, in ordine di importanza:

     1. con i multigol accesi la regola e' ancora ONESTA? Prende quanto
        promette? Se si', l'app non e' rotta: e' monotona.
     2. quanto e' monotona: quante selezioni diverse propone in una giornata.
     3. chiedere che la selezione sia DISTINTIVA — cioe' che dica qualcosa di
        questa partita e non la stessa cosa di tutte — migliora o peggiora?

   uso: node tools/misura_multigol.js
*/
var fs = require('fs'), path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
  .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var SENZA_MG = ['1','X','2','O05','O15','U15','O25','U25','O35','U35','O45','U45','DISP','PARI'];
var MG = ['MG13','MG24','MG15','MG12','MG23','MG34','MG14','MG25','MG03'];
var CON_MG = SENZA_MG.concat(MG);
var SOGLIA = 0.82;                    /* la posizione di partenza della manopola */

var per = {};
tutte.forEach(function (p) {
  if (!p.giornata) return;
  (per[p.s + '|' + p.giornata] = per[p.s + '|' + p.giornata] || []).push(p);
});
var chiavi = Object.keys(per).filter(function (k) { return per[k].length >= 8; })
  .sort(function (a, b) { return per[a][0].d < per[b][0].d ? -1 : 1; });

console.log('rigioco le giornate…');
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
    var sim = M.simula(mod, p.c, p.v, { N: 1200, q: p.qex || p.q || null, qou: p.qou || null });
    if (!sim) return;
    var medie = {};
    for (var kk in sim.fasce) medie[kk] = sim.fasce[kk].p;
    var ok = [];
    M.elencoMercati(medie, [p.c, p.v]).forEach(function (m) {
      if (CON_MG.indexOf(m.id) < 0) return;
      var b = sim.fasce[m.campo];
      var p05 = b ? (m.inverso ? 1 - b.p95 : b.p05) : m.p;
      var e = M.haVinto(m.id, p.gc, p.gv, p.ptc, p.ptv);
      if (e === null) return;
      ok.push({ id: m.id, nome: m.nome, campo: m.campo, p: m.p,
                p05: Math.max(0, Math.min(m.p, p05)), quota: 1 / Math.max(1e-6, m.p),
                vinto: e ? 1 : 0 });
    });
    if (ok.length) partite.push(ok);
  });
  if (partite.length < 8) return;
  /* la media di giornata per mercato: e' quella che dice se una selezione sta
     dicendo qualcosa di QUESTA partita o la stessa cosa di tutte */
  var somma = {}, quanti = {};
  partite.forEach(function (ok) {
    ok.forEach(function (m) { somma[m.id] = (somma[m.id] || 0) + m.p; quanti[m.id] = (quanti[m.id] || 0) + 1; });
  });
  partite.forEach(function (ok) {
    ok.forEach(function (m) { m.scarto = m.p - somma[m.id] / quanti[m.id]; });
  });
  giornate.push({ d: d0, partite: partite });
});
console.log(giornate.length + ' giornate\n');
if (giornate.length < 40) { console.log('troppo poche'); process.exit(0); }

/* Le regole a confronto. La prima e' quella dell'app, oggi. */
var REGOLE = {
  'pavimento (come adesso)': function (amm) {
    return amm.slice().sort(function (a, b) { return b.p05 - a.p05; })[0];
  },
  'pavimento, ma distintiva': function (amm) {
    /* Una selezione che dice la stessa cosa in ogni partita della giornata non
       informa su NESSUNA partita. Si chiede che si discosti almeno di tre punti
       dalla media di giornata; se nessuna ci arriva, si torna alla piu' solida
       invece di non proporre niente. */
    var d = amm.filter(function (m) { return Math.abs(m.scarto) >= 0.03; });
    return (d.length ? d : amm).slice().sort(function (a, b) { return b.p05 - a.p05; })[0];
  },
  'la piu notevole': function (amm) {
    return amm.slice().sort(function (a, b) {
      return Math.abs(b.scarto) * b.p05 - Math.abs(a.scarto) * a.p05;
    })[0];
  }
};

function valuta(nome, scegli, elenco) {
  var n = 0, presi = 0, promessi = 0, quote = [], perG = [], distinti = [];
  giornate.forEach(function (g) {
    var sel = [], visti = {};
    g.partite.forEach(function (ok) {
      var amm = ok.filter(function (m) {
        return elenco.indexOf(m.id) >= 0 && m.p >= 0.12 && m.p <= 0.88;
      });
      var pag = amm.filter(function (m) { return m.p <= SOGLIA; });
      var s = scegli(pag.length ? pag : amm);
      if (s) { sel.push(s); visti[s.id] = 1; }
    });
    if (sel.length < 8) return;
    var q = 1, pr = 0;
    sel.forEach(function (m) { n++; presi += m.vinto; promessi += m.p; q *= m.quota; pr += m.vinto; });
    quote.push(q); distinti.push(Object.keys(visti).length);
    perG.push({ presi: pr, ps: sel.map(function (m) { return m.p; }) });
  });
  if (!n) return null;
  var es = Math.sqrt(perG.reduce(function (s, g) {
    return s + g.ps.reduce(function (a, p) { return a + p * (1 - p); }, 0);
  }, 0)) / n;
  quote.sort(function (a, b) { return a - b; });
  var alm8 = perG.filter(function (g) { return g.presi >= 8; }).length / perG.length;
  return { nome: nome, n: n, tasso: presi / n, promesso: promessi / n, es: es,
           quota: quote[Math.floor(quote.length / 2)], alm8: alm8,
           distinti: distinti.reduce(function (a, b) { return a + b; }, 0) / distinti.length };
}

function tabella(titolo, elenco) {
  console.log('=== ' + titolo + ' ===');
  console.log('  ' + 'regola'.padEnd(26) + 'prese  promesse   scarto    quota  8su10  selezioni diverse');
  Object.keys(REGOLE).forEach(function (nome) {
    var r = valuta(nome, REGOLE[nome], elenco);
    if (!r) return;
    var z = (r.tasso - r.promesso) / Math.max(1e-9, r.es);
    console.log('  ' + nome.padEnd(26) +
      (100 * r.tasso).toFixed(1) + '%   ' + (100 * r.promesso).toFixed(1) + '%   ' +
      (z >= 0 ? '+' : '') + z.toFixed(1) + 'σ' +
      r.quota.toFixed(1).padStart(9) + (100 * r.alm8).toFixed(0).padStart(6) + '%' +
      r.distinti.toFixed(1).padStart(10) + ' su 10');
  });
  console.log('');
}

tabella('multigol SPENTI — il mondo in cui la regola e stata tarata', SENZA_MG);
tabella('multigol ACCESI', CON_MG);

var a = valuta('x', REGOLE['pavimento (come adesso)'], CON_MG);
var b = valuta('x', REGOLE['pavimento, ma distintiva'], CON_MG);
console.log('Con i multigol accesi, la regola di adesso propone ' + a.distinti.toFixed(1) +
            ' selezioni diverse su 10 partite.');
console.log('Chiedendo che siano distintive: ' + b.distinti.toFixed(1) + '.');
console.log('');
var za = (a.tasso - a.promesso) / Math.max(1e-9, a.es);
if (Math.abs(za) < 2) {
  console.log('La regola di adesso resta ONESTA anche coi multigol: prende ' +
              (100 * a.tasso).toFixed(1) + '% contro ' + (100 * a.promesso).toFixed(1) +
              '% promesso (' + za.toFixed(1) + 'σ). Quindi non e rotta.');
} else {
  console.log('Coi multigol accesi la regola NON mantiene piu: ' + (100 * a.tasso).toFixed(1) +
              '% contro ' + (100 * a.promesso).toFixed(1) + '% promesso, ' + za.toFixed(1) + 'σ.');
}
console.log('Il problema e un altro: dice la stessa cosa in ogni partita, e una');
console.log('previsione che non cambia da partita a partita non informa su nessuna.');
