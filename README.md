# Modello Serie A

Un modello statistico per la Serie A che gira interamente nel browser: forze di attacco e
difesa di ogni squadra, probabilità di ogni partita, cartellini attesi per arbitro, e —
la parte che conta — **quanto sbaglia davvero**, misurato rigiocando le stagioni passate.

I dati si aggiornano da soli una volta al giorno, con un robot che vive su GitHub.

---

## Cosa fa

| Sezione | Cosa ci trovi |
|---|---|
| **Giornata** | Le partite in arrivo: 1X2, gol attesi, Over/Under 2.5, Gol/NoGol, risultato più probabile. Toccando una partita: la matrice di tutti i punteggi, i cartellini attesi con l'arbitro che scegli, e i cursori per scontare le assenze. |
| **Squadre** | Attacco contro difesa di tutte e 20, forza complessiva, forma recente. |
| **Arbitri** | Chi fischia stretto e chi lascia correre, corretto per il numero di gare arbitrate. Quali squadre si fanno ammonire di più. |
| **Affidabilità** | Il backtest: errore del modello contro il mercato e contro il caso, curva di calibrazione, peso ottimale dei tiri. |
| **Dati** | Stato dell'ultimo aggiornamento, tasto per rifare tutto, e la spiegazione onesta di cosa il modello non sa. |

## Il modello in cinque righe

1. Ogni squadra ha due numeri: **attacco** e **difesa**. I gol attesi di una partita sono
   attacco di una, difesa dell'altra, più il vantaggio del campo.
2. Si stimano tutti insieme massimizzando la verosimiglianza di Poisson, **pesando le
   partite per quanto sono recenti** (una di due anni fa vale meno di un decimo di una di ieri).
3. Il Poisson puro sbaglia sui punteggi bassi: 0-0 e 1-1 capitano più spesso di quanto dica.
   La correzione di **Dixon-Coles (1997)** li rimette a posto, ed entra dentro la stima, non dopo.
4. Un **secondo modello identico stimato sui tiri in porta** invece che sui gol pesa per una
   quota decisa dal backtest. I tiri sono molti di più dei gol: dicono prima e con meno rumore
   chi sta giocando bene.
5. Da lì esce la matrice di tutti i punteggi fino al 10-10, e sommando le caselle giuste
   vengono 1X2, Over/Under, Gol/NoGol.

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

Da lì in avanti il robot gira ogni mattina da solo. Il tasto **Aggiorna** dentro l'app rilegge
il file e rifà i conti; non forza il download, quello lo fa GitHub.

### Modulo giocatori (facoltativo)

Marcatori e assist della stagione in corso arrivano da football-data.org, che ha un piano
gratuito. Serve una chiave:

1. Registrati su `football-data.org` e copia il token.
2. Nel repository: **Settings → Secrets and variables → Actions → New repository secret**.
3. Nome: `FOOTBALL_DATA_TOKEN`, valore: il token.

Senza chiave tutto il resto funziona uguale, e l'app dice che il modulo è spento.

## I dati

Fonte principale: **football-data.co.uk**, che pubblica per ogni partita di Serie A risultato,
tiri, tiri in porta, falli, corner, cartellini, **arbitro** e quote di chiusura. Sei stagioni.
Fonte di riserva: **openfootball/football.json** (solo risultati) se la prima è irraggiungibile.

Se entrambe falliscono, lo script **non tocca i dati esistenti**: scrive l'errore in
`data/meta.json` e l'app te lo mostra. Meglio dati vecchi dichiarati che dati vuoti a sorpresa.

## Cosa NON c'è dentro, e perché

Non esiste una fonte gratuita e stabile con "tutte le statistiche del mondo". Mancano
infortuni, formazioni ufficiali, minuti dei singoli, calciomercato, allenatori, meteo.
Alcune di queste cose contano davvero — le formazioni soprattutto — ma nessuna è disponibile
in modo affidabile e completo per ogni partita. **Infilare dati pieni di buchi in un modello
non lo rende più intelligente: lo rende rumoroso.**

Quello che si può fare, e che l'app fa, è lasciarti intervenire dove sai qualcosa che il
modello non sa: nel dettaglio di ogni partita puoi togliere fino al 40% all'attacco di una
squadra e vedere come cambia tutto.

## Come è stato verificato

Il problema di ogni modello previsionale è che sui dati veri non si conosce la risposta giusta.
Qui il controllo è fatto in due modi.

**1. Campionato finto, verità nota.** `tools/genera_dati_sintetici.py` simula sei stagioni da
parametri decisi a tavolino: forza di ogni squadra, vantaggio del campo, severità di ogni
arbitro. Poi si guarda se il modello li ritrova.

```
correlazione fra forze stimate e forze vere (media su 4 stagioni)
                    gol    tiri   modello completo
attacco            0.88    0.97   0.95
difesa             0.91    0.98   0.97
vantaggio campo    stimato 0.228 · vero 0.260
gol per partita    previsti 3.26 · reali 3.25
scarto medio in classifica: 1.4 posizioni su 20
```

**2. Backtest walk-forward.** Ogni partita viene prevista usando **solo** i dati precedenti a
quella data, ristimando il modello da capo. Poi si misura con RPS, log-loss e Brier contro due
riferimenti: le quote di chiusura e una baseline che indovina con le frequenze storiche.

```
                RPS       contro
modello       0.2165      —
mercato       0.2130      il modello sta 1.6% dietro
caso          0.2338      il modello guadagna 7.4%
errore medio di calibrazione: 1.4 punti percentuali
```

**Stare dietro al mercato è il risultato giusto.** Le quote di chiusura contengono soldi veri,
formazioni ufficiali e infortuni dell'ultimo minuto: batterle stabilmente non riesce quasi a
nessuno, e un modello che dicesse di farlo starebbe quasi certamente sbagliando i conti.

Per rifare le verifiche:

```bash
python3 tools/genera_dati_sintetici.py /tmp/finto   # campionato finto
python3 tools/test_pipeline.py                      # la pipeline vera sui dati finti
node tools/test_modello.js                          # ritrova i parametri veri?
node tools/test_backtest.js                         # batte la baseline? è calibrato?
```

## Struttura

| File | Cosa fa |
|---|---|
| `index.html` | interfaccia |
| `modello.js` | il motore: stima, previsione, arbitri, backtest. Nessun DOM: gira anche sotto node |
| `worker.js` | fa girare il motore fuori dal thread dell'interfaccia, così lo schermo non si blocca |
| `scripts/build_data.py` | scarica e normalizza i dati (solo libreria standard) |
| `scripts/riepilogo.py` | tabella di stato nel riepilogo della Action |
| `.github/workflows/aggiorna-dati.yml` | il robot: ogni giorno alle 5:17 UTC |
| `tools/` | generatore di dati sintetici e i quattro test |
| `data/` | riempita dalla Action: `serie-a.json` e `meta.json` |

## Una nota sul senso di tutto questo

Una probabilità del 65% vuol dire che **una volta su tre finisce diversamente**. Non è un
difetto del modello: è cosa significa 65%. Un modello serve a essere meno impreciso di così,
non a sapere come va a finire. Se qualcuno ti promette il secondo, ti sta vendendo qualcosa.
