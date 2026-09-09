#!/usr/bin/env python3
"""
Controlla i pezzi di scripts/build_data.py che leggono le fonti, senza rete.

Ogni fonte nuova è un modo nuovo di ricevere spazzatura: una pagina che cambia
formato, un CSV con le colonne rinominate, una partita datata al giorno dopo.
Qui si dà in pasto allo script esattamente quella spazzatura e si controlla che
la rifiuti invece di trasformarla in dati.

    python3 tools/test_fonti.py
"""

import csv
import io
import json
import os
import sys

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(QUI, 'scripts'))

import build_data as B          # noqa: E402

ESITI = []


def prova(nome, condizione, dettaglio=''):
    ESITI.append((nome, bool(condizione), dettaglio))


# ── il validatore dei CSV ────────────────────────────────────────────────────

def test_validatori():
    html = b'<!DOCTYPE html><html><head><title>404</title></head><body>' + b'x' * 500
    prova('una pagina HTML non passa per un CSV', B.pare_csv_seriea(html))
    prova('un file troppo corto viene rifiutato', B.pare_csv_seriea(b'Div,Date\n'))

    storico = b'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\n' + b'I1,17/08/2024,Inter,Torino,2,0\n' * 20
    prova('un CSV di Serie A passa', B.pare_csv_seriea(storico) is None,
          str(B.pare_csv_seriea(storico)))

    # Il calendario di football-data.co.uk contiene tutte le leghe ordinate per
    # data: in pausa nazionali la Serie A può non comparire nei primi 3000 byte,
    # o non comparire affatto. Pretenderla lì è il difetto che teneva le partite
    # in arrivo senza quote.
    lontano = (b'Div,Date,Time,HomeTeam,AwayTeam,AvgH,AvgD,AvgA\n'
               + b'E0,05/09/2026,15:00,Arsenal,Chelsea,2.10,3.40,3.50\n' * 90
               + b'I1,06/09/2026,20:45,Inter,Milan,2.05,3.50,3.60\n')
    prova('il calendario passa anche se la Serie A sta in fondo',
          B.pare_csv_calendario(lontano) is None, str(B.pare_csv_calendario(lontano)))
    prova('il vecchio validatore invece lo rifiutava (è il bug che si è corretto)',
          B.pare_csv_seriea(lontano) is not None)
    prova('anche il calendario rifiuta una pagina HTML', B.pare_csv_calendario(html))


# ── le quote ────────────────────────────────────────────────────────────────

def test_quote():
    r = {'AvgH': '2.10', 'AvgD': '3.40', 'AvgA': '3.50', 'Avg>2.5': '1.80', 'Avg<2.5': '2.00'}
    q = B.quote_da_riga(r)
    prova('legge le quote medie 1X2', q.get('q') == [2.1, 3.4, 3.5], str(q))
    prova('legge le quote Over/Under', q.get('qou') == [1.8, 2.0], str(q))

    # il calendario porta spesso solo le colonne di un operatore
    solo_b365 = {'B365H': '1.95', 'B365D': '3.60', 'B365A': '4.00', 'B365>2.5': '1.85', 'B365<2.5': '1.95'}
    q2 = B.quote_da_riga(solo_b365)
    prova('ripiega su un singolo bookmaker quando manca la media',
          q2.get('q') == [1.95, 3.6, 4.0] and q2.get('qou') == [1.85, 1.95], str(q2))

    prova('una quota impossibile viene ignorata',
          'q' not in B.quote_da_riga({'AvgH': '0.5', 'AvgD': '3.4', 'AvgA': '3.5'}))
    prova('quote incomplete vengono ignorate',
          'q' not in B.quote_da_riga({'AvgH': '2.10', 'AvgD': '', 'AvgA': '3.5'}))

    # La quota MIGLIORE del mercato sull'Over/Under: ricarico quasi nullo,
    # quindi togliendolo si sbaglia quasi niente. Tenuta a parte da 'qou'
    # finche' non e' misurata, perche' un secondo campo che si scambia col
    # primo per sbaglio e' il modo piu' silenzioso di rovinare l'ancoraggio.
    e = B.quote_extra_da_riga({'MaxC>2.5': '2.05', 'MaxC<2.5': '1.98',
                               'Max>2.5': '1.99', 'Max<2.5': '1.90'})
    prova('legge l\'Over/Under migliore del mercato, di chiusura',
          e.get('qoumax') == [2.05, 1.98], str(e.get('qoumax')))
    prova('e ripiega sull\'apertura quando la chiusura non c\'e',
          B.quote_extra_da_riga({'Max>2.5': '1.99', 'Max<2.5': '1.90'}).get('qoumax') == [1.99, 1.9])
    prova('il ricarico della migliore e piu piccolo di quello della media',
          (1 / 2.05 + 1 / 1.98) < (1 / 1.80 + 1 / 2.00))
    # bet365 e' uno dei banchi su cui si gioca davvero: il suo ricarico non e'
    # una media europea, e' un numero suo. Tenuto a parte da 'q' perche' serve
    # a sapere quanto costa, non a prevedere.
    b3 = B.quote_extra_da_riga({'B365CH': '2.55', 'B365CD': '3.45', 'B365CA': '2.85',
                                'B365H': '2.50', 'B365D': '3.40', 'B365A': '2.80'})
    prova('legge bet365 di chiusura', b3.get('qb365') == [2.55, 3.45, 2.85], str(b3.get('qb365')))
    prova('e ripiega sull\'apertura', B.quote_extra_da_riga(
          {'B365H': '2.50', 'B365D': '3.40', 'B365A': '2.80'}).get('qb365') == [2.5, 3.4, 2.8])
    prova('bet365 non finisce dentro q',
          'q' not in B.quote_extra_da_riga({'B365CH': '2.55', 'B365CD': '3.45', 'B365CA': '2.85'}))

    prova('qoumax non finisce mai dentro qou',
          'qou' not in B.quote_extra_da_riga({'MaxC>2.5': '2.05', 'MaxC<2.5': '1.98'}) and
          'qoumax' not in B.quote_da_riga({'MaxC>2.5': '2.05', 'MaxC<2.5': '1.98'}))


