# Percorso dei dati (NON nel repository)

Questa cartella contiene dati personali e viene ignorata da git. Qui finiscono:

| File / cartella        | Contenuto                                          |
|------------------------|----------------------------------------------------|
| `auth/`                | sessione WhatsApp — **segreta**, dà accesso all'account |
| `messages.jsonl`       | log di tutti i messaggi processati                  |
| `state.json`           | id già visti (anti-duplicati) + statistiche         |
| `contacts.json`        | rubrica: LID ↔ numero di telefono ↔ nomi            |
| `instance.lock`        | lock dell'istanza in esecuzione                     |
| `out/audio/`           | vocali scaricati                                    |
| `out/<altro>/`         | altri media                                         |
| `samples/`             | file audio di prova generati (es. `nota.ogg`)       |

La cartella viene ricreata da sola al primo avvio.

Per rigenerare un vocale di prova: `powershell -File tools\make-sample-audio.ps1`
