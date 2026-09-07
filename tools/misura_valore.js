/* Quando il modello dissente dal mercato, chi ha ragione?

   È la domanda che decide se una regola di selezione può guadagnare o solo
   scegliere fra profili di rischio. Tutte le altre — quanto sono calibrato,
   quante ne prendo — possono avere ottime risposte e lasciare il conto in
   rosso, perché il banco si prende il 5% e quella è la soglia da superare.

   Qui si misura sul serio, con le quote VERE di chiusura (non le eque): per
   ogni partita si guarda quanto il modello si discosta dal mercato, si
   raggruppa per entità del disaccordo, e si vede quanto avrebbe reso
   scommetterci sopra.

   Si prova due volte, e il confronto fra le due è il punto:

     · il modello PURO, che ha un'opinione propria. Se un vantaggio esiste,
       sta qui — un modello ancorato al mercato non può batterlo, si appoggia
       a lui.

     · il modello ANCORATO, quello che l'app usa davvero.

   uso: node tools/misura_valore.js
*/
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'serie-a.json'), 'utf8'));
var dati = M.prepara(doc.partite);
var st = (doc.stagioni || []).slice().sort();
if (st.length < 4) { console.log('Servono almeno 4 stagioni.'); process.exit(0); }
var da = (parseInt(st[st.length - 4].slice(0, 4), 10)) + '-08-01';
console.log('rigioco dal ' + da + '…');
var camp = M.campionaBacktest(dati, { da: da, refitOgniGiorni: 3, iterazioni: 110 })
  .campioni.filter(function (c) { return c.q && c.qou; });
console.log(camp.length + ' partite con le quote vere di chiusura\n');

function giocate(ancorato) {
  var out = [];
  camp.forEach(function (c) {
    var lam = c.lamG, mu = c.muG;
    if (c.lamT != null) { lam = 0.65 * c.lamG + 0.35 * c.lamT; mu = 0.65 * c.muG + 0.35 * c.muT; }
    if (ancorato) {
      var a = M.ancoraMercato(lam, mu, c.rho, { q: c.q, qou: c.qou, peso1x2: 0.95, pesoOU: 0.95 });
      if (a && a.usato) { lam = a.lam; mu = a.mu; }
    }
    var mk = M.mercatiDaMatrice(M.matriceRisultati(lam, mu, c.rho, 11));
    [{ p: mk.casa, q: c.q[0], v: c.esito === 0 },
     { p: mk.pari, q: c.q[1], v: c.esito === 1 },
     { p: mk.via, q: c.q[2], v: c.esito === 2 },
     { p: mk.o25, q: c.qou[0], v: (c.x + c.y) > 2.5 },
     { p: 1 - mk.o25, q: c.qou[1], v: (c.x + c.y) < 2.5 }].forEach(function (o) {
      if (!(o.q > 1) || o.p == null) return;
      out.push({ p: o.p, q: o.q, edge: o.p * o.q - 1, vinto: o.v ? 1 : 0 });
    });
  });
  return out;
}

function riga(t, l) {
  if (l.length < 40) { console.log('  ' + t.padEnd(20) + ' troppo poche (' + l.length + ')'); return; }
  var n = l.length;
  var vals = l.map(function (x) { return (x.vinto ? x.q : 0) - 1; });
  var m = vals.reduce(function (a, b) { return a + b; }, 0) / n;
  var sd = Math.sqrt(vals.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (n - 1));
  var es = sd / Math.sqrt(n);
  var presi = l.reduce(function (s, x) { return s + x.vinto; }, 0);
  var att = l.reduce(function (s, x) { return s + x.p; }, 0);
  console.log('  ' + t.padEnd(20) + String(n).padStart(6) +
    '   resa ' + (m >= 0 ? '+' : '') + (100 * m).toFixed(1).padStart(6) + '%' +
    '  z=' + (m / es >= 0 ? '+' : '') + (m / es).toFixed(2).padStart(5) +
    '   prese ' + (100 * presi / n).toFixed(1) + '% contro ' + (100 * att / n).toFixed(1) + '% promesse');
}

var FASCE = [[-9, -0.10, 'sotto -10%'], [-0.10, 0, 'da -10% a 0'], [0, 0.05, 'da 0 a +5%'],
             [0.05, 0.10, 'da +5% a +10%'], [0.10, 0.20, 'da +10% a +20%'], [0.20, 9, 'sopra +20%']];

[[false, 'MODELLO PURO — con un\'opinione propria sul mercato'],
 [true, 'MODELLO ANCORATO — quello che l\'app usa']].forEach(function (caso) {
  var l = giocate(caso[0]);
  console.log('=== ' + caso[1] + ' ===');
  riga('tutte', l);
  console.log('  per vantaggio che il modello si attribuisce:');
  FASCE.forEach(function (f) {
    riga('  ' + f[2], l.filter(function (x) { return x.edge >= f[0] && x.edge < f[1]; }));
  });
  console.log('');
});

console.log('=== COSA SE NE RICAVA ===');
console.log('Nel modello puro la resa PEGGIORA man mano che il vantaggio dichiarato cresce.');
console.log('Non e sfortuna, e la maledizione del vincitore: dove il modello dissente di piu');
console.log('dal mercato non e perche ha visto qualcosa, e perche li sta sbagliando di piu.');
console.log('Un filtro "gioca dove hai vantaggio" pesca esattamente i suoi errori peggiori.');
console.log('');
console.log('Ancorandolo al mercato il dissenso sparisce quasi del tutto e le probabilita');
console.log('diventano oneste — ma con lui sparisce anche ogni vantaggio. E il prezzo, ed e');
console.log('giusto pagarlo: meglio numeri veri senza vantaggio che numeri gonfi con un');
console.log('vantaggio che non c e.');
console.log('');
console.log('Conclusione operativa: con questi dati non si batte il mercato. La regola di');
console.log('selezione non sceglie quanto si guadagna — sceglie il profilo. Vedi');
console.log('tools/ottimizza_regola.js.');
