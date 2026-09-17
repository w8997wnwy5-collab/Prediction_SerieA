/* Il peso giusto quando il mercato non ha ancora visto le formazioni.

   Tutto quello che questo progetto ha misurato sull'ancoraggio e' misurato
   sulle quote di CHIUSURA: il prezzo con cui la partita e' andata in campo,
   dopo che il mercato ha assorbito formazioni, infortuni, meteo. E' la stima
   migliore che esista — e non e' quella che si ha in mano quando si punta.

   Chi gioca prima delle formazioni ufficiali, per prendere quote piu' alte, ha
   l'APERTURA. Piu' grezza, per definizione: e' il prezzo prima che si sapesse.

   E qui nasce una domanda che nessuna misura di questo progetto poteva porsi,
   perche' l'apertura veniva scartata invece che tenuta a parte:

     se il mercato di chiusura e' molto piu' informato del modello, ma quello
     di APERTURA lo e' MENO, allora il peso giusto da dare al modello non e' lo
     stesso nei due momenti.

   Il sospetto e' fondato. Fra apertura e chiusura il mercato si sposta, in
   media, del 2.3% di variazione totale: non e' rumore, e' informazione che
   arriva. Al momento dell'apertura quella informazione NON C'E' ANCORA — ne'
   per il mercato ne' per me — quindi li' i due previsori sono piu' alla pari.

   Se cosi' fosse, l'app starebbe facendo un errore preciso e invisibile:
   userebbe, sulle partite da giocare, un peso tarato su una situazione in cui
   non ci si trova mai. E' lo stesso genere di sbaglio delle quote di Betfair
   che non arrivavano al calendario — un numero misurato benissimo, su un
   mondo che non e' quello di chi gioca.

   Due domande separate, tutte e due con train/test:

     1. il peso ottimo sull'apertura e' lo stesso che sulla chiusura?
     2. quanto si prevede peggio, in assoluto, con l'apertura? (perche' e'
        QUELLO il numero che l'app dovrebbe dichiarare come propria precisione)

   uso: node tools/misura_apertura.js
*/
var fs = require('fs'), path = require('path');
var R = '/home/user/Prediction_SerieA';
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var PESI = [0, 0.3, 0.5, 0.65, 0.8, 0.9, 1];
var PESO_TIRI = 0.60, OGNI = 10;

function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }
function rpsTre(pr, e) {
  var c = 0, s = 0;
  for (var i = 0; i < 2; i++) { c += pr[i]; var x = (e <= i) ? 1 : 0; s += (c - x) * (c - x); }
  return s / 2;
}
function z(a, b) {
  var d = a.map(function (x, i) { return x - b[i]; }), m = media(d);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / Math.max(1, d.length - 1));
  return m / (sd / Math.sqrt(d.length));
}

var dati = M.prepara(tutte);
var stagioni = (doc.stagioni || []).slice().sort();
var inizio = parseInt(stagioni[Math.max(0, stagioni.length - 3)].slice(0, 4), 10) + '-08-01';
var confine = parseInt(stagioni[Math.max(0, stagioni.length - 2)].slice(0, 4), 10) + '-08-01';

/* Una passata sola. Per ogni partita, l'errore con OGNI peso su tutte e due le
   fotografie del mercato — piu' l'errore del mercato nudo, che dice quanto
   vale la fotografia di per se'. */
var righe = [], mod = null, ultimo = null;
tutte.forEach(function (p) {
  if (p.d < inizio) return;
  if (!p.qap || !p.q) return;                       /* servono entrambe */
  if (!ultimo || M.giorni(ultimo, p.d) >= OGNI) {
    mod = M.costruisci(tutte, { dati: dati, fino: p.d, primoTempo: false,
                                iterazioni: 160, pesoTiri: PESO_TIRI });
    ultimo = p.d;
  }
  if (!mod || !mod.ok) return;
  var i = mod.indice[p.c], j = mod.indice[p.v];
  if (i == null || j == null) return;
  var e = p.gc > p.gv ? 0 : (p.gc === p.gv ? 1 : 2);
  var g = M.golAttesiModello(mod, i, j, { pesoTiri: PESO_TIRI });

  function serie(quote, quoteOU) {
    return PESI.map(function (w) {
      var am = M.ancoraMercato(g[0], g[1], mod.gol.rho,
        { q: quote, qou: quoteOU || null, peso1x2: w, pesoOU: w });
      var es = M.esiti(M.matriceRisultati(am.lam, am.mu, mod.gol.rho, 11));
      return rpsTre([es.casa, es.pari, es.via], e);
    });
  }
  function nudo(quote) {
    var m = M.daQuote(quote);
    return m ? rpsTre(m, e) : null;
  }
  righe.push({
    d: p.d,
    ap: serie(p.qap, p.qapou), ch: serie(p.qex || p.q, p.qou),
    merAp: nudo(p.qap), merCh: nudo(p.qex || p.q)
  });
});

