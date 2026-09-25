# Meta STT Research

Last updated: 2026-09-03
Researcher: devin-add97bc1647f48d3a35428eeab3b5edb

### Scope

- Lane being onboarded: `sync transcription` (REST, pre-recorded)
- Primary model id: `muse-voice-transcribe-1.0` (Meta Muse Voice Transcribe)
- Explicitly deferred:
  - Realtime transcription over WebSocket (`wss://api.meta.ai/v1/asr/realtime`).
    OpenRouter STT is sync-only today.
  - Audio transcoding on the OpenRouter side. Meta accepts one audio format
    (see Quirks). Launch is WAV-only with an OpenRouter-side RIFF header
    check that returns a deterministic 400, decided in the launch thread.

### Model map

Meta's model list (<https://dev.meta.ai/docs/models.md>, checked 2026-09-03)
carries a single ASR model, `muse-voice-transcribe-1.0`. There is no
`-latest` alias. Sending any other model id returns 404 `model_not_found`
(unknown-model capture).

### Endpoint shape

- Sync URL: `https://api.meta.ai/v1/asr/transcribe`
- Auth: Bearer (header: `Authorization: Bearer <key>`), same key as the
  existing Meta Responses adapter (`META_API_KEY`)
- Body format: `multipart/form-data` with exactly two parts:
  - `request`: JSON part (`Content-Type: application/json`) carrying `model`,
    `audioEncoding`, and the optional `mode` / `languageBias` / `keywords`
  - `audio`: the WAV bytes
- Default OpenRouter URL pattern (`<baseUrl>/audio/transcriptions`) compatible?
  - [ ] Yes
  - [x] No. The path is `/asr/transcribe` under `https://api.meta.ai/v1`.
    Adapter overrides `getUrl()` to `${provider_info.baseUrl}/asr/transcribe`.

Docs: <https://dev.meta.ai/docs/speech-to-text.md>,
<https://dev.meta.ai/docs/api-reference/voice/transcribe>,
<https://dev.meta.ai/docs/api-reference/voice/schemas> (checked 2026-09-03).

### Request matrix

| Scenario | Format | Optional fields exercised | Notes |
| --- | --- | --- | --- |
| baseline | wav 24 kHz mono s16, 19.94s | none (`mode` defaults to `PUSH_TO_TALK`) | inline JSON below |
| with-endpointing | same clip | `mode: "ENDPOINTING"` | `turns[]` populated, no `speaker` |
| with-diarization | same clip | `mode: "DIARIZATION"` | `turns[]` populated with string `speaker` |
| with-language-bias-keywords | same clip | `languageBias: ["English"]`, `keywords: ["OpenRouter"]` | same shape as baseline, keyword spelling honoured |
| mono-16k | wav 16 kHz mono s16 | none | 200 |
| accept-text-plain | same clip | `Accept: text/plain` | 200 `text/plain`, one line per turn |
| empty-audio | wav 16 kHz mono s16, 0.5s speech-free | none | `transcript: ""`, `audioDurationMs: 560` |
| silence | wav 24 kHz mono s16, 2s synthetic silence | none | `transcript: ""`, `audioDurationMs: 2000` |
| error-400-invalid-audio | mp3 bytes as `audio` | none | 400, `param: "audio"` |
| stereo-wav | wav 24 kHz stereo s16 | none | 503 `backend_unavailable` (x2) |
| 44k-wav | wav 44.1 kHz mono s16 | none | 503 `backend_unavailable` (x2) |
| missing-encoding | wav | `audioEncoding` omitted | 400, `param: "audioEncoding"` |
| error-401 | wav | invalid Bearer | 401 `invalid_api_key` |
| unknown-model | wav | `model: "does-not-exist"` | 404 `model_not_found` |

#### Shape-affecting and billing-affecting request arguments

| Argument | Effect | Classification | Scenario evidence |
| --- | --- | --- | --- |
| `mode: "ENDPOINTING"` | `turns[]` populated with `turnId`/`startMs`/`endMs`/`transcript` | response-shape | with-endpointing |
| `mode: "DIARIZATION"` | `turns[]` populated and each turn gains a string `speaker` (`"A"`, `"B"`) | response-shape | with-diarization |
| `languageBias`, `keywords` | content only, same envelope | response-shape (content only) | with-language-bias-keywords |
| `Accept: text/plain` | whole body becomes plain text, one line per turn | response-shape | accept-text-plain |

