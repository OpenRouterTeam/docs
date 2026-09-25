# DeepInfra STT Research

Last updated: 2026-08-13
Researcher: devin-457ab8d9f6a240cea03a3831da16ab17
(Voxtral addendum: devin-d0699621606548edb69a4111a4651eb3, 2026-08-13)

### Scope

- Lane being onboarded: `sync transcription` (REST, pre-recorded, OpenAI-compatible)
- Primary model ids (both onboard through one adapter):
  - `Qwen/Qwen3-ASR-0.6B`
  - `Qwen/Qwen3-ASR-1.7B`
- Explicitly deferred:
  - `nvidia/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b` — deferred at the
    research checkpoint (2026-08-12) because the model dropped the first ~6s
    of audio on DeepInfra's pre-recorded endpoint. **No longer reproducible
    as of 2026-08-13** (see Nemotron re-test addendum); the deferral reason
    is resolved.
  - Streaming/WSS transcription — OpenRouter STT is sync-only today. The
    Nemotron model is *branded* streaming but is served by DeepInfra on the
    same pre-recorded REST endpoint as every other ASR model.
  - DeepInfra's Whisper family — already served elsewhere; out of scope for
    this onboarding.
  - Per-model inference endpoint (`/v1/inference/<model>`) — the
    OpenAI-compatible endpoint is the lane we use.

### Model map

From `GET https://api.deepinfra.com/models/list` (2026-08-12), filtered on
`"type": "automatic-speech-recognition"`:

| Model id | Pricing (`cents_per_input_sec`) | Tags |
| --- | --- | --- |
| `nvidia/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b` | 0.000333 | openai, multilingual, streaming |
| `Qwen/Qwen3-ASR-0.6B` | 0.000333 | openai |
| `Qwen/Qwen3-ASR-1.7B` | 0.00075 | openai |
| `openai/whisper-*` (8 models) | 0.000333 | openai — out of scope |

No `-latest` aliases exist on this surface; ids are already pinned.

### Endpoint shape

- Sync URL: `https://api.deepinfra.com/v1/openai/audio/transcriptions`
- Auth: Bearer (header: `Authorization: Bearer <key>`)
- Body format: `multipart/form-data` (`file` + `model` fields)
- Default OpenRouter URL pattern (`<baseUrl>/audio/transcriptions`) compatible?
  - [x] Yes — DeepInfra's `provider_info.baseUrl` is
    `https://api.deepinfra.com/v1/openai` (see
    `packages/providers/configs/provider-url.test.ts`), so the adapter can
    derive the URL from `provider_info.baseUrl`.
  - [ ] No

Docs: <https://deepinfra.com/docs/openai_api> (checked 2026-08-12).

### Request matrix

| Scenario | Format | Optional fields exercised | Notes |
| --- | --- | --- | --- |
| baseline | wav 5.1s | — | Qwen models OK; Nemotron returned empty text on 2026-08-12 (fixed by 2026-08-13, see Nemotron re-test addendum) |
| with-language | wav | `language=en` | 200, identical output to baseline |
| with-temperature | wav | `temperature=0.3` | 200, identical output to baseline |
| with-timestamps | wav | `response_format=verbose_json`, `timestamp_granularities[]=word` | `words[]` replaces `segments` |
| with-provider-options | wav | `prompt`, `seed` | silently ignored (200, identical output) |
| long-audio | wav 42.5s | `response_format=verbose_json` | duration 42.544 reported |
| unsupported-format | `.xyz` text file | — | HTTP 500 `{"detail":"inference error"}` (not a 4xx) |
| bad-auth | wav | invalid key | HTTP 401 `{"detail":"User is not authorized to access this resource"}` |
| oversize-payload | — | — | not captured; DeepInfra does not publish a hard size limit for this endpoint. Open question below. |
| short-audio | wav 0.4s | `response_format=verbose_json` | duration 0.4 — **no billing floor observed**; `segments: null` |
| empty-audio | wav 3s silence | `response_format=verbose_json` | Nemotron: `text: ""`, `segments: null`. Qwen 0.6B hallucinates a word ("Ahora.") |
| doc-constraint-validation | — | — | no documented X-requires-Y constraints on this endpoint; nothing to validate |

#### Shape-affecting and billing-affecting request arguments

