# Deploy su dkct

Stack `wa-categorizer` sull'environment **2** di Dockhand, in
`/data/stacks/wa-categorizer/` sull'host.

```text
/data/stacks/wa-categorizer/
├─ compose.yaml      modificabile dal pannello di Dockhand
├─ .env              SOLO segreti (mode 600)
├─ config/rules.yaml regole, bind-montate → ricarica a caldo
└─ data/             sessione WhatsApp, log, media, rubrica
```

## L'immagine arriva da GHCR

L'immagine la costruisce **GitHub Actions** a ogni push su `main` e la pubblica
su `ghcr.io/cchrkk/wa-categorizer`. Il server la scarica: nessun build, nessun
clone del repo.

Il motivo per cui il build **non** può farlo Dockhand: l'agent Hawser di dkct
gira con queste restrizioni.

```ini
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/run/docker.sock /data/stacks
```

`ProtectHome=true` rende `/root` inaccessibile in scrittura, quindi
`docker compose build` non riesce a creare `/root/.docker` e fallisce con
`mkdir /root/.docker: read-only file system`. Il `pull` non ha questo problema.

## Segreti contro configurazione

| Dove | Cosa | Perché |
|---|---|---|
| **`.env`** | `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HA_TOKEN`, `WEB_TOKEN`, `HA_URL` | sono segreti (o indirizzi interni) e non vanno né nel repo né nel compose |
| **`compose.yaml`** | `LOG_LEVEL`, `TRANSCRIBE_*`, `WEB_ENABLED`, `WEB_BIND`, … | non sono segreti, e nel compose sono **visibili e modificabili dal pannello di Dockhand** |

Se un valore ti serve modificabile dall'interfaccia, mettilo in `environment:`
nel compose — `env_file` Dockhand non lo mostra.

`if` `WEB_ENABLED` è `false`, **commenta anche `ports:`**: altrimenti resta una
porta pubblicata su tutta la LAN con niente dietro.

## Aggiornare

Dal pannello di Dockhand: **recreate** dello stack (il compose ha
`pull_policy: always`, quindi prende l'ultima immagine).

Oppure da riga di comando:

```bash
ssh root@<host> 'sh /data/stacks/wa-categorizer/app/deploy/dkct/update.sh'
```

`data/` non viene toccato: **la sessione WhatsApp resta**, niente QR da rifare.

Per ricaricare solo le regole non serve niente: si salva `config/rules.yaml` e
il programma le rilegge da solo (watch sul file). Anche la rete è comoda:
`config/rules.yaml` è un file di testo, si modifica dalla LAN.

## Primo avvio / sessione WhatsApp

Se `data/auth/` è vuota, il QR compare nei log e va inquadrato da
WhatsApp → *Dispositivi collegati*:

```bash
docker compose logs -f wa-categorizer
```

Se invece ci si copia dentro una sessione già attiva, il container parte già
collegato. Attenzione: **due processi con la stessa `auth/` si contendono la
connessione** e WhatsApp risponde `440 connection replaced` in loop fino allo
stop di uno dei due.

## Verifiche

```bash
docker compose exec wa-categorizer node src/index.js --check
docker compose exec wa-categorizer node src/index.js --contacts
docker compose exec wa-categorizer tail -5 data/messages.jsonl
```
