# Data and media

Everything lives under `DATA_DIR` (default `data/`) and **everything is outside the
repository**:

| path | contents |
|---|---|
| `auth/` | WhatsApp session — **secret**, never share it |
| `data/messages.jsonl` | log of every processed message |
| `data/state.json` | message ids already seen (de-duplication) + counters |
| `data/contacts.json` | address book: LID ↔ phone number ↔ names |
| `data/instance.lock` | lock of the running instance |
| `data/web-token.txt` | generated panel token, if `WEB_TOKEN` is empty |
| `data/out/audio/` | downloaded voice notes (deleted per `mediaRetentionDays`) |
| `data/out/tmp/` | temporary conversions (always wiped) |
| `data/out/<other>/` | other media, only if a rule asks for it |

## Media cleanup

In `settings`:

```yaml
settings:
  mediaRetentionDays: 7    # > 0 = N days | 0 = right after processing | -1 = never
```

The sweep runs **at startup and then every 6 hours**; the threshold is re-read on every
sweep, so changing it in `rules.yaml` applies immediately without a restart.
`data/out/tmp/` is always rubbish and is emptied regardless.

With `0` the file is deleted as soon as the transcription succeeded. If the transcription
**fails** the file stays, so you can retry it; the next sweep collects it.

Sizing, as a rule of thumb: a WhatsApp voice note is 10–60 KB, so a thousand of them is
around 50 MB. Nothing dramatic, but it grows without limit if you never clean it.

## The message log

`data/messages.jsonl` is append-only, one JSON object per message, and it is the first
place to look when something did not work:

```json
{
  "ts": "2026-09-30T07:00:00.000Z",
  "id": "AC78EDE4…",
  "chat": "Orders",
  "chatJid": "223344556677889@lid",
  "chatJidAlt": "393331234567@s.whatsapp.net",
  "sender": "Mario",
  "senderJid": "223344556677889@lid",
  "senderJidAlt": "393331234567@s.whatsapp.net",
  "fromMe": false,
  "type": "audio",
  "text": "",
  "matched": ["orders-voice"],
  "transcript": "we need three cartons of red",
  "actions": [{ "rule": "orders-voice", "type": "notify.telegram", "ok": true }]
}
```

- `matched: []` with a rule you expected means the rule did not fire: the
  [test bench](web-panel.md) tells you which criterion blocked it
- `chatJid` versus `chatJidAlt` is where the [LID](rules.md#lid-why-your-number-alone-is-not-enough)
  question gets answered
- `actions` tells you whether an action ran **and whether it succeeded**

It is off with `settings.logMessages: false`. Dry runs never write to it.

Logs of the messages that were *skipped* (your own messages, protocol noise, duplicates)
are not written here: they appear in the terminal only at `LOG_LEVEL=debug`.

## Backups

`data/` holds the address book and the message log; `auth/` holds the session. Backing up
`data/` plus `config/` plus `.env` is enough to rebuild everything — `auth/` you can
re-pair with a QR.

Two things to be careful about when restoring:

- **`auth/` is an account credential.** Two processes using the same `auth/` fight over the
  connection and WhatsApp answers `440 connection replaced` in a loop. Stop one before
  starting the other.
- **`data/contacts.json` is worth keeping**: it is the mapping between LIDs, phone numbers
  and names that the rules rely on.
