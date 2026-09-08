---
name: embeddings-e2e-testing
description: "Phase 4: test embeddings end-to-end via cfw-embeddings-api, including text and multimodal inputs, batch behavior, billing, response validation, and dev-fs-logs. Sub-skill of embeddings-provider-onboarding."
user-invocable: true
---

# Embeddings E2E Testing

Test an embedding endpoint end-to-end against the local
`cfw-embeddings-api` service running in Tilt. Supports
text-only and multimodal (image, audio, video, PDF) inputs
using sample files.

## Prerequisites

- Tilt stack running (`tilt up`)
- `api` resource ready (port 8787) — needed for the KV cron
- `embeddings-api` resource ready (port 8789)
- `dev-fs-logs` running for debugging (`bun run dev dev-fs-logs`)
- The target embedding model and endpoint already staged in
  the local DB (see `stage-endpoint` skill if not)
- Provider API key available — the embeddings-api reads keys
  from `services/cfw-embeddings-api/.dev.vars`. If missing,
  copy from `services/cfw-api/.dev.vars` and update the
  relevant provider key. Do not commit `.dev.vars` files.

### If embedding models are missing from the local DB

The seed data may be stale. Reset the DB to get fresh seeds:

```bash
bun run db:reset
```

Then restart `cfw-api` and re-run the KV cron (step 3).

## Arguments

- `$MODEL_SLUG`: Full model slug
  (e.g., `openai/text-embedding-3-small`,
  `google/gemini-embedding-001`)
- `$ADAPTER_NAME`: Which embeddings adapter the endpoint uses
  (e.g., `OpenAIEmbeddingsAdapter`,
  `GoogleAIStudioEmbeddingsAdapter`)

## Steps

### 1. Verify Tilt services are ready

```bash
tilt wait --for=condition=Ready \
  uiresource/postgres \
  uiresource/postgres-migrate \
  uiresource/postgres-seed \
  uiresource/embeddings-api
```

If `embeddings-api` is not running, enable it:

```bash
tilt enable embeddings-api
```

The embeddings API runs on port **8789** by default
(`CFW_EMBEDDINGS_API_PORT` env var).

### 2. Verify the model and endpoint exist in the local DB

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 \
  -U postgres -d postgres -c "
SELECT m.slug, m.name, m.output_modalities,
       e.provider_name, e.provider_model_id, e.hidden,
       e.provider_overrides->'adapterName' AS adapter_override
FROM models m
JOIN endpoints e ON e.model_permaslug = m.permaslug
WHERE m.slug = '\$MODEL_SLUG'
  AND m.deleted = false
  AND e.deleted = false;"
```

The embeddings adapter is resolved by
`packages/embeddings/configs/get-adapter-name.ts`:
1. If the endpoint has `provider_overrides.adapterName`
   matching an embeddings adapter enum value, that wins.
2. Otherwise, the adapter is inferred from `provider_name`
   (e.g., Nvidia → `NvidiaEmbeddingsAdapter`,
   Google AI Studio → `GoogleAIStudioEmbeddingsAdapter`,
   everything else → `OpenAIEmbeddingsAdapter`).

Check the `adapter_override` column in the query above
to see if an endpoint uses an explicit adapter override
(e.g., Azure endpoints set `AzureOpenAIEmbeddingsAdapter`).

For provider-routing curls (step 9), use the `permaslug`
from `providers` (e.g. `openai`, `azure`,
`google-ai-studio`):

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 \
  -U postgres -d postgres -c "
SELECT provider_name, permaslug FROM providers
WHERE deleted = false ORDER BY provider_name;"
```

Confirm the model has `embeddings` in `output_modalities`
and the endpoint is not hidden (or set `hidden = false` if
testing a newly staged endpoint).

If no results, stage the endpoint first using the
`stage-endpoint` skill.

### 3. Refresh the KV cache

The embeddings-api reads models and endpoints from a shared
KV store populated by the **cfw-api** cron (port 8787).
After staging or modifying data, flush and rebuild:

