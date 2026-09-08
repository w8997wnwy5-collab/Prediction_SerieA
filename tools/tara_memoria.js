/* Quanto lontano deve guardare il modello, e quanto deve fidarsi di quello che
   vede?

   Dentro il motore ci sono tre numeri che nessuno ha mai misurato:

     xi      0.0028   quanto svaniscono i risultati vecchi (mezza vita 250 giorni)
     xiTiri  0.0045   lo stesso per i tiri, che si stabilizzano prima
     ridge   0.30     quanto le forze vengono tirate verso la media della lega

   Sono scelti a occhio, come lo era il ricarico del banco, e governano tutto:
   xi decide se il modello ricorda la stagione scorsa o solo l'ultimo mese,
   ridge decide se il Napoli capolista e' davvero cosi' forte o se e' meta'
   fortuna. Numeri del genere non si dichiarano, si misurano.

   La trappola e' misurarli e basta: con venticinque combinazioni provate sullo
   stesso archivio, la migliore vince anche se sono tutte uguali. Quindi le
   stagioni si tagliano in due: si SCEGLIE sulla meta' vecchia e si VERIFICA su
   quella nuova, che nella scelta non e' mai entrata. Se il guadagno sparisce
   passando da una all'altra, era rumore.

   uso: node tools/tara_memoria.js
*/
var fs = require('fs'), path = require('path');
var R = '/home/user/Prediction_SerieA';
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var PESO_TIRI = 0.60;      /* tenuto fermo: lo sceglie il backtest dell'app */
var ANCORA = 0.50;         /* idem, ma qui serve un valore per il secondo conto */
var OGNI = 10;             /* giorni fra un riaddestramento e l'altro */

function rpsTre(pr, e) {
  var c = 0, s = 0;
  for (var i = 0; i < 2; i++) { c += pr[i]; var x = (e <= i) ? 1 : 0; s += (c - x) * (c - x); }
  return s / 2;
}
function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }

var dati = M.prepara(tutte);

/* Una passata completa con una terna di parametri. Torna due liste appaiate di
   errori, una partita per posizione: senza ancoraggio e con. */
var cache = {};
function passata(xi, xiTiri, ridge, da, a) {
  var chiave = [xi, xiTiri, ridge, da, a].join('|');
  if (cache[chiave]) return cache[chiave];
  var mod = null, ultimo = null, nudo = [], anc = [];
  for (var k = 0; k < tutte.length; k++) {
    var p = tutte[k];
    if (p.d < da || p.d >= a) continue;
    if (!ultimo || M.giorni(ultimo, p.d) >= OGNI) {
      mod = M.costruisci(tutte, { dati: dati, fino: p.d, primoTempo: false,
                                  iterazioni: 160, xi: xi, xiTiri: xiTiri, ridge: ridge,
                                  pesoTiri: PESO_TIRI });
      ultimo = p.d;
    }
    if (!mod || !mod.ok) continue;
    var i = mod.indice[p.c], j = mod.indice[p.v];
    if (i == null || j == null) continue;
    var e = p.gc > p.gv ? 0 : (p.gc === p.gv ? 1 : 2);
    var g = M.golAttesiModello(mod, i, j, { pesoTiri: PESO_TIRI });
    var mt = M.matriceRisultati(g[0], g[1], mod.gol.rho, 11);
    var es = M.esiti(mt);
    nudo.push(rpsTre([es.casa, es.pari, es.via], e));

    var q = p.qex || p.q || null;
    var am = M.ancoraMercato(g[0], g[1], mod.gol.rho,
      { q: q, qou: p.qou || null, peso1x2: ANCORA, pesoOU: ANCORA });
    var es2 = M.esiti(M.matriceRisultati(am.lam, am.mu, mod.gol.rho, 11));
    anc.push(rpsTre([es2.casa, es2.pari, es2.via], e));
  }
  var out = { nudo: nudo, anc: anc };
  cache[chiave] = out;
  return out;
}

function z(a, b) {   /* appaiato: stesse partite, due parametrizzazioni */
  var d = [], i;
  for (i = 0; i < a.length; i++) d.push(a[i] - b[i]);
  var m = media(d);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / Math.max(1, d.length - 1));
  return m / (sd / Math.sqrt(d.length));
}

/* Il taglio: tre stagioni di valutazione, meta' per scegliere e meta' per
   verificare. Il confine e' una data, non una percentuale di righe, cosi' non
   spezza una giornata a meta'. */
var stagioni = (doc.stagioni || []).slice().sort();
var inizio = parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10) + '-08-01';
var confine = parseInt(stagioni[Math.max(0, stagioni.length - 2)].slice(0, 4), 10) + '-08-01';
var fine = '2099-01-01';
console.log('scelgo su   ' + inizio + ' → ' + confine);
console.log('verifico su ' + confine + ' → oggi\n');

function mostra(nome, valori, fai, base) {
  console.log(nome);
  console.log('   valore    senza ancora   col mercato');
  var best = null;
  valori.forEach(function (v) {
    var r = fai(v);
    var mn = media(r.nudo), ma = media(r.anc);
    var stella = (v === base) ? '  ← quello di adesso' : '';
    console.log('   ' + String(v).padEnd(10) + mn.toFixed(5) + '        ' + ma.toFixed(5) + stella);
    if (!best || mn < best.m) best = { v: v, m: mn, r: r };
  });
  console.log('   migliore: ' + best.v + '\n');
  return best;
}

/* Una coordinata alla volta: si parte da quelli di adesso e si muove uno solo. */
var xi = M.PREDEF.xi, xiTiri = M.PREDEF.xiTiri, ridge = M.PREDEF.ridge;
var bXi = mostra('xi — quanto svaniscono i risultati vecchi',
  [0.0014, 0.0021, 0.0028, 0.0040, 0.0060],
  function (v) { return passata(v, xiTiri, ridge, inizio, confine); }, xi);
