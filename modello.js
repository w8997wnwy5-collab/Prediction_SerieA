/* ============================================================================
   modello.js — il motore. Nessun DOM qui dentro: gira uguale nel browser,
   dentro un Web Worker e sotto node, così si può testare davvero.

   Modello: Dixon-Coles (1997). Ogni squadra ha una forza d'attacco e una di
   difesa; i gol attesi di una partita escono da attacco di uno, difesa
   dell'altro e vantaggio del campo. Le partite vecchie pesano meno di quelle
   recenti. Una correzione sui punteggi bassi rimette a posto lo 0-0 e l'1-1,
   che il Poisson puro sottostima.

   Sopra ci sta un secondo modello identico ma stimato sui TIRI IN PORTA invece
   che sui gol: i tiri sono più numerosi, quindi più stabili, e dicono in
   anticipo quello che i gol diranno più avanti. I due vengono mescolati.
   ========================================================================= */

(function (radice) {
'use strict';

/* ─────────────────────────── numeri di base ─────────────────────────── */

var FATT = [1];
for (var _i = 1; _i < 25; _i++) FATT[_i] = FATT[_i - 1] * _i;

function poisson(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lam) * Math.pow(lam, k) / FATT[k];
}
function limita(v, min, max) { return v < min ? min : (v > max ? max : v); }
function media(a) { var t = 0, i; for (i = 0; i < a.length; i++) t += a[i]; return a.length ? t / a.length : 0; }
function giorni(a, b) { return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000; }

/* Correzione Dixon-Coles: solo i quattro risultati bassi vengono ritoccati. */
function tau(x, y, lam, mu, rho) {
  if (x === 0 && y === 0) return 1 - lam * mu * rho;
  if (x === 0 && y === 1) return 1 + lam * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/* ─────────────────────────── preparazione ─────────────────────────── */

/* Da tiri a gol attesi: un tiro in porta vale circa un terzo di gol, uno fuori
   quasi niente. I coefficienti non sono inventati: vengono ricalibrati sui dati
   in modo che la somma dei gol attesi coincida con i gol davvero segnati. */
function calibraTiri(partite) {
  var sg = 0, stp = 0, sf = 0, n = 0, i, p;
  for (i = 0; i < partite.length; i++) {
    p = partite[i];
    if (p.gc == null || p.tpc == null || p.tc == null) continue;
    sg += p.gc + p.gv;
    stp += p.tpc + p.tpv;
    sf += Math.max(0, (p.tc - p.tpc)) + Math.max(0, (p.tv - p.tpv));
    n++;
  }
  if (!n || stp <= 0) return null;
  /* quota dei gol spiegata dai tiri fuori: piccola e fissa, il resto ai tiri in porta */
  var pesoFuori = 0.022;
  var golDaFuori = sf * pesoFuori;
  var perTiroInPorta = Math.max(0.05, (sg - golDaFuori) / stp);
  return { inPorta: perTiroInPorta, fuori: pesoFuori, partite: n };
}

function xgDaTiri(p, cal) {
  if (!cal || p.tpc == null) return null;
  var fc = Math.max(0, (p.tc == null ? p.tpc : p.tc) - p.tpc);
  var fv = Math.max(0, (p.tv == null ? p.tpv : p.tv) - p.tpv);
  return [p.tpc * cal.inPorta + fc * cal.fuori, p.tpv * cal.inPorta + fv * cal.fuori];
}

/* Gli xG veri, dove ci sono, battono qualsiasi conto fatto sui tiri: un tiro da
   trenta metri e un tap-in valgono uno a testa nel conteggio dei tiri, e 0.02
   contro 0.7 negli xG. Ma le due scale non coincidono per forza, e mescolarle
   così com'è vorrebbe dire cambiare unità di misura a metà archivio. Quindi si
   misura lo scarto sulle partite che hanno ENTRAMBI e si riporta il conto sui
   tiri sulla scala degli xG veri, non viceversa: la scala buona è quella. */
function allineaXg(giocate, cal) {
  if (!cal) return null;
  var sVeri = 0, sTiri = 0, n = 0, i, p, prox;
  for (i = 0; i < giocate.length; i++) {
    p = giocate[i];
    if (p.xgc == null || p.xgv == null) continue;
    prox = xgDaTiri(p, cal);
    if (!prox) continue;
    sVeri += p.xgc + p.xgv; sTiri += prox[0] + prox[1]; n++;
  }
  if (n < 40 || sTiri <= 0) return null;
  return { fattore: limita(sVeri / sTiri, 0.6, 1.6), partite: n };
}

/* Costruisce la struttura su cui gira tutto: squadre indicizzate e righe compatte. */
function prepara(partite, opzioni) {
  opzioni = opzioni || {};
  var giocate = [], i, p;
  for (i = 0; i < partite.length; i++) {
    p = partite[i];
    if (p && p.gc != null && p.gv != null && p.c && p.v && p.d) giocate.push(p);
  }
  giocate.sort(function (a, b) { return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0); });

  /* Solo le squadre della stagione in corso interessano davvero, ma per stimarle
     servono anche le partite vecchie: teniamo tutti, filtriamo in uscita. */
  var indice = {}, squadre = [];
  function idx(nome) {
    if (indice[nome] == null) { indice[nome] = squadre.length; squadre.push(nome); }
    return indice[nome];
  }
  var cal = calibraTiri(giocate);
  var all = allineaXg(giocate, cal);
  var righe = [], nVeri = 0, nProxy = 0;
  for (i = 0; i < giocate.length; i++) {
    p = giocate[i];
    var xg = null, veri = false;
    if (p.xgc != null && p.xgv != null) { xg = [p.xgc, p.xgv]; veri = true; nVeri++; }
    else {
      xg = xgDaTiri(p, cal);
      if (xg && all) { xg = [xg[0] * all.fattore, xg[1] * all.fattore]; }
      if (xg) nProxy++;
    }
    righe.push({
      i: idx(p.c), j: idx(p.v), x: p.gc, y: p.gv, d: p.d,
      xgc: xg ? xg[0] : null, xgv: xg ? xg[1] : null, xgVeri: veri,
      ptc: p.ptc == null ? null : p.ptc, ptv: p.ptv == null ? null : p.ptv,
      arb: p.arb || null, s: p.s || null, q: p.q || null, qou: p.qou || null, rif: p
    });
  }
  return { squadre: squadre, indice: indice, righe: righe, calibrazioneTiri: cal,
           allineamentoXg: all, xgVeri: nVeri, xgDaTiri: nProxy,
           ultimaData: righe.length ? righe[righe.length - 1].d : null };
}

/* ─────────────────────────── stima ─────────────────────────── */

var PREDEF = {
  xi: 0.0028,        // decadimento giornaliero dei gol: mezza vita ≈ 250 giorni
  xiTiri: 0.0045,    // i tiri si stabilizzano prima, quindi memoria più corta
  ridge: 0.30,       // tira le forze verso la media: protegge le neopromosse
  iterazioni: 260,
  passo: 0.06,
  rho: 0,            // correzione punteggi bassi usata DENTRO la stima
  usaXg: false,      // se true stima sui gol attesi (xG veri, o dedotti dai tiri)
  usaPt: false       // se true stima sui gol del PRIMO TEMPO invece che finali
};

/* Da quale coppia di numeri si stima: i gol finali, i gol attesi o i gol del
   primo tempo. Una funzione sola, così stima e stimaRho non possono guardare
   due colonne diverse — che è esattamente il genere di sfasamento che poi si
   manifesta come "il modello del primo tempo dà numeri strani". */
function bersaglio(o) {
  if (o.usaXg) return function (r) { return [r.xgc, r.xgv]; };
  if (o.usaPt) return function (r) { return [r.ptc, r.ptv]; };
  return function (r) { return [r.x, r.y]; };
}

function nuoviParametri(nSquadre) {
  return { mu0: Math.log(1.35), gamma: 0.25, rho: 0,
           att: new Float64Array(nSquadre), dif: new Float64Array(nSquadre), n: nSquadre };
}

/* Massimizza la log-verosimiglianza di Poisson pesata nel tempo, con Adam.
   Il gradiente è analitico: per ogni partita l'errore è (gol osservati − gol attesi). */
function stima(dati, opzioni, iniziali) {
  var o = {}, k;
  for (k in PREDEF) o[k] = PREDEF[k];
  for (k in (opzioni || {})) if (opzioni[k] != null) o[k] = opzioni[k];

  var n = dati.squadre.length, righe = dati.righe;
  var fino = o.fino || dati.ultimaData;
  var par = nuoviParametri(n);
  if (iniziali && iniziali.n === n) {
    par.mu0 = iniziali.mu0; par.gamma = iniziali.gamma; par.rho = iniziali.rho;
    par.att.set(iniziali.att); par.dif.set(iniziali.dif);
  }

  /* righe utilizzabili e pesi temporali, calcolati una volta sola */
  var uso = [], pesi = [], i, r, w;
  for (i = 0; i < righe.length; i++) {
    r = righe[i];
    if (r.d >= fino) continue;                       // niente sbirciate nel futuro
    if (o.usaXg && r.xgc == null) continue;
    if (o.usaPt && r.ptc == null) continue;
    w = Math.exp(-o.xi * Math.max(0, giorni(r.d, fino)));
    if (w < 1e-4) continue;
    uso.push(r); pesi.push(w);
  }
  if (uso.length < 30) return { par: par, ok: false, n: uso.length };

  var quali = bersaglio(o);
  var mAtt = new Float64Array(n), vAtt = new Float64Array(n);
  var mDif = new Float64Array(n), vDif = new Float64Array(n);
  var mMu = 0, vMu = 0, mGa = 0, vGa = 0;
  var b1 = 0.9, b2 = 0.999, eps = 1e-8, rhoFisso = o.rho || 0;
  var gAtt = new Float64Array(n), gDif = new Float64Array(n);

  for (var it = 1; it <= o.iterazioni; it++) {
    gAtt.fill(0); gDif.fill(0);
    var gMu = 0, gGa = 0;
    for (i = 0; i < uso.length; i++) {
      r = uso[i]; w = pesi[i];
      var b_ = quali(r), xi_ = b_[0], yi_ = b_[1];
      var lam = limita(Math.exp(par.mu0 + par.att[r.i] - par.dif[r.j] + par.gamma), 0.03, 8);
      var mu_ = limita(Math.exp(par.mu0 + par.att[r.j] - par.dif[r.i]), 0.03, 8);
      var ex = w * (xi_ - lam), ey = w * (yi_ - mu_);
      /* la correzione sui punteggi bassi non è un ritocco finale: entra nel
         gradiente, altrimenti il livello dei gol resta storto */
      if (rhoFisso !== 0 && !o.usaXg && xi_ < 2 && yi_ < 2) {   /* interi: gol finali o di primo tempo */
        var tv = tau(xi_, yi_, lam, mu_, rhoFisso);
        if (tv > 1e-6) {
          if (xi_ === 0 && yi_ === 0) { ex += w * (-lam * mu_ * rhoFisso) / tv; ey += w * (-lam * mu_ * rhoFisso) / tv; }
          else if (xi_ === 0 && yi_ === 1) { ex += w * (lam * rhoFisso) / tv; }
          else if (xi_ === 1 && yi_ === 0) { ey += w * (mu_ * rhoFisso) / tv; }
        }
      }
      gMu += ex + ey;
      gGa += ex;
      gAtt[r.i] += ex; gAtt[r.j] += ey;
      gDif[r.j] -= ex; gDif[r.i] -= ey;
    }
    for (i = 0; i < n; i++) { gAtt[i] -= o.ridge * par.att[i]; gDif[i] -= o.ridge * par.dif[i]; }

    var corr1 = 1 - Math.pow(b1, it), corr2 = 1 - Math.pow(b2, it);
    mMu = b1 * mMu + (1 - b1) * gMu; vMu = b2 * vMu + (1 - b2) * gMu * gMu;
    par.mu0 += o.passo * (mMu / corr1) / (Math.sqrt(vMu / corr2) + eps);
    mGa = b1 * mGa + (1 - b1) * gGa; vGa = b2 * vGa + (1 - b2) * gGa * gGa;
    par.gamma += o.passo * (mGa / corr1) / (Math.sqrt(vGa / corr2) + eps);
    for (i = 0; i < n; i++) {
      mAtt[i] = b1 * mAtt[i] + (1 - b1) * gAtt[i];
      vAtt[i] = b2 * vAtt[i] + (1 - b2) * gAtt[i] * gAtt[i];
      par.att[i] += o.passo * (mAtt[i] / corr1) / (Math.sqrt(vAtt[i] / corr2) + eps);
      mDif[i] = b1 * mDif[i] + (1 - b1) * gDif[i];
      vDif[i] = b2 * vDif[i] + (1 - b2) * gDif[i] * gDif[i];
      par.dif[i] += o.passo * (mDif[i] / corr1) / (Math.sqrt(vDif[i] / corr2) + eps);
    }
    /* identificabilità: attacco e difesa medi a zero, il livello sta in mu0 */
    var ma = 0, md = 0;
    for (i = 0; i < n; i++) { ma += par.att[i]; md += par.dif[i]; }
    ma /= n; md /= n;
    for (i = 0; i < n; i++) { par.att[i] -= ma; par.dif[i] -= md; }
    par.mu0 += ma - md;
    par.gamma = limita(par.gamma, -0.4, 0.9);
  }

  par.rho = o.usaXg ? 0 : stimaRho(par, uso, pesi, quali);
  par.osservazioni = uso.length;
  par.pesoTotale = pesi.reduce(function (a, b) { return a + b; }, 0);
  return { par: par, ok: true, n: uso.length };
}

/* rho si stima da solo, dopo: una ricerca in una dimensione sola sui punteggi bassi. */
function stimaRho(par, uso, pesi, quali) {
  quali = quali || function (r) { return [r.x, r.y]; };
  function ll(rho) {
    var t = 0;
    for (var i = 0; i < uso.length; i++) {
      var r = uso[i], b = quali(r);
      if (b[0] > 1 || b[1] > 1) continue;
      var lam = limita(Math.exp(par.mu0 + par.att[r.i] - par.dif[r.j] + par.gamma), 0.03, 8);
      var mu_ = limita(Math.exp(par.mu0 + par.att[r.j] - par.dif[r.i]), 0.03, 8);
      var v = tau(b[0], b[1], lam, mu_, rho);
      if (v <= 1e-8) return -1e12;
      t += pesi[i] * Math.log(v);
    }
    return t;
  }
  var a = -0.22, b = 0.22, gr = (Math.sqrt(5) - 1) / 2, c, d, fc, fd;
  c = b - gr * (b - a); d = a + gr * (b - a);
  fc = ll(c); fd = ll(d);
  for (var k = 0; k < 34; k++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = ll(c); }
    else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = ll(d); }
  }
  return limita((a + b) / 2, -0.2, 0.2);
}

