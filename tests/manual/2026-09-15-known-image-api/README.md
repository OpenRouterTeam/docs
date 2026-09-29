# Image API screening acceptance

This branch adds screening for input reference images on the dedicated image API. It uses the shared matcher and its own `known_csam_image` Live Config entry. All behavior rates default to zero. The shared schema also supplies the scan timeout; there is no environment-level enable flag. Chat screening settings do not activate this Worker.

The guard screens OpenRouter-funded attempts across all providers. BYOK attempts skip screening; a later fallback to OpenRouter credentials is screened before dispatch. A match returns the generic refusal and stops fallback. Observation runs in the background. HIPAA and unknown-posture requests are excluded before extraction. EU requests skip screening unless the independent `europe` rates are enabled.

## Local matcher scenarios

Use the existing harmless HMA bank described in [the initial guide](../2026-09-14-known-image-rollout/README.md). Leave a healthy matcher running.

```bash
bun test tests/manual/2026-09-15-known-image-api/index.test.ts
```

The service-local scenarios cover off, observation, blocking, a benign control, mixed supported/unsupported references, fail-open and fail-closed outages, default EU exclusion and BYOK bypass, other-provider matches, and text-only generation. They assert responses, matcher calls, provider dispatch, and no Queue delivery. The outage fixture uses a loopback 503 server.

## Authenticated HTTP acceptance

Prepare the isolated worktree database and API development environment using [the HTTP guide](../2026-09-14-known-image-rollout/README.md#authenticated-worker-http-acceptance). Keep local HMA on port 15100. The image suite reuses those local settings and writes only ignored image Worker configuration. Its upstream stub returns a harmless fixture and never calls an inference provider.

```bash
KNOWN_IMAGE_API_HTTP_ACCEPTANCE=1 bun test tests/manual/2026-09-15-known-image-api/http.test.ts
```

This exercises the real image Worker in workerd, seeded authentication, local Postgres/KV, HMA, and the OpenAI Images adapter against the local stub. Each stage checks an unauthenticated request too. Run this sequentially with chat and Queue HTTP acceptance because they share ports 20887 and 20889.

The fixture warms the nonblocking Live Config reader with harmless text-only requests. It does not establish immediate policy consistency on cold production isolates.

## Rollout

This Worker can deploy independently of Sentinel, reporting, and notifications. The PR adds no Queue binding and does not read the shared Sentinel delivery rate or capture request IPs. Queue delivery can be wired separately after its infrastructure and consumer are deployed; enabling the chat delivery rate cannot activate it here.

Start with the independent image observation rate. Blocking and fail-closed behavior each need their own rollout acceptance. Each region covers all providers. EU rates default off and must be enabled separately. Production bank settings and capacity are operational prerequisites, not established by local fixture tests.
