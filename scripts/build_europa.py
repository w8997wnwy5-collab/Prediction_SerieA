#!/usr/bin/env python3
"""L'Europa: i campionati che contano e la Champions.

Il problema, e perche' non basta scaricare la Champions.

Il modello di questa app stima attacco e difesa di ogni squadra dal suo
campionato, dove tutte si incontrano con tutte: e' quello che rende i numeri
confrontabili. La Champions non e' cosi. Trentasei squadre di sedici paesi che
si incontrano otto volte in tutto: un attacco stimato li' sarebbe basato su
otto partite, e per giunta contro avversari mai visti.

E c'e' un guaio peggiore, che si vede solo se lo si cerca: le forze di
campionati diversi NON SONO CONFRONTABILI. Un attacco di 0.5 in Eredivisie non
vale un attacco di 0.5 in Premier, perche' sono misurati contro difese diverse.
Sommarli sarebbe come sommare gradi Celsius e Fahrenheit.

Quindi si fa in due tempi.

  1. Le forze delle squadre si stimano dal loro campionato, dove ci sono
     trecentottanta partite l'anno invece di otto.

  2. Un OFFSET per campionato dice quanto vale una lega rispetto a un'altra, e
     si stima dalle sole partite in cui squadre di leghe diverse si incontrano
     — cioe' proprio dalle coppe europee, che sono l'unico posto dove quella
     domanda ha una risposta osservabile.

Questo file raccoglie la materia prima per tutti e due: i campionati da
football-data.co.uk (stesso formato della Serie A, gia' collaudato) e le coppe
da openfootball. Il modello vero e' in modello.js.

Copertura, misurata sulla Champions 2025-26: 30 squadre su 36 giocano in un
campionato che football-data copre. Delle altre sei — Azerbaigian, Cechia,
Norvegia, Cipro, Danimarca, Kazakistan — non si sa niente, e l'app lo dice
invece di inventarselo.

    python3 scripts/build_europa.py
"""
import json
import os
import unicodedata
import re
import sys
import time
from datetime import datetime, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)
import build_data as B                                    # noqa: E402

DATA = os.path.join(os.path.dirname(QUI), 'data')
FILE_EUROPA = os.path.join(DATA, 'europa.json')

# I campionati che football-data.co.uk pubblica e da cui esce quasi tutta la
# Champions. Il codice a tre lettere e' quello che openfootball scrive fra
# parentesi accanto a ogni squadra nelle coppe: e' la chiave che unisce i due.
CAMPIONATI = (
    ('E0',  'ENG', 'Premier League'),
    ('SP1', 'ESP', 'Liga'),
    ('I1',  'ITA', 'Serie A'),
    ('D1',  'GER', 'Bundesliga'),
    ('F1',  'FRA', 'Ligue 1'),
    ('N1',  'NED', 'Eredivisie'),
    ('P1',  'POR', 'Primeira Liga'),
    ('B1',  'BEL', 'Pro League'),
    ('T1',  'TUR', 'Super Lig'),
    ('G1',  'GRE', 'Super League'),
)
# Il Monaco gioca in Francia pur non essendo francese: openfootball lo segna
# MCO, football-data lo trova in F1. Senza questa riga sarebbe una delle
# squadre "di cui non so niente", e invece si sa tutto.
PAESE_IN_CAMPIONATO = {'MCO': 'FRA'}

COPPE = (
    ('champions-league', 'Champions League'),
)


def stagioni_recenti(quante=3):
    """Le ultime N stagioni, nel formato di football-data (2627) e in quello
    lungo (2026-27). La stagione gira a luglio."""
    oggi = datetime.now(timezone.utc).date()
    inizio = oggi.year if oggi.month >= 7 else oggi.year - 1
    fuori = []
    for i in range(quante):
        a = inizio - i
        fuori.append(('%02d%02d' % (a % 100, (a + 1) % 100), '%d-%02d' % (a, (a + 1) % 100)))
    return fuori