/* ─────────────────────────── previsione ─────────────────────────── */

function attesi(par, i, j, agg) {
  agg = agg || {};
  var attC = par.att[i] + (agg.attC || 0), difC = par.dif[i] + (agg.difC || 0);
  var attV = par.att[j] + (agg.attV || 0), difV = par.dif[j] + (agg.difV || 0);
  return [
    limita(Math.exp(par.mu0 + attC - difV + par.gamma), 0.05, 7),
    limita(Math.exp(par.mu0 + attV - difC), 0.05, 7)
  ];
}

function matriceRisultati(lam, mu, rho, n) {
  n = n || 11;
  var pl = [], pm = [], i, j;
  for (i = 0; i < n; i++) { pl.push(poisson(i, lam)); pm.push(poisson(i, mu)); }
  var m = [], tot = 0;
  for (i = 0; i < n; i++) {
    m.push([]);
    for (j = 0; j < n; j++) {
      var v = pl[i] * pm[j] * Math.max(1e-9, tau(i, j, lam, mu, rho));
      m[i].push(v); tot += v;
    }
  }
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) m[i][j] /= tot;
  return m;
}

function esiti(m) {
  var n = m.length, i, j, p;
  var casa = 0, pari = 0, via = 0, over = 0, gol = 0, gc = 0, gv = 0;
  var risultati = [];
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
    p = m[i][j];
    if (i > j) casa += p; else if (i === j) pari += p; else via += p;
    if (i + j > 2) over += p;
    if (i > 0 && j > 0) gol += p;
    gc += p * i; gv += p * j;
    if (i < 6 && j < 6) risultati.push({ r: i + '-' + j, p: p });
  }
  risultati.sort(function (a, b) { return b.p - a.p; });
  return {
    casa: casa, pari: pari, via: via,
    over25: over, under25: 1 - over, gol: gol, nogol: 1 - gol,
    golCasa: gc, golVia: gv, totale: gc + gv,
    risultati: risultati.slice(0, 6),
    puntiCasa: casa * 3 + pari, puntiVia: via * 3 + pari
  };
}

/* ───────────────── ancoraggio al mercato ─────────────────

   Il backtest dice una cosa scomoda e sempre uguale: sulle partite con quote,
   il mercato è più preciso di questo modello. Fino a ieri l'app si limitava a
   dirtelo. Dirlo e non usarlo è spreco: le quote di chiusura contengono le
   formazioni, gli infortuni e i soldi di chi rischia davvero, cioè esattamente
   le tre cose che a un modello statistico mancano.

   Però non basta ricopiare le quote, per due motivi. Il primo è che le quote
   coprono l'1X2 e l'Over/Under, non i quaranta mercati che l'app calcola. Il
   secondo è che una probabilità copiata non si può più confrontare col mercato
   per cercare valore: il confronto darebbe zero per costruzione.

   La soluzione è ancorare la MATRICE, non le probabilità. Si cercano i due gol
   attesi che riproducono quello che dice il mercato su due assi — quanto è
   squilibrata la partita (1X2) e quanti gol si aspetta (Over/Under) — e da
   quella matrice ricadono tutti gli altri mercati, che ereditano l'informazione
   del mercato anche dove il mercato non è quotato. La previsione pura resta
   disponibile a parte, ed è quella che si usa per cercare valore. */

function daQuoteOU(qou) {
  if (!qou || qou.length < 2) return null;
  var a = 1 / qou[0], b = 1 / qou[1], s = a + b;
  if (!(s > 0)) return null;
  return a / s;                                   // probabilità di Over
}

/* Fonde due probabilità in scala log-odds: è il modo giusto di mediarle, perché
   media aritmetica fra 2% e 8% dà 5% ma la distanza vera fra i due è un fattore
   quattro, non sei punti. */
function fondiLogit(p, q, w) {
  if (q == null) return p;
  var a = Math.log(Math.max(1e-9, p) / Math.max(1e-9, 1 - p));
  var b = Math.log(Math.max(1e-9, q) / Math.max(1e-9, 1 - q));
  return 1 / (1 + Math.exp(-((1 - w) * a + w * b)));
}
function fondiTre(p, q, w) {
  if (!q) return p;
  var o = [], t = 0, i;
  for (i = 0; i < 3; i++) {
    o.push(Math.pow(Math.max(1e-9, p[i]), 1 - w) * Math.pow(Math.max(1e-9, q[i]), w));
    t += o[i];
  }
  for (i = 0; i < 3; i++) o[i] /= t;
  return o;
}

/* Da una coppia di gol attesi ai due numeri che ci interessano: lo squilibrio
   (quanto pende da una parte) e la quota di partite oltre le 2.5 reti.

   Questa funzione viene chiamata qualche centinaio di volte per ogni partita
   ancorata, e nel backtest qualche milione di volte in tutto: costruire ogni
   volta la matrice intera è lo spreco che rendeva il ricalcolo insopportabile
   su un telefono. Si sfrutta il fatto che le due marginali sono indipendenti —
   la correzione di Dixon-Coles tocca quattro caselle e basta — così i conti
   diventano lineari invece che quadratici, e le quattro caselle si aggiustano
   a mano alla fine. Il risultato è identico alla matrice, cifra per cifra. */
function _sintesi(lam, mu, rho) {
  var n = 11, pl = new Array(n), pm = new Array(n), i;
  for (i = 0; i < n; i++) { pl[i] = poisson(i, lam); pm[i] = poisson(i, mu); }
  var sl = 0, sm = 0, casa = 0, via = 0, cumL = 0, cumM = 0;
  var cm = new Array(n), cl = new Array(n);
  for (i = 0; i < n; i++) { cl[i] = cumL; cumL += pl[i]; cm[i] = cumM; cumM += pm[i]; }
  sl = cumL; sm = cumM;
  for (i = 0; i < n; i++) { casa += pl[i] * cm[i]; via += pm[i] * cl[i]; }
  var sotto = pl[0] * (pm[0] + pm[1] + pm[2]) + pl[1] * (pm[0] + pm[1]) + pl[2] * pm[0];
  /* lo stesso pavimento che mette matriceRisultati: con rho grande e molti gol
     attesi la correzione andrebbe sotto zero, e una probabilità negativa non è
     una correzione, è un errore */
  var d00 = pl[0] * pm[0] * (Math.max(1e-9, tau(0, 0, lam, mu, rho)) - 1);
  var d01 = pl[0] * pm[1] * (Math.max(1e-9, tau(0, 1, lam, mu, rho)) - 1);
  var d10 = pl[1] * pm[0] * (Math.max(1e-9, tau(1, 0, lam, mu, rho)) - 1);
  var d11 = pl[1] * pm[1] * (Math.max(1e-9, tau(1, 1, lam, mu, rho)) - 1);
  var tot = sl * sm + d00 + d01 + d10 + d11;
  if (!(tot > 0)) return { squilibrio: 0, over: 0.5 };
  return { squilibrio: ((casa + d10) - (via + d01)) / tot,
           over: (sl * sm - sotto) / tot };
}

/* Due incognite, due bersagli, entrambi monotoni: il totale fa salire l'Over,
   e spostare gol dalla trasferta alla casa fa salire lo squilibrio. Due bisezioni
   annidate ci arrivano senza derivate e senza poter divergere. */
