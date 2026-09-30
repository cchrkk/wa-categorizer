# Data folder (NOT in the repository)

This folder holds personal data and is ignored by git. It contains:

| File / folder | Contents |
|---|---|
| `auth/` | WhatsApp session — **secret**, it grants access to the account |
| `messages.jsonl` | log of every processed message |
| `state.json` | ids already seen (de-duplication) + counters |
| `contacts.json` | address book: LID ↔ phone number ↔ names |
| `instance.lock` | lock of the running instance |
| `web-token.txt` | generated panel token, if `WEB_TOKEN` is empty |
| `out/audio/` | downloaded voice notes |
| `out/<other>/` | other media |
| `samples/` | generated test audio (e.g. `note.ogg`) |

The folder is recreated on first start.

To generate a test voice note: `powershell -File tools/make-sample-audio.ps1`