def prendi_campionato(codice, stagione_corta, etichetta, paese, esiti):
    """Un CSV di football-data, ridotto all'osso: qui servono solo i gol."""
    try:
        testo = B.scarica_football_data('mmz4281/%s/%s.csv' % (stagione_corta, codice), esiti,
                                        controllo=None).decode('utf-8-sig', 'replace')
    except Exception as e:                                # noqa: BLE001
        esiti['%s %s' % (codice, etichetta)] = 'fallita: %s' % str(e)[:60]
        return []
    import csv
    import io
    fuori = []
    lettore = csv.DictReader(io.StringIO(testo.replace('\r\n', '\n')))
    if lettore.fieldnames:
        lettore.fieldnames = [(c or '').replace('﻿', '').strip() for c in lettore.fieldnames]
    for r in lettore:
        casa = (r.get('HomeTeam') or '').strip()
        via = (r.get('AwayTeam') or '').strip()
        d = B.data_iso(r.get('Date'))
        gc, gv = B.intero(r.get('FTHG')), B.intero(r.get('FTAG'))
        if not (casa and via and d) or gc is None or gv is None:
            continue
        fuori.append({'d': d, 'c': casa, 'v': via, 'gc': gc, 'gv': gv,
                      'p': paese, 's': etichetta})
    esiti['%s %s' % (codice, etichetta)] = 'ok: %d partite' % len(fuori)
    return fuori


# Una riga di coppa, in tutte le forme che openfootball le da':
#
#   Real Madrid CF (ESP)      v Marseille (FRA)       2-1 (1-1)
#   Juventus FC (ITA)         v Galatasaray SK (TUR)  3-2 a.e.t. (3-0, 1-0)
#   Paris Saint-Germain (FRA) v Arsenal FC (ENG)      4-3 pen. 1-1 a.e.t. (1-1, 0-1)
#
# La seconda e la terza sono il motivo per cui questa espressione e' cosi'
# lunga, e non e' pignoleria. Fra parentesi c'e' il risultato dei NOVANTA
# MINUTI, ed e' quello su cui si giocano i mercati: una partita finita 1-1 e
# decisa ai rigori e' un PAREGGIO, e registrarla come vittoria di casa
# falserebbe il modello proprio sulle partite che contano di piu', quelle a
# eliminazione. Con due coppie fra parentesi la prima e' il 90' e la seconda il
# primo tempo; con una coppia sola e' il primo tempo, e il 90' e' il numero
# davanti.
RIGA_COPPA = re.compile(
    r'^\s+(?:\d{1,2}:\d{2}\s+)?(.+?)\s+\((\w{3})\)\s+v\s+(.+?)\s+\((\w{3})\)'
    r'(?:\s+(?:\d+-\d+\s+pen\.\s+)?(\d+)-(\d+)(?:\s+a\.e\.t\.)?)?'
    r'(?:\s*\((\d+)-(\d+)(?:\s*,\s*(\d+)-(\d+))?\))?\s*$')

MESI_INGLESI = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
                'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}


ultimo_mese = [None]


def _data_coppa(riga, anno_corrente):
    """"Tue Sep 16 2025", oppure "Wed Sep 17" che eredita l'anno dalla riga
    sopra. Una stagione scavalca il capodanno, quindi l'anno ereditato va
    avanti di uno quando si passa da dicembre a gennaio."""
    m = re.match(r'^\s{2}\w{3}\s+(\w{3})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$', riga)
    if not m:
        return None, anno_corrente
    mese = MESI_INGLESI.get(m.group(1).lower())
    if not mese:
        return None, anno_corrente
    if m.group(3):
        anno = int(m.group(3))
    else:
        # Senza anno scritto lo si eredita dalla riga sopra — ma una stagione
        # scavalca il capodanno, e a gennaio l'anno ereditato e' quello
        # sbagliato. Oggi openfootball lo ripete sempre al cambio, quindi non
        # succede; il giorno che smettesse, l'errore sarebbe di dodici mesi e
        # non si vedrebbe da nessuna parte se non nel decadimento del modello.
        anno = anno_corrente
        if mese <= 7 and (ultimo_mese[0] or 0) >= 8:
            anno += 1
    ultimo_mese[0] = mese
    try:
        return datetime(anno, mese, int(m.group(2))).strftime('%Y-%m-%d'), anno
    except ValueError:
        return None, anno_corrente


