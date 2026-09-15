---
name: image-add-adapter
description: "Phase 2: add an image-generation provider adapter with request/response mapping, pricing, registration, and tests. Sub-skill of image-provider-onboarding."
user-invocable: true
---

# Add Image Adapter

Implement one provider from a completed `docs/image-research/<provider>.md`. Follow the image
package's template-method bases; do not copy a chat adapter or hand-write a full generation
lifecycle.

## Files to touch

Typical changes:

- `packages/enums/adapters.ts` — `ImageGenerationAdapterName` member.
- `packages/enums/image-parameters.ts` — extend `ImageGenerationResolution` / `ImageAspectRatio`
  when the provider supports values the serving enums lack.
- `packages/image-generation/adapters/<provider>/index.ts` — adapter implementation.
- `packages/image-generation/adapters/<provider>/index.test.ts` — fetch-mocked lifecycle tests.
- `packages/image-generation/adapters/adapter-factory.ts` — constructor registration.
- `packages/image-generation/configs/get-adapter-name.ts` — legacy adapter mapping when needed.
- `packages/pricing/strategies/<provider>/skus.ts` and `strategy.ts` — pricing.
- `packages/pricing/strategies/get-pricing-strategy.ts` — strategy registration.
- Provider config and database seed/metadata files when the provider is new.

Use the existing provider's directory conventions and keep the diff limited to the researched
surface.

## Step 1 — Register adapter name

Add a member to `ImageGenerationAdapterName` in `packages/enums/adapters.ts`. Keep the enum value
stable and descriptive, for example `QuiverImageAdapter`. If a legacy chat adapter name can occur
on an image endpoint, add the explicit compatibility mapping in
`packages/image-generation/configs/get-adapter-name.ts`.

## Step 2 — Choose and implement the base

Extend:

- `BaseSyncImageGenerationAdapter` for one request returning inline image data.
- `BaseAsyncImageJobAdapter` for submit/poll/artifact retrieval.

Follow `packages/image-generation/adapters/AGENTS.md`. Implement only the abstract hooks:

Sync:

- `location`, `providerLogName`, `providerErrorName`, `buildUpstreamRequestBody`, `getUrl`,
  `redactRequestForLog`, `parseUpstreamBody`.
- Override multipart fetch or non-2xx handling only when required.

Async:

- `location`, `providerLogName`, `providerErrorName`, `buildUpstreamRequestBody`, `getUrl`,
  `redactSubmitRequestForLog`, `parseSubmitResponse`, `getPollUrl`,
  `classifyPollResponse`, and `buildSuccessResult`.

Call `validateImageRequestCapabilities` first in `buildUpstreamRequestBody` with
`this.ctx.endpoint.supported_image_parameters`. Use shared input-reference, artifact-resolution,
provider-option, error-sanitization, logging, and SKU helpers.

## Request and response mapping

Map normalized fields from `schemas/request.ts` to the provider wire format. Test:

- Prompt, count, size/resolution/aspect ratio, seed, output format, and provider options.
- Input-reference URL/base64 handling and multipart boundaries for edits.
- Unsupported fields and capability errors.
- Provider request redaction.

Parse the provider success schema and error envelope into
`ImageGenerationImage { b64_json, media_type? }`. Resolve URL artifacts to base64 with
`resolve-artifact.ts`; preserve SVG as `image/svg+xml` when applicable.

## Pricing SKUs and strategy

Define SKU constants under `packages/pricing/strategies/<provider>/skus.ts`. Match the measured
unit and variants from the research note: per image, token, megapixel, input image, resolution,
quality, or upstream-reported cost.

Implement the strategy with validated `pricing_json`, register it in
`packages/pricing/strategies/get-pricing-strategy.ts`, and ensure
`packages/pricing/billable/get-image-pricing.ts` can project public `PricingEntry[]` when the
strategy is image-serving. Keep cents/dollars conversion and rounding in the strategy.

## Factory and provider mapping

Register the adapter import and constructor in
`packages/image-generation/adapters/adapter-factory.ts`. The `satisfies Record<...>` check must
remain exhaustive.

Register provider metadata and API key/config wiring. Use
`getImageGenerationAdapterName` for legacy chat names only when required. Most endpoint rows use
the image adapter enum directly.

## Tests

Co-locate `index.test.ts` and mock `globalThis.fetch`, restoring it in `finally`. Cover:

- Minimal text-to-image request and normalized response.
- Input-reference/edit path when supported.
- Error envelope, non-2xx, invalid JSON, and empty image data.
- Async pending/success/failure or streaming partial/completed events when applicable.
- Capability rejection from `supported_image_parameters`.
- Provider options and redacted logs.
- SKU items, pricing variants, MIME type, and usage.

Use fixture payloads from `create-fixtures` for real upstream behavior; do not hand-write a
provider-shaped response when a live capture is available.

## Lint, typecheck, and test

From the repository root:

```bash
bun run --filter @openrouter-monorepo/image-generation test
bun run --filter @openrouter-monorepo/image-generation typecheck
```

Run the narrow adapter and pricing tests first, then the package checks.

## Acceptance criteria

- Adapter is registered and selected for every intended provider/model row.
- Every advertised capability is honored and DB-driven.
- Serving enums cover the provider's full advertised parameter surface; enum extensions ship in
  this PR, so staged capability metadata is schema-valid by construction.
- Response schema returns valid base64 and MIME metadata.
- Errors are sanitized and classified through shared image paths.
- Pricing JSON, SKU emission, usage, and public pricing agree.
- Fixtures and tests cover the provider's real wire shapes.
- No secrets, fixed capability constants, or unrelated adapter refactors remain.

## Related skills

- `image-provider-onboarding`
- `image-research-provider`
- `create-fixtures`
- `add-provider-adapter`

Before opening the PR, review the change against `packages/image-generation/REVIEW.md`.

## Key source files

- `packages/image-generation/adapters/AGENTS.md`
- `packages/image-generation/adapters/base/index.ts`
- `packages/image-generation/adapters/base/sync-image-adapter.ts`
- `packages/image-generation/adapters/base/async-image-job-adapter.ts`
- `packages/image-generation/adapters/adapter-factory.ts`
- `packages/image-generation/configs/get-adapter-name.ts`
- `packages/image-generation/capabilities/validate-request.ts`
- `packages/image-generation/adapters/input-references.ts`
- `packages/image-generation/adapters/resolve-artifact.ts`
- `packages/image-generation/schemas/response.ts`
- `packages/pricing/strategies/get-pricing-strategy.ts`
- `packages/pricing/billable/get-image-pricing.ts`