function _risolvi(lam, mu, rho, bersaglioSquilibrio, bersaglioOver) {
  var totale = lam + mu;
  if (!(totale > 0)) return [lam, mu];

  function conQuota(a, T) {            // a = quota di gol attesi alla squadra di casa
    return [limita(T * a, 0.05, 7), limita(T * (1 - a), 0.05, 7)];
  }
  function quotaPerSquilibrio(T) {
    if (bersaglioSquilibrio == null) return limita(lam / totale, 0.05, 0.95);
    var lo = 0.05, hi = 0.95, k, mid, g;
    for (k = 0; k < 17; k++) {
      mid = (lo + hi) / 2;
      g = conQuota(mid, T);
      if (_sintesi(g[0], g[1], rho).squilibrio < bersaglioSquilibrio) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  if (bersaglioOver == null) {
    var g0 = conQuota(quotaPerSquilibrio(totale), totale);
    return g0;
  }
  var lo = Math.max(0.3, totale * 0.35), hi = Math.min(9, totale * 2.4), k, mid, g;
  for (k = 0; k < 17; k++) {
    mid = (lo + hi) / 2;
    g = conQuota(quotaPerSquilibrio(mid), mid);
    if (_sintesi(g[0], g[1], rho).over < bersaglioOver) lo = mid; else hi = mid;
  }
  mid = (lo + hi) / 2;
  return conQuota(quotaPerSquilibrio(mid), mid);
}

/* Restituisce i gol attesi ancorati e i due fattori moltiplicativi che ci sono
   voluti. I fattori servono alla simulazione: si applicano a ogni giro senza
   rifare la ricerca, così la fascia di incertezza resta quella del modello e
   non viene schiacciata dall'ancoraggio. */
function ancoraMercato(lam, mu, rho, opz) {
  opz = opz || {};
  var w1 = opz.peso1x2 == null ? 0 : opz.peso1x2;
  var wOU = opz.pesoOU == null ? w1 : opz.pesoOU;
  var q = opz.q ? daQuote(opz.q) : null;
  var pOU = opz.qou ? daQuoteOU(opz.qou) : null;
  var senzaNulla = { lam: lam, mu: mu, fattoreCasa: 1, fattoreVia: 1, usato: false,
                     pesoUsato: 0, mercato1x2: q, mercatoOver: pOU };
  if ((!q || w1 <= 0) && (pOU == null || wOU <= 0)) return senzaNulla;

  var base = matriceRisultati(lam, mu, rho, 11), e = esiti(base);
  var mie = [e.casa, e.pari, e.via];
  var bersaglioSq = null, bersaglioOver = null;
  if (q && w1 > 0) {
    var fusa = fondiTre(mie, q, w1);
    bersaglioSq = fusa[0] - fusa[2];
  }
  if (pOU != null && wOU > 0) {
    bersaglioOver = fondiLogit(e.over25, pOU, wOU);
  }
  var g = _risolvi(lam, mu, rho, bersaglioSq, bersaglioOver);
  return { lam: g[0], mu: g[1],
           fattoreCasa: lam > 0 ? g[0] / lam : 1, fattoreVia: mu > 0 ? g[1] / mu : 1,
           usato: true, pesoUsato: Math.max(q ? w1 : 0, pOU != null ? wOU : 0),
           mercato1x2: q, mercatoOver: pOU };
}

/* I gol attesi del solo modello, prima che il mercato ci metta bocca. */
function golAttesiModello(modello, i, j, opz) {
  var peso = opz.pesoTiri == null ? modello.pesoTiri : opz.pesoTiri;
  var g = attesi(modello.gol, i, j, opz.agg);
  var lam = g[0], mu = g[1];
  if (modello.tiri && peso > 0) {
    var t = attesi(modello.tiri, i, j, opz.agg);
    lam = (1 - peso) * lam + peso * t[0];
    mu = (1 - peso) * mu + peso * t[1];
  }
  /* Quando non c'è nessuna quota a cui ancorarsi resta un difetto misurato nel
     backtest: il modello è leggermente timido, tiene le partite più in bilico
     di come finiscono. Si allarga lo squilibrio di un fattore stimato lì, senza
     toccare il totale dei gol. */
  var stiro = opz.stiro == null ? (modello.stiro == null ? 1 : modello.stiro) : opz.stiro;
  if (stiro && stiro !== 1) {
    var tot = lam + mu, dif = (lam - mu) * stiro;
    lam = limita((tot + dif) / 2, 0.05, 7);
    mu = limita((tot - dif) / 2, 0.05, 7);
  }
  return [lam, mu];
}

/* Previsione completa di una partita: due modelli mescolati, la matrice, e —
   se ci sono quote — l'ancoraggio al mercato. Escono ENTRAMBE le letture: quella
   ancorata, che è la migliore stima disponibile, e quella pura, che è l'unica
   con cui ha senso cercare valore contro il banco. */
function prevedi(modello, casa, via, opz) {
  opz = opz || {};
  var i = modello.indice[casa], j = modello.indice[via];
  if (i == null || j == null) return null;
  var g = golAttesiModello(modello, i, j, opz);
  var lam = g[0], mu = g[1], rho = modello.gol.rho;

  var mPuro = matriceRisultati(lam, mu, rho, 11);
  var puro = esiti(mPuro);
  puro.lambdaCasa = lam; puro.lambdaVia = mu; puro.matrice = mPuro;

  var anc = ancoraMercato(lam, mu, rho, {
    q: opz.q, qou: opz.qou,
    peso1x2: opz.peso1x2 == null ? (modello.ancoraggio || 0) : opz.peso1x2,
    pesoOU: opz.pesoOU == null ? (modello.ancoraggioOU == null ? modello.ancoraggio : modello.ancoraggioOU) : opz.pesoOU
  });
  var e;
  if (anc.usato) {
    var m = matriceRisultati(anc.lam, anc.mu, rho, 11);
    e = esiti(m);
    e.lambdaCasa = anc.lam; e.lambdaVia = anc.mu; e.matrice = m;
  } else {
    e = puro;
  }
  e.puro = puro;
  e.ancoraggio = anc;
  var quoteHT = quotePrimoTempo(modello, i, j, opz.agg);
  if (quoteHT) {
    e.tempi = mercatiTempi(e.lambdaCasa, e.lambdaVia, rho, quoteHT);
    e.primoFinale = primoFinale(e.lambdaCasa, e.lambdaVia, rho, quoteHT);
    e.quotePrimoTempo = quoteHT;
  }
  e.casaNome = casa; e.viaNome = via;
  return e;
}

/* ───────────────────── incertezza: quanto NON sappiamo ───────────────────── */

/* Le forze stimate non sono la verità: sono la miglior lettura di un campione.
   Rigiocando lo stesso campionato con la stessa fortuna diversa, verrebbero
   numeri un po' diversi. Il bootstrap misura proprio questo: si ricampiona
   l'archivio con ripetizione e si ristima. La dispersione dei risultati è
   l'incertezza vera del modello, quella che poi diventa una fascia invece di
   un numero secco. */
function bootstrap(dati, opzioni, K, parBase) {
  opzioni = opzioni || {};
  K = K || 20;
  var righeOrig = dati.righe, n = righeOrig.length, k, i;
  if (n < 200 || !parBase) return [];
  var seme = 12345;
  function rnd() {                    /* deterministico: stessi dati, stessa risposta */
    seme = (seme * 1103515245 + 12345) & 0x7fffffff;
    return seme / 0x7fffffff;
  }
  function poissonCasuale(lam) {
    /* Knuth: per i valori piccoli di una partita di calcio va benissimo */
    var L = Math.exp(-lam), p = 1, x = -1;
    do { x++; p *= rnd(); } while (p > L && x < 20);
    return x;
  }
  /* Ricampionare le partite a caso sembra la cosa ovvia, ma rompe una cosa che
     nel calcio è vera per costruzione: ogni squadra gioca 38 partite, metà in
     casa e metà fuori. Un campionato ricampionato è più sbilanciato di
     qualunque campionato vero, e l'incertezza esce gonfiata.
     Si tiene quindi fisso il calendario e si rigiocano i RISULTATI, pescandoli
     dal modello stimato. È la stessa domanda, posta bene: se questo campionato
     si rigiocasse con la stessa fortuna diversa, che forze stimeremmo? */
  var repliche = [];
  for (k = 0; k < K; k++) {
    var campione = new Array(n);
    for (i = 0; i < n; i++) {
      var r0 = righeOrig[i];
      var lam = limita(Math.exp(parBase.mu0 + parBase.att[r0.i] - parBase.dif[r0.j] + parBase.gamma), 0.03, 8);
      var mu = limita(Math.exp(parBase.mu0 + parBase.att[r0.j] - parBase.dif[r0.i]), 0.03, 8);
      campione[i] = { i: r0.i, j: r0.j, d: r0.d, s: r0.s,
                      x: poissonCasuale(lam), y: poissonCasuale(mu),
                      xgc: r0.xgc, xgv: r0.xgv };
    }
    var finti = { squadre: dati.squadre, indice: dati.indice, righe: campione,
                  calibrazioneTiri: dati.calibrazioneTiri, ultimaData: dati.ultimaData };
    var r = stima(finti, { xi: opzioni.xi, ridge: opzioni.ridge, fino: opzioni.fino,
                           iterazioni: opzioni.iterazioni || 120, rho: parBase.rho }, parBase);
    if (r.ok) repliche.push({ mu0: r.par.mu0, gamma: r.par.gamma, rho: r.par.rho,
                              att: Array.prototype.slice.call(r.par.att),
                              dif: Array.prototype.slice.call(r.par.dif) });
  }
  return repliche;
}

/* Dalle repliche del bootstrap a un numero per parametro: di quanto può
   sbagliarsi la forza di ogni squadra. Con poche repliche i percentili sarebbero
   a scalini, quindi si usa la loro dispersione per pescare da una normale:
   la fascia resta liscia e non finge una precisione che non c'è. */
function sintesiBootstrap(repliche, nSquadre) {
  if (!repliche || repliche.length < 4) return null;
  var K = repliche.length, i, k;
  var se = { att: new Float64Array(nSquadre), dif: new Float64Array(nSquadre), gamma: 0, mu0: 0 };
  function scarto(valori) {
    var m = 0, q = 0, z;
    for (z = 0; z < valori.length; z++) m += valori[z];
    m /= valori.length;
    for (z = 0; z < valori.length; z++) q += (valori[z] - m) * (valori[z] - m);
    return Math.sqrt(q / Math.max(1, valori.length - 1));
  }
  for (i = 0; i < nSquadre; i++) {
    var a = [], d = [];
    for (k = 0; k < K; k++) { a.push(repliche[k].att[i]); d.push(repliche[k].dif[i]); }
    se.att[i] = scarto(a);
    se.dif[i] = scarto(d);
  }
  se.gamma = scarto(repliche.map(function (r) { return r.gamma; }));
  se.mu0 = scarto(repliche.map(function (r) { return r.mu0; }));
  se.repliche = K;
  /* Il centro delle repliche non coincide con la stima piena: ricampionando,
     certe squadre finiscono con meno partite e la regolarizzazione le schiaccia
     un po' di più verso la media. Se si usassero le repliche così come sono, la
     probabilità media scivolerebbe verso il 50-50. Si tiene quindi la stima
     piena come centro e dalle repliche si prende solo lo SCOSTAMENTO. */
  var centro = { att: new Float64Array(nSquadre), dif: new Float64Array(nSquadre), gamma: 0, mu0: 0 };
  for (i = 0; i < nSquadre; i++) {
    for (k = 0; k < K; k++) { centro.att[i] += repliche[k].att[i]; centro.dif[i] += repliche[k].dif[i]; }
    centro.att[i] /= K; centro.dif[i] /= K;
  }
  for (k = 0; k < K; k++) { centro.gamma += repliche[k].gamma; centro.mu0 += repliche[k].mu0; }
  centro.gamma /= K; centro.mu0 /= K;
  se.centro = centro;
  return se;
}

/* Quanto pesa un'espulsione, misurato invece che immaginato: si confrontano i
   gol segnati e subiti da chi resta in dieci con quelli di tutti gli altri. */
function effettoRosso(partite, modello) {
  /* Confrontare chi resta in dieci con la media della lega non basta: il rosso
     lo prende più spesso chi sta già soffrendo, e il conto verrebbe gonfiato.
     Se c'è un modello si usa quello che LUI si aspettava da quella partita: così
     il confronto è con la squadra giusta, non con una squadra media. */
  var attesiF = 0, attesiS = 0, fattiF = 0, fattiS = 0, nCon = 0;
  var rossi = 0, nPartite = 0, i, p;
  for (i = 0; i < partite.length; i++) {
    p = partite[i];
    if (p.gc == null || p.rc == null) continue;
    nPartite++;
    rossi += (p.rc || 0 ? 1 : 0) + (p.rv || 0 ? 1 : 0);
    var rc = (p.rc || 0) > 0, rv = (p.rv || 0) > 0;
    if (rc === rv) continue;                    /* nessuno o entrambi: non dice niente */
    var casaInDieci = rc;
    var iC = modello ? modello.indice[p.c] : null, iV = modello ? modello.indice[p.v] : null;
    var att;
    if (modello && iC != null && iV != null) {
      att = attesi(modello.gol, iC, iV);
    } else {
      att = [1.45, 1.15];                       /* senza modello: medie di lega ragionevoli */
    }
    if (casaInDieci) { attesiF += att[0]; attesiS += att[1]; fattiF += p.gc; fattiS += p.gv; }
    else { attesiF += att[1]; attesiS += att[0]; fattiF += p.gv; fattiS += p.gc; }
    nCon++;
  }
  var prob = nPartite > 50 ? limita(rossi / (2 * nPartite), 0.005, 0.25) : 0.05;
  var base = { attacco: 0.80, difesa: 1.28, prob: prob, misurato: false, n: nCon };
  if (nCon < 40 || attesiF <= 0 || attesiS <= 0) return base;
  /* si tira il risultato verso "nessun effetto" in proporzione a quanto è magro
     il campione: con 40 partite non si riscrive la letteratura */
  var forza = Math.min(1, nCon / 150);
  var att0 = fattiF / attesiF, dif0 = fattiS / attesiS;
  return {
    attacco: limita(1 + (att0 - 1) * forza, 0.45, 1.05),
    difesa: limita(1 + (dif0 - 1) * forza, 0.95, 2.2),
    prob: prob, misurato: true, n: nCon
  };
}

/* ───────────────────── mercati ─────────────────────

   Tutto quello che segue esce da UNA matrice: la probabilità congiunta di ogni
   punteggio. Non ci sono formule separate per l'Over, per il Gol/Gol e per le
   combo, e non è un dettaglio da programmatori: significa che i mercati non
   possono contraddirsi fra loro. Un "1 + Over 2.5" calcolato a parte potrebbe
   risultare più probabile del solo "1", che è impossibile; sommato dalla
   matrice, non può. */

var CAMPI_MERCATO = null;

function mercatiDaMatrice(m) {
  var n = m.length, i, j, p, t, d;
  var s = {
    casa: 0, pari: 0, via: 0, gol: 0,
    o05: 0, o15: 0, o25: 0, o35: 0, o45: 0, o55: 0,
    mg13: 0, mg24: 0, mg15: 0, mg12: 0, mg23: 0, mg34: 0, mg14: 0, mg25: 0, mg03: 0,
    segnaC: 0, segnaV: 0, cnp: 0, vnp: 0,
    c1x: 0, cx2: 0, c12: 0,
    /* totali di squadra */
    tc05: 0, tc15: 0, tc25: 0, tv05: 0, tv15: 0, tv25: 0,
    /* vittoria senza subire */
    cSecca: 0, vSecca: 0,
    /* handicap europeo a una e due reti */
    h1c: 0, h1x: 0, h1v: 0, h2c: 0, h2v: 0,
    /* margine */
    m1: 0, m2: 0, m3p: 0,
    /* gol esatti in tutta la partita */
    g0: 0, g1: 0, g2: 0, g3: 0, g4p: 0,
    /* combinazioni: esito e gol insieme, prese dalla stessa matrice */
    c1o25: 0, c1u25: 0, cXo25: 0, cXu25: 0, c2o25: 0, c2u25: 0,
    c1xo25: 0, cx2o25: 0, c1xu25: 0, cx2u25: 0,
    ggo25: 0, ngu25: 0, ggo35: 0, c1gg: 0, c2gg: 0, cXgg: 0
  };
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
    p = m[i][j];
    if (p <= 0) continue;
    t = i + j; d = i - j;
    if (d > 0) s.casa += p; else if (d === 0) s.pari += p; else s.via += p;
    if (i > 0 && j > 0) s.gol += p;
    if (i > 0) s.segnaC += p;
    if (j > 0) s.segnaV += p;
    if (j === 0) s.cnp += p;
    if (i === 0) s.vnp += p;
    if (t > 0.5) s.o05 += p;
    if (t > 1.5) s.o15 += p;
    if (t > 2.5) s.o25 += p;
    if (t > 3.5) s.o35 += p;
    if (t > 4.5) s.o45 += p;
    if (t > 5.5) s.o55 += p;
    if (t >= 1 && t <= 3) s.mg13 += p;
    if (t >= 2 && t <= 4) s.mg24 += p;
    if (t >= 1 && t <= 5) s.mg15 += p;
    if (t >= 1 && t <= 2) s.mg12 += p;
    if (t >= 2 && t <= 3) s.mg23 += p;
    if (t >= 3 && t <= 4) s.mg34 += p;
    if (t >= 1 && t <= 4) s.mg14 += p;
    if (t >= 2 && t <= 5) s.mg25 += p;
    if (t <= 3) s.mg03 += p;
    if (i >= 1) s.tc05 += p;
    if (i >= 2) s.tc15 += p;
    if (i >= 3) s.tc25 += p;
    if (j >= 1) s.tv05 += p;
    if (j >= 2) s.tv15 += p;
    if (j >= 3) s.tv25 += p;
    if (d > 0 && j === 0) s.cSecca += p;
    if (d < 0 && i === 0) s.vSecca += p;
    if (d >= 2) s.h1c += p; else if (d === 1) s.h1x += p; else s.h1v += p;
    if (d >= 3) s.h2c += p;
    if (d <= -3) s.h2v += p;
    if (d === 1 || d === -1) s.m1 += p;
    else if (d === 2 || d === -2) s.m2 += p;
    else if (d >= 3 || d <= -3) s.m3p += p;
    if (t === 0) s.g0 += p; else if (t === 1) s.g1 += p;
    else if (t === 2) s.g2 += p; else if (t === 3) s.g3 += p; else s.g4p += p;
    if (d > 0 && t > 2.5) s.c1o25 += p;
    if (d > 0 && t < 2.5) s.c1u25 += p;
    if (d === 0 && t > 2.5) s.cXo25 += p;
    if (d === 0 && t < 2.5) s.cXu25 += p;
    if (d < 0 && t > 2.5) s.c2o25 += p;
    if (d < 0 && t < 2.5) s.c2u25 += p;
    if (d >= 0 && t > 2.5) s.c1xo25 += p;
    if (d <= 0 && t > 2.5) s.cx2o25 += p;
    if (d >= 0 && t < 2.5) s.c1xu25 += p;
    if (d <= 0 && t < 2.5) s.cx2u25 += p;
    if (i > 0 && j > 0 && t > 2.5) s.ggo25 += p;
    if (i > 0 && j > 0 && t > 3.5) s.ggo35 += p;
    if ((i === 0 || j === 0) && t < 2.5) s.ngu25 += p;
    if (d > 0 && i > 0 && j > 0) s.c1gg += p;
    if (d < 0 && i > 0 && j > 0) s.c2gg += p;
    if (d === 0 && i > 0 && j > 0) s.cXgg += p;
  }
  /* le doppie chance si sommano QUI, dentro ogni simulazione: sommare i
     percentili di due mercati separati gonfierebbe la fascia */
  s.c1x = s.casa + s.pari;
  s.cx2 = s.via + s.pari;
  s.c12 = s.casa + s.via;
  return s;
}

/* L'elenco dei mercati giocabili. Ogni voce dichiara da quale campo della
   matrice viene e se va letta al contrario (gli Under sono il complemento
   degli Over): così la fascia di incertezza si aggancia da sola, senza una
   tabella di corrispondenze da tenere allineata a mano — che è il posto dove
   questi errori si nascondono meglio. */
function elencoMercati(s, nomiSquadre) {
  var c = nomiSquadre ? nomiSquadre[0] : 'casa', v = nomiSquadre ? nomiSquadre[1] : 'trasferta';
  function m(id, nome, gruppo, campo, inverso) {
    var p = inverso ? 1 - s[campo] : s[campo];
    return { id: id, nome: nome, gruppo: gruppo, campo: campo, inverso: !!inverso, p: p };
  }
  return [
    m('1', 'Vince ' + c, 'Esito', 'casa'),
    m('X', 'Pareggio', 'Esito', 'pari'),
    m('2', 'Vince ' + v, 'Esito', 'via'),
    m('1X', c + ' non perde', 'Doppia chance', 'c1x'),
    m('X2', v + ' non perde', 'Doppia chance', 'cx2'),
    m('12', 'Non finisce pari', 'Doppia chance', 'c12'),
    m('O05', 'Almeno un gol', 'Gol totali', 'o05'),
    m('O15', 'Over 1.5', 'Gol totali', 'o15'),
    m('U15', 'Under 1.5', 'Gol totali', 'o15', true),
    m('O25', 'Over 2.5', 'Gol totali', 'o25'),
    m('U25', 'Under 2.5', 'Gol totali', 'o25', true),
    m('O35', 'Over 3.5', 'Gol totali', 'o35'),
    m('U35', 'Under 3.5', 'Gol totali', 'o35', true),
    m('O45', 'Over 4.5', 'Gol totali', 'o45'),
    m('U45', 'Under 4.5', 'Gol totali', 'o45', true),
    m('MG12', 'Multigol 1-2', 'Gol totali', 'mg12'),
    m('MG13', 'Multigol 1-3', 'Gol totali', 'mg13'),
    m('MG14', 'Multigol 1-4', 'Gol totali', 'mg14'),
    m('MG23', 'Multigol 2-3', 'Gol totali', 'mg23'),
    m('MG24', 'Multigol 2-4', 'Gol totali', 'mg24'),
    m('MG25', 'Multigol 2-5', 'Gol totali', 'mg25'),
    m('MG34', 'Multigol 3-4', 'Gol totali', 'mg34'),
    m('MG15', 'Multigol 1-5', 'Gol totali', 'mg15'),
    m('GG', 'Segnano entrambe', 'Chi segna', 'gol'),
    m('NG', 'Non segnano entrambe', 'Chi segna', 'gol', true),
    m('SC', c + ' segna', 'Chi segna', 'segnaC'),
    m('SV', v + ' segna', 'Chi segna', 'segnaV'),
    m('CNP', c + ' non subisce', 'Chi segna', 'cnp'),
    m('VNP', v + ' non subisce', 'Chi segna', 'vnp'),
    m('TC05', c + ' segna almeno 1', 'Gol di squadra', 'tc05'),
    m('TC15', c + ' segna almeno 2', 'Gol di squadra', 'tc15'),
    m('TC25', c + ' segna almeno 3', 'Gol di squadra', 'tc25'),
    m('TV05', v + ' segna almeno 1', 'Gol di squadra', 'tv05'),
    m('TV15', v + ' segna almeno 2', 'Gol di squadra', 'tv15'),
    m('TV25', v + ' segna almeno 3', 'Gol di squadra', 'tv25'),
    m('CSECCA', c + ' vince senza subire', 'Handicap e margine', 'cSecca'),
    m('VSECCA', v + ' vince senza subire', 'Handicap e margine', 'vSecca'),
    m('H1C', c + ' vince con 2+ gol di scarto', 'Handicap e margine', 'h1c'),
    m('H2C', c + ' vince con 3+ gol di scarto', 'Handicap e margine', 'h2c'),
    m('H1V', v + ' vince con 2+ gol di scarto', 'Handicap e margine', 'h1v'),
    m('H2V', v + ' vince con 3+ gol di scarto', 'Handicap e margine', 'h2v'),
    m('M1', 'Si decide per un gol', 'Handicap e margine', 'm1'),
    m('G0', 'Finisce 0-0', 'Gol esatti', 'g0'),
    m('G1', 'Un gol in tutto', 'Gol esatti', 'g1'),
    m('G2', 'Due gol in tutto', 'Gol esatti', 'g2'),
    m('G3', 'Tre gol in tutto', 'Gol esatti', 'g3'),
    m('G4P', 'Quattro gol o più', 'Gol esatti', 'g4p'),
    m('1O25', c + ' vince + Over 2.5', 'Combinazioni', 'c1o25'),
    m('1U25', c + ' vince + Under 2.5', 'Combinazioni', 'c1u25'),
    m('XO25', 'Pareggio + Over 2.5', 'Combinazioni', 'cXo25'),
    m('XU25', 'Pareggio + Under 2.5', 'Combinazioni', 'cXu25'),
    m('2O25', v + ' vince + Over 2.5', 'Combinazioni', 'c2o25'),
    m('2U25', v + ' vince + Under 2.5', 'Combinazioni', 'c2u25'),
    m('1XO25', c + ' non perde + Over 2.5', 'Combinazioni', 'c1xo25'),
    m('X2O25', v + ' non perde + Over 2.5', 'Combinazioni', 'cx2o25'),
    m('1XU25', c + ' non perde + Under 2.5', 'Combinazioni', 'c1xu25'),
    m('X2U25', v + ' non perde + Under 2.5', 'Combinazioni', 'cx2u25'),
    m('GGO25', 'Gol/Gol + Over 2.5', 'Combinazioni', 'ggo25'),
    m('GGO35', 'Gol/Gol + Over 3.5', 'Combinazioni', 'ggo35'),
    m('NGU25', 'NoGol + Under 2.5', 'Combinazioni', 'ngu25'),
    m('1GG', c + ' vince + Gol/Gol', 'Combinazioni', 'c1gg'),
    m('2GG', v + ' vince + Gol/Gol', 'Combinazioni', 'c2gg'),
    m('XGG', 'Pareggio + Gol/Gol', 'Combinazioni', 'cXgg')
  ];
}

/* I nomi dei campi, una volta sola: servono alla simulazione per sapere di che
   cosa deve tenere il conto giro per giro. */
function campiMercato() {
  if (!CAMPI_MERCATO) CAMPI_MERCATO = Object.keys(mercatiDaMatrice(matriceRisultati(1, 1, 0, 3)));
  return CAMPI_MERCATO;
}

/* ───────────────────── primo e secondo tempo ─────────────────────

   L'archivio contiene il punteggio all'intervallo di ogni partita, e fino a
   ieri non lo guardava nessuno: 1910 righe di dati buoni buttate. Da lì esce un
   secondo modello, identico al primo ma stimato sui gol del primo tempo, e con
   quello si aprono i mercati sui tempi.

   Il punto delicato è tenere insieme le due letture. Se il primo tempo avesse
   un modello suo del tutto indipendente, la somma dei due tempi non farebbe il
   risultato finale, e l'app direbbe due cose diverse sulla stessa partita. Qui
   invece il modello del primo tempo serve solo a decidere COME SI DIVIDONO i
   gol attesi fra i due tempi; il totale resta quello del modello finale, quello
   ancorato al mercato. Così le due letture non possono litigare. */

function quotePrimoTempo(modello, i, j, agg) {
  if (!modello.primoTempo) return null;
  var ft = attesi(modello.gol, i, j, agg);
  var ht = attesi(modello.primoTempo, i, j, agg);
  return [limita(ht[0] / Math.max(0.05, ft[0]), 0.20, 0.70),
          limita(ht[1] / Math.max(0.05, ft[1]), 0.20, 0.70)];
}

var CAMPI_TEMPI = ['pt1', 'ptX', 'pt2', 'pt1x', 'ptx2', 'pt12', 'ptO05', 'ptO15', 'ptGG',
                   'st1', 'stX', 'st2', 'stO05', 'stO15', 'golEntrambi', 'piuSecondo'];

/* Da due matrici piccole (primo tempo, secondo tempo) ai mercati sui tempi.
   Otto reti per tempo bastano: oltre, la probabilità è sotto il miliardesimo. */
function mercatiTempi(lam, mu, rho, quote, dentro) {
  var s = dentro || {};
  var k;
  for (k = 0; k < CAMPI_TEMPI.length; k++) s[CAMPI_TEMPI[k]] = 0;
  if (!quote) return s;
  var l1 = limita(lam * quote[0], 0.02, 5), m1 = limita(mu * quote[1], 0.02, 5);
  var l2 = limita(lam - l1, 0.02, 5), m2 = limita(mu - m1, 0.02, 5);
  var A = matriceRisultati(l1, m1, rho, 8), B = matriceRisultati(l2, m2, rho, 8);
  var i, j, p, n = 8;
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
    p = A[i][j];
    if (i > j) s.pt1 += p; else if (i === j) s.ptX += p; else s.pt2 += p;
    if (i + j > 0) s.ptO05 += p;
    if (i + j > 1) s.ptO15 += p;
    if (i > 0 && j > 0) s.ptGG += p;
    p = B[i][j];
    if (i > j) s.st1 += p; else if (i === j) s.stX += p; else s.st2 += p;
    if (i + j > 0) s.stO05 += p;
    if (i + j > 1) s.stO15 += p;
  }
  s.pt1x = s.pt1 + s.ptX; s.ptx2 = s.pt2 + s.ptX; s.pt12 = s.pt1 + s.pt2;
  /* i due tempi si trattano come indipendenti: quello che succede prima
     dell'intervallo cambia il punteggio, non le forze in campo */
  s.golEntrambi = s.ptO05 * s.stO05;
  s.piuSecondo = 0;
  var tA = [], tB = [], t;
  for (t = 0; t < 2 * n; t++) { tA.push(0); tB.push(0); }
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) { tA[i + j] += A[i][j]; tB[i + j] += B[i][j]; }
  for (i = 0; i < 2 * n; i++) for (j = 0; j < 2 * n; j++) if (j > i) s.piuSecondo += tA[i] * tB[j];
  return s;
}

