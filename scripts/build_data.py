#!/usr/bin/env python3
"""
Scarica e normalizza i dati della Serie A.

Gira dentro GitHub Actions (nessuna dipendenza fuori dalla libreria standard).
Fonte principale: football-data.co.uk — risultati, tiri, falli, cartellini,
ARBITRO e quote di chiusura per ogni partita.
Fonte di riserva: openfootball/football.json — solo risultati, ma non chiede nulla
a nessuno e non cade mai.

Se tutto fallisce NON cancella i dati esistenti: scrive l'errore in data/meta.json
e lascia in piedi l'ultimo file buono.
"""

import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(QUI, 'data')

# Stagioni da tenere: il codice è AAAA della stagione (2425 = 2024/25).
# Sei stagioni bastano: più indietro si va, meno le squadre di allora
# somigliano a quelle di oggi.
N_STAGIONI = 6
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/126.0 Safari/537.36')

# football-data.co.uk: colonne che ci interessano davvero
COLONNE_BASE = ['Div', 'Date', 'Time', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'FTR',
                'HTHG', 'HTAG', 'Referee', 'HS', 'AS', 'HST', 'AST',
                'HF', 'AF', 'HC', 'AC', 'HY', 'AY', 'HR', 'AR']
# quote medie di mercato (chiusura) — servono solo come metro di paragone
COLONNE_QUOTE = ['AvgH', 'AvgD', 'AvgA', 'Avg>2.5', 'Avg<2.5',
                 'B365H', 'B365D', 'B365A', 'PSH', 'PSD', 'PSA',
                 'BbAvH', 'BbAvD', 'BbAvA']


def log(*a):
    print(*a, flush=True)


def scarica(url, tentativi=3, attesa=4):
    ultimo = None
    for i in range(tentativi):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': UA,
                'Accept': '*/*',
                'Accept-Language': 'it,en;q=0.8',
            })
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except Exception as e:            # noqa: BLE001 — qualunque cosa vada storta, riprova
            ultimo = e
            log('  tentativo %d fallito: %s' % (i + 1, e))
            time.sleep(attesa * (i + 1))
    raise RuntimeError('download fallito: %s (%s)' % (url, ultimo))


def stagioni_da_prendere(oggi=None):
    """La stagione europea parte a luglio: prima di luglio siamo ancora in quella
    cominciata l'anno prima."""
    oggi = oggi or datetime.now(timezone.utc)
    inizio = oggi.year if oggi.month >= 7 else oggi.year - 1
    out = []
    for k in range(N_STAGIONI):
        a = inizio - k
        out.append(('%02d%02d' % (a % 100, (a + 1) % 100), '%d-%02d' % (a, (a + 1) % 100)))
    return list(reversed(out))


def num(v):
    if v is None:
        return None
    v = str(v).strip()
    if v == '' or v.upper() == 'NA':
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    if f != f:                      # NaN
        return None
    return f


def intero(v):
    f = num(v)
    return None if f is None else int(round(f))


def data_iso(v, ora=None):
    """football-data.co.uk usa gg/mm/aa e gg/mm/aaaa a seconda dell'annata."""
    v = (v or '').strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', v)
    if not m:
        return None
    g, mm, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if a < 100:
        a += 2000 if a < 70 else 1900
    try:
        d = datetime(a, mm, g)
    except ValueError:
        return None
    return d.strftime('%Y-%m-%d')


def normalizza_nome(n):
    """I nomi cambiano di poco fra le fonti: li riportiamo a una forma sola."""
    n = (n or '').strip()
    alias = {
        'Internazionale': 'Inter', 'FC Internazionale Milano': 'Inter', 'Inter Milan': 'Inter',
        'AC Milan': 'Milan', 'Juventus FC': 'Juventus', 'AS Roma': 'Roma',
        'SS Lazio': 'Lazio', 'SSC Napoli': 'Napoli', 'Atalanta BC': 'Atalanta',
        'ACF Fiorentina': 'Fiorentina', 'Bologna FC 1909': 'Bologna',
        'Torino FC': 'Torino', 'Udinese Calcio': 'Udinese', 'Genoa CFC': 'Genoa',
        'UC Sampdoria': 'Sampdoria', 'US Sassuolo Calcio': 'Sassuolo',
        'Hellas Verona FC': 'Verona', 'Hellas Verona': 'Verona',
        'Empoli FC': 'Empoli', 'US Lecce': 'Lecce', 'US Salernitana 1919': 'Salernitana',
        'Cagliari Calcio': 'Cagliari', 'Frosinone Calcio': 'Frosinone',
        'AC Monza': 'Monza', 'Venezia FC': 'Venezia', 'Parma Calcio 1913': 'Parma',
        'Como 1907': 'Como', 'Spezia Calcio': 'Spezia', 'Benevento Calcio': 'Benevento',
        'US Cremonese': 'Cremonese', 'SPAL': 'Spal', 'Brescia Calcio': 'Brescia',
        'Pisa SC': 'Pisa', 'AC Pisa 1909': 'Pisa',
    }
    return alias.get(n, n)


