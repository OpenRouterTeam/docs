---
name: image-provider-onboarding
description: "Entrypoint for onboarding an image-generation provider from capability discovery through adapter, staging, UI, and end-to-end verification."
user-invocable: true
---

# Image Provider Onboarding

Use this as the single entrypoint for onboarding an image-generation provider. Image is one
modality, so the stack is a single ordered sequence rather than parallel modality branches.

## Required answers at invocation

Before cutting a branch, record:

- Provider name, upstream API family, model IDs, regions, and authentication source.
- Text-to-image, image-to-image, synchronous, asynchronous, and native-streaming support.
- Supported request fields: `n`, `quality`, `background`, `output_format`, `aspect_ratio`, `resolution`,
  `size`, `seed`, `stream`, `input_references`, and provider passthrough options.
- Response artifact shape, MIME detection, error envelopes, polling states, and request limits.
- Billing unit, pricing tiers, SKU names, and the source that reconciles each value.
- Model and endpoint visibility, private-access requirements, and production test owner.

Do not implement from vendor documentation alone. Capture the provider wire format and commit the
research note and fixtures before relying on assumptions.

## Composition

Run the phase skills in this order:

1. `image-research-provider` — document capabilities, pricing, live captures, and fixtures.
2. `image-add-adapter` — implement the image adapter, pricing, registrations, and tests.
   Review the result against `packages/image-generation/REVIEW.md` before opening the PR.
3. `image-stage-endpoint` — stage model, endpoint, pricing, KV, and a local worker request.
4. `image-e2e-testing` — run local image requests, inspect `dev-fs-logs`, and reconcile billing.

The phase skills are operational recipes. Keep provider-neutral stack policy here and put
provider-specific facts in the research note.

## Provider foundation

Create the provider foundation before the adapter layer when the provider is new:

- Provider enum/name and provider metadata.
- Provider slug, display name, icon, regions, BYOK policy, and API-key configuration.
- Provider API client or environment wiring required by the adapter.
- Provider pricing strategy selection and any provider override such as
  `provider_overrides.pricingStrategy`.
- Model author and model metadata with `output_modalities: ['image']`.

Reuse the existing provider config and database paths. Do not add image capability constants to an
adapter: image limits are endpoint-owned in `supported_image_parameters` and validated by
`validateImageRequestCapabilities` in `packages/image-generation/capabilities/validate-request.ts`.

## Single-modality PR stack

The recommended stack is:

1. Provider foundation and metadata.
2. Research note and raw fixtures.
3. Image adapter, response schemas, pricing strategy, and unit tests.
4. Staging and worker/e2e verification.

Keep each PR narrowly owned. The adapter PR owns provider wire translation and tests; the staging
PR owns database/KV setup and request evidence. If a layer is unnecessary, record why rather than
silently changing the stack shape.

## Gates before implementation

- Research note has primary-source capability and pricing citations.
- Live captures cover the happy path, image-to-image path when supported, errors, and every
  billing-affecting option.
- The response is normalized to `created`, `data[].b64_json`, optional `media_type`, and `usage`
  from `packages/image-generation/schemas/response.ts`.
- Every advertised capability is honored by `buildUpstreamRequestBody`, or removed from the database
  capability row.
- Pricing strategy, pricing JSON, emitted SKU items, and public image pricing agree.
- Every provider-advertised parameter value fits the serving enums (see the completeness rule in
  `image-add-adapter`).
- The adapter uses `BaseSyncImageGenerationAdapter` or `BaseAsyncImageJobAdapter` rather than
  reimplementing transport, retries, logging, and SKU plumbing.
- Local test plans have an explicit cleanup owner.

## PR metadata and checkpoints

Every phase handoff should include:

- Branch and base branch.
- Files changed and tests run.
- Research-note and fixture paths.
- Model/endpoint IDs and visibility state.
- Pricing strategy, pricing JSON, and expected per-image/token cost.
- Request/response evidence and `dev-fs-logs` locations.
- Open questions and the next phase owner.

Stop at phase boundaries for review. Do not expose an unpriced, untested, or accidentally public
image endpoint.

## Pre-public launch gate

Before the model goes public, the agent in the thread runs the featured-example
launch gate per `docs/runbooks/model-launch.md` section 3b; the `buddy` skill's
[`launch-examples.md`](../buddy/references/launch-examples.md) owns the mechanics.

## Related skills

- `image-research-provider`
- `image-add-adapter`
- `image-stage-endpoint`
- `image-e2e-testing`
- `stage-endpoint` for generic seed/KV mechanics
- `add-provider-adapter` for general provider registration conventions
- `create-fixtures` for captured upstream behavior
- `image-api-error-triage` for production failure clustering
- `multimodal-daily-report` for post-launch reliability and adoption signals

## Key source files

- `packages/image-generation/README.md`
- `packages/image-generation/adapters/AGENTS.md`
- `packages/image-generation/adapters/base/index.ts`
- `packages/image-generation/adapters/base/sync-image-adapter.ts`
- `packages/image-generation/adapters/base/async-image-job-adapter.ts`
- `packages/image-generation/adapters/adapter-factory.ts`
- `packages/image-generation/configs/get-adapter-name.ts`
- `packages/image-generation/schemas/request.ts`
- `packages/image-generation/schemas/response.ts`
- `packages/image-generation/capabilities/validate-request.ts`
- `services/cfw-image-api/src/routes/images/generations.ts`
- `services/cfw-image-api/src/routes/models/to-image-endpoints.ts`
