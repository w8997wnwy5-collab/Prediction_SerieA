# Come si accende il cancello

Dieci minuti, e sono quasi tutti di attesa. Serve un account Cloudflare —
gratuito, e il piano free copre questi numeri senza avvicinarsi ai limiti.

## 1. I due depositi

```bash
cd server
npx wrangler login                      # si apre il browser, accetti
npx wrangler kv namespace create CODICI
npx wrangler kv namespace create DATI
```

Ognuno dei due comandi stampa un `id`. Copiali dentro `wrangler.toml` al posto
di `METTI_QUI_...`.

## 2. I due segreti

```bash
npx wrangler secret put SEGRETO          # incolla una riga lunga e a caso
npx wrangler secret put SEGRETO_ADMIN    # un'altra, diversa
```

Per generarle:

```bash
openssl rand -base64 48
```

`SEGRETO` firma i gettoni: se cambia, tutti devono reinserire il codice.
`SEGRETO_ADMIN` apre il pannello e permette di caricare i dati. Non finiscono
mai in un file del repository, che è pubblico.

## 3. Accendere

```bash
npx wrangler deploy
```

Stampa un indirizzo tipo `https://monthline.TUONOME.workers.dev`. Quello è
l'API.

## 4. Dirlo all'app

In `index.html`, in cima allo script, c'è una riga sola:

```js
var API = '';
```

Ci metti dentro l'indirizzo del punto 3. Finché è vuota l'app funziona come
prima, senza cancello: è apposta, così niente si rompe mentre monti il resto.

## 5. Dirlo al robot dei dati

Su GitHub, nelle impostazioni del repository → *Secrets and variables* →
*Actions* → *New repository secret*, due voci:

| nome | valore |
|---|---|
| `MONTHLINE_API` | l'indirizzo del punto 3 |
| `MONTHLINE_ADMIN` | lo stesso `SEGRETO_ADMIN` del punto 2 |

Da lì in poi ogni giro dei dati deposita i calendari nel deposito, e smette di
scriverli nel repository pubblico.

## 6. Fare i codici

Apri `admin.html` (basta il file, anche dal telefono), incolli il
`SEGRETO_ADMIN` una volta sola, e da lì crei i codici: **VIP** senza scadenza
per chi vuoi tu, **abbonato** con i mesi che scegli per chi paga.

---

## Cosa passa dal server e cosa no

L'**archivio** delle partite giocate resta pubblico sul sito: sono i risultati
di football-data.co.uk, li scarica chiunque. Metterli sotto chiave non
proteggerebbe niente e costringerebbe a far passare tre megabyte per il server
a ogni apertura.

Dal server passa il **calendario**: le partite in arrivo con le quote. È
l'unica cosa che ha senso vendere — le quote costano crediti veri, e sono
quelle che servono per giocare.

Senza codice si vedono le **prime tre partite di ogni campionato**. Non è un
assaggio finto: sono tre partite vere con la selezione vera. Quello che manca
è il resto, e l'app dice quante ne restano dietro.

## Quanto costa tenerlo acceso

Il piano gratuito di Cloudflare dà 100.000 richieste al giorno e 1.000
scritture al giorno sui depositi. Un utente che apre l'app consuma cinque
letture (una per campionato). Il giro dei dati consuma cinque scritture, cinque
volte al giorno: venticinque. Ci stanno dentro migliaia di persone prima di
dover pagare qualcosa.
