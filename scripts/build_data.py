#!/usr/bin/env python3
"""
Scarica e normalizza i dati della Serie A.

Gira dentro GitHub Actions, senza dipendenze fuori dalla libreria standard.

Fonti, in ordine:
  1. football-data.co.uk — risultati, tiri, falli, corner, cartellini, arbitro
     e quote di chiusura. Sei stagioni, dalla più recente all'indietro.
  2. openfootball/football.json — solo risultati e calendario, ma non si arrabbia
     mai: fa da riserva stagione per stagione.
  3. API-Football (facoltativa, chiave gratuita) — arbitro e statistiche partita
     dove le prime due non arrivano.

Tre regole che vengono prima di tutto il resto:
  · quello che è già stato scaricato NON si perde: il file esistente viene unito
    a quello nuovo, campo per campo;
  · una risposta che non è un CSV della Serie A è un errore, non "zero partite";
  · quello che non ha funzionato finisce scritto in data/meta.json, non nel nulla.
"""

import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(QUI, 'data')
FILE_DATI = os.path.join(DATA, 'serie-a.json')
FILE_META = os.path.join(DATA, 'meta.json')

N_STAGIONI = 6
PAUSA = 5           # secondi fra un download e l'altro: la fonte non ama le raffiche
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/127.0.0.0 Safari/537.36')
LEGA_APIFOOTBALL = 135      # Serie A
MAX_RICHIESTE_API = 70      # il piano gratuito ne dà 100 al giorno: ne lasciamo da parte
N_STAGIONI_XG = 6           # Understat copre la Serie A dal 2014: prendiamo le stesse sei
MAX_ESPN_DETTAGLI = 60      # una richiesta per partita: si riempie l'archivio un pezzo al giorno

def log(*a):
    print(*a, flush=True)


# ────────────────────────────── rete ──────────────────────────────

def scarica(url, tentativi=4, attesa=6, controllo=None, intestazioni=None):
    """Scarica e, se serve, controlla che il contenuto sia quello giusto.
    Un sito che risponde 200 con una pagina di errore è il modo più subdolo di
    fallire: senza questo controllo il file finisce vuoto e nessuno se ne accorge."""
    ultimo = None
    for i in range(tentativi):
        try:
            testa = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'it,en;q=0.8'}
            testa.update(intestazioni or {})
            req = urllib.request.Request(url, headers=testa)
            with urllib.request.urlopen(req, timeout=60) as r:
                dati = r.read()
            if controllo:
                problema = controllo(dati)
                if problema:
                    raise RuntimeError('risposta non valida (%s)' % problema)
            return dati
        except Exception as e:            # noqa: BLE001
            ultimo = e
            log('    tentativo %d: %s' % (i + 1, e))
            if i < tentativi - 1:
                time.sleep(attesa * (i + 1))
    raise RuntimeError(str(ultimo))


def _pare_csv(dati, byte_minimi=400):
    """Controlli comuni a tutti i CSV di football-data.co.uk."""
    if not dati or len(dati) < byte_minimi:
        return 'solo %d byte' % len(dati or b'')
    # utf-8-sig toglie il BOM: certe stagioni ce l'hanno, altre no, ed è invisibile
    testa = dati[:3000].decode('utf-8-sig', errors='replace').lstrip('\ufeff').lstrip()
    if testa[:1] == '<' or '<html' in testa[:400].lower():
        return 'è una pagina HTML, non un CSV'
    prima = testa.split('\n', 1)[0]
    if not prima.startswith('Div'):
        return "l'intestazione non comincia con Div: %r" % prima[:60]
    return None


def pare_csv_seriea(dati):
    """None se va bene, altrimenti il motivo del rifiuto."""
    problema = _pare_csv(dati)
    if problema:
        return problema
    testa = dati[:3000].decode('utf-8-sig', errors='replace')
    if 'I1' not in testa:
        return 'nessuna riga di Serie A nelle prime righe'
    return None


def pare_csv_calendario(dati):
    """Il calendario di tutte le leghe è ordinato per data, non per campionato:
    la Serie A può stare a metà file o non esserci affatto in pausa nazionali.
    Pretendere 'I1' nei primi 3000 byte è il motivo per cui questo file è stato
    rifiutato per mesi, e con lui le quote di tutte le partite in arrivo."""
    return _pare_csv(dati, byte_minimi=200)


# ────────────────────────────── conversioni ──────────────────────────────

def num(v):
    if v is None:
        return None
    v = str(v).strip()
    if v == '' or v.upper() in ('NA', 'N/A', '-'):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return None if f != f else f


def intero(v):
    f = num(v)
    return None if f is None else int(round(f))


def data_iso(v):
    v = (v or '').strip()
    m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$', v)
    if m:
        g, mm, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if a < 100:
            a += 2000 if a < 70 else 1900
    else:
        m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', v)
        if not m:
            return None
        a, mm, g = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return datetime(a, mm, g).strftime('%Y-%m-%d')
    except ValueError:
        return None


ALIAS = {
    'Internazionale': 'Inter', 'FC Internazionale Milano': 'Inter', 'Inter Milan': 'Inter',
    'AC Milan': 'Milan', 'Milan AC': 'Milan', 'Juventus FC': 'Juventus', 'AS Roma': 'Roma',
    'SS Lazio': 'Lazio', 'SSC Napoli': 'Napoli', 'Atalanta BC': 'Atalanta',
    'ACF Fiorentina': 'Fiorentina', 'Bologna FC 1909': 'Bologna', 'Torino FC': 'Torino',
    'Udinese Calcio': 'Udinese', 'Genoa CFC': 'Genoa', 'UC Sampdoria': 'Sampdoria',
    'US Sassuolo Calcio': 'Sassuolo', 'Sassuolo Calcio': 'Sassuolo',
    'Hellas Verona FC': 'Verona', 'Hellas Verona': 'Verona', 'Verona FC': 'Verona',
    'Empoli FC': 'Empoli', 'US Lecce': 'Lecce', 'US Salernitana 1919': 'Salernitana',
    'Salernitana 1919': 'Salernitana', 'Cagliari Calcio': 'Cagliari',
    'Frosinone Calcio': 'Frosinone', 'AC Monza': 'Monza', 'Venezia FC': 'Venezia',
    'Parma Calcio 1913': 'Parma', 'Como 1907': 'Como', 'Spezia Calcio': 'Spezia',
    'Benevento Calcio': 'Benevento', 'US Cremonese': 'Cremonese', 'SPAL': 'Spal',
    'Brescia Calcio': 'Brescia', 'Pisa SC': 'Pisa', 'AC Pisa 1909': 'Pisa',
    'Pisa 1909': 'Pisa', 'US Pisa 1909': 'Pisa', 'AC Reggiana': 'Reggiana',
    'Palermo FC': 'Palermo', 'US Catanzaro 1929': 'Catanzaro', 'Bari 1908': 'Bari',
}


