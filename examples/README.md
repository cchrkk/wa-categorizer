# Esempi di regole

Un file per caso, ognuno indipendente e con un titolo che dice cosa fa.

**Come si usano:** copia il file che ti serve in `config/rules.d/` (o sul
server, in `/data/stacks/wa-categorizer/config/rules.d/`), apri il file e metti
`enabled: true`. Il programma li carica tutti insieme, in ordine alfabetico:
non devi incollare niente dentro `rules.yaml`.

Tutti gli esempi nascono **disattivati**, così copiarli non fa scattare nulla.

```bash
mkdir -p config/rules.d
cp examples/01-ogni-messaggio-da-una-persona.yaml config/rules.d/
# poi nel file: enabled: true
npm run check
```

| File | Cosa fa |
|---|---|
| [01-ogni-messaggio-da-una-persona](01-ogni-messaggio-da-una-persona.yaml) | Ogni **testo** da un contatto: niente filtri sul contenuto |
| [02-ogni-vocale-da-una-persona](02-ogni-vocale-da-una-persona.yaml) | Ogni **vocale** da un contatto, trascritto |
| [03-vocali-filtrati-per-parole-chiave](03-vocali-filtrati-per-parole-chiave.yaml) | Vocali, ma solo se dicono certe cose |
| [04-vocali-in-un-gruppo](04-vocali-in-un-gruppo.yaml) | Vocali in un gruppo scelto per nome, filtrati |
| [05-classificazione-lavoro-o-altro](05-classificazione-lavoro-o-altro.yaml) | L'LLM decide: lavoro / chiacchiere / spam |
| [06-comandi-casa-home-assistant](06-comandi-casa-home-assistant.yaml) | «accendi luce cameretta» → `light.turn_on` |
| [07-documenti-ricevuti](07-documenti-ricevuti.yaml) | PDF e allegati, con nome file |
| [08-moderazione-link-nei-gruppi](08-moderazione-link-nei-gruppi.yaml) | Link nei gruppi → webhook |
| [09-note-a-me-stesso](09-note-a-me-stesso.yaml) | Quello che scrivi tu, su Telegram o in un file |
| [10-ordini-testo](10-ordini-testo.yaml) | Chat ordini: testi con una quantità |
| [11-ordini-vocali](11-ordini-vocali.yaml) | Chat ordini: vocali, con le stesse parole chiave |

Per capire **perché** una regola non scatta, usa il pannello web (campo di prova)
o `node tools/prova-trascrizione.mjs "testo" "Nome chat" "Mittente"`.

Riferimento completo di tutti i campi: [README](../README.md).
