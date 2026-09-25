"""Il valore esiste? bet365.it ed eurobet.it contro il prezzo equo di Pinnacle.
══════════════════════════════════════════════════════════════════════════════
Tutto quello che questo progetto ha misurato dice la stessa cosa: dove il
banco quota, il banco batte il modello. Prevedere meglio il calcio non batte
il bookmaker. Il PREZZO pero' puo': se una casa "morbida" paga un esito piu'
di quanto lo paghi Pinnacle una volta tolto il margine, quella scommessa ha
valore — senza bisogno di sapere niente di calcio.

Questo file risponde alla domanda con lo storico vero, partita per partita,
prima che si rischi un franco.

LE REGOLE, FISSATE PRIMA DI GUARDARE UN SOLO RISULTATO
─────────────────────────────────────────────────────
Scegliere le regole dopo aver visto cosa avrebbe vinto e' il modo piu' sicuro
di trovare un guadagno che non esiste. Quindi sono scritte qui, e non si
toccano dopo:

  • case morbide: bet365.it ed eurobet.it — le versioni italiane, quelle su
    cui si gioca davvero; il .com prezza diverso
  • prezzo equo: Pinnacle, con il margine tolto in proporzione
  • mercato: 1X2 finale, e soltanto singole
  • momento della giocata, PRIMARIO: tre ore prima del fischio — prima delle
    formazioni, che escono un'ora prima, cioe' quando si gioca davvero
  • momento SECONDARIO: ventiquattro ore prima. Riportato, non deciso.
  • soglia, PRIMARIA: la casa morbida deve pagare almeno il 3% sopra l'equo
  • "chiusura" = l'ultima quota ATTIVA prima dell'orario d'inizio. Lo storico
    continua dentro la partita — la sonda ha visto un pareggio a 41 e una
    trasferta a 151 — e prendere "l'ultima" vorrebbe dire confrontare prezzi
    live. Sarebbe spazzatura con l'aria di un risultato.

IL VERDETTO, DECISO PRIMA
─────────────────────────
La misura che decide e' il CLV: quanto il prezzo preso batte la chiusura
equa di Pinnacle. Con qualche centinaio di giocate il guadagno realizzato e'
quasi tutto fortuna — una trasferta a 5.00 che entra o no sposta il totale
di cinque unita' — mentre il CLV si stabilizza molto prima, e sul lungo
periodo e' quello che diventa guadagno.

  "il valore esiste" SOLO se il CLV medio della configurazione primaria e'
  positivo con z > 2. Tutto il resto e' contorno.

E un controllo di sanita', prima di tutto: giocando TUTTO su una casa
morbida senza filtro, il CLV deve uscire negativo di circa il margine della
casa. Se esce zero o positivo, la macchina e' rotta e i numeri sotto non
valgono niente.

I DATI
──────
Lo storico di OddsPapi non si ripubblica: questo repository e' pubblico. I
dati grezzi si scaricano, si riducono a sei numeri per casa e per momento, e
restano nella cache privata delle Action. Fuori escono solo gli aggregati.

    ODDSPAPI_KEY=... BUDGET=200 python3 scripts/backtest_valore.py
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)
import build_data as B                         # noqa: E402  (solo per il risolutore di nomi)

BASE = 'https://api.oddspapi.io/v4'
CHIAVE = os.environ.get('ODDSPAPI_KEY', '').strip()
BUDGET = int(os.environ.get('BUDGET', '200'))
CACHE = os.environ.get('CACHE_DIR', os.path.join(QUI, '..', '.cache_oddspapi'))

TORNEO = 23                                    # Serie A
MORBIDE = ['bet365.it', 'eurobet.it']
DURA = 'pinnacle'
MERCATO = '101'
ESITI = ['101', '102', '103']                  # 1, X, 2
MOMENTI = {'t24': 24, 't3': 3, 'chiusura': 0}
PRIMARIO = ('t3', 0.03)
DA = '2025-08-01'

SPESE = [0]


# ───────────────────────── le chiamate ─────────────────────────

def chiedi(via, param=None):
    if SPESE[0] >= BUDGET:
        raise RuntimeError('budget finito (%d richieste)' % BUDGET)
    p = dict(param or {})
    p['apiKey'] = CHIAVE
    url = BASE + via + '?' + urllib.parse.urlencode(p)
    SPESE[0] += 1
    time.sleep(1.2)
    for tentativo in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(
                    url, headers={'User-Agent': 'monthline-backtest'}), timeout=180) as r:
                return json.loads(r.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:
            corpo = e.read().decode('utf-8', 'replace').replace(CHIAVE, '***')[:200]
            if e.code == 429 and tentativo < 2:
                time.sleep(20)
                continue
            raise RuntimeError('HTTP %d: %s' % (e.code, corpo))
        except Exception as e:                  # noqa: BLE001
            if tentativo < 2:
                time.sleep(5)
                continue
            raise RuntimeError(str(e).replace(CHIAVE, '***')[:200])


def in_cache(nome):
    p = os.path.join(CACHE, nome)
    if os.path.exists(p):
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    return None


def metti_in_cache(nome, dato):
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, nome), 'w', encoding='utf-8') as f:
        json.dump(dato, f)


def elenco(x):
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        for k in ('data', 'items', 'participants', 'fixtures'):
            if isinstance(x.get(k), list):
                return x[k]
    return []


def quando(s):
    return datetime.fromisoformat(str(s).replace('Z', '+00:00'))


# ───────────────────────── i dati ─────────────────────────

def partecipanti():
    c = in_cache('partecipanti.json')
    if c is not None:
        return c
    d = chiedi('/participants', {'sportId': 10, 'tournamentId': TORNEO})
    nomi = {}
    if isinstance(d, dict) and not elenco(d):
        nomi = {str(k): v for k, v in d.items() if isinstance(v, str)}
    for p in elenco(d):
        pid = p.get('participantId') or p.get('id')
        nome = p.get('participantName') or p.get('name')
        if pid is not None and nome:
            nomi[str(pid)] = nome
    print('partecipanti: %d nomi' % len(nomi))
    metti_in_cache('partecipanti.json', nomi)
    return nomi


def partite_giocate():
    """Le partite finite, mese per mese, dalla piu' recente. Gli elenchi dei
    mesi chiusi si tengono in cache: non cambiano piu'."""
    oggi = datetime.now(timezone.utc).date()
    tutte, inizio = [], datetime.fromisoformat(DA).date()
    mesi = []
    d = inizio
    while d <= oggi:
        fine = (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        mesi.append((d, min(fine, oggi - timedelta(days=1))))
        d = fine + timedelta(days=1)
    for a, b in reversed(mesi):
        nome = 'mese_%s.json' % a.isoformat()
        c = in_cache(nome)
        chiuso = b < oggi - timedelta(days=3)
        if c is None:
            try:
                c = elenco(chiedi('/fixtures', {'tournamentId': TORNEO, 'from': a.isoformat(),
                                                'to': b.isoformat()}))
            except RuntimeError as e:
                # Un mese senza partite (luglio: niente campionato) risponde
                # 404 FIXTURE_NOT_FOUND. Il primo giro si fermava li', e la
                # stagione 2025-26 intera non e' mai stata chiesta: un mese
                # vuoto e' un mese vuoto, non la fine dello storico.
                if 'FIXTURE_NOT_FOUND' not in str(e):
                    print('  elenco %s: %s' % (a, e))
                    break
                print('  elenco %s: nessuna partita in quel mese' % a)
                c = []
            if chiuso:
                metti_in_cache(nome, c)
        tutte.extend(p for p in c if p.get('statusId') == 2)
    return tutte


def estrai(storico, inizio):
    """Da cinquanta mega a sei numeri per casa e per momento."""
    fuori = {}
    for casa, dati in (storico.get('bookmakers') or {}).items():
        m = ((dati or {}).get('markets') or {}).get(MERCATO)
        if not m:
            continue
        serie = {}
        for oid in ESITI:
            v = (m.get('outcomes') or {}).get(oid) or {}
            punti = []
            for lista in (v.get('players') or {}).values():
                for s in lista or []:
                    if s.get('price') and s.get('createdAt') and s.get('active', True) is not False:
                        punti.append((quando(s['createdAt']), float(s['price'])))
            punti.sort()
            serie[oid] = punti
        scatti = {}
        for nome, ore in MOMENTI.items():
            limite = inizio - timedelta(hours=ore)
            q = []
            for oid in ESITI:
                prima = [p for t, p in serie[oid] if t < limite]
                q.append(prima[-1] if prima else None)
            if all(x and x > 1.0 for x in q):
                scatti[nome] = q
        fuori[casa] = scatti
    return fuori


def storico_di(p):
    fid = p.get('fixtureId')
    c = in_cache('f_%s.json' % fid)
    if c is not None:
        return c
    grezzo = chiedi('/historical-odds', {'fixtureId': fid,
                                         'bookmakers': ','.join([DURA] + MORBIDE)})
    ridotto = {'fixtureId': fid, 'inizio': p.get('startTime'),
               'p1': p.get('participant1Id'), 'p2': p.get('participant2Id'),
               'case': estrai(grezzo, quando(p['startTime']))}
    del grezzo
    metti_in_cache('f_%s.json' % fid, ridotto)
    return ridotto


# ───────────────────────── i risultati ─────────────────────────

def abbinatore():
    with open(os.path.join(QUI, '..', 'data', 'serie-a.json'), encoding='utf-8') as f:
        arch = json.load(f)
    giocate = [p for p in arch.get('partite') or [] if p.get('gc') is not None]
    nomi = sorted({p['c'] for p in giocate} | {p['v'] for p in giocate})
    risolutore = B.RisolutoreNomi(nomi)
    per_giorno = {}
    for p in giocate:
        per_giorno.setdefault(p['d'], []).append(p)

    def trova(data, n1, n2):
        """In un giorno una squadra gioca una partita sola: basta che UNO dei
        due nomi si risolva con certezza. Il risolutore rifiuta 'Inter Milan'
        — ambiguo fra Inter e Milan, e fa bene — ma con l'avversario risolto
        la partita si ritrova lo stesso, senza indovinare."""
        r1, r2 = risolutore.risolvi(n1 or ''), risolutore.risolvi(n2 or '')
        if not (r1 or r2):
            return None
        d0 = datetime.fromisoformat(data).date()
        cand = []
        for delta in (-1, 0, 1):
            for p in per_giorno.get((d0 + timedelta(days=delta)).isoformat(), []):
                if (r1 is None or p['c'] == r1) and (r2 is None or p['v'] == r2):
                    cand.append(p)
        return cand[0] if len(cand) == 1 else None
    return trova


def esito(p):
    return 0 if p['gc'] > p['gv'] else (1 if p['gc'] == p['gv'] else 2)


# ───────────────────────── la misura ─────────────────────────

def equo(q):
    inv = [1 / x for x in q]
    s = sum(inv)
    return [x / s for x in inv]


def misura(righe, casa, momento, soglia, filtro=True):
    giocate = []
    for r in righe:
        c = r['case']
        if DURA not in c or momento not in c[DURA] or 'chiusura' not in c[DURA]:
            continue
        equo_ora, equo_ch = equo(c[DURA][momento]), equo(c[DURA]['chiusura'])
        if casa == 'migliore':
            prezzi = [c[b][momento] for b in MORBIDE if b in c and momento in c[b]]
            if not prezzi:
                continue
            q = [max(x[i] for x in prezzi) for i in range(3)]
        else:
            if casa not in c or momento not in c[casa]:
                continue
            q = c[casa][momento]
        for i in range(3):
            ev = q[i] * equo_ora[i] - 1
            if filtro and ev < soglia:
                continue
            giocate.append({'ev': ev, 'clv': q[i] * equo_ch[i] - 1,
                            'utile': (q[i] - 1) if r['esito'] == i else -1.0,
                            'quota': q[i]})
    return giocate


def sintesi(g):
    if not g:
        return None
    n = len(g)
    m = lambda k: sum(x[k] for x in g) / n
    def se(k):
        mu = m(k)
        return math.sqrt(sum((x[k] - mu) ** 2 for x in g) / max(1, n - 1) / n)
    clv, sclv = m('clv'), se('clv')
    roi, sroi = m('utile'), se('utile')
    return {'n': n, 'ev': m('ev'), 'clv': clv, 'z_clv': clv / sclv if sclv else 0,
            'roi': roi, 'se_roi': sroi, 'quota': m('quota')}


def main():
    if not CHIAVE:
        print('manca ODDSPAPI_KEY')
        return 0
    nomi = partecipanti()
    partite = partite_giocate()
    print('partite finite in elenco: %d (dal %s)' % (len(partite), DA))

    trova = abbinatore()
    righe, mancano_nomi, mancano_ris, fermato = [], 0, 0, None
    vuote_di_fila, per_mese = 0, {}
    for p in sorted(partite, key=lambda x: x.get('startTime', ''), reverse=True):
        try:
            s = storico_di(p)
        except RuntimeError as e:
            fermato = str(e)
            break
        # Si va all'indietro nel tempo. Se lo storico a un certo punto non
        # c'e' piu', ogni partita piu' vecchia costerebbe una richiesta per
        # niente: dopo otto vuote di fila ci si ferma.
        if DURA not in s['case'] or 't3' not in s['case'][DURA]:
            vuote_di_fila += 1
            if vuote_di_fila >= 8:
                fermato = ('lo storico non arriva prima del %s: otto partite di fila senza '
                           'la quota di Pinnacle' % s['inizio'][:10])
                break
        else:
            vuote_di_fila = 0
            per_mese[s['inizio'][:7]] = per_mese.get(s['inizio'][:7], 0) + 1
        n1, n2 = nomi.get(str(s['p1'])), nomi.get(str(s['p2']))
        if not (n1 and n2):
            mancano_nomi += 1
            continue
        a = trova(s['inizio'][:10], n1, n2)
        if not a:
            mancano_ris += 1
            continue
        righe.append({'case': s['case'], 'esito': esito(a)})

    print('richieste spese in questo giro: %d' % SPESE[0])
    if fermato:
        print('fermato: %s' % fermato)
    print('partite con risultato abbinato: %d  (senza nomi: %d, senza risultato: %d)'
          % (len(righe), mancano_nomi, mancano_ris))
    for b in [DURA] + MORBIDE:
        n = sum(1 for r in righe if b in r['case'] and 't3' in r['case'][b])
        print('  %-11s con la quota a 3 ore: %d partite' % (b, n))
    print('  con Pinnacle, mese per mese: %s' % ', '.join(
        '%s %d' % (m, per_mese[m]) for m in sorted(per_mese)))
    if len(righe) < 30:
        print('\nTROPPO POCHE PARTITE per dire qualunque cosa. Rilanciare quando la cache cresce.')
        return 0

    fuori = []
    print('\n=== CONTROLLO DI SANITA: tutto giocato, nessun filtro ===')
    print('(il CLV deve uscire negativo di circa il margine; se no la macchina e rotta)')
    for casa in MORBIDE:
        s = sintesi(misura(righe, casa, 't3', 0, filtro=False))
        if s:
            print('  %-11s n=%4d  CLV %+.2f%%  ROI %+.2f%%' % (casa, s['n'], 100 * s['clv'], 100 * s['roi']))
            fuori.append(('sanita', casa, 't3', '-', s))

    print('\n=== IL VALORE ===')
    print('  %-10s %-8s %-7s %5s  %7s  %8s %6s  %9s' % ('casa', 'momento', 'soglia', 'n',
                                                     'EV', 'CLV', 'z', 'ROI reale'))
    for momento in ('t3', 't24'):
        for soglia in (0.03, 0.0, 0.05):
            for casa in MORBIDE + ['migliore']:
                s = sintesi(misura(righe, casa, momento, soglia))
                if not s:
                    continue
                primario = (momento, soglia) == PRIMARIO
                print('  %-10s %-8s %-7s %5d  %+6.2f%%  %+7.2f%% %+6.2f  %+7.1f%% ±%.1f %s'
                      % (casa, momento, '%d%%' % round(100 * soglia), s['n'], 100 * s['ev'],
                         100 * s['clv'], s['z_clv'], 100 * s['roi'], 100 * s['se_roi'],
                         '← PRIMARIO' if primario else ''))
                fuori.append(('valore', casa, momento, soglia, s))

    prim = [x for x in fuori if x[0] == 'valore' and (x[2], x[3]) == PRIMARIO and x[1] == 'migliore']
    print('\n=== VERDETTO (regola scritta prima) ===')
    if prim:
        s = prim[0][4]
        if s['clv'] > 0 and s['z_clv'] > 2:
            print('IL VALORE ESISTE: CLV %+.2f%% con z=%.2f su %d giocate.' % (100 * s['clv'], s['z_clv'], s['n']))
        elif s['clv'] > 0:
            print('IL SEGNO E GIUSTO MA NON BASTA: CLV %+.2f%%, z=%.2f. Servono piu partite.'
                  % (100 * s['clv'], s['z_clv']))
        else:
            print('IL VALORE NON C E: CLV %+.2f%% (z=%.2f). Non si gioca.' % (100 * s['clv'], s['z_clv']))
    _riassunto(fuori, len(righe))
    return 0


def _riassunto(fuori, n):
    percorso = os.environ.get('GITHUB_STEP_SUMMARY')
    if not percorso:
        return
    with open(percorso, 'a', encoding='utf-8') as f:
        f.write('## Backtest del valore — %d partite\n\n' % n)
        f.write('| tipo | casa | momento | soglia | n | CLV | z | ROI reale |\n|---|---|---|---|---|---|---|---|\n')
        for tipo, casa, momento, soglia, s in fuori:
            f.write('| %s | %s | %s | %s | %d | %+.2f%% | %+.2f | %+.1f%% |\n'
                    % (tipo, casa, momento, soglia if soglia == '-' else '%d%%' % round(100 * soglia),
                       s['n'], 100 * s['clv'], s['z_clv'], 100 * s['roi']))


if __name__ == '__main__':
    sys.exit(main())
