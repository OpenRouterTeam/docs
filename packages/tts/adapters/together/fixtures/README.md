# Together TTS fixtures

Captured live 2026-07-17 against `POST https://api.together.ai/v1/audio/speech`.
Binary audio bodies are not committed; each fixture records its status, output
format, and headers below. Request IDs and base64 audio deltas are
redacted/truncated.

- `baseline.request.json` — Kokoro, `af_bella`, mp3 (200, `audio/mpeg`, `x-together-usage-tokens: 44`)
- `with-cartesia-voice.request.json` — sonic-2 with Cartesia voice UUID, mp3 (200, `audio/mpeg` 44.1 kHz)
- `with-voice-mix.request.json` — Kokoro voice mixing `af_bella+af_heart` (200, billed same 44 chars)
- `error-invalid-voice.response.json` — 400 body for an unknown Kokoro voice
- `error-bad-auth.response.json` — 401 body, `code: "invalid_api_key"`
- `error-non-serverless-model.response.json` — 400 body for a dedicated-only model (`cartesia/sonic-3.5`)
- `stream-sample.sse` — shape of `stream: true` SSE output (base64 pcm_s16le deltas, truncated) terminated by `data: [DONE]`
