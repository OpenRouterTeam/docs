# ElevenLabs TTS Research

Phase 1 output of `.agents/skills/audio-research-provider/SKILL.md` for `$PROVIDER_SLUG = elevenlabs`, `$MODEL_ID = eleven_v3` (plus `eleven_multilingual_v2` and `eleven_flash_v2_5`). Docs read and live captures taken 2026-09-24 against `https://api.elevenlabs.io` with the OpenRouter ElevenLabs key from Infisical (`ELEVENLABS_API_KEY`). The key has no `user_read` scope, so `GET /v1/user/subscription` returned 401 and the account tier was **not** verified directly; tier claims below are from the docs, plus the observation that the key succeeded on every tier-gated format it was asked for.

Each claim is tagged: **[doc]** from ElevenLabs documentation, **[live]** observed on the wire in this pass, **[measured]** computed locally from the captures, **[inferred]** our reading, **[open]** unresolved.

A second pass on 2026-09-29 added `eleven_v4` and `eleven_v4_turbo` (see Eleven v4 below) and re-checked the pricing page.

## Scope

- Lane: synchronous, non-streaming `POST /v1/text-to-speech/{voice_id}`. Response is raw audio bytes, which is exactly the shape `BaseTTSAdapter` finalizes today.
- Deferred to a follow-up pass (agreed in `#proj-elevenlabs`): `/stream`, `/with-timestamps`, `/stream/with-timestamps`, request stitching (`previous_request_ids` / `next_request_ids`), Text to Dialogue, and any codec family outside `mp3` / `pcm`.
- Initial models: `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`. `eleven_turbo_v2_5` and `eleven_flash_v2` were captured in `GET /v1/models` but are not part of the first pass. `eleven_v4` and `eleven_v4_turbo` were added in the 2026-09-29 pass.
- Companion note: `docs/stt-research/elevenlabs.md` covers the Scribe speech-to-text lane on the same provider account (key, request id header, and error envelope conventions are shared).

## Summary + doc links

- Convert (no timestamps): <https://elevenlabs.io/docs/api-reference/text-to-speech/convert>
- Convert with timestamps (deferred): <https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps>
- Models overview: <https://elevenlabs.io/docs/overview/models>
- API pricing (primary pricing source): <https://elevenlabs.io/pricing/api>
- Voice settings: <https://elevenlabs.io/docs/overview/capabilities/text-to-speech#voice-settings>
- Eleven v4 guide: <https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4>
- Text to Dialogue (deferred): <https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert>

Headline findings:

- **Billable unit is Unicode code points, halved on Flash** [live]. `character-cost` equals the code-point count of `text` on `eleven_v3` and `eleven_multilingual_v2`, and exactly half of it on `eleven_flash_v2_5`. It is not UTF-16 code units (`input.length`) and not UTF-8 bytes. See Billing reconciliation.
- **Auth is `xi-api-key`** [doc][live], not `Authorization: Bearer`. `getHeaders()` override required.
- **Voice is a path segment** [doc]. `voice_id` lives in the URL; there is no body field. Adapter builds the URL from `request.voice`.
- **`request-id` response header** [live] is the first entry in `UPSTREAM_REQUEST_ID_HEADERS` (`packages/helpers/upstream-request-id.ts`), so upstream id capture works with no adapter override.
- **PCM is 16-bit signed little-endian mono** [measured]. Byte counts match `rate * 2 * seconds`, and little-endian decoding gives plausible speech statistics where big-endian gives full-scale noise.
- **Upstream ignores unknown body fields** [live]. An unknown key returned 200, so passthrough typos will not be caught by ElevenLabs; the adapter's blocklist is the only guard.
- **Documented per-model text limits are enforced upstream with a 10% allowance** [live]. A 5,100-character `eleven_v3` request (documented cap 5,000) returned 200 and billed 5,100; the 2026-09-30 boundary probe found the cut at exactly 1.1x the documented value on every model tested (5,500 / 5,501, 11,000 / 11,001, 33,000 / 33,001, 44,000 / 44,001).

## Request surface

### Endpoint, method, auth

| Item | Value | Tag |
| --- | --- | --- |
| URL | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` | [doc][live] |
| Auth | `xi-api-key: <key>` header. `Authorization: Bearer` is not accepted. | [doc][live] |
| Bad key | `401` `{"detail":{"type":"authentication_error","code":"unauthorized","message":"Invalid API key","status":"invalid_api_key","request_id":"..."}}` | [live] |
| Content type | `application/json` body | [doc] |
| `endpoint.provider_info.baseUrl` | `https://api.elevenlabs.io/v1`; adapter appends `/text-to-speech/{voice_id}` | [inferred] |

