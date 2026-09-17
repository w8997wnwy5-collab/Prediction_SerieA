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


if __name__ == '__main__':
    main()
    sonda_api_football()