def leggi_csv_football_data(testo, stagione):
    """Il CSV ha righe vuote in coda e colonne che cambiano di anno in anno:
    si prende quello che c'è, senza dare per scontato niente."""
    testo = testo.replace('\r\n', '\n')
    righe = list(csv.DictReader(io.StringIO(testo)))
    fuori = []
    for r in righe:
        if (r.get('Div') or '').strip() != 'I1':
            continue
        casa = normalizza_nome(r.get('HomeTeam'))
        via = normalizza_nome(r.get('AwayTeam'))
        d = data_iso(r.get('Date'))
        if not casa or not via or not d:
            continue
        gc, gv = intero(r.get('FTHG')), intero(r.get('FTAG'))
        m = {
            's': stagione, 'd': d, 'o': (r.get('Time') or '').strip() or None,
            'c': casa, 'v': via,
            'gc': gc, 'gv': gv,
            'ptc': intero(r.get('HTHG')), 'ptv': intero(r.get('HTAG')),
            'arb': (r.get('Referee') or '').strip() or None,
            'tc': intero(r.get('HS')), 'tv': intero(r.get('AS')),
            'tpc': intero(r.get('HST')), 'tpv': intero(r.get('AST')),
            'fc': intero(r.get('HF')), 'fv': intero(r.get('AF')),
            'ac': intero(r.get('HC')), 'av': intero(r.get('AC')),
            'gic': intero(r.get('HY')), 'giv': intero(r.get('AY')),
            'rc': intero(r.get('HR')), 'rv': intero(r.get('AR')),
        }
        # quote: prima la media di mercato, poi i singoli operatori
        q = None
        for h, dd, a in (('AvgH', 'AvgD', 'AvgA'), ('BbAvH', 'BbAvD', 'BbAvA'),
                         ('PSH', 'PSD', 'PSA'), ('B365H', 'B365D', 'B365A')):
            qh, qd, qa = num(r.get(h)), num(r.get(dd)), num(r.get(a))
            if qh and qd and qa and qh > 1 and qd > 1 and qa > 1:
                q = [round(qh, 3), round(qd, 3), round(qa, 3)]
                break
        if q:
            m['q'] = q
        qo, qu = num(r.get('Avg>2.5')), num(r.get('Avg<2.5'))
        if qo and qu and qo > 1 and qu > 1:
            m['qou'] = [round(qo, 3), round(qu, 3)]
        m = {k: v for k, v in m.items() if v is not None}
        fuori.append(m)
    return fuori


def prendi_football_data(stagioni):
    partite, errori = [], []
    for codice, etichetta in stagioni:
        url = 'https://www.football-data.co.uk/mmz4281/%s/I1.csv' % codice
        log('· football-data.co.uk %s' % etichetta)
        try:
            grezzo = scarica(url)
            testo = grezzo.decode('utf-8', errors='replace')
            p = leggi_csv_football_data(testo, etichetta)
            log('  %d partite' % len(p))
            partite.extend(p)
        except Exception as e:        # noqa: BLE001
            errori.append('%s: %s' % (etichetta, e))
            log('  saltata: %s' % e)
    return partite, errori


