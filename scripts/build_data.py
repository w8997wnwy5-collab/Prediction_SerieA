#!/usr/bin/env python3
"""
Scarica e normalizza i dati della Serie A.

Gira dentro GitHub Actions, senza dipendenze fuori dalla libreria standard.

Fonti, in ordine:
  1. football-data.co.uk — risultati, tiri, falli, corner, cartellini, arbitro
     e quote di chiusura. Sei stagioni, dalla più recente all'indietro.
  2. openfootball/football.json — solo risultati e calendario, ma non si arrabbia
     mai: fa da riserva stagione per stagione.
  3. API-Football (facoltativa, chiave gratuita) — arbitro e statistiche partita
     dove le prime due non arrivano.

Tre regole che vengono prima di tutto il resto:
  · quello che è già stato scaricato NON si perde: il file esistente viene unito
    a quello nuovo, campo per campo;
  · una risposta che non è un CSV della Serie A è un errore, non "zero partite";
  · quello che non ha funzionato finisce scritto in data/meta.json, non nel nulla.
"""

import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(QUI, 'data')
FILE_DATI = os.path.join(DATA, 'serie-a.json')
FILE_META = os.path.join(DATA, 'meta.json')

# ────────────────────────────── i campionati ──────────────────────────────
#
# Cinque, e sono INDIPENDENTI: non si scommette su Inter-Arsenal, quindi le
# forze di due campionati non devono essere confrontabili fra loro. Ogni lega
# ha il suo modello, la sua calibrazione dei tiri, il suo vantaggio di campo.
# E' molto piu' semplice — e molto piu' solido — del lavoro sulla Champions,
# che aveva bisogno di ponti stimati sulle coppe per rendere paragonabili le
# forze di paesi diversi.
#
# Sondato prima di scrivere (scripts/_sonda_leghe.py), su sei stagioni:
#
#   Serie A     I1   1950 partite    tiri 100%  quote 100%  O/U 100%  handicap 100%
#   Premier     E0   1950 partite    tiri 100%  quote 100%  O/U 100%  handicap 100%
#   Bundesliga  D1   1566 partite    tiri 100%  quote 100%  O/U 100%  handicap 100%
#   Liga        SP1  1969 partite    tiri 100%  quote 100%  O/U 100%  handicap 100%
#   Ligue 1     F1   1723 partite    tiri 100%  quote 100%  O/U 100%  handicap 100%
#
# Tutto quello che il modello usa c'e' dappertutto. Mancano due cose, e
# nessuna delle due pesa: gli xG veri ci sono solo nella stagione in corso —
# ma anche in Serie A e' cosi', ed e' stato MISURATO che gli xG dedotti dai
# tiri non si distinguono da quelli veri nel prevedere i gol (z = -1.40 su 100
# osservazioni, tools/misura_xg.js) — e l'arbitro manca a tutte tranne la
# Premier, ma l'effetto dell'arbitro e' stato misurato ed e' nullo, per quello
# non e' nel modello.
#
# 9158 partite in un file solo farebbero 3.9 MB, che un telefono scarica a
# ogni apertura. Quindi un file per lega, e un indice che dice quali ci sono.
LEGHE = [
    {'id': 'I1',  'nome': 'Serie A',        'paese': 'Italia',
     'of': 'it.1', 'odds': 'soccer_italy_serie_a',      'file': 'serie-a.json'},
    {'id': 'E0',  'nome': 'Premier League', 'paese': 'Inghilterra',
     'of': 'en.1', 'odds': 'soccer_epl',                'file': 'leghe/E0.json'},
    {'id': 'D1',  'nome': 'Bundesliga',     'paese': 'Germania',
     'of': 'de.1', 'odds': 'soccer_germany_bundesliga', 'file': 'leghe/D1.json'},
    {'id': 'SP1', 'nome': 'Liga',           'paese': 'Spagna',
     'of': 'es.1', 'odds': 'soccer_spain_la_liga',      'file': 'leghe/SP1.json'},
    {'id': 'F1',  'nome': 'Ligue 1',        'paese': 'Francia',
     'of': 'fr.1', 'odds': 'soccer_france_ligue_one',   'file': 'leghe/F1.json'},
]
LEGA_CASA = LEGHE[0]            # la Serie A: quella con tutto l'arricchimento

N_STAGIONI = 6
PAUSA = 5           # secondi fra un download e l'altro: la fonte non ama le raffiche
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/127.0.0.0 Safari/537.36')
LEGA_APIFOOTBALL = 135      # Serie A
MAX_RICHIESTE_API = 70      # il piano gratuito ne dà 100 al giorno: ne lasciamo da parte
N_STAGIONI_XG = 6           # Understat copre la Serie A dal 2014: prendiamo le stesse sei
MAX_ESPN_DETTAGLI = 60      # una richiesta per partita: si riempie l'archivio un pezzo al giorno

def log(*a):
    print(*a, flush=True)


# ────────────────────────────── rete ──────────────────────────────

def scarica(url, tentativi=4, attesa=6, controllo=None, intestazioni=None):
    """Scarica e, se serve, controlla che il contenuto sia quello giusto.
    Un sito che risponde 200 con una pagina di errore è il modo più subdolo di
    fallire: senza questo controllo il file finisce vuoto e nessuno se ne accorge."""
    ultimo = None
    for i in range(tentativi):
        try:
            testa = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'it,en;q=0.8'}
            testa.update(intestazioni or {})
            req = urllib.request.Request(url, headers=testa)
            with urllib.request.urlopen(req, timeout=60) as r:
                dati = r.read()
            if controllo:
                problema = controllo(dati)
                if problema:
                    raise RuntimeError('risposta non valida (%s)' % problema)
            return dati
        except Exception as e:            # noqa: BLE001
            ultimo = e
            log('    tentativo %d: %s' % (i + 1, e))
            if i < tentativi - 1:
                time.sleep(attesa * (i + 1))
    raise RuntimeError(str(ultimo))


def scarica_con_intestazioni(url, tentativi=4, attesa=6):
    """Come scarica(), ma torna anche le intestazioni della risposta.

    Serve a una cosa sola e importante: The Odds API dichiara i crediti rimasti
    in un'intestazione, non nel corpo. Se quei crediti finiscono a meta' mese la
    fonte smette di rispondere e l'ancoraggio torna spento — cioe' esattamente
    il guasto silenzioso che questa fonte era venuta a chiudere. Un numero che
    si puo' leggere e non si legge e' un guasto che si sceglie di non vedere."""
    ultimo = None
    for i in range(tentativi):
        try:
            testa = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'it,en;q=0.8'}
            req = urllib.request.Request(url, headers=testa)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read(), dict(r.headers)
        except Exception as e:            # noqa: BLE001
            ultimo = e
            log('    tentativo %d: %s' % (i + 1, e))
            if i < tentativi - 1:
                time.sleep(attesa * (i + 1))
    raise RuntimeError(str(ultimo))


def _pare_csv(dati, byte_minimi=400):
    """Controlli comuni a tutti i CSV di football-data.co.uk."""
    if not dati or len(dati) < byte_minimi:
        return 'solo %d byte' % len(dati or b'')
    # utf-8-sig toglie il BOM: certe stagioni ce l'hanno, altre no, ed è invisibile
    testa = dati[:3000].decode('utf-8-sig', errors='replace').lstrip('\ufeff').lstrip()
    if testa[:1] == '<' or '<html' in testa[:400].lower():
        return 'è una pagina HTML, non un CSV'
    prima = testa.split('\n', 1)[0]
    if not prima.startswith('Div'):
        return "l'intestazione non comincia con Div: %r" % prima[:60]
    return None


def pare_csv_lega(div):
    """Il controllo per il file di UN campionato: deve essere un CSV, e nelle
    prime righe deve comparire il suo codice. Prima era scritto su misura per
    'I1', che e' il motivo per cui questa funzione ora prende un argomento."""
    def controllo(dati):
        problema = _pare_csv(dati)
        if problema:
            return problema
        testa = dati[:3000].decode('utf-8-sig', errors='replace')
        if div not in testa:
            return 'nessuna riga di %s nelle prime righe' % div
        return None
    return controllo


def pare_csv_seriea(dati):
    """None se va bene, altrimenti il motivo del rifiuto."""
    return pare_csv_lega('I1')(dati)


def pare_csv_calendario(dati):
    """Il calendario di tutte le leghe è ordinato per data, non per campionato:
    la Serie A può stare a metà file o non esserci affatto in pausa nazionali.
    Pretendere 'I1' nei primi 3000 byte è il motivo per cui questo file è stato
    rifiutato per mesi, e con lui le quote di tutte le partite in arrivo."""
    return _pare_csv(dati, byte_minimi=200)


# ────────────────────────────── conversioni ──────────────────────────────

def num(v):
    if v is None:
        return None
    v = str(v).strip()
    if v == '' or v.upper() in ('NA', 'N/A', '-'):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return None if f != f else f


def intero(v):
    f = num(v)
    return None if f is None else int(round(f))


def data_iso(v):
    v = (v or '').strip()
    m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$', v)
    if m:
        g, mm, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if a < 100:
            a += 2000 if a < 70 else 1900
    else:
        m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', v)
        if not m:
            return None
        a, mm, g = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return datetime(a, mm, g).strftime('%Y-%m-%d')
    except ValueError:
        return None


# ────────────────────────────── orari ──────────────────────────────
#
# Tre fonti, tre fusi, e nessuna che lo dica. football-data.co.uk scrive
# l'orario di Londra, openfootball quello italiano, ESPN quello di Greenwich.
# Finché li si copiava così com'erano, l'app mostrava "19:45" per una partita
# che in Svizzera comincia alle 20:45: un'ora sbagliata su ogni singola
# partita, per chi la usa per decidere se fare in tempo a giocare.
#
# Qui dentro si entra da fusi diversi e si esce sempre dall'ora italiana, che
# è anche quella svizzera. Chi legge `o` da qui in avanti sa cosa sta leggendo.

def _ora_legale(data):
    """Vera fra l'ultima domenica di marzo e l'ultima domenica di ottobre.

    L'Unione Europea e il Regno Unito cambiano l'ora nello stesso giorno, quindi
    fra Londra e Roma c'è sempre esattamente un'ora, tutto l'anno. Rispetto a
    Greenwich invece la distanza è una d'inverno e due d'estate, e va calcolata."""
    try:
        a, m, g = int(data[0:4]), int(data[5:7]), int(data[8:10])
    except (ValueError, IndexError):
        return False
    if m < 3 or m > 10:
        return False
    if 3 < m < 10:
        return True
    ultima_domenica = 31
    while datetime(a, m, ultima_domenica).weekday() != 6:
        ultima_domenica -= 1
    if m == 3:
        return g >= ultima_domenica
    return g < ultima_domenica


def _sposta(hhmm, ore):
    m = re.match(r'^\s*(\d{1,2})[:.](\d{2})', hhmm or '')
    if not m:
        return None
    h = (int(m.group(1)) + ore) % 24
    return '%02d:%s' % (h, m.group(2))


def ora_da_londra(hhmm):
    """football-data.co.uk: sempre un'ora indietro rispetto all'Italia."""
    return _sposta(hhmm, 1)


def ora_da_greenwich(hhmm, data):
    """ESPN, che pubblica in UTC: una d'inverno, due d'estate."""
    return _sposta(hhmm, 2 if _ora_legale(data) else 1)


ALIAS = {
    'Internazionale': 'Inter', 'FC Internazionale Milano': 'Inter', 'Inter Milan': 'Inter',
    'AC Milan': 'Milan', 'Milan AC': 'Milan', 'Juventus FC': 'Juventus', 'AS Roma': 'Roma',
    'SS Lazio': 'Lazio', 'SSC Napoli': 'Napoli', 'Atalanta BC': 'Atalanta',
    'ACF Fiorentina': 'Fiorentina', 'Bologna FC 1909': 'Bologna', 'Torino FC': 'Torino',
    'Udinese Calcio': 'Udinese', 'Genoa CFC': 'Genoa', 'UC Sampdoria': 'Sampdoria',
    'US Sassuolo Calcio': 'Sassuolo', 'Sassuolo Calcio': 'Sassuolo',
    'Hellas Verona FC': 'Verona', 'Hellas Verona': 'Verona', 'Verona FC': 'Verona',
    'Empoli FC': 'Empoli', 'US Lecce': 'Lecce', 'US Salernitana 1919': 'Salernitana',
    'Salernitana 1919': 'Salernitana', 'Cagliari Calcio': 'Cagliari',
    'Frosinone Calcio': 'Frosinone', 'AC Monza': 'Monza', 'Venezia FC': 'Venezia',
    'Parma Calcio 1913': 'Parma', 'Como 1907': 'Como', 'Spezia Calcio': 'Spezia',
    'Benevento Calcio': 'Benevento', 'US Cremonese': 'Cremonese', 'SPAL': 'Spal',
    'Brescia Calcio': 'Brescia', 'Pisa SC': 'Pisa', 'AC Pisa 1909': 'Pisa',
    'Pisa 1909': 'Pisa', 'US Pisa 1909': 'Pisa', 'AC Reggiana': 'Reggiana',
    'Palermo FC': 'Palermo', 'US Catanzaro 1929': 'Catanzaro', 'Bari 1908': 'Bari',
}


def nome(n):
    n = (n or '').strip()
    return ALIAS.get(n, n)


def chiave(p):
    return '%s|%s|%s' % (p.get('d'), p.get('c'), p.get('v'))


# ────────────────────────────── stagioni ──────────────────────────────

def stagioni_da_prendere(oggi=None):
    """La stagione europea comincia a luglio. Si parte dalla più recente:
    se la fonte a un certo punto smette di rispondere, almeno le stagioni che
    contano davvero sono già in tasca."""
    oggi = oggi or datetime.now(timezone.utc)
    inizio = oggi.year if oggi.month >= 7 else oggi.year - 1
    fuori = []
    for k in range(N_STAGIONI):
        a = inizio - k
        fuori.append(('%02d%02d' % (a % 100, (a + 1) % 100), '%d-%02d' % (a, (a + 1) % 100)))
    return fuori


# ────────────────────────────── football-data.co.uk ──────────────────────────────

# Le quote, in ordine di preferenza. La "C" in mezzo al nome vuol dire
# CHIUSURA: il prezzo con cui la partita e' andata in campo, dopo che il mercato
# ha assorbito formazioni, infortuni e tutto quello che si e' saputo fino
# all'ultimo. E' la stima migliore che esista, ed e' quella contro cui ha senso
# misurarsi. Le colonne senza C sono di apertura, e per mesi ho usato quelle:
# non per una scelta, ma perche' AvgH viene prima di AvgCH in ordine alfabetico
# nella mia testa.
#
# Le partite in ARRIVO hanno solo l'apertura, per forza — la chiusura non e'
# ancora avvenuta. Per quelle si scende nell'elenco fino a trovare qualcosa, ed
# e' giusto cosi': quando si gioca si ha il prezzo di adesso, non quello finale.
COLONNE_1X2 = (('AvgCH', 'AvgCD', 'AvgCA'), ('PSCH', 'PSCD', 'PSCA'),
               ('B365CH', 'B365CD', 'B365CA'), ('MaxCH', 'MaxCD', 'MaxCA'),
               ('AvgH', 'AvgD', 'AvgA'), ('BbAvH', 'BbAvD', 'BbAvA'),
               ('PSH', 'PSD', 'PSA'), ('B365H', 'B365D', 'B365A'),
               ('BWH', 'BWD', 'BWA'), ('IWH', 'IWD', 'IWA'),
               ('WHH', 'WHD', 'WHA'))
COLONNE_OU = (('AvgC>2.5', 'AvgC<2.5'), ('B365C>2.5', 'B365C<2.5'),
              ('MaxC>2.5', 'MaxC<2.5'), ('Avg>2.5', 'Avg<2.5'),
              ('BbAv>2.5', 'BbAv<2.5'), ('P>2.5', 'P<2.5'),
              ('B365>2.5', 'B365<2.5'))


# Betfair Exchange non e' un bookmaker: e' un mercato dove la gente scommette
# contro altra gente, e la casa prende una commissione invece di caricare un
# margine sul prezzo. Le sue quote sono la stima piu' pulita che esista — la
# somma delle probabilita' sta intorno a 1.02 invece di 1.05 — e sono nel file
# da sempre, nelle colonne BFEC*.
COLONNE_EXCHANGE = (('BFECH', 'BFECD', 'BFECA'), ('BFEH', 'BFED', 'BFEA'))

