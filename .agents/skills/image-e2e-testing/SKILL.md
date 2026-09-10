---
name: image-e2e-testing
description: "Phase 4: run local end-to-end tests for an image-generation provider, including response validation, logs, and cost reconciliation. Sub-skill of image-provider-onboarding."
user-invocable: true
---

# Image Generation E2E Testing

Exercise the complete image path: authenticated request, model/endpoint routing, provider
adapter, image bytes, billing, and observability. For local API tests, start services with
`bun run dev cfw-image-api dev-fs-logs` and inspect the resulting artifacts.

## Secrets

Use Infisical or the repository's local `.dev.vars` mechanism for:

- OpenRouter/local API key.
- Provider API key and provider-specific environment variables.
- Datadog keys only when the test explicitly requires production log inspection.

Never print, persist, or commit secret values. Redact prompts, image bytes, signed URLs, and
authorization headers in evidence.

## Prerequisites

- Adapter unit tests, pricing tests, and package typecheck pass.
- Provider research note and raw fixtures exist.
- Local Postgres, model/endpoint rows, pricing version, image KV, `cfw-image-api`, and
  `dev-fs-logs` are ready.
- Test model has `output_modalities: ['image']`, an enabled endpoint, and complete
  `supported_image_parameters`.
- A small deterministic prompt and expected cost are recorded.

## Setup

1. Start the required local services from the repo root:

   ```bash
   bun run dev cfw-image-api dev-fs-logs
   ```

2. Follow `image-stage-endpoint` to seed the model, endpoint, pricing, and `modality_image` KV.
3. Check worker health and model discovery:

   ```bash
   curl -fsS http://localhost:${CFW_IMAGE_API_PORT:-8797}/health
   curl -fsS http://localhost:${CFW_IMAGE_API_PORT:-8797}/api/v1/images/models
   ```

4. Record model slug, endpoint ID, provider model ID, adapter, pricing strategy, and expected
   image capability fields.

## Run tests

Run the narrow image worker tests and then real local requests:

```bash
bun run --filter @openrouter-monorepo/cfw-image-api test
bun run --filter @openrouter-monorepo/image-generation test
bun run --filter @openrouter-monorepo/cfw-image-api typecheck
bun run --filter @openrouter-monorepo/image-generation typecheck
```

Exercise:

1. Minimal text-to-image request.
2. `n` and output-format behavior.
3. Aspect ratio/resolution/size capability.
4. Input-reference edit when supported.
5. Provider passthrough option when researched.
6. Invalid capability and provider error.
7. Native streaming with partial and completed events when supported.

## Response and image validation

Parse responses with `ImageGenerationResponseSchema` and stream events with
`packages/image-generation/schemas/stream-events.ts`. Assert:

- HTTP status and OpenRouter error envelope.
- `created` is an integer timestamp.
- Every `data[].b64_json` is non-empty, valid base64, and decodes to a real image.
- PNG/JPEG/WebP/SVG magic bytes and `media_type` agree.
- Image dimensions and count match requested/capability limits.
- Streaming partials precede one completed event and do not double-count billing.
- Moderation/refusal is classified separately from infrastructure failure.

## Cost reconciliation

For each successful and failed scenario:

- Capture generation ID, endpoint ID, image count, and `usage.cost`.
- Compare emitted SKU items and usage with `pricing_versions.pricing_json`.
- Compare provider-reported cost or invoice estimate with the strategy's unit.
- Check `n`, quality, resolution, input references, and partial-stream completion rules.
- Confirm no charge for rejected capability requests and the intended policy for provider
  moderation/refusal.

## Inspect dev-fs-logs

After every real request, inspect `services/dev-fs-logs/.logs/` for:

- Request route and generation ID.
- Model/endpoint/provider selection.
- Sanitized upstream request and response/error.
- Image adapter success/error and MIME resolution.
- SKU items, transaction attempt, usage, and finalization.
- Streaming completion/truncation state when applicable.

The logs are local-development evidence; do not treat a passing HTTP assertion as complete without
checking the request path and billing evidence.

## UI spot-check

With the local web app running, confirm the model appears under the image lane
(`output_modalities=image` in model discovery) rather than another modality, and that the
rendered pricing unit and values match the pricing JSON and
`GET /api/v1/images/models/{author}/{slug}/endpoints`.

## After local testing

Production verification and the pre-public featured-example gate are owned by the launch process,
not this skill: see `docs/runbooks/model-launch.md` (§3 staging/private access, §3b launch gate).

## Done when

- Local happy-path, capability, error, edit, and streaming scenarios pass as applicable.
- Decoded image content and MIME type are valid.
- `dev-fs-logs` contains routing, adapter, response, and billing evidence.
- Cost and SKU reconciliation is documented.
- The UI spot-check passes.
- Temporary local visibility changes and test data were cleaned up.

## Related skills

- `image-provider-onboarding`
- `image-research-provider`
- `image-stage-endpoint`
- `e2e-testing`
- `local-dev-env`
- `debug-capsule`
- `image-api-error-triage`

## Key source files

- `services/cfw-image-api/README.md`
- `services/cfw-image-api/src/routes/images/generations.ts`
- `services/cfw-image-api/src/routes/models/index.ts`
- the `image-api` resource in `Tiltfile` for the default local port (`8797`).
- `packages/image-generation/schemas/response.ts`
- `packages/image-generation/schemas/stream-events.ts`
- `packages/image-generation/adapters/base/index.ts`
- `packages/pricing/billable/get-image-pricing.ts`
- `projects/web/components/model-discovery/build-discovery-lanes.ts`