```bash
# Clear shared KV state
rm -rf .wrangler/shared-state

# IMPORTANT: restart cfw-api before triggering the cron.
# Deleting .wrangler/shared-state while wrangler dev is
# running corrupts the miniflare KV handle and subsequent
# `KV.put` calls fail silently with
# `Failed to write models and endpoints to KV`.
tilt trigger api

# Trigger the cron on cfw-api (NOT embeddings-api).
# Wait a few seconds after `tilt trigger api` so wrangler
# is fully back up before you hit /__scheduled.
curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"

# Restart embeddings-api so it picks up the new KV data
tilt trigger embeddings-api
```

Verify embedding models are in KV:

```bash
cd services/cfw-api && bunx wrangler kv key get modality_embeddings \
  --binding KV_MODELS_AND_ENDPOINTS --local \
  --persist-to ../../.wrangler/shared-state 2>/dev/null \
  | sed -n '/^{/,$p' \
  | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(f'Models: {len(d[\"models\"])}, Endpoints: {len(d[\"endpoints\"])}')"
```

The `sed -n '/^{/,$p'` step strips the `bun` / wrangler
warning banners that print before the JSON body (without
it, `python3 -c "json.load(...)"` chokes on the first line).

### 4. Prepare sample input files

Create a working directory for test artifacts:

```bash
mkdir -p /tmp/embedding-test-artifacts
```

#### Text file (for text-only embeddings)

```bash
cat > /tmp/embedding-test-artifacts/sample.txt << 'EOF'
OpenRouter is a unified API for LLM routing. It normalizes
multiple provider interfaces into a single OpenAI-compatible
schema, enabling developers to access hundreds of models
through one endpoint.
EOF
```

#### Image file (for multimodal embeddings)

For adapters that support multimodal input
(`GoogleAIStudioEmbeddingsAdapter`), prepare a test image.
Use a small, publicly accessible image URL or a local
base64-encoded image:

```bash
# Download a small test image
curl -sL "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png" \
  -o /tmp/embedding-test-artifacts/sample.png

# Generate base64 data URI for inline use
echo -n "data:image/png;base64,$(base64 -w0 /tmp/embedding-test-artifacts/sample.png)" \
  > /tmp/embedding-test-artifacts/sample-image-data-uri.txt
```

### 5. Test text-only embedding

#### Single string input

```bash
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg model "$MODEL_SLUG" \
      --arg input "$(< /tmp/embedding-test-artifacts/sample.txt)" \
      '{model: $model, input: $input}')" | jq .
```

#### Batch string input

```bash
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg model "$MODEL_SLUG" \
      --arg line1 "$(head -1 /tmp/embedding-test-artifacts/sample.txt)" \
      --arg line2 "$(tail -1 /tmp/embedding-test-artifacts/sample.txt)" \
      '{model: $model, input: [$line1, $line2]}')" | jq .
```

Always test BOTH single and batch modes. Adapters often route
them to different upstream endpoints (e.g. Google Vertex uses
`:embedContent` for single input and `:predict` for arrays),
and some models only support one mode. Expected outcomes vary:

- Batch supported: 200 with one embedding per input.
- Batch unsupported upstream: the adapter should return a clean
  400 (e.g. gemini-embedding-2 on Vertex has no `:predict`
  endpoint at all). An upstream 404 surfacing to the user means
  the adapter is missing a guard.
- The same model can differ per provider: gemini-embedding-2
  batch works on AI Studio (`batchEmbedContents`) but is
  single-only on Vertex.

#### With encoding_format

```bash
# Float format (default)
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": \"Hello world\",
    \"encoding_format\": \"float\"
  }" | jq .

# Base64 format (not supported by all adapters)
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": \"Hello world\",
    \"encoding_format\": \"base64\"
  }" | jq .
```

#### With dimensions

```bash
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": \"Hello world\",
    \"dimensions\": 256
  }" | jq .
```

#### With input_type

> **Note**: Accepted `input_type` values vary by adapter.
> Nvidia only accepts `"query"` or `"passage"` (returns 400
> for other values). Google AI Studio maps `input_type` to
> its own task type enum. Other adapters ignore `input_type`.

```bash
# Google AI Studio / general (search_query, search_document, etc.)
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": \"What is machine learning?\",
    \"input_type\": \"search_query\"
  }" | jq .

# Nvidia-specific (only "query" or "passage")
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": \"What is machine learning?\",
    \"input_type\": \"query\"
  }" | jq .
```

