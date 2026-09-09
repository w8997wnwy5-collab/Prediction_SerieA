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
| **Il mio libro** | Le giocate vere, a quote vere, sui banchi veri: da lì il ricarico misurato per banco, la calibrazione personale e se discostarsi dal modello conviene. |
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

**Una quarta prova, ma su dati veri.** Le tre qui sopra dicono se il motore è
sano. Non dicono se una schedina si prende, e quella è la domanda che uno si fa
davvero. `tools/verifica_giornata.js` rifà esattamente il gesto dell'app —
sceglie "la più solida" con lo stesso identico filtro della copertina — su una
giornata già giocata, allenando il modello **solo** sulle partite precedenti.
Niente di quello che è successo dopo entra nella previsione: se entrasse, il
punteggio sarebbe un complimento che ci si fa da soli.

```bash
node tools/verifica_giornata.js                     # l'ultima giornata giocata
node tools/verifica_giornata.js 2026-09-04 2026-09-07
node tools/misura_arbitri.js                        # l'arbitro sposta i gol? (no)
node tools/misura_indipendenza.js                   # le giocate cadono insieme? (no)
node tools/misura_valore.js                         # si batte il mercato? (no, e c'è di peggio)
node tools/ottimizza_regola.js                      # quale soglia conviene? (nessuna, e va bene così)
node tools/misura_handicap.js                       # l'handicap dice qualcosa in più? (no)
node tools/misura_campo.js                          # il campo pesa diverso per squadra? (no)
node tools/misura_neopromosse.js                    # serve l'archivio di Serie B? (no)
node tools/tara_memoria.js                          # i parametri a occhio erano sbagliati? (no)
node tools/misura_ancora_ou.js                      # l'Over/Under a ricarico zero aiuta? (no)
node tools/misura_stringimento.js                   # l'ancoraggio deve stringere di più quando il modello alza la voce? (no)
node tools/misura_mercati.js                        # il peso giusto è lo stesso su tutti i mercati? (sì: uno)
node tools/ottimizza_mese.js                        # quale struttura chiude il mese in attivo più spesso
node tools/misura_multigol.js                       # Multigol 1-4 ovunque: bug o regola che fa il suo mestiere?
```

### Le notizie, e cosa possono fare

Le fonti raggiungibili dalla Action sono state provate una per una
(`scripts/sonda_fonti.py`, che gira su richiesta): rispondono 14 su 19. Quello
che ne è venuto fuori, in ordine di valore reale:

**TheSportsDB** pubblica partita per partita invece che a giornata chiusa. È
l'unica che il lunedì mattina ha i risultati del venerdì — le altre due
aspettano il posticipo. Non ha tiri né arbitro, quindi non basterebbe da sola,
ma il risultato ce l'ha per primo, ed è quello che serve per non restare fermi.
Entra come terza fonte, con un filtro: si accettano solo sfide fra squadre che
l'archivio già conosce, perché una partita inventata è molto peggio di una
partita mancante.

**Gli infortuni no.** `API-Football` li ha, ma il piano gratuito risponde
`"Free plans do not have access to this season, try from 2022 to 2024"`. Il
dato che sarebbe servito di più è l'unico negato.

**Tre RSS su otto provati** sono rimasti in piedi, e non per scelta di gusto —
i contatori hanno bocciato gli altri:

| feed | esito |
|---|---|
| ANSA | 44 titoli tenuti su 65 |
| Football Italia | 19 su 20 |
| Repubblica | 13 su 25 |
| Gazzetta `/calcio` | 99 titoli, zero: è fantacalcio e rubriche |
| Gazzetta `/serie-a` | 100 titoli, zero: 65 più vecchi di dieci giorni — è un archivio, non un flusso |
| corriereobjects | 8 titoli, zero |
| Sky `sport.sky.it` | ha risposto alla sonda e poi 404 al giro vero |
| Tuttomercatoweb | 403 |

I titoli vengono raccolti, attaccati alle squadre che nominano, e mostrati
**accanto** alla partita — mai dentro il calcolo.

Due cose imparate dal primo giro vero, che nessuna sonda poteva anticipare.
I titoli non chiamano le squadre come le chiamano le tabelle: "Juve" è scritto
più spesso di "Juventus", e "Nerazzurri" non contiene "Inter" — c'è una tabella
di soprannomi, con dentro solo quelli che stanno per una squadra sola
(«bianconeri» è Juventus ma anche Udinese, e resta fuori). E quando una fonte
non dà niente, il riepilogo riporta il motivo dello scarto e un paio di titoli
veri: «zero su novantanove» non è un numero, è una domanda.