No argument changes the published rate. Pricing is flat $0.18 per audio hour
for the whole sync surface. Meta does not return word-level timestamps in any
mode, so `verbose_json` stays unsupported.

### Response shape

- Transcript field: `transcript` (top-level)
- Usage field: `audioDurationMs` (top-level, integer milliseconds)
- Request ID field: `sessionId` in the body, echoing the `X-Request-Id`
  request header when one is sent
- Error envelope: `{ "sessionId": string, "error": { "code": string | null, "param": string | null, "type": string, "message": string } }`

Baseline capture (19.94s clip, `PUSH_TO_TALK`):

```json
{
  "sessionId": "or-capture-baseline-ptt-24k",
  "transcript": "Hello, this is a test of the Microsoft MAI transcribed to model. Um, I think. Uh, open router is a unified inference gateway. Yes, that is right. It routes requests to many providers, um, including Azure Speech. Great, and this recording has two speakers.",
  "audioDurationMs": 20000,
  "turns": []
}
```

Diarization capture (`mode: "DIARIZATION"`), `speaker` is a string label:

```json
{
  "sessionId": "or-capture-diarization",
  "transcript": "Hello, this is a test ... this recording has two speakers.",
  "audioDurationMs": 20000,
  "turns": [
    { "turnId": 0, "startMs": 0, "endMs": 9500, "transcript": "Hello, this is a test of the Microsoft MAI transcribed to model. Um, I think, uh, Open Router is a unified inference gateway.", "speaker": "A" },
    { "turnId": 1, "startMs": 10140, "endMs": 16220, "transcript": "Yes, that is right. It routes requests to many providers, um, including Azure Speech.", "speaker": "B" }
  ]
}
```

Endpointing capture (`mode: "ENDPOINTING"`), turns without `speaker`:

```json
{
  "sessionId": "or-capture-endpointing",
  "transcript": "Hello, this is a test ... this recording has two speakers",
  "audioDurationMs": 20000,
  "turns": [
    { "turnId": 0, "startMs": 0, "endMs": 8860, "transcript": "Hello, this is a test of the Microsoft MAI transcribed to model. Um, I think, uh, open router is a unified inference gateway." },
    { "turnId": 1, "startMs": 9820, "endMs": 15900, "transcript": "Yes, that is right. It routes requests to many providers um including Azure Speech" }
  ]
}
```

Speech-free 0.5s clip, transcript empty and duration rounded up:

```json
{ "sessionId": "or-capture-short-16k", "transcript": "", "audioDurationMs": 560, "turns": [] }
```

The Zod schema therefore keeps `turns` optional (empty array in the default
mode), `speaker` an optional string, and `audioDurationMs` optional so a
missing duration surfaces as unknown usage rather than a parse failure.

### Billing model

- Unit: seconds, derived as `audioDurationMs / 1000`
- Rate: **$0.18 / audio hour** (= $0.00005/s), from
  <https://dev.meta.ai/docs/pricing-rate-limits.md>, checked 2026-09-03
- Floor: none documented upstream. OpenRouter enforces a 1-second floor
  (`META_STT_MIN_BILLED_SECONDS`) at the adapter and the pricing strategy,
  matching the Microsoft STT convention.
- Surcharges: none published. Modes, `languageBias`, and `keywords` are all
  included in the flat rate.
- Free passthrough fields: `mode`, `languageBias`, `keywords`
- Meta documents that HTTP 429 responses are not billed. No usage or billing
  headers are returned.

#### Reconciliation

| Scenario | measured | floor | billed | unit price | expected cost | upstream cost | delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 19.94s | 1s | 20.0s (`audioDurationMs: 20000`) | $0.00005/s | $0.001000 | n/a | Meta reports 20000, not 19940 |
| empty-audio | 0.502s | 1s | 1s (Meta reports 560 ms, floor lifts to 1s) | $0.00005/s | $0.000050 | n/a | floor enforced |
| silence | 2.0s | 1s | 2.0s | $0.00005/s | $0.000100 | n/a | linear |

`audioDurationMs` is not the exact file duration. Meta reported 20000 for a
19.94s file and 560 for a 0.502s file. Bill from `audioDurationMs` as
returned, then apply the floor.

