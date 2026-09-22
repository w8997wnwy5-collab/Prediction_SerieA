/* QUALI partite in QUALE schedina?

   L'app sa già quante schedine fare e quante gambe dargli: lo decide
   cercaStruttureMese, con un conto esatto. Ma su una cosa non ha mai detto
   niente, e nessuno se n'era accorto: DENTRO quella struttura, quale partita
   va in quale schedina.

   Oggi la risposta implicita è "in ordine": si ordinano le selezioni dalla più
   solida alla meno solida e si riempie la prima schedina, poi la seconda. Le
   tre più solide finiscono insieme. Non è una scelta, è l'ordine dell'array —
   ed è il tipo di dettaglio che resta per anni perché non sembra una decisione.

   Ma è una decisione, e pesa. Il conto lo dice in due righe:

     ogni schedina j esce con probabilità  P_j = prodotto delle sue gambe
     e paga                                 (punti/m) / (P_j · (1+ricarico)^L)

   Il pagamento è INVERSO alla probabilità. Il prodotto di TUTTE le P_j è
   fisso — è il prodotto di tutte le gambe usate, e non dipende da come le
   dividi. Quindi ripartire non cambia la somma: sposta soltanto massa fra una
   schedina probabile che paga poco e una improbabile che paga molto. Il valore
   atteso resta identico (si verifica sotto). La probabilità di chiudere il
   mese in attivo no.

   E c'è una semplificazione che rende il conto esatto e veloce: le schedine
   non condividono gambe, e le gambe sono indipendenti — quindi le SCHEDINE
   sono indipendenti. La distribuzione della giornata non ha bisogno di 2^n
   scenari sulle gambe: ne bastano 2^m sulle schedine. Sotto si verifica che
   le due strade danno lo stesso numero, e poi si usa quella corta.

   Le ripartizioni messe a confronto:

     sequenziale   le più solide tutte insieme, poi le altre   (quella di oggi)
     serpentina    a zig-zag, così le schedine si pareggiano
     casuale       media su tanti mescolamenti, per avere un fondo
     migliore      la migliore in assoluto, enumerando le partizioni

   uso: node tools/misura_ripartizione.js [giornate]
*/
var fs = require('fs'), path = require('path');
var R = path.join(__dirname, '..');
var M = require(path.join(R, 'modello.js'));
var doc = JSON.parse(fs.readFileSync(path.join(R, 'data', 'serie-a.json'), 'utf8'));
var tutte = doc.partite.filter(function (p) { return p.gc != null; })
                       .sort(function (a, b) { return a.d < b.d ? -1 : 1; });

var QUANTE = parseInt(process.argv[2], 10) || 24;
var RICARICO = 0.056;          /* bet365, misurato su 1930 partite */
var PUNTATA = 20;
var GIORNATE_MESE = 4;
var SOGLIA = 0.82;             /* "Equilibrata", la prudenza predefinita dell'app */

/* ── le giornate: gruppi di partite separati da un buco di più di due giorni ── */
function giornate(l) {
  var fuori = [], corr = [], prec = null;
  l.forEach(function (p) {
    var d = new Date(p.d + 'T00:00:00Z').getTime();
    if (prec != null && (d - prec) > 2 * 86400000) { fuori.push(corr); corr = []; }
    corr.push(p); prec = d;
  });
  if (corr.length) fuori.push(corr);
  return fuori.filter(function (g) { return g.length >= 6; });
}

/* ── la selezione che l'app metterebbe in schedina, partita per partita ──
   Stesso filtro della copertina: fra 12% e 88%, non oltre la soglia di
   prudenza, e fra quelle la più solida (pavimento più alto). */
function selezioniDi(mod, partite) {
  var fuori = [];
  partite.forEach(function (p) {
    var sim = M.simula(mod, p.c, p.v, { N: 1200, q: p.q, qou: p.qou });
    if (!sim) return;
    var medie = {}, k;
    for (k in sim.fasce) medie[k] = sim.fasce[k].p;
    var voci = M.elencoMercati(medie, [p.c, p.v]).concat(M.elencoTempi(medie, [p.c, p.v]));
    var meglio = null;
    voci.forEach(function (m) {
      var b = sim.fasce[m.campo];
      var p05 = b ? (m.inverso ? 1 - b.p95 : b.p05) : m.p;
      p05 = Math.max(0, Math.min(m.p, p05 == null ? m.p : p05));
      if (!(m.p >= 0.12 && m.p <= 0.88) || m.p > SOGLIA) return;
      if (!meglio || p05 > meglio.p05) meglio = { p: m.p, p05: p05, nome: m.nome };
    });
    if (meglio) fuori.push(meglio);
  });
  return fuori.sort(function (a, b) { return b.p05 - a.p05; });
}

