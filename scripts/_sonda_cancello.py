"""Il cancello risponde? E i calendari ci sono gia' dentro?

Da dove gira l'app di sviluppo non si raggiunge niente: la rete in uscita e'
chiusa. Quindi per sapere se il Worker sta davvero in piedi bisogna chiederlo
da fuori, e "fuori" qui e' un runner di GitHub. Questa sonda non cambia
niente: chiede, guarda, e scrive quello che ha visto.

Tre domande, in ordine, perche' ognuna spiega un guasto diverso:

  1. /api/io risponde?            no  -> il Worker non e' acceso, o l'indirizzo e' sbagliato
  2. che dice per un anonimo?     deve dire "libero", e nient'altro
  3. /api/calendario/I1 porta?    "campionato non disponibile" -> i depositi
                                  sono vuoti, cioe' il giro dei dati non ha
                                  ancora depositato niente. Normale prima del
                                  primo giro, un guasto dopo.

L'indirizzo si legge da MONTHLINE_API, oppure si passa come argomento:

    python3 scripts/_sonda_cancello.py https://monthline.TUONOME.workers.dev
"""
import json
import os
import sys
import urllib.error
import urllib.request


def chiedi(via):
    """Torna (stato, corpo INTERO). Il taglio si fa quando si STAMPA.

    Prima si tagliava qui a quattrocento caratteri, e la sonda diceva "200 ma
    corpo illeggibile" sui campionati con la risposta piu' lunga: non era il
    server, era il taglio che spezzava il JSON a meta'. Una sonda che accusa
    il sorvegliato del proprio difetto e' peggio di nessuna sonda."""
    req = urllib.request.Request(via, headers={'User-Agent': 'monthline-sonda'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:                      # noqa: BLE001
        return None, str(e)[:200]


def breve(testo, quanti=160):
    testo = ' '.join(str(testo).split())
    return testo if len(testo) <= quanti else testo[:quanti] + '…'


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get('MONTHLINE_API', '')).strip()
    base = base.rstrip('/')
    if base and not base.startswith('http'):
        base = 'https://' + base
    print('=== CANCELLO ===')
    if not base:
        print('nessun indirizzo: ne MONTHLINE_API ne argomento. Salto.')
        return 0
    print('indirizzo:', base)

    stato, corpo = chiedi(base + '/api/io')
    print('/api/io ->', stato, breve(corpo))
    if stato != 200:
        print('VERDETTO: il cancello non risponde. Indirizzo sbagliato o Worker spento.')
        return 0
    try:
        io = json.loads(corpo)
    except Exception:                           # noqa: BLE001
        io = {}
    if io.get('tipo') != 'libero' or io.get('tutto') is not False:
        print('VERDETTO: risponde ma dice una cosa strana. Controllare il codice incollato.')
        return 0

    vuoti = []
    for lega in ('I1', 'E0', 'D1', 'SP1', 'F1'):
        stato, corpo = chiedi(base + '/api/calendario/' + lega)
        if stato == 200:
            try:
                d = json.loads(corpo)
                print(lega, '->', len(d.get('calendario') or []), 'partite mostrate su',
                      d.get('totale'), '| tutto =', d.get('tutto'))
            except Exception:                   # noqa: BLE001
                print(lega, '-> 200 ma corpo illeggibile:', breve(corpo))
        else:
            vuoti.append(lega)
            print(lega, '->', stato, breve(corpo))

    if len(vuoti) == 5:
        print('VERDETTO: cancello in piedi, depositi VUOTI. Manca il primo giro dei dati.')
    elif vuoti:
        print('VERDETTO: cancello in piedi, ma mancano i campionati:', ' '.join(vuoti))
    else:
        print('VERDETTO: cancello in piedi e calendari dentro. Si puo accendere l\'app.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