def prendi_coppa(repo, etichetta_coppa, stagione, esiti):
    """Il formato testo di openfootball, che accanto a ogni squadra scrive il
    paese fra parentesi — ed e' proprio quel paese a rendere possibile tutto il
    resto, perche' dice a quale campionato appartiene la squadra."""
    url = ('https://raw.githubusercontent.com/openfootball/%s/master/%s/cl.txt'
           % (repo, stagione))
    try:
        testo = B.scarica(url, tentativi=2, attesa=3).decode('utf-8', 'replace')
    except Exception as e:                                # noqa: BLE001
        esiti['%s %s' % (etichetta_coppa, stagione)] = 'non disponibile: %s' % str(e)[:50]
        return [], []
    giocate, future = [], []
    data_corrente, anno = None, int(stagione[:4])
    ultimo_mese[0] = None
    for riga in testo.split('\n'):
        d, anno = _data_coppa(riga, anno)
        if d:
            data_corrente = d
            continue
        m = RIGA_COPPA.match(riga)
        if not m:
            continue
        casa, pc, via, pv, gc, gv, a1, a2, b1, b2 = m.groups()
        voce = {'c': casa.strip(), 'v': via.strip(), 'pc': pc, 'pv': pv,
                'coppa': etichetta_coppa, 's': stagione}
        if data_corrente:
            voce['d'] = data_corrente
        if gc is not None:
            if b1 is not None:
                # Due coppie fra parentesi: la prima e' il risultato dei
                # NOVANTA MINUTI, la seconda il primo tempo, e il numero
                # davanti e' dopo i supplementari. Per una scommessa conta il
                # 90': una partita finita 1-1 e decisa ai rigori e' un
                # PAREGGIO, e registrarla come vittoria falserebbe il modello
                # proprio sulle partite che contano di piu'.
                voce['gc'], voce['gv'] = int(a1), int(a2)
                voce['ptc'], voce['ptv'] = int(b1), int(b2)
                voce['oltre90'] = True
            else:
                voce['gc'], voce['gv'] = int(gc), int(gv)
                if a1 is not None:
                    voce['ptc'], voce['ptv'] = int(a1), int(a2)
            giocate.append(voce)
        else:
            future.append(voce)
    esiti['%s %s' % (etichetta_coppa, stagione)] = 'ok: %d giocate, %d in programma' % (
        len(giocate), len(future))
    return giocate, future


# ────────────────────────────── i nomi ──────────────────────────────
#
# Il pezzo che tiene insieme tutto, ed e' anche quello che si rompe per primo.
#
# football-data scrive "Man City", "Ath Madrid", "Inter". openfootball scrive
# "Manchester City FC", "Club Atletico de Madrid", "FC Internazionale Milano".
# Su cinquantaquattro squadre di coppa, i nomi che coincidono alla lettera sono
# UNO. Senza accoppiarli, ogni squadra esiste due volte — una col nome del
# campionato e una con quello della coppa — e le partite di coppa non fanno da
# ponte fra i campionati, che e' l'unica ragione per cui sono qui.
#
# Si accoppia in tre passaggi, dal piu' automatico al piu' manuale, e alla fine
# si dice quante ne sono rimaste fuori: un accoppiamento sbagliato in silenzio
# sarebbe peggio di uno mancato.

RUMORE_NOME = (r'\b(fc|cf|ac|sc|afc|bc|sk|fk|cd|rc|ss|us|as|kv|sv|vfb|vfl|tsg|bsc|'
               r'ssc|aek|pae|pao|gnk|nk|hnk|rsc|kaa|krc|sl|cp|ca|club|calcio|futebol|'
               r'sporting|clube|de|del|la|el|di|1909|1913|1907|1919|1929|1908|04|05|'
               r'96|1899|09|1846|1893|1900)\b')

