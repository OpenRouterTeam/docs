---
name: audio-e2e-testing
description: "Phase 4: run local speech-to-text (STT) and text-to-speech (TTS) end-to-end tests with worker logs, audio/transcription evidence, and cost reconciliation. Sub-skill of audio-provider-onboarding."
user-invocable: true
---

## Shared e2e policy

Run against the local worker with the required KV/model setup and dev-fs-logs evidence. Reconcile usage and cost against staged pricing, cover the provider's modality-specific happy paths and errors, and state whether each result used mock keys, a local real key, or a paid path. Rerun after pushes that change adapter or pricing behavior.

## STT

Run the STT end-to-end test suite at `tests/e2e/api/stt/` against
the local cfw-stt-api worker.

### Devin Secrets Needed

- `OPENAI_API_KEY` — available in Infisical at `/tests/e2e` path.
  Used by the stt-api worker for upstream OpenAI calls.

### Prerequisites

1. **Local stack ready** — follow [local-dev-env](../local-dev-env/SKILL.md).
2. **cfw-api at port 8787** — required by the e2e prerequisite check.
   Auto-starts with Tilt.
3. **stt-api ready** — default port 8792; start it if needed:
   ```bash
   tilt trigger stt-api && tilt wait --for=condition=Ready uiresource/stt-api
   ```
4. **dev-fs-logs running** — for log verification

#### Which worker handles what

The prereq check in step 3 (`Verify Setup`) requires multiple services
respond, but only one of them actually handles e2e test traffic. Reading
the checks in isolation can lead to mistaking cfw-api for the worker
under test — it isn't.

| Service | Port | Role in e2e tests |
|---------|------|-------------------|
| **cfw-stt-api** | `8792` | **The worker under test.** All e2e STT traffic hits this port via `OPENROUTER_STT_API_BASE`. |
| cfw-api | `8787` | Sanity check that the broader dev stack is alive. Does NOT handle STT traffic. |
| Postgres | `54322` | Model/endpoint reads (via cfw-stt-api). |
| dev-fs-logs | `1090` | Log introspection only — tests do not depend on it being up. |

If the prerequisite check fails, inspect the named service and configured origin in its error. Port values above are defaults; use Tilt's actual URLs when overrides are set.

### Setup Steps

#### 1. Ensure stt-api has `.dev.vars`

The stt-api worker needs provider API keys. If `services/cfw-stt-api/.dev.vars`
does not exist, copy from cfw-api:

```bash
cp services/cfw-api/.dev.vars services/cfw-stt-api/.dev.vars
```

**Important**: Verify that `OPENAI_API_KEY` in `.dev.vars` is a real key
(not a placeholder like `...`). If it's a placeholder, replace it with
the key from Infisical:

```bash
export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --client-id=${INFISICAL_CLIENT} --client-secret=${INFISICAL_SECRET} \
  --silent --plain)
OPENAI_KEY=$(infisical secrets get OPENAI_API_KEY \
  --projectId="771b7bc0-6578-41b0-886e-9fcdb66e9173" \
  --env=dev --path="/tests/e2e" --plain)
sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=${OPENAI_KEY}|" \
  services/cfw-stt-api/.dev.vars
```

#### 2. Seed STT Models into KV

The `warmKVModelsAndEndpoints()` cron may not populate KV locally
(it depends on ClickHouse performance data which is unavailable locally).
You may need to seed KV directly.

**Option A: Try the cron first**
```bash
curl -s http://127.0.0.1:8787/__scheduled
```
Then check if KV is populated by making a test request.

**Option B: Direct KV write (if cron fails)**

Construct a `RouterModelConfigs` JSON with `models` and `endpoints`
arrays, then write it:

```bash
cd services/cfw-stt-api && npx wrangler kv key put \
  "modality_transcription" "$KV_DATA" \
  --binding KV_MODELS_AND_ENDPOINTS --local \
  --persist-to ../../.wrangler/shared-state
```

See `audio-stage-endpoint` skill for the full model/endpoint schema.

**Important**: After writing KV, restart stt-api to clear the
in-memory `FetchDeduper` cache (5-minute TTL):
```bash
tilt trigger stt-api && tilt wait --for=condition=Ready uiresource/stt-api
```

#### 3. Verify Setup

```bash
# Check both services respond
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/v1/models
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8792/health
```

### Run Tests

```bash
cd tests/e2e && OPENROUTER_API_KEY=sk-or-v1-unlimitedkey bun run test:e2e api/stt
```