# ── Understat ───────────────────────────────────────────────────────────────

def test_understat():
    dentro = json.dumps([{
        'id': '1', 'isResult': True,
        'h': {'title': 'AC Milan'}, 'a': {'title': 'Parma Calcio 1913'},
        'goals': {'h': '2', 'a': '1'}, 'xG': {'h': '1.873', 'a': '0.914'},
        'datetime': '2025-09-14 20:45:00'
    }, {
        'id': '2', 'isResult': False,
        'h': {'title': 'Inter'}, 'a': {'title': 'Hellas Verona'},
        'xG': {'h': None, 'a': None}, 'datetime': '2025-09-21 18:00:00'
    }])
    # Understat scrive ogni carattere come \xNN dentro una stringa JavaScript
    sfuggito = ''.join('\\x%02x' % ord(c) if ord(c) < 128 else c for c in dentro)
    pagina = "<script>\n\tvar datesData = JSON.parse('%s');\n</script>" % sfuggito

    righe = B._json_da_understat(pagina, 'datesData')
    prova('srotola il JSON nascosto nella pagina', righe is not None and len(righe) == 2,
          str(type(righe)))

    fuori = []
    for m in (righe or []):
        if not m.get('isResult'):
            continue
        xc, xv = B.num((m.get('xG') or {}).get('h')), B.num((m.get('xG') or {}).get('a'))
        fuori.append({'c': B.nome(m['h']['title']), 'v': B.nome(m['a']['title']),
                      'd': B.data_iso(m['datetime'][:10]), 'xgc': xc, 'xgv': xv})
    prova('salta le partite non ancora giocate', len(fuori) == 1, str(fuori))
    prova('traduce i nomi delle squadre',
          fuori and fuori[0]['c'] == 'Milan' and fuori[0]['v'] == 'Parma', str(fuori))
    prova('legge gli xG come numeri',
          fuori and abs(fuori[0]['xgc'] - 1.873) < 1e-9, str(fuori))
    prova('una pagina cambiata non esplode: restituisce nulla',
          B._json_da_understat('<html>niente di utile</html>', 'datesData') is None)

    # tre forme viste in giro: pretenderne una sola è il modo di perdere una
    # fonte che funziona ancora
    corto = json.dumps([{'isResult': False}])
    sfug = ''.join('\\x%02x' % ord(c) for c in corto)
    for etichetta, forma in (
            ('senza punto e virgola', "var datesData = JSON.parse('%s')\n" % sfug),
            ('senza var', "datesData = JSON.parse('%s');" % sfug),
            ('con apici doppi', 'datesData = JSON.parse("%s");' % sfug)):
        prova('legge anche la forma %s' % etichetta,
              B._json_da_understat(forma, 'datesData') is not None)

    # la diagnosi deve distinguere i casi, altrimenti si tira a indovinare
    sfida = 'Just a moment...' + 'x' * 3000 + 'cf-browser-verification'
    prova('riconosce la verifica di Cloudflare',
          'Cloudflare' in B._perche_understat_non_va(sfida, 'datesData'),
          B._perche_understat_non_va(sfida, 'datesData'))
    prova('riconosce una pagina troppo corta',
          'byte' in B._perche_understat_non_va('vuoto', 'datesData'))
    prova('riconosce il formato cambiato',
          'formato' in B._perche_understat_non_va('x' * 3000 + ' datesData = qualcosa', 'datesData'),
          B._perche_understat_non_va('x' * 3000 + ' datesData = qualcosa', 'datesData'))


# ── ESPN ────────────────────────────────────────────────────────────────────

def test_espn():
    prova('+250 all\'americana fa 3.50', B._americana_a_decimale('+250') == 3.5)
    prova('−140 all\'americana fa 1.714', abs(B._americana_a_decimale('-140') - 1.714) < 0.001)
    prova('zero non è una quota', B._americana_a_decimale(0) is None)
    prova('vuoto non è una quota', B._americana_a_decimale('') is None)

    comp = {'odds': [{'homeTeamOdds': {'moneyLine': -110},
                      'awayTeamOdds': {'moneyLine': 320},
                      'drawOdds': {'moneyLine': 240}}]}
    q = B._quote_espn(comp)
    prova('legge le tre vie dal blocco quote', q and len(q) == 3 and q[0] < q[2], str(q))
    prova('un blocco quote incompleto viene saltato',
          B._quote_espn({'odds': [{'homeTeamOdds': {'moneyLine': -110}}]}) is None)
    prova('nessuna quota non è un errore', B._quote_espn({}) is None)


