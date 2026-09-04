---
name: stage-endpoint
description: Get a model + endpoint into the local Postgres DB and test it via curl against the local cfw-api. Preferred path is prod-first via the seed CSVs; manual SQL staging is the fallback for models/adapters not yet in prod.
user-invocable: true
---

# Stage Local Endpoint

Get a model and endpoint into the local Postgres DB and test it
via the local cfw-api.

For a new embeddings/rerank provider, start with
[`embeddings-rerank-provider-onboarding`](../embeddings-rerank-provider-onboarding/SKILL.md)
before staging its endpoints.

There are two paths. **Prefer Path A** — it gives you the exact
model/endpoint rows that exist in prod, with zero hand-crafted
SQL to drift out of sync.

| Path | When to use |
|------|-------------|
| **A. Prod-first via seeds** (preferred) | The model/endpoint exists in prod, or can be created there by a human or the buddy agent |
| **B. Manual SQL staging** (fallback) | Brand-new provider/adapter not yet in prod, or a throwaway local-only experiment |

## Prerequisites

- Local Postgres running (`tilt up` or `bun run db:start`; use `TILT_PROFILE=lean tilt up` if encountering OOM)
- cfw-api running (`bun run dev cfw-api`)
- dev-fs-logs running (`bun run dev dev-fs-logs`) for debugging

## Arguments

Placeholders used throughout both paths:

- `$MODEL_SLUG`: Full model slug (e.g., `openai/gpt-4o`, `perplexity/sonar-deep-research`)
- `$PROVIDER_NAME`: Provider name as it appears in the `providers` table (e.g., `OpenAI`, `Perplexity`, `Google`)
- `$PROVIDER_MODEL_ID`: The upstream model identifier the provider expects (e.g., `gpt-4o`, `sonar-deep-research`)

## Step 0: Check what you already have

Before staging anything, check whether the model/endpoint is
already available — it often is.

```bash
# Is it in the seed CSVs on your branch?
grep '$MODEL_SLUG' postgres/seeds/models_rows.csv
grep '$PROVIDER_NAME' postgres/seeds/endpoints_rows.csv
```

```sql
-- Is it already in your local DB?
SELECT slug, permaslug, hidden FROM models WHERE slug = '$MODEL_SLUG';

SELECT provider_name, provider_model_id, hidden, is_disabled
FROM endpoints
WHERE model_permaslug IN
  (SELECT permaslug FROM models WHERE slug = '$MODEL_SLUG');
```

- **In the local DB already**: skip straight to unhiding if
  needed (A4) and the shared cache-refresh/test steps.
- **In the seeds but not the DB**: just run the seed script (A3).
- **In neither**: start at A1 (or Path B if it can't exist in
  prod yet).

## Path A: Prod-first via seeds (preferred)

The source of truth for models/endpoints is the prod DB. The repo
mirrors it through CSV seed files in `postgres/seeds/`, which a
GitHub Action keeps fresh. The flow:

```
prod DB  →  refresh-models-endpoints GH Action  →  postgres/seeds/*.csv  →  seed script  →  local DB
```

### A1. Create the model + endpoint in prod

Do NOT insert by hand locally. Instead, have the rows created in
prod first:

- **Human**: an admin creates the model/endpoint via
  mission-control.
- **Buddy agent**: the buddy agent can create models, model
  version groups, and endpoints via its `cfw-internal` routes
  (see `services/cfw-internal/README.md`).

### A2. Refresh the seed CSVs

The `Refresh Models and Endpoints` workflow
(`.github/workflows/refresh-models-endpoints.yaml`) runs
`scripts/seed/prod-get-seed-models-endpoints.ts` against the prod
DB and opens an automated PR
(branch `automated/refresh-models-endpoints`) with updated CSVs
for `models`, `endpoints`, `providers`, `model_authors`,
`model_version_groups`, `data_policies`, `pricing_versions`, and
`benchmark_results`.

- It runs daily at 13:00 UTC; if you can't wait, trigger it
  manually via `workflow_dispatch` at
  <https://github.com/OpenRouterTeam/openrouter-web/actions/workflows/refresh-models-endpoints.yaml>
  ("Run workflow").
- Merge the automated PR (or check out its branch) so your local
  checkout has the new rows in `postgres/seeds/*.csv`.