| Argument | Effect | Classification | Scenario evidence |
| --- | --- | --- | --- |
| `response_format=verbose_json` | switches envelope from bare `{text}` to `{text, task, language, duration, segments}` | response-shape | with-timestamps, long-audio |
| `timestamp_granularities[]=word` | replaces `segments` with `words[]` (requires verbose_json) | response-shape | with-timestamps |
| (short / silent input) | `segments` is `null` instead of an array | response-shape | short-audio, empty-audio |
| `language`, `temperature`, `prompt`, `seed` | none observed | neither | with-language, with-temperature, with-provider-options |

No request argument changes billing. Pricing is flat per input second per
model; timestamps and language hints are free.

### Response shape

- Transcript field: `text` (top-level)
- Usage field: `duration` (top-level, seconds, 3 d.p.) — **only present with
  `response_format=verbose_json`**. The default `json` format returns bare
  `{"text": ...}` with no usage data, so the adapter must pin
  `verbose_json` upstream (or measure duration locally) to bill correctly.
- Request ID field: `x-request-id` response header (no body field)
- Error envelope: `{"detail": "<message>"}` (FastAPI-style) for 401 and 500

Verbose baseline (Qwen3-ASR-1.7B, 5.1s clip):

```json
{
  "text": "The quick brown fox jumps over the lazy dog near the river bank today.",
  "task": "transcribe",
  "language": "english",
  "duration": 5.101,
  "segments": [
    {
      "id": 0,
      "seek": 0,
      "start": 0.0,
      "end": 5.10099983215332,
      "text": "The quick brown fox jumps over the lazy dog near the river bank today.",
      "tokens": [11528, 6364, 151704, 785],
      "temperature": 0.0,
      "avg_logprob": -0.0225,
      "compression_ratio": 1.0,
      "no_speech_prob": 0.0
    }
  ]
}
```

Word-granularity shape — `segments` key absent, `words[]` present:

```json
{
  "text": "...",
  "task": "transcribe",
  "language": "auto",
  "duration": 42.544,
  "words": [{ "word": "Open", "start": 6.16, "end": 6.32 }]
}
```

Short/silent audio — `segments` is JSON `null` (not `[]`):

```json
{ "text": "", "task": "transcribe", "language": "auto", "duration": 0.4, "segments": null }
```

The adapter Zod schema must admit: bare `{text}`, verbose with
`segments: array | null`, and verbose with `words[]` and no `segments`.
`language` may be a language name (`"english"`) or `"auto"`.

### Billing model

