/*
  Il modello ritrova i parametri veri?

  Su un campionato finto la risposta giusta esiste — l'ha scritta
  genera_dati_sintetici.py — quindi si può controllare, invece di guardare i
  numeri e dire che sembrano ragionevoli.

      python3 tools/genera_dati_sintetici.py /tmp/finto
      node tools/test_modello.js /tmp/finto
*/
'use strict';
var fs = require('fs');
var path = require('path');
var M = require(path.join(__dirname, '..', 'modello.js'));

var CARTELLA = process.argv[2] || '/tmp/finto';
var esiti = [];
function prova(nome, ok, dettaglio) { esiti.push([nome, !!ok, dettaglio == null ? '' : String(dettaglio)]); }
function correlazione(a, b) {
  var n = a.length, ma = 0, mb = 0, i;
  for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  var sa = 0, sb = 0, sab = 0;
  for (i = 0; i < n; i++) { sa += (a[i]-ma)*(a[i]-ma); sb += (b[i]-mb)*(b[i]-mb); sab += (a[i]-ma)*(b[i]-mb); }
  return sab / Math.sqrt(sa * sb);
}

if (!fs.existsSync(path.join(CARTELLA, 'serie-a.json'))) {
  console.error('Prima serve il campionato finto:\n  python3 tools/genera_dati_sintetici.py ' + CARTELLA);
  process.exit(2);
}
var doc = JSON.parse(fs.readFileSync(path.join(CARTELLA, 'serie-a.json'), 'utf8'));
var vero = JSON.parse(fs.readFileSync(path.join(CARTELLA, 'verita.json'), 'utf8'));

/* ── il modello ritrova le forze vere? ──────────────────────────────────── */
var dati = M.prepara(doc.partite);
prova('gli xG veri vengono preferiti al conto sui tiri',
      dati.xgVeri === doc.partite.length && dati.xgDaTiri === 0,
      'veri=' + dati.xgVeri + ' proxy=' + dati.xgDaTiri);

var mod = M.costruisci(doc.partite, { dati: dati, iterazioni: 600, pesoTiri: 0.3 });
prova('la stima converge', mod.ok);

var attV = [], attS = [], difV = [], difS = [];
mod.squadre.forEach(function (s, i) {
  if (!vero.forza[s]) return;
  attV.push(vero.forza[s].att); attS.push(mod.gol.att[i]);
  difV.push(vero.forza[s].dif); difS.push(mod.gol.dif[i]);
});
var cAtt = correlazione(attV, attS), cDif = correlazione(difV, difS);
prova('ritrova gli attacchi veri (corr > 0.85)', cAtt > 0.85, 'corr=' + cAtt.toFixed(3));
prova('ritrova le difese vere (corr > 0.80)', cDif > 0.80, 'corr=' + cDif.toFixed(3));

var dGamma = Math.abs(mod.gol.gamma - vero.parametri.gamma);
prova('ritrova il vantaggio del campo (± 0.08)', dGamma < 0.08,
      'stimato ' + mod.gol.gamma.toFixed(3) + ' vero ' + vero.parametri.gamma.toFixed(3));
prova('ritrova il segno della correzione sui punteggi bassi',
      mod.gol.rho * vero.parametri.rho > 0 || Math.abs(vero.parametri.rho) < 0.02,
      'stimato ' + mod.gol.rho.toFixed(4) + ' vero ' + vero.parametri.rho.toFixed(4));

var golVeri = doc.partite.reduce(function (t, p) { return t + p.gc + p.gv; }, 0) / doc.partite.length;
var somma = 0, n = 0;
mod.squadre.forEach(function (a) { mod.squadre.forEach(function (b) {
  if (a === b) return;
  var pr = M.prevedi(mod, a, b, {});
  if (pr) { somma += pr.totale; n++; }
}); });
prova('il livello dei gol torna (± 6%)', Math.abs(somma / n / golVeri - 1) < 0.06,
      'previsti ' + (somma/n).toFixed(3) + ' reali ' + golVeri.toFixed(3));

/* ── il primo tempo ─────────────────────────────────────────────────────── */
prova('stima anche il modello del primo tempo', !!mod.primoTempo);
if (mod.primoTempo) {
  var i0 = mod.indice[mod.squadre[0]], j0 = mod.indice[mod.squadre[1]];
  var q = M.quotePrimoTempo(mod, i0, j0, {});
  var quotaVera = vero.parametri.quota_primo_tempo;
  prova('la quota di gol nel primo tempo è quella vera (± 0.08)',
        Math.abs((q[0] + q[1]) / 2 - quotaVera) < 0.08,
        'stimata ' + ((q[0]+q[1])/2).toFixed(3) + ' vera ' + quotaVera.toFixed(3));
  var pf = M.primoFinale(1.6, 1.2, mod.gol.rho, q);
  var tot = 0; pf.forEach(function (r) { r.forEach(function (x) { tot += x; }); });
  prova('primo tempo / finale somma a 1', Math.abs(tot - 1) < 1e-6, tot.toFixed(9));
  var pr = M.prevedi(mod, mod.squadre[0], mod.squadre[1], {});
  var casaDaHtFt = pr.primoFinale[0][0] + pr.primoFinale[1][0] + pr.primoFinale[2][0];
  prova('i due tempi rimessi insieme danno il risultato finale',
        Math.abs(casaDaHtFt - pr.casa) < 0.01,
        'da HT/FT ' + casaDaHtFt.toFixed(4) + ' dal modello ' + pr.casa.toFixed(4));
}

/* ── i mercati non possono contraddirsi ─────────────────────────────────── */
var m = M.matriceRisultati(1.7, 1.15, -0.05, 11);
var s = M.mercatiDaMatrice(m);
var voci = M.elencoMercati(s, ['Casa', 'Ospite']);
function P(id) { var v = voci.filter(function (x) { return x.id === id; })[0]; return v ? v.p : NaN; }
prova('1 + X + 2 fa 1', Math.abs(P('1') + P('X') + P('2') - 1) < 1e-9);
prova('gli Under sono il complemento degli Over', Math.abs(P('O25') + P('U25') - 1) < 1e-9);
prova('una combo non supera nessuno dei suoi pezzi', P('1O25') <= P('1') + 1e-12 && P('1O25') <= P('O25') + 1e-12);
prova('le due metà di una combo ricompongono il tutto', Math.abs(P('1O25') + P('1U25') - P('1')) < 1e-9);
prova('i gol esatti sommano a 1', Math.abs(P('G0')+P('G1')+P('G2')+P('G3')+P('G4P') - 1) < 1e-9);
prova('vincere senza subire implica vincere', P('CSECCA') <= P('1') + 1e-12);
prova('vincere di due implica vincere', P('H1C') <= P('1') + 1e-12);
prova('la doppia chance è la somma dei due esiti', Math.abs(P('1X') - (P('1') + P('X'))) < 1e-9);
prova('ogni mercato è una probabilità', voci.every(function (v) { return v.p >= -1e-12 && v.p <= 1 + 1e-12; }));
prova('ogni mercato dichiara da dove viene', voci.every(function (v) { return s[v.campo] != null; }));

/* Il campo 'pari' era il pareggio, e chiamare così anche "numero di reti pari"
   ha fatto sommare due probabilità diverse nella stessa casella. La somma
   1+X+2 ha smesso di fare 1 e la prova qui sopra è diventata rossa. Questa
   controlla la causa invece del sintomo. */
var visti = {}, doppioni = [];
voci.forEach(function (v) {
  if (visti[v.campo] && visti[v.campo] !== (v.inverso ? 'i' : 'd')) return;
  if (visti[v.campo] === (v.inverso ? 'i' : 'd')) doppioni.push(v.campo + ' (' + v.id + ')');
  visti[v.campo] = v.inverso ? 'i' : 'd';
});
prova('nessun campo viene usato da due mercati diversi nello stesso verso',
      doppioni.length === 0, doppioni.join(', '));
