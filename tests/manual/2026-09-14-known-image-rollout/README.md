# Known-image rollout: local acceptance

Start with the [application review and rollout guide](../../../packages/kyc/docs/known-image-review-rollout.md) for PR order, deployment configuration and live acceptance gates. This page covers local verification.

This suite runs the actual Router preflight, rollout policy, image hydration, HMA HTTP client and local HMA matcher. Provider responses use the existing benign router fixtures. It checks both the caller result and whether provider dispatch happened. The expected stage behavior is recorded in `snapshot.json`.

The suite covers observation and request blocking. The Worker binding and Mission Control rollout controls have separate scoped tests. Authenticated Worker HTTP acceptance is available as a separate opt-in suite below. Later stack layers add separate Queue/Sentinel and reporting acceptance suites; this suite does not test those stages. Automatic account actions remain outstanding. A local test bank does not validate an operational NCMEC bank or its matching threshold.

## Setup

Run these commands from the repository root with Docker running:

```bash
bun install --frozen-lockfile
bun run --cwd packages/chat-templates build
bun scripts/coop-hma-local-runtime.ts ensure-env
bun scripts/coop-hma-local-runtime.ts start-hma
bun scripts/coop-hma-local-runtime.ts bootstrap-benign-bank
```

`start-hma` starts HMA and its database dependencies. `bootstrap-benign-bank` replaces only the local `OPENROUTER_TEST` bank with the checked-in harmless fixture and rebuilds its index. The Router suite below respects existing worktree port overrides; the separate authenticated HTTP suite requires the fixed ports listed in its setup section. Both suites use loopback HTTP for HMA and never contact a real inference provider.

## Run the stages

Run all twenty-eight cases:

```bash
bun test tests/manual/2026-09-14-known-image-rollout/index.test.ts
```

Run one stage at a time:

```bash
bun test tests/manual/2026-09-14-known-image-rollout/index.test.ts --test-name-pattern '^off:'
bun test tests/manual/2026-09-14-known-image-rollout/index.test.ts --test-name-pattern '^observe:'
bun test tests/manual/2026-09-14-known-image-rollout/index.test.ts --test-name-pattern '^block:'
bun test tests/manual/2026-09-14-known-image-rollout/index.test.ts --test-name-pattern '^fail_closed:'
```

| Scenario | Caller result | HMA lookups | Provider dispatches |
| --- | --- | --- | --- |
| Gates off, matching fixture | Allowed | 0 | 1 |
| Observation, matching fixture | Allowed; match logged | 1 | 1 |
| Blocking, matching fixture | Generic prohibited-content refusal, 403 | 1 | 0 |
| Blocking, unrelated fixture | Allowed | 1 | 1 |
| Blocking, remote image unsupported by the matcher | Allowed; coverage gap logged | 0 | 1 |
| Blocking, matching fixture plus unsupported remote image | Whole request refused, 403 | 1 | 0 |
| Blocking, matcher outage | Allowed; failure logged | 1 | 1 |
| Fail closed, matcher outage | Moderation unavailable, 503 | 1 | 0 |
| Blocking, capped extraction with a retained match | Whole request refused, 403; incomplete coverage logged | 1 | 0 |
| Blocking, capped extraction without a retained match | Allowed; incomplete coverage logged | 1 | 1 |
| Fail closed, capped extraction without a retained match | Moderation unavailable, 503 | 1 | 0 |
| EU request during the initial rollout | Allowed; screening skipped | 0 | 1 |

The outage cases use a temporary loopback HTTP server returning 503. They leave the running HMA service intact. Remote image references use the reserved `media.example` domain and are not fetched by HMA.

## Resizing and re-encoding checkpoint

Six cases use fixed transformations of the existing harmless bank image and unrelated control. The matching variants must produce a match log during observation and refuse the entire request before provider dispatch during blocking. Both transformed controls must pass through. Only the original `exact-match.png` is in `OPENROUTER_TEST`; the variants are not added to the bank. The tests also reject a variant file that is byte-identical to its original.

```bash
bun test tests/manual/2026-09-14-known-image-rollout/index.test.ts --test-name-pattern 'resized|jpeg'
```

| Fixture | Source | Fixed transformation |
| --- | --- | --- |
| `fixtures/match-resized.png` | `dev/coop-hma/fixtures/exact-match.png` | 1200 × 630 → 600 × 315 PNG |
| `fixtures/match-jpeg.jpg` | Same matching source | Original dimensions, JPEG quality 85 |
| `fixtures/no-match-resized.png` | `dev/coop-hma/fixtures/no-match.png` | 780 × 1688 → 390 × 844 PNG |
| `fixtures/no-match-jpeg.jpg` | Same unrelated source | Original dimensions, JPEG quality 85 |

