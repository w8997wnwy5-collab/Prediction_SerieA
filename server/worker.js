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
const GAMBE_MAX = 8;              /* gambe per schedina: oltre, non e' piu' una giocata */
const CLASSIFICA_QUANTI = 50;     /* quanti se ne mandano */
const NICK_MIN = 3, NICK_MAX = 16;
const OSPITI_ORA = 4;             /* identita' da ospite per indirizzo, all'ora */

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
  if (voce.tipo === 'vip' || voce.tipo === 'capo') return true;
  return !!voce.scade && new Date(voce.scade).getTime() > Date.now();
}

/* Il freno sui tentativi. Senza, un codice da dodici caratteri si trova a
   forza bruta con abbastanza pazienza e abbastanza richieste. */
function chiaveFreno(ip) {
  return 'freno:' + ip + ':' + Math.floor(Date.now() / 3600000);
}
async function troppiTentativi(env, ip) {
  if (!env.CODICI || !ip) return false;
  const n = parseInt(await env.CODICI.get(chiaveFreno(ip)) || '0', 10);
  return n >= TENTATIVI_ORA;
}

/* Si contano solo i codici SBAGLIATI, e la differenza non e' un dettaglio.

   Contando anche quelli giusti, il freno pensato contro chi tira a indovinare
   colpiva prima di tutto la gente normale: dodici attivazioni riuscite nella
   stessa ora e il tredicesimo resta fuori. E "la stessa ora dallo stesso
   indirizzo" non vuol dire "la stessa persona" — dietro la rete mobile
   l'indirizzo e' condiviso fra migliaia di abbonati, quindi sarebbe bastato
   che dodici sconosciuti attivassero il codice quel pomeriggio per murare il
   tredicesimo, che ha pagato. Chi indovina un codice da dodici caratteri non
   lo indovina sbagliando poche volte: il freno deve contare gli errori. */
async function segnaTentativo(env, ip) {
  if (!env.CODICI || !ip) return;
  const k = chiaveFreno(ip);
  const n = parseInt(await env.CODICI.get(k) || '0', 10);
  await env.CODICI.put(k, String(n + 1), { expirationTtl: 3700 });
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
    capo: !!dati.capo,
    tutto: dati.tipo === 'vip' || dati.tipo === 'capo' ||
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
  if (codice.length < 6) {
    await segnaTentativo(env, ip);
    return json({ errore: 'codice non valido' }, 400);
  }

  const grezzo = await env.CODICI.get('codice:' + codice);
  const voce = grezzo ? JSON.parse(grezzo) : null;
  if (!vale(voce)) {
    await segnaTentativo(env, ip);
    return json({ errore: 'codice non valido o scaduto' }, 403);
  }

  /* si segna quando e' stato usato l'ultima volta, cosi' si vede chi e' vivo
     e chi no senza chiedere niente a nessuno */
  voce.ultimoUso = new Date().toISOString();
  voce.usi = (voce.usi || 0) + 1;
  await env.CODICI.put('codice:' + codice, JSON.stringify(voce));

  /* Dentro il gettone va l'IMPRONTA del codice, non il codice.

     Serve un nome stabile per la classifica — il punteggio deve ritrovare il
     suo proprietario a ogni accesso — e il codice quel lavoro lo farebbe. Ma
     il codice e' un segreto che apre l'app, e il gettone e' solo firmato, non
     cifrato: chiunque lo legga se lo ritroverebbe dentro in chiaro. Chi passa
     il gettone a un amico gli regala l'accesso per trenta giorni; se ci
     mettessimo il codice gli regalerebbe l'accesso per sempre, e senza
     saperlo. L'impronta identifica e non rivela. */
  const gid = await chiaveGiocatore(codice, env.SEGRETO);
  await traslocaOspite(req, env, gid);
  const gettone = await firmaGettone({
    tipo: voce.tipo, nome: voce.nome || '', scade: voce.scade || null,
    capo: voce.tipo === 'capo', gid: gid,
    exp: Date.now() + GETTONE_GIORNI * 86400000,
  }, env.SEGRETO);
  /* Il nome di chi entra viaggia con la risposta. Senza, l'app che ha appena
     fatto entrare qualcuno non sa come si chiama, e gli rimette davanti la
     schermata "come ti chiami?" — a uno che il nome ce l'ha gia' e magari se
     l'e' appena portato dietro traslocando. Il server lo sapeva: bastava
     dirlo, invece di farlo chiedere un'altra volta. */
  const mio = await leggiGiocatore(env, gid);
  const pt = await leggiPunti(env, gid, mio);
  return json({ gettone, tipo: voce.tipo, nome: voce.nome || '',
                scade: voce.scade || null, capo: voce.tipo === 'capo',
                nick: (mio && mio.nick) || null,
                punti: pt.punti || 0, vinte: pt.vinte || 0 });
}

/* IL TRASLOCO

   Il percorso normale di chi paga e' questo: prova l'app gratis, si mette un
   nome, gioca qualche schedina sulle tre partite che vede, e poi prende il
   codice. Se mettere il codice gli desse un'identita' nuova di zecca, in quel
   momento perderebbe nome e punti — e il nome non potrebbe nemmeno
   riprenderselo, perche' risulterebbe gia' occupato da se stesso di cinque
   minuti prima. Il premio per aver pagato sarebbe ricominciare da capo.

   Quindi quando un OSPITE entra con un codice si porta dietro quello che ha:
   nome, punti, schedine. Solo da ospite: due abbonamenti veri non si fondono
   mai — quello sarebbe un modo per sommare i punti di due persone — e non si
   trasloca sopra a un giocatore che esiste gia'. */
