#!/usr/bin/env python3
"""
Un campionato finto di cui si conosce la verità.

Sui dati veri il problema di ogni modello è che la risposta giusta non esiste:
non si sa quanto valga davvero l'Atalanta, si sa solo cosa ha fatto. Qui invece
le forze di ogni squadra, il vantaggio del campo e la severità di ogni arbitro
sono decisi a tavolino, le partite si giocano tirando i dadi da quei numeri, e
poi si guarda se il modello li ritrova.

    python3 tools/genera_dati_sintetici.py /tmp/finto
"""

import json
import math
import os
import random
import sys
from datetime import date, timedelta

SQUADRE = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
           'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
           'Quebec', 'Romeo', 'Sierra', 'Tango']
ARBITRI = ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Gialli', 'Blu', 'Viola', 'Grigi']

VERO = {
    'mu0': math.log(1.17),
    'gamma': 0.26,          # vantaggio del campo
    'rho': -0.05,           # correzione sui punteggi bassi
    'quota_primo_tempo': 0.44,
    'tiri_per_gol_atteso': 3.6,
    'corner_medi': 4.6,
}


def poisson(rnd, lam):
    """Knuth: va benissimo per lambda piccoli come questi."""
    lim, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rnd.random()
        if p <= lim:
            return k
        k += 1
        if k > 40:
            return k


def tau(x, y, lam, mu, rho):
    if x == 0 and y == 0:
        return 1 - lam * mu * rho
    if x == 0 and y == 1:
        return 1 + lam * rho
    if x == 1 and y == 0:
        return 1 + mu * rho
    if x == 1 and y == 1:
        return 1 - rho
    return 1.0


def tira_dixon_coles(rnd, lam, mu, rho):
    """Rifiuto vero, non ritiro alla cieca.

    Ritirare i dadi quando la casella non piace sembra la stessa cosa e non lo
    è: il secondo tiro può finire ovunque, e la distribuzione che ne esce non è
    più quella di Dixon-Coles — è Poisson con qualche gol in più. Qui invece si
    accetta con probabilità proporzionale a tau, che è la definizione."""
    limite = max(1.0, abs(1 - lam * mu * rho), abs(1 + lam * rho),
                 abs(1 + mu * rho), abs(1 - rho))
    for _ in range(60):
        x, y = poisson(rnd, lam), poisson(rnd, mu)
        if rnd.random() < max(0.0, tau(x, y, lam, mu, rho)) / limite:
            return x, y
    return poisson(rnd, lam), poisson(rnd, mu)


def genera(seme=7, stagioni=6, cartella='/tmp/finto'):
    rnd = random.Random(seme)
    forza = {}
    for s in SQUADRE:
        forza[s] = {'att': rnd.gauss(0, 0.30), 'dif': rnd.gauss(0, 0.26),
                    'falli': max(0.5, rnd.gauss(1.0, 0.18))}
    severita = {a: max(0.55, rnd.gauss(1.0, 0.22)) for a in ARBITRI}

    partite = []
    inizio = date(2020, 8, 20)
    for st in range(stagioni):
        etichetta = '%d-%02d' % (2020 + st, (2021 + st) % 100)
        giorno = inizio.replace(year=2020 + st)
        coppie = [(a, b) for a in SQUADRE for b in SQUADRE if a != b]
        rnd.shuffle(coppie)
        for n, (casa, via) in enumerate(coppie):
            if n % 10 == 0:
                giorno += timedelta(days=7)
            lam = math.exp(VERO['mu0'] + forza[casa]['att'] - forza[via]['dif'] + VERO['gamma'])
            mu = math.exp(VERO['mu0'] + forza[via]['att'] - forza[casa]['dif'])
            gc, gv = tira_dixon_coles(rnd, lam, mu, VERO['rho'])
            arb = rnd.choice(ARBITRI)
            sev = severita[arb]
            partite.append({
                's': etichetta, 'd': giorno.isoformat(), 'c': casa, 'v': via,
                'gc': gc, 'gv': gv,
                'ptc': sum(1 for _ in range(gc) if rnd.random() < VERO['quota_primo_tempo']),
                'ptv': sum(1 for _ in range(gv) if rnd.random() < VERO['quota_primo_tempo']),
                'tpc': poisson(rnd, lam * VERO['tiri_per_gol_atteso']),
                'tpv': poisson(rnd, mu * VERO['tiri_per_gol_atteso']),
                'tc': poisson(rnd, lam * VERO['tiri_per_gol_atteso'] * 2.4),
                'tv': poisson(rnd, mu * VERO['tiri_per_gol_atteso'] * 2.4),
                'ac': poisson(rnd, VERO['corner_medi'] * 1.12),
                'av': poisson(rnd, VERO['corner_medi'] / 1.12),
                'gic': poisson(rnd, 1.35 * sev * forza[casa]['falli']),
                'giv': poisson(rnd, 1.55 * sev * forza[via]['falli']),
                'rc': 1 if rnd.random() < 0.045 else 0,
                'rv': 1 if rnd.random() < 0.055 else 0,
                'fc': poisson(rnd, 12 * forza[casa]['falli']),
                'fv': poisson(rnd, 12 * forza[via]['falli']),
                'arb': arb,
                # gli xG "veri": i gol attesi più un po' di rumore, che è
                # esattamente cosa sono nella realtà
                'xgc': round(max(0.05, lam * rnd.gauss(1.0, 0.28)), 3),
                'xgv': round(max(0.05, mu * rnd.gauss(1.0, 0.28)), 3),
            })

    os.makedirs(cartella, exist_ok=True)
    doc = {'lega': 'Finta A', 'aggiornato': '2026-01-01T00:00:00+00:00',
           'fonte': 'generato da tools/genera_dati_sintetici.py',
           'stagioni': sorted({p['s'] for p in partite}),
           'partite': partite, 'calendario': []}
    with open(os.path.join(cartella, 'serie-a.json'), 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(cartella, 'verita.json'), 'w', encoding='utf-8') as f:
        json.dump({'parametri': VERO, 'forza': forza, 'severita': severita}, f,
                  ensure_ascii=False, indent=1)

    gol = sum(p['gc'] + p['gv'] for p in partite) / len(partite)
    casa = sum(p['gc'] for p in partite) / len(partite)
    print('%d partite in %d stagioni → %s' % (len(partite), stagioni, cartella))
    print('gol per partita: %.3f (di cui %.3f in casa)' % (gol, casa))
    return doc


if __name__ == '__main__':
    genera(cartella=sys.argv[1] if len(sys.argv) > 1 else '/tmp/finto')
