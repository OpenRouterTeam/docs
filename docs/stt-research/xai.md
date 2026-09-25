# xAI STT Research

Last updated: 2026-07-22
Researcher: devin-619aa2d40c4e49e8b2e41e50b354270e

### Scope

- Lane being onboarded: `sync transcription` (REST, pre-recorded)
- Primary model id: none — xAI's `/v1/stt` endpoint takes **no model
  parameter**. There is a single unnamed STT model behind the endpoint.
  `GET /v1/models` returns no STT-capable model id (only text/imagine
  models). OpenRouter needs to mint a slug for the endpoint record
  (open question below).
- Explicitly deferred:
  - Streaming STT over WebSocket (`wss://api.x.ai/v1/stt`) — OpenRouter
    STT is sync-only today; priced differently ($0.20/hr vs $0.10/hr).
  - Voice Agent API / Realtime — separate product surface.

### Model map

`GET https://api.x.ai/v1/models` (2026-07-22) lists only text and imagine
models (`grok-4.5`, `grok-4.3`, `grok-build-0.1`, `grok-imagine-*`, …).
No STT model id exists; the STT surface is addressed purely by endpoint.
There is therefore no `-latest` alias risk, but also no dated id to pin.

### Endpoint shape

- Sync URL: `https://api.x.ai/v1/stt`
- Auth: Bearer (header: `Authorization: Bearer <key>`)
- Body format: `multipart/form-data` (`file` field, or server-side `url`
  download mode)
- Default OpenRouter URL pattern (`<baseUrl>/audio/transcriptions`) compatible?
  - [ ] Yes — adapter can derive URL from `provider_info.baseUrl`
  - [x] No — the path is `/stt`, not `/audio/transcriptions`. Adapter
    overrides `getUrl()` to `${provider_info.baseUrl}/stt` (same pattern
    as the xAI TTS adapter, which uses `${baseUrl}/tts`).

Docs: <https://docs.x.ai/developers/model-capabilities/audio/speech-to-text>
(checked 2026-07-22).

### Request matrix

| Scenario | Format | Optional fields exercised | Notes |
| --- | --- | --- | --- |
| baseline | wav | — | inline JSON below |
| with-language | wav | `language=en` | identical response to baseline |
| with-temperature | wav | `temperature=0.7` | silently ignored (200, identical output) |
| with-format | wav | `format=true&language=en` | ITN formatting; requires `language` |
| with-provider-options | wav | `diarize=true` | adds `speaker` to each word |
| with-keyterm | wav | `keyterm=OpenRouter` | biasing accepted, 200 |
| with-filler-words | wav | `filler_words=true` | 200; fillers kept in transcript |
| long-audio | wav 30s | — | duration 30.0 |
| short-audio | wav 0.4s | — | duration 0.4 — no floor observed |
| empty-audio | wav 5s silent | — | 200, `text: ""`, **no `words` key**, `language: ""` |
| with-raw-pcm | pcm | `audio_format=pcm&sample_rate=16000` | raw mode works |
| multichannel | wav stereo | `multichannel=true` | adds `channels[]`; top-level `text` interleaves both channels |
| with-file-url | url | `url=<public mp3>` | 200; server-side download; billed full 182.05s |
| with-oai-passthrough | wav | `model`, `response_format`, `prompt` | all silently ignored (200, identical output) |

#### Shape-affecting and billing-affecting request arguments

| Argument | Effect | Classification | Scenario evidence |
| --- | --- | --- | --- |
| `diarize=true` | adds `speaker` (integer) to each entry in `words[]`; no price change published | response-shape | with-provider-options |
| `multichannel=true` | adds `channels[]` array (per-channel `index`/`language`/`text`/`words`); top-level `text`/`words` become interleaved merge of channels | response-shape | multichannel |
| `filler_words=true` | fillers included in `text` and `words[]` | response-shape (content only) | with-filler-words |
| `format=true` | ITN formatting of numbers/currency in `text`; requires `language` | response-shape (content only) | with-format, constraint-format-without-language |
| `url=<...>` | duration billed for the full downloaded file | billing (input mode) | with-file-url |