Oltre alle assenze c'è un secondo tipo di notizia, che pesa di più: **chi siede
in panchina**. Il primo giro ha pescato «la Fiorentina esonera Grosso dopo 3
giornate», ed è la cosa che il modello sa peggio di tutte — le forze di una
squadra sono calcolate sui risultati di una squadra che da domani è guidata da
un altro, e nessun decadimento temporale se ne accorge. Va in cima con la sua
etichetta. Tre fonti che raccontano lo stesso esonero diventano una riga sola
con «e altre 2 fonti»: due infortuni diversi invece restano due notizie,
perché accorparli sarebbe nascondere.

Perché fuori dal calcolo, e non è pigrizia. "La Roma ha nove punti su nove" è
informazione che il mercato ha già, e il mercato lo usiamo come ancora: quella
notizia è già dentro le probabilità, arrivata per la porta giusta. E la tabella
qui sotto mostra cosa succede quando il modello si fa un'opinione propria
contro il mercato.

Quello che il mercato ha e noi no sono le **assenze**. Quelle non si sanno
pesare senza i dati sui singoli, che la fonte gratuita non concede per la
stagione in corso. Quindi si mettono davanti a chi gioca: un elenco di parole
(`infortun`, `squalific`, `out`, `forfait`, …) marca i titoli che sembrano
segnalare un'assenza. Non capisce la frase — sbaglia in entrambe le direzioni,
ed è scritto nell'app.

Con le notizie sono spariti gli ultimi due cursori dell'app, quelli con cui
bisognava dire a mano chi mancava. Chiedevano proprio il dato che nessuno sa a
memoria.

**Il "gran momento" invece era già dentro.** La forma recente — punti, gol
fatti e subiti nelle ultime 3, 5 e 8 partite — è stata confrontata con quello
che il modello sbaglia: tutte le correlazioni comprendono lo zero (la più
grande è r = −0.067). Il decadimento temporale del modello la cattura già.

### Due cose che erano nel file e non guardavo

Ho sondato le colonne del CSV di football-data cercando informazione gratis.
Ne sono uscite **77 che non usavo**, e due contavano.

**Gli xG veri**, nelle colonne `HxG` e `AxG`, piene al 100%. Per mesi il modello
li ha dedotti dai tiri mentre provavo a scaricarli da Understat — che blocca
l'indirizzo della Action — e intanto arrivavano ogni giorno dentro un file che
apro da sempre. Football-data li pubblica dalla stagione 2026-27: oggi sono 30
partite, a fine stagione 380, e sono le più pesate dal modello.

**Le quote di chiusura.** La `C` in mezzo al nome (`AvgCH` invece di `AvgH`)
vuol dire chiusura: il prezzo con cui la partita è andata in campo, dopo che il
mercato ha assorbito formazioni e infortuni. Usavo l'apertura, e non per una
scelta — perché `AvgH` veniva prima nell'elenco che avevo scritto io.

E una terza, cercata dopo aver visto le altre due: **Betfair Exchange**. Non è
un bookmaker, è un mercato dove la gente scommette contro altra gente e la casa
prende una commissione invece di caricare il margine sul prezzo. Misurato su
770 partite: la somma delle sue probabilità sta a **1.005** contro **1.055** dei
bookmaker. Conta perché per usare una quota come probabilità bisogna togliere il
margine, e il modo con cui lo tolgo è tanto più storto quanto più il margine è
grosso.

| | RPS |
|---|---|
| modello senza ancoraggio | 0.19531 |
| ancorato ai bookmaker | 0.19003 |
| **ancorato a Betfair Exchange** | **0.18950** |
| Betfair Exchange da solo | 0.18938 |
| i bookmaker da soli | 0.18992 |

L'exchange vale +0.28% (z = 2.01) e batte i bookmaker anche da solo. Poco, ma
gratis e nella direzione giusta.

**E poi il limite dichiarato che non esisteva.** Per settimane qui c'è stato
scritto: *"il file delle partite in arrivo non porta le quote dell'exchange,
quindi nello storico mi ancoro a Betfair e quando gioco ai bookmaker."* Era
onesto come dichiarazione e falso come fatto. Il file delle partite in arrivo le
porta eccome — è la funzione che lo legge che chiamava `quote_da_riga` e non
`quote_extra_da_riga`, due parole di differenza in una riga sola.

Il risultato: `qex` c'era su tutte e 1930 le partite già giocate e su **zero**
delle 360 in calendario. Cioè il miglior guadagno della stagione, misurato e
verificato, esisteva in ogni backtest e in nessuna giocata — e proprio nel
momento in cui serve la stima più pulita il modello si ancorava alla quota media
col 5% di ricarico dentro.

Vale la pena dire come non è stato trovato: non da una prova. Le 111 prove
guardavano tutte una riga di CSV **già giocata**, che quel percorso ce l'aveva.
È saltato fuori aprendo il file pubblicato e contando i campi. Adesso c'è una
prova che legge il *sorgente* e pretende che dove si chiama `quote_da_riga` si
chiami anche `quote_extra_da_riga`, così la prossima famiglia di quote non può
entrare da una porta sola.

