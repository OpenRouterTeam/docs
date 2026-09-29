# Spec: STT + TTS tools on the OpenRouter MCP server

Status: proposed (not yet implemented)
Scope: `services/cfw-mcp` only — no changes to `cfw-stt-api` / `cfw-tts-api`.

## 1. Summary

Add two hand-written custom tools:

| Tool | Upstream endpoint | Returns |
| --- | --- | --- |
| `transcribe-audio` | `POST /api/v1/audio/transcriptions` (JSON body) | transcript text + inline cost |
| `generate-speech` | `POST /api/v1/audio/speech` | MCP `audio` content block + generation id |

Both endpoints are already in the OpenAPI spec, and Speakeasy has already
generated funcs (`generated/src/funcs/{sttCreateTranscription,ttsCreateSpeech}.ts`)
and models (`sttrequest.ts`, `speechrequest.ts`, …) for them — they are just
suppressed by the deny-by-default overlay (`overlays/01-disable-all-tools.yaml`)
and never registered. So there are two viable routes:

- **Route A — generated**: enable the ops in `overlays/02-enable-read-tools.yaml`
  and regen. Cheap, and the generated `formatResult`
  (`generated/src/mcp-server/tools.ts:110-129`) already converts an `audio/*`
  response into an MCP `{ type: 'audio', data, mimeType }` block.
- **Route B — custom (recommended)**: hand-write slim wrappers under
  `generated/src/mcp-server/custom/` + `src/tools/`, mirroring
  `generate-image` / `send-message`.