var train = righe.filter(function (r) { return r.d < confine; });
var test  = righe.filter(function (r) { return r.d >= confine; });
console.log('partite: ' + righe.length + '   scelgo su ' + train.length +
            ', verifico su ' + test.length + ' mai viste\n');

/* ── 1. quanto vale la fotografia, da sola ───────────────────────────────── */
console.log('LE DUE FOTOGRAFIE DEL MERCATO, NUDE');
var mAp = media(righe.map(function (r) { return r.merAp; }));
var mCh = media(righe.map(function (r) { return r.merCh; }));
console.log('  apertura   ' + mAp.toFixed(5));
console.log('  chiusura   ' + mCh.toFixed(5) + '   meglio del ' +
            (100 * (mAp - mCh) / mAp).toFixed(2) + '%, z=' +
            z(righe.map(function (r) { return r.merAp; }),
              righe.map(function (r) { return r.merCh; })).toFixed(2));
console.log('  → e\' la misura di quanta informazione arriva fra i due momenti.\n');

/* ── 2. il peso ottimo, per ciascuna ─────────────────────────────────────── */
function curva(l, campo) { return PESI.map(function (w, k) { return media(l.map(function (r) { return r[campo][k]; })); }); }
function migliore(c) { var b = 0; c.forEach(function (v, k) { if (v < c[b]) b = k; }); return b; }

var cAp = curva(train, 'ap'), cCh = curva(train, 'ch');
var bAp = migliore(cAp), bCh = migliore(cCh);
console.log('IL PESO DA DARE AL MERCATO (scelto sul train)');
console.log('  peso     su APERTURA    su CHIUSURA');
PESI.forEach(function (w, k) {
  console.log('  ' + String(w).padEnd(8) + cAp[k].toFixed(5) +
              (k === bAp ? ' ←' : '  ') + '      ' + cCh[k].toFixed(5) + (k === bCh ? ' ←' : ''));
});
console.log('\n  migliore sull\'apertura: ' + PESI[bAp] + '     sulla chiusura: ' + PESI[bCh]);
console.log('  (peso 1 = il modello sta zitto; peso 0 = il mercato non si guarda)\n');

/* ── 3. la verifica ──────────────────────────────────────────────────────── */
var uno = PESI.length - 1;
var conBAp = test.map(function (r) { return r.ap[bAp]; });
var conUno = test.map(function (r) { return r.ap[uno]; });
console.log('══ VERIFICA su ' + test.length + ' partite mai viste, sull\'apertura');
console.log('   peso 1 (modello zitto)      ' + media(conUno).toFixed(5));
console.log('   peso ' + PESI[bAp] + ' (scelto sul train)' + (String(PESI[bAp]).length < 4 ? '  ' : '') +
            '   ' + media(conBAp).toFixed(5));
var zz = PESI[bAp] === 1 ? 0 : z(conUno, conBAp);
console.log('   guadagno                    ' +
  (100 * (media(conUno) - media(conBAp)) / media(conUno)).toFixed(2) + '%   z=' + zz.toFixed(2));
console.log('');

/* ── 4. il numero che l'app dovrebbe dichiarare ──────────────────────────── */
console.log('QUANTO SI PREVEDE PEGGIO, GIOCANDO PRIMA DELLE FORMAZIONI');
var appAp = media(test.map(function (r) { return r.ap[bAp]; }));
var appCh = media(test.map(function (r) { return r.ch[bCh]; }));
console.log('  ancorati alla chiusura   ' + appCh.toFixed(5) + '   ← quello che l\'app dichiara');
console.log('  ancorati all\'apertura    ' + appAp.toFixed(5) + '   ← quello che succede davvero');
console.log('  differenza               ' + (100 * (appAp - appCh) / appCh).toFixed(2) + '%   z=' +
            z(test.map(function (r) { return r.ap[bAp]; }),
              test.map(function (r) { return r.ch[bCh]; })).toFixed(2));
console.log('');

if (PESI[bAp] < 1 && zz > 1.9) {
  console.log('IL PESO NON E\' LO STESSO. Sull\'apertura il modello merita voce: il');
  console.log('mercato non ha ancora visto le formazioni, e li\' i due previsori sono');
  console.log('piu\' alla pari. L\'app usa un peso tarato sulla chiusura su partite che');
  console.log('vengono giocate all\'apertura: va corretto.');
} else if (PESI[bAp] === 1) {
  console.log('Anche sull\'apertura conviene stare zitti. Il mercato, pure grezzo, sa');
  console.log('gia\' piu\' del modello: la meta\' di informazione che gli manca non basta');
  console.log('a pareggiare il divario. Il peso resta uno, e la cosa da correggere non');
  console.log('e\' il peso — e\' il numero che l\'app dichiara come propria precisione.');
} else {
  console.log('Il peso scelto sull\'apertura non regge fuori campione: resta uno.');
}
