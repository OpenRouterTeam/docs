---
name: video-research-provider
description: "Phase 1: research a video-generation provider's async API, capabilities, pricing, polling lifecycle, and fixtures. Sub-skill of video-provider-onboarding."
user-invocable: true
---

# Research Video Provider

Produce a cited research note before adapter implementation. Video research must capture the
complete asynchronous job lifecycle, not only the initial generation request.

## Invocation and prerequisites

Record provider, model IDs, regions, auth source, endpoint owner, and intended API shape.

Before starting:

- Check the launch/chat thread for provider capabilities already dropped in by the requester;
  treat them as the primary capability input and reconcile them against provider documentation
  rather than starting from scratch.

Read:

- `packages/video-generation/README.md`
- `packages/video-generation/adapters/base.ts`
- `packages/video-generation/schemas/index.ts`
- `packages/video-generation/schemas/video-result.ts`
- `services/cfw-video-api/src/durable-objects/video-generation-job.ts`

## Documentation pass

Document request fields: `prompt`, `duration`, `resolution`, `aspect_ratio`, `size`, `seed`,
`generate_audio`, `input_references`, `frame_images`, `callback_url`, and provider options.
Separate accepted fields from fields actually supported by this provider.

## Capability matrix

For each field record provider support, valid values, conflicts, defaults, limits, and the exact
`supported_video_parameters` representation. Include text-to-video, image-to-video, first/last
frame, audio/video references, audio generation, duration, resolution, aspect ratio, and seed.

Enumerate the provider's FULL advertised parameter surface (all resolutions, durations, aspect
ratios, etc.), not just the values our serving enums already cover, so the adapter PR can extend
the serving enums where needed (see the completeness rule in `video-add-adapter`).

## Async capture matrix

Capture redacted examples for:

1. Submit request and response with upstream job ID.
2. Pending/queued/running poll responses.
3. Completed response and artifact URL/content.
4. Provider failure, moderation, expired artifact, timeout, and cancellation.
5. Callback/webhook behavior when supported.
6. Each billing-affecting duration/resolution/audio variant.

Record HTTP status, retry-after, request IDs, terminal classification, and artifact expiration.

## Billing reconciliation

Compare provider invoices or documented prices with `getEstimatedSKUItems`, `videoDuration`, and
the registered pricing strategy. Reconcile per-second and per-video units, minimum charges,
resolution/audio multipliers, failed-job policy, and BYOK behavior.

Refetch the machine-readable spec instead of trusting a task brief's summary of it, and derive both rates and capabilities from the same fetch. The spec often carries the rendered docs table too (Krea's OpenAPI puts it in `x-mint` next to `x-krea-pricing`), so one artifact settles whether docs and schema actually diverge — a brief claiming they do is worth re-deriving before treating the rate as unresolved. Where the schema advertises a priced dimension our SKUs cannot express (Krea's per-reference-image surcharge), narrow the capability declaration rather than forwarding an uncharged field. Provider usage endpoints often need a workspace-scoped key we do not hold, so do not plan on per-job billing readback to confirm a rate card.

## Research-note template

Use `docs/video-research/<provider>.md` with:

```text
# Provider
## Sources and authentication
## Models, regions, and endpoint map
## Request and capability matrix
## Submit/poll/status lifecycle
## Artifact and callback behavior
## Errors, retries, timeout, and cancellation
## Billing and SKU reconciliation
## Adapter/base-class choice
## Endpoint fields and pricing JSON
## Live capture matrix
## Open questions
## Fixture inventory
```

## Fixture wiring

Use `create-fixtures` for raw submit, poll, terminal success, artifact, and error payloads. Keep
secrets and media redacted. Add tests for request mapping, status classification, artifact
normalization, and SKU emission.

## Related skills

- `video-provider-onboarding`
- `video-add-adapter`
- `video-stage-endpoint`
- `video-e2e-testing`
- `create-fixtures`
- `multimodal-daily-report`

## Key source files

- `packages/video-generation/schemas/index.ts`
- `packages/video-generation/schemas/video-result.ts`
- `packages/video-generation/adapters/base.ts`
- `packages/video-generation/adapters/types.ts`
- `packages/video-generation/routing/by-video-parameters.ts`
- `services/cfw-video-api/src/durable-objects/video-generation-job.ts`
