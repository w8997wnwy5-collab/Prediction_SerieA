# Come si accende il cancello

Serve un account Cloudflare, gratuito. Il piano free copre questi numeri senza
avvicinarsi ai limiti — i conti stanno in fondo.

Due strade per la stessa cosa. La **prima** si fa tutta dal browser e non
richiede di installare niente: è quella da seguire se non hai voglia di
mettere mano a un terminale. La **seconda** è per chi il terminale ce l'ha già
aperto ed è più corta.

---

# Strada A — dal browser, senza installare niente

## A1. L'account

dash.cloudflare.com → registrati. Email e password, niente carta.

## A2. I due depositi

Nel menù a sinistra: **Storage & Databases → KV** (in qualche versione del
pannello si chiama solo *KV*). Poi **Create instance / Create namespace**, due
volte, con questi nomi esatti:

- `CODICI`
- `DATI`

Maiuscoli. Sono i nomi con cui il programma li cerca.

> Due depositi e non uno, e non è pignoleria: i CODICI sono la cosa che non si
> può perdere — se sparisce quel deposito, sparisce chi ha pagato. I DATI si
> riscrivono da soli al giro dopo. Tenerli divisi vuol dire poter svuotare
> l'uno senza rischiare l'altro.

## A3. Il Worker

**Compute → Workers & Pages → Create → Start with Hello World → Deploy**.
Chiamalo `monthline`.

Adesso c'è un Worker che dice "Hello World". Va sostituito col nostro:
**Edit code** (o *Quick edit*), cancelli tutto quello che c'è nell'editor, e
incolli dentro il contenuto di `server/worker.js` — lo apri su GitHub, premi
il pulsante **Raw**, selezioni tutto e copi. Poi **Deploy**.

## A4. Attaccare i depositi al Worker

**Settings → Bindings → Add → KV namespace**, due volte:

| Variable name | KV namespace |
|---|---|
| `CODICI` | il deposito CODICI |
| `DATI` | il deposito DATI |

Se questo passo si salta, il Worker parte lo stesso e poi risponde "campionato
non disponibile" a tutto: è il guasto più facile da fare e il meno ovvio da
capire.

## A5. I due segreti

Sempre in **Settings → Variables and Secrets → Add**, tipo **Secret**:

| nome | cos'è |
|---|---|
| `SEGRETO` | firma i gettoni. Se lo cambi, tutti devono reinserire il codice |
| `SEGRETO_ADMIN` | apre il pannello dei codici e permette di caricare i dati |

Due righe lunghe e a caso, **diverse fra loro**. Se non sai da dove prenderle:
apri una scheda nuova, premi F12 → Console, e incolla

```js
crypto.randomUUID() + crypto.randomUUID()
```

due volte. Vanno bene. Non finiscono mai in un file del repository, che è
pubblico.

`ORIGINI` non serve metterla: senza, vale l'indirizzo dell'app e basta.
Serve solo il giorno che l'app cambia indirizzo.

## A6. L'indirizzo

In cima alla pagina del Worker c'è un indirizzo tipo
`https://monthline.TUONOME.workers.dev`. **Quello è l'API**: copialo.

Provalo subito aprendolo nel browser con `/api/io` in fondo:

```
https://monthline.TUONOME.workers.dev/api/io
```

Deve rispondere `{"tipo":"libero","tutto":false}`. Se risponde quello, il
cancello è in piedi. Da qui salti a **Ultimi due passi**.

---

# Strada B — da terminale

```bash
cd server
npx wrangler login                      # si apre il browser, accetti
npx wrangler kv namespace create CODICI
npx wrangler kv namespace create DATI
```

Ognuno dei due comandi stampa un `id`: copiali dentro `wrangler.toml` al posto
di `METTI_QUI_...`. Poi i segreti e l'accensione:

```bash
openssl rand -base64 48                  # una riga a caso, per ognuno dei due
npx wrangler secret put SEGRETO
npx wrangler secret put SEGRETO_ADMIN
npx wrangler deploy
```

L'ultimo comando stampa l'indirizzo. Quello è l'API.

---

# Ultimi due passi, uguali per tutte e due le strade

## 1. Dirlo all'app

In `index.html`, in cima allo script, c'è una riga sola:

```js
var API = '';
```

Ci metti dentro l'indirizzo. Finché è vuota l'app funziona come prima, senza
cancello: è apposta, così niente si rompe mentre monti il resto.

## 2. Dirlo al robot dei dati

Su GitHub, nelle impostazioni del repository → *Secrets and variables* →
*Actions* → *New repository secret*, due voci:

| nome | valore |
|---|---|
| `MONTHLINE_API` | l'indirizzo del Worker |
| `MONTHLINE_ADMIN` | lo stesso `SEGRETO_ADMIN` |

Da lì in poi ogni giro dei dati deposita i calendari nel deposito, e smette di
scriverli nel repository pubblico.

**Questi due passi vanno fatti insieme.** Mettere i segreti su GitHub senza
mettere l'indirizzo in `index.html` vuol dire calendari fuori dai file
pubblici e un'app che non sa dove andarli a riprendere. L'app in quel caso lo
dice invece di fingere che la stagione sia finita, ma resta un'app vuota per
niente.

## 3. Fare i codici

Apri il pannello **dal sito**:

```
https://w8997wnwy5-collab.github.io/Prediction_SerieA/admin.html
```

Non aprendo il file dal telefono o dal computer con un doppio clic: da lì il
browser considera la pagina "senza indirizzo" e il server la rifiuta, per la
stessa regola che impedisce a un sito qualunque di parlare con questa API.

Incolli l'indirizzo del Worker e il `SEGRETO_ADMIN` una volta sola — restano
sul tuo telefono, non vanno da nessuna parte — e da lì crei i codici: **VIP**
senza scadenza per chi vuoi tu, **abbonato** con i mesi che scegli per chi
paga.

---

## Cosa passa dal server e cosa no

L'**archivio** delle partite giocate resta pubblico sul sito: sono i risultati
di football-data.co.uk, li scarica chiunque. Metterli sotto chiave non
proteggerebbe niente e costringerebbe a far passare tre megabyte per il server
a ogni apertura.

Dal server passa il **calendario**: le partite in arrivo con le quote. È
l'unica cosa che ha senso vendere — le quote costano crediti veri, e sono
quelle che servono per giocare.

Senza codice si vedono le **prime tre partite di ogni campionato**, e sono le
prime tre ancora da giocare, non le prime tre righe del file. Non è un
assaggio finto: tre partite vere con la selezione vera. Quello che manca è il
resto, e l'app dice quante ne restano dietro.

## Quanto costa tenerlo acceso

Il piano gratuito di Cloudflare dà 100.000 richieste al giorno e 1.000
scritture al giorno sui depositi. Un utente che apre l'app consuma cinque
letture (una per campionato). Il giro dei dati consuma cinque scritture,
cinque volte al giorno: venticinque. Ci stanno dentro migliaia di persone
prima di dover pagare qualcosa.
