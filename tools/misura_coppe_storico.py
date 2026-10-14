"""Coppe europee in mezzo alla settimana, e lo storico dei precedenti:
sanno qualcosa che le quote non sanno?

La prima prova sul riposo (tools/misura_oltre_mercato.py) aveva un buco, e
l'ha visto chi usa l'app prima di chi l'ha scritta: l'archivio ha solo le
partite di CAMPIONATO, quindi una squadra che il mercoledi' aveva giocato in
Champions risultava riposata da una settimana. Proprio l'effetto da misurare
restava invisibile.

Qui le coppe ci sono: Champions, Europa League e Conference League da
openfootball (lo stesso progetto che da' i calendari di campionato), con data
di ogni partita. Si usano le stagioni in cui ci sono tutte e tre: 2021-22 ..
2024-25. Stima sulle prime tre, verifica sulla 2024-25 mai vista.

La domanda e' la stessa di sempre: la probabilita' del mercato (apertura e
chiusura) PIU' il dato, prevede meglio della sola probabilita' del mercato?

  riposo vero        giorni dall'ultima partita in QUALSIASI competizione,
                     casa meno ospite
  coppa prima        ha giocato in Europa nei 4 giorni prima (casa / ospite)
  coppa dopo         gioca in Europa nei 4 giorni dopo: e' li' che si fa
                     turnover (casa / ospite)
  storico            negli ultimi scontri diretti (almeno 3, al massimo 6):
                     differenza reti dal punto di vista di chi gioca in casa,
                     e gol medi a partita

IL RISULTATO, 14 ottobre 2026: 1423 partite di coppa agganciate, 7156 di
campionato; stima 2021-22 .. 2023-24, verifica sulla 2024-25 mai vista.
Nessun dato migliora le previsioni, ne' contro l'apertura ne' contro la
chiusura:

  riposo vero (coppe comprese)  guadagno +0.06% (z 0.7): rumore
  coppa nei 4 giorni prima      casa: coeff. z +1.9 nella stima, ma sulla
                                stagione nuova PEGGIORA (-0.28%, z -2.2)
  coppa nei 4 giorni dopo       casa: z +2.2 nella stima, +0.02% sulla nuova;
                                ospite: z +1.6, -0.14%
  storico dei precedenti        differenza reti: PEGGIORA (-0.37%, z -3.1);
                                gol medi: -0.32% / -0.02%

Le coppe in mezzo alla settimana e i precedenti le quote li sanno gia', dal
primo prezzo. Il modello resta com'e'.

Gli infortuni qui non ci sono e non ci possono essere: per misurarli serve
sapere cosa si sapeva PRIMA di ogni partita. Quella storia si sta
raccogliendo da sola: ogni aggiornamento dei dati salva i titoli recenti,
ognuno con la squadra e il segno "assenza", e la storia del repository li
tiene tutti. Con un paio di mesi di partite si potra' fare la stessa prova.

uso: python3 tools/misura_coppe_storico.py
"""
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date, timedelta

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.dirname(QUI)
sys.path.insert(0, os.path.join(RADICE, 'scripts'))
sys.path.insert(0, QUI)
import build_data as B                                    # noqa: E402  (il risolutore dei nomi)
import misura_oltre_mercato as O                          # noqa: E402  (la stessa prova)

LEGHE = {'ITA': 'data/serie-a.json', 'ENG': 'data/leghe/E0.json', 'GER': 'data/leghe/D1.json',
         'ESP': 'data/leghe/SP1.json', 'FRA': 'data/leghe/F1.json'}
STAGIONI = ['2021-22', '2022-23', '2023-24', '2024-25']
COPPE = ['cl', 'el', 'conf']
CACHE = os.environ.get('CACHE_COPPE', os.path.join(RADICE, '.cache_coppe'))
URL = 'https://raw.githubusercontent.com/openfootball/champions-league/master/%s/%s.txt'
# i due che il risolutore non aggancia da solo, ed e' giusto che non lo faccia:
# "Lazio Roma" contiene "Roma", "Internazionale Milano" contiene "Milano"
NOMI_A_MANO = {'FC Internazionale Milano': 'Inter', 'Lazio Roma': 'Lazio'}
MESI = {m: i + 1 for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}


def scarica(stagione, coppa):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, '%s-%s.txt' % (stagione, coppa))
    if not os.path.exists(p):
        with urllib.request.urlopen(URL % (stagione, coppa), timeout=30) as r:
            open(p, 'wb').write(r.read())
    return open(p, encoding='utf-8').read()


def partite_di_coppa(testo, stagione):
    """(data, squadra, paese) per ogni squadra di ogni partita giocata."""
    a1 = int(stagione[:4])
    fuori, giorno = [], None
    for riga in testo.splitlines():
        m = re.match(r'^\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$', riga)
        if m:
            mese, gg = MESI[m.group(1)], int(m.group(2))
            anno = int(m.group(3)) if m.group(3) else (a1 if mese >= 7 else a1 + 1)
            giorno = date(anno, mese, gg)
            continue
        m = re.match(r'^\s+(?:\d{1,2}[.:]\d{2}\s+)?(.+?)\s+\(([A-Z]{3})\)\s+v\s+(.+?)\s+\(([A-Z]{3})\)\s+\d+-\d+', riga)
        if m and giorno:
            fuori.append((giorno, m.group(1).strip(), m.group(2)))
            fuori.append((giorno, m.group(3).strip(), m.group(4)))
    return fuori


