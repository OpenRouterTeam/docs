---
name: video-add-adapter
description: "Phase 2: add a video-generation provider adapter with async submit/poll mapping, pricing, registration, and tests. Sub-skill of video-provider-onboarding."
user-invocable: true
---

# Add Video Adapter

Implement from a completed `docs/video-research/<provider>.md`. Video adapters must preserve the
job lifecycle and use the shared transaction, SKU, and artifact paths.

## Files to touch

- `packages/enums/adapters.ts` for the adapter identity.
- `packages/video-generation/adapters/<provider>/index.ts` and co-located tests.
- `packages/video-generation/adapters/<provider>/schemas.ts` for upstream payloads.
- `packages/video-generation/adapters/adapter-factory.ts`.
- `packages/video-generation/configs/get-adapter-name.ts` when mapping is exceptional.
- Provider pricing strategy/SKU files and `get-pricing-strategy.ts`.
- Provider metadata/config only when the provider is new.

## Adapter implementation

Extend `BaseVideoGenerationAdapter` from `packages/video-generation/adapters/base.ts`. Implement
`getUrl`, `transformRequest`, `transformResponse`, `getVideoDuration`, and
`getEstimatedSKUItems`; use the existing provider adapters as templates.

Map `prompt`, `duration`, `resolution`, `aspect_ratio`, `size`, `seed`, `generate_audio`,
`input_references`, `frame_images`, callback, and allowlisted provider options. Validate and
normalize upstream submit, poll, terminal, and artifact responses with Zod.

Where the research note records provider-supported values our serving enums lack (e.g.
`VideoGenerationResolution`, `VideoAspectRatio` in `packages/enums/video-parameters.ts`, duration
limits in `packages/video-generation/schemas/index.ts`), EXTEND the serving enums in this same
adapter PR so staged capability metadata is schema-valid by construction. Buddy-api staging writes
validate `supported_video_parameters` against these schemas and return 400 with `capability_issues`
on mismatch (`validateCapabilityFields` in
`services/cfw-internal/src/routes/buddy-api/validate-capability-fields.ts`, called from
`services/cfw-internal/src/routes/buddy-api/create-endpoint.ts`); the serving read path
returns `null` on schema failure
(`safeParseSupportedVideoParameters` in `packages/routing/endpoints/constructor.ts`) and video
routing treats missing capability lists as compatible with every requested duration or resolution
(`packages/video-generation/routing/by-video-parameters.ts`), so a malformed manually staged
row can look staged while requests receive no limits. Never drop the capability field to make a
request pass.

## Job lifecycle

Return the upstream job ID from submit. Classify pending/running/completed/failed/cancelled states
without treating a transient poll response as terminal. Ensure the artifact is fetched or exposed
through the normalized video result, and that duration is set before final SKU emission.
`VideoGenerationJob` owns persistence, alarms, retries, webhook delivery, and cleanup; do not
duplicate that logic in an adapter.

Video-in/video-out tools (upscale, edit) that derive duration, geometry, and audio from the source
clip: use `extractSoleVideoReference` in `adapters/video-input-reference.ts` for the single
`video_url` reference plus rejection of generation controls, return `null` from
`getVideoDuration` at request time, and set duration plus the final SKU from the terminal poll.
The `black-forest-labs-video-upscale` and `black-forest-labs-video-edit` adapters are the models.

## Pricing and registration

Define exact SKU units for per-second/per-video, duration, resolution, audio, and variants. Register
the strategy, adapter enum, factory entry, provider mapping, and endpoint pricing override. Ensure
estimated cost and final usage agree.

## Tests and commands

Mock `globalThis.fetch` and cover submit, each poll state, malformed/error responses, artifact
fetch, duration/SKU calculation, input references, passthrough filtering, and redacted logs.

```bash
bun run --filter @openrouter-monorepo/video-generation test
bun run --filter @openrouter-monorepo/video-generation typecheck
```

## Acceptance

- Adapter is selected for each intended endpoint.
- All advertised `supported_video_parameters` are honored and every provider-supported value is
  representable in the serving enums.
- Job and artifact lifecycle is terminal, bounded, and observable.
- Usage/SKU pricing reconciles for successful and failed jobs.
- Captures and tests cover real provider wire shapes without secrets.

## Related skills

- `video-provider-onboarding`
- `video-research-provider`
- `create-fixtures`
- `add-provider-adapter`

Before opening the PR, review the change against `packages/video-generation/REVIEW.md`.

## Key source files

- `packages/video-generation/adapters/base.ts`
- `packages/video-generation/adapters/adapter-factory.ts`
- `packages/video-generation/adapters/types.ts`
- `packages/video-generation/schemas/index.ts`
- `packages/video-generation/schemas/video-result.ts`
- `services/cfw-video-api/src/durable-objects/video-generation-job.ts`
