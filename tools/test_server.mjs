/* Il cancello, provato chiamandolo davvero.
   ══════════════════════════════════════════════════════════════════════════
   Non si provano i pezzi: si costruisce una KV finta in memoria e si chiama
   worker.fetch() come lo chiamerebbe Cloudflare. Una prova che controlla la
   funzione che firma i gettoni non dice niente su cosa succede quando arriva
   una richiesta vera con un gettone storto.

   La prova che conta di piu' e' una sola: un gettone FABBRICATO deve essere
   rifiutato. Tutto il resto di questo file protegge comodita'; quella protegge
   il fatto che l'abbonamento abbia senso.

   uso: node tools/test_server.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const QUI = dirname(fileURLToPath(import.meta.url));
const worker = (await import(join(QUI, '..', 'server', 'worker.js'))).default;

const ESITI = [];
function prova(nome, ok, dettaglio) { ESITI.push([nome, !!ok, dettaglio]); }

/* ── una KV finta: mette, prende, elenca, e fa scadere ── */
function kvFinta() {
  const m = new Map();
  return {
    _m: m,
    async get(k) {
      const v = m.get(k);
      if (!v) return null;
      if (v.scadeA && Date.now() > v.scadeA) { m.delete(k); return null; }
      return v.val;
    },
    async put(k, val, opz) {
      m.set(k, { val, scadeA: opz && opz.expirationTtl ? Date.now() + opz.expirationTtl * 1000 : 0,
                 metadata: (opz && opz.metadata) || null });
    },
    /* C'era il buco: questa finta KV non sapeva cancellare, e la KV vera si'.
       Il primo codice che ha provato a cancellare una chiave ha preso un 500
       e la prova diceva soltanto "non ha funzionato", senza dire perche'. Un
       doppione di prova che offre MENO dell'originale non prova il codice:
       prova il doppione. */
    async delete(k) { m.delete(k); },
    /* come la vera: in ordine alfabetico, coi metadati, e col limite */
    async list({ prefix, cursor, limit }) {
      const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).sort()
        .slice(0, limit || 1000).map(name => ({ name, metadata: m.get(name).metadata }));
      return { keys, list_complete: true, cursor: null };
    },
  };
}

const ORIGINE = 'https://w8997wnwy5-collab.github.io';
function ambiente() {
  return {
    CODICI: kvFinta(), DATI: kvFinta(),
    SEGRETO: 'segreto-di-prova-lungo-abbastanza',
    SEGRETO_ADMIN: 'admin-di-prova-0123456789',
    ORIGINI: ORIGINE,
  };
}
function chiedi(env, via, opz = {}) {
  const h = new Headers(opz.headers || {});
  if (!h.has('Origin')) h.set('Origin', ORIGINE);
  if (!h.has('CF-Connecting-IP')) h.set('CF-Connecting-IP', opz.ip || '1.2.3.4');
  if (opz.gettone) h.set('Authorization', 'Bearer ' + opz.gettone);
  if (opz.admin) h.set('Authorization', 'Bearer ' + opz.admin);
  return worker.fetch(new Request('https://api.esempio/' + via.replace(/^\//, ''), {
    method: opz.metodo || 'GET', headers: h,
    body: opz.corpo ? JSON.stringify(opz.corpo) : undefined,
  }), env);
}
const leggi = async r => ({ stato: r.status, corpo: await r.json().catch(() => null) });

/* ── un campionato finto con dieci partite ── */
async function preparaDati(env, lega = 'I1', quante = 10) {
  const cal = [];
  for (let i = 0; i < quante; i++) {
    cal.push({ d: '2026-10-' + String(10 + i).padStart(2, '0'), c: 'Casa' + i, v: 'Via' + i,
               q: [2.1, 3.3, 3.4] });
  }
  await env.DATI.put('cal:' + lega, JSON.stringify({ aggiornato: 'ora', calendario: cal }));
}
async function creaCodice(env, corpo) {
  const r = await chiedi(env, '/api/admin/crea', { metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo });
  return (await r.json()).codice;
}
async function entra(env, codice) {
  const r = await chiedi(env, '/api/codice', { metodo: 'POST', corpo: { codice } });
  return leggi(r);
}

/* ═══ 1. il taglio ═══ */
{
  const env = ambiente(); await preparaDati(env);
  const { stato, corpo } = await leggi(await chiedi(env, '/api/calendario/I1'));
  prova('senza codice si vedono tre partite', stato === 200 && corpo.calendario.length === 3,
        corpo && corpo.calendario && corpo.calendario.length);
  prova('e si dice quante ce ne sono dietro, o il muro non convince',
        corpo.totale === 10 && corpo.tutto === false, corpo && corpo.totale);
  prova('le tre sono le PRIME, non tre a caso', corpo.calendario[0].c === 'Casa0');
}

