# Deploy on dkct

The `wa-categorizer` stack on Dockhand environment **2**, living in
`/data/stacks/wa-categorizer/` on the host.

```text
/data/stacks/wa-categorizer/
├─ compose.yaml      editable from the Dockhand panel
├─ .env              SECRETS ONLY (mode 600)
├─ config/rules.yaml rules, bind-mounted → live reload
└─ data/             WhatsApp session, logs, media, contacts
```

## The image comes from GHCR

**GitHub Actions** builds the image on every push to `main` and publishes it to
`ghcr.io/cchrkk/wa-categorizer`. The server downloads it: no build, no repo clone.

Why the build **cannot** be done by the Docker agent here: it runs with these
restrictions.

```ini
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/run/docker.sock /data/stacks
```

`ProtectHome=true` makes `/root` inaccessible for writing, so `docker compose build`
cannot create `/root/.docker` and fails with `mkdir /root/.docker: read-only file
system`. `pull` does not have that problem.

## Secrets versus configuration

| Where | What | Why |
|---|---|---|
| **`.env`** | `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `HA_TOKEN`, `WEB_TOKEN`, `HA_URL` | they are secrets (or internal addresses) and belong neither in the repo nor in the compose |
| **`compose.yaml`** | `LOG_LEVEL`, `TRANSCRIBE_*`, `WEB_ENABLED`, `WEB_BIND`, the published port | not secret, and in the compose they are **visible and editable from the management panel** |

If you need a value to be editable from the panel, put it in `environment:` in the
compose — variables arriving through `env_file:` are usually not shown.

**The env file is written by the panel.** Edits made over SSH to `.env` are wiped on
the next deploy, so put anything you change often in the compose.

## Updating

From the management panel: **recreate** the stack (the compose has
`pull_policy: always`, so it picks up the latest image).

Or from the command line:

```bash
ssh root@<host> 'sh /data/stacks/wa-categorizer/app/deploy/dkct/update.sh'
```

`data/` is untouched: **the WhatsApp session survives**, no QR to scan again.

To reload only the rules nothing is needed: save `config/rules.yaml` and the program
re-reads it (it watches the file).

## First start / WhatsApp session

If `data/auth/` is empty, the QR appears in the logs and must be scanned from
WhatsApp → *Linked devices*:

```bash
docker compose logs -f wa-categorizer
```

If instead you copy in a session that is already active, the container starts already
connected. Careful: **two processes sharing the same `auth/` fight over the
connection** and WhatsApp answers `440 connection replaced` in a loop until one stops.

## Checks

```bash
docker compose exec wa-categorizer node src/index.js --check
docker compose exec wa-categorizer node src/index.js --contacts
docker compose exec wa-categorizer tail -5 data/messages.jsonl
```
