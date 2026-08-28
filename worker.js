/* Il lavoro pesante — stima, arbitri, backtest — sta qui, fuori dal thread
   dell'interfaccia. Altrimenti lo schermo si blocca per qualche secondo e
   sembra che l'app sia morta. */
'use strict';
importScripts('modello.js');
var M = self.Modello;

function stato(fase, q, testo) {
  self.postMessage({ tipo: 'stato', fase: fase, q: q, testo: testo });
}
function semplifica(par) {
  if (!par) return null;
  return { mu0: par.mu0, gamma: par.gamma, rho: par.rho,
           att: Array.prototype.slice.call(par.att), dif: Array.prototype.slice.call(par.dif),
           n: par.n, osservazioni: par.osservazioni || 0 };
}

self.onmessage = function (ev) {
  var msg = ev.data || {};
  if (msg.tipo !== 'avvia') return;
  var partite = msg.partite || [], opz = msg.opzioni || {};
  try {
    stato('preparazione', 0.02, 'Metto in fila le partite');
    var dati = M.prepara(partite);
    if (dati.righe.length < 100) {
      self.postMessage({ tipo: 'errore', messaggio: 'Solo ' + dati.righe.length +
        ' partite utilizzabili: troppo poche per stimare qualcosa di sensato.' });
      return;
    }

    stato('backtest', 0.08, 'Rigioco le stagioni passate una giornata alla volta');
    var daBacktest = opz.daBacktest || null;
    var res = M.campionaBacktest(dati, {
      da: daBacktest, refitOgniGiorni: opz.refitOgniGiorni || 3,
      xi: opz.xi, xiTiri: opz.xiTiri, ridge: opz.ridge, iterazioni: 90
    }, function (q) { stato('backtest', 0.08 + q * 0.62, 'Rigioco le stagioni passate'); });
    var back = res.campioni.length > 50 ? M.valutaBacktest(res) : null;

    stato('stima', 0.76, 'Stimo le forze di oggi');
    var peso = back && back.pesoMigliore != null ? back.pesoMigliore : 0.6;
    var mod = M.costruisci(partite, {
      xi: opz.xi, xiTiri: opz.xiTiri, ridge: opz.ridge, dati: dati,
      iterazioni: 400, pesoTiri: peso
    });

    stato('incertezza', 0.86, 'Rigioco il campionato per misurare quanto posso sbagliarmi');
    var repliche = M.bootstrap(dati, { xi: opz.xi, ridge: opz.ridge, iterazioni: 120 },
                               opz.repliche || 40, mod.gol);
    var se = M.sintesiBootstrap(repliche, mod.squadre.length);

    stato('arbitri', 0.94, 'Conto i cartellini di ogni arbitro');
    var arb = M.statisticheArbitri(partite, { da: opz.daArbitri || null, k: 12 });
    var rosso = M.effettoRosso(partite, mod);

    self.postMessage({
      tipo: 'pronto',
      risultato: {
        squadre: mod.squadre, gol: semplifica(mod.gol), tiri: semplifica(mod.tiri),
        pesoTiri: peso, calibrazioneTiri: mod.calibrazioneTiri,
        arbitri: arb, backtest: back,
        repliche: repliche, se: se ? {
          att: Array.prototype.slice.call(se.att), dif: Array.prototype.slice.call(se.dif),
          gamma: se.gamma, mu0: se.mu0, repliche: se.repliche,
          centro: { att: Array.prototype.slice.call(se.centro.att),
                    dif: Array.prototype.slice.call(se.centro.dif),
                    gamma: se.centro.gamma, mu0: se.centro.mu0 }
        } : null,
        effettoRosso: rosso,
        partiteUsate: dati.righe.length, ultimaData: dati.ultimaData
      }
    });
  } catch (e) {
    self.postMessage({ tipo: 'errore', messaggio: (e && e.message) || String(e),
                       traccia: e && e.stack ? String(e.stack).slice(0, 600) : null });
  }
};