/* ═══ 1-bis. il taglio quando la stagione e' gia' cominciata ═══

   La prova che serviva davvero, e mancava. In archivio il calendario e' tutta
   la stagione: a ottobre le prime righe del file sono partite di agosto, gia'
   giocate. Tagliando "le prime tre" del file si mandavano tre partite morte,
   l'app le scartava perche' passate, e chi non aveva il codice apriva l'app e
   trovava il VUOTO. Un muro che non mostra niente non vende niente. */
{
  const env = ambiente();
  const giorno = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const cal = [];
  for (let i = 0; i < 12; i++) cal.push({ d: giorno(-40 + i), c: 'Vecchia' + i, v: 'Finita' + i });
  for (let i = 0; i < 8; i++) cal.push({ d: giorno(3 + i), c: 'Prossima' + i, v: 'Ospite' + i });
  await env.DATI.put('cal:I1', JSON.stringify({ aggiornato: 'ora', calendario: cal }));

  const { corpo } = await leggi(await chiedi(env, '/api/calendario/I1'));
  prova('col campionato in corso si vedono tre partite DA GIOCARE, non tre gia finite',
        corpo.calendario.length === 3 &&
        corpo.calendario.every(p => p.c.startsWith('Prossima')),
        corpo.calendario.map(p => p.c).join(','));
  prova('e sono le prime tre in ordine di data',
        corpo.calendario[0].c === 'Prossima0' && corpo.calendario[2].c === 'Prossima2');
  prova('il totale conta le partite future, non quelle di agosto',
        corpo.totale === 8, corpo.totale);

  /* l'ora conta: due partite lo stesso giorno vanno in ordine di orario */
  const cal2 = [{ d: giorno(2), o: '20:45', c: 'Sera', v: 'X' },
                { d: giorno(2), o: '15:00', c: 'Pomeriggio', v: 'Y' },
                { d: giorno(5), o: '18:00', c: 'Poi', v: 'Z' },
                { d: giorno(9), o: '18:00', c: 'Dopo', v: 'W' }];
  await env.DATI.put('cal:E0', JSON.stringify({ aggiornato: 'ora', calendario: cal2 }));
  const due = await leggi(await chiedi(env, '/api/calendario/E0'));
  prova('e a parita di giorno prima quella che si gioca prima',
        due.corpo.calendario[0].c === 'Pomeriggio' && due.corpo.calendario[1].c === 'Sera',
        due.corpo.calendario.map(p => p.c).join(','));
}

/* ═══ 2. i codici ═══ */
{
  const env = ambiente(); await preparaDati(env);
  const vip = await creaCodice(env, { tipo: 'vip', nome: 'un amico' });
  prova('un codice si legge al telefono: niente O/0 ne I/1/L',
        /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789-]+$/.test(vip), vip);

  const r = await entra(env, vip);
  prova('il codice VIP apre', r.stato === 200 && !!r.corpo.gettone);
  const g = r.corpo.gettone;

  const dopo = await leggi(await chiedi(env, '/api/calendario/I1', { gettone: g }));
  prova('e col gettone si vede tutto', dopo.corpo.calendario.length === 10 && dopo.corpo.tutto === true);

  const io = await leggi(await chiedi(env, '/api/io', { gettone: g }));
  prova('l\'app puo chiedere che diritti ha', io.corpo.tipo === 'vip' && io.corpo.tutto === true);

  const storto = await entra(env, 'XXXX-XXXX-XXXX');
  prova('un codice inventato non apre', storto.stato === 403);

  /* minuscole, spazi e trattini messi a caso devono funzionare lo stesso:
     chi lo copia da un messaggio non lo scrive mai identico */
  const sporco = await entra(env, ' ' + vip.toLowerCase().replace(/-/g, ' ') + ' ');
  prova('e uno scritto storto ma giusto apre comunque', sporco.stato === 200, sporco.stato);
}

/* ═══ 3. LA PROVA CHE CONTA: un gettone fabbricato ═══ */
{
  const env = ambiente(); await preparaDati(env);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const finto = b64({ tipo: 'vip', exp: Date.now() + 9e9 }) + '.' + b64('firma-inventata');
  const r = await leggi(await chiedi(env, '/api/calendario/I1', { gettone: finto }));
  prova('UN GETTONE FABBRICATO NON APRE', r.corpo.calendario.length === 3 && r.corpo.tutto === false,
        r.corpo && r.corpo.calendario && r.corpo.calendario.length);

  /* e uno vero, ma firmato con un altro segreto, nemmeno */
  const altro = ambiente(); altro.SEGRETO = 'un-altro-segreto-diverso';
  await preparaDati(altro);
  const suoVip = await creaCodice(altro, { tipo: 'vip' });
  const suoGettone = (await entra(altro, suoVip)).corpo.gettone;
  const incrociato = await leggi(await chiedi(env, '/api/calendario/I1', { gettone: suoGettone }));
  prova('ne uno firmato con un altro segreto', incrociato.corpo.calendario.length === 3);

  const rotto = await leggi(await chiedi(env, '/api/calendario/I1', { gettone: 'robaccia' }));
  prova('ne robaccia qualunque', rotto.corpo.calendario.length === 3);
}

/* ═══ 4. scadenze e revoche ═══ */
{
  const env = ambiente(); await preparaDati(env);
  const ab = await creaCodice(env, { tipo: 'abbonato', mesi: 1 });
  prova('un abbonamento apre finche dura', (await entra(env, ab)).stato === 200);

  /* lo si fa scadere a mano, come farebbe il tempo */
  const chiave = 'codice:' + ab.replace(/-/g, '');
  const voce = JSON.parse(await env.CODICI.get(chiave));
  voce.scade = new Date(Date.now() - 86400000).toISOString();
  await env.CODICI.put(chiave, JSON.stringify(voce));
  prova('e smette di aprire quando scade', (await entra(env, ab)).stato === 403);

  const vip = await creaCodice(env, { tipo: 'vip' });
  await chiedi(env, '/api/admin/revoca', { metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo: { codice: vip } });
  prova('un codice revocato smette di aprire', (await entra(env, vip)).stato === 403);
}

