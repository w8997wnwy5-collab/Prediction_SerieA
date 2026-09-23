/* Il saldatore: chi ha vinto e chi no.
   ══════════════════════════════════════════════════════════════════════════
   La prova che conta: una gamba persa chiude la schedina SUBITO, anche se le
   altre non si sanno ancora. E' il caso che sembra un dettaglio e non lo e' —
   senza, una schedina gia' morta il sabato resterebbe "aperta" fino al
   lunedi', e chi l'ha giocata vedrebbe in classifica una speranza che non
   c'e' piu'.

   uso: node tools/test_salda.js
   ══════════════════════════════════════════════════════════════════════════ */
const S = require('../scripts/salda.js');

const ESITI = [];
function prova(nome, ok, dettaglio) { ESITI.push([nome, !!ok, dettaglio]); }

const oggi = new Date().toISOString().slice(0, 10);
function giorno(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

/* un archivio finto, messo al posto di quello vero */
function archivio(partite) {
  for (const k of Object.keys(S._archivi)) delete S._archivi[k];
  S._archivi.I1 = partite;
}
function gamba(c, v, mercato, d) {
  return { lega: 'I1', d: d || giorno(-1), c, v, mercato, quota: 1.5 };
}

/* ═══ 1. una schedina tutta giocata ═══ */
{
  archivio([{ d: giorno(-1), c: 'Inter', v: 'Milan', gc: 2, gv: 1, ptc: 1, ptv: 0 },
            { d: giorno(-1), c: 'Roma', v: 'Lazio', gc: 0, gv: 0, ptc: 0, ptv: 0 }]);
  prova('tutte prese = vinta',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', 'O15'), gamba('Roma', 'Lazio', 'U15')] }) === true);
  prova('una sbagliata = persa',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', 'O15'), gamba('Roma', 'Lazio', 'O25')] }) === false);
}

/* ═══ 2. quello che non si sa ancora ═══ */
{
  archivio([{ d: giorno(-1), c: 'Inter', v: 'Milan', gc: 2, gv: 1, ptc: 1, ptv: 0 }]);
  prova('se una partita non e ancora arrivata, non si decide',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', 'O15'), gamba('Roma', 'Lazio', 'U15')] }) === null);

  prova('MA UNA GAMBA GIA PERSA CHIUDE TUTTO SUBITO',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', 'U15'), gamba('Roma', 'Lazio', 'U15')] }) === false);
}

/* ═══ 3. l'anticipo spostato ═══ */
{
  archivio([{ d: giorno(-3), c: 'Inter', v: 'Milan', gc: 2, gv: 1, ptc: 1, ptv: 0 }]);
  prova('una partita rinviata di due giorni si ritrova lo stesso',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', 'O15', giorno(-1))] }) === true);
  archivio([{ d: giorno(-30), c: 'Inter', v: 'Milan', gc: 2, gv: 1, ptc: 1, ptv: 0 }]);
  prova('ma una di un mese prima e un altra partita, non questa',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', 'O15', giorno(-1))] }) === null);
}

/* ═══ 4. il primo tempo che manca ═══ */
{
  archivio([{ d: giorno(-1), c: 'Inter', v: 'Milan', gc: 2, gv: 1 }]);
  prova('un mercato sul primo tempo senza primo tempo resta sospeso',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', '1T-O05')] }) === null);
  prova('ma i mercati sul finale si decidono lo stesso',
        S.esitoSchedina({ gambe: [gamba('Inter', 'Milan', 'O15')] }) === true);
}

const rotte = ESITI.filter(e => !e[1]);
ESITI.forEach(([n, ok, d]) => console.log((ok ? 'ok   ' : 'FALLITO') + '  ' + n.padEnd(62) +
  (d !== undefined && !ok ? '  → ' + d : '')));
console.log('\n' + ESITI.length + ' prove, ' + rotte.length + ' fallite');
process.exit(rotte.length ? 1 : 0);
