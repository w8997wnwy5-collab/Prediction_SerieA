/* Lo storico vero della Consigliata: come sono andate le schedine che l'app
   ha proposto, giornata per giornata, contro quello che promettevano.
   ══════════════════════════════════════════════════════════════════════════
   Il 4 novembre la domanda era: "stai sbagliando tanto ultimamente?". Per
   rispondere bisognava rigiocare le giornate a mano, e la risposta e' stata
   che le singole entravano piu' del promesso e le multiple perdevano quanto
   dicevano i loro numeri. Una risposta cosi' deve stare nell'app, non in una
   chat: e' l'unico modo di distinguere la sfortuna da un modello che sbaglia.

   Come si rigioca una giornata, e perche' cosi':
     · con l'app VERA, la stessa pagina che si apre sul telefono, dentro un
       browser senza schermo. Rifare la Consigliata qui con un'altra copia
       delle sue regole vorrebbe dire due verita' sulla stessa cosa, che un
       giorno smettono di coincidere;
     · alle 9 di mattina (ora di Roma) del giorno della prima partita di Serie
       A, o del venerdi' se la giornata comincia nel fine settimana: e' quando
       si gioca, prima delle formazioni;
     · con le quote di quel momento (le "pre-closing" di football-data: la
       media dei bookmaker, raccolta il venerdi' pomeriggio o il martedi');
     · con l'archivio tagliato al giorno prima, e il calendario che il server
       avrebbe mandato: le partite di ogni campionato, senza risultato;
     · con le impostazioni di partenza: ricarico bet365, prudenza Equilibrata,
       i mercati di base. Chi ne ha cambiate vede schedine un po' diverse.

   Una giornata si rigioca una volta sola, appena tutte le partite che servono
   sono finite e hanno le quote nell'archivio, col codice di quel giorno; poi
   resta com'e'. Il file e' pubblico perche' racconta solo partite gia'
   giocate.

     node scripts/storico_consigliata.js             rigioca quelle che mancano
     node scripts/storico_consigliata.js --controlla dice solo se ne mancano
     node scripts/storico_consigliata.js --rifai     le rigioca tutte da capo
   Serve playwright (npm install playwright, npx playwright install chromium);
   --controlla no.
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const M = require('../modello.js');

const QUI = path.join(__dirname, '..');
const USCITA = path.join(QUI, 'data', 'storico-consigliata.json');
const API = 'https://monthline.crvmtt22.workers.dev';    /* quello scritto in index.html: il finto risponde al suo posto */
const QUANTE = 20;                                        /* le giornate tenute nel file */
/* quello che l'app scrive sotto lo storico: e' testo per chi legge, con gli accenti */
const COME = 'rigiocate con l\'app vera alle 9 del giorno della prima partita di Serie A (il venerdì se si ' +
             'comincia nel fine settimana), con le quote del venerdì (media dei bookmaker) e le impostazioni ' +
             'di partenza: ricarico bet365, prudenza Equilibrata, mercati di base';
const FILE_SITO = ['index.html', 'modello.js', 'worker.js', 'manifest.webmanifest', 'icon.svg', 'icon-chiaro.svg'];

const argomenti = process.argv.slice(2);
const SOLO_CONTROLLO = argomenti.includes('--controlla');
const RIFAI = argomenti.includes('--rifai');