/* ═══ 5. il pannello ═══ */
{
  const env = ambiente();
  const senza = await chiedi(env, '/api/admin/elenco');
  prova('il pannello senza segreto non si apre', senza.status === 401);
  const quasi = await chiedi(env, '/api/admin/elenco', { admin: 'admin-di-prova-012345678X' });
  prova('e nemmeno con un segreto quasi giusto', quasi.status === 401);

  await creaCodice(env, { tipo: 'vip', nome: 'Tizio' });
  await creaCodice(env, { tipo: 'abbonato', mesi: 3 });
  const el = await leggi(await chiedi(env, '/api/admin/elenco', { admin: env.SEGRETO_ADMIN }));
  prova('col segreto si vede chi ha un codice', el.corpo.quanti === 2 && el.corpo.validi === 2,
        el.corpo && el.corpo.quanti);
  prova('e si vede a chi era destinato', el.corpo.codici.some(c => c.nome === 'Tizio'));
}

/* ═══ 6. il freno sui tentativi ═══ */
{
  const env = ambiente();
  let bloccato = false;
  for (let i = 0; i < 20; i++) {
    const r = await entra(env, 'AAAA-BBBB-CCC' + (i % 9));
    if (r.stato === 429) { bloccato = true; break; }
  }
  prova('dopo abbastanza codici sbagliati il freno scatta', bloccato);
}

/* ═══ 7. CORS ═══ */
{
  const env = ambiente(); await preparaDati(env);
  const estraneo = await chiedi(env, '/api/calendario/I1', { headers: { Origin: 'https://sito-cattivo.example' } });
  {
    const env2 = ambiente(); await preparaDati(env2);
    const buono = await creaCodice(env2, { tipo: 'vip', nome: 'tanti' });
    let tutti = true;
    for (let i = 0; i < 20; i++) {
      const r = await chiedi(env2, '/api/codice', { metodo: 'POST', ip: '9.9.9.9',
        corpo: { codice: buono } });
      if (r.status !== 200) { tutti = false; break; }
    }
    prova('IL FRENO NON PUNISCE CHI IL CODICE CE L HA: venti entrate giuste passano',
          tutti);
  }

  prova('un altro sito non riceve il permesso di leggere la risposta',
        !estraneo.headers.get('access-control-allow-origin'));
  const nostro = await chiedi(env, '/api/calendario/I1');
  prova('il nostro si', nostro.headers.get('access-control-allow-origin') === ORIGINE);
}
/* ═══ 7-bis. il capo ═══

   Il capo e' un VIP che puo' anche fare codici, cosi' invitare un amico costa
   tre tocchi dentro l'app invece di "apri il pannello, ritrova il segreto
   grosso, incollalo nel telefono". Il segreto grosso nel telefono e' proprio
   la cosa da evitare: da li' non esce piu', e un telefono perso sarebbe il
   deposito dei dati in mano a qualcun altro.

   Quindi i due confini che questo blocco difende, e che sono il motivo per
   cui il capo esiste invece di dare a tutti il segreto:
     - un capo NON puo' fare altri capi
     - un capo NON puo' toccare il deposito dei dati
   Un telefono perso regala abbonamenti, e si spegne. Non diventa padrone. */
{
  const env = ambiente(); await preparaDati(env);
  const codiceCapo = await creaCodice(env, { tipo: 'capo', nome: 'il boss' });
  const r = await entra(env, codiceCapo);
  prova('il codice da capo apre', r.stato === 200 && r.corpo.tutto !== false, r.stato);
  prova('e si presenta come capo', r.corpo.capo === true && r.corpo.tipo === 'capo', r.corpo.tipo);
  const g = r.corpo.gettone;

  const io = await leggi(await chiedi(env, '/api/io', { gettone: g }));
  prova('i diritti dicono capo e tutto aperto', io.corpo.capo === true && io.corpo.tutto === true);

  const cal = await leggi(await chiedi(env, '/api/calendario/I1', { gettone: g }));
  prova('e vede tutte le partite come un VIP', cal.corpo.calendario.length === 10);

  /* col suo gettone fa codici, senza mai vedere il segreto grosso */
  const fatto = await leggi(await chiedi(env, '/api/admin/crea',
    { metodo: 'POST', gettone: g, corpo: { tipo: 'vip', nome: 'un amico del boss' } }));
  prova('col gettone da capo si fa un codice per un amico',
        fatto.stato === 200 && !!fatto.corpo.codice, fatto.stato);
  const amico = await entra(env, fatto.corpo.codice);
  prova('e quel codice apre davvero', amico.stato === 200 && amico.corpo.capo === false);

  const visti = await leggi(await chiedi(env, '/api/admin/elenco', { gettone: g }));
  prova('il capo vede i codici che ha dato', visti.stato === 200 && visti.corpo.quanti >= 2);

  const tolto = await leggi(await chiedi(env, '/api/admin/revoca',
    { metodo: 'POST', gettone: g, corpo: { codice: fatto.corpo.codice } }));
  prova('e li puo revocare', tolto.stato === 200);
  const dopo = await entra(env, fatto.corpo.codice);
  prova('dopo la revoca quel codice non apre piu', dopo.stato === 403);

  /* i due confini */
  const altroCapo = await leggi(await chiedi(env, '/api/admin/crea',
    { metodo: 'POST', gettone: g, corpo: { tipo: 'capo', nome: 'un secondo boss' } }));
  prova('UN CAPO NON PUO FARE UN ALTRO CAPO', altroCapo.stato === 403, altroCapo.stato);

  const carico = await leggi(await chiedi(env, '/api/admin/carica/I1',
    { metodo: 'POST', gettone: g, corpo: { calendario: [] } }));
  prova('E NON PUO TOCCARE IL DEPOSITO DEI DATI', carico.stato === 401, carico.stato);

  /* e un VIP qualunque non comanda niente */
  const vip = await creaCodice(env, { tipo: 'vip', nome: 'uno normale' });
  const gv = (await entra(env, vip)).corpo.gettone;
  const prova1 = await leggi(await chiedi(env, '/api/admin/crea',
    { metodo: 'POST', gettone: gv, corpo: { tipo: 'vip', nome: 'furbo' } }));
  prova('un VIP normale non puo fare codici', prova1.stato === 401, prova1.stato);
}