# Quelle che nessuna regola puo' indovinare, perche' una delle due fonti usa
# un'abbreviazione o un nome storico diverso. Sette su trentanove: si scrivono.
NOMI_A_MANO = {
    'Manchester City FC': 'Man City',
    'Athletic Club': 'Ath Bilbao',
    'Club Atlético de Madrid': 'Ath Madrid',
    'Eintracht Frankfurt': 'Ein Frankfurt',
    'FC Internazionale Milano': 'Inter',
    'Sporting Clube de Portugal': 'Sp Lisbon',
    'Royale Union Saint-Gilloise': 'St. Gilloise',
    # München / Munich: una traduzione non e' una regola, e' un fatto. Nessuna
    # normalizzazione poteva indovinarla, e infatti il primo giro l'ha lasciata
    # fuori — cioe' il Bayern sarebbe stato una squadra "di cui non so niente".
    'FC Bayern München': 'Bayern Munich',
    'FC Bayern Munchen': 'Bayern Munich',
    # A Parigi ci sono DUE squadre in Ligue 1, e il contenimento le confondeva:
    # "paris" (Paris FC) sta dentro "paris saint germain" (PSG), ed era l'unico
    # candidato, quindi passava senza che niente protestasse. Il PSG e' finito
    # quinto in Europa con la forza del Paris FC per un giro intero.
    'Paris Saint-Germain FC': 'Paris SG',
}


def _senza_fronzoli(nome):
    fuori = unicodedata.normalize('NFD', nome)
    fuori = ''.join(c for c in fuori if unicodedata.category(c) != 'Mn')
    fuori = fuori.lower().replace('ø', 'o').replace('ß', 'ss').replace('ð', 'd').replace('&', ' ')
    fuori = re.sub(r'[^a-z0-9 ]', ' ', fuori)
    fuori = re.sub(RUMORE_NOME, ' ', fuori)
    return re.sub(r'\s+', ' ', fuori).strip()


def accoppia_nomi(partite, coppe, paese_in_campionato):
    """Da nome-di-coppa a nome-di-campionato. Quello che non si accoppia resta
    com'e' — una squadra senza campionato e' una squadra di cui non si sa la
    forza, e va detto, non nascosto."""
    per_paese = {}
    for m in partite:
        per_paese.setdefault(m['p'], set()).update((m['c'], m['v']))
    indici = {}
    for paese, squadre in per_paese.items():
        idx = {}
        for s in squadre:
            idx.setdefault(_senza_fronzoli(s), s)
        indici[paese] = idx

    mappa, orfane = {}, []
    viste = set()
    for m in coppe:
        for nome, paese in ((m['c'], m['pc']), (m['v'], m['pv'])):
            if (nome, paese) in viste:
                continue
            viste.add((nome, paese))
            dove = paese_in_campionato.get(paese, paese)
            idx = indici.get(dove)
            if not idx:
                orfane.append((nome, paese, 'nessun campionato per %s' % paese))
                continue
            # 1. a mano, per i sette casi che nessuna regola indovina
            if nome in NOMI_A_MANO and NOMI_A_MANO[nome] in per_paese.get(dove, ()):
                mappa[nome] = NOMI_A_MANO[nome]
                continue
            chiave = _senza_fronzoli(nome)
            # 2. stesso nome una volta tolti i fronzoli societari
            if chiave in idx:
                mappa[nome] = idx[chiave]
                continue
            # 3. uno contenuto nell'altro. Un candidato solo non basta a stare
            #    tranquilli: a Parigi ci sono due squadre in Ligue 1, "paris"
            #    (Paris FC) sta dentro "paris saint germain" (PSG) ed era
            #    l'unico candidato — il PSG ha girato per un po' con la forza
            #    del Paris FC. Quindi si guarda anche se nel campionato c'e'
            #    qualcun altro che comincia con la stessa parola: se c'e', la
            #    somiglianza non decide niente e si lascia perdere.
            cand = [v for k, v in idx.items() if k and (k in chiave or chiave in k)]
            if len(cand) != 1:
                orfane.append((nome, paese, '%d candidati' % len(cand)))
                continue
            primo = _senza_fronzoli(cand[0]).split(' ')[0]
            omonime = [s for s in per_paese[dove]
                       if _senza_fronzoli(s).split(' ')[0] == primo]
            if len(omonime) > 1:
                orfane.append((nome, paese,
                               'ambiguo fra %s' % ', '.join(sorted(omonime)[:3])))
                continue
            mappa[nome] = cand[0]
    return mappa, orfane