La morale, che vale più del bug: **un limite dichiarato è comodo.** Scriverlo
sembra rigore, e intanto chiude la questione — nessuno va più a controllare se
era vero. Questo era lì da settimane, in un README che si vanta di misurare
tutto.

### La maledizione del vincitore

La domanda giusta da fare a un modello di scommesse: **se sono alla pari col
mercato, giocare dove ci DISSENTO non dovrebbe pagare?**

La risposta è no, e all'incontrario. Sulle quote vere di chiusura, 5800 giocate
possibili, modello **senza** ancoraggio — quello con un'opinione propria:

| dove il modello si dava… | resa | prese contro promesse |
|---|---|---|
| −10% o meno | −5.9% | 44.6% contro 39.0% |
| fra −10% e 0 | −1.9% | 42.7% contro 41.4% |
| fra 0 e +5% | −8.0% | 40.3% contro 43.8% |
| fra +5% e +10% | −11.1% | 36.0% contro 42.6% |
| fra +10% e +20% | −14.8% | 27.9% contro 36.3% |
| **più di +20%** | **−35.3%** | **14.0% contro 26.6%** |

Più il modello si credeva in vantaggio, peggio andava. Non è sfortuna: dove
dissente di più dal mercato non è perché ha visto qualcosa, è perché lì sta
sbagliando di più. Un filtro "gioca dove hai vantaggio" non pesca le occasioni —
pesca gli errori peggiori del modello, uno per uno.

È il motivo per cui l'app **usa** le quote invece di scommetterci contro.
Ancorata al mercato, il dissenso sparisce (5466 giocate su 5800 finiscono nella
fascia −10%/0) e le probabilità diventano oneste: 47.7% promesso, 47.7% uscito.
Con il dissenso sparisce anche ogni vantaggio, e va bene così — meglio numeri
veri senza vantaggio che numeri gonfi con un vantaggio che non esiste.

### Non c'è una soglia migliore: c'è una frontiera

L'app propone di ogni partita una giocata sola. Per sceglierla scarta le troppo
probabili — sopra una certa soglia la quota non paga niente — e fra le rimaste
prende quella col pavimento più alto. Quella soglia è stata 0.78 per mesi,
scelta a occhio.

`tools/ottimizza_regola.js` la mette alla prova: tre criteri × sei soglie,
scelti su 46 giornate e **misurati su 47 mai viste**, così la vincitrice non può
esserlo per caso. Due risultati.

**Non esiste una soglia migliore.** Non può esistere: il modello è calibrato e
senza vantaggio, quindi ogni soglia ha lo stesso valore atteso. Cambia il
profilo, misurato sulle giornate mai viste:

| soglia | ne prende | quota di tutte e dieci | almeno 8 su 10 |
|---|---|---|---|
| 0.74 | 71% | ~43 | 34% |
| 0.78 | 75% | ~30 | 40% |
| 0.82 | 78% | ~15 | 55% |
| 0.86 | 79% | ~10 | 65% |

Non è un ottimo da trovare, è una frontiera da scegliere — quindi è diventata
una **manopola** in Giornata, con questi numeri accanto a ogni posizione.

**Un difetto vero, però, c'era.** A 0.78 il modello prometteva meno di quanto
manteneva: 71.1% contro 75.4% uscito, +4.4 punti (z = +2.1), e lo stesso segno
sulla metà di scelta. È un errore a favore di chi gioca, ma resta un errore, e
sporcava la distribuzione "quante ne prendi" e tutto quello che ci sta sopra.
Dallo 0.82 in su i conti tornano: per questo il valore di partenza ora è quello.

Il criterio di ordinamento, invece, conta quasi niente: pavimento e probabilità
danno lo stesso risultato a ogni soglia.

### Quante ne prendi, e come le impacchetti

Una schedina da dieci si racconta come "esce o non esce", ed è il modo in cui si
perde la parte interessante. Dieci selezioni al 75% l'una **non** fanno dieci su
dieci il 75% delle volte: lo fanno il 5.6%. Il risultato più probabile è otto.

È lo stesso identico pronostico — cambia solo come lo si impacchetta. E
cambiare l'impacchettamento cambia due cose diverse, che vale la pena tenere
separate:

**Il rischio**, che è ovvio. **Il prezzo**, che non lo è: il ricarico del banco
si moltiplica a ogni selezione. Su una singola paghi il 5.6% (bet365, misurato);
su un'accumulata da dieci paghi 1.056¹⁰, cioè il **42%**. Con le stesse dieci
selezioni al 75% e gli stessi 20 chf:

