"""Cosa c'e' davvero dentro fixtures.csv, e perche' il calendario resta vuoto.

Il file con le quote delle partite in arrivo e' l'UNICA fonte di ancoraggio per
le partite su cui si scommette. Quando torna vuoto, l'app gira col modello
nudo — che e' la sua versione peggiore — e finora non lo diceva a nessuno.

Questo non e' un test: e' una sonda. Scarica, guarda e racconta. Gira solo a
mano, dalla Action, perche' da qui serve la rete.

    python3 scripts/_sonda_calendario.py
"""
import collections
import csv
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as B          # noqa: E402


def riga(t=''):
    print(t, flush=True)


def main():
    esiti = {}
    riga('== fixtures.csv ==')
    try:
        grezzo = B.scarica_football_data('fixtures.csv', esiti,
                                         controllo=B.pare_csv_calendario)
    except Exception as e:                       # noqa: BLE001
        riga('NON SCARICATO: %s' % e)
        riga('indirizzo provato: %s' % esiti.get('football-data indirizzo', '?'))
        return
    testo = grezzo.decode('utf-8-sig', 'replace')
    riga('scaricato da %s' % esiti.get('football-data indirizzo', '(prima porta)'))
    riga('byte: %d' % len(grezzo))

    lettore = csv.DictReader(io.StringIO(testo))
    colonne = lettore.fieldnames or []
    righe = list(lettore)
    riga('righe: %d' % len(righe))
    riga('colonne (%d): %s' % (len(colonne), ', '.join(colonne[:40])))
    riga()

    leghe = collections.Counter((r.get('Div') or '').strip() for r in righe)
    riga('campionati presenti: %s' % ', '.join(
        '%s=%d' % (k or '(vuoto)', v) for k, v in leghe.most_common(20)))
    riga()

    i1 = [r for r in righe if (r.get('Div') or '').strip() == 'I1']
    riga('righe Serie A (I1): %d' % len(i1))
    if not i1:
        riga()
        riga('Serie A NON C\'E\' in questo file. Le date presenti sono:')
        date = collections.Counter((r.get('Date') or '').strip() for r in righe)
        for d, n in sorted(date.items())[:12]:
            riga('  %s  %d partite' % (d, n))
        return

    riga()
    quote = {'q': 0, 'qou': 0, 'qex': 0, 'qmax': 0, 'qb365': 0, 'qap': 0, 'qah': 0}
    for r in i1[:40]:
        m = {}
        m.update(B.quote_da_riga(r))
        m.update(B.quote_extra_da_riga(r))
        for k in quote:
            if m.get(k):
                quote[k] += 1
    riga('sulle prime %d partite di Serie A, quante portano quali quote:' % min(40, len(i1)))
    for k, v in quote.items():
        riga('  %-7s %d' % (k, v))
    riga()
    riga('prime tre righe, per esteso:')
    for r in i1[:3]:
        piene = {k: v for k, v in r.items() if (v or '').strip()}
        riga('  %s' % piene)


def sonda_api_football():
    """C'e' una SECONDA fonte possibile per le quote delle partite in arrivo?

    fixtures.csv di football-data e' l'unica che l'app usa, e la sonda qui sopra
    ha mostrato che copre una finestra di due o tre giorni e che la Serie A
    spesso non c'e'. Un punto singolo di rottura sull'input piu' importante.

    API-Football ha un endpoint /odds e la chiave e' gia' nei segreti (la si usa
    per arbitri e statistiche). Prima di costruirci sopra si chiede: risponde?
    Con quante partite? Con quali banchi? Quanto costa di quota?
    """
    import json as _json
    chiave = os.environ.get('APIFOOTBALL_KEY', '').strip()
    riga()
    riga('== API-Football /odds ==')
    if not chiave:
        riga("nessuna chiave APIFOOTBALL_KEY: non si puo' sapere")
        return
    conteggio = [0]
    try:
        d = B.api_football('odds', {'league': B.LEGA_APIFOOTBALL, 'season': 2026},
                           chiave, conteggio)
    except Exception as e:                       # noqa: BLE001
        riga('NON RISPONDE: %s' % str(e)[:200])
        return
    risposte = d.get('response') or []
    riga('richieste spese: %d' % conteggio[0])
    riga('partite con quote: %d' % len(risposte))
    riga('paginazione: %s' % _json.dumps(d.get('paging') or {}))
    if d.get('errors'):
        riga('errori dichiarati: %s' % _json.dumps(d['errors'])[:300])
    if not risposte:
        riga("risponde ma non porta niente: non e' una fonte utilizzabile.")
        return
    r0 = risposte[0]
    fx = (r0.get('fixture') or {})
    riga('prima partita: %s  (id %s)' % (fx.get('date'), fx.get('id')))
    banchi = [(b.get('name'), len(b.get('bets') or [])) for b in (r0.get('bookmakers') or [])]
    riga('banchi: %d — %s' % (len(banchi), ', '.join('%s(%d mercati)' % b for b in banchi[:8])))
    for b in (r0.get('bookmakers') or [])[:1]:
        for bet in (b.get('bets') or [])[:3]:
            riga('  %s: %s' % (bet.get('name'),
                               ', '.join('%s=%s' % (v.get('value'), v.get('odd'))
                                         for v in (bet.get('values') or [])[:4])))


if __name__ == '__main__':
    main()
    sonda_api_football()