# ────────────────────────────── il calendario della stagione in corso ──────────
#
# openfootball pubblica le coppe a stagione avviata: al 7 settembre 2026 la
# Champions 2026-27 non c'e' ancora, e senza calendario non c'e' niente da
# prevedere — cioe' tutto il resto di questo file servirebbe a fare la storia.
# TheSportsDB invece ha la stagione in corso, e la da' aperta e senza chiave.

ID_CHAMPIONS_TSDB = 4480


def calendario_champions(mappa, squadre_note, esiti):
    """Le prossime di Champions, con i nomi gia' tradotti in quelli dei
    campionati. Chi non si riesce a tradurre entra lo stesso, marcato: una
    partita che c'e' e di cui non so prevedere l'esito e' un fatto, una partita
    che non c'e' e' un buco."""
    fuori = []
    for pezzo in ('eventsnextleague', 'eventspastleague'):
        try:
            grezzo = B.scarica('%s/%s.php?id=%d' % (B.BASE_TSDB, pezzo, ID_CHAMPIONS_TSDB),
                               tentativi=2, attesa=4)
            d = json.loads(grezzo.decode('utf-8'))
        except Exception as e:                            # noqa: BLE001
            esiti['Champions %s' % pezzo] = 'non disponibile: %s' % str(e)[:60]
            continue
        for ev in (d.get('events') or []):
            casa = (ev.get('strHomeTeam') or '').strip()
            via = (ev.get('strAwayTeam') or '').strip()
            data = B.data_iso(ev.get('dateEvent') or (ev.get('strTimestamp') or '')[:10])
            if not (casa and via and data):
                continue
            c, v = mappa.get(casa, casa), mappa.get(via, via)
            # "noto" vuol dire "so quanto vale", cioe' gioca in un campionato
            # che scarico — non "il suo nome sta nella tabella di traduzione".
            # TheSportsDB scrive gia' "Club Brugge" e "Aston Villa", cioe' i
            # nomi di football-data: non sono chiavi da tradurre, sono gia'
            # arrivati. Confondere le due cose marcava come sconosciute proprio
            # le squadre che si conoscono meglio.
            voce = {'c': c, 'v': v, 'd': data, 'coppa': 'Champions League',
                    'noto': c in squadre_note and v in squadre_note}
            ts = ev.get('strTimestamp') or ''
            if len(ts) >= 16:
                ora = B.ora_da_greenwich(ts[11:16], data)
                if ora:
                    voce['o'] = ora
            gc, gv = B.intero(ev.get('intHomeScore')), B.intero(ev.get('intAwayScore'))
            if gc is not None and gv is not None:
                voce['gc'], voce['gv'] = gc, gv
            fuori.append(voce)
        time.sleep(1.5)
    da_giocare = [x for x in fuori if 'gc' not in x]
    esiti['Champions calendario'] = 'ok: %d partite (%d da giocare, %d fra squadre di cui so la forza)' % (
        len(fuori), len(da_giocare), len([x for x in fuori if x['noto']]))
    return fuori