**Recommendation: Route B for both tools**, per the v1 plan §2.7 precedent
("disable the generated equivalent via overlay, add the file under
`src/mcp-server/custom/`, register it in server.extensions.ts"):

1. **Context/token budget.** Tool schemas are injected into every client
   conversation (~400-token budget per tool, plan §2.7). The generated STT
   schema drags in `provider.options` passthrough, `verbose_json`,
   `timestamp_granularities`, segments/words — none of which an agent needs in
   v1. A slim wrapper is the same trade that made `send-message` hand-written
   (~1.6KB vs ~5KB).
2. **Base64 audio must not flow through the model.** The generated STT tool's
   only input is `input_audio.data` (base64). MCP tool arguments are produced
   by the model, so a 10 MB clip would mean ~13 MB of base64 in the model's
   output tokens — unusable beyond tiny clips. A custom tool can accept an
   `audio_url` that the worker fetches server-side.
3. **Generation-id / cost reporting.** The TTS response body is raw audio, so
   the generated tool would return only the audio block. A custom tool reads
   the `X-Generation-Id` response header and appends a trailing text block
   (`generate-image` pattern), so cost is one `get-generation` call away.

No overlay changes are needed for Route B: the generated audio ops are already
disabled by overlay 01 and stay that way.

## 2. Tool: `transcribe-audio`

Files:
- `generated/src/mcp-server/custom/transcribeAudioTool.ts` (definition)
- `src/tools/transcribe-audio/run-transcribe-audio.ts` (logic)
- `src/tools/transcribe-audio/run-transcribe-audio.test.ts`

### Args (zod raw shape, all `.describe()`d)

```
model         z.string()            — STT model slug, e.g. "openai/whisper-large-v3"
audio_url     z.string().optional() — HTTPS URL of the audio file; fetched server-side
audio_base64  z.string().optional() — base64 audio bytes, for small clips only
format        z.string().optional() — audio container format (wav, mp3, flac, m4a, ogg, webm, aac);
                                       required with audio_base64, inferred from URL/Content-Type otherwise
language      z.string().optional() — ISO-639-1 hint; auto-detected if omitted
```

Exactly one of `audio_url` / `audio_base64` is required (validated in the run
fn; return a tool error otherwise). v1 deliberately omits `temperature`,
`response_format: verbose_json`, and `timestamp_granularities` — add later
behind the same tool if agents ask for word timestamps.

Description (for the agent): transcribe speech from an audio file to text;
bills the caller; find STT models via `list-models` with
`output_modalities=transcription`. Point at `audio_url` as the preferred input.

Annotations: `readOnlyHint: false`, `idempotentHint: false`,
`destructiveHint: false`, `openWorldHint: true`, `scopes: ['read']`
(matches `generate-image` — billable, so not read-only).

### Flow (`runTranscribeAudio`)

1. If `audio_url`: `wrap(() => fetch(audio_url))`. The worker has
   `global_fetch_strictly_public` (`wrangler.toml`), which is the SSRF
   mitigation — internal/private addresses are unreachable by construction.
   - Reject non-2xx (cancel body).
   - Enforce a size cap of 25 MB (`Content-Length` check first, then a
     counting read of the stream; abort + tool error over the cap). 25 MB
     matches the STT API's own multipart cap
     (`packages/stt/helpers/parse-multipart-transcription-request.ts:16`).
   - `encodeUint8ArrayToBase64` (from `@openrouter-monorepo/helpers/base64`)
     on the bytes.
   - Resolve `format`: explicit arg → URL file extension → response
     `Content-Type` subtype, else tool error asking for `format`.
2. `POST {apiBaseUrl}/audio/transcriptions` with
   `{ model, input_audio: { data, format }, ...(language && { language }) }`,
   `Authorization: Bearer <ctx.authInfo.token>` — same fetch/error ladder as
   `run-generate-image.ts` (wrap → wLog on send failure → body-read guard with
   `response.body?.cancel()` → `!ok` → 500-char body excerpt → `parseSchema`).
3. Response schema (local, minimal): `{ text: z.string(), usage: {...}.nullish() }`
   with `usage.cost`/`usage.seconds` as `zDouble().nullish()`. Capture
   `X-Generation-Id` from headers.
4. Return:
   ```
   content: [
     { type: 'text', text: <transcript> },
     { type: 'text', text: '(model: …, cost: $…, seconds: …, generation id: …)' },
   ]
   ```
   Cost is inline because the STT API returns `usage.cost` in-body
   (`packages/stt-interfaces/schemas/response/index.ts:23`).

## 3. Tool: `generate-speech`

Files:
- `generated/src/mcp-server/custom/generateSpeechTool.ts`
- `src/tools/generate-speech/run-generate-speech.ts`
- `src/tools/generate-speech/run-generate-speech.test.ts`

### Args

```
model           z.string()                        — TTS model slug, e.g. "mistralai/voxtral-mini-tts-2603"
input           z.string()                        — text to synthesize
voice           z.string()                        — voice id; list via get-model (supported_voices)
response_format z.enum(['mp3','pcm']).optional()  — tool defaults to 'mp3'
speed           zDouble().optional()              — playback speed; only some models honor it
```

Note the deliberate default flip: the API defaults to `pcm`
(`packages/tts/schemas/request/index.ts`), but the tool sends
`response_format: 'mp3'` when unset — mp3 is ~10x smaller, and the whole
payload is base64'd back through the MCP response.

Description: synthesize speech and return it as an inline audio content block;
bills the caller; find TTS models via `list-models` with
`output_modalities=speech`, and each model's `supported_voices` via
`get-model`. Note that not all MCP clients can play audio.

Annotations: identical to `generate-image` (billable → `readOnlyHint: false`,
`idempotentHint: false`).

### Flow (`runGenerateSpeech`)

1. `POST {apiBaseUrl}/audio/speech` with
   `{ model, input, voice, response_format, ...(speed && { speed }) }`, bearer
   auth, same error ladder as above. On `!response.ok` the body is JSON error
   text — surface a 500-char excerpt.
2. On success the body is a raw audio bytestream:
   `await response.arrayBuffer()` → `encodeUint8ArrayToBase64(new Uint8Array(buf))`.
   Guard empty body (0 bytes → tool error).
3. `mimeType` = the response `Content-Type` header verbatim (the API sets
   `audio/mpeg` or `audio/pcm;rate=…;channels=…` via `getTTSContentType`) with
   fallback `audio/mpeg`. Do NOT sniff — `getMimeType` has no audio magic
   bytes.
4. Capture `X-Generation-Id`. Cost is NOT in the response (binary body) — the
   generation id + the existing `get-generation` tool is the cost path, same
   contract as `send-message`.
5. Return:
   ```
   content: [
     { type: 'audio', data: <base64>, mimeType },
     { type: 'text', text: '(model: …, generation id: …; audio cost via get-generation)' },
   ]
   ```

## 4. Wiring checklist (both tools)

1. Register in `generated/src/mcp-server/server.extensions.ts`
   (`register.tool(tool$transcribeAudio); register.tool(tool$generateSpeech);`).
2. Add `transcribe-audio` + `generate-speech` to `KNOWN_TOOLS` in
   `src/routes/mcp.ts` (Datadog tag allowlist).
3. `src/mcp-client.test.ts`:
   - add both names to the pinned sorted tool list (16 → 18 tools);
   - add both to the non-read-only annotation assertions block (alongside
     send-message / generate-image / send-feedback).
4. Unit tests for each run fn, mocking `global.fetch` per
   `run-generate-image.test.ts`: happy path (incl. `X-Generation-Id` capture),
   missing token, upstream !ok, non-JSON (STT), schema mismatch (STT), empty
   audio body (TTS), mimeType passthrough (TTS), url-vs-base64 arg validation
   and size-cap rejection (STT).
5. No `bun run regen` / no overlay edits — custom tools bypass Speakeasy.
   `mcp-regen-check` is unaffected (only `custom/` + `server.extensions.ts`
   are hand-written and regen-exempt).
6. `bun test` + `bun run typecheck` in `services/cfw-mcp`.
7. CHANGELOG entry in `services/cfw-mcp/CHANGELOG.md` (user-facing: two new
   tools, names, one line each).
8. Optional live smoke via `bunx wrangler dev` (:8798) with a real
   `sk-or-v1-` key; known-good request shapes are in
   `.speakeasy/gen.lock` examples (TTS: voxtral-mini-tts-2603 /
   `en_paul_neutral`; STT: whisper-large-v3 with a wav clip).

## 5. Token budget

Both arg schemas are 4–5 short string fields — comfortably inside the
~400-token/tool budget (plan §2.7). The STT surface trimmed out of v1
(verbose_json, timestamps, provider options) is the main thing keeping it
there; revisit only with a concrete agent use case.

## 6. Open questions / follow-ups

- **`audio_url` trust**: `global_fetch_strictly_public` blocks private
  targets, but the worker still fetches arbitrary public URLs with no
  allowlist. Acceptable for v1 (same posture as any URL-taking tool); flag in
  review if a stricter stance is wanted.
- **Large TTS outputs**: a long `input` produces a large base64 audio block in
  the MCP response. v1 mitigations: mp3 default + description note. If it
  becomes a problem, add a `return_url`-style mode later (needs storage —
  out of scope).
- **Streaming**: both upstream endpoints stream, MCP tool results don't.
  Buffering in the worker is fine at the 25 MB scale.
- **`/api/v1/tts` alias**: undocumented and excluded from the OpenAPI export —
  do not use; target `/audio/speech`.