xi = bXi.v;
var bRid = mostra('ridge — quanto le forze vengono tirate verso la media',
  [0.10, 0.20, 0.30, 0.45, 0.70],
  function (v) { return passata(xi, xiTiri, v, inizio, confine); }, ridge);
ridge = bRid.v;
var bTiri = mostra('xiTiri — la memoria del modello sui tiri',
  [0.0025, 0.0045, 0.0070, 0.0110, 0.0180, 0.0300],
  function (v) { return passata(xi, v, ridge, inizio, confine); }, xiTiri);
xiTiri = bTiri.v;

console.log('scelta sulla meta\' vecchia:  xi=' + xi + '  xiTiri=' + xiTiri + '  ridge=' + ridge);
console.log('quella di adesso:            xi=' + M.PREDEF.xi + '  xiTiri=' + M.PREDEF.xiTiri +
            '  ridge=' + M.PREDEF.ridge + '\n');

var vecchioT = passata(M.PREDEF.xi, M.PREDEF.xiTiri, M.PREDEF.ridge, confine, fine);
var nuovoT = passata(xi, xiTiri, ridge, confine, fine);
var vecchioS = passata(M.PREDEF.xi, M.PREDEF.xiTiri, M.PREDEF.ridge, inizio, confine);

/* Due dei tre migliori sono caduti sul BORDO della griglia (il piu' piccolo xi,
   il piu' piccolo ridge): quando succede, quello che si e' trovato non e' un
   massimo, e' una direzione senza fondo — cioe' rumore. Solo xiTiri ha un
   minimo vero in mezzo, con i valori piu' grandi e piu' piccoli entrambi
   peggiori. Vale la pena verificarlo da solo, invece di affogarlo insieme agli
   altri due: se il guadagno c'e', deve vedersi qui. */
var soloTiri = passata(M.PREDEF.xi, xiTiri, M.PREDEF.ridge, confine, fine);

console.log('══ la verifica, sulla meta\' che non ha scelto niente (' + nuovoT.nudo.length + ' partite)');
console.log('                        senza ancora   col mercato');
console.log('  come adesso           ' + media(vecchioT.nudo).toFixed(5) + '        ' + media(vecchioT.anc).toFixed(5));
console.log('  come scelto sopra     ' + media(nuovoT.nudo).toFixed(5) + '        ' + media(nuovoT.anc).toFixed(5));
var zn = z(vecchioT.nudo, nuovoT.nudo), za = z(vecchioT.anc, nuovoT.anc);
console.log('  guadagno              ' +
  (100 * (media(vecchioT.nudo) - media(nuovoT.nudo)) / media(vecchioT.nudo)).toFixed(2) + '%  z=' + zn.toFixed(2) +
  '     ' + (100 * (media(vecchioT.anc) - media(nuovoT.anc)) / media(vecchioT.anc)).toFixed(2) + '%  z=' + za.toFixed(2));
console.log('');
var guadagnoScelta = 100 * (media(vecchioS.nudo) - bTiri.m) / media(vecchioS.nudo);
console.log('  (sulla meta\' dove ha scelto il guadagno era ' + guadagnoScelta.toFixed(2) + '%)');
console.log('');
console.log('══ e xiTiri da solo, l\'unico con un minimo vero in mezzo alla griglia');
console.log('  come adesso           ' + media(vecchioT.nudo).toFixed(5) + '        ' + media(vecchioT.anc).toFixed(5));
console.log('  con xiTiri=' + String(xiTiri).padEnd(10) + media(soloTiri.nudo).toFixed(5) + '        ' + media(soloTiri.anc).toFixed(5));
var zt = z(vecchioT.nudo, soloTiri.nudo), zta = z(vecchioT.anc, soloTiri.anc);
console.log('  guadagno              ' +
  (100 * (media(vecchioT.nudo) - media(soloTiri.nudo)) / media(vecchioT.nudo)).toFixed(2) + '%  z=' + zt.toFixed(2) +
  '     ' + (100 * (media(vecchioT.anc) - media(soloTiri.anc)) / media(vecchioT.anc)).toFixed(2) + '%  z=' + zta.toFixed(2));
console.log('');

if (zt > 1.9 && zn < 1.9) {
  console.log('I tre insieme non reggono, ma xiTiri da solo si\': il modello sui tiri');
  console.log('vuole una memoria molto piu\' corta di quella che ha adesso. Gli altri due');
  console.log('erano scelte cadute sul bordo della griglia, cioe\' rumore, e trascinavano');
  console.log('giu\' anche il terzo.');
} else if (zn > 1.9) {
  console.log('I nuovi valori reggono anche dove non hanno scelto niente: vanno messi');
  console.log('in PREDEF. Il guadagno sulla meta\' di verifica e\' quello vero — quello');
  console.log('sulla meta\' di scelta e\' sempre gonfiato, perche\' li\' ha vinto il');
  console.log('migliore di venti tentativi.');
} else if (zn < -1.9) {
  console.log('I nuovi valori PEGGIORANO fuori dalla meta\' in cui sono stati scelti.');
  console.log('Erano rumore travestito da guadagno: si tiene quello che c\'e\'.');
} else {
  console.log('Fuori dalla meta\' in cui sono stati scelti i nuovi valori non si');
  console.log('distinguono da quelli di adesso. Se ci fosse stato un guadagno vero');
  console.log('sarebbe passato di la\' anche lui: quei tre numeri stanno gia\' in una');
  console.log('zona piatta, e sceglierli meglio non e\' il modo di migliorare il modello.');
}