async function traslocaOspite(req, env, nuovo) {
  const vecchioIo = await chiSono(req, env);
  if (!vecchioIo || vecchioIo.id === nuovo) return;
  if (vecchioIo.tipo !== 'libero') return;             /* solo dagli ospiti */

  const g = await leggiGiocatore(env, vecchioIo.id);
  if (!g || !g.nick) return;
  if (await env.CODICI.get('gioc:' + nuovo)) return;   /* il nuovo esiste gia' */

  g.aggiornato = new Date().toISOString();
  await env.CODICI.put('gioc:' + nuovo, JSON.stringify(g));
  await env.CODICI.put('nick:' + g.nick.toLowerCase(), nuovo);
  await env.CODICI.delete('gioc:' + vecchioIo.id);
  const pt = await env.CODICI.get('punti:' + vecchioIo.id);
  if (pt) {
    await env.CODICI.put('punti:' + nuovo, pt);
    await env.CODICI.delete('punti:' + vecchioIo.id);
  }
  await registra(env, 'trasloco', g.nick + ': da ospite a codice');

  /* e le schedine gia' registrate: senza, quelle in attesa pagherebbero
     punti a un giocatore che non c'e' piu' */
  let cursore;
  do {
    const p = await env.CODICI.list({ prefix: 'sch:' + vecchioIo.id + ':', cursor: cursore });
    for (const k of p.keys) {
      const v = await env.CODICI.get(k.name);
      if (v) {
        await env.CODICI.put('sch:' + nuovo + ':' + k.name.split(':')[2], v);
        await env.CODICI.delete(k.name);
      }
    }
    cursore = p.list_complete ? null : p.cursor;
  } while (cursore);
}

