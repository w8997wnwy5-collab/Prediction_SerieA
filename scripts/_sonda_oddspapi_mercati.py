"""OddsPapi, seconda domanda: come si chiama l'1X2, e si puo' chiedere solo quello?

La prima sonda ha portato 16 MB per UNA partita, perche' lo storico arriva
con tutti i mercati di ogni casa. Per il backtest servono tre numeri per
casa (1, X, 2) in due momenti (quando si gioca, e al fischio). Scaricare
sedici mega per tenerne sei vorrebbe dire che un backtest su una stagione
intera sono sei gigabyte di roba da buttare.

Tre richieste:
  1. /markets: quale id e' l'1X2 finale, e quali sono i suoi esiti
  2. /historical-odds con un filtro sul mercato: il filtro esiste? (se il
     peso crolla, si')
  3. per quella partita, apertura e chiusura dell'1X2 su Pinnacle, bet365.it
     ed eurobet.it — per vedere che la lettura regge prima di farla su
     trecento partite
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.oddspapi.io/v4'
CHIAVE = os.environ.get('ODDSPAPI_KEY', '').strip()
PARTITA = 'id1000002371944898'           # quella gia' vista dalla prima sonda (22 agosto)
CASE = 'pinnacle,bet365.it,eurobet.it'   # al massimo tre per chiamata, sul piano gratis
SPESE = [0]


def chiedi(via, param=None):
    p = dict(param or {})
    p['apiKey'] = CHIAVE
    url = BASE + via + '?' + urllib.parse.urlencode(p)
    SPESE[0] += 1
    time.sleep(1.2)
    try:
        with urllib.request.urlopen(urllib.request.Request(
                url, headers={'User-Agent': 'monthline-sonda'}), timeout=60) as r:
            corpo = r.read().decode('utf-8', 'replace')
            return r.status, corpo
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace').replace(CHIAVE, '***')[:400]
    except Exception as e:                       # noqa: BLE001
        return None, str(e).replace(CHIAVE, '***')[:300]


def main():
    if not CHIAVE:
        print('manca ODDSPAPI_KEY')
        return 0

    print('=== 1. I MERCATI ===')
    stato, corpo = chiedi('/markets', {'sportId': 10})
    print('/markets ->', stato, '| %d caratteri' % len(corpo))
    try:
        mercati = json.loads(corpo)
    except Exception:                            # noqa: BLE001
        print('   ', corpo[:300])
        return 0
    lista = mercati if isinstance(mercati, list) else mercati.get('data', [mercati])
    print('    %d mercati; forma del primo: %s' % (len(lista), json.dumps(lista[0])[:300]))
    uno_x_due = None
    for m in lista:
        s = json.dumps(m).lower()
        nome = str(m.get('marketName') or m.get('name') or '')
        if any(k in s for k in ('1x2', 'full time result', 'match result', 'fulltime result')):
            print('    candidato 1X2:', json.dumps(m)[:260])
            if uno_x_due is None and 'half' not in s and 'corner' not in s and 'card' not in s:
                uno_x_due = m
    for parola in ('over/under', 'total', 'both teams'):
        trovati = [m for m in lista if parola in json.dumps(m).lower()][:2]
        for m in trovati:
            print('    %-10s %s' % (parola, json.dumps(m)[:200]))
    if not uno_x_due:
        print('    1X2 NON TROVATO: il backtest non parte finche non si sa come si chiama.')
        return 0
    mid = uno_x_due.get('marketId') or uno_x_due.get('id')
    print('    → 1X2 finale: marketId %s' % mid)

    print('\n=== 2. LO STORICO SOLO DELL\'1X2 ===')
    stato, corpo = chiedi('/historical-odds', {'fixtureId': PARTITA, 'bookmakers': CASE,
                                               'marketId': mid})
    print('/historical-odds con marketId ->', stato, '| %d caratteri' % len(corpo))
    filtrato = len(corpo) < 2_000_000
    print('    il filtro sul mercato %s' % ('FUNZIONA' if filtrato
                                            else 'NON funziona (ignorato: arriva tutto)'))
    try:
        d = json.loads(corpo)
    except Exception:                            # noqa: BLE001
        print('   ', corpo[:300])
        return 0

    print('\n=== 3. APERTURA E CHIUSURA, CASA PER CASA ===')
    for casa, dati in (d.get('bookmakers') or {}).items():
        m = ((dati or {}).get('markets') or {}).get(str(mid))
        if not m:
            print('    %-12s niente 1X2' % casa)
            continue
        riga = []
        for esito, v in (m.get('outcomes') or {}).items():
            serie = []
            for giocatori in (v.get('players') or {}).values():
                serie.extend(giocatori or [])
            serie = [s for s in serie if s.get('price')]
            serie.sort(key=lambda s: s.get('createdAt') or '')
            if not serie:
                continue
            riga.append('%s: %.2f → %.2f (%d movimenti)'
                        % (esito, serie[0]['price'], serie[-1]['price'], len(serie)))
        print('    %-12s %s' % (casa, ' | '.join(riga)))
    print('\nrichieste spese: %d' % SPESE[0])
    return 0


if __name__ == '__main__':
    sys.exit(main())
