#!/usr/bin/env python3
"""Cosa si riesce davvero a raggiungere da dentro la Action?

Prima di scrivere un pezzo di codice che legge una fonte conviene sapere se
quella fonte risponde, e cosa manda. Da dentro questa sessione non si vede
niente — l'unica uscita e' verso GitHub — quindi la prova si fa qui, dove la
Action gira per davvero, e il risultato finisce nel riepilogo.

Non scarica niente di serio e non scrive nell'archivio: chiede, guarda cosa
torna, e riferisce. Un giro solo, a mano.

    python3 scripts/sonda_fonti.py
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

TIMEOUT = 12
UA = ('Mozilla/5.0 (compatible; PredizioneSerieA/1.0; '
      '+https://github.com/w8997wnwy5-collab/Prediction_SerieA)')


def prova(nome, url, intestazioni=None, cerca=None, nota=''):
    """Una richiesta sola, e si riferisce cosa e' successo."""
    testa = {'User-Agent': UA, 'Accept': '*/*'}
    testa.update(intestazioni or {})
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers=testa)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            grezzo = r.read(400000)
            tipo = r.headers.get('Content-Type', '')[:40]
        ms = int(1000 * (time.time() - t0))
        testo = grezzo.decode('utf-8', 'replace')
        esito = 'ok'
        extra = '%d KB, %s, %d ms' % (len(grezzo) // 1024 or 1, tipo.split(';')[0], ms)
        if cerca:
            trovati = [c for c in cerca if c.lower() in testo.lower()]
            extra += ' — contiene %d/%d parole chiave' % (len(trovati), len(cerca))
            if len(trovati) < len(cerca):
                mancanti = [c for c in cerca if c not in trovati]
                extra += ' (mancano: %s)' % ', '.join(mancanti[:3])
            if not trovati:
                esito = 'risponde ma non e quello che cerco'
        return {'nome': nome, 'esito': esito, 'dettaglio': extra, 'nota': nota,
                'assaggio': re.sub(r'\s+', ' ', testo[:300]),
                'titoli': re.findall(r'<title>(?:<!\\[CDATA\\[)?(.{5,110}?)(?:\\]\\]>)?</title>', testo)[1:7]}
    except urllib.error.HTTPError as e:
        return {'nome': nome, 'esito': 'HTTP %d' % e.code, 'titoli': [], 'dettaglio': str(e.reason)[:60],
                'nota': nota, 'assaggio': ''}
    except Exception as e:                     # noqa: BLE001
        return {'nome': nome, 'esito': 'irraggiungibile', 'titoli': [], 'dettaglio': str(e)[:80],
                'nota': nota, 'assaggio': ''}


def candidate():
    chiave_af = os.environ.get('APIFOOTBALL_KEY', '').strip()
    token_fd = os.environ.get('FOOTBALL_DATA_TOKEN', '').strip()
    af = {'x-apisports-key': chiave_af} if chiave_af else None
    fd = {'X-Auth-Token': token_fd} if token_fd else None
    L = []

    # ── quello che manca davvero al modello: chi non gioca ──
    if af:
        L.append(('API-Football infortuni (stagione in corso)',
                  'https://v3.football.api-sports.io/injuries?league=135&season=2026', af,
                  ['player'], 'chi e fuori: il buco piu grosso del modello'))
        L.append(('API-Football formazioni',
                  'https://v3.football.api-sports.io/fixtures/lineups?fixture=0', af,
                  [], 'formazioni: servono a partita, si prova la forma della risposta'))
        L.append(('API-Football quote',
                  'https://v3.football.api-sports.io/odds?league=135&season=2024', af,
                  ['bookmaker'], 'quote da una seconda fonte'))
        L.append(('API-Football squalificati/trasferimenti',
                  'https://v3.football.api-sports.io/transfers?team=497', af,
                  ['transfers'], 'movimenti di rosa'))
    else:
        L.append(('API-Football', None, None, None, 'nessuna chiave APIFOOTBALL_KEY'))
    if fd:
        L.append(('football-data.org partite stagione in corso',
                  'https://api.football-data.org/v4/competitions/SA/matches?season=2026', fd,
                  ['matches'], 'risultati e arbitri, tutte le stagioni'))
    else:
        L.append(('football-data.org', None, None, None, 'nessuna chiave FOOTBALL_DATA_TOKEN'))

    # ── fonti aperte, senza chiave ──
    L += [
        ('TheSportsDB prossime di Serie A',
         'https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4332', None,
         ['events'], 'calendario e, forse, formazioni'),
        ('TheSportsDB ultime giocate',
         'https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=4332', None,
         ['events'], 'risultati recenti'),
        ('Wikipedia Serie A 2026-27',
         'https://it.wikipedia.org/api/rest_v1/page/summary/Serie_A_2026-2027', None,
         ['extract'], 'classifica e cronaca, in prosa'),
        ('Wikidata',
         'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=AS%20Roma&language=it&format=json',
         None, ['search'], 'anagrafica squadre'),
        ('OpenLigaDB (esempio tedesco)',
         'https://api.openligadb.de/getmatchdata/bl1', None,
         ['matchID'], 'se risponde, e una API di calcio aperta e senza chiave'),
        ('Reddit r/seriea',
         'https://www.reddit.com/r/seriea/new.json?limit=10', None,
         ['children'], 'discussione, non dati'),
    ]

    # ── secondo giro: la forma esatta di quello che serve ──
    L += [
        ('TheSportsDB: ci sono i punteggi?',
         'https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=4332', None,
         ['intHomeScore', 'intAwayScore', 'strTimestamp'],
         'se ci sono, e una terza fonte di risultati piu veloce delle altre due'),
        ('TheSportsDB: dettaglio di una squadra',
         'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=Roma', None,
         ['strTeam'], 'anagrafica e descrizione'),
    ]
    if af:
        L.append(('API-Football infortuni 2024 (per vedere la forma del dato)',
                  'https://v3.football.api-sports.io/injuries?league=135&season=2024', af,
                  ['player', 'type'], 'com e fatto un infortunio, quando il piano lo concede'))

    # ── notizie: RSS di testate italiane ──
    # Il feed "calcio" della Gazzetta ha dato 99 titoli e zero riconosciuti: sono
    # rubriche e fantacalcio, non cronaca. Si provano gli altri suoi indirizzi.
    L += [
        ('RSS Gazzetta serie-a', 'https://www.gazzetta.it/rss/serie-a.xml', None,
         ['<item'], 'forse questo e cronaca invece che rubriche'),
        ('RSS Gazzetta home', 'https://www.gazzetta.it/rss/home.xml', None,
         ['<item'], 'tutto, da filtrare'),
        ('RSS Sky Sport vero', 'https://sport.sky.it/rss/calcio.xml', None,
         ['<item'], 'quello che avevo etichettato Sky era del Corriere'),
        ('RSS Repubblica calcio',
         'https://www.repubblica.it/rss/sport/calcio/rss2.0.xml', None,
         ['<item'], 'altra agenzia'),
        ('RSS Corriere dello Sport',
         'https://www.corrieredellosport.it/rss/calcio.xml', None,
         ['<item'], 'molto puntuale sulle formazioni'),
        ('RSS Gazzetta calcio (quello di adesso)',
         'https://www.gazzetta.it/rss/calcio.xml', None,
         ['<item', 'title'], 'per confronto'),
        ('RSS ANSA calcio',
         'https://www.ansa.it/sito/notizie/sport/calcio/calcio_rss.xml', None,
         ['<item', 'title'], 'agenzia, asciutta e affidabile'),
        ('RSS Sky Sport calcio', 'https://xml2.corriereobjects.it/rss/sport.xml', None,
         ['<item'], 'notizie'),
        ('RSS Football Italia', 'https://football-italia.net/feed/', None,
         ['<item'], 'in inglese, ma molto puntuale sulle formazioni'),
        ('RSS Tuttomercatoweb Serie A', 'https://www.tuttomercatoweb.com/rss', None,
         ['<item'], 'formazioni e infortuni, aggiornatissimo'),
    ]
    return L


def main():
    print('Sonda: cosa risponde da dentro la Action\n')
    esiti = []
    for nome, url, testa, cerca, nota in candidate():
        if not url:
            esiti.append({'nome': nome, 'esito': 'saltata', 'dettaglio': nota,
                          'nota': '', 'assaggio': ''})
            print('  saltata          %s — %s' % (nome, nota))
            continue
        r = prova(nome, url, testa, cerca, nota)
        esiti.append(r)
        print('  %-16s %s' % (r['esito'][:16], r['nome']))
        print('                   %s' % r['dettaglio'])
        if r.get('titoli'):
            for t in r['titoli'][:5]:
                print('                   · %s' % t[:110])
        elif r['assaggio']:
            print('                   « %s »' % r['assaggio'][:150])
        time.sleep(1.2)

    buone = [e for e in esiti if e['esito'] == 'ok']
    print('\n%d fonti su %d rispondono.' % (len(buone), len(esiti)))
    for e in buone:
        print('  · %s%s' % (e['nome'], ' — ' + e['nota'] if e['nota'] else ''))

    percorso = os.environ.get('GITHUB_STEP_SUMMARY')
    if percorso:
        with open(percorso, 'a', encoding='utf-8') as f:
            f.write('## Sonda fonti\n\n| fonte | esito | dettaglio |\n|---|---|---|\n')
            for e in esiti:
                f.write('| %s | %s | %s |\n' % (e['nome'], e['esito'], e['dettaglio'][:80]))
    with open('sonda.json', 'w', encoding='utf-8') as f:
        json.dump(esiti, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
