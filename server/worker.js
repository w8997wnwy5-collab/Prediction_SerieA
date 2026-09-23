/* Il cancello.
   ══════════════════════════════════════════════════════════════════════════
   L'app sta su GitHub Pages, che e' un sito statico: non puo' decidere niente.
   Un controllo scritto in JavaScript dentro la pagina nasconde i pulsanti, non
   i dati — chiunque apra l'indirizzo del file se li prende, senza nemmeno
   vedere la schermata d'accesso. Per questo esiste questo pezzo: e' l'unico
   punto in cui "chi puo' vedere cosa" viene deciso da qualcuno che non e' il
   telefono di chi guarda.

   Cosa passa di qui e cosa no, e perche':

     l'ARCHIVIO (le partite gia' giocate) resta pubblico sul sito. Sono i
     risultati di football-data.co.uk, scaricabili da chiunque: metterli sotto
     chiave non proteggerebbe niente e costringerebbe a far passare tre
     megabyte per il server a ogni apertura.

     il CALENDARIO (le partite in arrivo, con le quote) passa da qui, ed e'
     l'unica cosa che vale la pena vendere: le quote costano crediti veri, e
     sono quelle che servono per giocare.

   Chi non ha un codice vede le prime tre partite di ogni campionato. Non e'
   un assaggio finto: sono tre partite vere, con la selezione vera. Quello che
   manca e' il resto.

   Endpoint:
     POST /api/codice     un codice → un gettone firmato
     GET  /api/io         cosa dice il gettone che hai
     GET  /api/calendario/:lega    il calendario, intero o tagliato
     POST /api/admin/...  creare, elencare e revocare codici (segreto a parte)
   ══════════════════════════════════════════════════════════════════════════ */

const GRATIS = 3;                 /* partite per campionato senza codice */

/* L'indirizzo da cui l'app parla con questa API.
   Si puo' cambiare con la variabile ORIGINI, ma un valore predefinito ci
   vuole: senza, un ORIGINI dimenticato durante il montaggio vorrebbe dire
   che il browser rifiuta OGNI richiesta, e l'unico sintomo sarebbe "il
   calendario non arriva" — un guasto che sembra il server rotto e invece e'
   una casella vuota. L'asterisco no: vorrebbe dire che qualunque sito puo'
   far parlare il browser di chi passa con questa API usando il suo gettone. */
const ORIGINI_PREDEFINITE = 'https://w8997wnwy5-collab.github.io';
const GETTONE_GIORNI = 30;        /* ogni quanto il telefono deve ripresentarsi */
const TENTATIVI_ORA = 12;         /* codici sbagliati tollerati, per indirizzo */

/* ─────────────────────────── utilita' ─────────────────────────── */

const enc = new TextEncoder();

/* Il giorno di oggi come lo conta chi gioca: a Roma, non a Greenwich.

   D'estate l'Italia e' due ore avanti su UTC, e una partita delle 20:45 del
   sabato per UTC e' ancora sabato: fin qui pari. Ma alle 00:30 italiane di
   domenica UTC e' ancora sabato, e il taglio "da oggi in poi" lascerebbe
   dentro una giornata gia' finita. Un fuso orario sbagliato non rompe niente
   in modo visibile: sposta le cose di un giorno, ogni tanto. */
