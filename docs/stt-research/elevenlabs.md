# ElevenLabs Scribe v2 STT Research

Last updated: 2026-09-29
Researcher: devin-7371632c30f7494e8bbae66aeb8412ed (will.kofski, jarrel)

Live captures run 2026-09-25 against `https://api.elevenlabs.io/v1/speech-to-text` with the dev `ELEVENLABS_API_KEY`. 58 scenarios returned a live response. Raw captures (request scripts, bodies, headers) are scratch artifacts in the session workspace and are not committed. Verbatim bodies for the scenarios the adapter tests need live in `packages/stt/adapters/elevenlabs/fixtures/` (see its README for the per-file description).

## Scope

- Lane being onboarded: batch (pre-recorded) transcription via `POST /v1/speech-to-text`, synchronous response only (no `webhook`).
- Primary model id: `scribe_v2`. `scribe_v2_medical` shares the endpoint, parameters, response shape, and price (verified live with `medical-baseline`, `medical-no-verbatim`) and can be staged as a second endpoint on the same adapter. `scribe_v1` and `scribe_v1_experimental` are accepted by the endpoint but not staged.
- Docs (all checked 2026-09-25):
  - Create transcript reference: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
  - Models overview (Scribe v2, Scribe v2 Medical): https://elevenlabs.io/docs/overview/models#scribe-v2
  - OpenAPI: https://api.elevenlabs.io/openapi.json (`SpeechToTextChunkResponseModel`, `SpeechToTextWordResponseModel`, `DetectedEntity`, `MultichannelSpeechToTextResponseModel`)
  - API pricing page: https://elevenlabs.io/pricing/api
- Explicitly deferred (per Jarrel, 2026-09-25, "Don't do provider_metadata"): any generic vendor-metadata slot on the OpenRouter response. Fields with no typed OpenRouter home are dropped and listed in "What we lose" below.
- Explicitly out of scope for this pass: `scribe_v2_realtime` (WebSocket), `webhook` / `webhook_id` / `webhook_metadata` (202 async flow), `additional_formats` (srt/vtt/docx exports), `cloud_storage_url` input (deprecated upstream; `source_url` is supported, see below), `use_multi_channel` / `multichannel_output_style`, `timestamps_granularity=character`, `token` query-string auth, regional hosts, and inline uploads above the OpenRouter 25 MB multipart cap (larger files go through `input_audio.url`).

## Model map

No STT model-listing endpoint. `model_id` is a free-form string validated server side. An unknown value (`scribe_v9`) or a TTS model id (`eleven_multilingual_v2`) returns 400 `detail.code: unsupported_model`, `detail.status: invalid_model_id`, and the message lists the accepted ids: `scribe_v1`, `scribe_v1_experimental`, `scribe_v2`, `scribe_v2_medical`. The adapter passes the endpoint's `provider_model_id` straight through.

## Endpoint shape

- URL: `https://api.elevenlabs.io/v1/speech-to-text`. The adapter reads `provider_info.baseUrl` (expected `https://api.elevenlabs.io/v1`) and appends `/speech-to-text?enable_logging=<bool>`, `false` when the endpoint data policy does not retain prompts (ZDR), `true` otherwise, mirroring the TTS adapter. Regional hosts (`api.eu.residency.elevenlabs.io`, `api.in.residency.elevenlabs.io`) exist per docs and were not captured.
- Auth: `xi-api-key: <key>` header. No `Bearer` prefix. Bad key returns **401** `{"detail":{"type":"authentication_error","code":"unauthorized","message":"Invalid API key","status":"invalid_api_key","request_id":"..."}}`.
- Body: `multipart/form-data`. `model_id` is required. Exactly one of `file`, `cloud_storage_url` (deprecated), or `source_url` must be present. Every other parameter is an ordinary form field. Repeated fields (`keyterms`, `entity_detection`, `entity_redaction`) are sent as repeated parts.
- Accepted upload formats (verified live against ElevenLabs directly, all 200): wav, mp3, flac, m4a, ogg, and raw 16 kHz mono s16le PCM with `file_format=pcm_s16le_16`. A text file uploaded as `file` returns 400 `invalid_audio` / `invalid_content`. The OpenRouter adapter maps `input_audio.format: "pcm"` to `file_format=pcm_s16le_16` by convention, so canonical `pcm` means 16 kHz mono s16le on this path (see "Deliberate feature gaps").
- Limits (docs): file under 5 GB, up to 10 hours. Not probed for uploads because OpenRouter caps multipart input at 25 MB and JSON base64 input well below that; `source_url` is the path for larger files, ElevenLabs downloads the URL itself and the OpenRouter cap does not apply.
- `source_url` (captures 2026-09-27, `fixtures/source-url.*`): a public `https://storage.googleapis.com/cloud-samples-data/speech/brooklyn_bridge.flac` with `model_id` and `timestamps_granularity` and no `file` part returns 200 with the ordinary response shape (`language_code`, `words[]`, `transcription_id`, `audio_duration_secs: 1.8111875`), so billing is unchanged. A GitHub raw WAV URL also returned 200. `source_url` plus `file` returns 400 `invalid_parameters` `Cannot provide both file and URL parameters.` (`error-400-source-url-and-file`). A URL that does not resolve to an object returns 400 `detail.code: bad_request`, `detail.status: invalid_request`, message names the URL download failure (`error-400-source-url-download`). The same `detail.code: bad_request` comes back for an empty inline `file` part, with `detail.status: empty_file` and `param: file` (`error-400-empty-file`, captured through the local worker), so the adapter picks the sanitized copy from the request's audio source rather than from the code alone. A URL that serves a JPEG returns 400 `invalid_audio` / `invalid_content` after about 3 s, same as a corrupted upload. One reachable Wikimedia `.ogg` URL was refused with the download error while `curl` fetched it, so provider-side fetch policy (redirects, hosts, content negotiation) is opaque and not something OpenRouter can pre-validate.
- Rate limits: not published on the reference page. Response headers carry `request-id` only, no rate-limit budget headers were observed.
- Unknown form fields are ignored (200, `unknown-field`, `oai-passthrough`).