# ── innesto: la regola che protegge l'archivio ──────────────────────────────

def test_innesto():
    archivio = {
        '2025-09-14|Milan|Parma': {'d': '2025-09-14', 'c': 'Milan', 'v': 'Parma', 'gc': 2, 'gv': 1},
        '2025-09-21|Inter|Verona': {'d': '2025-09-21', 'c': 'Inter', 'v': 'Verona', 'gc': 1, 'gv': 1},
    }
    prima = len(archivio)

    # stessa partita datata al giorno dopo da un'altra fonte
    tocche, orfane = B.innesta(archivio, [
        {'d': '2025-09-15', 'c': 'Milan', 'v': 'Parma', 'xgc': 1.9, 'xgv': 0.8},
    ], ('xgc', 'xgv'))
    prova('riconosce la stessa partita datata al giorno dopo', tocche == 1 and orfane == 0,
          'tocche=%d orfane=%d' % (tocche, orfane))
    prova('gli xG sono finiti sulla partita giusta',
          archivio['2025-09-14|Milan|Parma'].get('xgc') == 1.9)

    # una partita che l'archivio non conosce NON deve entrare
    tocche, orfane = B.innesta(archivio, [
        {'d': '2025-09-14', 'c': 'Squadra Inventata', 'v': 'Altra', 'xgc': 1.0, 'xgv': 1.0},
    ], ('xgc', 'xgv'))
    prova('una partita sconosciuta non viene inventata',
          orfane == 1 and len(archivio) == prima, 'archivio=%d' % len(archivio))

    # solo_se_vuoto non deve sovrascrivere quello che c'è già
    archivio['2025-09-21|Inter|Verona']['arb'] = 'Orsato'
    B.innesta(archivio, [{'d': '2025-09-21', 'c': 'Inter', 'v': 'Verona', 'arb': 'Altro'}],
              ('arb',), solo_se_vuoto=('arb',))
    prova('non sovrascrive un arbitro già noto',
          archivio['2025-09-21|Inter|Verona']['arb'] == 'Orsato')

    # una data troppo lontana è un'altra partita
    tocche, orfane = B.innesta(archivio, [
        {'d': '2025-10-30', 'c': 'Milan', 'v': 'Parma', 'xgc': 3.0, 'xgv': 0.1},
    ], ('xgc', 'xgv'))
    prova('sei settimane dopo è il ritorno, non la stessa partita', orfane == 1)


# ── calendario a pezzi ──────────────────────────────────────────────────────

