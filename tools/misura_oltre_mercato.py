"""Cosa sa un dato che il mercato non sa gia'?

Il modello si ancora alle quote con peso UNO dove il mercato quota: chi
vince e quanti gol. Quindi un dato nuovo migliora le previsioni solo se dice
qualcosa che le quote NON dicono gia'. E' l'unica domanda che conta, e qui
si fa a tutti i candidati nello stesso modo:

    la probabilita' del mercato, PIU' il dato, prevede meglio della sola
    probabilita' del mercato, su stagioni che la stima non ha mai visto?

Tecnicamente: una regressione logistica con la probabilita' del mercato
come base fissa (offset) e il dato come unica cosa che puo' spostarla.
Stimata sulle stagioni 2021-22 .. 2023-24 dei cinque campionati, misurata
sulle successive. Se il coefficiente non e' lontano da zero (z > 2) e la
log-loss sulle stagioni nuove non scende, il dato non serve, e non entra.

Contro DUE prezzi: l'apertura (piu' o meno quello che si ha in mano quando
si gioca prima delle formazioni) e la chiusura (il mercato piu' informato).
Un dato che batte l'apertura e non la chiusura e' uno che il mercato
capisce tardi — e servirebbe proprio a chi gioca presto.

I candidati, tutti calcolati SOLO con quello che si sapeva prima del fischio:

  riposo          giorni dall'ultima di campionato, casa meno ospite
  riposo corto    chi ha giocato da 4 giorni o meno (i turni infrasettimanali)
  inizio stagione le prime 5 giornate, quando il mercato sa meno di mercato e
                  neopromosse
  forma           differenza reti nelle ultime 5, casa meno ospite
  fine stagione   le ultime 5 giornate, quando qualcuno non ha piu' niente da
                  giocarsi (la lunghezza della stagione e' nota dal calendario)

IL RISULTATO, 14 ottobre 2026: 9205 partite, stima su 5404, verifica su 3801
mai viste. Nessun candidato passa, ne' contro l'apertura ne' contro la
chiusura (che differiscono davvero: 2 punti in media sull'1, piu' di 3 in
2029 partite).

  riposo            coeff. z -0.8, guadagno +0.05% (z 1.8): rumore
  riposo corto      z +1.6 / +1.0, guadagno negativo
  prime 5 giornate  z -1.8, guadagno -0.11%
  ultime 5          sull'over 2.5 z +2.0 nella stima, ma sulle stagioni nuove
                    PEGGIORA (-0.11%, z -1.7): un caso, non una regola
  forma             z +1.9 / -0.7, guadagno ~0

Cioe': quello che questi dati sanno, le quote lo sanno gia' — dall'apertura.
Il modello resta com'e'.

uso: python3 tools/misura_oltre_mercato.py
"""
import json
import math
import os
import subprocess
import sys
from datetime import date

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.dirname(QUI)
FILES = ['data/serie-a.json', 'data/leghe/E0.json', 'data/leghe/D1.json',
         'data/leghe/SP1.json', 'data/leghe/F1.json']
STIMA = {'2021-22', '2022-23', '2023-24'}


def carica(f):
    with open(os.path.join(RADICE, f), encoding='utf-8') as h:
        return [p for p in json.load(h)['partite'] if p.get('gc') is not None]


def equa(q):
    if not q or not all(x and x > 1 for x in q):
        return None
    inv = [1 / x for x in q]
    s = sum(inv)
    return [x / s for x in inv]


def logit(p):
    p = min(1 - 1e-6, max(1e-6, p))
    return math.log(p / (1 - p))


def righe():
    fuori = []
    for f in FILES:
        partite = sorted(carica(f), key=lambda p: (p['d'], p.get('o') or ''))
        ultima, storia, n_stag = {}, {}, {}
        totale = {}
        for p in partite:
            for t in (p['c'], p['v']):
                totale[(t, p['s'])] = totale.get((t, p['s']), 0) + 1
        lunghezza = {}
        for (t, s_), n in totale.items():
            lunghezza[s_] = max(lunghezza.get(s_, 0), n)
        for p in partite:
            d = date.fromisoformat(p['d'])
            c, v, s = p['c'], p['v'], p['s']
            riposo = []
            for t in (c, v):
                u = ultima.get(t)
                riposo.append(min(14, (d - u).days) if u and (d - u).days < 60 else None)
            forma = []
            for t in (c, v):
                h = storia.get(t, [])[-5:]
                forma.append(sum(h) if len(h) == 5 else None)
            inizio = min(n_stag.get((t, s), 0) for t in (c, v)) < 5
            completa = lunghezza.get(s, 0) >= 30
            fine = completa and max(n_stag.get((t, s), 0) for t in (c, v)) >= lunghezza[s] - 5
            x = {'f': f, 's': s, 'gc': p['gc'], 'gv': p['gv'],
                 'riposo': (riposo[0] - riposo[1]) if None not in riposo else None,
                 'corto_c': 1 if riposo[0] is not None and riposo[0] <= 4 else 0,
                 'corto_v': 1 if riposo[1] is not None and riposo[1] <= 4 else 0,
                 'inizio': 1 if inizio else 0,
                 'fine': 1 if fine else 0,
                 'forma': (forma[0] - forma[1]) if None not in forma else None}
            for nome, campo1, campoou in (('ch', 'q', 'qoumax'), ('ap', 'qap', 'qapou')):
                e1 = equa(p.get(campo1))
                eou = equa(p.get(campoou) or (p.get('qou') if nome == 'ch' else None))
                x[nome + '1'] = e1
                x[nome + 'ou'] = eou
            fuori.append(x)
            ultima[c] = ultima[v] = d
            storia.setdefault(c, []).append(p['gc'] - p['gv'])
            storia.setdefault(v, []).append(p['gv'] - p['gc'])
            n_stag[(c, s)] = n_stag.get((c, s), 0) + 1
            n_stag[(v, s)] = n_stag.get((v, s), 0) + 1
    return fuori


