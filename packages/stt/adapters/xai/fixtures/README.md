# xAI STT fixtures

Captured live from `POST https://api.x.ai/v1/stt` on 2026-07-22. Request
fixtures are the parsed multipart form fields; the `file` field is a
placeholder for the binary upload.

- `baseline.{request,response}.json` — 5s en-US clip, default options; `words[]` timestamps always present
- `with-diarize.{request,response}.json` — 5s clip, `diarize=true`; each word gains an integer `speaker` field
- `empty-audio.{request,response}.json` — 5s silent clip; `text` empty, `language` empty, `words` key absent
- `multichannel.{request,response}.json` — ~4s stereo clip, `multichannel=true`; adds `channels[]` (per-channel `index`/`language`/`text`/`words`), top-level `text`/`words` interleave both channels
