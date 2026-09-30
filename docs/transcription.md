# Transcription

In `.env`:

```ini
TRANSCRIBE_BACKEND=none      # none | openai | command
```

With `none` the program never transcribes: voice notes are simply not filtered on content.
Everything else keeps working.

## `openai` — any OpenAI-compatible API (Groq, OpenRouter, your own endpoint)

```ini
TRANSCRIBE_BACKEND=openai
OPENAI_API_KEY=gsk_...
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_TRANSCRIBE_MODEL=whisper-large-v3-turbo
OPENAI_CLASSIFY_MODEL=openai/gpt-oss-120b
TRANSCRIBE_LANGUAGE=it
```

With **Groq** this works as-is: `whisper-large-v3-turbo` transcribes a voice note in under
a second, and `openai/gpt-oss-120b` (or `-20b`) is the classifier for rules that use
`classify`. Both run on the same endpoint, so one key covers everything.

`OPENAI_BASE_URL` is also what `classify` uses, so a single provider serves both. If you
use a different provider, any OpenAI-compatible base URL works.

## `command` — everything local

```ini
TRANSCRIBE_BACKEND=command
TRANSCRIBE_LANGUAGE=it
TRANSCRIBE_FFMPEG=ffmpeg
TRANSCRIBE_COMMAND=C:\whisper\main.exe -m C:\whisper\models\ggml-small.bin -f {wav} -nt -l {language}
```

Placeholders available:

| placeholder | what it holds |
|---|---|
| `{input}` | the audio file downloaded from WhatsApp (ogg/opus) |
| `{wav}` | the same file converted to **16 kHz mono wav** |
| `{language}` | `TRANSCRIBE_LANGUAGE` |

The command must print **only the transcript on stdout**.

Works with whisper.cpp, faster-whisper (`python -m faster_whisper.cli …`), the official
whisper, or any script of your own. If you use `{wav}`, `ffmpeg` must be in the PATH.

## Testing without spending anything

`node tools/try-transcript.mjs "text"` (see [testing](testing.md)) runs a written
transcript through the rule engine, so you can iterate on rules without recording audio.
The web panel accepts a real audio file and transcribes it with the same code path the real
voice notes use.

## Cost and volume

Transcription runs **once per message**, not once per rule: if three rules need the
transcript, the API is called once. It runs lazily — only for messages that reach a rule
which actually needs the text.

`mediaRetentionDays` decides how long the downloaded audio stays on disk; the transcript
itself lives in `data/messages.jsonl` (see [data and media](data-and-media.md)).