Expected: golden-path tests pass for each provider's `describe` block
(currently Whisper + GPT-4o Transcribe), 2 format-label tests, response-shape
tests, and 6 error-handling tests. Adding a provider today means adding a new
`describe` block to `index.test.ts` — see
[ECO-682](https://linear.app/openrouter/issue/ECO-682) for the planned
parametric refactor that will reduce this to a one-row registry append.

For a new provider, the block must also cover:

- Every request-level pricing modifier — assert
  the correct SKU appears in `sku_items` with a non-null price and the
  cost reconciles against the staged rate
- Verbose response capabilities the adapter advertises (`verbose_json`,
  word timestamps, segments) — unadvertised capabilities must 400, not
  silently degrade

### Test Structure

- `helpers.ts` — `callSttApi()` helper + `generateTestWavBase64()` WAV generator.
  Logs `or_request_body` + `or_response_body` per call to `e2e/stt/success.log`.
- `index.test.ts` — golden-path `describe` blocks per provider
  (one for duration-based Whisper, one for token-based GPT-4o Transcribe),
  plus `describe('STT: Format Label Handling')` and
  `describe('STT: Response Shape')` blocks. Each provider block asserts the
  billing-mode shape (`isDurationUsage` or `isTokenUsage`) end-to-end.
- `basic/errors.test.ts` — Error handling: 401, 400, 404 (6 cases).

### Inspecting Request/Response Shapes (dev-fs-logs)

Every STT request writes three `sendToFSLog` channels under
`services/dev-fs-logs/.logs/default/stt/`, keyed by `generation_id`:

| Channel | Contents | Producer |
|---|---|---|
| `stt/request-body` | Request metadata as received by cfw-stt-api (model, format, language, decoded audio size — no audio bytes) | `handleSTTRequest` in `packages/stt/lifecycle/submit.ts` |
| `stt/transaction-attempt` | Per-endpoint attempt outcome (success, endpoint, refund, client/endpoint error) | `packages/routing/helpers/log-tx-attempt.ts` |
| `stt/provider-response` | Endpoint id, provider name, and upstream status for the winning attempt | `packages/stt/lifecycle/finalize.ts` |

The upstream request and raw upstream response body are not logged; verify
field mappings from the client-visible response body and the e2e suite's
own `e2e/stt/success` log (`tests/e2e/api/stt/helpers.ts`).

After running a test, grep each file by `generation_id` (returned in the
`x-generation-id` response header) to reconstruct the round-trip.
See the "After Tests: Check Logs" section below.

This is local-only — `services/dev-fs-logs/.logs/` doesn't exist in remote
environments.

#### Adding a new provider to e2e

Copy an existing `describe` block in `tests/e2e/api/stt/index.test.ts`
(the duration-based Whisper block or the token-based GPT-4o Transcribe
block, whichever matches the new provider's billing mode) and swap the
model slug. The test should assert:

- `200` OK response
- `text` is a string
- `x-generation-id` header present
- `usage` shape matches the declared billing mode
  (`isDurationUsage` or `isTokenUsage`)

The error suite (`basic/errors.test.ts`) tests provider-agnostic behavior
and does not need a new block per provider. See
[ECO-682](https://linear.app/openrouter/issue/ECO-682) for the planned
refactor that will replace the copy-paste pattern with a parametric
provider registry.

### After Tests: Check Logs

```bash
# e2e suite's own per-request logs (status, usage, generation_id, request body)
cat services/dev-fs-logs/.logs/default/e2e/stt/success.log
cat services/dev-fs-logs/.logs/default/e2e/stt/error.log

# Worker-side channels (see the table above)
cat services/dev-fs-logs/.logs/default/stt/request-body.log
cat services/dev-fs-logs/.logs/default/stt/transaction-attempt.log
cat services/dev-fs-logs/.logs/default/stt/provider-response.log
```

Load-bearing things to eyeball in a new adapter's response:

- `text` is the verbatim transcription the provider returned —
  recognisable text proves the adapter wiring works end-to-end, not just
  that auth + routing succeeded.
- `usage.seconds` matches the clip duration (no clamp needed for ≥1s
  clips; sub-1s clips would show `0` upstream and `1` post-clamp).
- `cost` = `seconds × price_per_second` from `pricing_json` — e.g.
  `11 × $0.00005 = $0.00055` for the JFK clip on Mistral.
- `generation_id` is identical across the three worker-side channels —
  that's the correlation key when grepping them.

#### Sanity-checking a new adapter with a real audio clip

Go-to fixture for longer-audio verification: **JFK's "ask not what your
country can do for you"** —
`https://github.com/openai/whisper/raw/main/tests/jfk.flac`. Public domain
(US government work, 1961), ~11s, 1.15 MB FLAC, the same clip OpenAI uses
in Whisper's reference test suite. The transcription is universally
recognisable, so a reviewer can verify the adapter works end-to-end
without listening to the audio.

Mistral's `/v1/audio/transcriptions` accepts FLAC directly — no transcode
step needed (their docs list wav/mp3/etc but FLAC is empirically supported,
verified `2026-05-15`). For providers that reject FLAC, transcode with
`ffmpeg -i jfk.flac -ar 16000 -ac 1 jfk.wav -y` and adjust `format`.

```bash
# Download JFK FLAC (public-domain, ~11s)
curl -sL https://github.com/openai/whisper/raw/main/tests/jfk.flac -o /tmp/jfk.flac
AUDIO_B64=$(base64 -w0 /tmp/jfk.flac)

# Hit the local cfw-stt-api on :8792 — capture response headers for the generation id
curl -sS -X POST http://127.0.0.1:8792/api/v1/audio/transcriptions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -D /tmp/stt-headers.txt \
  -d "{\"model\":\"mistralai/voxtral-mini-transcribe\",\"input_audio\":{\"format\":\"flac\",\"data\":\"${AUDIO_B64}\"},\"language\":\"en\"}" \
  | jq .

# Pull the generation id and grep the worker-side channels
GEN_ID=$(grep -i X-Generation-Id /tmp/stt-headers.txt | awk '{print $2}' | tr -d '\r')
ROOT=services/dev-fs-logs/.logs/default/stt
grep -l "$GEN_ID" $ROOT/{request-body,transaction-attempt,provider-response}.log
```

Expected `text`: `"And so, my fellow Americans, ask not what your country
can do for you, ask what you can do for your country."`
Expected `cost` on Mistral at $0.003/min: `0.00055` (11s × $0.00005/s).

What you're looking for in the response:

- `text` is **non-empty** and recognisable as what the audio actually
  says (proves the request reached Mistral and the upstream response was
  forwarded back).
- `usage.seconds` = clip duration (no off-by-one).
- `cost` = `seconds × price_per_second` matches the row you staged in
  `endpoints.pricing_json`.

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "STT models not found in KV" | KV not seeded | Seed via wrangler or cron |
| "Model X does not exist" (400) | KV cache stale | Restart stt-api to clear FetchDeduper |
| "Provider returned 401" | Invalid OPENAI_API_KEY | Replace placeholder in `.dev.vars` |
| "Provider returned 400" | Malformed audio file | Check WAV header construction |
| Prerequisite check fails | cfw-api not running at 8787 | `tilt trigger api` |
| cfw-api unresponsive or a port remains occupied | Inspect the current `api` logs and listener; the symptom alone does not identify the cause | Use [kill-port](../kill-port/SKILL.md) for cleanup and restart with local-dev-env |
| Zod validation errors on startup | Missing or invalid worker configuration | Follow the `.dev.vars` setup above; STT currently runs Wrangler directly, so its `dev` command does not generate that file |
| `Invalid model group: X` in cfw-api logs, model missing from `modality_transcription` KV | Hand-staged `models.group` is not a value the KV warmer accepts | Use an existing group such as `Other` |
| 403 for a fresh local user | No `age_18plus` attestation row (source `user`) for the test user | Insert the attestation row, then retry |
| Passthrough options silently ignored on a regional endpoint | `endpoints.provider_region` hydrates the slug as `<provider>/<region>`; a lookup keyed on the raw slug misses `provider.options.<provider>` | Resolve options through `getProviderOptionsForEndpointSlug` (exact slug, then base slug). Always test passthrough against a regional endpoint, not only `provider_region = NULL` |

#### Verifying what actually reached the provider and what got billed

- To prove a passthrough option reached the provider, assert on a
  provider-visible side effect (a keyword spelled as supplied, diarization
  turns) or add a temporary redacted `sendToFSLog` in
  `buildProviderRequest` and revert it before committing.
- Provider 4xx bodies are not surfaced to the client (`Provider returned
  400`); read the upstream body preview from `stt/provider-response`.
- A 200 with `usage.cost` does not prove persistence. The local path is
  cfw-stt-api, usage-record, Pub/Sub emulator, `dev-dataflow-1` (manual
  Tilt trigger, not replayed if it was down), Spanner emulator (REST on
  :9020, project `openrouter-dev`, instance `dev`, database `usage`).
  In `generations` the id column is `generation_id`, cost is `usage`, and
  priced SKUs are in `sku_items` as `{sku: {price, quantity}}`. Per-hour
  audio SKUs store `quantity = seconds / 3600`. A query against a
  non-existent column returns an `error` object and zero rows, so check
  `error` before concluding "not persisted".
- Preflight 400s (bad WAV header, invalid provider options) must leave no
  `stt/transaction-attempt` or `stt/provider-response` entry and no Spanner
  row. Check that the row count did not move.


## TTS

Phase 4 of [`audio-provider-onboarding`](../audio-provider-onboarding/SKILL.md).
Requires a staged endpoint from
[`audio-stage-endpoint`](../audio-stage-endpoint/SKILL.md) (KV `modality_tts`
seeded, real provider key in `services/cfw-tts-api/.dev.vars`, worker on
port 8791).

### Validation modes

Be explicit in your report about which mode each result came from:

- **Mock** — mock env keys; proves routing/schema wiring only, upstream
  calls fail auth. Never claim audio correctness from mock runs.
- **Local real-key** — real provider key against the local worker; proves
  the adapter, billing, and audio end-to-end. This is the required bar
  for onboarding.
- **Real paid-path** — against staging/production
  (`OPENROUTER_TTS_API_BASE`); only when the human asks, since it spends
  real money.

### Run the tests

The suite lives in `tests/e2e/api/tts/` (`index.test.ts` golden path +
format tests, `errors.test.ts`, `helpers.ts` with `callTtsApi`).

```bash
# terminal 1 — log sink
bun run dev dev-fs-logs

# terminal 2
cd tests/e2e && bun test api/tts
```

### Adding the new provider to e2e

Add a `describe` block to `tests/e2e/api/tts/index.test.ts` (copy the
existing golden-path block and swap model/voice). Follow the existing
style: `callTtsApi`, `assertOk`, `sendToFSLog`, `writeBufferToFile`, no
nested branching. Assert:

- status 200 and the expected `Content-Type` for the requested format
- an `x-generation-id` header
- `byteLength > 0`, and the written file is **decodable** (check the
  saved artifact with `ffprobe`: right codec, duration > 0)
- cover **both compressed (mp3/opus) and PCM** output when the adapter
  supports both — PCM bugs (sample rate/endianness) don't show up in
  byte-length assertions

### Inspect the evidence

For each run, walk the full chain in
`services/dev-fs-logs/.logs/` and the worker output:

1. **Request** — the inbound body (model, input, voice, format, speed)
2. **Upstream** — the adapter's transformed request and the upstream
   request id
3. **Response** — status, Content-Type, byte length
4. **Usage/cost** — the billed SKU(s) and amounts

**Reconcile cost with staged pricing**: billed characters × the staged
`pricing_json` rate must equal the reported cost. Use a multi-byte input
in at least one run to confirm the billable-unit definition from
[`audio-research-provider`](../audio-research-provider/SKILL.md) holds in the
full pipeline, not just in the adapter unit test.

## UI spot-check

With the local web app running, confirm the model appears under the correct
audio lane in model discovery (`output_modalities=transcription` for STT,
the TTS/audio lane for TTS) rather than another modality, and that the
rendered pricing label, unit, and values match the staged `pricing_json`
and the strategy's `getPublicPricing` (the price card on the model detail
page is the load-bearing surface).

## After local testing

Production verification is owned by the launch process, not this skill:
see `docs/runbooks/model-launch.md` (§3 staging/private access).

### Done when

- All TTS e2e tests pass in local real-key mode
- The new provider's block covers compressed + PCM (as supported) with
  decodable-audio checks
- dev-fs-logs shows the expected adapter, strategy, and SKU keys, and
  the cost math reconciles against the primary-source rate from the
  research note
- A non-default `voice` request provably reaches the upstream (inspect
  the upstream URL/body in dev-fs-logs) — a silently ignored voice is a
  failure even when audio comes back
- The UI spot-check passes
- Results (mode, pass/fail, sample log paths) are reported in the top PR

Rerun after every push that changes adapter or pricing behavior. Never
report completion when a run was skipped or failed.