/* ── la probabilità che il mese chiuda in attivo, data la ripartizione ──
   gruppi = array di array di indici dentro `sel`. */
function pAttivo(sel, gruppi) {
  var m = gruppi.length;
  /* Le schedine sono indipendenti: ognuna diventa UNA "gamba" con la sua
     probabilità composta e il suo pagamento. 2^m invece di 2^n. */
  var finte = gruppi.map(function (g) {
    var P = 1;
    g.forEach(function (i) { P *= sel[i].p; });
    return { p: P, quota: (1 / P) / Math.pow(1 + RICARICO, g.length) };
  });
  var soli = finte.map(function (_, i) { return [i]; });
  var d = M.distribuzioneRitorni(finte, soli, PUNTATA);
  if (!d) return null;
  var r = M.probMeseInAttivo(d, GIORNATE_MESE);
  return r ? r : null;
}

/* La stessa cosa passando dalle gambe vere, 2^n scenari. Serve solo a
   verificare che la scorciatoia qui sopra non stia mentendo. */
function pAttivoLungo(sel, gruppi) {
  var gambe = sel.map(function (s) {
    return { p: s.p, quota: (1 / s.p) / (1 + RICARICO) };
  });
  var d = M.distribuzioneRitorni(gambe, gruppi, PUNTATA);
  if (!d) return null;
  return M.probMeseInAttivo(d, GIORNATE_MESE);
}

