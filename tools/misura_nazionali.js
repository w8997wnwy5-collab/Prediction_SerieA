/* Il modello regge sulle NAZIONALI, o sta solo indovinando?
   ══════════════════════════════════════════════════════════════════════════
   Prima di costruire un'app sopra a un modello, si misura il modello. Qui c'e'
   un motivo in piu' del solito per non fidarsi: tutto quello che sappiamo di
   questo modello e' stato misurato su squadre di club, che giocano trentotto
   partite l'anno con la stessa rosa. Una nazionale ne gioca dieci, con
   giocatori che cambiano, e in mezzo ci sono le amichevoli — dove nessuno
   prova davvero a vincere.

   Due domande, e la seconda vale piu' della prima:

     1. sull'1X2 batte una base ragionevole?
        Serve a sapere se il modello ha imparato qualcosa. Ma conta poco per
        l'app: sull'1X2 il banco quota, e il peso dell'ancoraggio misurato e'
        UNO — il mercato vince comunque.

     2. i mercati DERIVATI sono calibrati?
        Questa e' la domanda vera. Over 2.5, gol/gol, multigol: il banco non
        li quota quasi mai, quindi li' l'app mostra il modello NUDO. Se il
        modello dice 70% e la realta' e' 55%, l'app sta mentendo — e lo sta
        facendo proprio sui mercati che sceglie per le schedine, perche'
        l'ottimizzatore pesca i numeri piu' alti, cioe' quelli piu' gonfiati.

   Si misura fuori campione, su partite che il modello non ha mai visto, col
   taglio nel tempo: allena fino a una data, prova su quelle dopo.

   uso: node tools/misura_nazionali.js [percorso results.csv]
   ══════════════════════════════════════════════════════════════════════════ */
var fs = require('fs'), path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var CSV = process.argv[2] || '/tmp/naz.csv';
/* TRE PEZZI, NON DUE.

   Il modello prevede meno gol di quanti ne escono, sempre nella stessa
   direzione. La tentazione e' moltiplicare per il rapporto misurato e
   dichiarare risolto — ma quel rapporto viene dalle stesse partite su cui poi
   si verifica, e allora torna per forza: non e' una misura, e' un'eco.

   Quindi tre pezzi: si allena sul primo, si tara la correzione sul secondo, e
   si verifica sul terzo, che nessuno dei due ha mai visto. Se la correzione
   presa nel 2023-2024 raddrizza anche il 2025-2026, allora e' un difetto vero
   e stabile. Se no, era rumore di quel periodo e va buttata. */
var TARA = '2023-07-01';          /* fin qui si allena */
var TAGLIO = '2025-01-01';        /* da qui si verifica, e basta */
var DA = '2014-01-01';            /* piu' indietro di cosi' e' un altro sport */

/* Le nazionali che giocano in UEFA. Non e' campanilismo: il modello stima
   forze CONFRONTABILI solo fra squadre che si incontrano, e le europee si
   incontrano fra loro. Mettere dentro il mondo intero vorrebbe dire stimare
   il Brasile da tre amichevoli contro l'Europa. */
var UEFA = ('Albania Andorra Armenia Austria Azerbaijan Belarus Belgium Bosnia and Herzegovina ' +
  'Bulgaria Croatia Cyprus Czech Republic Czechia Denmark England Estonia Faroe Islands Finland ' +
  'France Georgia Germany Gibraltar Greece Hungary Iceland Israel Italy Kazakhstan Kosovo Latvia ' +
  'Liechtenstein Lithuania Luxembourg Malta Moldova Montenegro Netherlands North Macedonia ' +
  'Northern Ireland Norway Poland Portugal Republic of Ireland Romania Russia San Marino Scotland ' +
  'Serbia Slovakia Slovenia Spain Sweden Switzerland Turkey Ukraine Wales').split(' ');