def test_calendario():
    base = [{'d': '2026-09-06', 'c': 'Inter', 'v': 'Milan', 'giornata': 'Matchday 3'}]
    extra = [{'d': '2026-09-06', 'c': 'Inter', 'v': 'Milan', 'o': '20:45',
              'q': [2.05, 3.5, 3.6], 'stadio': 'San Siro'},
             {'d': '2026-09-07', 'c': 'Roma', 'v': 'Lazio', 'o': '18:00'}]
    fuori = B.unisci_calendario(base, extra)
    inter = [p for p in fuori if p['c'] == 'Inter'][0]
    prova('le quote si attaccano alla partita già in calendario',
          inter.get('q') == [2.05, 3.5, 3.6] and inter.get('o') == '20:45', str(inter))
    prova('la giornata di partenza non si perde', inter.get('giornata') == 'Matchday 3')
    prova('una partita nuova viene aggiunta', len(fuori) == 2)
    prova('non si duplica nulla',
          len([p for p in fuori if p['c'] == 'Inter']) == 1)

    spostata = B.unisci_calendario(base, [{'d': '2026-09-08', 'c': 'Inter', 'v': 'Milan', 'o': '20:45'}])
    prova('un anticipo spostato di due giorni resta una partita sola', len(spostata) == 1,
          str(spostata))

    # La regressione da non rifare: football-data.co.uk conosce solo la settimana
    # in arrivo, openfootball tutta la stagione. Tenere il primo perché ha
    # risposto vuol dire passare da 370 partite a 10.
    squadre = ['Sq%02d' % i for i in range(20)]
    stagionale = []
    for g in range(37):
        for k in range(0, 20, 2):
            stagionale.append({'d': '2026-%02d-%02d' % (9 + g // 4, 1 + (g % 4) * 7),
                               'c': squadre[k], 'v': squadre[(k + 1 + g) % 20]})
    ravvicinato = [dict(p, o='20:45', q=[2.0, 3.3, 3.8]) for p in stagionale[:10]]
    fuso = B.unisci_calendario(stagionale, ravvicinato)
    prova('il calendario di stagione non si accorcia quando arriva quello ravvicinato',
          len(fuso) == len(stagionale), '%d invece di %d' % (len(fuso), len(stagionale)))
    prova('e le quote della settimana in arrivo ci sono lo stesso',
          len([p for p in fuso if p.get('q')]) == 10,
          str(len([p for p in fuso if p.get('q')])))


# ── giocatori: una squadra alla volta, e si ricorda dov'era ─────────────────

def test_freno_api():
    """Il piano gratuito accetta dieci richieste al minuto. Senza freno le prime
    dieci passano e le altre vengono rifiutate: tre rose su venti e nessun
    errore in vista."""
    import time as _t
    chiamate = []
    vero_scarica, vera_pausa = B.scarica, B.PAUSA_API_FOOTBALL
    try:
        B.scarica = lambda url, **kw: (chiamate.append(_t.time()), b'{"response":[]}')[1]
        B.PAUSA_API_FOOTBALL = 0.25
        B._ultima_api_football[0] = 0
        c = [0]
        for i in range(3):
            B.api_football('players', {'page': i}, 'k', c)
        salti = [chiamate[i+1] - chiamate[i] for i in range(len(chiamate)-1)]
        prova('fra una richiesta e l\'altra il freno aspetta',
              all(x >= 0.24 for x in salti), str([round(x, 3) for x in salti]))
        prova('e le richieste vengono contate tutte', c[0] == 3, str(c[0]))
    finally:
        B.scarica, B.PAUSA_API_FOOTBALL = vero_scarica, vera_pausa


# ── le quote non si buttano via quando la fonte è giù ───────────────────────

def test_quote_tenute():
    """football-data.co.uk ha risposto 503 per giorni e le partite in arrivo
    sono rimaste senza quote per una settimana, con l'ancoraggio al mercato
    spento e nessuno che se ne accorgeva. Le quote di ieri sono vecchie di un
    giorno; nessuna quota è vecchia di sempre."""
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    oggi = _dt.now(_tz.utc).date()
    dopo = (oggi + _td(days=2)).isoformat()
    prima = (oggi - _td(days=5)).isoformat()
    oggi_iso = oggi.isoformat()

    stagionale = [{'d': dopo, 'c': 'Inter', 'v': 'Milan'},
                  {'d': dopo, 'c': 'Roma', 'v': 'Lazio'}]
    archiviato = [{'d': dopo, 'c': 'Inter', 'v': 'Milan', 'o': '20:45', 'q': [2.0, 3.4, 3.8]},
                  {'d': prima, 'c': 'Como', 'v': 'Genoa', 'o': '18:00', 'q': [1.9, 3.5, 4.0]}]
    tenuto = B.da_tenere(archiviato, oggi_iso)

    cal = B.unisci_calendario(stagionale, tenuto)
    cal = B.unisci_calendario(cal, [])            # la fonte delle quote è giù
    inter = [p for p in cal if p['c'] == 'Inter'][0]
    prova('con la fonte giù le quote di ieri restano', inter.get('q') == [2.0, 3.4, 3.8], str(inter))
    # L'orario invece NON si tiene: viene da due fonti in due fusi diversi, e uno
    # tenuto da ieri non lo riguarda piu' nessuno. Lo rida' openfootball.
    prova('l\'orario non si tiene: verrebbe conservato anche se sbagliato',
          inter.get('o') is None, str(inter))
    prova('una partita già giocata non torna in calendario', len(cal) == 2, str(len(cal)))
    prova('le partite senza quote note restano senza',
          [p for p in cal if p['c'] == 'Roma'][0].get('q') is None)

    # quando la fonte torna, i prezzi nuovi devono avere la meglio
    fresco = [{'d': dopo, 'c': 'Inter', 'v': 'Milan', 'q': [2.2, 3.3, 3.5]}]
    cal2 = B.unisci_calendario(B.unisci_calendario(stagionale, tenuto), fresco)
    prova('quando la fonte torna, la quota nuova sostituisce quella tenuta',
          [p for p in cal2 if p['c'] == 'Inter'][0].get('q') == [2.2, 3.3, 3.5])


def test_punteggi_openfootball():
    """openfootball ha cambiato forma tre volte e non ha riscritto il passato."""
    moderno = {'score': {'ft': [2, 1], 'ht': [1, 0]}}
    prova('formato con ft e ht', B._punteggio_openfootball(moderno) == ((2, 1), (1, 0)))
    secco = {'score': [0, 0]}
    prova('formato con la lista secca — quello che faceva sparire il 2025-26',
          B._punteggio_openfootball(secco) == ((0, 0), None))
    antico = {'score1': 3, 'score2': 2, 'score1i': 1, 'score2i': 2}
    prova('formato antico score1/score2', B._punteggio_openfootball(antico) == ((3, 2), (1, 2)))
    prova('partita non giocata', B._punteggio_openfootball({'score': None}) == (None, None))
    prova('lista malformata non esplode', B._punteggio_openfootball({'score': [1]}) == (None, None))

    # La prova che conta: una sola riga scritta all'antica non deve portarsi via
    # le altre trecentosettantanove.
    matches = [{'round': 'Matchday 1', 'date': '2025-08-23', 'time': '18:30',
                'team1': 'Genoa CFC', 'team2': 'US Lecce', 'score': [0, 0]}]
    matches += [{'round': 'Matchday 1', 'date': '2025-08-24', 'time': '20:45',
                 'team1': 'AC Milan', 'team2': 'AS Roma',
                 'score': {'ft': [2, 1], 'ht': [1, 1]}}] * 3
    sorgente = json.dumps({'name': 'x', 'matches': matches}).encode('utf-8')
    vero = B.scarica
    B.scarica = lambda *a, **k: sorgente
    try:
        giocate, future = B.prendi_openfootball('2025-26')
    finally:
        B.scarica = vero
    prova('una riga vecchio formato non fa sparire la stagione', len(giocate) == 4,
          '%d partite lette su 4' % len(giocate))
    prova('il primo tempo arriva insieme al finale',
          len([g for g in giocate if g.get('ptc') is not None]) == 3)
    prova("l'orario arriva da openfootball", giocate[0].get('o') == '18:30')
    impossibile = json.dumps({'matches': [
        {'date': '2025-08-23', 'team1': 'AC Milan', 'team2': 'AS Roma',
         'score': {'ft': [1, 0], 'ht': [2, 0]}}]}).encode('utf-8')
    B.scarica = lambda *a, **k: impossibile
    try:
        strane, _ = B.prendi_openfootball('2025-26')
    finally:
        B.scarica = vero
    prova('un primo tempo con piu gol del finale viene ignorato',
          strane[0].get('ptc') is None and strane[0]['gc'] == 1)


def test_orari():
    """Tre fonti, tre fusi. Dall'app deve uscirne uno solo."""
    prova('Londra 19:45 → Roma 20:45', B.ora_da_londra('19:45') == '20:45')
    prova('Londra 14:00 → Roma 15:00', B.ora_da_londra('14:00') == '15:00')
    prova('orario mancante resta mancante', B.ora_da_londra(None) is None)
    prova('orario non numerico resta mancante', B.ora_da_londra('ND') is None)
    prova('mezzanotte non diventa le 24', B.ora_da_londra('23:30') == '00:30')
    prova('Greenwich 18:45 in agosto → Roma 20:45',
          B.ora_da_greenwich('18:45', '2026-08-31') == '20:45')
    prova('Greenwich 19:45 in dicembre → Roma 20:45',
          B.ora_da_greenwich('19:45', '2026-12-06') == '20:45')
    prova('ora legale: il 29 marzo 2026 è già estate', B._ora_legale('2026-03-29'))
    prova('ora legale: il 28 marzo 2026 è ancora inverno', not B._ora_legale('2026-03-28'))
    prova('ora legale: il 25 ottobre 2026 è già inverno', not B._ora_legale('2026-10-25'))
    prova('ora legale: il 24 ottobre 2026 è ancora estate', B._ora_legale('2026-10-24'))

    # La migrazione si fa una volta sola: due giri di seguito non devono
    # spostare gli orari di due ore.
    doc = {'partite': [{'d': '2026-08-31', 'o': '19:45'}],
           'calendario': [{'d': '2026-09-12', 'o': '20:45'}]}
    prova('i risultati si spostano', B._porta_a_ora_italiana(doc) == 1)
    prova('e si spostano di un\'ora sola', doc['partite'][0]['o'] == '20:45')
    prova('il calendario non si tocca: e un misto, e li nessuna correzione va bene per tutti',
          doc['calendario'][0]['o'] == '20:45')
    prova('la seconda volta non tocca niente', B._porta_a_ora_italiana(doc) == 0)
    prova('e l\'orario resta quello', doc['partite'][0]['o'] == '20:45')


def test_porta_football_data():
    """Se il www e giu ma il sito no, si passa dall'altra porta — e per tutti i
    file, non solo per quello dove il guasto e stato notato."""
    B._porta_buona[0] = None
    chiamati = []

    def finto(url, **k):
        chiamati.append(url)
        if 'www.' in url:
            raise RuntimeError('HTTP Error 503: Service Temporarily Unavailable')
        return b'contenuto'

    vero = B.scarica
    B.scarica = finto
    try:
        esiti = {}
        prova('il file arriva dalla porta che risponde',
              B.scarica_football_data('fixtures.csv', esiti) == b'contenuto')
        prova('e il riepilogo dice quale',
              esiti.get('football-data indirizzo') == 'https://football-data.co.uk')
        quante = len(chiamati)
        B.scarica_football_data('mmz4281/2627/I1.csv', esiti)
        prova('la porta trovata vale anche per gli altri file, senza ricercarla',
              len(chiamati) == quante + 1,
              '%d richieste in piu invece di 1' % (len(chiamati) - quante))

        B._porta_buona[0] = None
        B.scarica = lambda url, **k: (_ for _ in ()).throw(RuntimeError('503'))
        caduto = False
        try:
            B.scarica_football_data('fixtures.csv', esiti)
        except RuntimeError:
            caduto = True
        prova('se non risponde nessuna porta, si alza le mani', caduto)
    finally:
        B.scarica = vero
        B._porta_buona[0] = None


def test_nessun_orario_grezzo():
    """La prova che serviva la prima volta: la conversione era stata messa nel
    lettore dei risultati e dimenticata in quello del calendario, e infatti il
    calendario e uscito con gli orari di Londra mentre i risultati avevano
    quelli giusti. Qui si controlla la causa, non il sintomo."""
    sorgente = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'scripts', 'build_data.py')
    with open(sorgente, encoding='utf-8') as f:
        testo = f.read()
    grezzi = [r for r in testo.split('\n')
              if "get('Time')" in r and 'ora_da_' not in r]
    prova("nessun orario di football-data entra senza passare dal convertitore",
          not grezzi, ' / '.join(x.strip()[:70] for x in grezzi))
    grezzi_espn = [r for r in testo.split('\n')
                   if "iso[11:16]" in r and 'ora_da_' not in r]
    prova('nessun orario ESPN entra senza passare dal convertitore',
          not grezzi_espn, ' / '.join(x.strip()[:70] for x in grezzi_espn))