/* ═══ 7-ter. la classifica ═══

   Qui si prova la cosa che tiene in piedi tutta la classifica: che il
   punteggio non se lo possa mettere chi gioca. Se la schedina la dichiara il
   giocatore a partita finita, la classifica diventa la graduatoria di chi
   mente meglio, e muore in una settimana.

   Tre chiodi, e sono le tre prove scritte in maiuscolo qui sotto. */
{
  const env = ambiente();
  const giorno = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  await env.DATI.put('cal:I1', JSON.stringify({ aggiornato: 'ora', calendario: [
    { d: giorno(3), o: '20:45', c: 'Inter', v: 'Milan', q: [2, 3.3, 3.8], qou: [1.9, 1.95] },
    { d: giorno(4), o: '15:00', c: 'Roma', v: 'Lazio', q: [2.2, 3.2, 3.4], qou: [2.05, 1.8] },
    { d: giorno(-2), o: '20:45', c: 'Napoli', v: 'Juve', q: [2.1, 3.3, 3.5] },
    { d: giorno(5), o: '18:00', c: 'Genoa', v: 'Lecce', q: [2.3, 3.1, 3.2] },
    { d: giorno(6), o: '18:00', c: 'Como', v: 'Pisa' },
  ] }));
  /* il prezzo onesto, calcolato qui a parte: quota equa senza margine, meno
     il ricarico della classifica, a due decimali */
  const equa = (q, i) => { const inv = q.map(x => 1 / x); return inv[i] / inv.reduce((a, b) => a + b, 0); };
  const prezzo = (pr) => Math.round((1 / pr) * (1 - 0.056) * 100) / 100;
  const q1Roma = prezzo(equa([2.2, 3.2, 3.4], 0));
  const qOver = prezzo(equa([1.9, 1.95], 0));

  const cod = await creaCodice(env, { tipo: 'vip', nome: 'uno' });
  const g = (await entra(env, cod)).corpo.gettone;

  /* senza nome non si gioca: in classifica un anonimo non ci sta */
  const senzaNome = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g,
    corpo: { gambe: [{ lega: 'I1', d: giorno(3), c: 'Inter', v: 'Milan', mercato: 'o15', quota: 1.3 }] } }));
  prova('senza un nome non si registra niente', senzaNome.stato === 428, senzaNome.stato);

  const nick = await leggi(await chiedi(env, '/api/nick',
    { metodo: 'POST', gettone: g, corpo: { nick: 'Cristian' } }));
  prova('il nome si mette una volta', nick.stato === 200 && nick.corpo.nick === 'Cristian', nick.stato);

  const corto = await leggi(await chiedi(env, '/api/nick',
    { metodo: 'POST', gettone: g, corpo: { nick: 'ab' } }));
  prova('e uno da due lettere non va bene', corto.stato === 400);

  /* il nome e' per sempre: e' quello che tiene insieme la classifica */
  const cambio = await leggi(await chiedi(env, '/api/nick',
    { metodo: 'POST', gettone: g, corpo: { nick: 'Cristiano' } }));
  prova('IL NOME NON SI CAMBIA PIU: chi perde non si ribattezza e riparte',
        cambio.stato === 409 && cambio.corpo.nick === 'Cristian', cambio.stato);
  const stesso = await leggi(await chiedi(env, '/api/nick',
    { metodo: 'POST', gettone: g, corpo: { nick: 'Cristian' } }));
  prova('ma rimetterlo uguale non e un errore', stesso.stato === 200);

  /* due persone, lo stesso nome */
  const cod2 = await creaCodice(env, { tipo: 'vip', nome: 'due' });
  const g2 = (await entra(env, cod2)).corpo.gettone;
  const doppio = await leggi(await chiedi(env, '/api/nick',
    { metodo: 'POST', gettone: g2, corpo: { nick: 'cristian' } }));
  prova('due giocatori non possono chiamarsi uguale', doppio.stato === 409, doppio.stato);

  /* la schedina vera */
  const ok = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(3), c: 'Inter', v: 'Milan', mercato: 'o25', quota: 1.95 },
            { lega: 'I1', d: giorno(4), c: 'Roma', v: 'Lazio', mercato: '1', quota: 2.20 }] } }));
  prova('una schedina su partite vere si registra, AL PREZZO DEL SERVER',
        ok.stato === 200 && Math.abs(ok.corpo.quota - qOver * q1Roma) < 0.002,
        ok.corpo && ok.corpo.quota + ' invece di ' + (qOver * q1Roma));
  prova('la gamba 1X2 costa quanto il mercato senza margine, meno il ricarico',
        ok.corpo.gambe[1].quota === q1Roma, ok.corpo.gambe && ok.corpo.gambe[1].quota + ' / ' + q1Roma);
  prova('e l\'Over 2.5 esattamente quanto il suo mercato: la Poisson si tara li\'',
        ok.corpo.gambe[0].quota === qOver, ok.corpo.gambe && ok.corpo.gambe[0].quota + ' / ' + qOver);

  /* I TRE CHIODI */
  const tardi = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(-2), c: 'Napoli', v: 'Juve', mercato: '1', quota: 2.1 }] } }));
  prova('UNA PARTITA GIA COMINCIATA NON SI REGISTRA', tardi.stato === 409, tardi.stato);

  const finta = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(3), c: 'Atalanta', v: 'Torino', mercato: '1', quota: 2.1 }] } }));
  prova('UNA PARTITA INVENTATA NON SI REGISTRA', finta.stato === 400, finta.stato);

  /* Il buco vero: la quota la dichiarava il telefono, e il tetto lasciava
     passare un Over 1.5 a 10. Adesso quella che manda non si legge nemmeno. */
  const onesta = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(3), c: 'Inter', v: 'Milan', mercato: 'O15', quota: 1.2 }] } }));
  const gonfia = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(3), c: 'Inter', v: 'Milan', mercato: 'O15', quota: 90 }] } }));
  prova('UNA QUOTA GONFIATA NON CONTA: il prezzo lo fa il server',
        gonfia.corpo.quota === onesta.corpo.quota && gonfia.corpo.quota < 1.5,
        gonfia.corpo.quota + ' / ' + onesta.corpo.quota);
  const o15 = onesta.corpo.quota;
  prova('e l\'Over 1.5 costa meno dell\'Over 2.5, come deve', o15 < qOver, o15 + ' / ' + qOver);

  const ignoto = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(3), c: 'Inter', v: 'Milan', mercato: 'PT1', quota: 3 }] } }));
  prova('UN MERCATO CHE IL SERVER NON SA PREZZARE NON ENTRA IN CLASSIFICA',
        ignoto.stato === 400 && /prezzare/.test(ignoto.corpo.errore), ignoto.corpo && ignoto.corpo.errore);
  const senzaGol = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(5), c: 'Genoa', v: 'Lecce', mercato: 'O25', quota: 2 }] } }));
  prova('senza le quote dei gol i mercati sui gol non passano', senzaGol.stato === 400, senzaGol.stato);
  const senzaNiente = await leggi(await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(6), c: 'Como', v: 'Pisa', mercato: '1', quota: 2 }] } }));
  prova('e una partita senza quote non passa per niente', senzaNiente.stato === 400, senzaNiente.stato);

  const suoi = await leggi(await chiedi(env, '/api/admin/salda', { metodo: 'POST', gettone: g,
    corpo: { esiti: [{ chiave: 'sch:x:y', vinta: true }] } }));
  prova('CHI GIOCA NON PUO SALDARE I PROPRI PUNTI', suoi.stato === 401, suoi.stato);

  /* il giro dei dati invece si', ed e' l'unico */
  const pend = await leggi(await chiedi(env, '/api/admin/pendenti', { admin: env.SEGRETO_ADMIN }));
  prova('il giro dei dati vede le schedine da saldare',
        pend.stato === 200 && pend.corpo.quante === 3, pend.corpo && pend.corpo.quante);
  const miaPend = pend.corpo.schedine.filter(x => Math.abs(x.quota - ok.corpo.quota) < 0.001)[0];

  const attesi = Math.max(1, Math.round(10 * Math.log2(ok.corpo.quota)));
  const saldo = await leggi(await chiedi(env, '/api/admin/salda', { metodo: 'POST', admin: env.SEGRETO_ADMIN,
    corpo: { esiti: [{ chiave: miaPend.chiave, vinta: true }] } }));
  prova('e i punti li mette lui: 10 per il logaritmo della quota',
        saldo.corpo.saldate === 1 && saldo.corpo.punti === attesi, JSON.stringify(saldo.corpo) + ' / ' + attesi);

  const cl = await leggi(await chiedi(env, '/api/classifica', { gettone: g }));
  prova('la classifica mostra il nome, non il codice',
        cl.corpo.classifica[0].nick === 'Cristian' && cl.corpo.classifica[0].punti === attesi,
        JSON.stringify(cl.corpo.classifica[0]));
  prova('e dice a ognuno il suo posto', cl.corpo.io && cl.corpo.io.posto === 1);
  prova('nessuna impronta esce insieme al nome',
        cl.corpo.classifica.every(x => x.id === undefined));

  const dinuovo = await leggi(await chiedi(env, '/api/admin/salda', { metodo: 'POST', admin: env.SEGRETO_ADMIN,
    corpo: { esiti: [{ chiave: miaPend.chiave, vinta: true }] } }));
  prova('una schedina saldata due volte non paga due volte', dinuovo.corpo.saldate === 0);

  /* IL GIRO CHE CADE A META': i punti sono gia' scritti, la schedina no.
     Si rimette la schedina "aperta" a mano, come l'avrebbe lasciata il crollo. */
  {
    const grezzo = JSON.parse(await env.CODICI.get(miaPend.chiave));
    grezzo.stato = 'aperta';
    await env.CODICI.put(miaPend.chiave, JSON.stringify(grezzo));
    const rifatto = await leggi(await chiedi(env, '/api/admin/salda', { metodo: 'POST',
      admin: env.SEGRETO_ADMIN, corpo: { esiti: [{ chiave: miaPend.chiave, vinta: true }] } }));
    const dopoCrollo = await leggi(await chiedi(env, '/api/io', { gettone: g }));
    prova('UN GIRO CADUTO A META\' NON PAGA DUE VOLTE: si chiude la schedina e basta',
          dopoCrollo.corpo.punti === attesi &&
          JSON.parse(await env.CODICI.get(miaPend.chiave)).stato === 'vinta',
          dopoCrollo.corpo.punti + ' / ' + attesi + ' ' + JSON.stringify(rifatto.corpo));
  }

  /* I PUNTI HANNO UN PROPRIETARIO SOLO: registrare una schedina dopo il
     saldo non tocca i punti, anche se il record del giocatore si riscrive */
  await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g, corpo: {
    gambe: [{ lega: 'I1', d: giorno(4), c: 'Roma', v: 'Lazio', mercato: 'X', quota: 3 }] } });
  const dopoGiocata = await leggi(await chiedi(env, '/api/io', { gettone: g }));
  prova('UNA SCHEDINA NUOVA NON PUO\' CANCELLARE I PUNTI DI UN SALDO',
        dopoGiocata.corpo.punti === attesi, dopoGiocata.corpo.punti);

  /* i giocatori di prima avevano i punti dentro il loro record */
  {
    await env.CODICI.put('gioc:vecchio1', JSON.stringify({ nick: 'Veterano', tipo: 'vip',
      punti: 30, vinte: 2, giocate: 5 }));
    const clv = await leggi(await chiedi(env, '/api/classifica', { gettone: g }));
    const vet = clv.corpo.classifica.filter(x => x.nick === 'Veterano')[0];
    prova('i punti di prima si leggono ancora da dove stavano',
          vet && vet.punti === 30 && vet.vinte === 2 && vet.giocate === 5, JSON.stringify(vet));
    await env.CODICI.put('sch:vecchio1:zz1', JSON.stringify({ id: 'zz1', quota: 4, stato: 'aperta',
      gambe: [] }));
    await chiedi(env, '/api/admin/salda', { metodo: 'POST', admin: env.SEGRETO_ADMIN,
      corpo: { esiti: [{ chiave: 'sch:vecchio1:zz1', vinta: true }] } });
    const clv2 = await leggi(await chiedi(env, '/api/classifica', { gettone: g }));
    const vet2 = clv2.corpo.classifica.filter(x => x.nick === 'Veterano')[0];
    prova('e il primo saldo nuovo ci somma sopra invece di ripartire da zero',
          vet2 && vet2.punti === 50 && vet2.vinte === 3, JSON.stringify(vet2));
  }

  /* IL REGISTRO: cosa e' successo, e quando */
  {
    const reg = await leggi(await chiedi(env, '/api/admin/registro', { admin: env.SEGRETO_ADMIN }));
    prova('il registro racconta i saldi, i piu\' recenti per primi',
          reg.stato === 200 && reg.corpo.righe[0].cosa === 'saldo' &&
          reg.corpo.righe.some(r => r.cosa === 'codice'), JSON.stringify(reg.corpo.righe.slice(0, 3)));
    prova('e nel registro il codice intero non c\'e\' mai',
          !JSON.stringify(reg.corpo).includes(cod), 'codice trovato nel registro');
    const vipReg = await chiedi(env, '/api/admin/registro', { gettone: g });
    prova('un VIP il registro non lo legge', vipReg.status === 401, vipReg.status);
  }

  /* IL TRASLOCO: l'ospite che paga non ricomincia da capo */
  {
    const o = await leggi(await chiedi(env, '/api/ospite', { metodo: 'POST' }));
    const go = o.corpo.gettone;
    await chiedi(env, '/api/nick', { metodo: 'POST', gettone: go, corpo: { nick: 'Provetta' } });
    await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: go, corpo: {
      gambe: [{ lega: 'I1', d: giorno(3), c: 'Inter', v: 'Milan', mercato: 'O15', quota: 1.3 }] } });

    const codVip = await creaCodice(env, { tipo: 'vip', nome: 'era ospite' });
    const r2 = await chiedi(env, '/api/codice',
      { metodo: 'POST', gettone: go, corpo: { codice: codVip } });
    const dentro = await leggi(r2);
    const io2 = await leggi(await chiedi(env, '/api/io', { gettone: dentro.corpo.gettone }));
    prova('e l app lo sa subito, senza doverlo richiedere',
          dentro.corpo.nick === 'Provetta', dentro.corpo.nick);
    prova('CHI PAGA NON RICOMINCIA DA CAPO: nome e punti lo seguono',
          io2.corpo.nick === 'Provetta' && io2.corpo.tutto === true, JSON.stringify(io2.corpo));

    /* e la schedina gia' registrata paga LUI, non l'ospite che non c'e' piu' */
    const cl2 = await leggi(await chiedi(env, '/api/classifica', { gettone: dentro.corpo.gettone }));
    prova('e le giocate gia fatte traslocano con lui',
          cl2.corpo.io && cl2.corpo.io.nick === 'Provetta' && cl2.corpo.io.giocate === 1,
          JSON.stringify(cl2.corpo.io));
    prova('e l ospite di prima sparisce dalla classifica invece di restarci doppio',
          cl2.corpo.classifica.filter(x => x.nick === 'Provetta').length === 1);

    /* ma due abbonamenti veri non si fondono */
    const cod3 = await creaCodice(env, { tipo: 'vip', nome: 'terzo' });
    const g3 = (await entra(env, cod3)).corpo.gettone;
    await chiedi(env, '/api/nick', { metodo: 'POST', gettone: g3, corpo: { nick: 'Terzo' } });
    const cod4 = await creaCodice(env, { tipo: 'vip', nome: 'quarto' });
    const dopo4 = await leggi(await chiedi(env, '/api/codice',
      { metodo: 'POST', gettone: g3, corpo: { codice: cod4 } }));
    const io4 = await leggi(await chiedi(env, '/api/io', { gettone: dopo4.corpo.gettone }));
    prova('DUE ABBONAMENTI VERI NON SI FONDONO MAI', !io4.corpo.nick, io4.corpo.nick);
  }

  /* l'ospite: niente codice, ma un nome e un posto */
  const osp = await leggi(await chiedi(env, '/api/ospite', { metodo: 'POST', ip: '7.7.7.7' }));
  prova('chi non ha un codice puo comunque avere un nome',
        osp.stato === 200 && !!osp.corpo.gettone && osp.corpo.tutto === false);

  /* ma non dieci: le fabbriche di identita' si fermano */
  let bloccato = false;
  for (let i = 0; i < 8; i++) {
    const r = await chiedi(env, '/api/ospite', { metodo: 'POST', ip: '8.8.8.8' });
    if (r.status === 429) { bloccato = true; break; }
  }
  prova('NIENTE DIECI ACCOUNT A TESTA: le identita a raffica si fermano', bloccato);
  const go = osp.corpo.gettone;
  const nickOsp = await leggi(await chiedi(env, '/api/nick',
    { metodo: 'POST', gettone: go, corpo: { nick: 'Ospite1' } }));
  prova('e si iscrive alla classifica', nickOsp.stato === 200);
  const calOsp = await leggi(await chiedi(env, '/api/calendario/I1', { gettone: go }));
  prova('MA RESTA FUORI: vede sempre e solo le partite gratis',
        calOsp.corpo.tutto === false && calOsp.corpo.calendario.length <= 3,
        calOsp.corpo && calOsp.corpo.calendario.length);
}