def date_di_coppa():
    """per lega: {squadra dell'archivio: [date delle partite di coppa]}"""
    per_lega, irrisolti = {}, {}
    nomi_lega = {}
    for paese, f in LEGHE.items():
        nomi_lega[paese] = sorted({p['c'] for p in O.carica(f)} | {p['v'] for p in O.carica(f)})
    risolutori = {paese: B.RisolutoreNomi(n) for paese, n in nomi_lega.items()}
    for st in STAGIONI:
        for c in COPPE:
            for g, nome, paese in partite_di_coppa(scarica(st, c), st):
                if paese not in LEGHE:
                    continue
                r = NOMI_A_MANO.get(nome) or risolutori[paese].risolvi(nome)
                if not r:
                    irrisolti[(paese, nome)] = irrisolti.get((paese, nome), 0) + 1
                    continue
                per_lega.setdefault(LEGHE[paese], {}).setdefault(r, []).append(g)
    return per_lega, irrisolti


def righe(coppe):
    fuori = []
    for paese, f in LEGHE.items():
        europa = coppe.get(f, {})
        partite = sorted([p for p in O.carica(f) if p['s'] in STAGIONI],
                         key=lambda p: (p['d'], p.get('o') or ''))
        tutte_l = sorted(O.carica(f), key=lambda p: (p['d'], p.get('o') or ''))
        ultima = {}
        precedenti = {}
        for p in tutte_l:
            d = date.fromisoformat(p['d'])
            c, v = p['c'], p['v']
            if p['s'] in STAGIONI:
                x = {'f': f, 's': p['s'], 'gc': p['gc'], 'gv': p['gv']}
                rip = []
                for t in (c, v):
                    cand = [u for u in [ultima.get(t)] + [e for e in europa.get(t, []) if e < d] if u]
                    u = max(cand) if cand else None
                    rip.append(min(14, (d - u).days) if u and (d - u).days < 60 else None)
                x['riposo_vero'] = (rip[0] - rip[1]) if None not in rip else None
                for t, k in ((c, 'c'), (v, 'v')):
                    e = europa.get(t, [])
                    x['coppa_prima_' + k] = 1 if any(0 < (d - g).days <= 4 for g in e) else 0
                    x['coppa_dopo_' + k] = 1 if any(0 < (g - d).days <= 4 for g in e) else 0
                h = precedenti.get(frozenset((c, v)), [])[-6:]
                if len(h) >= 3:
                    x['storico_dr'] = sum((gc - gv) if casa == c else (gv - gc) for casa, gc, gv in h) / len(h)
                    x['storico_gol'] = sum(gc + gv for _, gc, gv in h) / len(h)
                else:
                    x['storico_dr'] = x['storico_gol'] = None
                for nome, campo1, campoou in (('ch', 'q', 'qoumax'), ('ap', 'qap', 'qapou')):
                    x[nome + '1'] = O.equa(p.get(campo1))
                    x[nome + 'ou'] = O.equa(p.get(campoou) or (p.get('qou') if nome == 'ch' else None))
                fuori.append(x)
            ultima[c] = ultima[v] = d
            precedenti.setdefault(frozenset((c, v)), []).append((c, p['gc'], p['gv']))
    return fuori


def main():
    coppe, irrisolti = date_di_coppa()
    n_date = sum(len(v) for l in coppe.values() for v in l.values())
    print('partite di coppa agganciate a squadre dei cinque campionati: %d' % n_date)
    if irrisolti:
        print('nomi non riconosciuti (%d): %s' % (len(irrisolti), ', '.join(
            '%s/%s' % k for k, _ in sorted(irrisolti.items(), key=lambda x: -x[1])[:12])))
    tutte = righe(coppe)
    print('partite di campionato nelle stagioni con le coppe: %d' % len(tutte))
    print('  con coppa nei 4 giorni prima: casa %d, ospite %d' % (
        sum(r['coppa_prima_c'] for r in tutte), sum(r['coppa_prima_v'] for r in tutte)))
    print('  con coppa nei 4 giorni dopo:  casa %d, ospite %d' % (
        sum(r['coppa_dopo_c'] for r in tutte), sum(r['coppa_dopo_v'] for r in tutte)))
    print('  con almeno 3 precedenti: %d\n' % sum(1 for r in tutte if r['storico_dr'] is not None))

    O.STIMA = {'2021-22', '2022-23', '2023-24'}
    candidati = [('riposo_vero', 'riposo vero (casa - ospite)'),
                 ('coppa_prima_c', 'casa: coppa nei 4 giorni prima'),
                 ('coppa_prima_v', 'ospite: coppa nei 4 giorni prima'),
                 ('coppa_dopo_c', 'casa: coppa nei 4 giorni dopo'),
                 ('coppa_dopo_v', 'ospite: coppa nei 4 giorni dopo'),
                 ('storico_dr', 'storico: diff. reti precedenti'),
                 ('storico_gol', 'storico: gol medi precedenti')]
    for mercato, nome_m in (('ap', 'APERTURA'), ('ch', 'CHIUSURA')):
        print('=== contro le quote di %s ===' % nome_m)
        print('  %-34s %-10s %8s %7s %10s %7s' % ('dato', 'cosa', 'coeff.', 'z', 'guadagno', 'z'))
        for bersaglio, campo in (('casa', mercato + '1'), ('over', mercato + 'ou')):
            for dato, nome in candidati:
                r = O.prova(tutte, campo, bersaglio, dato, nome)
                if not r:
                    continue
                print('  %-34s %-10s %+8.3f %+7.2f %+9.3f%% %+7.2f' % (
                    nome, 'vince casa' if bersaglio == 'casa' else 'over 2.5',
                    r['coef'], r['z_coef'], r['guadagno'], r['z_guadagno']))
        print('')


if __name__ == '__main__':
    sys.exit(main())