function oggiARoma() {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function json(dati, stato = 200, extra = {}) {
  return new Response(JSON.stringify(dati), {
    status: stato,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

/* CORS: solo l'origine dell'app, e solo quella. Un asterisco qui vorrebbe dire
   che qualunque sito puo' far parlare il browser di chi passa con questa API
   usando il suo gettone. */
function intestazioniCors(req, env) {
  const ammesse = (env.ORIGINI || ORIGINI_PREDEFINITE).split(',').map(s => s.trim()).filter(Boolean);
  const origine = req.headers.get('Origin') || '';
  if (!ammesse.includes(origine)) return null;
  return {
    'access-control-allow-origin': origine,
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function base64url(buf) {
  const b = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function daBase64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function chiave(segreto) {
  return crypto.subtle.importKey('raw', enc.encode(segreto),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/* Il gettone: un pezzetto di JSON e la sua firma. Non e' cifrato e non deve
   esserlo — dentro non c'e' niente di segreto, c'e' solo "fino a quando" e
   "che tipo". Il punto e' che non si possa CAMBIARE, ed e' la firma a
   garantirlo. */
async function firmaGettone(dati, segreto) {
  const corpo = base64url(enc.encode(JSON.stringify(dati)));
  const firma = base64url(await crypto.subtle.sign('HMAC', await chiave(segreto), enc.encode(corpo)));
  return corpo + '.' + firma;
}

async function leggiGettone(gettone, segreto) {
  if (typeof gettone !== 'string' || !gettone.includes('.')) return null;
  const [corpo, firma] = gettone.split('.');
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await chiave(segreto),
      daBase64url(firma), enc.encode(corpo));
  } catch (e) { return null; }
  if (!ok) return null;
  let dati;
  try { dati = JSON.parse(new TextDecoder().decode(daBase64url(corpo))); }
  catch (e) { return null; }
  if (!dati || typeof dati.exp !== 'number' || Date.now() > dati.exp) return null;
  return dati;
}

/* Un codice leggibile al telefono: niente 0/O ne' 1/I/L, che al bar sotto una
   luce storta si scambiano e fanno sembrare rotto un codice giusto. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function nuovoCodice(pezzi = 3, lungo = 4) {
  const n = pezzi * lungo;
  const caso = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (let i = 0; i < n; i++) {
    if (i && i % lungo === 0) s += '-';
    s += ALFABETO[caso[i] % ALFABETO.length];
  }
  return s;
}

function normalizza(codice) {
  return String(codice || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* Un codice e' valido se esiste, non e' stato revocato e non e' scaduto. */
function vale(voce) {
  if (!voce || voce.revocato) return false;
  if (voce.tipo === 'vip') return true;
  return !!voce.scade && new Date(voce.scade).getTime() > Date.now();
}

/* Il freno sui tentativi. Senza, un codice da dodici caratteri si trova a
   forza bruta con abbastanza pazienza e abbastanza richieste. */
async function troppiTentativi(env, ip) {
  if (!env.CODICI || !ip) return false;
  const k = 'freno:' + ip + ':' + Math.floor(Date.now() / 3600000);
  const n = parseInt(await env.CODICI.get(k) || '0', 10);
  if (n >= TENTATIVI_ORA) return true;
  await env.CODICI.put(k, String(n + 1), { expirationTtl: 3700 });
  return false;
}

/* ─────────────────────────── i diritti ─────────────────────────── */

async function dirittiDa(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const gettone = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const dati = await leggiGettone(gettone, env.SEGRETO);
  if (!dati) return { tipo: 'libero', tutto: false };
  return {
    tipo: dati.tipo,
    nome: dati.nome || '',
    scade: dati.scade || null,
    tutto: dati.tipo === 'vip' ||
           (!!dati.scade && new Date(dati.scade).getTime() > Date.now()),
  };
}

/* ─────────────────────────── le rotte ─────────────────────────── */

async function postCodice(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || '';
  if (await troppiTentativi(env, ip)) {
    return json({ errore: 'troppi tentativi, riprova fra un\'ora' }, 429);
  }
  let corpo;
  try { corpo = await req.json(); } catch (e) { return json({ errore: 'richiesta illeggibile' }, 400); }
  const codice = normalizza(corpo && corpo.codice);
  if (codice.length < 6) return json({ errore: 'codice non valido' }, 400);

  const grezzo = await env.CODICI.get('codice:' + codice);
  const voce = grezzo ? JSON.parse(grezzo) : null;
  if (!vale(voce)) return json({ errore: 'codice non valido o scaduto' }, 403);

  /* si segna quando e' stato usato l'ultima volta, cosi' si vede chi e' vivo
     e chi no senza chiedere niente a nessuno */
  voce.ultimoUso = new Date().toISOString();
  voce.usi = (voce.usi || 0) + 1;
  await env.CODICI.put('codice:' + codice, JSON.stringify(voce));

  const gettone = await firmaGettone({
    tipo: voce.tipo, nome: voce.nome || '', scade: voce.scade || null,
    exp: Date.now() + GETTONE_GIORNI * 86400000,
  }, env.SEGRETO);
  return json({ gettone, tipo: voce.tipo, nome: voce.nome || '', scade: voce.scade || null });
}

async function getIo(req, env) {
  return json(await dirittiDa(req, env));
}

async function getCalendario(req, env, lega) {
  if (!/^[A-Z0-9]{1,6}$/.test(lega)) return json({ errore: 'campionato sconosciuto' }, 400);
  const grezzo = await env.DATI.get('cal:' + lega);
  if (!grezzo) return json({ errore: 'campionato non disponibile' }, 404);
  const doc = JSON.parse(grezzo);
  const diritti = await dirittiDa(req, env);
  const tutte = doc.calendario || [];
  if (diritti.tutto) {
    return json({ lega, aggiornato: doc.aggiornato, calendario: tutte,
                  totale: tutte.length, mostrate: tutte.length, tutto: true });
  }
  /* Le prime GRATIS in ordine di data: partite vere, non un assaggio finto.
     E si dice quante ne restano dietro, perche' un muro che non dice cosa
     nasconde non convince nessuno a pagarlo.

     "Le prime tre" vuol dire le prime tre ANCORA DA GIOCARE, e la differenza
     non e' una sfumatura. In archivio il calendario e' tutta la stagione, in
     ordine di data, partite finite comprese: a fine settembre le prime tre
     righe del file sono tre partite del 18 e 19, gia' giocate. Tagliando li'
     si mandavano tre partite che l'app scarta perche' passate, e chi non ha
     il codice apriva l'app e non trovava NIENTE — non un assaggio: il vuoto,
     che e' il modo piu' sicuro di non vendere un abbonamento.

     Per lo stesso motivo il totale e' quello delle partite future e non delle
     trecentoquaranta della stagione: "3 su 340" conterebbe come nascoste
     anche quelle di agosto, e sarebbe un numero gonfiato. */
  const oggi = oggiARoma();
  const future = tutte
    .filter((p) => p && p.d && p.d >= oggi && p.c && p.v)
    .sort((a, b) => (a.d === b.d
      ? String(a.o || '99:99').localeCompare(String(b.o || '99:99'))
      : (a.d < b.d ? -1 : 1)));
  const mostrate = future.slice(0, GRATIS);
  return json({ lega, aggiornato: doc.aggiornato, calendario: mostrate,
                totale: future.length, mostrate: mostrate.length, tutto: false });
}

/* ─────────────────────────── il pannello ─────────────────────────── */

function ammesso(req, env) {
  const a = req.headers.get('Authorization') || '';
  const dato = a.startsWith('Bearer ') ? a.slice(7) : '';
  /* confronto a tempo costante: con un == secco la durata della risposta
     racconta quante lettere iniziali sono giuste */
  const atteso = env.SEGRETO_ADMIN || '';
  if (!atteso || dato.length !== atteso.length) return false;
  let diff = 0;
  for (let i = 0; i < atteso.length; i++) diff |= dato.charCodeAt(i) ^ atteso.charCodeAt(i);
  return diff === 0;
}

async function adminCrea(req, env) {
  let c;
  try { c = await req.json(); } catch (e) { c = {}; }
  const tipo = c.tipo === 'vip' ? 'vip' : 'abbonato';
  const mesi = Math.max(1, Math.min(24, parseInt(c.mesi, 10) || 1));
  const codice = nuovoCodice();
  const voce = {
    tipo, nome: String(c.nome || '').slice(0, 60),
    creato: new Date().toISOString(),
    scade: tipo === 'vip' ? null : new Date(Date.now() + mesi * 30 * 86400000).toISOString(),
    usi: 0,
  };
  await env.CODICI.put('codice:' + normalizza(codice), JSON.stringify(voce));
  return json({ codice, ...voce });
}

async function adminElenco(env) {
  const fuori = [];
  let cursore;
  do {
    const p = await env.CODICI.list({ prefix: 'codice:', cursor: cursore });
    for (const k of p.keys) {
      const v = JSON.parse(await env.CODICI.get(k.name) || '{}');
      fuori.push({ codice: k.name.slice(7), ...v, valido: vale(v) });
    }
    cursore = p.list_complete ? null : p.cursor;
  } while (cursore);
  fuori.sort((a, b) => String(b.creato || '').localeCompare(String(a.creato || '')));
  return json({ codici: fuori, quanti: fuori.length,
                validi: fuori.filter(x => x.valido).length });
}

async function adminRevoca(req, env) {
  let c;
  try { c = await req.json(); } catch (e) { c = {}; }
  const codice = normalizza(c.codice);
  const grezzo = await env.CODICI.get('codice:' + codice);
  if (!grezzo) return json({ errore: 'codice inesistente' }, 404);
  const voce = JSON.parse(grezzo);
  voce.revocato = new Date().toISOString();
  await env.CODICI.put('codice:' + codice, JSON.stringify(voce));
  return json({ ok: true, codice, revocato: voce.revocato });
}

/* Il giro dei dati deposita qui i calendari. Stessa porta del pannello. */
async function adminCarica(req, env, lega) {
  if (!/^[A-Z0-9]{1,6}$/.test(lega)) return json({ errore: 'campionato sconosciuto' }, 400);
  let corpo;
  try { corpo = await req.json(); } catch (e) { return json({ errore: 'corpo illeggibile' }, 400); }
  if (!Array.isArray(corpo && corpo.calendario)) {
    return json({ errore: 'manca il calendario' }, 400);
  }
  await env.DATI.put('cal:' + lega, JSON.stringify({
    aggiornato: new Date().toISOString(), calendario: corpo.calendario,
  }));
  return json({ ok: true, lega, partite: corpo.calendario.length });
}

/* ─────────────────────────── l'ingresso ─────────────────────────── */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const via = url.pathname;
    const cors = intestazioniCors(req, env);

    if (req.method === 'OPTIONS') {
      return cors ? new Response(null, { status: 204, headers: cors })
                  : new Response(null, { status: 403 });
    }

    const rispondi = async () => {
      try {
        if (via === '/api/codice' && req.method === 'POST') return await postCodice(req, env);
        if (via === '/api/io' && req.method === 'GET') return await getIo(req, env);
        const cal = /^\/api\/calendario\/([A-Za-z0-9]{1,6})$/.exec(via);
        if (cal && req.method === 'GET') return await getCalendario(req, env, cal[1].toUpperCase());

        if (via.startsWith('/api/admin/')) {
          if (!ammesso(req, env)) return json({ errore: 'non ammesso' }, 401);
          if (via === '/api/admin/crea' && req.method === 'POST') return await adminCrea(req, env);
          if (via === '/api/admin/elenco' && req.method === 'GET') return await adminElenco(env);
          if (via === '/api/admin/revoca' && req.method === 'POST') return await adminRevoca(req, env);
          const car = /^\/api\/admin\/carica\/([A-Za-z0-9]{1,6})$/.exec(via);
          if (car && req.method === 'POST') return await adminCarica(req, env, car[1].toUpperCase());
        }
        return json({ errore: 'non trovato' }, 404);
      } catch (e) {
        /* il messaggio vero resta nei registri di Cloudflare: qui fuori non
           deve uscire niente che racconti com'e' fatto dentro */
        console.log('errore', via, e && e.message);
        return json({ errore: 'errore interno' }, 500);
      }
    };

    const r = await rispondi();
    if (!cors) return r;
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(r.body, { status: r.status, headers: h });
  },
};
