---
name: image-research-provider
description: "Phase 1: research an image-generation provider before code is written, including live captures, pricing, and fixtures. Sub-skill of image-provider-onboarding."
user-invocable: true
---

# Research Image Provider

Produce the research note that the adapter, staging, and verification phases implement. Use the
provider's primary API documentation and live responses; treat examples in this skill as a
checklist, not as provider facts.

## Invocation and prerequisites

Invoke for a new image provider, a new image model family, or a provider behavior change affecting
request fields, response artifacts, errors, streaming, polling, or billing.

Before starting:

- Check the launch/chat thread for provider capabilities already dropped in by the requester;
  treat them as the primary capability input and reconcile them against provider documentation
  rather than starting from scratch.
- Read `packages/image-generation/README.md` and `packages/image-generation/adapters/AGENTS.md`.
- Read `schemas/request.ts`, `schemas/response.ts`, `schemas/stream-events.ts`, and
  `capabilities/validate-request.ts`.
- Inspect at least one current sync adapter and one async adapter.
- Confirm a provider key and a disposable model/endpoint or vendor sandbox.
- Create a capture directory outside committed fixtures, then redact secrets and user content.

## Outputs

- `docs/image-research/<provider>.md` with cited sources and an implementation-ready capability
  matrix.
- Raw request/response captures for each scenario.
- Pricing reconciliation with currency, unit, tier, and timestamp.
- Fixture files and the test wiring required by `create-fixtures`.
- Open questions that block implementation, each with an owner.

## Phase A — Documentation pass

### Image request surface

Extract whether the provider accepts:

- Prompt, `n`, quality, background, output format, compression, seed, and safety controls.
- Resolution, explicit dimensions, aspect ratio, or provider-specific size vocabulary.
- Input reference images, URL versus base64 encoding, image count limits, and edit endpoints.
- Synchronous JSON, asynchronous job creation plus polling, multipart edits, or SSE events.
- Provider-specific options that belong under `provider.options`, not the normalized request.

Map each provider field to the normalized request in
`packages/image-generation/schemas/request.ts`. Record fields that are unsupported, ignored, or
conflict-checked; only fields genuinely honored by the adapter belong in
`supported_image_parameters`.

### Capability matrix

Record the exact accepted values for:

- `aspect_ratio`, `resolution`, and `size`.
- `n`, `input_references`, `output_format`, `quality`, `background`, and compression.
- `seed` and native `stream` support.
- Maximum prompt size, image dimensions, reference count, and request body size.

The endpoint capability JSON is DB-owned and consumed by
`packages/image-generation/capabilities/from-db.ts` and `validate-request.ts`. Distinguish
normalized fields from passthrough fields and note which adapter hook enforces each one.

Enumerate the provider's full advertised parameter surface, not just the values the first model
uses, so the adapter PR can extend the serving enums where needed (see the completeness rule in
`image-add-adapter`).

### Output and error shape

Document:

- Where image bytes appear: inline base64, data URL, or downloadable artifact URL.
- MIME type source and magic-byte fallback.
- Created timestamp, multiple-image behavior, and provider prompt rewrites.
- HTTP status, provider error envelope, request ID, moderation refusal, and retry headers.
- Async status values, poll interval, timeout, and terminal failure body.

The OpenRouter response is base64-only today: `ImageGenerationResponseSchema` returns
`created`, `data[].b64_json`, optional `media_type`, and `usage`.

### Provider/model/endpoint mapping

For every model:

- Upstream model ID (`provider_model_id`).
- OpenRouter model slug and author.
- Provider name/slug and image adapter enum.
- Sync versus async base class.
- T2I/i2i URLs, region, BYOK behavior, and provider options.
- `output_modalities: ['image']` and all endpoint capability fields.

## Phase B — Live capture matrix

Capture raw provider responses for:

1. Minimal text-to-image request.
2. Every normalized size/resolution/aspect-ratio combination the provider advertises.
3. `n > 1` when supported.
4. Each output format and quality/background mode.
5. Seed determinism where supported.
6. Image-to-image with one and maximum references.
7. Invalid capability, invalid prompt, moderation refusal, authentication, rate limit, and
   upstream 5xx responses.
8. Async submit, pending poll, success, timeout, and terminal failure when applicable.
9. Native streaming partial and completed events when applicable.
10. Provider options that affect output or cost.

Record request headers without keys, response status, response headers, raw body, provider request
ID, latency, and the exact model ID. Do not replace a capture with a hand-written fixture.

## Phase C — Billing reconciliation

For each scenario:

- Capture provider-reported usage or invoice estimate.
- Identify the billable unit: image, output token, input image token, megapixel, step, or a
  provider-specific unit.
- Map the unit to the pricing strategy and SKU names under `packages/pricing/strategies`.
- Record pricing JSON keys, cents versus dollars, resolution/quality variants, input-image costs,
  minimums, and rounding.
- Compare expected provider cost with the OpenRouter usage calculation and public pricing output.

Current image pricing projection is implemented in
`packages/pricing/billable/get-image-pricing.ts`; strategies include
`AzureMAIImage`, `BFL`, `Recraft`, `Sourceful`, `XaiImages`, and shared Gemini/OpenAI image SKUs.

## Phase D — Research note template

Write `docs/image-research/<provider>.md` with:

```md
# <Provider> Image Research

## Scope and sources
## Model and endpoint map
## Request/capability matrix
## Image-to-image and input references
## Response, streaming, and async lifecycle
## Error envelopes and retry behavior
## Billing model and reconciliation
## OpenRouter adapter/base-class choice
## OpenRouter DB fields and pricing strategy
## Live capture matrix
## Quirks and open questions
## Fixture inventory
```

Link each non-obvious claim to vendor documentation or a capture. Include exact examples of
`supported_image_parameters` and pricing JSON, but keep secrets and customer prompts redacted.

## Phase E — Fixture wiring

Use `create-fixtures` whenever the adapter changes upstream request or response handling:

- Store raw provider payloads under the image fixture convention selected by the package.
- Cover success, provider error, and any stream/poll event shape.
- Add a co-located adapter test that mocks `globalThis.fetch`.
- Assert normalized base64 output, MIME type, usage/SKU items, and error classification.

## Troubleshooting

- A provider returns a URL: use `resolve-artifact.ts`; do not add URL output to the public schema.
- A provider accepts a field but the capability gate rejects it: compare the DB JSON with
  `imageParametersToCapabilitySchema`.
- Pricing differs by resolution/model: use a variant SKU or pricing strategy field; do not encode
  one hardcoded price in the adapter.
- A provider has no stable error envelope: capture status/body and use the shared sanitization path.
- A provider only returns images asynchronously: use `BaseAsyncImageJobAdapter`.

## Related skills

- `image-provider-onboarding`
- `image-add-adapter`
- `image-stage-endpoint`
- `image-e2e-testing`
- `create-fixtures`
- `image-api-error-triage`

## Key source files

- `packages/image-generation/schemas/request.ts`
- `packages/image-generation/schemas/response.ts`
- `packages/image-generation/schemas/stream-events.ts`
- `packages/image-generation/capabilities/validate-request.ts`
- `packages/image-generation/adapters/AGENTS.md`
- `packages/image-generation/adapters/base/sync-image-adapter.ts`
- `packages/image-generation/adapters/base/async-image-job-adapter.ts`
- `packages/pricing/billable/get-image-pricing.ts`
- `packages/db/providers/resolve-endpoint-pricing-strategy.ts`
- `services/cfw-image-api/src/routes/images/generations.ts`
