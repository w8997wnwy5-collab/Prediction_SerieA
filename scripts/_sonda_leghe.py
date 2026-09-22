"""Gli altri quattro campionati hanno davvero le stesse colonne?

Serie A viene da football-data.co.uk, file mmz4281/<stagione>/I1.csv. Premier,
Bundesliga, Liga e Ligue 1 stanno sullo stesso sito con un altro codice — E0,
D1, SP1, F1 — e "stesso sito, stesso formato" e' esattamente il tipo di cosa
che sembra ovvia e che in questo progetto si e' gia' rivelata falsa una volta:
gli xG veri erano nelle colonne HxG e AxG di un file scaricato ogni giorno, e
per mesi nessuno li ha cercati perche' nessuno aveva guardato l'elenco delle
colonne.

Quindi prima si guarda. Cosa serve sapere, in ordine:

  1. il file c'e', per tutte e sei le stagioni?
  2. quante partite porta? (la Bundesliga ne ha 306, non 380: 18 squadre)
  3. le colonne che servono ci sono tutte — quote di chiusura, di apertura,
     tiri, tiri in porta, xG, arbitro?
  4. quanto pesa l'archivio completo? Il file della sola Serie A sta a 850 KB
     e lo carica un telefono a ogni apertura: per cinque campionati la domanda
     non e' se dividerlo, e' quanto.

    python3 scripts/_sonda_leghe.py
"""
import csv
import io
import sys
import urllib.request

PORTE = ('https://football-data.co.uk', 'https://www.football-data.co.uk',
         'http://football-data.co.uk')
LEGHE = [('I1', 'Serie A'), ('E0', 'Premier League'), ('D1', 'Bundesliga'),
         ('SP1', 'Liga'), ('F1', 'Ligue 1')]
STAGIONI = [('2627', '2026-27'), ('2526', '2025-26'), ('2425', '2024-25'),
            ('2324', '2023-24'), ('2223', '2022-23'), ('2122', '2021-22')]

# Le colonne che il lettore di Serie A usa davvero, divise per a cosa servono:
# se ne manca una a un campionato, si vuole sapere QUALE pezzo dell'app perde.
SERVONO = {
    'esito':   ['Div', 'Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG'],
    'primo t': ['HTHG', 'HTAG'],
    'tiri':    ['HS', 'AS', 'HST', 'AST'],
    'xG':      ['HxG', 'AxG'],
    'arbitro': ['Referee'],
    'quote chiusura': ['AvgCH', 'AvgCD', 'AvgCA', 'MaxCH', 'B365CH'],
    'quote apertura': ['AvgH', 'AvgD', 'AvgA'],
    'over/under':     ['AvgC>2.5', 'AvgC<2.5', 'MaxC>2.5'],
    'handicap':       ['AHCh', 'AvgCAHH', 'AvgCAHA'],
}


def riga(t=''):
    print(t, flush=True)


def prendi(percorso):
    ultimo = None
    for porta in PORTE:
        try:
            req = urllib.request.Request('%s/%s' % (porta, percorso),
                                         headers={'User-Agent': 'Prediction_SerieA/sonda'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:                   # noqa: BLE001
            ultimo = str(e)[:70]
    raise RuntimeError(ultimo or 'nessun indirizzo')


def main():
    riga('== gli altri campionati hanno le stesse colonne? ==')
    riga()
    totale_byte = 0
    per_lega = {}
    for cod, nome in LEGHE:
        riga('%s (%s)' % (nome, cod))
        partite_tot, byte_tot, mancanti_ovunque = 0, 0, {}
        for stag, etichetta in STAGIONI:
            try:
                d = prendi('mmz4281/%s/%s.csv' % (stag, cod))
            except Exception as e:               # noqa: BLE001
                riga('  %-8s NON scaricato: %s' % (etichetta, e))
                continue
            byte_tot += len(d)
            t = d.decode('utf-8-sig', errors='replace')
            lettore = csv.DictReader(io.StringIO(t.replace('\r\n', '\n')))
            campi = [(c or '').replace('﻿', '').strip()
                     for c in (lettore.fieldnames or [])]
            righe = [x for x in lettore if (x.get('Div') or '').strip() == cod]
            partite_tot += len(righe)
            pieni = {}
            for gruppo, cols in SERVONO.items():
                manca = [c for c in cols if c not in campi]
                if manca:
                    mancanti_ovunque.setdefault(gruppo, set()).update(manca)
                    pieni[gruppo] = 'MANCA ' + ','.join(manca)
                else:
                    # c'e' la colonna, ma e' piena?
                    primo = cols[-1] if gruppo != 'esito' else cols[4]
                    n = sum(1 for x in righe if (x.get(primo) or '').strip())
                    pieni[gruppo] = '%d%%' % round(100 * n / max(1, len(righe)))
            riga('  %-8s %3d partite, %3d colonne, %6.0f KB   %s'
                 % (etichetta, len(righe), len(campi), len(d) / 1024.0,
                    '  '.join('%s %s' % (g, pieni[g])
                              for g in ('tiri', 'xG', 'arbitro', 'quote chiusura',
                                        'over/under', 'handicap'))))
        per_lega[nome] = (partite_tot, byte_tot)
        totale_byte += byte_tot
        if mancanti_ovunque:
            riga('  colonne che mancano da qualche parte:')
            for g in sorted(mancanti_ovunque):
                riga('    %-16s %s' % (g, ', '.join(sorted(mancanti_ovunque[g]))))
        riga('  TOTALE %d partite, %.0f KB di CSV grezzo' % (partite_tot, byte_tot / 1024.0))
        riga()

    riga('== quanto pesa tutto insieme ==')
    tot_partite = sum(v[0] for v in per_lega.values())
    for nome in per_lega:
        riga('  %-16s %5d partite' % (nome, per_lega[nome][0]))
    riga('  %-16s %5d partite' % ('TUTTI', tot_partite))
    riga()
    riga('  Il file di oggi, solo Serie A, sta a 850 KB per 1950 partite:')
    riga('  circa %.0f byte a partita dopo la potatura.' % (850 * 1024 / 1950.0))
    riga('  Cinque campionati sarebbero circa %.1f MB in un file solo.'
         % (tot_partite * (850 * 1024 / 1950.0) / (1024 * 1024)))
    riga('  Un telefono lo scarica a ogni apertura: va diviso per lega.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