function leggi(f) { return JSON.parse(fs.readFileSync(path.join(QUI, 'data', f), 'utf8')); }
function piu(d, n) { return new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function ordine(a, b) {
  const x = a.d + (a.o || '99:99'), y = b.d + (b.o || '99:99');
  return x < y ? -1 : (x > y ? 1 : 0);
}

/* Le giornate come le raggruppa l'app (raggruppaGiornate in index.html): il
   numero della giornata se c'e', altrimenti le date — piu' di quattro giorni
   dall'inizio, o dieci partite, e comincia la successiva. */
function raggruppa(lista) {
  const gruppi = [];
  lista.forEach(function (p) {
    const g = gruppi[gruppi.length - 1];
    let nuova;
    if (!g) nuova = true;
    else if (g.giornata && p.giornata) nuova = g.giornata !== p.giornata;
    else nuova = M.giorni(g.inizio, p.d) > 4 || g.partite.length >= 10;
    if (nuova) gruppi.push({ inizio: p.d, fine: p.d, partite: [], giornata: p.giornata || null });
    const h = gruppi[gruppi.length - 1];
    h.partite.push(p);
    if (p.d > h.fine) h.fine = p.d;
  });
  return gruppi;
}

/* Le 9 di mattina a Roma, in millisecondi: CEST fino all'ultima domenica di
   ottobre, CET dopo (e prima dell'ultima domenica di marzo). */
function ultimaDomenica(anno, mese) {
  const d = new Date(Date.UTC(anno, mese + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function alleNove(giorno) {
  const anno = +giorno.slice(0, 4);
  const estate = giorno >= ultimaDomenica(anno, 2) && giorno < ultimaDomenica(anno, 9);
  return Date.parse(giorno + 'T09:00:00' + (estate ? '+02:00' : '+01:00'));
}
function quandoSiGioca(inizio) {
  const g = new Date(Date.parse(inizio + 'T12:00:00Z')).getUTCDay();   /* 0 domenica, 6 sabato */
  return g === 6 ? piu(inizio, -1) : (g === 0 ? piu(inizio, -2) : inizio);
}
function iniziataAlle(p) {
  if (!p.o) return Date.parse(p.d + 'T12:00:00Z');
  const anno = +p.d.slice(0, 4);
  const estate = p.d >= ultimaDomenica(anno, 2) && p.d < ultimaDomenica(anno, 9);
  return Date.parse(p.d + 'T' + p.o + ':00' + (estate ? '+02:00' : '+01:00'));
}

/* Cosa serve per rigiocare la giornata che comincia con la prima partita di
   Serie A del gruppo: per ogni campionato le partite dopo le 9 di quel giorno,
   e la prima giornata di ognuno deve essere finita e avere le quote. */
function preparaGiornata(gruppo, leghe, docs, oggi) {
  const giorno = quandoSiGioca(gruppo.inizio);
  const adesso = alleNove(giorno);
  const calendari = {}, veri = {};
  let pronta = true, motivo = '';
  leghe.forEach(function (l) {
    const tutte = docs[l.id].partite.filter(function (p) { return p.gc != null; }).sort(ordine);
    const dopo = tutte.filter(function (p) { return iniziataAlle(p) > adesso && p.d <= piu(giorno, 14); });
    const prima = raggruppa(dopo)[0];
    if (!prima) { calendari[l.id] = []; return; }
    /* finita: ci sono tutte le partite di un turno (meta' delle squadre), o il
       campionato e' andato oltre, o sono passati cinque giorni */
    const squadre = {};
    tutte.forEach(function (p) { if (p.s === gruppo.partite[0].s) { squadre[p.c] = 1; squadre[p.v] = 1; } });
    const turno = Math.floor(Object.keys(squadre).length / 2);
    const oltre = tutte.some(function (p) { return p.d > piu(prima.fine, 1); });
    if (prima.partite.length < turno && !oltre && oggi < piu(prima.fine, 5)) {
      pronta = false; motivo = l.id + ' non ha finito la giornata';
    }
    if (prima.partite.some(function (p) { return !p.qap || !p.qapou; })) { pronta = false; motivo = l.id + ' senza le quote del venerdi\''; }
    calendari[l.id] = prima.partite.map(function (p) {
      const x = { s: p.s, d: p.d, o: p.o, c: p.c, v: p.v, q: p.qap, qou: p.qapou };
      if (p.giornata) x.giornata = p.giornata;
      veri[l.id + '|' + p.d + '|' + p.c + '|' + p.v] = { gc: p.gc, gv: p.gv, ptc: p.ptc, ptv: p.ptv };
      return x;
    });
  });
  return { inizio: gruppo.inizio, giorno: giorno, adesso: adesso, calendari: calendari, veri: veri,
           pronta: pronta, motivo: motivo };
}

function serviCartella(cartella) {
  return new Promise(function (fatto) {
    const tipi = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                   '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    const s = http.createServer(function (req, res) {
      const via = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const f = path.join(cartella, via);
      if (!f.startsWith(cartella) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': tipi[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', function () { fatto(s); });
  });
}

async function rigioca(g, leghe, docs, chromium) {
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'storico-'));
  fs.mkdirSync(path.join(cartella, 'data', 'leghe'), { recursive: true });
  FILE_SITO.forEach(function (f) {
    if (fs.existsSync(path.join(QUI, f))) fs.copyFileSync(path.join(QUI, f), path.join(cartella, f));
  });
  fs.copyFileSync(path.join(QUI, 'data', 'leghe.json'), path.join(cartella, 'data', 'leghe.json'));
  fs.writeFileSync(path.join(cartella, 'data', 'meta.json'), JSON.stringify({ aggiornato: g.giorno + 'T06:00:00+00:00' }));
  leghe.forEach(function (l) {
    const copia = Object.assign({}, docs[l.id]);
    copia.partite = docs[l.id].partite.filter(function (p) { return p.d < g.giorno; });
    copia.notizie = [];
    copia.aggiornato = g.giorno + 'T06:00:00+00:00';
    fs.writeFileSync(path.join(cartella, 'data', l.file), JSON.stringify(copia));
  });
  const server = await serviCartella(cartella);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Rome' });
    /* l'orologio della pagina spostato alla mattina di quel giorno */
    await ctx.addInitScript(function (T) {
      const Vera = Date, scarto = T - Vera.now();
      function Finta() {
        if (!(this instanceof Finta)) return new Vera(Vera.now() + scarto).toString();
        const a = Array.prototype.slice.call(arguments);
        return a.length ? new (Function.prototype.bind.apply(Vera, [null].concat(a)))() : new Vera(Vera.now() + scarto);
      }
      Finta.prototype = Vera.prototype;
      Finta.now = function () { return Vera.now() + scarto; };
      Finta.parse = Vera.parse; Finta.UTC = Vera.UTC;
      self.Date = Finta;
    }, g.adesso);
    /* il server finto: il calendario di quel giorno, tutto (come lo vede il capo) */
    await ctx.route(API + '/**', function (route) {
      const m = /^\/api\/calendario\/([A-Z0-9]+)$/.exec(new URL(route.request().url()).pathname);
      if (m) {
        const cal = g.calendari[m[1]] || [];
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ calendario: cal, totale: cal.length, mostrate: cal.length, tutto: true }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"errore":"rigioco"}' });
    });
    const pagina = await ctx.newPage();
    await pagina.goto('http://127.0.0.1:' + server.address().port + '/index.html');
    const t0 = Date.now();
    for (;;) {
      const pronto = await pagina.evaluate(function () {
        try { return S.stato === 'pronto' && !S.legheInCorso && legheCaricate().length >= (S.leghe || []).length; }
        catch (e) { return false; }
      });
      if (pronto) break;
      if (Date.now() - t0 > 300000) throw new Error('l\'app non e\' pronta dopo 5 minuti');
      await new Promise(function (r) { setTimeout(r, 1000); });
    }
    return await pagina.evaluate(function () {
      function gamba(c) {
        const p = c.partita;
        return { lega: c.lega ? c.lega.id : LEGA_CASA, d: p.d, c: p.c, v: p.v, id: c.id, nome: c.nome,
                 p: c.p, quota: quotaGamba(c) };
      }
      const solide = [];
      perOgniLega(function (lega) {
        partiteGiornata().forEach(function (p) {
          const sc = sceltePartita(p, 3);
          if (sc && sc.piuSolida) solide.push({ lega: lega.id, d: p.d, c: p.c, v: p.v, id: sc.piuSolida.id, p: sc.piuSolida.p });
        });
      });
      const livelli = consigliate().map(function (x) {
        return { id: x.livello.id, nome: x.livello.nome, quota: x.scelta ? x.scelta.quota : null,
                 p: x.scelta ? x.scelta.p : null, gambe: x.scelta ? x.scelta.scelte.map(gamba) : [] };
      });
      const q10 = _consCache && _consCache.quota10;
      livelli.push({ id: 'quota10', nome: 'Quota 10', quota: q10 ? q10.quota : null, p: q10 ? q10.p : null,
                     gambe: q10 ? q10.scelte.map(gamba) : [] });
      const cand = candidatiConsigliata(1.01);
      const sicure = SICURE_N.map(function (n) { return { n: n, gambe: sicureDi(cand, n).map(gamba) }; });
      return { solide: solide, dieci: dieciDellaGiornata().map(gamba), livelli: livelli, sicure: sicure };
    });
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(cartella, { recursive: true, force: true });
  }
}

