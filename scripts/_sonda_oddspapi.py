"""OddsPapi: le tue case ci sono davvero? E lo storico, quanto va indietro?

Tutto quello che sappiamo di OddsPapi lo sappiamo dal LORO blog, e il loro
blog l'abbiamo gia' colto in fallo una volta: dice che The Odds API non ha
Pinnacle ne' Betfair, e la nostra sonda li ha trovati tutti e due. Quindi
niente si costruisce su quello che dichiarano — si chiede alla loro API, con
una chiave vera, e si guarda cosa torna.

Le domande, in ordine di importanza per i soldi:

  1. bet365, Eurobet, Sisal, Snai, Sporttip: ci sono? (le case su cui si
     gioca davvero — senza queste la macchina del valore non ha meta' dei
     prezzi che le servono)
  2. Pinnacle c'e'? (e' il prezzo equo contro cui si misura il valore)
  3. sulla Serie A, per una partita vera, quali mercati da' bet365?
  4. lo storico c'e' sul piano gratis, e con quanta profondita'?
  5. quante richieste restano: 250 al mese si finiscono in fretta

Il piano gratis ne da' 250 al mese: questa sonda ne spende meno di dieci.

    ODDSPAPI_KEY=... python3 scripts/_sonda_oddspapi.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = 'https://api.oddspapi.io/v4'
CHIAVE = os.environ.get('ODDSPAPI_KEY', '').strip()
CERCATE = ['bet365', 'eurobet', 'sisal', 'snai', 'sporttip', 'pinnacle', 'betfair',
           'lottomatica', 'goldbet', 'planetwin', 'better']
SPESE = [0]


def pulisci(testo):
    return str(testo).replace(CHIAVE, '***') if CHIAVE else str(testo)


def chiedi(via, param=None):
    """Una chiamata. La chiave viaggia nell'URL, quindi non si stampa MAI
    l'URL, e ogni messaggio d'errore passa per pulisci() prima di uscire."""
    p = dict(param or {})
    p['apiKey'] = CHIAVE
    url = BASE + via + '?' + urllib.parse.urlencode(p)
    SPESE[0] += 1
    time.sleep(1.2)                      # il piano gratis vuole respiro fra le chiamate
    req = urllib.request.Request(url, headers={'User-Agent': 'monthline-sonda',
                                               'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            testa = {k.lower(): v for k, v in r.headers.items()}
            corpo = r.read().decode('utf-8', 'replace')
            try:
                return r.status, json.loads(corpo), testa
            except Exception:            # noqa: BLE001
                return r.status, corpo[:300], testa
    except urllib.error.HTTPError as e:
        corpo = e.read().decode('utf-8', 'replace')
        return e.code, pulisci(corpo[:400]), {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:               # noqa: BLE001
        return None, pulisci(e)[:300], {}


def quota_rimasta(testa):
    utili = {k: v for k, v in testa.items()
             if any(x in k for x in ('ratelimit', 'remaining', 'requests', 'quota', 'limit'))}
    return utili or '(nessuna intestazione sul consumo)'


def forma(x, livello=0):
    """La forma di una risposta sconosciuta: chiavi e tipi, senza stampare
    megabyte. La prima volta che si parla con un'API non si sa com'e' fatta,
    e indovinarlo e' il modo migliore di leggere un campo che non esiste —
    e' gia' successo in questa sessione."""
    pad = '    ' * livello
    if isinstance(x, dict):
        chiavi = list(x.keys())
        return pad + 'oggetto con %d chiavi: %s' % (len(chiavi), ', '.join(map(str, chiavi[:14])))
    if isinstance(x, list):
        return pad + 'lista di %d elementi' % len(x)
    return pad + '%s: %s' % (type(x).__name__, str(x)[:80])


def elementi(x):
    """Una risposta puo' essere una lista, o un oggetto che contiene la lista."""
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        for k in ('data', 'items', 'results', 'response', 'bookmakers', 'tournaments', 'fixtures'):
            if isinstance(x.get(k), list):
                return x[k]
        return [x]
    return []