async function getIo(req, env) {
  const d = await dirittiDa(req, env);
  const io = await chiSono(req, env);
  /* "Valido" e "apre tutto" sono due cose diverse, e confonderle costava un
     bug intero: il gettone da ospite e' validissimo e non apre niente. L'app
     butta il gettone quando non vale, non quando non apre. */
  d.valido = !!io;
  if (io) {
    const g = await leggiGiocatore(env, io.id);
    const pt = await leggiPunti(env, io.id, g);
    d.nick = (g && g.nick) || null;
    d.punti = pt.punti || 0;
    d.vinte = pt.vinte || 0;
  }
  return json(d);
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

/* Chi puo' fare e disfare i codici.

   Due chiavi diverse per due mestieri diversi. Il SEGRETO_ADMIN e' la chiave
   del padrone di casa: apre tutto, compreso il deposito dei dati, e vive
   dentro la Action e dentro il pannello. Il gettone da CAPO e' la chiave che
   il padrone tiene in tasca: fa i codici per gli amici e li revoca, e basta.

   Perche' due. Per fare un codice a un amico al bar servirebbe altrimenti
   incollare il segreto grosso dentro il telefono, e da li' non esce piu': un
   telefono perso e' il deposito dei dati in mano a qualcun altro. Il gettone
   invece scade da solo in trenta giorni, si revoca, e cambiando SEGRETO muoiono
   tutti insieme. Il deposito dei dati non lo tocca comunque.

   E un capo non puo' fare altri capi: quello lo decide solo il segreto grosso.
   Cosi' il danno di un telefono perso resta "qualcuno regala abbonamenti",
   che si spegne, e non "qualcuno si e' fatto padrone di casa". */
async function comanda(req, env) {
  if (ammesso(req, env)) return 'segreto';
  const d = await dirittiDa(req, env);
  return d.capo ? 'capo' : null;
}

async function adminCrea(req, env, chi) {
  let c;
  try { c = await req.json(); } catch (e) { c = {}; }
  const vuole = c.tipo === 'vip' ? 'vip' : (c.tipo === 'capo' ? 'capo' : 'abbonato');
  if (vuole === 'capo' && chi !== 'segreto') {
    return json({ errore: 'solo il segreto puo fare un altro capo' }, 403);
  }
  const tipo = vuole;
  const mesi = Math.max(1, Math.min(24, parseInt(c.mesi, 10) || 1));
  const codice = nuovoCodice();
  const voce = {
    tipo, nome: String(c.nome || '').slice(0, 60),
    creato: new Date().toISOString(),
    scade: (tipo === 'vip' || tipo === 'capo')
      ? null : new Date(Date.now() + mesi * 30 * 86400000).toISOString(),
    usi: 0,
  };
  await env.CODICI.put('codice:' + normalizza(codice), JSON.stringify(voce));
  /* il codice intero non va nel registro: e' una chiave, chi lo legge entra */
  await registra(env, 'codice', tipo + ' per ' + (voce.nome || 'senza nome') +
                 ' (' + codice.slice(0, 4) + '…), fatto da ' + (chi === 'segreto' ? 'pannello' : 'capo'));
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
  await registra(env, 'revoca', (voce.tipo || '?') + ' di ' + (voce.nome || 'senza nome') +
                 ' (' + codice.slice(0, 4) + '…)');
  return json({ ok: true, codice, revocato: voce.revocato });
}

/* Le partite di un calendario ancora da giocare. */
function daGiocare(calendario, oggi) {
  return (calendario || []).filter((p) => p && p.d && p.d >= oggi && p.c && p.v).length;
}

/* Sotto questa soglia un calendario che si accorcia non insospettisce: a fine
   stagione restano poche partite, e sparire e' il loro mestiere. */
const ACCORCIA_DA = 10;

/* Il giro dei dati deposita qui i calendari. Stessa porta del pannello.

   E qui c'era il buco che si e' visto dopo aver acceso il cancello: il freno
   scattava solo se il campo mancava, non se era VUOTO. Un giro con la fonte
   giu' mandava [] e il deposito lo prendeva per buono, cancellando trecento
   partite con le loro quote. Adesso un calendario che perde piu' di meta'
   delle partite ancora da giocare viene rifiutato, e resta quello di prima.
   Se l'accorciamento e' vero (una stagione cancellata, un campionato
   rifatto) si deposita lo stesso con ?forza=1: la porta c'e', ma va aperta
   apposta. */
async function adminCarica(req, env, lega) {
  if (!/^[A-Z0-9]{1,6}$/.test(lega)) return json({ errore: 'campionato sconosciuto' }, 400);
  let corpo;
  try { corpo = await req.json(); } catch (e) { return json({ errore: 'corpo illeggibile' }, 400); }
  if (!Array.isArray(corpo && corpo.calendario)) {
    return json({ errore: 'manca il calendario' }, 400);
  }
  const forza = new URL(req.url).searchParams.get('forza') === '1';
  if (!forza) {
    let vecchio = [];
    try { vecchio = (JSON.parse(await env.DATI.get('cal:' + lega) || '{}').calendario) || []; }
    catch (e) { vecchio = []; }
    const oggi = oggiARoma();
    const prima = daGiocare(vecchio, oggi);
    const dopo = daGiocare(corpo.calendario, oggi);
    if ((prima > 0 && dopo === 0) || (prima >= ACCORCIA_DA && dopo * 2 < prima)) {
      await registra(env, 'calendario', lega + ' rifiutato: ' + dopo + ' partite da giocare invece di ' + prima);
      return json({ errore: 'calendario troppo corto, tengo quello di prima', prima, dopo }, 409);
    }
  } else {
    await registra(env, 'calendario', lega + ' depositato con forza=1: ' +
                   corpo.calendario.length + ' partite');
  }
  await env.DATI.put('cal:' + lega, JSON.stringify({
    aggiornato: new Date().toISOString(), calendario: corpo.calendario,
  }));
  return json({ ok: true, lega, partite: corpo.calendario.length });
}

/* Il calendario com'e' nel deposito, intero, per il giro dei dati.

   Da quando il calendario non sta piu' nel repository, il giro non aveva piu'
   modo di sapere cosa aveva scritto il giro prima: ripartiva da zero, e le
   quote della mattina sparivano col primo giro leggero del pomeriggio che non
   ne scaricava di nuove. Questa e' la sua memoria. */
async function adminCalendario(env, lega) {
  if (!/^[A-Z0-9]{1,6}$/.test(lega)) return json({ errore: 'campionato sconosciuto' }, 400);
  const grezzo = await env.DATI.get('cal:' + lega);
  if (!grezzo) return json({ errore: 'campionato non disponibile' }, 404);
  const doc = JSON.parse(grezzo);
  return json({ lega, aggiornato: doc.aggiornato, calendario: doc.calendario || [] });
}

/* ─────────────────────────── l'ingresso ─────────────────────────── */

/* ══════════════════════════════════════════════════════════════════════════
   LA CLASSIFICA

   Un punteggio ha senso solo se non ci si puo' mettere dentro quello che si
   vuole. Se la schedina la dichiara chi gioca, a partita finita, la classifica
   diventa la graduatoria di chi mente meglio — e muore in una settimana,
   perche' il primo che se ne accorge smette di giocare.

   Quindi tre chiodi, e sono tutti e tre nel server:

     1. la schedina si registra PRIMA del fischio d'inizio. L'ora la decide il
        server guardando il suo orologio, non quello del telefono.
     2. ogni gamba deve esistere nel calendario del server, e la sua quota
        la calcola il server dalle quote vere del mercato: quella che manda
        il telefono non si legge nemmeno. Non si registrano partite
        inventate ne' quote gonfiate.
     3. l'esito NON lo dice chi ha giocato. Lo calcola il giro dei dati, che
        vede i risultati, usando la stessa funzione con cui l'app decide se
        una giocata e' presa — M.haVinto. Una sola verita', non due.

   I punti: 10 x log2(quota) per ogni schedina vinta. Logaritmico apposta.
   Con i punti uguali alla quota, una botta di culo da 50 cancellerebbe un
   mese di gioco solido, e la classifica misurerebbe la fortuna. Cosi' invece
   una da 2.00 vale 10, una da 4.00 ne vale 20, una da 16.00 quaranta: il
   rischio paga, ma paga come il logaritmo, non come il colpo di fortuna.
   ══════════════════════════════════════════════════════════════════════════ */

function puntiDi(quota) {
  if (!(quota > 1)) return 0;
  return Math.max(1, Math.round(10 * Math.log2(quota)));
}

function nickPulito(x) {
  const n = String(x || '').trim().replace(/\s+/g, ' ');
  if (n.length < NICK_MIN || n.length > NICK_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(n)) return null;
  return n;
}

/* La chiave di chi gioca. Non e' il codice: il codice e' un segreto — chi lo
   ha in mano entra — e la classifica e' pubblica. Si usa l'impronta del
   codice, che identifica senza rivelare. */
async function chiaveGiocatore(codice, segreto) {
  const f = await crypto.subtle.sign('HMAC', await chiave(segreto), enc.encode('gioc:' + codice));
  return base64url(f).slice(0, 22);
}

async function leggiGiocatore(env, id) {
  const g = await env.CODICI.get('gioc:' + id);
  return g ? JSON.parse(g) : null;
}

/* I PUNTI HANNO UN PROPRIETARIO SOLO

   Prima stavano dentro il record del giocatore, e quel record lo scrivevano
   in due: il giro dei dati quando saldava, il telefono quando registrava
   una schedina. Due scritture che si incrociano su KV — dove una lettura
   puo' essere vecchia fino a un minuto — e una delle due sparisce: se
   sparisce quella del giro, spariscono dei punti, e nessuno lo vede.

   Adesso i punti stanno in una chiave loro, "punti:", che scrive SOLO il
   giro dei dati. Dentro c'e' anche l'elenco delle schedine gia' contate:
   se il giro cade fra "conto i punti" e "segno la schedina come saldata",
   al giro dopo la schedina risulta ancora aperta ma i suoi punti non si
   contano una seconda volta. Si puo' ripetere quante volte si vuole, e il
   risultato e' lo stesso.

   Il record del giocatore resta del giocatore: nome, e quante ne ha giocate.
   I giocatori di prima avevano i punti li' dentro: finche' il giro non gli
   salda una schedina nuova, si leggono da li'. */
async function leggiPunti(env, id, g) {
  const r = await env.CODICI.get('punti:' + id);
  if (r) return JSON.parse(r);
  if (g === undefined) g = await leggiGiocatore(env, id);
  return { punti: (g && g.punti) || 0, vinte: (g && g.vinte) || 0, annullate: 0, contate: [] };
}
function giocateDi(g, pt) {
  return Math.max(0, ((g && g.giocate) || 0) - ((pt && pt.annullate) || 0));
}

/* IL REGISTRO

   Quando qualcosa non torna — dei punti che mancano, un codice che non
   apre, un calendario rimasto vecchio — la domanda e' sempre "cosa e'
   successo, e quando". Qui si scrive una riga per ogni cosa che conta:
   i saldi, i codici fatti e revocati, i calendari rifiutati. Novanta
   giorni e poi si cancellano da soli.

   La chiave va all'indietro nel tempo (un numero che scende), cosi'
   l'elenco di KV, che e' in ordine alfabetico, da' per prime le piu'
   recenti. E il riassunto sta nei metadati: per leggere il registro basta
   l'elenco, senza aprire una chiave per volta. */
const REGISTRO_GIORNI = 90;
async function registra(env, cosa, riassunto, dettaglio) {
  try {
    const ora = Date.now();
    const k = 'log:' + String(9999999999999 - ora).padStart(13, '0') + ':' + nuovoId().slice(0, 4);
    await env.CODICI.put(k, JSON.stringify(Object.assign({ cosa, quando: new Date(ora).toISOString() },
                                                         dettaglio || {})), {
      expirationTtl: REGISTRO_GIORNI * 86400,
      metadata: { cosa, quando: new Date(ora).toISOString(), r: String(riassunto || '').slice(0, 300) },
    });
  } catch (e) { /* un registro che si rompe non deve rompere quello che registra */ }
}
async function adminRegistro(env) {
  const p = await env.CODICI.list({ prefix: 'log:', limit: 150 });
  return json({ righe: p.keys.map((k) => k.metadata || { cosa: '?', r: k.name }) });
}

/* Chi sta chiedendo, in termini di classifica: l'impronta, e che grado ha. */
async function chiSono(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const gettone = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const dati = await leggiGettone(gettone, env.SEGRETO);
  if (!dati) return null;
  if (!dati.gid) return null;
  return {
    id: dati.gid,
    tipo: dati.capo ? 'capo' : (dati.tipo || 'libero'),
    tutto: dati.tipo === 'vip' || dati.tipo === 'capo' ||
           (!!dati.scade && new Date(dati.scade).getTime() > Date.now()),
  };
}

/* L'OSPITE

   Chi non ha un codice puo' comunque avere un nome e un posto in classifica.
   Non e' generosita': e' il gancio. Uno che vede il suo nome dodicesimo e sa
   che i primi undici scelgono fra millecinquecento partite mentre lui ne
   vede quindici, ha un motivo per pagare che nessun muro gli avrebbe dato.

   E vedere non e' entrare: l'ospite resta libero, con le sue tre partite per
   campionato. Il gettone dice chi e', non cosa puo'. */
async function postOspite(req, env) {
  /* Un'identita' da ospite non costa niente e non apre niente, ma dieci
     identita' sono dieci righe in classifica: un freno ci vuole lo stesso.
     Quattro all'ora per indirizzo — piu' che abbastanza per una famiglia,
     poco per una fabbrica. */
  const ip = req.headers.get('CF-Connecting-IP') || '';
  if (ip && env.CODICI) {
    const k = 'ospiti:' + ip + ':' + Math.floor(Date.now() / 3600000);
    const n = parseInt(await env.CODICI.get(k) || '0', 10);
    if (n >= OSPITI_ORA) {
      return json({ errore: 'troppi nomi nuovi da qui, riprova fra un\'ora' }, 429);
    }
    await env.CODICI.put(k, String(n + 1), { expirationTtl: 3700 });
  }
  const seme = base64url(crypto.getRandomValues(new Uint8Array(18)).buffer);
  const gid = await chiaveGiocatore('ospite:' + seme, env.SEGRETO);
  const gettone = await firmaGettone({
    tipo: 'libero', nome: '', scade: null, capo: false, gid: gid,
    exp: Date.now() + GETTONE_GIORNI * 86400000,
  }, env.SEGRETO);
  return json({ gettone, tipo: 'libero', tutto: false, capo: false });
}

async function postNick(req, env) {
  const io = await chiSono(req, env);
  if (!io) return json({ errore: 'serve un codice' }, 401);
  let c; try { c = await req.json(); } catch (e) { c = {}; }
  const nick = nickPulito(c.nick);
  if (!nick) {
    return json({ errore: 'il nome va da ' + NICK_MIN + ' a ' + NICK_MAX +
                          ' caratteri, lettere e numeri' }, 400);
  }
  /* uno per uno: due "Marco" in classifica non si distinguono */
  const chiave2 = 'nick:' + nick.toLowerCase();
  const gia = await env.CODICI.get(chiave2);
  if (gia && gia !== io.id) return json({ errore: 'questo nome e gia preso' }, 409);

  const vecchio = await leggiGiocatore(env, io.id);
  /* IL NOME SI SCEGLIE UNA VOLTA SOLA.

     Non e' rigidita': e' l'unica cosa che rende leggibile una classifica.
     Se il nome si cambia, la persona dietro il terzo posto di oggi non e'
     necessariamente quella di ieri, e chi perde una settimana si ribattezza
     e riparte come se fosse un altro. Un punteggio ha senso solo se resta
     attaccato a un nome, e il nome a una persona.

     E' anche la difesa piu' semplice contro chi si fabbrica dieci identita':
     i nomi buoni finiscono, e nessuno si costruisce una reputazione da
     ricominciare ogni volta. */
  if (vecchio && vecchio.nick) {
    if (vecchio.nick.toLowerCase() === nick.toLowerCase()) {
      const pt = await leggiPunti(env, io.id, vecchio);
      return json({ nick: vecchio.nick, punti: pt.punti || 0, vinte: pt.vinte || 0,
                    giocate: giocateDi(vecchio, pt), tipo: vecchio.tipo || io.tipo });
    }
    return json({ errore: 'il nome si sceglie una volta sola', nick: vecchio.nick }, 409);
  }
  const g = Object.assign({ giocate: 0 }, vecchio || {},
                          { nick, tipo: io.tipo, aggiornato: new Date().toISOString() });
  await env.CODICI.put('gioc:' + io.id, JSON.stringify(g));
  await env.CODICI.put(chiave2, io.id);
  const pt = await leggiPunti(env, io.id, g);
  return json({ nick: g.nick, punti: pt.punti || 0, vinte: pt.vinte || 0,
                giocate: giocateDi(g, pt), tipo: g.tipo });
}

async function getClassifica(req, env) {
  const io = await chiSono(req, env);
  const fuori = [];
  let cursore;
  do {
    const p = await env.CODICI.list({ prefix: 'gioc:', cursor: cursore });
    for (const k of p.keys) {
      const v = JSON.parse(await env.CODICI.get(k.name) || '{}');
      if (!v.nick) continue;
      const pt = await leggiPunti(env, k.name.slice(5), v);
      fuori.push({ id: k.name.slice(5), nick: v.nick, tipo: v.tipo || 'libero',
                   punti: pt.punti || 0, vinte: pt.vinte || 0, giocate: giocateDi(v, pt) });
    }
    cursore = p.list_complete ? null : p.cursor;
  } while (cursore);
  fuori.sort((a, b) => (b.punti - a.punti) || (b.vinte - a.vinte) ||
                       String(a.nick).localeCompare(String(b.nick)));
  fuori.forEach((x, i) => { x.posto = i + 1; });
  const mio = io ? fuori.filter(x => x.id === io.id)[0] || null : null;
  /* l'impronta non esce: serviva solo a ritrovarsi nella lista */
  const senzaId = fuori.slice(0, CLASSIFICA_QUANTI).map(({ id, ...r }) => r);
  return json({ classifica: senzaId, quanti: fuori.length,
                io: mio ? { posto: mio.posto, nick: mio.nick, punti: mio.punti,
                            vinte: mio.vinte, giocate: mio.giocate, tipo: mio.tipo } : null });
}

/* ══════════════════════════════════════════════════════════════════════════
   LE QUOTE DELLA CLASSIFICA LE FA IL SERVER

   Prima la quota di ogni gamba la dichiarava il telefono, e qui c'era solo
   un tetto: due volte e mezzo l'esito piu' lungo della partita. Il commento
   diceva che cosi' chi bara guadagnava "meno del doppio" di chi gioca
   onesto. Era falso: un Over 1.5 che vale 1.20 si poteva dichiarare a 10, e
   una doppia cosi' valeva 66 punti invece di 5 — tredici volte tanto, su
   gambe che escono quasi sempre.

   Adesso il telefono dice COSA gioca, e il prezzo lo fa il server, con le
   quote vere dei bookmaker che ha gia' in calendario:

     1X2 e doppia chance   dalle quote dell'1X2, tolto il margine
     tutti i mercati gol   da due Poisson tarate sulle quote dell'1X2 e
                           dell'Over/Under 2.5: il totale dei gol si tara
                           sull'Over 2.5, la divisione fra le due squadre
                           sulla differenza fra vittoria in casa e fuori

   e poi il ricarico medio del banco, lo stesso che mostra l'app. I punti
   diventano quote di MERCATO, non del modello di Monthline: per una
   classifica fra amici e' anche piu' giusto — nessuno viene premiato perche'
   il nostro modello sbaglia a suo favore.

   Quello che non si sa prezzare (il primo tempo, le combinazioni, gli
   handicap) in classifica non entra. Meglio un "no" chiaro che un prezzo
   inventato: il prezzo inventato era proprio il buco.
   ══════════════════════════════════════════════════════════════════════════ */
const RICARICO_CLASSIFICA = 0.056;   /* bet365 misurato su 1930 partite: e' il default dell'app */

function probEque(q) {
  if (!Array.isArray(q) || !q.every((x) => x > 1)) return null;
  const inv = q.map((x) => 1 / x), s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
}
function poisson(k, l) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}
function fraGol(a, b, l) {             /* P(a <= gol <= b) con gol ~ Poisson(l) */
  let s = 0;
  for (let k = a; k <= b; k++) s += poisson(k, l);
  return s;
}
/* Il totale dei gol che rende l'Over 2.5 esattamente quello del mercato. */
function totaleDaOver(po) {
  let a = 0.05, b = 9;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (1 - fraGol(0, 2, m) < po) a = m; else b = m;
  }
  return (a + b) / 2;
}
/* Come si divide il totale fra le due squadre: la quota di casa che rende
   "vince la casa meno vince l'ospite" uguale a quella del mercato. */
