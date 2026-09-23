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
import datetime
import io
import json
import os
import re
import sys

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(QUI, 'scripts'))

import build_data as B          # noqa: E402

ESITI = []


def _rfc822(giorni_fa):
    """Una data nel formato dei feed RSS, contata da oggi.

    Serve a non scrivere date a mano nei campioni di prova: il codice che si
    sta provando scarta le notizie piu' vecchie di dieci giorni, quindi un
    campione con date fisse smette di funzionare da solo dopo dieci giorni."""
    q = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=giorni_fa)
    giorno = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')[q.weekday()]
    mese = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')[q.month - 1]
    return '%s, %02d %s %d %02d:%02d:00 +0000' % (
        giorno, q.day, mese, q.year, q.hour, q.minute)


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

    # L'apertura tenuta A PARTE dalla chiusura, non al posto suo. Serve a
    # misurare una cosa che nessun backtest di questo progetto poteva porsi:
    # il peso giusto da dare al modello e' lo stesso quando il mercato e'
    # ancora grezzo e quando ha gia' assorbito le formazioni?
    ap = B.quote_extra_da_riga({'AvgCH':'2.55','AvgCD':'3.45','AvgCA':'2.85',
                                'AvgH':'2.40','AvgD':'3.30','AvgA':'3.05',
                                'Avg>2.5':'1.88','Avg<2.5':'1.92'})
    prova('legge le quote di APERTURA', ap.get('qap') == [2.4, 3.3, 3.05], str(ap.get('qap')))
    prova('e l\'apertura Over/Under', ap.get('qapou') == [1.88, 1.92], str(ap.get('qapou')))
    ch = B.quote_da_riga({'AvgCH':'2.55','AvgCD':'3.45','AvgCA':'2.85',
                          'AvgH':'2.40','AvgD':'3.30','AvgA':'3.05'})
    prova('la chiusura resta in q, l\'apertura non la sostituisce',
          ch.get('q') == [2.55, 3.45, 2.85] and 'qap' not in ch, str(ch))
    prova('apertura e chiusura sono due campi distinti, mai lo stesso',
          ap.get('qap') != ch.get('q'))

    prova('qoumax non finisce mai dentro qou',
          'qou' not in B.quote_extra_da_riga({'MaxC>2.5': '2.05', 'MaxC<2.5': '1.98'}) and
          'qoumax' not in B.quote_da_riga({'MaxC>2.5': '2.05', 'MaxC<2.5': '1.98'}))


# ── Understat ───────────────────────────────────────────────────────────────