| come | in attivo | ti torna | al massimo |
|---|---|---|---|
| una da 10 | 6% | 11.60 | 206 |
| 2 da 5 | 42% | 15.23 | 64 |
| 3 da 3 + 1 | 38% | 17.47 | 37 |
| 5 da 2 | 28% | 17.94 | 32 |
| 10 singole | 53% | 18.94 | 25 |

Non è un invito a non farle: l'accumulata è l'unica che può pagare 206, e
nessuna delle altre ci arriva. È che se una la fai, tanto vale sapere che stai
comprando una lotteria a quel prezzo, e non un pronostico a quel prezzo.

Il 5.6% non è scelto: è il ricarico misurato di bet365 su 1930 partite, ed è la
storia della sezione qui sotto. La manopola in **Schedine** rifà tutta la
tabella — e quando il **libro** ha otto giocate segnate, il numero che ci
mette dentro è quello vero di chi gioca, non di un banco medio.

Il conto è **esatto, non simulato**: con dieci selezioni gli scenari possibili
sono 1024 e si enumerano tutti. Regge però su un'ipotesi — che le selezioni
siano indipendenti — e quell'ipotesi è stata verificata invece che assunta.
`tools/misura_indipendenza.js` rigioca 93 giornate e confronta la varianza
osservata del numero di esiti presi con quella teorica: **1.985 contro 1.994**,
rapporto 1.00. Dieci Over della stessa giornata non cadono insieme. Se cadessero,
tutta questa parte sarebbe sbagliata.

Sulle stesse 93 giornate: 692 selezioni prese su 927 (74.6%) contro il 71.8%
promesso, z = 1.95. Il modello promette un filo meno di quanto mantiene.

### Il ricarico del banco, che assumevo invece di misurarlo

Per mesi il conto delle schedine partiva da 6.5%. Non era una misura: era un
numero scelto a occhio perché suonava plausibile, e governava la riga più
importante di tutta la sezione. Nei file che scarico ci sono, per ogni partita,
sia la quota **media** di tutti i bookmaker sia la **migliore** del mercato.
Bastava sommare le tre probabilità implicite e vedere di quanto passano l'unità.
Su 1930 partite di Serie A:

| | ricarico |
|---|---|
| **bet365** | **5.63%** |
| media dei bookmaker europei | 4.90% |
| Betfair Exchange | 0.51% |
| la migliore del mercato, esito per esito | **0.00%** |
| quello che questa app assumeva | 6.50% |

Lo zero non è un errore di conto. Se per ogni singolo esito si prendesse il
banco più generoso fra tutti, il ricarico collettivo sparisce: i bookmaker si
scavalcano a vicenda abbastanza da annullarlo. Non è però una cosa che chi
gioca su un sito solo possa fare, e infatti il numero che conta per l'app è il
4.9%.

**bet365 sta sopra la media europea, non sotto.** Ed è il punto: la media di
tutti i bookmaker è un numero onesto su banchi che nessuno usa tutti insieme.
Chi gioca, gioca da qualche parte in particolare. Perciò il valore di partenza
della manopola è quello di un banco vero e misurato (5.6%), non la media —
e le altre posizioni servono da confronto: 4.9% la media europea, 8.5% poca
concorrenza, 11% monopolio.

**Sporttip** e **Eurobet**, gli altri due banchi in uso, in questo file non ci
sono. Sporttip in particolare è in concessione unica in Svizzera, e i monopoli
di solito ricaricano di più — ma quanto, non lo so e non me lo invento. Il modo
per saperlo non è una schermata da chiedere: è **Il mio libro** (sezione
successiva), che lo misura da otto giocate segnate.

Non è cosmetica. Le stesse dieci selezioni, gli stessi 20 chf: l'accumulata
rende 11.60 al 5.6% e 7.04 all'11%, perché il ricarico si compone a ogni
selezione. Un parametro inventato che sposta il risultato del 40% è peggio di
un parametro mancante, perché non si vede.

### Chiudere il mese in attivo non è la stessa domanda di guadagnare

Questa è la parte del progetto che non somiglia a nient'altro, e non perché sia
complicata: perché risponde a una domanda che le app di scommesse non pongono.

Ovunque, qui e altrove, si ottimizza il **valore atteso**: quanto torna in
media. È la domanda giusta se l'obiettivo è guadagnare. Ma *"voglio chiudere il
mese in attivo"* è una richiesta diversa e legittima — ed è la richiesta vera di
quasi tutti quelli che giocano. Le due risposte non solo differiscono: spesso
sono **opposte**, e si dimostra in tre righe.

Il valore atteso di un mese, a budget fisso `B`, con selezioni a probabilità `p`
e un banco che ricarica `m` per gamba, dipende **solo** dal numero di gambe `L`:

```
atteso = B / (1+m)^L
```

Non da quante schedine fai. Non da quali. Solo da `L`. Quindi, se l'obiettivo
fosse il ritorno medio, la risposta è una sola — singole — e non c'è altro da
dire.

