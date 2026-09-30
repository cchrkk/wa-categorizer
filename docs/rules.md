# Rules

Rules live in `config/rules.yaml`, which is **reloaded live**: save it and the new rules
apply immediately, no restart. If you save it broken, the app **does not load it** and
keeps the previous rules — see
[troubleshooting](troubleshooting.md#a-rule-never-fires-and-the-file-looks-fine).

`config/rules.json` also works, but only if `rules.yaml` is absent. With `--config FILE`
you can point at a file of your own.

## Ready-made examples: `examples/`

Every use case is **its own file**, with a title that says what it does:

| File | What it does |
|---|---|
| `01-every-message-from-a-person` | every **text** from one contact, no filtering |
| `02-every-voice-note-from-a-person` | every **voice note** from one contact, transcribed |
| `03-voice-notes-filtered-by-keywords` | voice notes, but only if they say certain things |
| `04-voice-notes-in-a-group` | voice notes in a group chosen by name, filtered |
| `05-classify-work-or-other` | the LLM decides: work / chat / spam |
| `06-home-assistant-commands` | "turn on the bedroom light" → `light.turn_on` |
| `07-received-documents` | PDFs and attachments, with file name |
| `08-moderate-links-in-groups` | links in groups → webhook |
| `09-notes-to-myself` | what you write yourself, to Telegram or a file |
| `10-orders-text` | orders chat: texts with a quantity |
| `11-orders-voice` | orders chat: voice notes, same keywords |
| `12-assist-chat` | talk to Home Assistant Assist with a `!` prefix |

They are all **disabled**: copying them does not make anything fire.

## Several files instead of one: `config/rules.d/`

Every `.yaml` in `config/rules.d/` is loaded **together with** `rules.yaml`, in
alphabetical order. That makes the examples *drop-in*: copy a file, set `enabled: true`,
and it works — without pasting anything into one big file.

```bash
mkdir -p config/rules.d
cp examples/06-home-assistant-commands.yaml config/rules.d/
# open the file and set enabled: true
npm run check
```

Those files may contain **only** `rules:` — `settings` are valid only in
`config/rules.yaml` (elsewhere they are ignored, with a warning).

Evaluation order is still decided by `priority`, not by file name; the file name appears in
the startup banner and in `npm run check`, so you know where a rule comes from:

```
config: rules.yaml + 06-home-assistant-commands.yaml
  • [  5] home-turn-on-light   da=@me  tipo=text | audio  [06-home-assistant-commands.yaml]
```

## The shape of a rule

```yaml
settings:
  transcribeAudio: true
  logMessages: true
  processOwnMessages: false    # true = also process messages you send yourself
  allowShell: false
  mediaRetentionDays: 7

rules:
  - id: orders-from-mario
    name: "Orders — voice notes from Mario"
    priority: 10
    enabled: true

    match:
      chatName: Orders
      senderName:
        - Mario
        - Mario deliveries
      type: audio

    transcribe: true
    continue: false

    actions:
      - type: notify.telegram
        message: |
          🎙️ Order from Mario

          "{{transcript}}"
      - type: appendJsonl
        file: data/orders.jsonl
```

Regexes in YAML go in **single quotes**, so you don't have to double the backslashes:

```yaml
textMatch:
  mode: regex
  patterns: ['\d+\s*(cartons|boxes|bottles)']   # in JSON this would be "\\d+\\s*..."
```

## `match` fields

| field | type | notes |
|---|---|---|
| `chatName` | text | chat name (group or contact), case-insensitive |
| `chatJid` | jid | exact match, see [LID](#lid-why-your-number-alone-is-not-enough) |
| `senderName` | text | who wrote it (from contacts first, then their own WhatsApp name) |
| `senderJid` | jid | exact match; accepts `"@me"` for your own account |
| `self` | `true`/`false` | `true` = only your own messages |
| `type` | string \| array | `text`, `audio`, `image`, `video`, `document`, `sticker`, `location`, `contact`, `media`, `*` |
| `isGroup` | `true`/`false` | |
| `ptt` | `true`/`false` | true = voice note (push-to-talk) rather than an audio file |
| `mediaMimetype` | text | e.g. `audio/ogg` |
| `textMatch` | see below | the message text **or the transcript** of a voice note |

If you set `textMatch` on a voice note, **the transcription happens first**, before matching.

### Three forms for a text field

```yaml
chatName: Orders                      # contains (case-insensitive)

senderName:                           # contains at least one
  - Mario
  - Mario deliveries

textMatch:                            # explicit form
  mode: regex                         # contains (default) | exact | regex
  flags: iu
  patterns: ['(?<![\p{L}\p{N}])boxes(?![\p{L}\p{N}])']
```

`mode` can be `contains` (default), `exact`, `regex`.

`mode: contains` is the simplest form and has no traps: it does not use word boundaries, so
it works with accented characters. The price is false positives — `oro` would match inside
"lav**oro**".

## ⚠️ `\b` and accented characters

The trap that wastes the most time, because the pattern **looks right** and never matches:

```yaml
patterns: ['\b(carton|città)\b']     # "città" will NEVER match
```

In JavaScript `\b` counts only `[A-Za-z0-9_]` as letters. `è` **is not a letter** to it, and
in `"una città, per favore"` the character after `è` is a comma: between two non-letters
**there is no boundary**, so that trailing `\b` fails. It applies to `città`, `però`, `più`,
`perché`… anything ending in an accented character.

Two ways out. With **Unicode boundaries**, which is precise:

```yaml
textMatch:
  mode: regex
  flags: iu                                   # the u enables \p{L}
  patterns:
    - '(?<![\p{L}\p{N}])città(?![\p{L}\p{N}])'
```

or with **`contains`**, if "contains one of these words" is enough:

```yaml
textMatch:
  mode: contains
  patterns: [carton, cartons, bottles, sugar]
```

`npm run check` **warns you by itself** when it finds a `\b` together with an accented word:

```
✗ rule "orders-voice": you use \b with an accented word — that word will NEVER match
   \b(carton|sugar|città|...)\b
```

## LID: why your number alone is not enough

WhatsApp is migrating chats to **LIDs** (`223344556677889@lid`), anonymous identifiers that
**do not contain the phone number**. The same contact therefore arrives in two forms:

```
393331234567@s.whatsapp.net     phone number
223344556677889@lid             anonymous identifier
```

The program keeps an address book (`data/contacts.json`) linking them, so `senderJid`,
`chatJid` and `senderName` keep working. For your own account use **`"@me"`**, which is
valid in both forms. To see what it knows:

```bash
npm run contacts
```

```
  You:
    name        Mario R.
    jid         393331234567@s.whatsapp.net
    lid         223344556677889@lid

  Mario R.                 393331234567@s.whatsapp.net  <->  223344556677889@lid
```

## Other rule fields

| field | default | meaning |
|---|---|---|
| `id` | — | internal name, required and unique: appears in logs and in the panel |
| `name` | `id` | human-readable title, used in the banner and in notifications |
| `priority` | 100 | evaluation order: **lower number = first** |
| `enabled` | true | if false the rule is ignored |
| `transcribe` | false | transcribe the voice note before running the actions |
| `continue` | false | if true, keep evaluating the following rules too |
| `classify` | — | optional LLM filter: `labels: [order, spam]` + `minConfidence: 0.7` |

> `markRead` **does not exist**: if you write it in the config file the program refuses to
> start. Read-only mode cannot be turned off from `rules.yaml`.

### Several rules on the same message

With `continue: false` (the default) **the first** matching rule wins. Give the most
specific rules low `priority` numbers.

If a rule has `classify` and the classifier rejects it, **evaluation moves on to the next
rule**: that is how
[05-classify-work-or-other](../examples/05-classify-work-or-other.yaml) sends work and
chatter to different places.

## Messages you send yourself

With `processOwnMessages: false` (the default) your own messages are dropped **before**
anything else. To process them — notes to yourself, or the
[home commands](../examples/06-home-assistant-commands.yaml) — set it to `true` in
`settings` and use `senderJid: "@me"` in the rule.
