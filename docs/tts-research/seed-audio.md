# Seed Audio 1.0 (BytePlus Seed Speech) TTS Research

Last updated: 2026-09-18
Researcher: devin-c491fd6a2f044edebbf9017578f4558a (mindi.weik)

Live captures were run 2026-09-18 against `https://voice.ap-southeast-1.bytepluses.com` with the dev `BYTEPLUS_SPEECH_API_KEY` (Infisical `/services/cfw-api`). Sanitized request/response pairs live in `packages/tts/adapters/seed-audio/fixtures/`. Audio bytes were decoded and probed locally with `file` and `ffprobe` and are not committed.

## Summary + doc links

- Provider: BytePlus Seed Speech, served under the existing `Seed` provider row. The `Seed` provider config has no TTS adapter of its own (`getTTSAdapterName` has no `Seed` case and would fall through to `OpenAITTSAdapter`), so the endpoint row sets `provider_overrides.adapterName` to the Seed Audio adapter name. `initEndpointFromDB` spreads `provider_overrides` over the provider config into `providerInfo`, and `getTTSAdapterName` returns `providerInfo.adapterName` when it is a `TTSAdapterName` member, so the override selects the adapter for this endpoint only and leaves the ModelArk LLM endpoints on the `Seed` row untouched. The adapter layer adds the `TTSAdapterName` member and factory case. This is a different product, host, and credential from BytePlus ModelArk (`ark.ap-southeast.bytepluses.com`, `BYTEPLUS_API_KEY`). The ModelArk key is rejected by Seed Speech with `401 Invalid X-Api-Key`.
- Model: `seed-audio-1.0` (OpenRouter slug `bytedance-seed/seed-audio-1-0`). Metadata entry: https://byteplus.gopomelo.com/byteplus/metadata/v1/models (`unit_price 0.0025 / second`, modalities text+image+audio → audio, datacenter `MY`).
- Lane onboarded: sync REST `POST /api/v3/tts/create`, JSON response carrying base64 audio, whole-file consumption.
- Docs:
  - API reference: https://docs.byteplus.com/en/docs/byteplusvoice/seedaudio-01 (page dated 2026-08-06)
  - Pricing: BytePlus Seed Speech → Pricing → Audio 1.0 (page dated 2026-07-14), also https://www.byteplus.com/en/pricing
  - Voice list: BytePlus Seed Speech → Text-to-Speech → TTS 2.0 → Voice List (177 `*_bigtts` speaker IDs at capture time)
  - Console activation: https://console.byteplus.com/voice/new/setting/activate?projectName=default
  - Console API keys: https://console.byteplus.com/voice/new/setting/apikeys?projectName=default
- Added under ECO-4109: up to three `input_audio` reference clips mapped positionally to `audio_data`, `@Audio1..3` placeholders validated against the clip count, one `image_url` reference mapped to `image_data`, and remote `input_audio` / `image_url` URLs fetched and inlined by OpenRouter so Seed never receives a caller URL. Seed 400 `message` text is forwarded to callers only for the input-rejection codes listed in the error table, after runtime validation, base64 redaction, and the shared provider-error sanitizer (trailing request IDs stripped, 200-character bound).
- Still deferred: `enable_subtitle` word timestamps (the TTS API has no response field to carry them), `loudness_rate`, `pitch_rate`, and the top-level `watermark` object. The adapter blocks these in passthrough rather than forwarding them.

## Request surface

