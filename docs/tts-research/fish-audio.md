# Fish Audio TTS Research

Last updated: 2026-07-17
Researcher: devin-2f6ea831e3eb4ceaa02d702f86f71215 (john.bailey)

Live captures run against `https://api.fish.audio`. Initial captures
(2026-07-15) used the free-tier model `s2.1-pro-free` because the key had
$0 API credit; **paid captures on `s2.1-pro` were re-run 2026-07-17 with a
funded key** and confirm free/paid parity on formats, headers, and payload
mapping. Billing was reconciled end-to-end through the local OpenRouter
stack (see Billing reconciliation).

## Summary + doc links

- Provider: Fish Audio (`fish-audio`), new provider (no existing enum entry).
- Lane onboarded: sync REST synthesis `POST /v1/tts` (whole-file response,
  chunked transfer).
- Models: `s2.1-pro` (recommended production), `s2.1-pro-free` (same model,
  $0, no TTFA/DPA guarantees), `s2-pro` (previous gen), `s1` (legacy).
- Docs:
  - Index: https://docs.fish.audio/llms.txt
  - TTS endpoint: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech.md
  - Models overview: https://docs.fish.audio/developer-guide/models-pricing/models-overview.md
  - Pricing: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits.md
  - OpenAPI: https://docs.fish.audio/api-reference/openapi.json
- Explicitly deferred: WebSocket real-time streaming, `POST
  /v1/tts/stream/with-timestamp`, voice cloning/model creation (`POST
  /model`), `POST /v1/voice-design`, MessagePack request serialization with
  inline `references` audio, multi-speaker dialogue synthesis.

## Request surface

- URL: `POST https://api.fish.audio/v1/tts`
- Auth: `Authorization: Bearer <key>` (matches `BaseTTSAdapter.getHeaders()`
  default).
- **Model is a request header**, not a body field: `model: s2.1-pro`. The
  adapter must override `getHeaders()` to add the `model` header from
  `endpoint.provider_model_id`.