No argument changes the published rate — pricing is flat $0.10/hr for the
whole REST surface (diarization, timestamps, multichannel, formatting all
included). Word-level timestamps are always on; there is no verbose/plain
response toggle.

### Response shape

- Transcript field: `text` (top-level)
- Usage field: `duration` (top-level, seconds, 2 d.p.) — no `usage` object
- Request ID field: `x-trace-id` response header (no body field)
- Error envelope: `{ "error": "<message>" }` for most 4xx; auth errors add
  a `code` field (see Error envelopes)

Baseline capture (5s clip):

```json
{
  "text": "OpenRouter provides a unified interface for large language models.",
  "language": "en",
  "duration": 5.0,
  "words": [
    { "text": "OpenRouter", "start": 0.14, "end": 0.8 },
    { "text": "provides", "start": 0.8, "end": 1.28 }
  ]
}
```

Diarize capture (`diarize=true`) — `speaker` appears per word:

```json
{
  "text": "OpenRouter provides a unified interface for large language models.",
  "language": "en",
  "duration": 5.0,
  "words": [
    { "text": "OpenRouter", "start": 0.14, "end": 0.8, "speaker": 0 }
  ]
}
```

Empty/silent audio — **`words` key absent entirely**, `language` empty:

```json
{ "text": "", "language": "", "duration": 5.0 }
```

Multichannel capture (`multichannel=true`, stereo) — `channels[]` appears
and top-level `text`/`words` interleave the channels:

```json
{
  "text": "OpenRouter OpenRouter provides provides ...",
  "language": "en",
  "duration": 5.0,
  "words": [{ "text": "OpenRouter", "start": 0.14, "end": 0.8 }],
  "channels": [
    { "index": 0, "language": "en", "text": "OpenRouter provides a unified interface for large language models.", "words": [] },
    { "index": 1, "language": "en", "text": "OpenRouter provides a unified interface for large language models.", "words": [] }
  ]
}
```

The Zod schema must therefore make `words` optional, `language` allow
empty string, and admit optional `channels`.

### Billing model

- Unit: seconds (from `duration`, 2 d.p.)
- Rate: **$0.10 / hr REST** (= $0.10/3600 ≈ $0.0000277778/s), from the
  primary pricing source <https://docs.x.ai/developers/pricing> → "Voice
  API" table, checked 2026-07-22. Streaming is $0.20/hr — out of scope.
- Floor: none observed — 0.4s clip returned `duration: 0.4` (no upstream
  clamp). No floor is documented. Whether xAI's billing meter floors
  sub-second clips is unverified (Cost Tracking console not inspected);
  we bill from `duration` as returned.
- Surcharges: none published — diarization, timestamps, multichannel,
  formatting, keyterms are all included in the flat rate.
- Free passthrough fields: `language`, `format`, `keyterm` (repeatable),
  `filler_words`, `diarize`, `multichannel`, `channels`, `audio_format`,
  `sample_rate`.

#### Reconciliation

| Scenario | measured | floor | billed | unit price | expected cost | upstream cost | delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 5.0s | none | 5.0s | $0.0000277778/s | $0.000139 | n/a | — |
| short-audio | 0.4s | none | 0.4s | $0.0000277778/s | $0.000011 | n/a | no floor observed |
| long-audio | 30.0s | none | 30.0s | $0.0000277778/s | $0.000833 | n/a | linear |
| with-file-url | 182.05s | none | 182.05s | $0.0000277778/s | $0.005057 | n/a | url mode billed on full file |

No cost field in the response; `duration` is the only usage signal.

### OpenRouter mapping

- Adapter shape: FormData (`file` last field)
- URL strategy: override `getUrl()` → `${provider_info.baseUrl}/stt`
  (baseUrl `https://api.x.ai/v1`, consistent with the existing xAI TTS
  adapter)