The checked-in files were generated with macOS `sips`; no image-processing dependency is needed to run the suite. To regenerate them from the repository root:

```bash
sips --resampleHeightWidth 315 600 dev/coop-hma/fixtures/exact-match.png --out tests/manual/2026-09-14-known-image-rollout/fixtures/match-resized.png
sips -s format jpeg -s formatOptions 85 dev/coop-hma/fixtures/exact-match.png --out tests/manual/2026-09-14-known-image-rollout/fixtures/match-jpeg.jpg
sips --resampleHeightWidth 844 390 dev/coop-hma/fixtures/no-match.png --out tests/manual/2026-09-14-known-image-rollout/fixtures/no-match-resized.png
sips -s format jpeg -s formatOptions 85 dev/coop-hma/fixtures/no-match.png --out tests/manual/2026-09-14-known-image-rollout/fixtures/no-match-jpeg.jpg
```

These cases use the configured local HMA index and the existing client threshold without adjustment. They establish compatibility for these particular image transformations.

## Worker rollout controls

The Worker reads the `known_csam` Live Config entry; rates alone select screening. That entry also sets `scanTimeoutMs` (integer 1–30,000, default 5,000) and `reportingIpCaptureEnabled` (default false). The HTTP harness uses a 10,000 ms timeout and enables IP capture only for the explicit reporting-IP acceptance run. Mission Control registers this as **Known-image screening rollout**. Behavior rates default to zero and accept fractions from zero to one. The optional `additionalProvidersRate` also accepts zero to one; omission keeps expansion off. These tests use explicit local configurations; they do not change a deployed gate or Live Config value.

| Stage | `observationRate` | `blockingRate` | `failClosedRate` |
| --- | --- | --- | --- |
| Off | 0 | 0 | 0 |
| Observe all eligible traffic | 1 | 0 | 0 |
| Block matches, fail open on errors/gaps | 0 | 1 | 0 |
| Block matches and fail closed on errors/gaps | 0 | 1 | 1 |

Use smaller fractions for gradual ramps. Fail closed applies only within the blocking cohort. With provider expansion omitted, the initial filter applies to every stage: direct OpenAI, Global/US, images. EU-restricted attempts skip the feature. The Worker reads Live Config without waiting on KV and uses the off defaults on a cold isolate; stronger fail-closed activation must account for this existing Live Config behavior.

## Later provider expansion

The same Router policy supports an optional `additionalProvidersRate`. Leave it omitted or zero for the initial direct-OpenAI rollout. Later, a request-stable cohort of other selected providers can join the existing observation/blocking/fail-closed ramps. Setting expansion alone cannot enable screening. EU-restricted requests still skip screening.

```json
{"observationRate": 1, "blockingRate": 0, "failClosedRate": 0, "additionalProvidersRate": 0.01}
```

This example observes all eligible direct-OpenAI traffic and samples additional-provider requests at 1%. Behavior ramps are shared: if blocking is already enabled, sampled additional providers join that blocking cohort too. Expansion does not create an independent observation period for them. Before activating it, review all four rates together.

```bash
bun test tests/manual/2026-09-14-known-image-rollout/index.test.ts --test-name-pattern '^providers:'
```

Eight additional cases use Together as the only available endpoint, so they cannot accidentally pass by routing to OpenAI. They cover expansion off, behavior off, observation, match refusal, a benign control, fail-open and fail-closed outages, and EU exclusion. Each checks actual HMA lookups, structured outcomes and provider dispatches.

The shared Router integration covers chat, responses and messages. This acceptance suite exercises chat with local HMA and benign provider fixtures; it does not validate every upstream API or the dedicated image-generation/embedding paths. Those paths and EU remain follow-up work. No deployed configuration is changed.

## Worker binding regression tests

The Worker host tests cover lazy loading, cold imports in observation versus blocking, import-failure policy, regional skips and hydration context forwarding:

```bash
bun test services/cfw-api/src/utils/known-csam-router-screening.test.ts services/cfw-api/src/utils/router-live-configs.test.ts services/cfw-api/src/config.test.ts
```

## Related regression tests

The fast router suite also proves that a match prevents fallback, a fallback into OpenAI is screened, observation returns while matching is still pending, and the existing HIPAA exclusion is preserved pending the scope decision:

