---
name: image-stage-endpoint
description: "Phase 3: stage an image-generation model and endpoint in local Postgres, pricing, KV, and cfw-image-api, then verify a real image response. Sub-skill of image-provider-onboarding."
user-invocable: true
---

# Stage Local Image Endpoint

Stage a researched image model and endpoint, refresh the image KV cache, call the local
`cfw-image-api`, and reconcile response and billing. Prefer prod-first seed rows; use manual SQL
only for an adapter that cannot exist in production yet. Start local services with the current
`local-dev-env` and generic `stage-endpoint` procedures.

## Prerequisites

- Branch contains the adapter, provider metadata, pricing strategy, and tests.
- Local Postgres is running on the repository's configured port.
- `cfw-image-api` and `dev-fs-logs` are running.
- Provider credentials are available through Infisical or the worker's `.dev.vars`; never commit
  them.
- Model slug, author, provider name/slug, upstream model ID, adapter enum, pricing strategy, and
  capability matrix are known.

## Don't forget these params

Use the exact database column names below. The authoritative CSV headers are the header rows of
`postgres/seeds/models_rows.csv` and `postgres/seeds/endpoints_rows.csv`; the SQL schema is
`postgres/migrations/20260706230000_baseline_schema.sql`.

### Model row

- `slug`, `permaslug`, `author_id`, `name`, and model description.
- `hidden` — use `false` only for a deliberate local test; newly created admin models default to
  hidden (`services/cfw-internal/src/routes/buddy-api/create-model.ts`).
- `input_modalities` — usually `['text']` for text-to-image; include image only if the model
  accepts image input as a model modality.
- `output_modalities` — **must include `'image'`** for image generation. The models table requires
  both modality arrays (`models` in `postgres/migrations/20260706230000_baseline_schema.sql`).
- `is_private` and `owner_clerk_user_id` when using private production testing.

### Endpoint row

- `provider_name`, `provider_model_id`, `model_permaslug`, and `variant`.
- `hidden` and `is_disabled`; local requests need both visible and enabled.
- `is_private`, `is_byok_only`, and `owner_clerk_user_id` for private/BYOK testing.
- `supported_image_parameters` — **required for accurate image capability filtering**. This JSONB
  describes honored request fields: `resolutions`, `aspect_ratios`, `output_formats`,
  `qualities`, `backgrounds`, `n`, `input_references`, `output_compression`, `seed`, `size`, etc. The
  column is declared on `endpoints` in
  `postgres/migrations/20260706230000_baseline_schema.sql` and typed in
  `packages/db/kysely-types.gen.d.ts`. The value must
  validate against `SupportedImageParametersSchema` (`packages/db/endpoints/index.ts`);
  never drop the capability field to bypass validation, because the serving read path nulls out any
  row the schema rejects (`safeParseSupportedImageParameters` in
  `packages/routing/endpoints/constructor.ts`) and image request
  capability validation skips checks when the parsed field is null
  (`validateImageRequestCapabilities` in
  `packages/image-generation/capabilities/validate-request.ts`). If a value the provider
  genuinely supports is rejected, extend the serving enums in the adapter PR (see
  `image-add-adapter`).
- `provider_overrides` with `pricingStrategy` when the provider's strategy is selected per
  endpoint; `packages/db/providers/resolve-endpoint-pricing-strategy.ts` resolves it.
- `allowed_passthrough_parameters` for provider options intentionally exposed through
  `provider.options`.
- `max_tokens_per_image` only when the provider bills or limits image-token output.
- `provider_region`, `features`, `additional_parameters`, `excluded_parameters`, and data-policy
  fields required by the provider.

### Pricing row

- Insert a `pricing_versions` row for the endpoint with `pricing_json`; the table requires
  `endpoint_id`, `pricing_json`, and `effective_at`.
- Use the strategy's exact SKU keys and units. Current image billable projection lives in
  `packages/pricing/billable/get-image-pricing.ts`, with provider-specific image billables under
  `packages/pricing/strategies/openai-responses-image-billable.ts` and
  `packages/pricing/strategies/gemini/image-billable.ts`.
- Reconcile per-image, input/output image token, megapixel, resolution, quality, and variant
  pricing against the research capture.

## Dependency order

1. Provider row and provider API key/config.
2. Model author and model row with `output_modalities: ['image']`.
3. Endpoint row with adapter, provider model ID, visibility, and capabilities.
4. Pricing version and strategy override.
5. KV cache for image models/endpoints.
6. Worker request and response/billing inspection.

## Preferred seed path