def test_odds_api():
    """The Odds API: la fonte che ha chiuso il punto singolo di rottura.

    Le cose che possono rompersi in silenzio sono due, e sono entrambe brutte.
    La prima: The Odds API mette il NOME DELLA SQUADRA al posto di "1" e "2",
    quindi l'ordine casa-pareggio-trasferta va ricostruito dai nomi. Fidarsi
    della posizione e' il modo piu' silenzioso di scambiare casa e trasferta —
    nessun errore, solo previsioni al contrario.

    La seconda: la chiave sta nell'URL. Se un'eccezione porta l'URL nel
    messaggio, e il messaggio finisce nel file pubblicato, la chiave e'
    pubblica."""
    casa = {'key': 'h2h', 'outcomes': [
        {'name': 'Sassuolo', 'price': 2.30},
        {'name': 'Monza', 'price': 2.75},
        {'name': 'Draw', 'price': 3.45}]}
    t = B._terna_h2h(casa, 'Monza', 'Sassuolo')
    prova('la terna si ricostruisce dai NOMI, non dalla posizione',
          t == [2.75, 3.45, 2.30], str(t))
    prova('e invertendo le squadre si inverte la terna',
          B._terna_h2h(casa, 'Sassuolo', 'Monza') == [2.30, 3.45, 2.75])
    prova('un nome che non torna non produce una terna sbagliata: non la produce',
          B._terna_h2h(casa, 'Inter', 'Sassuolo') is None)

    ou = {'key': 'totals', 'outcomes': [
        {'name': 'Over', 'price': 1.73, 'point': 2.5},
        {'name': 'Under', 'price': 1.95, 'point': 2.5},
        {'name': 'Over', 'price': 2.90, 'point': 3.5},
        {'name': 'Under', 'price': 1.40, 'point': 3.5}]}
    prova('dell\'Over/Under si prende la linea 2.5 e non un\'altra',
          B._coppia_ou(ou) == [1.73, 1.95], str(B._coppia_ou(ou)))
    prova('se la 2.5 non c\'e non si ripiega su una linea diversa',
          B._coppia_ou({'key': 'totals', 'outcomes': [
              {'name': 'Over', 'price': 2.9, 'point': 3.5},
              {'name': 'Under', 'price': 1.4, 'point': 3.5}]}) is None)

    # il giro intero, con la rete finta
    risposta = json.dumps([{
        'home_team': 'Monza', 'away_team': 'Sassuolo',
        'commence_time': '2026-09-18T18:45:00Z',
        'bookmakers': [
            {'key': 'betfair_ex_eu', 'markets': [
                {'key': 'h2h', 'outcomes': [
                    {'name': 'Monza', 'price': 2.90},
                    {'name': 'Sassuolo', 'price': 2.50},
                    {'name': 'Draw', 'price': 3.60}]}]},
            {'key': 'pinnacle', 'markets': [
                {'key': 'h2h', 'outcomes': [
                    {'name': 'Monza', 'price': 2.80},
                    {'name': 'Sassuolo', 'price': 2.40},
                    {'name': 'Draw', 'price': 3.50}]},
                {'key': 'totals', 'outcomes': [
                    {'name': 'Over', 'price': 1.80, 'point': 2.5},
                    {'name': 'Under', 'price': 2.00, 'point': 2.5}]}]}]}]).encode()
    # si finge scarica_con_intestazioni, non scarica: i crediti rimasti
    # stanno nelle INTESTAZIONI, ed e' l'unico posto dove sono scritti
    vero = B.scarica_con_intestazioni
    B.scarica_con_intestazioni = lambda *a, **k: (
        risposta, {'x-requests-remaining': '438', 'x-requests-used': '62'})
    os.environ['ODDS_API_KEY'] = 'chiave-finta'
    try:
        esiti = {}
        out = B.prendi_odds_api(esiti)
    finally:
        B.scarica_con_intestazioni = vero
        os.environ.pop('ODDS_API_KEY', None)
    prova('una partita torna dalla fonte', len(out) == 1, len(out))
    m = out[0] if out else {}
    prova('la media e la media dei banchi', m.get('q') == [2.85, 3.55, 2.45], str(m.get('q')))
    prova('la migliore e il massimo, non la media', m.get('qmax') == [2.9, 3.6, 2.5], str(m.get('qmax')))
    prova('Betfair finisce in qex, separata dalla media',
          m.get('qex') == [2.9, 3.6, 2.5], str(m.get('qex')))
    prova('e l\'Over/Under arriva', m.get('qou') == [1.8, 2.0], str(m.get('qou')))
    prova('la data e quella della partita', m.get('d') == '2026-09-18', m.get('d'))
    prova('l\'esito dice quante e quante con Betfair',
          'Betfair' in str(esiti.get('The Odds API')), str(esiti.get('The Odds API')))
    # I crediti: se finiscono a meta' mese la fonte smette di rispondere e
    # l'ancoraggio torna spento. Un numero leggibile che non si legge e' un
    # guasto che si sceglie di non vedere.
    prova('i crediti rimasti vengono letti dalle intestazioni',
          '438' in str(esiti.get('The Odds API crediti')), str(esiti.get('The Odds API crediti')))
    prova('e finiscono in un numero, pronti per il meta',
          B._crediti_rimasti(esiti) == 438, B._crediti_rimasti(esiti))
    prova('senza intestazioni non si inventa un numero',
          B._crediti_rimasti({}) is None)

    # senza chiave non si inventa niente e non si sbatte
    os.environ.pop('ODDS_API_KEY', None)
    e2 = {}
    prova('senza chiave si salta invece di rompersi',
          B.prendi_odds_api(e2) == [] and 'saltata' in str(e2.get('The Odds API')))

    # la chiave non deve uscire nei messaggi: sta nell'URL
    def esplode(*a, **k):
        raise RuntimeError('HTTP 401 su %s/odds?apiKey=SEGRETISSIMA' % B.ODDS_API_BASE)
    vero2 = B.scarica_con_intestazioni
    B.scarica_con_intestazioni = esplode
    os.environ['ODDS_API_KEY'] = 'SEGRETISSIMA'
    try:
        e3 = {}
        B.prendi_odds_api(e3)
    finally:
        B.scarica_con_intestazioni = vero2
        os.environ.pop('ODDS_API_KEY', None)
    prova('se la chiamata fallisce, la CHIAVE non finisce nel messaggio',
          'SEGRETISSIMA' not in str(e3.get('The Odds API')), str(e3.get('The Odds API')))

    sorgente = io.open(os.path.join(QUI, 'scripts', 'build_data.py'), encoding='utf-8').read()
    prova('la chiave si legge dall\'ambiente e non e scritta nel codice',
          "os.environ.get('ODDS_API_KEY'" in sorgente and
          not re.search(r"ODDS_API_KEY['\"]?\s*[:=]\s*['\"][0-9a-f]{16}", sorgente))


