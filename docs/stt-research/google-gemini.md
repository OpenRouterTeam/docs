# Google Gemini Transcribe STT Research

Last updated: 2026-08-26
Researcher: devin-79ee9372c47e4601b513d16ac92d175e

### TL;DR

- `gemini-3.5-transcribe`, served by Google AI Studio's generic
  Interactions API (`POST /v1beta/interactions`), API-key auth, JSON body
  with inline base64 audio.
- Billed per **token** ($2/M in, $12/M out) — no duration anywhere in the
  response, so the pricing strategy is token-based.
- New adapter (`packages/stt/adapters/google-gemini`) — the request,
  auth, response, and billing all differ from Google Cloud Speech v2.
- Every claim below was captured live against the real API on 2026-08-26.

### Scope

- Lane being onboarded: sync transcription (REST, pre-recorded)
- OpenRouter slug: `google/gemini-3.5-transcribe`
- Explicitly deferred:
  - `gemini-3.5-transcribe-live` — WebSocket Live API only; the unary
    endpoint 404s it. Priced separately ($3.50 / $21.00 per 1M tokens).
  - Files API upload — inline base64 worked at every size tested,
    including a 21.5 MB body.

Docs: <https://ai.google.dev/gemini-api/docs/transcribe>,
<https://ai.google.dev/gemini-api/docs/pricing> (checked 2026-08-26).

### Request

- URL: `https://generativelanguage.googleapis.com/v1beta/interactions`
  (the AI Studio provider `base_url` is already `…/v1beta`; the adapter
  overrides `getUrl()` to append `/interactions`)
- Auth: `x-goog-api-key: <key>` header (not `Authorization: Bearer`)
- Body — the only accepted audio encoding is raw base64 on `input[]`,
  which is exactly what OpenRouter's `input_audio.data` already holds:

```json
{
  "model": "gemini-3.5-transcribe",
  "input": [{ "type": "audio", "data": "<base64>", "mime_type": "audio/wav" }],
  "generation_config": {
    "temperature": 0,
    "transcription_config": {
      "language_codes": ["en-US"],
      "custom_vocabulary": ["OpenRouter"],
      "mode": {
        "type": "verbatim",
        "timestamp_granularities": ["word"],
        "diarization_mode": "speaker"
      }
    }
  }
}
```

Rejected alternatives: `inline_data` (the `generateContent` spelling) and
`data:` URIs both 400.

Everything under `transcription_config` is optional. Shape-affecting
options:

| Option | Effect |
| --- | --- |
| `mode.timestamp_granularities: ["word"]` | adds `word_info` annotations |
| `mode.diarization_mode: "speaker"` | adds `speaker: "spk:<n>"` to those annotations (needs timestamps to be visible) |
| `mode.type: "smart"` | rewrites the transcript (disfluencies removed, formatting) — incompatible with timestamps/diarization |

`language_codes`, `custom_vocabulary`, and `temperature` affect content
only. Nothing changes the billing rate.

### Response

Interaction object. Transcript lives at `steps[].content[].text` where
`step.type == "model_output"` and `content.type == "text"`:

```json
{
  "id": "v1_...",
  "status": "completed",
  "usage": { "total_tokens": 126, "total_input_tokens": 126, "total_output_tokens": 0 },
  "steps": [
    {
      "type": "model_output",
      "content": [{ "type": "text", "text": "The sun rises in the east…" }]
    }
  ],
  "model": "gemini-3.5-transcribe"
}
```

With timestamps/diarization, `word_info` annotations sit alongside the
text content:

```json
{ "text": "The", "start_offset": "0.100s", "end_offset": "0.100s", "speaker": "spk:0", "type": "word_info" }
```

Offsets are protobuf duration **strings** (whole seconds elide the
fraction: `"7s"`) and speakers are `"spk:<n>"` labels — both need parsing
into OpenRouter's numeric word schema.

**A successful 200 can have no `steps` key at all** (silent audio, and
one oversized payload — see quirks). The Zod schema makes `steps`,
`content`, `text`, and `annotations` optional, and the adapter treats a
step-less 200 as an empty transcript, not an error.

### Billing

- Unit: tokens. No duration in the response or headers ⇒
  `isDurationBased() === false`.
- $2.00 / 1M input tokens, $12.00 / 1M output tokens. Google's per-minute
  figures (~$0.005/min blended) are estimates; we bill reported tokens.
- Audio ≈ 25 tokens/second (5s → 125, 60s → 870), plus exactly 1 text
  input token per request. One published input rate ⇒ both modalities
  fold into the single `google_gemini_stt:input_tokens` SKU.
- `total_output_tokens` was **0 in every capture** — the transcript is
  not billed as output. The `google_gemini_stt:output_tokens` SKU is
  registered anyway so pricing survives if that changes; today it's $0.
- Sanity check: baseline 5s clip = 126 input tokens = $0.000252.

### OpenRouter mapping

- Adapter: `packages/stt/adapters/google-gemini` (JSON body, not FormData)
- Pricing strategy: `google_gemini_stt`
- Passthrough: `provider.options['google-ai-studio']` merges into
  `transcription_config`, except adapter-owned fields: `language_codes`
  (driven by `request.language`), `mode` and `diarization_mode` (composed
  by the adapter so a passthrough `mode` can't drop the word timestamps
  `verbose_json` promises; `diarization_mode` is honoured by nesting it
  into the adapter's `mode`)
- `verbose_json`: supported — the adapter requests word timestamps and
  synthesizes a single full-audio `segments` entry (Gemini has no segment
  concept)
- Routing: the bare `google` author prefix maps to Google Cloud Speech v2,
  so `google/gemini-3.5-transcribe` gets an explicit slug override to this
  adapter

### Quirks

- **Auth failure is HTTP 400 (not 401) and a JSON *array***:
  `[{"error":{"code":400,"message":"API key not valid…","status":"INVALID_ARGUMENT"}}]`
  — every other error is the usual `{"error":{…}}` object.
- **`mime_type` is advisory** — a WAV sent as `audio/xyz` still
  transcribed (200), so a wrong mapping fails silently.
- **Large audio can 200 with no transcript**: a 21.5 MB / ~5 min inline
  payload returned `status: "completed"`, no `steps`, and 3054 tokens
  billed — indistinguishable from silence. Worth watching after the first
  staged traffic; re-test via the Files API before advertising long-audio
  support.
- **Smart + timestamps rejects with a generic parameter error**
  (`Unknown parameter 'timestamp_granularities' at …mode`), not the
  documented incompatibility message.
- No rate-limit headers observed; body `id` is the only correlation id.

### Documented limits (not independently verified)

- ≤ 1 hour of audio per request; ≤ 30 min with timestamps or diarization
- ≤ 8 speakers; 3+ marked experimental
- `custom_vocabulary` ≤ 1000 terms, ~100 recommended
- Word timestamps may reduce accuracy
- 85+ locales, automatic language ID, code-switching

### Open questions

- Why does a ~5 min inline payload return a billed 200 with no
  transcript, well under the 1 hour limit?
- Does diarization-only mode (no timestamps) expose speakers anywhere?
  No speaker signal was visible without also requesting word timestamps.