#### Gemini-specific task types (embedding-001 vs embedding-2)

Google's embedding models split into two task-type mechanisms,
resolved by `usesPromptPrefixes()` in
`packages/embeddings/configs/model-capabilities.ts` (the
prefix/task-type mapping logic itself lives in
`packages/embeddings/adapters/google-ai-studio/schemas.ts`):

| Model | Mechanism | What the adapter sends |
|-------|-----------|------------------------|
| `gemini-embedding-001` | `taskType` API field | `input_type` is normalized to an UPPER_CASE `taskType` (e.g. `query` → `RETRIEVAL_QUERY`) via `INPUT_TYPE_TO_TASK_TYPE` in `packages/embeddings/adapters/google-ai-studio/schemas.ts` |
| `gemini-embedding-2` / `gemini-embedding-2-preview` | Prompt-text prefix | `taskType` is omitted; a prefix is prepended to each input via `getEmbedding2TaskPrefix()` (e.g. `query` → `task: search result \| query: `, `document` → `text: `). Inputs that already carry a prefix are left untouched (`hasTaskPrefix`) |

Test both mechanisms:

```bash
# Query task type
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": \"What is machine learning?\",
    \"input_type\": \"query\"
  }" | jq .

# Document task type (batch)
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": [\"doc one\", \"doc two\"],
    \"input_type\": \"document\"
  }" | jq .
```

Then verify the wire shape in dev-fs-logs using the request/response
trace pattern documented by the embeddings worker:

```bash
LOG_DIR=services/dev-fs-logs/.logs/default/embeddings

# task_type (001) or task_prefix (embedding-2) chosen by the adapter
cat $LOG_DIR/transform-request.log

# the actual provider request body
cat $LOG_DIR/fetch-request.log
```

For embedding-2, expect the prefix inside each `text` field
and **no** `taskType` key:

```json
"text": "task: search result | query: What is machine learning?"
```

For embedding-001, expect untouched `text` plus
`"taskType": "RETRIEVAL_QUERY"`.

#### Gemini batch routing caveat (Vertex)

Vertex serves prompt-prefix Gemini embedding models
(`gemini-embedding-2`) single-input only — it 400s on batch
(multi-input) requests. The routing step
`Filter Vertex Prompt-Prefix by Batch Support`
(`packages/embeddings/routing/filter-by-batch-support.ts`)
drops Vertex endpoints for these models when the input is a
batch, so batch requests land on AI Studio
(`:batchEmbedContents`) while single-input requests may still
use Vertex.

To verify, send a batch and a single-input request and read
the routing log:

```bash
cat services/dev-fs-logs/.logs/default/router/routing/step.log
```

Expect `mutate` (Vertex removed) for the batch request and
`skipped | Not a batch request` for the single input.

### 6. Test multimodal embedding (if adapter supports it)

`GoogleAIStudioEmbeddingsAdapter` (and
`GoogleVertexEmbeddingsAdapter`, which extends it) supports
text + image + audio + video + PDF.
`NvidiaEmbeddingsAdapter` supports text + image. Nvidia
processes `image_url` components via
`extractFromMultimodalInput` in
`packages/embeddings/adapters/nvidia/get-array-inputs.ts`
and auto-selects `input_type = 'passage'` for image
inputs. The request format is the same `content: []`
array for both adapters. Other adapters accept text-only
input.

The request schema lives in
`packages/embedding-interfaces/schemas/request/index.ts`. Each
input is an object with a `content` array of typed parts:
`text`, `image_url`, `input_audio`, `input_video`,
`input_file`. Media parts take a **full data URL** in `data`
(bare base64 is a 400).

#### Text + image via URL

```bash
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": [
      {
        \"content\": [
          {\"type\": \"text\", \"text\": \"A logo image\"},
          {\"type\": \"image_url\", \"image_url\": {\"url\": \"https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png\"}}
        ]
      }
    ]
  }" | jq .
```

#### Text + image via base64 data URI

```bash
IMAGE_DATA_URI=$(cat /tmp/embedding-test-artifacts/sample-image-data-uri.txt)

curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": [
      {
        \"content\": [
          {\"type\": \"text\", \"text\": \"A logo image\"},
          {\"type\": \"image_url\", \"image_url\": {\"url\": \"$IMAGE_DATA_URI\"}}
        ]
      }
    ]
  }" | jq .
```