- URL: `POST {baseUrl}/api/v3/tts/create` where `baseUrl` is `https://voice.ap-southeast-1.bytepluses.com`. The adapter must build the URL from `endpoint.provider_info.baseUrl`, not a hardcoded host.
- Auth: `X-Api-Key: <key>`. Bearer auth is not accepted. `BaseTTSAdapter.getHeaders()` must be overridden.
- Optional header `X-Api-Request-Id` is echoed back as `x-api-request-id` (verified with `or-research-baseline-0001`). It only reflects what the caller sent, so the adapter does not send or read it. The provider-generated trace ID is `x-tt-logid`. The shared `readUpstreamRequestId` helper (`packages/helpers/upstream-request-id.ts`) reads `request-id`, `x-request-id`, `x-amzn-requestid`, and `apim-request-id` only, so the adapter layer must add `x-tt-logid` to its header list or no upstream request ID is captured.
- Body (JSON):
  - `model` (required): `seed-audio-1.0`, from `endpoint.provider_model_id`.
  - `text_prompt` (required, max 3000 chars): from `request.input`. It is a prompt, not only text to speak. Non-speech prompts work (see `sound-effect-prompt`).
  - `references[]` (optional, max 3 audio or 1 image): each item is exactly one of `speaker` (TTS 2.0 speaker ID), `audio_data` (base64), `audio_url`, `image_data`, `image_url`. Audio and image references cannot be mixed.
  - `audio_config.format`: `wav` | `mp3` | `pcm` | `ogg_opus`, default `wav`.
  - `audio_config.sample_rate`: 8000 | 16000 | 24000 | 32000 | 44100 | 48000. Default 40000 for wav/pcm and 44100 for mp3.
  - `audio_config.speech_rate`: int, documented range -50..100 (100 = 2.0x, -50 = 0.5x), default 0.
  - `audio_config.loudness_rate`: int -50..100. `audio_config.pitch_rate`: int -12..12. `audio_config.enable_subtitle`: bool. All three are deferred (see above).
  - `watermark` (top level, optional): `aigc_watermark` (bool, appends an audible rhythm marker to the end of the output) and `aigc_metadata` (`enable`, `content_producer`, `produce_id`, `content_propagator`, `propagate_id`, written into the file header). Captured with `aigc_watermark: true` (see `watermark` row): 200, `duration 4.04` against `original_duration 3.2`, so the marker lengthens the file without changing the billing basis. Deferred and blocked in passthrough. The OpenRouter contract has no place to declare it and it changes the bytes the caller receives.
- Model/voice mapping:
  - `request.voice` → `references[0].speaker`. Optional. With no reference at all, Seed infers a voice from the prompt.
  - one decoded `input_references` audio clip → `references[0].audio_data`.
  - `voice` plus a clip in one request is an OpenRouter decision, not a provider constraint. Seed accepts `references: [{speaker}, {audio_data}]` in one request (see `speaker-plus-audio` row: 200, 6.5 s) and the docs do not say which reference wins. The adapter rejects the combination with a 400 because the public contract cannot express which one the caller meant, and forwarding it would bill a clip the caller may not have wanted applied. Revisit with the multi-reference work in ECO-4109.
  - `request.speed` (0.5..2.0) → `speech_rate = round((speed - 1) * 100)`, which lands exactly on Seed's documented -50..100 (0.5x..2.0x). Outside 0.5..2.0 is a 400 at the adapter.
  - `request.response_format` → `audio_config.format` (see Audio output for what we expose).
- Provider-side validation is permissive. Undocumented `format: flac` (200, playable FLAC), `sample_rate: 12345` (200), `speech_rate: 500` (200), and unknown fields at both top level and inside `audio_config` (200) were all accepted. The adapter enforces the OpenRouter contract itself and blocks passthrough of `model`, `text_prompt`, `references`, `audio_config`, `watermark`, and auth.
- Latency: 12 to 60 s per request for 3 to 24 s of audio (`server-timing: inner; dur=11333` on the baseline). One `wav` request took 60 s. There is no streaming variant on this endpoint.
- No rate-limit headers were observed. Response headers of note: `x-tt-logid`, `x-api-status-code` (`20000000` on success), `x-api-message`, `x-api-request-id`.

## Reference audio (voice cloning)

- Docs claim `audio_data` accepts base64 of wav/mp3/pcm/ogg_opus, up to 30 s and 10 MB per clip. Captures disagree on the duration limit and refine the size limit:
  - A 34.5 s, 3.3 MB WAV clip (24 kHz stereo 16-bit) was accepted (200, 6.744225 s output, see `reference-audio-oversize-duration`). The 30 s limit is not enforced by the API, or not at that length.
  - A 27.6 s, 10.6 MB WAV clip (96 kHz stereo 16-bit, 14,131,336 base64 chars) was rejected with `400 {"code":45001001,"message":"audio reference size %!f(int=00)MB exceeds maximum of 10.11MB%!(EXTRA float64=10)"}` (see `reference-audio-oversize-bytes`). The limit is enforced on decoded bytes, at roughly 10 MB, and the message has a provider-side format-string defect.
  - Our request schema caps a reference at `MAX_REF_AUDIO_BASE64_LENGTH` (20 MiB of base64, about 15 MB decoded), so a 10 to 15 MB clip passes our check and reaches Seed. The adapter does not enforce the 10 MB limit itself. Seed's `400 45001001` flows through the ordinary 400 path so the caller sees the provider's message, and nothing is billed because the error response carries no `original_duration`.