# La quota MIGLIORE fra tutti i bookmaker, non la media. Serve a una cosa sola,
# ma importante: sapere quanto costa davvero giocare. L'app finora assumeva un
# ricarico del 6.5% per selezione — un numero scelto a occhio — e su quella
# assunzione poggia tutta la tabella "come le impacchetti". Con Max e Avg
# insieme il ricarico si calcola invece di stimarlo, e si vede anche la
# differenza fra il banco migliore e quello medio.
COLONNE_MAX = (('MaxCH', 'MaxCD', 'MaxCA'), ('MaxH', 'MaxD', 'MaxA'))

# Lo stesso trucco sull'Over/Under 2.5, che e' il secondo asse dell'ancoraggio.
# Il primo asse e' passato dalla quota media a quella di Betfair Exchange e ci
# ha guadagnato lo 0.28%, per un motivo solo: il ricarico. Una quota media porta
# dentro il 4.9% del banco, e il modo con cui lo si toglie (dividere per la
# somma) e' approssimato — tanto piu' storto quanto piu' il ricarico e' grosso.
# Betfair sull'Over/Under non c'e', ma la quota MIGLIORE del mercato si': ha
# ricarico praticamente nullo, quindi non c'e' quasi niente da togliere e non
# c'e' quasi niente da sbagliare. Tenuta a parte finche' non e' misurata.
COLONNE_OU_MAX = (('MaxC>2.5', 'MaxC<2.5'), ('Max>2.5', 'Max<2.5'))

# bet365 e' uno dei tre operatori su cui si gioca davvero, e football-data lo
# pubblica su tutto l'archivio. Non serve a prevedere: serve a sapere QUANTO
# COSTA. Il ricarico medio europeo (4.9%) e' una media su decine di banchi, e
# non e' detto sia quello di nessuno in particolare; questo invece e' il numero
# di un banco vero, su 1930 partite di Serie A. Gli altri due (Sporttip,
# Eurobet) in questo file non ci sono, e per quelli l'unico modo di saperlo e'
# il registro delle giocate.
COLONNE_B365 = (('B365CH', 'B365CD', 'B365CA'), ('B365H', 'B365D', 'B365A'))

# Le quote di APERTURA, tenute a parte da quelle di chiusura invece che
# scartate. Servono a una domanda che finora nessuna misura di questo progetto
# poteva porsi, e che e' la piu' importante di tutte.
#
# Tutti i backtest si ancorano alla CHIUSURA: il prezzo con cui la partita e'
# andata in campo, dopo che il mercato ha assorbito formazioni e infortuni. E'
# la stima migliore che esista — e non e' quella che si ha in mano quando si
# gioca. Chi punta il venerdi' ha l'apertura, che e' piu' grezza.
#
# Se il mercato di chiusura e' molto piu' informato del modello, ma quello di
# apertura lo e' meno, allora il peso giusto da dare al modello NON e' lo
# stesso nei due casi — e tararlo sulla chiusura, come si fa sempre, vuol dire
# tararlo su una situazione in cui non ci si trova mai.
COLONNE_1X2_APERTURA = (('AvgH', 'AvgD', 'AvgA'), ('B365H', 'B365D', 'B365A'),
                        ('PSH', 'PSD', 'PSA'), ('BbAvH', 'BbAvD', 'BbAvA'))
COLONNE_OU_APERTURA = (('Avg>2.5', 'Avg<2.5'), ('B365>2.5', 'B365<2.5'),
                       ('BbAv>2.5', 'BbAv<2.5'), ('P>2.5', 'P<2.5'))

# L'handicap asiatico dice di quanti gol una squadra e' data favorita, ed e' il
# mercato piu' liquido del mondo: la sua linea e' la misura piu' precisa della
# supremazia attesa che si possa avere gratis. Oggi l'ancoraggio usa due assi
# (chi vince, quanti gol); questo sarebbe un terzo modo di guardare il primo.
COLONNE_HANDICAP = (('AHCh', 'AvgCAHH', 'AvgCAHA'), ('AHh', 'AvgAHH', 'AvgAHA'),
                    ('AHCh', 'B365CAHH', 'B365CAHA'), ('AHh', 'B365AHH', 'B365AHA'))


def quote_extra_da_riga(r):
    """Exchange e handicap asiatico: due modi in piu' di leggere lo stesso
    mercato, tenuti a parte finche' non si e' misurato se servono."""
    fuori = {}
    for a, b, c in COLONNE_EXCHANGE:
        q = [num(r.get(a)), num(r.get(b)), num(r.get(c))]
        if all(q) and min(q) > 1:
            fuori['qex'] = [round(x, 3) for x in q]
            break
    for a, b, c in COLONNE_MAX:
        q = [num(r.get(a)), num(r.get(b)), num(r.get(c))]
        if all(q) and min(q) > 1:
            fuori['qmax'] = [round(x, 3) for x in q]
            break
    for a, b, c in COLONNE_B365:
        q = [num(r.get(a)), num(r.get(b)), num(r.get(c))]
        if all(q) and min(q) > 1:
            fuori['qb365'] = [round(x, 3) for x in q]
            break
    for a, b, c in COLONNE_1X2_APERTURA:
        q = [num(r.get(a)), num(r.get(b)), num(r.get(c))]
        if all(q) and min(q) > 1:
            fuori['qap'] = [round(x, 3) for x in q]
            break
    for a, b in COLONNE_OU_APERTURA:
        qo, qu = num(r.get(a)), num(r.get(b))
        if qo and qu and min(qo, qu) > 1:
            fuori['qapou'] = [round(qo, 3), round(qu, 3)]
            break
    for a, b in COLONNE_OU_MAX:
        qo, qu = num(r.get(a)), num(r.get(b))
        if qo and qu and min(qo, qu) > 1:
            fuori['qoumax'] = [round(qo, 3), round(qu, 3)]
            break
    for linea, ca, cv in COLONNE_HANDICAP:
        h, qa, qv = num(r.get(linea)), num(r.get(ca)), num(r.get(cv))
        if h is not None and qa and qv and min(qa, qv) > 1:
            fuori['qah'] = [round(h, 2), round(qa, 3), round(qv, 3)]
            break
    return fuori


def quote_da_riga(r):
    """Le stesse quote hanno nomi diversi a seconda della stagione e del file:
    la media di tutti i bookmaker quando c'è, il singolo bookmaker quando non
    c'è. Il calendario in arrivo, in particolare, porta solo le colonne di
    qualche operatore: cercarne una sola era il motivo per cui le partite
    future finivano senza quote, e senza quote il confronto col mercato non
    esiste."""
    fuori = {}
    for a, b, c in COLONNE_1X2:
        q = [num(r.get(a)), num(r.get(b)), num(r.get(c))]
        if all(q) and min(q) > 1:
            fuori['q'] = [round(x, 3) for x in q]
            break
    for a, b in COLONNE_OU:
        qo, qu = num(r.get(a)), num(r.get(b))
        if qo and qu and min(qo, qu) > 1:
            fuori['qou'] = [round(qo, 3), round(qu, 3)]
            break
    return fuori


def leggi_csv(testo, stagione, div='I1'):
    fuori = []
    lettore = csv.DictReader(io.StringIO(testo.replace('\r\n', '\n')))
    # Il BOM in testa al file diventerebbe parte del nome della prima colonna:
    # 'Div' si chiamerebbe '\ufeffDiv' e ogni riga verrebbe scartata in silenzio.
    # È esattamente il modo in cui tre stagioni sono sparite senza un errore.
    if lettore.fieldnames:
        lettore.fieldnames = [(c or '').replace('\ufeff', '').strip() for c in lettore.fieldnames]
    for r in lettore:
        if (r.get('Div') or '').strip() != div:
            continue
        casa, via, d = nome(r.get('HomeTeam')), nome(r.get('AwayTeam')), data_iso(r.get('Date'))
        if not (casa and via and d):
            continue
        m = {'s': stagione, 'd': d, 'o': ora_da_londra(r.get('Time')),
             'c': casa, 'v': via,
             'gc': intero(r.get('FTHG')), 'gv': intero(r.get('FTAG')),
             'ptc': intero(r.get('HTHG')), 'ptv': intero(r.get('HTAG')),
             'arb': (r.get('Referee') or '').strip() or None,
             'tc': intero(r.get('HS')), 'tv': intero(r.get('AS')),
             'tpc': intero(r.get('HST')), 'tpv': intero(r.get('AST')),
             'fc': intero(r.get('HF')), 'fv': intero(r.get('AF')),
             'ac': intero(r.get('HC')), 'av': intero(r.get('AC')),
             'gic': intero(r.get('HY')), 'giv': intero(r.get('AY')),
             'rc': intero(r.get('HR')), 'rv': intero(r.get('AR')),
             # Gli xG VERI. Erano in questo file da sempre, nelle colonne HxG e
             # AxG, piene al cento per cento — e per mesi il modello li ha
             # dedotti dai tiri mentre provava a scaricarli da Understat, che
             # blocca l'indirizzo della Action. Non li cercavo qui perche' non
             # avevo mai guardato l'elenco delle colonne di un file che
             # scaricavo tutti i giorni.
             'xgc': num(r.get('HxG')), 'xgv': num(r.get('AxG'))}
        m.update(quote_da_riga(r))
        m.update(quote_extra_da_riga(r))
        fuori.append({k: v for k, v in m.items() if v is not None})
    return fuori


# Lo stesso sito servito da tre porte, e non sempre sono tutte aperte.
#
# Per una settimana intera "www.football-data.co.uk" ha risposto 503 su tutto,
# e siccome era l'unico indirizzo provato l'archivio è rimasto fermo: risultati
# vecchi di sette giorni, quote assenti, ancoraggio al mercato spento. Il primo
# giro con tre indirizzi ha scoperto che "football-data.co.uk" senza il www
# rispondeva benissimo — non era il sito a essere giù, era un nome.
#
# Da qui in avanti ogni file di quel sito passa da qui, non solo il calendario:
# scoprire la porta buona e poi usarla per un file solo era il modo più veloce
# di rifare la stessa figura la settimana dopo. Il primo indirizzo che risponde
# viene ricordato per tutto il giro, così le stagioni successive non ripagano
# ogni volta il prezzo della scoperta.

PORTE_FOOTBALL_DATA = ('https://football-data.co.uk',
                       'https://www.football-data.co.uk',
                       'http://football-data.co.uk')
_porta_buona = [None]


def scarica_football_data(percorso, esiti, controllo=None, tentativi=2, attesa=4):
    porte = list(PORTE_FOOTBALL_DATA)
    if _porta_buona[0] in porte:
        porte.remove(_porta_buona[0])
        porte.insert(0, _porta_buona[0])
    ultimo = None
    for porta in porte:
        try:
            grezzo = scarica('%s/%s' % (porta, percorso), tentativi=tentativi,
                             attesa=attesa, controllo=controllo)
            if _porta_buona[0] != porta:
                _porta_buona[0] = porta
                esiti['football-data indirizzo'] = porta
                log('  risponde %s' % porta)
            return grezzo
        except Exception as e:          # noqa: BLE001
            ultimo = '%s → %s' % (porta.split('//')[1], str(e)[:60])
            log('  %s' % ultimo)
    raise RuntimeError(ultimo or 'nessun indirizzo ha risposto')


def prendi_football_data(stagioni, div='I1', nome_lega='Serie A', pausa=None):
    partite, esiti = [], {}
    if pausa is None:
        pausa = PAUSA
    for i, (codice, etichetta) in enumerate(stagioni):
        if i:
            time.sleep(pausa)
        log('· football-data.co.uk %s %s' % (div, etichetta))
        try:
            testo = scarica_football_data('mmz4281/%s/%s.csv' % (codice, div), esiti,
                                          controllo=pare_csv_lega(div)).decode('utf-8-sig',
                                                                               errors='replace')
            p = leggi_csv(testo, etichetta, div)
            if not p:
                raise RuntimeError('CSV scaricato ma nessuna partita di %s dentro' % nome_lega)
            arb = len([x for x in p if x.get('arb')])
            log('  %d partite (%d con arbitro)' % (len(p), arb))
            partite.extend(p)
            esiti[etichetta] = 'ok: %d partite, %d con arbitro' % (len(p), arb)
        except Exception as e:        # noqa: BLE001
            log('  FALLITA: %s' % e)
            esiti[etichetta] = 'fallita: %s' % e
    return partite, esiti


# ────────────────────────────── TheSportsDB (la piu svelta) ──────────────────────────────
#
# Le altre due fonti pubblicano a giornata chiusa: finche' non si e' giocato il
# posticipo del lunedi, i risultati del venerdi non ci sono. Per giorni l'app ha
# detto "mancano 8 risultati" ed era vero — solo che non era colpa di nessuno,
# era il calendario delle fonti.
#
# TheSportsDB pubblica partita per partita, ed e' aperta senza chiave. Non ha
# tiri, ne' falli, ne' arbitro: da sola non basterebbe. Ma il risultato ce l'ha
# per prima, e il risultato e' quello che serve per non restare fermi.

ID_SERIEA_TSDB = 4332
BASE_TSDB = 'https://www.thesportsdb.com/api/v1/json/3'


def _partita_tsdb(ev, stagione):
    casa, via = nome(ev.get('strHomeTeam')), nome(ev.get('strAwayTeam'))
    data = data_iso((ev.get('dateEvent') or (ev.get('strTimestamp') or '')[:10]))
    if not (casa and via and data):
        return None
    fuori = {'s': stagione, 'd': data, 'c': casa, 'v': via}
    # L'ora e' quella di Greenwich, come dice il nome del campo accanto.
    ts = ev.get('strTimestamp') or ''
    if len(ts) >= 16:
        ora = ora_da_greenwich(ts[11:16], data)
        if ora:
            fuori['o'] = ora
    gc, gv = intero(ev.get('intHomeScore')), intero(ev.get('intAwayScore'))
    if gc is not None and gv is not None:
        fuori['gc'], fuori['gv'] = gc, gv
    giornata = intero(ev.get('intRound'))
    if giornata:
        fuori['giornata'] = 'Matchday %d' % giornata
    return fuori


def prendi_thesportsdb(stagione, esiti):
    """Le ultime giocate e le prossime in programma. Due richieste in tutto."""
    giocate, future = [], []
    for pezzo, dove in (('eventspastleague', giocate), ('eventsnextleague', future)):
        try:
            grezzo = scarica('%s/%s.php?id=%d' % (BASE_TSDB, pezzo, ID_SERIEA_TSDB),
                             tentativi=2, attesa=4)
            d = json.loads(grezzo.decode('utf-8'))
        except Exception as e:            # noqa: BLE001
            esiti['TheSportsDB %s' % pezzo] = 'fallita: %s' % e
            continue
        for ev in (d.get('events') or []):
            p = _partita_tsdb(ev, stagione)
            if p:
                dove.append(p)
        time.sleep(1.5)
    con_risultato = [p for p in giocate if p.get('gc') is not None]
    # Il piano aperto serve poche partite per volta: dire quante ne ha mandate
    # e' l'unico modo per accorgersi se un giorno smette di mandarne.
    esiti['TheSportsDB'] = 'ok: %d giocate di cui %d col risultato, %d in arrivo' % (
        len(giocate), len(con_risultato), len(future))
    return con_risultato, future


# ────────────────────────────── le notizie ──────────────────────────────
#
# Cosa ci fanno qui, visto che tutto il resto di questo progetto e' numeri.
#
# Non entrano nel modello, e non e' pigrizia: e' una decisione presa dopo
# averla misurata. "La Roma ha nove punti su nove" e' informazione che il
# mercato ha gia', e il mercato lo usiamo come ancora — quindi ce l'abbiamo
# gia' dentro, meglio di come la ricaveremmo noi. E tools/misura_valore.js
# mostra cosa succede quando il modello si fa un'opinione propria contro il
# mercato: dove si dava piu' del 20% di vantaggio ha reso il -35%.
#
# Servono a un'altra cosa, che i numeri non fanno. Il modello sa quanto forte
# e' la Roma; non sa che oggi mancano tre titolari. Quella notizia il mercato
# ce l'ha e noi no, e non c'e' modo di darla in pasto a un Dixon-Coles senza i
# dati sui singoli — che il piano gratuito non concede per la stagione in
# corso. Quindi la si mette davanti a chi gioca, e decide lui.
#
# Il contenuto e' scritto da altri: non si esegue, non si interpreta, non
# cambia un numero. Si mostra, con la fonte accanto.