def test_prima_quota():
    """La prima quota vista non si sovrascrive mai.

    E' la meta' di una misura che finora era impossibile: il valore contro la
    linea di chiusura. Se il prezzo preso batte quello con cui la partita e'
    andata in campo, si e' comprato meglio del mercato — e quella misura
    converge in cinquanta giocate invece che in mille, perche' il risultato di
    una scommessa e' quasi tutto fortuna mentre il prezzo no.

    La cosa che puo' rompersi in silenzio e' una sola, ed e' fatale: che un
    giro successivo riscriva la prima quota con quella di adesso. Allora i due
    estremi diventano lo stesso numero, il CLV viene zero sempre, e sembra solo
    che non ci sia segnale."""
    nuovo = [{'c': 'Monza', 'v': 'Sassuolo', 'd': '2026-09-18',
              'q': [2.90, 3.50, 2.40], 'qex': [3.00, 3.55, 2.56]}]
    primo = B.ricorda_prima_quota([], [dict(x) for x in nuovo])
    prova('al primo giro la quota di adesso diventa la prima',
          primo[0].get('qprimo') == [2.90, 3.50, 2.40], str(primo[0].get('qprimo')))
    prova('e anche quella di Betfair', primo[0].get('qexprimo') == [3.00, 3.55, 2.56])
    prova('con la data di quando e stata vista', bool(primo[0].get('qprimoVisto')))

    # il giro dopo, il mercato si e' mosso
    dopo = [{'c': 'Monza', 'v': 'Sassuolo', 'd': '2026-09-18',
             'q': [2.60, 3.45, 2.70], 'qex': [2.70, 3.50, 2.80]}]
    secondo = B.ricorda_prima_quota(primo, [dict(x) for x in dopo])
    prova('al secondo giro la prima quota NON viene riscritta',
          secondo[0].get('qprimo') == [2.90, 3.50, 2.40], str(secondo[0].get('qprimo')))
    prova('e quella di adesso e la nuova', secondo[0].get('q') == [2.60, 3.45, 2.70])
    prova('anche Betfair tiene la sua prima',
          secondo[0].get('qexprimo') == [3.00, 3.55, 2.56], str(secondo[0].get('qexprimo')))
    prova('la data della prima resta quella della prima',
          secondo[0].get('qprimoVisto') == primo[0].get('qprimoVisto'))

    # una partita diversa non eredita niente da un'altra
    altra = B.ricorda_prima_quota(primo, [{'c': 'Roma', 'v': 'Inter', 'd': '2026-09-19',
                                           'q': [2.69, 3.43, 2.55]}])
    prova('un\'altra partita non eredita la prima quota di quella prima',
          altra[0].get('qprimo') == [2.69, 3.43, 2.55], str(altra[0].get('qprimo')))

    # e senza quote non si inventa una prima quota
    vuota = B.ricorda_prima_quota([], [{'c': 'Lazio', 'v': 'Milan', 'd': '2026-09-26'}])
    prova('senza quote non si inventa una prima quota', 'qprimo' not in vuota[0])

    # la prima quota sopravvive anche se le quote di adesso spariscono
    tenuta = B.da_tenere([{'c': 'Monza', 'v': 'Sassuolo', 'd': '2099-01-01',
                           'qprimo': [2.9, 3.5, 2.4]}], '2026-09-18')
    prova('e sopravvive anche quando le quote di adesso spariscono',
          len(tenuta) == 1 and tenuta[0].get('qprimo') == [2.9, 3.5, 2.4], str(tenuta))


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
    # Le date sono RELATIVE a oggi, non scritte a mano.
    #
    # Prima erano fisse — "Mon, 07 Sep 2026" — e la prova passava. Poi sono
    # passati dieci giorni, il filtro che scarta le notizie vecchie ha iniziato
    # a mangiarsi il campione, e la prova e' esplosa da sola senza che nessuno
    # avesse toccato niente. Una prova che invecchia e' peggio di una prova che
    # manca: fallisce quando il codice e' giusto, e insegna a ignorarla.
    ieri = _rfc822(1)
    rss = ('''<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[Roma, Dybala out: lesione al flessore, salta l&apos;Atalanta]]></title>
<link>https://esempio.it/1</link><pubDate>%s</pubDate></item>
<item><title>Inter-Napoli 2-1: decide Lautaro nel finale</title>
<link>https://esempio.it/2</link><pubDate>%s</pubDate></item>
<item><title>Calciomercato: il Bayern piomba su un big</title>
<link>https://esempio.it/3</link><pubDate>%s</pubDate></item>
<item><title>Milan, il tecnico rassicura</title>
<link>javascript:alert(1)</link><pubDate>%s</pubDate></item>
</channel></rss>''' % (ieri, _rfc822(2), ieri, ieri)).encode()
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

    # La finestra dei dieci giorni, provata APPOSTA invece che per caso.
    # Prima era coperta solo per sbaglio, dalle date fisse del campione che
    # invecchiavano: quando la copertura di una regola dipende dal giorno in
    # cui si lancia la prova, non e' copertura.
    fresco = ('<?xml version="1.0"?><rss version="2.0"><channel>'
              '<item><title>Roma, Dybala out</title><link>https://e.it/a</link>'
              '<pubDate>%s</pubDate></item>'
              '<item><title>Inter, Lautaro out</title><link>https://e.it/b</link>'
              '<pubDate>%s</pubDate></item>'
              '</channel></rss>' % (_rfc822(9), _rfc822(11))).encode()
    vero2, pausa2, fonti2 = B.scarica, B.time.sleep, B.FONTI_NOTIZIE
    B.scarica = lambda *a, **k: fresco
    B.time.sleep = lambda *a: None
    B.FONTI_NOTIZIE = (('Prova', 'http://x'),)
    try:
        esiti2 = {}
        finestra = B.prendi_notizie(['Roma', 'Inter'], esiti2)
    finally:
        B.scarica, B.time.sleep, B.FONTI_NOTIZIE = vero2, pausa2, fonti2
    prova('una notizia di nove giorni fa si tiene',
          any('Dybala' in n['t'] for n in finestra), [n['t'] for n in finestra])
    prova('una di undici giorni no',
          not any('Lautaro' in n['t'] for n in finestra), [n['t'] for n in finestra])
    prova('e lo scarto viene contato come "vecchio", non sparisce in silenzio',
          any('vecchio' in str(v) for v in esiti2.values()), str(esiti2))

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
    # Anche qui le date si contano da oggi. La volta scorsa ne ho sistemato un
    # campione e lasciato questo, e undici giorni dopo e' fallito uguale: il
    # difetto non era quella data, era l'abitudine di scriverle a mano. La prova
    # in fondo al file adesso non la lascia piu' passare.
    rss2 = ('''<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Juve, altro stop: il difensore out un mese</title><link>https://e.it/a</link>
<pubDate>%s</pubDate></item>
<item><title>Nerazzurri scatenati sul mercato</title><link>https://e.it/b</link>
<pubDate>%s</pubDate></item>
<item><title>Ufficiale: la Fiorentina esonera il tecnico</title><link>https://e.it/c</link>
<pubDate>%s</pubDate></item>
</channel></rss>''' % (_rfc822(1), _rfc822(1), _rfc822(1))).encode()
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


