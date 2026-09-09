/* Quale struttura massimizza la probabilita' di chiudere il mese in attivo?

   Non e' la stessa domanda di "quale rende di piu'", e la differenza non e' un
   dettaglio: le due risposte sono OPPOSTE, e si puo' dimostrare in tre righe.

   Il valore atteso di un mese, a budget fisso B, con selezioni al 75% e un
   banco che ricarica m per gamba, dipende SOLO dal numero di gambe L:

       atteso = B / (1+m)^L

   Non da quante schedine fai, non da come le spezzi. Solo da L. Quindi se
   l'obiettivo fosse guadagnare, la risposta e' L=1, singole, e basta.

   Ma la domanda e' un'altra: quante volte su cento il mese chiude sopra zero?
   E li' entra un fatto che quasi nessuno si aspetta. Quando il gioco e'
   SFAVOREVOLE — e lo e' sempre, e' il ricarico — la varianza smette di essere
   un nemico e diventa l'unica alleata. Con tante giocate piccole la legge dei
   grandi numeri fa il suo lavoro e ti porta esattamente dove dice il valore
   atteso, cioe' sotto. Con poche giocate lunghe il risultato e' incerto — e
   l'incertezza e' l'unica cosa che puo' metterti sopra.

   E' il teorema del gioco d'azzardo (Dubins-Savage, 1965): in un gioco
   sfavorevole, per raggiungere un obiettivo conviene il "bold play", puntare
   grosso e poche volte. Nessuna app di scommesse lo dice, perche' suona come
   un consiglio irresponsabile — e invece e' semplicemente la risposta giusta
   alla domanda "voglio chiudere il mese in attivo", che e' una domanda
   diversa da "voglio guadagnare".

   Il conto qui e' ESATTO, non simulato. Con m schedine identiche da L gambe:

     ogni schedina esce con probabilita'  p^L
     paga                                 s * (1/p^L) / (1+ricarico)^L
     le vincenti sono                     Binomiale(m, p^L)
     il mese chiude in attivo se          vincenti >= B / (s * quota)

   uso: node tools/ottimizza_mese.js [ricarico] [probabilita per gamba]
*/
var ric = parseFloat(process.argv[2]);
var p = parseFloat(process.argv[3]);
if (!(ric >= 0)) ric = 0.056;          /* bet365, misurato su 1930 partite */
if (!(p > 0 && p < 1)) p = 0.75;       /* una selezione "solida" tipica */

var B = 80;                            /* budget del mese: 20 chf a giornata */
var GIORNATE = 4;

function logC(n, k) {                  /* log del binomiale, per non esplodere */
  var s = 0, i;
  for (i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
  return s;
}
/* P(Binomiale(n,q) >= k), sommata dalla coda per non perdere cifre */
function codaBinom(n, q, k) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  var t = 0;
  for (var i = k; i <= n; i++) {
    t += Math.exp(logC(n, i) + i * Math.log(q) + (n - i) * Math.log(1 - q));
  }
  return Math.min(1, t);
}

console.log('budget del mese: ' + B + ' chf su ' + GIORNATE + ' giornate');
console.log('ricarico del banco: ' + (100 * ric).toFixed(1) + '%   ' +
            'probabilita per gamba: ' + (100 * p).toFixed(0) + '%\n');

/* ── il punto, che nella tabella grezza si perde ──────────────────────────
   L'atteso dipende SOLO dalle gambe: B/(1+ricarico)^L. Non dipende da quante
   schedine fai. Quindi, a parita' di gambe, spostare il numero di schedine
   cambia la probabilita' di chiudere in attivo SENZA COSTARE NIENTE in valore
   atteso. E' l'unica cosa gratis di tutta questa app.

   Perche' cambia, e perche' cambia a scatti: per stare sopra ti serve un
   NUMERO INTERO di schedine vincenti. Con quattro schedine da tre gambe a
   quota 2.01 ne bastano due (2 x 20 x 2.01 = 80.4 > 80): sei sopra per
   quaranta centesimi. Con due schedine ne basta una. La soglia intera e' tutto,
   e nessuno la guarda perche' si guarda sempre l'atteso, che invece e' piatto. */

function riga(L, m) {
  var pL = Math.pow(p, L);
  var quota = (1 / pL) / Math.pow(1 + ric, L);
  var s = B / m;
  var k = Math.floor(B / (s * quota)) + 1;
  if (k * s * quota <= B + 1e-9) k++;
  return { L: L, m: m, quota: quota, s: s, k: k,
           P: codaBinom(m, pL, k), atteso: B / Math.pow(1 + ric, L),
           seVaBene: k * s * quota };
}