- Pricing strategy:
  - SKUs needed: one duration SKU at $0.0000277778/s ($0.10/hr)
  - Floor enforced at adapter AND pricing strategy? No — floor is 0; bill
    raw `duration`
- Provider passthrough namespace: `provider.options.xai`
  (candidates: `language`, `format`, `keyterm`, `filler_words`, `diarize`,
  `multichannel`, `channels`, `audio_format`, `sample_rate`)
- Core fields blocklist: `file`, `url` (input is owned by OpenRouter);
  OpenAI-compat `model` / `response_format` / `prompt` / `temperature` are
  silently ignored upstream — do not forward
- Provider identity: `ProviderName.XAI` already exists (foundation phase
  not needed); API key env `X_AI_API_KEY` already provisioned

### Quirks

- **No model parameter, no STT model id in `/v1/models`.** OpenRouter must
  mint the model slug; `provider_model_id` has no upstream counterpart.
- **OpenAI-compat fields are silently ignored** (`model`,
  `response_format=verbose_json`, `prompt`, `temperature=0.7` all returned
  identical 200 responses). No error signal if a caller sends them.
- **`words` disappears for empty transcripts** (silent audio) and
  `language` comes back as `""` — schema must not require them.
- **Docs say `file` must be the last multipart field, but a request with
  `file` first also returned 200** with a correct transcript
  (constraint-file-not-last capture). Keep `file` last anyway per docs.
- **`format=true` without `language` is enforced**: 400
  `{"error": "Field 'language' is required when 'format' is true"}`.
- **Raw audio without `sample_rate` is enforced**: 400
  `{"error": "sample_rate is required for raw audio formats"}`.
- **413 comes from Cloudflare as HTML, not JSON** (535MB upload). The
  adapter's error path cannot assume a JSON envelope for oversize files.
- **`url` download failures return `error code: 502` as plain text**
  (Cloudflare), not the JSON envelope.
- **Word-level timestamps are always on** — there is no plain/verbose
  toggle; every non-empty transcription includes `words[]`.
- Rate-limit headers: none observed on success or error responses (no
  `x-ratelimit-*`); `x-trace-id` is the correlation id to log.

### Error envelopes

| Status | Trigger | Shape | Content-Type |
| --- | --- | --- | --- |
| 400 | undetectable audio format | `{"error": "Could not detect audio format from file header"}` | application/json |
| 400 | `format=true` without `language` | `{"error": "Field 'language' is required when 'format' is true"}` | application/json |
| 400 | raw audio without `sample_rate` | `{"error": "sample_rate is required for raw audio formats"}` | application/json |
| 400 | invalid API key | `{"code": "Client specified an invalid argument", "error": "Incorrect API key provided. ..."}` — note: **400, not 401** | application/json |
| 413 | file > 500 MB | Cloudflare HTML page, not JSON | text/html |
| 502 | `url` download failed | `error code: 502` plain text | text/plain |

The auth-failure envelope has an extra string `code` field the other 400s
lack, and auth failures return HTTP 400 rather than 401/403.

### Cool features (deferred)

- Streaming STT over WebSocket (interim results, endpointing, Smart Turn,
  per-channel finalize) — $0.20/hr
- Speaker diarization is already free on sync — exposed via passthrough
  in v1 rather than a first-class OpenRouter field
- `url` input mode (server-side download) — works live (200, billed on
  full file); candidate passthrough
- Multichannel transcription (2–8 channels)
- `keyterm` biasing (max 100 terms, 50 chars each)

### Open questions

- **Model slug**: no upstream model id exists. Proposal: `x-ai/grok-stt`
  (analogous to how the endpoint is branded in the xAI console) — needs
  sign-off before staging.
- Does xAI's billing meter floor sub-second clips even though the API
  reports raw duration? Not verifiable from docs; revisit against the
  Cost Tracking console after first staged traffic.