```bash
bun test packages/router/plugins/known-csam-observation/index.test.ts packages/router/tests/known-csam-integration.test.ts packages/router/tests/known-csam-blocking.test.ts
```

Extraction stops at 32 image entries and conservatively records incomplete coverage without reading beyond the cap. The capped cases repeat one harmless fixture 33 times; retained identical images are deduplicated into one HMA lookup. They prove that a retained match still blocks and that an incomplete scan without a match follows the selected fail-open/fail-closed policy. They do not imply that an image beyond the cap was scanned.

## Authenticated Worker HTTP acceptance

The HTTP suite exercises the actual workerd entrypoint, seeded API-key authentication, local Postgres, local KV, the Worker host, HMA and the existing fake-provider server. It verifies all four stages with 20 image requests, including a confirmed match alongside a coverage gap and a simulated matcher outage. A streaming loopback relay counts matcher and provider requests; a blocked request must dispatch to the provider zero times. The observation case also waits for the Worker's structured match log.

The blocking and fail-closed stages also send four distinct harmless PNGs of about 7 MiB each, which sit just under the 30 MiB aggregate observation budget, and expect four concurrent HMA lookups with the request allowed. Adding the matching fixture as a fifth image must refuse the request after five lookups. A final run of the four-image request against a relay that holds every matcher response for 12 seconds, past the configured 10 second scan timeout, must record an indeterminate outcome: the blocking stage allows the request and the fail-closed stage returns 503. This exercises the shared deadline across concurrent workers and holds several hydrated images in the Worker at once. The relay closes each connection after its response so the Worker never reuses a pooled socket that Node's keep-alive timeout has already closed between requests.

Use a linked worktree and an Infisical login (`infisical login`, or `INFISICAL_TOKEN`) that can read the cfw-api dev scope. The environment preparation command refuses the primary checkout, starts from cfw-api's Infisical dev secrets under your `.env.development.local` overrides (the same inputs `bun run dev cfw-api` uses), replaces inference credentials with a synthetic key, removes HMA ingress credentials, directs Postgres to a worktree-specific database and disables both Coop handoffs. It writes only ignored development files. Keep the shared local Postgres and Pub/Sub emulators running; do not reset them.

Prepare the isolated database and Worker configuration from the repository root:

```bash
bun run db:known-image
bun scripts/known-image-http-env.ts
```

`db:known-image` reuses the existing migration and seed machinery. Re-running it skips already applied migrations and seed data. It creates a separate logical database on the existing local Postgres server at port 54322.

Start HMA using the setup above, with its default local port 15100. In another terminal, start a dedicated fake upstream:

```bash
cd services/fake-provider
FAKE_PROVIDER_API_KEY=known-image-local-synthetic-key PORT=20888 bun run start
```

Run the HTTP suite below; it starts Wrangler directly with the isolated configuration. Do not run `bun run dev cfw-api` after preparation, because that command regenerates the development configuration. Each stage also sends an unauthenticated image request and verifies a 401 with no matcher or provider dispatch.

Run all HTTP stages, or select one:

```bash
KNOWN_IMAGE_HTTP_ACCEPTANCE=1 bun test tests/manual/2026-09-14-known-image-rollout/http.test.ts
KNOWN_IMAGE_HTTP_ACCEPTANCE=1 bun test tests/manual/2026-09-14-known-image-rollout/http.test.ts --test-name-pattern 'block:'
```

The suite owns Worker port 20887 and relay port 20889; leave them free. It starts and stops its own Worker process for each stage, names it `api-known-image-local` to avoid replacing the primary checkout's dev registry entry, and seeds only local KV under `.wrangler/known-image-http-state`. The catalog keeps OpenAI's provider identity for eligibility but routes exclusively to the loopback relay and fake server. This suite is opt-in; ordinary runs leave these HTTP cases skipped.

Each stage warms the existing Live Config reader using harmless text requests before testing the effective policy. This validates warmed stage behavior, not immediate gate consistency across cold production isolates. Afterward the Worker and relay stop; the fake upstream and HMA remain running. Local Worker output is appended to `coop-http-worker.log` in the system temporary directory (`node:os.tmpdir()`). The fixed ports mean this suite should run in one worktree at a time.

The fail-closed coverage-gap expectation records the current draft behavior; whether that later stage should close on gaps as well as errors remains a policy question. The HTTP suite uses Global requests; the existing Router suite covers the initial EU exclusion and terminal fallback behavior. Neither suite validates a production hash bank, production ingress authentication, persistent usage delivery, Sentinel or reporting.
