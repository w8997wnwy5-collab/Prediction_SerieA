/* Vale la pena PAGARE per gli xG veri?

   Domanda concreta, nata da una domanda concreta: quale API comprare per
   rendere l'app piu' precisa. Gli xG sono il candidato ovvio — l'archivio ne
   ha 50 partite su 1950, perche' Understat risponde a tutte le stagioni con
   la stessa pagina quando la chiamata parte da GitHub (un blocco sull'IP, non
   un formato cambiato). Le altre 1900 partite usano xG DEDOTTI dai tiri:

       xG = tiri in porta · peso_porta + tiri fuori · peso_fuori

   pesi calibrati sull'archivio, e poi riportati sulla scala degli xG veri.
   Grossolano, detto cosi'. Ma "grossolano" non e' una misura.

   Le 50 partite che hanno ENTRAMBI permettono di chiederlo sul serio. E la
   domanda giusta non e' "quanto somigliano" — e' "chi prevede meglio i GOL",
   che e' l'unica cosa per cui l'app usa gli xG.

   Il risultato, se regge su piu' dati, dice di tenersi i soldi in tasca.

   uso: node tools/misura_xg.js
*/
var fs = require('fs'), path = require('path');
var R = path.join(__dirname, '..');
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var cal = M.calibraTiri(tutte);
var all = M.allineaXg(tutte, cal);
console.log('Gli xG veri valgono i soldi che costano?\n');
console.log('calibrazione dei tiri: in porta = ' + cal.inPorta.toFixed(4) +
            ', fuori = ' + cal.fuori.toFixed(4));
console.log('scala riportata su quella degli xG veri: fattore ' +
            (all ? all.fattore.toFixed(4) : 'n/d') +
            ' (su ' + (all ? all.partite : 0) + ' partite)\n');

/* Ogni squadra-partita e' un'osservazione: due per partita. */
var oss = [];
tutte.forEach(function (p) {
  if (p.xgc == null || p.xgv == null) return;
  var t = M.xgDaTiri(p, cal);
  if (!t) return;
  var f = all ? all.fattore : 1;
  oss.push({ vero: p.xgc, stima: t[0] * f, gol: p.gc });
  oss.push({ vero: p.xgv, stima: t[1] * f, gol: p.gv });
});
if (oss.length < 20) {
  console.log('Servono piu\' partite con xG veri: ce ne sono ' + (oss.length / 2) + '.');
  process.exit(0);
}
function media(l, f) { return l.reduce(function (a, b) { return a + f(b); }, 0) / l.length; }
function eqm(l, f, g) {
  return Math.sqrt(l.reduce(function (s, x) { var d = f(x) - g(x); return s + d * d; }, 0) / l.length);
}
function corr(l, f, g) {
  var ma = media(l, f), mb = media(l, g), sa = 0, sb = 0, sab = 0;
  l.forEach(function (x) { var a = f(x) - ma, b = g(x) - mb; sa += a * a; sb += b * b; sab += a * b; });
  return sab / Math.sqrt(sa * sb);
}
var VERO = function (x) { return x.vero; },
    STIMA = function (x) { return x.stima; },
    GOL = function (x) { return x.gol; };

console.log(oss.length / 2 + ' partite, ' + oss.length + ' squadra-partita\n');
console.log('  medie   xG veri ' + media(oss, VERO).toFixed(3) +
            '   dai tiri ' + media(oss, STIMA).toFixed(3) +
            '   gol veri ' + media(oss, GOL).toFixed(3));
console.log('  quanto si somigliano: scarto ' + eqm(oss, STIMA, VERO).toFixed(3) +
            ', correlazione ' + corr(oss, STIMA, VERO).toFixed(3));
console.log('\n  Ma la domanda e\' chi prevede meglio i GOL:');
console.log('    xG veri   scarto ' + eqm(oss, VERO, GOL).toFixed(3) +
            '   correlazione ' + corr(oss, VERO, GOL).toFixed(3));
console.log('    dai tiri  scarto ' + eqm(oss, STIMA, GOL).toFixed(3) +
            '   correlazione ' + corr(oss, STIMA, GOL).toFixed(3));

/* Appaiato: stessa squadra-partita, due stime. Confrontare due scarti
   quadratici medi come se fossero indipendenti butterebbe via proprio
   l'informazione che rende il confronto sensato. */
var d = oss.map(function (x) {
  return Math.pow(x.stima - x.gol, 2) - Math.pow(x.vero - x.gol, 2);
});
var n = d.length, mu = d.reduce(function (a, b) { return a + b; }, 0) / n;
var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / (n - 1));
var z = mu / (sd / Math.sqrt(n));
console.log('\n  test appaiato sugli errori quadratici:');
console.log('    differenza media ' + mu.toFixed(4) + '  (negativo = i tiri sbagliano meno)');
console.log('    z = ' + z.toFixed(2) + ' su ' + n + ' osservazioni');
console.log('    ' + (Math.abs(z) < 1.96
  ? 'DENTRO il rumore: su questi dati non si distingue quale sia meglio.'
  : 'fuori dal rumore.'));

console.log('\n  E c\'e\' una ragione piu\' profonda per cui cambierebbe poco comunque:');
console.log('  l\'ancoraggio al mercato sta a peso UNO su tutti e tredici i mercati');
console.log('  provati (tools/misura_mercati.js). Dove il mercato quota, sono le sue');
console.log('  quote a fissare i gol attesi, non gli xG. Gli xG contano dove il');
console.log('  mercato tace — e li\' non c\'e\' niente con cui verificarli.');
