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
  var righe = [];
  for (i = 0; i < giocate.length; i++) {
    p = giocate[i];
    var xg = xgDaTiri(p, cal);
    righe.push({
      i: idx(p.c), j: idx(p.v), x: p.gc, y: p.gv, d: p.d,
      xgc: xg ? xg[0] : null, xgv: xg ? xg[1] : null,
      arb: p.arb || null, s: p.s || null, q: p.q || null, rif: p
    });
  }
  return { squadre: squadre, indice: indice, righe: righe, calibrazioneTiri: cal,
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
  usaXg: false       // se true stima sui gol attesi da tiri invece che sui gol
};

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
    w = Math.exp(-o.xi * Math.max(0, giorni(r.d, fino)));
    if (w < 1e-4) continue;
    uso.push(r); pesi.push(w);
  }
  if (uso.length < 30) return { par: par, ok: false, n: uso.length };

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
      var xi_ = o.usaXg ? r.xgc : r.x, yi_ = o.usaXg ? r.xgv : r.y;
      var lam = limita(Math.exp(par.mu0 + par.att[r.i] - par.dif[r.j] + par.gamma), 0.03, 8);
      var mu_ = limita(Math.exp(par.mu0 + par.att[r.j] - par.dif[r.i]), 0.03, 8);
      var ex = w * (xi_ - lam), ey = w * (yi_ - mu_);
      /* la correzione sui punteggi bassi non è un ritocco finale: entra nel
         gradiente, altrimenti il livello dei gol resta storto */
      if (rhoFisso !== 0 && !o.usaXg && xi_ < 2 && yi_ < 2) {
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

  if (!o.usaXg) par.rho = stimaRho(par, uso, pesi); else par.rho = 0;
  par.osservazioni = uso.length;
  par.pesoTotale = pesi.reduce(function (a, b) { return a + b; }, 0);
  return { par: par, ok: true, n: uso.length };
}

/* rho si stima da solo, dopo: una ricerca in una dimensione sola sui punteggi bassi. */
function stimaRho(par, uso, pesi) {
  function ll(rho) {
    var t = 0;
    for (var i = 0; i < uso.length; i++) {
      var r = uso[i];
      if (r.x > 1 || r.y > 1) continue;
      var lam = limita(Math.exp(par.mu0 + par.att[r.i] - par.dif[r.j] + par.gamma), 0.03, 8);
      var mu_ = limita(Math.exp(par.mu0 + par.att[r.j] - par.dif[r.i]), 0.03, 8);
      var v = tau(r.x, r.y, lam, mu_, rho);
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

/* Previsione completa di una partita: due modelli mescolati, poi la matrice. */
function prevedi(modello, casa, via, opz) {
  opz = opz || {};
  var i = modello.indice[casa], j = modello.indice[via];
  if (i == null || j == null) return null;
  var peso = opz.pesoTiri == null ? modello.pesoTiri : opz.pesoTiri;
  var g = attesi(modello.gol, i, j, opz.agg);
  var lam = g[0], mu = g[1];
  if (modello.tiri && peso > 0) {
    var t = attesi(modello.tiri, i, j, opz.agg);
    lam = (1 - peso) * lam + peso * t[0];
    mu = (1 - peso) * mu + peso * t[1];
  }
  var m = matriceRisultati(lam, mu, modello.gol.rho, 11);
  var e = esiti(m);
  e.lambdaCasa = lam; e.lambdaVia = mu; e.matrice = m;
  e.casaNome = casa; e.viaNome = via;
  return e;
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
    gol: g.par, tiri: t, ok: g.ok,
    pesoTiri: opzioni.pesoTiri == null ? 0.60 : opzioni.pesoTiri,
    calibrazioneTiri: dati.calibrazioneTiri
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
      rho: parG.rho, q: r.q || null
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

function probabilitaDaCampione(cam, peso) {
  var lam = cam.lamT != null ? (1 - peso) * cam.lamG + peso * cam.lamT : cam.lamG;
  var mu = cam.muT != null ? (1 - peso) * cam.muG + peso * cam.muT : cam.muG;
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
  var campioni = res.campioni, base = res.base, i, k;
  var conTiri = campioni.filter(function (c) { return c.lamT != null; });
  var perPeso = [];
  var cache = {};
  for (k = 0; k < pesi.length; k++) {
    var coppie = [];
    for (i = 0; i < campioni.length; i++) {
      var pr = probabilitaDaCampione(campioni[i], pesi[k]);
      coppie.push({ p: pr.p, esito: campioni[i].esito, over: pr.over,
                    overReale: (campioni[i].x + campioni[i].y) > 2.5 ? 1 : 0 });
    }
    cache[pesi[k]] = coppie;
    var m = misura(coppie);
    m.peso = pesi[k];
    perPeso.push(m);
  }
  var migliore = perPeso.slice().sort(function (a, b) { return a.rps - b.rps; })[0];

  /* stesse partite per tutti, altrimenti il confronto non vale niente */
  var conQuote = [];
  for (i = 0; i < campioni.length; i++) if (campioni[i].q && daQuote(campioni[i].q)) conQuote.push(i);
  var mercato = [], modelloSub = [], baseSub = [];
  var coppieMigliori = cache[migliore.peso];
  for (k = 0; k < conQuote.length; k++) {
    i = conQuote[k];
    mercato.push({ p: daQuote(campioni[i].q), esito: campioni[i].esito });
    modelloSub.push(coppieMigliori[i]);
    baseSub.push({ p: base, esito: campioni[i].esito });
  }
  return {
    perPeso: perPeso, pesoMigliore: migliore.peso, modello: migliore,
    confronto: conQuote.length > 30 ? {
      n: conQuote.length,
      modello: misura(modelloSub), mercato: misura(mercato), baseline: misura(baseSub)
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
  forze: forze, calibraTiri: calibraTiri, xgDaTiri: xgDaTiri,
  statisticheArbitri: statisticheArbitri, cartelliniAttesi: cartelliniAttesi, verso: verso,
  campionaBacktest: campionaBacktest, valutaBacktest: valutaBacktest,
  probabilitaDaCampione: probabilitaDaCampione, misura: misura,
  logLoss: logLoss, brier: brier, rps: rps, daQuote: daQuote, esitoReale: esitoReale,
  PREDEF: PREDEF
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
radice.Modello = API;

})(typeof self !== 'undefined' ? self : this);
