"""La Nations League: c'e', quanto costa, e con quali banchi?

Tre domande, e una sola risposta buona non basta:

  1. The Odds API la copre col piano gratuito? (il nome della chiave e'
     soccer_uefa_nations_league, ma i piani cambiano e le chiavi anche)
  2. quante partite porta, e quanto in anticipo?
  3. quanti CREDITI costa un giro — perche' il piano gratuito ne da 500 al
     mese e i cinque campionati ne mangiano gia' 321

E poi la domanda che vale piu' di tutte e che qui non si puo' chiedere a
un'API: esiste un archivio di risultati delle NAZIONALI? Senza, il modello
non sa niente di chi gioca, e l'app saprebbe solo ripetere le quote del
banco. Quella si guarda altrove.

    ODDS_API_KEY=... python3 scripts/_sonda_nations.py
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.the-odds-api.com/v4'


def chiedi(via, param=None):
    chiave = os.environ.get('ODDS_API_KEY', '')
    p = dict(param or {})
    p['apiKey'] = chiave
    url = BASE + via + '?' + urllib.parse.urlencode(p)
    try:
        with urllib.request.urlopen(url, timeout=25) as r:
            testa = {k.lower(): v for k, v in r.headers.items()}
            return r.status, json.loads(r.read().decode('utf-8')), testa
    except urllib.error.HTTPError as e:
        corpo = e.read().decode('utf-8', 'replace')
        return e.code, corpo.replace(chiave, '***')[:300], {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:                      # noqa: BLE001
        return None, str(e).replace(chiave, '***')[:200], {}


def restano(testa):
    return testa.get('x-requests-remaining'), testa.get('x-requests-used'), testa.get('x-requests-last')


def main():
    if not os.environ.get('ODDS_API_KEY'):
        print('manca ODDS_API_KEY')
        return 0

    print('=== quali competizioni per nazionali esistono ===')
    stato, sport, testa = chiedi('/sports')
    if stato != 200:
        print('la lista degli sport non risponde:', stato, sport)
        return 0
    print('lista sport: costo', restano(testa)[2], '| restano', restano(testa)[0])
    nazionali = [s for s in sport
                 if any(x in (s.get('key', '') + ' ' + s.get('title', '')).lower()
                        for x in ('nations', 'uefa_euro', 'world_cup', 'friendl',
                                  'qualif', 'conmebol', 'international'))]
    for s in nazionali:
        print('  %-42s %-34s attiva=%s' % (s.get('key'), s.get('title'), s.get('active')))
    if not nazionali:
        print('  nessuna competizione per nazionali nella lista.')

    chiave = 'soccer_uefa_nations_league'
    if not any(s.get('key') == chiave for s in sport):
        print('\nLa chiave', chiave, 'NON e nella lista: niente Nations League da qui.')
        return 0

    print('\n=== quante partite, e quando ===')
    stato, ev, testa = chiedi('/sports/%s/events' % chiave)
    if stato != 200:
        print('eventi:', stato, ev)
        return 0
    print('eventi in arrivo:', len(ev), '| costo', restano(testa)[2], '| restano', restano(testa)[0])
    for e in ev[:8]:
        print('   %s  %s - %s' % (e.get('commence_time', '')[:16],
                                  e.get('home_team'), e.get('away_team')))

    print('\n=== quanto costa un giro di quote ===')
    for mercati in ('h2h', 'h2h,totals', 'h2h,totals,spreads'):
        stato, q, testa = chiedi('/sports/%s/odds' % chiave,
                                 {'regions': 'eu', 'markets': mercati, 'oddsFormat': 'decimal'})
        if stato != 200:
            print('  %-20s %s %s' % (mercati, stato, str(q)[:120]))
            continue
        banchi = set()
        for p in q:
            for b in p.get('bookmakers', []):
                banchi.add(b.get('key'))
        print('  %-20s %2d partite, %2d banchi, costo %s crediti, restano %s'
              % (mercati, len(q), len(banchi), restano(testa)[2], restano(testa)[0]))

    print('\n=== i banchi, e se c e un exchange ===')
    stato, q, testa = chiedi('/sports/%s/odds' % chiave,
                             {'regions': 'eu,uk', 'markets': 'h2h', 'oddsFormat': 'decimal'})
    if stato == 200:
        banchi = {}
        for p in q:
            for b in p.get('bookmakers', []):
                banchi[b.get('key')] = b.get('title')
        print('  eu,uk: %d banchi, costo %s crediti, restano %s'
              % (len(banchi), restano(testa)[2], restano(testa)[0]))
        for k in sorted(banchi):
            print('     %-22s %s' % (k, banchi[k]))
        for cercato in ('bet365', 'Eurobet', 'Sporttip'):
            print('     %-10s %s' % (cercato,
                  'c e' if any(cercato.lower() in (k + t).lower() for k, t in banchi.items())
                  else "NON c e"))
    return 0


if __name__ == '__main__':
    sys.exit(main())
