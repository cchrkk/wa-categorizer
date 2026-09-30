# wa-categorizer

App che si collega a WhatsApp (via **Baileys**, come WhatsApp Web), legge i messaggi in
arrivo, li **categorizza con regole** e in base a quelle scatena **azioni**:
trascrizione dei vocali, notifiche Telegram, webhook, Home Assistant, scrittura su file,
comandi locali. **In sola lettura**: nessuna spunta blu, nessuna presenza online.

Caso d'uso di partenza: *una chat "Ordini" dove i vocali di Mario vengono trascritti e il
testo finisce in `data/ordini.jsonl`, su Telegram e su Home Assistant.*

---

## ⚠️ Prima di tutto

Baileys **non è ufficiale**: usa il protocollo di WhatsApp Web. È contro i ToS e il numero
collegato può essere bannato (raro se non fai spam, ma possibile).
**Usa un numero dedicato, non il tuo personale.** Le sessioni restano in `auth/` — non
condividerle con nessuno: chi le ha, ha il tuo WhatsApp.

---

## 🔒 Modalità solo lettura (imposta dal progetto)

Questo progetto **osserva e basta**: non parla con WhatsApp, non ti fa apparire online.

Cosa è garantito:

- **Nessuna ricevuta di lettura**, mai: nel codice non esiste alcuna chiamata a
  `readMessages()`, e il metodo viene reso inaccessibile sul client (fallisce se chiamato).
  Chi ti scrive **non vedrà mai le spunte blu**.
- **Nessuna presenza**: `markOnlineOnConnect: false` + `sendPresenceUpdate` neutralizzato.
  Non risulti online, non mostri "sta scrivendo", non aggiorni il tuo ultimo accesso.
- **Nessuna cronologia scaricata** (`syncFullHistory: false`): ricevi solo i messaggi che
  arrivano da quando il processo è attivo, non riscarica il passato.
- **Nessun invio**: l'azione `reply` è bloccata e la funzione di invio viene passata come
  `null` al motore delle regole. Per riabilitarla servirebbe disattivare `readOnly`, e il
  file di configurazione lo rifiuta come errore.

Una cosa che **non dipende da noi**, per onestà: la **doppia spunta grigia di consegna**.
Quella la genera il server WhatsApp quando il messaggio raggiunge il dispositivo collegato,
e non è disattivabile dal client. Le spunte blu sì, e quelle non arriveranno mai.

Conseguenza pratica: sul telefono i messaggi restano **non letti** finché non apri WhatsApp
tu. Se lo apri, sarà WhatsApp stesso a marcarli — non questa app.

---

## Requisiti

