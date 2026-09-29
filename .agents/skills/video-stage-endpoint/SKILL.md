---
name: video-stage-endpoint
description: "Phase 3: stage a video-generation model, async endpoint, capabilities, pricing, KV, and local worker job. Sub-skill of video-provider-onboarding."
user-invocable: true
---

# Stage Local Video Endpoint

Stage model, endpoint, pricing, and `modality_video` KV, then prove submit/poll/content behavior
through `cfw-video-api`.

## Prerequisites

- Adapter, provider metadata, pricing strategy, tests, and research note are complete.
- Local Postgres, KV, `cfw-video-api`, and `dev-fs-logs` are ready.
- Provider credentials and a short deterministic generation are available.

## Don't forget these params

Use exact column names from the header rows of `postgres/seeds/models_rows.csv` and
`postgres/seeds/endpoints_rows.csv`, and the `endpoints` and `models` tables in
`postgres/migrations/20260706230000_baseline_schema.sql`.

### Model

- `slug`, `permaslug`, `author_id`, `hidden`, `input_modalities`, `output_modalities`
- `output_modalities` must include `'video'`.
- `is_private`, `owner_clerk_user_id`, and model visibility.

### Endpoint

- `provider_name`, `provider_model_id`, `model_permaslug`, `variant`
- `hidden`, `is_disabled`, `is_private`, `is_byok_only`, `owner_clerk_user_id`
- `supported_video_parameters` — duration, resolutions, aspect ratios, sizes, `generate_audio`,
  input/frame reference support, and any provider-specific capability descriptors
- Staging writes through the buddy-api routes validate `supported_video_parameters` against the
  serving Zod schemas and return 400 with `capability_issues` on mismatch; never drop the
  capability field to bypass validation, because the serving read path nulls out any row the
  schema rejects (`safeParseSupportedVideoParameters` in
  `packages/routing/endpoints/constructor.ts`) and video routing treats
  missing capability lists as compatible with every requested duration or resolution
  (`packages/video-generation/routing/by-video-parameters.ts`). If a value the provider
  genuinely supports is rejected, extend the serving enums in the adapter PR (see
  `video-add-adapter`). Rows staged outside the buddy-api routes get no write-time check, so
  validate manually staged values yourself.
- `provider_overrides`, especially `pricingStrategy`
- `allowed_passthrough_parameters`, `provider_region`, `features`, `additional_parameters`,
  `excluded_parameters`, and `override_datapolicy_id`

### Pricing

- `pricing_versions.endpoint_id`, `pricing_json`, `effective_at`,
  `created_by_clerk_user_id` (`pricing_versions` in
  `postgres/migrations/20260706230000_baseline_schema.sql`)
- Exact per-second/per-video, duration, resolution, audio, and variant SKU values.

## Dependency order and worker

Seed provider → model → endpoint → pricing → KV. Use the generic `stage-endpoint` seed path where
possible. Refresh the video model cache using `KV_MODALITY_VIDEO` (`modality_video`) and verify
`services/cfw-video-api/src/kv/index.ts`.

The default Tilt port is `8788` (`Tiltfile` `video-api` resource, `CFW_VIDEO_API_PORT`). Routes are registered with
`app.route` in `services/cfw-video-api/src/app.ts`; the video route handles `POST /api/v1/videos`.

## Test job

```bash
curl -fsS http://localhost:${CFW_VIDEO_API_PORT:-8788}/api/v1/videos \
  -H 'content-type: application/json' -H "authorization: Bearer $OPENROUTER_API_KEY" \
  -d "{\"model\":\"$MODEL_SLUG\",\"prompt\":\"a short red panda walking\",\"duration\":1,\"resolution\":\"720p\"}"
```

Record job ID, polling URL, upstream job ID, statuses, artifact/content response, generation ID,
SKU items, cost, and `dev-fs-logs`. Never treat submit success as generation success.

## Mission Control links

Use the FULL model permaslug in model editor URLs — never `{author}/{model-slug}`; permaslugs can
carry a `YYYYMMDD` suffix the public slug omits:

- Model: `https://internal.openrouter.ai/model/edit/{model-permaslug}`
- Endpoint: `https://internal.openrouter.ai/endpoint/edit/{endpoint_id}`
- Provider: `https://internal.openrouter.ai/provider/{provider-permaslug}/edit`

## Related skills

- `video-provider-onboarding`
- `stage-endpoint`
- `video-e2e-testing`
- `multimodal-daily-report`

## Key source files

- `postgres/migrations/20260706230000_baseline_schema.sql` (`endpoints`, `models`, `pricing_versions`)
- `packages/video-generation/adapters/base.ts`
- `packages/video-generation/routing/by-video-parameters.ts`
- `services/cfw-video-api/src/app.ts`
- `services/cfw-video-api/src/durable-objects/video-generation-job.ts`
- `services/cfw-video-api/src/kv/index.ts`
- `services/cfw-internal/src/routes/buddy-api/validate-capability-fields.ts`