def prendi_openfootball(stagioni):
    """Riserva: solo risultati e calendario, ma non chiede permesso a nessuno."""
    partite, errori = [], []
    for _, etichetta in stagioni:
        anno = etichetta if len(etichetta) == 7 else etichetta
        url = ('https://raw.githubusercontent.com/openfootball/football.json/'
               'master/%s/it.1.json' % anno)
        try:
            d = json.loads(scarica(url, tentativi=2).decode('utf-8'))
            for m in d.get('matches', []):
                sc = (m.get('score') or {}).get('ft')
                partite.append({
                    's': etichetta, 'd': m.get('date'),
                    'c': normalizza_nome(m.get('team1')), 'v': normalizza_nome(m.get('team2')),
                    'gc': sc[0] if sc else None, 'gv': sc[1] if sc else None,
                    'giornata': m.get('round'),
                })
        except Exception as e:        # noqa: BLE001
            errori.append('openfootball %s: %s' % (etichetta, e))
    return [{k: v for k, v in p.items() if v is not None} for p in partite], errori


def prendi_calendario(stagioni):
    """Partite ancora da giocare. fixtures.csv copre i prossimi giorni di tutte le
    leghe; openfootball ha invece il calendario completo della stagione."""
    fut, errori = [], []
    try:
        testo = scarica('https://www.football-data.co.uk/fixtures.csv').decode('utf-8', 'replace')
        for r in csv.DictReader(io.StringIO(testo)):
            if (r.get('Div') or '').strip() != 'I1':
                continue
            d = data_iso(r.get('Date'))
            if not d:
                continue
            m = {'d': d, 'o': (r.get('Time') or '').strip() or None,
                 'c': normalizza_nome(r.get('HomeTeam')), 'v': normalizza_nome(r.get('AwayTeam'))}
            q = [num(r.get('AvgH')), num(r.get('AvgD')), num(r.get('AvgA'))]
            if all(q):
                m['q'] = [round(x, 3) for x in q]
            fut.append({k: v for k, v in m.items() if v is not None})
        log('· calendario: %d partite in arrivo' % len(fut))
    except Exception as e:            # noqa: BLE001
        errori.append('fixtures: %s' % e)
        log('· calendario non disponibile: %s' % e)
    if not fut:
        p, e2 = prendi_openfootball(stagioni[-1:])
        errori.extend(e2)
        fut = [{'d': x['d'], 'c': x['c'], 'v': x['v'], 'giornata': x.get('giornata')}
               for x in p if x.get('gc') is None]
        if fut:
            log('· calendario da openfootball: %d partite' % len(fut))
    return fut, errori


