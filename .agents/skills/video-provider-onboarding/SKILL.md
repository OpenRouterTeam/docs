---
name: video-provider-onboarding
description: "Entrypoint for onboarding a video-generation provider from capability discovery through async adapter, staging, and end-to-end verification."
user-invocable: true
---

# Video Provider Onboarding

Use this as the single entrypoint for onboarding a video-generation provider. Video generation is
an asynchronous job surface: every phase must account for submit, poll, terminal status, artifact
delivery, billing, and cleanup.

## Required answers at invocation

- Provider API family, model IDs, regions, authentication, and BYOK behavior.
- Text-to-video, image-to-video, audio/video references, native audio, and callback support.
- Supported `duration`, `resolution`, `aspect_ratio`, `size`, `seed`, `generate_audio`,
  `input_references`, `frame_images`, and provider options.
- Submit response, upstream job ID, polling states, terminal errors, artifact URL/content shape,
  expiration, and retry limits.
- Billing unit and SKU source: per-second, per-video, resolution, audio, or provider tier.
- Model/endpoint visibility, private-access owner, and production cleanup owner.

Do not implement from documentation alone. Capture provider request, submit, poll, success, error,
and billing behavior before relying on assumptions.

## Composition

Run the phase skills in order:

1. `video-research-provider` — document capabilities, async lifecycle, pricing, captures, fixtures.
2. `video-add-adapter` — implement adapter, response mapping, pricing, registration, tests.
   Review the result against `packages/video-generation/REVIEW.md` before opening the PR.
3. `video-stage-endpoint` — stage model, endpoint, capabilities, pricing, KV, and worker request.
4. `video-e2e-testing` — run submit/poll/content flows, inspect logs, and reconcile billing.

## Provider foundation

- Add provider metadata, slug, icon, regions, API-key configuration, and BYOK policy.
- Register the video adapter identity and pricing strategy.
- Add model metadata with `output_modalities: ['video']`.
- Keep video capabilities endpoint-owned in `supported_video_parameters`; do not hardcode provider
  limits in routing or UI.
- Every provider-supported parameter value must be representable in the serving enums (see the
  completeness rule in `video-add-adapter`).
- Mission Control model editor URLs use the FULL model permaslug:
  `https://internal.openrouter.ai/model/edit/{model-permaslug}` (never `{author}/{model-slug}`).

## Single-modality PR stack

1. Provider foundation and metadata.
2. Research note, async captures, and raw fixtures.
3. Video adapter, schemas, pricing, registrations, and tests.
4. Database/KV staging and async worker evidence.

The adapter layer owns provider wire translation; staging owns rows/KV and submit/poll evidence.

## Gates before implementation

- Captures include submit, pending, poll, success, failure, cancellation/timeout, and artifact fetch.
- `VideoGenerationResponseSchema` and `VideoResult` behavior are understood.
- `BaseVideoGenerationAdapter` lifecycle methods, `VideoGenerationJob`, and `AsyncJobStatus` are
  used rather than reimplementing job persistence.
- Every advertised `supported_video_parameters` field is mapped or removed, and every value is
  valid under the serving schemas.
- Estimated and final SKU items agree for duration, resolution, audio, and provider variants.
- Local test plans have an explicit cleanup owner.

## Pre-public launch gate

Before the model goes public, the agent in the thread runs the featured-example
launch gate per `docs/runbooks/model-launch.md` section 3b; the `buddy` skill's
[`launch-examples.md`](../buddy/references/launch-examples.md) owns the mechanics.

## Related skills

- `video-research-provider`
- `video-add-adapter`
- `video-stage-endpoint`
- `video-e2e-testing`
- `stage-endpoint`
- `add-provider-adapter`
- `create-fixtures`
- `multimodal-daily-report`

## Key source files

- `packages/video-generation/README.md`
- `packages/video-generation/adapters/base.ts`
- `packages/video-generation/adapters/adapter-factory.ts`
- `packages/video-generation/schemas/index.ts`
- `packages/video-generation/schemas/video-result.ts`
- `packages/video-generation/routing/by-video-parameters.ts`
- `services/cfw-video-api/src/app.ts`
- `services/cfw-video-api/src/durable-objects/video-generation-job.ts`