def test_cinque_campionati():
    """Cinque campionati indipendenti, e i confini fra loro.

    Il rischio qui non e' che non funzioni: e' che funzioni MESCOLANDO. Un
    filtro sbagliato e le partite della Premier finiscono nell'archivio della
    Serie A, il modello impara che l'Arsenal gioca in Italia, e nessun errore
    lo dice. Le prove qui sotto guardano i confini, non le funzionalita'.
    """
    prova('i campionati sono cinque', len(B.LEGHE) == 5, len(B.LEGHE))
    prova('e la Serie A e la prima, quella con tutto l\'arricchimento',
          B.LEGHE[0]['id'] == 'I1' and B.LEGA_CASA is B.LEGHE[0])
    chiavi = ('id', 'nome', 'paese', 'of', 'odds', 'file')
    prova('ognuno dichiara codice, nome, paese, calendario, sport e file',
          all(all(k in l and l[k] for k in chiavi) for l in B.LEGHE))
    prova('i codici e i file sono tutti diversi',
          len({l['id'] for l in B.LEGHE}) == 5 and len({l['file'] for l in B.LEGHE}) == 5)

    # un CSV con due campionati dentro: e' esattamente come arriva fixtures.csv
    testa = ('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST,'
             'AvgCH,AvgCD,AvgCA\n')
    righe = ('I1,22/08/2026,Inter,Lecce,2,0,15,6,7,2,1.30,5.50,9.00\n'
             'E0,22/08/2026,Arsenal,Chelsea,1,1,12,10,4,5,2.10,3.40,3.60\n'
             'D1,22/08/2026,Bayern Munich,Mainz,3,1,20,5,9,1,1.20,7.00,12.0\n')
    csv_misto = testa + righe
    soloI1 = B.leggi_csv(csv_misto, '2026-27', 'I1')
    soloE0 = B.leggi_csv(csv_misto, '2026-27', 'E0')
    prova('il lettore prende solo il campionato che gli si chiede',
          len(soloI1) == 1 and len(soloE0) == 1 and
          soloI1[0]['c'] != soloE0[0]['c'],
          '%d di I1, %d di E0' % (len(soloI1), len(soloE0)))
    prova('e la Premier non finisce nell\'archivio della Serie A',
          all('Arsenal' not in (p['c'], p['v']) for p in soloI1))
    prova('il valore predefinito resta la Serie A, cosi\' il vecchio codice non cambia',
          len(B.leggi_csv(csv_misto, '2026-27')) == 1 and
          B.leggi_csv(csv_misto, '2026-27')[0]['c'] == soloI1[0]['c'])

    # il controllo sul file scaricato deve rifiutare il campionato sbagliato
    dati = (testa + righe).encode('utf-8') + b' ' * 500
    prova('un file senza il campionato chiesto viene rifiutato',
          B.pare_csv_lega('SP1')(dati) is not None and
          B.pare_csv_lega('I1')(dati) is None,
          str(B.pare_csv_lega('SP1')(dati))[:60])

    # Bundesliga e Ligue 1 hanno diciotto squadre: la soglia stava a venti
    diciotto = []
    squadre = ['S%02d' % i for i in range(18)]
    for g in range(40):
        for i in range(0, 18, 2):
            diciotto.append({'d': '2026-01-%02d' % (1 + g % 28), 's': '2026-27',
                             'c': squadre[i], 'v': squadre[i + 1], 'gc': 1, 'gv': 0})
    prova('un campionato da diciotto squadre non viene scambiato per un file rotto',
          not B.controlla(diciotto), B.controlla(diciotto))


