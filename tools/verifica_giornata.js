/* Cosa avrebbe detto l'app PRIMA che si giocasse, e com'è andata.

   La differenza con test_backtest.js è il punto di vista. Quello misura il
   modello su metriche da statistico — RPS, Brier, log-loss — che dicono se le
   probabilità sono oneste ma non dicono se una schedina si prende. Questo
   invece rifà esattamente il gesto dell'app: per ogni partita sceglie "la più
   solida" con lo stesso identico filtro della copertina, poi va a vedere come
   è finita.

   Il vincolo che rende il numero credibile: il modello viene allenato SOLO
   sulle partite giocate prima di quella giornata. Niente di quello che è
   successo dopo entra nella previsione — se entrasse, il punteggio sarebbe un
   complimento che ci si fa da soli.

   uso: node tools/verifica_giornata.js [data-inizio] [data-fine]
        node tools/verifica_giornata.js 2026-09-04 2026-09-07
*/
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var FILE = path.join(__dirname, '..', 'data', 'serie-a.json');
var doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
var tutte = doc.partite.filter(function(p){ return p.gc != null; });
tutte.sort(function(a, b){ return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0); });

/* Gli stessi scaffali dell'app: i mercati che su Sporttip ci sono davvero. */
var MERCATI_VISTI = ['1','X','2','O05','O15','U15','O25','U25','O35','U35','O45','U45','DISP','PARI'];

var da = process.argv[2] || null;
var a  = process.argv[3] || null;
if(!da){
  /* senza argomenti: l'ultima giornata che si è giocata */
  var ultima = tutte[tutte.length - 1].d;
  var d = new Date(ultima + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 4);
  da = d.toISOString().slice(0, 10); a = ultima;
}
if(!a) a = da;

var bersaglio = tutte.filter(function(p){ return p.d >= da && p.d <= a; });
if(!bersaglio.length){
  console.log('Nessuna partita giocata fra ' + da + ' e ' + a + '.');
  process.exit(0);
}
var prima = tutte.filter(function(p){ return p.d < da; });
console.log('Giornata dal ' + da + ' al ' + a + ': ' + bersaglio.length + ' partite');
console.log('Modello allenato su ' + prima.length + ' partite giocate prima, e su nient\'altro.\n');

var mod = M.costruisci(prima, {fino: da});
if(!mod){ console.log('Non ci sono abbastanza partite per allenare.'); process.exit(1); }

function quoteDi(p){ return {q: p.q || null, qou: p.qou || null}; }

/* Passata uno: la media della giornata, che serve per "cosa ha di diverso". */
function mercatiDi(p, N, campioni){
  var sim = M.simula(mod, p.c, p.v, {
    N: N, q: quoteDi(p).q, qou: quoteDi(p).qou, campioni: campioni || 0
  });
  if(!sim) return null;
  var medie = {}, k;
  for(k in sim.fasce) medie[k] = sim.fasce[k].p;
  var voci = M.elencoMercati(medie, [p.c, p.v]).concat(M.elencoTempi(medie, [p.c, p.v]));
  voci.forEach(function(m){
    var b = sim.fasce[m.campo];
    if(b){
      m.p05 = m.inverso ? 1 - b.p95 : b.p05;
      m.p95 = m.inverso ? 1 - b.p05 : b.p95;
    }
    m.p05 = Math.max(0, Math.min(m.p, m.p05 == null ? m.p : m.p05));
    m.quota = m.p > 0.001 ? 1 / m.p : null;
  });
  return voci;
}

/* La più solida, con lo stesso filtro della copertina dell'app:
   fra il 12% e l'88%, e fra quelle che pagano qualcosa (sotto il 78%),
   quella con il pavimento più alto. */
function piuSolida(p){
  var voci = mercatiDi(p, 1500, 140);
  if(!voci) return null;
  var attive = voci.filter(function(m){
    return MERCATI_VISTI.indexOf(m.id) >= 0 && m.p >= 0.12 && m.p <= 0.88;
  });
  attive.sort(function(x, y){ return y.p05 - x.p05; });
  var pagante = attive.filter(function(m){ return m.p <= 0.78; });
  return pagante[0] || attive[0] || null;
}

var righe = [], presi = 0, promesso = 0, quotaTotale = 1;
bersaglio.forEach(function(p){
  var m = piuSolida(p);
  if(!m) return;
  var esito = M.haVinto(m.id, p.gc, p.gv, p.ptc, p.ptv);
  if(esito === null) return;
  if(esito) presi++;
  promesso += m.p;
  quotaTotale *= m.quota;
  righe.push({p: p, m: m, esito: esito});
});

var largh = 0;
righe.forEach(function(r){ largh = Math.max(largh, (r.p.c + ' — ' + r.p.v).length); });
righe.forEach(function(r){
  console.log('%s  %s  %s  %s  (%s%%, quota equa %s)  →  %s',
    r.esito ? 'PRESA ' : 'persa ',
    (r.p.c + ' — ' + r.p.v).padEnd(largh),
    (r.p.gc + '-' + r.p.gv).padEnd(4),
    r.m.nome.padEnd(24),
    (r.m.p * 100).toFixed(0).padStart(2),
    r.m.quota.toFixed(2),
    r.esito ? 'sì' : 'no');
});

var n = righe.length;
console.log('\n%d su %d prese (%s%%). Il modello ne prometteva %s%%.',
  presi, n, (100 * presi / n).toFixed(0), (100 * promesso / n).toFixed(0));
console.log('Tutte insieme facevano quota %s: %s.',
  quotaTotale.toFixed(2),
  presi === n ? '20 CHF ne avrebbero fatti ' + (20 * quotaTotale).toFixed(0)
              : 'con ' + (n - presi) + ' persa/e, zero');
var scarto = presi - promesso;
console.log('%s',
  Math.abs(scarto) < 1.2
    ? 'Preso quello che aveva promesso: su ' + n + ' partite è quanto di più si possa dire.'
    : (scarto > 0 ? 'Andata meglio del previsto di ' + scarto.toFixed(1) + ' esiti — su ' + n +
                    ' partite è fortuna, non bravura.'
                  : 'Andata peggio del previsto di ' + (-scarto).toFixed(1) + ' esiti — su ' + n +
                    ' partite può essere solo sfortuna, ma va guardato di nuovo fra due giornate.'));