### Query parameters

| Param | Type / values | First-pass decision | Tag |
| --- | --- | --- | --- |
| `output_format` | enum, see Audio output. Default `mp3_44100_128`. | Adapter-owned. Derived from `response_format`, overridable by passthrough only within the same codec (`mp3_*` for `mp3`, `pcm_*` for `pcm`). | [doc][live] |
| `enable_logging` | bool, default `true`. `false` = zero retention, Enterprise only. | Adapter-owned, derived from endpoint ZDR policy. Never caller-settable. `false` returned `history-item-id: not_stored` on our key. | [doc][live] |
| `optimize_streaming_latency` | int 0..4, deprecated | Blocked. Upstream still accepts it (200 with value 3). | [doc][live] |

### Body fields

| Field | Type / values | First-pass decision | Tag |
| --- | --- | --- | --- |
| `text` | string, required. Whitespace-only or empty text returns 200 and bills 1 character on Multilingual v2 and the Flash/Turbo models; v3, v3 Conversational, v4 and v4 Turbo return 400 `input_text_empty` for it and for text that is empty after stripping speaker tags and emojis. | Canonical `input`. | [doc][live] |
| `model_id` | string, default `eleven_multilingual_v2` | Canonical `model` via `endpoint.provider_model_id`. Unknown id returns 400 `model_not_found`. | [doc][live] |
| `voice_settings.speed` | number 0.7..1.2, default 1.0. 0.69 and 2.0 return 400 `invalid_voice_settings`. | Canonical `speed`, nested by the adapter. Adapter validates the range and returns 400 before the upstream call. | [doc][live] |
| `voice_settings.stability` | number 0..1 (v3 accepts only 0.0 / 0.5 / 1.0 per docs) | Passthrough, merged with canonical speed. | [doc] |
| `voice_settings.similarity_boost` | number 0..1 | Passthrough. | [doc] |
| `voice_settings.style` | number 0..1. `GET /v1/models` reports `can_use_style: false` for `eleven_v3`, yet `style: 0.5` on v3 returned 200. | Passthrough; upstream silently ignores on unsupported models. | [doc][live] |
| `voice_settings.use_speaker_boost` | bool | Passthrough. | [doc] |
| `language_code` | ISO 639-1. Honored on Flash / Turbo v2.5; silently ignored on Multilingual v2 (both `fr` requests returned 200). | Passthrough. | [doc][live] |
| `seed` | int 0..4294967295, best effort | Passthrough. 200 observed. | [doc][live] |
| `previous_text` / `next_text` | string | Passthrough. 200 observed. | [doc][live] |
| `apply_text_normalization` | `auto` / `on` / `off`. `on` is Enterprise-only on Flash v2.5. | Passthrough. `on` with Flash v2.5 returned 200 on our key. | [doc][live] |
| `apply_language_text_normalization` | bool (Japanese only) | Passthrough. | [doc] |
| `pronunciation_dictionary_locators` | array of `{pronunciation_dictionary_id, version_id}`, max 3, account-scoped | Passthrough (BYOK-useful only; on managed keys the ids will not resolve). | [doc] |
| `previous_request_ids` / `next_request_ids` | array of strings, max 3, needs `enable_logging=true` | Blocked in first pass (stitching deferred; will map to OpenRouter generation ids later). | [doc] |
| `use_pvc_as_ivc` | bool, deprecated | Blocked. | [doc] |
| Unknown keys | Ignored by upstream (200) | Adapter forwards non-blocked passthrough keys verbatim. | [live] |

### Model vs voice mapping

- `endpoint.provider_model_id` holds the ElevenLabs `model_id` (`eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`).
- `request.voice` holds the ElevenLabs `voice_id` and is required (`requiresVoice = true`), because the URL cannot be built without it. ElevenLabs manages the voice inventory; the adapter does not validate against a static list, it only rejects strings outside `[A-Za-z0-9_-]` locally so the voice cannot reshape the request path. Unknown id returns 404 `voice_not_found`, which the adapter maps to a 400 for the caller. A bare-string `{"detail":"Not Found"}` 404 (unroutable path, e.g. a base URL missing `/v1`) is left to the shared handler as an upstream fault.
- Captured premade voice ids used in this pass: `JBFqnCBsd6RMkjVDRZzb` (George), `EXAVITQu4vr4xnSDxMaL` (Sarah). Both produced audibly different audio for the same text.

### Text limits [doc][live]