def nome(n):
    n = (n or '').strip()
    return ALIAS.get(n, n)


def chiave(p):
    return '%s|%s|%s' % (p.get('d'), p.get('c'), p.get('v'))


# ────────────────────────────── stagioni ──────────────────────────────

def stagioni_da_prendere(oggi=None):
    """La stagione europea comincia a luglio. Si parte dalla più recente:
    se la fonte a un certo punto smette di rispondere, almeno le stagioni che
    contano davvero sono già in tasca."""
    oggi = oggi or datetime.now(timezone.utc)
    inizio = oggi.year if oggi.month >= 7 else oggi.year - 1
    fuori = []
    for k in range(N_STAGIONI):
        a = inizio - k
        fuori.append(('%02d%02d' % (a % 100, (a + 1) % 100), '%d-%02d' % (a, (a + 1) % 100)))
    return fuori


# ────────────────────────────── football-data.co.uk ──────────────────────────────

COLONNE_1X2 = (('AvgH', 'AvgD', 'AvgA'), ('BbAvH', 'BbAvD', 'BbAvA'),
               ('PSCH', 'PSCD', 'PSCA'), ('PSH', 'PSD', 'PSA'),
               ('B365H', 'B365D', 'B365A'), ('BWH', 'BWD', 'BWA'),
               ('IWH', 'IWD', 'IWA'), ('WHH', 'WHD', 'WHA'))
COLONNE_OU = (('Avg>2.5', 'Avg<2.5'), ('BbAv>2.5', 'BbAv<2.5'),
              ('P>2.5', 'P<2.5'), ('B365>2.5', 'B365<2.5'))


def quote_da_riga(r):
    """Le stesse quote hanno nomi diversi a seconda della stagione e del file:
    la media di tutti i bookmaker quando c'è, il singolo bookmaker quando non
    c'è. Il calendario in arrivo, in particolare, porta solo le colonne di
    qualche operatore: cercarne una sola era il motivo per cui le partite
    future finivano senza quote, e senza quote il confronto col mercato non
    esiste."""
    fuori = {}
    for a, b, c in COLONNE_1X2:
        q = [num(r.get(a)), num(r.get(b)), num(r.get(c))]
        if all(q) and min(q) > 1:
            fuori['q'] = [round(x, 3) for x in q]
            break
    for a, b in COLONNE_OU:
        qo, qu = num(r.get(a)), num(r.get(b))
        if qo and qu and min(qo, qu) > 1:
            fuori['qou'] = [round(qo, 3), round(qu, 3)]
            break
    return fuori


def leggi_csv(testo, stagione):
    fuori = []
    lettore = csv.DictReader(io.StringIO(testo.replace('\r\n', '\n')))
    # Il BOM in testa al file diventerebbe parte del nome della prima colonna:
    # 'Div' si chiamerebbe '\ufeffDiv' e ogni riga verrebbe scartata in silenzio.
    # È esattamente il modo in cui tre stagioni sono sparite senza un errore.
    if lettore.fieldnames:
        lettore.fieldnames = [(c or '').replace('\ufeff', '').strip() for c in lettore.fieldnames]
    for r in lettore:
        if (r.get('Div') or '').strip() != 'I1':
            continue
        casa, via, d = nome(r.get('HomeTeam')), nome(r.get('AwayTeam')), data_iso(r.get('Date'))
        if not (casa and via and d):
            continue
        m = {'s': stagione, 'd': d, 'o': (r.get('Time') or '').strip() or None,
             'c': casa, 'v': via,
             'gc': intero(r.get('FTHG')), 'gv': intero(r.get('FTAG')),
             'ptc': intero(r.get('HTHG')), 'ptv': intero(r.get('HTAG')),
             'arb': (r.get('Referee') or '').strip() or None,
             'tc': intero(r.get('HS')), 'tv': intero(r.get('AS')),
             'tpc': intero(r.get('HST')), 'tpv': intero(r.get('AST')),
             'fc': intero(r.get('HF')), 'fv': intero(r.get('AF')),
             'ac': intero(r.get('HC')), 'av': intero(r.get('AC')),
             'gic': intero(r.get('HY')), 'giv': intero(r.get('AY')),
             'rc': intero(r.get('HR')), 'rv': intero(r.get('AR'))}
        m.update(quote_da_riga(r))
        fuori.append({k: v for k, v in m.items() if v is not None})
    return fuori


def prendi_football_data(stagioni):
    partite, esiti = [], {}
    for i, (codice, etichetta) in enumerate(stagioni):
        if i:
            time.sleep(PAUSA)
        url = 'https://www.football-data.co.uk/mmz4281/%s/I1.csv' % codice
        log('· football-data.co.uk %s' % etichetta)
        try:
            testo = scarica(url, controllo=pare_csv_seriea).decode('utf-8-sig', errors='replace')
            p = leggi_csv(testo, etichetta)
            if not p:
                raise RuntimeError('CSV scaricato ma nessuna partita di Serie A dentro')
            arb = len([x for x in p if x.get('arb')])
            log('  %d partite (%d con arbitro)' % (len(p), arb))
            partite.extend(p)
            esiti[etichetta] = 'ok: %d partite, %d con arbitro' % (len(p), arb)
        except Exception as e:        # noqa: BLE001
            log('  FALLITA: %s' % e)
            esiti[etichetta] = 'fallita: %s' % e
    return partite, esiti


