---
name: audio-stage-endpoint
description: "Phase 3: stage and verify a speech-to-text (STT) or text-to-speech (TTS) endpoint locally in Postgres, KV, and its worker. Sub-skill of audio-provider-onboarding."
user-invocable: true
---

## Shared staging policy

Stage the provider, model, endpoint, pricing version, and modality KV entry in local Postgres/KV. Reconcile staged pricing with the research note and verify a live request through the modality worker, including generation id, usage, cost, and dev-fs-logs evidence. Keep the worker under test and its port explicit; do not proceed after a failed billing or routing check.

## STT

Stage a new speech-to-text (STT) model and endpoint in the
local Postgres DB and test it via the local cfw-stt-api worker.

### Prerequisites

- Start the stack using [local-dev-env](../local-dev-env/SKILL.md).
- Confirm `api-kv-cron` and `stt-api` are Ready before testing.

### Dependency Order

1. Run `bun run dev:up` from the repository root.
2. Wait for auto-init resources:
   ```bash
   tilt wait --for=condition=Ready \
     uiresource/postgres uiresource/postgres-migrate \
     uiresource/postgres-seed uiresource/clickhouse \
     uiresource/clickhouse-migrate uiresource/api \
     uiresource/api-kv-cron --timeout=300s
   ```
3. Start stt-api if it is not already running:
   ```bash
   tilt enable stt-api && tilt trigger stt-api
   tilt wait --for=condition=Ready uiresource/stt-api --timeout=120s
   ```
4. **Insert DB rows** — models, endpoints, pricing_versions
   (steps 1–6). Seed data may already exist; check first.
5. **Refresh KV** — trigger the cron to pick up new DB rows:
   ```bash
   curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
   ```
6. **Enrich KV with `pricing_json`** — the cron does NOT
   include `pricing_json` on endpoint objects in KV, so
   `computeSTTUsageResponse` can't calculate costs. Run the
   KV enrichment script (step 7) to add `pricing_json` so
   that `usage.cost` is populated in responses.

Workers share KV through `.wrangler/shared-state`; Tilt supplies the persist path.

### Arguments

- `$MODEL_SLUG`: Full model slug (e.g., `openai/whisper-1`)
- `$PROVIDER_NAME`: Provider name as in the `providers` table (e.g., `OpenAI`)
- `$PROVIDER_MODEL_ID`: Upstream model identifier used by the provider (e.g., `whisper-1`)

### Steps

#### 1. Look up the provider

```sql
SELECT provider_name, base_url, adapter_name, pricing_strategy
FROM providers
WHERE provider_name = '$PROVIDER_NAME';
```

#### 2. Look up or create the model author

```sql
SELECT id, slug FROM model_authors
WHERE slug = '<author-slug>';
```

If missing:
```sql
INSERT INTO model_authors (slug, name)
VALUES ('<author-slug>', '<Display Name>')
ON CONFLICT (slug) DO NOTHING
RETURNING id;
```

#### 3. Understand STT adapter URL construction

`BaseSTTAdapter.getUrl()` in `packages/stt/adapters/base.ts`
builds the upstream URL as:
```text
${endpoint.provider_info.baseUrl}/audio/transcriptions
```

The adapter always appends `/audio/transcriptions` to whatever
`baseUrl` resolves to. `provider_info.baseUrl` is determined by:
1. The provider's `base_url` column in the `providers` table
2. Overridden per-endpoint via `provider_overrides.baseUrl`
   (if set on the endpoint row)

**CRITICAL**: The `baseUrl` must be the provider's *base API
path only* — it must NOT include `/audio/transcriptions`.
If it does, the adapter produces a double-path like
`<baseUrl>/audio/transcriptions/audio/transcriptions` → 404.

To verify for a given provider, check the provider's
`base_url` in the DB (step 1). If the provider's DB
`base_url` already ends with a modality-specific path, set
`provider_overrides.baseUrl` on the endpoint to override it
to just the base path.

#### 4. Insert the model