# Quali feed, e perche' proprio questi tre. Non e' una scelta di gusto: sono
# rimasti in piedi da soli, dopo che i contatori hanno bocciato tutti gli altri.
#
#   ANSA               44 titoli tenuti su 65 — l'agenzia, asciutta e puntuale
#   Football Italia    19 su 20 — in inglese, ma il piu' pulito di tutti
#   Repubblica         11 su 25
#
# Bocciati, con il motivo scritto dai numeri e non dall'impressione:
#
#   Gazzetta /calcio     99 titoli, zero: e' fantacalcio e rubriche
#   Gazzetta /serie-a   100 titoli, zero: 65 piu' vecchi di dieci giorni. Non e'
#                       un flusso, e' un archivio — l'esempio nel riepilogo
#                       citava Sarri alla Lazio, cioe' due stagioni fa
#   corriereobjects       8 titoli, zero
#   Sky sport.sky.it    ha risposto alla sonda e poi 404 al giro vero
#   Corriere dello Sport risponde con un feed senza nemmeno un <item>
#   Tuttomercatoweb      403
#
# Sessanta titoli e' gia' il tetto (MAX_NOTIZIE) e queste tre lo riempiono:
# aggiungerne altre non porterebbe notizie, porterebbe doppioni e attesa.
FONTI_NOTIZIE = (
    ('ANSA', 'https://www.ansa.it/sito/notizie/sport/calcio/calcio_rss.xml'),
    ('Football Italia', 'https://football-italia.net/feed/'),
    ('Repubblica', 'https://www.repubblica.it/rss/sport/calcio/rss2.0.xml'),
)

# Parole che segnalano un'assenza. Non e' un modello di linguaggio: e' un
# elenco, e come tale sbaglia in entrambe le direzioni. Serve a far risaltare
# le notizie che contano davvero, non a decidere niente.
# Come le squadre si chiamano nei titoli, che non e' come si chiamano nelle
# tabelle. "Juve" e' scritto piu' spesso di "Juventus", e un titolo che dice
# "Nerazzurri" non contiene la parola "Inter" da nessuna parte. Senza questi,
# la Gazzetta ha dato zero titoli riconosciuti su novantanove.
#
# Ci sono solo i soprannomi che stanno per UNA squadra sola. "Bianconeri" e'
# Juventus ma anche Udinese, "granata" e' Torino ma anche Salernitana: quelli
# restano fuori, perche' attaccare una notizia alla squadra sbagliata e' peggio
# che non attaccarla.
SOPRANNOMI = {
    'Juventus': ('juve',),
    'Inter': ('nerazzurri', 'internazionale'),
    'Milan': ('rossoneri', 'diavolo'),
    'Roma': ('giallorossi', 'lupi'),
    'Lazio': ('biancocelesti',),
    'Napoli': ('partenopei', 'azzurri di conte'),
    'Fiorentina': ('viola', 'gigliati'),
    'Atalanta': ('dea', 'orobici', 'bergamaschi'),
    'Bologna': ('rossoblu felsinei', 'felsinei'),
    'Genoa': ('grifone', 'rossoblu di genova'),
    'Sampdoria': ('doria', 'blucerchiati'),
    'Sassuolo': ('neroverdi',),
    'Udinese': ('friulani',),
    'Cagliari': ('rossoblu sardi', 'isolani'),
    'Lecce': ('salentini',),
    'Verona': ('gialloblu', 'scaligeri'),
    'Empoli': ('azzurri toscani',),
    'Monza': ('brianzoli',),
    'Parma': ('ducali', 'crociati'),
    'Como': ('lariani',),
    'Venezia': ('lagunari', 'arancioneroverdi'),
    'Torino': ('toro',),
}

PAROLE_ASSENZA = ('infortun', 'squalific', 'lesion', 'stiramento', 'distorsion',
                  'operaz', 'out ', ' ko', 'salta la', 'salterà', 'salta il',
                  'indisponibil', 'forfait', 'in dubbio', 'injur', 'suspend',
                  'doubt', 'sidelin', 'ruled out')
# L'altra cosa che il modello non puo' sapere e che sposta davvero: chi siede
# in panchina. Un esonero a stagione in corso cambia la squadra in un modo che
# i risultati passati non raccontano ancora.
PAROLE_PANCHINA = ('esoner', 'dimission', 'nuovo allenatore', 'nuovo tecnico',
                   'in panchina', 'subentra', 'ufficiale:', 'sack', 'appointed',
                   'new coach', 'takes charge', 'resign')
MAX_NOTIZIE = 60


def _voci_rss(testo):
    """I pezzi di un RSS, senza librerie e senza fidarsi del formato.

    Si usa xml.etree e non un'espressione regolare perche' i titoli contengono
    virgolette, ampersand e CDATA, e prima o poi uno di quelli rompe la regex —
    di solito il giorno in cui serve."""
    import xml.etree.ElementTree as ET
    try:
        radice = ET.fromstring(testo)
    except ET.ParseError:
        return []
    fuori = []
    for item in radice.iter():
        if not item.tag.endswith('item') and not item.tag.endswith('entry'):
            continue
        voce = {}
        for figlio in item:
            etichetta = figlio.tag.split('}')[-1]
            if etichetta in ('title', 'link', 'pubDate', 'updated', 'published'):
                valore = (figlio.text or figlio.get('href') or '').strip()
                if valore:
                    voce.setdefault(etichetta, valore)
        if voce.get('title'):
            fuori.append(voce)
    return fuori


def _quando(voce):
    grezzo = voce.get('pubDate') or voce.get('published') or voce.get('updated') or ''
    m = re.search(r'(\d{1,2})\s+(\w{3})\s+(\d{4})', grezzo)
    mesi = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
            'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
    if m and m.group(2)[:3].lower() in mesi:
        try:
            return '%04d-%02d-%02d' % (int(m.group(3)), mesi[m.group(2)[:3].lower()],
                                       int(m.group(1)))
        except ValueError:
            pass
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', grezzo)
    return m.group(1) if m else None