/* ═══ 8-bis. l'origine dimenticata ═══

   Montando il Worker dal pannello di Cloudflare invece che da riga di comando,
   le variabili si mettono a mano e ORIGINI e' facilissima da saltare. Senza
   un valore predefinito il browser rifiuterebbe ogni risposta e il sintomo
   sarebbe "il calendario non arriva": sembra il server rotto, e' una casella
   vuota. Quindi senza ORIGINI vale l'indirizzo dell'app — e solo quello. */
{
  const env = ambiente(); delete env.ORIGINI;
  await preparaDati(env);
  const nostro = await chiedi(env, '/api/calendario/I1', { headers: { Origin: ORIGINE } });
  prova('senza ORIGINI l\'app sua funziona lo stesso',
        nostro.headers.get('access-control-allow-origin') === ORIGINE,
        nostro.headers.get('access-control-allow-origin'));
  const altrui = await chiedi(env, '/api/calendario/I1', { headers: { Origin: 'https://ladro.example' } });
  prova('ma un altro sito no, nemmeno allora',
        !altrui.headers.get('access-control-allow-origin'));
}


/* ═══ 8. il deposito dei dati ═══ */
{
  const env = ambiente();
  const senza = await chiedi(env, '/api/admin/carica/E0', { metodo: 'POST', corpo: { calendario: [] } });
  prova('caricare i dati senza segreto non si puo', senza.status === 401);
  const con = await leggi(await chiedi(env, '/api/admin/carica/E0', {
    metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo: { calendario: [{ d: '2026-10-10', c: 'A', v: 'B' }] } }));
  prova('col segreto si', con.stato === 200 && con.corpo.partite === 1);
  const vuoto = await chiedi(env, '/api/admin/carica/E0', {
    metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo: { sbagliato: true } });
  prova('e un corpo senza calendario viene rifiutato invece di svuotare tutto', vuoto.status === 400);
}