# ────────────────────────────── openfootball (riserva) ──────────────────────────────

def prendi_openfootball(etichetta):
    url = ('https://raw.githubusercontent.com/openfootball/football.json/'
           'master/%s/it.1.json' % etichetta)
    d = json.loads(scarica(url, tentativi=2, attesa=3).decode('utf-8'))
    giocate, future = [], []
    for m in d.get('matches', []):
        casa, via = nome(m.get('team1')), nome(m.get('team2'))
        data = data_iso(m.get('date'))
        if not (casa and via and data):
            continue
        sc = (m.get('score') or {}).get('ft')
        base = {'s': etichetta, 'd': data, 'c': casa, 'v': via}
        if m.get('round'):
            base['giornata'] = m['round']
        if sc and len(sc) == 2 and sc[0] is not None:
            base['gc'], base['gv'] = sc[0], sc[1]
            giocate.append(base)
        else:
            future.append(base)
    return giocate, future


# ────────────────────────────── calendario ──────────────────────────────

def prendi_calendario(stagioni, esiti):
    fut = []
    try:
        testo = scarica('https://www.football-data.co.uk/fixtures.csv',
                        tentativi=2, controllo=pare_csv_calendario).decode('utf-8-sig', 'replace')
        for r in csv.DictReader(io.StringIO(testo)):
            if (r.get('Div') or '').strip() != 'I1':
                continue
            d = data_iso(r.get('Date'))
            if not d:
                continue
            m = {'d': d, 'o': (r.get('Time') or '').strip() or None,
                 'c': nome(r.get('HomeTeam')), 'v': nome(r.get('AwayTeam'))}
            m.update(quote_da_riga(r))
            fut.append({k: v for k, v in m.items() if v is not None})
        esiti['calendario ravvicinato'] = 'ok: %d partite' % len(fut)
    except Exception as e:            # noqa: BLE001
        esiti['calendario ravvicinato'] = 'fallito: %s' % e
    return fut


# ────────────────────────────── API-Football (facoltativa) ──────────────────────────────

def api_football(percorso, parametri, chiave_api, conteggio):
    url = 'https://v3.football.api-sports.io/%s?%s' % (percorso, urllib.parse.urlencode(parametri))
    grezzo = scarica(url, tentativi=2, attesa=4, intestazioni={'x-apisports-key': chiave_api})
    conteggio[0] += 1
    d = json.loads(grezzo.decode('utf-8'))
    err = d.get('errors')
    if err and (isinstance(err, dict) and err or isinstance(err, list) and err):
        raise RuntimeError('API-Football dice: %s' % json.dumps(err, ensure_ascii=False)[:200])
    return d


def arricchisci(indice, stagioni, esiti):
    """Riempie arbitro e statistiche dove mancano, con la chiave gratuita di
    API-Football. Il piano gratuito è avaro di stagioni e di richieste: si parte
    dalla stagione in corso e ci si ferma prima di finire la quota."""
    chiave_api = os.environ.get('APIFOOTBALL_KEY', '').strip()
    if not chiave_api:
        esiti['API-Football'] = 'saltata: nessuna chiave APIFOOTBALL_KEY'
        return 0, 0
    conteggio, agg_arb, agg_stat = [0], 0, 0
    # Il piano gratuito copre una finestra di stagioni che si sposta ogni anno e
    # che non è documentata: si prova con tutte e si tiene quello che risponde.
    # Costa una richiesta a vuoto per stagione, su una quota di settanta.
    for codice, etichetta in stagioni:
        anno = int(etichetta[:4])
        try:
            d = api_football('fixtures', {'league': LEGA_APIFOOTBALL, 'season': anno},
                             chiave_api, conteggio)
        except Exception as e:        # noqa: BLE001
            esiti['API-Football %s' % etichetta] = 'non disponibile: %s' % e
            continue
        risposte = d.get('response') or []
        if not risposte:
            esiti['API-Football %s' % etichetta] = 'stagione non compresa nel piano'
            continue
        senza_statistiche = []
        for f in risposte:
            fx = f.get('fixture') or {}
            sq = f.get('teams') or {}
            data = data_iso((fx.get('date') or '')[:10])
            casa = nome(((sq.get('home') or {}).get('name')))
            via = nome(((sq.get('away') or {}).get('name')))
            if not (data and casa and via):
                continue
            p = indice.get('%s|%s|%s' % (data, casa, via))
            if p is None:               # fuso orario: la partita può essere del giorno prima o dopo
                for salto in (-1, 1):
                    alt = (datetime.strptime(data, '%Y-%m-%d') + timedelta(days=salto)).strftime('%Y-%m-%d')
                    p = indice.get('%s|%s|%s' % (alt, casa, via))
                    if p is not None:
                        break
            if p is None:
                continue
            arb = (fx.get('referee') or '').split(',')[0].strip()
            if arb and not p.get('arb'):
                p['arb'] = arb
                agg_arb += 1
            if p.get('gc') is not None and p.get('tpc') is None and fx.get('id'):
                senza_statistiche.append((fx['id'], p))
        esiti['API-Football %s' % etichetta] = 'ok: %d partite, %d arbitri aggiunti' % (
            len(risposte), agg_arb)
        senza_statistiche.sort(key=lambda x: x[1]['d'], reverse=True)
        for fid, p in senza_statistiche:
            if conteggio[0] >= MAX_RICHIESTE_API:
                esiti['API-Football quota'] = ('fermato a %d richieste: mancano ancora %d partite '
                                               'da completare, le prende domani'
                                               % (conteggio[0], len(senza_statistiche) - agg_stat))
                break
            try:
                d2 = api_football('fixtures/statistics', {'fixture': fid}, chiave_api, conteggio)
            except Exception:         # noqa: BLE001
                continue
            mappa = {'Total Shots': ('tc', 'tv'), 'Shots on Goal': ('tpc', 'tpv'),
                     'Fouls': ('fc', 'fv'), 'Corner Kicks': ('ac', 'av'),
                     'Yellow Cards': ('gic', 'giv'), 'Red Cards': ('rc', 'rv')}
            for lato, blocco in enumerate(d2.get('response') or []):
                for s in blocco.get('statistics') or []:
                    campi = mappa.get(s.get('type'))
                    if campi and s.get('value') is not None:
                        p[campi[lato if lato < 2 else 0]] = intero(s.get('value')) or 0
            agg_stat += 1
            time.sleep(0.7)
    esiti['API-Football richieste'] = '%d usate su %d disponibili' % (conteggio[0], MAX_RICHIESTE_API)
    return agg_arb, agg_stat


