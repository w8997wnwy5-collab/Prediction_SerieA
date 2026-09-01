# Modello Serie A

Un modello statistico per la Serie A che gira interamente nel browser: forze di attacco e
difesa di ogni squadra, probabilità di ogni partita su una sessantina di mercati, cartellini
attesi per arbitro, corner, primo tempo — e, la parte che conta, **quanto sbaglia davvero**,
misurato rigiocando le stagioni passate.

I dati si aggiornano da soli quattro volte al giorno, con un robot che vive su GitHub.

---

## Cosa fa

| Sezione | Cosa ci trovi |
|---|---|
| **Giornata** | Le partite in arrivo e, per ciascuna, **cosa ha di diverso dalle altre della stessa giornata**. Toccandola: la matrice di tutti i punteggi, primo tempo/finale, corner, cartellini con l'arbitro che scegli, e i cursori per scontare le assenze. |
| **Ammoniti** | Cartellini attesi partita per partita, ordinati. Chi fischia stretto, chi se le va a cercare. |
| **Schedine** | Un solo campo — quanto ci punti — e da lì quota, probabilità vera e vincita possibile, alla quota equa e con il ricarico del banco. |
| **Squadre** | Attacco contro difesa di tutte e 20, forma recente, corner. |
| **Precisione** | Se ci si può fidare, detto in italiano prima che in numeri. Più sotto: calibrazione, confronto col mercato, e i pronostici che l'app ha segnato da sola. |
| **Dati** | Stato di ogni fonte, quali mercati esistono dove giochi, e la spiegazione onesta di cosa il modello non sa. |

### Due scelte che vale la pena spiegare

**"Cosa ha di diverso" invece di "la più probabile".** Per un po' l'app ordinava
i mercati per probabilità e chiamava "più solida" il primo. Sembra ragionevole e non lo è: il
primo è sempre *Almeno un gol* al 93%, in tutte le partite di tutte le giornate, quota 1.08.
Non è un consiglio, è una constatazione — e occupava il posto della cosa interessante. Quello
che informa non è quanto una cosa è probabile, ma di quanto **questa** partita si scosta dalle
altre. Se l'Under 2.5 vale il 66% dove il resto della giornata sta al 52%, quello è un fatto.

**Nessun dato da inserire a mano.** L'unica cosa che l'app chiede è quanto vuoi puntare. I
pronostici da confrontare con la realtà se li segna da sola, a ogni giornata, e li chiude
quando i risultati entrano in archivio — così si trova giudicata sulle previsioni che ha fatto
davvero, non su quelle che uno si ricorda di aver segnato quando andavano bene.

## Il modello

1. Ogni squadra ha due numeri: **attacco** e **difesa**. I gol attesi di una partita sono
   attacco di una, difesa dell'altra, più il vantaggio del campo.
2. Si stimano tutti insieme massimizzando la verosimiglianza di Poisson, **pesando le
   partite per quanto sono recenti** (una di due anni fa vale meno di un decimo di una di ieri).
3. Il Poisson puro sbaglia sui punteggi bassi: 0-0 e 1-1 capitano più spesso di quanto dica.
   La correzione di **Dixon-Coles (1997)** li rimette a posto, ed entra dentro la stima, non dopo.
4. Un **secondo modello identico stimato sui gol attesi** pesa per una quota decisa dal
   backtest. Dove ci sono, i gol attesi sono gli **xG veri** di Understat; dove non ci sono,
   si deducono dai tiri e si riportano sulla stessa scala.
5. Un **terzo modello sui gol del primo tempo** decide come le reti attese si dividono fra i
   due tempi. Non decide quante sono: quello resta al modello finale, così le due letture non
   possono contraddirsi.
6. **Quando ci sono le quote, il modello le usa.** Si cercano i due gol attesi che riproducono
   quello che dice il mercato su due assi — squilibrio della partita (1X2) e totale reti
   (Over/Under) — e da quella matrice ricadono tutti gli altri mercati. Il peso da dare al
   mercato lo sceglie il backtest.
7. Da lì esce la matrice di tutti i punteggi, e sommando le caselle giuste vengono 1X2,
   Over/Under, Gol/Gol, handicap, combo, totali di squadra, gol esatti: **63 mercati che per
   costruzione non possono contraddirsi fra loro**, più 12 sui tempi.

### Perché ancorarsi al mercato non è barare

Il backtest lo dice da sempre e continua a dirlo: sulle partite quotate, le quote di chiusura
sono più precise di questo modello. Prima l'app si limitava a segnalarlo. Dirlo e non usarlo
è spreco.

Ancorarsi non vuol dire ricopiare. Le quote coprono l'1X2 e l'Over/Under; ancorando i **gol
attesi** invece che le probabilità, l'informazione del mercato arriva anche ai quaranta
mercati che il banco non quota. E la previsione **pura** resta calcolata a parte — è quella
che si vede nel dettaglio della partita, ed è l'unica con cui abbia senso cercare valore.

