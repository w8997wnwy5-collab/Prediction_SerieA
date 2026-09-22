/* Il peso dell'ancoraggio al mercato e' lo stesso in tutti i campionati?

   La domanda nasce da un problema pratico. Costruire il modello di un
   campionato costa 253 ms; il backtest che ne tara l'ancoraggio ne costa
   15.000. Farlo per cinque campionati a ogni apertura dell'app vorrebbe dire
   un minuto e mezzo di attesa su un telefono, e non e' accettabile.

   La scorciatoia sarebbe: il peso migliore misurato sulla Serie A e' UNO — il
   modello sta zitto e parla solo il mercato, su tutti e tredici i mercati
   provati, sia sulle quote di apertura sia su quelle di chiusura — quindi si
   usa uno dappertutto e via.

   Ma "misurato sulla Serie A, dato per buono altrove" e' esattamente il tipo
   di salto contro cui questo progetto e' costruito. Se il peso fosse davvero
   uno solo in Italia, usarlo in Premier renderebbe l'app PEGGIORE proprio dove
   ci sono piu' partite fra cui scegliere.

   Quindi si misura, campionato per campionato, con la stessa disciplina di
   sempre: si guarda il punteggio RPS su partite che il modello non ha visto.
   Il peso 1 non e' "il modello e' inutile": il mercato quota tre cose e l'app
   ne mostra quaranta. E' che su quelle tre non c'e' partita.

   uso: node tools/misura_ancora_leghe.js
*/
var fs = require('fs'), path = require('path');
var R = path.join(__dirname, '..');
var M = require(path.join(R, 'modello.js'));

var PESI = [0, 0.3, 0.6, 0.85, 1];

function carica(file) {
  var p = path.join(R, 'data', file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

var indice = carica('leghe.json');
if (!indice) {
  console.log('Manca data/leghe.json: il giro dei dati non e\' ancora passato.');
  process.exit(0);
}

console.log('Il peso dell\'ancoraggio al mercato, campionato per campionato.');
console.log('RPS sulle partite non viste: piu\' basso e\' meglio.\n');
console.log('campionato        partite   ' +
            PESI.map(function (p) { return ('peso ' + p).padStart(9); }).join('') +
            '    migliore');

var riepilogo = [];
indice.leghe.forEach(function (lega) {
  var doc = carica(lega.file);
  if (!doc) { console.log('  %s: file mancante', lega.nome); return; }
  var giocate = (doc.partite || []).filter(function (p) { return p.gc != null; })
                                   .sort(function (a, b) { return a.d < b.d ? -1 : 1; });
  if (giocate.length < 400) {
    console.log('  ' + lega.nome.padEnd(16) + '  troppo poche partite (' + giocate.length + ')');
    return;
  }
  var dati = M.prepara(giocate);
  var stagioni = (doc.stagioni || []).slice().sort();
  var da = stagioni.length >= 3
    ? (parseInt(stagioni[stagioni.length - 3].slice(0, 4), 10) + '-08-01') : null;
  var res = M.campionaBacktest(dati, { da: da, refitOgniGiorni: 3, iterazioni: 90 });
  if (!res || res.campioni.length < 200) {
    console.log('  ' + lega.nome.padEnd(16) + '  backtest troppo corto');
    return;
  }
  /* Lo stesso schema di valutaBacktest, non uno scritto a mano: si costruiscono
     le coppie (probabilita', esito vero) e le si passa a misura(). La prima
     versione di questo strumento calcolava l'RPS per conto suo e usava
     esitoReale() invece del campo esito gia' salvato nel campione: dava numeri
     doppi e una risposta rovesciata, che contraddiceva tre misure gia' fatte.
     Quella contraddizione e' stata l'unica cosa che l'ha smascherato. */
  var conQuote = res.campioni.filter(function (c) { return c.q; });
  if (conQuote.length < 100) {
    console.log('  ' + lega.nome.padEnd(16) + '  solo ' + conQuote.length + ' campioni con le quote');
    return;
  }
  var pesoTiri = 0.60;
  var punteggi = PESI.map(function (ancora) {
    var coppie = conQuote.map(function (c) {
      var pr = M.probabilitaDaCampione(c, pesoTiri, { ancoraggio: ancora });
      return { p: pr.p, esito: c.esito };
    });
    return M.misura(coppie).rps;
  });
  var minimo = Math.min.apply(null, punteggi);
  var migliore = PESI[punteggi.indexOf(minimo)];
  console.log('  ' + lega.nome.padEnd(16) + String(conQuote.length).padStart(7) + '   ' +
    punteggi.map(function (x) { return x.toFixed(5).padStart(9); }).join('') +
    '      ' + migliore);
  /* Un minimo che sta a 0.6 invece che a 1 puo' essere una differenza vera
     oppure la curva piatta piu' il rumore. Si decide con un test APPAIATO:
     la stessa partita vista con due pesi, cosi' la fortuna di quella giornata
     si cancella invece di entrare nella varianza. */
  if (migliore !== 1) {
    var a = conQuote.map(function (c) {
      var pr = M.probabilitaDaCampione(c, pesoTiri, { ancoraggio: migliore });
      return M.rps(pr.p, c.esito);
    });
    var b = conQuote.map(function (c) {
      var pr = M.probabilitaDaCampione(c, pesoTiri, { ancoraggio: 1 });
      return M.rps(pr.p, c.esito);
    });
    var d = a.map(function (x, k) { return x - b[k]; });
    var mu = d.reduce(function (x, y) { return x + y; }, 0) / d.length;
    var sd = Math.sqrt(d.reduce(function (sx, x) { return sx + (x - mu) * (x - mu); }, 0) /
                       Math.max(1, d.length - 1));
    var z = sd > 0 ? mu / (sd / Math.sqrt(d.length)) : 0;
    console.log('      peso ' + migliore + ' contro peso 1, appaiato: z = ' + z.toFixed(2) +
                (Math.abs(z) < 1.96
                  ? '  DENTRO il rumore: la curva e\' piatta, non e\' una differenza vera.'
                  : '  fuori dal rumore: e\' una differenza vera.'));
    riepilogo.push({ lega: lega.nome, migliore: Math.abs(z) < 1.96 ? 1 : migliore,
                     grezzo: migliore, z: z });
    return;
  }
  riepilogo.push({ lega: lega.nome, migliore: migliore });
});

console.log('');
var pesi = riepilogo.map(function (r) { return r.migliore; });
riepilogo.forEach(function (r) {
  if (r.grezzo != null && r.grezzo !== r.migliore) {
    console.log('(' + r.lega + ': il minimo grezzo stava a ' + r.grezzo +
                ', ma appaiato contro 1 fa z=' + r.z.toFixed(2) + ', quindi vale 1.)');
  }
});
if (pesi.length && pesi.every(function (p) { return p === pesi[0]; })) {
  console.log('Tutti i campionati vogliono lo stesso peso: ' + pesi[0] + '.');
  console.log('Quindi l\'app puo\' usarlo senza rifare il backtest per ognuno —');
  console.log('e non e\' una comodita\' data per buona, e\' una cosa misurata.');
} else {
  console.log('I pesi migliori NON coincidono: ' +
              riepilogo.map(function (r) { return r.lega + '=' + r.migliore; }).join(', '));
  console.log('Quindi il backtest per campionato serve davvero, e la scorciatoia');
  console.log('avrebbe peggiorato l\'app proprio dove ci sono piu\' partite.');
}