def prendi_giocatori(esiti):
    token = os.environ.get('FOOTBALL_DATA_TOKEN', '').strip()
    if not token:
        esiti['marcatori'] = 'saltati: nessuna chiave FOOTBALL_DATA_TOKEN'
        return None
    try:
        d = json.loads(scarica('https://api.football-data.org/v4/competitions/SA/scorers?limit=100',
                               tentativi=2, intestazioni={'X-Auth-Token': token}).decode('utf-8'))
        lista = []
        for s in d.get('scorers', []):
            p, sq = s.get('player') or {}, s.get('team') or {}
            lista.append({'nome': p.get('name'), 'ruolo': p.get('position'),
                          'squadra': nome(sq.get('shortName') or sq.get('name')),
                          'gol': s.get('goals') or 0, 'assist': s.get('assists') or 0,
                          'rigori': s.get('penalties') or 0,
                          'partite': s.get('playedMatches') or 0})
        esiti['marcatori'] = 'ok: %d giocatori' % len(lista)
        return {'stagione': (d.get('season') or {}).get('startDate', '')[:4], 'lista': lista}
    except Exception as e:            # noqa: BLE001
        esiti['marcatori'] = 'falliti: %s' % e
        return None


# ────────────────────────────── Understat: gli xG veri ──────────────────────────────

URL_UNDERSTAT = 'https://understat.com/league/Serie_A/%d'


def _json_da_understat(testo, variabile):
    """Understat non ha API: i dati stanno dentro la pagina, dentro una stringa
    JavaScript in cui ogni carattere è scritto come \\xNN. Si srotola e diventa JSON.

    Le tre forme sono tutte state viste in giro — con e senza `var`, con e senza
    punto e virgola, apici singoli o doppi — e costano tre righe invece di una.
    Pretenderne una sola e chiamarlo "formato cambiato" quando non combacia è il
    modo più veloce di perdere una fonte che funziona ancora."""
    forme = [
        r"var\s+%s\s*=\s*JSON\.parse\('(.*?)'\)",
        r"%s\s*=\s*JSON\.parse\('(.*?)'\)",
        r'%s\s*=\s*JSON\.parse\("(.*?)"\)',
    ]
    for forma in forme:
        m = re.search(forma % re.escape(variabile), testo, re.S)
        if not m:
            continue
        grezzo = re.sub(r'\\x([0-9A-Fa-f]{2})', lambda g: chr(int(g.group(1), 16)), m.group(1))
        try:
            return json.loads(grezzo)
        except ValueError:
            continue
    return None


def _perche_understat_non_va(testo, variabile):
    """Quando una pagina non dà quello che deve, la differenza fra "hanno
    cambiato il formato" e "ci hanno chiuso la porta" cambia completamente cosa
    conviene fare. Costa cinque righe saperlo, e senza si tira a indovinare per
    settimane."""
    basso = testo.lower()
    if len(testo) < 2000:
        return 'la pagina è di soli %d byte: non è la pagina della lega' % len(testo)
    for spia, spiegazione in (
            ('cf-browser-verification', 'Cloudflare chiede una verifica del browser'),
            ('challenge-platform', 'Cloudflare chiede una verifica del browser'),
            ('just a moment', 'Cloudflare chiede una verifica del browser'),
            ('captcha', 'la pagina chiede un captcha'),
            ('access denied', 'accesso negato'),
            ('enable javascript', 'la pagina pretende JavaScript')):
        if spia in basso:
            return '%s (pagina di %d byte)' % (spiegazione, len(testo))
    if variabile.lower() in basso:
        return ('la variabile %s c\'è ma non nella forma attesa (pagina di %d byte): '
                'è cambiato il formato' % (variabile, len(testo)))
    return ('nella pagina non compare mai %s (%d byte): o è cambiato il nome, o quella '
            'servita non è la pagina della lega' % (variabile, len(testo)))


def prendi_understat(stagioni, esiti):
    """Gli xG dicono l'unica cosa che i tiri non dicono già: quanto valevano.
    Un tiro da trenta metri e un tap-in a porta vuota nel conteggio dei tiri
    valgono uno a testa; negli xG valgono 0.02 e 0.7. È informazione nuova, non
    lo stesso numero scritto in un altro modo — ed è per questo che vale la pena
    di prenderla da una pagina HTML invece che da un'API pulita che non esiste."""
    fuori = []
    for i, (_, etichetta) in enumerate(stagioni[:N_STAGIONI_XG]):
        anno = int(etichetta[:4])
        if i:
            time.sleep(2)
        log('· understat %s' % etichetta)
        try:
            testo = scarica(URL_UNDERSTAT % anno, tentativi=2, attesa=5, intestazioni={
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-GB,en;q=0.9,it;q=0.8',
                'Referer': 'https://understat.com/',
                'Upgrade-Insecure-Requests': '1',
            }).decode('utf-8', 'replace')
            righe = _json_da_understat(testo, 'datesData')
            if righe is None:
                raise RuntimeError(_perche_understat_non_va(testo, 'datesData'))
            n = 0
            for m in righe:
                if not m.get('isResult'):
                    continue
                xg = m.get('xG') or {}
                casa = nome((m.get('h') or {}).get('title'))
                via = nome((m.get('a') or {}).get('title'))
                d = data_iso((m.get('datetime') or '')[:10])
                if not (casa and via and d):
                    continue
                xc, xv = num(xg.get('h')), num(xg.get('a'))
                if xc is None or xv is None:
                    continue
                fuori.append({'s': etichetta, 'd': d, 'c': casa, 'v': via,
                              'xgc': round(xc, 3), 'xgv': round(xv, 3)})
                n += 1
            log('  %d partite con xG' % n)
            esiti['Understat %s' % etichetta] = 'ok: %d partite con xG' % n
        except Exception as e:          # noqa: BLE001
            log('  FALLITA: %s' % e)
            esiti['Understat %s' % etichetta] = 'fallita: %s' % e
    return fuori