# I feed degli altri quattro campionati.
#
# Scelti misurando la cosa che conta, non se rispondono: quanti titoli si
# agganciano a una squadra vera. Un titolo che non si attacca a nessuno e' un
# titolo in mezzo al nulla — non si puo' mettere accanto a una partita, e tanto
# vale non prenderlo. Sondato (scripts/_sonda_notizie.py), titoli agganciati:
#
#   Premier      Guardian 80%   Sky 80%    BBC 17% (parla di tutto il calcio)
#   Bundesliga   Guardian 50%   kicker 35%
#   Liga         Guardian 55%   Marca 33% (ma 49 titoli, quindi 16 agganciati)
#   Ligue 1      RMC 47%        Guardian 40%
#
# Morti: Sport1 (404) e L'Equipe (403, blocca i robot).
#
# Due per campionato, e non a caso: uno inglese che aggancia tanto e uno nella
# lingua del posto che porta le notizie che l'inglese non da'.
FONTI_NOTIZIE_LEGA = {
    'E0': (('Guardian', 'https://www.theguardian.com/football/premierleague/rss'),
           ('Sky Sports', 'https://www.skysports.com/rss/11661')),
    'D1': (('Guardian', 'https://www.theguardian.com/football/bundesligafootball/rss'),
           ('kicker', 'https://newsfeed.kicker.de/news/bundesliga')),
    'SP1': (('Guardian', 'https://www.theguardian.com/football/laligafootball/rss'),
            ('Marca', 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml')),
    'F1': (('RMC', 'https://rmcsport.bfmtv.com/rss/football/ligue-1/'),
           ('Guardian', 'https://www.theguardian.com/football/ligue1football/rss')),
}


def prendi_notizie(squadre, esiti, fonti=None, risolutore=None):
    """Titoli recenti, attaccati alle squadre che nominano.

    Con un `risolutore` si lavora fuori dall'Italia: la tabella dei soprannomi
    e' italiana — "Juve", "Nerazzurri" — e per ottanta squadre in quattro
    lingue non si scrive a mano. Il risolutore dei nomi, costruito per
    agganciare i calendari, funziona anche qui: misurato, riconosce "Spurs"
    come Tottenham, "Atleti" come Atletico e "Gladbach" come Monchengladbach
    dentro i titoli, senza che nessuno glielo abbia insegnato apposta."""
    if not squadre:
        return []
    # Per riconoscere una squadra in un titolo servono anche i suoi altri nomi:
    # "Inter" e "Internazionale", "Milan" e "AC Milan". ALIAS ce li ha gia'.
    per_squadra = {}
    for sq in squadre:
        per_squadra.setdefault(sq, set()).add(sq.lower())
    for lungo, corto in ALIAS.items():
        if corto in per_squadra:
            per_squadra[corto].add(lungo.lower())
    for sq, soprannomi in SOPRANNOMI.items():
        if sq in per_squadra:
            per_squadra[sq].update(soprannomi)

    oggi = datetime.now(timezone.utc).date()
    limite = (oggi - timedelta(days=10)).isoformat()
    viste, fuori = set(), []
    for etichetta, url in (fonti or FONTI_NOTIZIE):
        try:
            grezzo = scarica(url, tentativi=2, attesa=3)
            testo = grezzo.decode('utf-8', 'replace')
        except Exception as e:        # noqa: BLE001
            esiti['notizie %s' % etichetta] = 'non disponibile: %s' % str(e)[:60]
            continue
        voci = _voci_rss(testo)
        prese, scarti = 0, {'doppio': 0, 'nessuna squadra': 0, 'vecchio': 0}
        for voce in voci:
            titolo = re.sub(r'\s+', ' ', voce['title']).strip()
            if not titolo or titolo.lower() in viste:
                scarti['doppio'] += 1
                continue
            basso = titolo.lower()
            if risolutore:
                # Fuori dall'Italia non c'e' una tabella di soprannomi: si
                # prova ogni parola lunga del titolo contro il risolutore, che
                # sa gia' che "Spurs" e' il Tottenham. Le parole corte si
                # saltano perche' "Won" o "Cup" pescherebbero qualunque cosa.
                trovate = set()
                for pezzo in re.findall(r"[A-Za-z\u00C0-\u00FF'\-]{4,}", titolo):
                    q = risolutore._cerca(pezzo)
                    if q:
                        trovate.add(q)
                citate = sorted(trovate)
            else:
                citate = sorted(sq for sq, nomi in per_squadra.items()
                                if any(re.search(r'\b%s\b' % re.escape(n), basso) for n in nomi))
            if not citate:
                scarti['nessuna squadra'] += 1
                continue
            quando = _quando(voce)
            if quando and quando < limite:
                scarti['vecchio'] += 1
                continue
            link = (voce.get('link') or '').strip()
            if not link.startswith(('http://', 'https://')):
                link = ''
            viste.add(basso)
            fuori.append({'t': titolo[:180], 'f': etichetta, 'd': quando,
                          'sq': citate, 'l': link,
                          'ass': any(k in basso for k in PAROLE_ASSENZA),
                          'pan': any(k in basso for k in PAROLE_PANCHINA)})
            prese += 1
        motivi = ', '.join('%d %s' % (n, k) for k, n in scarti.items() if n)
        if prese or not voci:
            esiti['notizie %s' % etichetta] = '%d titoli tenuti su %d%s' % (
                prese, len(voci), ' (scartati: %s)' % motivi if motivi else '')
        else:
            # Zero su novantanove non e' un numero, e' una domanda. Il motivo
            # dello scarto e un paio di titoli veri rispondono in un colpo
            # d'occhio: se il feed parla di fantacalcio non c'e' niente da
            # aggiustare, se invece nomina le squadre e io non le vedo, il
            # difetto e' mio. La prima volta ho dovuto indovinarlo.
            campione = ' // '.join(re.sub(r'\s+', ' ', v['title'])[:70] for v in voci[:2])
            esiti['notizie %s' % etichetta] = (
                'nessuno dei %d titoli tenuto (%s). Per esempio: %s'
                % (len(voci), motivi or 'nessun motivo registrato', campione))
        time.sleep(1.5)
    fuori.sort(key=lambda x: (x['d'] or '', x['ass'] or x['pan']), reverse=True)
    fuori = fuori[:MAX_NOTIZIE]
    quante = len([x for x in fuori if x['ass']])
    panchine = len([x for x in fuori if x['pan']])
    esiti['notizie'] = '%d titoli tenuti, %d %s un\'assenza, %d la panchina' % (
        len(fuori), quante, 'segnala' if quante == 1 else 'segnalano', panchine)
    return fuori


# ────────────────────────────── openfootball (riserva) ──────────────────────────────

def _coppia(v):
    """[2, 1] → (2, 1). Qualunque altra cosa → None."""
    if isinstance(v, (list, tuple)) and len(v) == 2 and v[0] is not None and v[1] is not None:
        try:
            return int(v[0]), int(v[1])
        except (TypeError, ValueError):
            return None
    return None


def _punteggio_openfootball(m):
    """Il risultato finale e quello all'intervallo, comunque siano scritti.

    openfootball ha cambiato forma tre volte e le stagioni vecchie non sono
    state riscritte: nello stesso file convivono `score: {ft: [2,1], ht: [1,0]}`
    e `score: [2,1]` secco, e nelle stagioni più vecchie `score1`/`score2`.
    Chiedere `.get('ft')` a una lista solleva un'eccezione, e l'eccezione si
    portava via l'intera stagione: trentasei partite scritte all'antica su
    trecentottanta bastavano a far sparire il 2025-26 per intero — cioè la
    stagione più recente, quella che il modello pesa di più."""
    sc = m.get('score')
    if isinstance(sc, dict):
        return _coppia(sc.get('ft')), _coppia(sc.get('ht'))
    diretto = _coppia(sc)
    if diretto:
        return diretto, None
    finale = _coppia([m.get('score1'), m.get('score2')])
    return finale, _coppia([m.get('score1i'), m.get('score2i')])


def prendi_openfootball(etichetta, of='it.1'):
    url = ('https://raw.githubusercontent.com/openfootball/football.json/'
           'master/%s/%s.json' % (etichetta, of))
    d = json.loads(scarica(url, tentativi=2, attesa=3).decode('utf-8'))
    giocate, future = [], []
    for m in d.get('matches', []):
        casa, via = nome(m.get('team1')), nome(m.get('team2'))
        data = data_iso(m.get('date'))
        if not (casa and via and data):
            continue
        base = {'s': etichetta, 'd': data, 'c': casa, 'v': via}
        if m.get('round'):
            base['giornata'] = m['round']
        # L'orario c'è ed è già quello italiano: è l'unica fonte che ce l'ha per
        # le partite in arrivo, ed è il motivo per cui il calendario dell'app
        # mostrava le date senza mai un'ora.
        ora = _sposta(m.get('time'), 0)
        if ora:
            base['o'] = ora
        finale, intervallo = _punteggio_openfootball(m)
        if finale:
            base['gc'], base['gv'] = finale
            if intervallo and intervallo[0] <= finale[0] and intervallo[1] <= finale[1]:
                base['ptc'], base['ptv'] = intervallo
            giocate.append(base)
        else:
            future.append(base)
    return giocate, future


# ────────────────────────────── calendario ──────────────────────────────

def prendi_calendario(stagioni, esiti, div='I1'):
    fut = []
    try:
        log('· football-data.co.uk calendario')
        testo = scarica_football_data('fixtures.csv', esiti,
                                      controllo=pare_csv_calendario).decode('utf-8-sig', 'replace')
        for r in csv.DictReader(io.StringIO(testo)):
            if (r.get('Div') or '').strip() != div:
                continue
            d = data_iso(r.get('Date'))
            if not d:
                continue
            m = {'d': d, 'o': ora_da_londra(r.get('Time')),
                 'c': nome(r.get('HomeTeam')), 'v': nome(r.get('AwayTeam'))}
            m.update(quote_da_riga(r))
            # E anche Betfair, la migliore del mercato e l'handicap. Per mesi
            # questa riga non c'era, ed era il buco piu' costoso di tutto lo
            # script: ancorarsi a Betfair invece che alla quota media era stato
            # MISURATO come il miglior guadagno della stagione (+0.28%, e il
            # backtest da 0.18993 a 0.18945) — ma quel guadagno arrivava solo
            # alle partite GIA' GIOCATE, cioe' a quelle su cui non si scommette.
            # Le partite in arrivo, le uniche che contano quando si gioca,
            # avevano soltanto la quota media dei bookmaker, perche' qui si
            # chiamava quote_da_riga e non quote_extra_da_riga. Un miglioramento
            # misurato che non arriva dove serve non e' un miglioramento.
            m.update(quote_extra_da_riga(r))
            fut.append({k: v for k, v in m.items() if v is not None})
        esiti['calendario ravvicinato'] = 'ok: %d partite' % len(fut)
    except Exception as e:            # noqa: BLE001
        esiti['calendario ravvicinato'] = 'fallito: %s' % e
    return fut


# ────────────────────────────── The Odds API ──────────────────────────────

# La fonte che ha risolto il punto singolo di rottura.
#
# Per mesi le quote delle partite in arrivo sono arrivate da un file solo,
# fixtures.csv di football-data, che copre una finestra di due o tre giorni.
# Il 17 settembre quella finestra conteneva 30 partite di otto campionati e
# nessuna di Serie A, mentre si giocava il giorno dopo: l'ancoraggio spento,
# il modello nudo, e nessuno che lo dicesse.
#
# Misurato con la sonda prima di scrivere una riga (scripts/_sonda_odds.py):
#
#   partite di Serie A con quote : 20
#   copertura                    : dal 18 settembre al 12 OTTOBRE, 24 giorni
#   banchi                       : 24, fra cui Betfair Exchange e Pinnacle
#   costo                        : 2 crediti a chiamata, ~240 al mese su 500
#
# Le due cose che contano piu' del resto:
#
# BETFAIR EXCHANGE SULLE PARTITE FUTURE. Ancorarsi a Betfair invece che alla
# quota media era gia' stato misurato come il miglior guadagno della stagione
# (+0.28%), ma quel guadagno arrivava solo alle partite GIA' GIOCATE, perche'
# football-data non pubblica l'exchange sui fixture. Adesso arriva dove si
# gioca. Ricarico 0.5% invece di 5.
#
# PINNACLE. Il banco che gli altri guardano per decidere i propri prezzi:
# margine basso e limiti alti, quindi la sua quota e' la stima piu' onesta che
# un bookmaker produca. Entra nel calcolo della media come gli altri.
#
# La chiave sta in ODDS_API_KEY, un segreto del repository. Questo file e'
# pubblico: una chiave scritta qui sarebbe una chiave regalata.

ODDS_API_BASE = 'https://api.the-odds-api.com/v4'
ODDS_API_SPORT = 'soccer_italy_serie_a'
ODDS_EXCHANGE = 'betfair_ex_eu'
LINEA_OU = 2.5


def _terna_h2h(mercato, squadra_casa, squadra_via):
    """Le tre quote di un banco, nell'ordine 1-X-2. The Odds API mette il nome
    della squadra al posto di "1" e "2", quindi l'ordine va ricostruito dai
    nomi invece che dalla posizione: fidarsi della posizione e' il modo piu'
    silenzioso di scambiare casa e trasferta."""
    trovate = {}
    for o in mercato.get('outcomes') or []:
        trovate[(o.get('name') or '').strip()] = num(o.get('price'))
    c = trovate.get(squadra_casa)
    v = trovate.get(squadra_via)
    x = trovate.get('Draw')
    if c and x and v and min(c, x, v) > 1:
        return [c, x, v]
    return None


def _coppia_ou(mercato):
    """Over e Under sulla linea 2.5, se il banco la quota."""
    o = u = None
    for x in mercato.get('outcomes') or []:
        if abs((num(x.get('point')) or 0) - LINEA_OU) > 1e-9:
            continue
        if (x.get('name') or '') == 'Over':
            o = num(x.get('price'))
        elif (x.get('name') or '') == 'Under':
            u = num(x.get('price'))
    if o and u and min(o, u) > 1:
        return [o, u]
    return None


def _crediti_rimasti(esiti):
    """I crediti che restano, tirati fuori dal riepilogo per finire nel meta:
    l'app lo mostra in Dati, cosi' la fine della quota si vede arrivare invece
    di scoprirla dall'ancoraggio che si spegne.

    Con cinque campionati le righe sono cinque, una per lega. Si prende la piu'
    BASSA, che e' quella dell'ultima chiamata fatta: e' l'unica che dice quanto
    ne resta davvero.

    E se non c'e' NESSUNA riga si tiene l'ultimo numero conosciuto, invece di
    lasciare il campo vuoto. Succede da quando si chiamano solo i campionati
    che giocano: in pausa nazionali non parte una richiesta, quindi nessuno
    dice quanti crediti restano — e un contatore che sparisce proprio quando
    non si spende e' il modo piu' stupido di rompere una cosa che serviva a
    non farsi sorprendere."""
    restano = []
    for chiave, testo in esiti.items():
        if not str(chiave).endswith('crediti'):
            continue
        m = re.search(r'restano (\d+)', str(testo or ''))
        if m:
            restano.append(int(m.group(1)))
    if restano:
        return min(restano)
    try:
        with open(FILE_META, encoding='utf-8') as f:
            return (json.load(f) or {}).get('crediti_quote')
    except Exception:                             # noqa: BLE001
        return None

def prendi_odds_api(esiti, sport=None, etichetta=None):
    """Le quote delle partite in arrivo, da 24 banchi e con 24 giorni di
    anticipo. Torna voci di calendario pronte da fondere.

    Con cinque campionati costa cinque crediti a giro invece di uno: la chiave
    dello sport e' un argomento, e chi chiama tiene il conto."""
    sport = sport or ODDS_API_SPORT
    etichetta = etichetta or 'The Odds API'
    chiave = os.environ.get('ODDS_API_KEY', '').strip()
    if not chiave:
        esiti[etichetta] = 'saltata: nessuna chiave ODDS_API_KEY'
        return []
    # Perche' solo la regione 'eu' e non anche 'uk'. Misurato con la sonda:
    #   eu      20 banchi, 20 partite con l'exchange, 1 credito
    #   uk      19 banchi, 20 partite con l'exchange, 1 credito
    #   eu,uk   37 banchi, 20 partite con l'exchange, 2 crediti
    # Raddoppiare i banchi raddoppia il costo e non aggiunge un solo exchange.
    # E l'exchange e' quello che conta: l'ancoraggio usa qex quando c'e', e la
    # media dei banchi e' solo il ripiego. Con sei giri al giorno, eu costa 360
    # crediti al mese su 500; eu,uk ne costerebbe 540, cioe' piu' del piano.
    url = ('%s/sports/%s/odds?regions=eu&markets=h2h,totals&oddsFormat=decimal&apiKey=%s'
           % (ODDS_API_BASE, sport, chiave))
    try:
        log('· The Odds API')
        grezzo, intestazioni = scarica_con_intestazioni(url, tentativi=2, attesa=3)
        partite = json.loads(grezzo.decode('utf-8'))
    except Exception as e:                        # noqa: BLE001
        # Il messaggio puo' contenere l'URL, e l'URL contiene la chiave.
        esiti[etichetta] = 'non disponibile: %s' % str(e).replace(chiave, '***')[:80]
        return []
    if not isinstance(partite, list):
        esiti[etichetta] = 'risposta inattesa'
        return []

    fuori, senza_quote = [], 0
    for p in partite:
        casa_grezza = (p.get('home_team') or '').strip()
        via_grezza = (p.get('away_team') or '').strip()
        c, v = nome(casa_grezza), nome(via_grezza)
        d = (p.get('commence_time') or '')[:10]
        if not (c and v and d):
            continue
        terne, coppie, exch = [], [], None
        for b in p.get('bookmakers') or []:
            for m in b.get('markets') or []:
                if m.get('key') == 'h2h':
                    t = _terna_h2h(m, casa_grezza, via_grezza)
                    if t:
                        terne.append(t)
                        if b.get('key') == ODDS_EXCHANGE:
                            exch = t
                elif m.get('key') == 'totals':
                    cp = _coppia_ou(m)
                    if cp:
                        coppie.append(cp)
        if not terne:
            senza_quote += 1
            continue
        m = {'d': d, 'c': c, 'v': v,
             'q': [round(sum(t[i] for t in terne) / len(terne), 3) for i in range(3)],
             'qmax': [round(max(t[i] for t in terne), 3) for i in range(3)]}
        if exch:
            m['qex'] = [round(x, 3) for x in exch]
        if coppie:
            m['qou'] = [round(sum(cp[i] for cp in coppie) / len(coppie), 3) for i in range(2)]
            m['qoumax'] = [round(max(cp[i] for cp in coppie), 3) for i in range(2)]
        fuori.append(m)

    conex = sum(1 for m in fuori if m.get('qex'))
    # I crediti rimasti non sono un dettaglio da curiosi: se finiscono a meta'
    # mese questa fonte smette di rispondere e l'ancoraggio torna spento —
    # esattamente il guasto silenzioso che questa fonte e' venuta a chiudere.
    # Quindi il numero si pubblica, e l'app lo mostra prima che serva.
    restano = intestazioni.get('x-requests-remaining') if intestazioni else None
    usati = intestazioni.get('x-requests-used') if intestazioni else None
    if restano is not None:
        esiti[etichetta + ' crediti'] = 'restano %s (usati %s)' % (restano, usati)
    esiti[etichetta] = ('ok: %d partite con quote (%d con Betfair)%s'
                             % (len(fuori), conex,
                                ', %d scartate senza quote' % senza_quote if senza_quote else ''))
    return fuori


# ────────────────────────────── API-Football (facoltativa) ──────────────────────────────

_ultima_api_football = [0.0]
PAUSA_API_FOOTBALL = 6.5      # il piano gratuito accetta 10 richieste al minuto


def api_football(percorso, parametri, chiave_api, conteggio):
    """Una richiesta ogni sei secondi e mezzo, sempre.

    Il piano gratuito ne accetta dieci al minuto. Sparandone due al secondo le
    prime dieci passano e tutte le altre vengono rifiutate — e siccome il codice
    che chiama qui ingoiava le eccezioni per non fermarsi al primo intoppo, il
    risultato era un archivio pieno per un ventesimo con nessun errore in vista:
    tre rose su venti e quarantatré giocatori invece di cinquecento. Il freno
    sta qui dentro, dove nessuno può dimenticarsi di metterlo."""
    attesa_dovuta = PAUSA_API_FOOTBALL - (time.time() - _ultima_api_football[0])
    if attesa_dovuta > 0:
        time.sleep(attesa_dovuta)
    _ultima_api_football[0] = time.time()
    url = 'https://v3.football.api-sports.io/%s?%s' % (percorso, urllib.parse.urlencode(parametri))
    grezzo = scarica(url, tentativi=2, attesa=8, intestazioni={'x-apisports-key': chiave_api})
    conteggio[0] += 1
    d = json.loads(grezzo.decode('utf-8'))
    err = d.get('errors')
    if err and (isinstance(err, dict) and err or isinstance(err, list) and err):
        raise RuntimeError('API-Football dice: %s' % json.dumps(err, ensure_ascii=False)[:200])
    return d


def arricchisci(indice, stagioni, esiti):
    """Riempie arbitro e statistiche dove mancano, con la chiave gratuita di
    API-Football. Il piano gratuito è avaro di stagioni e di richieste: si parte
    dalla stagione in corso e ci si ferma prima di finire la quota."""
    chiave_api = os.environ.get('APIFOOTBALL_KEY', '').strip()
    if not chiave_api:
        esiti['API-Football'] = 'saltata: nessuna chiave APIFOOTBALL_KEY'
        return 0, 0
    conteggio, agg_arb, agg_stat = [0], 0, 0
    # Il piano gratuito copre una finestra di stagioni che si sposta ogni anno e
    # che non è documentata: si prova con tutte e si tiene quello che risponde.
    # Costa una richiesta a vuoto per stagione, su una quota di settanta.
    for codice, etichetta in stagioni:
        anno = int(etichetta[:4])
        try:
            d = api_football('fixtures', {'league': LEGA_APIFOOTBALL, 'season': anno},
                             chiave_api, conteggio)
        except Exception as e:        # noqa: BLE001
            esiti['API-Football %s' % etichetta] = 'non disponibile: %s' % e
            continue
        risposte = d.get('response') or []
        if not risposte:
            esiti['API-Football %s' % etichetta] = 'stagione non compresa nel piano'
            continue
        senza_statistiche = []
        for f in risposte:
            fx = f.get('fixture') or {}
            sq = f.get('teams') or {}
            data = data_iso((fx.get('date') or '')[:10])
            casa = nome(((sq.get('home') or {}).get('name')))
            via = nome(((sq.get('away') or {}).get('name')))
            if not (data and casa and via):
                continue
            p = indice.get('%s|%s|%s' % (data, casa, via))
            if p is None:               # fuso orario: la partita può essere del giorno prima o dopo
                for salto in (-1, 1):
                    alt = (datetime.strptime(data, '%Y-%m-%d') + timedelta(days=salto)).strftime('%Y-%m-%d')
                    p = indice.get('%s|%s|%s' % (alt, casa, via))
                    if p is not None:
                        break
            if p is None:
                continue
            arb = (fx.get('referee') or '').split(',')[0].strip()
            if arb and not p.get('arb'):
                p['arb'] = arb
                agg_arb += 1
            if p.get('gc') is not None and p.get('tpc') is None and fx.get('id'):
                senza_statistiche.append((fx['id'], p))
        esiti['API-Football %s' % etichetta] = 'ok: %d partite, %d arbitri aggiunti' % (
            len(risposte), agg_arb)
        senza_statistiche.sort(key=lambda x: x[1]['d'], reverse=True)
        for fid, p in senza_statistiche:
            if conteggio[0] >= MAX_RICHIESTE_API:
                esiti['API-Football quota'] = ('fermato a %d richieste: mancano ancora %d partite '
                                               'da completare, le prende domani'
                                               % (conteggio[0], len(senza_statistiche) - agg_stat))
                break
            try:
                d2 = api_football('fixtures/statistics', {'fixture': fid}, chiave_api, conteggio)
            except Exception:         # noqa: BLE001
                continue
            mappa = {'Total Shots': ('tc', 'tv'), 'Shots on Goal': ('tpc', 'tpv'),
                     'Fouls': ('fc', 'fv'), 'Corner Kicks': ('ac', 'av'),
                     'Yellow Cards': ('gic', 'giv'), 'Red Cards': ('rc', 'rv')}
            for lato, blocco in enumerate(d2.get('response') or []):
                for s in blocco.get('statistics') or []:
                    campi = mappa.get(s.get('type'))
                    if campi and s.get('value') is not None:
                        p[campi[lato if lato < 2 else 0]] = intero(s.get('value')) or 0
            agg_stat += 1
    esiti['API-Football richieste'] = '%d usate su %d disponibili' % (conteggio[0], MAX_RICHIESTE_API)
    return agg_arb, agg_stat


def prendi_marcatori(esiti):
    token = os.environ.get('FOOTBALL_DATA_TOKEN', '').strip()
    if not token:
        esiti['marcatori'] = 'saltati: nessuna chiave FOOTBALL_DATA_TOKEN'
        return None
    try:
        d = json.loads(scarica('https://api.football-data.org/v4/competitions/SA/scorers?limit=100',
                               tentativi=2, intestazioni={'X-Auth-Token': token}).decode('utf-8'))
        lista = []
        for s in d.get('scorers', []):
            p, sq = s.get('player') or {}, s.get('team') or {}
            lista.append({'nome': p.get('name'), 'ruolo': p.get('position'),
                          'squadra': nome(sq.get('shortName') or sq.get('name')),
                          'gol': s.get('goals') or 0, 'assist': s.get('assists') or 0,
                          'rigori': s.get('penalties') or 0,
                          'partite': s.get('playedMatches') or 0})
        esiti['marcatori'] = 'ok: %d giocatori' % len(lista)
        return {'stagione': (d.get('season') or {}).get('startDate', '')[:4], 'lista': lista}
    except Exception as e:            # noqa: BLE001
        esiti['marcatori'] = 'falliti: %s' % e
        return None


# ────────────────────────────── Understat: gli xG veri ──────────────────────────────

URL_UNDERSTAT = 'https://understat.com/league/Serie_A/%d'


def _json_da_understat(testo, variabile):
    """Understat non ha API: i dati stanno dentro la pagina, dentro una stringa
    JavaScript in cui ogni carattere è scritto come \\xNN. Si srotola e diventa JSON.

    Le tre forme sono tutte state viste in giro — con e senza `var`, con e senza
    punto e virgola, apici singoli o doppi — e costano tre righe invece di una.
    Pretenderne una sola e chiamarlo "formato cambiato" quando non combacia è il
    modo più veloce di perdere una fonte che funziona ancora."""
    forme = [
        r"var\s+%s\s*=\s*JSON\.parse\('(.*?)'\)",
        r"%s\s*=\s*JSON\.parse\('(.*?)'\)",
        r'%s\s*=\s*JSON\.parse\("(.*?)"\)',
    ]
    for forma in forme:
        m = re.search(forma % re.escape(variabile), testo, re.S)
        if not m:
            continue
        grezzo = re.sub(r'\\x([0-9A-Fa-f]{2})', lambda g: chr(int(g.group(1), 16)), m.group(1))
        try:
            return json.loads(grezzo)
        except ValueError:
            continue
    return None


def _perche_understat_non_va(testo, variabile):
    """Quando una pagina non dà quello che deve, la differenza fra "hanno
    cambiato il formato" e "ci hanno chiuso la porta" cambia completamente cosa
    conviene fare. Costa cinque righe saperlo, e senza si tira a indovinare per
    settimane."""
    basso = testo.lower()
    if len(testo) < 2000:
        return 'la pagina è di soli %d byte: non è la pagina della lega' % len(testo)
    for spia, spiegazione in (
            ('cf-browser-verification', 'Cloudflare chiede una verifica del browser'),
            ('challenge-platform', 'Cloudflare chiede una verifica del browser'),
            ('just a moment', 'Cloudflare chiede una verifica del browser'),
            ('captcha', 'la pagina chiede un captcha'),
            ('access denied', 'accesso negato'),
            ('enable javascript', 'la pagina pretende JavaScript')):
        if spia in basso:
            return '%s (pagina di %d byte)' % (spiegazione, len(testo))
    if variabile.lower() in basso:
        return ('la variabile %s c\'è ma non nella forma attesa (pagina di %d byte): '
                'è cambiato il formato' % (variabile, len(testo)))
    return ('nella pagina non compare mai %s (%d byte): o è cambiato il nome, o quella '
            'servita non è la pagina della lega' % (variabile, len(testo)))


def prendi_understat(stagioni, esiti):
    """Gli xG dicono l'unica cosa che i tiri non dicono già: quanto valevano.
    Un tiro da trenta metri e un tap-in a porta vuota nel conteggio dei tiri
    valgono uno a testa; negli xG valgono 0.02 e 0.7. È informazione nuova, non
    lo stesso numero scritto in un altro modo — ed è per questo che vale la pena
    di prenderla da una pagina HTML invece che da un'API pulita che non esiste."""
    fuori = []
    impronte = set()
    for i, (_, etichetta) in enumerate(stagioni[:N_STAGIONI_XG]):
        anno = int(etichetta[:4])
        # Sei URL diversi che restituiscono pagine identiche non sono sei
        # stagioni mancanti: sono una porta chiusa, e continuare a bussare non
        # la apre. Basta il confronto delle dimensioni per accorgersene.
        if len(impronte) == 1 and i >= 2:
            esiti['Understat'] = ('fermato dopo %d tentativi: %s risponde sempre con la stessa '
                                  'pagina, la stessa per tutte le stagioni. Non è un formato '
                                  'cambiato, è un blocco — probabilmente sull\'indirizzo da cui '
                                  'gira la Action. Gli xG restano dedotti dai tiri.'
                                  % (i, 'understat.com'))
            log('· understat: stessa pagina per ogni stagione, è un blocco. Mi fermo.')
            break
        if i:
            time.sleep(2)
        log('· understat %s' % etichetta)
        try:
            testo = scarica(URL_UNDERSTAT % anno, tentativi=2, attesa=5, intestazioni={
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-GB,en;q=0.9,it;q=0.8',
                'Referer': 'https://understat.com/',
                'Upgrade-Insecure-Requests': '1',
            }).decode('utf-8', 'replace')
            righe = _json_da_understat(testo, 'datesData')
            if righe is None:
                impronte.add(len(testo))
                raise RuntimeError(_perche_understat_non_va(testo, 'datesData'))
            impronte.add(-i)          # una pagina buona non fa impronta comune
            n = 0
            for m in righe:
                if not m.get('isResult'):
                    continue
                xg = m.get('xG') or {}
                casa = nome((m.get('h') or {}).get('title'))
                via = nome((m.get('a') or {}).get('title'))
                d = data_iso((m.get('datetime') or '')[:10])
                if not (casa and via and d):
                    continue
                xc, xv = num(xg.get('h')), num(xg.get('a'))
                if xc is None or xv is None:
                    continue
                fuori.append({'s': etichetta, 'd': d, 'c': casa, 'v': via,
                              'xgc': round(xc, 3), 'xgv': round(xv, 3)})
                n += 1
            log('  %d partite con xG' % n)
            esiti['Understat %s' % etichetta] = 'ok: %d partite con xG' % n
        except Exception as e:          # noqa: BLE001
            log('  FALLITA: %s' % e)
            esiti['Understat %s' % etichetta] = 'fallita: %s' % e
    return fuori


# ────────────────────────────── ESPN: arbitri, orari, quote ──────────────────────────────

BASE_ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1'


def _americana_a_decimale(v):
    """ESPN dà le quote all'americana: +250 e −140 invece di 3.50 e 1.71."""
    f = num(v)
    if f is None or f == 0:
        return None
    d = 1 + (f / 100.0 if f > 0 else 100.0 / abs(f))
    return round(d, 3) if 1.01 <= d <= 100 else None


def _quote_espn(comp):
    """Il blocco quote di ESPN cambia forma a seconda del fornitore: a volte le
    tre vie sono in cima, a volte dentro homeTeamOdds. Si prova nell'ordine e ci
    si ferma alla prima che dà tre numeri sensati."""
    for o in (comp.get('odds') or []):
        casa = _americana_a_decimale((o.get('homeTeamOdds') or {}).get('moneyLine'))
        via = _americana_a_decimale((o.get('awayTeamOdds') or {}).get('moneyLine'))
        pari = _americana_a_decimale(o.get('drawOdds', {}).get('moneyLine')
                                     if isinstance(o.get('drawOdds'), dict) else o.get('drawOdds'))
        if casa and pari and via:
            return [casa, pari, via]
    return None


def espn_scoreboard(da, a, conteggio):
    url = '%s/scoreboard?dates=%s-%s&limit=300' % (BASE_ESPN, da.replace('-', ''), a.replace('-', ''))
    grezzo = scarica(url, tentativi=2, attesa=4,
                     intestazioni={'Accept': 'application/json',
                                   'Referer': 'https://www.espn.com/soccer/scoreboard'})
    conteggio[0] += 1
    return json.loads(grezzo.decode('utf-8'))


def prendi_espn(stagioni, esiti, conteggio):
    """Orario esatto del calcio d'inizio, stadio e — quando il fornitore le
    espone — le quote. Serve soprattutto per le partite in arrivo: il calendario
    di riserva arriva senza orario e senza quote, e senza quote metà di quello
    che questo modello sa fare resta spento."""
    oggi = datetime.now(timezone.utc).date()
    finestre = [((oggi - timedelta(days=10)).isoformat(), (oggi + timedelta(days=45)).isoformat())]
    partite, futuro = [], []
    for da, a in finestre:
        log('· ESPN %s → %s' % (da, a))
        try:
            d = espn_scoreboard(da, a, conteggio)
        except Exception as e:          # noqa: BLE001
            # ESPN blocca spesso gli indirizzi dei datacenter, e le Action girano
            # su Azure. Non è un guasto: è una fonte in più che oggi non c'è, e
            # tutto quello che dava lo danno anche le altre.
            log('  non disponibile: %s' % e)
            esiti['ESPN calendario'] = 'non disponibile: %s' % e
            return partite, futuro
        for ev in (d.get('events') or []):
            comp = ((ev.get('competitions') or [None])[0]) or {}
            squadre = comp.get('competitors') or []
            casa = via = None
            for c in squadre:
                n = nome((c.get('team') or {}).get('displayName')
                         or (c.get('team') or {}).get('name'))
                if c.get('homeAway') == 'home':
                    casa = n
                elif c.get('homeAway') == 'away':
                    via = n
            iso = (ev.get('date') or '')
            d_ = data_iso(iso[:10])
            if not (casa and via and d_):
                continue
            riga = {'d': d_, 'c': casa, 'v': via, 'espn': ev.get('id')}
            if len(iso) >= 16:
                riga['o'] = ora_da_greenwich(iso[11:16], d_)
            sede = ((comp.get('venue') or {}).get('fullName') or '').strip()
            if sede:
                riga['stadio'] = sede
            q = _quote_espn(comp)
            if q:
                riga['q'] = q
            finita = bool(((comp.get('status') or {}).get('type') or {}).get('completed'))
            if finita:
                partite.append(riga)
            else:
                futuro.append(riga)
    esiti['ESPN calendario'] = 'ok: %d in arrivo, %d già giocate (%d con quote)' % (
        len(futuro), len(partite), len([x for x in futuro + partite if x.get('q')]))
    return partite, futuro


def arbitri_da_espn(indice, esiti, conteggio):
    """L'arbitro sta solo nel dettaglio della singola partita: una richiesta a
    testa. Sono troppe per prenderle tutte in un colpo, quindi se ne fa un pezzo
    al giorno partendo dalle più recenti. Fra una decina di giorni l'archivio è
    pieno, e da lì in avanti bastano le partite nuove."""
    senza_arbitro = [p for p in indice.values()
                     if p.get('gc') is not None and not p.get('arb')]
    mancanti = [p for p in senza_arbitro if p.get('espn')]
    mancanti.sort(key=lambda p: p['d'], reverse=True)
    if not mancanti:
        # Distinguere i due casi conta: "non c'è niente da fare" e "non so da
        # dove cominciare" si somigliano solo se non si guarda il numero.
        if senza_arbitro:
            esiti['ESPN arbitri'] = ('%d partite sono senza arbitro, ma nessuna è stata agganciata '
                                     'a ESPN: senza il suo identificativo non posso chiederne il '
                                     'dettaglio' % len(senza_arbitro))
        else:
            esiti['ESPN arbitri'] = 'niente da fare: tutte le partite giocate hanno già un arbitro'
        return 0
    aggiunti = 0
    for p in mancanti[:MAX_ESPN_DETTAGLI]:
        try:
            grezzo = scarica('%s/summary?event=%s' % (BASE_ESPN, p['espn']), tentativi=1, attesa=3)
            conteggio[0] += 1
            d = json.loads(grezzo.decode('utf-8'))
        except Exception:               # noqa: BLE001
            continue
        for u in ((d.get('gameInfo') or {}).get('officials') or []):
            ruolo = ((u.get('position') or {}).get('displayName') or '').lower()
            nomeu = (u.get('displayName') or '').strip()
            if nomeu and ('referee' in ruolo or 'arbitro' in ruolo or not ruolo):
                p['arb'] = nomeu
                aggiunti += 1
                break
        time.sleep(0.4)
    esiti['ESPN arbitri'] = 'ok: %d aggiunti, ne restano %d da riempire' % (
        aggiunti, max(0, len(mancanti) - aggiunti))
    return aggiunti


# ────────────────────────────── football-data.org: arbitri in blocco ──────────────────────────────

def arbitri_da_footballdata(indice, stagioni, esiti):
    """Con il token gratuito, una sola richiesta per stagione restituisce tutte
    le partite con l'arbitro dentro. È la strada buona: quella di ESPN è il
    ripiego per chi il token non ce l'ha."""
    token = os.environ.get('FOOTBALL_DATA_TOKEN', '').strip()
    if not token:
        esiti['football-data.org arbitri'] = 'saltati: nessuna chiave FOOTBALL_DATA_TOKEN'
        return 0
    aggiunti = 0
    for i, (_, etichetta) in enumerate(stagioni[:4]):
        anno = int(etichetta[:4])
        if i:
            time.sleep(7)               # il piano gratuito conta 10 richieste al minuto
        try:
            d = json.loads(scarica(
                'https://api.football-data.org/v4/competitions/SA/matches?season=%d' % anno,
                tentativi=2, attesa=8, intestazioni={'X-Auth-Token': token}).decode('utf-8'))
        except Exception as e:          # noqa: BLE001
            esiti['football-data.org %s' % etichetta] = 'fallita: %s' % e
            continue
        n = 0
        for m in (d.get('matches') or []):
            arb = ''
            for u in (m.get('referees') or []):
                if 'REFEREE' in (u.get('type') or 'REFEREE').upper():
                    arb = (u.get('name') or '').strip()
                    break
            if not arb:
                continue
            casa = nome(((m.get('homeTeam') or {}).get('shortName')
                         or (m.get('homeTeam') or {}).get('name')))
            via = nome(((m.get('awayTeam') or {}).get('shortName')
                        or (m.get('awayTeam') or {}).get('name')))
            data = data_iso((m.get('utcDate') or '')[:10])
            p = trova(indice, data, casa, via)
            if p is not None and not p.get('arb'):
                p['arb'] = arb
                n += 1
        aggiunti += n
        esiti['football-data.org %s' % etichetta] = 'ok: %d arbitri aggiunti' % n
    return aggiunti


# ────────────────────────────── innesto ──────────────────────────────

def trova(indice, data, casa, via, tolleranza=3):
    """La stessa partita, datata in modo diverso da due fonti. Si cerca prima
    esatta, poi nell'intorno: un rinvio o un fuso orario non devono diventare
    una partita in più."""
    if not (data and casa and via):
        return None
    p = indice.get('%s|%s|%s' % (data, casa, via))
    if p is not None:
        return p
    for salto in range(1, tolleranza + 1):
        for segno in (-1, 1):
            try:
                alt = (datetime.strptime(data, '%Y-%m-%d')
                       + timedelta(days=salto * segno)).strftime('%Y-%m-%d')
            except Exception:           # noqa: BLE001
                return None
            p = indice.get('%s|%s|%s' % (alt, casa, via))
            if p is not None:
                return p
    return None


def innesta(indice, righe, campi, solo_se_vuoto=()):
    """Aggiunge campi a partite che esistono già, e SOLO a quelle. Una fonte
    secondaria che non riconosce una partita non deve poterla inventare: una
    riga senza risultato che entra nell'archivio è un buco che poi il modello
    scambia per un dato."""
    tocche, orfane = 0, 0
    for r in righe:
        p = trova(indice, r.get('d'), r.get('c'), r.get('v'))
        if p is None:
            orfane += 1
            continue
        cambiato = False
        for campo in campi:
            v = r.get(campo)
            if v is None:
                continue
            if campo in solo_se_vuoto and p.get(campo) is not None:
                continue
            if p.get(campo) != v:
                p[campo] = v
                cambiato = True
        if cambiato:
            tocche += 1
    return tocche, orfane


def ricorda_prima_quota(vecchio, nuovo):
    """La PRIMA quota mai vista per ogni partita, conservata da un giro
    all'altro.

    Serve alla misura piu' onesta che esista su chi scommette, e che finora era
    impossibile perche' le quote future non c'erano: il CLV, il valore contro la
    linea di chiusura.

    L'idea, in una riga: se il prezzo che hai preso batte quello con cui la
    partita e' andata in campo, hai comprato meglio del mercato. E quella misura
    converge in cinquanta giocate, mentre il guadagno vero ne chiede un
    migliaio — perche' il risultato di una scommessa e' quasi tutto fortuna,
    mentre il prezzo no.

    Qui si conserva solo il primo estremo. Il secondo — la chiusura — arriva da
    se', perche' l'ultimo giro prima del fischio scrive l'ultima quota vista.
    Due numeri per partita, e si puo' misurare una cosa che di solito richiede
    un abbonamento."""
    per_sfida = {}
    for p in (vecchio or []):
        per_sfida[(p.get('c'), p.get('v'))] = p
    for p in (nuovo or []):
        vecchia = per_sfida.get((p.get('c'), p.get('v')))
        if vecchia and vecchia.get('qprimo'):
            # gia' vista: si tiene la prima, non la si sovrascrive mai
            p['qprimo'] = vecchia['qprimo']
            p['qprimoVisto'] = vecchia.get('qprimoVisto')
            if vecchia.get('qexprimo'):
                p['qexprimo'] = vecchia['qexprimo']
        elif p.get('q'):
            p['qprimo'] = list(p['q'])
            p['qprimoVisto'] = datetime.now(timezone.utc).isoformat(timespec='minutes')
            if p.get('qex'):
                p['qexprimo'] = list(p['qex'])
    return nuovo


def da_tenere(calendario, oggi_iso):
    """Cosa sopravvive a una fonte irraggiungibile.

    Le QUOTE sì: una quota di ieri è una quota vecchia di un giorno e vale
    ancora, mentre nessuna quota è vecchia di sempre — è per questo che questo
    strato esiste, dopo una settimana di partite senza prezzi e con l'ancoraggio
    al mercato spento.

    L'ORARIO no, e non è una svista. Il calendario prende l'orario da due fonti
    che lo scrivono in due fusi diversi: tenendolo da un giro all'altro, un
    orario sbagliato non viene mai più riguardato da nessuno e resta sbagliato
    per sempre. È esattamente com'è finito, per un giro, con metà calendario a
    Roma e metà a Londra. L'orario lo ridà openfootball ogni volta: meglio
    ricevuto di nuovo che conservato male.

    E le partite già giocate restano fuori: una riga in calendario con la data
    di ieri è una partita che il calendario non sa essere finita."""
    return [{k: v for k, v in p.items() if k != 'o'}
            for p in (calendario or [])
            if p.get('d', '') >= oggi_iso and (p.get('q') or p.get('qprimo'))]


def unisci_calendario(base, extra):
    """Il calendario arriva a pezzi: openfootball sa quali partite si giocano,
    football-data.co.uk e ESPN sanno a che ora e a quanto le danno. Si fondono
    sulla stessa sfida, con la solita tolleranza di qualche giorno perché un
    anticipo spostato non deve comparire due volte."""
    fuori = [dict(p) for p in (base or [])]
    per_sfida = {}
    for p in fuori:
        per_sfida.setdefault((p.get('c'), p.get('v')), []).append(p)
    for p in (extra or []):
        candidate = per_sfida.get((p.get('c'), p.get('v')), [])
        bersaglio = None
        for altra in candidate:
            if giorni_tra(altra.get('d', ''), p.get('d', '')) <= 4:
                bersaglio = altra
                break
        if bersaglio is None:
            nuova = dict(p)
            fuori.append(nuova)
            per_sfida.setdefault((p.get('c'), p.get('v')), []).append(nuova)
            continue
        for campo, valore in p.items():
            if valore is not None:
                bersaglio[campo] = valore
    return fuori



# ────────────────────────────── unione e controlli ──────────────────────────────

VERSIONE_ORARI = 1     # 1 = i risultati in archivio sono in ora italiana


def _porta_a_ora_italiana(doc):
    """Sposta in avanti di un'ora gli orari dei RISULTATI scritti prima che questo
    file sapesse che football-data.co.uk pubblica l'ora di Londra.

    Si fa una volta sola e si lascia detto nell'archivio che è stata fatta: un
    archivio che non dice in che fuso sono i suoi orari finisce per essere
    corretto due volte, ed è peggio di prima.

    Il calendario non si tocca, e non è una dimenticanza. Le partite giocate
    vengono tutte dalla stessa fonte, quindi sono tutte sbagliate allo stesso
    modo e si aggiustano in blocco. Il calendario invece è un misto — l'orario
    lo danno openfootball (già italiano) e football-data.co.uk (di Londra) — e
    in un misto non c'è nessuna correzione che vada bene per tutti: applicandone
    una si sistema una metà e si rompe l'altra. Il calendario si rifà da capo a
    ogni giro dalle fonti, che adesso convertono entrambe: si lascia fare a
    loro. Vedi anche cosa NON si tiene nello strato di ritenzione."""
    if not doc or doc.get('versione_orari') == VERSIONE_ORARI:
        return 0
    spostate = 0
    for p in (doc.get('partite') or []):
        nuova = ora_da_londra(p.get('o'))
        if nuova:
            p['o'] = nuova
            spostate += 1
    doc['versione_orari'] = VERSIONE_ORARI
    return spostate


def carica_esistente():
    try:
        with open(FILE_DATI, encoding='utf-8') as f:
            return json.load(f)
    except Exception:                 # noqa: BLE001
        return None


def giorni_tra(a, b):
    try:
        return abs((datetime.strptime(a, '%Y-%m-%d') - datetime.strptime(b, '%Y-%m-%d')).days)
    except Exception:                 # noqa: BLE001
        return 999


def unisci(vecchie, nuove):
    """Il nuovo vince, ma solo dove ha qualcosa da dire: un campo assente non
    cancella quello che c'era. Così l'arbitro trovato ieri resta anche se oggi
    la fonte principale non l'ha dato.

    Il punto delicato è che due fonti diverse datano la stessa partita in modo
    diverso — un rinvio, un fuso orario, una partita di sabato sera segnata alla
    domenica. Senza accorgersene si finisce con la stessa partita due volte, e un
    modello che conta due volte gli stessi gol è peggio di un modello con meno dati.
    Quindi: stessa squadra di casa, stessa squadra ospite, meno di quattro giorni
    di distanza = è la stessa partita, e vince la data della fonte nuova."""
    indice, per_sfida = {}, {}

    def registra(p, k):
        indice[k] = p
        per_sfida.setdefault((p.get('c'), p.get('v')), set()).add(k)

    for p in (vecchie or []):
        registra(dict(p), chiave(p))

    for p in nuove:
        k = chiave(p)
        esistente = indice.get(k)
        vecchia_chiave = k
        if esistente is None:
            for k2 in list(per_sfida.get((p.get('c'), p.get('v')), ())):
                altra = indice.get(k2)
                if not altra:
                    continue
                stessa_stagione = (not altra.get('s') or not p.get('s') or altra['s'] == p['s'])
                if stessa_stagione and giorni_tra(altra.get('d', ''), p.get('d', '')) <= 3:
                    esistente, vecchia_chiave = altra, k2
                    break
        if esistente is None:
            registra(dict(p), k)
            continue
        for campo, valore in p.items():
            if valore is not None:
                esistente[campo] = valore
        if vecchia_chiave != k:       # la data è cambiata: si sposta sotto la chiave nuova
            indice.pop(vecchia_chiave, None)
            per_sfida[(p.get('c'), p.get('v'))].discard(vecchia_chiave)
            registra(esistente, k)
    return indice


def controlla(partite):
    problemi = []
    giocate = [p for p in partite if p.get('gc') is not None]
    if len(giocate) < 300:
        problemi.append('solo %d partite con risultato' % len(giocate))
    squadre = {p['c'] for p in giocate} | {p['v'] for p in giocate}
    # Sedici, non venti: Bundesliga e Ligue 1 ne schierano diciotto. Questo
    # controllo serve a dire "il file e' rotto", non "il campionato e' piccolo",
    # e su sei stagioni anche una lega da diciotto ne accumula una trentina.
    if len(squadre) < 16:
        problemi.append('solo %d squadre distinte' % len(squadre))
    if [p for p in giocate if not (0 <= p['gc'] <= 15 and 0 <= p['gv'] <= 15)]:
        problemi.append('punteggi fuori scala')
    return problemi


ETICHETTE = {'aggiornato': 'Aggiornato', 'esito': 'Esito', 'ultima_partita': 'Ultima partita',
             'partite_totali': 'Partite totali', 'partite_giocate': 'Partite giocate',
             'partite_in_arrivo': 'Partite in arrivo', 'con_arbitro': 'Con arbitro',
             'con_tiri': 'Con tiri', 'con_xg': 'Con xG veri', 'con_quote': 'Con quote',
             'crediti_quote': 'Crediti quote rimasti',
             'in_arrivo_con_quote': 'In arrivo con quote',
             'in_arrivo_con_orario': 'In arrivo con orario', 'marcatori': 'Marcatori',
             'notizie': 'Titoli raccolti', 'notizie_assenze': 'Titoli che segnalano assenze',
             'stagioni': 'Stagioni', 'dettaglio': 'Dettaglio per fonte', 'problemi': 'Problemi',
             'nota': 'Nota', 'nuove_oggi': 'Partite nuove oggi'}


def riepilogo(meta):
    percorso = os.environ.get('GITHUB_STEP_SUMMARY')
    if not percorso:
        return
    try:
        righe = ['### Aggiornamento dati Serie A', '', '| campo | valore |', '|---|---|']
        for k, v in meta.items():
            if k == 'dettaglio':
                continue
            if isinstance(v, list):
                v = ', '.join(str(x) for x in v) or '—'
            righe.append('| %s | %s |' % (ETICHETTE.get(k, k), v))
        det = meta.get('dettaglio') or {}
        if det:
            righe += ['', '#### Cosa ha risposto ogni fonte', '', '| fonte | esito |', '|---|---|']
            righe += ['| %s | %s |' % (k, v) for k, v in det.items()]
        with open(percorso, 'a', encoding='utf-8') as f:
            f.write('\n'.join(righe) + '\n')
    except Exception as e:            # noqa: BLE001
        log('riepilogo non scritto: %s' % e)


def scrivi_meta(meta):
    os.makedirs(DATA, exist_ok=True)
    with open(FILE_META, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    riepilogo(meta)


# ────────────────────────────── i nomi delle squadre ──────────────────────────────
#
# Il pezzo piu' rischioso di tutto il lavoro sui cinque campionati, e non si
# vede: tre fonti scrivono gli stessi club in tre modi diversi.
#
#   football-data   Bayern Munich      Man City        Ein Frankfurt
#   openfootball    FC Bayern Munchen  Manchester City Eintracht Frankfurt
#   The Odds API    Bayern Munich      Manchester City Eintracht Frankfurt
#
# Per la Serie A c'e' ALIAS, una tabella scritta a mano club per club. Per
# quattro campionati in piu' sarebbero ottanta squadre l'anno, riscritte ogni
# volta che una promossa cambia le carte. Non regge.
#
# La strada e' un'altra: l'archivio di football-data e' la verita', e i nomi
# delle altre fonti si RISOLVONO contro quelli. Chi non si risolve non entra e
# viene CONTATO — un nome non riconosciuto e' una partita senza quote, che si
# vede; un nome riconosciuto male e' due club fusi in uno, che non si vede
# affatto e avvelena il modello in silenzio.
#
# Per questo, davanti a un caso ambiguo, questo codice rinuncia invece di
# scegliere. Una partita senza quote e' un danno piccolo e visibile. Due club
# fusi sono un danno grande e invisibile.

_SENZA_ACCENTI = {
    'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a', 'å': 'a',
    'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
    'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
    'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o', 'ø': 'o',
    'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
    'ñ': 'n', 'ç': 'c', 'ß': 'ss', 'ł': 'l', 'š': 's', 'ž': 'z', 'ć': 'c', 'č': 'c',
}

# Le sigle societarie: dicono la forma giuridica del club, non quale club e'.
# "1. FSV Mainz 05" e "Mainz" sono la stessa squadra; "FC" non distingue niente
# perche' ce l'hanno quasi tutti.
_SIGLE = ('fc', 'afc', 'cf', 'ac', 'sc', 'sv', 'tsv', 'vfb', 'vfl', 'bsc', 'tsg',
          'spvgg', 'rc', 'rcd', 'ud', 'cd', 'sd', 'ca', 'as', 'ss', 'ssc', 'us',
          'usl', 'acf', 'bc', 'cfc', 'sk', 'fk', 'fsv', 'msv', 'ogc', 'osc',
          'rcs', 'sco', 'asse', 'club', 'calcio', 'futbol', 'fussball')


def _normalizza_nome(n):
    """La chiave con cui due scritture dello stesso club si incontrano."""
    n = (n or '').strip().lower()
    n = ''.join(_SENZA_ACCENTI.get(c, c) for c in n)
    n = re.sub(r'[^a-z0-9 ]+', ' ', n)
    n = re.sub(r'\b(18|19|20)\d\d\b', ' ', n)      # anni di fondazione
    n = re.sub(r'\b\d+\b', ' ', n)                  # "1. FSV", "05"
    pezzi = [x for x in n.split() if x and x not in _SIGLE]
    return ' '.join(pezzi) or n.strip()


# I casi che nessuna regola puo' indovinare, perche' i due nomi non hanno
# NIENTE in comune. "Spurs" e "Tottenham Hotspur" sono la stessa squadra e non
# condividono una lettera utile; nessun punteggio di somiglianza li mettera'
# mai insieme, e va bene cosi' — si scrivono a mano, sono pochi, e l'elenco si
# completa guardando cosa il primo giro vero dichiara come non riconosciuto,
# invece che indovinando da qui.
ALIAS_EUROPA = {
    'spurs': 'tottenham',
    'nottm forest': 'nottingham forest',
    'sheffield weds': 'sheffield wednesday',
    'paris sg': 'paris saint germain',
    'ath bilbao': 'athletic',
    'ath madrid': 'atletico madrid',
    'sociedad': 'real sociedad',
    'espanol': 'espanyol',
    'betis': 'real betis',
    'vallecano': 'rayo vallecano',
    'celta': 'celta vigo',
    'la coruna': 'deportivo la coruna',
    'ein frankfurt': 'eintracht frankfurt',
    'leverkusen': 'bayer leverkusen',
    'm gladbach': 'borussia monchengladbach',
    'monchengladbach': 'borussia monchengladbach',
    'st etienne': 'saint etienne',
    # Trovati provando il risolutore contro i nomi veri di openfootball: tre
    # coppie che nessuna regola puo' unire perche' le due scritture non
    # condividono abbastanza lettere.
    'bayern munchen': 'bayern munich',
    'espanyol de barcelona': 'espanol',
    'espanyol': 'espanol',
    'stade rennais': 'rennes',
    # Trovato dal primo giro vero: 1522 nomi su 1560 risolti in Premier, e
    # l'unico fuori era questo. E' esattamente il modo in cui questa tabella
    # doveva crescere — guardando cosa il resoconto dichiara, non indovinando.
    'wolverhampton wanderers': 'wolves',
    'wolverhampton': 'wolves',
    'rennais': 'rennes',
}


def _token_uguali(a, b):
    """Due pezzi di nome sono la stessa parola?

    Uguali; oppure uno e' l'inizio dell'altro per almeno tre lettere ("man" e
    "manchester", "ath" e "athletic"); oppure uno sta dentro l'altro per almeno
    cinque ("gladbach" dentro "monchengladbach")."""
    if a == b:
        return True
    corto, lungo = (a, b) if len(a) <= len(b) else (b, a)
    if len(corto) >= 3 and lungo.startswith(corto):
        return True
    return len(corto) >= 5 and corto in lungo


class RisolutoreNomi(object):
    """Riporta i nomi di una fonte su quelli dell'archivio, o rinuncia.

    Dal piu' sicuro al meno sicuro, e ci si ferma appena un passaggio e' ambiguo:
      1. il nome e' identico
      2. la chiave normalizzata e' identica (anche passando per ALIAS_EUROPA,
         che viene applicato da tutte e due le parti)
      3. OGNI pezzo del nome piu' corto si ritrova nell'altro, e il vincitore
         e' uno solo

    Il punto (3) e' l'unico che indovina, e la regola che lo rende sicuro e'
    "ogni pezzo", non "abbastanza pezzi". La prima versione chiedeva che si
    somigliasse meta' del nome, ed e' stata provata contro i nomi veri delle
    quattro leghe: faceva quattro FUSIONI. "Hull City" e "Coventry City"
    diventavano "Man City" perche' condividevano "city"; "Espanyol de
    Barcelona" diventava "Barcelona"; "Real Racing Santander" diventava "Real
    Madrid"; "Le Mans" diventava "Le Havre". Tutte e quattro sono il disastro
    che questo codice esiste per evitare — due club diversi fusi in uno, senza
    un errore, con il modello che impara i gol sbagliati.

    Chiedendo che TUTTI i pezzi del nome corto trovino casa, "Hull City" non
    passa piu': "hull" non somiglia a niente in "man city". E "Borussia" da
    sola pesca Dortmund e Monchengladbach: due candidati, si rinuncia.

    Una partita senza quote e' un danno piccolo e visibile. Due club fusi sono
    un danno grande e invisibile.
    """

    def __init__(self, nomi):
        self.noti = set(n for n in nomi if n)
        self.per_chiave = {}
        for n in self.noti:
            k = _normalizza_nome(n)
            for variante in {k, ALIAS_EUROPA.get(k)}:
                if variante:
                    self.per_chiave.setdefault(variante, []).append(n)
        self.ambigue = {k for k, v in self.per_chiave.items() if len(set(v)) > 1}
        self.risolti, self.persi, self.esempi = 0, 0, []
        self._memoria = {}

    def _cerca(self, n):
        if n in self.noti:
            return n
        k = _normalizza_nome(n)
        if not k:
            return None
        for prova_chiave in (k, ALIAS_EUROPA.get(k)):
            if prova_chiave and prova_chiave in self.per_chiave and prova_chiave not in self.ambigue:
                return self.per_chiave[prova_chiave][0]
        miei = [x for x in k.split() if x]
        if not miei:
            return None
        vincitori = set()
        for altra, nomi in self.per_chiave.items():
            if altra in self.ambigue:
                continue
            suoi = [x for x in altra.split() if x]
            if not suoi:
                continue
            corto, lungo = (miei, suoi) if len(miei) <= len(suoi) else (suoi, miei)
            if all(any(_token_uguali(a, b) for b in lungo) for a in corto):
                vincitori.update(nomi)
        return vincitori.pop() if len(vincitori) == 1 else None

    def risolvi(self, n):
        n = (n or '').strip()
        if not n:
            return None
        if n not in self._memoria:
            self._memoria[n] = self._cerca(n)
        trovato = self._memoria[n]
        if trovato:
            self.risolti += 1
            return trovato
        self.persi += 1
        if len(self.esempi) < 8 and n not in self.esempi:
            self.esempi.append(n)
        return None

    def applica(self, righe):
        """Riscrive c e v sui nomi dell'archivio. Chi non si risolve esce."""
        fuori = []
        for r in righe:
            c = self.risolvi(r.get('c'))
            v = self.risolvi(r.get('v'))
            if not c or not v:
                continue
            nuova = dict(r)
            nuova['c'], nuova['v'] = c, v
            fuori.append(nuova)
        return fuori

    def resoconto(self):
        tot = self.risolti + self.persi
        if not tot:
            return 'nessun nome da risolvere'
        return '%d su %d risolti%s' % (
            self.risolti, tot,
            '; NON riconosciuti: %s' % ', '.join(self.esempi) if self.esempi else '')


# ────────────────────────────── gli altri campionati ──────────────────────────────

# Quanti giorni prima di una partita vale la pena chiedere le sue quote.
#
# Perche' esiste questa regola: ogni chiamata a The Odds API costa un credito
# per campionato, e per mesi si e' pagato lo stesso prezzo tutti i giorni —
# anche il 23 settembre, quando il prossimo turno era a diciassette giorni di
# distanza e le chiamate tornavano quote di partite che non c'erano.
#
# Misurato sul calendario vero delle cinque leghe: ognuna gioca una
# cinquantina di giorni su duecentocinquanta. Chiedere solo a chi gioca
# davvero cambia il conto per intero:
#
#   sempre tutte, 3 giri            15.0 crediti/giorno   450 al mese
#   10 giorni + 4 giri da 3 giorni  10.7 crediti/giorno   321 al mese
#
# Due finestre e non una, perche' servono a due cose diverse. Il giro
# completo passa una volta al giorno e guarda LARGO: le quote compaiono con
# dieci giorni di anticipo, che e' molto prima di quando si gioca. I giri
# leggeri passano quattro volte e guardano STRETTO: rinfrescare il prezzo
# serve solo quando la partita e' vicina.
FINESTRA_QUOTE_COMPLETO = 10
FINESTRA_QUOTE_LEGGERO = 3


def gioca_presto(calendario, giorni):
    """C'e' almeno una partita entro tot giorni? Se no, chiedere le quote
    costa un credito e non porta niente."""
    if not calendario:
        return False
    oggi = datetime.now(timezone.utc).date()
    limite = (oggi + timedelta(days=giorni)).isoformat()
    minimo = oggi.isoformat()
    for p in calendario:
        d = p.get('d')
        if d and minimo <= d <= limite:
            return True
    return False


def quote_se_gioca(esiti, lega, calendario, giorni, etichetta):
    """Le quote, ma solo se c'e' qualcosa da quotare. Quando si salta lo si
    DICE: un credito risparmiato in silenzio e un guasto silenzioso si
    somigliano troppo perche' valga la pena confonderli."""
    if not gioca_presto(calendario, giorni):
        esiti['%s quote' % lega['id']] = ('saltata: nessuna partita entro %d giorni '
                                          '(risparmiato 1 credito)' % giorni)
        return []
    return prendi_odds_api(esiti, lega['odds'], etichetta)


def costruisci_lega(lega, stagioni, esiti):
    """Un campionato che non sia la Serie A: solo il cuore.

    La Serie A ha addosso mezza dozzina di fonti in piu' — ESPN per gli orari e
    gli stadi, API-Football per le statistiche, tre strade per l'arbitro, le
    notizie, i marcatori. Qui no, e non e' pigrizia: e' quello che la sonda ha
    detto che serve. Il modello gira su risultati, tiri e quote, e quelle tre
    cose ci sono al 100% in tutti e cinque i campionati. L'arbitro manca a
    tutte tranne la Premier, ma l'effetto dell'arbitro e' stato misurato ed e'
    nullo — per quello non e' nel modello. Gli xG veri ci sono solo nella
    stagione in corso, ma anche in Serie A e' cosi', ed e' stato misurato che
    quelli dedotti dai tiri non si distinguono nel prevedere i gol.

    Cosi' la Serie A resta intoccata: se questo pezzo si rompe, si rompe da
    solo e il campionato di casa continua a funzionare.
    """
    mie = {}
    partite, esiti_fd = prendi_football_data(stagioni, lega['id'], lega['nome'])
    for k, v in esiti_fd.items():
        mie['%s %s' % (lega['id'], k)] = v
    if not partite:
        esiti['%s' % lega['nome']] = 'nessuna partita: salto il campionato'
        return None

    indice = unisci(None, partite)

    # I nomi dell'archivio sono la verita': tutto il resto si riporta su questi.
    risolutore = RisolutoreNomi({p['c'] for p in partite} | {p['v'] for p in partite})

    # openfootball: il calendario delle partite in arrivo, con l'orario gia'
    # italiano, e i risultati come riserva quando football-data e' indietro.
    calendario = []
    for _, etichetta in stagioni[:2]:
        try:
            giocate, future = prendi_openfootball(etichetta, lega['of'])
            giocate, future = risolutore.applica(giocate), risolutore.applica(future)
            if giocate:
                innesta(indice, giocate, ('gc', 'gv', 'ptc', 'ptv'), solo_se_vuoto=('gc', 'gv'))
            if future:
                calendario = unisci_calendario(calendario, future)
            mie['%s openfootball %s' % (lega['id'], etichetta)] = (
                'ok: %d giocate, %d in arrivo' % (len(giocate), len(future)))
        except Exception as e:                    # noqa: BLE001
            mie['%s openfootball %s' % (lega['id'], etichetta)] = 'fallita: %s' % str(e)[:90]

    # il calendario ravvicinato di football-data, con le sue quote
    vicine = prendi_calendario(stagioni, mie, lega['id'])
    if vicine:
        calendario = unisci_calendario(calendario, vicine)

    # e le quote vere, che sono il motivo per cui tutto questo vale la pena:
    # l'ancoraggio al mercato e' la cosa piu' forte che l'app abbia.
    quote = risolutore.applica(
        quote_se_gioca(mie, lega, calendario, FINESTRA_QUOTE_COMPLETO, '%s quote' % lega['id']))
    if quote:
        calendario = unisci_calendario(calendario, quote)
    mie['%s nomi' % lega['id']] = risolutore.resoconto()

    partite_ord = sorted(indice.values(), key=lambda x: (x['d'], x.get('c', '')))
    problemi = controlla(partite_ord)
    if problemi:
        mie['%s controlli' % lega['id']] = 'RIFIUTATO: %s' % '; '.join(problemi)
        esiti.update(mie)
        return None

    calendario = sorted([x for x in calendario if x.get('c') and x.get('v')],
                        key=lambda x: (x['d'], x.get('c', '')))

    # Le notizie: non entrano nel modello, stanno accanto alla partita. Qui
    # l'aggancio lo fa il risolutore dei nomi invece della tabella italiana
    # dei soprannomi, che per ottanta squadre in quattro lingue non si scrive.
    notizie = []
    try:
        notizie = prendi_notizie(sorted(risolutore.noti), mie,
                                 FONTI_NOTIZIE_LEGA.get(lega['id']), risolutore)
    except Exception as e:                        # noqa: BLE001
        mie['%s notizie' % lega['id']] = 'fallite: %s' % str(e)[:90]

    esiti.update(mie)
    doc_extra = {'notizie': notizie} if notizie else {}
    return dict(doc_extra, **{'lega': lega['nome'], 'legaId': lega['id'], 'paese': lega['paese'],
            'aggiornato': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'versione_orari': VERSIONE_ORARI,
            'fonte': 'football-data.co.uk + openfootball + The Odds API',
            'stagioni': sorted({x['s'] for x in partite_ord if x.get('s')}),
            'partite': partite_ord, 'calendario': calendario})


# ────────────────────────────── il deposito ──────────────────────────────
#
# Il calendario esce dal repository pubblico.
#
# Questo e' il passo senza il quale il cancello non vale niente. L'app puo'
# nascondere quanto vuole: se il calendario resta in un file su GitHub, chi ne
# conosce l'indirizzo se lo prende senza nemmeno vedere la schermata
# d'accesso. Non e' un difetto dell'app, e' quello che vuol dire "sito
# statico" — non c'e' nessuno, li' sopra, che possa dire di no.
#
# Cosa resta pubblico e cosa no, e il criterio e' onesto:
#
#   l'ARCHIVIO (le partite giocate) resta nel repository. Sono i risultati di
#   football-data.co.uk, scaricabili da chiunque in dieci secondi: metterli
#   sotto chiave non proteggerebbe niente e costringerebbe a far passare tre
#   megabyte e mezzo per il server a ogni apertura dell'app.
#
#   il CALENDARIO (le partite in arrivo, con le quote) va nel deposito. E' la
#   sola cosa che ha senso vendere: le quote costano crediti veri, e sono
#   quelle che servono per giocare.
#
# Se il deposito non risponde il giro NON si ferma e NON riscrive il
# calendario nel repository: si limita a dirlo. Un guasto di rete non deve
# poter spalancare il cancello.

def deposita_calendario(lega_id, calendario, esiti):
    """Manda un calendario al Worker. Torna True se e' arrivato."""
    api = os.environ.get('MONTHLINE_API', '').strip().rstrip('/')
    segreto = os.environ.get('MONTHLINE_ADMIN', '').strip()
    if not api or not segreto:
        esiti['deposito %s' % lega_id] = 'saltato: manca MONTHLINE_API o MONTHLINE_ADMIN'
        return False
    corpo = json.dumps({'calendario': calendario}).encode('utf-8')
    url = '%s/api/admin/carica/%s' % (api, lega_id)
    req = urllib.request.Request(url, data=corpo, method='POST', headers={
        'content-type': 'application/json',
        'authorization': 'Bearer %s' % segreto,
        'User-Agent': 'Monthline/deposito',
    })
    for tentativo in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                risposta = json.loads(r.read().decode('utf-8'))
            esiti['deposito %s' % lega_id] = 'ok: %d partite depositate' % (
                risposta.get('partite', len(calendario)))
            return True
        except Exception as e:                    # noqa: BLE001
            # il segreto puo' finire in un messaggio di errore: mai stamparlo
            motivo = str(e).replace(segreto, '***')[:90]
            if tentativo == 2:
                esiti['deposito %s' % lega_id] = 'FALLITO: %s' % motivo
                return False
            time.sleep(2 * (tentativo + 1))
    return False


def cancello_acceso():
    """C'e' un deposito dove mandare i calendari? Se no, si resta come prima:
    tutto nel repository, nessun cancello. Serve a non rompere niente mentre
    il Worker non c'e' ancora."""
    return bool(os.environ.get('MONTHLINE_API', '').strip() and
                os.environ.get('MONTHLINE_ADMIN', '').strip())


def scrivi_lega(lega, doc, esiti=None):
    """Un file per campionato. Tutti insieme farebbero 3.9 MB — misurati — e un
    telefono li scaricherebbe a ogni apertura.

    Col cancello acceso il CALENDARIO non entra nel file: va nel deposito, e
    nel file resta solo l'archivio. Se il deposito rifiuta, il calendario NON
    torna nel file di ripiego — si perde quel giro e si riprova al prossimo.
    Un guasto di rete non deve poter spalancare il cancello."""
    percorso = os.path.join(DATA, *lega['file'].split('/'))
    os.makedirs(os.path.dirname(percorso), exist_ok=True)
    da_scrivere = doc
    if cancello_acceso():
        deposita_calendario(lega['id'], doc.get('calendario') or [],
                            esiti if esiti is not None else {})
        da_scrivere = {k: v for k, v in doc.items() if k != 'calendario'}
        da_scrivere['calendarioAltrove'] = True
    with open(percorso, 'w', encoding='utf-8') as f:
        json.dump(da_scrivere, f, ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(percorso)


def scrivi_indice(voci):
    """L'elenco dei campionati disponibili, che l'app legge per prima per
    sapere cosa puo' caricare. Senza, ogni lega nuova vorrebbe una riga scritta
    a mano dentro l'app."""
    percorso = os.path.join(DATA, 'leghe.json')
    with open(percorso, 'w', encoding='utf-8') as f:
        json.dump({'aggiornato': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                   'leghe': voci}, f, ensure_ascii=False, separators=(',', ':'))


def aggiorna_lega_leggero(lega, stagioni, esiti):
    """Il giro svelto per un campionato: le quote, e nient'altro.

    Le quote sono la cosa piu' deperibile dell'archivio — si muovono durante il
    giorno, e il modello ci si ancora con peso UNO su tutto quello che il
    mercato quota. Riscaricare sei stagioni di CSV per aggiornarle sarebbe
    ventiquattro file per accorgersi che nessun risultato del 2021 e' cambiato.

    Quindi qui si rilegge il file di ieri, gli si rifa' solo il calendario, e
    lo si riscrive. Costa un credito di The Odds API per lega.
    """
    percorso = os.path.join(DATA, *lega['file'].split('/'))
    if not os.path.exists(percorso):
        return None
    try:
        with open(percorso, encoding='utf-8') as f:
            doc = json.load(f)
    except Exception as e:                        # noqa: BLE001
        esiti['%s (leggero)' % lega['nome']] = 'file illeggibile: %s' % str(e)[:80]
        return None

    calendario = doc.get('calendario') or []
    risolutore = RisolutoreNomi({p['c'] for p in (doc.get('partite') or [])} |
                                {p['v'] for p in (doc.get('partite') or [])})
    vicine = prendi_calendario(stagioni, esiti, lega['id'])
    if vicine:
        calendario = unisci_calendario(calendario, vicine)
    quote = risolutore.applica(
        quote_se_gioca(esiti, lega, calendario, FINESTRA_QUOTE_LEGGERO, '%s quote' % lega['id']))
    if quote:
        calendario = unisci_calendario(calendario, quote)
    esiti['%s nomi (leggero)' % lega['id']] = risolutore.resoconto()

    # Le partite gia' giocate escono dal calendario da sole: unisci_calendario
    # tiene solo quelle in arrivo, e qui si ripulisce comunque il vecchio.
    oggi = datetime.now(timezone.utc).date().isoformat()
    calendario = sorted([x for x in calendario
                         if x.get('c') and x.get('v') and x.get('d', '') >= oggi],
                        key=lambda x: (x['d'], x.get('c', '')))
    doc['calendario'] = calendario
    doc['aggiornato'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    scrivi_lega(lega, doc, esiti)
    con_quote = len([x for x in calendario if x.get('q') or x.get('qex')])
    log('  %s: %d in arrivo, %d con quote' % (lega['nome'], len(calendario), con_quote))
    return {'id': lega['id'], 'nome': lega['nome'], 'paese': lega['paese'],
            'file': lega['file'], 'partite': len(doc.get('partite') or []),
            'inArrivo': len(calendario), 'conQuote': con_quote}


def costruisci_altre_leghe(stagioni, esiti, voci):
    """Le quattro oltre la Serie A. Una che cade non porta giu' le altre."""
    for lega in LEGHE[1:]:
        log('')
        log('── %s (%s) ──' % (lega['nome'], lega['id']))
        try:
            doc = costruisci_lega(lega, stagioni, esiti)
        except Exception as e:                    # noqa: BLE001
            log('  FALLITO: %s' % str(e)[:150])
            esiti[lega['nome']] = 'fallito: %s' % str(e)[:150]
            continue
        if not doc:
            continue
        peso = scrivi_lega(lega, doc, esiti)
        in_arrivo = len(doc['calendario'])
        con_quote = len([x for x in doc['calendario'] if x.get('q') or x.get('qex')])
        log('  %d partite, %d in arrivo (%d con quote), %.0f KB'
            % (len(doc['partite']), in_arrivo, con_quote, peso / 1024.0))
        esiti[lega['nome']] = ('ok: %d partite, %d in arrivo, %d con quote'
                               % (len(doc['partite']), in_arrivo, con_quote))
        voci.append({'id': lega['id'], 'nome': lega['nome'], 'paese': lega['paese'],
                     'file': lega['file'], 'partite': len(doc['partite']),
                     'inArrivo': in_arrivo, 'conQuote': con_quote})


def main():
    os.makedirs(DATA, exist_ok=True)
    stagioni = stagioni_da_prendere()
    # Due modi di girare, per una ragione precisa. Le quote delle partite in
    # arrivo si muovono durante la giornata, e adesso il modello ci si ancora
    # sopra: una fotografia scattata una volta al giorno all'alba è già vecchia
    # al fischio d'inizio. Ma ricaricare sei stagioni di archivio e sei pagine
    # di xG ogni tre ore sarebbe maleducato verso fonti che ci lasciano entrare
    # gratis, e inutile: l'archivio cambia solo quando si gioca.
    #   completo → tutto, una volta al giorno
    #   leggero  → solo calendario, quote e arbitri, ogni poche ore
    leggero = os.environ.get('MODO', '').strip().lower() == 'leggero'
    log('Modo: %s' % ('leggero (solo calendario, quote e arbitri)' if leggero else 'completo'))
    log('Stagioni cercate: %s' % ', '.join(e for _, e in stagioni))
    esiti = {}
    esiti['modo'] = 'leggero' if leggero else 'completo'

    if leggero:
        nuove, esiti_fd = [], {}
    else:
        nuove, esiti_fd = prendi_football_data(stagioni)
    esiti.update(esiti_fd)

    # riserva stagione per stagione: meglio i soli risultati che il vuoto
    prese = {p['s'] for p in nuove}
    if leggero:
        prese = {e for _, e in stagioni[1:]}      # solo la stagione in corso
    calendario_riserva = []
    for codice, etichetta in stagioni:
        if etichetta in prese:
            continue
        log('· riserva openfootball %s' % etichetta)
        try:
            giocate, future = prendi_openfootball(etichetta)
            if giocate or future:
                nuove.extend(giocate)
                calendario_riserva.extend(future)
                esiti['riserva %s' % etichetta] = 'ok: %d giocate, %d in calendario (senza tiri né arbitri)' % (
                    len(giocate), len(future))
            else:
                esiti['riserva %s' % etichetta] = 'nessuna partita'
        except Exception as e:        # noqa: BLE001
            esiti['riserva %s' % etichetta] = 'fallita: %s' % e

    # TheSportsDB per ultimo, sui risultati appena arrivati. Le altre due
    # pubblicano a giornata chiusa e per giorni l'app dice "manca il risultato"
    # senza che sia colpa di nessuno: questa pubblica partita per partita.
    # Arriva senza tiri e senza arbitro, quindi non puo' creare una partita da
    # sola — riempie il risultato dove manca, e basta. Vedi `innesta`.
    log('· TheSportsDB')
    try:
        tsdb_giocate, tsdb_future = prendi_thesportsdb(stagioni[0][1], esiti)
    except Exception as e:            # noqa: BLE001
        esiti['TheSportsDB'] = 'fallita: %s' % e
        tsdb_giocate, tsdb_future = [], []

    # Due calendari, e servono tutti e due. openfootball sa QUALI partite si
    # giocano fino a maggio; football-data.co.uk sa a che ora e a quanto le
    # danno, ma solo per la settimana in arrivo. Prendere solo il secondo perché
    # ha risposto — che è quello che succedeva finché il primo era l'unico a
    # funzionare — vuol dire passare da trecentosettanta partite a dieci.
    vecchio = carica_esistente()
    spostate = _porta_a_ora_italiana(vecchio)
    if spostate:
        esiti['orari'] = ('%d orari portati da Londra a Roma: erano scritti '
                          "un'ora indietro su ogni partita" % spostate)
        log("· orari: %d portati all'ora italiana" % spostate)
    ravvicinato = prendi_calendario(stagioni, esiti)
    stagionale = list(calendario_riserva)
    if not stagionale:
        try:
            _, future = prendi_openfootball(stagioni[0][1])
            stagionale = future
            esiti['calendario stagione'] = 'ok da openfootball: %d partite' % len(future)
        except Exception as e:        # noqa: BLE001
            esiti['calendario stagione'] = 'fallito: %s' % e
    # base = la stagione intera, sopra quello che si sapeva ieri, sopra ancora
    # quello che si e' scaricato oggi.
    #
    # Il pezzo di mezzo e' quello che mancava, e si e' visto: football-data.co.uk
    # ha risposto 503 per giorni e le partite in arrivo sono rimaste SENZA QUOTE
    # per una settimana intera, con l'ancoraggio al mercato spento e nessuno che
    # se ne accorgeva. Le quote di ieri sono vecchie di un giorno; nessuna quota
    # e' vecchia di sempre. In testa al file c'e' scritto che quello che e' stato
    # scaricato non si perde: valeva per le partite giocate e non per il
    # calendario, che e' esattamente dove serviva di piu'.
    vecchio_cal = (vecchio or {}).get('calendario') or []
    oggi_iso = datetime.now(timezone.utc).date().isoformat()
    tenuto = da_tenere(vecchio_cal, oggi_iso)
    calendario = unisci_calendario(stagionale, tenuto)
    calendario = unisci_calendario(calendario, ravvicinato)
    # The Odds API viene DOPO football-data, quindi vince sui campi che porta:
    # ha 24 giorni di anticipo invece di due, 24 banchi invece di una manciata,
    # e soprattutto Betfair Exchange, che sulle partite future non c'era mai
    # stato. Sui campi che non porta (orario, giornata) non tocca niente,
    # perche' unisci_calendario scrive solo i valori non nulli.
    # Anche il campionato di casa paga un credito a giro, e anche lui ha
    # diciassette giorni di pausa nazionali in cui non c'e' niente da quotare.
    # La finestra qui e' quella larga anche nei giri leggeri: la Serie A e'
    # quella che si guarda tutti i giorni, e un credito e' un credito.
    calendario = unisci_calendario(
        calendario,
        quote_se_gioca(esiti, LEGA_CASA, calendario,
                       FINESTRA_QUOTE_LEGGERO if leggero else FINESTRA_QUOTE_COMPLETO,
                       'The Odds API'))
    calendario = ricorda_prima_quota(vecchio_cal, calendario)
    if tsdb_future:
        calendario = unisci_calendario(calendario, tsdb_future)
    # Una partita che si e' giocata non e' piu' in calendario. Quando una fonte
    # non ne pubblica mai il risultato — succede: dieci partite dell'ultima
    # giornata 2024-25 sono rimaste senza — quella riga resta li' per sempre e
    # l'app la conta fra le partite di cui "non si sa com'e' finita", cioe' fa
    # suonare un allarme che non rientrera' mai piu'. Un allarme che non si
    # spegne e' rumore, e il rumore fa ignorare anche quelli veri.
    limite = (datetime.now(timezone.utc).date() - timedelta(days=10)).isoformat()
    scadute = len([p for p in calendario if p.get('d', '') < limite])
    calendario = [p for p in calendario if p.get('d', '') >= limite]
    if scadute:
        esiti['calendario scadute'] = ('%d partite tolte dal calendario: giocate da piu\' di dieci '
                                       'giorni e mai comparse fra i risultati' % scadute)
    con_quote = len([p for p in calendario if p.get('q')])
    freschi = len([p for p in ravvicinato if p.get('q')])
    esiti['calendario'] = '%d partite in tutto, %d con le quote (%d scaricate adesso, %d tenute da prima)' % (
        len(calendario), con_quote, freschi, max(0, con_quote - freschi))

    prima = len((vecchio or {}).get('partite') or [])
    # I risultati di TheSportsDB entrano come partite vere, non come innesto:
    # se le altre due fonti non hanno ancora pubblicato la giornata, quella
    # partita nell'archivio non esiste ancora e non c'e' niente da riempire.
    #
    # Il filtro che tiene: si accettano solo sfide fra squadre che l'archivio
    # gia' conosce. Una fonte che non riconosciamo bene puo' sbagliare un nome,
    # e una partita inventata e' molto peggio di una partita mancante — il
    # modello non ha modo di accorgersene.
    note = {p.get('c') for p in ((vecchio or {}).get('partite') or [])}
    note |= {p.get('v') for p in ((vecchio or {}).get('partite') or [])}
    note |= {p.get('c') for p in nuove} | {p.get('v') for p in nuove}
    buone = [p for p in tsdb_giocate if p['c'] in note and p['v'] in note]
    scartate = len(tsdb_giocate) - len(buone)
    if buone:
        nuove.extend(buone)
    esiti['TheSportsDB risultati'] = '%d risultati accolti%s' % (
        len(buone), ', %d scartati (squadre mai viste)' % scartate if scartate else '')

    indice = unisci((vecchio or {}).get('partite'), nuove)

    # xG veri: l'unica statistica pubblica che aggiunge informazione ai tiri
    xg = [] if leggero else prendi_understat(stagioni, esiti)
    tocche, orfane = innesta(indice, xg, ('xgc', 'xgv'))
    if xg:
        esiti['Understat innesto'] = '%d partite aggiornate, %d non riconosciute' % (tocche, orfane)
        log('· Understat: xG su %d partite (%d non riconosciute)' % (tocche, orfane))

    # ESPN: orario, stadio, identificativo per il dettaglio, e quote quando ci sono
    conteggio_espn = [0]
    espn_giocate, espn_future = prendi_espn(stagioni, esiti, conteggio_espn)
    if espn_giocate:
        t2, _ = innesta(indice, espn_giocate, ('espn', 'stadio', 'o', 'q'), solo_se_vuoto=('o', 'q'))
        log('· ESPN: %d partite giocate agganciate' % t2)

    # arbitri: prima la strada buona (una richiesta per stagione), poi il ripiego
    agg_arb_fd = 0 if leggero else arbitri_da_footballdata(indice, stagioni, esiti)
    agg_arb_espn = arbitri_da_espn(indice, esiti, conteggio_espn)
    if agg_arb_fd or agg_arb_espn:
        log('· arbitri: %d da football-data.org, %d da ESPN' % (agg_arb_fd, agg_arb_espn))

    agg_arb, agg_stat = (0, 0) if leggero else arricchisci(indice, stagioni, esiti)
    if agg_arb or agg_stat:
        log('· API-Football: %d arbitri e %d partite di statistiche aggiunti' % (agg_arb, agg_stat))
    agg_arb += agg_arb_fd + agg_arb_espn


    partite = sorted(indice.values(), key=lambda p: (p['d'], p.get('c', '')))
    problemi = controlla(partite)
    adesso = datetime.now(timezone.utc).isoformat(timespec='seconds')

    if problemi:
        log('DATI RIFIUTATI: %s' % '; '.join(problemi))
        scrivi_meta({'aggiornato': adesso, 'esito': 'rifiutato', 'problemi': problemi,
                     'dettaglio': esiti,
                     'nota': 'I dati precedenti sono stati lasciati come erano.'})
        return 1

    giocate = [p for p in partite if p.get('gc') is not None]
    if espn_future:
        calendario = unisci_calendario(calendario, espn_future)
    calendario = sorted([p for p in calendario if p.get('c') and p.get('v')],
                        key=lambda p: (p['d'], p.get('c', '')))
    marcatori = prendi_marcatori(esiti)

    # Le notizie: non entrano nel modello, stanno accanto alla partita. Il
    # perche' e' scritto in testa a prendi_notizie, e non e' una scorciatoia.
    squadre_attive = sorted({p['c'] for p in partite if p.get('s') == stagioni[0][1]} |
                            {p['v'] for p in partite if p.get('s') == stagioni[0][1]} |
                            {p.get('c') for p in calendario if p.get('c')} |
                            {p.get('v') for p in calendario if p.get('v')})
    # Le notizie girano a OGNI giro, anche in quelli leggeri, ed e' l'unica cosa
    # in questo file che lo fa. Tutto il resto qui dentro cambia quando si
    # gioca; una notizia invecchia in ore. Nella prima versione le prendevo solo
    # nel giro completo delle 5:17, quindi un esonero delle due del pomeriggio
    # si sarebbe visto il mattino dopo — cioe' il dato piu' deperibile
    # dell'archivio era quello aggiornato meno spesso. Costa tre richieste.
    try:
        notizie = prendi_notizie(squadre_attive, esiti)
    except Exception as e:            # noqa: BLE001
        esiti['notizie'] = 'fallite: %s' % e
        notizie = ((vecchio or {}).get('notizie') or [])

    doc = {'lega': LEGA_CASA['nome'], 'legaId': LEGA_CASA['id'],
           'paese': LEGA_CASA['paese'], 'aggiornato': adesso,
           'versione_orari': VERSIONE_ORARI,
           'fonte': ' + '.join(['football-data.co.uk', 'openfootball']
                               + (['understat'] if xg else [])
                               + (['ESPN'] if (espn_giocate or espn_future) else [])
                               + (['API-Football'] if agg_stat else [])),
           'stagioni': sorted({p['s'] for p in partite if p.get('s')}),
           'partite': partite, 'calendario': calendario}
    if marcatori:
        doc['marcatori'] = marcatori
    if notizie:
        doc['notizie'] = notizie
    # Anche il campionato di casa. Senza questo pezzo la Serie A sarebbe
    # l'unico con il cancello spalancato — e per giunta proprio quello che si
    # apre per primo.
    da_scrivere = doc
    if cancello_acceso():
        deposita_calendario(LEGA_CASA['id'], calendario, esiti)
        da_scrivere = {k: v for k, v in doc.items() if k != 'calendario'}
        da_scrivere['calendarioAltrove'] = True
    with open(FILE_DATI, 'w', encoding='utf-8') as f:
        json.dump(da_scrivere, f, ensure_ascii=False, separators=(',', ':'))

    # ── gli altri quattro campionati ──
    # Vengono DOPO, e apposta: se qualcosa qui sotto si rompe, la Serie A e'
    # gia' scritta su disco e l'app continua a funzionare come prima. Nei giri
    # leggeri si saltano — sei stagioni per quattro campionati sono ventiquattro
    # file, e il giro leggero esiste per essere svelto.
    voci = [{'id': LEGA_CASA['id'], 'nome': LEGA_CASA['nome'], 'paese': LEGA_CASA['paese'],
             'file': LEGA_CASA['file'], 'partite': len(partite),
             'inArrivo': len(calendario),
             'conQuote': len([x for x in calendario if x.get('q') or x.get('qex')])}]
    if not leggero:
        costruisci_altre_leghe(stagioni, esiti, voci)
    else:
        # Nel giro leggero l'archivio degli altri campionati resta quello di
        # ieri — nessun risultato del 2021 e' cambiato stanotte — ma le QUOTE
        # si aggiornano, perche' sono l'unica cosa per cui il giro leggero
        # esiste: si muovono durante il giorno e il modello ci si ancora.
        for lega in LEGHE[1:]:
            try:
                voce = aggiorna_lega_leggero(lega, stagioni, esiti)
            except Exception as e:                # noqa: BLE001
                esiti['%s (leggero)' % lega['nome']] = 'fallito: %s' % str(e)[:120]
                voce = None
            if voce:
                voci.append(voce)
    scrivi_indice(voci)

    scrivi_meta({
        'aggiornato': adesso, 'esito': 'ok',
        'ultima_partita': giocate[-1]['d'] if giocate else '—',
        'partite_totali': len(partite), 'partite_giocate': len(giocate),
        'nuove_oggi': max(0, len(partite) - prima),
        'partite_in_arrivo': len(calendario),
        'con_arbitro': len([p for p in giocate if p.get('arb')]),
        'con_tiri': len([p for p in giocate if p.get('tpc') is not None]),
        'con_xg': len([p for p in giocate if p.get('xgc') is not None]),
        'con_quote': len([p for p in giocate if p.get('q')]),
        'in_arrivo_con_quote': len([p for p in calendario if p.get('q')]),
        # Se i crediti finiscono a meta' mese questa fonte smette di rispondere
        # e l'ancoraggio torna spento. Il numero si pubblica per vederlo
        # arrivare, invece di scoprirlo dall'app che ricomincia ad andare a naso.
        'crediti_quote': _crediti_rimasti(esiti),
        'in_arrivo_con_orario': len([p for p in calendario if p.get('o')]),
        'marcatori': len((marcatori or {}).get('lista', [])),
        'notizie': len(notizie),
        'notizie_assenze': len([x for x in notizie if x.get('ass')]),
        'stagioni': doc['stagioni'], 'dettaglio': esiti,
    })
    log('Scritte %d partite (%d giocate, ultima il %s), %d in calendario, %.0f KB'
        % (len(partite), len(giocate), giocate[-1]['d'] if giocate else '—',
           len(calendario), os.path.getsize(FILE_DATI) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