STT models use `output_modalities: {transcription}` and
`input_modalities: {audio}`:

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
  '<Group>',
  false,
  0,                              -- context_length: 0 for STT models
  '$MODEL_SLUG-<YYYYMMDD>',
  false,
  '<author_id>',
  '{audio}',                      -- input: audio
  '{transcription}',              -- output: transcription
  '{}',                           -- no reasoning/chat_template features
  '{}'::jsonb,                    -- default_parameters: NOT NULL, use '{}'::jsonb (never null)
  false,                          -- no reasoning support
  null                            -- no quick start example
) ON CONFLICT (permaslug) DO NOTHING;
```

#### 5. Insert the endpoint

STT endpoints need a pricing strategy set via
`provider_overrides.pricingStrategy`. All pricing is now in
the `pricing_versions.pricing_json` SKU map; the legacy flat
pricing columns (`pricing_input_prompt`,
`pricing_output_completion`, etc.) were dropped from the
`endpoints` table in migration
`20260417181849_drop_flat_pricing_columns_from_endpoints.sql`.
Do not reference them.

**Where does `pricingStrategy` live?** On the
`endpoints.provider_overrides` JSONB, NOT on the `providers`
row. The provider row only carries adapter-level config
(base URL, adapter name). Two endpoints for the same provider
can use different strategies via per-endpoint overrides.
Misreading this is the #1 cause of "my strategy resolves in
unit tests but not in the API path."

**Choose the correct `pricingStrategy` for the provider:**

| Provider | `pricingStrategy` | Enum | SKU keys |
|----------|-------------------|------|----------|
| OpenAI | `"openai_stt"` | `PricingStrategyName.OpenAISTT` | `openai_stt:audio_minutes`, `openai_stt:input_tokens`, `openai_stt:output_tokens` |
| Google Cloud | `"google_cloud_stt"` | `PricingStrategyName.GoogleCloudSTT` | `google_cloud_stt:audio_minutes` |
| Groq | `"groq_stt"` | `PricingStrategyName.GroqSTT` | `groq_stt:audio_hours` |
| Alibaba | `"alibaba_stt"` | `PricingStrategyName.AlibabaSTT` | `alibaba_stt:audio_seconds` |
| Mistral | `"mistral_stt"` | `PricingStrategyName.MistralSTT` | `mistral_stt:audio_minutes` |
| Microsoft | `"microsoft_stt"` | `PricingStrategyName.MicrosoftSTT` | `microsoft_stt:audio_hours` |

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
  'unknown',
  '<model_permaslug>',
  0, 0,
  false, false,
  false,                          -- has_completions: false
  false,                          -- has_chat_completions: false (STT, not chat)
  false,
  false,                          -- is_disabled: false
  '{"pricingStrategy": "<strategy>", "baseUrl": "<provider-base-url>"}',
  -- pricingStrategy: see table above (must match the provider's adapter)
  -- baseUrl: the provider's base API path (see step 3)
  '{}',
  'standard',
  '{}',
  '{}'
)
RETURNING id;
```

Note the `provider_overrides`:
- `pricingStrategy`: must match the provider's adapter
  (see table above). Each strategy uses different SKU keys
  in `pricing_json` (step 6). Using the wrong strategy
  causes `computeSTTUsageResponse` to fail or return null.
- `baseUrl`: set this if the provider's DB `base_url` doesn't
  match what the STT adapter expects (see step 3). Omit if
  the provider's `base_url` is already correct.

#### 6. Insert pricing version

STT uses SKU-based pricing via `pricing_versions`. Each
pricing strategy has its own SKU keys — you must use the
correct keys for the provider's `pricingStrategy` (step 5).

**Pre-staging pricing gate.** Before inserting:

- Rates must come from the provider's primary source (URL + date in the
  research note), for the API mode the adapter uses (e.g. pre-recorded,
  not streaming). Never copy rates from a PR description or an older
  doc — they go stale. If the rate can't be verified, stop and escalate
  to the invoker per
  [`audio-research-provider`](../audio-research-provider/SKILL.md) §A.2.
- Include **every** SKU the strategy can select, including ones driven by
  request-level modifiers (e.g. `<slug>_stt:audio_minutes_multilingual`
  for a multilingual param). A missing SKU silently bills the fallback rate
  and records null per-SKU prices in `sku_items`.
- If a modifier SKU's rate genuinely isn't published, staging on the
  strategy's fallback is acceptable with the paper trail required by
  §A.2 and [`audio-add-adapter`](../audio-add-adapter/SKILL.md). Never
  stage a guessed rate to avoid the fallback.

##### OpenAI STT SKUs (`pricingStrategy: "openai_stt"`)

SKUs defined in `packages/pricing/strategies/stt/skus.ts`:

| SKU | Key | Description |
|-----|-----|-------------|
| Audio minutes | `openai_stt:audio_minutes` | Per-minute cost (duration-based billing) |
| Input tokens | `openai_stt:input_tokens` | Per-token cost (token-based billing) |
| Output tokens | `openai_stt:output_tokens` | Per-token cost (token-based billing) |

**Duration-based billing** (billed per audio minute, e.g.,
OpenAI Whisper at $0.006/min):
```sql
INSERT INTO pricing_versions (
  id, created_at, effective_at, endpoint_id, pricing_json
) VALUES (
  uuidv7(), now(), now(),
  '<endpoint_id>',
  '{"openai_stt:audio_minutes": "0.006", "openai_stt:input_tokens": "0", "openai_stt:output_tokens": "0"}'
);
```
Set `openai_stt:audio_minutes` to the provider's per-minute
cost. The adapter returns `usage.seconds` which is converted
to minutes for billing.
Example: 3 seconds of audio → `cost = (3 / 60) × 0.006 = 0.0003`

**Token-based billing** (billed per input/output token, e.g.,
OpenAI gpt-4o-transcribe at $2.50/M input, $10/M output):
```sql
INSERT INTO pricing_versions (
  id, created_at, effective_at, endpoint_id, pricing_json
) VALUES (
  uuidv7(), now(), now(),
  '<endpoint_id>',
  '{"openai_stt:audio_minutes": "0", "openai_stt:input_tokens": "0.0000025", "openai_stt:output_tokens": "0.00001"}'
);
```
Example: 20 input tokens + 4 output tokens →
`cost = (20 × 0.0000025) + (4 × 0.00001) = 0.00009`

**Billing mode** is either **duration-based** or
**token-based**, determined by the pricing config:

- `OpenAISTTPricingStrategy` in
  `packages/pricing/strategies/stt/strategy.ts` checks
  whether `openai_stt:input_tokens` or
  `openai_stt:output_tokens` is > 0. If so, billing is
  **token-based**; otherwise it is **duration-based**
  (using `openai_stt:audio_minutes`).
- `OpenAISTTAdapter.isDurationBased()` in
  `packages/stt/adapters/openai/index.ts` mirrors this
  check. When duration-based it sets
  `response_format: verbose_json` (to get `usage.seconds`
  from the provider); when token-based it sets
  `response_format: json`.

##### Google Cloud STT SKUs (`pricingStrategy: "google_cloud_stt"`)

SKUs defined in `packages/pricing/strategies/stt/google-cloud-skus.ts`:

| SKU | Key | Description |
|-----|-----|-------------|
| Audio minutes | `google_cloud_stt:audio_minutes` | Per-minute cost (duration-based only) |

Google Cloud STT is always duration-based. Google rounds
`totalBilledDuration` up to the nearest second; no minimum.

```sql
INSERT INTO pricing_versions (
  id, created_at, effective_at, endpoint_id, pricing_json
) VALUES (
  uuidv7(), now(), now(),
  '<endpoint_id>',
  '{"google_cloud_stt:audio_minutes": "0.016"}'
);
```
Example: 3 seconds of audio → `cost = (3 / 60) × 0.016 = 0.0008`

##### Groq STT SKUs (`pricingStrategy: "groq_stt"`)

SKUs defined in `packages/pricing/strategies/stt/groq-skus.ts`:

| SKU | Key | Description |
|-----|-----|-------------|
| Audio hours | `groq_stt:audio_hours` | Per-hour cost (duration-based only) |

Groq STT bills per audio hour with a 10-second minimum
(`GROQ_MIN_BILLED_SECONDS = 10`).

```sql
INSERT INTO pricing_versions (
  id, created_at, effective_at, endpoint_id, pricing_json
) VALUES (
  uuidv7(), now(), now(),
  '<endpoint_id>',
  '{"groq_stt:audio_hours": "0.11"}'
);
```
Example: 60 seconds of audio → `cost = (60 / 3600) × 0.11 = 0.00183`

##### Generic STT provider SKUs (`pricingStrategy: "<slug>_stt"`)

This subsection is the template for any STT provider not already
listed above. Most STT providers bill duration-based (per second,
per minute, or per hour of audio); a small number bill token-based
(input + output tokens of the transcription transcript). Pick the
billing mode the provider's `usage` payload tells you to use.

SKUs are declared in `packages/pricing/strategies/stt/<slug>-skus.ts`.
The SKU key encodes the **canonical** billing unit your pricing
strategy operates in — pick the unit the provider's publicly-quoted
rate is in (`$X / second`, `$X / minute`, `$X / hour`). The
adapter's `getUsage()` is responsible for converting upstream
`usage.seconds` into that same canonical unit before handing it
to the strategy (`MistralSTTAdapter.getUsage` in
`packages/stt/adapters/mistral/index.ts` is the reference
for a per-minute canonical: `bn(billing.audioDurationSeconds ?? 0).div(60)`).
The SKU key, the `sku_label`, the `unitLabel`, and the price-card
fragment all line up on the SAME unit.

Every duration-based STT strategy in the codebase today uses
`displayMultiplier: 1` — the canonical unit and the display unit
match. The `displayMultiplier` mechanism is only used to translate
token-pricing canonical (per-token) into a friendlier display
(`/M tokens` via `displayMultiplier: 1_000_000`). Do NOT introduce
a non-`1` duration multiplier expecting the UI to convert seconds
into minutes for you — that would silently 60× the displayed price
and misrepresent the model to every developer who clicks it.

**Pattern A — duration-based** (per second / per minute / per hour;
the canonical unit is the unit you want displayed on the model card):

| SKU | Key | When to use |
|-----|-----|-------------|
| Audio seconds | `<slug>_stt:audio_seconds` | Provider quotes pricing in `$ / second` (e.g. Alibaba) |
| Audio minutes | `<slug>_stt:audio_minutes` | Provider quotes pricing in `$ / minute` (e.g. OpenAI Whisper, Google Cloud, Mistral) |
| Audio hours | `<slug>_stt:audio_hours` | Provider quotes pricing in `$ / hour` (e.g. Groq) |

The strategy's `getPublicPricing` returns a single `DisplayPricingItem`
with `sku_label: 'Audio <Unit>'`, `unitLabel: 'per <unit>'`, and
`displayMultiplier: 1`. The `getFinalUsageResponse` multiplies
`reducedSKUItems.get(<slug>_stt:audio_<unit>)` by
`pricing[<slug>_stt:audio_<unit>]` directly — no conversion at the
strategy layer.

```sql
INSERT INTO pricing_versions (
  id, created_at, effective_at, endpoint_id, pricing_json
) VALUES (
  uuidv7(), now(), now(),
  '<endpoint_id>',
  '{"<slug>_stt:audio_<unit>": "<cost_per_unit>"}'
);
```
Example: provider quotes `$0.003 / min`, choose `audio_minutes` as
the canonical SKU, set `cost_per_unit = 0.003`. The adapter must
divide `audioDurationSeconds / 60` in `getUsage()` so the strategy
sees the duration in minutes.