Use the generic `stage-endpoint` Path A when model and endpoint rows exist in production:

```bash
grep '$MODEL_SLUG' postgres/seeds/models_rows.csv
grep '$PROVIDER_NAME' postgres/seeds/endpoints_rows.csv
bun run x scripts/seed/seed-models-endpoints.ts
```

For local-only testing, use the generic skill's Path B SQL with explicit image fields above.
Never omit `supported_image_parameters` merely to make a request pass: when NULL,
`validateImageRequestCapabilities` skips DB capability validation
(`packages/image-generation/capabilities/validate-request.ts`), which can hide an incomplete
staging row.

## KV and worker setup

The image worker reads its image-specific model cache from `KV_MODELS_AND_ENDPOINTS` using
`KV_MODALITY_IMAGE` (`modality_image`) (`packages/cloudflare/kv-keys.ts` and
`services/cfw-image-api/src/image-kv.ts`). Refresh the cache after changing model, endpoint,
visibility, capabilities, or pricing.

Start the worker using its package command or the repository dev runner. The worker exposes:

- `GET /health`
- `POST /api/v1/images`
- `GET /api/v1/images/models`
- `GET /api/v1/images/models/{author}/{slug}/endpoints`

The route and model discovery flow are implemented in the `app.route` mounts in
`services/cfw-image-api/src/app.ts`,
`services/cfw-image-api/src/routes/images/generations.ts`, and
`services/cfw-image-api/src/routes/models/to-image-endpoints.ts`.

## Test request and verification

Send a minimal request, then one capability-affecting request:

```bash
curl -sS http://localhost:${CFW_IMAGE_API_PORT:-8797}/health
curl -sS http://localhost:${CFW_IMAGE_API_PORT:-8797}/api/v1/images/models
curl -sS http://localhost:${CFW_IMAGE_API_PORT:-8797}/api/v1/images \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{"model":"$MODEL_SLUG","prompt":"a red panda astronaut in space","output_format":"png"}'
```

Validate with the Zod response schema, decode `data[].b64_json`, check the MIME magic bytes, and
record `created`, `usage.cost`, and image count. For streaming-capable adapters, repeat with
`"stream":true` and validate partial/completed SSE events.

Inspect `dev-fs-logs` for generation ID, endpoint ID, provider request, sanitized response,
transaction outcome, SKU items, and final usage. Confirm the response cost equals the pricing
strategy and expected provider unit.

## Debugging and connection details

- Cache shows no model: verify `output_modalities`, `hidden`, model/endpoint cache refresh, and the
  `modality_image` key.
- 400 capability error: compare request fields with `supported_image_parameters`.
- Unknown adapter: inspect `getImageGenerationAdapterName` and `adapter-factory.ts`.
- Empty image: inspect `parseUpstreamBody`, artifact resolution, and provider response fixture.
- Wrong cost: inspect `pricing_versions.pricing_json`, provider override strategy, emitted SKUs,
  and `get-image-pricing.ts`.
- 413: check the worker content-length cap and use a smaller prompt/reference payload.

Use connection strings and ports from the active Tilt profile and `services/cfw-image-api`; do
not hardcode credentials in this skill.

## Done when

- Model, endpoint, capabilities, visibility, and pricing rows are present and intentional.
- KV exposes the endpoint and per-endpoint capabilities/pricing.
- Buffered and supported streaming requests return valid image bytes.
- `dev-fs-logs` confirms routing, billing, and sanitized response evidence.
- Cost and image count reconcile.
- All temporary private/hidden/local changes are recorded for cleanup.

## Related skills

- `image-provider-onboarding`
- `image-research-provider`
- `image-add-adapter`
- `image-e2e-testing`
- `stage-endpoint`
- `local-dev-env`

## Key source files

- `postgres/migrations/20260706230000_baseline_schema.sql` (`endpoints`, `models`, `pricing_versions`)
- `postgres/seeds/models_rows.csv` (header row)
- `postgres/seeds/endpoints_rows.csv` (header row)
- `packages/db/kysely-types.gen.d.ts` (`Endpoints.supported_image_parameters`)
- `packages/image-generation/capabilities/validate-request.ts`
- `packages/pricing/billable/get-image-pricing.ts`
- `services/cfw-image-api/README.md`
- `services/cfw-image-api/src/routes/images/generations.ts`
- `services/cfw-image-api/src/routes/models/to-image-endpoints.ts`
- `packages/cloudflare/kv-keys.ts`
- `services/cfw-image-api/src/image-kv.ts`