/* Primo tempo / finale: nove caselle. Si convolvono le due matrici invece di
   inventarsi una regola: il primo tempo decide la casella di partenza, il
   secondo dove si arriva. */
function primoFinale(lam, mu, rho, quote) {
  if (!quote) return null;
  var l1 = limita(lam * quote[0], 0.02, 5), m1 = limita(mu * quote[1], 0.02, 5);
  var l2 = limita(lam - l1, 0.02, 5), m2 = limita(mu - m1, 0.02, 5);
  var A = matriceRisultati(l1, m1, rho, 7), B = matriceRisultati(l2, m2, rho, 7);
  var g = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], a, b, c, d, seg, fin, tot = 0;
  for (a = 0; a < 7; a++) for (b = 0; b < 7; b++) {
    if (A[a][b] < 1e-9) continue;
    seg = a > b ? 0 : (a === b ? 1 : 2);
    for (c = 0; c < 7; c++) for (d = 0; d < 7; d++) {
      var p = A[a][b] * B[c][d];
      if (p < 1e-12) continue;
      fin = (a + c) > (b + d) ? 0 : ((a + c) === (b + d) ? 1 : 2);
      g[seg][fin] += p; tot += p;
    }
  }
  if (tot > 0) for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) g[a][b] /= tot;
  return g;
}