- A 6.9 s 24 kHz stereo 16-bit WAV clip cloned successfully both with an `@Audio1` placeholder in the prompt and without any placeholder (200, 6.65 s and 6.9 s outputs). The placeholder is optional for a single clip.
- The same content as MP3 was rejected upstream with `500 {"code":55001310,"message":"audio risk audit tts_create_output: chunk 0 rejected (decision_in_reject_list)"}`. This is a content audit on the output, not a schema error. The adapter maps `55001310` to a 4xx so it is not retried as a provider outage.
- `audio_url` pointing at `http://127.0.0.1:1/private.wav` returned `400 {"code":45001131,"message":"download audio error ... the request address is forbidden"}`. Seed blocks loopback itself, but we do not forward caller URLs in this stack.

## Multi-clip and image references (captured 2026-09-23)

- Two `audio_data` clips with `@Audio1` and `@Audio2` in the prompt synthesized both segments (200, 8.3 s). The same two clips with no placeholders also returned 200 (9.38 s), and one clip with `@Audio1` and `@Audio2` in the prompt returned 200 (4.08 s) with no error for the unbacked placeholder. Seed does not validate placeholders, so the adapter does. With more than one clip every clip must be addressed and every placeholder must point at a supplied clip. A single clip may omit the placeholder.
- One `image_data` reference synthesized with JPEG, PNG, and WebP (200, 3.31 s, 6.08 s, 3.51 s). WebP took 38 s against 14 s for the other two.
- Two `image_data` references were rejected with `400 {"code":45001001,"message":"at most one image reference is supported"}`. An image plus an audio clip was rejected with `400 {"code":45001001,"message":"image reference cannot be mixed with audio or video references"}`. The request schema enforces both before the adapter runs.
- An `@Audio1` placeholder with an image reference or with a `speaker` reference returned 200, so Seed ignores placeholders that have no clip. The adapter rejects placeholders in those requests because the ordinal has nothing to point at.
- A 64 x 64 PNG was rejected with `402 {"code":40000020,"message":"InvalidPayload:ImageSizeOutOfRange"}`, the same code and status as `DurationOutOfRange`. The accepted images were 768 px. The minimum dimension is undocumented. The adapter maps both `InvalidPayload` messages to 400 on the message text.

## Audio output

The response is JSON, not raw audio. `audio` is a base64 string of the encoded file. `url` is a signed temporary link (about 2 h). The adapter decodes `audio` and returns raw bytes with the OpenRouter content type.

| `format` | Observed bytes | Notes |
| --- | --- | --- |
| `mp3` | ID3v2.4 + MPEG layer III, 44.1 kHz stereo (default), 24 kHz stereo when `sample_rate: 24000` | exposed as `mp3` → `audio/mpeg` |
| `pcm` | headerless s16le stereo. 6.5 s @ 24 kHz = 624,000 B, 3.2 s @ 16 kHz = 204,800 B, 3.2 s @ 40 kHz default = 512,000 B. `channel: 1` in the request was ignored (430,984 B for 4.49 s = stereo) | exposed as `pcm` with pinned `sample_rate: 24000`, stereo, 16-bit → `audio/pcm;rate=24000;channels=2` |
| `wav` | RIFF 16-bit stereo, 24 kHz or 40 kHz default | not exposed (not in `TTSResponseFormat`) |
| `ogg_opus` | Ogg **Vorbis**, stereo 48 kHz | not exposed. Would be mislabeled as Opus |
| `flac` (undocumented) | FLAC 16-bit stereo | not exposed |

`duration` and `original_duration` are seconds as floats. They are equal unless `speech_rate` is set, in which case `duration` reflects the post-processed length and `original_duration` stays at the pre-speed length.

## Pricing