/* Il conto, con la stessa regola con cui l'app e la classifica decidono chi
   ha vinto: M.haVinto. */
function conta(g, r) {
  function esito(x) {
    const v = g.veri[x.lega + '|' + x.d + '|' + x.c + '|' + x.v];
    if (!v) return null;
    const h = M.haVinto(x.id, v.gc, v.gv, v.ptc, v.ptv);
    return { ris: v.gc + '-' + v.gv, ok: h === null ? null : !!h };
  }
  function gambe(l) {
    return l.map(function (x) {
      const e = esito(x) || { ris: null, ok: null };
      return { lega: x.lega, d: x.d, c: x.c, v: x.v, id: x.id, nome: x.nome, p: Math.round(x.p * 1e4) / 1e4,
               quota: x.quota, ris: e.ris, ok: e.ok };
    });
  }
  function tutte(l) {
    if (!l.length || l.some(function (x) { return x.ok === null; })) return null;
    return l.every(function (x) { return x.ok; });
  }
  const livelli = r.livelli.map(function (l) {
    const gg = gambe(l.gambe);
    return { id: l.id, nome: l.nome, quota: l.quota && Math.round(l.quota * 100) / 100,
             p: l.p && Math.round(l.p * 1e4) / 1e4, vinta: tutte(gg), gambe: gg };
  });
  const dieci = gambe(r.dieci);
  const prodotto = function (l, campo) { return l.reduce(function (t, x) { return t * x[campo]; }, 1); };
  const sicure = r.sicure.map(function (s) {
    const gg = gambe(s.gambe);
    return { n: s.n, p: Math.round(prodotto(gg, 'p') * 1e4) / 1e4, quota: Math.round(prodotto(gg, 'quota') * 100) / 100,
             prese: gg.filter(function (x) { return x.ok; }).length, vinta: tutte(gg) };
  });
  let n = 0, promesse = 0, prese = 0;
  r.solide.forEach(function (x) {
    const e = esito(x);
    if (!e || e.ok === null) return;
    n++; promesse += x.p; prese += e.ok ? 1 : 0;
  });
  return {
    inizio: g.inizio, giocata: g.giorno, livelli: livelli,
    dieci: { gambe: dieci, n: dieci.length, prese: dieci.filter(function (x) { return x.ok; }).length,
             attese: Math.round(dieci.reduce(function (t, x) { return t + x.p; }, 0) * 100) / 100,
             tutte: Math.round(prodotto(dieci, 'p') * 1e4) / 1e4 },
    sicure: sicure,
    solide: { n: n, promesse: Math.round(promesse * 100) / 100, prese: prese }
  };
}