/* i nomi con lo spazio dentro vanno rimessi insieme */
UEFA = UEFA.join(' ').replace('Bosnia and Herzegovina', 'Bosnia_and_Herzegovina')
  .replace('Czech Republic', 'Czech_Republic').replace('Faroe Islands', 'Faroe_Islands')
  .replace('North Macedonia', 'North_Macedonia').replace('Northern Ireland', 'Northern_Ireland')
  .replace('Republic of Ireland', 'Republic_of_Ireland').replace('San Marino', 'San_Marino')
  .split(' ').map(function (s) { return s.replace(/_/g, ' '); });
var inUefa = {};
UEFA.forEach(function (s) { inUefa[s] = 1; });

function leggiCsv(testo) {
  var righe = testo.split('\n'), intest = righe[0].split(','), fuori = [];
  for (var i = 1; i < righe.length; i++) {
    if (!righe[i].trim()) continue;
    /* niente virgole dentro i campi in questo file, ma i nomi di citta' si:
       si spezza solo sui primi campi e l'ultimo, il resto non serve */
    var c = righe[i].split(',');
    if (c.length < 9) continue;
    var r = {};
    for (var j = 0; j < intest.length && j < c.length; j++) r[intest[j].trim()] = c[j];
    fuori.push(r);
  }
  return fuori;
}

function carica() {
  var righe = leggiCsv(fs.readFileSync(CSV, 'utf8'));
  var fuori = [];
  for (var i = 0; i < righe.length; i++) {
    var r = righe[i];
    if (!r.date || r.date < DA) continue;
    if (!inUefa[r.home_team] || !inUefa[r.away_team]) continue;
    var gc = parseInt(r.home_score, 10), gv = parseInt(r.away_score, 10);
    if (!(gc >= 0) || !(gv >= 0)) continue;
    fuori.push({
      d: r.date, c: r.home_team, v: r.away_team, gc: gc, gv: gv,
      torneo: r.tournament || '',
      /* campo neutro: una finale in Germania fra Spagna e Francia non e' una
         partita in casa di nessuno, e darle il vantaggio del campo sarebbe
         un errore sistematico su tutti i tornei */
      neutro: String(r.neutral).toLowerCase() === 'true',
      s: r.date.slice(0, 4)
    });
  }
  return fuori;
}

function conta(t) {
  var n = {};
  t.forEach(function (p) { n[p.c] = (n[p.c] || 0) + 1; n[p.v] = (n[p.v] || 0) + 1; });
  return n;
}

/* ─── le misure ─── */
function rps(p, esito) { return M.rps(p, esito); }

function valuta(nome, mod, prove, opz) {
  opz = opz || {};
  var somma = 0, n = 0, saltate = 0;
  /* I mercati come li mostra l'app. esiti() ne espone una manciata col nome
     lungo (over25); i quaranta veri stanno in mercatiDaMatrice, che e' la
     stessa funzione da cui l'app li prende. Misurare quelli di esiti() invece
     di questi vorrebbe dire misurare qualcosa che l'utente non vede. */
  var cal = {o15: [], o25: [], o35: [], gol: [], mg13: [], mg24: [], c1x: [], cx2: []};
  var VERO = {
    o15: function (p) { return (p.gc + p.gv) > 1.5; },
    o25: function (p) { return (p.gc + p.gv) > 2.5; },
    o35: function (p) { return (p.gc + p.gv) > 3.5; },
    gol: function (p) { return p.gc > 0 && p.gv > 0; },
    mg13: function (p) { var t = p.gc + p.gv; return t >= 1 && t <= 3; },
    mg24: function (p) { var t = p.gc + p.gv; return t >= 2 && t <= 4; },
    c1x: function (p) { return p.gc >= p.gv; },
    cx2: function (p) { return p.gc <= p.gv; }
  };

  for (var i = 0; i < prove.length; i++) {
    var p = prove[i];
    /* prevedi torna GLI ESITI, non un involucro che li contiene. Leggere
       pr.esiti dava undefined su tutte e trecentotrentanove le partite, e la
       misura stampava lo stesso "il modello e' 100% meglio della base" — su
       zero partite. Ecco perche' sotto c'e' il freno. */
    var e = M.prevedi(mod, p.c, p.v, {});
    if (!e || e.casa == null) { saltate++; continue; }
    var q = [e.casa, e.pari, e.via];
    somma += rps(q, M.esitoReale(p.gc, p.gv));
    n++;
    var mk = M.mercatiDaMatrice(e.matrice);
    Object.keys(cal).forEach(function (k) {
      if (mk[k] == null) return;
      cal[k].push([mk[k], VERO[k](p) ? 1 : 0]);
    });
  }
  return {nome: nome, rps: somma / Math.max(1, n), n: n, saltate: saltate, cal: cal};
}