def test_thesportsdb():
    """La fonte piu svelta: pubblica partita per partita invece che a giornata
    chiusa, ed e' l'unica che il lunedi mattina ha i risultati del venerdi."""
    risposta = json.dumps({'events': [
        {'idEvent': '1', 'strTimestamp': '2026-09-06T18:45:00', 'dateEvent': '2026-09-06',
         'strHomeTeam': 'Juventus', 'strAwayTeam': 'AC Milan',
         'intHomeScore': '2', 'intAwayScore': '1', 'intRound': '3'},
        {'idEvent': '2', 'strTimestamp': '2026-09-07T16:30:00', 'dateEvent': '2026-09-07',
         'strHomeTeam': 'Cagliari', 'strAwayTeam': 'US Lecce',
         'intHomeScore': None, 'intAwayScore': None, 'intRound': '3'},
        {'idEvent': '3', 'dateEvent': None, 'strHomeTeam': 'Boh', 'strAwayTeam': 'Mah'},
    ]}).encode('utf-8')
    vero = B.scarica
    B.scarica = lambda *a, **k: risposta
    vera_pausa = B.time.sleep
    B.time.sleep = lambda *a: None
    try:
        esiti = {}
        giocate, future = B.prendi_thesportsdb('2026-27', esiti)
    finally:
        B.scarica = vero
        B.time.sleep = vera_pausa
    # Delle tre righe finte una sola ha il punteggio: le altre sono una partita
    # da giocare e una riga senza data. Fra le "giocate" deve restare quella.
    prova('fra le giocate finisce solo quella col risultato', len(giocate) == 1,
          '%d invece di 1' % len(giocate))
    prova('e quella da giocare finisce fra le prossime',
          any(x['c'] == 'Cagliari' for x in future))
    j = giocate[0]
    prova('i nomi passano dal normalizzatore', j['c'] == 'Juventus' and j['v'] == 'Milan',
          '%s / %s' % (j['c'], j['v']))
    prova('il risultato arriva come numero', j['gc'] == 2 and j['gv'] == 1)
    prova('la giornata arriva con lo stesso nome delle altre fonti',
          j.get('giornata') == 'Matchday 3', j.get('giornata'))
    # 18:45 a Greenwich il 6 settembre = 20:45 a Roma
    prova("l'orario arriva convertito, non copiato", j.get('o') == '20:45', j.get('o'))
    prova('una riga senza data viene lasciata perdere',
          all(x['c'] != 'Boh' for x in giocate + future))

    B.scarica = lambda *a, **k: b'non sono json'
    B.time.sleep = lambda *a: None
    try:
        esiti2 = {}
        g2, f2 = B.prendi_thesportsdb('2026-27', esiti2)
    finally:
        B.scarica = vero
        B.time.sleep = vera_pausa
    prova('se la fonte risponde male non si porta giu il giro',
          g2 == [] and f2 == [] and any('fallita' in v for v in esiti2.values()))


