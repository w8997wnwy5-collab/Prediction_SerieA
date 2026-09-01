#!/usr/bin/env python3
"""
Controlla i pezzi di scripts/build_data.py che leggono le fonti, senza rete.

Ogni fonte nuova è un modo nuovo di ricevere spazzatura: una pagina che cambia
formato, un CSV con le colonne rinominate, una partita datata al giorno dopo.
Qui si dà in pasto allo script esattamente quella spazzatura e si controlla che
la rifiuti invece di trasformarla in dati.

    python3 tools/test_fonti.py
"""

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

def test_giocatori():
    """Chiedendoli per lega ne tornano quarantatré e la paginazione dichiara di
    aver finito: il piano gratuito serve una fetta e non lo dice. Per squadra
    tornano tutti, ma non ci stanno in una quota giornaliera sola — quindi la
    parte che conta è che si fermi e riprenda da dove era."""
    squadre = [(1, 'Inter'), (2, 'Milan'), (3, 'Roma')]

    def finta(url, **kw):
        if 'players' not in url or 'team=' not in url:
            raise RuntimeError('endpoint non previsto: %s' % url)
        tid = int(url.split('team=')[1].split('&')[0])
        pag = int(url.split('page=')[1].split('&')[0]) if 'page=' in url else 1
        gio = [{'player': {'id': tid*100+pag*10+k, 'name': 'Gioc%d-%d-%d' % (tid, pag, k)},
                'statistics': [{'league': {'id': 135}, 'team': {'name': squadre[tid-1][1]},
                                'games': {'appearences': 20, 'minutes': 1500, 'position': 'Defender'},
                                'cards': {'yellow': 6, 'yellowred': 0, 'red': 0}}]}
               for k in range(2)]
        return json.dumps({'response': gio, 'paging': {'current': pag, 'total': 2}}).encode()

    vero_scarica, vera_pausa, vera_quota = B.scarica, B.PAUSA_API_FOOTBALL, B.MAX_RICHIESTE_API
    try:
        B.scarica, B.PAUSA_API_FOOTBALL = finta, 0
        esiti, c = {}, [0]
        B.MAX_RICHIESTE_API = 4
        lista1, fatte1 = B.prendi_statistiche_giocatori('k', esiti, c, 2024, squadre, [])
        prova('con poca quota si ferma invece di andare avanti a vuoto',
              len(fatte1) < 3 and bool(esiti.get('giocatori quota')), str(fatte1))

        c2 = [0]
        B.MAX_RICHIESTE_API = 70
        lista2, fatte2 = B.prendi_statistiche_giocatori('k', esiti, c2, 2024, squadre, fatte1)
        prova('al giro dopo riprende da dove era', len(fatte2) == 3, str(fatte2))
        prova('e non rifà le squadre già prese',
              all(x['s'] not in fatte1 for x in lista2),
              ', '.join(sorted({x['s'] for x in lista2})))

        distinti = {x['n'] for x in lista1 + lista2}
        prova('messi insieme i due giri non manca nessuno', len(distinti) == 12, str(len(distinti)))
        uno = (lista1 + lista2)[0]
        prova('legge gialli, minuti e presenze',
              uno['g'] == 6 and uno['m'] == 1500 and uno['p'] == 20, str(uno))

        # chi gioca pochissimo è rumore, non un dato
        def poco(url, **kw):
            return json.dumps({'response': [{'player': {'id': 9, 'name': 'Panchinaro'},
                'statistics': [{'league': {'id': 135}, 'team': {'name': 'Inter'},
                                'games': {'appearences': 3, 'minutes': 40},
                                'cards': {'yellow': 1}}]}],
                'paging': {'current': 1, 'total': 1}}).encode()
        B.scarica = poco
        c3 = [0]
        lista3, _ = B.prendi_statistiche_giocatori('k', {}, c3, 2024, [(1, 'Inter')], [])
        prova('chi ha giocato quaranta minuti viene lasciato fuori', len(lista3) == 0, str(lista3))
    finally:
        B.scarica, B.PAUSA_API_FOOTBALL, B.MAX_RICHIESTE_API = vero_scarica, vera_pausa, vera_quota


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


def main():
    test_validatori()
    test_quote()
    test_understat()
    test_espn()
    test_innesto()
    test_calendario()
    test_giocatori()
    test_freno_api()

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