### A3. Seed the local DB

With the refreshed CSVs on your branch:

```bash
# Fresh DB (no models yet): full seed
bun run db:seed

# Already-seeded DB: upsert just models/endpoints + friends
bun run x scripts/seed/seed-models-endpoints.ts
```

`db:seed` skips entirely if the DB already has models, so use the
second command to pick up newly added rows — it upserts
(`ON CONFLICT` on `permaslug` for models, `provider_name` for
providers; `endpoints` upsert on `id`, so hand-staged Path B rows
are not replaced — delete them first) and only ever targets a
localhost connection string.

The `x` runner wraps the script in `infisical run`, so
authenticate first if you aren't already (agents: machine
identity, see AGENTS.md):

```bash
INFISICAL_TOKEN=$(infisical login \
  --method=universal-auth \
  --client-id="$INFISICAL_CLIENT" \
  --client-secret="$INFISICAL_SECRET" \
  --plain --silent) || {
  echo "infisical login failed — check INFISICAL_CLIENT / INFISICAL_SECRET" >&2
  exit 1
}
[ -n "$INFISICAL_TOKEN" ] || {
  echo "infisical login returned an empty token — check INFISICAL_CLIENT / INFISICAL_SECRET" >&2
  exit 1
}
export INFISICAL_TOKEN
```

### A4. Unhide the model/endpoint locally

Models and endpoints under active development are usually
`hidden` in prod (and therefore in the seeds), which keeps them
out of routing. Unhide them locally before testing:

```sql
UPDATE models SET hidden = false WHERE slug = '$MODEL_SLUG';

UPDATE endpoints SET hidden = false, is_disabled = false
WHERE model_permaslug = '<permaslug>'
  AND provider_name = '$PROVIDER_NAME';
```

(DB connection details are at the bottom of this doc.)

Note: re-running the seed script (A3) restores the prod
`hidden`/`is_disabled` values — re-apply this step (and refresh
the cache) after every re-seed.

Before testing, verify the model and every staged endpoint resolve an effective
`context_length_override ?? model.context_length` value > 0
(image-generation endpoints use the runtime default). A 500 with generic
`Internal Server Error` on every request is the signature of an effective
`context_length=0`.

### A5. Refresh the KV cache and test