def risolvi(A, b):
    n = len(b)
    M = [A[i][:] + [b[i]] for i in range(n)]
    for i in range(n):
        piv = max(range(i, n), key=lambda r: abs(M[r][i]))
        M[i], M[piv] = M[piv], M[i]
        if abs(M[i][i]) < 1e-12:
            return None
        for r in range(n):
            if r != i:
                k = M[r][i] / M[i][i]
                for cc in range(i, n + 1):
                    M[r][cc] -= k * M[i][cc]
    return [M[i][n] / M[i][i] for i in range(n)]


def logistica(X, y, offset, giri=30):
    """beta che massimizza la verosimiglianza di y ~ offset + X.beta (Newton)."""
    k = len(X[0])
    beta = [0.0] * k
    for _ in range(giri):
        g = [0.0] * k
        H = [[0.0] * k for _ in range(k)]
        for xi, yi, oi in zip(X, y, offset):
            eta = oi + sum(b * a for b, a in zip(beta, xi))
            p = 1 / (1 + math.exp(-eta))
            w = p * (1 - p)
            for a in range(k):
                g[a] += (yi - p) * xi[a]
                for b2 in range(k):
                    H[a][b2] += w * xi[a] * xi[b2]
        passo = risolvi(H, g)
        if passo is None:
            break
        beta = [b + s for b, s in zip(beta, passo)]
        if max(abs(s) for s in passo) < 1e-8:
            break
    inv_diag = []
    for a in range(k):
        e = [1.0 if i == a else 0.0 for i in range(k)]
        col = risolvi(H, e)
        inv_diag.append(col[a] if col else float('nan'))
    se = [math.sqrt(v) if v > 0 else float('nan') for v in inv_diag]
    return beta, se


def logloss(y, p):
    return [-(math.log(max(1e-12, pi)) if yi else math.log(max(1e-12, 1 - pi))) for yi, pi in zip(y, p)]


def prova(tutte, mercato, bersaglio, dato, etichetta):
    ok = [r for r in tutte if r[mercato] and r.get(dato) is not None]
    def pm(r):
        return r[mercato][0] if mercato.endswith('1') else r[mercato][0]
    def yv(r):
        return 1 if (r['gc'] > r['gv'] if bersaglio == 'casa' else r['gc'] + r['gv'] > 2) else 0
    st = [r for r in ok if r['s'] in STIMA]
    ve = [r for r in ok if r['s'] not in STIMA]
    if len(st) < 500 or len(ve) < 300:
        return None
    X = [[1.0, float(r[dato])] for r in st]
    y = [yv(r) for r in st]
    off = [logit(pm(r)) for r in st]
    beta, se = logistica(X, y, off)
    yv_ = [yv(r) for r in ve]
    base = [pm(r) for r in ve]
    nuova = [1 / (1 + math.exp(-(logit(pm(r)) + beta[0] + beta[1] * float(r[dato])))) for r in ve]
    l0, l1 = logloss(yv_, base), logloss(yv_, nuova)
    diff = [a - b for a, b in zip(l0, l1)]
    m = sum(diff) / len(diff)
    sd = math.sqrt(sum((d - m) ** 2 for d in diff) / max(1, len(diff) - 1))
    zt = m / (sd / math.sqrt(len(diff))) if sd > 0 else 0
    return {'n_stima': len(st), 'n_verifica': len(ve), 'coef': beta[1], 'z_coef': beta[1] / se[1] if se[1] else 0,
            'guadagno': 100 * m / (sum(l0) / len(l0)), 'z_guadagno': zt}


def main():
    tutte = righe()
    print('partite: %d nei cinque campionati\n' % len(tutte))
    candidati = [('riposo', 'riposo (giorni, casa - ospite)'),
                 ('corto_c', 'casa con riposo corto (<=4)'),
                 ('corto_v', 'ospite con riposo corto (<=4)'),
                 ('inizio', 'prime 5 giornate'),
                 ('fine', 'ultime 5 giornate'),
                 ('forma', 'forma (diff. reti ultime 5)')]
    for mercato, nome_m in (('ap', 'APERTURA'), ('ch', 'CHIUSURA')):
        print('=== contro le quote di %s ===' % nome_m)
        print('  %-34s %-9s %8s %7s %10s %7s' % ('dato', 'cosa', 'coeff.', 'z', 'guadagno', 'z'))
        for bersaglio, campo in (('casa', mercato + '1'), ('over', mercato + 'ou')):
            for dato, nome in candidati:
                r = prova(tutte, campo, bersaglio, dato, nome)
                if not r:
                    continue
                print('  %-34s %-9s %+8.3f %+7.2f %+9.3f%% %+7.2f' % (
                    nome, 'vince casa' if bersaglio == 'casa' else 'over 2.5',
                    r['coef'], r['z_coef'], r['guadagno'], r['z_guadagno']))
        print('')
    print('Si legge cosi\': "guadagno" e\' quanto scende la log-loss sulle stagioni mai')
    print('viste aggiungendo il dato alla quota. Un dato serve solo se il coefficiente e\'')
    print('lontano da zero (|z| > 2) E il guadagno e\' positivo con z > 2.')


if __name__ == '__main__':
    sys.exit(main())