def main():
    if not CHIAVE:
        print('manca ODDSPAPI_KEY')
        return 0

    # ── 1. le case ──
    print('=== 1. LE CASE ===')
    stato, d, testa = chiedi('/bookmakers')
    print('/bookmakers ->', stato, '| consumo:', quota_rimasta(testa))
    if stato != 200:
        print('   ', d)
        print('VERDETTO: la chiave non entra. Controllare che sia copiata intera.')
        return 0
    case = elementi(d)
    print('   ', forma(d))
    if case:
        print('    primo elemento:', json.dumps(case[0])[:220])
    testo = json.dumps(d).lower()
    for c in CERCATE:
        trovate = sorted({s for s in _slug(case) if c in s})
        print('    %-12s %s' % (c, ', '.join(trovate) if trovate
                                  else ('compare nel testo' if c in testo else 'NON c e')))

    # ── 2. la Serie A ──
    print('\n=== 2. I CAMPIONATI (calcio = sportId 10) ===')
    stato, d, testa = chiedi('/tournaments', {'sportId': 10})
    print('/tournaments ->', stato, '|', forma(d))
    tornei = elementi(d)
    serie_a = None
    for t in tornei:
        s = json.dumps(t).lower()
        if 'serie a' in s and 'ital' in s and 'women' not in s and 'femminile' not in s:
            serie_a = t
            break
    if not serie_a:
        print('    Serie A non trovata fra %d campionati. Primi: %s'
              % (len(tornei), json.dumps(tornei[:2])[:300]))
        return 0
    tid = _campo(serie_a, ('tournamentId', 'id', 'tournament_id'))
    print('    Serie A:', json.dumps(serie_a)[:260])
    print('    id usato:', tid)

    # ── 3. una partita vera in arrivo, e cosa quota bet365 ──
    print('\n=== 3. LE PARTITE IN ARRIVO ===')
    oggi = datetime.now(timezone.utc).date()
    stato, d, testa = chiedi('/fixtures', {'tournamentId': tid,
                                           'from': oggi.isoformat(),
                                           'to': (oggi + timedelta(days=21)).isoformat()})
    print('/fixtures ->', stato, '|', forma(d), '| consumo:', quota_rimasta(testa))
    partite = elementi(d)
    if not partite:
        print('    nessuna partita:', str(d)[:300])
        return 0
    print('    prima:', json.dumps(partite[0])[:300])
    fid = _campo(partite[0], ('fixtureId', 'id', 'fixture_id'))

    print('\n=== 4. LE QUOTE DI QUELLA PARTITA ===')
    stato, d, testa = chiedi('/odds', {'fixtureId': fid})
    print('/odds ->', stato, '|', forma(d), '| consumo:', quota_rimasta(testa))
    if stato == 200:
        _racconta_quote(d)
    else:
        print('   ', str(d)[:300])

    # ── 5. lo storico: una partita GIA' giocata ──
    print('\n=== 5. LO STORICO ===')
    stato, d, testa = chiedi('/fixtures', {'tournamentId': tid,
                                           'from': (oggi - timedelta(days=40)).isoformat(),
                                           'to': (oggi - timedelta(days=2)).isoformat()})
    giocate = elementi(d)
    print('/fixtures (passate) ->', stato, '|', len(giocate), 'partite')
    if giocate:
        fid_v = _campo(giocate[0], ('fixtureId', 'id', 'fixture_id'))
        print('    partita:', json.dumps(giocate[0])[:220])
        stato, d, testa = chiedi('/historical-odds', {'fixtureId': fid_v,
                                                      'bookmakers': 'bet365,pinnacle'})
        print('/historical-odds ->', stato, '|', forma(d), '| consumo:', quota_rimasta(testa))
        if stato == 200:
            _racconta_storico(d)
        else:
            print('   ', str(d)[:300])

    print('\nrichieste spese da questa sonda: %d su 250 al mese' % SPESE[0])
    return 0


def _slug(case):
    fuori = set()
    for c in case:
        if isinstance(c, dict):
            for k in ('slug', 'bookmaker', 'bookmakerSlug', 'key', 'name', 'id'):
                v = c.get(k)
                if isinstance(v, str):
                    fuori.add(v.lower())
        elif isinstance(c, str):
            fuori.add(c.lower())
    return fuori


def _campo(obj, nomi):
    if isinstance(obj, dict):
        for n in nomi:
            if obj.get(n) is not None:
                return obj[n]
    return None


def _racconta_quote(d):
    """Chi quota, e quanti mercati. Senza sapere la forma esatta: si cerca un
    oggetto le cui chiavi sono i nomi delle case."""
    testo = json.dumps(d).lower()
    for c in ('bet365', 'pinnacle', 'eurobet', 'sisal', 'snai', 'betfair'):
        print('    %-10s %s' % (c, 'presente' if c in testo else 'assente'))
    contenitore = None
    stack = [d]
    while stack:
        x = stack.pop()
        if isinstance(x, dict):
            if any(k.lower() in ('bet365', 'pinnacle') for k in x.keys()):
                contenitore = x
                break
            stack.extend(x.values())
        elif isinstance(x, list):
            stack.extend(x)
    if contenitore:
        print('    case che quotano questa partita: %d' % len(contenitore))
        for casa in ('bet365', 'pinnacle', 'sisal', 'snai'):
            v = contenitore.get(casa)
            if v is None:
                continue
            mercati = _conta_mercati(v)
            print('    %-9s %s' % (casa, mercati))


def _conta_mercati(v):
    if isinstance(v, dict):
        for k in ('markets', 'odds', 'market'):
            if isinstance(v.get(k), (dict, list)):
                m = v[k]
                chiavi = list(m.keys())[:12] if isinstance(m, dict) else []
                return '%d mercati (primi id: %s)' % (len(m), ', '.join(map(str, chiavi)))
        return 'oggetto con chiavi: ' + ', '.join(list(v.keys())[:10])
    return str(v)[:120]


def _racconta_storico(d):
    testo = json.dumps(d)
    print('    dimensione della risposta: %d caratteri' % len(testo))
    punti = testo.count('"price"') + testo.count('"odds"') + testo.count('"createdAt"')
    print('    punti di prezzo (stima grezza): %d' % punti)
    print('    un pezzo:', testo[:360])


if __name__ == '__main__':
    sys.exit(main())