La **probabilità di chiudere in attivo** no. Quella dipende eccome da quante
schedine fai, e cambia molto, perché per stare sopra ti serve un **numero
intero** di schedine vincenti. Con quattro schedine da 20 a quota 2.01 te ne
servono due; con due da 40 te ne basta una. Il conto medio non se ne accorge —
è identico nei due casi. Su un caso reale la differenza è di **10 punti di
probabilità a valore atteso invariato**: l'unica cosa gratis di tutto il
progetto.

E sotto c'è un teorema vero. In un gioco **sfavorevole** — e col ricarico lo è
sempre — la legge dei grandi numeri non è tua amica: più giocate fai, più il
risultato si incolla alla media, che sta sotto zero. L'incertezza è l'unica cosa
che può metterti sopra, e concentrare è il modo di comprarne. È il *bold play*
di Dubins e Savage (1965). Nessuna app lo scrive, perché "concentra" suona
irresponsabile — e non lo è, se accanto c'è scritto per intero quanto costa.
Nell'app le due colonne stanno sempre affiancate: la probabilità di chiudere in
attivo si **compra**, e si paga in valore atteso.

**Il conto è esatto, non simulato.** La distribuzione dei ritorni di una
giornata si enumera tutta (2ⁿ scenari), e il mese è quella distribuzione
convoluta con sé stessa quattro volte — legittimo perché l'indipendenza fra
giornate è stata *verificata*, non assunta. Simulare sarebbe stato più facile e
più sbagliato proprio dove conta: la coda destra è fatta di eventi rari, ed è
l'unica cosa che tiene sopra un mese quando il gioco è sfavorevole. La media
viaggia esatta accanto alla griglia, perché su quattro convoluzioni
l'arrotondamento si accumula.

E la tabella **non dà per scontata la propria tesi**: quando le selezioni più
solide sono davvero solide, le singole vincono su tutti e due i fronti e la
scheda lo dice. Si rifà a ogni giornata.

### Multigol 1-4 dappertutto: onesto e monotono insieme

Accendendo i mercati multigol, l'app propone **Multigol 1-4 su nove partite su
dieci**. Sembra un bug. Non lo è, ed è più interessante di un bug.

"La più solida" ordina per **pavimento** — il fondo della banda di incertezza —
e prende la prima sotto la soglia di prudenza. Multigol 1-4 vuol dire *"fra uno
e quattro gol"*: sta al 78-81% in ogni partita di ogni giornata, ha quindi il
pavimento più alto ovunque, e sotto la soglia dello 0.82 ci passa. Vince ovunque
perché è davvero, ovunque, la cosa più solida.

È lo stesso inciampo di *"Almeno un gol al 93%"*, che questo README dichiara di
aver già corretto. La correzione era un tetto sulla probabilità. Multigol 1-4
passa sotto il tetto.

E c'è un dettaglio che rende la cosa peggiore di quanto sembri: quando la regola
di selezione è stata tarata, **i multigol non erano nell'elenco dei mercati
misurati**. La manopola della prudenza, coi suoi numeri, descrive un mondo senza
multigol. Accendendoli, l'app usciva dal proprio collaudo continuando a mostrare
i numeri di prima.

Rimisurato su 93 giornate coi multigol accesi (`tools/misura_multigol.js`):

| regola | prese | promesse | scarto | quota | 8 su 10 | selezioni diverse |
|---|---|---|---|---|---|---|
| pavimento (come adesso) | 79.9% | 79.4% | +0.4σ | 9.9 | 62% | **2.6 su 10** |
| pavimento, ma distintiva | 69.9% | 69.7% | +0.2σ | 42.5 | 41% | **5.3 su 10** |

Due cose vanno dette insieme, e separarle sarebbe disonesto. **La regola resta
calibrata:** prende quanto promette, a 0.4σ. Non è rotta. **E dice la stessa
cosa in ogni partita:** 2.6 selezioni diverse su dieci. Una previsione che non
cambia da partita a partita non informa su nessuna partita — l'app mostrava
dieci volte un fatto sul *campionato* travestito da dieci fatti sulle *partite*.

Notare che il problema esisteva già senza multigol: 2.8 selezioni diverse su 10.
I multigol lo hanno solo reso impossibile da non vedere.

La correzione non è cambiare la regola di nascosto — sarebbe scambiare dieci
punti di probabilità senza dirlo. È **una manopola con i due numeri scritti**, e
un avviso in Giornata quando la stessa selezione esce su più di due terzi delle
partite. Se l'obiettivo è chiudere il mese in attivo, la più solida vince
davvero: gambe più probabili, e su una multipla corta è quello che conta. Se
l'obiettivo è sapere cosa ha di diverso questa partita, la distintiva è l'unica
che risponde.

### Il modello non deve avere opinioni