var somme = M.mercatiDaMatrice(m);
prova('la somma di TUTTE le probabilità della matrice fa 1',
      Math.abs(somme.casa + somme.pari + somme.via - 1) < 1e-9 &&
      Math.abs(somme.retiDispari + somme.retiPari - 1) < 1e-9,
      'esiti ' + (somme.casa+somme.pari+somme.via).toFixed(9) +
      ' · dispari/pari ' + (somme.retiDispari+somme.retiPari).toFixed(9));

/* ── chi ha vinto: la regola dev'essere la stessa del prezzo ────────────── */

/* Ogni caso è scritto a mano da chi legge la schedina, non ricavato dal codice:
   se la regola di pagamento fosse sbagliata sarebbe sbagliato anche il
   controllo, e sarebbero d'accordo nell'errore. */
var casi = [
  [2, 0, '1', true],   [2, 0, 'X', false],  [2, 0, '2', false],
  [2, 0, 'U35', true], [2, 0, 'O15', true], [2, 0, 'O25', false],
  [2, 0, 'GG', false], [2, 0, 'NG', true],  [2, 0, 'CSECCA', true],
  [2, 0, 'PARI', true],[2, 0, 'DISP', false],
  [0, 0, 'U35', true], [0, 0, 'O05', false],[0, 0, 'PARI', true], [0, 0, 'G0', true],
  [2, 3, 'DISP', true],[2, 3, 'O45', true], [2, 3, 'U45', false], [2, 3, 'GG', true],
  [1, 2, 'DISP', true],[1, 2, '2', true],   [1, 2, 'X2', true],   [1, 2, '1X', false],
  [1, 0, 'DISP', true],[1, 0, 'MG13', true],[1, 0, 'H1C', false],
  [0, 4, 'O15', true], [0, 4, 'H2V', true], [0, 4, 'VSECCA', true], [0, 4, 'PARI', true],
  [3, 3, 'PARI', true],[3, 3, 'X', true],   [3, 3, 'O45', true],
  [1, 1, 'PARI', true],[1, 1, 'U15', false],[1, 1, 'GG', true]
];
var storti = [];
casi.forEach(function (t) {
  var v = M.haVinto(t[2], t[0], t[1]);
  if (v !== t[3]) storti.push(t[0] + '-' + t[1] + ' ' + t[2] + ': dice ' + v + ' invece di ' + t[3]);
});
prova('il registro paga le giocate come le paga la schedina (' + casi.length + ' casi)',
      storti.length === 0, storti.slice(0, 4).join(' | '));

/* Nessuna regola scritta due volte: chi ha vinto esce dalla stessa funzione che
   calcola il prezzo, quindi ogni mercato deve valere esattamente 0 o 1. */
var nonBinari = [];
[[0,0],[1,0],[2,1],[3,3],[0,4],[2,3]].forEach(function (r) {
  var reali = M.esitiReali(r[0], r[1]);
  M.elencoMercati(reali, null).forEach(function (v) {
    if (Math.abs(v.p - Math.round(v.p)) > 1e-9) nonBinari.push(r[0]+'-'+r[1]+' '+v.id+'='+v.p);
  });
});
prova('su una partita finita ogni mercato vale 0 o 1, mai una via di mezzo',
      nonBinari.length === 0, nonBinari.slice(0, 3).join(' | '));

prova('i mercati sul primo tempo restano indecisi senza il punteggio dell\'intervallo',
      M.haVinto('PTO05', 2, 1) === null && M.haVinto('PTO05', 2, 1, 1, 0) === true);
prova('un primo tempo impossibile viene ignorato invece di produrre numeri finti',
      M.haVinto('PTO05', 1, 0, 3, 0) === null);
prova('un mercato che non esiste non viene dato per vinto', M.haVinto('BOH', 2, 0) === null);
prova('senza risultato non si decide niente', M.esitiReali(null, null) === null);

/* ── la scorciatoia dell'ancoraggio è esatta ────────────────────────────── */
var peggio = 0;
for (var t = 0; t < 2000; t++) {
  var lam = 0.1 + Math.random() * 4, mu2 = 0.1 + Math.random() * 4, rho = (Math.random() - 0.5) * 0.4;
  var e = M.esiti(M.matriceRisultati(lam, mu2, rho, 11)), sc = M._sintesi(lam, mu2, rho);
  peggio = Math.max(peggio, Math.abs(sc.squilibrio - (e.casa - e.via)), Math.abs(sc.over - e.over25));
}
prova('la scorciatoia dà gli stessi numeri della matrice intera', peggio < 1e-12, peggio.toExponential(2));

/* ── l'ancoraggio raggiunge davvero il mercato ──────────────────────────── */
var quote = [1.55, 4.20, 6.00], quoteOU = [1.80, 2.00];
var anc = M.ancoraMercato(1.8, 0.9, -0.05, { q: quote, qou: quoteOU, peso1x2: 1, pesoOU: 1 });
var ris = M.esiti(M.matriceRisultati(anc.lam, anc.mu, -0.05, 11));
var pq = M.daQuote(quote), pou = M.daQuoteOU(quoteOU);
prova('con peso 1 riproduce l\'1X2 del mercato (± 0.5 punti)',
      Math.abs(ris.casa - pq[0]) < 0.005 && Math.abs(ris.via - pq[2]) < 0.005,
      ris.casa.toFixed(4) + ' vs ' + pq[0].toFixed(4));
prova('con peso 1 riproduce anche l\'Over del mercato (± 0.5 punti)',
      Math.abs(ris.over25 - pou) < 0.005, ris.over25.toFixed(4) + ' vs ' + pou.toFixed(4));
var anc0 = M.ancoraMercato(1.8, 0.9, -0.05, { q: quote, qou: quoteOU, peso1x2: 0, pesoOU: 0 });
prova('con peso 0 non tocca niente', !anc0.usato && anc0.lam === 1.8 && anc0.mu === 0.9);
var ancM = M.ancoraMercato(1.8, 0.9, -0.05, { q: quote, qou: quoteOU, peso1x2: 0.5, pesoOU: 0.5 });
var risM = M.esiti(M.matriceRisultati(ancM.lam, ancM.mu, -0.05, 11));
var puro = M.esiti(M.matriceRisultati(1.8, 0.9, -0.05, 11));
prova('con peso intermedio finisce in mezzo',
      risM.casa > Math.min(puro.casa, pq[0]) - 1e-9 && risM.casa < Math.max(puro.casa, pq[0]) + 1e-9,
      puro.casa.toFixed(3) + ' < ' + risM.casa.toFixed(3) + ' < ' + pq[0].toFixed(3));
prova('senza quote non succede niente', !M.ancoraMercato(1.8, 0.9, -0.05, { peso1x2: 1 }).usato);

/* ── Kelly ──────────────────────────────────────────────────────────────── */
prova('Kelly su p=0.6 a quota 2 dà 0.20', Math.abs(M.kelly(0.6, 2) - 0.2) < 1e-12);
prova('Kelly non propone mai una puntata in perdita', M.kelly(0.3, 2) === 0 && M.kelly(0.5, 1.9) === 0);
var val = M.valore({ p: 0.62, p05: 0.55 }, 1.85, { cassa: 100 });
prova('la puntata parte dal pavimento della fascia, non dalla media',
      val.puntata < 100 * M.kelly(0.62, 1.85), val.puntata.toFixed(3));

/* ── arbitri e corner ───────────────────────────────────────────────────── */
var arb = M.statisticheArbitri(doc.partite, { k: 12 });
prova('trova gli arbitri', arb && arb.arbitri.length === Object.keys(vero.severita).length,
      arb ? arb.arbitri.length : 0);