If the provider applies a billing floor (e.g. sub-second clips
bill as N seconds), declare a `<SLUG>_STT_MIN_BILLED_SECONDS` constant
in the SKU file and enforce it in **both** the adapter's
`getResponseUsageSeconds` (so the OR response shows the clamped
value) **and** the strategy's `getFinalUsageResponse` (so billing
matches the response). When the canonical unit is minutes or
hours, convert the floor (e.g. `bn(MIN_BILLED_SECONDS).div(60)` for
a minutes-canonical strategy — see `minBilledMinutes` in
`packages/pricing/strategies/stt/mistral-strategy.ts`). Dual-clamp
is non-negotiable — single-side clamping causes the response and
the billed cost to disagree.

**Pattern B — token-based** (rare; use only when the provider bills
on transcript token counts, e.g. OpenAI `gpt-4o-transcribe`):

| SKU | Key | Description |
|-----|-----|-------------|
| Input tokens | `<slug>_stt:input_tokens` | Per-token input cost (displayed as `/M tokens` via `displayMultiplier: 1_000_000`) |
| Output tokens | `<slug>_stt:output_tokens` | Per-token output cost (displayed as `/M tokens` via `displayMultiplier: 1_000_000`) |

When following pattern B, set the duration SKU to `"0"` and have
the strategy switch billing modes by checking whether either token
SKU is non-zero — the OpenAI STT subsection above shows the full
`isDurationBased()` switch including the `response_format` toggle
the adapter needs to request the right `usage` shape upstream.

**Reference instantiation (Mistral)**: pattern A with canonical unit
`audio_minutes`, SKU key `mistral_stt:audio_minutes`, 1-second floor
(stored as `bn(1).div(60)` minutes), `cost_per_unit = 0.003`
(quoted publicly as `$0.003 / minute`). The adapter converts
seconds to minutes in `getUsage()`. See
`packages/pricing/strategies/stt/mistral-skus.ts` and
`packages/pricing/strategies/stt/mistral-strategy.ts` for the full
file layout your `<slug>-skus.ts` and `<slug>-strategy.ts` should
mirror.

##### Duration-based STT strategies in the codebase today

This table lists the actual canonical-unit + display-unit pairings
defined in `packages/pricing/strategies/stt/*-strategy.ts`. Every
row uses `displayMultiplier: 1` — the canonical unit IS the display
unit. Use it as ground truth when choosing the canonical unit for
a new provider:

| Provider | Canonical SKU | Floor | `sku_label` | `unitLabel` | `displayMultiplier` |
|----------|---------------|-------|-------------|-------------|---------------------|
| Alibaba | `alibaba_stt:audio_seconds` | 1s | `Audio Seconds` | `per second` | `1` |
| OpenAI (Whisper) | `openai_stt:audio_minutes` | — | `Audio Minutes` | `per minute` | `1` |
| Google Cloud | `google_cloud_stt:audio_minutes` | — | `Audio Minutes` | `per minute` | `1` |
| Mistral | `mistral_stt:audio_minutes` | 1s | `Audio Minutes` | `per minute` | `1` |
| Groq | `groq_stt:audio_hours` | 10s | `Audio Hours` | `per hour` | `1` |
| Microsoft | `microsoft_stt:audio_hours` | 1s | `Audio Hours` | `per hour` | `1` |

The SKU key reflects the unit the strategy operates in — the
marketplace UI surfaces it verbatim. Do not change SKU keys to
match a different display unit, and do not introduce a non-`1`
`displayMultiplier` for duration-based pricing.

##### Reference pricing (from production seeds)

| Model | Strategy | SKU | Price |
|-------|----------|-----|-------|
| `openai/whisper-1` | `openai_stt` | `openai_stt:audio_minutes` | `0.006` ($0.006/min) |
| `openai/gpt-4o-transcribe` | `openai_stt` | `openai_stt:input_tokens` | `0.0000025` ($2.50/M tokens) |
| `openai/gpt-4o-transcribe` | `openai_stt` | `openai_stt:output_tokens` | `0.00001` ($10/M tokens) |
| `google/chirp-3` | `google_cloud_stt` | `google_cloud_stt:audio_minutes` | `0.016` ($0.016/min) |
| `groq/whisper-large-v3` | `groq_stt` | `groq_stt:audio_hours` | `0.11` ($0.11/hr) |
| `mistralai/voxtral-mini-transcribe` | `mistral_stt` | `mistral_stt:audio_minutes` | `0.003` ($0.003/min) |
| `microsoft/mai-transcribe-1.5` | `microsoft_stt` | `microsoft_stt:audio_hours` | `1.00` ($1.00/hr) |

#### 7. Seed the KV cache

The STT worker reads models/endpoints from a shared KV store.
The KV key is `modality_transcription`.

##### Option A: Direct KV write (required without Tilt, or to add `pricing_json`)

The cfw-api cron populates KV from the DB but does **not**
include `pricing_json` on endpoint objects. Without
`pricing_json`, `computeSTTUsageResponse` returns null and
`usage.cost` is missing from responses.

Use a tsx script to build KV data with `pricing_json` included.