## Request matrix (live, 2026-09-25, dev key)

Clips: `baseline.wav` 7.5 s 16 kHz mono one synthetic speaker; `two-speakers.mp3` 19.94 s two synthetic voices; `entities.mp3` 11.47 s fictional name, city, phone, date, organization, doctor; `stereo.wav` 6 s different voice per channel; `silence.wav` 3 s digital silence; `bad.txt` 18 bytes text.

| Scenario | Input | Config | Result |
| --- | --- | --- | --- |
| baseline | baseline.wav | `model_id=scribe_v2` | 200, `language_code: "eng"`, `language_probability: 0.95`, 19 words, `audio_duration_secs: 7.5`, default granularity is `word` |
| timestamps-none | same | `timestamps_granularity=none` | 200, `words[]` still returned, every entry lacks `start` and `end` |
| timestamps-word | same | `timestamps_granularity=word` | 200, byte-identical structure to baseline |
| timestamps-character | same | `timestamps_granularity=character` | 200, each word gains `characters[]` with per-character `start`/`end` |
| timestamps-invalid | same | `timestamps_granularity=segment` | **422** FastAPI list envelope, `Input should be 'none', 'word' or 'character'` |
| with-language | same | `language_code=en` | 200, `language_probability: 1.0`, response `language_code` is `eng` (ISO 639-3) |
| with-language-iso3 | same | `language_code=eng` | 200, same as above |
| with-language-invalid | same | `language_code=zz` | 400 `invalid_parameters` / `invalid_language_code`, message lists supported codes |
| with-temperature | same | `temperature=0.5` | 200, transcript unchanged |
| with-temperature-1.5 | same | `temperature=1.5` | 200, `language_probability` dropped to 0.76, transcript unchanged. Not reachable through OpenRouter (cap 1) |
| with-temperature-2.5 | same | `temperature=2.5` | **422** list envelope, `Input should be less than or equal to 2` |
| seed | same | `seed=42` | 200, transcript identical to baseline |
| seed-invalid | same | `seed=-1` | **422** list envelope, `Input should be greater than or equal to 0` |
| audio-events-off | same | `tag_audio_events=false` | 200, identical to baseline (baseline clip produced no audio event either way) |
| no-verbatim | two-speakers.mp3 | `no_verbatim=true` | 200, 40 words vs 44 on `long-audio` (fillers removed) |
| keyterms | entities.mp3 | `keyterms=OpenRouter`, `keyterms=Doctor Patel` | 200, shape identical to baseline, no field indicates keyterms were applied |
| keyterms-too-long | same | one 60-character keyterm | 400 `invalid_parameters` / `invalid_keyword_length`, `All keywords must be less than 50 characters.` |
| keyterms-invalid-chars | same | keyterm with punctuation | 400 `invalid_parameters` / `invalid_keyword`, `Some keyword contains invalid characters` |
| diarize | two-speakers.mp3 | `diarize=true` | 200, `speaker_id` is `speaker_0` / `speaker_1` |
| diarize-num-speakers | same | `diarize=true`, `num_speakers=2` | 200, same labels |
| diarize-threshold | same | `diarize=true`, `diarization_threshold=0.3` | 200 |
| diarize-threshold-invalid | same | `diarization_threshold=0.9` | **422** list envelope, `Input should be less than or equal to 0.4` |
| no-diarize-two-speakers | same | none | 200, no `speaker_id` on any word |
| diarize-speaker-roles | same | `diarize=true`, `detect_speaker_roles=true` | 200, `speaker_id` is `agent` / `customer` |
| speaker-roles-without-diarize | same | `detect_speaker_roles=true` | 400 `invalid_parameters`, `Speaker role detection requires diarize=true.` |
| entities-all | entities.mp3 | `entity_detection=all` | 200, top-level `entities[]` with 10 entries (`text`, `entity_type`, `start_char`, `end_char`) |
| entities-pii | same | `entity_detection=pii` | 200, 9 entities |
| entities-list | same | `entity_detection=person_name`, `entity_detection=phone_number` | 400 `invalid_parameters`, `person_name` is not a valid type. The message enumerates the valid categories (`offensive_language`, `other`, `pci`, `phi`, `pii`) and 70 valid entity types (`name`, `name_given`, `phone_number`, `location_city`, ...) |
| entities-none-timestamps | same | `entity_detection=all`, `timestamps_granularity=none` | 200, entities still returned |
| entities-baseline-no-entities | same | none | 200, no `entities` key |
| redaction-all | same | `entity_detection=all`, `entity_redaction=all` | 200, `{REDACTED}` in `text` and `words[].text`, `entities[]` still returned, 25 words vs 37 |
| redaction-mode-entity-type | same | plus `entity_redaction_mode=entity_type` | 200, placeholders carry the entity type |
| redaction-mode-redacted | same | plus `entity_redaction_mode=redacted` | 200, placeholders are `{REDACTED}` |
| redaction-not-subset | same | `entity_detection=pii`, `entity_redaction=all` | 200 (docs say redaction must be a subset of detection, upstream did not enforce it) |
| redaction-without-detection | same | `entity_redaction=all` only | 200, redacted text, no `entities` key |
| multichannel-combined | stereo.wav | `use_multi_channel=true`, `multichannel_output_style=combined` | 200, single transcript, words carry `channel_index` and `speaker_id` |
| multichannel-separate | stereo.wav | `use_multi_channel=true` | 200, top-level `transcripts[]` with one transcript per channel, each with `channel_index` and its own `audio_duration_secs` |
| additional-formats-srt | baseline.wav | `additional_formats=[{"format":"srt"}]` | 400 `invalid_parameters`, `Requesting additional formats must have diarization and timestamps enabled.` |
| additional-formats-segmented-json | same | `additional_formats=[{"format":"segmented_json"}]` | 400, same message |
| format-mp3 / flac / m4a / ogg | baseline re-encoded | none | 200 each, duration 7.5 or 7.552 (m4a) |
| format-pcm-s16le | raw s16le | `file_format=pcm_s16le_16` | 200, `audio_duration_secs: 7.5024375` (direct upstream call; the adapter sends the same form for `input_audio.format: "pcm"`) |
| long-audio | two-speakers.mp3 | none | 200, `audio_duration_secs: 19.9405`, 44 words |
| short-audio | 0.5 s slice | none | 200, `text: ""`, `words: []`, `language_probability: 0`, **no `audio_duration_secs`** |
| empty-audio | silence.wav | none | 200, same shape as short-audio, no `audio_duration_secs` |
| unsupported-format | bad.txt | none | 400 `invalid_audio` / `invalid_content`, `File is corrupted. Please ensure it is playable audio.` |
| missing-file | none | `model_id` only | 400 `invalid_parameters`, `Must provide either file or a URL parameter.` |
| bad-auth | baseline.wav | bad key | **401** `unauthorized` / `invalid_api_key` |
| invalid-model | baseline.wav | `model_id=scribe_v9` | 400 `unsupported_model` / `invalid_model_id` |
| tts-model-on-stt | baseline.wav | `model_id=eleven_multilingual_v2` | 400 `unsupported_model` / `invalid_model_id` |
| scribe-v1-model | baseline.wav | `model_id=scribe_v1` | 200 |
| medical-baseline | baseline.wav | `model_id=scribe_v2_medical` | 200, same shape |
| medical-no-verbatim | baseline.wav | `model_id=scribe_v2_medical`, `no_verbatim=true` | 200, 17 words vs 19 |
| enable-logging-false | baseline.wav | `?enable_logging=false` | 200, response unchanged |
| unknown-field | baseline.wav | `foo=bar` | 200, ignored |
| oai-passthrough | baseline.wav | `response_format=verbose_json`, `timestamp_granularities[]=word` | 200, ignored |
| oversize-payload | not run | | OpenRouter rejects inline uploads above 25 MB before the adapter runs, upstream limit is 5 GB; `source_url` bypasses the OpenRouter cap |
| source-url | none (public FLAC URL) | `source_url=<gcs brooklyn_bridge.flac>`, `timestamps_granularity=none` | 200, `text: "How old is the Brooklyn Bridge?"`, `audio_duration_secs: 1.8111875` |
| source-url-word | same | `timestamps_granularity=word` | 200, 6 words plus spacing entries, `transcription_id` present |
| source-url-with-file | short.wav plus the URL | both `file` and `source_url` | 400 `invalid_parameters`, `Cannot provide both file and URL parameters.` |
| source-url-unreachable | none | `source_url` to a missing GCS object | 400 `bad_request` / `invalid_request`, download failure |
| empty-file | zero-byte `file` part | none | 400 `bad_request` / `empty_file`, `param: file` |
| source-url-not-audio | none | `source_url` to a JPEG | 400 `invalid_audio` / `invalid_content` after about 3 s |
| source-url-github-raw | none | `source_url` to a GitHub raw WAV | 200 |