if (arb) {
  var sevV = [], sevS = [];
  arb.arbitri.forEach(function (a) {
    if (vero.severita[a.nome] == null) return;
    sevV.push(vero.severita[a.nome]); sevS.push(a.severita);
  });
  prova('ritrova chi fischia stretto (corr > 0.85)', correlazione(sevV, sevS) > 0.85,
        'corr=' + correlazione(sevV, sevS).toFixed(3));
}
var co = M.statisticheCorner(doc.partite, { k: 10 });
prova('conta i corner', co && co.squadre.length === 20, co ? co.squadre.length : 0);
if (co) {
  var ca = M.cornerAttesi(co, mod.squadre[0], mod.squadre[1], M.vantaggioCornerCasa(doc.partite));
  prova('i corner attesi stanno intorno alla media della lega',
        Math.abs(ca.totali - co.mediaPartita) < 2.5,
        ca.totali.toFixed(2) + ' vs media ' + co.mediaPartita.toFixed(2));
  prova('le soglie dei corner sono decrescenti',
        ca.oltre75 > ca.oltre85 && ca.oltre85 > ca.oltre95 && ca.oltre95 > ca.oltre105);
}

/* ─── quante ne prendi, e come le impacchetti ─── */
var d10 = M.distribuzioneEsiti([0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);
prova('la distribuzione ha n+1 caselle', d10.length === 11, d10.length);
prova('e somma a uno', Math.abs(d10.reduce(function (a, b) { return a + b; }, 0) - 1) < 1e-12);
prova('dieci su dieci coincide col prodotto',
      Math.abs(d10[10] - Math.pow(0.75, 10)) < 1e-12);
prova('zero su dieci coincide col prodotto dei mancati',
      Math.abs(d10[0] - Math.pow(0.25, 10)) < 1e-12);
prova('con dieci al 75% il caso piu probabile e 8, non 10',
      d10.indexOf(Math.max.apply(null, d10)) === 8, d10.indexOf(Math.max.apply(null, d10)));
/* probabilita diverse: la media resta la somma delle probabilita */
var mix = [0.9, 0.8, 0.7, 0.6, 0.5];
var dm = M.distribuzioneEsiti(mix);
var mediaAttesa = mix.reduce(function (a, b) { return a + b; }, 0);
var mediaCalc = dm.reduce(function (s, p, k) { return s + k * p; }, 0);
prova('la media della distribuzione e la somma delle probabilita',
      Math.abs(mediaCalc - mediaAttesa) < 1e-12, mediaCalc.toFixed(6));
prova('caso limite: nessuna selezione', M.distribuzioneEsiti([]).length === 1);

var sel3 = [{p: 0.5, quota: 2}, {p: 0.5, quota: 2}, {p: 0.5, quota: 2}];
var acc = M.profiloGiocata(sel3, [[0, 1, 2]], 30);
prova('l\'accumulata paga solo se escono tutte',
      Math.abs(acc.pZero - 0.875) < 1e-9, acc.pZero.toFixed(6));
prova('e a quote eque il ritorno atteso e la puntata',
      Math.abs(acc.atteso - 30) < 1e-9, acc.atteso.toFixed(6));
var sing = M.profiloGiocata(sel3, [[0], [1], [2]], 30);
prova('le singole hanno lo stesso atteso dell\'accumulata, a quote eque',
      Math.abs(sing.atteso - acc.atteso) < 1e-9);
prova('ma perdono tutto molto piu di rado',
      sing.pZero < acc.pZero, sing.pZero.toFixed(3) + ' contro ' + acc.pZero.toFixed(3));
prova('e vincono molto meno quando va bene',
      sing.massimo < acc.massimo, sing.massimo + ' contro ' + acc.massimo);

/* il punto che conta: col ricarico del banco l'accumulata NON e' neutra */
var conRicarico = sel3.map(function (x) { return {p: x.p, quota: x.quota / 1.065}; });
var accR = M.profiloGiocata(conRicarico, [[0, 1, 2]], 30);
var singR = M.profiloGiocata(conRicarico, [[0], [1], [2]], 30);
prova('col ricarico l\'accumulata rende meno delle singole',
      accR.atteso < singR.atteso - 0.5,
      accR.atteso.toFixed(2) + ' contro ' + singR.atteso.toFixed(2));
prova('e la differenza e il ricarico composto',
      Math.abs(accR.atteso - 30 / Math.pow(1.065, 3)) < 1e-9, accR.atteso.toFixed(4));

var st = M.struttureGiocata(10);
prova('le strutture coprono tutte le selezioni, sempre',
      st.every(function (x) {
        var visti = {};
        x.gruppi.forEach(function (g) { g.forEach(function (i) { visti[i] = 1; }); });
        return Object.keys(visti).length === 10;
      }));
prova('e nessuna selezione finisce in due schedine',
      st.every(function (x) {
        var n = 0;
        x.gruppi.forEach(function (g) { n += g.length; });
        return n === 10;
      }));

/* ─── la manopola della prudenza, letta dal sorgente dell'app ───

   PRUDENZE non e' codice di calcolo, e' una tabella di numeri MISURATI su 47
   giornate mai viste (tools/ottimizza_regola.js). Una tabella di numeri
   misurati puo' essere ricopiata male, e nessuno se ne accorge: qui si
   controlla che le quattro posizioni raccontino una storia coerente — piu'
   prudente vuol dire prendere piu' spesso e pagare di meno — e che la soglia
   non sia rimasta scritta a mano da qualche parte. */
(function () {
  var html;
  try {
    html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  } catch (e) { return; }
  var blocco = html.match(/var PRUDENZE = \[[\s\S]*?\n\];/);
  prova('la manopola della prudenza esiste nel sorgente', !!blocco);
  if (!blocco) return;
  /* In strict mode un eval non puo' assegnare una variabile di fuori: si
     valuta l'array come espressione e si prende quello che torna. */
  var PRUDENZE = eval('(' + blocco[0].replace('var PRUDENZE = ', '').replace(/;\s*$/, '') + ')');
  prova('quattro posizioni', PRUDENZE.length === 4, PRUDENZE.length);
  prova('soglie crescenti',
        PRUDENZE.every(function (x, i) { return i === 0 || x.soglia > PRUDENZE[i - 1].soglia; }));
  prova('piu prudente = paga meno',
        PRUDENZE.every(function (x, i) { return i === 0 || x.quota < PRUDENZE[i - 1].quota; }));
  prova('piu prudente = ne prende di piu',
        PRUDENZE.every(function (x, i) { return i === 0 || x.prese >= PRUDENZE[i - 1].prese; }));
  prova('piu prudente = almeno otto su dieci piu spesso',
        PRUDENZE.every(function (x, i) { return i === 0 || x.alm8 > PRUDENZE[i - 1].alm8; }));
  prova('ogni posizione ha id, nome e spiegazione',
        PRUDENZE.every(function (x) { return x.id && x.nome && x.testo && x.testo.length > 30; }));
  prova('gli id sono distinti',
        Object.keys(PRUDENZE.reduce(function (a, x) { a[x.id] = 1; return a; }, {})).length === 4);
  prova('le soglie stanno nell\'intervallo provato (0.70-0.90)',
        PRUDENZE.every(function (x) { return x.soglia >= 0.70 && x.soglia <= 0.90; }));
  prova('si parte da quella dove i conti tornano, non dalla prima',
        PRUDENZE[2].id === 'equi' && /PRUDENZE\[2\]/.test(html), PRUDENZE[2].id);
  prova('la soglia non e piu scritta a mano dentro sceltePartita',
        !/m\.p <= 0\.78/.test(html) && /m\.p <= prudenza\(\)\.soglia/.test(html));
  prova('cambiando manopola si butta la media della giornata',
        /impostaPrudenza[\s\S]{0,300}_mediaGiornata = null/.test(html));
  prova('la posizione attiva finisce nel pronostico che l\'app segna a se stessa',
        /prud: prudenza\(\)\.id/.test(html));
})();

/* ─── le notizie: un esonero e' un fatto solo, anche se lo scrivono in tre ─── */
(function () {
  var html;
  try {
    html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  } catch (e) { return; }
  function estrai(n) {
    var i = html.indexOf('function ' + n + '(');
    if (i < 0) return null;
    var d = 0;
    for (var k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++;
      else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); }
    }
    return null;
  }
  var src = estrai('accorpaPanchina');
  prova('l\'accorpamento delle notizie di panchina esiste', !!src);
  if (!src) return;
  var accorpaPanchina = eval('(' + src + ')');            // eslint-disable-line no-eval
  var l = [
    { t: 'La Fiorentina esonera Grosso', f: 'ANSA', sq: ['Fiorentina'], pan: true, ass: false },
    { t: 'Grosso esonerato: il poco feeling', f: 'Repubblica', sq: ['Fiorentina'], pan: true, ass: false },
    { t: 'La Fiorentina ha esonerato Fabio Grosso', f: 'Repubblica', sq: ['Fiorentina'], pan: true, ass: false },
    { t: 'Fiorentina, Kean out', f: 'Gazzetta', sq: ['Fiorentina'], pan: false, ass: true },
    { t: 'Fiorentina, Gudmundsson out', f: 'ANSA', sq: ['Fiorentina'], pan: false, ass: true }
  ];
  var r = accorpaPanchina(l);
  prova('tre titoli sullo stesso esonero diventano uno', r.length === 3, r.length);
  var pan = r.filter(function (x) { return x.pan; });
  prova('e resta il primo, con quante altre fonti lo dicono',
        pan.length === 1 && pan[0].altre === 2, pan.length ? pan[0].altre : 'nessuno');
  prova('due infortuni diversi restano due notizie: accorparli sarebbe nascondere',
        r.filter(function (x) { return x.ass; }).length === 2);
  prova('non si tocca l\'originale', l[0].altre === undefined);
  var due = accorpaPanchina([
    { t: 'Milan cambia', f: 'A', sq: ['Milan'], pan: true },
    { t: 'Roma cambia', f: 'B', sq: ['Roma'], pan: true }
  ]);
  prova('due squadre diverse non si accorpano fra loro', due.length === 2, due.length);
})();