# ────────────────────────────── ESPN: arbitri, orari, quote ──────────────────────────────

BASE_ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1'


def _americana_a_decimale(v):
    """ESPN dà le quote all'americana: +250 e −140 invece di 3.50 e 1.71."""
    f = num(v)
    if f is None or f == 0:
        return None
    d = 1 + (f / 100.0 if f > 0 else 100.0 / abs(f))
    return round(d, 3) if 1.01 <= d <= 100 else None


def _quote_espn(comp):
    """Il blocco quote di ESPN cambia forma a seconda del fornitore: a volte le
    tre vie sono in cima, a volte dentro homeTeamOdds. Si prova nell'ordine e ci
    si ferma alla prima che dà tre numeri sensati."""
    for o in (comp.get('odds') or []):
        casa = _americana_a_decimale((o.get('homeTeamOdds') or {}).get('moneyLine'))
        via = _americana_a_decimale((o.get('awayTeamOdds') or {}).get('moneyLine'))
        pari = _americana_a_decimale(o.get('drawOdds', {}).get('moneyLine')
                                     if isinstance(o.get('drawOdds'), dict) else o.get('drawOdds'))
        if casa and pari and via:
            return [casa, pari, via]
    return None


def espn_scoreboard(da, a, conteggio):
    url = '%s/scoreboard?dates=%s-%s&limit=300' % (BASE_ESPN, da.replace('-', ''), a.replace('-', ''))
    grezzo = scarica(url, tentativi=2, attesa=4,
                     intestazioni={'Accept': 'application/json',
                                   'Referer': 'https://www.espn.com/soccer/scoreboard'})
    conteggio[0] += 1
    return json.loads(grezzo.decode('utf-8'))


def prendi_espn(stagioni, esiti, conteggio):
    """Orario esatto del calcio d'inizio, stadio e — quando il fornitore le
    espone — le quote. Serve soprattutto per le partite in arrivo: il calendario
    di riserva arriva senza orario e senza quote, e senza quote metà di quello
    che questo modello sa fare resta spento."""
    oggi = datetime.now(timezone.utc).date()
    finestre = [((oggi - timedelta(days=10)).isoformat(), (oggi + timedelta(days=45)).isoformat())]
    partite, futuro = [], []
    for da, a in finestre:
        log('· ESPN %s → %s' % (da, a))
        try:
            d = espn_scoreboard(da, a, conteggio)
        except Exception as e:          # noqa: BLE001
            # ESPN blocca spesso gli indirizzi dei datacenter, e le Action girano
            # su Azure. Non è un guasto: è una fonte in più che oggi non c'è, e
            # tutto quello che dava lo danno anche le altre.
            log('  non disponibile: %s' % e)
            esiti['ESPN calendario'] = 'non disponibile: %s' % e
            return partite, futuro
        for ev in (d.get('events') or []):
            comp = ((ev.get('competitions') or [None])[0]) or {}
            squadre = comp.get('competitors') or []
            casa = via = None
            for c in squadre:
                n = nome((c.get('team') or {}).get('displayName')
                         or (c.get('team') or {}).get('name'))
                if c.get('homeAway') == 'home':
                    casa = n
                elif c.get('homeAway') == 'away':
                    via = n
            iso = (ev.get('date') or '')
            d_ = data_iso(iso[:10])
            if not (casa and via and d_):
                continue
            riga = {'d': d_, 'c': casa, 'v': via, 'espn': ev.get('id')}
            if len(iso) >= 16:
                riga['o'] = iso[11:16]
            sede = ((comp.get('venue') or {}).get('fullName') or '').strip()
            if sede:
                riga['stadio'] = sede
            q = _quote_espn(comp)
            if q:
                riga['q'] = q
            finita = bool(((comp.get('status') or {}).get('type') or {}).get('completed'))
            if finita:
                partite.append(riga)
            else:
                futuro.append(riga)
    esiti['ESPN calendario'] = 'ok: %d in arrivo, %d già giocate (%d con quote)' % (
        len(futuro), len(partite), len([x for x in futuro + partite if x.get('q')]))
    return partite, futuro


def arbitri_da_espn(indice, esiti, conteggio):
    """L'arbitro sta solo nel dettaglio della singola partita: una richiesta a
    testa. Sono troppe per prenderle tutte in un colpo, quindi se ne fa un pezzo
    al giorno partendo dalle più recenti. Fra una decina di giorni l'archivio è
    pieno, e da lì in avanti bastano le partite nuove."""
    senza_arbitro = [p for p in indice.values()
                     if p.get('gc') is not None and not p.get('arb')]
    mancanti = [p for p in senza_arbitro if p.get('espn')]
    mancanti.sort(key=lambda p: p['d'], reverse=True)
    if not mancanti:
        # Distinguere i due casi conta: "non c'è niente da fare" e "non so da
        # dove cominciare" si somigliano solo se non si guarda il numero.
        if senza_arbitro:
            esiti['ESPN arbitri'] = ('%d partite sono senza arbitro, ma nessuna è stata agganciata '
                                     'a ESPN: senza il suo identificativo non posso chiederne il '
                                     'dettaglio' % len(senza_arbitro))
        else:
            esiti['ESPN arbitri'] = 'niente da fare: tutte le partite giocate hanno già un arbitro'
        return 0
    aggiunti = 0
    for p in mancanti[:MAX_ESPN_DETTAGLI]:
        try:
            grezzo = scarica('%s/summary?event=%s' % (BASE_ESPN, p['espn']), tentativi=1, attesa=3)
            conteggio[0] += 1
            d = json.loads(grezzo.decode('utf-8'))
        except Exception:               # noqa: BLE001
            continue
        for u in ((d.get('gameInfo') or {}).get('officials') or []):
            ruolo = ((u.get('position') or {}).get('displayName') or '').lower()
            nomeu = (u.get('displayName') or '').strip()
            if nomeu and ('referee' in ruolo or 'arbitro' in ruolo or not ruolo):
                p['arb'] = nomeu
                aggiunti += 1
                break
        time.sleep(0.4)
    esiti['ESPN arbitri'] = 'ok: %d aggiunti, ne restano %d da riempire' % (
        aggiunti, max(0, len(mancanti) - aggiunti))
    return aggiunti