function divisione(T, diff) {
  const scarto = (s) => {
    const lc = T * s, lv = T * (1 - s);
    let d = 0;
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 12; j++) {
        if (i !== j) d += (i > j ? 1 : -1) * poisson(i, lc) * poisson(j, lv);
      }
    }
    return d;
  };
  let a = 0.02, b = 0.98;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (scarto(m) < diff) a = m; else b = m;
  }
  const s = (a + b) / 2;
  return [T * s, T * (1 - s)];
}

/* La probabilita' di un mercato, o null se il server non la sa. */
function probMercato(p, id) {
  const x1x2 = probEque(p.qex) || probEque(p.q);
  const pou = probEque(p.qou);
  const quale = { '1': 0, 'X': 1, '2': 2 };
  if (id in quale) return x1x2 ? x1x2[quale[id]] : null;
  const dc = { '1X': [0, 1], 'X2': [1, 2], '12': [0, 2] };
  if (id in dc) return x1x2 ? x1x2[dc[id][0]] + x1x2[dc[id][1]] : null;

  if (!pou) return null;
  const T = totaleDaOver(pou[0]);
  let m;
  if ((m = /^([OU])([0-9])5$/.exec(id))) {                 /* Over/Under k.5 */
    const sotto = fraGol(0, +m[2], T);
    return m[1] === 'U' ? sotto : 1 - sotto;
  }
  if ((m = /^MG([0-9])([0-9])$/.exec(id))) return fraGol(+m[1], +m[2], T);   /* multigol */
  if ((m = /^G([0-9])$/.exec(id))) return poisson(+m[1], T);                  /* gol esatti */
  if (id === 'G4P') return 1 - fraGol(0, 3, T);
  if (id === 'PARI' || id === 'DISP') {
    let pari = 0;
    for (let k = 0; k <= 20; k += 2) pari += poisson(k, T);
    return id === 'PARI' ? pari : 1 - pari;
  }

  if (!x1x2) return null;
  const [lc, lv] = divisione(T, x1x2[0] - x1x2[2]);
  const segna = { SC: 1 - poisson(0, lc), SV: 1 - poisson(0, lv) };
  if (id in segna) return segna[id];
  if (id === 'GG') return segna.SC * segna.SV;
  if (id === 'NG') return 1 - segna.SC * segna.SV;
  if (id === 'CNP') return poisson(0, lv);                  /* casa non subisce */
  if (id === 'VNP') return poisson(0, lc);                  /* ospite non subisce */
  if ((m = /^T([CV])([0-9])5$/.exec(id))) {                 /* gol di una squadra */
    return 1 - fraGol(0, +m[2], m[1] === 'C' ? lc : lv);
  }
  return null;
}