/* ═══ 9. il freno sul deposito, e la memoria del giro ═══
   Il buco vero: un calendario VUOTO passava, perche' il freno guardava solo
   se il campo c'era. Un giro con la fonte giu' cancellava la stagione. */
{
  const env = ambiente(); await preparaDati(env, 'I1', 12);
  const vuoto = await leggi(await chiedi(env, '/api/admin/carica/I1', {
    metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo: { calendario: [] } }));
  prova('UN CALENDARIO VUOTO NON CANCELLA QUELLO DI PRIMA', vuoto.stato === 409, vuoto.stato);
  const resta = await leggi(await chiedi(env, '/api/admin/calendario/I1', { admin: env.SEGRETO_ADMIN }));
  prova('e quello di prima e\' ancora li\', intero', resta.stato === 200 &&
        resta.corpo.calendario.length === 12, resta.corpo && resta.corpo.calendario &&
        resta.corpo.calendario.length);

  const corto = [{ d: '2026-10-10', c: 'Casa0', v: 'Via0' }, { d: '2026-10-11', c: 'Casa1', v: 'Via1' }];
  const dimezzato = await leggi(await chiedi(env, '/api/admin/carica/I1', {
    metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo: { calendario: corto } }));
  prova('uno che perde piu\' di meta\' delle partite nemmeno',
        dimezzato.stato === 409 && dimezzato.corpo.prima === 12 && dimezzato.corpo.dopo === 2,
        JSON.stringify(dimezzato.corpo));

  const quasi = [];
  for (let i = 0; i < 7; i++) quasi.push({ d: '2026-10-1' + i, c: 'Casa' + i, v: 'Via' + i });
  const normale = await leggi(await chiedi(env, '/api/admin/carica/I1', {
    metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo: { calendario: quasi } }));
  prova('uno che ne perde meno di meta\' si', normale.stato === 200 && normale.corpo.partite === 7,
        normale.stato);

  const forzato = await leggi(await chiedi(env, '/api/admin/carica/I1?forza=1', {
    metodo: 'POST', admin: env.SEGRETO_ADMIN, corpo: { calendario: [] } }));
  prova('e con ?forza=1 passa anche il vuoto, apposta', forzato.stato === 200, forzato.stato);

  /* le partite gia' giocate non contano: a fine stagione il calendario si
     svuota da solo, e il freno non deve scambiarlo per un guasto */
  const env2 = ambiente();
  const passate = [];
  for (let i = 0; i < 20; i++) passate.push({ d: '2020-05-' + String(10 + i), c: 'C' + i, v: 'V' + i });
  await env2.DATI.put('cal:E0', JSON.stringify({ aggiornato: 'ieri', calendario: passate }));
  const fine = await leggi(await chiedi(env2, '/api/admin/carica/E0', {
    metodo: 'POST', admin: env2.SEGRETO_ADMIN, corpo: { calendario: [] } }));
  prova('ma a stagione finita il vuoto e\' la verita\', e passa', fine.stato === 200, fine.stato);

  const primo = await leggi(await chiedi(env2, '/api/admin/carica/SP1', {
    metodo: 'POST', admin: env2.SEGRETO_ADMIN, corpo: { calendario: [{ d: '2026-10-10', c: 'A', v: 'B' }] } }));
  prova('e il primo deposito di un campionato nuovo passa', primo.stato === 200, primo.stato);

  const senza = await chiedi(env, '/api/admin/calendario/I1');
  prova('la memoria del giro senza segreto non si legge', senza.status === 401, senza.status);
  const g = (await entra(env, await creaCodice(env, { tipo: 'capo', nome: 'boss' }))).corpo.gettone;
  const capo = await chiedi(env, '/api/admin/calendario/I1', { gettone: g });
  prova('NEMMENO DAL CAPO: e\' il mestiere della Action', capo.status === 401, capo.status);
  const manca = await chiedi(env, '/api/admin/calendario/D1', { admin: env.SEGRETO_ADMIN });
  prova('e un campionato mai depositato dice 404, non un calendario vuoto finto', manca.status === 404);
}