function elencoTempi(s, nomiSquadre) {
  if (!s || s.pt1 == null) return [];
  var c = nomiSquadre ? nomiSquadre[0] : 'casa', v = nomiSquadre ? nomiSquadre[1] : 'trasferta';
  function m(id, nome, campo) {
    return { id: id, nome: nome, gruppo: 'Primo tempo', campo: campo, inverso: false, p: s[campo] };
  }
  return [
    m('PT1', c + ' avanti all\'intervallo', 'pt1'),
    m('PTX', 'Pari all\'intervallo', 'ptX'),
    m('PT2', v + ' avanti all\'intervallo', 'pt2'),
    m('PT1X', c + ' non sotto all\'intervallo', 'pt1x'),
    m('PTX2', v + ' non sotto all\'intervallo', 'ptx2'),
    m('PTO05', 'Gol nel primo tempo', 'ptO05'),
    m('PTO15', 'Over 1.5 primo tempo', 'ptO15'),
    m('PTGG', 'Segnano entrambe nel primo tempo', 'ptGG'),
    m('STO05', 'Gol nel secondo tempo', 'stO05'),
    m('STO15', 'Over 1.5 secondo tempo', 'stO15'),
    m('GENT', 'Gol in entrambi i tempi', 'golEntrambi'),
    m('PIU2T', 'Più gol nel secondo tempo', 'piuSecondo')
  ];
}

/* ───────────────────── simulazione ───────────────────── */

/* Il punto della simulazione non è rifare quello che la matrice già calcola.
   È aggiungere le due cose che la matrice dà per scontate:
     · le forze delle squadre sono NOTE  → invece sono stimate, e ogni giro ne
       pesca una versione diversa fra quelle plausibili;
     · la partita fila liscia            → invece qualcuno può restare in dieci,
       e l'effetto è misurato sull'archivio.
   Quello che esce non è una probabilità, ma una fascia di probabilità. */
function simula(modello, casa, via, opz) {
  opz = opz || {};
  var N = opz.N || 3000;
  var i = modello.indice[casa], j = modello.indice[via];
  if (i == null || j == null) return null;
  /* Meglio pescare una replica intera del bootstrap che perturbare ogni forza
     per conto suo: dentro una replica attacco, difesa e vantaggio del campo si
     muovono INSIEME come si muovono davvero. Trattandoli come indipendenti la
     fascia si gonfia e il modello sembra più ignorante di quanto sia. */
  var centro = modello.se && modello.se.centro ? modello.se.centro : null;
  var repliche = (modello.repliche && modello.repliche.length >= 8 && centro) ? modello.repliche : null;
  var se = repliche ? null : (modello.se || null);
  var rosso = modello.effettoRosso || { attacco: 0.78, difesa: 1.32, prob: 0.10 };
  var pRossoC = opz.pRossoCasa != null ? opz.pRossoCasa : (rosso.prob || 0.10);
  var pRossoV = opz.pRossoVia != null ? opz.pRossoVia : (rosso.prob || 0.10);
  var agg = opz.agg || {};
  var peso = opz.pesoTiri == null ? modello.pesoTiri : opz.pesoTiri;

  var stiro = opz.stiro == null ? (modello.stiro == null ? 1 : modello.stiro) : opz.stiro;

  var seme = 987654321;
  function rnd() { seme = (seme * 1103515245 + 12345) & 0x7fffffff; return seme / 0x7fffffff; }
  function gauss() {
    var u = 1 - rnd(), w = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  }

  var centrale = golAttesiModello(modello, i, j, { pesoTiri: peso, agg: agg, stiro: stiro });
  var ancCentro = ancoraMercato(centrale[0], centrale[1], modello.gol.rho, {
    q: opz.q, qou: opz.qou,
    peso1x2: opz.peso1x2 == null ? (modello.ancoraggio || 0) : opz.peso1x2,
    pesoOU: opz.pesoOU == null ? (modello.ancoraggioOU == null ? modello.ancoraggio : modello.ancoraggioOU) : opz.pesoOU
  });
  var fattC = ancCentro.fattoreCasa, fattV = ancCentro.fattoreVia;

  var esitiSim = [], conta = {}, k, campi;
  var somma = null, sommaGolC = 0, sommaGolV = 0;
  var risultatiConta = {};
  var rossoCasa = 0, rossoVia = 0;
  campi = campiMercato();
  var quoteHT = quotePrimoTempo(modello, i, j, agg);
  if (quoteHT) campi = campi.concat(CAMPI_TEMPI);
  somma = {};
  for (k = 0; k < campi.length; k++) somma[campi[k]] = 0;
  var quadrati = {};
  for (k = 0; k < campi.length; k++) quadrati[campi[k]] = 0;
  var campione = [];

  for (var n = 0; n < N; n++) {
    var par = modello.gol, parT = modello.tiri;
    /* la stessa scossa di incertezza vale per entrambi i modelli: sono stimati
       sulle stesse partite, se sbagliano lo fanno insieme */
    var dAttC = 0, dDifC = 0, dAttV = 0, dDifV = 0, dGamma = 0, dMu0 = 0;
    if (repliche) {
      var r = repliche[(rnd() * repliche.length) | 0];
      dAttC = r.att[i] - centro.att[i]; dDifC = r.dif[i] - centro.dif[i];
      dAttV = r.att[j] - centro.att[j]; dDifV = r.dif[j] - centro.dif[j];
      dGamma = r.gamma - centro.gamma; dMu0 = r.mu0 - centro.mu0;
    } else if (se) {
      dAttC = se.att[i] * gauss(); dDifC = se.dif[i] * gauss();
      dAttV = se.att[j] * gauss(); dDifV = se.dif[j] * gauss();
      dGamma = se.gamma * gauss(); dMu0 = se.mu0 * gauss();
    }
    var rho = par.rho;
    function coppia(pp) {
      var aC = pp.att[i] + dAttC + (agg.attC || 0), dC = pp.dif[i] + dDifC + (agg.difC || 0);
      var aV = pp.att[j] + dAttV + (agg.attV || 0), dV = pp.dif[j] + dDifV + (agg.difV || 0);
      return [limita(Math.exp(pp.mu0 + dMu0 + aC - dV + pp.gamma + dGamma), 0.05, 7),
              limita(Math.exp(pp.mu0 + dMu0 + aV - dC), 0.05, 7)];
    }
    var g = coppia(par), lam = g[0], mu = g[1];
    if (parT && peso > 0) {                     /* media dei gol attesi, non dei parametri */
      var t = coppia(parT);
      lam = (1 - peso) * lam + peso * t[0];
      mu = (1 - peso) * mu + peso * t[1];
    }
    if (stiro !== 1) {
      var tS = lam + mu, dS = (lam - mu) * stiro;
      lam = limita((tS + dS) / 2, 0.05, 7); mu = limita((tS - dS) / 2, 0.05, 7);
    }
    /* L'ancoraggio si calcola UNA volta sul centro e poi si applica come
       fattore: rifarlo a ogni giro costerebbe mille ricerche per partita, e
       soprattutto schiaccerebbe la fascia sul mercato. Così l'incertezza che
       resta è ancora quella del modello, spostata dove dice il mercato. */
    lam = limita(lam * fattC, 0.05, 7);
    mu = limita(mu * fattV, 0.05, 7);
    /* imprevisti: qualcuno resta in dieci */
    if (rnd() < pRossoC) { lam *= rosso.attacco; mu *= rosso.difesa; rossoCasa++; }
    if (rnd() < pRossoV) { mu *= rosso.attacco; lam *= rosso.difesa; rossoVia++; }
    var m = matriceRisultati(lam, mu, rho, 11);
    var s = mercatiDaMatrice(m);
    if (quoteHT) mercatiTempi(lam, mu, rho, quoteHT, s);
    for (k = 0; k < campi.length; k++) {
      somma[campi[k]] += s[campi[k]];
      quadrati[campi[k]] += s[campi[k]] * s[campi[k]];
    }
    campione.push(s);
    var gc = 0, gv = 0;
    for (var a = 0; a < m.length; a++) for (var b = 0; b < m.length; b++) { gc += m[a][b] * a; gv += m[a][b] * b; }
    sommaGolC += gc; sommaGolV += gv;
  }

  var quantiCampioni = opz.campioni || 0;
  function fascia(campo) {
    var v = new Array(N);
    for (var q = 0; q < N; q++) v[q] = campione[q][campo];
    v.sort(function (a, b) { return a - b; });
    var f = { p: somma[campo] / N, p05: v[Math.floor(N * 0.05)], p95: v[Math.floor(N * 0.95)],
              p25: v[Math.floor(N * 0.25)] };
    if (quantiCampioni) {
      /* Per combinare più partite non bastano media e fascia: serve un campione.
         E soprattutto va tenuto NELL'ORDINE IN CUI È STATO ESTRATTO, non
         ordinato: il giro numero k usa la stessa lettura delle forze in tutte le
         partite, perché l'errore del modello sul livello dei gol è uno solo per
         tutta la lega. Moltiplicando i campioni posizione per posizione, tre
         "Under 1.5" in tre partite diverse restano legati fra loro come lo sono
         davvero — e la schedina smette di sembrare più sicura di quello che è. */
      f.campioni = [];
      var passo = N / quantiCampioni;
      for (q = 0; q < quantiCampioni; q++) {
        f.campioni.push(campione[Math.min(N - 1, Math.floor(q * passo))][campo]);
      }
    }
    return f;
  }
  var fasce = {};
  for (k = 0; k < campi.length; k++) fasce[campi[k]] = fascia(campi[k]);
  return {
    N: N, fasce: fasce, golCasa: sommaGolC / N, golVia: sommaGolV / N,
    quotaRossi: { casa: rossoCasa / N, via: rossoVia / N },
    effettoRosso: rosso, ancoraggio: ancCentro, quotePrimoTempo: quoteHT
  };
}