/* ── le ripartizioni ── */
function sequenziale(n, L, m) {
  var g = [], j, i;
  for (j = 0; j < m; j++) { var x = []; for (i = 0; i < L; i++) x.push(j * L + i); g.push(x); }
  return g;
}
function serpentina(n, L, m) {
  var g = [], j, giro, i = 0;
  for (j = 0; j < m; j++) g.push([]);
  for (giro = 0; giro < L; giro++) {
    for (j = 0; j < m; j++) {
      var dove = (giro % 2 === 0) ? j : (m - 1 - j);
      g[dove].push(i++);
    }
  }
  return g;
}
function daPermutazione(perm, L, m) {
  var g = [], j, i;
  for (j = 0; j < m; j++) { var x = []; for (i = 0; i < L; i++) x.push(perm[j * L + i]); g.push(x); }
  return g;
}
function mescola(n, rnd) {
  var a = [], i, j, t;
  for (i = 0; i < n; i++) a.push(i);
  for (i = n - 1; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function casuale(seed) {                    /* deterministico, così si ripete */
  var s = seed || 12345;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
/* Tutte le partizioni di n elementi in m gruppi da L. Si ancora sempre il
   primo elemento ancora libero al gruppo che si sta formando: così ogni
   partizione esce una volta sola invece di m! volte. */
function tutteLePartizioni(n, L, limite) {
  var fuori = [];
  function giu(resto, acc) {
    if (fuori.length >= limite) return;
    if (!resto.length) { fuori.push(acc.slice()); return; }
    var testa = resto[0], altri = resto.slice(1);
    (function comb(da, presi) {
      if (fuori.length >= limite) return;
      if (presi.length === L - 1) {
        var gruppo = [testa].concat(presi), dentro = {};
        gruppo.forEach(function (x) { dentro[x] = 1; });
        giu(resto.filter(function (x) { return !dentro[x]; }), acc.concat([gruppo]));
        return;
      }
      for (var i = da; i < altri.length; i++) comb(i + 1, presi.concat([altri[i]]));
    })(0, []);
  }
  var l = []; for (var i = 0; i < n; i++) l.push(i);
  giu(l, []);
  return fuori;
}

/* ══ si comincia ══ */
var gg = giornate(tutte);
var bersagli = gg.slice(-QUANTE);
console.log('Ripartizione delle selezioni fra le schedine.');
console.log(bersagli.length + ' giornate vere, modello allenato ogni volta solo su quello che');
console.log('era già successo. Ricarico ' + (100 * RICARICO).toFixed(1) + '%, ' +
            PUNTATA + ' chf a giornata, ' + GIORNATE_MESE + ' giornate al mese.\n');

var STRUTTURE = [];
for (var L = 2; L <= 4; L++) for (var m = 2; m <= 4; m++) STRUTTURE.push({ L: L, m: m });

var conto = {};
STRUTTURE.forEach(function (st) {
  conto[st.L + 'x' + st.m] = { seq: [], ser: [], cas: [], mig: [], attSeq: [], attSer: [] };
});
var verificato = false;

bersagli.forEach(function (g, idx) {
  var prima = tutte.filter(function (p) { return p.d < g[0].d; });
  if (prima.length < 200) return;
  var mod = M.costruisci(prima, { fino: g[0].d });
  if (!mod) return;
  var sel = selezioniDi(mod, g);
  if (sel.length < 8) return;
  process.stderr.write('\r  giornata ' + (idx + 1) + '/' + bersagli.length +
                       ' (' + g[0].d + ', ' + sel.length + ' selezioni)   ');

  STRUTTURE.forEach(function (st) {
    var n = st.L * st.m;
    if (sel.length < n) return;
    var usate = sel.slice(0, n);
    var c = conto[st.L + 'x' + st.m];

    var gSeq = sequenziale(n, st.L, st.m);
    var gSer = serpentina(n, st.L, st.m);
    var rSeq = pAttivo(usate, gSeq), rSer = pAttivo(usate, gSer);
    if (!rSeq || !rSer) return;

    /* una volta sola: la scorciatoia a 2^m dà lo stesso numero di 2^n? */
    if (!verificato) {
      var lungo = pAttivoLungo(usate, gSeq);
      var scarto = Math.abs(lungo.pAttivo - rSeq.pAttivo);
      console.log('verifica: schedine indipendenti, 2^' + n + ' scenari sulle gambe = ' +
                  lungo.pAttivo.toFixed(6) + ',  2^' + st.m + ' sulle schedine = ' +
                  rSeq.pAttivo.toFixed(6) + '   scarto ' + scarto.toExponential(1));
      if (scarto > 2e-3) { console.log('  NON COINCIDONO: la scorciatoia è sbagliata.'); process.exit(1); }
      console.log('');
      verificato = true;
    }

    c.seq.push(rSeq.pAttivo); c.ser.push(rSer.pAttivo);
    c.attSeq.push(rSeq.atteso); c.attSer.push(rSer.atteso);

    var rnd = casuale(1000 + idx), somma = 0, giri = 60, k;
    for (k = 0; k < giri; k++) {
      var r = pAttivo(usate, daPermutazione(mescola(n, rnd), st.L, st.m));
      somma += r ? r.pAttivo : 0;
    }
    c.cas.push(somma / giri);

    var parti = tutteLePartizioni(n, st.L, 6000), meglio = 0;
    parti.forEach(function (gr) {
      var r = pAttivo(usate, gr);
      if (r && r.pAttivo > meglio) meglio = r.pAttivo;
    });
    c.mig.push(meglio);
  });
});
process.stderr.write('\r' + ' '.repeat(70) + '\r');

function media(l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : 0; }
/* z appaiato: la stessa giornata vista con due ripartizioni diverse. */
function zAppaiato(a, b) {
  var n = Math.min(a.length, b.length), d = [], i;
  for (i = 0; i < n; i++) d.push(a[i] - b[i]);
  var mu = media(d);
  var sd = Math.sqrt(d.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / Math.max(1, n - 1));
  return sd > 0 ? mu / (sd / Math.sqrt(n)) : 0;
}

console.log('P(mese in attivo), media sulle giornate:\n');
console.log('           sequenziale   serpentina   casuale    migliore    ' +
            'serp-seq      z');
STRUTTURE.forEach(function (st) {
  var c = conto[st.L + 'x' + st.m];
  if (!c.seq.length) return;
  var s = media(c.seq), r = media(c.ser);
  console.log('  ' + st.m + ' da ' + st.L + '   ' +
    (100 * s).toFixed(2).padStart(10) + '%' +
    (100 * r).toFixed(2).padStart(11) + '%' +
    (100 * media(c.cas)).toFixed(2).padStart(10) + '%' +
    (100 * media(c.mig)).toFixed(2).padStart(11) + '%' +
    (100 * (r - s)).toFixed(2).padStart(11) +
    zAppaiato(c.ser, c.seq).toFixed(1).padStart(8) +
    '   (' + c.seq.length + ' giornate)');
});

console.log('\nIl valore atteso del mese, per controllo — deve essere IDENTICO,');
console.log('perché dipende solo dalle gambe e non da come le raggruppi:\n');
STRUTTURE.forEach(function (st) {
  var c = conto[st.L + 'x' + st.m];
  if (!c.attSeq.length) return;
  var a = media(c.attSeq), b = media(c.attSer);
  console.log('  ' + st.m + ' da ' + st.L + '   sequenziale ' + a.toFixed(4) +
              '   serpentina ' + b.toFixed(4) +
              '   scarto ' + Math.abs(a - b).toExponential(1));
});