| Model | `GET /v1/models` `maximum_text_length_per_request` | Observed enforcement |
| --- | --- | --- |
| `eleven_v4` | 10,000 | not probed |
| `eleven_v4_turbo` | 10,000 | 11,000 returned 200 (`character-cost: 5500`), 11,001 returned 400 `max_character_limit_exceeded` |
| `eleven_v3` | 5,000 | 5,001 and 5,100 returned 200 (`character-cost: 5001` / `5100`), 5,501 returned 400 `max_character_limit_exceeded` (fixture `error-400-text-too-long`) |
| `eleven_v3_conversational` | 5,000 | 5,500 returned 200 (`character-cost: 2750`), 5,501 returned 400 |
| `eleven_multilingual_v2` | 10,000 | not probed |
| `eleven_flash_v2_5` | 40,000 | 44,000 returned 200 (`character-cost: 22000`), 44,001 returned 400 |
| `eleven_turbo_v2_5` | 40,000 | not probed |
| `eleven_turbo_v2` | 30,000 | 33,000 returned 200 (`character-cost: 16500`), 33,001 returned 400 |
| `eleven_flash_v2` | 30,000 | not probed |

The rejection body is `code: text_too_long`, `status: max_character_limit_exceeded`, with a message that quotes the documented value ("Request text length (5501) exceeds the maximum text length of 5000 characters") even though the enforced cut is 10% higher. Probe log: 2026-09-30 prod parity run, `limit_probe.log`.

Decision: the adapter enforces `floor(documented × 1.1)` per model locally (400 before upstream, message in the upstream wording) so callers see the same accept/reject boundary as a direct request, and maps `max_character_limit_exceeded` to the same 400 for models whose limit is not in the local table. Measured in Unicode code points, matching the billable unit.

### Speed [doc][live]

`voice_settings.speed`, range 0.7..1.2, default 1.0. OpenRouter's `speed` schema allows a wider range, so the adapter must clamp-reject: out-of-range values return 400 locally with the ElevenLabs bounds in the message. Returned 200 on all three first-pass models (v3 at 1.2 returned 200).

2026-09-29 duration check [measured]: `speed: 0.7` stretched Multilingual v2 from 3.53 s to 5.02 s, but left `eleven_v3` (3.97 s both ways, `seed: 42`) and the v4 models unchanged. The v4 guide states "Style and Speed sliders are not available in Eleven v4" [doc], so the adapter rejects a non-default `speed` on `eleven_v4` / `eleven_v4_turbo` with a local 400 and strips `speed` from `voice_settings` before sending. v3 is left as-is pending confirmation (see Open questions).

### Streaming [doc]

`/stream` returns chunked raw audio; `/stream/with-timestamps` returns JSON chunks with `audio_base64` plus per-chunk alignment. Both deferred. The sync endpoint returns the whole file in one response body.

### Upstream request id [live]

Response header `request-id` (e.g. `4buQtq7JkXXR8n5LX8Sb`). Also present: `history-item-id`, `character-cost`, `tts-latency-ms`, `current-concurrent-requests`, `workspace-concurrent-requests`, `x-region`. Error bodies repeat the id as `detail.request_id`.

### Callbacks / SSRF [doc]

The sync endpoint has no callback or webhook parameter. Nothing to block on that axis; the adapter still refuses any passthrough key it does not recognize as a documented body field.

## Eleven v4 [doc][live]

Docs read and captures taken 2026-09-29 (`/home/ubuntu/el-capture/capture.sh`, local scratch, same redaction rules as the first pass).

| Item | `eleven_v4` | `eleven_v4_turbo` | Tag |
| --- | --- | --- | --- |
| Positioning | flagship expressive model; v4 guide recommends it over v3 | same quality tier, built for real-time ("median inference latency ~100 ms") | [doc] |
| Sync `POST /v1/text-to-speech/{voice_id}` | 200, `audio/mpeg`, 66,499 B, 4.13 s | 200, `audio/mpeg`, 65,245 B, 4.05 s | [live] |
| `tts-latency-ms` (55-char text, one sample each) | 1352 | 164 | [live] |
| `pcm_24000` | 200, `audio/pcm`, 192,000 B = 4.000 s | not probed | [live] |
| `maximum_text_length_per_request` | 10,000 | 10,000 | [live] `GET /v1/models` |
| Languages | "90+" marketed; `/v1/models` lists 85 | same | [doc][live] |
| `character-cost` for 55 code points | 55 | **28** (half-credit, like Flash) | [live] |
| `token_cost_factor` / `character_cost_multiplier` | 1.0 / 1.0 | 1.0 / 1.0 | [live] |
| `can_use_style` / `can_use_speaker_boost` | false / false | false / false | [live] |
| Concurrency group | `standard_eleven_v4` | `standard_eleven_v4` | [live] |
| Voice settings per docs | Stability, Similarity only; "Style and Speed sliders are not available"; no SSML | same | [doc] |
| `voice_settings.speed` | 200 at 0.7, 1.0 and 2.0; identical 4.13 s audio every time (ignored, not range-checked) | 200 at 0.7, same duration as default | [live] |
| `voice_settings.style: 0.5` | 200 (ignored) | not probed | [live] |
| `voice_settings.stability` + `similarity_boost` | 200 | not probed | [live] |
| Audio tags in `text` (`[whispering]`, `[laughing]`) | 200, `character-cost: 79` (tags are billed) | not probed | [live] |
| `language_code: en` | 200 | not probed | [live] |
| `apply_text_normalization: on` | 200 | not probed | [live] |
| `apply_language_text_normalization: true` | **400** `unsupported_model`, "Providing apply_language_text_normalization is not supported with the 'eleven_v4' model." | not probed | [live] |
| Empty `text` | 400 `input_text_empty` (message is the Text to Dialogue variant: "Input at position 0 has empty text") | not probed | [live] |
| Multibyte `こんにちは世界 🎉 你好` | `character-cost: 12` (code points) | not probed | [live] |

