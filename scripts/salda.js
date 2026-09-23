/* Chi ha vinto, e quanti punti vale.
   ══════════════════════════════════════════════════════════════════════════
   Gira nel giro dei dati, una volta a giro. Chiede al server le schedine che
   aspettano un esito, cerca i risultati nell'archivio appena scaricato, e
   rimanda indietro chi ha vinto e chi no.

   Sta QUI e non dentro il server per una ragione sola, ed e' la piu'
   importante di tutte: l'esito di un mercato lo sa gia' decidere M.haVinto —
   la stessa identica funzione con cui l'app dice a chi gioca se la sua
   giocata e' presa. Riscriverla nel Worker vorrebbe dire due verita' sullo
   stesso fatto, che per un po' coincidono e poi un giorno no: la classifica
   direbbe "persa" e la schermata della giocata "presa", sulla stessa partita.
   Non c'e' nessun vantaggio che paghi quel prezzo.

   Chi decide, quindi, non e' mai chi gioca: e' questo script, col segreto
   grosso, che i risultati li ha visti.

     MONTHLINE_API=... MONTHLINE_ADMIN=... node scripts/salda.js
   ══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const M = require('../modello.js');

const API = (process.env.MONTHLINE_API || '').trim().replace(/\/+$/, '');
const ADMIN = (process.env.MONTHLINE_ADMIN || '').trim();
const QUI = path.join(__dirname, '..');

/* Quanti giorni si aspetta un risultato prima di dire "questa non si decide".
   Le fonti pubblicano a giornata chiusa, non a partita chiusa: sotto i tre
   giorni il vuoto non e' un guasto, e' il calendario. Dopo dieci si', e
   tenere aperta per sempre una schedina che nessuno potra' mai saldare
   vorrebbe dire lasciare quel giocatore con una giocata in sospeso a vita. */
const GIORNI_PAZIENZA = 10;

function chiedi(via, opz) {
  opz = opz || {};
  const testate = { Authorization: 'Bearer ' + ADMIN };
  if (opz.corpo) testate['content-type'] = 'application/json';
  return fetch(API + via, {
    method: opz.metodo || 'GET', headers: testate,
    body: opz.corpo ? JSON.stringify(opz.corpo) : undefined,
  }).then(async (r) => {
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch (e) { j = null; }
    if (!r.ok) throw new Error((j && j.errore) || ('HTTP ' + r.status));
    return j;
  });
}

/* L'archivio, un campionato alla volta e solo quando serve. */
const archivi = {};
function partiteDi(lega) {
  if (archivi[lega]) return archivi[lega];
  const dove = lega === 'I1'
    ? path.join(QUI, 'data', 'serie-a.json')
    : path.join(QUI, 'data', 'leghe', lega + '.json');
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(dove, 'utf8')); } catch (e) { doc = null; }
  archivi[lega] = (doc && doc.partite) || [];
  return archivi[lega];
}

/* La partita giocata che corrisponde a una gamba. La tolleranza sui giorni
   c'e' perche' un anticipo spostato cambia data fra quando la schedina e'
   stata registrata e quando il risultato arriva: stessa regola che usa l'app
   nel registro personale. */
function partitaDi(gamba) {
  const ps = partiteDi(gamba.lega);
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (p.gc == null || p.c !== gamba.c || p.v !== gamba.v) continue;
    if (Math.abs(M.giorni(p.d, gamba.d)) <= 5) return p;
  }
  return null;
}

function giorniDa(iso) {
  const t = new Date(iso).getTime();
  if (!(t > 0)) return 0;
  return (Date.now() - t) / 86400000;
}

/* Tre risposte: true (vinta), false (persa), null (non si sa ancora). */
function esitoSchedina(sch) {
  let sospese = 0;
  for (const gamba of sch.gambe) {
    const p = partitaDi(gamba);
    if (!p) { sospese++; continue; }
    const v = M.haVinto(gamba.mercato, p.gc, p.gv, p.ptc, p.ptv);
    if (v == null) { sospese++; continue; }
    /* una gamba persa chiude la schedina subito: le altre non contano piu' */
    if (v === false) return false;
  }
  return sospese ? null : true;
}

async function main() {
  if (!API || !ADMIN) { console.log('classifica: spenta (manca MONTHLINE_API o MONTHLINE_ADMIN)'); return; }
  let dati;
  try { dati = await chiedi('/api/admin/pendenti'); }
  catch (e) { console.log('classifica: non riesco a leggere le schedine —', e.message); return; }

  const aperte = dati.schedine || [];
  if (!aperte.length) { console.log('classifica: niente da saldare'); return; }

  const esiti = [];
  let vinte = 0, perse = 0, annullate = 0, ancora = 0;
  for (const sch of aperte) {
    const v = esitoSchedina(sch);
    if (v === null) {
      const vecchia = sch.gambe.every(g => M.giorni(g.d, new Date().toISOString().slice(0, 10)) > GIORNI_PAZIENZA);
      if (vecchia) { esiti.push({ chiave: sch.chiave, annulla: true }); annullate++; }
      else ancora++;
      continue;
    }
    esiti.push({ chiave: sch.chiave, vinta: v });
    if (v) vinte++; else perse++;
  }
  if (!esiti.length) { console.log('classifica: ' + ancora + ' schedine aspettano ancora un risultato'); return; }

  const r = await chiedi('/api/admin/salda', { metodo: 'POST', corpo: { esiti } });
  console.log('classifica: ' + r.saldate + ' saldate (' + vinte + ' vinte, ' + perse +
              ' perse, ' + annullate + ' annullate), ' + r.punti + ' punti distribuiti, ' +
              ancora + ' ancora aperte');
}

/* Le parti che decidono si possono provare da sole: e' il pezzo dove un
   errore non si vede — nessuno si accorge di una schedina saldata male
   finche' non gliela si mostra in classifica. */
module.exports = { esitoSchedina, partitaDi, giorniDa, GIORNI_PAZIENZA, _archivi: archivi };

if (require.main === module) {
  main().catch((e) => { console.log('classifica: ' + e.message); });
}