## Shape-affecting and billing-affecting arguments

| Argument | Shape effect | Billing effect (pricing page 2026-09-25) | Decision |
| --- | --- | --- | --- |
| `timestamps_granularity` | `none` drops `start`/`end`, `character` adds `characters[]` | none | always `word`, so a missing `audio_duration_secs` still has a word-timing lower bound. `character` never requested |
| `language_code` | none | none | map from `language` |
| `temperature` | none | none | map from `temperature` (OpenRouter cap 1, upstream cap 2) |
| `diarize`, `num_speakers`, `diarization_threshold` | adds `speaker_id` | none listed | `provider.options.elevenlabs` |
| `detect_speaker_roles` | `speaker_id` becomes `agent`/`customer` | +10% per API reference, not on pricing page | **deferred**, not in the v1 allowlist (see "Billing-altering parameters and SKU plan") |
| `keyterms` | none | $0.05/hour on top of base (pricing page), +20% and a 20 s minimum above 100 keyterms (API reference) | **deferred**, not in the v1 allowlist |
| `entity_detection` | adds top-level `entities[]` | $0.07/hour on top of base (pricing page), +30% (API reference) | **deferred**, not in the v1 allowlist |
| `entity_redaction`, `entity_redaction_mode` | rewrites `text` and `words[].text`, adds `entities[]` when combined with detection | +30% (API reference), priced with detection on the pricing page | **deferred**, not in the v1 allowlist |
| `tag_audio_events` | may add `type: audio_event` words | `words[].type: "audio_event"` | `provider.options.elevenlabs`, timed events are kept as `STTWord` entries with `type: "audio_event"` |
| `no_verbatim`, `seed` | none | none | `provider.options.elevenlabs` |
| `use_speaker_library` | `speaker_id` may name a registered workspace speaker | none listed | **deferred**: reads the OpenRouter-owned workspace speaker library, so it is a data-exposure question before it is a billing one |
| `transcript_edit` | adds `edited_transcript` | +30% with a 10 s billed minimum (API reference) | **unsupported**, dropped as an unknown key, no response slot |
| `use_multi_channel`, `multichannel_output_style` | wraps response in `transcripts[]` or adds `channel_index` | each channel billed for the full duration (docs) | **unsupported**, not in the allowlist, `transcripts[]` rejected with 502 if it ever arrives |
| `additional_formats` | adds `additional_formats[]` | none listed | **unsupported** |
| `source_url` | none (response shape and `audio_duration_secs` identical to an upload) | none | mapped from `input_audio.url` / multipart `source_url`; the adapter sends `source_url` and no `file` part, OpenRouter never fetches the URL |
| `cloud_storage_url` | none | none | **unsupported**, deprecated upstream in favor of `source_url` |
| `webhook*` | 202 instead of 200 | billed upstream, but the 202 carries no `audio_duration_secs`, so OpenRouter could not bill it | **unsupported** |
| `file_format` | none | none | derived: `input_audio.format: "pcm"` sends `file_format=pcm_s16le_16`, every other canonical format is a self-describing container and sends none |
| `enable_logging` (query) | none | none | set by the adapter from the endpoint data policy (`false` on a ZDR endpoint, `true` otherwise), never from `provider.options` |
| `token` (query) | none | none | not forwarded, `xi-api-key` header only |

