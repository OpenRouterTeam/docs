# Google Gemini Transcribe fixtures

Captured live from `POST https://generativelanguage.googleapis.com/v1beta/interactions`
on 2026-08-26 against `gemini-3.5-transcribe`. Request fixtures are the JSON
bodies with the base64 audio replaced by a `<base64 audio>` placeholder.

- `baseline.{request,response}.json` — 5s en-US clip, no `generation_config`; transcript in `steps[0].content[0].text`, usage in tokens, no duration anywhere
- `with-language.request.json` — same clip with `transcription_config.language_codes`
- `with-timestamps.request.json` — `mode.type: verbatim` + `mode.timestamp_granularities: ["word"]`
- `with-diarization.request.json` — `mode.type: verbatim` + `mode.diarization_mode: speaker`
- `with-timestamps.response.json` — timestamps + diarization together; adds `word_info` annotations carrying `start_offset`/`end_offset` duration strings and `spk:<n>` speakers (annotation list trimmed to two speakers' worth of words)
- `empty-audio.response.json` — 5s silent clip; HTTP 200, `steps` key absent entirely, tokens still billed

See `docs/stt-research/google-gemini.md` for the full scenario matrix,
including the error envelopes.