- Source: BytePlus Seed Speech pricing page, Audio 1.0, dated 2026-07-14. Text: "Audio is charged by the length of generated audio, the accuracy is second." Table: pay-as-you-go 0.15 USD / minute. Note on the page: "0.15 USD/min = 0.0025 USD/second, and Audio 1.0 pricing unit is USD/second." The gopomelo metadata entry agrees (`unit_price 0.0025 / second`).
- Billing basis: `original_duration` (documented as the billed length, unaffected by `speech_rate` in captures).
- Billing floor: none found. A 1.88 s output reported `original_duration 1.88`, a 3.2 s output reported 3.2, fractional values (`3.587925`, `6.6486`) are reported as-is. Whether BytePlus rounds up to whole seconds on their invoice is unverified (open question).
- Request modifiers: none found. `speech_rate`, `sample_rate`, format, and reference audio did not change the rate. Pre-paid minute packages are BytePlus-account-level and do not affect the per-second SKU.
- Free tier: 60 min free trial on activation (pricing page). Our dev key appears to be on this trial, so prod cost reconciliation must be checked once the prod key is live.
- OpenRouter SKU: `seed_audio_tts:output_seconds` at `$0.0025` per second, displayed as `$0.15 / minute`. Pricing strategy `SeedAudioTTS` in `packages/pricing/strategies/seed-audio-tts/`.
- Preauthorization: output length is unknown until the response, so `estimateTTSCostDollars` preauthorizes the documented 120 s maximum (`$0.30`) for this strategy. The provider-reported `original_duration` supersedes the estimate through the last-write-wins SKU reducer.

## Capture matrix (live, 2026-09-18)

All requests `POST /api/v3/tts/create` with `model: seed-audio-1.0`. Durations are provider `original_duration` / `duration` in seconds.