## Billing-altering parameters and SKU plan

Sources, checked 2026-09-29: the `Body_Speech_to_Text_v1_speech_to_text_post` schema in https://api.elevenlabs.io/openapi.json (the per-field "Usage of this parameter will incur ..." text) and https://elevenlabs.io/pricing/api (the STT table and FAQ). The two sources disagree on the surcharge form: the pricing page lists flat hourly add-ons, the API reference lists percentages of base. The 2026-09-25 local E2E costs below, measured on the pre-v1 build that still forwarded these options, match the flat add-ons.

v1 starts minimal. `provider.options.elevenlabs` accepts only options with no billing text in either source, and the endpoint prices a single SKU, `elevenlabs_stt:audio_seconds` at $0.22/hour. Every option below is outside the allowlist, so it is dropped with a `stt-elevenlabs-passthrough-option-blocked` log line and never reaches ElevenLabs. Each later phase adds one row to the allowlist together with its SKU, a pricing test, and a live invoice or usage-dashboard reconciliation.

| Parameter | Billing effect upstream | Candidate SKU | Cursed because | Phase |
| --- | --- | --- | --- | --- |
| `keyterms` | $0.05/hour (pricing page); +20% of base and a 20 s minimum billed duration when more than 100 keyterms are sent (API reference) | `elevenlabs_stt:keyterms_audio_seconds` | the minimum makes a 2 s clip with 101 keyterms bill as 20 s, so the SKU quantity is `max(duration, 20)` above 100 terms, not `audio_duration_secs` | 2 |
| `entity_detection` | $0.07/hour (pricing page); +30% (API reference) | `elevenlabs_stt:entity_audio_seconds` | none beyond the source disagreement | 2 |
| `entity_redaction` (+ `entity_redaction_mode`) | +30% (API reference); not listed separately on the pricing page | same entity SKU, billed once | unverified whether detection plus redaction bills one or two surcharges; `entity_redaction_mode` alone is free and inert | 2 |
| `detect_speaker_roles` | +10% of base (API reference only) | `elevenlabs_stt:speaker_roles_audio_seconds` | no published rate; needs an invoice before pricing | 3 |
| `transcript_edit` | +30% of base, billed for at least 10 s of audio (API reference) | `elevenlabs_stt:transcript_edit_audio_seconds` | per-request 10 s floor, caller-authored LLM instruction, and the `edited_transcript` result has no response slot | 3, needs a response field |
| `use_multi_channel` (+ `multichannel_output_style`) | each channel (up to 5) billed for the full duration, cost scales linearly with channel count | base SKU x channel count | quantity is not in `audio_duration_secs`; separate style changes the response shape to `transcripts[]` | not planned |
| `source_url` | none by itself, billed on the fetched media's duration | base SKU | accepts YouTube, TikTok, and other hosted video URLs, so a short URL can bill up to the 10 h upload limit ($2.20 base) with no OpenRouter-side size cap | shipped with `input_audio.url` in the URL-input layers; flagged for a duration or host policy |
| `cloud_storage_url` | same as `source_url` | base SKU | deprecated upstream | not planned |
| `webhook`, `webhook_id`, `webhook_metadata` | billed upstream, delivered later | n/a | the synchronous 202 has no `audio_duration_secs`, so the request is billed by ElevenLabs and not by OpenRouter | not planned |
| `model_id=scribe_v2_realtime` | $0.39/hour | separate endpoint | WebSocket lane | not planned |
| `enable_logging=false` (query) | none listed, enterprise-only zero retention | n/a | set by the adapter from the endpoint data policy, never by the caller | adapter-owned |