- Body: JSON (`application/json`) or MessagePack. JSON covers everything except
  inline `references` audio, which Fish accepts only over MessagePack — see
  [Inline reference audio](#inline-reference-audio-voice-cloning).
- Model/voice mapping:
  - `endpoint.provider_model_id` → `model` header (`s2.1-pro`).
  - `request.voice` → body `reference_id` (a Fish Audio voice model id,
    e.g. `90e65eaaf50e4470b8e6d43ee6afd7d5`). Omitting `reference_id` uses a
    default voice. Voice ids come from `GET /model` (2.4M public voices) —
    we will curate a small `supported_tts_voices` list at staging time.
  - `request.speed` → body `prosody.speed` (0.5–2.0, multiplier).
  - `request.response_format` → body `format` (`wav` | `pcm` | `mp3` | `opus`).
- Other body fields (defaults fine, candidates for passthrough):
  `temperature` (0–1, default 0.7), `top_p`, `chunk_length` (100–300),
  `normalize`, `sample_rate`, `mp3_bitrate` (64/128/192), `opus_bitrate`,
  `latency` (`low`/`normal`/`balanced`), `max_new_tokens`,
  `repetition_penalty`, `min_chunk_length`, `condition_on_previous_chunks`,
  `early_stop_threshold`, `features` (e.g. `["quality-guard"]`).
- Text limits: no documented max input length. `chunk_length` caps at 300
  chars per processing segment but the API chunks internally. Overflow
  behavior unverified (open question).
- Streaming: response is chunked raw audio bytes (`Transfer-Encoding:
  chunked`), no SSE/base64 wrapping — whole-file consumption works.
- Request-ID headers: **none observed**. Only `cf-ray` (Cloudflare) and
  `x-fishaudio-datacenter` (e.g. `us-dallas`). Log `cf-ray` on error paths.
- Rate-limit headers: `ratelimit-current-concurrency` /
  `ratelimit-limit-concurrency` — quota is concurrency-based (5/15/50 tiers
  by paid threshold), not request-counted.
- Callbacks/webhooks: none on `/v1/tts` (no SSRF surface). Neither
  `references` inline audio nor `reference_id` takes a URL — the former is
  raw bytes, the latter an opaque id lookup.

## Inline reference audio (voice cloning)

The contract as implemented by `FishAudioTTSAdapter`:

- The `input_audio` part of `request.input_references` (base64, optionally a
  `data:` URI) is decoded to bytes at the request boundary and mapped to
  `references[0].audio` as **raw bytes**, not base64. The optional `text` part
  maps to `references[0].text`, defaulting to `''` when absent.
- The body must be MessagePack (`Content-Type: application/msgpack`) whenever
  `references` is populated. The adapter switches encodings on the presence of
  reference audio, so the two cannot diverge. Fish rejects a base64 string or
  `data:` URI in JSON `references[0].audio` (400 `Reference Audio is not
  valid`); the only working JSON encoding is an integer byte array, which
  inflates the payload ~3.7x over raw bytes (a 15 MiB reference would exceed
  Fish's ~50 MiB request cap), so MessagePack stays (verified 2026-08-03
  against `s2.1-pro`).
- `reference_id` and `references` are alternative ways to select a voice.
  OpenRouter sends no voice for cloning requests, so `reference_id` is absent.
- Routing is gated on the `supports_voice_cloning` endpoint feature **and** the
  adapter's `supportsVoiceCloning` capability, so enabling the flag on a
  provider that cannot encode reference audio does not route traffic there.

Live capture against a funded `s2.1-pro` key, 2026-08-03 (direct provider
calls encoded exactly like the adapter — msgpackr `Packr({ useRecords:
false })` — plus local-stack runs for the billing question). These are
observed behaviors, not documented provider guarantees:

- **Accepted containers/codecs**: WAV (PCM s16le; 8 kHz mono, 44.1 kHz mono
  and stereo), MP3, Opus-in-Ogg, Vorbis-in-Ogg, FLAC, AAC-in-M4A, and
  Opus-in-WebM all returned 200. Headerless raw PCM, random bytes, and plain
  text were rejected with 400
  `{"message":"Reference Audio is not valid, please check your reference audio","status":400}`.
  Fish sniffs the container — there is no format/mime field for references.
- **Duration limit**: a generated MP3 of 376 s was accepted; 378 s was
  rejected with 400 `{"message":"Reference audio too long","status":400}`.
  The boundary sits between 376 s and 378 s (~6.3 min) and is enforced on
  decoded duration, not bytes.
- **Byte limit**: valid WAV references up to 52.0 MB (total request ~52.0 MB)
  were accepted; a ~53 MB request got HTTP 413 with a plain-text `Payload too
  large` body (no JSON envelope) — a transport-level cap of ~50 MiB that fires
  before duration validation. OpenRouter's own `MAX_REF_AUDIO_BASE64_LENGTH`
  guard (15 MiB decoded) is therefore well below both provider ceilings, but
  it remains a platform choice, not a mirrored provider limit.
- **Reference `text` and clone quality**: 12 paid runs (exact, empty,
  mismatched-English, and wrong-language transcripts x3 each, same reference
  audio and input text) showed no measurable difference: MFCC cosine
  similarity to the reference voice was 0.982–0.992 for every variant
  (default voice scored 0.878–0.910), and Deepgram nova-2 transcribed every
  output with 0% WER. An empty or mismatched `text` did not measurably
  degrade the clone in this capture; keeping `''` as the default is safe.
- **Billing**: through the local stack, the same 39-UTF-8-byte input with no
  reference, a 25 KB reference, and a 10.6 MB reference produced identical
  usage (`0.000585` = 39 x $0.000015) in the transaction records — reference
  bytes do not affect OpenRouter metering (billed on input text only; see
  [Pricing](#pricing)). Fish's wallet decrements arrive batched/delayed, so
  per-request provider-side attribution is not observable, but the observed
  decrements were consistent with text-byte billing.

## Audio output

| `format` | Content-Type observed | Notes |
| --- | --- | --- |
| `mp3` | `audio/mpeg` | default; 32/44.1kHz, mono, bitrate 64/128 (default)/192 kbps |
| `wav` | `audio/wav` | 8/16/24/32/44.1kHz, default 44.1kHz, 16-bit mono |
| `pcm` | `audio/pcm` | headerless; default 44.1kHz, 16-bit, mono |
| `opus` | `audio/opus` (ogg container per ffprobe) | 48kHz only, mono, bitrate -1000 (auto)/24/32 (default)/48/64 kbps |

- PCM parameters: 44100 Hz, 16-bit signed little-endian, 1 channel
  (defaults; `sample_rate` body field can change the rate — we pin the
  default). Verified: `pcm` capture of a 2.88s utterance returned 253,952
  bytes ≈ 2.879s × 44100 × 2 bytes.
- `TTS_ADAPTER_SUPPORTED_FORMATS` decision: `mp3` + `pcm` (the two formats
  in `TTSResponseFormat`). `wav`/`opus` exist upstream but are not part of
  the OpenRouter response-format enum.

## Pricing

- Primary source: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits.md
  (checked 2026-07-15).

| Model | Price |
| --- | --- |
| `s2.1-pro` | $15.00 / 1M UTF-8 bytes |
| `s2.1-pro-free` | $0.00 / 1M UTF-8 bytes |
| `s2-pro` | $15.00 / 1M UTF-8 bytes |
| `s1` | $15.00 / 1M UTF-8 bytes |

- Billing dimension: **input text size in UTF-8 bytes** ($0.000015/byte).
- Billable-unit risk: UTF-8 bytes ≠ JS `input.length` (UTF-16 code units).
  Multi-byte probe `你好世界 😀 こんにちは`: 12 code points, 13 UTF-16 code
  units, **33 UTF-8 bytes**. The default `BaseTTSAdapter.getUsage()`
  (`input.length`) would under-bill CJK/emoji text by ~2.5×. The adapter
  must meter `Buffer.byteLength(input, 'utf8')`.
- SKU decision: **custom `fish_audio_tts:utf8_bytes` SKU** with a
  `FishAudioTTSPricingStrategy`, priced at $15/1M UTF-8 bytes
  (user-approved; see Open questions #2). The adapter overrides
  `getUsage()` to report `Buffer.byteLength(input, 'utf8')` as the
  quantity.
- Request-level pricing modifiers: none found — voice (`reference_id`),
  format, bitrate, latency, and speed do not change the rate. `features:
  ["quality-guard"]` availability/pricing is undocumented; blocked from
  passthrough until clarified.
- Minimums/floors: none documented.

## Capture matrix (live; happy paths re-verified on paid `s2.1-pro` 2026-07-17)

| Scenario | Status | Evidence |
| --- | --- | --- |
| compressed (mp3) | 200, 101,981 B, `audio/mpeg`, ffprobe 6.37s @128kbps, playable | happy path |
| pcm | 200, 253,952 B, `audio/pcm`, byte math ⇒ 44.1kHz/16-bit/mono | PCM params |
| opus | 200, 22,457 B, `audio/opus`, ffprobe ogg 2.88s | format mapping |
| wav | 200, 208,940 B, `audio/wav` | format mapping |
| with-voice (`reference_id`) | 200, audibly different voice, 6.71s | voice mapping works |
| with-speed (`prosody.speed: 2.0`) | 200, 2.27s output for 70-byte text (≈half the baseline pace) | speed plumbing works |
| multibyte (CJK+emoji) | 200, 2.30s audio | unit probe (see Pricing) |
| bad-voice (`reference_id: nonexistent…`) | 400 `{"message":"Reference not found","status":400}` | error shape |
| bad-format (`format: "aac"`) | 400, **plain-text** body: `Failed to parse json request body: unknown variant \`aac\`, expected one of \`mp3\`, \`wav\`, \`pcm\`, \`opus\`` | non-JSON error path |
| bad-auth | 401 `{"message":"Invalid Token","status":401}` | auth scheme confirmed |
| unknown model header | **402** insufficient-credit envelope (not 404) | model validation quirk |
| insufficient credit ($0 key, paid model) | 402 `{"message":"Insufficient API credit. …","status":402}` | error case only — not the happy path |

Paid `s2.1-pro` captures (2026-07-17):

| Scenario | Status | Evidence |
| --- | --- | --- |
| mp3 (`{"text":"Hello from Fish Audio paid tier","format":"mp3"}` + `model: s2.1-pro` header) | 200, 35,943 B, `audio/mpeg`, ffprobe mp3 2.246s, playable | paid happy path |
| pcm (`format: "pcm", sample_rate: 44100`) | 200, 327,680 B raw, `audio/pcm`; 327,680 / 2 / 44,100 = 3.715s matches ffprobe s16le@44.1kHz mono | PCM params confirmed on paid model |
| speed (`prosody: {speed: 1.5}`) | 200, 1.33s output (audibly faster) | speed plumbing on paid model |
| multibyte (`こんにちは世界`) | 200, 24,658 B mp3 | CJK path on paid model |
| bad format (`format: "bogus"`) | 400 plain-text `unknown variant \`bogus\`, expected one of \`mp3\`, \`wav\`, \`pcm\`, \`opus\`` | error shape unchanged |

Error envelope: `{ message: string, status: number }` for 400/401/402
(`application/json; charset=utf-8`); 422 validation errors are an array of
`{ loc, type, msg, ctx?, in? }`; malformed-JSON 400s are plain text.

## Billing reconciliation

**Verified end-to-end (2026-07-17)** through the local OpenRouter stack
(cfw-tts-api → FishAudioTTSAdapter → usage records in Spanner):

- Input `"Billing reconciliation test €ñ日本"` = 32 JS chars / **39 UTF-8
  bytes**. Recorded usage:
  `sku_items = { "fish_audio_tts:utf8_bytes": { price: "0.000015", quantity: "39" } }`,
  `usage = 0.000585` = 39 × $0.000015 — confirming byte metering (a
  `input.length` meter would have recorded 32).
- Provider-side: Fish's wallet (`GET /wallet/self/api-credit`) did not
  visibly decrement per request during the capture window on the funded
  account, so per-request provider-cost diffs could not be extracted from
  the wallet endpoint; the $15/1M-UTF-8-bytes rate is from the pricing
  page and our metering matches that unit.

| Scenario | unit count (UTF-8 B) | rate | expected cost | measured (usage record) | delta |
| --- | --- | --- | --- | --- | --- |
| multibyte ("Billing reconciliation test €ñ日本", 39 B) | 39 | $15/1M | $0.000585 | $0.000585 | 0 |

## Open questions (human checkpoint)

1. ~~Billing reconciliation on a paid model is pending API credit.~~
   **Resolved (2026-07-17):** paid `s2.1-pro` captures succeeded and
   OpenRouter-side metering reconciles at 39 UTF-8 bytes × $0.000015
   (see Billing reconciliation). Fish's wallet endpoint did not expose
   per-request decrements for a provider-side cross-check.
2. ~~Generic `TTSSKU.Characters` metered in UTF-8 bytes vs a custom
   `fish_audio_tts` SKU?~~ **Resolved:** custom `fish_audio_tts:utf8_bytes`
   SKU + `FishAudioTTSPricingStrategy` (user-approved).
3. ~~Which models to stage?~~ **Resolved:** models are staged as endpoint
   data, not code; `s2.1-pro` is used for local verification and further
   models can be added later without adapter changes.
4. Default voice / curated `supported_tts_voices` list — Fish has 2.4M
   public voices; need a product decision on the curated set.
   **Engineering default shipped:** no curated list — `voice` maps to any
   `reference_id` and the adapter enforces `supported_tts_voices` only if
   the staged model defines one.
5. Max input length is undocumented — probe overflow behavior before
   go-live.
6. Is `features: ["quality-guard"]` priced? **Engineering default shipped:**
   blocked from passthrough (`BLOCKED_BODY_FIELDS`) until answered.
7. `prosody` currently documents only `speed`, so the adapter blocks the
   whole `prosody` key from passthrough (the adapter owns
   `request.speed → prosody.speed`). If Fish adds more prosody sub-fields
   (e.g. `volume`, `pitch`), refine the blocklist to merge passthrough
   prosody sub-fields while keeping `speed` canonical.
