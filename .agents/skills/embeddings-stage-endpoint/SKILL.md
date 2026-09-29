---
name: embeddings-stage-endpoint
description: "Phase 3: stage an embeddings model, endpoint, capabilities, pricing, KV, and local API request. Sub-skill of embeddings-provider-onboarding."
user-invocable: true
---

# Stage Local Embeddings Endpoint

Stage Postgres rows and refresh `KV_MODALITY_EMBEDDINGS`, then test `cfw-embeddings-api` on port
`8789` (the `embeddings-api` resource in `Tiltfile`).

## Don't forget these params

Use the `endpoints`, `models`, and `pricing_versions` tables in
`postgres/migrations/20260706230000_baseline_schema.sql`,
and the header rows of `postgres/seeds/models_rows.csv` and `postgres/seeds/endpoints_rows.csv`.

- Model `slug`, `permaslug`, `author_id`, `input_modalities`, `output_modalities`, `hidden`,
  `is_private`, and `owner_clerk_user_id`; output must describe embeddings.
- Endpoint `provider_name`, `provider_model_id`, `model_permaslug`, `variant`, `hidden`,
  `is_disabled`, `is_private`, `is_byok_only`, `owner_clerk_user_id`, `provider_region`.
- `provider_overrides` including adapter and pricing strategy; `allowed_passthrough_parameters`.
- Input modality metadata for text, image, audio, video, and file/PDF where supported.
- Batch support, dimensions, `encoding_format`, chunk/input limits, and any capability JSON in
  `additional_parameters`/`features`.
- Pricing `pricing_versions.pricing_json`, effective time, per-token/modality SKUs, and creator.

## Dependency order and request

Seed provider → model → endpoint → pricing, refresh the cfw-api cache, then restart embeddings-api.
The worker route is `/api/v1/embeddings` (`services/cfw-embeddings-api/src/app.ts`); KV reads
`KV_MODALITY_EMBEDDINGS` (`services/cfw-embeddings-api/src/kv/index.ts`).

Run text, array/batch, and supported multimodal requests. Validate vector count/order,
dimensions, encoding, `usage.prompt_tokens`, modality token details, cost, and logs.

## Related skills

- `embeddings-provider-onboarding`
- `stage-endpoint`
- `embeddings-e2e-testing`
- `multimodal-daily-report`

## Key source files

- `packages/embeddings/adapters/base.ts`
- `packages/embedding-interfaces/schemas/request/index.ts`
- `packages/embedding-interfaces/schemas/response/index.ts`
- `services/cfw-embeddings-api/src/kv/index.ts`
- the `embeddings-api` resource in `Tiltfile`
