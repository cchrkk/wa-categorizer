# Actions

Actions run in order, each with a timeout. **Errors are isolated**: one failing action does
not stop the others, and every result is reported in the log.

| `type` | parameters | what it does |
|---|---|---|
| `log` | `level`, `message` | writes to the log |
| `notify.console` | `message` | prints to the terminal, highlighted |
| `notify.telegram` | `message`, `chatId?`, `parseMode?` | Telegram message |
| `webhook` | `url`, `method?`, `headers?`, `body?` | JSON POST (full payload if `body` is absent) |
| `ha.notify` | `service`, `message`, `title?`, `data?` | phone notification (shortcut for `notify.*`) |
| `ha.button` | `button` | presses a `button.*` entity |
| `ha.script` | `script`, `variables?`, `wait?` | runs a script, with variables |
| `ha.automation` | `automation` | triggers an automation |
| `ha.action` | `entityId`, `action`, `data?` | generic action: `light.living_room` + `turn_on` |
| `ha.service` | `domain`, `service`, `data?`, `entityId?` | raw Home Assistant service call |
| `ha.webhook` | `webhookId?`, `body?` | calls a Home Assistant webhook |
| `ha.assist` | `text`, `language?`, `agentId?` | asks **Assist**, leaves the answer in `{{assist}}` |
| `appendJsonl` | `file`, `fields?` | appends one JSON line to a file |
| `reply` | `text` | ⛔ **blocked**: it would write into the chat (read-only) |
| `shell` | `command`, `cwd?`, `timeoutMs?` | runs a local command (requires `settings.allowShell: true`) |

Home Assistant specifics are in [home-assistant.md](home-assistant.md).

## Placeholders

Inside any string:

`{{content}}` (the text, or the transcript for a voice note — the most used one),
`{{text}}`, `{{transcript}}`, `{{chat}}`, `{{chatJid}}`, `{{sender}}`, `{{senderJid}}`,
`{{rule}}`, `{{ruleName}}`, `{{type}}`, `{{label}}` / `{{confidence}}` (from
classification), `{{fileName}}`, `{{seconds}}`, `{{date}}`.

One more, and it is a different kind of thing: `{{assist}}` does not come from the message
but from the action before it in the same rule — it is what Home Assistant Assist answered.
See [Assist](home-assistant.md#assist-talking-to-it).

A misspelled placeholder (`{{transcriptt}}`) **stays visible** in the message instead of
vanishing, and `npm run check` reports it.

## Capture groups: words taken from the message

`{{1}}`, `{{2}}`… and `{{name}}` are the **capture groups** of the `textMatch` regex. They
let you reuse a word found in the message inside an action:

```yaml
- id: home-turn-on-light
  match:
    senderJid: "@me"
    type: [text, audio]
    textMatch:
      mode: regex
      flags: iu
      patterns:
        - '(?<![\p{L}\p{N}])turn on the (?<room>[\p{L} ]+?) light(?![\p{L}\p{N}])'
  transcribe: true
  actions:
    - type: ha.action
      entityId: "light.{{room}}"      # "turn on the bedroom light" -> light.bedroom
      action: turn_on
```

`npm run check` also lists the groups it finds: `✓ all {{...}} placeholders are valid
(groups: room)`.

## Webhook payload

With no `body`, the `webhook` action sends the whole context:

```json
{
  "ts": "2026-09-30T07:00:00.000Z",
  "rule": { "id": "orders-voice", "name": "Orders — voice notes" },
  "chat": { "jid": "…@g.us", "name": "Orders", "isGroup": true },
  "sender": { "jid": "…@s.whatsapp.net", "name": "Mario" },
  "message": { "id": "…", "type": "audio", "timestamp": 1790745070020, "text": "", "caption": "", "ptt": true },
  "transcript": "we need three cartons of red",
  "content": "we need three cartons of red",
  "classification": { "label": "order", "confidence": 0.97, "reason": "…" },
  "mediaFile": "data/out/audio/…"
}
```

## Payload shape of `appendJsonl`

Without `fields` you get the same payload as the webhook, one JSON object per line. With
`fields` you choose:

```yaml
- type: appendJsonl
  file: data/orders.jsonl
  fields:
    quando: "{{date}}"
    chi: "{{sender}}"
    cosa: "{{transcript}}"
```

`file` is relative to the project root, so in Docker `data/orders.jsonl` lands in
`/app/data/orders.jsonl` — inside the volume, not in the image layer.
