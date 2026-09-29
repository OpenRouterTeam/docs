# Meta STT fixtures

Captured live from `POST https://api.meta.ai/v1/asr/transcribe` on 2026-09-03
(`multipart/form-data`, Bearer auth, model `muse-voice-transcribe-1.0`). See
`docs/stt-research/meta.md` for the full research note.

Request fixtures mirror the two multipart parts Meta expects: `request` is the
JSON part (verbatim) and `audio` is a placeholder for the binary WAV upload.
Response fixtures are the raw JSON bodies, unmodified. `sessionId` echoes the
`X-Request-Id` header sent with each capture.

- `baseline.{request,response}.json`: ~20s two-speaker clip, 24 kHz mono s16, default mode (`PUSH_TO_TALK`); `turns` is an empty array
- `with-language-bias-keywords.{request,response}.json`: same clip with `languageBias: ["English"]` and `keywords: ["OpenRouter"]`; keyword spelling honoured in the transcript
- `with-diarization.{request,response}.json`: same clip with `mode: "DIARIZATION"`; `turns[]` gains `startMs`/`endMs` and string `speaker` labels (`"A"`, `"B"`)
- `with-endpointing.{request,response}.json`: same clip with `mode: "ENDPOINTING"`; `turns[]` present without `speaker`
- `empty-audio.{request,response}.json`: 0.5s speech-free clip, 16 kHz mono s16; `transcript` empty, `audioDurationMs: 560` (Meta reports slightly more than the file length)
- `error-400-invalid-audio.{request,response}.json`: mp3 bytes sent as the `audio` part; HTTP 400 `invalid_request_error` envelope, `param: "audio"`, `code: null`
- `error-401.{request,response}.json`: invalid Bearer token; HTTP 401 `authentication_error` envelope, `code: "invalid_api_key"`, `param: null`