/* La quota di classifica di una gamba: equa meno il ricarico, a due
   decimali, come la scrive un bookmaker. */
function quotaServer(p, id) {
  const pr = probMercato(p, String(id || '').toUpperCase());
  if (!(pr > 0.001 && pr < 0.995)) return null;
  return Math.round((1 / pr) * (1 - RICARICO_CLASSIFICA) * 100) / 100;
}

/* Una schedina registrata prima del fischio d'inizio. */
async function postSchedina(req, env) {
  const io = await chiSono(req, env);
  if (!io) return json({ errore: 'serve un codice' }, 401);
  const g = await leggiGiocatore(env, io.id);
  if (!g || !g.nick) return json({ errore: 'prima scegli un nome' }, 428);

  let c; try { c = await req.json(); } catch (e) { c = {}; }
  const gambe = Array.isArray(c.gambe) ? c.gambe : [];
  if (!gambe.length || gambe.length > GAMBE_MAX) {
    return json({ errore: 'da 1 a ' + GAMBE_MAX + ' gambe' }, 400);
  }

  const adesso = Date.now();
  const pulite = [];
  for (const gamba of gambe) {
    const lega = String(gamba.lega || '').toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(lega)) return json({ errore: 'campionato sconosciuto' }, 400);
    const grezzo = await env.DATI.get('cal:' + lega);
    if (!grezzo) return json({ errore: 'campionato non disponibile' }, 404);
    const cal = JSON.parse(grezzo).calendario || [];
    const p = cal.filter(x => x.d === gamba.d && x.c === gamba.c && x.v === gamba.v)[0];
    if (!p) return json({ errore: 'questa partita non e in calendario' }, 400);
    if (inizioDi(p) <= adesso) return json({ errore: 'questa partita e gia cominciata' }, 409);
    /* La quota che manda il telefono non si legge nemmeno: il prezzo lo fa
       il server (vedi sopra). */
    const mercato = String(gamba.mercato || '').toUpperCase().slice(0, 24);
    const quota = quotaServer(p, mercato);
    if (quota == null) {
      return json({ errore: 'in classifica non si puo prezzare ' + (mercato || 'questo mercato') +
                            ' su ' + p.c + ' - ' + p.v + ': mancano le quote o il mercato' }, 400);
    }
    if (!(quota > 1.01)) return json({ errore: 'una gamba a ' + quota + ' non paga niente' }, 400);
    pulite.push({ lega, d: p.d, o: p.o || null, c: p.c, v: p.v, mercato, quota });
  }
  const quota = pulite.reduce((t, x) => t * x.quota, 1);
  if (quota > 500) return json({ errore: 'schedina troppo lunga per la classifica' }, 400);
  const id = nuovoId();
  const sch = { id, gambe: pulite, quota: Math.round(quota * 1000) / 1000,
                creata: new Date(adesso).toISOString(), stato: 'aperta' };
  await env.CODICI.put('sch:' + io.id + ':' + id, JSON.stringify(sch));
  g.giocate = (g.giocate || 0) + 1;
  await env.CODICI.put('gioc:' + io.id, JSON.stringify(g));
  return json(sch);
}