/* Dalla probabilità del modello a quella corretta con la storia: se nella fascia
   60-70% il modello ha visto succedere il 64%, non c'è motivo di credergli sulla
   parola oggi. Correzione dolce, proporzionale a quanti casi ci sono. */
function calibra(p, bins) {
  if (!bins || !bins.length) return p;
  var b = bins[Math.min(bins.length - 1, Math.max(0, Math.floor(p * bins.length)))];
  if (!b || !b.n || b.previsto == null || b.osservato == null || b.n < 25) return p;
  var forza = Math.min(1, b.n / 250);
  var spostata = p + (b.osservato - b.previsto) * forza;
  return limita(spostata, 0.005, 0.995);
}

/* Mettere insieme più partite moltiplica le quote e DIVIDE le probabilità: è la
   parte di matematica che le schedine nascondono meglio. Qui si fa il contrario:
   si moltiplica pescando ogni volta un valore diverso dal campione di ciascuna
   partita, così esce anche la fascia della combinazione e non solo il numero.
   Partite diverse si trattano come indipendenti: quello che succede a Milano non
   cambia quello che succede a Lecce. */
function combina(selezioni, giri) {
  if (!selezioni || !selezioni.length) return null;
  giri = giri || 2000;
  var media = 1, i, k;
  for (i = 0; i < selezioni.length; i++) media *= selezioni[i].p;
  var conCampioni = selezioni.filter(function (s) { return s.campioni && s.campioni.length; });
  if (conCampioni.length !== selezioni.length) {
    var basso = 1, alto = 1;
    for (i = 0; i < selezioni.length; i++) {
      basso *= (selezioni[i].p05 != null ? selezioni[i].p05 : selezioni[i].p);
      alto *= (selezioni[i].p95 != null ? selezioni[i].p95 : selezioni[i].p);
    }
    return { p: media, p05: basso, p95: alto, quota: media > 0 ? 1 / media : null,
             quotaPrudente: basso > 0 ? 1 / basso : null, n: selezioni.length, approssimata: true };
  }
  /* Stesso indice per tutte le partite: è quello che tiene insieme l'errore
     comune. Se i campioni avessero lunghezze diverse si ripiega sul più corto. */
  var lung = selezioni[0].campioni.length;
  for (i = 1; i < selezioni.length; i++) lung = Math.min(lung, selezioni[i].campioni.length);
  var valori = new Array(lung);
  for (k = 0; k < lung; k++) {
    var prod = 1;
    for (i = 0; i < selezioni.length; i++) prod *= selezioni[i].campioni[k];
    valori[k] = prod;
  }
  giri = lung;
  valori.sort(function (a, b) { return a - b; });
  var p05 = valori[Math.floor(giri * 0.05)], p95 = valori[Math.floor(giri * 0.95)];
  return { p: media, p05: p05, p95: p95,
           quota: media > 0 ? 1 / media : null,
           quotaPrudente: p05 > 0 ? 1 / p05 : null,
           n: selezioni.length, approssimata: false };
}

/* Ordina i mercati per quanto sono solidi: non la probabilità più alta, ma il
   pavimento — quanto resta anche nello scenario in cui il modello ha sbagliato
   la lettura delle forze e in campo succede l'imprevisto. */
function piuSicure(mercati, quante) {
  return mercati.slice()
    .filter(function (m) { return m.p05 != null; })
    .sort(function (a, b) { return b.p05 - a.p05; })
    .slice(0, quante || 3);
}

/* ───────────────────── quanto puntare ─────────────────────

   Trovare una quota conveniente è metà del lavoro; l'altra metà è non giocarci
   sopra troppo. Il criterio di Kelly dà la frazione di cassa che massimizza la
   crescita nel lungo periodo: puntare di più non fa guadagnare di più, fa
   fallire prima, ed è un risultato matematico, non un consiglio di prudenza.

   Qui Kelly si calcola due volte. Una sulla probabilità stimata, che è la
   risposta da manuale. E una sul PAVIMENTO della fascia — la probabilità nello
   scenario in cui il modello ha letto male le forze — che è la risposta onesta,
   perché Kelly presuppone di conoscere la probabilità vera e noi la conosciamo
   solo a meno di un margine di errore che il modello stesso ha misurato.
   Fra le due, quella da usare è la seconda. */

function kelly(p, quota) {
  if (!(quota > 1) || !(p > 0)) return 0;
  var b = quota - 1;
  return Math.max(0, (p * b - (1 - p)) / b);
}

/* Il conto completo su una singola giocata: vantaggio atteso e puntata. */
function valore(mercato, quota, opzioni) {
  opzioni = opzioni || {};
  var frazione = opzioni.frazione == null ? 0.25 : opzioni.frazione;  // Kelly a un quarto
  var cassa = opzioni.cassa || 0;
  var q = Number(quota);
  if (!(q > 1) || !mercato || !(mercato.p > 0)) return null;
  var p = mercato.p;
  var pBassa = mercato.p05 == null ? p : mercato.p05;
  var margine = 1 / q;                              /* quanto ti chiede il banco */
  var k = kelly(p, q), kBassa = kelly(pBassa, q);
  return {
    quota: q, p: p, pBassa: pBassa,
    quotaEqua: 1 / p, quotaPrudente: pBassa > 0 ? 1 / pBassa : null,
    reso: p * q - 1,                                /* guadagno atteso per franco giocato */
    resoPrudente: pBassa * q - 1,
    scarto: p - margine,                            /* di quanto il modello supera il banco */
    kelly: k, kellyPrudente: kBassa,
    frazione: frazione,
    puntata: cassa ? cassa * kBassa * frazione : null,
    puntataPiena: cassa ? cassa * k * frazione : null,
    conviene: pBassa * q > 1
  };
}

/* Ordina le giocate per vantaggio, ma solo quelle che reggono anche nello
   scenario sfavorevole: una quota che conviene solo se il modello ha ragione
   al centesimo non è un'occasione, è un'illusione ottica. */
function occasioni(voci, quote, opzioni) {
  opzioni = opzioni || {};
  var fuori = [], i, v;
  for (i = 0; i < voci.length; i++) {
    v = voci[i];
    var q = quote ? quote[v.id] : null;
    if (!(q > 1)) continue;
    var val = valore(v, q, opzioni);
    if (!val) continue;
    fuori.push({ mercato: v, valore: val });
  }
  fuori.sort(function (a, b) { return b.valore.resoPrudente - a.valore.resoPrudente; });
  if (opzioni.soloConvenienti !== false) {
    fuori = fuori.filter(function (x) { return x.valore.conviene; });
  }
  return fuori;
}

/* ─────────────────────────── misure ─────────────────────────── */

function esitoReale(x, y) { return x > y ? 0 : (x === y ? 1 : 2); }

function logLoss(p, esito) { return -Math.log(Math.max(1e-12, p[esito])); }
function brier(p, esito) {
  var t = 0;
  for (var i = 0; i < 3; i++) { var y = (i === esito ? 1 : 0); t += (p[i] - y) * (p[i] - y); }
  return t;
}
/* RPS: penalizza di più chi sbaglia di due caselle (dare la casa vincente
   quando vince fuori) rispetto a chi sbaglia di una. Per l'1X2 è la misura giusta. */
function rps(p, esito) {
  var cp = 0, cy = 0, t = 0;
  for (var i = 0; i < 2; i++) {
    cp += p[i]; cy += (i === esito ? 1 : 0);
    t += (cp - cy) * (cp - cy);
  }
  return t / 2;
}
/* Dalle quote alle probabilità: si toglie il ricarico del bookmaker in proporzione. */
function daQuote(q) {
  if (!q || q.length < 3) return null;
  var inv = [1 / q[0], 1 / q[1], 1 / q[2]];
  var s = inv[0] + inv[1] + inv[2];
  if (!(s > 0)) return null;
  return [inv[0] / s, inv[1] / s, inv[2] / s];
}

/* ─────────────────────────── costruzione modello ─────────────────────────── */

function costruisci(partite, opzioni) {
  opzioni = opzioni || {};
  var dati = opzioni.dati || prepara(partite);
  var base = { xi: opzioni.xi, ridge: opzioni.ridge, iterazioni: opzioni.iterazioni, fino: opzioni.fino };
  /* Due passate: la prima ignora la correzione sui punteggi bassi e la misura,
     la seconda rifà i conti tenendone conto. È la stima di Dixon-Coles fatta
     per alternanza invece che tutta insieme: stesso punto d'arrivo, molto più
     semplice da tenere in piedi. */
  var g = stima(dati, base, opzioni.caldo);
  if (g.ok && Math.abs(g.par.rho) > 0.003) {
    var seconda = {}; for (var kk in base) seconda[kk] = base[kk];
    seconda.rho = g.par.rho;
    var g2 = stima(dati, seconda, g.par);
    if (g2.ok) g = g2;
  }
  /* terzo modello: i gol del primo tempo. Costa poco (stessa stima, altra
     colonna) e apre una decina di mercati che prima non c'erano. */
  var pt = null;
  if (opzioni.primoTempo !== false) {
    var oPt = { xi: opzioni.xi, ridge: opzioni.ridge, iterazioni: opzioni.iterazioni,
                fino: opzioni.fino, usaPt: true };
    var sp = stima(dati, oPt, opzioni.caldoPt);
    if (sp.ok) pt = sp.par;
  }
  var t = null;
  if (dati.calibrazioneTiri) {
    var oTiri = { xi: opzioni.xiTiri == null ? PREDEF.xiTiri : opzioni.xiTiri,
                  ridge: opzioni.ridge, iterazioni: opzioni.iterazioni,
                  fino: opzioni.fino, usaXg: true };
    var st = stima(dati, oTiri, opzioni.caldoTiri);
    if (st.ok) t = st.par;
  }
  return {
    squadre: dati.squadre, indice: dati.indice, dati: dati,
    gol: g.par, tiri: t, primoTempo: pt, ok: g.ok,
    pesoTiri: opzioni.pesoTiri == null ? 0.60 : opzioni.pesoTiri,
    stiro: opzioni.stiro == null ? 1 : opzioni.stiro,
    ancoraggio: opzioni.ancoraggio == null ? 0 : opzioni.ancoraggio,
    ancoraggioOU: opzioni.ancoraggioOU == null ? null : opzioni.ancoraggioOU,
    calibrazioneTiri: dati.calibrazioneTiri,
    xgVeri: dati.xgVeri || 0, allineamentoXg: dati.allineamentoXg || null
  };
}