def test_notizie():
    """I titoli non entrano nel modello, quindi le prove non riguardano la
    previsione: riguardano che si legga il formato giusto, che si riconosca la
    squadra, e soprattutto che roba scritta da altri non finisca dritta
    nell'app."""
    rss = b'''<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[Roma, Dybala out: lesione al flessore, salta l&apos;Atalanta]]></title>
<link>https://esempio.it/1</link><pubDate>Mon, 07 Sep 2026 08:00:00 +0200</pubDate></item>
<item><title>Inter-Napoli 2-1: decide Lautaro nel finale</title>
<link>https://esempio.it/2</link><pubDate>Sun, 06 Sep 2026 22:30:00 +0200</pubDate></item>
<item><title>Calciomercato: il Bayern piomba su un big</title>
<link>https://esempio.it/3</link><pubDate>Mon, 07 Sep 2026 09:00:00 +0200</pubDate></item>
<item><title>Milan, il tecnico rassicura</title>
<link>javascript:alert(1)</link><pubDate>Mon, 07 Sep 2026 07:00:00 +0200</pubDate></item>
</channel></rss>'''
    vero, vera_pausa, vere_fonti = B.scarica, B.time.sleep, B.FONTI_NOTIZIE
    B.scarica = lambda *a, **k: rss
    B.time.sleep = lambda *a: None
    B.FONTI_NOTIZIE = (('Prova', 'http://x'),)
    try:
        esiti = {}
        out = B.prendi_notizie(['Roma', 'Inter', 'Napoli', 'Atalanta', 'Milan'], esiti)
    finally:
        B.scarica, B.time.sleep, B.FONTI_NOTIZIE = vero, vera_pausa, vere_fonti

    per_titolo = {n['t'][:20]: n for n in out}
    prova('legge il CDATA senza inciamparci',
          any('Dybala' in n['t'] for n in out), [n['t'][:40] for n in out])
    dyb = [n for n in out if 'Dybala' in n['t']][0]
    prova('riconosce tutte le squadre nominate nel titolo',
          dyb['sq'] == ['Atalanta', 'Roma'], dyb['sq'])
    prova('riconosce che e un\'assenza', dyb['ass'] is True)
    prova('un titolo di cronaca non viene scambiato per un\'assenza',
          [n for n in out if 'Lautaro' in n['t']][0]['ass'] is False)
    prova('un titolo che non nomina nessuna squadra di A viene lasciato fuori',
          not any('Bayern' in n['t'] for n in out))

    # La parte che conta: il contenuto lo scrive qualcun altro.
    mil = [n for n in out if n['t'].startswith('Milan')]
    prova('un link che non e http viene buttato, la notizia resta',
          len(mil) == 1 and mil[0]['l'] == '', mil[0]['l'] if mil else 'notizia persa')
    prova('nessun titolo tenuto porta con se un link non http',
          all(n['l'] == '' or n['l'].startswith(('http://', 'https://')) for n in out))
    prova('i titoli sono tagliati, cosi un feed non puo occupare tutto',
          all(len(n['t']) <= 180 for n in out))

    # una fonte rotta non deve portarsi giu il resto
    B.scarica = lambda *a, **k: b'<html>non sono un rss</html>'
    B.time.sleep = lambda *a: None
    B.FONTI_NOTIZIE = (('Rotta', 'http://x'),)
    try:
        esiti2 = {}
        out2 = B.prendi_notizie(['Roma'], esiti2)
    finally:
        B.scarica, B.time.sleep, B.FONTI_NOTIZIE = vero, vera_pausa, vere_fonti
    prova('un feed che non e un feed non fa saltare niente', out2 == [], out2)

    # I titoli veri non chiamano le squadre come le tabelle: "Juve" e' scritto
    # piu' spesso di "Juventus", e "Nerazzurri" non contiene "Inter". Senza i
    # soprannomi la Gazzetta ha dato zero titoli riconosciuti su novantanove.
    rss2 = b'''<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Juve, altro stop: il difensore out un mese</title><link>https://e.it/a</link>
<pubDate>Mon, 07 Sep 2026 08:00:00 +0200</pubDate></item>
<item><title>Nerazzurri scatenati sul mercato</title><link>https://e.it/b</link>
<pubDate>Mon, 07 Sep 2026 08:00:00 +0200</pubDate></item>
<item><title>Ufficiale: la Fiorentina esonera il tecnico</title><link>https://e.it/c</link>
<pubDate>Mon, 07 Sep 2026 08:00:00 +0200</pubDate></item>
</channel></rss>'''
    B.scarica = lambda *a, **k: rss2
    B.time.sleep = lambda *a: None
    B.FONTI_NOTIZIE = (('Prova', 'http://x'),)
    try:
        esiti3 = {}
        out3 = B.prendi_notizie(['Juventus', 'Inter', 'Fiorentina'], esiti3)
    finally:
        B.scarica, B.time.sleep, B.FONTI_NOTIZIE = vero, vera_pausa, vere_fonti
    prova('"Juve" viene riconosciuta come Juventus',
          any(n['sq'] == ['Juventus'] for n in out3), [n['sq'] for n in out3])
    prova('"Nerazzurri" viene riconosciuto come Inter',
          any(n['sq'] == ['Inter'] for n in out3), [n['sq'] for n in out3])
    fio = [n for n in out3 if n['sq'] == ['Fiorentina']]
    prova('un esonero viene marcato come cambio di panchina',
          len(fio) == 1 and fio[0]['pan'] is True and fio[0]['ass'] is False,
          fio[0] if fio else 'non trovata')

    # Quando una fonte non da' niente, il riepilogo deve dire perche'.
    rss3 = b'''<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Tennis, finale a New York</title><link>https://e.it/d</link></item>
<item><title>Ciclismo, la Vuelta si decide oggi</title><link>https://e.it/e</link></item>
</channel></rss>'''
    B.scarica = lambda *a, **k: rss3
    B.time.sleep = lambda *a: None
    B.FONTI_NOTIZIE = (('Muta', 'http://x'),)
    try:
        esiti4 = {}
        B.prendi_notizie(['Juventus'], esiti4)
    finally:
        B.scarica, B.time.sleep, B.FONTI_NOTIZIE = vero, vera_pausa, vere_fonti
    detto = esiti4.get('notizie Muta', '')
    prova('zero titoli riconosciuti si spiega, non si conta e basta',
          'Per esempio' in detto and 'Tennis' in detto, detto[:90])