Follow [Refresh the cache](#7-refresh-the-cache) and
[Test via curl](#8-test-via-curl) below — those steps are the
same for both paths, as is
[Debug failures](#9-debug-failures).

## Path B: Manual SQL staging (fallback)

Only use this when the model/endpoint can't exist in prod yet —
typically while developing a brand-new provider adapter. Expect
to eventually replace your hand-staged rows with seeded ones via
Path A once the provider goes live. Since the seed upserts
endpoints on `id`, the seeded rows won't overwrite hand-staged
ones — `DELETE` your hand-staged endpoints before re-seeding to
avoid duplicates.

### 1. Look up the provider

Query the local DB to confirm the provider exists and note its
`base_url` and `adapter_name`:

```sql
SELECT provider_name, base_url, adapter_name, pricing_strategy
FROM providers
WHERE provider_name = '$PROVIDER_NAME';
```

If the provider doesn't exist, it must be created first. See
the `add-provider-adapter` skill for adding new providers.

### 2. Look up or create the model author

Every model needs an `author_id` referencing `model_authors`.
The author slug is typically the first segment of the model slug
(e.g., `openai` from `openai/gpt-4o`).

```sql
SELECT id, slug FROM model_authors
WHERE slug = '<author-slug>';
```

If it doesn't exist, insert one:

```sql
INSERT INTO model_authors (slug, name)
VALUES ('<author-slug>', '<Display Name>')
ON CONFLICT (slug) DO NOTHING
RETURNING id;
```

### 3. Determine adapter behavior and endpoint URL

Before inserting, understand how the request will be routed:

- **Check the adapter class** in `packages/router/adapters/` to
  see what `provider_model_id` the upstream expects and whether
  it transforms the request in any special way.
- **Check provider URL generation** in
  `packages/providers/configs/provider-url.ts` to see if the
  provider has custom URL logic (e.g., Google appends model ID,
  Anthropic uses `/messages`, Cohere uses `/chat`).
- **Decide if `provider_overrides` is needed**: if the provider's
  `base_url` in the DB doesn't match what the adapter/URL builder
  expects, you can override it per-endpoint via
  `provider_overrides`. Allowed override fields:
  - `baseUrl` - override the provider's base URL
  - `slug` - override the provider slug
  - `adapterName` - override which adapter class to use
  - `displayName` - override the provider display name
  - `pricingStrategy` - override the pricing strategy

### 4. Insert the model

```sql
INSERT INTO models (
  created_at, updated_at, slug, name, description,
  "group", hidden, context_length, permaslug, deleted,
  author_id, input_modalities, output_modalities,
  features, default_parameters, supports_reasoning,
  quick_start_example_type
) VALUES (
  now(), now(),
  '$MODEL_SLUG',
  '<Display Name>',
  '<Short description>',
  '<Group>',                    -- e.g. 'GPT', 'Gemini', 'Claude', 'Other'
  false,
  <context_length>,             -- e.g. 128000
  '$MODEL_SLUG-<YYYYMMDD>',    -- immutable permaslug
  false,
  '<author_id>',                -- UUID from model_authors
  '{<input_modalities>}',       -- see Input Modalities below
  '{<output_modalities>}',      -- see Output Modalities below
  '<features_json>',            -- see Model Features below
  '<default_parameters_json>',  -- see Default Parameters below
  <supports_reasoning>,         -- true/false
  '<example_type>'              -- see Quick Start Example Types below
) ON CONFLICT (permaslug) DO NOTHING;
```

#### Model Fields Reference

**Input Modalities** (comma-separated in `{}`):
- `text` - text input (almost always present)
- `image` - image input (vision models)
- `video` - video input
- `audio` - audio input
- `file` - file/document input

**Output Modalities** (comma-separated in `{}`):
- `text` - text output (most models)
- `image` - image generation
- `embeddings` - embedding vectors
- `audio` - audio generation
- `video` - video generation
- `rerank` - reranking models
- `speech` - text-to-speech (TTS)
- `transcription` - speech-to-text (STT)

**Group**: Controls UI grouping. Common values:
`GPT`, `Claude`, `Gemini`, `Llama`, `Qwen3`, `Other`, etc.
Check existing models in the same family for the right group.

**Quick Start Example Types**: Controls which code example
appears on the model page:
- `reasoning` - for reasoning/thinking models
- `image_generation` - for image+text models (shows both Chat Completions and Image API tabs)
- `image_generation_without_text` - for image-only models (shows only Image API tab)
- `embeddings` - for embedding models
- `null` / omit - for standard chat models

**`permaslug`**: Convention is `<slug>-<YYYYMMDD>` using today's
date. This is the immutable identifier — the `slug` can change
but `permaslug` cannot.

**Public slug numbering**: Mirror the provider's numbering
exactly. Do not add padding the provider omitted, and do not
strip padding it used. Compare numeric tokens in the proposed
slug with the upstream `provider_model_id` and the provider's
announcement. If they disagree, reconcile the choice with a
human before staging. Check the numbering style of existing
slugs in the same family/author too. Every padded model
identifier in the catalog mirrors a padded provider identifier
(`gemini-embedding-001`, `text-embedding-ada-002`,
`gemini-2.0-flash-lite-001`, `gemini-2.0-flash-001`, and
`minimax/minimax-01` against `MiniMax-Text-01`).
`minimax/hailuo-03` was the failure case: MiniMax shipped
`MiniMax-H3` and its siblings use `minimax/hailuo-2.3`. This is
not purely cosmetic, since family extraction strips a trailing
padded number but not a plain one.

#### Model Features JSON

The `features` column is a JSON object with two optional keys:

```json
{
  "reasoning_config": { ... },
  "chat_template_config": { ... }
}
```

**`reasoning_config`** (for reasoning/thinking models):

| Field | Type | Description |
|-------|------|-------------|
| `start_token` | `string\|null` | Opening tag, e.g. `"<think>"`. Must match `<...>`. Null for models using native reasoning API. |
| `end_token` | `string\|null` | Closing tag, e.g. `"</think>"`. Must match `</...>`. |
| `is_mandatory_reasoning` | `boolean` | If true, reasoning cannot be disabled |
| `supports_reasoning_effort` | `boolean` | If true, model accepts reasoning effort parameter |
| `supported_reasoning_efforts` | `string[]` | Subset of `["none","minimal","low","medium","high","xhigh"]` |
| `default_reasoning_effort` | `string` | Default effort level when not specified |
| `default_reasoning_enabled` | `boolean` | Whether reasoning is on by default |
| `supports_reasoning_max_tokens` | `boolean` | Whether max reasoning tokens can be set |
| `reasoning_return_mechanism` | `string` | `"content_string"`, `"reasoning_content"`, or `"reasoning"` |
| `system_prompt` | `string\|null` | System prompt for reasoning |

Example for a thinking model with `<think>` tags:
```json
{
  "reasoning_config": {
    "start_token": "<think>",
    "end_token": "</think>",
    "is_mandatory_reasoning": false,
    "supports_reasoning_effort": false
  }
}
```

Example for a model with native reasoning effort:
```json
{
  "reasoning_config": {
    "start_token": null,
    "end_token": null,
    "is_mandatory_reasoning": false,
    "default_reasoning_effort": "medium",
    "default_reasoning_enabled": true,
    "supports_reasoning_effort": true,
    "supported_reasoning_efforts": ["none","low","medium","high"]
  }
}
```

**`chat_template_config`**:

| Field | Type | Description |
|-------|------|-------------|
| `should_hoist_and_merge_system_messages` | `boolean` | Whether to hoist and merge system messages |

#### Default Parameters JSON

Controls default sampling parameters. All fields nullable:

```json
{
  "top_p": null,
  "top_k": null,
  "temperature": null,
  "frequency_penalty": null,
  "presence_penalty": null,
  "repetition_penalty": null
}
```

Set values only when the model has strong defaults that differ
from the norm (e.g., `"temperature": 0.6` for Qwen models).

### 5. Insert the endpoint

> Note: the `pricing_input_prompt` / `pricing_output_completion`
> columns no longer exist on `endpoints` — all pricing lives in
> `pricing_versions` (step 6, mandatory). Inspect the live schema
> with `\d endpoints` before hand-writing an insert; this template
> can drift.

```sql
INSERT INTO endpoints (
  id, created_at, updated_at, provider_name,
  provider_model_id, hidden, quantization,
  model_permaslug, discount_from_provider,
  discount_to_user, deleted, is_deranked,
  has_completions, has_chat_completions,
  supports_reasoning, is_disabled,
  provider_overrides, features, variant,
  additional_parameters, excluded_parameters
) VALUES (
  uuidv7(), now(), now(),
  '$PROVIDER_NAME',
  '$PROVIDER_MODEL_ID',
  false,
  'unknown',                        -- see Quantization below
  '<model_permaslug>',              -- must match models.permaslug
  0, 0,
  false, false, false, true,        -- has_completions=false, has_chat_completions=true
  <supports_reasoning>,             -- match the model
  false,
  '<provider_overrides_json>',      -- see Provider Overrides below
  '<features_json>',                -- see Endpoint Features below
  'standard',                       -- see Variants below
  '<additional_parameters>',        -- see Parameters below
  '<excluded_parameters>'           -- see Parameters below
);
```

#### Endpoint Fields Reference

**Quantization**: Describes model precision.
Common values: `unknown`, `fp16`, `fp8`, `bf16`, `int8`, `int4`.

**Variant**: Static routing variant.
- `standard` - normal endpoint (most common)
- `free` - free tier endpoint
- `extended` - extended context endpoint
- `thinking` - reasoning/thinking endpoint
- `batch` - async batch endpoint (~50% of sync pricing)

**Pricing**: No per-token price columns on `endpoints` — all
pricing lives in `pricing_versions` (step 6, mandatory). Only
the discount fields (`discount_from_provider`,
`discount_to_user`) are set on the row itself.

**Rate limits** (optional):
- `limit_rpm` - requests per minute limit
- `limit_rpd` - requests per day limit

**Capacity** (optional):
- `capacity_tpm` - tokens per minute capacity
- `max_prompt_tokens` - max input tokens
- `max_completion_tokens` - max output tokens

**Provider region** (optional):
- `provider_region` - e.g. `'global'`, `'us-east-1'`

#### Provider Overrides JSON

Override provider-level settings per-endpoint. Common uses:

```json
{"baseUrl": "https://custom-endpoint.example.com/v1"}
```

Full overridable fields:
- `baseUrl` - override provider base URL
- `slug` - override provider slug
- `adapterName` - override adapter (e.g., `"AnthropicAdapter"`)
- `displayName` - override display name
- `pricingStrategy` - override pricing strategy

Set to `'{}'` when no overrides needed.

#### Endpoint Features JSON

Controls endpoint-level capability flags. Defined by
`EndpointFeaturesSchema` in `packages/db/endpoints/index.ts`:

```json
{
  "supports_tool_choice": {
    "literal_none": true,
    "literal_auto": true,
    "literal_required": true,
    "type_function": true
  },
  "supports_multipart": false,
  "supports_implicit_caching": false,
  "supports_file_urls": false,
  "supports_native_web_search": false,
  "supports_video_urls": false,
  "supports_base64_video_input": false,
  "reasoning_return_mechanism": null,
  "supported_parameters": {
    "response_format": true,
    "structured_outputs": true
  }
}
```

Set only the fields that apply. If the provider doesn't support
tool choice at all, omit `supports_tool_choice`. If certain
tool_choice modes don't work, set them to `false`:

```json
{
  "supports_tool_choice": {
    "literal_none": false,
    "type_function": false,
    "literal_required": false
  }
}
```

#### Additional & Excluded Parameters

These are Postgres text arrays controlling which parameters the
endpoint supports or blocks. They are combined with the provider's
`supported_parameters` to produce the final parameter list.

`additional_parameters` - add parameters beyond the provider
default. Examples:
```sql
'{}'                                        -- no additions
'{reasoning}'                               -- add reasoning
'{tools,tool_choice,reasoning}'             -- tool-capable staged endpoint
```

If the request will include `tools`, the endpoint's effective
supported parameters must contain `tools`/`tool_choice`, or the
routing filter rejects it with 404
`No endpoints found that support tool use.` — for a hand-staged
endpoint on a provider whose defaults don't include them, add
both to `additional_parameters`.

`excluded_parameters` - remove parameters the provider normally
supports. Examples:
```sql
'{}'                                        -- no exclusions
'{top_p,frequency_penalty}'                 -- exclude these
'{tools,tool_choice,response_format}'       -- no tool/format support
'{top_p,temperature}'                       -- exclude sampling params
```

Common parameter names: `temperature`, `max_tokens`, `top_p`,
`top_k`, `stop`, `frequency_penalty`, `presence_penalty`,
`repetition_penalty`, `seed`, `logprobs`, `top_logprobs`,
`tools`, `tool_choice`, `response_format`, `structured_outputs`,
`reasoning`.

### 6. Insert pricing version (if provider uses pricing strategy)

Some providers use SKU-based pricing via `pricing_versions`.
Check if the provider has a `pricing_strategy` set. If so,
insert a pricing version row:

```sql
INSERT INTO pricing_versions (
  id, created_at, effective_at, endpoint_id, pricing_json
) VALUES (
  uuidv7(), now(), now(),
  '<endpoint_id>',
  '<pricing_json>'
);
```

Common `pricing_json` formats:

**OpenAI-style (per-token)**:
```json
{
  "openai:prompt_tokens": "0.0000025",
  "openai:completion_tokens": "0.00001",
  "openai:cached_prompt_tokens": "0.00000125"
}
```

**Gemini-style (multi-SKU)**:
```json
{
  "gemini:prompt_tokens": "0.5e-6",
  "gemini:completion_tokens": "3e-6",
  "gemini:reasoning_tokens": "1.5e-6",
  "gemini:text_input_tokens": "0.5e-6",
  "gemini:image_input_tokens": "0.5e-6",
  "gemini:cache_read_tokens": "0.05e-6"
}
```

Gotcha: the current-pricing-version join compares `effective_at`
against a **bucketed** now (`getBucketedNow()` in
`packages/db/endpoints/hydrated-queries.ts`: 5-minute buckets,
offset by 1 minute), so a pricing row inserted with
`effective_at = now()` can be invisible to the KV warm for up to
~6 minutes. During that window the endpoint constructs with
`Failed to get public pricing from strategy: No pricing_json
available` in the api log and is force-disabled (never routed;
requests 404 with `No endpoints found`). For local staging, set
`effective_at = now() - interval '1 day'` to hydrate immediately.

## Shared steps (both paths)

### 7. Refresh the cache

The cfw-api reads models and endpoints from a Cloudflare KV
cache. After inserting or seeding data, flush and rebuild it:

```bash
rm -rf services/cfw-api/.wrangler/state/v3/kv
cd services/cfw-api && bun run test:cron
```

The `test:cron` script hits
`http://localhost:8787/__scheduled?cron=*/5+*+*+*+*`
which triggers the same cron that refreshes the
endpoints/models KV cache in production.

If cfw-api is not running yet, start it first:
```bash
bun run dev cfw-api
```

If requests still return `<slug> is not a valid model ID` after a
successful `test:cron` (the api log shows `warmKVModelsAndEndpoints
completed`), the running worker isolate is serving a stale in-memory
router config. Restart the worker (`tilt trigger api`, or restart
`bun run dev cfw-api`) and re-run `test:cron`.

Cache-refresh gotchas:

- `warmKVModelsAndEndpoints` queries ClickHouse; if the local
  ClickHouse container is down it fails with
  `Network connection lost.` and workers keep serving stale
  provider/endpoint config. Fix:
  `docker start clickhouse-clickhouse-1`, then re-run `test:cron`
  and check the api log for `warmKVModelsAndEndpoints completed`.
  On a box that never ran `tilt up`, the container does not exist
  at all — create it first:
  `cd packages/clickhouse && docker compose -f docker-compose.yaml
  -f docker-compose.lean.yaml up -d && bun run ch:migrate`.
- The same cron writes the `web_models_cache` KV key that
  `cfw-frontend-api` reads (`services/cfw-frontend-api/src/kv/web-models-cache.ts`).
  Frontend-api routes such as `/api/frontend/v1/author-models`
  return 500 with `Web models cache not found in KV` until a
  cfw-api `test:cron` run has succeeded, even though the DB rows
  are seeded. Both workers persist to `.wrangler/shared-state`, so
  no extra wiring is needed — just run cfw-api's cron once.
- Every `services/<worker>/scripts/dev.ts` defaults `WRANGLER_INSPECTOR_PORT`
  to 9229, so the second worker you start dies with
  `Address already in use (127.0.0.1:9229)`. Give it its own:
  `WRANGLER_INSPECTOR_PORT=9339 bun run dev cfw-api`. The flag
  cannot be passed through as a CLI arg.
- When restarting a worker to pick up new config, verify the
  `workerd` process actually died — killing only the
  `infisical`/`tsx`/`wrangler` wrappers leaves
  `workerd ... --socket-addr=entry=localhost:<port>` serving the
  old isolate. `kill -9 $(pgrep -f "entry=localhost:<port>")` if
  needed, then start fresh.

### 8. Test via curl

#### Chat completions

```bash
curl -s http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_SLUG",
    "messages": [
      {"role": "user", "content": "Say hello"}
    ],
    "max_tokens": 50
  }'
```

#### Embeddings

Embeddings are served by `cfw-embeddings-api` on port **8789**
(start with `bun run dev cfw-embeddings-api`), not the main
cfw-api port.

```bash
curl -s http://localhost:8789/api/v1/embeddings \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_SLUG",
    "input": "Hello world"
  }'
```

#### Video generation

Video routes (`/api/v1/videos`) are served by `cfw-video-api` on
port **8788** (start with `bun run dev cfw-video-api`), not
cfw-api. It reads the same shared-state KV, so the cache-refresh
steps above still run through cfw-api's `test:cron`. Two extra
dependencies:

- Submissions work standalone, but `GET /api/v1/videos/{id}`
  (status/polling) calls the `usage-record` worker, which needs
  the Spanner emulator: `bun run dev usage-record` plus
  `docker start dev-spanner-1` and (on a fresh emulator)
  `cd services/usage-record && bun run spanner:migrate`.
- To capture the exact upstream headers an adapter sends (e.g.
  provider attribution headers), point the provider's `base_url`
  at a tiny local `Bun.serve` echo server, re-warm KV, and restart
  `cfw-video-api`; wrangler dev can reach localhost.

Pin a specific provider (essential when the model has endpoints
on several providers and you're testing one adapter):

```json
"provider": {"order": ["google-vertex"], "allow_fallbacks": false}
```

For deeper embeddings testing (batch vs non-batch modes,
multimodal inputs, billing SKU verification), use the
`embeddings-e2e-testing` skill.

#### With streaming

```bash
curl -s http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_SLUG",
    "messages": [
      {"role": "user", "content": "Say hello"}
    ],
    "stream": true,
    "max_tokens": 50
  }'
```

#### With reasoning

```bash
curl -s http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_SLUG",
    "messages": [
      {"role": "user", "content": "What is 2+2?"}
    ],
    "reasoning": {"effort": "medium"}
  }'
```

#### With tools

```bash
curl -s http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "$MODEL_SLUG",
    "messages": [
      {"role": "user", "content": "What is the weather in SF?"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}
      }
    }]
  }'
```

### 9. Debug failures

Check dev-fs-logs for the latest request:

```bash
# List recent generation folders
ls -lt services/dev-fs-logs/.logs/ | head -5

# Check routing decisions
cat services/dev-fs-logs/.logs/<gen-id>/router/routing/step.log

# Check the outgoing provider request (URL + body only — outgoing
# HTTP headers are NOT logged; see the header-capture note below)
cat services/dev-fs-logs/.logs/<gen-id>/adapters/base-fetch-request.log

# Check provider response / errors
cat services/dev-fs-logs/.logs/<gen-id>/adapters/fetch-error.log
cat services/dev-fs-logs/.logs/<gen-id>/adapters/base-stream-event.log

# Check skin-level response transformation
cat services/dev-fs-logs/.logs/<gen-id>/skins/openai-chat-completions/response-json.log

# For embeddings
cat services/dev-fs-logs/.logs/<gen-id>/embeddings/submit.log
cat services/dev-fs-logs/.logs/<gen-id>/embeddings/fetch-request.log
```

#### Common issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| **404 "No endpoints found"** | Endpoint not in KV cache | Refresh cache (step 7) or restart cfw-api |
| **404 from upstream** | Wrong provider URL | Check if `provider_overrides.baseUrl` is needed. Compare with `provider-url.ts` |
| **401 from upstream** | Missing or wrong API key | Check `.env.development.local` for the provider's API key |
| **400 from upstream** | Bad request format | Check adapter's `transformRequest()` — the `provider_model_id` or request body may be wrong |
| **"No successful provider responses"** | Endpoint exists but request failed | Check `adapters/fetch-error.log` for the upstream error |
| **500 from upstream** | Model not live or format issue | Verify the model is available upstream; check adapter logs |
| **Wrong adapter used** | Adapter mismatch | Check provider's `adapter_name` in DB. Override via `provider_overrides.adapterName` if needed |
| **Parameters rejected** | Unsupported params sent | Add to `excluded_parameters` on the endpoint |
| **Tools not working** | Tool support not configured | Set `features.supports_tool_choice` and ensure `tools`/`tool_choice` not in `excluded_parameters` |
| **Endpoint disappears after KV warm cron** | `pricing_versions` row missing or not yet effective under the bucketed now when cron ran (endpoint force-disabled as invalid pricing) | Insert endpoint + pricing_versions together with a backdated `effective_at`, THEN trigger the cron; restart the worker (`tilt trigger api`) if it still 404s |
| **404 "available_providers" omits your regional endpoint** (e.g. `amazon-bedrock/us-west-2` staged but only `xai` listed) | The **Regional Surcharge filter** (`packages/routing/filters/by-regional-surcharge.ts`) drops region-slugged endpoints (Bedrock/Vertex/Azure regional rows) on global data-region requests, and a *bare* base slug in `provider.only` (e.g. `amazon-bedrock`) does **not** exempt them | Pin the full regional slug in the request: `"provider": {"only": ["amazon-bedrock/us-west-2"]}` |
| **Endpoint visible via `curl localhost:8788/model-config?permaslug=...` but cfw-api still 404s** | cfw-api's in-isolate router-config cache (5-min TTL) and cfw-kv-cache's in-memory SWR cache are stale even though shared-state KV is fresh | After `test:cron`, restart **both** cfw-kv-cache (`cd services/cfw-kv-cache && bun run start` — note the script is `start`, not `dev`) and cfw-api. Start cfw-api first (it needs ports 8787 + inspector 9229), then cfw-kv-cache (8788); both must use `--persist-to ../../.wrangler/shared-state` (their default scripts do) or they will not share KV |
| **KV `__scheduled` cron warm silently keeps stale endpoint data** | ClickHouse (`packages/clickhouse/docker-compose.yaml` service `clickhouse`, :8123) is down — the warm job's analytics queries fail (`Network connection lost`) and the KV write is aborted, without a loud error | Start ClickHouse (`docker compose -f packages/clickhouse/docker-compose.yaml up -d clickhouse`, confirm `curl localhost:8123/ping` → `Ok`), re-run `curl 'localhost:8787/__scheduled?cron=*/5+*+*+*+*'`, then verify the flag/endpoint actually changed in `localhost:8788/kv/all` before trusting metadata-dependent tests |
| **Behavior doesn't change after editing `packages/router` (or other package) source while `wrangler dev` is running** | wrangler dev's watcher does not reliably rebuild on cross-package source changes (e.g. restoring a file via `git checkout`) — the worker keeps serving the old bundle | Restart cfw-api after any package-level source change, and confirm with a behavior-discriminating request rather than trusting hot reload |

#### Verifying outgoing request headers

`adapters/base-fetch-request.log` records the upstream URL and
body but not the headers (`getHeaders` output isn't logged). To
assert headers at runtime (e.g. `anthropic-version` present,
`anthropic-beta`/`x-api-key` absent), temporarily point the
endpoint's `provider_overrides.baseUrl` at a tiny local HTTP
server that records `req.headers` (redact auth values!) and
replies with a minimal valid response/SSE stream for the wire
shape, re-warm KV, restart the worker, send the request, then
restore the real baseUrl. wrangler dev can reach localhost.

### 10. Verify and iterate

After a successful response:

1. Check the response format matches expectations
2. Verify token counts and pricing are reasonable
3. Test edge cases (streaming, tool calls, reasoning toggle)
4. If the model is a reasoning model, verify reasoning tokens
   appear correctly in the response

To update the endpoint after initial insertion:

```sql
UPDATE endpoints
SET features = '<new_features_json>',
    excluded_parameters = '{param1,param2}'
WHERE provider_name = '$PROVIDER_NAME'
  AND model_permaslug = '<permaslug>';
```

Then refresh the cache again (step 7).

## Connection details

- **DB**: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres`
- **API**: `http://localhost:8787`
- **Auth**: `Bearer sk-or-v1-unlimitedkey`
- **Dev logs**: `http://localhost:1090` (logs written to `services/dev-fs-logs/.logs/`)

## Key source files

| File | Purpose |
|------|---------|
| `packages/db/kysely-types.gen.d.ts` | Generated DB types — `Models`, `Endpoints`, `Providers` interfaces |
| `packages/db/endpoints/index.ts` | `EndpointFeaturesSchema` — all endpoint feature flags |
| `packages/models/model-info/index.ts` | `ReasoningConfigSchema`, `ModelFeaturesSchema`, `DefaultParametersSchema` |
| `packages/providers/configs/provider-url.ts` | Provider URL generation logic (how base URL + model ID become the upstream URL) |
| `packages/routing/endpoints/constructor.ts` | How DB rows become runtime `Endpoint` objects (shows how `provider_overrides` are applied) |
| `packages/db/providers/index.ts` | `ProviderInfoOverridesSchema` — what fields can be overridden per-endpoint |
| `packages/router/adapters/` | Adapter classes — controls request/response transformation per provider |
| `postgres/seeds/` | Seed CSV files — prod mirror used by Path A (also useful reference data for Path B) |
| `scripts/seed/prod-get-seed-models-endpoints.ts` | Exports prod tables to the seed CSVs (run by the refresh GH Action) |
| `scripts/seed/seed-models-endpoints.ts` | Imports the seed CSVs into the local DB (upsert, localhost-only) |
| `.github/workflows/refresh-models-endpoints.yaml` | Daily/dispatchable Action that refreshes seed CSVs and opens the automated PR |