- Unit: seconds of input audio (`pricing.type: "input_length"`,
  `cents_per_input_sec` from `GET /models/list`, 2026-08-12; same rates shown
  on the public model pages, e.g.
  <https://deepinfra.com/Qwen/Qwen3-ASR-1.7B>)
- Rates:
  - Nemotron-3.5-ASR and Qwen3-ASR-0.6B: 0.000333 ¢/s = **$0.00000333/s**
    ($0.0002/min, $0.012/hr)
  - Qwen3-ASR-1.7B: 0.00075 ¢/s = **$0.0000075/s** ($0.00045/min, $0.027/hr)
- Floor: none observed — the 0.4s clip reported `duration: 0.4` and DeepInfra
  bills fractional seconds. No our-side floor clamp required.
- Surcharges: none. Timestamps, language hints, and multilingual audio are
  all flat-priced.
- Free passthrough fields: `language`, `temperature`, `prompt`, `seed`
  (accepted, no billing effect).

#### Reconciliation

| Scenario | measured | floor | billed | unit price | expected cost | upstream cost | delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline (Qwen 1.7B) | 5.101s | none | 5.101s | $0.0000075/s | $0.0000383 | n/a | — |
| long-audio (Nemotron) | 42.544s | none | 42.544s | $0.00000333/s | $0.0001417 | n/a | — |
| short-audio (Nemotron) | 0.4s | none | 0.4s | $0.00000333/s | $0.0000013 | n/a | no floor |
| empty-audio (Nemotron) | 3.0s | none | 3.0s | $0.00000333/s | $0.0000100 | n/a | silence billed |

DeepInfra returns no cost field; reconciliation is against the published
per-second rate. `duration` from verbose_json is the billing source.

### OpenRouter mapping

- Adapter shape: FormData (extends `OpenAISTTAdapter`, same pattern as
  `TogetherSTTAdapter` in `packages/stt/adapters/together/index.ts`)
- URL strategy: inherit `provider_info.baseUrl`
  (`https://api.deepinfra.com/v1/openai` + `/audio/transcriptions`)
- Pricing strategy: per-second SKU (`audioDurationSeconds`), one rate per
  endpoint; no floor clamp, no modifier SKUs
- Duration extraction: pin `response_format=verbose_json` upstream and read
  top-level `duration`

### Quirks

- **Nemotron dropped roughly the first 6 seconds of audio (2026-08-12,
  fixed by 2026-08-13).** A 5.1s speech clip returned `text: ""`; a 12s clip
  lost its first sentence; word timestamps on a 42s clip started at 6.16s.
  Reproduced consistently across baseline, language, and temperature
  scenarios (2026-08-12); this looked like the streaming model's lookahead
  buffer applied to the pre-recorded endpoint on DeepInfra's side. **No
  longer reproducible** — see the Nemotron re-test addendum below.
- Qwen3-ASR-0.6B hallucinates short words on silent/near-empty audio (silence
  → "Ahora.", 0.4s clip → "É.") and misrecognized "The quick brown" as
  "A quick round" on the 5s clip. The 1.7B model transcribed the same clip
  perfectly.
- Unsupported audio formats return HTTP **500** `{"detail":"inference error"}`
  rather than a 4xx — the adapter's error mapping should treat 500 with that
  envelope as a client-input error, not an upstream outage. Implemented in
  `DeepInfraSTTAdapter.getProviderErrorOverride` (remap to 400, keyed on the
  exact body, so genuine 500 outages pass through).
- The default `json` response format carries no duration/usage data at all;
  billing depends on pinning `verbose_json`.

### Voxtral addendum (2026-08-13)

`mistralai/Voxtral-Small-24B-2507` and `mistralai/Voxtral-Mini-3B-2507`
(staged as `mistralai/voxtral-small-24b-2507-stt` and
`mistralai/voxtral-mini-3b-2507`) were re-tested against the same endpoint
with a 2.1s wav; captures live in
`packages/stt/adapters/deepinfra/fixtures/voxtral-*.response.json`:

- `response_format=verbose_json` is **accepted** and returns `duration`
  (billing works), but `segments` is always `null` and `language` is `null`.
- `timestamp_granularities[]=word` returns `words: null` — no word
  timestamps either.
- Malformed audio reproduces the 500 `{"detail":"inference error"}` quirk.

Adapter consequence: the Voxtral slugs sit in
`DeepInfraSTTAdapter.verboseOutputUnsupportedModelSlugs`, a deny-set distinct
from `verboseJsonUnsupportedModelSlugs` — client-requested `verbose_json` is
rejected with a 400 while duration-billed requests keep pinning
`verbose_json` upstream to read `duration`. Qwen models keep full verbose
support (their captures show real segments/words).

### Nemotron re-test addendum (2026-08-13)

Re-tested `nvidia/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b` live against
`POST /v1/openai/audio/transcriptions` with `openai/whisper-large-v3-turbo`
as control:

- 2.1s clip with speech at 0s (`sample.wav`, "Affirmative.") — full
  transcript returned. Under the old behavior this clip sat entirely inside
  the dropped window and returned empty text.
- 10.7s clip of the same utterance concatenated 5x — all 5 repetitions
  transcribed. A ~6s drop would have lost roughly the first 3.
- Same clip delayed 8s — transcribed, as before.
- `response_format=verbose_json` on the 10.7s clip returned a real
  `segments` array (start 1.44s) and correct `duration: 10.668`, improving
  on the null-segments/6.16s-offset behavior captured on 2026-08-12.

DeepInfra appears to have fixed the serving behavior; the truncation
deferral reason no longer holds. No adapter change is required.

### Open questions

- Max file size / duration for the transcriptions endpoint is not published;
  oversize-payload capture not run. Verify limits with DeepInfra before
  setting our request cap.
- ~~Should the Nemotron endpoint ship at all while the ~6s leading-audio drop
  reproduces?~~ Resolved 2026-08-12: deferred at the research checkpoint;
  only the two Qwen3-ASR models shipped then. Superseded 2026-08-13: the
  drop no longer reproduces (see Nemotron re-test addendum), unblocking the
  Nemotron endpoint.
- Rate limits: response headers expose no rate-limit budget; DeepInfra
  account default is 200 concurrent requests per
  <https://deepinfra.com/docs/advanced/rate-limits> (checked 2026-08-12).
