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


def pare_csv_seriea(dati):
    """None se va bene, altrimenti il motivo del rifiuto."""
    if not dati or len(dati) < 400:
        return 'solo %d byte' % len(dati or b'')
    # utf-8-sig toglie il BOM: certe stagioni ce l'hanno, altre no, ed è invisibile
    testa = dati[:3000].decode('utf-8-sig', errors='replace').lstrip('\ufeff').lstrip()
    if testa[:1] == '<' or '<html' in testa[:400].lower():
        return 'è una pagina HTML, non un CSV'
    prima = testa.split('\n', 1)[0]
    if not prima.startswith('Div'):
        return "l'intestazione non comincia con Div: %r" % prima[:60]
    if 'I1' not in testa:
        return 'nessuna riga di Serie A nelle prime righe'
    return None


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
        for a, b, c in (('AvgH', 'AvgD', 'AvgA'), ('BbAvH', 'BbAvD', 'BbAvA'),
                        ('PSCH', 'PSCD', 'PSCA'), ('PSH', 'PSD', 'PSA'),
                        ('B365H', 'B365D', 'B365A')):
            q = [num(r.get(a)), num(r.get(b)), num(r.get(c))]
            if all(q) and min(q) > 1:
                m['q'] = [round(x, 3) for x in q]
                break
        qo, qu = num(r.get('Avg>2.5')), num(r.get('Avg<2.5'))
        if qo and qu and min(qo, qu) > 1:
            m['qou'] = [round(qo, 3), round(qu, 3)]
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
                        tentativi=2, controllo=pare_csv_seriea).decode('utf-8-sig', 'replace')
        for r in csv.DictReader(io.StringIO(testo)):
            if (r.get('Div') or '').strip() != 'I1':
                continue
            d = data_iso(r.get('Date'))
            if not d:
                continue
            m = {'d': d, 'o': (r.get('Time') or '').strip() or None,
                 'c': nome(r.get('HomeTeam')), 'v': nome(r.get('AwayTeam'))}
            q = [num(r.get('AvgH')), num(r.get('AvgD')), num(r.get('AvgA'))]
            if all(q):
                m['q'] = [round(x, 3) for x in q]
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
    for codice, etichetta in stagioni[:3]:
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
             'con_tiri': 'Con tiri', 'con_quote': 'Con quote', 'giocatori': 'Marcatori',
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
    log('Stagioni cercate: %s' % ', '.join(e for _, e in stagioni))
    esiti = {}

    nuove, esiti_fd = prendi_football_data(stagioni)
    esiti.update(esiti_fd)

    # riserva stagione per stagione: meglio i soli risultati che il vuoto
    prese = {p['s'] for p in nuove}
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

    calendario = prendi_calendario(stagioni, esiti)
    if calendario_riserva:
        visti = {chiave(p) for p in calendario}
        calendario.extend([p for p in calendario_riserva if chiave(p) not in visti])
    if not calendario:
        try:
            _, future = prendi_openfootball(stagioni[0][1])
            calendario = future
            esiti['calendario stagione'] = 'ok da openfootball: %d partite' % len(future)
        except Exception as e:        # noqa: BLE001
            esiti['calendario stagione'] = 'fallito: %s' % e

    vecchio = carica_esistente()
    prima = len((vecchio or {}).get('partite') or [])
    indice = unisci((vecchio or {}).get('partite'), nuove)

    agg_arb, agg_stat = arricchisci(indice, stagioni, esiti)
    if agg_arb or agg_stat:
        log('· API-Football: %d arbitri e %d partite di statistiche aggiunti' % (agg_arb, agg_stat))

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
    calendario = sorted([p for p in calendario if p.get('c') and p.get('v')],
                        key=lambda p: (p['d'], p.get('c', '')))
    giocatori = prendi_giocatori(esiti)

    doc = {'lega': 'Serie A', 'aggiornato': adesso,
           'fonte': 'football-data.co.uk + openfootball' + (' + API-Football' if agg_arb or agg_stat else ''),
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
        'con_quote': len([p for p in giocate if p.get('q')]),
        'giocatori': len((giocatori or {}).get('lista', [])),
        'stagioni': doc['stagioni'], 'dettaglio': esiti,
    })
    log('Scritte %d partite (%d giocate, ultima il %s), %d in calendario, %.0f KB'
        % (len(partite), len(giocate), giocate[-1]['d'] if giocate else '—',
           len(calendario), os.path.getsize(FILE_DATI) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