Adapter decisions:

- `ELEVENLABS_MAX_TEXT_LENGTH` gains `eleven_v4: 10_000` and `eleven_v4_turbo: 10_000`.
- Non-default `speed` on either model, canonical or passthrough `voice_settings.speed`, is a local 400 ("speed is not supported by eleven_v4"); a default `speed: 1` is stripped so the field is never sent. Rejecting is preferred over forwarding because upstream returns 200 with unchanged audio, so the caller would otherwise be silently ignored.
- `apply_language_text_normalization` stays in the passthrough allowlist; the v4 400 already maps to the generic `unsupported_model` input rejection (`fixtures/error-400-v4-language-normalization.response.json`).
- Half-credit `character-cost` on Turbo is handled like Flash: bill full code points at the Turbo endpoint rate.
- The models overview page lists v4 only under Text to Dialogue and v4 Turbo only under the Text to Dialogue WebSocket [doc], but the plain sync endpoint serves both [live]. Multi-speaker `/v1/text-to-dialogue` (`inputs[]` of `{text, voice_id}`) and the realtime WebSocket remain deferred; the multi-speaker shape maps onto the provider-neutral `input: SpeechTurn[]` proposal rather than onto this adapter.

## Audio output

### Output format list

Docs page (2026-09-24) lists 28 values. The live `invalid_output_format` error enumerates 29, adding `m4a_aac_44100_128` over the docs page. Keep both lists in mind; the adapter only needs the `mp3_*` and `pcm_*` families.

| Codec family | Values | Tier gate [doc] | First pass |
| --- | --- | --- | --- |
| MP3 | `mp3_22050_32`, `mp3_24000_48`, `mp3_44100_32`, `mp3_44100_64`, `mp3_44100_96`, `mp3_44100_128`, `mp3_44100_192` | `mp3_44100_192` Creator+ | Canonical `mp3` = `mp3_44100_128`. Same-codec passthrough override allowed; `mp3_44100_192` BYOK-only. |
| PCM | `pcm_8000`, `pcm_16000`, `pcm_22050`, `pcm_24000`, `pcm_32000`, `pcm_44100`, `pcm_48000` | `pcm_44100` Pro+ | Canonical `pcm` = `pcm_24000`. Same-codec override allowed; `pcm_44100` BYOK-only. `pcm_48000` is not on the docs tier list. |
| WAV | `wav_8000` … `wav_48000` | `wav_44100` Pro+ | Not reachable through `TTSResponseFormat`. Rejected. |
| Opus (Ogg) | `opus_48000_32` … `opus_48000_192` | none | Not reachable. Rejected. Live capture confirmed `OggS` container, 48 kHz mono. |
| μ-law / A-law | `ulaw_8000`, `alaw_8000` | none | Not reachable. Rejected. |
| AAC | `m4a_aac_44100_128` (live list only) | unknown | Not reachable. Rejected. |

### Content-Type and byte-level details [live][measured]

| `output_format` | Upstream `content-type` | Bytes / duration | Notes |
| --- | --- | --- | --- |
| `mp3_44100_128` | `audio/mpeg` | 58,057 B / 3.63 s (v3) | Starts with `ID3` tag; ffprobe: mp3, 44100 Hz, mono, ~129 kbps |
| `mp3_44100_192` | `audio/mpeg` | 87,188 B | Creator+ format, succeeded on our key |
| `pcm_24000` | `audio/pcm` (no rate params) | 192,000 B = 4.000 s | s16le mono |
| `pcm_16000` | `audio/pcm` | 128,000 B = 4.000 s | s16le mono |
| `pcm_44100` | `audio/pcm` | 319,488 B = 3.622 s | Pro+ format, succeeded on our key |
| `opus_48000_64` | `audio/ogg` | 32,718 B / 3.72 s | Ogg container; evidence for the later codec-enum work |