| Scenario | Request delta | Status | Evidence |
| --- | --- | --- | --- |
| baseline-mp3 | 58-char English, `format: mp3` | 200 | 6.08 / 6.08, 131,576 B base64 → MP3 44.1 kHz stereo, ffprobe 6.14 s, playable |
| mp3-24k | `sample_rate: 24000` | 200 | 3.2 / 3.2, MP3 24 kHz stereo |
| pcm | `format: pcm, sample_rate: 24000` | 200 | 6.5 / 6.5, 624,000 B = 6.5 × 24,000 × 2 ch × 2 B, byte-exact stereo s16le |
| pcm-16k | `sample_rate: 16000` | 200 | 3.2 / 3.2, 204,800 B = 3.2 × 16,000 × 4 |
| pcm-default-rate | no `sample_rate` | 200 | 3.2 / 3.2, 512,000 B = 3.2 × 40,000 × 4 (default 40 kHz confirmed) |
| pcm-mono-request | `channel: 1` (undocumented) | 200 | 4.4894 / 4.4894, 430,984 B ≈ stereo, mono ignored |
| wav | `format: wav, sample_rate: 24000` | 200 | 6.9 / 6.9, RIFF 16-bit stereo 24 kHz |
| wav-default-rate | `format: wav` | 200 | 3.2 / 3.2, RIFF 16-bit stereo 40 kHz, 60 s latency |
| ogg-opus | `format: ogg_opus` | 200 | 6.08 / 6.08, Ogg Vorbis 48 kHz stereo (not Opus) |
| bad-format | `format: flac` | 200 | 1.88 / 1.88, playable FLAC. Provider does not validate format |
| bad-sample-rate | `format: pcm, sample_rate: 12345` | 200 | 3.2 / 3.2, 158,016 B ≈ 3.2 × 12,345 × 4. Provider does not validate rate |
| speaker-tts2 | `references: [{speaker: en_female_dacey_uranus_bigtts}]` | 200 | 3.587925 / 3.587925, audibly different voice |
| speed-ratio | `speech_rate: 50` | 200 | 6.08 / 4.0448. Billing basis unchanged, output shortened |
| speed-ratio-negative | `speech_rate: -50` | 200 | 6.5 / 12.9256. Billing basis unchanged, output lengthened |
| speed-ratio-out-of-range | `speech_rate: 500` | 200 | 3.2 / 1.5872. Accepted, but the speed effect is clamped to 2.0x (the `speech_rate: 100` ceiling). A linear 6.0x would give about 0.53 s |
| subtitle-enabled | `enable_subtitle: true` | 200 | 4 / 4, `subtitle.sentences[].words[]` with ms timestamps |
| unknown-field | `bogus_top`, `audio_config.bogus_field` | 200 | 3.2 / 3.2, unknown fields ignored |
| cjk-emoji | `你好，这是一个多字节测试。🎧 日本語も少し。` (22 chars) | 200 | 5 / 5, playable MP3 |
| sound-effect-prompt | "Heavy rain falling on a tin roof with distant thunder, no speech." | 200 | 23.5 / 23.5, non-speech audio |
| reference-audio-wav | `@Audio1 ...` + `audio_data` (6.9 s WAV) | 200 | 6.6486 / 6.6486, cloned voice |
| reference-audio-no-placeholder | `audio_data` only, no `@Audio1` | 200 | 6.9 / 6.9, cloned voice |
| reference-audio | `audio_data` (same clip as MP3) | 500 | `{"code":55001310,"message":"audio risk audit tts_create_output: chunk 0 rejected (decision_in_reject_list)"}` |
| reference-audio-url | `audio_url: http://127.0.0.1:1/private.wav` | 400 | `{"code":45001131,"message":"download audio error ... the request address is forbidden"}` |
| bad-speaker | `speaker: not_a_real_speaker_id` | 400 | `{"code":45001115,"message":"speaker not_a_real_speaker_id not found in speaker_map, speaker_audio, or mega_info"}` |
| empty-text | `text_prompt: ""` | 400 | `{"code":45001116,"message":"text_prompt is required"}` |
| oversize-text | 3410 chars | 400 | `{"code":45001116,"message":"text_prompt length 3410 exceeds maximum of 3000"}` |
| cjk-2500-chars | 2500 CJK chars | 402 | `{"code":40000020,"message":"InvalidPayload:DurationOutOfRange"}` after 24 s. Output would exceed 120 s |
| speaker-plus-audio | `references: [{speaker: en_female_dacey_uranus_bigtts}, {audio_data: 6.9 s WAV}]` | 200 | 6.5 / 6.5. Seed accepts both. Which reference won is not audible from one sample and is undocumented |
| reference-audio-oversize-duration | `audio_data` 34.5 s 3.3 MB WAV | 200 | 6.744225 / 6.744225. Documented 30 s clip limit not enforced |
| reference-audio-oversize-bytes | `audio_data` 27.6 s 10.6 MB WAV | 400 | `{"code":45001001,"message":"audio reference size %!f(int=00)MB exceeds maximum of 10.11MB%!(EXTRA float64=10)"}`. Roughly 10 MB decoded limit enforced |
| watermark | top-level `watermark: {aigc_watermark: true}` | 200 | 3.2 / 4.04. Marker adds 0.84 s to `duration`, `original_duration` unchanged |
| bad-model | `model: seed-audio-9.9` | 403 | `{"code":45000030,"message":"extract request resource id: fail to convert model to resource_id"}` |
| bad-auth | wrong `X-Api-Key` | 401 | `{"code":45000010,"message":"Invalid X-Api-Key"}` |
| bad-json | malformed body | 400 | `{"code":45000000,"message":"invalid character 'o' in literal null (expecting 'u')"}` |
| multi-reference-audio | `@Audio1 ... @Audio2 ...` + two `audio_data` clips (WAV, MP3) | 200 | 8.3 / 8.3, both voices present. 2026-09-23 |
| multi-reference-audio-no-placeholder | two `audio_data` clips, no placeholders | 200 | 9.38 / 9.38. 2026-09-23 |
| placeholder-without-clip | `@Audio1 ... @Audio2 ...` + one `audio_data` clip | 200 | 4.08 / 4.08. Unbacked placeholder not rejected by Seed. 2026-09-23 |
| reference-image-jpeg | one `image_data` (JPEG, 768 px) | 200 | 3.30545 / 3.30545. 2026-09-23 |
| reference-image-png | one `image_data` (PNG, 768 px) | 200 | 6.08 / 6.08. 2026-09-23 |
| reference-image-webp | one `image_data` (WebP, 768 px) | 200 | 3.511225 / 3.511225, 38 s latency. 2026-09-23 |
| reference-image-two | two `image_data` | 400 | `{"code":45001001,"message":"at most one image reference is supported"}`. 2026-09-23 |
| reference-image-mixed | `image_data` + `audio_data` | 400 | `{"code":45001001,"message":"image reference cannot be mixed with audio or video references"}`. 2026-09-23 |
| reference-image-placeholder | `@Audio1 ...` + one `image_data` | 200 | 6.08 / 6.08. Placeholder ignored. 2026-09-23 |
| speaker-placeholder | `@Audio1 ...` + `speaker` | 200 | 2.9778 / 2.9778. Placeholder ignored. 2026-09-23 |
| reference-image-size | one `image_data` (PNG, 64 x 64) | 402 | `{"code":40000020,"message":"InvalidPayload:ImageSizeOutOfRange"}`. 2026-09-23 |

