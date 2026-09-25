# AssemblyAI Sync STT Research

Last updated: 2026-09-14
Researcher: devin-1c021e5823094609890f409a9ace4dba (alan.carroll)

Live captures run 2026-09-14 against `https://sync.assemblyai.com/transcribe`
with the dev `ASSEMBLYAI_API_KEY` from Infisical. Every mandatory scenario in
the capture matrix returned a live response. Raw captures (request scripts,
bodies, headers) are scratch artifacts in the session workspace and are not
committed. Sanitized bodies live in `packages/stt/adapters/assemblyai/fixtures/`.

## Scope

- Lane being onboarded: sync transcription via the dedicated **Sync API**
  (`POST /transcribe` on `sync.assemblyai.com`). This is a separate product
  from the classic pre-recorded API (`POST /v2/transcript` on
  `api.assemblyai.com`, submit then poll) and from Streaming.
- Primary model id: `universal-3-5-pro`, selected by the `X-AAI-Model`
  request header. This is the only model documented for the Sync API.
- Docs (all checked 2026-09-14):
  - Sync API reference: https://www.assemblyai.com/docs/api-reference/sync-api/transcribe
  - Warm endpoint: https://www.assemblyai.com/docs/api-reference/sync-api/warm
  - Getting started: https://www.assemblyai.com/docs/sync-stt/getting-started/transcribe-a-short-audio-file
  - Audio requirements: https://www.assemblyai.com/docs/sync-stt/audio-requirements
  - Error handling: https://www.assemblyai.com/docs/sync-stt/error-handling
  - Endpoints and data zones: https://www.assemblyai.com/docs/sync-stt/endpoints-and-data-zones
  - Language selection: https://www.assemblyai.com/docs/sync-stt/language-selection
  - Word timestamps: https://www.assemblyai.com/docs/sync-stt/word-timestamps
  - Prompting and keyterms: https://www.assemblyai.com/docs/sync-stt/prompting-and-keyterms
  - Conversation context: https://www.assemblyai.com/docs/sync-stt/conversation-context
  - Billing: https://www.assemblyai.com/docs/billing-and-pricing
  - Pricing page: https://www.assemblyai.com/pricing
