#!/usr/bin/env python3
"""Quali colonne ci sono nel CSV di football-data, e quali sto ignorando.

Il modo piu' economico di trovare informazione: guardare cosa e' gia' arrivato
nei file che scarico ogni giorno e che butto via senza guardare.
"""
import csv
import io
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data as B                                    # noqa: E402

for stagione, etichetta in (('2526', '2025-26'), ('2627', '2026-27')):
    try:
        testo = B.scarica_football_data('mmz4281/%s/I1.csv' % stagione, {},
                                        controllo=None).decode('utf-8-sig', 'replace')
    except Exception as e:                                # noqa: BLE001
        print('%s: non disponibile (%s)' % (etichetta, str(e)[:60]))
        continue
    lettore = csv.DictReader(io.StringIO(testo.replace('\r\n', '\n')))
    campi = [(c or '').replace('﻿', '').strip() for c in (lettore.fieldnames or [])]
    righe = list(lettore)
    print('\n=== %s: %d colonne, %d righe ===' % (etichetta, len(campi), len(righe)))
    usate = {'Div', 'Date', 'Time', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'HTHG', 'HTAG',
             'Referee', 'HS', 'AS', 'HST', 'AST', 'HF', 'AF', 'HC', 'AC', 'HY', 'AY',
             'HR', 'AR', 'FTR', 'HTR'}
    for a, b, c in B.COLONNE_1X2:
        usate |= {a, b, c}
    for a, b in B.COLONNE_OU:
        usate |= {a, b}

    def piene(col):
        return sum(1 for x in righe if (x.get(col) or '').strip())

    fuori = [c for c in campi if c not in usate and piene(c) > len(righe) * 0.5]
    print('colonne piene che NON uso: %d' % len(fuori))
    for c in fuori:
        esempi = [(x.get(c) or '').strip() for x in righe[:3]]
        print('  %-14s %3d%%  es: %s' % (c, 100 * piene(c) // max(1, len(righe)),
                                         ', '.join(esempi)))
