# Seed Audio 1.0 TTS fixtures

Request and response bodies for `POST https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/create` imported by the adapter tests. Captured live on 2026-09-18 (TTS subset) and 2026-09-23 (multi-clip and image references) with the dev Seed Speech key. The full capture matrix, including the error scenarios that have no fixture here, is in `docs/tts-research/seed-audio.md`.

Redactions keep the raw provider shape but replace payloads with short valid base64 or a marker: `audio` (base64 output) is `b3V0cHV0IGF1ZGlvIHJlZGFjdGVk` (`output audio redacted`), `references[].audio_data` is `cmVmZXJlbmNlIGF1ZGlvIHJlZGFjdGVk` (`reference audio redacted`), `references[].image_data` is `cmVmZXJlbmNlIGltYWdlIHJlZGFjdGVk` (`reference image redacted`), the signed temporary `url` path is `<redacted>`, and the 2500-char CJK prompt in `cjk-2500-chars.request.json` is `<2500 chars redacted>`. Everything else, including `duration`, `original_duration`, and error `code` / `message`, is verbatim.

Success shapes:

- `baseline-mp3` default mp3, `original_duration 6.08`.
- `pcm` `format: pcm, sample_rate: 24000`, raw stereo s16le, `original_duration 6.5` (624,000 decoded bytes).
- `speaker-tts2` `references[0].speaker` set, `original_duration 3.587925`.
- `speed-ratio` `speech_rate: 50`, `original_duration 6.08` with `duration 4.0448` (billing basis unchanged by speed).
- `multi-reference-audio` two `audio_data` clips addressed by `@Audio1` and `@Audio2` in `text_prompt`, `original_duration 8.3`.
- `reference-image` one `image_data` (PNG) reference, `original_duration 6.08`.

Error shapes (`{code, message}`):

- `cjk-2500-chars` 402 `40000020` `DurationOutOfRange` (output would exceed 120 s).
- `reference-audio` 500 `55001310` audio risk audit rejected an MP3 reference clip. The request is also the one-clip `audio_data` shape the adapter produces.
- `bad-speaker` 400 `45001115` unknown `speaker` ID. Response only, the message is forwarded to callers.
- `reference-image-size` 402 `40000020` `ImageSizeOutOfRange`. Response only.