**Pick the correct `PRICING_STRATEGY` and `PRICING_JSON`
for the provider** — the script auto-selects the right SKU
keys based on the pricing strategy.

```bash
cd /path/to/openrouter-web && npx tsx -e "
import { createMockModelInfo } from './packages/models/test/mock-model.ts';
import { createMockModelEndpoint } from './packages/providers/test/mock-endpoint.ts';
import { OutputModality, InputModality } from './packages/enums/model/modality.ts';

// ── Configuration ──────────────────────────────────────
// Set these to match your provider (see step 5 table)
const PRICING_STRATEGY = '<strategy>';  // 'openai_stt' | 'google_cloud_stt' | 'groq_stt'

// Set pricing_json to match the strategy's SKUs (see step 6)
// Each strategy has DIFFERENT keys — using the wrong keys
// causes computeSTTUsageResponse to return null (no cost).
const PRICING_JSON_BY_STRATEGY: Record<string, Record<string, number>> = {
  openai_stt: {
    'openai_stt:audio_minutes': 0.006,       // whisper: \$0.006/min
    'openai_stt:input_tokens': 0,            // 0 for duration-based
    'openai_stt:output_tokens': 0,           // 0 for duration-based
  },
  google_cloud_stt: {
    'google_cloud_stt:audio_minutes': 0.016, // chirp: \$0.016/min
  },
  groq_stt: {
    'groq_stt:audio_hours': 0.11,            // groq whisper: \$0.11/hr
  },
  microsoft_stt: {
    'microsoft_stt:audio_hours': 1.00,       // MAI-Transcribe: \$1.00/hr
  },
};

// For token-based OpenAI models (e.g. gpt-4o-transcribe),
// override like this:
// PRICING_JSON_BY_STRATEGY.openai_stt = {
//   'openai_stt:audio_minutes': 0,
//   'openai_stt:input_tokens': 0.0000025,   // \$2.50/M tokens
//   'openai_stt:output_tokens': 0.00001,    // \$10/M tokens
// };

const pricingJson = PRICING_JSON_BY_STRATEGY[PRICING_STRATEGY];
if (!pricingJson) throw new Error('Unknown PRICING_STRATEGY: ' + PRICING_STRATEGY);
// ── End Configuration ──────────────────────────────────

const model = createMockModelInfo('\$MODEL_SLUG', {
  name: '<Display Name>',
  input_modalities: [InputModality.Audio],
  output_modalities: [OutputModality.Transcription],
  context_length: 0,
  hidden: false,
});

const endpoint = createMockModelEndpoint('\$MODEL_SLUG', {
  providerName: '\$PROVIDER_NAME',
  providerModelId: '\$PROVIDER_MODEL_ID',
  pricingStrategy: PRICING_STRATEGY,
});
endpoint.provider_model_id = '\$PROVIDER_MODEL_ID';
endpoint.model_permaslug = '\$MODEL_SLUG';
endpoint.model_variant_permaslug = '\$MODEL_SLUG';
endpoint.model_variant_slug = '\$MODEL_SLUG';
endpoint.model = model;
endpoint.provider_overrides = { pricingStrategy: PRICING_STRATEGY, baseUrl: '<provider-base-url>' };
endpoint.provider_info = {
  ...endpoint.provider_info,
  baseUrl: '<provider-base-url>',
  name: '\$PROVIDER_NAME',
  displayName: '\$PROVIDER_NAME',
  slug: '<provider-slug>',
  pricingStrategy: PRICING_STRATEGY,
};
endpoint.pricing_json = pricingJson;

import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/kv_transcription.json', JSON.stringify({
  models: [model],
  endpoints: [endpoint],
}));
console.log('KV data written with', PRICING_STRATEGY, 'pricing:', JSON.stringify(pricingJson));
"

# Write to local KV
cd services/cfw-stt-api && npx wrangler kv key put \
  "modality_transcription" "\$(cat /tmp/kv_transcription.json)" \
  --binding KV_MODELS_AND_ENDPOINTS --local \
  --persist-to ../../.wrangler/shared-state
```

**Important**: `pricing_json` on the endpoint object controls
billing. Without it, `computeSTTUsageResponse` returns null
and `usage.cost` is missing. The SKU keys in `pricing_json`
must match the `pricingStrategy` — e.g. `google_cloud_stt`
endpoints must use `google_cloud_stt:audio_minutes`, not
`openai_stt:audio_minutes`. For `openai_stt` specifically,
`pricing_json` also controls the adapter's billing mode
(`isDurationBased()`): if `input_tokens` or `output_tokens`
is > 0, the adapter uses token-based billing and sets
`response_format: json` instead of `verbose_json`.

##### Option B: cfw-api cron (Tilt only — populates KV but no pricing_json)

```bash
curl -s "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

This rebuilds all modality KV entries including transcription.
**Note:** The cron-populated KV data does NOT include
`pricing_json`, so `usage.cost` will be missing. Follow up
with Option A to enrich the KV with pricing data if you need
cost calculation.

##### After seeding

If services are already running, restart stt-api to clear the
FetchDeduper cache (5-minute TTL):
```bash
# Kill and restart stt-api
cd services/cfw-stt-api && bunx wrangler dev --port 8792 \
  --persist-to ../../.wrangler/shared-state