function baseFrequenze(alleno) {
  var c = 0, x = 0, v = 0;
  alleno.forEach(function (p) {
    if (p.gc > p.gv) c++; else if (p.gc === p.gv) x++; else v++;
  });
  var t = c + x + v;
  return [c / t, x / t, v / t];
}

function rpsBase(prove, q) {
  var s = 0;
  prove.forEach(function (p) { s += rps(q, M.esitoReale(p.gc, p.gv)); });
  return s / prove.length;
}

function stampaCalibrazione(cal) {
  var nomi = {o15: 'Over 1.5', o25: 'Over 2.5', o35: 'Over 3.5', gol: 'Gol/Gol',
              mg13: 'Multigol 1-3', mg24: 'Multigol 2-4', c1x: '1X', cx2: 'X2'};
  Object.keys(cal).forEach(function (k) {
    var righe = cal[k];
    /* zero righe qui vuol dire che quel mercato non esiste col nome che gli
       ho dato: va detto, non ignorato. La prima stesura leggeva o25 da un
       oggetto che espone over25, e stampava tre volte "poche" come se fosse
       un problema di campione. */
    if (!righe.length) { console.log(' ' + nomi[k] + ': MERCATO NON TROVATO nel modello'); return; }
    /* tre fasce, perche' con poche partite dieci secchielli sono rumore */
    var fasce = [[0, 0.45], [0.45, 0.6], [0.6, 1.01]];
    var out = [];
    fasce.forEach(function (f) {
      var dentro = righe.filter(function (r) { return r[0] >= f[0] && r[0] < f[1]; });
      if (dentro.length < 20) { out.push('  ' + f[0] + '–' + f[1] + ': poche (' + dentro.length + ')'); return; }
      var det = dentro.reduce(function (t, r) { return t + r[0]; }, 0) / dentro.length;
      var vero = dentro.reduce(function (t, r) { return t + r[1]; }, 0) / dentro.length;
      var se = Math.sqrt(vero * (1 - vero) / dentro.length);
      var z = (det - vero) / (se || 1e-9);
      out.push('  ' + (100 * f[0]).toFixed(0) + '–' + (100 * f[1]).toFixed(0) + '%: ' +
        'dice ' + (100 * det).toFixed(1) + '%, esce ' + (100 * vero).toFixed(1) + '%' +
        ' (n=' + dentro.length + ', z=' + z.toFixed(2) + ')' +
        (Math.abs(z) > 2 ? '  ← SGONFIA' : ''));
    });
    console.log(' ' + nomi[k] + ':');
    out.forEach(function (r) { console.log(r); });
  });
}

