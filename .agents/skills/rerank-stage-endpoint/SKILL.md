---
name: rerank-stage-endpoint
description: "Phase 3: stage an API-only rerank model, endpoint, capability metadata, pricing, KV, and local request. Sub-skill of rerank-provider-onboarding."
user-invocable: true
---

# Stage Local Rerank Endpoint

Stage Postgres rows and refresh modality KV, then test `cfw-rerank-api` on port `8790`
(the `rerank-api` resource in `Tiltfile`).

## Don't forget these params

Use the `endpoints`, `models`, and `pricing_versions` tables in
`postgres/migrations/20260706230000_baseline_schema.sql`,
and the header rows of `postgres/seeds/models_rows.csv` and `postgres/seeds/endpoints_rows.csv`.

- Model `slug`, `permaslug`, `author_id`, `input_modalities`, `output_modalities`, `hidden`,
  `is_private`, and `owner_clerk_user_id`; output metadata must match rerank.
- Endpoint `provider_name`, `provider_model_id`, `model_permaslug`, `variant`, `hidden`,
  `is_disabled`, `is_private`, `is_byok_only`, `owner_clerk_user_id`, and `provider_region`.
- `provider_overrides` including adapter and pricing strategy; `allowed_passthrough_parameters`.
- Any rerank capability metadata in `features`, `additional_parameters`, or endpoint-specific
  fields; document text/image support, `top_n`, and provider options.
- `pricing_versions.endpoint_id`, `pricing_json`, effective time, and token/search-unit SKUs.

## Dependency order and request

Seed provider → model → endpoint → pricing, refresh the rerank modality KV, and restart the worker.
The route is `services/cfw-rerank-api/src/routes/rerank/submit.ts`; streaming is unsupported.

Run text and structured image-document requests, invalid document/top_n cases, and provider
failure. Validate result order/index/score, usage tokens/search units/cost, and logs.

## Related skills

- `rerank-provider-onboarding`
- `stage-endpoint`
- `rerank-e2e-testing`
- `multimodal-daily-report`

## Key source files

- `packages/rerank/adapters/base.ts`
- `packages/rerank-interfaces/schemas/request/index.ts`
- `packages/rerank-interfaces/schemas/response/index.ts`
- `services/cfw-rerank-api/src/app.ts`
- the `rerank-api` resource in `Tiltfile`