Endianness check on `pcm_24000`: little-endian decode gives RMS 3,338 / peak 24,491 / 11,773 zero crossings; big-endian gives RMS 16,917 / peak 32,768 / 36,285 zero crossings (full-scale noise). PCM is **16-bit signed little-endian, 1 channel**.

`TTSPcmParameters` must be derived from the effective `output_format`: `pcm_<rate>` gives `sampleRate = rate`, `channels = 1`. Do not pin a constant, because same-codec passthrough can change the rate.

### Supported formats decision

Register `elevenlabs` in `TTS_ADAPTER_SUPPORTED_FORMATS` with `['mp3', 'pcm']`.

## Pricing

### Dimension and rate [doc]

Source: <https://elevenlabs.io/pricing/api>, re-checked 2026-09-29 (first checked 2026-09-24). Per 1K characters, text-to-speech section:

| Model family | List price (2026-09-29) | Per character | List price seen 2026-09-24 |
| --- | --- | --- | --- |
| v4 (`eleven_v4`) | $0.08 / 1K | $0.00008 | not listed |
| v4 Turbo (`eleven_v4_turbo`) | $0.04 / 1K | $0.00004 | not listed |
| v3 (`eleven_v3`) | $0.08 / 1K | $0.00008 | $0.10 / 1K |
| v2 Multilingual (`eleven_multilingual_v2`) | $0.08 / 1K | $0.00008 | $0.10 / 1K |
| Flash / Turbo (`eleven_flash_v2_5`, `eleven_turbo_v2_5`) | $0.04 / 1K | $0.00004 | $0.05 / 1K |
| v3 Conversational | $0.04 / 1K | not in first pass | $0.05 / 1K |

On 2026-09-29 the page also advertised a launch promotion, "72% off until October 12": v4 $0.022 / 1K and v4 Turbo $0.011 / 1K. That is time-boxed and is not an endpoint rate. The 2026-09-24 numbers are kept for provenance because the billing-reconciliation math below was done against them; the dollar checks hold at either rate since the per-model ratio (v3 / v2 = 2× Flash / Turbo, v4 = 2× v4 Turbo) is unchanged.

The OpenRouter contract rate is an ops input on the endpoint pricing row, not something this note can verify. The list price above is the public floor.

### Billable-character definition [live][measured]

`character-cost` response header versus local counts of `text`:

| Text | Model | UTF-16 units (`input.length`) | Code points | UTF-8 bytes | `character-cost` |
| --- | --- | --- | --- | --- | --- |
| `Hello from OpenRouter. This is a short synthesis check.` | v3 | 55 | 55 | 55 | 55 |
| same | Multilingual v2 | 55 | 55 | 55 | 55 |
| same | Flash v2.5 | 55 | 55 | 55 | **28** |
| `こんにちは世界 🎉 你好` | Multilingual v2 | 13 | 12 | 33 | **12** |
| `こんにちは世界 🎉 你好` | Flash v2.5 | 13 | 12 | 33 | **6** |
| `ab🎉🎉cd` | Multilingual v2 | 8 | 6 | 12 | **6** |
| `🎉🎉🎉` | Multilingual v2 | 6 | 3 | 12 | **3** |
| `Hello 🎉 world` | v3 | 14 | 13 | 16 | **13** |
| `Call 555-0100 at 3pm on 12/25.` | Flash v2.5 | 30 | 30 | 30 | 15 |
| `Bonjour tout le monde.` | Flash v2.5 | 22 | 22 | 22 | 11 |
| `Bonjour tout le monde.` | Multilingual v2 | 22 | 22 | 22 | 22 |
| 5,100 × `a` | v3 | 5,100 | 5,100 | 5,100 | 5,100 |
| `   ` (3 spaces) | Multilingual v2 | 3 | 3 | 3 | 1 |

Conclusions:

- The unit is **Unicode code points** of the submitted `text` (every astral character counts once). `input.length` over-counts by one per surrogate pair; UTF-8 bytes over-count heavily on CJK.
- Flash v2.5 reports **half** the code-point count (`ceil(n / 2)`: 55 → 28, 30 → 15, 22 → 11, 12 → 6). This is ElevenLabs expressing its 0.5-credit-per-character Flash pricing in the header. In dollar terms it is identical to billing full code points at $0.05 / 1K, so the adapter should **not** halve the count; the per-model endpoint rate carries the difference.
- Whitespace-only and empty input bill 1 on `eleven_multilingual_v2` and 0 on the half-credit models (`eleven_flash_v2_5`, `eleven_turbo_v2_5`, `eleven_turbo_v2`, `eleven_flash_v2`), which is the same one-character floor after round-half-even halving [live, 2026-09-30 probe across all nine models]. `eleven_v3`, `eleven_v3_conversational`, `eleven_v4` and `eleven_v4_turbo` reject it with 400 `input_text_empty` instead. The adapter bills a floor of 1 character on every successful request; the resulting $0.00004 on a half-credit model is the same half-credit rounding gap as any odd-length request and is not modelled separately.