/* ─── il ricarico del banco: misurato, non assunto ─── */
(function () {
  var html;
  try {
    html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  } catch (e) { return; }
  var blocco = html.match(/var RICARICHI = \[[\s\S]*?\n\];/);
  prova('la manopola del ricarico esiste', !!blocco);
  if (!blocco) return;
  var RICARICHI = eval('(' + blocco[0].replace('var RICARICHI = ', '').replace(/;\s*$/, '') + ')');
  prova('quattro posizioni', RICARICHI.length === 4, RICARICHI.length);
  /* Non piu' crescenti: la prima e' bet365 (5.6%), la seconda la media europea
     (4.9%), che sta SOTTO. E' il punto — il banco che si usa e' piu' caro
     della media, e metterlo in ordine di prezzo nasconderebbe proprio quello. */
  prova('si parte da un banco VERO e misurato, non da una media',
        RICARICHI[0].id === 'bet365' && Math.abs(RICARICHI[0].v - 0.056) < 1e-9,
        RICARICHI[0].id + ' ' + RICARICHI[0].v);
  prova('e quel banco sta sopra la media europea, che e il fatto interessante',
        RICARICHI[0].v > RICARICHI[1].v && RICARICHI[1].id === 'medio');
  prova('le due posizioni non misurate stanno in fondo e sono le piu care',
        RICARICHI[2].v > RICARICHI[0].v && RICARICHI[3].v > RICARICHI[2].v);
  /* Il ripiego non e' piu' RICARICHI[0] scritto a mano ma il primo dell'elenco
     disponibile — che e' RICARICHI[0] finche' il libro non ha abbastanza
     giocate, e la posizione "Il mio" da li' in poi. */
  prova('e in mancanza di scelta si prende il primo dell\'elenco disponibile',
        /S\.ricarico = elenco\.filter[\s\S]{0,80}\|\| elenco\[0\]/.test(html));
  prova('nessun 6.5% scritto a mano e rimasto in giro',
        !/Math\.pow\(1\.065/.test(html));
  prova('il ricarico passa da una funzione sola',
        /function quotaBanco[\s\S]{0,200}1 \+ ricarico\(\)\.v/.test(html));
  prova('ogni posizione ha una spiegazione, non solo un numero',
        RICARICHI.every(function (x) { return x.testo && x.testo.length > 40; }));

  /* Il conto che conta: il ricarico si moltiplica a ogni selezione, quindi su
     un'accumulata da dieci costa molto piu' di dieci volte. */
  var sel = [];
  for (var i = 0; i < 10; i++) sel.push({ p: 0.75, quota: (1 / 0.75) / 1.049 });
  var acc = M.profiloGiocata(sel, [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], 20);
  var sing = M.profiloGiocata(sel, sel.map(function (_, k) { return [k]; }), 20);
  prova('sull\'accumulata il ricarico si compone',
        Math.abs(acc.atteso - 20 / Math.pow(1.049, 10)) < 1e-6, acc.atteso.toFixed(4));
  prova('sulle singole no', Math.abs(sing.atteso - 20 / 1.049) < 1e-6, sing.atteso.toFixed(4));
  prova('e la differenza fra i due e grossa: e il punto di tutta la sezione',
        sing.atteso - acc.atteso > 5, (sing.atteso - acc.atteso).toFixed(2));
})();

/* ─── il valore contro la linea di chiusura ───

   La misura piu' onesta che esista su chi scommette, e impossibile da fare
   fino a quando le quote delle partite in arrivo non ci sono state. Se il
   prezzo preso batte quello con cui la partita e' andata in campo, si e'
   comprato meglio del mercato — e quella misura converge in cinquanta giocate
   invece che in mille, perche' il risultato di una scommessa e' quasi tutto
   fortuna mentre il prezzo no.

   Le due cose che possono rompersi in silenzio: leggere la chiusura
   dall'esito sbagliato (un CLV calcolato sulla quota della trasferta quando si
   e' giocata la casa non da' errore, da' un numero), e dichiarare un numero
   quando le giocate sono troppo poche perche' voglia dire qualcosa. */
(function () {
  var html;
  try { html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); } catch (e) { return; }
  function estrai(n) {
    var i = html.indexOf('function ' + n + '(');
    if (i < 0) return null;
    var d = 0;
    for (var k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++;
      else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); }
    }
    return null;
  }
  var src = estrai('chiusuraDi');
  prova('la lettura della chiusura esiste', !!src);
  if (!src) return;
  var partita = { qex: [2.50, 3.40, 2.90], qou: [1.85, 1.95] };
  var chiusuraDi = new Function('partitaDiGiocata',
    'return ' + src + ';')(function () { return partita; });

  prova('1 legge la chiusura di casa', chiusuraDi({ mercato: '1' }) === 2.50);
  prova('X legge il pareggio', chiusuraDi({ mercato: 'X' }) === 3.40);
  prova('2 legge la trasferta', chiusuraDi({ mercato: '2' }) === 2.90);
  prova('Over 2.5 legge la sua', chiusuraDi({ mercato: 'O25' }) === 1.85);
  prova('Under 2.5 la sua', chiusuraDi({ mercato: 'U25' }) === 1.95);
  prova('un mercato senza chiusura non ne inventa una',
        chiusuraDi({ mercato: '1X' }) == null);
  var senza = new Function('partitaDiGiocata', 'return ' + src + ';')(function () { return null; });
  prova('e una partita non ancora giocata non ha chiusura',
        senza({ mercato: '1' }) == null);

  var src2 = estrai('misuraClv');
  prova('il conto del CLV esiste', !!src2);
  if (!src2) return;
  function conLibro(voci, chiusura) {
    return new Function('libro', 'chiusuraDi', 'return ' + src2 + ';')(
      function () { return voci; }, function () { return chiusura; })();
  }
  /* preso a 2.60 quello che ha chiuso a 2.50: il 4% meglio */
  var otto = [];
  for (var i = 0; i < 8; i++) otto.push({ presa: 2.60, mercato: '1' });
  var r = conLibro(otto, 2.50);
  prova('otto giocate al 4% meglio danno +4%',
        Math.abs(r.medio - 0.04) < 0.0005, r.medio);
  prova('e le conta tutte sopra', r.sopra === 8, r.sopra);
  prova('sotto le tre giocate non dichiara un numero',
        conLibro(otto.slice(0, 2), 2.50).medio === undefined);
  var peggio = [];
  for (i = 0; i < 5; i++) peggio.push({ presa: 2.40, mercato: '1' });
  prova('e un prezzo peggiore della chiusura da un numero negativo',
        conLibro(peggio, 2.50).medio < 0, conLibro(peggio, 2.50).medio);
  prova('una giocata senza chiusura viene saltata, non contata a zero',
        conLibro(otto, null).n === 0);

  /* \\s+ invece di uno spazio: il testo va a capo nel sorgente, e una prova che
     fallisce per un ritorno a capo insegna solo a non fidarsi delle prove. */
  prova('la scheda dice che un CLV positivo NON e guadagno',
        /non vuol dire\s+guadagno[\s\S]{0,300}riduce il ricarico, non lo inverte/.test(html));
  prova('e dice perche vale piu del guadagno: converge prima',
        /cinquanta[\s\S]{0,120}invece che in mille|migliaio di giocate/.test(html));
})();