def test_notizie_a_ogni_giro():
    """Il dato piu deperibile dell'archivio non puo essere quello aggiornato
    meno spesso. Un esonero delle due del pomeriggio non si vede il mattino
    dopo."""
    sorgente = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'scripts', 'build_data.py')
    with open(sorgente, encoding='utf-8') as f:
        testo = f.read()
    prova('le notizie non sono saltate nei giri leggeri',
          'notizie = [] if leggero' not in testo and 'prendi_notizie(squadre_attive' in testo)
    # e tutto il resto invece deve restare saltato: sono giri leggeri per un motivo
    prova('i giri leggeri restano leggeri su tutto il resto',
          'if not leggero else' in testo or '0 if leggero else' in testo or
          '[] if leggero else' in testo)


def test_xg_e_quote_di_chiusura():
    """Due cose che erano nel file da sempre e che non guardavo.

    Gli xG veri stanno nelle colonne HxG e AxG, piene al cento per cento. Per
    mesi il modello li ha dedotti dai tiri mentre provava a scaricarli da
    Understat, che blocca l'indirizzo della Action: erano gia' arrivati, in un
    file che scarico tutti i giorni.

    E le quote: la C in mezzo al nome vuol dire CHIUSURA, cioe' il prezzo con
    cui la partita e' andata in campo, dopo formazioni e infortuni. E' la stima
    migliore che esista. Usavo quelle di apertura."""
    riga = ('Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG,Referee,'
            'HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,HxG,AxG,'
            'AvgH,AvgD,AvgA,AvgCH,AvgCD,AvgCA,Avg>2.5,Avg<2.5,AvgC>2.5,AvgC<2.5\n'
            'I1,31/08/2026,17:30,Lecce,Roma,0,4,0,3,X,7,15,3,8,9,8,2,1,1,1,0,0,0.85,2.31,'
            '7.00,4.00,1.50,7.28,4.05,1.46,2.10,1.80,2.04,1.73\n')
    p = B.leggi_csv(riga, '2026-27')[0]
    prova('gli xG veri arrivano dal CSV, non dai tiri',
          p.get('xgc') == 0.85 and p.get('xgv') == 2.31, (p.get('xgc'), p.get('xgv')))
    prova('e le quote sono quelle di CHIUSURA, non di apertura',
          p.get('q') == [7.28, 4.05, 1.46], p.get('q'))
    prova('anche per over e under', p.get('qou') == [2.04, 1.73], p.get('qou'))

    # Le partite in ARRIVO non hanno una chiusura: non e' ancora avvenuta.
    # Li' si deve scendere fino all'apertura, se no restano senza quote.
    solo_apertura = ('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5\n'
                     'I1,12/09/2026,Lazio,Milan,1,1,2.50,3.40,2.80,1.90,1.95\n')
    p2 = B.leggi_csv(solo_apertura, '2026-27')[0]
    prova('senza chiusura si scende all\'apertura invece di restare senza',
          p2.get('q') == [2.5, 3.4, 2.8], p2.get('q'))
    prova('e la chiusura, quando c\'e, viene prima nell\'elenco',
          B.COLONNE_1X2[0] == ('AvgCH', 'AvgCD', 'AvgCA'), B.COLONNE_1X2[0])