#### Audio, video, and PDF inputs

```bash
B64WAV=$(base64 -w0 audio.wav)
B64MP4=$(base64 -w0 video.mp4)
B64PDF=$(base64 -w0 doc.pdf)

# audio
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"$MODEL_SLUG\", \"input\": [{\"content\": [{\"type\": \"input_audio\", \"input_audio\": {\"data\": \"data:audio/wav;base64,$B64WAV\", \"format\": \"wav\"}}]}]}" | jq .

# video
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"$MODEL_SLUG\", \"input\": [{\"content\": [{\"type\": \"input_video\", \"input_video\": {\"data\": \"data:video/mp4;base64,$B64MP4\"}}]}]}" | jq .

# pdf / file
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"$MODEL_SLUG\", \"input\": [{\"content\": [{\"type\": \"input_file\", \"input_file\": {\"data\": \"data:application/pdf;base64,$B64PDF\"}}]}]}" | jq .
```

#### Batch multimodal

```bash
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": [
      {
        \"content\": [
          {\"type\": \"text\", \"text\": \"First document with image\"},
          {\"type\": \"image_url\", \"image_url\": {\"url\": \"https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png\"}}
        ]
      },
      {
        \"content\": [
          {\"type\": \"text\", \"text\": \"Second document, text only\"}
        ]
      }
    ]
  }" | jq .
```

### 7. Validate the response

A successful embedding response matches the OpenAI schema:

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023, -0.0091, ...]
    }
  ],
  "model": "<model>",
  "usage": {
    "prompt_tokens": <N>,
    "total_tokens": <N>,
    "cost": <number>,
    "is_byok": <boolean>,
    "cost_details": {
      "upstream_inference_prompt_cost": <number>,
      "upstream_inference_completions_cost": <number>
    }
  }
}
```

Verify:

| Check | Expected |
|-------|----------|
| `object` | `"list"` |
| `data[].object` | `"embedding"` |
| `data[].embedding` | Array of floats (or base64 string if `encoding_format: "base64"`) |
| `data[].index` | Sequential integers starting at 0 |
| `data` length | Matches number of inputs |
| `usage.prompt_tokens` | Greater than 0 |
| `usage.cost` | Number (request cost in credits) |
| `usage.is_byok` | Boolean (`true` for BYOK endpoints) |
| `usage.cost_details` | Object with `upstream_inference_prompt_cost` and `upstream_inference_completions_cost` |
| `model` | Provider-native model id (e.g. `text-embedding-3-small`, `gemini-embedding-2-preview`) — *not* the OpenRouter slug. cfw-embeddings-api does not currently rewrite this field. |
| Embedding dimension | Matches `dimensions` param if set, or model default |

For batch requests, verify each `data[]` entry corresponds
to the correct input by checking `index` ordering.

### 8. Verify billing SKUs

A 200 with sane `usage` is not enough. Multimodal billing bugs
show up as the wrong (or missing) SKU. For each gen ID, check
the transaction log:

```bash
grep -A40 '<gen-id>' services/dev-fs-logs/.logs/default/embeddings/transaction-attempt.log | grep -m1 sku_items
```

What to look for:

- Each modality bills its own SKU at its own rate:
  `text_input_tokens`, `image_input_tokens`,
  `audio_input_tokens`, `video_input_tokens`,
  `file_input_tokens`. Mixed inputs should split (e.g. image 258
  + text 2).
- `total_input_tokens` alone is a red flag: pricing strategies
  bill per-modality SKUs only, so a request with just the total
  SKU bills $0 (this was a real revenue leak on Vertex).
- `price: null` in sku_items means the local seed has no price
  for that SKU and the dev fallback price was used. A nonzero
  `cost` still proves the SKU wiring; prod attaches real rates.
- Some upstreams return no per-modality breakdown at all (e.g.
  gemini-embedding-001 `:embedContent`); the adapter should
  fall back to billing the total as text rather than $0.

### 9. Test provider routing

If the model has endpoints on multiple providers, test
provider-specific routing:

```bash
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_SLUG\",
    \"input\": \"Test provider routing\",
    \"provider\": {
      \"order\": [\"<provider-slug>\"],
      \"allow_fallbacks\": false
    }
  }" | jq .