```

#### 8. Test via curl

The STT worker runs on port **8792** (default in Tiltfile).

##### Basic transcription (base64 audio)

```bash
# Generate a small test WAV file
python3 -c "
import struct, base64
sr=16000; dur=3; samples=sr*dur
data = struct.pack('<'+('h'*samples), *[0]*samples)
hdr = struct.pack('<4sI4s4sIHHIIHH4sI',
  b'RIFF', 36+len(data), b'WAVE', b'fmt ', 16, 1, 1, sr, sr*2, 2, 16,
  b'data', len(data))
print(base64.b64encode(hdr+data).decode())
" > /tmp/test_audio_b64.txt

# Send to STT API
curl -s http://localhost:8792/api/v1/audio/transcriptions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile audio /tmp/test_audio_b64.txt '{
    model: \"$MODEL_SLUG\",
    input_audio: { data: ($audio | rtrimstr(\"\n\")), format: \"wav\" }
  }')"
```

##### Expected successful response

Duration-based response (e.g. whisper):
```json
{
  "text": "<transcribed text>",
  "usage": {
    "seconds": <duration>,
    "cost": <cost>
  }
}
```

Token-based response (e.g. gpt-4o-transcribe):
```json
{
  "text": "<transcribed text>",
  "usage": {
    "total_tokens": <total>,
    "input_tokens": <input>,
    "output_tokens": <output>,
    "cost": <cost>
  }
}
```

If `cost` is missing, the KV data is missing `pricing_json`
or `provider_info.pricingStrategy` is not set correctly.
`computeSTTUsageResponse` reads from `provider_info`, not
`provider_overrides`. Ensure `pricingStrategy` matches the
provider (see step 5 table) and the `pricing_json` SKU keys
match that strategy (see step 6). Run the KV enrichment
script (step 7 Option A) and restart stt-api.

##### Verify BYOK billing

If testing BYOK, the user must have their provider key
registered in the `provider_api_keys` table. BYOK requests:
- `usage.cost`: BYOK fee (or $0 if waived/below threshold)
- Upstream cost tracked in `byok_usage_inference` (ClickHouse)
- `usage_upstream`: $0 (user pays provider directly)

BYOK endpoints are created dynamically by the
`addBYOKEndpoints` routing step — you don't need a separate
endpoint row for BYOK.

#### 9. Debug failures

##### Common STT issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| **404 from upstream** | Double-path in URL (`/audio/transcriptions/audio/transcriptions`) | Fix `baseUrl` — must NOT include `/audio/transcriptions` (see step 3) |
| **"No endpoints found"** | Model not in KV `modality_transcription` key | Ensure `output_modalities` includes `transcription`, then refresh cache (step 7) |
| **"No successful provider responses"** | Upstream call failed | Check provider API key is set in `.env.development.local` or Infisical |
| **Cost is $0 for non-BYOK** | Missing `pricing_versions` row or wrong `pricingStrategy` | Insert pricing version (step 6) and verify `provider_overrides.pricingStrategy` matches the provider (step 5 table) |
| **Cost is missing (`usage.cost` absent)** | KV data missing `pricing_json` on endpoint | Run KV enrichment (step 7 Option A) to add `pricing_json`, then restart stt-api |
| **BYOK fee is $0 unexpectedly** | User below free tier threshold or has waiver | Check `requests_byok_monthly` vs `BYOK_FEE_MONTHLY_REQUEST_THRESHOLD`, and `byok_fee_waived_until` |
| **`usage_updated_at` resets monthly count** | `usage_updated_at` is null | When null, `isFromPreviousUtcMonth()` returns true, resetting `requests_byok_monthly` to 0 |
| **Billing doesn't run on abort** | `waitUntil` not registered before fetch | The STT router uses a deferred billing guard (`promiseWithResolvers`) — verify it's registered before `fetch` |
| **Wrong adapter** | Provider doesn't map to an STT adapter | Check `packages/stt/configs/get-adapter-name.ts` — verify the provider is mapped to an STT adapter in the switch statement |

##### Check routing logs

The STT worker doesn't write to dev-fs-logs by default.
To debug routing, add temporary logging in
`packages/stt/lifecycle/resolve.ts` or check the wrangler console output.

#### 10. Verify billing end-to-end

After a successful transcription:

1. **Check the response** has `usage.cost` > 0 (non-BYOK)
   or `usage.cost` = BYOK fee (BYOK)
2. **Verify the pricing math** (billing mode depends on
   pricing config — see step 6):
   - Duration-based: `cost = (seconds / 60) × audio_minutes_price`
   - Token-based: `cost = input_tokens × input_price + output_tokens × output_price`
3. **For BYOK**: confirm `cost = 0` when user has waiver or
   is below `BYOK_FEE_MONTHLY_REQUEST_THRESHOLD`

#### 11. Verify it really works end-to-end

Step 10 confirmed the response shape and the math; this step confirms
the staged endpoint behaves the way it will in production. Run it after
every change that touches the adapter, pricing strategy, or the staged
seed rows. The result of this step is what the
[`audio-provider-onboarding`](../audio-provider-onboarding/SKILL.md) Phase 3
checkpoint asks for.

##### 11.1 — Unit tests pass

```bash
bun run test --filter @openrouter-monorepo/stt
bun run test --filter @openrouter-monorepo/pricing
```

Both must pass green before continuing. A failing unit test means the
staged endpoint will misbehave in a real e2e scenario.

##### 11.2 — KV spot-check

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT permaslug, provider_name, adapter_name, pricing_strategy_name
      FROM endpoints
      WHERE permaslug LIKE '%<your-slug>%';"
```

Then read the KV `modality_transcription` key and confirm the new
endpoint is present with the expected `adapter_name` and
`pricing_strategy_name`. Mismatch here means
[`get-adapter-name`](../../../packages/stt/configs/get-adapter-name.ts)
or [`get-pricing-strategy`](../../../packages/pricing/strategies/get-pricing-strategy.ts)
is missing a switch case.

##### 11.3 — Live cURL (baseline)

```bash
# 5-second clip, baseline scenario from audio-research-provider/capture-matrix.md
curl -sS -X POST http://localhost:8792/api/v1/audio/transcriptions \
  -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=<your-slug>" | jq .
```

Verify:

- `text` is populated
- `usage.seconds` matches the audio duration (clamped to floor if
  applicable — see step 11.4)
- `usage.cost` > 0 and matches the reconciliation table in
  `docs/stt-research/<provider>.md`

##### 11.4 — Surcharge / floor sanity

Repeat the cURL with a sub-floor clip (~0.4s) and with each opt-in
surcharge from the research note (e.g. `diarize=true`,
`response_format=verbose_json`). Verify:

- Sub-floor clip returns `usage.seconds = <floor>` (not the raw audio
  duration). This is the only place the dual-clamp pattern can be
  observed end-to-end.
- Each surcharge changes `usage.cost` by the documented multiplier.
  Cross-reference with the reconciliation table in the research note.
- Toggling a surcharge off returns cost to the baseline rate.

A dual-clamp regression here is the highest-severity STT bug shape.
Catch it before opening the PR.

##### 11.5 — dev-fs-logs review

Run [`dev-fs-logs`](../../../services/dev-fs-logs/README.md) while
firing 11.3 and 11.4:

```bash
bun run dev dev-fs-logs
```

Confirm the request flowed through the expected adapter and strategy:

```bash
ls services/dev-fs-logs/.logs/ | tail -n 5            # latest generation ids
cat services/dev-fs-logs/.logs/<gen-id>/adapters/<provider>/*.log
```

Spot-check that:

- `parseProviderResponse` did not log a schema warning (would mean
  upstream returned a field shape your Zod schema does not accept)
- `getUsage` did not log a missing-field warning
- The SKU keys in the billing log match the constants in your `*-skus.ts`

##### 11.6 — E2E suite

Run the STT e2e suite against the locally-staged endpoint:

```bash
bun run test:e2e -- --grep "stt"
```

See [`audio-e2e-testing`](../audio-e2e-testing/SKILL.md) for the canonical
setup. New STT providers usually need at least one new e2e test
asserting the provider-specific surface — add it under
`tests/e2e/api/stt/` before requesting review.

##### 11.7 — Verification checklist

Paste this checklist into the PR description; tick every box before
requesting review:

- [ ] Step 11.1: unit tests green (`stt` + `pricing` filters)
- [ ] Step 11.2: endpoint row in Postgres + KV `modality_transcription`
      key populated
- [ ] Step 11.3: baseline cURL returns transcription with
      `usage.cost > 0` matching reconciliation table
- [ ] Step 11.4: sub-floor scenario returns `usage.seconds = <floor>`
- [ ] Step 11.4: each opt-in surcharge changes cost by the documented
      multiplier
- [ ] Step 11.5: dev-fs-logs show the expected adapter + strategy with
      no schema warnings
- [ ] Step 11.6: e2e suite green with at least one new test if the
      provider exposes a new caller-facing surface
- [ ] UI spot-check from
      [`audio-e2e-testing`](../audio-e2e-testing/SKILL.md) passes

When any box stays unchecked, do NOT open the PR — fix the gap and
re-run from the failing step.

### Connection details

| Resource | Address |
|----------|--------|
| DB | `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres` |
| cfw-api | `http://localhost:8787` |
| stt-api | `http://localhost:8792` |
| Auth | `Bearer sk-or-v1-unlimitedkey` |

### Key source files

| File | Purpose |
|------|--------|
| `packages/stt/lifecycle/context.ts` | STT request context and `createSTTCtx` |
| `packages/stt/lifecycle/capabilities.ts` | Request-scoped policies and `createSTTCapabilities` |
| `packages/stt/lifecycle/submit.ts` | STT orchestration and `submitSTT` |
| `packages/stt/lifecycle/invoke.ts` | Provider dispatch and the deferred billing guard |
| `packages/stt/lifecycle/finalize.ts` | Transcript finalization and billing handoff |
| `packages/stt/adapters/base.ts` | Base adapter — URL construction (`baseUrl + /audio/transcriptions`) |
| `packages/stt/adapters/openai/index.ts` | Reference adapter implementation — FormData building, response parsing, `isDurationBased()` billing mode check |
| `packages/stt/adapters/google-cloud/index.ts` | Google Cloud STT adapter — Chirp models, regional routing, JSON body (not FormData) |
| `packages/stt/adapters/groq/index.ts` | Groq STT adapter — Whisper models via Groq |
| `packages/stt/adapters/adapter-factory.ts` | Adapter factory — maps `STTAdapterName` to adapter class |
| `packages/stt/configs/get-adapter-name.ts` | Maps `ProviderName` → `STTAdapterName` |
| `packages/stt/helpers/init-tx.ts` | Billing: `computeSTTUsageResponse`, `getUsage`, `initTx` |
| `packages/stt/routing/steps.ts` | STT routing steps (includes `addBYOKEndpoints`) |
| `packages/pricing/strategies/stt/strategy.ts` | `OpenAISTTPricingStrategy` — billing mode logic (duration vs token) |
| `packages/pricing/strategies/stt/skus.ts` | OpenAI SKU definitions: `openai_stt:audio_minutes`, `input_tokens`, `output_tokens` |
| `packages/pricing/strategies/stt/google-cloud-skus.ts` | Google Cloud SKU definitions: `google_cloud_stt:audio_minutes` |
| `packages/pricing/strategies/stt/google-cloud-strategy.ts` | `GoogleCloudSTTPricingStrategy` — duration-based billing |
| `packages/pricing/strategies/stt/groq-skus.ts` | Groq SKU definitions: `groq_stt:audio_hours` |
| `packages/pricing/strategies/stt/groq-strategy.ts` | `GroqSTTPricingStrategy` — duration-based billing (10s minimum) |
| `services/cfw-stt-api/src/kv/index.ts` | KV cache — reads `modality_transcription` key |
| `services/cfw-stt-api/src/app.ts` | Worker app setup, middleware chain, auth |
| `services/cfw-api/src/kv/index.ts` | KV cron — `filterByOutputModality(Transcription)` populates STT KV |


## TTS

Phase 3 of [`audio-provider-onboarding`](../audio-provider-onboarding/SKILL.md).
The database mechanics are identical to the STT staging steps above in
this skill — reuse steps 1–6 (provider lookup, model author, model row,
endpoint row, pricing version) and the failure-debugging section. This
section documents the TTS-specific deltas.

### TTS deltas vs STT staging

| Item            | STT                               | TTS                                                                         |
| --------------- | --------------------------------- | --------------------------------------------------------------------------- |
| Worker          | `services/cfw-stt-api`, port 8792 | `services/cfw-tts-api`, port **8791** (`CFW_TTS_API_PORT` in the Tiltfile)  |
| KV key          | `modality_transcription`          | `modality_tts`                                                              |
| Endpoint route  | `/api/v1/audio/transcriptions`    | `/api/v1/audio/speech`                                                      |
| Output modality | text                              | audio                                                                       |
| Pricing         | duration/token SKUs               | `TTSSKU.Characters` (`tts:characters`) or the custom strategy from research |

### Steps

1. **DB rows** — follow the STT steps 1–6 above, with the model's
   modalities set for TTS (text input, audio output) and the endpoint's
   `pricing_json` matching the strategy chosen in research (validate it
   against `TTSPricingJsonSchema` or the custom schema before inserting).
   The pre-staging pricing gate from STT step 6 above applies:
   primary-source rate (URL + date), correct API mode, every selectable
   SKU present — or escalate to the invoker instead of staging.
2. **Provider API key** — put the real key in
   `services/cfw-tts-api/.dev.vars` (env var name from
   `packages/providers/env.ts`). Mock env values return upstream auth
   errors, so a real key is required for actual audio.
3. **Seed KV** — same two options as STT step 7 above, but
   write the `modality_tts` key:

   ```bash
   cd services/cfw-tts-api && npx wrangler kv key put \
     "modality_tts" "$(cat /tmp/kv_tts.json)" \
     --binding KV_MODELS_AND_ENDPOINTS --local \
     --persist-to ../../.wrangler/shared-state
   ```

   Remember the cfw-api cron does not include `pricing_json`; enrich the
   KV entry directly when you need cost to be non-zero.

4. **Run the worker**:

   ```bash
   cd services/cfw-tts-api && bunx wrangler dev --port 8791 \
     --persist-to ../../.wrangler/shared-state
   ```

5. **Curl for audio**:

   ```bash
   curl -s http://localhost:8791/api/v1/audio/speech \
     -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
     -H "Content-Type: application/json" \
     -d '{"model":"<openrouter-slug>","input":"Hello from staging","voice":"<voice>","response_format":"mp3"}' \
     -o /tmp/staged.mp3 -D /tmp/staged.headers
   ```

### Done when

- The response is 200 with the expected `Content-Type` and an
  `x-generation-id` header
- `/tmp/staged.mp3` is **non-empty and playable** — verify with
  `ffprobe /tmp/staged.mp3` (codec, duration > 0) and listen or spot-check
  the waveform; a 200 with a 0-byte or undecodable body is a failure
- Repeat with `response_format: "pcm"` if the adapter supports it and
  confirm the PCM plays correctly at the adapter's declared
  `getPcmParameters()` (wrong sample rate/endianness sounds like noise or
  chipmunks)
- Cost is non-zero and consistent with the staged `pricing_json` times
  the input's billable characters

If any check fails, the bug is in the adapter, KV data, or pricing —
review the adapter against `packages/tts/REVIEW.md` with the failure in
mind before touching staging again.
