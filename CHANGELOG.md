# Changelog

## 1.0.0 — 2026-09-30

First release worth a number.

A read-only WhatsApp client that **categorises incoming messages with YAML rules** and runs
**actions** based on them — voice-note transcription, Telegram, Home Assistant, webhooks,
files — with a web panel for the rules.

### Rules

- Match on chat, sender, type, text and transcript, with plain `contains`, exact values or
  regexes (and Unicode boundaries for accented words).
- Priorities, `continue`, optional LLM classification, and `config/rules.d/` so one file is one
  case, copied from `examples/` without pasting anything.
- Capture groups become placeholders: `entityId: "light.{{room}}"`.
- Twelve examples, one per use case, disabled by default.

### Actions

Telegram, webhooks, JSONL files, local commands, and Home Assistant: notifications, services,
buttons, scripts, automations, webhooks — plus **Assist**. `ha.assist` asks the conversation
agent and leaves the answer in `{{assist}}` for the next action of the same rule.

### Web panel

Editor with highlighting and **validation before saving** — a broken file never reaches the
disk — plus a test bench that says, for every rule, which criterion failed, including the ones
that did not fire. It can test rules that match on the jid, with `@me` resolved the way the
rules resolve it.

### Read-only, unless you say otherwise

- No read receipts, no presence, no history download. Not configurable, by design.
- Sending is the one exception, and it lives only in `.env` (`ALLOW_REPLY`) — never in a rules
  file, because the panel can rewrite those. Read the warning in the README first: an
  unofficial client is weakest exactly there.

### Health

- `data/health.json` holds what the running process is doing and `--health` judges it; the image
  carries a `HEALTHCHECK`, so `docker ps` says `healthy` / `unhealthy` on its own.
- It reports messages arriving that cannot be decrypted — **one alert per session, not a
  barrage** — which is how session problems stop being invisible.
- libsignal prints its failures, and its session dumps (private keys included), straight to
  `console`, ignoring `LOG_LEVEL`. The program intercepts them: the failures are counted, the
  dumps are dropped.

### Fixed along the way

- **`Tab` duplicated the whole file** in the panel instead of indenting it: the operation
  carried the wrong range, so the document doubled on every press until the browser tab died.
  There is a single application point now, and the tests simulate what the textarea does.
- **A tab used as indentation** is converted to spaces instead of being refused with a message
  about a line you cannot see.
- **A `textMatch` pattern that is empty** — `- !word` is a YAML tag, not a string, and YAML
  turns it into `""` — made a rule match every message. It is refused at load time now; one of
  these opened a gate on every message, for real.
- `markRead` is refused rather than ignored.

### Docker

Public image on GHCR, built by GitHub Actions on every push to `main` and on tags; the server
only pulls. Releases are published as `1.0.0` and `1.0`.

---

Built by prompting an AI and testing everything for real — including the mistakes, which are
in [troubleshooting](docs/troubleshooting.md) with their cause. See
[How this was built](README.md#how-this-was-built).