## Error mapping

All errors are JSON `{code: number, message: string}` with `content-type: application/json`. HTTP status and `code` are both needed because Seed uses 402 and 500 for caller-side conditions.

| Seed | OpenRouter |
| --- | --- |
| 400 `45001115` bad speaker, `45001116` text empty or too long, `45001131` reference download, `45001001` reference clip over 10 MB, too many images, or image mixed with audio | 400 "Provider rejected the request: <Seed message>", message bounded to 200 chars with base64 runs redacted. Only these codes forward the message, since each one describes the caller's own input |
| 400 with any other code (for example `45000000` bad JSON) | 400 "Provider returned 400", message not forwarded |
| 402 `40000020` `DurationOutOfRange` | 400, "input exceeds the 120 second output limit". Not surfaced as 402 so it is not read as an OpenRouter balance error |
| 402 `40000020` `ImageSizeOutOfRange` | 400, reference image dimensions out of range |
| 500 `55001310` audio risk audit rejected | 400 with a content-moderation message. Not a provider outage, do not retry |
| 401 `45000010` | 502 provider auth error (our key), or 401 passthrough on BYOK |
| 403 `45000030` | 502 misconfigured `provider_model_id` |
| other 5xx | 502 |

## Billing reconciliation

Unit is provider `original_duration` seconds at `$0.0025/s`. Expected costs from captures:

| Scenario | `original_duration` (s) | rate | expected cost | measured (usage record) | delta |
| --- | --- | --- | --- | --- | --- |
| baseline-mp3 | 6.08 | $0.0025/s | $0.0152 | pending staging | |
| speed-ratio (`speech_rate: 50`, output 4.04 s) | 6.08 | $0.0025/s | $0.0152 | pending staging | |
| speaker-tts2 | 3.587925 | $0.0025/s | $0.00896981 | pending staging | |
| sound-effect-prompt | 23.5 | $0.0025/s | $0.05875 | pending staging | |
| preauth (120 s max) | 120 | $0.0025/s | $0.30 | n/a (estimate only) | |

No row is reconciled yet. Every measured cell stays `pending` until the endpoint is staged locally and a real usage record exists. Reconciliation is a launch gate (see Open questions): the measured column is filled in during `audio-e2e-testing` from the local usage record for each staged request, and the prod key's BytePlus invoice line is compared against the summed `original_duration` before unhide.

## Open questions (human checkpoint)

- Billing reconciliation is unmeasured. Whole-second rounding on the BytePlus invoice is unverified. Captures report fractional `original_duration` and we bill fractional. If BytePlus rounds up, our margin is negative on short clips by up to `$0.0025` per request.
- The 60 min free trial on the dev key means dev-side cost cannot be reconciled against a BytePlus invoice. Prod key reconciliation (invoice line versus summed `original_duration`) is a launch gate before unhide.
- Prod and Cloudflare sync of `BYTEPLUS_SPEECH_API_KEY` is pending (Mindi, 2026-09-18). Native smoke test with the prod key is required before unhide.
- Curated `supported_tts_voices` list for the endpoint: propose a small English subset of the TTS 2.0 `*_bigtts` speakers plus the no-voice default. Full list is 177 IDs.
- Whether to expose `wav` once `TTSResponseFormat` grows beyond `mp3` and `pcm` (platform question, not Seed-specific).
- Enterpret (2026-09-18): no customer signal on Seed Audio specifically. Related TTS signal in the last 30 days: a Zendesk ticket asking why OpenAI TTS models are missing from the directory (blocking an Azure migration), and a refund dispute where a user could not map billed usage to a small TTS input. Both support per-second billing being visible and legible on the model page.