```

### 10. Debug failures

Unlike chat completions, embeddings dev-fs-logs do not
bucket by `gen-{timestamp}-{random}`. Every embedding
request writes to the literal `default/` folder, and
back-to-back requests overwrite each other's files. Make
your request, then read immediately:

```bash
LOG_DIR=services/dev-fs-logs/.logs/default/embeddings
ls -l $LOG_DIR

cat $LOG_DIR/submit.log
cat $LOG_DIR/fetch-request.log
cat $LOG_DIR/transform-request.log
cat $LOG_DIR/transaction-attempt.log
```

The OpenAI-format finalize step (response shaping) runs
for every adapter, not just OpenAI:

```bash
cat $LOG_DIR/openai/on-finalize.log
```

#### Common issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| **400 "Model ... does not exist"** | Model not in KV cache | Run `bun run db:reset` if model is missing from DB, then refresh KV cache (step 3). Ensure the cron runs against cfw-api port 8787, not embeddings-api port 8789 |
| **404 "No endpoints found"** | Endpoint not in KV cache | Refresh cache (step 3) |
| **400 invalid_union on multimodal input** | Wrong part shape | Match `packages/embedding-interfaces/schemas/request/index.ts`: `input_video: {data}` not `video_url: {url}`, full `data:` URL not bare base64 |
| **Request bills $0** | Only `total_input_tokens` SKU emitted | Adapter must push per-modality SKUs (or bill total as text when no breakdown); see step 8 |
| **Batch input 404s upstream** | Model has no batch endpoint on that provider | Adapter should guard and return a clean 400 instead |
| **Worker dies with `read ECONNRESET` mid-run** | Unhandled socket error in the dev worker after ~10 requests | Restart embeddings-api and run your scenarios immediately in one chunk |
| **404 from upstream** | Wrong provider URL or model ID | Check `provider_model_id` and `provider_overrides.baseUrl` on the endpoint |
| **401 from upstream** | Missing or wrong API key | Ensure the provider's API key is in `services/cfw-embeddings-api/.dev.vars` (copy from `services/cfw-api/.dev.vars` if needed) |
| **400 "base64 not supported"** | Adapter rejects `encoding_format: "base64"` | Use `float` or omit `encoding_format` |
| **400 "Input must not be empty"** | Empty input array | Provide at least one input string or multimodal block |
| **400 "Unsupported input component type"** | Multimodal input sent to text-only adapter | Only the Google adapters (AI Studio, Vertex) and Nvidia support multimodal; use text-only input for other adapters |
| **Wrong embedding dimensions** | Model doesn't support `dimensions` param | Not all models support custom dimensions; omit the parameter |
| **Empty `usage.prompt_tokens`** | Adapter doesn't return token counts | Check the adapter's `transformResponse` implementation |
| **408 Timeout** | Provider API key missing | Copy `.dev.vars` from `services/cfw-api/` to `services/cfw-embeddings-api/` and set the provider key |

### 11. Run existing e2e tests

The repo has existing e2e and manual tests for embeddings:

```bash
# E2E tests (run against live Tilt stack)
cd tests/e2e && bunx vitest run api/embeddings/

# Manual tests (provider routing comparison)
cd tests/manual && bunx vitest run api/embeddings/provider-routing

# Manual tests (OpenRouter vs OpenAI comparison)
cd tests/manual && bunx vitest run api/embeddings/vs-openai
```

Use the `EmbeddingsRequestBuilder` from
`tests/e2e/fixtures/embeddings-request-factory.ts` when
writing new e2e tests:

```typescript
import { EmbeddingsRequestBuilder } from '@/fixtures';
import { callApi } from '@/utils/call-api';

// Simple text embedding
const result = await callApi('/api/v1/embeddings', {
  body: EmbeddingsRequestBuilder.simple(MODEL),
});

// Batch text embedding
const batchResult = await callApi('/api/v1/embeddings', {
  body: EmbeddingsRequestBuilder.batch(MODEL, [
    'First document',
    'Second document',
  ]),
});
```

### 12. Verify billing in prod (post-deploy)

After a billing fix or new endpoint deploys, re-verify against
prod. There are no dev-fs-logs in prod, so use the response
`usage.cost` field plus rate math instead:

```bash
curl -s https://openrouter.ai/api/v1/embeddings \
  -H "Authorization: Bearer $FUNDED_PROD_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "<slug>", "input": "...", "provider": {"order": ["<provider-slug>"], "allow_fallbacks": false}}'