Il risultato più scomodo che sia uscito da questo progetto, e quello che ne
ridefinisce lo scopo.

L'ancoraggio fonde la previsione del modello con quella del mercato, con un
peso. Sweepando quel peso sull'errore di previsione dell'1X2, la curva è
monotona **fino al bordo**:

| peso al mercato | errore |
|---|---|
| 0 (il modello da solo) | 0.19049 |
| 0.85 (come faceva l'app) | 0.18402 |
| **1 (il modello zitto)** | **0.18359** |

Poi misurato su **tredici mercati**, con Brier e train/test: il peso migliore è
**1 su tutti e tredici**. Sull'esito di una partita, l'opinione del modello
sulle forze delle squadre vale zero, e ogni grammo di voce che le si concede
peggiora la previsione.

La conclusione facile — "allora il modello è inutile" — è sbagliata, ed è qui
che sta il punto. **Il banco quota tre mercati; l'app ne mostra quaranta.** Il
valore del modello non è indovinare chi vince: è prendere i due numeri che il
mercato regala (supremazia e gol totali) e propagarli a quaranta mercati che
nessuno quota, tenendo insieme le correlazioni fra di essi. Non è poco — è
esattamente quello che il banco non ti dà — ma non è avere un'opinione.

Nessuno tara l'ancoraggio così, perché tutti lo tarano sull'1X2, che è l'unico
mercato su cui il confronto è comodo.

**Il limite dichiarato, e stavolta verificato prima di dichiararlo:** tutto
questo è misurato sulle quote di **chiusura**, che sono la stima migliore che
esista e non sono quelle che hai in mano quando punti. Chi gioca prima delle
formazioni ufficiali ha l'**apertura**, più grezza. Se il mercato di chiusura è
molto più informato del modello ma quello di apertura lo è meno, il peso giusto
non è 1 in quel momento — e tararlo sulla chiusura vuol dire tararlo su una
situazione in cui non ci si trova mai. Le colonne di apertura sono ora
nell'archivio, tenute separate, per poterlo misurare.

### Il mio libro: la parte che non si può chiedere

Tutto il resto di questo progetto è replicabile, ed è giusto così. I dati sono
pubblici, il metodo è scritto qui per intero, e due persone che partono da qui
arrivano allo stesso posto. La statistica non è di nessuno.

Le giocate di una persona sì. A che quota le ha prese, su quale dei suoi banchi,
quali ha scelto fra quelle proposte e quali si è inventato. Non si scaricano da
nessuna parte e non si possono chiedere: si accumulano una alla volta. E
rispondono a tre domande che il modello, da solo, non può nemmeno formulare.

**1. Quanto costa giocare, davvero.** Non la media europea — il ricarico di
*questo* banco su *queste* quote. Il libro lo misura in due modi, e uno è
nettamente migliore:

- **quota tua ÷ migliore del mercato di quel giorno.** Funziona perché il
  ricarico della migliore del mercato è **zero**, misurato: i banchi si
  scavalcano abbastanza da annullarlo. Quindi la differenza fra i due prezzi
  *è*, quasi esattamente, quello che si prende il banco. Nessun modello in
  mezzo: prezzo contro prezzo. Vale su 1X2 e Over/Under 2.5, gli unici mercati
  per cui l'archivio porta la quota massima.
- **quota equa mia ÷ quota tua.** Disponibile su tutti i mercati, ma ci porta
  dentro il mio errore: se sbaglio io del 3%, quel 3% finisce nel conto del
  banco. Ripiego, dichiarato come tale.

Da otto giocate in poi compare una quinta posizione nella manopola del
ricarico — **"Il mio"** — e da lì in poi i conti delle schedine sono i suoi
invece che una media.

**2. Quanto è calibrato il modello sulle partite che sceglie lui**, che non è
la stessa cosa che essere calibrato in media: di cento partite ne gioca dieci,
e quelle dieci sono una selezione, non un campione.

**3. Quando si discosta dal modello, ci guadagna o ci perde?** È la versione
personale della maledizione del vincitore. Sul modello quella misura fa paura
(−35% dove crede di avere il 20% di vantaggio). Su una persona non si sa: vede
cose che il modello non vede — un'assenza, una squadra che sta bene — ma è
anche l'unica delle due parti che può affezionarsi a una squadra.

Due dettagli di progetto che contano più di quanto sembri:

- **L'esito non lo scrive l'utente.** Si segnano due cose sole, quota presa e
  banco; il risultato lo mette l'app quando arriva, via `M.haVinto` sui dati
  già in casa. Chiedere anche il risultato vorrebbe dire chiedere due volte,
  e la seconda non la fa nessuno — è il motivo per cui la maggior parte dei
  registri di scommesse resta vuota dopo tre settimane.
- **Non c'è nessun server.** Il libro sta in `localStorage`, e si esporta e
  reimporta come testo. Non passa da nessuna parte perché non c'è nessuna parte
  da cui passare.

### Le idee buone che i dati hanno bocciato

Erano tutte ragionevoli, tutte avevano un meccanismo credibile dietro, e tutte
sono state misurate invece che dichiarate. Sono qui perché un'idea provata e
bocciata vale quanto una accettata: senza il conto scritto, fra sei mesi
qualcuno la riprova.

**L'arbitro.** Un arbitro che fischia tanto spezzetta la partita; una partita
spezzettata ha meno gioco effettivo; con meno gioco si fanno meno gol. Le
designazioni escono due o tre giorni prima, cioè in tempo per giocarci.
`tools/misura_arbitri.js` la prova in tre modi, dal più indulgente al più
severo:

| | |
|---|---|
| dispersione dei residui per arbitro | **1.07** (se l'arbitro non conta vale 1.00) |
| quanto è severo di suo ↔ gol in più/meno | **r = −0.10**, intervallo (−0.48, +0.31) |
| errore di previsione senza l'arbitro | **0.19246** su 680 partite mai viste |
| errore di previsione con l'arbitro | **0.19274** — peggiora, z = −2.1 |

Il segno torna: viene negativo dovunque lo si guardi, esattamente come dice
l'ipotesi. Ma è troppo piccolo per distinguersi dal caso, e dandolo in pasto al
modello l'errore **sale**. Un dato vero ma debole non è informazione in più: è
rumore in più — e il rumore è tanto più insidioso quanto più la storia che lo
accompagna è convincente.

Dove l'arbitro conta davvero è sui cartellini: dal più mite al più severo si
passa da 3.1 a 5.8 gialli a partita, quasi il doppio. Quella tabella è rimasta
in **Squadre**, come fatto sulla Serie A e non come previsione da giocare.

**L'handicap asiatico come terzo ancoraggio.** Il modello si ancora al mercato
su due assi: chi è più forte (dall'1X2) e quanti gol si faranno (dall'Over/Under
2.5). L'handicap asiatico è un terzo mercato, con la sua linea e le sue quote, e
dice la stessa cosa del primo asse ma con più precisione — le linee vanno di un
quarto di gol invece che a salti. Sembrava informazione gratis.
`tools/misura_handicap.js` misura quanto le due letture si somigliano e poi
quale delle due prevede meglio:

| | |
|---|---|
| correlazione fra la supremazia letta dai due mercati | **r = 0.909** |
| scarto tipico fra le due letture | **0.6 punti** di quota |
| errore ancorandosi all'1X2 | **0.24910** |
| errore ancorandosi all'handicap | **0.24932**, z = 0.58 |

Le due letture sono la stessa lettura. Dove differiscono, differiscono di un
soffio, e quel soffio non contiene niente: la differenza fra i due errori è
dentro il rumore. Aggiungere l'handicap avrebbe raddoppiato il codice
dell'ancoraggio per riscrivere un numero che già avevo. Il conto della
probabilità di handicap (`probHandicap`, con i rimborsi delle linee intere e le
mezze poste sui quarti) è rimasto nel motore, perché è un mercato che si può
voler giocare — ma non entra nella stima.

**Il vantaggio del campo, squadra per squadra.** Che il campo pesi non è in
discussione: il modello lo stima e vale mezzo gol. Il dubbio era se pesi
*uguale* per tutti. Uno stadio pieno e ostile non può valere quanto uno vuoto,
e nei residui si vedeva: dispersione 1.26 invece di 1.00, la Roma mezzo gol
sopra la media in casa, il Monza mezzo gol sotto. `tools/misura_campo.js` prova
a dare a ogni squadra il suo, tirato verso la media di quanto serve (il
parametro *k*: più è alto, meno ogni squadra si allontana dalla media):

| effetto campo | errore fuori campione |
|---|---|
| tutto per squadra, nessun freno | 0.19871 |
| k = 20 | 0.19695 |
| k = 80 | 0.19595 |
| k = 160 | 0.19566 |
| **uguale per tutti (come adesso)** | **0.19542** |

Il modo in cui perde è la parte interessante: più si tira l'effetto verso zero,
meglio si prevede — e la risposta migliore sta *sul bordo*, cioè al caso limite
di non avere nessun effetto per squadra. **Quando l'ottimo cade sul bordo,
l'effetto che si stava misurando non c'era.** La Roma a +0.5 in casa è vera sul
passato e non si ripete: con venti squadre, il massimo di venti numeri casuali è
sempre notevole.

**Le neopromosse.** Ogni estate tre squadre salgono dalla Serie B senza storia
in Serie A: 218 partite su 784, il 28% del calendario, in cui il modello parte
quasi a mani vuote. Sembrava il buco più grosso che ci fosse, e riempirlo
avrebbe voluto dire andare a prendere un secondo archivio. Prima però conviene
sapere se il buco c'è, e la domanda giusta non è "sbaglio di più?" ma **"perdo
di più dal mercato?"** — perché se sbagliano anche i bookmaker, che di dati ne
hanno molti più di me, allora non è ignoranza mia: è che una squadra al primo
anno è davvero meno prevedibile, e nessun archivio la renderebbe prevedibile.

| | modello | mercato | quanto sto dietro |
|---|---|---|---|
| con una neopromossa | 0.19501 | 0.18860 | **+0.00641** |
| fra due squadre note | 0.19557 | 0.18946 | **+0.00611** |

Le due righe sono la stessa riga (z = 0.08). Il modello, sulle neopromosse, sta
dietro al mercato esattamente quanto sta dietro dappertutto — e in valore
assoluto sbaglia perfino un filo *meno*, perché una neopromossa è quasi sempre
prevedibilmente debole. La Serie B non serve. `tools/misura_neopromosse.js`.

**I tre numeri scelti a occhio dentro il motore.** Dopo il ricarico del banco
era lecito il sospetto che ce ne fossero altri: `xi` (quanto svaniscono i
risultati vecchi), `xiTiri` (lo stesso per i tiri) e `ridge` (quanto le forze
vengono tirate verso la media) sono costanti che ho scritto io, e governano se
il modello ricorda la stagione scorsa o solo l'ultimo mese.
`tools/tara_memoria.js` le spazza in griglia, ma con una precauzione: **sceglie
su una stagione e verifica su un'altra**, perché con venti combinazioni provate
sullo stesso archivio la migliore vince anche quando sono tutte uguali.

```
sulla metà dove sceglie   il guadagno è  +0.35%
sulla metà che non ha mai visto          −0.10%   z = −0.22
```

Cioè: zero. Due dei tre valori "migliori" erano caduti sul **bordo** della
griglia, che è il segno che non si è trovato un massimo ma una direzione senza
fondo. Il terzo, `xiTiri`, aveva un minimo vero in mezzo — e messo alla prova da
solo sull'altra metà fa −0.16%, z = −0.38. Piatto anche lui.

Il risultato utile non è il numero: è che quei tre parametri stanno in una zona
piatta, e quindi *smanettarli non è il modo di migliorare il modello*. Una
mattina risparmiata, e la certezza di non aver lasciato un guadagno sul tavolo.

**L'Over/Under alla quota migliore del mercato.** Se togliere il ricarico dal
primo asse dell'ancoraggio ha reso lo 0.28%, il secondo asse — quanti gol si
faranno, letto dall'Over/Under 2.5 — usa ancora la quota media, che di ricarico
ne porta il 5.20%. La migliore del mercato ne porta lo 0.57%. Stessa medicina,
stesso guadagno atteso.

| | errore 1X2 | errore Over/Under |
|---|---|---|
| con la quota media (5.20% di ricarico) | 0.19130 | 0.24823 |
| con la migliore del mercato (0.57%) | 0.19129 | 0.24831 |

Niente, in nessuna delle due direzioni. E il motivo è aritmetico, non
statistico: togliere il ricarico dividendo per la somma delle probabilità
implicite è un'approssimazione che sbaglia tanto più quanti sono gli esiti fra
cui distribuire l'errore. Su **due** esiti c'è un grado di libertà solo, e
l'approssimazione è quasi esatta anche con il 5% dentro. Su tre no — ed è lì che
Betfair aveva fatto la differenza. `tools/misura_ancora_ou.js`.

Con i giorni di riposo fanno sette idee sensate, sette conti, sette no. Il modello è
quello che è rimasto in piedi — e il fatto che tante idee ragionevoli non
attacchino è, di per sé, l'informazione più utile di tutta questa sezione: vuol
dire che quello che resta da guadagnare non sta nel modello, sta nel **prezzo**
(quali quote uso, quanto ricarico pago, come impacchetto la giocata).

## Struttura

| File | Cosa fa |
|---|---|
| `index.html` | interfaccia |
| `modello.js` | il motore: stima, previsione, ancoraggio, mercati, arbitri, corner, backtest. Nessun DOM: gira anche sotto node |
| `worker.js` | fa girare il motore fuori dal thread dell'interfaccia, così lo schermo non si blocca |
| `scripts/build_data.py` | scarica e normalizza i dati da sei fonti (solo libreria standard) |
| `.github/workflows/aggiorna-dati.yml` | il robot: quattro giri al giorno |
| `tools/` | generatore di dati sintetici, le tre prove (123 sulle fonti, 130 sul motore, 15 sul backtest), la verifica di una giornata a posteriori e le nove misure (arbitri, indipendenza, valore, regola di selezione, handicap, vantaggio del campo, neopromosse, taratura dei parametri, ancoraggio Over/Under) |
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