/* ═══ 10. il fischio d'inizio, con l'ora legale e con quella solare ═══
   Gli orari del calendario sono italiani. Il server faceva "meno due ore"
   fisso: dal 25 ottobre avrebbe chiuso le schedine un'ora prima del fischio.
   Qui si sposta l'orologio del server sui due lati del cambio d'ora. */
{
  const env = ambiente();
  await env.DATI.put('cal:I1', JSON.stringify({ aggiornato: 'ora', calendario: [
    { d: '2026-10-24', o: '15:00', c: 'Estate', v: 'Legale', q: [2, 3.3, 3.8], qou: [1.9, 1.95] },
    { d: '2026-10-26', o: '15:00', c: 'Inverno', v: 'Solare', q: [2, 3.3, 3.8], qou: [1.9, 1.95] },
  ] }));
  const vero = Date.now;
  const alle = (iso) => { Date.now = () => Date.parse(iso); };
  const gioca = async (g, c, v, d) => (await chiedi(env, '/api/schedina', { metodo: 'POST', gettone: g,
    corpo: { gambe: [{ lega: 'I1', d, c, v, mercato: '1' }] } })).status;
  try {
    alle('2026-10-20T10:00:00Z');
    const g = (await entra(env, await creaCodice(env, { tipo: 'vip', nome: 'orologio' }))).corpo.gettone;
    await chiedi(env, '/api/nick', { metodo: 'POST', gettone: g, corpo: { nick: 'Orologio' } });

    alle('2026-10-26T13:30:00Z');            /* 14:30 in Italia, si gioca alle 15:00 */
    prova('COL\'ORA SOLARE MEZZ\'ORA PRIMA DEL FISCHIO SI GIOCA ANCORA',
          await gioca(g, 'Inverno', 'Solare', '2026-10-26') === 200);
    alle('2026-10-26T14:01:00Z');            /* 15:01 in Italia */
    prova('e un minuto dopo il fischio no', await gioca(g, 'Inverno', 'Solare', '2026-10-26') === 409);
    alle('2026-10-24T12:59:00Z');            /* 14:59 in Italia, ora legale */
    prova('con l\'ora legale, un minuto prima si gioca',
          await gioca(g, 'Estate', 'Legale', '2026-10-24') === 200);
    alle('2026-10-24T13:01:00Z');            /* 15:01 in Italia */
    prova('e un minuto dopo no', await gioca(g, 'Estate', 'Legale', '2026-10-24') === 409);
  } finally {
    Date.now = vero;
  }
}

/* ── resoconto ── */
const larghezza = Math.max(...ESITI.map(([n]) => n.length));
let falliti = 0;
for (const [nome, ok, dett] of ESITI) {
  console.log(`${ok ? 'ok  ' : 'FALLITO'}  ${nome.padEnd(larghezza)}${ok ? '' : '   → ' + dett}`);
  if (!ok) falliti++;
}
console.log(`\n${ESITI.length} prove, ${falliti} fallite`);
process.exit(falliti ? 1 : 0);