# ────────────────────────────── football-data.org: arbitri in blocco ──────────────────────────────

def arbitri_da_footballdata(indice, stagioni, esiti):
    """Con il token gratuito, una sola richiesta per stagione restituisce tutte
    le partite con l'arbitro dentro. È la strada buona: quella di ESPN è il
    ripiego per chi il token non ce l'ha."""
    token = os.environ.get('FOOTBALL_DATA_TOKEN', '').strip()
    if not token:
        esiti['football-data.org arbitri'] = 'saltati: nessuna chiave FOOTBALL_DATA_TOKEN'
        return 0
    aggiunti = 0
    for i, (_, etichetta) in enumerate(stagioni[:4]):
        anno = int(etichetta[:4])
        if i:
            time.sleep(7)               # il piano gratuito conta 10 richieste al minuto
        try:
            d = json.loads(scarica(
                'https://api.football-data.org/v4/competitions/SA/matches?season=%d' % anno,
                tentativi=2, attesa=8, intestazioni={'X-Auth-Token': token}).decode('utf-8'))
        except Exception as e:          # noqa: BLE001
            esiti['football-data.org %s' % etichetta] = 'fallita: %s' % e
            continue
        n = 0
        for m in (d.get('matches') or []):
            arb = ''
            for u in (m.get('referees') or []):
                if 'REFEREE' in (u.get('type') or 'REFEREE').upper():
                    arb = (u.get('name') or '').strip()
                    break
            if not arb:
                continue
            casa = nome(((m.get('homeTeam') or {}).get('shortName')
                         or (m.get('homeTeam') or {}).get('name')))
            via = nome(((m.get('awayTeam') or {}).get('shortName')
                        or (m.get('awayTeam') or {}).get('name')))
            data = data_iso((m.get('utcDate') or '')[:10])
            p = trova(indice, data, casa, via)
            if p is not None and not p.get('arb'):
                p['arb'] = arb
                n += 1
        aggiunti += n
        esiti['football-data.org %s' % etichetta] = 'ok: %d arbitri aggiunti' % n
    return aggiunti


# ────────────────────────────── innesto ──────────────────────────────

def trova(indice, data, casa, via, tolleranza=3):
    """La stessa partita, datata in modo diverso da due fonti. Si cerca prima
    esatta, poi nell'intorno: un rinvio o un fuso orario non devono diventare
    una partita in più."""
    if not (data and casa and via):
        return None
    p = indice.get('%s|%s|%s' % (data, casa, via))
    if p is not None:
        return p
    for salto in range(1, tolleranza + 1):
        for segno in (-1, 1):
            try:
                alt = (datetime.strptime(data, '%Y-%m-%d')
                       + timedelta(days=salto * segno)).strftime('%Y-%m-%d')
            except Exception:           # noqa: BLE001
                return None
            p = indice.get('%s|%s|%s' % (alt, casa, via))
            if p is not None:
                return p
    return None


def innesta(indice, righe, campi, solo_se_vuoto=()):
    """Aggiunge campi a partite che esistono già, e SOLO a quelle. Una fonte
    secondaria che non riconosce una partita non deve poterla inventare: una
    riga senza risultato che entra nell'archivio è un buco che poi il modello
    scambia per un dato."""
    tocche, orfane = 0, 0
    for r in righe:
        p = trova(indice, r.get('d'), r.get('c'), r.get('v'))
        if p is None:
            orfane += 1
            continue
        cambiato = False
        for campo in campi:
            v = r.get(campo)
            if v is None:
                continue
            if campo in solo_se_vuoto and p.get(campo) is not None:
                continue
            if p.get(campo) != v:
                p[campo] = v
                cambiato = True
        if cambiato:
            tocche += 1
    return tocche, orfane


def unisci_calendario(base, extra):
    """Il calendario arriva a pezzi: openfootball sa quali partite si giocano,
    football-data.co.uk e ESPN sanno a che ora e a quanto le danno. Si fondono
    sulla stessa sfida, con la solita tolleranza di qualche giorno perché un
    anticipo spostato non deve comparire due volte."""
    fuori = [dict(p) for p in (base or [])]
    per_sfida = {}
    for p in fuori:
        per_sfida.setdefault((p.get('c'), p.get('v')), []).append(p)
    for p in (extra or []):
        candidate = per_sfida.get((p.get('c'), p.get('v')), [])
        bersaglio = None
        for altra in candidate:
            if giorni_tra(altra.get('d', ''), p.get('d', '')) <= 4:
                bersaglio = altra
                break
        if bersaglio is None:
            nuova = dict(p)
            fuori.append(nuova)
            per_sfida.setdefault((p.get('c'), p.get('v')), []).append(nuova)
            continue
        for campo, valore in p.items():
            if valore is not None:
                bersaglio[campo] = valore
    return fuori


# ────────────────────────────── unione e controlli ──────────────────────────────

def carica_esistente():
    try:
        with open(FILE_DATI, encoding='utf-8') as f:
            return json.load(f)
    except Exception:                 # noqa: BLE001
        return None


def giorni_tra(a, b):
    try:
        return abs((datetime.strptime(a, '%Y-%m-%d') - datetime.strptime(b, '%Y-%m-%d')).days)
    except Exception:                 # noqa: BLE001
        return 999