/* ─────────────────────────── classifica delle forze ─────────────────────────── */

function forze(modello, soloSquadre) {
  var out = [], i, par = modello.gol;
  for (i = 0; i < modello.squadre.length; i++) {
    var nome = modello.squadre[i];
    if (soloSquadre && soloSquadre.indexOf(nome) < 0) continue;
    var attT = modello.tiri ? modello.tiri.att[i] : par.att[i];
    var difT = modello.tiri ? modello.tiri.dif[i] : par.dif[i];
    var w = modello.pesoTiri;
    var att = (1 - w) * par.att[i] + w * attT;
    var dif = (1 - w) * par.dif[i] + w * difT;
    out.push({
      squadra: nome, i: i, attacco: att, difesa: dif, forza: att + dif,
      attaccoGol: par.att[i], difesaGol: par.dif[i],
      attaccoTiri: modello.tiri ? modello.tiri.att[i] : null,
      golAttesiCasa: Math.exp(par.mu0 + att + par.gamma),
      golSubitiCasa: Math.exp(par.mu0 - dif)
    });
  }
  out.sort(function (a, b) { return b.forza - a.forza; });
  return out;
}

/* ─────────────────────────── arbitri ─────────────────────────── */

/* Le medie di un arbitro con 9 partite non valgono quanto quelle di uno con 90.
   Si tirano verso la media della lega in proporzione a quanto poco hanno
   arbitrato: con pochi dati vince la lega, con tanti vince l'arbitro. */
function verso(valore, mediaLega, n, k) {
  if (!(n > 0)) return mediaLega;
  return (n * valore + k * mediaLega) / (n + k);
}

function statisticheArbitri(partite, opzioni) {
  opzioni = opzioni || {};
  var k = opzioni.k == null ? 12 : opzioni.k;       // "partite equivalenti" di prudenza
  var da = opzioni.da || null;
  var arb = {}, sq = {}, tot = { g: 0, r: 0, f: 0, n: 0 }, i, p;
  for (i = 0; i < partite.length; i++) {
    p = partite[i];
    if (p.gc == null || (da && p.d < da)) continue;
    var gialli = (p.gic || 0) + (p.giv || 0), rossi = (p.rc || 0) + (p.rv || 0);
    var falli = (p.fc == null ? null : p.fc + p.fv);
    if (p.gic == null) continue;
    tot.g += gialli; tot.r += rossi; tot.n++;
    if (falli != null) tot.f += falli;
    if (p.arb) {
      var a = arb[p.arb] || (arb[p.arb] = { nome: p.arb, n: 0, g: 0, r: 0, f: 0, nf: 0, casa: 0, via: 0, ultima: '' });
      a.n++; a.g += gialli; a.r += rossi; a.casa += (p.gic || 0); a.via += (p.giv || 0);
      if (falli != null) { a.f += falli; a.nf++; }
      if (p.d > a.ultima) a.ultima = p.d;
    }
    [[p.c, p.gic, p.fc], [p.v, p.giv, p.fv]].forEach(function (t) {
      if (!t[0]) return;
      var e = sq[t[0]] || (sq[t[0]] = { squadra: t[0], n: 0, g: 0, f: 0, nf: 0 });
      e.n++; e.g += (t[1] || 0);
      if (t[2] != null) { e.f += t[2]; e.nf++; }
    });
  }
  if (!tot.n) return null;
  var mediaGialli = tot.g / tot.n, mediaRossi = tot.r / tot.n, mediaFalli = tot.f / Math.max(1, tot.n);
  var listaArb = [];
  for (var nome in arb) {
    var a = arb[nome];
    a.gialliPartita = a.g / a.n;
    a.rossiPartita = a.r / a.n;
    a.falliPartita = a.nf ? a.f / a.nf : null;
    a.gialliCorretti = verso(a.gialliPartita, mediaGialli, a.n, k);
    a.rossiCorretti = verso(a.rossiPartita, mediaRossi, a.n, k);
    a.severita = a.gialliCorretti / mediaGialli;
    a.cartelliniPerFallo = (a.falliPartita && a.falliPartita > 0) ? a.gialliPartita / a.falliPartita : null;
    a.quotaCasa = a.g > 0 ? a.casa / a.g : 0.5;
    listaArb.push(a);
  }
  listaArb.sort(function (x, y) { return y.gialliCorretti - x.gialliCorretti; });
  var listaSq = [];
  for (var s2 in sq) {
    var e = sq[s2];
    e.gialliPartita = e.g / e.n;
    e.falliPartita = e.nf ? e.f / e.nf : null;
    e.propensione = verso(e.gialliPartita, mediaGialli / 2, e.n, k) / (mediaGialli / 2);
    listaSq.push(e);
  }
  listaSq.sort(function (x, y) { return y.propensione - x.propensione; });
  return {
    arbitri: listaArb, squadre: listaSq, indiceArbitri: arb, indiceSquadre: sq,
    mediaGialli: mediaGialli, mediaRossi: mediaRossi, mediaFalli: mediaFalli, partite: tot.n
  };
}

/* Cartellini attesi in una partita: quanto fischia l'arbitro × quanto fallose
   sono le due squadre. Poi Poisson per le soglie. */
function cartelliniAttesi(stat, arbitro, casa, via) {
  if (!stat) return null;
  var a = arbitro ? stat.indiceArbitri[arbitro] : null;
  var sev = a ? a.severita : 1;
  var pc = stat.indiceSquadre[casa], pv = stat.indiceSquadre[via];
  var fc = pc ? pc.propensione : 1, fv = pv ? pv.propensione : 1;
  var base = stat.mediaGialli / 2;
  var lamC = limita(base * fc * sev, 0.15, 6);
  var lamV = limita(base * fv * sev, 0.15, 6);
  var tot = lamC + lamV;
  var p = function (soglia) {
    var acc = 0;
    for (var kk = 0; kk <= Math.floor(soglia); kk++) acc += poisson(kk, tot);
    return 1 - acc;
  };
  return {
    arbitro: arbitro || null, noto: !!a, partiteArbitro: a ? a.n : 0,
    severita: sev, gialliCasa: lamC, gialliVia: lamV, gialliTotali: tot,
    oltre35: p(3.5), oltre45: p(4.5), oltre55: p(5.5),
    rossi: (a ? a.rossiCorretti : stat.mediaRossi)
  };
}

/* ─────────────────────────── corner ───────────────────────────

   I corner stanno nell'archivio da sempre — una colonna per squadra, 1910
   partite piene — e non li guardava nessuno. Sono l'unico mercato aggiuntivo
   che si può stimare senza nuove fonti e senza fingere di sapere qualcosa.

   Il modello è volutamente più povero di quello dei gol: chi ne batte tanti per
   chi ne concede tanti, riportato sulla media della lega. Niente Dixon-Coles,
   niente decadimento fine: i corner sono più numerosi dei gol e molto meno
   informativi, e un modello elaborato su un segnale debole è solo un modo più
   convincente di sbagliare. */

function statisticheCorner(partite, opzioni) {
  opzioni = opzioni || {};
  var k = opzioni.k == null ? 10 : opzioni.k;      // partite equivalenti di prudenza
  var da = opzioni.da || null;
  var sq = {}, tot = 0, n = 0, i, p;
  for (i = 0; i < partite.length; i++) {
    p = partite[i];
    if (p.gc == null || p.ac == null || p.av == null) continue;
    if (da && p.d < da) continue;
    tot += p.ac + p.av; n++;
    [[p.c, p.ac, p.av], [p.v, p.av, p.ac]].forEach(function (t) {
      if (!t[0]) return;
      var e = sq[t[0]] || (sq[t[0]] = { squadra: t[0], n: 0, fatti: 0, subiti: 0 });
      e.n++; e.fatti += t[1]; e.subiti += t[2];
    });
  }
  if (n < 60) return null;
  var mediaPartita = tot / n, mediaSquadra = mediaPartita / 2;
  var lista = [];
  for (var s in sq) {
    var e = sq[s];
    e.perPartita = e.fatti / e.n;
    e.subitiPerPartita = e.subiti / e.n;
    e.attacco = verso(e.perPartita, mediaSquadra, e.n, k) / mediaSquadra;
    e.difesa = verso(e.subitiPerPartita, mediaSquadra, e.n, k) / mediaSquadra;
    lista.push(e);
  }
  lista.sort(function (a, b) { return b.attacco - a.attacco; });
  return { squadre: lista, indice: sq, mediaPartita: mediaPartita,
           mediaSquadra: mediaSquadra, partite: n };
}

/* Il vantaggio del campo sui corner esiste ed è più marcato che sui gol: chi
   gioca in casa attacca di più e quindi ne batte di più. Si misura, non si
   suppone: è il rapporto fra corner di casa e corner in trasferta. */
function cornerAttesi(stat, casa, via, vantaggio) {
  if (!stat) return null;
  var c = stat.indice[casa], v = stat.indice[via];
  var ac = c ? c.attacco : 1, dc = c ? c.difesa : 1;
  var av = v ? v.attacco : 1, dv = v ? v.difesa : 1;
  var g = vantaggio == null ? 1.10 : vantaggio;
  var lamC = limita(stat.mediaSquadra * ac * dv * g, 0.5, 12);
  var lamV = limita(stat.mediaSquadra * av * dc / g, 0.5, 12);
  var tot = lamC + lamV;
  function oltre(soglia) {
    var acc = 0;
    for (var kk = 0; kk <= Math.floor(soglia) && kk < 25; kk++) acc += poisson(kk, tot);
    return limita(1 - acc, 0, 1);
  }
  return { casa: lamC, via: lamV, totali: tot, noto: !!(c && v),
           oltre75: oltre(7.5), oltre85: oltre(8.5), oltre95: oltre(9.5),
           oltre105: oltre(10.5), oltre115: oltre(11.5) };
}

function vantaggioCornerCasa(partite) {
  var c = 0, v = 0, i, p;
  for (i = 0; i < partite.length; i++) {
    p = partite[i];
    if (p.ac == null || p.av == null) continue;
    c += p.ac; v += p.av;
  }
  if (!(v > 0)) return 1.10;
  return limita(Math.sqrt(c / v), 0.9, 1.35);
}

/* ─────────────────────────── backtest ─────────────────────────── */

/* Passata unica: per ogni partita del periodo di prova si rifà la stima usando
   SOLO quello che si sapeva prima di quella data, e si salvano i gol attesi dei
   due modelli. Con quelli si può poi provare qualsiasi peso senza ristimare. */
