---
name: cfw-api-cpu-memory-optimization
description: cfw-api per-request CPU, memory and latency measurement runbook using api-perf Previews, worker metrics and local isolate profiling. Use when measuring running requests, profiling request-path performance, or investigating memory pressure outside the startup window.
user-invocable: true
---

# cfw-api Per-Request CPU, Memory and Latency

Runbook for measuring cfw-api under real requests. The
[`cfw-api-startup-optimization`](../cfw-api-startup-optimization/SKILL.md)
skill covers the separate Cloudflare startup CPU limit, bundle size and upload
timing. The [`cfw-fusion-isolate-memory`](../cfw-fusion-isolate-memory/SKILL.md)
skill covers fusion-specific isolate memory retainers and `exceededMemory`
analysis.

## What the perf worker measures

The `api-perf` worker is a throwaway Cloudflare Worker Preview of cfw-api. It
uses the same cfw-api source with FakeProvider-only inference and read-only
bindings, so several branches can be under load at once without sharing a
deployment or Durable Object storage. The Preview name follows the branch. The
run summary prints a stable hostname that follows the branch and an immutable
hostname pinned to the commit. Use the immutable hostname when comparing two
commits.

The Preview cannot write to Postgres, has no queue producer bindings and no
usage-record binding. It holds exactly one secret, the FakeProvider key, set by
hand in the worker's Previews settings with
`bunx wrangler preview secret put FAKE_PROVIDER_API_KEY --config wrangler.perf.toml`.
Every new Preview copies that secret. The workflow handles no secrets, no paid
provider key and no `PROVIDER_ENCRYPTION_KEY`, so load points at FakeProvider
endpoints by default; passthrough (see
[Profiling production OpenRouter routing](#profiling-production-openrouter-routing))
is the real-model option. The `FAKE_PROVIDER_API_KEY` is a Preview base-config
secret, and a Preview never inherits secrets from the production deployment.

The Preview omits `CF_AI`, presidio, sandbox, files-api, fusion and image-api.
Features behind those bindings report themselves unavailable and measurements of
those paths are not meaningful. `R2_SKILL_BUNDLES` no longer exists in either config: nothing in cfw-api ever
read it (the skills routes live in cfw-public-api), and an unused R2 binding
carries put and delete against the immutable skill-bundles store, so the
production binding was removed with the r2-audit rollout.

Its rate limiters fail open. Every Hyperdrive binding points at
`pg-us-central1-replica`, so cross-region latency is not comparable to
production. Every Preview shares those Hyperdrive configurations and the
production KV namespaces, so KV-contention experiments need their own
resources.

## Deploying a Preview

Use `repository_dispatch` to trigger
`.github/workflows/deploy-cfw-api-perf.yaml` from the branch under test. It
needs only `Contents: write` and deploys `wrangler.perf.toml` as the `api-perf`
Preview:

```sh
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=deploy-cfw-api-perf \
  -f 'client_payload[action]=deploy' \
  -f 'client_payload[ref]=<branch>' \
  -f 'client_payload[experiment]=cpu-hunt'
```

`client_payload[ref]` is the branch to deploy. The run itself reports the
default branch, so a dispatched run's `head_branch` is not the ref under test.
`action: bootstrap` creates the worker once. `action: delete` ends an
experiment early. Run the workflow from the branch under test so the Preview
name and hostname come from the ref.

A human can trigger the workflow from the Actions UI. An agent token cannot use
`workflow_dispatch`, so a 403 `Resource not accessible by integration` means
that path was used instead of `repository_dispatch`.

## Sending requests

A request to a Preview passes two independent checks, and confusing them wastes
time because both look like a 401.

1. **Cloudflare Access**, at the edge, before the worker runs. Satisfied by a
   service token sent as `CF-Access-Client-Id` and
   `CF-Access-Client-Secret`. Access strips both headers before the request
   reaches the worker.
2. **cfw-api**, in the worker. Satisfied by an OpenRouter API key sent as
   `Authorization: Bearer <key>`. The `Bearer` prefix is not optional. The
   header parser takes the second space-separated token, so a bare key reads as
   `undefined` and fails with `Missing Authentication header`.

The script reports which of the two rejected a request.

Query with service-token headers rather than a browser login. An Access cookie
reaches cfw-api's Clerk middleware, which the perf worker has no secret for.

Any OpenRouter API key works. The Preview validates it against the production
database replica and passes it upstream exactly as production does, so there is
no perf-specific key and no allowlist. What it cannot do is validate a key that
the replica has never seen: the Infisical dev seeded key under `/tests/e2e` and
`/services/cfw-api` exists only in the local seed database and returns 401. An
agent session already holds a production key in the `OPENROUTER_API_KEY`
environment variable.

That key is shared org-wide and has a real monthly budget. The Preview defaults
to FakeProvider, so it cannot spend, but pointing a run at a real model spends
from the shared pool and shares its rate limits with every other session in the
org. Use a separate key for load against real models.

Access credentials are not in Infisical. In CI, the pair lives in the
`Cloudflare API Perf` GitHub environment. In an agent session, the same values
are already in `CLOUDFLARE_ACCESS_ID` and `CLOUDFLARE_SECRET`. To mint a new
pair in Cloudflare One, follow [Putting the Previews behind
Access](#putting-the-previews-behind-access). In all cases, map the values to
`PERF_CF_ACCESS_CLIENT_ID` and `PERF_CF_ACCESS_CLIENT_SECRET` below.

```bash
export OPENROUTER_API_KEY=...      # OpenRouter API key
export PERF_CF_ACCESS_CLIENT_ID=...     # Access service token
export PERF_CF_ACCESS_CLIENT_SECRET=...

bun scripts/ci/query-perf-preview.ts \
  --url https://<preview>-api-perf.openrouter.workers.dev \
  --count 100 \
  --initial-delay-ms 200
```

The script is a load generator and an Access/auth canary, not a CPU
instrument. It prints per-request status and client-side wire timing, TTFB and
total, which carries network, colo, cold start and FakeProvider delay alongside
any worker cost. Read CPU from the worker's own events instead, per
[Measuring request-path changes](#measuring-request-path-changes).
The model defaults to `openrouter/fake-20260806`, so no request from it can
reach a paid upstream. Both the stable Preview URL and the immutable Deployment
URL of a single commit work as `--url`.

A Preview only picks up a merged fix on redeploy, including changes to how it
logs.

## Profiling production OpenRouter routing

The `api-perf` Preview can optionally forward keyed inference to production
OpenRouter instead of contacting a provider. Passthrough activates only when
`OR_PERF_SKIP_SIDE_EFFECTS` is `true`, the Preview base URL is configured, the
request has a valid API key, and the request is not already marked as
passthrough. It pins production to the endpoint selected by the Preview and
forwards the caller's own key, so real inference spends the caller's own
credits. Use a dedicated account with a credit limit when profiling.

Requests for `openrouter/fake-*` remain on FakeProvider and are free. Cookie-
authenticated requests, stealth adapters and non-inference requests
(embeddings, rerank, media and batch) do not use passthrough. Paid inference
needs a production-valid key in `OPENROUTER_API_KEY`, which agent sessions
already have; the local seed key the e2e suite defaults to is not valid
against the production replica.

Passthrough Previews reproduce production model output faithfully, including
reasoning content and `reasoning_details`, but a few response metadata fields
do not survive: reasoning-token usage fields
(`completion_tokens_details.reasoning_tokens` and the Responses API
equivalents) can be absent, zero or inconsistent, and `service_tier` is
`null`. At commit `b279465d971`, a run of the chat-completions, completions,
messages and responses suites produced 1004 passed, 54 failed and 259
skipped. The original 37 expected failures remain: 20 were capabilities
deliberately omitted by `wrangler.perf.toml` (6 image-generation and 14
web-search), 15 were reasoning-token usage assertions in
`api/chat-completions/reasoning/{basic,usage-tracking}.test.ts` and
`api/responses/reasoning/usage-tracking.test.ts`, and 2 were
`api/messages/regressions/service-tier.test.ts`. The remaining failures were
nine raw-fetch Access-login artifacts in
`api/responses/basic/error-handling.test.ts`, one `service_tier: null` snapshot
in `api/chat-completions/basic/simple.test.ts`, one web-search 500 in
`api/chat-completions/metadata/router-metadata.test.ts`, two additional
reasoning-token usage failures for OpenAI o4-mini and xAI Grok 4.3, one timeout
from the large-base64 video regression because the Preview omits the
sandbox/files-api bindings, and provider-nondeterminism cases in
`api/messages/edge-cases/incomplete-responses.test.ts` and
`api/messages/reasoning/block-index-ordering.test.ts`. Do not treat these
capability, passthrough, Access, binding, or provider-nondeterminism failures
as regressions when validating a branch on a perf Preview; diff against this
observed baseline instead.

### Preview Access and raw-fetch gotcha

An e2e test that calls `fetch` directly against `config.apiBase` does not
receive the Cloudflare Access service-token headers added by
`getPerfPreviewHeaders` in `tests/e2e/utils/config.ts`. On a Preview, the
request therefore follows Access's redirect to a `200 text/html` login page
instead of reaching cfw-api; the tell is the title `Sign in ・ Cloudflare
Access`. Check the raw-fetch sites in
`tests/e2e/api/responses/basic/error-handling.test.ts`,
`tests/e2e/api/messages/metadata/pipeline-guardrails.test.ts`,
`tests/e2e/api/responses/metadata/pipeline-guardrails.test.ts`, and
`tests/e2e/api/guardrails/accuracy-helpers.ts` before treating an unexpected
200 as a product response.

By hand:

```bash
curl https://<preview>-api-perf.openrouter.workers.dev/api/v1/chat/completions \
  -H "CF-Access-Client-Id: $PERF_CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $PERF_CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'x-initial-delay-ms: 200' \
  -d '{"model":"openrouter/fake-20260806","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
```

### FakeProvider response controls

The router forwards the headers in `FAKE_PROVIDER_HEADERS` from
`packages/llm-interfaces/schemas/request/index.ts`. Examples include:

- `x-initial-delay-ms`, `x-completion-tokens`, `x-reasoning-tokens`

An unlisted header is silently dropped at ingress. Content length is
`min(x-completion-tokens or 300, body max_tokens if present, 100,000)`, where
the header fallback applies when it is absent, invalid or zero.
`x-reasoning-tokens` adds reasoning tokens on top under the same 100,000-token
ceiling. See
[`services/fake-provider/README.md`](../../../services/fake-provider/README.md)
for the full header reference.

To check the hostname from the outside, without any credentials:

```bash
bun scripts/ci/query-perf-preview.ts --url https://<preview>-api-perf.openrouter.workers.dev --check-access
```

It exits non-zero when cfw-api answers an unauthenticated request, which proves
the hostname is reachable without Access. The deploy workflow runs this after
every deploy and fails the run on a public Preview. Setting the repository (or
`Cloudflare API Perf` environment) variable `PERF_REQUIRE_CF_ACCESS` to `false`
downgrades that to a warning, which is only for bringing a Preview up before
the Access application covers its hostname.

## Measuring request-path changes

Measure differentially. Deploy a second Preview from `main` and compare it to
the branch Preview with the same client and request shape. A single hostname's
absolute numbers are unusable because the baseline is not zero and cold starts
inflate the tail into seconds.

The metric is `cpuTime` from the worker's own request events, not client
latency. Those events reach Datadog tagged `@script_name:api-perf`, carry
`cpuTime`, `wallTime`, `outcome` and `response_status`, and are attributable to
one Preview by `@url`. Query each arm by its immutable hostname so a redeploy
cannot mix commits into one series.

Each worker log event also carries `@preview_slug`, read off the tail event's
`preview` metadata, so it labels a Preview whichever of its hostnames served the
request. That metadata is optional on the tail event, so pin a commit-scoped arm
on `@version` (the Cloudflare version uuid, on every api-perf event) or `@url`,
and treat the slug as a grouping convenience. Cloudflare's own metric-side
`preview_slug` does not behave the same way, per
[Preview memory metrics](#preview-memory-metrics).

One invocation emits several log lines that each repeat the same `cpuTime` and
`wallTime` snapshot, so aggregating raw lines weights a request by how much it
logged. Group by request id and take the maximum per group, then compute
percentiles over the per-request values:

```sh
curl -sS -X POST "https://api.us5.datadoghq.com/api/v2/logs/analytics/aggregate" \
  -H "Content-Type: application/json" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -d '{
    "compute": [
      { "aggregation": "max", "metric": "@cpuTime", "type": "total" },
      { "aggregation": "max", "metric": "@wallTime", "type": "total" }
    ],
    "filter": {
      "query": "@script_name:api-perf @url:*<deployment-id>-api-perf.openrouter.workers.dev*",
      "from": "<load-start-ms>", "to": "<load-end-ms>", "indexes": ["*"]
    },
    "group_by": [{ "facet": "@cf_ray_id", "limit": 1000 }]
  }'
```

A `sort` key on `group_by` is rejected by this endpoint, and `DD_API_KEY` /
`DD_APP_KEY` are already in an agent session.

Choose the sample size from the highest percentile claimed, not convenience.
For `n` requests per arm, percentile `p` has only about `n * (1 - p)`
observations behind it. Tens of requests support p50, at least 100 supports
p90, several hundred supports p95, and p99 needs thousands. With fewer
requests, report the supported lower percentiles and the observed maximum
instead of an unsupported percentile. State `n` per arm alongside every
percentile so readers can judge it, and treat overlapping arms as no result.
Report p50, p90, p95 and p99 when the sample supports them, along with how many
requests carried no numeric `cpuTime`. Do not use `pc50`-style aggregation
here: it percentiles raw log lines, so requests that log more count more.
Group with `max` first, then compute percentiles locally over one value per
request. Note each arm's load window in UTC and keep the arms non-overlapping
so neither series can absorb the other's requests.

End the query window well after the load finishes. Log lines land after the
client has its response, so a window that stops at the last response drops
requests and silently shrinks the sample.

Account for the tail rather than dropping it. Cold starts, the first requests
against a fresh Preview, and events from an earlier run of the same hostname
all belong in a separate bucket, named in the write-up, not merged into the
distribution.

`wallTime` measures elapsed invocation time, not CPU, and the two diverge by
orders of magnitude when a request waits. Use it to describe request-path
elapsed cost, never as a CPU proxy.

### The same trap in local CPU profiles

A local `.cpuprofile` has its own version of the `wallTime` mistake, and it has
already produced wrong conclusions in this campaign. V8 charges each sample the
whole gap since the previous sample, so the "self ms" of a frame that is on the
stack while the isolate awaits I/O includes that wait. On a streaming inference
scenario the measured mean sample gap was **994µs against a requested 100µs
interval** — the isolate was mostly awaiting upstream bytes, so every
wall-delta figure in the profile was inflated ~10x overall and up to ~80x for
individual awaiting frames (`fetch`, `read`, `postSpans`, the streaming `pull`).

Consequences to respect before quoting any local profile number:

- **Rank by `cpu ms` (`cpuEstimateMs` = samples x interval), never `self ms`.**
  The harness now prints both plus an `infl` ratio and warns when the mean gap
  exceeds 2x the requested interval. See `scripts/profile-inference/AGENTS.md`.
- **"% of mapped JS" is not a CPU share.** `mappedJsMs` is a wall-delta sum, so
  a share computed against it inherits the inflation and mixes waiting with
  work. Use `busySamples` as the denominator.
- **Subtract development-only cost.** The dev span exporter and fs-logs do not
  run in production and were 42% of busy CPU in the reference profile;
  `devOnlyCpuEstimateMs` reports it. fs-logs also *create* most local spans, so
  local profiles overstate per-span overhead in volume as well as in cost.
- **Check the sample count behind a candidate.** One sample is the resolution
  quantum (0.008 ms/request at 100µs over 12 requests), so anything under ~10
  samples is noise. For a sub-millisecond-per-request candidate, a local
  profile cannot settle it — microbenchmark the specific function on
  production-shaped input instead.

Worked example of the last point: span-constructor attribute processing
(`processAttributes` = `sanitizeAttributes(definedValues(attr))`) looked
significant in a wall-delta reading, but a direct microbenchmark measured
0.05µs for a 5-key CLIENT span and 0.29µs for a 22-key SERVER span. Even at 120
spans per request that is under 0.01 ms/request — about 50x below a 0.5
ms/request bar. The wall-delta reading and the profile's dev-only span volume
had made a negligible cost look actionable.

### Preview memory metrics

Worker log events carry no memory field, but Preview memory is a first-class
metric. Use
`openrouter.cloudflare.workersInvocationsAdaptive.byVersion.quantiles.memoryUsageBytes`
with `P50`, `P90`, `P99` or `P999`, or
`openrouter.cloudflare.workersInvocationsAdaptive.byVersion.max.memoryUsageBytes`.
Filter by `script_name`, `version` and `is_preview`. Values are bytes and are
per-minute quantiles across all requests for one worker version, not per-request
samples. The parallel `byVersion.quantiles.cpuTime*` series are microseconds,
unlike the log-derived `@cpuTime`, which is milliseconds.

Do not filter these series by `preview_slug` when the load ran against immutable
Deployment hostnames. Cloudflare fills `previewSlug` in per request, only for
requests that arrived at the alias hostname, and cf-analytics normalizes its
absent form to `preview_slug:unknown`, so immutable-hostname load lands under
`unknown` on every metric series while the logs still carry the real
`@preview_slug`. `version` is exact on both sides and is the tag to pin an arm
with.

The `version` tag holds a full UUID and the deploy run prints only its first
eight characters, as the immutable Deployment id. Resolve the arm by listing the
versions with `by {version}` over the load window and taking the one whose UUID
starts with that Deployment id, then query it directly:

```sh
curl -sS -G "https://api.us5.datadoghq.com/api/v1/query" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  --data-urlencode "from=<load-start-unix-seconds>" \
  --data-urlencode "to=<load-end-unix-seconds>" \
  --data-urlencode "query=avg:openrouter.cloudflare.workersInvocationsAdaptive.byVersion.quantiles.memoryUsageBytesP99{script_name:api-perf,version:<version-uuid>}"
```

For leak detection, sustain load long enough to produce many minute buckets,
then read the `P99`/`P999` and `byVersion.max.memoryUsageBytes` trends within
each arm. Monotonic growth across one arm is a leak. A level shift between arms
is a footprint change, not a leak. A short burst produces too few points to
support percentiles. Compare arms only at comparable load.

Use [local heap snapshots](#local-pre-traffic-heap-snapshots) to attribute
growth to a retainer after the metric series show it. Use the
[`cfw-fusion-isolate-memory`](../cfw-fusion-isolate-memory/SKILL.md) skill for
the fusion-specific case. These series, and the log-derived per-request
percentiles, are already assembled on the
[`api-perf` dashboard](https://us5.datadoghq.com/dashboard/c9w-pnp-4rx), defined
under `configs/terraform-monitors/monitoring/cfw_api_perf/`; the deploy run
prints a link to it scoped to the version it deployed.

Production telemetry provides a separate request-path CPU measure. Compare the
median `cpuTime / upstream_chunk_count`, excluding requests with zero upstream
chunks. The
[`cfw-api-startup-optimization`](../cfw-api-startup-optimization/SKILL.md)
skill records the specific post-merge acceptance gate that uses this method.

Client-side timing answers a different question. TTFB is meaningless on a
successful inference request, because the worker emits keep-alive whitespace
ahead of the real response; it is informative only for requests cfw-api rejects
before it starts responding. Treat the script's timing as evidence that load
arrived and that Access and auth are satisfied.

Always pin generation length explicitly with `x-completion-tokens` and
`max_tokens` so measurement requests do not drift when a default changes.

A request cfw-api rejects at auth is still a valid probe for anything that runs
before auth. It is cheaper and has much less variance than a successful
inference request. Check where the handler runs the thing under test before
assuming a working key is required.

Synthetic CPU cost cannot spin until a wall-clock deadline because Workers
freeze `Date.now()` during synchronous execution
(https://developers.cloudflare.com/workers/reference/security-model/). The
clock returns the time of the last I/O and does not advance while code runs.
Use a fixed iteration count and calibrate it from a deployed Preview because a
local host's throughput differs. Budget a deploy, a measurement, and a second
deploy for any calibration. Calibrate against `cpuTime` from the worker events,
not against added client latency, which includes time the CPU counter never
sees and biases the constant.

To point suites that use `callApi`, `apiFetch` or the media helpers at a
Preview, set `TEST_ENV=production`, `OPENROUTER_API_BASE=<preview url>`,
`OPENROUTER_API_KEY=<key>`, `PERF_CF_ACCESS_CLIENT_ID`, and
`PERF_CF_ACCESS_CLIENT_SECRET`. Tests that call `fetch` directly do not attach
the Access headers and will receive a 302. The Preview defaults to FakeProvider;
tests pinned to real provider models can run via passthrough (see
[Profiling production OpenRouter routing](#profiling-production-openrouter-routing)),
with a known set of failures.

## Local pre-traffic heap snapshots

In this workerd build, `wrangler dev` cannot provide a pre-traffic inspector
target: `/json` and `/json/list` advertise only a proxy target, with no
`core:user:*` target before traffic, and the advertised WebSocket times out.
For a pre-traffic heap snapshot, build with `wrangler deploy --dry-run`, run
`workerd serve` directly against the extracted bundle with a pinned inspector
address, and complete `HeapProfiler.takeHeapSnapshot` before issuing any
request. `HeapProfiler.collectGarbage` hangs in this build. Use the completed
snapshot as the GC boundary.

## Putting the Previews behind Access

Access is a Cloudflare One Access application, configured outside this
repository. No wrangler setting makes a Preview hostname private:
`workers_dev = false` does not cover Preview hostnames. The existing application
covers `*-api-perf.openrouter.workers.dev`, including stable per-branch and
immutable Deployment URLs, with a Service Auth policy for the token and an
Allow policy for humans opening the URLs in a browser. An uncovered Preview
fails its deploy instead of serving the public internet.
`PERF_REQUIRE_CF_ACCESS=false` is the setup escape hatch. Access is the only
rate limit in front of these hostnames because the perf worker's rate limiters
fail open.

## Expiry and cleanup

Cloudflare never expires a Preview. It evicts the least recently deployed one
when the worker reaches its Preview cap, which is not a time bound, so
`cleanup-cfw-api-perf-previews.yaml` runs hourly and applies two:

- **Six hours since the last deploy.** Always enforced, because it needs no
  telemetry.
- **One hour with no requests.** Enforced only when the workflow has both
  Datadog keys, because without them a Preview under load and an abandoned one
  look identical, and deleting the former destroys a running experiment. When
  they are missing, or when the activity query for a Preview fails, the run
  reports `activity_unmeasured` for that Preview and only the age cap applies.

A Preview younger than the idle limit is never deleted for idleness, since a
Preview is deployed before load is pointed at it. Redeploying resets both clocks,
so a long experiment survives by redeploying, or by running the cleanup workflow
with a larger `max-age-minutes`.

Which Previews exist comes from this repository's deploy-workflow run history,
matched by the deploy workflow's `run-name`, because wrangler 4.107.0 has no
`preview list` and the Previews REST API is in private beta. Consequences worth
knowing:

- A Preview created outside CI is invisible to cleanup and has to be deleted by
  hand.
- Renaming the deploy workflow's `run-name` blinds cleanup until
  `perfPreviewEventFromRun` is updated to match.
- Cleanup's own deletions leave no run behind, so a Preview it deleted stays on
  the list until its deploy run leaves the history window. The window is the
  age cap plus two hours for that reason, and a delete that finds nothing is
  reported as `already_gone` rather than counted or alerted on. Override it with
  `--lookback-minutes` only alongside a larger `--max-age-minutes`. A window
  shorter than the age cap hides Previews before they are ever deleted.

Idle time comes from the hostname in cfw-api's own request logs, which is the
only per-Preview signal available. Cloudflare's Workers metrics aggregate across
a script's hostnames. A request counts for a Preview unless its hostname belongs
to another live Preview, because a deployment's immutable hostname is named
after the deployment id and cannot be reconstructed from a Preview name. Load
pointed at a Deployment URL keeps its Preview alive, at the cost of holding the
other live Previews open until the age cap too.

To see decisions without acting on them, a human can dispatch
`cleanup-cfw-api-perf-previews.yaml` with `dry-run`; it is not an agent-triggerable
workflow today. The summary lists every Preview with its age, idle time and
reason.

To delete a Preview, dispatch the deploy workflow with `action: delete` from the
branch that created it:

```bash
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=deploy-cfw-api-perf \
  -f 'client_payload[action]=delete' \
  -f 'client_payload[ref]=<branch>' \
  -f 'client_payload[experiment]=cpu-hunt'
```

Deleting a Preview deletes every deployment in it. A deleted Preview comes back
by dispatching `action: deploy` again.