async function main() {
  const leghe = leggi('leghe.json').leghe;
  const docs = {};
  leghe.forEach(function (l) { docs[l.id] = leggi(l.file); });
  const casa = docs.I1 || docs[leghe[0].id];
  const stagione = (casa.stagioni || []).slice().sort().pop();
  const oggi = new Date().toISOString().slice(0, 10);
  const giornate = raggruppa(casa.partite.filter(function (p) { return p.s === stagione && p.gc != null; }).sort(ordine))
    .filter(function (g) { return g.partite.length >= 8; });

  let storico = { giornate: [] };
  if (!RIFAI && fs.existsSync(USCITA)) {
    try { storico = JSON.parse(fs.readFileSync(USCITA, 'utf8')); } catch (e) { storico = { giornate: [] }; }
  }
  const fatte = {};
  (storico.giornate || []).forEach(function (x) { fatte[x.inizio] = true; });
  const daFare = [];
  giornate.slice(-QUANTE).forEach(function (gr) {
    if (fatte[gr.inizio]) return;
    const g = preparaGiornata(gr, leghe, docs, oggi);
    if (g.pronta) daFare.push(g);
    else console.log('giornata del ' + gr.inizio + ': non ancora (' + g.motivo + ')');
  });
  console.log('giornate da rigiocare: ' + daFare.length);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'serve=' + (daFare.length ? 'si' : 'no') + '\n');
  if (SOLO_CONTROLLO || !daFare.length) return 0;

  const { chromium } = require('playwright');
  for (const g of daFare) {
    const t0 = Date.now();
    const r = await rigioca(g, leghe, docs, chromium);
    const x = conta(g, r);
    storico.giornate = (storico.giornate || []).filter(function (y) { return y.inizio !== x.inizio; }).concat([x]);
    console.log('giornata del ' + g.inizio + ' (giocata il ' + g.giorno + '): ' +
                x.livelli.map(function (l) { return l.id + ' ' + (l.vinta === null ? '?' : (l.vinta ? 'presa' : 'persa')); }).join(', ') +
                '; le 10: ' + x.dieci.prese + '/' + x.dieci.n + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }
  storico.giornate.sort(function (a, b) { return a.inizio < b.inizio ? 1 : -1; });
  storico.giornate = storico.giornate.slice(0, QUANTE);
  storico.aggiornato = new Date().toISOString();
  storico.come = COME;
  fs.writeFileSync(USCITA, JSON.stringify(storico));
  console.log('scritto ' + path.relative(QUI, USCITA) + ': ' + storico.giornate.length + ' giornate');
  return 0;
}

if (require.main === module) {
  main().then(function (c) { process.exitCode = c; }, function (e) {
    console.error('storico della Consigliata: ' + (e && e.message || e));
    process.exitCode = 1;
  });
}
module.exports = { raggruppa: raggruppa, alleNove: alleNove, quandoSiGioca: quandoSiGioca,
                   preparaGiornata: preparaGiornata, conta: conta };