v1 allowlist, what each option does, and why each is safe. All six are provider passthrough: callers set them under `provider.options.elevenlabs`, the adapter validates them against the allowlist schema, and forwards each as the same-named form field. `diarize` is also reachable through the canonical top-level `diarize` field.

| Parameter | Type and range | What it does | Billing text upstream | Note |
| --- | --- | --- | --- | --- |
| `tag_audio_events` | boolean | tags non-speech sounds such as `(laughter)` or `(applause)` in the transcript | none | returned as `words[]` entries with `type: "audio_event"` |
| `no_verbatim` | boolean | removes filler words ("um", "uh") and false starts | none | 44 words to 40 on the `no-verbatim` capture |
| `seed` | integer, 0 to 2147483647 | asks for deterministic output, so the same audio and seed return the same transcript | none | best effort, not guaranteed upstream |
| `diarize` | boolean | labels which speaker said each word (`speaker_0`, `speaker_1`, ...) | none | adds `speaker_id`, mapped to `speaker` and `speaker_label` |
| `num_speakers` | integer, 1 to 32 | hints the maximum number of speakers so diarization does not over- or under-split | none | requires `diarize`, excludes `diarization_threshold` |
| `diarization_threshold` | number, 0.1 to 0.4 | tunes how readily voices are split into separate speakers; higher means fewer false splits of one voice but more merges of two similar voices | none | requires `diarize`, excludes `num_speakers`; both rules return 400 before upstream |

Open billing questions to close before phase 2: which surcharge form the invoice uses (flat hourly vs percent of base), whether detection plus redaction bills once, and whether the keyterm 20 s minimum applies to the surcharge only or to the base as well.

## Response shape (verified live 2026-09-25)

Success (200, `application/json`), default `word` granularity, no diarization:

```json
{
  "language_code": "eng",
  "language_probability": 0.9529139399528503,
  "text": "Hello, this is a test of the Microsoft MAI Transcribe 2 model. Um, I think, uh, OpenRouter is a",
  "words": [
    { "text": "Hello,", "start": 0.04, "end": 0.48, "type": "word", "logprob": -0.006383976415236248 },
    { "text": " ", "start": 0.48, "end": 0.76, "type": "spacing", "logprob": -2.7656173188006505e-05 },
    { "text": "this", "start": 0.76, "end": 0.9, "type": "word", "logprob": -2.7656173188006505e-05 }
  ],
  "transcription_id": "t5hN6PxTeaSw39OoEQCI",
  "audio_duration_secs": 7.5
}
```

Variations observed:

- `timestamps_granularity=none`: `words[]` entries have no `start`/`end` keys.
- `timestamps_granularity=character`: each `word` entry adds `characters: [{ "text": "H", "start": 0.04, "end": 0.1 }, ...]`.
- `diarize=true`: each entry adds `speaker_id: "speaker_0"`. With `detect_speaker_roles=true` the values are `"agent"` / `"customer"`.
- `entity_detection`: top-level `entities: [{ "text": "John Smith", "entity_type": "name", "start_char": 15, "end_char": 25 }, ...]`. Offsets are character offsets into `text`. Nested entities overlap (`name` and `name_given`).
- `entity_redaction`: `text` and `words[].text` contain `{REDACTED}` (or `{NAME}`-style type placeholders under `entity_redaction_mode=entity_type`).
- `multichannel_output_style=combined`: entries add `channel_index: 1`.
- `use_multi_channel` (separate): `{ "transcripts": [ { "language_code", "language_probability", "text", "words", "channel_index", "audio_duration_secs" }, ... ] }`. No top-level `text`.
- Silence or sub-second audio: `{ "language_code": "en", "language_probability": 0.0, "text": "", "words": [], "transcription_id": "..." }`. `audio_duration_secs` is absent.
- `logprob` is a natural log in (-inf, 0]. Observed range on the fixtures is about -1.5 to 0.

Errors:

- Business validation (400): `{"detail":{"type":"validation_error","code":"<code>","message":"...","status":"<status>","request_id":"...","param":"<field>"}}`. Observed codes: `unsupported_model`, `invalid_audio`, `invalid_parameters`. Observed statuses: `invalid_model_id`, `invalid_content`, `invalid_language_code`, `invalid_keyword`, `invalid_keyword_length`, `invalid_parameters`.
- Auth (401): same envelope with `type: authentication_error`, `code: unauthorized`, `status: invalid_api_key`.
- Pydantic range validation (422): `{"detail":[{"type":"less_than_equal","loc":["body","temperature"],"msg":"Input should be less than or equal to 2","input":"2.5","ctx":{"le":2.0}}]}`. `detail` is a list, not an object.
- Request id: `detail.request_id` in the 400/401 envelopes and the `request-id` response header on every response.

## Billing model