- Explicitly deferred (per Alan, 2026-09-14): the async pre-recorded API,
  Streaming STT (the realtime PR #41563 is an internal POC only), TTS.

## Model map

No model-listing endpoint. `X-AAI-Model` accepts `universal-3-5-pro` and the
legacy aliases `u3-sync-pro` and `u3-pro` (verified live, `u3-pro` returns
the byte-identical transcript). Any other value, or a missing header, returns
a bare `404 Not found` (`text/plain`, `server: awselb/2.0`) from the load
balancer before the application sees the request. `universal-2` is a
pre-recorded API model and is rejected on Sync.

The provider monitor from the foundation PR keeps a static model list, which
matches this surface.

## Endpoint shape

- Sync URL: `https://sync.assemblyai.com/transcribe`. Regional endpoints
  `sync.us.assemblyai.com` and `sync.eu.assemblyai.com` exist (EU verified
  live, 200, ~650 ms request_time_ms vs ~200 ms global from this box).
- Auth: `Authorization: <key>` with **no `Bearer` prefix** per docs. Live,
  `Authorization: Bearer <key>` also returns 200, so the adapter should still
  send the raw key to match the documented contract and the provider monitor.
  A `token=<key>` query parameter also works (verified) but is not needed.
- Bad key: **404** `{"status":404,"title":"Not Found","detail":"Invalid API key"}`
  with `content-type: application/problem+json`. Not 401. The adapter must
  map this 404 to an auth error rather than a model-not-found error.
- Body: `multipart/form-data` with two parts.
  - `audio` (required). Documented content types: `audio/wav`, `audio/pcm`.
    Live, `audio/mpeg`, `audio/flac`, `audio/ogg` (opus) and `audio/mp4`
    (aac) were all accepted with correct transcripts. Undocumented, so treat
    as best-effort. The part's `Content-Type` is what is validated: omitting
    it yields 415 `unsupported audio Content-Type: 'application/octet-stream'`,
    and an mp3 labelled `audio/wav` yields 400 `malformed WAV`.
  - `config` (optional, `application/json`). Fields: `sample_rate`,
    `channels` (both required for `audio/pcm`), `language_code`
    (string or array), `timestamps` (bool), `prompt` (string, max 6000
    chars), `keyterms_prompt` (array, max 100 terms / 8000 chars, aliases
    `keyterms` and `word_boost`, only one allowed), `conversation_context`
    (string or array up to 500). Unknown keys are **rejected** with 400
    `invalid config part: <key>: Extra inputs are not permitted`.
- Audio constraints (all verified live): 80 ms to 120 000 ms duration,
  16-bit samples only, sample rate in
  `[8000, 16000, 22050, 24000, 32000, 44100, 48000]`, mono or stereo. Stereo
  is down-mixed and billed once (5 s stereo → `audio_duration_ms: 5000`).
  40 MB max file size per docs (not probed, the 120 s duration limit is hit
  first for 16 kHz mono 16-bit WAV at ~3.8 MB).
- Default OpenRouter URL pattern (`<baseUrl>/audio/transcriptions`)
  compatible? No. Adapter overrides `getUrl()` to
  `${provider_info.baseUrl}/transcribe` with `baseUrl` set to
  `https://sync.assemblyai.com`, and `getHeaders()` to drop the `Bearer`
  prefix and add `X-AAI-Model: <provider_model_id>`.
- No request-ID or rate-limit response headers. The only correlation id is
  `session_id` in the success body. Error bodies carry no id. Log
  `session_id` on success and the `detail` string on error.
- `GET /warm` (unauthenticated, same `X-AAI-Model` header) returns 200 and
  pre-establishes the HTTPS connection for a `/transcribe` that follows on
  the same connection pool. Not useful for the adapter: the worker only sees
  the request once the audio has arrived, so a warm call would just add a
  round trip, and it cannot serve as a key check because it needs no auth.

## Request matrix (live, 2026-09-14, dev key)

| Scenario                          | Input                    | Config                                                         | Result                                                                                                               |
| --------------------------------- | ------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| baseline                          | 5.000 s wav 16k mono     | none                                                           | 200, 13 words, `audio_duration_ms: 5000`, `request_time_ms: 209`                                                     |
| with-language                     | same                     | `language_code: "en"`                                          | 200, transcript within noise of baseline (one word differs), same duration                                           |
| with-language (array)             | same                     | `language_code: ["en","es"]`                                   | 200                                                                                                                  |
| with-language (bad)               | same                     | `language_code: "xx"`                                          | 400 listing the accepted codes (32, see Quirks)                                                                      |
| with-temperature                  | same                     | `temperature: 0.5`                                             | 400 `Extra inputs are not permitted`. No temperature analog.                                                         |
| with-timestamps                   | same                     | `timestamps: true`                                             | 200, every word gains integer ms `start`/`end`                                                                       |
| with-provider-options             | same                     | `keyterms_prompt`, `prompt`, `conversation_context` (one each) | 200 each, same duration, transcript unchanged                                                                        |
| long-audio                        | 29.964 s wav             | none                                                           | 200, 65 words, `audio_duration_ms: 29964`                                                                            |
| unsupported-format                | 5 s mp3 as `audio/mpeg`  | none                                                           | **200** (undocumented format accepted). 24-bit wav → 415, 11 025 Hz → 415, no part content type → 415                |
| bad-auth                          | 5 s wav                  | bad key                                                        | **404** `Invalid API key` (problem+json)                                                                             |
| oversize-payload                  | 124.784 s wav            | none                                                           | 413 `audio duration 124784 ms exceeds limit 120000 ms`                                                               |
| short-audio                       | 0.500 s wav              | none                                                           | 200, `audio_duration_ms: 500`, one low-confidence word                                                               |
| empty-audio                       | 5 s silence              | none                                                           | 200, `text: ""`, `words: []`, `confidence: 0`, `audio_duration_ms: 5000`                                             |
| doc-constraint: 50 ms             | 0.050 s wav              | none                                                           | 400 `audio duration 50 ms below minimum 80 ms`                                                                       |
| doc-constraint: pcm               | 5 s raw s16le            | none                                                           | 400 `audio/pcm requires sample_rate and channels`; with both → 200                                                   |
| doc-constraint: keyterm aliases   | 5 s wav                  | `keyterms_prompt` + `word_boost`                               | 400 `provide only one of ...`                                                                                        |
| doc-constraint: prompt + language | 5 s wav                  | `prompt` + `language_code: "es"`                               | 200 (docs say language is ignored when prompt is set; transcript stayed English)                                     |
| doc-constraint: model header      | 5 s wav                  | missing / `universal-2` / `u3-pro`                             | 404 / 404 / 200                                                                                                      |
| with-oai-passthrough              | 5 s wav                  | `response_format`, extra field                                 | 400 `Extra inputs are not permitted`                                                                                 |
| sharding probe                    | 59.892 s / 119.320 s wav | none                                                           | 200 / 200, `request_time_ms` 725 / 806. Latency is flat across 5 s to 120 s, no sharding needed below the hard limit |
| with-region                       | 5 s wav to `sync.eu`     | none                                                           | 200                                                                                                                  |
| bad config JSON                   | 5 s wav                  | `{not json`                                                    | 400 `invalid config part: config: Invalid JSON ...`                                                                  |
| no audio part                     | none                     | `{}`                                                           | 400 `request must include an audio file part`                                                                        |

## Shape-affecting and billing-affecting arguments

| Argument                  | Shape effect                    | Billing effect (pricing page) | Decision                                                                                          |
| ------------------------- | ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `timestamps`              | adds `start`/`end` to each word | none listed                   | map from `response_format: verbose_json`                                                          |
| `language_code`           | none                            | none listed                   | map from `language`                                                                               |
| `keyterms_prompt`         | none                            | "Included"                    | allow via `provider.options.assemblyai`                                                           |
| `conversation_context`    | none                            | "Included"                    | allow via `provider.options.assemblyai`                                                           |
| `prompt`                  | none                            | **$0.05/hr surcharge**        | forward only when the endpoint prices `audio_seconds_prompted`; bill the whole duration on that SKU |
| `sample_rate`, `channels` | none                            | none                          | adapter-owned, set only for `audio/pcm` (OpenRouter input is always a container format, so never) |

## Response shape (verified live 2026-09-14)

Success (200, `application/json`):

```json
{
  "text": "Hello, this is a test of the Microsoft MAI Transcribe 2 module. Um—",
  "words": [
    { "text": "Hello,", "confidence": 0.9377333516700835 },
    { "text": "this", "confidence": 0.9999210896780105 }
  ],
  "confidence": 0.9413228649711401,
  "audio_duration_ms": 5000,
  "session_id": "289441d5-c92e-45fe-b29b-b821fd21b2f6",
  "request_time_ms": 209.1260552406311
}
```

With `timestamps: true` each word is
`{ "text": "Hello,", "start": 0, "end": 274, "confidence": 0.93 }` (integer
milliseconds). There is no segment or utterance array and no detected
language field. `audio_duration_ms` is an integer and matched ffprobe to the
millisecond on every WAV capture (5000, 29964, 59892, 119320, 500). The aac
clip reported 5056 for a 5.000 s source, consistent with codec priming
padding rather than a provider rounding rule.

Error (4xx/5xx from the application, `application/problem+json`):

```json
{
  "status": 413,
  "title": "Audio Too Large",
  "detail": "audio duration 124784 ms exceeds limit 120000 ms"
}
```

Observed `title` values: `Bad Request` (400 config errors), `Bad Audio`
(400 audio errors), `Audio Too Short` (400), `Not Found` (404 bad key),
`Audio Too Large` (413), `Unsupported Media Type` (415). The documented
`error_code` field was not present on any capture. Load-balancer errors
(bad or missing `X-AAI-Model`) are `text/plain` `Not found`. 429 and 503
were not triggered during the capture run. Docs say both carry
`Retry-After`, and `access-control-expose-headers: Retry-After` is present
on every response, which supports that claim.

## Billing model

- Primary source: https://www.assemblyai.com/pricing, checked 2026-09-14.
  Pay-as-you-go section, "Sync API": Universal-3.5 Pro **$0.45/hr**.
  Add-on features, Sync API: Keyterms Prompting "Included", Conversation
  Context "Included", Prompting **$0.05/hr**.
- $0.45/hr = $0.000125 per audio second.
- Granularity: https://www.assemblyai.com/docs/billing-and-pricing says
  "pre-recorded audio is pro-rated to the exact second of audio processed"
  and "failed transcripts aren't charged". That page does not mention the
  Sync API by name, so **per-second proration for Sync is unverified** and
  is treated below as the working assumption. The response reports
  `audio_duration_ms` at millisecond precision, so the adapter can bill at
  either granularity once confirmed.
- Floor: none documented beyond the 80 ms rejection minimum. A 500 ms clip
  reports `audio_duration_ms: 500`. Silence is transcribed as empty text and
  still reports full duration, so silence is billable.
- Stereo is billed once (down-mixed), not per channel.
- No provider-side cost field in the response and no usage/billing API on
  the Sync surface. Provider-reported cost can only be reconciled from the
  AssemblyAI dashboard or the monthly invoice (Alan confirmed invoiced
  billing is set up).
- Rate limits: not documented numerically for Sync. The pricing page offers
  "custom rate limits, enhanced concurrency" on the Custom tier. No
  rate-limit headers are returned on 200s.

## Reconciliation (2026-09-14)

Expected cost uses $0.000125/s on exact `audio_duration_ms / 1000`. Provider
cost column is blank because the Sync response exposes no cost and no usage
API exists. Fill from the invoice after staging.

| Scenario              | ffprobe s | `audio_duration_ms` | delta  | expected cost | provider cost |
| --------------------- | --------- | ------------------- | ------ | ------------- | ------------- |
| baseline              | 5.000     | 5000                | 0      | $0.000625     | unverified    |
| with-timestamps       | 5.000     | 5000                | 0      | $0.000625     | unverified    |
| short-audio           | 0.500     | 500                 | 0      | $0.0000625    | unverified    |
| empty-audio (silence) | 5.000     | 5000                | 0      | $0.000625     | unverified    |
| stereo                | 5.000     | 5000                | 0      | $0.000625     | unverified    |
| long-audio            | 29.964    | 29964               | 0      | $0.0037455    | unverified    |
| sharding 60 s         | 59.892    | 59892               | 0      | $0.0074865    | unverified    |
| sharding 119 s        | 119.320   | 119320              | 0      | $0.014915     | unverified    |
| aac (m4a)             | 5.000     | 5056                | +56 ms | $0.000632     | unverified    |

Total audio submitted across the full capture run (37 successful requests,
~7.8 minutes) is about $0.06 at the listed rate. The request matrix above
shows one representative result per scenario. The full run also included
repeats of the baseline clip while iterating on the capture script and
exploratory probes (`Bearer` auth, `token` query parameter, legacy model
aliases, the `/warm` endpoint, additional formats), which account for the
extra ~20 requests and ~3 minutes of audio. One `prompt` request (5 s) adds
about $0.00007 at $0.05/hr.

## OpenRouter mapping (proposed, human checkpoint)

- Adapter: `packages/stt/adapters/assemblyai`, multipart FormData like
  Fish Audio and Mistral. Audio part filename and `Content-Type` derived
  from `input_audio.format` (the part content type is what AssemblyAI
  validates). Accept only the documented `wav`; reject other
  `input_audio.format` values with a 400 in `validateRequest()`. `mp3`,
  `flac`, `ogg`, `m4a` worked live but are undocumented.
- `getUrl()`: `${baseUrl}/transcribe`, `baseUrl = https://sync.assemblyai.com`.
  Regional endpoints can be separate provider rows later if data residency
  is requested.
- `getHeaders()`: `Authorization: <key>` (no Bearer),
  `X-AAI-Model: <provider_model_id>` (`universal-3-5-pro`).
- `language` → `config.language_code`. Validate against the live list
  (32 codes) or pass through and let the 400 surface.
- `temperature` → not supported. Reject with a client error or ignore, per
  the pattern used by other adapters without a temperature analog.
- `response_format: verbose_json` → `config.timestamps: true`. Map
  `words[{text,start,end}]` (ms) to OpenRouter `words[{word,start,end}]`
  (seconds, divide by 1000), and emit one full-audio segment via
  `singleFullAudioSegments` since AssemblyAI returns no segments.
  `supportsVerboseJson = true`.
- `provider.options.assemblyai` allowlist: `keyterms_prompt`,
  `conversation_context`. Blocklist: `audio`, `sample_rate`, `channels`,
  `language_code`, `timestamps`, `keyterms`, `word_boost`. `prompt` is
  forwarded only when the endpoint's `pricing_json` carries the prompted
  rate, otherwise dropped with a warning (Decision 2).
- Usage: `audio_duration_ms / 1000` seconds. SKU
  `assemblyai_stt:audio_seconds` at $0.000125/s with exact (unrounded)
  quantity, matching the documented pre-recorded proration. A prompted
  request records the same quantity under
  `assemblyai_stt:audio_seconds_prompted` instead ($0.50/hr all-in,
  $0.000138889/s). Re-check both against the first invoice after staging
  (Decision 1).
- Error mapping: 404 with `application/problem+json` and
  `detail: "Invalid API key"` via `getProviderErrorOverride` → 401 on
  BYOK (the user's key) and 502 on managed keys (our key), following the
  Fish Audio 402 pattern. 413 → payload too large. 415 and 400
  `Bad Audio` → invalid request. 429/503 → retryable with `Retry-After`.
  Bare `text/plain` 404 means a bad `X-AAI-Model`, which is an OpenRouter
  configuration error, not a user error.
- Preauthorization: 120 s hard cap, so max charge per request is
  `120 * $0.000125 = $0.015` (`$0.0167` prompted).

## Quirks

- Bad key is 404, not 401, and uses problem+json. A bad model header is
  also 404 but `text/plain` from `awselb/2.0`. Distinguish on content type.
- Docs list 19 supported languages. The live 400 lists 32:
  `en es de fr it pt tr nl sv no da fi hi vi ar he ja ur zh ko ca gl ru ro et fa yue af mr zu xh nn`.
- Docs say only WAV and PCM are accepted. Live, mp3/flac/ogg-opus/aac
  containers were transcribed correctly when labelled with their real
  content type. Undocumented, could be removed without notice.
- Docs describe an `error_code` field. Live errors use RFC 9457
  `{status,title,detail}` only.
- `Bearer` prefix is tolerated live but documented as unsupported.
- `config` rejects unknown keys, so any future passthrough option must be
  explicitly allowlisted and every OpenAI-shaped field must be stripped.
- No request-id header. `session_id` is only present on success.
- `request_time_ms` (server processing) was 90 to 810 ms across 0.5 s to
  120 s inputs, with EU adding ~450 ms from this US box.

## Cool features (deferred)

- Async pre-recorded API (`api.assemblyai.com/v2/transcript`) with speaker
  labels, entity detection, and the wider model list. Out of scope.
- Streaming STT over WebSocket. Internal POC only (#41563).
- Regional endpoints `sync.us` / `sync.eu` for data residency.
- `GET /warm` for cold-start mitigation.

## Decisions (2026-09-14, Alan)

1. **Sync billing granularity.** Bill exact `audio_duration_ms / 1000` on
   an `audio_seconds` SKU at $0.000125/s. The billing docs state exact-second
   proration for pre-recorded audio and Sync has no separate statement, so
   verify against the first invoice after staging.
2. **`prompt` surcharge.** Tier swap, following Deepgram's multilingual
   SKU: a request carrying a non-empty `prompt` bills its whole duration
   under `audio_seconds_prompted` at the all-in $0.50/hr rate, unprompted
   requests stay on `audio_seconds`. The prompted SKU is optional in
   `pricing_json`. When absent the adapter drops `prompt` rather than
   forwarding an unpriced surcharge. The charge is decided from the
   request because the Sync response does not report whether a prompt was
   applied, so include one prompted request in the invoice reconciliation.
   (Launch PR blocked `prompt` entirely, superseded by the follow-up PR.)
3. **Input formats.** Restrict to the documented `wav`. Undocumented live
   acceptance of mp3/flac/ogg/m4a is not a supported contract.
4. **Bad-key 404.** Body-sniff `Invalid API key` on 404 and remap to 401
   on BYOK, 502 on managed keys.

## Open questions (human checkpoint)

1. **Rate limits.** No published numbers for Sync. Ask AssemblyAI for the
   account's concurrency cap before public exposure.
2. **`temperature`.** Not supported upstream. Reject or ignore?