### Request-level pricing modifiers [doc][live]

| Modifier | Effect on price | Decision |
| --- | --- | --- |
| `output_format` (any value incl. `mp3_44100_192`, `pcm_44100`, `opus_*`) | none; `character-cost` was 55 for every format tried | no SKU |
| `voice_settings.*`, `speed` | none | no SKU |
| `language_code`, `seed`, `previous_text`/`next_text`, `apply_text_normalization` | none observed | no SKU |
| `enable_logging=false` | none (55) | no SKU |
| `/with-timestamps` | none observed (11 for `Hello world`) | out of scope |
| Model | per-model rate (v3 / v2 / v4 = 2× Flash / Turbo / v4 Turbo) | separate endpoint rows |

No minimums beyond the 1-character floor (which the half-credit models report as `character-cost: 0`), no voice premiums on premade voices, and no per-request surcharges were observed.

### Generic vs custom SKU decision

Use the generic `TTSSKU.Characters` (`tts:characters`) with the standard `TTSPricingStrategy`, but override `getUsage()` in the adapter to count **Unicode code points** rather than `input.length`, mirroring `packages/tts/adapters/together/index.ts`, which already bills per code point through `countTTSInputCharacters`. Endpoint pricing rows carry the per-model per-character rate. No new pricing strategy or SKU is required.

## Capture matrix

All captures were made with `/home/ubuntu/el-research/capture.sh` (local scratch, not committed), which writes status / headers / body and redacts the key. Raw audio is not committed; committed fixtures record byte length and headers. Statuses and `character-cost` values as returned.

| # | Scenario | Model | Status | `character-cost` | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | mp3_44100_128 baseline | v3 | 200 | 55 | `fixtures/baseline-mp3.*`, 58,057 B, ffprobe mp3 44.1 kHz mono 3.63 s |
| 2 | pcm_24000 | v3 | 200 | 55 | `fixtures/pcm.*`, 192,000 B = 4.000 s s16le |
| 3 | Alternate voice (Sarah) | Multilingual v2 | 200 | 55 | distinct audio from #1 |
| 4 | speed 1.2 | Multilingual v2 | 200 | 55 | `fixtures/alt-voice-speed.*` |
| 5 | Unknown voice id | v3 | 404 | – | `fixtures/error-404-voice.response.json`, `voice_not_found` |
| 6 | Bad API key | v3 | 401 | – | `fixtures/error-401-auth.response.json`, `invalid_api_key` |
| 7 | Multibyte `こんにちは世界 🎉 你好` | Multilingual v2 | 200 | 12 | `fixtures/multibyte.*` |
| 8 | mp3_44100_192 (Creator+) | v3 | 200 | 55 | 87,188 B |
| 9 | pcm_44100 (Pro+) | v3 | 200 | 55 | 319,488 B = 3.622 s |
| 10 | `/with-timestamps` | v3 | 200 | 11 | `fixtures/with-timestamps.response.json` (audio redacted) |
| 11 | `output_format=mp3_99999_1` | v3 | 403 | – | `fixtures/error-403-output-format.response.json`, lists 29 valid values |
| 12 | 5,100 chars | v3 | 200 | 5,100 | within the 10% allowance over the documented limit |
| 13 | `enable_logging=false` | v3 | 200 | 55 | `history-item-id: not_stored` |
| 14 | `apply_text_normalization=on` | Flash v2.5 | 200 | 15 | Enterprise-only per docs; succeeded |
| 15 | `optimize_streaming_latency=3` (deprecated) | Multilingual v2 | 200 | 55 | still accepted |
| 17 | pcm_16000 | v3 | 200 | 55 | 128,000 B = 4.000 s |
| 18 | Empty text | v3 | 400 | – | `fixtures/error-400-empty-text.response.json`, `input_text_empty` |
| 19 | speed 2.0 | Multilingual v2 | 400 | – | `fixtures/error-400-speed.response.json`, bounds 0.7..1.2 |
| 20 | speed 1.2 | v3 | 200 | 55 | speed works on v3 |
| 21 | `model_id=eleven_not_a_model` | – | 400 | – | `fixtures/error-400-model.response.json`, `model_not_found` |
| 22 | opus_48000_64 | v3 | 200 | 55 | `audio/ogg`, `OggS` |
| 23 | mp3 baseline | Flash v2.5 | 200 | 28 | `fixtures/flash-mp3.*`, half-credit |
| 24 | `language_code=fr` | Flash v2.5 | 200 | 11 | honored |
| 25 | `language_code=fr` | Multilingual v2 | 200 | 22 | ignored, no error |
| 26 | `ab🎉🎉cd` | Multilingual v2 | 200 | 6 | code points |
| 27 | `🎉🎉🎉` | Multilingual v2 | 200 | 3 | code points |
| 28 | `Hello 🎉 world` | v3 | 200 | 13 | code points |
| 29 | Multibyte | Flash v2.5 | 200 | 6 | half of 12 |
| 30 | Unknown body field | Multilingual v2 | 200 | 55 | ignored |
| 31 | `seed` + `previous_text` | Multilingual v2 | 200 | 55 | accepted |
| 32 | pcm_24000 | Multilingual v2 | 200 | 55 | 171,642 B |
| 33 | pcm_24000 | Flash v2.5 | 200 | 28 | works on Flash |
| 34 | speed 0.7 | Multilingual v2 | 200 | 55 | lower bound inclusive |
| 35 | speed 0.69 | Multilingual v2 | 400 | – | `invalid_voice_settings` |
| 36 | `voice_settings.style=0.5` | v3 | 200 | 55 | ignored despite `can_use_style: false` |
| 37 | Whitespace-only text | Multilingual v2 | 200 | 1 | 1-character floor |