- Unit: audio hours, prorated. API pricing page (https://elevenlabs.io/pricing/api, checked 2026-09-25): Scribe v2 and Scribe v2 Medical **$0.22 per hour**, entity detection **$0.070 per hour**, keyterm prompting **$0.050 per hour**. The same rates appear in the page's FAQ text ("Speech to Text $0.22 per hour (Scribe) ... with entity detection $0.07 per hour and keyterm prompting $0.05 per hour"). Scribe v2 Realtime is $0.39 per hour and out of scope.
- Speaker roles: the API reference states a 10% surcharge for `detect_speaker_roles`. The pricing page does not list a rate. 10% of $0.22 is $0.022 per hour. Treated as **inferred** until confirmed by an invoice. v1 does not forward `detect_speaker_roles`.
- Per-second rate for `pricing_json`: base 0.22/3600 = 0.0000611111. Candidate surcharge rates for later phases: entity 0.07/3600 = 0.0000194444, keyterms 0.05/3600 = 0.0000138889, speaker roles 0.022/3600 = 0.0000061111 (inferred). The v1 pricing schema strips any surcharge key an endpoint row still carries.
- Billed quantity: `audio_duration_secs` from the response. No usage or billing fields are returned. When `audio_duration_secs` is absent the adapter bills the latest `end` across timed `words[]` entries (a lower bound) and logs `vendor_field_missing` with `billed_from: last_word_end`. Silence and sub-second clips omit it and return no timed entries, so they bill 0 seconds and log `billed_from: nothing`. Whether ElevenLabs bills those requests is **unverified** (would need an invoice or usage dashboard reading). The `last_word_end` fallback feeds only the base `elevenlabs_stt:audio_seconds` SKU: every future surcharge SKU, including any minimum such as keyterms' `max(duration, 20)`, reads only the provider-reported `audio_duration_secs` and bills no surcharge when it is absent.
- Floor: none observed on `audio_duration_secs` (7.5024375, 11.4706875, 19.9405). Whether the invoice rounds is **unverified**.
- Multi-channel bills each channel for the full duration per docs. Unsupported here, so not modeled.
- SKUs: v1 ships the base SKU `elevenlabs_stt:audio_seconds` only. The surcharge SKUs are candidates for later phases, listed in "Billing-altering parameters and SKU plan".

## Reconciliation (2026-09-25)

| Capture | `audio_duration_secs` | Expected cost at $0.22/h | Status |
| --- | --- | --- | --- |
| baseline | 7.5 | $0.000458 | reported (page rate x observed duration). No per-request cost returned by upstream, invoice not read |
| long-audio | 19.9405 | $0.001218 | reported |
| entities-all | 11.4706875 | $0.000701 base + $0.000223 entity | reported, pre-v1 (v1 drops `entity_detection`) |
| keyterms | 11.4706875 | $0.000701 base + $0.000159 keyterms | reported, pre-v1 (v1 drops `keyterms`) |
| empty-audio | absent | $0 by adapter | unverified upstream |

## OpenRouter mapping (implemented)

Request:

| OpenRouter | ElevenLabs | Notes |
| --- | --- | --- |
| `model` (endpoint `provider_model_id`) | `model_id` | |
| `input_audio.data` + `format` / multipart `file` | `file` part named `audio.<format>` with a MIME type | `format: "pcm"` adds `file_format=pcm_s16le_16`; the bytes are assumed to be 16 kHz mono s16le |
| `language` | `language_code` | canonical field wins over a passthrough `language_code` |
| `temperature` | `temperature` | canonical wins over passthrough. Values above 1 are unreachable |
| `response_format` / `timestamp_granularities` | `timestamps_granularity=word` | always sent so billing has a lower bound; `words` are returned only for `verbose_json` + `word`, and `segment` is synthesized from `text` and duration |
| `provider.options.elevenlabs.*` | same-named form field | v1 allowlist, none of which changes the price: `tag_audio_events`, `no_verbatim`, `seed`, `diarize`, `num_speakers`, `diarization_threshold` |
| unknown or deferred `provider.options.elevenlabs` key | dropped | logged as `stt-elevenlabs-passthrough-option-blocked` (deferred and documented upstream keys by name, anything else as `unknown`), request continues and bills the base SKU only |
| malformed allowlisted value | 400 before upstream | |
| `diarization_threshold` without `diarize`, or together with `num_speakers` | 400 before upstream | mirrors the upstream rules (`"If 'diarization_threshold' is provided, 'diarize' must be set to true."`, `"... 'num_speakers' must not be set."`) |
| `user`, `session_id`, `trace` | not sent | |

Response:

| ElevenLabs | OpenRouter | Notes |
| --- | --- | --- |
| `text` | `text` | |
| `language_code` | `language` (verbose only) | ISO 639-3 passed through unchanged |
| `language_probability` | `language_confidence` (verbose only) | new typed field |
| `audio_duration_secs` | `duration` (verbose only), `usage.seconds` | absent upstream leaves `duration` absent; `usage.seconds` falls back to the latest timed word `end`, or is absent when no entry is timed |
| `words[].text` (`type: word`) | `words[].word` | |
| `words[].start` / `end` | `words[].start` / `end` | entries without timestamps are dropped |
| `words[].logprob` | `words[].confidence` | `min(1, exp(logprob))` |
| `words[].speaker_id` `speaker_N` | `words[].speaker: N` and `speaker_label: "speaker_N"` | |
| `words[].speaker_id` `agent` / `customer` | `words[].speaker_label` only | `speaker` omitted |
| `words[].channel_index` | `words[].channel` | only reachable through combined multichannel, which is not exposed |
| `entities[]` | `entities[]` with `text`, `type`, `start_char`, `end_char` | character offsets into `text` (kept distinct from the seconds-valued `start`/`end` on words and segments), emitted for `json` and `verbose_json` |
| none | `segments` | one synthesized segment `{ id: 0, start: 0, end: duration, text }` when `verbose_json`. Empty array when upstream omits `audio_duration_secs` (silence, sub-second clips) |

## What we lose (dropped upstream fields)

| Upstream field | When it appears | Why it is dropped | Consequence |
| --- | --- | --- | --- |
| `words[].type: spacing` entries | always | not words | none, `text` keeps the spacing |
| `words[].characters[]` | `timestamps_granularity=character` | canonical granularity enum is `word`/`segment`. Never requested | character timestamps unavailable |
| `words[]` under `json` | always | OpenRouter `json` returns `text` only | same as every other adapter |
| `transcription_id` in the response body | always | returned as `upstream_id` by `GET /api/v1/generation` (the attempt's `id`, as chat does with the completion id) and persisted as the attempt's `upstream_id`; the `request-id` header stays in `upstream_request_id`; not in the transcription body | correlation goes through `GET /api/v1/generation`, not the STT response |
| `detail.request_id` on errors | 400/401 | not surfaced in the OpenRouter error body | correlation requires the `request-id` header in worker logs |
| `additional_formats[]` | never requested | unsupported | no srt/vtt/docx |
| `transcripts[]` (multichannel separate) | never requested | rejected with 502 if it arrives | none in practice |
| `words[].channel_index` | never requested in this pass | mapped to `channel` if present | none in practice |
| entity `entity_type` values beyond the docs list | `entity_detection` | passed through as `type: string` | none |

## Deliberate feature gaps

| Gap | Reason | Cost to close |
| --- | --- | --- |
| `timestamps_granularity=character` | canonical enum has no `character`, and `characters[]` has no typed slot | request enum plus a `characters` array on `STTWord` |
| `temperature` in (1, 2] | canonical cap is 1 | widen `STTRequestInputSchema.temperature` and every adapter that assumes 1 |
| `cloud_storage_url` | deprecated upstream, `source_url` covers the same input and is mapped from `input_audio.url` | none, intentionally left out |
| pre-validating `input_audio.url` | OpenRouter forwards the URL and never fetches it, so reachability and content type are only known once ElevenLabs downloads it. The download failure comes back as 400 `bad_request` and is sanitized to a hint that names `input_audio.url`; the same code for an inline request is sanitized to an empty-or-corrupted-file message instead | none, provider-owned fetch |
| `use_multi_channel` | per-channel billing not modeled by the STT pipeline (same reason Google Cloud blocks it), `transcripts[]` wrapper has no response slot | pipeline billing plus response schema |
| `additional_formats` | export payloads have no response slot | response schema |
| `webhook*` | STT route is synchronous | async job model |
| regional hosts | single `baseUrl` per endpoint | additional endpoint rows |
| `scribe_v1`, `scribe_v1_experimental` | superseded per models page | endpoint rows only |
| native `segment` timestamps | ElevenLabs has none. One synthesized full-audio segment matches the AssemblyAI precedent | `segmented_json` additional format parsing |
| unknown `provider.options.elevenlabs` keys | dropped with a log line instead of a 400, matching the Deepgram and AssemblyAI allowlists | policy change across adapters |
| 422 list-shaped errors | left to the shared status mapping, not remapped to `InputRejected` | only reachable through canonical fields the schema already bounds |
| raw PCM at any rate other than 16 kHz mono s16le | ElevenLabs accepts raw PCM only as `pcm_s16le_16` and the canonical request carries no sample rate, channel count, or bit depth, so `pcm` is mapped to that format by convention. Audio at another rate transcribes at the wrong speed and still bills | a typed PCM descriptor on `STTInputAudioSchema` |

## Assumptions

| Assumption | Basis | Risk if wrong |
| --- | --- | --- |
| `exp(logprob)` is an acceptable word confidence | `logprob` is documented as a log probability, observed values are in (-1.5, 0] | confidence is systematically off, but stays within 0..1 |
| `audio_duration_secs` is the billed quantity | it is the only duration in the response and matches the clip lengths | under- or over-billing if the invoice uses a different unit |
| Missing `audio_duration_secs` means zero billable seconds | observed on silence and 0.5 s clips | under-billing if ElevenLabs bills those requests |
| The v1 allowlist changes nothing on the invoice | no billing text on any v1 option in the API reference or the pricing page | under-billing if ElevenLabs starts pricing a v1 option; re-check the API reference before each phase |
| `speaker_N` labels are zero-based and stable | observed `speaker_0`, `speaker_1` | integer `speaker` off by one relative to other providers |
| One full-audio segment is acceptable `segment` output | AssemblyAI adapter precedent | callers expecting sentence segments get one block |
| ISO 639-3 `language` is acceptable | other adapters pass vendor codes through | callers comparing against ISO 639-1 mismatch |
| Unknown passthrough keys should be dropped, not rejected | matches existing allowlisted adapters | a typo in an option silently does nothing |
| `scribe_v2_medical` needs no adapter change | identical captures | medical-specific fields would be dropped |

## Quirks

- Response `language_code` is ISO 639-3 (`eng`) even when the request uses ISO 639-1 (`en`). Silence returns `en`.
- `words[]` is returned under `timestamps_granularity=none`, just without timestamps.
- `entity_redaction` without `entity_detection` succeeds and redacts, contradicting the docs' subset rule. `entity_redaction` not a subset of `entity_detection` also succeeds.
- `entities[]` overlap: `name` and `name_given` both cover "John".
- Two error envelope shapes: object `detail` for business validation and auth, list `detail` for Pydantic range checks.
- `additional_formats` returns 400 unless the request also enables diarization and timestamps.
- Unknown form fields are silently ignored, so OpenAI-shaped fields do not error.
- `language_probability` drops with higher temperature (0.95 at default, 0.76 at 1.5) while the transcript stays the same on a clean clip.
- `entity_detection` list items are validated upstream against the current type list. `person_name` (used in older docs) is rejected with 400 and the body enumerates the valid categories (`offensive_language`, `other`, `pci`, `phi`, `pii`) and types (`name`, `name_given`, `email_address`, ...). The adapter forwards list items verbatim and surfaces that 400 as an input rejection with OpenRouter copy (`Provider rejected the request parameters`), not the upstream text.
- `diarization_threshold` requires `diarize=true` and is mutually exclusive with `num_speakers` (both upstream 400s). The adapter enforces both before any provider call.
- `entity_redaction_mode` on its own (no `entity_redaction`) is accepted upstream, has no visible effect, and does not trigger the entity surcharge.

## Local E2E (2026-09-25)

Run on the pre-v1 build, which still forwarded `keyterms`, the entity options, and `detect_speaker_roles`. The surcharge rows below are research evidence for later phases, not v1 behavior.

100 cases through the local worker (`POST http://localhost:8792/api/v1/audio/transcriptions`, Tilt stack, dev `ELEVENLABS_API_KEY` held by the worker), 100 passed their expected status. Runner, per-case request/response artifacts, and the generated evidence table (`e2e-evidence.md` / `.csv`) are session artifacts, not committed.

- Coverage: both transports (JSON base64 and multipart with a JSON-encoded `provider` field), every `response_format` x `timestamp_granularities` combination, `language` (639-1, 639-3, invalid), `temperature` (0, 0.5, 1, 1.5, negative), both staged models plus an unknown model, five audio containers plus corrupted bytes, silence, a sub-second clip, stereo without multichannel, every allowlisted option alone, every cross-field pair, every surcharge alone and all three together, canonical-overrides-passthrough for `language`, `temperature`, and `timestamps_granularity`, seven blocked keys, thirteen malformed values, malformed `provider` envelopes on both transports, and five canonical schema rejections.
- Results: 70 x 200, 30 x 400. 400 origin: 14 adapter preflight, 9 route schema, 1 model lookup, 6 upstream status relayed (invalid language, corrupted audio, `person_name`, `not_a_type`, keyterm over 50 chars, empty audio data). Upstream `detail.message` is never client-visible. `invalid_audio`, `invalid_parameters`, and `unsupported_model` map to fixed OpenRouter copy with `InputRejected` ownership, every other upstream 4xx/5xx falls through to the default `Provider returned <status>` handling. The six cases were re-run after this copy change and kept their 400s.
- Log correlation (`services/dev-fs-logs/.logs/default/stt/`): all 70 generation ids appear in `request-body.log`, `transaction-attempt.log`, and `provider-response.log`. None of the 30 rejections has a generation id or a `provider-response.log` entry. For the 14 adapter preflight and 10 route/model rejections this shows no provider call was made. The worker's `provider-response.log` only records successful provider responses, so the 6 upstream 400s are evidenced by the `stt.invoke:providerErrorBody` worker log line (800-char body preview) and by their statuses matching the live captures.
- Billing (measured from `usage.cost / usage.seconds`): 0.220 $/h with no surcharge, 0.270 with `keyterms`, 0.290 with `entity_detection` and/or `entity_redaction` (one shared SKU, D14 = D17 = E05), 0.242 with `detect_speaker_roles` (inferred 10%), 0.362 with all three (E08). 68/68 priced cases match. Silence and the sub-second clip return `usage: { cost: 0 }` without `seconds` and empty `words` and `segments`.
- Normalization observed: `language` is `eng` for `en` requests (`en` on silence), `language_confidence` present under `verbose_json`, `confidence` in (0.99, 1.0] on clean clips, `speaker` integer plus `speaker_label: speaker_N` under `diarize`, `speaker_label` only (`agent`, `customer`) under `detect_speaker_roles`, `entities[]` emitted under both `json` and `verbose_json`, one synthesized segment under `verbose_json`.
- Upstream findings that changed the adapter during this pass: `diarization_threshold` cross-field rules (above), current entity type list (`person_name` invalid).

## Open questions (human checkpoint)

- Confirm the speaker-roles surcharge rate from an invoice or the usage dashboard before a later phase prices that SKU.
- Confirm whether silence and sub-second requests are billed upstream.
- Decide whether `character` granularity and `temperature` up to 2 are worth widening the canonical request schema for.
- Decide whether the other seven providers that return a body-level request id should record it as `upstream_id` the way ElevenLabs now does.