def main():
    esiti = {}
    stagioni = stagioni_recenti(3)
    B.log('Stagioni: %s' % ', '.join(e for _, e in stagioni))

    campionati = []
    for corta, lunga in stagioni:
        for codice, paese, nome_lega in CAMPIONATI:
            B.log('· %s %s' % (codice, lunga))
            campionati.extend(prendi_campionato(codice, corta, lunga, paese, esiti))
            time.sleep(B.PAUSA)

    coppe_giocate, coppe_future = [], []
    for repo, nome in COPPE:
        for _, lunga in stagioni:
            B.log('· %s %s' % (nome, lunga))
            g, f = prendi_coppa(repo, nome, lunga, esiti)
            coppe_giocate.extend(g)
            coppe_future.extend(f)
            time.sleep(1.5)

    # I nomi delle due fonti non coincidono quasi mai: senza accoppiarli, le
    # partite di coppa non fanno da ponte fra i campionati ed e' tutto inutile.
    mappa, orfane = accoppia_nomi(campionati, coppe_giocate + coppe_future,
                                  PAESE_IN_CAMPIONATO)
    for m in coppe_giocate + coppe_future:
        m['c'] = mappa.get(m['c'], m['c'])
        m['v'] = mappa.get(m['v'], m['v'])
        m['noto'] = (m['c'] in mappa.values() or mappa.get(m['c']) is not None) and \
                    (m['v'] in mappa.values() or mappa.get(m['v']) is not None)
    esiti['nomi accoppiati'] = '%d squadre di coppa agganciate al loro campionato' % len(mappa)
    if orfane:
        esiti['nomi non accoppiati'] = '; '.join(
            '%s (%s, %s)' % (n, p_, perche) for n, p_, perche in orfane[:12])

    # Il calendario della stagione in corso, che openfootball non ha ancora.
    try:
        squadre_note = set()
        for m in campionati:
            squadre_note.add(m['c'])
            squadre_note.add(m['v'])
        prossime_cl = calendario_champions(mappa, squadre_note, esiti)
    except Exception as e:                                # noqa: BLE001
        esiti['Champions calendario'] = 'fallito: %s' % e
        prossime_cl = []
    for m in prossime_cl:
        if 'gc' in m:
            if not any(x['c'] == m['c'] and x['v'] == m['v'] and x.get('d') == m['d']
                       for x in coppe_giocate):
                m['s'] = stagioni[0][1]
                coppe_giocate.append(m)
        else:
            coppe_future.append(m)

    paesi = sorted({p for _, p, _ in CAMPIONATI})
    doc = {
        'aggiornato': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'campionati': [{'paese': p, 'nome': n} for _, p, n in CAMPIONATI],
        'paese_in_campionato': PAESE_IN_CAMPIONATO,
        'nomi': mappa,
        'partite': campionati,
        'coppe': coppe_giocate,
        'coppe_calendario': coppe_future,
    }
    with open(FILE_EUROPA, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    kb = os.path.getsize(FILE_EUROPA) // 1024

    # Quante squadre di coppa si riescono a collegare a un campionato? E'
    # l'unico numero che dice se questa impalcatura sta in piedi: una squadra
    # senza campionato e' una squadra di cui non si sa la forza.
    per_paese = {}
    for m in coppe_giocate + coppe_future:
        per_paese.setdefault(m['pc'], set()).add(m['c'])
        per_paese.setdefault(m['pv'], set()).add(m['v'])
    noti = {p for p in paesi} | set(PAESE_IN_CAMPIONATO)
    dentro = sum(len(v) for k, v in per_paese.items() if k in noti)
    fuori_n = sum(len(v) for k, v in per_paese.items() if k not in noti)
    esiti['copertura'] = '%d squadre di coppa su %d hanno un campionato (%d no)' % (
        dentro, dentro + fuori_n, fuori_n)
    esiti['senza campionato'] = ', '.join(
        '%s (%s)' % (s, k) for k, v in sorted(per_paese.items()) if k not in noti for s in sorted(v)
    )[:300] or 'nessuna'

    B.log('')
    B.log('Scritte %d partite di campionato, %d di coppa (%d in programma), %d KB' % (
        len(campionati), len(coppe_giocate), len(coppe_future), kb))
    for k in sorted(esiti):
        B.log('  %s: %s' % (k, esiti[k]))

    percorso = os.environ.get('GITHUB_STEP_SUMMARY')
    if percorso:
        with open(percorso, 'a', encoding='utf-8') as f:
            f.write('## Europa\n\n')
            f.write('%d partite di campionato · %d di coppa · %d KB\n\n' % (
                len(campionati), len(coppe_giocate), kb))
            f.write('| voce | esito |\n|---|---|\n')
            for k in sorted(esiti):
                f.write('| %s | %s |\n' % (k, str(esiti[k])[:100]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