/* ─── le quote scritte a mano: l'unica fonte che non si puo' comprare ───

   Le quote delle partite in arrivo hanno una fonte sola e a volte manca. Non
   esiste un secondo canale gratuito (API-Football, misurato: "Free plans do
   not have access to this season"). Ma chi gioca ha in tasca una cosa che
   nessuna API puo' dare: le quote che vede davvero sul proprio conto.

   Le prove proteggono l'ordine di preferenza, che e' la parte che puo'
   rompersi in silenzio: dove c'e' il consenso di molti banchi si usa quello,
   perche' un banco solo e' una stima piu' rumorosa. Le scritte a mano riempiono
   il buco, non lo scavalcano. */
(function () {
  var html;
  try { html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); } catch (e) { return; }
  function estrai(n) {
    var i = html.indexOf('function ' + n + '(');
    if (i < 0) return null;
    var d = 0;
    for (var k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++;
      else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); }
    }
    return null;
  }
  var src = estrai('quoteDi');
  prova('quoteDi esiste', !!src);
  if (!src) return;
  var quoteDi = new Function('quotaMano', 'return ' + src + ';')(function (p) { return p._mano || null; });

  var mano = { q: [2.45, 3.30, 2.95] };
  prova('senza niente in archivio si usano le tue',
        JSON.stringify(quoteDi({ _mano: mano }).q) === JSON.stringify([2.45, 3.30, 2.95]));
  prova('e viene dichiarato che sono tue', quoteDi({ _mano: mano }).aMano === true);
  prova('la media dei bookmaker batte le tue: e un consenso, non un banco solo',
        JSON.stringify(quoteDi({ q: [2.5, 3.4, 2.8], _mano: mano }).q) ===
        JSON.stringify([2.5, 3.4, 2.8]));
  prova('e Betfair batte tutti: ricarico 0.5% invece di 5',
        JSON.stringify(quoteDi({ qex: [2.6, 3.5, 2.9], q: [2.5, 3.4, 2.8], _mano: mano }).q) ===
        JSON.stringify([2.6, 3.5, 2.9]));
  prova('con le quote scaricate non si dice che sono a mano',
        quoteDi({ q: [2.5, 3.4, 2.8], _mano: mano }).aMano === false);
  prova('senza niente del tutto non si inventa niente',
        quoteDi({}).q === null && quoteDi({}).aMano === false);

  prova('la scheda per scriverle esiste', /function cardQuoteAMano/.test(html));
  prova('chiede tre numeri, non cinque: l\'Over e facoltativo',
        /facoltativo/.test(html) && /function salvaQuoteMano/.test(html));
  prova('una quota impossibile non viene salvata',
        /if\(!q\.every\(function\(x\)\{ return x > 1; \}\)\) return;/.test(html));
  prova('mostra il ricarico mentre si scrive, che e il punto',
        /function anteprimaQuoteMano[\s\S]{0,700}si sta prendendo/.test(html));
  prova('restano sul telefono: nessun server',
        /CHIAVE_QUOTE_MANO[\s\S]{0,400}localStorage/.test(html));
  prova('e cambiandole si butta la simulazione tenuta in memoria',
        /function salvaQuoteAMano[\s\S]{0,240}S\._sim = null/.test(html));
})();

/* ─── quando l'ancoraggio e' spento, l'app deve dirlo ───

   Le quote delle partite in arrivo hanno una fonte sola. Quando quel file non
   porta la Serie A — misurato: succede, e succede in silenzio — l'ancoraggio si
   spegne e il modello parla da solo, che e' la sua versione peggiore e l'unica
   che soffre la maledizione del vincitore. Un punto singolo di rottura e' un
   problema; un punto singolo di rottura MUTO e' il problema. */
(function () {
  var html;
  try { html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); } catch (e) { return; }

  prova('l\'avviso per la giornata senza quote esiste',
        /function avvisoSenzaQuote/.test(html));
  prova('e guarda le quote vere, exchange comprese',
        /avvisoSenzaQuote[\s\S]{0,700}!\(p\.qex \|\| p\.q\)/.test(html));
  prova('viene mostrato in Giornata, non sepolto nel dettaglio',
        /h \+= avvisoSenzaQuote\(g\.partite\);/.test(html));
  prova('dice quanto costa, col numero preso dal backtest e non scritto a mano',
        /avvisoSenzaQuote[\s\S]{0,1400}confronto\.modello\.rps/.test(html));
  prova('e nomina la maledizione del vincitore, che e il vero motivo',
        /avvisoSenzaQuote[\s\S]{0,2400}maledizione del/.test(html));
  prova('non scatta quando le quote ci sono',
        /if\(!senza\) return '';/.test(html));

  /* La griglia dell'ancoraggio deve contenere la risposta misurata. */
  var mot = fs.readFileSync(path.join(__dirname, '..', 'modello.js'), 'utf8');
  var g = mot.match(/var ancore = opzioni\.ancore \|\| \[([^\]]*)\]/);
  prova('la griglia dell\'ancoraggio esiste', !!g);
  if (g) {
    var v = g[1].split(',').map(function (x) { return parseFloat(x); });
    prova('e arriva a UNO: senza, il backtest non puo scegliere la risposta misurata',
          v.indexOf(1) >= 0, g[1]);
    prova('ed e crescente', v.every(function (x, i) { return i === 0 || x > v[i - 1]; }), g[1]);
  }
  prova('e il perche e scritto accanto, con gli strumenti che l\'hanno misurato',
        /misura_mercati\.js[\s\S]{0,300}misura_apertura\.js/.test(mot));
  prova('lo strumento sull\'apertura esiste',
        fs.existsSync(path.join(__dirname, 'misura_apertura.js')));
})();

/* ─── i multigol: onesti e monotoni insieme ───

   Accendendo i multigol l'app propone Multigol 1-4 su nove partite su dieci.
   Misurato: la regola resta calibrata (0.4σ), quindi non e' rotta — dice pero'
   la stessa cosa in ogni partita, e una previsione che non cambia da partita a
   partita non informa su nessuna. Le prove qui sotto proteggono le due cose che
   possono rompersi in silenzio: che l'avviso ci sia quando serve, e che i
   numeri misurati non vengano ricopiati male. */
(function () {
  var html;
  try { html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); } catch (e) { return; }

  prova('tutti i multigol stanno in una famiglia sola',
        /mg12:'multigol'[\s\S]{0,300}mg03:'multigol'/.test(html));
  prova('esiste l\'avviso per quando la stessa selezione esce dappertutto',
        /function avvisoMonotonia[\s\S]{0,900}esce su/.test(html));
  prova('e scatta sopra i due terzi, non a caso',
        /conta\[top\] \/ tot < 0\.6/.test(html));
  prova('l\'avviso dice che NON e rotto, perche misurato non lo e',
        /non e rotto|non è rotto/.test(html));
  prova('la manopola solida/distintiva esiste', /function sceltaDistintiva/.test(html));
  prova('e la distintiva chiede uno scarto dalla media di giornata',
        /vuoleDistintiva\(\)[\s\S]{0,500}Math\.abs\(m\.scarto[^)]*\) >= 0\.03/.test(html));
  prova('se nessuna e distintiva si torna alla piu solida invece di non proporre niente',
        /if\(dist\.length\) pagante = dist;/.test(html));
  prova('tutte e due le posizioni portano i numeri misurati, non solo una',
        /79\.9%[\s\S]{0,2000}69\.9%/.test(html));
  prova('e dicono anche il prezzo: quante selezioni diverse escono',
        /2\.6[\s\S]{0,200}selezioni diverse|selezioni diverse[\s\S]{0,200}2\.6/.test(html) &&
        /5\.3/.test(html));
  prova('lo strumento che ha prodotto quei numeri esiste',
        fs.existsSync(path.join(__dirname, 'misura_multigol.js')));
})();