### OpenRouter mapping

- Adapter shape: FormData (`request` JSON part first, `audio` part last)
- URL strategy: override `getUrl()` to `${provider_info.baseUrl}/asr/transcribe`
  (baseUrl `https://api.meta.ai/v1`, shared with the Meta Responses adapter)
- Pricing strategy:
  - SKUs needed: one duration SKU, `meta_stt:audio_hours`, at $0.18/hr
  - Floor enforced at adapter AND pricing strategy? Yes, 1 second
- Provider passthrough namespace: `provider.options.meta`
  (`mode`, `languageBias`, `keywords`)
- Core fields blocklist (cannot be overridden via passthrough): `model`,
  `audioEncoding`, and the `audio` part itself. OpenAI-compat fields
  (`language`, `prompt`, `temperature`, `response_format`) have no Meta
  counterpart and are not forwarded.
- Audio gate: before the upstream fetch the adapter parses the RIFF header
  and rejects anything that is not `WAVE`, PCM format tag 1, 1 channel,
  16 bits per sample, at 16000 or 24000 Hz with a synthesized 400. This
  replaces Meta's inconsistent 400/503 behaviour (see Quirks) with a
  deterministic OpenRouter error and keeps provider health accurate.

### Quirks

- **One accepted audio format.** Meta accepts only mono, signed 16-bit PCM
  WAV at 16 kHz or 24 kHz. Non-WAV bytes return a clean 400
  (`"The 'audio' part must be a mono 16-bit PCM WAV at 16 or 24 kHz"`), but
  stereo WAV and 44.1 kHz WAV return **503 `backend_unavailable`**,
  reproduced twice each. Without the OpenRouter-side header check these
  user errors would look like provider outages.
- **`audioDurationMs` is rounded, not measured.** 19.94s came back as
  20000 and 0.502s as 560.
- **`turns` is an empty array in `PUSH_TO_TALK`**, populated only for
  `ENDPOINTING` and `DIARIZATION`. `speaker` is a string label, not an
  integer, so it does not map onto the numeric OpenRouter speaker field.
- **No word-level timestamps** in any mode. `verbose_json` is not
  advertised.
- **`audioEncoding` is required** in the `request` part even though WAV is
  the only accepted container. Omitting it returns 400 `param: "audioEncoding"`.
- **`Accept: text/plain` switches the whole body** to plain text. The
  adapter never sends it.
- **Documented limits**: 10 minutes of audio and a 32 MB request body.
  10 minutes of 24 kHz mono s16 is 28.8 MB, under the cap.
- **Tenant concurrency**: the docs list 8 concurrent streams per tenant.
  Worth confirming with Meta before a shared-gateway launch.

### Error envelopes

All observed errors share one JSON envelope,
`{ sessionId, error: { code, param, type, message } }`.

| Status | Trigger | `type` | `code` | `param` |
| --- | --- | --- | --- | --- |
| 400 | non-WAV or otherwise unsupported audio | `invalid_request_error` | `null` | `"audio"` |
| 400 | `audioEncoding` missing from `request` part | `invalid_request_error` | `null` | `"audioEncoding"` |
| 401 | invalid Bearer token | `authentication_error` | `"invalid_api_key"` | `null` |
| 404 | unknown model id | `invalid_request_error` | `"model_not_found"` | `null` |
| 503 | stereo or 44.1 kHz WAV | `server_error` | `"backend_unavailable"` | `null` |

`code` and `param` switch between string and `null` across envelopes, so the
schema types both as `nullish` strings.

### Cool features (deferred)

- Realtime transcription over WebSocket (`/v1/asr/realtime`)
- Turn-level timestamps and string speaker labels from `ENDPOINTING` /
  `DIARIZATION`, exposed via passthrough in v1 rather than a first-class
  OpenRouter field
- OpenRouter-side transcoding (ffmpeg in `cfw-media-worker`) so mp3, m4a,
  ogg, webm, and flac uploads reach Meta as normalized WAV

### Open questions

- Confirm the 8 concurrent stream tenant limit and whether it applies to
  the sync endpoint.
- Whether Meta's billing meter uses the rounded `audioDurationMs` or the
  true file duration is not verifiable from docs. Revisit against Meta's
  usage console after the first staged traffic.
