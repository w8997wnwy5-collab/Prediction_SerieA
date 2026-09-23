"""Le notizie per gli altri quattro campionati: quali feed, e servono a qualcosa?

Oggi le notizie sono solo Serie A: tre feed italiani, e prendi_notizie gira
soltanto sulle squadre di quel campionato. Negli altri quattro archivi la voce
"notizie" e' zero.

Ma "il feed risponde" non e' la domanda. La domanda e' se dai titoli si riesce
a capire DI CHI parlano: una notizia che non si aggancia a una squadra non si
puo' mostrare accanto a una partita, e resta un titolo in mezzo al nulla. Per
la Serie A c'e' voluta una tabella di soprannomi — senza, la Gazzetta dava zero
titoli riconosciuti su novantanove, perche' scrive "Juve" e "Nerazzurri" e mai
"Juventus" o "Inter".

Quindi qui si misura la cosa che conta: quanti titoli si agganciano a una
squadra vera, usando il risolutore di nomi che gia' esiste per i calendari.

    python3 scripts/_sonda_notizie.py
"""
import json
import os
import re
import sys

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(QUI, 'scripts'))
import build_data as B       # noqa: E402

CANDIDATI = {
    'E0': [
        ('BBC Sport', 'https://feeds.bbci.co.uk/sport/football/rss.xml'),
        ('Guardian PL', 'https://www.theguardian.com/football/premierleague/rss'),
        ('Sky Sports', 'https://www.skysports.com/rss/11661'),
    ],
    'D1': [
        ('kicker', 'https://newsfeed.kicker.de/news/bundesliga'),
        ('Sport1', 'https://www.sport1.de/news/fussball/bundesliga/feed'),
        ('Guardian Bundesliga', 'https://www.theguardian.com/football/bundesligafootball/rss'),
    ],
    'SP1': [
        ('Marca Liga', 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml'),
        ('AS', 'https://as.com/rss/futbol/primera.xml'),
        ('Guardian Liga', 'https://www.theguardian.com/football/laligafootball/rss'),
    ],
    'F1': [
        ('L\'Equipe', 'https://www.lequipe.fr/rss/actu_actualites-football.xml'),
        ('RMC', 'https://rmcsport.bfmtv.com/rss/football/ligue-1/'),
        ('Guardian Ligue 1', 'https://www.theguardian.com/football/ligue1football/rss'),
    ],
}


def riga(t=''):
    print(t, flush=True)


def squadre_di(lega_id):
    """Le squadre della stagione in corso, dall'archivio appena costruito."""
    lega = [x for x in B.LEGHE if x['id'] == lega_id][0]
    percorso = os.path.join(QUI, 'data', *lega['file'].split('/'))
    if not os.path.exists(percorso):
        return []
    with open(percorso, encoding='utf-8') as f:
        doc = json.load(f)
    stagioni = sorted({p.get('s') for p in doc.get('partite', []) if p.get('s')})
    ultima = stagioni[-1] if stagioni else None
    sq = {p['c'] for p in doc.get('partite', []) if p.get('s') == ultima}
    sq |= {p['v'] for p in doc.get('partite', []) if p.get('s') == ultima}
    sq |= {p.get('c') for p in doc.get('calendario', []) if p.get('c')}
    sq |= {p.get('v') for p in doc.get('calendario', []) if p.get('v')}
    return sorted(x for x in sq if x)


def main():
    riga('== notizie per gli altri quattro campionati ==')
    riga('La domanda non e\' "il feed risponde" ma "riconosco di chi parla".')
    riga()
    for lega_id, feed in CANDIDATI.items():
        squadre = squadre_di(lega_id)
        nome_lega = [x['nome'] for x in B.LEGHE if x['id'] == lega_id][0]
        riga('%s (%s): %d squadre in archivio' % (nome_lega, lega_id, len(squadre)))
        if not squadre:
            riga('  nessun archivio: salto')
            riga()
            continue
        risolutore = B.RisolutoreNomi(squadre)
        for etichetta, url in feed:
            try:
                grezzo = B.scarica(url, tentativi=2, attesa=3)
                testo = grezzo.decode('utf-8', 'replace')
            except Exception as e:                # noqa: BLE001
                riga('  %-20s non risponde: %s' % (etichetta, str(e)[:60]))
                continue
            voci = B._voci_rss(testo)
            if not voci:
                riga('  %-20s risponde ma nessun titolo riconoscibile come RSS' % etichetta)
                continue
            presi, esempi = 0, []
            for v in voci:
                titolo = re.sub(r'\s+', ' ', v.get('title') or '').strip()
                if not titolo:
                    continue
                # quale squadra nomina? si prova ogni parola lunga del titolo
                trovata = None
                for pezzo in re.findall(r"[A-Za-zÀ-ÿ'\-]{4,}", titolo):
                    q = risolutore._cerca(pezzo)
                    if q:
                        trovata = q
                        break
                if trovata:
                    presi += 1
                    if len(esempi) < 2:
                        esempi.append('%s -> %s' % (titolo[:42], trovata))
            riga('  %-20s %3d titoli, %3d agganciati (%d%%)%s'
                 % (etichetta, len(voci), presi,
                    round(100 * presi / max(1, len(voci))),
                    '   es: ' + ' | '.join(esempi) if esempi else ''))
        riga()
    return 0


if __name__ == '__main__':
    sys.exit(main())