/* ─── il mese: una domanda diversa dal valore atteso ───

   "Voglio chiudere il mese in attivo" non e' "voglio guadagnare", e le due
   risposte sono spesso opposte. Il conto si regge su un'identita' che va
   protetta con una prova, perche' se si rompe tutta la scheda mente in modo
   credibile: il valore atteso di un mese dipende SOLO dal numero di gambe, non
   da quante schedine si fanno. */
(function () {
  var p = 0.75, ric = 0.056, B = 20, G = 4;
  function struttura(L, m) {
    var sel = [], i;
    /* una volta per gamba: il prodotto delle gambe compone il resto */
    for (i = 0; i < L * m; i++) sel.push({ p: p, quota: (1 / p) / (1 + ric) });
    var gruppi = [], g, j;
    for (g = 0; g < m; g++) { var gr = []; for (j = 0; j < L; j++) gr.push(g * L + j); gruppi.push(gr); }
    var d = M.distribuzioneRitorni(sel, gruppi, B);
    return { d: d, r: M.probMeseInAttivo(d, G) };
  }
  var a = struttura(3, 2), b = struttura(3, 4), c = struttura(1, 4);

  prova('la distribuzione dei ritorni somma a uno',
        Math.abs(Object.keys(a.d.mappa).reduce(function (s, k) { return s + a.d.mappa[k]; }, 0) - 1) < 1e-9);
  prova('il mese spende quattro giornate', a.r.speso === B * G, a.r.speso);
  prova('l\'atteso del mese dipende SOLO dalle gambe, non da quante schedine',
        Math.abs(a.r.atteso - b.r.atteso) < 0.05,
        a.r.atteso.toFixed(3) + ' vs ' + b.r.atteso.toFixed(3));
  prova('e vale budget / (1+ricarico)^gambe, che e la formula da cui parte tutto',
        Math.abs(a.r.atteso - B * G / Math.pow(1 + ric, 3)) < 0.05,
        a.r.atteso.toFixed(3) + ' vs ' + (B * G / Math.pow(1 + ric, 3)).toFixed(3));
  prova('meno gambe = ritorno medio migliore, sempre', c.r.atteso > a.r.atteso);
  prova('ma la probabilita di chiudere in attivo NON e la stessa a parita di gambe',
        Math.abs(a.r.pAttivo - b.r.pAttivo) > 0.02,
        (100 * a.r.pAttivo).toFixed(1) + '% vs ' + (100 * b.r.pAttivo).toFixed(1) + '%');
  prova('e concentrare aiuta, quando il gioco e sfavorevole', a.r.pAttivo > b.r.pAttivo,
        (100 * a.r.pAttivo).toFixed(1) + '% vs ' + (100 * b.r.pAttivo).toFixed(1) + '%');
  prova('le probabilita restano probabilita',
        a.r.pAttivo >= 0 && a.r.pAttivo <= 1 && b.r.pAttivo >= 0 && b.r.pAttivo <= 1);

  /* Il controllo che smaschera un errore di convoluzione: con UNA sola
     giornata il conto deve coincidere con l'enumerazione diretta. */
  var sel1 = [], i;
  for (i = 0; i < 3; i++) sel1.push({ p: p, quota: (1 / p) / (1 + ric) });
  var uno = M.probMeseInAttivo(M.distribuzioneRitorni(sel1, [[0, 1, 2]], B), 1);
  var diretto = M.profiloGiocata(sel1, [[0, 1, 2]], B);
  prova('su una giornata sola la convoluzione coincide con l\'enumerazione',
        Math.abs(uno.atteso - diretto.atteso) < 0.05 &&
        Math.abs(uno.pAttivo - diretto.pAttivo) < 0.005,
        uno.atteso.toFixed(3) + '/' + diretto.atteso.toFixed(3));

  var html;
  try { html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); } catch (e) { return; }
  prova('la scheda del mese non da per scontato che concentrare vinca',
        /best\.L === 1[\s\S]{0,900}vanno d\\'accordo/.test(html));
  prova('e dice sempre quanto costa quella probabilita',
        /costo > 0\.05[\s\S]{0,400}comprando/.test(html));
})();

/* ─── QUALI partite in QUALE schedina ───

   Per anni l'app ne ha usata una sola, senza saperlo: le selezioni arrivavano
   ordinate dalla piu' solida in giu' e si riempiva la prima schedina, poi la
   seconda. Non era una scelta, era l'ordine dell'array. Misurato su 25
   giornate vere (tools/misura_ripartizione.js), ripartire cambia fino a 0.73
   punti di probabilita' di chiudere il mese in attivo, e non costa NIENTE in
   valore atteso — e quella gratuita' e' esattamente la cosa che va protetta da
   una prova, perche' se un giorno si rompe non da' errori: da' numeri
   plausibili e sbagliati. */