```

- Use a funded prod key. Unfunded accounts 402 before reaching
  the provider.
- Sanity-check `cost == prompt_tokens x modality rate` (rates
  on the model page). A cost matching the wrong modality's
  rate (e.g. image tokens billed at the text rate) means the
  per-modality SKU breakdown was dropped.
- `cost: 0` on a 200 is the prod equivalent of the
  total-only-SKU red flag in step 8.
- Datadog transaction logs can lag several minutes behind the
  request; the cost math gives an immediate answer.
- A 404 "No endpoints found" right after (re)staging a prod
  endpoint usually means the KV cache has not picked it up
  yet; retry after a few minutes before assuming the endpoint
  is missing.

## Adapter capabilities reference

| Adapter | Text | Batch | Multimodal | base64 | Dimensions | input_type |
|---------|------|-------|------------|--------|------------|------------|
| `OpenAIEmbeddingsAdapter` | Yes | Yes | No | Yes | Yes | No |
| `AzureOpenAIEmbeddingsAdapter` | Yes | Yes | No | Yes | Yes | No |
| `NvidiaEmbeddingsAdapter` | Yes | Yes | Yes (text + image via data URI or URL) | No | Yes | Yes (`query`, `passage` only) |
| `PerplexityEmbeddingsAdapter` | Yes | Yes | No | Yes (int8 -> float32) | Yes (min 128) | No |
| `GoogleAIStudioEmbeddingsAdapter` | Yes | Yes | Yes (text + image + audio + video + PDF) | Yes (floats encoded as float32 base64) | Yes | Yes (task type mapping) |
| `GoogleVertexEmbeddingsAdapter` | Yes | Model-dependent (gemini-embedding-001 yes via `:predict`; gemini-embedding-2: adapter guards batch with clean 400, see `PROMPT_PREFIX_MODEL_IDS`) | Yes (same as AI Studio) | Yes (same as AI Studio) | Yes | Yes (task type mapping) |

## Connection details

- **DB**: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres`
- **Embeddings API**: `http://localhost:8789`
- **Auth**: `Bearer sk-or-v1-unlimitedkey`
- **Dev logs**: `http://localhost:1090` (logs in `services/dev-fs-logs/.logs/`)

## After local testing

Production verification is owned by the launch process, not this skill: see
`docs/runbooks/model-launch.md` (§3 staging/private access).

## Key source files

| File | Purpose |
|------|---------|
| `services/cfw-embeddings-api/src/app.ts` | Embeddings API Hono app and route mounting |
| `services/cfw-embeddings-api/src/routes/embeddings/submit.ts` | Embeddings submit route handler |
| `packages/embeddings/adapters/adapter-factory.ts` | Adapter registry — maps adapter names to classes |
| `packages/embeddings/adapters/base.ts` | `BaseEmbeddingsAdapter` — shared embed/transform logic |
| `packages/embeddings/adapters/openai/index.ts` | OpenAI embeddings adapter |
| `packages/embeddings/adapters/azure-openai/index.ts` | Azure OpenAI embeddings adapter |
| `packages/embeddings/adapters/google-ai-studio/index.ts` | Google AI Studio adapter (multimodal support) |
| `packages/embeddings/adapters/nvidia/index.ts` | Nvidia embeddings adapter |
| `packages/embeddings/adapters/perplexity/index.ts` | Perplexity embeddings adapter (int8 encoding) |
| `packages/embedding-interfaces/schemas/request/index.ts` | `EmbeddingsRequestInputSchema` — request validation |
| `packages/embedding-interfaces/schemas/response/index.ts` | `OpenAIEmbeddingsResponseSchema` — response validation |
| `tests/e2e/api/embeddings/` | E2E tests for embeddings |
| `tests/e2e/fixtures/embeddings-request-factory.ts` | `EmbeddingsRequestBuilder` helper |
| `tests/manual/api/embeddings/` | Manual embeddings tests (provider routing, vs OpenAI) |