def test_nomi_fra_campionati():
    """Il pezzo piu' rischioso dei cinque campionati, e non si vede.

    Tre fonti scrivono gli stessi club in tre modi: football-data dice "Man
    City", openfootball "Manchester City FC", The Odds API "Manchester City".
    Per la Serie A c'e' una tabella scritta a mano; per quattro campionati in
    piu' sarebbero ottanta squadre l'anno.

    Il risolutore indovina, quindi queste prove guardano il modo in cui puo'
    sbagliare. E i due errori non sono simmetrici: un nome NON riconosciuto e'
    una partita senza quote, che si vede e si conta; un nome riconosciuto MALE
    sono due club fusi in uno, che non da' nessun errore e avvelena il modello
    in silenzio. La prima versione di questo codice ne faceva quattro, di
    fusioni, e l'ha detto solo una prova contro i nomi veri.
    """
    inglesi = ['Arsenal', 'Man City', 'Man United', 'Tottenham', 'Coventry',
               'Hull', 'Sheffield United', "Nott'm Forest", 'West Ham', 'Wolves']
    r = B.RisolutoreNomi(inglesi)
    prova('"Manchester City FC" trova "Man City"',
          r.risolvi('Manchester City FC') == 'Man City', r.risolvi('Manchester City FC'))
    prova('"Tottenham Hotspur FC" trova "Tottenham"',
          r.risolvi('Tottenham Hotspur FC') == 'Tottenham')
    prova('"Spurs" trova "Tottenham" passando dalla tabella',
          r.risolvi('Spurs') == 'Tottenham', r.risolvi('Spurs'))

    # LE FUSIONI: il caso che conta davvero
    prova('"Hull City AFC" NON diventa "Man City"',
          r.risolvi('Hull City AFC') in (None, 'Hull'), r.risolvi('Hull City AFC'))
    prova('"Coventry City FC" NON diventa "Man City"',
          r.risolvi('Coventry City FC') in (None, 'Coventry'), r.risolvi('Coventry City FC'))
    prova('un club mai visto non viene attaccato al piu somigliante',
          r.risolvi('Real Madrid CF') is None, r.risolvi('Real Madrid CF'))

    spagnoli = ['Barcelona', 'Real Madrid', 'Espanol', 'Ath Bilbao', 'Ath Madrid',
                'Betis', 'Sociedad', 'Santander']
    r2 = B.RisolutoreNomi(spagnoli)
    prova('"RCD Espanyol de Barcelona" NON diventa "Barcelona"',
          r2.risolvi('RCD Espanyol de Barcelona') == 'Espanol',
          r2.risolvi('RCD Espanyol de Barcelona'))
    prova('"Real Racing Club de Santander" NON diventa "Real Madrid"',
          r2.risolvi('Real Racing Club de Santander') in (None, 'Santander'),
          r2.risolvi('Real Racing Club de Santander'))
    prova('"Club Atletico de Madrid" trova l\'Atletico e non il Real',
          r2.risolvi('Club Atletico de Madrid') == 'Ath Madrid',
          r2.risolvi('Club Atletico de Madrid'))
    prova('gli accenti non contano: "Atlético" vale "Atletico"',
          r2.risolvi('Club Atl\u00e9tico de Madrid') == 'Ath Madrid')

    francesi = ['Paris SG', 'Paris FC', 'Le Havre', 'Le Mans', 'Rennes', 'Lyon']
    r3 = B.RisolutoreNomi(francesi)
    prova('"Le Mans FC" NON diventa "Le Havre"',
          r3.risolvi('Le Mans FC') == 'Le Mans', r3.risolvi('Le Mans FC'))
    prova('"Paris Saint-Germain FC" NON diventa "Paris FC"',
          r3.risolvi('Paris Saint-Germain FC') == 'Paris SG',
          r3.risolvi('Paris Saint-Germain FC'))
    prova('"Stade Rennais FC 1901" trova "Rennes"',
          r3.risolvi('Stade Rennais FC 1901') == 'Rennes',
          r3.risolvi('Stade Rennais FC 1901'))

    tedeschi = ['Bayern Munich', 'Dortmund', "M'gladbach", 'Leverkusen', 'FC Koln']
    r4 = B.RisolutoreNomi(tedeschi)
    prova('"FC Bayern Munchen" trova "Bayern Munich"',
          r4.risolvi('FC Bayern M\u00fcnchen') == 'Bayern Munich',
          r4.risolvi('FC Bayern M\u00fcnchen'))
    prova('"Borussia Monchengladbach" trova il Gladbach e non il Dortmund',
          r4.risolvi('Borussia M\u00f6nchengladbach') == "M'gladbach",
          r4.risolvi('Borussia M\u00f6nchengladbach'))
    # "Borussia" da sola: con un archivio che ne contiene DUE deve rinunciare.
    # (Con l'archivio di football-data, che scrive "Dortmund" senza "Borussia",
    # ce n'e' una sola e risolverla e' giusto: l'ambiguita' e' una proprieta'
    # dell'elenco, non del nome.)
    r5 = B.RisolutoreNomi(['Borussia Dortmund', "M'gladbach", 'Bayern Munich'])
    prova('con due Borussia in archivio, "Borussia" da sola rinuncia',
          r5.risolvi('Borussia') is None, r5.risolvi('Borussia'))
    prova('ma "Borussia Dortmund" per intero si risolve lo stesso',
          r5.risolvi('Borussia Dortmund') == 'Borussia Dortmund')

    # e chi non si risolve deve USCIRE, non entrare con un nome a caso
    righe = [{'d': '2026-10-10', 'c': 'Manchester City FC', 'v': 'Arsenal FC', 'q': [2, 3, 4]},
             {'d': '2026-10-10', 'c': 'Squadra Inventata', 'v': 'Arsenal FC', 'q': [2, 3, 4]}]
    fuori = r.applica(righe)
    prova('una partita con un nome non riconosciuto non entra',
          len(fuori) == 1 and fuori[0]['c'] == 'Man City', fuori)
    prova('e il numero dei non riconosciuti finisce nel resoconto',
          'NON riconosciuti' in r.resoconto(), r.resoconto())


