# DeepInfra STT fixtures

Captured live 2026-08-12 against `POST https://api.deepinfra.com/v1/openai/audio/transcriptions`
(multipart/form-data, Bearer auth). See `docs/stt-research/deepinfra.md` for the full research note.

- `baseline.request.json` / `baseline.response.json` — canonical pair: Qwen3-ASR-1.7B, 5.1s wav, `response_format=verbose_json` (multipart form fields, binary file placeholder)
- `with-language.request.json` / `with-language.response.json` — Qwen3-ASR-1.7B, baseline plus `language=en` (identical transcript/duration)
- `nemotron-asr-long-verbose.response.json` — Nemotron-3.5-ASR, 42.5s clip, `response_format=verbose_json` (segments shape)
- `nemotron-asr-word-timestamps.response.json` — Nemotron-3.5-ASR, `timestamp_granularities[]=word` (`words[]` replaces `segments`)
- `nemotron-asr-short-null-segments.response.json` — Nemotron-3.5-ASR, 0.4s clip: empty text, `segments: null`
- `qwen3-asr-0-6b-verbose.response.json` — Qwen3-ASR-0.6B, 5.1s clip, verbose_json (segments shape)
- `qwen3-asr-1-7b-verbose.response.json` — Qwen3-ASR-1.7B, 5.1s clip, verbose_json (segments shape)
- `qwen3-asr-word-timestamps.response.json` — Qwen3-ASR-0.6B, word granularity (`words[]` shape)
- `plain-json.response.json` — default `response_format=json`: bare `{"text": ...}` with no usage/duration
- `error-401.response.json` — bad auth envelope (`{"detail": ...}`, HTTP 401)
- `error-500-inference.response.json` — unsupported audio format envelope (HTTP 500)

Voxtral captures below taken live 2026-08-13 against the same endpoint with a
2.1s wav (`packages/llm-interfaces/test-data/sample.wav`):

- `voxtral-small-verbose-null-segments.response.json` — Voxtral-Small-24B-2507, `response_format=verbose_json`: `segments: null`, `language: null` (no segment data ever returned)
- `voxtral-mini-verbose-null-segments.response.json` — Voxtral-Mini-3B-2507, same shape as Small
- `voxtral-mini-word-timestamps-null-words.response.json` — Voxtral-Mini-3B-2507, `timestamp_granularities[]=word`: `words: null`
