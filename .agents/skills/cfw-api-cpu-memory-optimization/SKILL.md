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

## The api-perf Preview

What the Preview has and lacks, how to deploy it, authenticate, use passthrough, the e2e baseline, Access and cleanup are in [`cfw-api-perf`](../cfw-api-perf/SKILL.md#preview-reference), which also holds the task-level workflows (smoke, A/B, repro, config overrides). This skill covers how to measure once load is flowing.

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
- **Prove the two arms ran the same workload before reading a delta.** Response
  bytes and transport chunk counts are socket-timing artifacts, not proof that
  both arms produced the same model output. `--action compare` refuses pairs
  whose scenario, workload identity (API URL, endpoint, body hash, headers,
  API-key digest, sampling arm), model-event total, completion-token total,
  or model-output digest differ, and refuses any arm whose requests produced
  more than one distinct output. The digest folds each response to what the
  model said (text, reasoning, tool names and arguments, finish reason;
  Anthropic block types, text, thinking, tool-use name and input, stop
  reason) and ignores framing, ids, timestamps, and usage, so equal event and
  token totals with different text are still rejected. A sidecar written
  before those fields existed must be re-collected, not compared.
- **The sampling arm in a sidecar is the arm cfw-api booted with.** The pin
  only changes through a restart, so a run whose requested arm (including the
  implicit `inherit` of a plain `--action run`) differs from the worker's
  materialized `.dev.vars`, or whose `.dev.vars` was modified after the
  listening workerd process started, is refused before any request is sent.
  The check compares file mtime with `ps -o etime` of the API listener; it
  cannot read the environment inside workerd, so a same-second rewrite or a
  worker started from another checkout passes it. Finish or switch a series
  with `--prepare --sampling <arm>`, never by editing the env file.
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

### Per-frame CPU is mostly per-wakeup CPU

Measured 2026-09-03 with real process CPU on local workerd (below), the same 8,192-token FakeProvider stream costs about 120 µs/token at 1 ms per upstream chunk and about 380 µs/token at 20 ms per chunk. Production's `cpuTime / chunks_received_from_last_stream` shows the same gradient (0.35 ms/chunk at ~775 chunks/s, 0.67 ms/chunk at ~14 chunks/s). The JavaScript pipeline is the same in both cases; what changes is that a slow stream wakes the isolate once per frame, and a wakeup that runs one frame's worth of cold code costs several times what the same code costs warm. A trivial single-`TransformStream` proxy worker measures 33 µs/chunk at 1 ms pacing and 245 µs/chunk at 20 ms pacing, so that is the floor any per-frame JavaScript pays, not something adapters add.

Consequences:

- **Measure at production pacing.** FakeProvider accepts `X-Per-Chunk-Delay-Ms`; production streams mostly arrive at 10–30 ms per chunk (35–90 chunks/s). A tight-loop microbenchmark (10,000 chunks with no delay) prices a stream stage at ~4 µs and a promise hop at well under 1 µs; at 20 ms pacing the first JavaScript stage per wakeup is ~160 µs and each further stage ~20 µs. Wins measured only in a tight loop or in Bun overstate how much pipeline-side fusion buys and understate wakeup-count changes.
- **Removing hops does not remove wakeups.** Eliding the whole plugin generator chain (P = 3 layers, ~12 promise hops per frame) saved ~9% of streaming CPU at 20 ms pacing and nothing measurable on the non-streaming path; dropping two `Promise` allocations per chunk in the StreamBreaker pump was unmeasurable. Changes that make one wakeup carry several frames (BYOB `read(view, { min })`, see `packages/cloudflare/upstream-read-coalescing.ts`) halve the non-streaming path instead.
- **The V8 sampler under-reports at slow pacing.** At 100 µs sampling the harness reported 29 µs/token for a stream that cost 121 µs/token of process CPU and 108 µs/token for one that cost 377 µs/token; the sampler cannot keep its interval across idle gaps. Rank frames with it, but quote costs from process CPU or production `cpuTime`.
- **Turn the development sinks off first.** With the dev span exporter and fs-logs active and head sampling on, 90% of the local busy CPU in a long stream was those sinks (protobuf span serialization, per-log fetches, and their `captureException` retries when the collectors are unreachable), and the residue still hid inside promise continuations that ancestry-based dev-only filtering misses. Pin `--sampling off`, and expect to make `isFSLoggingEnabled` and `installDevSpanExporterIfDev` return early locally (do not commit that) before reading any per-frame number.

To read real process CPU per request, resolve the cfw-api workerd pid (the `workerd serve … --inspector-addr` process whose cwd is `services/cfw-api`) and diff `ps -p <pid> -o time=` around one long request; the 10 ms resolution is fine for a 4,096-token stream. The `streaming-many-tokens-fast` and `non-streaming-many-tokens-fast` scenarios in `scripts/profile-inference/scenarios.ts` run the same shape at 1 ms pacing, and this run's local reference values were 4,096 tokens at 20 ms pacing: ~300 µs/token with `stream: false` and ~330–400 µs/token with `stream: true` (the machine's run-to-run spread is about ±10%, so pair arms and repeat rather than trusting one pair).

Production splits by chunk rate and client mode with the `"Transaction attempt"` log: `@extra.user_streamed` is the client flag (`false` for 74% of requests and ~63% of all cfw-api CPU as of 2026-09-03), `@extra.streamed` is the upstream flag (always true on the SSE adapters), and `@breadcrumbs.chunks_received_from_last_stream` counts upstream SSE events. Bucket `@wallTime` at a fixed chunk-count band to see the pacing gradient. Frames per wakeup is `chunks_received_from_last_stream / upstream_reads_from_last_stream`; the `upstream-read-coalescing` read-stat breadcrumbs only fire on the non-streaming coalesced path, so do not use them to size batching for `user_streamed:true`. Bucket any streaming vs non-streaming per-request CPU comparison on `@extra.router_latency_v2_tags.request_size` and `@extra.retry_count:0` as well, since request size and retries account for most of the apparent low-chunk fixed-cost gap. The Infisical `/services/cfw-api` Datadog keys are logs-write-scoped and 403 on every read endpoint, including dashboards; a personal access token (`ddpa…`, sent as `Authorization: Bearer`) reads dashboards, logs search, and logs aggregate.

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

To run the e2e suites against a Preview, and for the known-failure baseline, see [`cfw-api-perf`](../cfw-api-perf/SKILL.md#smoke-test-a-branch).

## Local pre-traffic heap snapshots

In this workerd build, `wrangler dev` cannot provide a pre-traffic inspector
target: `/json` and `/json/list` advertise only a proxy target, with no
`core:user:*` target before traffic, and the advertised WebSocket times out.
For a pre-traffic heap snapshot, build with `wrangler deploy --dry-run`, run
`workerd serve` directly against the extracted bundle with a pinned inspector
address, and complete `HeapProfiler.takeHeapSnapshot` before issuing any
request. `HeapProfiler.collectGarbage` hangs in this build. Use the completed
snapshot as the GC boundary.