def test_giro_leggero_aggiorna_le_quote():
    """Il giro leggero esiste per le quote, e deve farlo per TUTTI i campionati.

    Se aggiornasse solo la Serie A, gli altri quattro mostrerebbero i prezzi di
    stanotte mentre si gioca — cioe' l'ancoraggio spento proprio dove serve, e
    spento in silenzio, che e' il guasto peggiore di questo progetto.
    """
    sorgente = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'scripts', 'build_data.py')
    testo = io.open(sorgente, encoding='utf-8').read()
    prova('il giro leggero aggiorna le quote anche degli altri campionati',
          'aggiorna_lega_leggero' in testo and
          re.search(r'else:[\s\S]{0,900}aggiorna_lega_leggero\(lega', testo) is not None)
    prova('e non riscarica sei stagioni di CSV per farlo',
          'prendi_football_data' not in testo.split('def aggiorna_lega_leggero')[1]
          .split('def ')[0])
    prova('il conto dei crediti guarda tutte e cinque le leghe, e prende il piu basso',
          'min(restano)' in testo)


def test_notizie_degli_altri_campionati():
    """Le notizie erano solo Serie A: tre feed italiani, e zero negli altri
    quattro archivi.

    Il pezzo delicato non e' scaricare i feed, e' capire DI CHI parlano. Per
    la Serie A c'e' voluta una tabella di soprannomi scritta a mano — senza,
    la Gazzetta dava zero titoli riconosciuti su novantanove, perche' scrive
    "Juve" e "Nerazzurri". Per ottanta squadre in quattro lingue quella
    tabella non si scrive: si riusa il risolutore dei nomi, e la prova qui
    sotto e' che funzioni davvero sui modi in cui i giornali scrivono i club.
    """
    prova('c\'e un feed per ognuno degli altri quattro campionati',
          sorted(B.FONTI_NOTIZIE_LEGA.keys()) == ['D1', 'E0', 'F1', 'SP1'])
    prova('e piu di uno per campionato, cosi uno che cade non lascia a secco',
          all(len(v) >= 2 for v in B.FONTI_NOTIZIE_LEGA.values()))

    inglesi = ['Tottenham', 'Arsenal', 'Man City', 'Liverpool', 'Wolves', 'Newcastle']
    r = B.RisolutoreNomi(inglesi)
    casi = [('Spurs', 'Tottenham'), ('Wolverhampton', 'Wolves'),
            ('Manchester', 'Man City'), ('Arsenal', 'Arsenal')]
    ok = all(r._cerca(a) == b for a, b in casi)
    prova('il risolutore riconosce i club come li scrivono i giornali', ok,
          [(a, r._cerca(a)) for a, b in casi])

    spagnoli = B.RisolutoreNomi(['Ath Madrid', 'Real Madrid', 'Barcelona', 'Espanol', 'Betis'])
    prova('e vale anche in spagnolo: "Atleti" non diventa il Real',
          spagnoli._cerca('Atletico') == 'Ath Madrid', spagnoli._cerca('Atletico'))

    # e il feed finto: l'aggancio deve passare dal risolutore, non dai soprannomi
    rss = ('<rss><channel>'
           '<item><title>Spurs beat Arsenal in the derby</title>'
           '<pubDate>%s</pubDate><link>https://x/1</link></item>'
           '<item><title>Nessuna squadra qui dentro</title>'
           '<pubDate>%s</pubDate><link>https://x/2</link></item>'
           '</channel></rss>') % (_rfc822(1), _rfc822(1))
    vero, vera_pausa = B.scarica, B.time.sleep
    B.scarica = lambda *a, **k: rss.encode('utf-8')
    B.time.sleep = lambda *a, **k: None
    try:
        esiti = {}
        fuori = B.prendi_notizie(inglesi, esiti, (('Prova', 'http://x'),), r)
    finally:
        B.scarica, B.time.sleep = vero, vera_pausa
    prova('un titolo inglese si aggancia alle squadre che nomina',
          len(fuori) == 1 and set(fuori[0]['sq']) == {'Tottenham', 'Arsenal'},
          [x['sq'] for x in fuori])
    prova('e quello che non nomina nessuno resta fuori',
          all('Nessuna squadra' not in x['t'] for x in fuori))

    sorgente = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'scripts', 'build_data.py')
    testo = io.open(sorgente, encoding='utf-8').read()
    prova('e ogni campionato le prende davvero, non solo la Serie A',
          'prendi_notizie(sorted(risolutore.noti)' in testo)


