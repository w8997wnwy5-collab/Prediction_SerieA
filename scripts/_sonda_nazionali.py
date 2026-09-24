"""Un archivio dei risultati delle NAZIONALI: esiste, e serve?

Le fonti di questo progetto coprono i campionati per club e basta.
football-data.co.uk pubblica venti campionati di club e nessuna nazionale;
openfootball ha i tornei, non lo storico continuo. Senza un archivio, il
modello non puo' stimare attacco e difesa di nessuna nazionale — e un'app che
non sa niente di chi gioca puo' solo ripetere le quote del banco.

Quindi la domanda non e' "riesco a scaricare qualcosa", e':

  1. c'e' un file, e si scarica senza chiave?
  2. quante partite, e fino a che data? (il modello vuole gol, non riassunti)
  3. quante ne restano se guardo solo le ultime stagioni e le nazionali
     europee? Il decadimento nel tempo di Dixon-Coles e' tarato su squadre
     che giocano trentotto partite l'anno: una nazionale ne gioca dieci.
  4. i TIRI ci sono? (il secondo modello dell'app gira sui tiri, peso 0.60)

    python3 scripts/_sonda_nazionali.py
"""
import csv
import io
import sys
import urllib.error
import urllib.request
from collections import Counter

FONTI = [
    ('martj42/international_results',
     'https://raw.githubusercontent.com/martj42/international_results/master/results.csv'),
]


def scarica(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'monthline-sonda'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:                      # noqa: BLE001
        return None, str(e)[:200]


def main():
    for nome, url in FONTI:
        print('=== %s ===' % nome)
        stato, testo = scarica(url)
        if stato != 200 or not testo:
            print('  non risponde:', stato, testo[:160])
            continue
        righe = list(csv.DictReader(io.StringIO(testo)))
        if not righe:
            print('  vuoto')
            continue
        col = list(righe[0].keys())
        print('  %d partite, colonne: %s' % (len(righe), ', '.join(col)))
        date = sorted(r.get('date', '') for r in righe if r.get('date'))
        print('  dal %s al %s' % (date[0], date[-1]))

        tornei = Counter(r.get('tournament', '') for r in righe)
        print('  Nations League in archivio: %d partite' % tornei.get('UEFA Nations League', 0))
        print('  i cinque tornei piu grossi:')
        for t, n in tornei.most_common(5):
            print('     %-34s %d' % (t, n))

        # quello che conta per il modello: quante partite RECENTI per squadra
        recenti = [r for r in righe if r.get('date', '') >= '2022-01-01']
        print('  dal 2022 in poi: %d partite' % len(recenti))
        squadre = Counter()
        for r in recenti:
            squadre[r.get('home_team', '')] += 1
            squadre[r.get('away_team', '')] += 1
        europee = ['Italy', 'Germany', 'Netherlands', 'Portugal', 'Spain', 'France',
                   'England', 'Denmark', 'Norway', 'Serbia', 'Greece', 'Wales',
                   'Austria', 'Israel', 'Malta', 'Andorra', 'Kosovo', 'Lithuania']
        print('  partite giocate dal 2022 (quelle che il modello userebbe):')
        for s in europee:
            print('     %-16s %s' % (s, squadre.get(s, 0)))
        manca = [s for s in europee if squadre.get(s, 0) < 20]
        print('  sotto le 20 partite in quattro anni: %s'
              % (', '.join(manca) if manca else 'nessuna'))
        print('  TIRI nelle colonne:', 'si' if any('shot' in c.lower() for c in col) else 'NO')
    return 0


if __name__ == '__main__':
    sys.exit(main())