function campionaBacktest(dati, opzioni, avanzamento) {
  opzioni = opzioni || {};
  var da = opzioni.da, ogni = opzioni.refitOgniGiorni == null ? 3 : opzioni.refitOgniGiorni;
  var iter = opzioni.iterazioni == null ? 90 : opzioni.iterazioni;
  var righe = dati.righe, campioni = [], i;
  var prova = [];
  for (i = 0; i < righe.length; i++) if (!da || righe[i].d >= da) prova.push(righe[i]);
  if (!prova.length) return { campioni: [], base: null };

  var caldoG = null, caldoT = null, ultimaStima = null, parG = null, parT = null;
  var passi = 0;
  for (i = 0; i < prova.length; i++) {
    var r = prova[i];
    if (!parG || !ultimaStima || giorni(ultimaStima, r.d) >= ogni) {
      var sg = stima(dati, { xi: opzioni.xi, xiTiri: opzioni.xiTiri, ridge: opzioni.ridge,
                             iterazioni: iter, fino: r.d, rho: parG ? parG.rho : 0 }, caldoG);
      if (!sg.ok) continue;
      parG = sg.par; caldoG = sg.par;
      if (dati.calibrazioneTiri) {
        var st = stima(dati, { xi: opzioni.xiTiri == null ? PREDEF.xiTiri : opzioni.xiTiri,
                               ridge: opzioni.ridge, iterazioni: iter, fino: r.d, usaXg: true }, caldoT);
        if (st.ok) { parT = st.par; caldoT = st.par; }
      }
      ultimaStima = r.d;
      passi++;
      if (avanzamento && passi % 5 === 0) avanzamento(i / prova.length);
    }
    if (!parG) continue;
    var g = attesi(parG, r.i, r.j);
    var t = parT ? attesi(parT, r.i, r.j) : null;
    campioni.push({
      d: r.d, s: r.s, casa: dati.squadre[r.i], via: dati.squadre[r.j],
      x: r.x, y: r.y, esito: esitoReale(r.x, r.y),
      lamG: g[0], muG: g[1], lamT: t ? t[0] : null, muT: t ? t[1] : null,
      rho: parG.rho, q: r.q || null, qou: r.qou || null
    });
  }
  /* baseline: le frequenze storiche prima del periodo di prova */
  var c = 0, p_ = 0, v = 0, n = 0;
  for (i = 0; i < righe.length; i++) {
    if (da && righe[i].d >= da) break;
    var e = esitoReale(righe[i].x, righe[i].y);
    if (e === 0) c++; else if (e === 1) p_++; else v++;
    n++;
  }
  var base = n > 50 ? [c / n, p_ / n, v / n] : [0.44, 0.26, 0.30];
  return { campioni: campioni, base: base };
}

function probabilitaDaCampione(cam, peso, opz) {
  opz = opz || {};
  var lam = cam.lamT != null ? (1 - peso) * cam.lamG + peso * cam.lamT : cam.lamG;
  var mu = cam.muT != null ? (1 - peso) * cam.muG + peso * cam.muT : cam.muG;
  var stiro = opz.stiro == null ? 1 : opz.stiro;
  if (stiro !== 1) {
    var tot = lam + mu, dif = (lam - mu) * stiro;
    lam = limita((tot + dif) / 2, 0.05, 7);
    mu = limita((tot - dif) / 2, 0.05, 7);
  }
  var w = opz.ancoraggio || 0;
  if (w > 0 && (cam.q || cam.qou)) {
    var a = ancoraMercato(lam, mu, cam.rho, {
      q: cam.q, qou: cam.qou, peso1x2: w,
      pesoOU: opz.ancoraggioOU == null ? w : opz.ancoraggioOU });
    lam = a.lam; mu = a.mu;
  }
  var m = matriceRisultati(lam, mu, cam.rho, 11);
  var e = esiti(m);
  return { p: [e.casa, e.pari, e.via], over: e.over25, totale: e.totale, lam: lam, mu: mu };
}

function misura(coppie) {
  /* coppie: [{p:[3], esito, over, overReale}] */
  var ll = 0, br = 0, rp = 0, acc = 0, n = coppie.length, i;
  var binN = [], binP = [], binO = [], b;
  for (b = 0; b < 10; b++) { binN.push(0); binP.push(0); binO.push(0); }
  var overErr = 0, overN = 0;
  for (i = 0; i < n; i++) {
    var c = coppie[i];
    ll += logLoss(c.p, c.esito);
    br += brier(c.p, c.esito);
    rp += rps(c.p, c.esito);
    var mx = c.p[0] >= c.p[1] ? (c.p[0] >= c.p[2] ? 0 : 2) : (c.p[1] >= c.p[2] ? 1 : 2);
    if (mx === c.esito) acc++;
    for (var e = 0; e < 3; e++) {
      b = Math.min(9, Math.floor(c.p[e] * 10));
      binN[b]++; binP[b] += c.p[e]; binO[b] += (e === c.esito ? 1 : 0);
    }
    if (c.over != null && c.overReale != null) { overErr += c.over - c.overReale; overN++; }
  }
  var calibrazione = [];
  for (b = 0; b < 10; b++) {
    calibrazione.push({ da: b / 10, a: (b + 1) / 10, n: binN[b],
      previsto: binN[b] ? binP[b] / binN[b] : null,
      osservato: binN[b] ? binO[b] / binN[b] : null });
  }
  return { n: n, logloss: ll / n, brier: br / n, rps: rp / n, accuratezza: acc / n,
           calibrazione: calibrazione, scartoOver: overN ? overErr / overN : null };
}

function valutaBacktest(res, opzioni) {
  opzioni = opzioni || {};
  var pesi = opzioni.pesi || [0, 0.2, 0.35, 0.5, 0.6, 0.7, 0.85, 1];
  var stiri = opzioni.stiri || [1, 1.05, 1.1, 1.15, 1.2, 1.3];
  var ancore = opzioni.ancore || [0, 0.2, 0.4, 0.6, 0.75, 0.85, 0.95];
  var campioni = res.campioni, base = res.base, i, k;
  var conTiri = campioni.filter(function (c) { return c.lamT != null; });

  function coppieCon(peso, opz) {
    var out = [];
    for (var q = 0; q < campioni.length; q++) {
      var pr = probabilitaDaCampione(campioni[q], peso, opz);
      out.push({ p: pr.p, esito: campioni[q].esito, over: pr.over,
                 overReale: (campioni[q].x + campioni[q].y) > 2.5 ? 1 : 0 });
    }
    return out;
  }

  /* 1. quanto pesano i tiri (o gli xG veri, dove ci sono) */
  var perPeso = [];
  for (k = 0; k < pesi.length; k++) {
    var m = misura(coppieCon(pesi[k], null));
    m.peso = pesi[k];
    perPeso.push(m);
  }
  var migliore = perPeso.slice().sort(function (a, b) { return a.rps - b.rps; })[0];
  var pesoMigliore = migliore.peso;

  /* 2. di quanto va allargato lo squilibrio quando non c'è nessuna quota.
     È il difetto che il backtest misura sempre nella stessa direzione: il
     modello lascia le partite più in bilico di come finiscono davvero. */
  var perStiro = [];
  for (k = 0; k < stiri.length; k++) {
    var ms = misura(coppieCon(pesoMigliore, { stiro: stiri[k] }));
    ms.stiro = stiri[k];
    perStiro.push(ms);
  }
  var migliorStiro = perStiro.slice().sort(function (a, b) { return a.rps - b.rps; })[0];
  var stiroMigliore = migliorStiro.stiro;

  /* 3. quanto dare retta al mercato, misurato solo dove il mercato c'è */
  var conQuote = [];
  for (i = 0; i < campioni.length; i++) if (campioni[i].q && daQuote(campioni[i].q)) conQuote.push(i);
  var perAncora = [];
  if (conQuote.length > 60) {
    for (k = 0; k < ancore.length; k++) {
      var opz = { stiro: stiroMigliore, ancoraggio: ancore[k] };
      var sub = [];
      for (i = 0; i < conQuote.length; i++) {
        var c = campioni[conQuote[i]];
        var pr = probabilitaDaCampione(c, pesoMigliore, opz);
        sub.push({ p: pr.p, esito: c.esito, over: pr.over,
                   overReale: (c.x + c.y) > 2.5 ? 1 : 0 });
      }
      var ma = misura(sub);
      ma.ancoraggio = ancore[k];
      perAncora.push(ma);
    }
  }
  var migliorAncora = perAncora.length
    ? perAncora.slice().sort(function (a, b) { return a.rps - b.rps; })[0] : null;
  var ancoraMigliore = migliorAncora ? migliorAncora.ancoraggio : 0;

  /* la calibrazione da mostrare e da usare è quella della configurazione scelta */
  var finale = misura(coppieCon(pesoMigliore, { stiro: stiroMigliore, ancoraggio: ancoraMigliore }));
  finale.peso = pesoMigliore; finale.stiro = stiroMigliore; finale.ancoraggio = ancoraMigliore;

  /* stesse partite per tutti, altrimenti il confronto non vale niente */
  var mercato = [], modelloPuro = [], modelloAncorato = [], baseSub = [];
  for (k = 0; k < conQuote.length; k++) {
    i = conQuote[k];
    var cc = campioni[i];
    var pPuro = probabilitaDaCampione(cc, pesoMigliore, { stiro: stiroMigliore });
    var pAnc = probabilitaDaCampione(cc, pesoMigliore,
                                     { stiro: stiroMigliore, ancoraggio: ancoraMigliore });
    var overReale = (cc.x + cc.y) > 2.5 ? 1 : 0;
    mercato.push({ p: daQuote(cc.q), esito: cc.esito,
                   over: daQuoteOU(cc.qou), overReale: overReale });
    modelloPuro.push({ p: pPuro.p, esito: cc.esito, over: pPuro.over, overReale: overReale });
    modelloAncorato.push({ p: pAnc.p, esito: cc.esito, over: pAnc.over, overReale: overReale });
    baseSub.push({ p: base, esito: cc.esito });
  }
  return {
    perPeso: perPeso, pesoMigliore: pesoMigliore,
    perStiro: perStiro, stiroMigliore: stiroMigliore,
    perAncora: perAncora, ancoraMigliore: ancoraMigliore,
    modello: finale,
    confronto: conQuote.length > 30 ? {
      n: conQuote.length,
      modello: misura(modelloPuro), ancorato: misura(modelloAncorato),
      mercato: misura(mercato), baseline: misura(baseSub)
    } : null,
    baselineTutte: misura(campioni.map(function (c) { return { p: base, esito: c.esito }; })),
    base: base, partite: campioni.length, conTiri: conTiri.length,
    da: campioni.length ? campioni[0].d : null, a: campioni.length ? campioni[campioni.length - 1].d : null
  };
}

/* ─────────────────────────── esportazione ─────────────────────────── */

var API = {
  poisson: poisson, tau: tau, giorni: giorni, limita: limita, media: media,
  prepara: prepara, stima: stima, stimaRho: stimaRho, costruisci: costruisci,
  attesi: attesi, matriceRisultati: matriceRisultati, esiti: esiti, prevedi: prevedi,
  ancoraMercato: ancoraMercato, daQuoteOU: daQuoteOU, fondiLogit: fondiLogit, fondiTre: fondiTre,
  _sintesi: _sintesi,
  forze: forze, calibraTiri: calibraTiri, xgDaTiri: xgDaTiri, allineaXg: allineaXg,
  statisticheArbitri: statisticheArbitri, cartelliniAttesi: cartelliniAttesi, verso: verso,
  statisticheCorner: statisticheCorner, cornerAttesi: cornerAttesi,
  vantaggioCornerCasa: vantaggioCornerCasa,
  bootstrap: bootstrap, sintesiBootstrap: sintesiBootstrap, effettoRosso: effettoRosso,
  golAttesiModello: golAttesiModello,
  simula: simula, calibra: calibra, combina: combina,
  kelly: kelly, valore: valore, occasioni: occasioni,
  mercatiDaMatrice: mercatiDaMatrice, elencoMercati: elencoMercati, piuSicure: piuSicure,
  campiMercato: campiMercato, mercatiTempi: mercatiTempi, primoFinale: primoFinale,
  elencoTempi: elencoTempi, quotePrimoTempo: quotePrimoTempo, CAMPI_TEMPI: CAMPI_TEMPI,
  campionaBacktest: campionaBacktest, valutaBacktest: valutaBacktest,
  probabilitaDaCampione: probabilitaDaCampione, misura: misura,
  logLoss: logLoss, brier: brier, rps: rps, daQuote: daQuote, esitoReale: esitoReale,
  PREDEF: PREDEF
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
radice.Modello = API;

})(typeof self !== 'undefined' ? self : this);
