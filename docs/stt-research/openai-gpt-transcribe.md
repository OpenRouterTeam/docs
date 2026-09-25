# OpenAI GPT Transcribe STT Research

Last updated: 2026-08-04
Researcher: devin-30a758adc66e40589b89d7576338769b

### Scope

- Lane being onboarded: sync file transcription (`POST /v1/audio/transcriptions`)
- Primary model id: `gpt-transcribe` (default snapshot alias; upstream serves
  `gpt-transcribe-api-ev3` behind it per error messages)
- OpenRouter slug: `openai/gpt-transcribe`
- Explicitly deferred:
  - Realtime transcription (`/v1/realtime`) — separate product surface.
  - Streamed file transcripts (`stream=true`) — OpenRouter STT is sync-only.

Docs: <https://developers.openai.com/api/docs/models/gpt-transcribe>,
<https://developers.openai.com/api/docs/guides/speech-to-text.md>
(checked 2026-08-04).

### Endpoint shape

- URL: `https://api.openai.com/v1/audio/transcriptions` — same endpoint
  family as whisper-1 / gpt-4o(-mini)-transcribe; `OpenAISTTAdapter` and the
  `openai_stt` pricing strategy are reused unchanged.
- Auth: Bearer.
- Body: `multipart/form-data`.
- File limit: 25 MB. Formats: mp3, mp4, mpeg, mpga, m4a, wav, webm.

### Billing

- Duration-billed: $0.0045 / audio minute ⇒ `openai_stt:audio_minutes`
  0.0045 with zero `openai_stt:input_tokens` / `openai_stt:output_tokens`
  (the strategy's existing token-prices-are-zero duration detection).
- Plain `json` responses carry the billable unit — no verbose_json needed:

```json
{ "text": "", "languages": [], "usage": { "type": "duration", "seconds": 1 } }
```

### Response formats

- `response_format=json` → 200 (shape above; note the response-level
  detected `languages` field, which OpenRouter's normalized STT response
  does not carry today).
- `response_format=verbose_json` → 400 `unsupported_value`:

```json
{
  "error": {
    "message": "response_format 'verbose_json' is not compatible with model 'gpt-transcribe-api-ev3'. Use 'json' or 'text' instead.",
    "type": "invalid_request_error",
    "param": "response_format",
    "code": "unsupported_value"
  }
}
```

⇒ slug added to `OpenAISTTAdapter.verboseJsonUnsupportedModelSlugs` (route
400s client verbose_json requests up-front), and the adapter now requests
plain `json` upstream for duration-billed deny-set models, reading
`usage.seconds` from the json body.

### Model-specific request parameters (provider passthrough)

All served via `provider.options.openai` — no first-class schema fields:

| Field | Multipart framing | Live result |
| --- | --- | --- |
| `prompt` | single text field | 200 |
| `keywords[]` | repeated text fields | 200; rejects `<`, `>`, CR, LF with 400 `invalid_value` |
| `languages[]` | repeated text fields | 200; replaces singular `language` for this model |
| `language` + `languages[]` together | — | 400 `invalid_value` (mutually exclusive; upstream owns the validation) |

Repeated multipart fields required generalizing the OpenAI adapter's
passthrough serialization to arrays of primitives (same mechanism the xAI
adapter already used for `keyterm`); extracted the shared `isPrimitive`
helper to `packages/stt/helpers/is-primitive.ts`.

### Open questions

- Response-level detected `languages` is dropped by the normalized STT
  response schema. Promote only as a cross-provider language-detection
  capability if demand appears.
- Streamed file transcripts and realtime remain out of scope until the STT
  surface supports streaming generally.