def test_crediti_solo_a_chi_gioca():
    """Un credito speso per chiedere le quote di partite che non ci sono.

    Il 23 settembre il turno successivo era a diciassette giorni, e i giri
    chiedevano comunque le quote a tutti e cinque i campionati, tre volte al
    giorno. Quattrocentocinquanta crediti al mese su cinquecento, quasi tutti
    per niente.
    """
    oggi = datetime.datetime.now(datetime.timezone.utc).date()

    def fra(n):
        return {'d': (oggi + datetime.timedelta(days=n)).isoformat(), 'c': 'A', 'v': 'B'}
    prova('una partita domani conta come "gioca presto"',
          B.gioca_presto([fra(1)], 3))
    prova('una fra dieci giorni no, se la finestra e di tre',
          not B.gioca_presto([fra(10)], 3))
    prova('ma si, se la finestra e di dieci', B.gioca_presto([fra(10)], 10))
    prova('un calendario vuoto non fa spendere niente',
          not B.gioca_presto([], 10) and not B.gioca_presto(None, 10))
    prova('una partita di ieri non tiene in vita la chiamata',
          not B.gioca_presto([fra(-2)], 3))

    # e la cosa che conta: quando si salta, si DICE
    esiti = {}
    fuori = B.quote_se_gioca(esiti, {'id': 'E0', 'odds': 'x'}, [fra(20)], 3, 'E0 quote')
    prova('saltare non chiama l\'API', fuori == [])
    prova('e il risparmio finisce nel riepilogo invece di sparire',
          'saltata' in esiti.get('E0 quote', '') and 'credito' in esiti.get('E0 quote', ''),
          esiti.get('E0 quote'))

    sorgente = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            'scripts', 'build_data.py')
    testo = io.open(sorgente, encoding='utf-8').read()
    prova('il giro completo guarda largo e il leggero stretto',
          'FINESTRA_QUOTE_COMPLETO = 10' in testo and 'FINESTRA_QUOTE_LEGGERO = 3' in testo)
    prova('e nessuna chiamata alle quote resta senza il controllo',
          testo.count('prendi_odds_api(') == 2, testo.count('prendi_odds_api('))