function main() {
  if (!fs.existsSync(CSV)) {
    console.log('manca il file ' + CSV + ' — scaricalo da martj42/international_results');
    return;
  }
  var tutte = carica();
  var alleno = tutte.filter(function (p) { return p.d < TARA; });
  var taratura = tutte.filter(function (p) { return p.d >= TARA && p.d < TAGLIO; });
  var prove = tutte.filter(function (p) { return p.d >= TAGLIO; });
  console.log('partite UEFA dal ' + DA + ': ' + tutte.length);
  console.log('  alleno   (< ' + TARA + '):  ' + alleno.length);
  console.log('  taratura (' + TARA + '–' + TAGLIO + '): ' + taratura.length);
  console.log('  verifica (>= ' + TAGLIO + '): ' + prove.length);
  var n = conta(alleno);
  var poche = Object.keys(n).filter(function (s) { return n[s] < 15; });
  console.log('  squadre: ' + Object.keys(n).length + ', con meno di 15 partite: ' +
              (poche.length ? poche.join(', ') : 'nessuna'));
  var amiche = alleno.filter(function (p) { return /Friendly/i.test(p.torneo); }).length;
  console.log('  di cui amichevoli: ' + amiche + ' (' + (100 * amiche / alleno.length).toFixed(0) + '%)');
  console.log('');

  var t0 = Date.now();
  var mod = M.costruisci(alleno, {primoTempo: false});
  console.log('modello costruito in ' + (Date.now() - t0) + ' ms, ok=' + mod.ok);
  console.log('');

  var base = baseFrequenze(alleno);
  console.log('=== 1X2, fuori campione (RPS: piu basso e meglio) ===');
  console.log('  base "sempre le frequenze medie": ' + rpsBase(prove, base).toFixed(5) +
              '   [' + base.map(function (x) { return (100 * x).toFixed(0) + '%'; }).join(' ') + ']');
  var r = valuta('modello', mod, prove);
  console.log('  modello:                          ' + r.rps.toFixed(5) +
              '   (su ' + r.n + ' partite, saltate ' + r.saltate + ')');
  /* IL FRENO. Una misura su zero partite non e' una misura buona a zero: e'
     l'assenza di una misura, e deve dirlo invece di stampare una percentuale.
     E' successo davvero, alla prima stesura di questo file. */
  if (!r.n) {
    console.log('');
    console.log('  NESSUNA PARTITA VALUTATA: qui non c e nessun risultato da leggere.');
    console.log('  (tutte saltate: il modello non conosce quelle squadre, o prevedi e cambiato)');
    return;
  }
  var meglio = 100 * (rpsBase(prove, base) - r.rps) / rpsBase(prove, base);
  console.log('  → il modello e ' + meglio.toFixed(1) + '% meglio della base');
  console.log('');
  /* Se ogni mercato sui gol e' storto nella STESSA direzione, non sono otto
     difetti: e' uno solo, e sta nel totale dei gol attesi. Si misura il
     rapporto fra i gol veri e quelli previsti — se e' un numero solo, si
     corregge con un numero solo. */
  var attesiTot = 0, veriTot = 0;
  prove.forEach(function (p) {
    var e = M.prevedi(mod, p.c, p.v, {});
    if (!e || e.totale == null) return;
    attesiTot += e.totale; veriTot += p.gc + p.gv;
  });
  /* la correzione si tara sul pezzo di mezzo, che non e' quello di verifica */
  var aT = 0, vT = 0;
  taratura.forEach(function (p) {
    var e = M.prevedi(mod, p.c, p.v, {});
    if (!e || e.totale == null) return;
    aT += e.totale; vT += p.gc + p.gv;
  });
  var correzione = vT / aT;

  console.log('=== I GOL: quanti ne prevede, quanti ne escono ===');
  console.log('  sulla TARATURA (' + taratura.length + ' partite): previsti ' +
              (aT / taratura.length).toFixed(3) + ', usciti ' + (vT / taratura.length).toFixed(3) +
              '  → correzione ' + correzione.toFixed(3));
  console.log('  sulla VERIFICA (' + r.n + ' partite):  previsti ' + (attesiTot / r.n).toFixed(3) +
              ', usciti ' + (veriTot / r.n).toFixed(3) +
              '  → servirebbe ' + (veriTot / attesiTot).toFixed(3));
  var resta = (veriTot / attesiTot) / correzione;
  console.log('  applicando la correzione tarata PRIMA, sulla verifica resta uno scarto di ' +
              ((resta - 1) * 100).toFixed(1) + '%' +
              (Math.abs(resta - 1) < 0.04
                ? '   ← LA CORREZIONE TIENE: e un difetto vero e stabile'
                : '   ← non tiene: era rumore di quel periodo, non una correzione'));
  console.log('');

  console.log('=== LA DOMANDA VERA: i derivati sono calibrati? ===');
  console.log('(dice = quanto promette il modello, esce = quanto succede davvero)');
  stampaCalibrazione(r.cal);
}

main();
