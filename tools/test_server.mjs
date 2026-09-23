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
      m.set(k, { val, scadeA: opz && opz.expirationTtl ? Date.now() + opz.expirationTtl * 1000 : 0 });
    },
    async list({ prefix, cursor }) {
      const keys = [...m.keys()].filter(k => k.startsWith(prefix || '')).map(name => ({ name }));
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
  prova('un altro sito non riceve il permesso di leggere la risposta',
        !estraneo.headers.get('access-control-allow-origin'));
  const nostro = await chiedi(env, '/api/calendario/I1');
  prova('il nostro si', nostro.headers.get('access-control-allow-origin') === ORIGINE);
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

/* ── resoconto ── */
const larghezza = Math.max(...ESITI.map(([n]) => n.length));
let falliti = 0;
for (const [nome, ok, dett] of ESITI) {
  console.log(`${ok ? 'ok  ' : 'FALLITO'}  ${nome.padEnd(larghezza)}${ok ? '' : '   → ' + dett}`);
  if (!ok) falliti++;
}
console.log(`\n${ESITI.length} prove, ${falliti} fallite`);
process.exit(falliti ? 1 : 0);
