# Fish Audio STT Research

Last updated: 2026-07-17
Researcher: devin-2f6ea831e3eb4ceaa02d702f86f71215 (john.bailey)

Live captures run against `https://api.fish.audio`. The initial pass
(2026-07-15) was blocked by a $0-credit key (every ASR request returned
the 402 insufficient-credit envelope); **the full capture matrix was run
2026-07-17 with a funded key** and this note reflects live responses.
The 402 envelope remains documented below as an error case.

## Scope

- Lane being onboarded: sync transcription (`POST /v1/asr`)
- Model ids: `transcribe-1` (default) and `transcribe-1-pro` (multi-speaker, inline `<|speaker:N|>` markers in `text`). Selected via the optional `model` HTTP header on `/v1/asr`, the same mechanism as TTS. Omitting the header selects `transcribe-1`. (Updated 2026-09-24. The 2026-07 docs and OpenAPI schema defined no model parameter, so the original adapter did not send one.)
- Docs:
  - Index: https://docs.fish.audio/llms.txt
  - ASR endpoint: https://docs.fish.audio/api-reference/endpoint/openapi-v1/speech-to-text.md
  - Pricing: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits.md
  - OpenAPI: https://docs.fish.audio/api-reference/openapi.json
- Explicitly deferred: streaming transcription (none documented), TTS
  (separate adapter, see `docs/tts-research/fish-audio.md`), voice
  cloning/model management endpoints.

## Model map

No model-listing endpoint for ASR (`GET /model` lists TTS voice models
only). ASR models are `transcribe-1` and `transcribe-1-pro`; the provider monitor will
need a static model list or a health probe rather than a models endpoint.

## Endpoint shape

- Sync URL: `https://api.fish.audio/v1/asr`
- Auth: `Authorization: Bearer <key>` (confirmed live — a bad key returns
  401 `{"message":"Invalid Token","status":401}` on the sibling TTS
  endpoint; ASR multipart requests with the valid key pass auth and reach
  the billing check).
- Body format — **resolved live (2026-07-17)**: multipart form-data
  (`-F audio=@file.wav`) works end-to-end (200 with transcripts). The
  endpoint-page/OpenAPI content-type contradiction is moot for our lane;
  the adapter uses multipart FormData.
- Request fields (OpenAPI):
  - `audio` (binary, required)
  - `language` (string | null, default null)
  - `ignore_timestamps` (boolean, default true; `false` requests precise
    segment timestamps at higher latency)
- No temperature analog, no response_format param, no callback/webhook
  params (no SSRF surface).
- Default OpenRouter URL pattern (`<baseUrl>/audio/transcriptions`)
  compatible? No — Fish uses `/v1/asr`; adapter overrides `getUrl()`.

## Request matrix (live, 2026-07-17, funded key)

| Scenario | Format | Fields | Result |
| --- | --- | --- | --- |
| baseline (8.54s speech) | wav (multipart) | `audio` only | 200 — correct transcript, `segments: []`, `duration: 8.5449375` |
| with-language | wav | `language=en` | 200 — identical transcript/duration to baseline |
| with-temperature | — | n/a — no such param | n/a |
| with-timestamps | wav | `ignore_timestamps=false` | 200 — **word-level** `segments[{text,start,end}]` populated (18 words for the 8.5s clip) |
| long-audio (49.1s) | wav | `audio` only | 200 — full transcript, `duration ≈ 49.14` |
| short-audio (0.51s) | wav | `audio` only | 200 — `duration: 0.5108125` (sub-second durations returned raw; our billing floors to 1s) |
| empty/silent audio (5s) | wav | `audio` only | **503** `{"message":"Failed to transcribe audio: upstream ASR service timed out.","status":503}` |
| unsupported-format | txt bytes | `audio` only | 400 `{"message":"Invalid audio input: failed to detect a supported audio format: …","status":400}` |
| bad-auth | wav | bad key | 401 `{"message":"Invalid Token","status":401}` (confirmed on ASR) |
| insufficient credit | any | $0-credit key | 402 `{"message":"Insufficient API credit. …","status":402}` — error case |

Also observed: mp3 input works (a 2.25s mp3 clip returned
`duration: 2.2465` with a correct transcript), and the response includes
`language`/`language_code` fields (auto-detected; a 0.5s clip was
misdetected as Japanese — pass `language` when known).

## Response shape (verified live 2026-07-17)

- Success: `{ language: string, language_code: string, text: string,
  duration: number, segments: ASRSegment[] }` with
  `ASRSegment = { text: string, start: number, end: number }`.
  `segments` is empty unless `ignore_timestamps=false`; when populated the
  segments are **word-level**, not sentence-level (contrary to the doc
  examples), e.g. `{"text":"Hello","start":0.08,"end":0.4}`.
- `duration` unit: seconds — confirmed against known-length clips
  (8.545s wav → `8.5449375`; 2.246s mp3 → `2.2465`).
- No usage object and no request-ID header observed on the API (only
  Cloudflare `cf-ray` and `x-fishaudio-datacenter`) — log `cf-ray` on
  error paths.
