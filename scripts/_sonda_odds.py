"""The Odds API risponde? Con che copertura, e a che costo di crediti?

La chiave NON sta qui dentro e non deve starci mai: si legge da ODDS_API_KEY,
che e' un segreto del repository. Un file di questo progetto e' pubblico —
finisce su GitHub Pages — quindi una chiave scritta nel codice sarebbe una
chiave regalata a chiunque.

Come per ogni altra fonte di questo progetto: prima si chiede, poi si scrive il
codice che ci si appoggia. API-Football sembrava la risposta ovvia e ha
risposto "Free plans do not have access to this season": mezz'ora di sonda ha
risparmiato un integratore che non avrebbe mai funzionato.

Quello che serve sapere, in ordine:
  1. risponde, con questa chiave?
  2. quante partite di Serie A porta, e quanto in anticipo?
  3. quali banchi? (bet365 e' uno dei tre su cui si gioca davvero)
  4. quanti crediti costa un giro, e quanti ne restano nel mese?

    ODDS_API_KEY=... python3 scripts/_sonda_odds.py
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.the-odds-api.com/v4'
SPORT = 'soccer_italy_serie_a'


def riga(t=''):
    print(t, flush=True)


def chiedi(percorso, parametri, chiave):
    """Torna (dati, intestazioni). Le intestazioni contano quanto i dati: e'
    li' che l'API dice quanti crediti restano."""
    p = dict(parametri)
    p['apiKey'] = chiave
    url = '%s%s?%s' % (BASE, percorso, urllib.parse.urlencode(p))
    req = urllib.request.Request(url, headers={'User-Agent': 'Prediction_SerieA/sonda'})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode('utf-8')), dict(r.headers)


def main():
    chiave = os.environ.get('ODDS_API_KEY', '').strip()
    riga('== The Odds API ==')
    if not chiave:
        riga('nessuna chiave in ODDS_API_KEY.')
        riga('Va messa come segreto del repository, non nel codice:')
        riga('  Settings → Secrets and variables → Actions → New repository secret')
        riga('  nome: ODDS_API_KEY')
        return 0
    riga('chiave presente (%d caratteri, non la stampo)' % len(chiave))

    # 1. lo sport esiste e si chiama come penso?
    try:
        sport, testa = chiedi('/sports', {}, chiave)
    except urllib.error.HTTPError as e:
        riga('NON RISPONDE su /sports: HTTP %s — %s' % (e.code, e.read()[:200].decode('utf-8', 'replace')))
        return 1
    except Exception as e:                      # noqa: BLE001
        riga('NON RISPONDE su /sports: %s' % str(e)[:200])
        return 1
    serie_a = [s for s in sport if s.get('key') == SPORT]
    riga('sport elencati: %d   Serie A presente: %s' % (len(sport), 'si' if serie_a else 'NO'))
    if serie_a:
        riga('  %s — attiva: %s' % (serie_a[0].get('title'), serie_a[0].get('active')))

    # 2. le quote
    try:
        quote, testa = chiedi('/sports/%s/odds' % SPORT,
                              {'regions': 'eu', 'markets': 'h2h,totals',
                               'oddsFormat': 'decimal'}, chiave)
    except urllib.error.HTTPError as e:
        riga('NON RISPONDE sulle quote: HTTP %s — %s' % (e.code, e.read()[:300].decode('utf-8', 'replace')))
        return 1

    riga('')
    riga('crediti usati finora: %s   rimasti: %s' % (
        testa.get('x-requests-used', '?'), testa.get('x-requests-remaining', '?')))
    riga('costo di questa chiamata: %s' % testa.get('x-requests-last', '?'))
    riga('partite di Serie A con quote: %d' % len(quote))
    if not quote:
        riga('risponde ma non porta partite: non e\' utilizzabile adesso.')
        return 0

    date = sorted(p.get('commence_time', '') for p in quote)
    riga('dalla prima (%s) all\'ultima (%s)' % (date[0][:16], date[-1][:16]))
    riga('')
    p0 = quote[0]
    riga('prima partita: %s — %s' % (p0.get('home_team'), p0.get('away_team')))
    banchi = p0.get('bookmakers') or []
    riga('banchi: %d' % len(banchi))
    nomi = [b.get('key') for b in banchi]
    for cercato in ('bet365', 'betfair_ex_eu', 'pinnacle', 'unibet_eu'):
        riga('  %-16s %s' % (cercato, 'c\'e\'' if cercato in nomi else 'no'))
    riga('  tutti: %s' % ', '.join(nomi[:14]))
    riga('')
    for b in banchi[:2]:
        riga('  %s:' % b.get('key'))
        for m in (b.get('markets') or []):
            vals = ', '.join('%s=%s' % (o.get('name'), o.get('price'))
                             for o in (m.get('outcomes') or [])[:3])
            riga('    %-8s %s' % (m.get('key'), vals))
    riga('')
    riga('Con 4 giri al giorno questa chiamata costa %s crediti a giro,' %
         testa.get('x-requests-last', '?'))
    riga('cioe\' circa %s al mese su un piano gratuito da 500.' %
         (int(testa.get('x-requests-last', 1)) * 4 * 30
          if str(testa.get('x-requests-last', '')).isdigit() else '?'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
