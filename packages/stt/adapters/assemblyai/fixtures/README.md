# AssemblyAI Sync STT fixtures

Bodies for `POST https://sync.assemblyai.com/transcribe` with
`X-AAI-Model: universal-3-5-pro`, captured live on 2026-09-14 with the dev
key. See `docs/stt-research/assemblyai.md` for the full capture matrix and
billing reconciliation. `session_id` values are replaced with stable
placeholders. Nothing else in the bodies is edited.

Input clip for every success fixture: the first 5.000 s of
`packages/stt/adapters/microsoft/fixtures/two-speakers.mp3` re-encoded as
16 kHz mono 16-bit WAV.

- `baseline.request.json` and `baseline.response.json`: audio part only, no
  `config` part. Words carry `text` and `confidence` and no timing fields.
- `with-timestamps.request.json` and `with-timestamps.response.json`:
  `config={"language_code":"en","timestamps":true}`. Words gain integer
  millisecond `start` and `end`. This is the `verbose_json` branch.
- `empty-audio.response.json`: 5 s of digital silence. `text` is `""`,
  `words` is `[]`, `confidence` is `0`, and `audio_duration_ms` still
  reports `5000`, so silence is billable.
- `error-400-audio-too-short.response.json`: 50 ms clip, below the 80 ms
  minimum.
- `error-404-invalid-api-key.response.json`: bad key. AssemblyAI returns
  404, not 401, with `content-type: application/problem+json`.
- `error-413-audio-too-large.response.json`: 124.8 s clip, over the 120 s
  limit.
- `error-415-unsupported-media-type.response.json`: 24-bit WAV.

Every error body uses the RFC 9457 shape `{status, title, detail}` with
`content-type: application/problem+json`. The `error_code` field in
AssemblyAI's error-handling page was not observed on any capture.