def unisci(vecchie, nuove):
    """Il nuovo vince, ma solo dove ha qualcosa da dire: un campo assente non
    cancella quello che c'era. Così l'arbitro trovato ieri resta anche se oggi
    la fonte principale non l'ha dato.

    Il punto delicato è che due fonti diverse datano la stessa partita in modo
    diverso — un rinvio, un fuso orario, una partita di sabato sera segnata alla
    domenica. Senza accorgersene si finisce con la stessa partita due volte, e un
    modello che conta due volte gli stessi gol è peggio di un modello con meno dati.
    Quindi: stessa squadra di casa, stessa squadra ospite, meno di quattro giorni
    di distanza = è la stessa partita, e vince la data della fonte nuova."""
    indice, per_sfida = {}, {}

    def registra(p, k):
        indice[k] = p
        per_sfida.setdefault((p.get('c'), p.get('v')), set()).add(k)

    for p in (vecchie or []):
        registra(dict(p), chiave(p))

    for p in nuove:
        k = chiave(p)
        esistente = indice.get(k)
        vecchia_chiave = k
        if esistente is None:
            for k2 in list(per_sfida.get((p.get('c'), p.get('v')), ())):
                altra = indice.get(k2)
                if not altra:
                    continue
                stessa_stagione = (not altra.get('s') or not p.get('s') or altra['s'] == p['s'])
                if stessa_stagione and giorni_tra(altra.get('d', ''), p.get('d', '')) <= 3:
                    esistente, vecchia_chiave = altra, k2
                    break
        if esistente is None:
            registra(dict(p), k)
            continue
        for campo, valore in p.items():
            if valore is not None:
                esistente[campo] = valore
        if vecchia_chiave != k:       # la data è cambiata: si sposta sotto la chiave nuova
            indice.pop(vecchia_chiave, None)
            per_sfida[(p.get('c'), p.get('v'))].discard(vecchia_chiave)
            registra(esistente, k)
    return indice


def controlla(partite):
    problemi = []
    giocate = [p for p in partite if p.get('gc') is not None]
    if len(giocate) < 300:
        problemi.append('solo %d partite con risultato' % len(giocate))
    squadre = {p['c'] for p in giocate} | {p['v'] for p in giocate}
    if len(squadre) < 20:
        problemi.append('solo %d squadre distinte' % len(squadre))
    if [p for p in giocate if not (0 <= p['gc'] <= 15 and 0 <= p['gv'] <= 15)]:
        problemi.append('punteggi fuori scala')
    return problemi


ETICHETTE = {'aggiornato': 'Aggiornato', 'esito': 'Esito', 'ultima_partita': 'Ultima partita',
             'partite_totali': 'Partite totali', 'partite_giocate': 'Partite giocate',
             'partite_in_arrivo': 'Partite in arrivo', 'con_arbitro': 'Con arbitro',
             'con_tiri': 'Con tiri', 'con_xg': 'Con xG veri', 'con_quote': 'Con quote',
             'in_arrivo_con_quote': 'In arrivo con quote',
             'in_arrivo_con_orario': 'In arrivo con orario', 'giocatori': 'Marcatori',
             'stagioni': 'Stagioni', 'dettaglio': 'Dettaglio per fonte', 'problemi': 'Problemi',
             'nota': 'Nota', 'nuove_oggi': 'Partite nuove oggi'}


def riepilogo(meta):
    percorso = os.environ.get('GITHUB_STEP_SUMMARY')
    if not percorso:
        return
    try:
        righe = ['### Aggiornamento dati Serie A', '', '| campo | valore |', '|---|---|']
        for k, v in meta.items():
            if k == 'dettaglio':
                continue
            if isinstance(v, list):
                v = ', '.join(str(x) for x in v) or '—'
            righe.append('| %s | %s |' % (ETICHETTE.get(k, k), v))
        det = meta.get('dettaglio') or {}
        if det:
            righe += ['', '#### Cosa ha risposto ogni fonte', '', '| fonte | esito |', '|---|---|']
            righe += ['| %s | %s |' % (k, v) for k, v in det.items()]
        with open(percorso, 'a', encoding='utf-8') as f:
            f.write('\n'.join(righe) + '\n')
    except Exception as e:            # noqa: BLE001
        log('riepilogo non scritto: %s' % e)