```
su 770 partite con quote, RPS (più basso è meglio)
  modello da solo   0.19462
  modello ancorato  0.19002      ← quello che l'app mostra
  quote di chiusura 0.18985
  frequenze storiche 0.23138
```

Il modello da solo sta **2.5% dietro** al mercato. Ancorato, sta allo **0.1%**.

## Come si pubblica

1. Su GitHub: **New repository** → nome a piacere → **Public** → Create.
2. **Add file → Upload files**: trascina *tutto* il contenuto di questa cartella, cartelle
   comprese (`.github`, `scripts`, `tools`, `data`) → Commit.
3. **Settings → Pages** → Source `Deploy from a branch` → Branch `main` / `(root)` → Save.
4. **Settings → Actions → General** → in fondo, *Workflow permissions* → seleziona
   **Read and write permissions** → Save. Senza questo il robot non può salvare i dati.
5. **Actions** → *Aggiorna dati Serie A* → **Run workflow**. Dopo un minuto la cartella `data/`
   si riempie e l'app funziona.

> **Se dopo il caricamento la scheda Actions è vuota**, il browser ha saltato la cartella
> nascosta `.github` (capita trascinando cartelle da Finder). Rimedio: nel repository
> **Add file → Create new file**, scrivi come nome `.github/workflows/aggiorna-dati.yml`,
> incolla dentro il contenuto di quel file e committa. Da quel momento la Action compare.

Da lì in avanti il robot gira da solo. Il tasto **Aggiorna** dentro l'app rilegge il file e
rifà i conti; non forza il download, quello lo fa GitHub.

### Chiavi facoltative

Tutto funziona senza registrarsi da nessuna parte. Due chiavi gratuite aggiungono qualcosa:

| Segreto | Da dove | Cosa aggiunge |
|---|---|---|
| `APIFOOTBALL_KEY` | api-sports.io | **Gli arbitri**, che nessun'altra fonte gratuita dà più. Senza questa, la sezione Arbitri resta vuota |
| `FOOTBALL_DATA_TOKEN` | football-data.org | Marcatori e assist, e gli arbitri della **stagione in corso**, che il piano gratuito di API-Football non copre |

Si mettono in **Settings → Secrets and variables → Actions → New repository secret**.

## I dati

| Fonte | Cosa dà | Chiave | Stato |
|---|---|---|---|
| **football-data.co.uk** | risultati, tiri, falli, corner, cartellini, quote di chiusura. Sei stagioni | no | funziona |
| **football-data.co.uk** *fixtures* | orario e **quote delle partite in arrivo** | no | funziona |
| **openfootball** | calendario di tutta la stagione | no | funziona |
| **API-Football** | **arbitri** e statistiche partita | sì, gratuita | funziona (stagioni 2022→2024) |
| **football-data.org** | arbitri in blocco, marcatori e assist | sì, gratuita | non provata: manca il token |
| **Understat** | gli **xG veri** di ogni partita | no | **bloccata** dalle Action |
| **ESPN** | orario, stadio, arbitro, quote | no | **bloccata** dalle Action |

Le ultime due righe meritano una spiegazione, perché sono state scritte, provate e lasciate
dentro lo stesso.

**Understat** risponde `200` ma serve la stessa pagina da 18 704 byte per tutte e sei le
stagioni, senza i dati dentro. Sei URL diversi che restituiscono pagine identiche non sono sei
stagioni mancanti: sono una porta chiusa sull'indirizzo da cui gira la Action. **ESPN**
risponde `403`: blocca gli indirizzi dei datacenter, e i runner di GitHub stanno su Azure.

Il codice resta perché non costa niente e degrada in modo pulito — senza xG veri il modello
continua a dedurli dai tiri, che è quello che faceva prima — e perché da un indirizzo
domestico funzionano: chi fa girare `build_data.py` sul proprio computer li ottiene. Lo stato
di ogni fonte è scritto in `data/meta.json` e visibile nella sezione **Dati** dell'app: se un
giorno si sbloccano, l'app lo dice da sola.

Gli **arbitri** erano il buco più grosso: la colonna di football-data.co.uk è vuota da tempo e
la sezione Arbitri era morta su tutte e 1910 le partite. Adesso arrivano da API-Football, che
con la chiave gratuita copre le stagioni 2022→2024: **1140 partite con arbitro**. Per la
stagione in corso serve il token di football-data.org.

Se tutte falliscono, lo script **non tocca i dati esistenti**: scrive l'errore in
`data/meta.json` e l'app te lo mostra. Meglio dati vecchi dichiarati che dati vuoti a sorpresa.

