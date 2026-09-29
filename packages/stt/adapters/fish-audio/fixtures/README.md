# Fish Audio ASR fixtures

Response bodies for `POST https://api.fish.audio/v1/asr` used by the schema
and adapter tests. All fixtures are live captures from the research
sessions (see `docs/stt-research/fish-audio.md`).

- `asr-baseline.response.json` — live capture (2026-07-22, funded key):
  a 2.06s mp3 clip transcribed with `ignore_timestamps=false`, so Fish's
  word-level `segments[{text,start,end}]` are populated. The adapter maps
  these records to OpenRouter `words`, emits one full-transcript fallback
  segment, and preserves the auto-detected `language_code`.
- `asr-default.response.json` — live capture (2026-07-22, funded key) of
  the same clip with timestamps ignored (the default): Fish returns
  `segments: []` explicitly rather than omitting the field.
- `2026-09-24-transcribe-1-pro-pro-json.response.json`, `2026-09-24-transcribe-1-pro-pro-verbose.response.json` — live captures (2026-09-24, funded key) of `packages/stt/adapters/microsoft/fixtures/two-speakers.mp3` with the `model: transcribe-1-pro` request header, with timestamps ignored and with `ignore_timestamps=false` respectively. Speaker turns arrive inline in `text` as `<|speaker:N|>` markers, not as a diarization field. Collected by `fixtures/scripts/collect-fish-audio-asr.ts`.
- `error-401.response.json`, `error-402.response.json` — live ASR captures
  (bad token / insufficient API credit), re-verified byte-identical on
  2026-07-22. These document the `{message, status}` error envelope for
  reference only: no schema parses error bodies — the adapter sanitizes
  402s via `getProviderErrorOverride` on managed-key endpoints (BYOK
  402s pass through, since they reflect the user's own Fish wallet) and
  other non-2xx statuses flow through the base adapter's generic error
  path.

## Free-model note

Fish Audio's documented free model is the TTS-only `s2.1-pro-free` model,
selected with the `model: s2.1-pro-free` request header on `POST /v1/tts`.
That free model does **not** apply to this ASR fixture set: `POST /v1/asr` selects between `transcribe-1` (the default when the header is omitted) and `transcribe-1-pro` via the same `model` request header, and both are paid-only (a $0-credit key returns the 402 fixture).