- **Node.js 20+** (testato su Node 26)
- `ffmpeg` nel PATH (solo se trascrivi con backend `command` e l'audio non è già wav)
- Un motore di trascrizione a scelta (vedi sotto) — oppure nessuno

---

## Installazione

```bat
cd C:\Users\SERVER\Desktop\Scripts\wa-categorizer
npm install
copy .env.example .env
```

Poi apri `.env` e compila almeno il blocco della trascrizione (vedi sotto).

### Primo avvio / QR

```bat
start.bat
```

Al primo avvio compare un **QR code nel terminale**: WhatsApp → *Impostazioni* →
*Dispositivi collegati* → *Collega un dispositivo* → inquadra.
Le credenziali finiscono in `auth/`, dal secondo avvio non serve più il QR.

Se la sessione viene chiusa da WhatsApp (logout), cancella la cartella `auth/` e riavvia.

---

## Trascrizione dei vocali

In `.env`:

```ini
TRANSCRIBE_BACKEND=none      # none | openai | command
```

### `command` — tutto in locale (consigliato per l'homelab)

```ini
TRANSCRIBE_BACKEND=command
TRANSCRIBE_LANGUAGE=it
TRANSCRIBE_FFMPEG=ffmpeg
TRANSCRIBE_COMMAND=C:\whisper\main.exe -m C:\whisper\models\ggml-small.bin -f {wav} -nt -l {language}
```

Segnaposto disponibili:

| segnaposto   | cosa contiene                                        |
|--------------|------------------------------------------------------|
| `{input}`    | il file audio scaricato da WhatsApp (ogg/opus)       |
| `{wav}`      | lo stesso file convertito in **wav 16 kHz mono**     |
| `{language}` | `TRANSCRIBE_LANGUAGE`                                |

Il comando deve stampare **solo la trascrizione su stdout**.
Funziona con whisper.cpp, faster-whisper (`python -m faster_whisper.cli ...`), whisper
ufficiale, o qualunque script tuo.

### `openai` — API OpenAI-compatibili (Groq, OpenRouter, endpoint tuo, ...)

```ini
TRANSCRIBE_BACKEND=openai
OPENAI_API_KEY=gsk_...
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_TRANSCRIBE_MODEL=whisper-large-v3-turbo
OPENAI_CLASSIFY_MODEL=openai/gpt-oss-120b
TRANSCRIBE_LANGUAGE=it
```

Con **Groq** va così come è: `whisper-large-v3-turbo` trascrive un vocale in meno di un
secondo, e `openai/gpt-oss-120b` (o `-20b`) fa da classificatore per le regole che usano
`classify`. Entrambi girano sullo stesso endpoint, quindi una sola chiave basta per tutto.

**Questa è la configurazione attiva in `.env`**: la trascrizione funziona già, verificata
end-to-end su un vocale di prova.

---

## Le regole: `config/rules.yaml`

Il file è **ricaricato a caldo**: salvi e le nuove regole valgono subito, senza riavviare.
Se preferisci, funziona ancora `config/rules.json` (viene usato solo se `rules.yaml` non c'è);
puoi anche puntare a un file tuo con `--config FILE`.

```yaml
settings:
  transcribeAudio: true
  logMessages: true
  processOwnMessages: false    # true = processa anche i messaggi che scrivi tu
  allowShell: false

rules:
  - id: ordini-da-mario
    name: "Ordini — vocali di Mario"
    priority: 10
    enabled: true

    match:
      chatName: Ordini
      senderName:
        - Mario
        - Mario consegne
      type: audio

    transcribe: true
    continue: false

    actions:
      - type: notify.telegram
        message: |
          🎙️ Ordine da Mario

          "{{transcript}}"
      - type: appendJsonl
        file: data/ordini.jsonl
```

Le regex in YAML si scrivono con gli apici singoli, così non devi raddoppiare i backslash:

```yaml
textMatch:
  mode: regex
  patterns: ['\b\d+\s*(casse|cartoni|bottiglie)\b']   # in JSON sarebbe "\\b\\d+..."
```

### Filtri di `match`

| campo            | tipo                | note                                                     |
|------------------|---------------------|----------------------------------------------------------|
| `chatName`       | testo               | nome della chat (gruppo o contatto), case-insensitive    |
| `chatJid`        | jid                 | match esatto, vedi **LID** più sotto                     |
| `senderName`     | testo               | nome di chi scrive (rubrica, poi il suo nome WhatsApp)   |
| `senderJid`      | jid                 | match esatto, accetta `"@me"` per il tuo account         |
| `self`           | `true`/`false`      | `true` = solo messaggi tuoi (note a te stesso)           |
| `type`           | string \| array     | `text`, `audio`, `image`, `video`, `document`, `sticker`, `location`, `contact`, `media`, `*` |
| `isGroup`        | `true`/`false`      |                                                          |
| `ptt`            | `true`/`false`      | true = vocale (push-to-talk) invece di file audio        |
| `mediaMimetype`  | testo               | es. `audio/ogg`                                          |
| `textMatch`      | vedi sotto          | il testo del messaggio **o la trascrizione** del vocale  |
| `textMatch.flags` | `i`                | solo per `mode: regex`. Serve `iu` per i confini unicode |

### LID: perché il tuo numero da solo non basta

WhatsApp sta migrando le chat ai **LID** (`223344556677889@lid`), identificatori anonimi che
**non contengono il numero di telefono**. Lo stesso contatto arriva quindi in due forme:

```
393331234567@s.whatsapp.net     numero di telefono
223344556677889@lid             identificatore anonimo
```

Il programma tiene una rubrica (`data/contacts.json`) che le collega, quindi `senderJid`,
`chatJid` e `senderName` funzionano comunque. Per il tuo account usa **`"@me"`**, che vale in
entrambe le forme. Per vedere cosa conosce:

```bat
npm run contacts
```

```
  Tu:
    nome        Mario R.
    jid         393331234567@s.whatsapp.net
    lid         223344556677889@lid

  Mario R.                 393331234567@s.whatsapp.net  <->  223344556677889@lid
```


I campi testuali accettano tre forme:

```yaml
chatName: Ordini                      # contiene (case-insensitive)

senderName:                           # contiene almeno uno
  - Mario
  - Mario consegne

textMatch:                            # oppure una forma esplicita
  mode: regex                         # contains (default) | exact | regex
  patterns: ['\b\d+\s*casse\b']
```

`mode` può essere `contains` (default), `exact`, `regex`.

### ⚠️ Il `\b` e le parole accentate

Questa è la trappola che fa perdere più tempo, perché il pattern **sembra giusto** e
non matcha mai:

```yaml
patterns: ['\b(cartone|città)\b']     # "città" NON matcherà mai
```

`\b` in JavaScript considera lettere solo `[A-Za-z0-9_]`. La `è` **non è una lettera**
per lui, e in `"una città, per favore"` dopo la `è` c'è una virgola: fra due caratteri
non-lettera **non esiste confine**, quindi quel `\b` finale fallisce. Vale per `città`,
`città`, `però`, `più`, `perché`... tutto ciò che finisce con un accento.

Due modi per risolverlo. Con i **confini unicode**, che è preciso:

```yaml
textMatch:
  mode: regex
  flags: iu                                   # la u abilita \p{L}
  patterns:
    - '(?<![\p{L}\p{N}])città(?![\p{L}\p{N}])'
```

oppure, se ti serve solo "contiene una di queste parole", con **`contains`**, che non ha
confini e quindi non ha il problema:

```yaml
textMatch:
  mode: contains
  patterns: [cartone, cartoni, bottiglie, zucchero]
```

Il prezzo di `contains` sono i falsi positivi: `oro` entra in "lav**oro**", e per questo
serve `(?<![\p{L}\p{N}])oro(?![\p{L}\p{N}])` se vuoi la parola intera.

`npm run check` **ti avvisa da solo** quando trova un `\b` insieme a una parola accentata:

```
✗ regola "ordini-vocali": usi \b con una parola accentata — su quella parola non matcherà MAI
   \b(cartone|zucchero|città|...)\b
```

Se impostano `textMatch` su un vocale, **la trascrizione avviene prima** del confronto.

### Altri campi della regola

| campo      | default | significato                                                       |
|------------|---------|-------------------------------------------------------------------|
| `priority` | 100     | ordine di valutazione, numero più basso = prima                    |
| `transcribe` | false | trascrive il vocale prima di eseguire le azioni                   |
| `continue` | false   | se true, dopo questa regola ne valuta anche le successive          |
| `classify` | —       | filtro LLM opzionale: `labels: [ordine, spam]` + `minConfidence: 0.7` |

> `markRead` non esiste: se lo scrivi nel file di configurazione il progetto si rifiuta di
> partire. La modalità solo lettura non è disattivabile da `rules.yaml`.

### Messaggi che scrivi tu

Con `processOwnMessages: false` (default) i tuoi messaggi sono ignorati. Per processarli —
per esempio per le **note a te stesso** — metti `true` in `settings` e aggiungi una regola
con il tuo numero in `senderJid`. Nel file c'è già pronta, disattivata, `note-a-me-stesso`.

---

## Azioni disponibili

| `type`            | parametri                                        | cosa fa |
|-------------------|--------------------------------------------------|---------|
| `log`             | `level`, `message`                               | scrive nel log |
| `notify.console`  | `message`                                        | stampa a video in evidenza |
| `notify.telegram` | `message`, `chatId?`, `parseMode?`               | messaggio Telegram |
| `webhook`         | `url`, `method?`, `headers?`, `body?`             | POST JSON (payload completo se `body` è assente) |
| `ha.notify`       | `service`, `message`, `title?`, `data?`           | notifica sul telefono (scorciatoia per `notify.*`) |
| `ha.button`       | `button`                                          | preme un `button.*`                        |
| `ha.script`       | `script`, `variables?`, `wait?`                   | esegue uno script, con variabili            |
| `ha.automation`   | `automation`                                      | attiva un'automazione                      |
| `ha.action`       | `entityId`, `action`, `data?`                     | azione generica: `light.salotto` + `turn_on` |
| `ha.service`      | `domain`, `service`, `data?`, `entityId?`         | chiamata grezza a un servizio HA           |
| `ha.webhook`      | `webhookId?`, `body?`                             | chiama un webhook di HA                    |
| `appendJsonl`     | `file`, `fields?`                                 | aggiunge una riga JSON a un file |
| `reply`           | `text`                                            | ⛔ **bloccata**: scriverebbe nella chat (solo lettura) |
| `shell`           | `command`, `cwd?`, `timeoutMs?`                   | esegue un comando locale (richiede `settings.allowShell: true`) |

Nelle stringhe puoi usare i segnaposto:
`{{content}}` (il testo, o la trascrizione se è un vocale), `{{text}}`, `{{transcript}}`,
`{{chat}}`, `{{chatJid}}`, `{{sender}}`, `{{senderJid}}`, `{{rule}}`, `{{ruleName}}`,
`{{type}}`, `{{label}}`/`{{confidence}}` (dalla classificazione), `{{date}}`.

Un segnaposto scritto male (`{{transcriptt}}`) resta visibile nel messaggio invece di
sparire, e `npm run check` te lo segnala.

Ogni azione ha timeout, gli errori sono isolati (un'azione fallita non blocca le altre) e
vengono riportati nel log.

---

## Home Assistant

In `.env` servono due cose:

```ini
HA_URL=http://10.0.0.20:8123
HA_TOKEN=eyJhbGciOi...
```

Il token si crea in Home Assistant da **Profilo → Sicurezza → Token di accesso a lunga
durata → Crea token**. Compare una volta sola: copialo subito.

`npm run check` verifica davvero URL e token (chiama `/api/config`, in sola lettura) e ti
dice nome della casa e versione:

```
✓ home assistant: Casa · HA 2026.9.0 · http://10.0.0.20:8123
```

### Esempi

Premere un bottone:

```yaml
- type: ha.button
  button: button.campanello
```

Eseguire uno **script** passando variabili. I segnaposto funzionano anche dentro
`variables`, non solo nelle stringhe:

```yaml
- type: ha.script
  script: script.notifica_ordine
  variables:
    testo: "{{transcript}}"
    mittente: "{{sender}}"
    chat: "{{chat}}"
    quando: "{{date}}"
```

Con `wait: true` aspetta la fine dello script e ne legge la chiave `response:`
(richiede `return_response: true` nello script):

```yaml
- type: ha.script
  script: script.riassumi_ordine
  wait: true
  variables:
    testo: "{{transcript}}"
```

Notifica sul telefono — la scorciatoia più comoda:

```yaml
- type: ha.notify
  service: mobile_app_il_mio_telefono
  title: "Ordine da {{sender}}"
  message: "{{transcript}}"
```

Attivare un'automazione, accendere una luce, azionare un interruttore:

```yaml
- type: ha.automation
  automation: cancello

- type: ha.action
  entityId: light.salotto
  action: turn_on
  data:
    brightness_pct: 60

- type: ha.action
  entityId: switch.presa_macchina
  action: toggle

# equivalente, ma con la forma grezza
- type: ha.service
  domain: light
  service: turn_on
  entityId: light.salotto
  data:
    rgb_color: [255, 200, 0]
```

### Provare senza toccare la casa

C'è un finto Home Assistant che registra le chiamate:

```bat
node tools\mock-ha.mjs 8199
:: in un altro terminale
set HA_URL=http://127.0.0.1:8199
set HA_TOKEN=prova
node src/index.js --simulate fixtures/sample-text.json --config fixtures/ha-actions.yaml --live
```

Stampa esattamente quali servizi e quali body riceverebbe la tua Home Assistant —
utile per controllare i segnaposto prima di far muovere qualcosa di vero.

---

## Test senza rischiare nulla

```bat
test.bat
```

oppure singolarmente:

```bat
node src/index.js --check                          :: valida config e ambiente
node src/index.js --contacts                       :: jid, LID e nomi conosciuti
node src/index.js --simulate fixtures/sample-text.json :: dry-run: nessuna azione eseguita
node src/index.js --simulate fixtures/sample-text.json --live   :: esegue davvero le azioni
node src/index.js --simulate fixtures/sample-audio.json         :: prova il ramo vocale
node src/index.js --simulate fixtures/sample-self.json          :: nota a te stesso (jid di esempio)
```

Il comando del CI, utile anche in locale: regole di esempio + messaggio finto, senza
toccare né WhatsApp né i segreti.

```bat
node src/index.js --simulate fixtures/sample-text.json --config config/rules.example.yaml
```

Per provare **davvero** la trascrizione serve un vocale. Non ne hai uno a portata? Generane
uno con la voce di Windows:

```bat
powershell -ExecutionPolicy Bypass -File tools\make-sample-audio.ps1
node src/index.js --simulate fixtures/sample-audio.json --live
```

Il primo comando crea `data/samples/nota.ogg` (voce italiana + conversione in opus, come i
vocali di WhatsApp), il secondo fa passare quel file da tutto il motore con le azioni vere.

Altri flag: `--config FILE` (regole alternative), `--dry` (connesso ma non esegue azioni),
`--help`.

---

## Dove finiscono i dati

Tutto dentro `DATA_DIR` (default `data/`), e **tutto fuori dal repository**:

| percorso                 | contenuto                                        |
|--------------------------|--------------------------------------------------|
| `auth/`                  | sessione WhatsApp — **segreta**, non condividerla |
| `data/messages.jsonl`    | log di tutti i messaggi processati               |
| `data/state.json`        | id già visti (anti-duplicati) + statistiche      |
| `data/contacts.json`     | rubrica: LID ↔ numero ↔ nomi dei contatti        |
| `data/instance.lock`     | lock dell'istanza in esecuzione                  |
| `data/out/audio/`        | vocali scaricati (cancellati secondo `mediaRetentionDays`) |
| `data/out/tmp/`          | conversioni temporanee (svuotata a ogni pulizia) |
| `data/out/<altro>/`      | altri media (solo se richiesti dalle regole)     |

### Pulizia dei media

Nelle `settings`:

```yaml
settings:
  mediaRetentionDays: 7    # > 0 = N giorni | 0 = subito dopo l'elaborazione | -1 = mai
```

Il giro di pulizia parte **all'avvio e poi ogni 6 ore**; la soglia si rilegge a ogni giro,
quindi modificarla in `rules.yaml` vale subito senza riavviare. `data/out/tmp/` è sempre
spazzatura e viene svuotata comunque.

Con `0` il file viene cancellato appena la trascrizione è andata a buon fine. Se la
trascrizione **fallisce** il file resta, così puoi riprovare: viene poi raccolto dalla
pulizia successiva.

---

## Pannello web

Editor delle regole e banco di prova, con una pagina sola. Si attiva con tre variabili:

```ini
WEB_ENABLED=true
WEB_PORT=8099
WEB_BIND=127.0.0.1     # 127.0.0.1 = solo questa macchina | 0.0.0.0 = visibile in LAN
WEB_TOKEN=             # vuoto = ne genera uno lui e te lo dice nei log
```

Poi vai su `http://<host>:<porta>` e inserisci il token. Se `WEB_TOKEN` è vuoto, il token
generato finisce in `data/web-token.txt` ed è stampato all'avvio:

```bash
docker compose logs wa-categorizer | grep -i token
```

### Cosa fa

**Editor.** Lo YAML a sinistra, con *Valida* e *Salva*. Il salvataggio **valida il file
prima di scriverlo**: se lo YAML è rotto non viene toccato niente e ti dice riga e colonna.
È la difesa contro l'errore più insidioso, quello che oggi mi è costato un'ora: una chiave
duplicata su disco che l'app ignora, continuando in silenzio con le regole di prima. Viene
tenuta una copia della versione precedente in `rules.yaml.bak`, e il file è scritto in modo
atomico.

**Banco di prova.** Scegli chat e mittente, incolli un testo *oppure trascini un vocale*.
Il vocale viene trascritto con lo stesso motore dei vocali veri, poi il messaggio passa dal
motore delle regole in `dryRun`.

Quello che vedi è **perché** ogni regola ha matchato o no:

```
regola                        perché
────────────────────────────────────────────────────────────────
ordini-scritti-con-prodotto   fallisce: type
ordini-vocali-con-prodotto    tutti i criteri soddisfatti · azioni: appendJsonl, notify.telegram
note-a-me-stesso              fallisce: senderJid, chatName
```

Il campo `failed` lo calcolava già `ruleMatches()` e finiva solo nel log a livello debug: il
pannello si limita a mostrartelo.

### Sicurezza

- **Il test è sempre in dry-run**: il pannello non ha alcun percorso che invii messaggi su
  WhatsApp. L'invariante di sola lettura regge anche se il pannello avesse un bug.
- Con `WEB_BIND=0.0.0.0` chiunque raggiunga la porta può **riscrivere le tue regole**: metti
  sempre un `WEB_TOKEN`. Se lo lasci vuoto non resta aperto, viene generato.
- In Docker il binding dell'host si sceglie con **`WEB_PUBLISH_IP`** (stessa idea: `127.0.0.1`
  o `0.0.0.0`), perché dentro il container l'app deve ascoltare su `0.0.0.0`.
- Docker **bypassa UFW**: una porta pubblicata non è filtrata da niente. Se la esponi in LAN
  e vuoi più di un token, l'idea è infilare il pannello dietro Cloudflare Access, come
  `il-pannello.example.tld`.

### Prova senza aprire niente

```bat
node tools\web-smoke.mjs
```

Avvia il pannello su una porta di prova lavorando su una **copia** delle regole, esercita
tutti gli endpoint e verifica anche che un salvataggio con YAML rotto venga rifiutato senza
toccare il file. È un passo del CI.

---

## Docker

```bat
copy .env.example .env
:: compila .env e config\rules.yaml, poi
docker compose up -d --build
docker compose logs -f
```

Al primo avvio il QR compare **nei log** (`docker compose logs -f wa-categorizer`) e va
inquadrato da WhatsApp → *Dispositivi collegati*.

Cosa fa lo stack:

| scelta | perché |
|---|---|
| **nessuna `ports:`** | l'app parla solo in uscita. E Docker bypassa UFW, quindi non pubblicare nulla è la difesa più semplice |
| volume `wa-data:/app/data` | sessione, log, media e rubrica sopravvivono a rebuild e aggiornamenti |
| `DATA_DIR=/app/data` | i percorsi relativi delle regole (`data/ordini.jsonl`) cadono nel volume, non nel layer dell'immagine |
| bind `./config:/app/config` | le regole restano fuori dall'immagine: le modifichi e si ricaricano a caldo, senza ricostruire |
| `stop_grace_period: 20s` | su `stop` l'app salva rubrica, stato e regole prima di uscire |
| utente `node`, non root | non serve root per quello che fa |
| `tini` come entrypoint | i segnali arrivano a node invece di essere inghiottiti da PID 1 |

Se usi il backend di trascrizione `command` (whisper locale) ffmpeg è già nell'immagine;
con `openai`/Groq puoi togliere quella riga dal `Dockerfile` e risparmiare ~80 MB.

Per aggiornare a una nuova versione:

```bat
docker compose up -d --build --force-recreate
```

Il volume `wa-data` resta, quindi **non serve rifare il QR**.

---

## Sicurezza — cosa non deve mai finire nel repository

| file | perché |
|---|---|
| `.env` | contiene la chiave Groq e il token del bot Telegram |
| `auth/` | **è l'account WhatsApp**: chi la copia può leggere e scrivere a tuo nome |
| `data/` | messaggi, trascrizioni, rubrica con nomi e numeri reali |
| `config/rules.yaml` | nomi delle tue chat e dei tuoi contatti |

Tutti già in `.gitignore`. Prima di pubblicare, un controllo veloce:

```bat
git status --short
git ls-files | findstr /i "env auth rules.yaml"
```

L'ultimo comando **non deve stampare niente** (a parte `.env.example`).
Se hai committato un segreto per sbaglio, cambiare la chiave è più veloce che riscrivere
la storia di git: considera già bruciata quella che hai pushato.

---

## Avvio automatico su Windows

Il modo più semplice: **Task Scheduler** → *Crea attività* → attiva *"Esegui al logon"* →
azione *Avvia programma* con `C:\Users\SERVER\Desktop\Scripts\wa-categorizer\start.bat`,
spuntando *"Esegui anche se l'utente non ha effettuato l'accesso"*.

Per un servizio vero serve un wrapper (`nssm`, `winsw`) puntato a `node src/index.js`
con cartella di lavoro `wa-categorizer`.

Su Linux, meglio il container.

---

## Struttura del progetto

```
wa-categorizer/
├─ src/
│  ├─ index.js       entrypoint, CLI (--check, --contacts, --simulate), reload regole
│  ├─ whatsapp.js    connessione Baileys, QR, riconnessione, normalizzazione messaggi
│  ├─ pipeline.js    il cuore: match regole → azioni (nessuna ricevuta di lettura)
│  ├─ rules.js       motore di match (testo/jid/tipo/regex) + filtri classificazione
│  ├─ actions.js     le azioni
│  ├─ transcribe.js  trascrizione (command | openai)
│  ├─ classify.js    classificazione LLM opzionale
│  ├─ media.js       salvataggio media su disco
│  ├─ store.js       log messaggi, stato anti-duplicati, statistiche
│  ├─ contacts.js    rubrica: LID <-> numero di telefono <-> nomi
│  ├─ config.js      .env + rules.yaml (o .json) + validazione
│  └─ logger.js      log
├─ config/
│  ├─ rules.example.yaml  esempio commentato, da copiare
│  └─ rules.yaml          ← le tue regole (fuori dal repo)
├─ data/             log, stato, media, rubrica (fuori dal repo)
├─ fixtures/         messaggi finti e regole di prova per --simulate
├─ tools/            make-sample-audio.ps1 (vocale di prova), mock-ha.mjs (finto Home Assistant)
├─ docker/           entrypoint del container
├─ Dockerfile · compose.yaml
├─ start.bat         avvio su Windows (installa le dipendenze la prima volta)
├─ test.bat          check + simulazioni
└─ .env              configurazione (fuori dal repo)
```

---

## Limiti noti e cose da sapere

- **Un solo numero per processo.** Due istanze con la stessa `auth/` si pestano i piedi.
- **I vocali vengono scaricati al primo uso** e riutilizzati per tutte le regole del
  messaggio.
- **`continue: false` (default)**: la prima regola che combacia vince. Metti `priority`
  bassi alle regole più specifiche.
- **Solo lettura**: nessuna spunta blu e nessuna presenza, ma la doppia spunta grigia di
  consegna è generata dal server e non è disattivabile dal client.
- La classificazione LLM costa una chiamata API per messaggio che arriva alla regola;
  lasciala a regole che ne hanno davvero bisogno.
- Se Baileys cambia protocollo, aggiorna: `npm i @whiskeysockets/baileys@latest`.

---

## Problemi

### Errore 440 / "connessione sostituita" in loop

Significa che **due sessioni usano le stesse credenziali**: WhatsApp ne sostituisce una e
così via all'infinito. Cause tipiche, in ordine di frequenza:

1. **Due istanze di wa-categorizer avviate insieme.** Il programma ora rifiuta di partire se
   trova un'altra istanza viva (lock in `data/instance.lock`). Se un'istanza è rimasta
   appesa: `taskkill /F /IM node.exe` e riavvia.
2. **Un secondo processo che legge la stessa cartella `auth/`** (per esempio una vecchia
   copia del progetto, o un altro client Baileys).
3. La sessione è stata aperta altrove: in quel caso rifai il QR.

Dopo 4 tentativi il programma si ferma da solo invece di continuare la guerra, e te lo dice.
Nota: il client ora **chiude sempre il socket precedente** prima di aprirne uno nuovo — era
proprio l'assenza di questa chiusura a generare il loop.

### Una regola non scatta mai e il file sembra giusto

Controlla che il file sia **YAML valido**: se lo salvi rotto (una chiave ripetuta, una
indentazione sbagliata) l'app **non lo carica** e continua con le regole di prima. Nel log:

```
ricarica regole fallita, tengo le vecchie: rules.yaml: YAML non valido
  → Map keys must be unique at line 128, column 5
```

Il caso classico è scrivere due volte la stessa chiave nella stessa regola:

```yaml
  - id: mia-regola
    transcribe: true
    match: { type: audio }
    transcribe: true      # ← duplicato: YAML valido? No, e la regola non esiste
```

`npm run check` te lo dice subito. E se te ne dimentichi, l'app te lo ricorda ogni due
minuti finché non lo sistemi.

### Una regola con un jid non scatta mai

Guarda `data/messages.jsonl`: il campo `chatJid` ti dice in che forma è arrivato il messaggio.
Se è `...@lid` e tu avevi scritto il numero, è il caso dei LID — vedi la sezione **LID** più
sopra. In breve: usa `"@me"` per il tuo account, e per gli altri `npm run contacts` per vedere
le due forme collegate; il match funziona comunque, perché la rubrica fa da ponte.

### `loggedOut`

WhatsApp ha chiuso la sessione (revocata da telefono o dopo troppo tempo). Elimina la
cartella `auth/` e riavvia per rifare il QR.

### Telegram: "chat not found"

Il bot non può scriverti per primo. Apri il link del bot (`https://t.me/<nome_bot>`) e premi
**Start**, poi riprova. `npm run check` te lo dice esattamente.
