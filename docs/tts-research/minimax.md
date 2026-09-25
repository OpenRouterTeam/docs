# MiniMax TTS research

Checked: 2026-07-15

Primary API documentation: [Speech-2 T2A HTTP](https://platform.minimax.io/docs/api-reference/speech-t2a-http)

## Request surface

- **Models:** `speech-2.8-hd` and `speech-2.8-turbo`.
- **Endpoint:** `POST <baseUrl>/t2a_v2`.
- **Base URL:** TTS endpoints use `https://api.minimax.io/v1`. This is separate from the existing MiniMax chat base URL.
- **Authentication:** `Authorization: Bearer <MINIMAX_API_KEY>`.
- **Request body:** `model`, `text`, `stream: true`, `output_format: "hex"`, `voice_setting.voice_id`, `voice_setting.speed` when non-default, `audio_setting.format: "mp3"`, and optional provider passthrough such as `language_boost`.
- **Model mapping:** `endpoint.provider_model_id` carries `speech-2.8-hd` or `speech-2.8-turbo`.
- **Voice mapping:** OpenRouter's required `request.voice` maps to `voice_setting.voice_id`. MiniMax voice IDs are passed through without validation against endpoint metadata.
- **Voice requirement:** `packages/tts/schemas/request/index.ts:16-19` requires `voice`; the adapter therefore does not provide an implicit default.
- **Speed:** `request.speed` maps to `voice_setting.speed` only when it differs from `1`.
- **Streaming:** The adapter uses MiniMax's SSE streaming mode. Streaming supports MP3 only; WAV and FLAC are available only for non-streaming requests. Each `data:` event is a JSON object with a status-1 audio chunk, followed by a status-1 empty event and a status-2 final event. The live final event repeats the complete audio payload, so the decoder emits status-1 chunks and uses the final event only for metadata.
- **Request IDs:** The response may include `trace_id`; the adapter also checks `minimax-request-id`, `trace-id`, and the standard request-ID headers.
- **Callbacks:** Callback, webhook, and URL passthrough fields are blocked to prevent SSRF.
- **Text limits:** No limit was pinned from the supplied API reference; the adapter does not chunk or truncate input.

## Audio output

The adapter requests `output_format: "hex"` and `audio_setting.format: "mp3"`, then decodes each SSE `data.audio` hex chunk to raw bytes before returning the response to the TTS router.

| OpenRouter format | MiniMax `audio_setting.format` | Returned content type |
|---|---|---|
| `mp3` | `mp3` | `audio/mpeg` |

PCM, WAV, and FLAC are unsupported by the streaming adapter and rejected with HTTP 400. The adapter does not implement `getPcmParameters()`.

## Response and billing

The non-streaming documented response shape is:

```json
{
  "data": { "audio": "<hex>", "status": 2 },
  "extra_info": { "usage_characters": 22 },
  "trace_id": "...",
  "base_resp": { "status_code": 0, "status_msg": "success" }
}
```

`base_resp.status_code === 0` indicates success. In streaming mode, the adapter parses each SSE envelope with Zod, decodes status-1 hex chunks, captures `trace_id` and final-event `extra_info.usage_characters`, and reports usage through the generic `TTSSKU.Characters` SKU. If that field is absent, it falls back to `request.input.length`.

### Live streaming capture

The live capture is stored verbatim in `packages/tts/adapters/minimax/fixtures/response-stream-live.sse`.
It contains five `data:` events separated by blank lines:

1. Status `1`, audio hex length `9306`.
2. Status `1`, audio hex length `12672`.
3. Status `1`, audio hex length `4608`.
4. Status `1`, empty audio.
5. Status `2`, audio hex length `26586`, `usage_characters: 2`, and final metadata.

The final audio length equals the sum of the first three chunks, confirming that it repeats the complete audio rather than providing a separate tail. Response headers included `content-type: text/event-stream`, `trace-id`, and `minimax-request-id`.

The approved endpoint rates are:

- `speech-2.8-turbo`: `$60 / 1M characters`
- `speech-2.8-hd`: `$100 / 1M characters`

These rates belong in endpoint pricing configuration. The adapter uses the generic per-character `tts` strategy.

## Capture matrix

An authenticated live capture was made against `https://api.minimax.io/v1/t2a_v2` on 2026-07-15 using a tiny `speech-2.8-turbo` MP3 request. The request returned HTTP 200 with `base_resp.status_code: 0`, `data.status: 2`, `extra_info.usage_characters: 2`, `extra_info.audio_format: "mp3"`, `extra_info.audio_sample_rate: 32000`, `extra_info.audio_channel: 1`, and a `trace_id`. The complete redacted capture, including the hex audio payload, is `packages/tts/adapters/minimax/fixtures/response-live.json`. The API also returned an empty `data.ced` field, which the Zod response parser intentionally ignores as an undocumented additive field.

| Case | Fixture / coverage |
|---|---|
| Successful MP3 streaming response | `fixtures/response-stream-live.sse` |
| Live non-streaming MP3 response | `fixtures/response-live.json` |
| MP3-only request mapping and validation | `index.test.ts` |
| Non-default speed | `index.test.ts` |
| Arbitrary voice passthrough | `index.test.ts` |
| Provider-reported ASCII, CJK, and emoji usage | `index.test.ts` |
| Streaming hex decode, final-event deduplication, and fallback usage | `index.test.ts` |
| Passthrough isolation and SSRF blocking | `index.test.ts` |
