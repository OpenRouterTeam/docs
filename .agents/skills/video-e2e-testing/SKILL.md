---
name: video-e2e-testing
description: "Phase 4: run local video-generation end-to-end tests, including async jobs, artifacts, logs, and cost reconciliation. Sub-skill of video-provider-onboarding."
user-invocable: true
---

# Video Generation E2E Testing

Exercise submit, polling, terminal status, content retrieval, billing, callbacks, and observability
through `cfw-video-api`.

## Prerequisites and setup

- Research captures, adapter tests, pricing, model/endpoint rows, video KV, worker, and
  `dev-fs-logs` are ready.
- Start local services with `WRANGLER_INSPECTOR_PORT=0 bun run dev cfw-video-api usage-record dev-fs-logs`
  for callback settlement scenarios. The `usage-record` worker is required for final async-job
  persistence, and assigning an OS-selected inspector port avoids the shared default `9229`
  colliding between workers. The shorter `bun run dev cfw-video-api dev-fs-logs` command is
  sufficient only for scenarios that do not settle through the usage-record service.
- Default local port is `8788` (`Tiltfile` `video-api` resource, `CFW_VIDEO_API_PORT`).

```bash
bun run --filter @openrouter-monorepo/video-generation test
bun run --filter @openrouter-monorepo/video-generation typecheck
```

## Run scenarios

Run short deterministic text-to-video, image-to-video/frame, duration/resolution/aspect-ratio,
audio, invalid capability, provider failure, timeout, and callback scenarios where supported.
Poll until a terminal `AsyncJobStatus`; then fetch and validate video content. Assert job ID,
polling URL, generation ID, provider job ID, artifact URL, MIME/type, and non-empty bytes.

## Billing and logs

Reconcile estimated/final per-second or per-video SKUs, duration, resolution/audio multipliers,
failed-job policy, and BYOK. Inspect `services/dev-fs-logs/.logs/` for submit, poll, terminal,
artifact, charge/release, and webhook evidence. Ensure no double charge across polls.

Provider callbacks hit `POST /api/v1/videos/:jobId/provider-callback/:region/:token`
(`services/cfw-video-api/src/routes/video/provider-callback.ts`) and only wake the job's poll;
the callback body never settles the job. Local workerd rejects jurisdiction-scoped Durable
Object lookups (`europe`/`us` regions return 500 with "Jurisdiction restrictions are not
implemented in workerd"), so test regional callback routing with the route unit tests and use
`global` for local curls.

To receive a real provider callback locally, expose the worker through the repo's `dev-tunnel`
pattern (`cloudflared tunnel --url http://localhost:8788`) and set the live-config key
`video_provider_callback_origin` to `https://<tunnel-host>` through a local KV write or Mission
Control before starting the stack. The origin must be `https://`. Evidence lives in the worker log, not
`dev-fs-logs`: look for the `provider-callback` POST (MiniMax sends a `{ challenge }` POST at
submit time, then one status POST), then `Video generation provider callback received` with
`elapsed_ms`, followed by the poll settling ahead of the fallback interval. Poll the local API
at sub-second intervals: once the DO settles and cleans up, the local GET falls through to the
usage-record row, which local dev may not have.

For Atlas callback captures, warm `video_provider_callback_origin` through the actual
`POST /api/v1/videos` route with a valid-shaped request using a nonexistent model, then wait
before submitting the real job; the GET status route does not read this live-config key. Do not
edit repository files between warm-up and submission because Wrangler reloads discard the
isolate-local live-config cache. To capture raw callbacks without worker instrumentation, place
a recording Bun reverse proxy between cloudflared and the worker, forwarding requests
byte-for-byte and recording headers, raw bodies, and response statuses outside the repository.

## UI spot-check

With the local web app running, confirm the model appears under the video lane
(`output_modalities=video` in model discovery) rather than another modality, and that the
rendered pricing unit and values match the pricing JSON and endpoint discovery.

## After local testing

Production verification and the pre-public featured-example gate are owned by the launch process,
not this skill: see `docs/runbooks/model-launch.md` (§3 staging/private access, §3b launch gate).
Buddy's own skills own the gate mechanics.

## Done when

- Submit, poll, terminal, artifact, error, and callback paths pass as applicable.
- Video bytes, MIME, duration, and generation IDs validate.
- Logs prove routing, lifecycle, billing, and cleanup.
- The UI spot-check passes.
- Temporary local visibility changes and test data were cleaned up.

## Related skills

- `video-provider-onboarding`
- `video-stage-endpoint`
- `multimodal-daily-report`
- `debug-capsule`

## Key source files

- `packages/video-generation/schemas/index.ts`
- `packages/video-generation/adapters/base.ts`
- `services/cfw-video-api/src/app.ts`
- `services/cfw-video-api/src/durable-objects/video-generation-job.ts`
- `projects/web/components/model-discovery/build-discovery-lanes.ts`
- `docs/runbooks/model-launch.md`