- Error envelopes (401/402 captured live on this API):
  - 400/401/402: `{ message: string, status: number }`
    (`application/json; charset=utf-8`), e.g. 402:
    `{"message":"Insufficient API credit. API credit is managed independently from platform credit. …","status":402}`
  - 422: array of `{ loc: string[], type: string, msg: string, ctx?, in? }`

## Billing model

- Primary source (checked 2026-07-15):
  https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits.md
- `transcribe-1`: **$0.36 per audio hour**, "Charges are based on the
  duration of audio processed"; "Duration is rounded up to the nearest
  second" — i.e. a provider-side per-second granularity with a 1-second
  floor (verify with `short04.wav`).
- Unit (user-approved): audio seconds (`fish_audio_stt:audio_seconds` at
  $0.0001/s). `Math.max(1, Math.ceil(duration))` mirrors the provider's
  round-up-to-the-second behavior with a 1-second billing floor.
- No documented surcharges, per-feature pricing, or minimum billed
  duration beyond the 1-second rounding. `ignore_timestamps=false` is not
  priced differently per docs (verify).
- Rate limits are concurrency-based (5/15/50 by paid threshold), exposed
  via `ratelimit-current-concurrency` / `ratelimit-limit-concurrency`
  headers.

## Reconciliation (verified 2026-07-17)

OpenRouter-side reconciliation was verified end-to-end through the local
stack (cfw-stt-api → FishAudioSTTAdapter → usage records in Spanner): a
2.2465s clip produced
`sku_items = { "fish_audio_stt:audio_seconds": { price: "0.0001", quantity: "3" } }`
and `usage = 0.0003` — i.e. `max(1, ceil(2.2465)) = 3` seconds at the
staged $0.0001/s test rate, confirming the ceil + 1-second-floor billing.

Provider-side: Fish's wallet endpoint (`GET /wallet/self/api-credit`) did
not expose per-request decrements during the capture window, so exact
provider-cost diffs could not be extracted from the wallet; the
$0.36/audio-hour rate and round-up-to-second behavior are from the pricing
page and our metering mirrors that unit.

| Scenario | duration | billed (max(1, ceil)) | rate | cost (usage record) |
| --- | --- | --- | --- | --- |
| mp3 clip (2.2465s) | 2.2465s | 3s | $0.0001/s | $0.0003 (verified) |
| short-audio (0.51s) | 0.5108s | 1s (floor) | $0.0001/s | — (direct capture only) |

## OpenRouter mapping (proposed — pending live verification)

- Adapter shape: multipart FormData (`audio` file field), like
  `packages/stt/adapters/mistral` — confirm exact field/content-type live.
- URL strategy: override `getUrl()` to `<baseUrl>/v1/asr`.
- `language` → body `language`; `verbose_json` → `ignore_timestamps=false`.
  Live captures show Fish's `segments[{text,start,end}]` are **word-level**,
  so the adapter maps them to OpenRouter `words[{word,start,end}]`, preserves
  `language_code`, and emits one full-transcript fallback segment rather than
  fabricating one segment per word.
- Usage: `response.duration` seconds, `Math.ceil` to mirror provider
  rounding.
- Pricing strategy: standard duration-based STT strategy with a Fish
  Audio SKU (`audio_seconds` or `audio_minutes`, checkpoint decision).
- Provider passthrough namespace: `provider.options.fish-audio` — no
  passthrough params identified; keep an empty allowlist.
- Core fields blocklist: `audio`, `language`, `ignore_timestamps`.

## Quirks

- Model selection is a `model` request header, not a form field. The adapter sends `provider_model_id` as that header, so endpoint records must use the exact Fish id (`transcribe-1` or `transcribe-1-pro`).
- Docs disagree with their own OpenAPI on accepted content types
  (form-data vs JSON); msgpack is common to both.
- API credit is a separate wallet from platform credit; 402 uses the
  generic `{message,status}` envelope.
- An unknown TTS `model` header yields 402 (insufficient credit), not
  404 — model validation appears to happen after the billing check.

## Open questions (human checkpoint)

1. ~~All live ASR captures require API credit.~~ **Resolved (2026-07-17):**
   full matrix captured with a funded key.
2. ~~Content-type resolution.~~ **Resolved:** multipart form-data works
   end-to-end.
3. ~~Segment shape with `ignore_timestamps=false`.~~ **Resolved:**
   word-level `{text,start,end}` segments (not sentence-level).
4. ~~SKU granularity.~~ **Resolved:** `fish_audio_stt:audio_seconds`.
5. ~~Billing floor.~~ **Resolved:** explicit 1-second floor
   (`max(1, ceil(duration))`), user-approved.
6. Max upload size / max duration — still undocumented; largest verified
   clip is 49.1s. Probe larger uploads before go-live.
7. Silent/undecipherable audio returns **503** (upstream ASR timeout)
   rather than an empty transcript — surfaced to users as a provider
   error; acceptable?