def scrivi_meta(meta):
    os.makedirs(DATA, exist_ok=True)
    with open(FILE_META, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    riepilogo(meta)


def main():
    os.makedirs(DATA, exist_ok=True)
    stagioni = stagioni_da_prendere()
    # Due modi di girare, per una ragione precisa. Le quote delle partite in
    # arrivo si muovono durante la giornata, e adesso il modello ci si ancora
    # sopra: una fotografia scattata una volta al giorno all'alba è già vecchia
    # al fischio d'inizio. Ma ricaricare sei stagioni di archivio e sei pagine
    # di xG ogni tre ore sarebbe maleducato verso fonti che ci lasciano entrare
    # gratis, e inutile: l'archivio cambia solo quando si gioca.
    #   completo → tutto, una volta al giorno
    #   leggero  → solo calendario, quote e arbitri, ogni poche ore
    leggero = os.environ.get('MODO', '').strip().lower() == 'leggero'
    log('Modo: %s' % ('leggero (solo calendario, quote e arbitri)' if leggero else 'completo'))
    log('Stagioni cercate: %s' % ', '.join(e for _, e in stagioni))
    esiti = {}
    esiti['modo'] = 'leggero' if leggero else 'completo'

    if leggero:
        nuove, esiti_fd = [], {}
    else:
        nuove, esiti_fd = prendi_football_data(stagioni)
    esiti.update(esiti_fd)

    # riserva stagione per stagione: meglio i soli risultati che il vuoto
    prese = {p['s'] for p in nuove}
    if leggero:
        prese = {e for _, e in stagioni[1:]}      # solo la stagione in corso
    calendario_riserva = []
    for codice, etichetta in stagioni:
        if etichetta in prese:
            continue
        log('· riserva openfootball %s' % etichetta)
        try:
            giocate, future = prendi_openfootball(etichetta)
            if giocate or future:
                nuove.extend(giocate)
                calendario_riserva.extend(future)
                esiti['riserva %s' % etichetta] = 'ok: %d giocate, %d in calendario (senza tiri né arbitri)' % (
                    len(giocate), len(future))
            else:
                esiti['riserva %s' % etichetta] = 'nessuna partita'
        except Exception as e:        # noqa: BLE001
            esiti['riserva %s' % etichetta] = 'fallita: %s' % e

    # Due calendari, e servono tutti e due. openfootball sa QUALI partite si
    # giocano fino a maggio; football-data.co.uk sa a che ora e a quanto le
    # danno, ma solo per la settimana in arrivo. Prendere solo il secondo perché
    # ha risposto — che è quello che succedeva finché il primo era l'unico a
    # funzionare — vuol dire passare da trecentosettanta partite a dieci.
    ravvicinato = prendi_calendario(stagioni, esiti)
    stagionale = list(calendario_riserva)
    if not stagionale:
        try:
            _, future = prendi_openfootball(stagioni[0][1])
            stagionale = future
            esiti['calendario stagione'] = 'ok da openfootball: %d partite' % len(future)
        except Exception as e:        # noqa: BLE001
            esiti['calendario stagione'] = 'fallito: %s' % e
    # base = la stagione intera, sopra = orari e quote di chi ce li ha
    calendario = unisci_calendario(stagionale, ravvicinato)
    esiti['calendario'] = '%d partite in tutto, %d con le quote' % (
        len(calendario), len([p for p in calendario if p.get('q')]))

    vecchio = carica_esistente()
    prima = len((vecchio or {}).get('partite') or [])
    indice = unisci((vecchio or {}).get('partite'), nuove)

    # xG veri: l'unica statistica pubblica che aggiunge informazione ai tiri
    xg = [] if leggero else prendi_understat(stagioni, esiti)
    tocche, orfane = innesta(indice, xg, ('xgc', 'xgv'))
    if xg:
        esiti['Understat innesto'] = '%d partite aggiornate, %d non riconosciute' % (tocche, orfane)
        log('· Understat: xG su %d partite (%d non riconosciute)' % (tocche, orfane))

    # ESPN: orario, stadio, identificativo per il dettaglio, e quote quando ci sono
    conteggio_espn = [0]
    espn_giocate, espn_future = prendi_espn(stagioni, esiti, conteggio_espn)
    if espn_giocate:
        t2, _ = innesta(indice, espn_giocate, ('espn', 'stadio', 'o', 'q'), solo_se_vuoto=('o', 'q'))
        log('· ESPN: %d partite giocate agganciate' % t2)

    # arbitri: prima la strada buona (una richiesta per stagione), poi il ripiego
    agg_arb_fd = 0 if leggero else arbitri_da_footballdata(indice, stagioni, esiti)
    agg_arb_espn = arbitri_da_espn(indice, esiti, conteggio_espn)
    if agg_arb_fd or agg_arb_espn:
        log('· arbitri: %d da football-data.org, %d da ESPN' % (agg_arb_fd, agg_arb_espn))

    agg_arb, agg_stat = (0, 0) if leggero else arricchisci(indice, stagioni, esiti)
    if agg_arb or agg_stat:
        log('· API-Football: %d arbitri e %d partite di statistiche aggiunti' % (agg_arb, agg_stat))
    agg_arb += agg_arb_fd + agg_arb_espn

    partite = sorted(indice.values(), key=lambda p: (p['d'], p.get('c', '')))
    problemi = controlla(partite)
    adesso = datetime.now(timezone.utc).isoformat(timespec='seconds')

    if problemi:
        log('DATI RIFIUTATI: %s' % '; '.join(problemi))
        scrivi_meta({'aggiornato': adesso, 'esito': 'rifiutato', 'problemi': problemi,
                     'dettaglio': esiti,
                     'nota': 'I dati precedenti sono stati lasciati come erano.'})
        return 1

    giocate = [p for p in partite if p.get('gc') is not None]
    if espn_future:
        calendario = unisci_calendario(calendario, espn_future)
    calendario = sorted([p for p in calendario if p.get('c') and p.get('v')],
                        key=lambda p: (p['d'], p.get('c', '')))
    giocatori = prendi_giocatori(esiti)

    doc = {'lega': 'Serie A', 'aggiornato': adesso,
           'fonte': ' + '.join(['football-data.co.uk', 'openfootball']
                               + (['understat'] if xg else [])
                               + (['ESPN'] if (espn_giocate or espn_future) else [])
                               + (['API-Football'] if agg_stat else [])),
           'stagioni': sorted({p['s'] for p in partite if p.get('s')}),
           'partite': partite, 'calendario': calendario}
    if giocatori:
        doc['giocatori'] = giocatori
    with open(FILE_DATI, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))

    scrivi_meta({
        'aggiornato': adesso, 'esito': 'ok',
        'ultima_partita': giocate[-1]['d'] if giocate else '—',
        'partite_totali': len(partite), 'partite_giocate': len(giocate),
        'nuove_oggi': max(0, len(partite) - prima),
        'partite_in_arrivo': len(calendario),
        'con_arbitro': len([p for p in giocate if p.get('arb')]),
        'con_tiri': len([p for p in giocate if p.get('tpc') is not None]),
        'con_xg': len([p for p in giocate if p.get('xgc') is not None]),
        'con_quote': len([p for p in giocate if p.get('q')]),
        'in_arrivo_con_quote': len([p for p in calendario if p.get('q')]),
        'in_arrivo_con_orario': len([p for p in calendario if p.get('o')]),
        'giocatori': len((giocatori or {}).get('lista', [])),
        'stagioni': doc['stagioni'], 'dettaglio': esiti,
    })
    log('Scritte %d partite (%d giocate, ultima il %s), %d in calendario, %.0f KB'
        % (len(partite), len(giocate), giocate[-1]['d'] if giocate else '—',
           len(calendario), os.path.getsize(FILE_DATI) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