console.log('A PARITA DI GAMBE, QUANTE SCHEDINE CONVIENE FARE');
console.log('(l\'atteso non cambia: dipende solo dalle gambe. La probabilita si.)\n');
console.log('gambe   atteso   giocando ogni giornata (>=4)      il meglio in assoluto');
console.log('────────────────────────────────────────────────────────────────────────');
for (var L = 1; L <= 6; L++) {
  var tutte = [], m;
  for (m = 1; m <= 16; m++) tutte.push(riga(L, m));
  var ogniG = tutte.filter(function (r) { return r.m >= GIORNATE; })
                   .reduce(function (a, b) { return b.P > a.P ? b : a; });
  var assoluto = tutte.reduce(function (a, b) { return b.P > a.P ? b : a; });
  var quattro = tutte.filter(function (r) { return r.m === GIORNATE; })[0];
  console.log('  ' + String(L).padStart(2) + '    ' + ogniG.atteso.toFixed(1).padStart(5) +
              '     ' + String(ogniG.m).padStart(2) + ' schedine da ' +
              ogniG.s.toFixed(2).padStart(5) + ' → ' + (100 * ogniG.P).toFixed(1).padStart(5) + '%' +
              '      ' + String(assoluto.m).padStart(2) + ' → ' +
              (100 * assoluto.P).toFixed(1).padStart(5) + '%' +
              (ogniG.m !== quattro.m
                ? '   (una a giornata: ' + (100 * quattro.P).toFixed(1) + '%)'
                : ''));
}
console.log('');
var tue = riga(3, 4), meglio = riga(3, 2);
console.log('Concreto, sul tuo caso. Tre gambe, quattro schedine da 20: chiudi in attivo');
console.log('il ' + (100 * tue.P).toFixed(1) + '% dei mesi, e te ne servono ' + tue.k + ' su ' + tue.m + '.');
console.log('Stesse gambe, DUE schedine da 40: il ' + (100 * meglio.P).toFixed(1) + '%, e te ne basta ' + meglio.k + '.');
console.log('Il valore atteso e identico — ' + tue.atteso.toFixed(1) + ' chf in tutti e due i casi.');
console.log('Sono ' + (100 * (meglio.P - tue.P)).toFixed(1) + ' punti di probabilita che non costano niente.');
console.log('');
console.log('E il motivo e la soglia intera: con quattro schedine ti servono DUE');
console.log('vincenti su quattro; con due ne basta UNA su due. Non e la stessa cosa,');
console.log('anche se il conto medio non se ne accorge.');
console.log('');
console.log('─────────────────────────────────────────────────────────────────────────');
console.log('la tabella intera, per chi vuole guardarla tutta:\n');

console.log('gambe  schedine   quota    puntata   servono   P(mese in attivo)   atteso   se va bene');
console.log('──────────────────────────────────────────────────────────────────────────────────────');

var righe = [];
for (var L = 1; L <= 10; L++) {
  var pL = Math.pow(p, L);
  var quota = (1 / pL) / Math.pow(1 + ric, L);
  var atteso = B / Math.pow(1 + ric, L);
  [GIORNATE * 4, GIORNATE * 2, GIORNATE, 2, 1].forEach(function (m) {
    if (m > GIORNATE * 4) return;
    var s = B / m;
    /* quante ne servono per stare sopra: la piu' piccola k con k*s*quota > B */
    var k = Math.floor(B / (s * quota)) + 1;
    if (k * s * quota <= B + 1e-9) k++;
    var P = codaBinom(m, pL, k);
    righe.push({ L: L, m: m, quota: quota, s: s, k: k, P: P, atteso: atteso,
                 seVaBene: k * s * quota });
  });
}

var mio = null, best = null;
righe.forEach(function (r) {
  var suo = (r.L >= 2 && r.L <= 4 && r.m === GIORNATE) ? '  ← quello che fai tu' : '';
  if (suo) { if (!mio || r.P > mio.P) mio = r; }
  if (!best || r.P > best.P) best = r;
});
righe.forEach(function (r) {
  var eti = '';
  if (r === best) eti = '  ← il massimo';
  else if (r.L >= 2 && r.L <= 4 && r.m === GIORNATE) eti = '  ← tu, piu o meno';
  console.log('  ' + String(r.L).padStart(2) + '      ' + String(r.m).padStart(3) +
              '     ' + r.quota.toFixed(2).padStart(7) + '   ' + r.s.toFixed(2).padStart(6) +
              '     ' + String(r.k).padStart(3) + '        ' +
              (100 * r.P).toFixed(1).padStart(5) + '%          ' +
              r.atteso.toFixed(1).padStart(5) + '    ' + r.seVaBene.toFixed(0).padStart(5) + eti);
});

console.log('\n' + 'il massimo: ' + best.L + ' gamb' + (best.L === 1 ? 'a' : 'e') + ', ' +
            best.m + ' schedin' + (best.m === 1 ? 'a' : 'e') + ' nel mese, ' +
            (100 * best.P).toFixed(1) + '% di chiudere in attivo');
if (mio) console.log('quello che fai tu:  ' + mio.L + ' gambe, ' + mio.m + ' schedine, ' +
                     (100 * mio.P).toFixed(1) + '%');
console.log('');

/* Il controllo che rende la cosa credibile invece che una frase a effetto:
   l'atteso NON migliora mai. Chi massimizza la probabilita' di chiudere in
   attivo sta comprando quella probabilita' col valore atteso, e va detto. */
var singole = righe.filter(function (r) { return r.L === 1; })[0];
console.log('e quanto costa: con le singole l\'atteso e ' + singole.atteso.toFixed(1) +
            ' chf su ' + B + ', col massimo e ' + best.atteso.toFixed(1) + '.');
console.log('Chi massimizza la probabilita di chiudere in attivo la STA COMPRANDO,');
console.log('e la paga in valore atteso. Non e un pasto gratis: e un cambio di');
console.log('valuta fra due cose che vuoi e non puoi avere insieme.');