(function () {
  var casi = [[4, 2, 3], [6, 2, 15], [8, 2, 105], [10, 2, 945],
              [6, 3, 10], [9, 3, 280], [8, 4, 35], [12, 4, 5775],
              [5, 5, 1], [3, 1, 1]];
  var tutteOk = true, formulaOk = true;
  casi.forEach(function (c) {
    var l = M.ripartizioni(c[0], c[1], 100000);
    if (l.length !== c[2]) tutteOk = false;
    if (M.quanteRipartizioni(c[0], c[1]) !== c[2]) formulaOk = false;
  });
  prova('le ripartizioni sono quelle che dice il calcolo combinatorio', tutteOk);
  prova('e contarle senza costruirle da lo stesso numero', formulaOk);

  var l9 = M.ripartizioni(9, 3, 100000);
  var copre = l9.every(function (g) {
    var visti = {}, quanti = 0;
    g.forEach(function (gr) { gr.forEach(function (i) { visti[i] = 1; quanti++; }); });
    return quanti === 9 && Object.keys(visti).length === 9 &&
           g.length === 3 && g.every(function (gr) { return gr.length === 3; });
  });
  prova('ogni ripartizione usa ogni selezione una volta sola', copre);

  var chiavi = {};
  l9.forEach(function (g) {
    chiavi[g.map(function (gr) { return gr.slice().sort().join(','); }).sort().join('|')] = 1;
  });
  prova('e non ce ne sono due uguali travestite da diverse',
        Object.keys(chiavi).length === l9.length,
        Object.keys(chiavi).length + ' distinte su ' + l9.length);

  prova('il limite taglia prima di esplodere, invece di piantare il telefono',
        M.ripartizioni(12, 4, 50).length === 50);
  prova('una richiesta impossibile torna vuota, non a meta',
        M.ripartizioni(7, 3, 100).length === 0 && M.quanteRipartizioni(7, 3) === 0);

  /* Il cuore: a parita' di gambe il valore atteso NON si muove di un
     centesimo, qualunque ripartizione si scelga, mentre la probabilita' di
     chiudere in attivo si muove. E' il motivo per cui questa scelta esiste. */
  var ric = 0.056, B = 20, G = 4;
  var ps = [0.84, 0.80, 0.77, 0.74, 0.70, 0.62];
  function valuta(gruppi) {
    var finte = gruppi.map(function (g) {
      var P = 1;
      g.forEach(function (i) { P *= ps[i]; });
      return { p: P, quota: (1 / P) / Math.pow(1 + ric, g.length) };
    });
    var soli = finte.map(function (_, i) { return [i]; });
    return M.probMeseInAttivo(M.distribuzioneRitorni(finte, soli, B), G);
  }
  var tutte = M.ripartizioni(6, 3, 100).map(valuta);
  var attesi = tutte.map(function (r) { return r.atteso; });
  var pAttivi = tutte.map(function (r) { return r.pAttivo; });
  var scartoAtteso = Math.max.apply(null, attesi) - Math.min.apply(null, attesi);
  var scartoP = Math.max.apply(null, pAttivi) - Math.min.apply(null, pAttivi);
  prova('ripartire non sposta il valore atteso di un centesimo',
        scartoAtteso < 1e-9, scartoAtteso.toExponential(1));
  prova('e vale budget / (1+ricarico)^gambe, ripartizione qualunque',
        Math.abs(attesi[0] - B * G / Math.pow(1 + ric, 3)) < 0.05,
        attesi[0].toFixed(3));
  prova('ma sposta la probabilita di chiudere in attivo, ed e gratis',
        scartoP > 0.005, (100 * scartoP).toFixed(2) + ' punti fra la migliore e la peggiore');

  /* Le schedine non condividono gambe e le gambe sono indipendenti, quindi le
     SCHEDINE sono indipendenti: la giornata si puo' enumerare su 2^schedine
     invece che su 2^gambe. E' la scorciatoia che rende il conto sostenibile su
     un telefono, e qui si controlla che non menta. */
  var gruppi = [[0, 1, 2], [3, 4, 5]];
  var gambe = ps.map(function (p) { return { p: p, quota: (1 / p) / (1 + ric) }; });
  var lungo = M.probMeseInAttivo(M.distribuzioneRitorni(gambe, gruppi, B), G);
  var corto = valuta(gruppi);
  prova('enumerare le schedine invece delle gambe da lo stesso identico numero',
        Math.abs(lungo.pAttivo - corto.pAttivo) < 1e-6 &&
        Math.abs(lungo.atteso - corto.atteso) < 1e-6,
        lungo.pAttivo.toFixed(8) + ' vs ' + corto.pAttivo.toFixed(8));

  var html;
  try { html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'); } catch (e) { return; }
  prova('l\'app cerca la ripartizione invece di prendere l\'ordine dell\'array',
        /ripartizioneMigliore/.test(html) && /M\.ripartizioni\(/.test(html));
  prova('e le schedine hanno un nome e delle partite, non solo "2 da 3"',
        /function cardLeTueSchedine/.test(html));

  /* Il difetto peggiore che quest'app possa avere e' dire due cose diverse
     sulla stessa partita, e per un pezzo l'ha fatto: il conto del mese pescava
     il massimo pavimento fra TUTTI i mercati, saltando la manopola della
     prudenza, mentre la Giornata mostrava la selezione filtrata. Su
     Torino-Udinese il mese proponeva Under 4.5 all'87%, che in Giornata non
     compare. Nessun errore e nessun numero sbagliato: solo due risposte. */
  prova('il conto del mese pesca le stesse selezioni della Giornata',
        /function cercaStruttureMese\(\)\{\s*\n\s*var tutte = ancoreTutteLeLeghe\(\);/.test(html) &&
        /function ancoreTutteLeLeghe\(\)[\s\S]{0,400}ancoreGiornata\(\)/.test(html));
  prova('e le pesca da TUTTI i campionati: e il motivo per cui ci sono',
        /perOgniLega\(function\(lega\)\{[\s\S]{0,200}ancoreGiornata\(\)/.test(html));
  prova('ogni selezione si porta dietro il suo campionato, o due partite si confondono',
        /a\.iPartita = lega\.id \+ ':' \+ a\.iPartita/.test(html) &&
        /c\.iPartita = lega\.id \+ ':' \+ c\.iPartita/.test(html));
  prova('e i puntatori tornano al loro posto anche se un campionato inciampa',
        /function perOgniLega[\s\S]{0,900}\} finally \{[\s\S]{0,200}S\.doc = eraDoc/.test(html));
  prova('e quelle selezioni sono la scelta della copertina, manopola compresa',
        /function ancoreGiornata\(\)[\s\S]{0,400}sceltePartita\(p, 1\)[\s\S]{0,120}sc\.ancora/.test(html));
  /* Il comando delle schedine e' UNO: la quota che vuoi. Le due tabelle
     erano diventate un secondo comando che diceva un'altra cosa — la forma —
     e due manopole che litigano sono peggio di una manopola sola. */
  prova('il comando delle schedine e la quota, non la forma',
        /function impostaRischio/.test(html) && !/impostaForma/.test(html));
  prova('e le fasce di rischio sono quattro, dalla prudente alla molto alta',
        /FASCE_RISCHIO = \[[\s\S]{0,900}molto/.test(html));

  /* ─── la schermata di caricamento ───

     Venti secondi di barra grigia sono venti secondi in cui sembra che l'app
     sia morta. Adesso c'e' un corridore, e la cosa che conta e' che avanzi in
     proporzione all'avanzamento VERO: una barra che arriva sempre in fondo
     comunque vada e' una bugia, e questa app non ne dice. */
  prova('il corridore avanza con l\'avanzamento vero, non con un timer',
        /function schermataCarico[\s\S]{0,700}S\.avanzamento/.test(html) &&
        /class="corsa" style="left:' \+ nu\(q \* 100/.test(html));
  prova('lo sprite ha quattro pose intere, non arti che ruotano',
        (html.match(/class="p[1-4]"/g) || []).length === 4);
  prova('e si alternano una alla volta',
        /@keyframes sprite\{0%,24\.9%\{opacity:1\} 25%,100%\{opacity:0\}\}/.test(html));
  prova('chi ha chiesto meno movimento non se lo prende comunque',
        /prefers-reduced-motion:reduce[\s\S]{0,160}animation:none/.test(html));
  prova('la striscia del campo ha una larghezza, o il corridore resta fermo al centro',
        /\.campo\{position:relative;width:100%/.test(html));

  /* ─── il nome e il marchio ───

     Un'icona rotta non da' errori: da' un quadrato bianco sulla schermata
     Home, e ci si accorge settimane dopo. Qui si controlla che il data URI
     sia davvero un SVG e che il nome sia lo stesso dappertutto — titolo,
     manifest, icona iOS — perche' tre nomi diversi sono tre app diverse. */
  var favicon = /<link rel="icon" href="data:image\/svg\+xml,([^"]*)">/.exec(html);
  prova('la favicon c\'e ed e un SVG, non un quadrato bianco',
        !!favicon && decodeURIComponent(favicon[1]).indexOf('<svg') === 0);
  prova('e disegna la M sulla linea, non il cerchio di prima',
        !!favicon && /M52 122V54/.test(decodeURIComponent(favicon[1])) &&
        !/circle/.test(decodeURIComponent(favicon[1])));
  prova('il nome e lo stesso nel titolo e nell\'icona iOS',
        /<title>Monthline<\/title>/.test(html) &&
        /apple-mobile-web-app-title" content="Monthline"/.test(html));
  var man;
  try { man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8')); }
  catch (e) { man = null; }
  prova('e anche nel manifest, o sulla Home ne compare un altro',
        !!man && man.name === 'Monthline' && man.short_name === 'Monthline',
        man && man.name + ' / ' + man.short_name);
  prova('il marchio sta sul caricamento, l\'unica schermata senza numeri da mostrare',
        /class="marchio"[\s\S]{0,500}Monthline/.test(html));

  /* Il tetto sulle gambe. Era stato tolto per far funzionare "una da 10", e
     con quarantotto selezioni la tabella e' arrivata a proporre "1 da 48":
     una schedina che nessun banco accetta e che comunque non esce mai. */
  prova('la tabella del mese non propone schedine ingiocabili',
        /L <= Math\.min\(MAX_TABELLA, n\)/.test(html));
  prova('e c\'e un tetto anche sulle gambe della schedina proposta',
        /MAX_GAMBE = [1-9]/.test(html) &&
        parseInt((/MAX_GAMBE = (\d+)/.exec(html) || [0, 99])[1], 10) <= 8,
        (/MAX_GAMBE = (\d+)/.exec(html) || [])[1]);

  /* ─── due leggi che governano la scelta della schedina ───

     La prima: a parita' di quota MOSTRATA, il banco applica il ricarico una
     volta per gamba, quindi la probabilita' vera e' 1/(Q(1+r)^L) e CALA con le
     gambe. Arrivare a quota 5 con otto gambe invece che con una porta il mese
     in attivo dal 56.8% al 42.5%. Per questo si cerca il numero MINIMO di
     gambe, non il massimo. */
  var ric2 = 0.056, B2 = 20, G2 = 4;
  function meseAllaQuota(Q, L, m) {
    var pSlip = 1 / (Q * Math.pow(1 + ric2, L));
    var sel = [], gruppi = [], i;
    for (i = 0; i < m; i++) { sel.push({ p: pSlip, quota: Q }); gruppi.push([i]); }
    var d = M.distribuzioneRitorni(sel, gruppi, B2);
    return d ? M.probMeseInAttivo(d, G2) : null;
  }
  var scala = [1, 2, 4, 8].map(function (L) { return meseAllaQuota(5, L, 1).pAttivo; });
  prova('a parita di quota, ogni gamba in piu toglie probabilita di chiudere sopra',
        scala.every(function (v, i) { return i === 0 || v < scala[i - 1]; }),
        scala.map(function (v) { return (100 * v).toFixed(1) + '%'; }).join(' > '));
  prova('e otto gambe costano piu di dieci punti rispetto a una',
        (scala[0] - scala[3]) > 0.10, (100 * (scala[0] - scala[3])).toFixed(1) + ' punti');
  prova('quindi la ricerca preferisce la schedina corta a parita di risultato',
        /a\.L - b\.L/.test(html));

  /* La seconda, e rende molto di piu': per stare sopra serve un numero INTERO
     di vincite, e questo fa dei GRADINI. Con m schedine a giornata e quattro
     giornate, k vincite bastano quando Q > 4m/k. Cinque centesimi di quota
     possono valere trenta punti, e l'app puntava al centro della fascia. */
  var sotto = meseAllaQuota(1.98, 1, 1).pAttivo, sopra = meseAllaQuota(2.05, 1, 1).pAttivo;
  prova('cinque centesimi di quota valgono decine di punti, per via del gradino',
        (sopra - sotto) > 0.25,
        (100 * sotto).toFixed(1) + '% a 1.98  ->  ' + (100 * sopra).toFixed(1) + '% a 2.05');
  prova('e il salto sta dove dice la formula, a 4m/k',
        meseAllaQuota(1.95, 1, 1).pAttivo < meseAllaQuota(2.05, 1, 1).pAttivo);
  prova('l\'app calcola i bersagli invece di prendere il centro della fascia',
        /function quoteBersaglio/.test(html) && /GIORNATE_MESE \* m \/ k/.test(html));
  prova('e dice quante vincite servono, che e il numero che fa il gradino',
        /vinciteServono/.test(html) && /basta <b>una vincita<\/b>/.test(html));
})();

/* ─── il libro: la parte che non si puo' chiedere ───

   Tutto il resto di quest'app due persone lo ottengono uguale. Il libro no: e'
   fatto di giocate vere, a quote vere, su banchi veri. Le prove qui sotto
   guardano le due cose che possono rompersi in silenzio — il conto del
   ricarico e la scelta di quale dei due modi usare — perche' un ricarico
   sbagliato non da' nessun errore: da' solo numeri credibili e falsi. */
(function () {
  var html;
  try {
    html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  } catch (e) { return; }
  function estrai(n) {
    var i = html.indexOf('function ' + n + '(');
    if (i < 0) return null;
    var d = 0;
    for (var k = html.indexOf('{', i); k < html.length; k++) {
      if (html[k] === '{') d++;
      else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1); }
    }
    return null;
  }

  var src = estrai('_quotaMercatoDi');
  prova('il confronto col mercato esiste', !!src);
  if (!src) return;
  var _quotaMercatoDi = eval('(' + src + ')');            // eslint-disable-line no-eval
  var g = { qmax: [2.60, 3.52, 2.88], qoumax: [1.95, 2.00] };
  prova('1 legge la quota di casa', _quotaMercatoDi(_c(g, '1')) === 2.60);
  prova('X legge il pareggio', _quotaMercatoDi(_c(g, 'X')) === 3.52);
  prova('2 legge la trasferta', _quotaMercatoDi(_c(g, '2')) === 2.88);
  prova('Over 2.5 legge la quota Over', _quotaMercatoDi(_c(g, 'O25')) === 1.95);
  prova('Under 2.5 legge la quota Under', _quotaMercatoDi(_c(g, 'U25')) === 2.00);
  prova('un mercato senza quota di riferimento torna niente invece di inventarla',
        _quotaMercatoDi(_c(g, '1X')) == null);
  prova('e senza quote in archivio torna niente',
        _quotaMercatoDi({ mercato: '1' }) == null);
  function _c(base, m) { var o = { mercato: m }; for (var k in base) o[k] = base[k]; return o; }

  /* Il conto del ricarico. La quota migliore del mercato ha ricarico misurato
     zero, quindi (migliore / presa - 1) E' il ricarico del banco: se il banco
     ricarica il 5.5%, il conto deve tornare 5.5%. */
  var src2 = estrai('ricaricoDalLibro');
  prova('il ricarico dal libro esiste', !!src2);
  if (!src2) return;
  var finto = [];
  for (var i = 0; i < 10; i++) {
    var rif = 2.50;
    finto.push({ mercato: '1', qmax: [rif, 3.4, 2.9], presa: rif / 1.055, equa: rif });
  }
  /* si rimonta la funzione con le sue due dipendenze */
  var fabbrica = new Function('libro', '_quotaMercatoDi', 'return ' + src2 + ';');
  var f = fabbrica(function () { return finto; }, _quotaMercatoDi);
  var r = f();
  prova('con dieci giocate il ricarico si misura', !!r);
  prova('e ritrova il 5.5% che avevo messo dentro',
        r && Math.abs(r.v - 0.055) < 0.0005, r ? r.v.toFixed(4) : 'niente');
  prova('e dice di averlo misurato sul mercato, non sulla mia quota equa',
        r && r.come === 'mercato', r ? r.come : 'niente');
  prova('sotto le otto giocate non torna niente invece di un numero fragile',
        fabbrica(function () { return finto.slice(0, 5); }, _quotaMercatoDi)() == null);

  /* Senza quota di mercato ripiega sulla quota equa, e lo dichiara. */
  var senza = finto.map(function (x) { return { mercato: '1X', presa: x.presa, equa: x.equa }; });
  var r2 = fabbrica(function () { return senza; }, _quotaMercatoDi)();
  prova('senza confronto di mercato ripiega sulla quota equa', r2 && r2.come === 'equa',
        r2 ? r2.come : 'niente');

  prova('il quadrante del ricarico sa del libro',
        /function ricarichiDisponibili[\s\S]{0,400}ricaricoDalLibro\(\)/.test(html));
  prova('e la posizione del libro sta per prima, quando c\'e',
        /id:'mio'[\s\S]*?\.concat\(RICARICHI\)/.test(html) &&
        html.indexOf("id:'mio'") < html.indexOf('.concat(RICARICHI)'));
  prova('salvare il libro butta il ricarico tenuto in memoria',
        /function salvaLibro[\s\S]{0,200}S\.ricarico = null/.test(html));
  prova('l\'esito non lo scrive l\'utente: lo legge l\'app',
        /function esitoGiocata[\s\S]{0,400}M\.haVinto/.test(html));
  prova('il libro sta solo sul telefono: nessuna chiamata a un server',
        !/fetch\([^)]*libro|libro[^\n]*fetch\(/.test(html));
})();

var largh = esiti.reduce(function (a, e) { return Math.max(a, e[0].length); }, 0);
var falliti = 0;
esiti.forEach(function (e) {
  console.log((e[1] ? 'ok    ' : 'FALLITO ') + e[0].padEnd(largh) + (e[1] ? '' : '   → ' + e[2]));
  if (!e[1]) falliti++;
});
console.log('\n' + esiti.length + ' prove, ' + falliti + ' fallite');
process.exit(falliti ? 1 : 0);