def test_calendario_ha_le_stesse_quote():
    """Il buco piu' costoso che ci sia stato in questo script.

    Ancorarsi a Betfair invece che alla quota media e' stato MISURATO come il
    miglior guadagno della stagione. Ma il calendario — cioe' le partite in
    arrivo, le uniche su cui si scommette — leggeva soltanto quote_da_riga, e
    quindi di Betfair non aveva niente: il guadagno arrivava solo alle partite
    gia' giocate. Un miglioramento che non arriva dove serve non e' un
    miglioramento, e nessuna prova se ne accorgeva.

    Questa prova guarda il SORGENTE: dove si legge una riga di quote, si devono
    leggere entrambe le famiglie."""
    sorgente = io.open(os.path.join(QUI, 'scripts', 'build_data.py'),
                       encoding='utf-8').read()
    normali = sorgente.count('m.update(quote_da_riga(r))')
    extra = sorgente.count('m.update(quote_extra_da_riga(r))')
    prova('ovunque si leggano le quote si leggono anche quelle extra',
          normali > 0 and normali == extra,
          'quote_da_riga: %d, quote_extra_da_riga: %d' % (normali, extra))

    riga = ('Div,Date,Time,HomeTeam,AwayTeam,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5,'
            'BFEH,BFED,BFEA,MaxH,MaxD,MaxA,Max>2.5,Max<2.5\n'
            'I1,12/09/2026,20:45,Lazio,Milan,2.50,3.40,2.80,1.90,1.95,'
            '2.62,3.55,2.90,2.60,3.52,2.88,1.95,2.00\n')
    fut = []
    for r in csv.DictReader(io.StringIO(riga)):
        m = {'d': '2026-09-12'}
        m.update(B.quote_da_riga(r))
        m.update(B.quote_extra_da_riga(r))
        fut.append(m)
    p = fut[0]
    prova('una partita in arrivo porta Betfair', p.get('qex') == [2.62, 3.55, 2.9], p.get('qex'))
    prova('e la migliore del mercato', p.get('qmax') == [2.6, 3.52, 2.88], p.get('qmax'))
    prova('Betfair ha meno ricarico della media, anche in arrivo',
          (1 / 2.62 + 1 / 3.55 + 1 / 2.9) < (1 / 2.5 + 1 / 3.4 + 1 / 2.8))
    prova('e le quote in arrivo sopravvivono a una fonte irraggiungibile',
          B.da_tenere([p], '2026-09-01')[0].get('qex') == [2.62, 3.55, 2.9])


def main():
    test_validatori()
    test_quote()
    test_calendario_ha_le_stesse_quote()
    test_xg_e_quote_di_chiusura()
    test_understat()
    test_espn()
    test_innesto()
    test_calendario()
    test_quote_tenute()
    test_freno_api()
    test_punteggi_openfootball()
    test_orari()
    test_porta_football_data()
    test_nessun_orario_grezzo()
    test_thesportsdb()
    test_notizie()
    test_notizie_a_ogni_giro()

    larghezza = max(len(n) for n, _, _ in ESITI)
    falliti = 0
    for nome, ok, dettaglio in ESITI:
        print('%s  %s%s' % ('ok  ' if ok else 'FALLITO', nome.ljust(larghezza),
                            '' if ok else '   → ' + dettaglio))
        if not ok:
            falliti += 1
    print('\n%d prove, %d fallite' % (len(ESITI), falliti))
    return 1 if falliti else 0


if __name__ == '__main__':
    sys.exit(main())