Una regola che vale per ogni fonte secondaria: può **riempire** una partita che esiste già,
non può **crearne** una. Una fonte che non riconosce una partita produce una riga senza
risultato, e una riga senza risultato dentro l'archivio è un buco che il modello poi scambia
per un dato.

### Perché quattro giri al giorno

Il giro delle 05:17 UTC rilegge tutto: archivio, xG, arbitri. Gli altri tre aggiornano solo
calendario, quote e arbitri. La ragione è che le quote si muovono durante la giornata e il
modello ci si ancora sopra: una fotografia scattata all'alba è già vecchia al fischio
d'inizio. L'archivio invece cambia solo quando si gioca, e ricaricare sei stagioni ogni sei
ore sarebbe maleducato verso fonti che ci lasciano entrare gratis.

## Cosa NON c'è dentro, e perché

Mancano infortuni, formazioni ufficiali, minuti dei singoli, calciomercato, allenatori, meteo.
Alcune di queste cose contano davvero — le formazioni soprattutto — ma nessuna è disponibile
in modo affidabile e completo per ogni partita. **Infilare dati pieni di buchi in un modello
non lo rende più intelligente: lo rende rumoroso.**

Vale la pena raccontare un caso, perché è il tipo di variabile che tutti si aspettano di
trovare. I **giorni di riposo** sono ricavabili dall'archivio senza chiedere niente a
nessuno, quindi sono stati misurati:

```
riposo ≤ 3 giorni   n=238   gol fatti 1.424   subiti 1.328
riposo  > 3 giorni  n=3442  gol fatti 1.292   subiti 1.298
```

Chi gioca ogni tre giorni segna *di più*, non di meno — perché a giocare ogni tre giorni sono
le squadre che fanno le coppe, cioè le più forti. L'effetto del riposo, se c'è, è sepolto
sotto quello. Aggiungerlo al modello avrebbe aggiunto rumore travestito da informazione, e
non è stato aggiunto.

Quello che invece si può fare, e che l'app fa, è lasciarti intervenire dove sai qualcosa che
il modello non sa: nel dettaglio di ogni partita puoi togliere fino al 40% all'attacco di una
squadra e vedere come cambia tutto.

## Come è stato verificato

**1. Campionato finto, verità nota.** `tools/genera_dati_sintetici.py` simula sei stagioni da
parametri decisi a tavolino: forza di ogni squadra, vantaggio del campo, severità di ogni
arbitro, quota di gol nel primo tempo. Poi si guarda se il modello li ritrova.

**2. Backtest walk-forward.** Ogni partita viene prevista usando **solo** i dati precedenti a
quella data, ristimando il modello da capo. Poi si misura con RPS, log-loss e Brier contro le
quote di chiusura e contro una baseline che indovina con le frequenze storiche.

**3. Le fonti nuove, senza rete.** Ogni fonte nuova è un modo nuovo di ricevere spazzatura:
una pagina che cambia formato, un CSV con le colonne rinominate, una partita datata al giorno
dopo. `tools/test_fonti.py` gliela dà in pasto e controlla che la rifiuti.

```bash
python3 tools/genera_dati_sintetici.py /tmp/finto   # campionato finto
python3 tools/test_fonti.py                         # le fonti, senza rete
node tools/test_modello.js /tmp/finto               # ritrova i parametri veri?
node tools/test_backtest.js                         # batte la baseline? è calibrato?
```

## Struttura

| File | Cosa fa |
|---|---|
| `index.html` | interfaccia |
| `modello.js` | il motore: stima, previsione, ancoraggio, mercati, arbitri, corner, backtest. Nessun DOM: gira anche sotto node |
| `worker.js` | fa girare il motore fuori dal thread dell'interfaccia, così lo schermo non si blocca |
| `scripts/build_data.py` | scarica e normalizza i dati da sei fonti (solo libreria standard) |
| `.github/workflows/aggiorna-dati.yml` | il robot: quattro giri al giorno |
| `tools/` | generatore di dati sintetici e le tre prove (41 sulle fonti, 43 sul motore, 15 sul backtest) |
| `data/` | riempita dalla Action: `serie-a.json` e `meta.json` |

## Una nota sul senso di tutto questo

Una probabilità del 65% vuol dire che **una volta su tre finisce diversamente**. Non è un
difetto del modello: è cosa significa 65%. Un modello serve a essere meno impreciso di così,
non a sapere come va a finire. Se qualcuno ti promette il secondo, ti sta vendendo qualcosa.

Vale anche per una serie di risultati azzeccati. Otto su dieci con probabilità intorno al 70%
è un risultato normale e fortunato insieme: il modello ne prometteva sette. La differenza fra
un modello che funziona e uno che sembra funzionare si vede su qualche centinaio di giocate,
non su dieci — ed è per questo che la sezione **Precisione** esiste e mostra i numeri brutti
insieme a quelli belli.
