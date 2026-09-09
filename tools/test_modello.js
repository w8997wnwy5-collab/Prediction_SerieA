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
