"""The Odds API risponde? Con che copertura, e a che costo di crediti?

La chiave NON sta qui dentro e non deve starci mai: si legge da ODDS_API_KEY,
che e' un segreto del repository. Un file di questo progetto e' pubblico —
finisce su GitHub Pages — quindi una chiave scritta nel codice sarebbe una
chiave regalata a chiunque.

Come per ogni altra fonte di questo progetto: prima si chiede, poi si scrive il
codice che ci si appoggia. API-Football sembrava la risposta ovvia e ha
risposto "Free plans do not have access to this season": mezz'ora di sonda ha
risparmiato un integratore che non avrebbe mai funzionato.

Quello che serve sapere, in ordine:
  1. risponde, con questa chiave?
  2. quante partite di Serie A porta, e quanto in anticipo?
  3. quali banchi? (bet365 e' uno dei tre su cui si gioca davvero)
  4. quanti crediti costa un giro, e quanti ne restano nel mese?

    ODDS_API_KEY=... python3 scripts/_sonda_odds.py
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://api.the-odds-api.com/v4'
SPORT = 'soccer_italy_serie_a'


def riga(t=''):
    print(t, flush=True)


def chiedi(percorso, parametri, chiave):
    """Torna (dati, intestazioni). Le intestazioni contano quanto i dati: e'
    li' che l'API dice quanti crediti restano."""
    p = dict(parametri)
    p['apiKey'] = chiave
    url = '%s%s?%s' % (BASE, percorso, urllib.parse.urlencode(p))
    req = urllib.request.Request(url, headers={'User-Agent': 'Prediction_SerieA/sonda'})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode('utf-8')), dict(r.headers)


def main():
    chiave = os.environ.get('ODDS_API_KEY', '').strip()
    riga('== The Odds API ==')
    if not chiave:
        riga('nessuna chiave in ODDS_API_KEY.')
        riga('Va messa come segreto del repository, non nel codice:')
        riga('  Settings → Secrets and variables → Actions → New repository secret')
        riga('  nome: ODDS_API_KEY')
        return 0
    riga('chiave presente (%d caratteri, non la stampo)' % len(chiave))

    # 1. lo sport esiste e si chiama come penso?
    try:
        sport, testa = chiedi('/sports', {}, chiave)
    except urllib.error.HTTPError as e:
        riga('NON RISPONDE su /sports: HTTP %s — %s' % (e.code, e.read()[:200].decode('utf-8', 'replace')))
        return 1
    except Exception as e:                      # noqa: BLE001
        riga('NON RISPONDE su /sports: %s' % str(e)[:200])
        return 1
    serie_a = [s for s in sport if s.get('key') == SPORT]
    riga('sport elencati: %d   Serie A presente: %s' % (len(sport), 'si' if serie_a else 'NO'))
    if serie_a:
        riga('  %s — attiva: %s' % (serie_a[0].get('title'), serie_a[0].get('active')))

    # 2. le quote
    try:
        quote, testa = chiedi('/sports/%s/odds' % SPORT,
                              {'regions': 'eu', 'markets': 'h2h,totals',
                               'oddsFormat': 'decimal'}, chiave)
    except urllib.error.HTTPError as e:
        riga('NON RISPONDE sulle quote: HTTP %s — %s' % (e.code, e.read()[:300].decode('utf-8', 'replace')))
        return 1

    riga('')
    riga('crediti usati finora: %s   rimasti: %s' % (
        testa.get('x-requests-used', '?'), testa.get('x-requests-remaining', '?')))
    riga('costo di questa chiamata: %s' % testa.get('x-requests-last', '?'))
    riga('partite di Serie A con quote: %d' % len(quote))
    if not quote:
        riga('risponde ma non porta partite: non e\' utilizzabile adesso.')
        return 0

    date = sorted(p.get('commence_time', '') for p in quote)
    riga('dalla prima (%s) all\'ultima (%s)' % (date[0][:16], date[-1][:16]))
    riga('')
    p0 = quote[0]
    riga('prima partita: %s — %s' % (p0.get('home_team'), p0.get('away_team')))
    banchi = p0.get('bookmakers') or []
    riga('banchi: %d' % len(banchi))
    nomi = [b.get('key') for b in banchi]
    for cercato in ('bet365', 'betfair_ex_eu', 'pinnacle', 'unibet_eu'):
        riga('  %-16s %s' % (cercato, 'c\'e\'' if cercato in nomi else 'no'))
    riga('  tutti: %s' % ', '.join(nomi[:14]))
    riga('')
    for b in banchi[:2]:
        riga('  %s:' % b.get('key'))
        for m in (b.get('markets') or []):
            vals = ', '.join('%s=%s' % (o.get('name'), o.get('price'))
                             for o in (m.get('outcomes') or [])[:3])
            riga('    %-8s %s' % (m.get('key'), vals))
    riga('')
    riga('Con 4 giri al giorno questa chiamata costa %s crediti a giro,' %
         testa.get('x-requests-last', '?'))
    riga('cioe\' circa %s al mese su un piano gratuito da 500.' %
         (int(testa.get('x-requests-last', 1)) * 4 * 30
          if str(testa.get('x-requests-last', '')).isdigit() else '?'))
    return 0


def sonda_mercati():
    """Quali mercati vende, e quanto costano.

    L'app oggi si ancora a DUE assi — chi vince e quanti gol — e da li' deduce
    quaranta mercati che il banco non quota. Ma la misura piu' netta di tutto
    il progetto dice che sul mercato quotato il mercato batte il modello, su
    tutti e tredici i mercati provati.

    Quindi: se questa API vende DIRETTAMENTE un mercato che oggi deduco — il
    Gol/Gol, la doppia chance — ancorarsi a quel prezzo invece di dedurlo
    dovrebbe essere piu' preciso. Vale la pena sapere quali ci sono e cosa
    costano in crediti, perche' il piano gratuito ne da' 500 al mese e oggi
    ne spendo 240.
    """
    chiave = os.environ.get('ODDS_API_KEY', '').strip()
    riga()
    riga('== quali mercati, e a che prezzo ==')
    if not chiave:
        riga('nessuna chiave.')
        return
    # un mercato alla volta: cosi' si vede chi risponde e chi no, e quanto costa
    for m in ('h2h', 'totals', 'spreads', 'btts', 'draw_no_bet',
              'double_chance', 'team_totals', 'alternate_totals'):
        try:
            d, testa = chiedi('/sports/%s/odds' % SPORT,
                              {'regions': 'eu', 'markets': m, 'oddsFormat': 'decimal'}, chiave)
        except urllib.error.HTTPError as e:
            corpo = e.read()[:120].decode('utf-8', 'replace')
            riga('  %-18s HTTP %s — %s' % (m, e.code, corpo))
            continue
        except Exception as e:                   # noqa: BLE001
            riga('  %-18s errore: %s' % (m, str(e)[:80]))
            continue
        conBanchi = sum(1 for p in d if p.get('bookmakers'))
        banchi = set()
        for p in d:
            for b in p.get('bookmakers') or []:
                for mk in b.get('markets') or []:
                    if mk.get('key') == m:
                        banchi.add(b.get('key'))
        riga('  %-18s %2d partite, %2d banchi, costo %s crediti, restano %s'
             % (m, conBanchi, len(banchi),
                testa.get('x-requests-last', '?'), testa.get('x-requests-remaining', '?')))

    # e le regioni: piu' regioni = piu' banchi, ma i crediti si moltiplicano
    riga()
    riga('== quanto rende allargare le regioni (solo h2h) ==')
    for reg in ('eu', 'uk', 'eu,uk'):
        try:
            d, testa = chiedi('/sports/%s/odds' % SPORT,
                              {'regions': reg, 'markets': 'h2h', 'oddsFormat': 'decimal'}, chiave)
        except Exception as e:                   # noqa: BLE001
            riga('  %-8s errore: %s' % (reg, str(e)[:80]))
            continue
        banchi = set()
        exch = 0
        for p in d:
            nomi = [b.get('key') for b in p.get('bookmakers') or []]
            banchi.update(nomi)
            if any('betfair' in (n or '') for n in nomi):
                exch += 1
        riga('  %-8s %2d banchi distinti, %2d partite con un exchange, costo %s crediti'
             % (reg, len(banchi), exch, testa.get('x-requests-last', '?')))


def _margine(prezzi):
    """Quanto si tiene il banco su una terna 1X2: la somma delle probabilita'
    implicite meno uno. Zero vuol dire quota equa."""
    if len(prezzi) != 3 or not all(q > 1 for q in prezzi):
        return None
    return sum(1.0 / q for q in prezzi) - 1.0


def sonda_acquisto():
    """Cosa comprerebbero davvero dei soldi spesi qui.

    La domanda arriva da chi paga, quindi merita numeri e non un'opinione. E la
    misura piu' netta del progetto la incornicia: sul mercato QUOTATO il
    mercato batte il modello su tutti e tredici i mercati provati, peso
    ottimale UNO. Quindi comprare piu' dati di MERCATO vale piu' che comprare
    piu' dati per il modello — non e' una convinzione, e' quello che dicono le
    misure gia' fatte.

    Tre domande, tre risposte misurabili:

      1. i banchi su cui gioca davvero — bet365, Eurobet, Sporttip — li vende?
         Se ce ne sono almeno due, l'app puo' dire su QUALE dei suoi prendere
         ogni singola gamba. Il ricarico misurato dice bet365 5.63% contro
         0.00% della migliore del mercato: su una multipla da tre quel divario
         vale il 18% della giocata, che e' piu' di qualunque miglioria al
         modello vista finora.

      2. quanto varrebbe, in margine, prendere il meglio fra i SUOI banchi
         invece del solo bet365. Non il meglio del mondo: il meglio di quelli
         dove ha gia' un conto aperto.

      3. cosa sblocca davvero il piano a pagamento: lo storico delle quote
         (che permetterebbe di misurare l'ancoraggio contro le chiusure vere,
         su stagioni intere) e i mercati aggiuntivi. Si chiede all'API e si
         legge l'errore, invece di fidarsi di una pagina di listino.
    """
    chiave = os.environ.get('ODDS_API_KEY', '').strip()
    riga()
    riga('== cosa comprerebbero dei soldi spesi qui ==')
    if not chiave:
        riga('nessuna chiave.')
        return

    # ── 1. quali banchi, su tutte le regioni che si possono chiedere ──
    for reg in ('eu', 'eu,uk'):
        try:
            d, testa = chiedi('/sports/%s/odds' % SPORT,
                              {'regions': reg, 'markets': 'h2h', 'oddsFormat': 'decimal'}, chiave)
        except Exception as e:                   # noqa: BLE001
            riga('  regione %-6s errore: %s' % (reg, str(e)[:90]))
            continue
        tutti = {}
        for pa in d:
            for b in pa.get('bookmakers') or []:
                tutti[b.get('key')] = b.get('title')
        riga()
        riga('regione %s: %d banchi, %d partite, %s crediti'
             % (reg, len(tutti), len(d), testa.get('x-requests-last', '?')))
        for k in sorted(tutti):
            riga('    %-22s %s' % (k, tutti[k]))
        # i suoi tre
        riga('  i banchi su cui gioca:')
        for etichetta, aghi in (('bet365', ('bet365',)),
                                ('Eurobet', ('eurobet',)),
                                ('Sporttip', ('sporttip', 'swisslos'))):
            trovati = [k for k in tutti if any(a in (k or '').lower() for a in aghi)]
            riga('    %-10s %s' % (etichetta, ', '.join(trovati) if trovati else 'NON c\'e\''))

    # ── 2. quanto vale prendere il meglio fra i suoi, invece del solo bet365 ──
    try:
        d, _ = chiedi('/sports/%s/odds' % SPORT,
                      {'regions': 'eu,uk', 'markets': 'h2h', 'oddsFormat': 'decimal'}, chiave)
    except Exception as e:                       # noqa: BLE001
        riga('  confronto banchi saltato: %s' % str(e)[:90])
        d = []

    def terna(book, partita):
        for m in book.get('markets') or []:
            if m.get('key') != 'h2h':
                continue
            per_nome = {o.get('name'): o.get('price') for o in m.get('outcomes') or []}
            fuori = [per_nome.get(partita.get('home_team')),
                     per_nome.get('Draw'),
                     per_nome.get(partita.get('away_team'))]
            if all(isinstance(q, (int, float)) and q > 1 for q in fuori):
                return fuori
        return None

    SUOI = ('bet365', 'eurobet', 'sporttip', 'swisslos')
    solo365, meglio_suoi, meglio_tutti, n = [], [], [], 0
    for pa in d:
        libri = {b.get('key'): b for b in pa.get('bookmakers') or []}
        t365 = None
        for k, b in libri.items():
            if 'bet365' in (k or '').lower():
                t365 = terna(b, pa)
        if not t365:
            continue
        ternesue, ternetutte = [t365], []
        for k, b in libri.items():
            t = terna(b, pa)
            if not t:
                continue
            ternetutte.append(t)
            if any(x in (k or '').lower() for x in SUOI):
                ternesue.append(t)
        if not ternetutte:
            continue
        n += 1
        solo365.append(_margine(t365))
        meglio_suoi.append(_margine([max(t[i] for t in ternesue) for i in range(3)]))
        meglio_tutti.append(_margine([max(t[i] for t in ternetutte) for i in range(3)]))

    riga()
    if n:
        def media(l):
            l = [x for x in l if x is not None]
            return sum(l) / len(l) if l else float('nan')
        a, b, c = media(solo365), media(meglio_suoi), media(meglio_tutti)
        riga('ricarico 1X2 misurato su %d partite in arrivo, adesso:' % n)
        riga('  solo bet365                  %5.2f%%' % (100 * a))
        riga('  il meglio dei TUOI banchi    %5.2f%%   (risparmi %.2f punti a gamba)'
             % (100 * b, 100 * (a - b)))
        riga('  il meglio di TUTTO il mercato %4.2f%%   (risparmi %.2f punti a gamba)'
             % (100 * c, 100 * (a - c)))
        for gambe in (2, 3, 4):
            riga('  su una multipla da %d gambe: %.1f%% -> %.1f%% della giocata'
                 % (gambe, 100 * (1 - 1 / (1 + a) ** gambe),
                    100 * (1 - 1 / (1 + b) ** gambe)))
    else:
        riga('nessuna partita con bet365 fra quelle in arrivo: confronto impossibile ora.')

    # ── 3. cosa e' chiuso dietro il piano a pagamento ──
    riga()
    riga('== cosa e\' chiuso dietro il piano a pagamento ==')
    prove = [
        ('storico quote', '/historical/sports/%s/odds' % SPORT,
         {'regions': 'eu', 'markets': 'h2h', 'date': '2026-05-01T12:00:00Z'}),
        ('eventi storici', '/historical/sports/%s/events' % SPORT,
         {'date': '2026-05-01T12:00:00Z'}),
        ('gol/gol', '/sports/%s/odds' % SPORT, {'regions': 'eu', 'markets': 'btts'}),
        ('doppia chance', '/sports/%s/odds' % SPORT, {'regions': 'eu', 'markets': 'double_chance'}),
        ('linee alternative', '/sports/%s/odds' % SPORT,
         {'regions': 'eu', 'markets': 'alternate_totals'}),
        ('marcatori', '/sports/%s/odds' % SPORT,
         {'regions': 'eu', 'markets': 'player_goal_scorer_anytime'}),
    ]
    for nome, percorso, par in prove:
        par = dict(par); par['oddsFormat'] = 'decimal'
        try:
            d, testa = chiedi(percorso, par, chiave)
            riga('  %-18s OK — %s elementi, costo %s crediti'
                 % (nome, len(d) if isinstance(d, list) else 'n/d',
                    testa.get('x-requests-last', '?')))
        except urllib.error.HTTPError as e:
            corpo = e.read()[:220].decode('utf-8', 'replace').replace('\n', ' ')
            riga('  %-18s HTTP %s — %s' % (nome, e.code, corpo))
        except Exception as e:                   # noqa: BLE001
            riga('  %-18s errore: %s' % (nome, str(e)[:90]))


def sonda_mercati_per_evento():
    """I mercati in piu' esistono, ma su un altro indirizzo?

    La sonda di prima chiedeva btts e doppia chance all'indirizzo che porta
    tutte le partite insieme, e si e' presa un 422: "Markets not supported by
    this endpoint". Quel messaggio e' diverso da quello dello storico, che dice
    chiaro "only available on paid usage plans" — qui non dice che manca il
    piano, dice che sbaglio porta. Vale la pena bussare all'altra.

    Se esistono, e' la cosa piu' preziosa che si possa comprare per questo
    progetto: l'app oggi si ancora a DUE assi e da li' DEDUCE quaranta mercati,
    ma la misura piu' netta di tutto il lavoro dice che sul mercato quotato il
    mercato batte il modello, peso ottimale uno, su tutti e tredici i mercati
    provati. Un prezzo vero per il Gol/Gol varrebbe piu' di qualunque cosa io
    possa aggiungere al modello.

    Costa un credito per partita per mercato, quindi qui si guarda anche il
    conto: dieci partite a giornata, quattro giri al giorno, fa presto a
    diventare il piano da pagare.
    """
    chiave = os.environ.get('ODDS_API_KEY', '').strip()
    riga()
    riga('== i mercati in piu\' esistono sull\'indirizzo per singola partita? ==')
    if not chiave:
        riga('nessuna chiave.')
        return
    try:
        eventi, testa = chiedi('/sports/%s/events' % SPORT, {}, chiave)
    except Exception as e:                       # noqa: BLE001
        riga('  elenco eventi: errore %s' % str(e)[:120])
        return
    riga('  eventi in arrivo: %d, costo %s crediti, restano %s'
         % (len(eventi), testa.get('x-requests-last', '?'), testa.get('x-requests-remaining', '?')))
    if not eventi:
        return
    ev = eventi[0]
    riga('  provo su: %s - %s' % (ev.get('home_team'), ev.get('away_team')))
    riga()
    for m in ('btts', 'double_chance', 'draw_no_bet', 'alternate_totals',
              'team_totals', 'h2h_h1', 'totals_h1', 'player_goal_scorer_anytime'):
        try:
            d, testa = chiedi('/sports/%s/events/%s/odds' % (SPORT, ev.get('id')),
                              {'regions': 'eu', 'markets': m, 'oddsFormat': 'decimal'}, chiave)
        except urllib.error.HTTPError as e:
            corpo = e.read()[:150].decode('utf-8', 'replace').replace('\n', ' ')
            riga('  %-26s HTTP %s — %s' % (m, e.code, corpo))
            continue
        except Exception as e:                   # noqa: BLE001
            riga('  %-26s errore: %s' % (m, str(e)[:90]))
            continue
        banchi = [b for b in (d.get('bookmakers') or [])
                  if any(mk.get('key') == m for mk in (b.get('markets') or []))]
        riga('  %-26s OK — %2d banchi, costo %s crediti, restano %s'
             % (m, len(banchi), testa.get('x-requests-last', '?'),
                testa.get('x-requests-remaining', '?')))
        if banchi:
            mk = [x for x in (banchi[0].get('markets') or []) if x.get('key') == m][0]
            campione = ', '.join('%s %s=%s' % (o.get('name'), o.get('point', ''), o.get('price'))
                                 for o in (mk.get('outcomes') or [])[:4])
            riga('      %s: %s' % (banchi[0].get('key'), campione))
            esistente = [b.get('key') for b in banchi]
            riga('      exchange fra questi: %s'
                 % (', '.join(k for k in esistente if 'betfair' in (k or '') or 'smarkets' in (k or ''))
                    or 'nessuno'))


if __name__ == '__main__':
    esito = main()
    sonda_mercati()
    sonda_acquisto()
    sonda_mercati_per_evento()
    sys.exit(esito)