/* L'orario del fischio d'inizio, in millisecondi. Senza ora si prende
   mezzogiorno: sbagliare di qualche ora sul giorno giusto e' molto meglio
   che accettare una schedina il giorno dopo la partita.

   Gli orari del calendario sono italiani, per tutti e cinque i campionati.
   Qui c'era scritto "meno due ore", cioe' l'ora legale fissata a mano: dal
   25 ottobre, con l'ora solare, il server avrebbe chiuso le schedine un'ora
   prima del fischio — proprio l'ora in cui si gioca, prima delle
   formazioni. Adesso lo scarto di Roma si chiede al calendario vero, giorno
   per giorno. */
function scartoRoma(ms) {
  try {
    const parti = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).forEach((x) => { parti[x.type] = x.value; });
    return Date.UTC(+parti.year, +parti.month - 1, +parti.day,
                    +parti.hour, +parti.minute, +parti.second) - ms;
  } catch (e) {
    return 2 * 3600000;       /* senza fusi orari si torna a com'era: meglio che niente */
  }
}
function inizioDi(p) {
  const o = /^\d{2}:\d{2}$/.test(p.o || '') ? p.o : '12:00';
  const comeSeUtc = new Date(p.d + 'T' + o + ':00Z').getTime();
  /* Lo scarto si misura all'istante giusto: una prima stima, poi si
     ricontrolla li'. Serve solo nella notte del cambio d'ora, ma costa niente. */
  let t = comeSeUtc - scartoRoma(comeSeUtc);
  const s = scartoRoma(t);
  if (comeSeUtc - s !== t) t = comeSeUtc - s;
  return t;
}

