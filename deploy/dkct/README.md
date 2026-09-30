# Deploy su dkct

Stack: `wa-categorizer` sull'environment **2** di Dockhand (`https://il-pannello.example.tld`).
Gira in `/data/stacks/wa-categorizer/` sull'host dkct.

```text
/data/stacks/wa-categorizer/
├─ compose.yaml     gestito da Dockhand  (questo file, adattato)
├─ app/             clone del repo via deploy key read-only "dkct"
├─ .env             segreti: Groq + Telegram           (mode 600)
├─ config/rules.yaml regole, bind-montate → ricarica a caldo
└─ data/            sessione WhatsApp, log, media, rubrica
```

## Perché il build è locale e non da GHCR

Il repo è **privato**, quindi anche il pacchetto GHCR è privato e dkct dovrebbe fare
`docker login ghcr.io` con un token con scope `read:packages`. Si può fare, ma è un segreto
in più da gestire. Qui invece dkct clona il repo (deploy key read-only, nessun token) e
costruisce l'immagine in locale.

Il workflow `.github/workflows/docker.yml` resta e continua a girare: valida che
l'immagine si costruisca a ogni push, così un Dockerfile rotto si scopre in CI e non sul
server.

## Perché il build non lo fa Dockhand

L'agent Hawser di dkct gira con questa unit:

```ini
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/run/docker.sock /data/stacks
```

`ProtectHome=true` rende `/root` un tmpfs inaccessibile, quindi `docker compose build` non
può creare `/root/.docker` e fallisce con:

```
mkdir /root/.docker: read-only file system
```

Non vale la pena indebolire la unit: **il build si fa via SSH, l'avvio lo fa Dockhand**.
Da qui `pull_policy: never` e nessun `build:` nel compose dello stack.

Se un giorno si vuole che Dockhand ricostruisca da solo, la via più pulita è pubblicare
l'immagine su GHCR (il workflow la costruisce già) e fare `docker login ghcr.io` una volta
sola sulla macchina.

## Aggiornare

```bash
ssh root@192.168.1.100 'sh /data/stacks/wa-categorizer/app/deploy/dkct/update.sh'
```

Fa `git pull`, ricostruisce l'immagine e riavvia lo stack.

`data/` non viene toccato: **la sessione WhatsApp resta**, niente QR da rifare.

Per ricaricare solo le regole non serve niente: si salva `config/rules.yaml` e il
programma le rilegge da solo (watch sul file).

## Primo avvio / sessione WhatsApp

Se `data/auth/` è vuota, il QR compare nei log e va inquadrato da
WhatsApp → *Dispositivi collegati*:

```bash
docker compose logs -f wa-categorizer
```

Se invece ci si copia dentro una sessione già attiva, il container parte già collegato.
Attenzione: due processi con la stessa `auth/` si contendono la connessione e WhatsApp
risponde **440 connection replaced** fino allo stop di uno dei due.

## Verifiche

```bash
# config valida dentro il container
docker compose exec wa-categorizer node src/index.js --check

# jid, LID e nomi che conosce
docker compose exec wa-categorizer node src/index.js --contacts

# ultimi messaggi processati
docker compose exec wa-categorizer tail -5 data/messages.jsonl
```