def test_service_worker():
    """Il service worker e il traffico che fa fare a un telefono.

    Il file della Serie A va sempre chiesto fresco, e c'e' una ragione
    misurata: GitHub Pages dice ai browser di tenersi le cose per dieci
    minuti, e senza saltare la cache si finiva a guardare i dati di ieri
    chiedendosi perche' non cambiava niente.

    Ma gli archivi degli altri quattro campionati sono 2.9 MB, e la stessa
    regola li farebbe ri-scaricare a ogni apertura. Tre megabyte di traffico
    ogni volta che si apre l'app fuori casa, per file che cambiano tre volte
    al giorno."""
    percorso = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sw.js')
    if not os.path.exists(percorso):
        return
    testo = io.open(percorso, encoding='utf-8').read()
    prova('gli archivi degli altri campionati non saltano la cache del browser',
          re.search(r"grosso\s*=\s*/\\/data\\/leghe", testo) is not None and
          '!grosso' in testo)
    prova('ma la pagina e il campionato di casa si', "e.request.mode === 'navigate'" in testo
          and 'html|js|json|webmanifest' in testo)
    prova('e la versione della cache e stata alzata, o il vecchio worker resterebbe',
          "seriea-v3'" not in testo)


def test_orari_del_giro():
    """Gli orari nel workflow e la condizione che decide completo/leggero
    devono parlare della stessa cosa.

    Non e' pedanteria: la condizione diceva '17 11,17,23 * * *', che non era
    nessuno degli orari programmati. Non ha mai fatto match, quindi TUTTI i
    giri hanno riletto l'archivio intero, sei volte al giorno, per mesi, in
    silenzio. Con cinque campionati sarebbero centottanta CSV al giorno.

    Questa prova non guarda il comportamento: guarda che i due elenchi si
    nominino a vicenda. E' l'unica cosa che avrebbe trovato quel difetto.
    """
    percorso = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            '.github', 'workflows', 'aggiorna-dati.yml')
    if not os.path.exists(percorso):
        return
    testo = io.open(percorso, encoding='utf-8').read()
    programmati = set(re.findall(r"- cron: '([^']+)'", testo))
    nominati = set(re.findall(r"github\.event\.schedule == '([^']+)'", testo))
    prova('ci sono degli orari programmati', bool(programmati), programmati)
    prova('ogni orario nominato dalla condizione esiste davvero fra quelli programmati',
          nominati and nominati <= programmati,
          'nominati ma non programmati: %s' % (nominati - programmati))
    prova('e almeno un giro resta completo',
          programmati - nominati, 'tutti leggeri: %s' % programmati)


def main():
    test_cinque_campionati()
    test_nomi_fra_campionati()
    test_giro_leggero_aggiorna_le_quote()
    test_orari_del_giro()
    test_service_worker()
    test_crediti_solo_a_chi_gioca()
    test_notizie_degli_altri_campionati()
    test_validatori()
    test_quote()
    test_calendario_ha_le_stesse_quote()
    test_odds_api()
    test_prima_quota()
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

    # ── la guardia contro le prove che invecchiano ──────────────────────────
    #
    # Due volte in due settimane questo file e' esploso da solo, su codice
    # giusto, perche' un campione aveva una data scritta a mano e il codice
    # scarta le notizie piu' vecchie di dieci giorni. La prima volta ne ho
    # corretto uno; il secondo e' scoppiato undici giorni dopo.
    #
    # Il difetto non era la data: era l'abitudine. Questa prova guarda il file
    # stesso e pretende che le date dei campioni si contino da oggi.
    sorgente_prove = io.open(os.path.abspath(__file__), encoding='utf-8').read()
    fisse = re.findall(r'<pubDate>[A-Z][a-z][a-z], \d', sorgente_prove)
    prova('nessun campione ha una data scritta a mano: invecchierebbe',
          not fisse, '%d trovate' % len(fisse))

    larghezza = max(len(n) for n, _, _ in ESITI)
    falliti = 0
    for nome, ok, dettaglio in ESITI:
        # str() sul dettaglio, non concatenazione diretta: una prova che passa
        # una lista come dettaglio e' comodissima da scrivere, e faceva
        # esplodere il REPORTER invece della prova — cioe' nascondeva quale
        # prova stesse fallendo proprio nel momento in cui serviva saperlo.
        print('%s  %s%s' % ('ok  ' if ok else 'FALLITO', nome.ljust(larghezza),
                            '' if ok else '   → %s' % (dettaglio,)))
        if not ok:
            falliti += 1
    print('\n%d prove, %d fallite' % (len(ESITI), falliti))
    return 1 if falliti else 0


if __name__ == '__main__':
    sys.exit(main())