function nuovoId() {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return base64url(b.buffer);
}

/* Le schedine che aspettano un esito: le legge il giro dei dati, che i
   risultati li vede. */
async function getPendenti(env) {
  const fuori = [];
  let cursore;
  do {
    const p = await env.CODICI.list({ prefix: 'sch:', cursor: cursore });
    for (const k of p.keys) {
      const v = JSON.parse(await env.CODICI.get(k.name) || '{}');
      if (v.stato !== 'aperta') continue;
      fuori.push({ chiave: k.name, id: v.id, gambe: v.gambe, quota: v.quota, creata: v.creata });
    }
    cursore = p.list_complete ? null : p.cursor;
  } while (cursore);
  return json({ schedine: fuori, quante: fuori.length });
}

/* E qui si saldano. Chi decide e' il giro dei dati, col segreto grosso: chi
   ha giocato non tocca il proprio punteggio nemmeno di striscio. */
async function postSalda(req, env) {
  let c; try { c = await req.json(); } catch (e) { c = {}; }
  const esiti = Array.isArray(c.esiti) ? c.esiti : [];
  let saldate = 0, punti = 0;
  const conti = {}, righe = [];
  for (const e of esiti) {
    const k = String(e.chiave || '');
    if (!k.startsWith('sch:')) continue;
    const grezzo = await env.CODICI.get(k);
    if (!grezzo) continue;
    const sch = JSON.parse(grezzo);
    if (sch.stato !== 'aperta') continue;
    const gid = k.split(':')[1];
    const pt = conti[gid] || (conti[gid] = await leggiPunti(env, gid));
    if (!Array.isArray(pt.contate)) pt.contate = [];

    /* Annullata: una gamba il cui esito non si riesce a decidere nemmeno
       dopo giorni — di solito un mercato sul primo tempo quando l'archivio
       il primo tempo non ce l'ha. Non e' ne' vinta ne' persa, e contarla
       persa sarebbe una bugia a spese di chi ha giocato: si toglie di mezzo
       e si scala dalle giocate, come se non fosse mai stata fatta. */
    const annulla = e.annulla === true;
    const vinta = !annulla && e.vinta === true;
    const suoi = vinta ? puntiDi(sch.quota) : 0;

    /* Prima i punti, poi la schedina. Nell'ordine inverso un giro che cade
       in mezzo lascerebbe una schedina saldata senza i suoi punti, e nessun
       giro dopo li rimetterebbe. Cosi' invece il giro dopo la trova ancora
       aperta, vede che e' gia' contata, e la chiude soltanto. */
    if (pt.contate.indexOf(sch.id) < 0) {
      if (annulla) pt.annullate = (pt.annullate || 0) + 1;
      else { pt.punti = (pt.punti || 0) + suoi; if (vinta) pt.vinte = (pt.vinte || 0) + 1; }
      pt.contate.push(sch.id);
      if (pt.contate.length > 5000) pt.contate = pt.contate.slice(-5000);
      pt.aggiornato = new Date().toISOString();
      await env.CODICI.put('punti:' + gid, JSON.stringify(pt));
    }
    sch.stato = annulla ? 'annullata' : (vinta ? 'vinta' : 'persa');
    sch.saldata = new Date().toISOString();
    sch.punti = suoi;
    await env.CODICI.put(k, JSON.stringify(sch));
    saldate++; punti += suoi;
    righe.push(sch.stato + ' ' + sch.quota + (suoi ? ' +' + suoi : ''));
  }
  if (saldate) {
    await registra(env, 'saldo', saldate + ' schedine, ' + punti + ' punti: ' + righe.join(', '),
                   { righe });
  }
  return json({ saldate, punti });
}

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
        if (via === '/api/ospite' && req.method === 'POST') return await postOspite(req, env);
        if (via === '/api/nick' && req.method === 'POST') return await postNick(req, env);
        if (via === '/api/classifica' && req.method === 'GET') return await getClassifica(req, env);
        if (via === '/api/schedina' && req.method === 'POST') return await postSchedina(req, env);
        const cal = /^\/api\/calendario\/([A-Za-z0-9]{1,6})$/.exec(via);
        if (cal && req.method === 'GET') return await getCalendario(req, env, cal[1].toUpperCase());

        if (via.startsWith('/api/admin/')) {
          /* il deposito dei dati resta al segreto grosso: e' il mestiere della
             Action, non una cosa che si fa da un telefono */
          const car = /^\/api\/admin\/carica\/([A-Za-z0-9]{1,6})$/.exec(via);
          if (car && req.method === 'POST') {
            if (!ammesso(req, env)) return json({ errore: 'non ammesso' }, 401);
            return await adminCarica(req, env, car[1].toUpperCase());
          }
          const mem = /^\/api\/admin\/calendario\/([A-Za-z0-9]{1,6})$/.exec(via);
          if (mem && req.method === 'GET') {
            if (!ammesso(req, env)) return json({ errore: 'non ammesso' }, 401);
            return await adminCalendario(env, mem[1].toUpperCase());
          }
          /* saldare i punti e' mestiere del giro dei dati, non di chi gioca */
          if (via === '/api/admin/pendenti' && req.method === 'GET') {
            if (!ammesso(req, env)) return json({ errore: 'non ammesso' }, 401);
            return await getPendenti(env);
          }
          if (via === '/api/admin/salda' && req.method === 'POST') {
            if (!ammesso(req, env)) return json({ errore: 'non ammesso' }, 401);
            return await postSalda(req, env);
          }
          const chi = await comanda(req, env);
          if (!chi) return json({ errore: 'non ammesso' }, 401);
          if (via === '/api/admin/crea' && req.method === 'POST') return await adminCrea(req, env, chi);
          if (via === '/api/admin/elenco' && req.method === 'GET') return await adminElenco(env);
          if (via === '/api/admin/revoca' && req.method === 'POST') return await adminRevoca(req, env);
          if (via === '/api/admin/registro' && req.method === 'GET') return await adminRegistro(env);
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