def prendi_giocatori():
    """Facoltativo: marcatori e assist della stagione in corso.
    Serve una chiave gratuita di football-data.org nel segreto FOOTBALL_DATA_TOKEN.
    Senza chiave si salta, e l'app lo dice."""
    token = os.environ.get('FOOTBALL_DATA_TOKEN', '').strip()
    if not token:
        return None, 'nessuna chiave: modulo giocatori non attivo'
    try:
        req = urllib.request.Request(
            'https://api.football-data.org/v4/competitions/SA/scorers?limit=100',
            headers={'X-Auth-Token': token, 'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=40) as r:
            d = json.loads(r.read().decode('utf-8'))
        gio = []
        for s in d.get('scorers', []):
            p, sq = s.get('player') or {}, s.get('team') or {}
            gio.append({
                'nome': p.get('name'), 'ruolo': p.get('position'),
                'squadra': normalizza_nome(sq.get('shortName') or sq.get('name')),
                'gol': s.get('goals') or 0, 'assist': s.get('assists') or 0,
                'rigori': s.get('penalties') or 0,
                'partite': s.get('playedMatches') or 0,
            })
        log('· giocatori: %d' % len(gio))
        return {'stagione': (d.get('season') or {}).get('startDate', '')[:4], 'lista': gio}, None
    except Exception as e:            # noqa: BLE001
        return None, 'giocatori non scaricati: %s' % e


def controlla(partite):
    """Meglio accorgersene qui che dentro l'app."""
    problemi = []
    giocate = [p for p in partite if p.get('gc') is not None]
    if len(giocate) < 200:
        problemi.append('solo %d partite con risultato: troppe poche' % len(giocate))
    squadre = {p['c'] for p in giocate} | {p['v'] for p in giocate}
    if len(squadre) < 20:
        problemi.append('solo %d squadre distinte' % len(squadre))
    strane = [p for p in giocate if not (0 <= p['gc'] <= 15 and 0 <= p['gv'] <= 15)]
    if strane:
        problemi.append('%d punteggi fuori scala' % len(strane))
    senza_data = [p for p in partite if not re.match(r'^\d{4}-\d{2}-\d{2}$', p.get('d', ''))]
    if senza_data:
        problemi.append('%d partite senza data valida' % len(senza_data))
    return problemi


ETICHETTE = {
    'aggiornato': 'Aggiornato', 'esito': 'Esito', 'fonte': 'Fonte',
    'partite_totali': 'Partite totali', 'partite_giocate': 'Partite giocate',
    'partite_in_arrivo': 'Partite in arrivo', 'con_arbitro': 'Con arbitro',
    'con_tiri': 'Con tiri', 'con_quote': 'Con quote', 'giocatori': 'Giocatori',
    'stagioni': 'Stagioni', 'errori': 'Avvisi', 'problemi': 'Problemi', 'nota': 'Nota',
}


def riepilogo(meta):
    """Scrive la tabella di stato nel riepilogo della GitHub Action, se siamo
    dentro una Action. Fuori non fa niente."""
    percorso = os.environ.get('GITHUB_STEP_SUMMARY')
    if not percorso:
        return
    try:
        righe = ['### Aggiornamento dati Serie A', '', '| campo | valore |', '|---|---|']
        for k, v in meta.items():
            if isinstance(v, list):
                v = ', '.join(str(x) for x in v) or '—'
            righe.append('| %s | %s |' % (ETICHETTE.get(k, k), v))
        with open(percorso, 'a', encoding='utf-8') as f:
            f.write('\n'.join(righe) + '\n')
    except Exception as e:            # noqa: BLE001 — il riepilogo non deve mai far fallire il lavoro
        log('riepilogo non scritto: %s' % e)


def main():
    os.makedirs(DATA, exist_ok=True)
    stagioni = stagioni_da_prendere()
    log('Stagioni: %s' % ', '.join(e for _, e in stagioni))

    partite, errori = prendi_football_data(stagioni)
    fonte = 'football-data.co.uk'
    if len([p for p in partite if p.get('gc') is not None]) < 200:
        log('Fonte principale insufficiente: passo alla riserva')
        p2, e2 = prendi_openfootball(stagioni)
        errori.extend(e2)
        if len(p2) > len(partite):
            partite, fonte = p2, 'openfootball (riserva: niente arbitri né tiri)'

    calendario, e3 = prendi_calendario(stagioni)
    errori.extend(e3)
    giocatori, e4 = prendi_giocatori()
    if e4:
        errori.append(e4)

    problemi = controlla(partite)
    percorso = os.path.join(DATA, 'serie-a.json')

    if problemi:
        log('DATI RIFIUTATI: %s' % '; '.join(problemi))
        meta = {
            'aggiornato': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'esito': 'rifiutato', 'problemi': problemi, 'errori': errori,
            'nota': 'I dati precedenti sono stati lasciati come erano.',
        }
        with open(os.path.join(DATA, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        riepilogo(meta)
        return 1

    partite.sort(key=lambda p: (p['d'], p.get('c', '')))
    calendario.sort(key=lambda p: (p['d'], p.get('c', '')))
    giocate = [p for p in partite if p.get('gc') is not None]

    doc = {
        'lega': 'Serie A',
        'fonte': fonte,
        'aggiornato': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'stagioni': sorted({p['s'] for p in partite if p.get('s')}),
        'partite': partite,
        'calendario': calendario,
    }
    if giocatori:
        doc['giocatori'] = giocatori

    with open(percorso, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))

    meta = {
        'aggiornato': doc['aggiornato'], 'esito': 'ok', 'fonte': fonte,
        'partite_totali': len(partite), 'partite_giocate': len(giocate),
        'partite_in_arrivo': len(calendario),
        'con_arbitro': len([p for p in giocate if p.get('arb')]),
        'con_tiri': len([p for p in giocate if p.get('tpc') is not None]),
        'con_quote': len([p for p in giocate if p.get('q')]),
        'giocatori': len((giocatori or {}).get('lista', [])),
        'stagioni': doc['stagioni'],
        'errori': errori,
    }
    with open(os.path.join(DATA, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    riepilogo(meta)

    log('Scritte %d partite (%d giocate), %d in arrivo, %.0f KB'
        % (len(partite), len(giocate), len(calendario), os.path.getsize(percorso) / 1024))
    if errori:
        log('Avvisi: %s' % '; '.join(errori))
    return 0


if __name__ == '__main__':
    sys.exit(main())