Capture #16 (v3 `stability: 0.7`) was skipped by the script because of a file-name issue and is not part of the evidence; the docs state v3 only accepts 0.0 / 0.5 / 1.0.

2026-09-29 pass (`/home/ubuntu/el-capture/capture.sh`, same 55-character text and voice as #1 unless noted):

| # | Scenario | Model | Status | `character-cost` | Evidence |
| --- | --- | --- | --- | --- | --- |
| 38 | mp3_44100_128 baseline | v4 | 200 | 55 | `fixtures/v4-mp3.*`, 66,499 B, 4.13 s, `tts-latency-ms: 1352` |
| 39 | mp3_44100_128 baseline | v4 Turbo | 200 | 28 | `fixtures/v4-turbo-mp3.*`, 65,245 B, 4.05 s, `tts-latency-ms: 164` |
| 40 | pcm_24000 | v4 | 200 | 55 | 192,000 B = 4.000 s s16le |
| 41 | speed 0.7 | v4 | 200 | 55 | `fixtures/v4-speed-ignored.*`, identical 66,499 B / 4.13 s to #38 |
| 42 | speed 0.7 | v4 Turbo | 200 | 28 | same duration as default |
| 43 | speed 2.0 (out of documented range) | v4 | 200 | 55 | accepted, same duration; range is not checked on v4 |
| 44 | speed 0.7, `seed: 42` vs default `seed: 42` | v3 | 200 | 55 | both 3.97 s: speed also ignored on v3 |
| 45 | speed 0.7, `seed: 42` vs default `seed: 42` | Multilingual v2 | 200 | 55 | 3.53 s → 5.02 s: speed honored |
| 46 | `voice_settings.style=0.5` | v4 | 200 | 55 | ignored despite `can_use_style: false` |
| 47 | `stability: 0.5, similarity_boost: 0.8` | v4 | 200 | 55 | accepted |
| 48 | Audio tags `[whispering]` … `[laughing]` in `text` | v4 | 200 | 79 | tags billed as characters |
| 49 | Multibyte `こんにちは世界 🎉 你好` | v4 | 200 | 12 | code points |
| 50 | `apply_language_text_normalization: true` | v4 | 400 | – | `fixtures/error-400-v4-language-normalization.response.json`, `unsupported_model` |
| 51 | `language_code=en` | v4 | 200 | 55 | accepted |
| 52 | `apply_text_normalization=on` | v4 | 200 | 55 | accepted |
| 53 | Empty text | v4 | 400 | – | `input_text_empty`, dialogue-style message "Input at position 0 has empty text" |

## Billing reconciliation

Expected cost = code points × list rate. Provider-reported = `character-cost` × per-credit rate (1 credit = 1 character at the model's list rate; Flash reports half credits at the v2 rate, which is the same dollar amount).

| Capture | Model | Code points | Expected (list) | `character-cost` | Provider-implied | Match |
| --- | --- | --- | --- | --- | --- | --- |
| #1 | v3 | 55 | 55 × $0.0001 = $0.0055 | 55 | $0.0055 | yes |
| #7 | Multilingual v2 | 12 | $0.0012 | 12 | $0.0012 | yes (UTF-16 would say 13) |
| #23 | Flash v2.5 | 55 | 55 × $0.00005 = $0.00275 | 28 | 28 × $0.0001 = $0.0028 | yes within ElevenLabs' `ceil(n/2)` rounding |
| #12 | v3 | 5,100 | $0.51 | 5,100 | $0.51 | yes |
| #38 | v4 | 55 | 55 × $0.00008 = $0.0044 | 55 | $0.0044 | yes (2026-09-29 list rate) |
| #39 | v4 Turbo | 55 | 55 × $0.00004 = $0.0022 | 28 | 28 × $0.00008 = $0.00224 | yes within `ceil(n/2)` rounding |

The dashboard-side check (account usage page) was not possible because the key lacks `user_read`; the `character-cost` header is the provider-reported figure used here.

## Error envelope

All errors are JSON `{"detail": {...}}`. Observed shapes:

| Status | `detail.status` | `detail.code` | Maps to OpenRouter |
| --- | --- | --- | --- |
| 400 | `invalid_voice_settings` | `invalid_voice_settings` | 400 (caller error, message passthrough) |
| 400 | `input_text_empty` | `invalid_parameters` | 400 |
| 400 | `model_not_found` | – (no `type`/`code`) | 502 (misconfigured endpoint) |
| 401 | `invalid_api_key` | `unauthorized` | 502 on managed keys, 401 on BYOK |
| 403 | `invalid_output_format` | `invalid_output_format` | 400 (also hit when a BYOK account lacks the tier for the format) |
| 404 | `voice_not_found` | `voice_not_found` | 400 (`voice` is caller input) |

Also expected per docs but not captured: 429 with `too_many_concurrent_requests` / `system_busy`, and 402 for exhausted quota.

## Shape-affecting and billing-affecting request arguments

| Argument | Response shape | Billing | Notes |
| --- | --- | --- | --- |
| `output_format` | yes (codec, rate, Content-Type) | no | adapter-owned; drives `TTSPcmParameters` |
| `text` | no | yes (code points) | canonical |
| `model_id` | no | yes (per-model rate) | canonical via endpoint |
| `voice_settings.*`, `speed` | no | no | canonical speed + passthrough; `speed` rejected/stripped on v4 models |
| `language_code`, `seed`, `previous_text`, `next_text`, normalization flags | no | no | passthrough |
| `enable_logging` | no | no | adapter-owned (ZDR) |
| `pronunciation_dictionary_locators` | no | no | passthrough, BYOK-effective |
| `previous_request_ids` / `next_request_ids` | no | no | blocked, deferred |

## Open questions (human checkpoint)

1. **Contract rate.** List price is $0.10 / 1K (v3, v2) and $0.05 / 1K (Flash). The negotiated Enterprise rate is an ops input on the endpoint row; nothing in this note depends on it.
2. **ZDR key mapping.** `enable_logging=false` succeeded on our key and returned `history-item-id: not_stored`. Whether the managed endpoint always sends `false`, or only on a ZDR endpoint row, is a policy decision pending ElevenLabs confirmation (Jarrel is confirming). The adapter derives it from the endpoint, never from the caller.
3. **Local text limits.** Upstream enforces the documented limits with a 10% allowance (5,500 accepted, 5,501 rejected on a 5,000 model). We enforce `floor(documented × 1.1)` locally so the accept/reject boundary matches a direct request; confirm this is preferred over forwarding and letting ElevenLabs decide.
4. **Format list drift.** Docs list 28 output formats; the live error lists 29. Only the `mp3_*` / `pcm_*` families matter for this pass, and those agree.
5. **Tier of the OpenRouter key.** Not verifiable via API (`user_read` missing). Every tier-gated feature tried (`mp3_44100_192`, `pcm_44100`, `enable_logging=false`, Flash normalization `on`) succeeded, consistent with Enterprise. Managed-key policy still restricts `mp3_44100_192` / `pcm_44100` overrides to BYOK per the first-pass decision.
6. **Speed on `eleven_v3`.** Capture #44 shows `speed: 0.7` produces the same 3.97 s clip as the default on v3 (`seed: 42`), i.e. v3 ignores it the way v4 does, while the first pass only checked for a 200. The v4 models now reject a non-default speed; v3 still forwards it. Decide whether v3 should join `ELEVENLABS_SPEED_UNSUPPORTED_MODELS`.
7. **v4 pricing window.** List is $0.08 / $0.04 per 1K; the 72%-off promotion ($0.022 / $0.011) ends October 12 per the pricing page. Endpoint rows should carry the list rate unless ops decides otherwise.
