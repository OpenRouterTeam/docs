# Presidio Service Monitoring

## Architecture

```
cfw-presidio Worker
  ├─ Structured logs (console.log/warn/error with JSON)
  └─ StatsD metrics (node:diagnostics_channel)
       │
       ▼
  cfw-instrumentation (tail consumer)
       │
       ▼
  GCP PubSub (telemetry-pipeline)
       │
       ▼
  gcp-queue-worker
       ├─ Logs  → Datadog Logs API (us5.datadoghq.com)
       └─ Metrics → StatsD → Datadog Agent (DaemonSet)
```

## Logs

The worker emits structured JSON logs for every request and container lifecycle event.
These are forwarded via `cfw-instrumentation` (tail consumer) to Datadog.

### Request Logs

Every proxied request emits a structured JSON log with timing breakdowns:

| Field | Description |
|-------|-------------|
| `service` | Always `presidio` |
| `endpoint` | `analyzer` or `anonymizer` |
| `method` | HTTP method |
| `status` | HTTP status code (on success) |
| `total_ms` | End-to-end request duration |
| `routing_ms` | Time to resolve DO routing |
| `body_read_ms` | Time to read request body |
| `rpc_ms` | Total DO RPC call duration |
| `container_fetch_ms` | Time inside the container for the HTTP call |
| `rpc_overhead_ms` | `rpc_ms - container_fetch_ms` (DO/network overhead) |
| `is_cold_start` | Whether this request hit a cold container |
| `request_body_chars` | Size of the request body in characters |
| `response_body_chars` | Size of the response body in characters |
| `size_bucket` | Payload size bucket: `<10k`, `10k-50k`, `50k-100k`, `100k-500k`, `500k+` |
| `request_colo` | CF colo where the request originated |
| `selected_hub` | Logical hub the request routed to (`EU`, `NAE`, `NAW`, `APAC`) |
| `data_region` | Data region (e.g., `us`, `eu`) |
| `durable_object_name` | DO instance name (e.g., `instance-NAE-0`) |
| `error` | Error message (on failure) |

### Container Lifecycle Logs

Container lifecycle events (`onStart`, `onStop`, `onError`) are logged with:

| Field | Description |
|-------|-------------|
| `cold_start` | `true` on `onStart` events |
| `container_type` | `analyzer` or `anonymizer` |

### Datadog Log Query Examples

```
# All presidio errors
service:presidio status:error

# Slow analyzer requests (>2s end-to-end)
service:presidio @endpoint:analyzer @total_ms:>2000

# Large payloads (>100k chars)
service:presidio @request_body_chars:>100000

# Large payloads that are slow (P99 suspects)
service:presidio @size_bucket:"500k+" @total_ms:>5000

# Latency breakdown by size bucket
service:presidio @size_bucket:"100k-500k" OR @size_bucket:"500k+" | stats p99(total_ms), p99(container_fetch_ms), p99(rpc_overhead_ms), avg(request_body_chars)

# Requests where RPC overhead dominates (>500ms overhead)
service:presidio @rpc_overhead_ms:>500

# Cold start requests
service:presidio @is_cold_start:true

# Cold start requests that were slow (>5s)
service:presidio @is_cold_start:true @total_ms:>5000

# P99 breakdown — container fetch vs RPC overhead by hub
service:presidio @endpoint:analyzer | stats p99(total_ms), p99(container_fetch_ms), p99(rpc_overhead_ms) by selected_hub

# Timeout correlation with large payloads
service:presidio @error:"Request timeout" | stats avg(request_body_chars), count by size_bucket

# Container starts (cold starts)
service:presidio "container started" @cold_start:true

# 5xx responses from containers
service:presidio @status:>=500

# Request timeouts
service:presidio @error:"Request timeout"
```

## StatsD Metrics

Metrics are emitted via `node:diagnostics_channel` and forwarded through the tail worker → telemetry pipeline → Datadog.

### Distribution Metrics (for percentile analysis)

| Metric | Tags | Description |
|--------|------|-------------|
| `presidio.total.duration_ms` | `endpoint`, `hub`, `data_region`, `size_bucket` | End-to-end request duration |
| `presidio.rpc.duration_ms` | `endpoint`, `hub`, `data_region`, `size_bucket` | Total DO RPC call time |
| `presidio.rpc_overhead.duration_ms` | `endpoint`, `hub`, `data_region`, `size_bucket` | RPC time minus container fetch time |
| `presidio.container_fetch.duration_ms` | `container_type` | Time for `containerFetch` inside the DO |
| `presidio.routing.duration_ms` | `endpoint`, `hub`, `data_region`, `size_bucket` | Routing resolution time |
| `presidio.routing.active_width` | `hub`, `container_type`, `tier` | Active routing width selected for the request |
| `presidio.body_read.duration_ms` | `endpoint`, `hub`, `data_region`, `size_bucket` | Request body read time |
| `presidio.request.body_chars` | `endpoint`, `hub`, `data_region`, `size_bucket` | Request body size (char count) |
| `presidio.response.body_chars` | `endpoint`, `hub`, `data_region`, `size_bucket` | Response body size (char count) |
| `presidio.warmup.duration_ms` | `container_type`, `instance` | Warmup health check duration |
| `presidio.container.alarm_failed_duration_ms` | `container_type`, `is_retry`, `retry_count` | Wall time the alarm ran before being reset (only emitted on alarm failure). |

All request-scoped distribution metrics include the `size_bucket` tag with values: `<10k`, `10k-50k`, `50k-100k`, `100k-500k`, `500k+`.

### Counter Metrics

| Metric | Tags | Description |
|--------|------|-------------|
| `presidio.container.cold_start` | `container_type` | Fired on first request after container start |
| `presidio.container.start` | `container_type` | Container started (onStart lifecycle) |
| `presidio.container.stop` | `container_type` | Container stopped (onStop lifecycle) |
| `presidio.container.error` | `container_type` | Container error (onError lifecycle) |
| `presidio.container.alarm_error` | `container_type`, `is_retry`, `retry_count` | Alarm-handler failure (DO storage reset). Tags surface CF alarm retry counter (max 3 retries). |
| `presidio.request.cold_start` | `endpoint`, `hub`, `data_region`, `size_bucket` | Request-level cold start counter |
| `presidio.rpc.error` | `endpoint`, `hub`, `data_region`, `size_bucket`, `error_type` | RPC failures/timeouts |
| `presidio.warmup.error` | `container_type`, `instance` | Warmup failures |
| `presidio.warmup.cold_start` | `container_type`, `instance` | Warmup triggered a cold start |
| `presidio.routing.tier` | `hub`, `container_type`, `tier` | Requests routed through the warm or burst tier |
| `presidio.routing.escalation` | `hub`, `container_type`, `reason` | RPC failure, timeout, non-2xx response, or slow response that escalated the active width |
| `presidio.routing.pool_exhausted` | `hub`, `container_type`, `reason` | Pressure failure received while the pool was already at its configured full width |
| `presidio.routing.unmapped_colo` | `container_type`, `colo` | Request colo missing from the colo→hub map (routed via the `NAE` fallback); a sustained new colo here needs a mapping added |

The `hub` tag has four values (`EU`, `NAE`, `NAW`, `APAC`), replacing the
former `colo` tag (~160 values), so metric cardinality drops accordingly.

### Recommended Datadog Metric Queries

```
# P99 end-to-end latency by size bucket
p99:presidio.total.duration_ms{*} by {size_bucket}

# P99 end-to-end latency by hub
p99:presidio.total.duration_ms{*} by {hub}

# P99 container fetch time (actual processing) by size bucket
p99:presidio.container_fetch.duration_ms{*} by {size_bucket}

# P99 RPC overhead — should be independent of payload size
p99:presidio.rpc_overhead.duration_ms{*} by {hub}

# Request body size distribution — see what payloads are coming in
p99:presidio.request.body_chars{*} by {endpoint}

# Latency vs size: scatter correlation (use Datadog notebook)
# X: avg:presidio.request.body_chars, Y: avg:presidio.total.duration_ms

# Cold start rate
sum:presidio.request.cold_start{*}.as_rate() / sum:presidio.total.duration_ms.count{*}.as_rate()

# Cold starts by hub — identify under-warmed regions
sum:presidio.request.cold_start{*} by {hub}

# Timeout rate by size bucket — are large payloads timing out?
sum:presidio.rpc.error{error_type:timeout} by {size_bucket}

# Container lifecycle (starts/stops per hour)
sum:presidio.container.start{*} by {container_type}.rollup(sum, 3600)

# Pool exhaustion events by hub
sum:presidio.routing.pool_exhausted{*} by {hub,container_type,reason}.as_count()
```

## Client-Side Metrics (cfw-api → cfw-presidio)

These metrics are emitted from the `packages/presidio` client code (running in cfw-api) and track the HTTP fetch path from the API layer to the Presidio service. They use the `openrouter.presidio.*` prefix to distinguish them from server-side `presidio.*` metrics.

### Per-Attempt Metrics

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `openrouter.presidio.fetch_attempt` | Counter | `stage`, `attempt`, `outcome`, `text_size`, `fetch_policy`, `attempt_timeout_cap_ms`, `total_budget_ms` | Incremented for each fetch attempt. Tracks which attempt failed and why. |
| `openrouter.presidio.fetch_attempt_latency_ms` | Distribution | `stage`, `attempt`, `outcome`, `text_size`, `fetch_policy`, `attempt_timeout_cap_ms`, `total_budget_ms` | Latency for each fetch attempt in milliseconds. |

**Tags:**
- `stage`: `analyze` or `anonymize`
- `attempt`: `0` (first attempt), `1` (retry), etc.
- `outcome`: `ok`, `timeout`, `http_4xx`, `http_5xx`, `network_error`
- `text_size`: `small`, `medium`, `large` (classified from request text length)
- `fetch_policy`: `per_attempt_retry` (small/medium text — two attempts capped at the per-attempt timeout) or `large_text_total_budget` (large text — first attempt capped below the total budget so a timeout can still retry within the remainder)
- `attempt_timeout_cap_ms`: per-attempt timeout cap in milliseconds
- `total_budget_ms`: total retry budget in milliseconds

### Terminal Outcome Metrics

| Metric | Type | Tags | Description |
|--------|------|------|-------------|
| `openrouter.presidio.fetch_outcome` | Counter | `stage`, `final_outcome`, `attempts_used`, `recovered`, `initial_failure_outcome`, `segment_count`, `text_size`, `fetch_policy`, `attempt_timeout_cap_ms`, `total_budget_ms` | Terminal outcome after all retries exhausted. |

**Tags:**
- `stage`: `analyze` or `anonymize`
- `final_outcome`: Same values as `outcome` above
- `attempts_used`: `1`, `2`, etc.
- `recovered`: `true` if a retry succeeded after an initial failure, `false` otherwise
- `initial_failure_outcome`: outcome of the first failed attempt (`timeout`, `http_4xx`, `http_5xx`, `network_error`) so a retry that fails differently is debuggable; `none` if the first attempt succeeded
- `segment_count`: number of text segments in the request (`1` for anonymize and unbatched analyze)
- `text_size`, `fetch_policy`, `attempt_timeout_cap_ms`, `total_budget_ms`: same as `fetch_attempt` above

### Client-Side Metric Queries

```
# Fetch attempts by outcome — which errors are we seeing?
sum:openrouter.presidio.fetch_attempt{*} by {outcome}

# Per-attempt latency by stage and attempt number
p99:openrouter.presidio.fetch_attempt_latency_ms{*} by {stage,attempt}

# Final outcomes — how many requests succeed vs fail after retries?
sum:openrouter.presidio.fetch_outcome{*} by {final_outcome}

# Retry recovery rate — are retries actually helping?
sum:openrouter.presidio.fetch_outcome{recovered:true}.as_count() / sum:openrouter.presidio.fetch_outcome{attempts_used:2}.as_count()

# Timeout rate by stage
sum:openrouter.presidio.fetch_attempt{outcome:timeout}.as_rate() by {stage}

# Cold-path (attempt 0) failures by outcome
sum:openrouter.presidio.fetch_attempt{attempt:0} by {outcome}

# Warm-retry (attempt 1) success rate
sum:openrouter.presidio.fetch_attempt{attempt:1,outcome:ok}.as_count() / sum:openrouter.presidio.fetch_attempt{attempt:1}.as_count()
```

## Recommended Datadog Monitors

### 1. Log-Based Error Monitor

**Query:** `logs("service:presidio @error:*").index("*").rollup("count").last("5m") > 5`

Alerts when more than 5 error logs appear in a 5-minute window.

### 2. P99 Latency Monitor (Metric-Based)

**Query:** `p99:presidio.total.duration_ms{endpoint:analyzer} > 10000`

Alerts when analyzer P99 exceeds 10 seconds.

### 3. Cold Start Spike Monitor

**Query:** `sum:presidio.request.cold_start{*}.as_count().rollup(sum, 300) > 20`

Alerts when more than 20 cold start requests occur in 5 minutes.

### 4. RPC Overhead Monitor

**Query:** `p99:presidio.rpc_overhead.duration_ms{*} > 2000`

Alerts when DO/network overhead exceeds 2 seconds at P99 — indicates routing or DO placement issues.

### Key Limitations

Cloudflare Containers do not expose infrastructure metrics (CPU, memory, disk I/O). All monitoring is application-level, emitted from the Worker code. There is no sidecar support for running a Datadog Agent inside the container.

## Infrastructure Configuration

| Parameter | Value |
|-----------|-------|
| Analyzer pool size (per hub) | EU 100/140, NAW 50/100, NAE 22/40, APAC 5/10 (warm/width) |
| Anonymizer pool size (per hub) | EU 6/12, NAW 5/10, NAE 3/6, APAC 2/4 (warm/width) |
| Sleep timeout | 10 minutes |
| Max instances (wrangler) | 300 per type |
| Analyzer instance type | `standard-4` (4 vCPU, 12 GiB RAM, 20 GB disk) |
| Anonymizer instance type | `basic` (1/4 vCPU, 1 GiB RAM, 4 GB disk) |
| Analyzer gunicorn workers | 4 (`WORKERS` in `analyzer.Dockerfile`) |
| Anonymizer gunicorn workers | 1 (upstream image default; `basic` has 1/4 vCPU) |
| Cloudflare platform autoscaling | Not available (Cloudflare unreleased feature) |

### Regional Hub Topology

Requests route to one of four logical hubs instead of a per-colo pool. Every
Cloudflare request colo maps deterministically to a hub in
`src/pool-hubs.ts`; unmapped or missing colos fall back to `NAE`, so no
request is ever dropped by the mapping:

| Hub | Coverage | Analyzer warm/width | Anonymizer warm/width |
|-----|----------|--------------------:|----------------------:|
| `EU` | Europe, Middle East, Africa | 100 / 140 | 6 / 12 |
| `NAW` | North America West | 50 / 100 | 5 / 10 |
| `NAE` | North America East, Latin America (default hub) | 22 / 40 | 3 / 6 |
| `APAC` | Asia Pacific, South Asia, Oceania | 5 / 10 | 2 / 4 |

Analyzer sizing is derived from offered load rather than request rate,
re-measured 2026-09-01: `openrouter.presidio.fetch_attempt{stage:analyze,
attempt:0}` per 5-minute bucket weighted by mean service time per `text_size`
(0.479s small, 0.492s medium, 1.067s large, from an unsaturated hour), over 4
sync gunicorn workers per instance at a 65% utilization target, then scaled by
1.6 because EU's active width sat pinned at 111-116 of its 116 ceiling while
that model asked for only 73 instances. Request rate alone mis-sizes a hub
whose text-size mix shifts: EU's analyze rate fell after 2026-08-31 while its
large-text share rose, so its offered load grew. Anonymizer sizing is
unchanged (223ms mean service time, 1 worker, 70% utilization). Hub pooling
multiplexes demand that per-colo pools could not share: on the same 2-day
5-minute dataset, per-colo pools sized to their own peaks need 340-426 warm
instances while the pooled hub demand needs 146. The warm floor is 177
analyzer + 16 anonymizer instances; total addressable width is 290 analyzer +
32 anonymizer, under the 300-per-type `max_instances` ceiling even if every
hub bursts to full width simultaneously (a colocated test in
`pool-sizing.test.ts` enforces `sum(width) <= max_instances - 10`).

A deploy is bounded more tightly than the table itself. Routing opens the new
widths as soon as it lands, while indices the new table no longer addresses
keep serving until the 10-minute sleep timeout reclaims them, so the deploy
window peaks at the per-hub maximum of the old and new widths, which must
stay within `max_instances`. The 10-instance reserve is the headroom those
abandoned indices may occupy, so a deploy that shrinks any hub can add at most
that much elsewhere, while an add-only deploy is bounded by the ceiling
directly. That is why EU
reached the 140 its measured peak asks for over two deploys: from the
previously deployed 116/53/105/16, EU 140 would have peaked at 314 during
the transition, so the first deploy stopped at 125 and a second deploy, after
the abandoned indices were reclaimed, took EU to 140 (transition peak 290).
`getPresidioPoolTransitionBudget` computes that peak and a colocated test
asserts it against the previously deployed widths.

NAW is sized below its demand on purpose. Its recurring bursts measure
440-600 instances of offered load between 5-minute p95 and peak, more than the
whole width budget, so NAW bursts still fail open until `max_instances` rises.
Every hub's width also stays within `warm + 4 * ceil(warm / 4)`, the widest
ceiling the escalation ladder below reaches in three consecutive failures.

Jurisdiction routing is unchanged: EU/US data regions still select the DO
jurisdiction namespace independently of the hub name, and regional requests
without `request.cf.colo` still fail closed. Instances are named
`instance-<hub>-<index>` (e.g. `instance-EU-0`). Cloudflare places each DO near
the colo that first addresses it, so a hub's instances land in-region near its
callers; this placement behavior is documented plus observed, not contractual,
so watch `presidio.rpc_overhead.duration_ms` by hub after migration.

Steady-state routing uses only each hub's warm range. An RPC failure, timeout,
or slow success exponentially expands that hub and container type's active
range, and each 60-second quiet period without another failure halves the
burst surplus back toward warm; Cloudflare's 10-minute idle sleep then
reclaims unused burst instances. The added cost of hub routing
is in-region RTT for callers outside the hub anchor (demand-weighted estimate
~5ms, worst cases ~95-120ms for SYD/GRU), small against the analyzer's ~509ms
p50 service time. Rollback is reverting the colo→hub mapping to per-colo
names; orphaned hub instances idle out within 10 minutes.

Raising `max_instances` still requires Cloudflare's per-account container
limit to be confirmed; `max_instances` stays at 300 until then.

An escalation records `http_error` for a non-2xx container response or
`slow_response` for a warm (non-cold-start) success over a payload-dependent
latency threshold: 2,500 ms for bodies under 50K characters (a leading
queueing signal, below the caller's 4,000 ms per-attempt budget in
`PRESIDIO_FETCH_TIMEOUT_MS`), and 4,000 ms for bodies between 50K and 100K
characters, where a warm analyzer legitimately exceeds 2,500 ms. Bodies of
100K characters or more never escalate on latency, since analyze time there
reflects the payload rather than pool pressure. Each escalation grows the
burst extent exponentially (`max(ceil(warm / 4), 2 * burst)`), so full width
takes two escalations for EU and three for NAE, NAW and APAC, and the
worker fire-and-forgets warmup pings (`ctx.waitUntil`) to the newly opened
indices, visible as a `presidio.warmup.*` burst during escalations. A
response that triggers an escalation is still returned unchanged to the
caller. RPC errors use `rpc_failure` or `rpc_timeout`.

Width above warm means a burst pays a container start plus spaCy model load on
each newly addressed index. The first requests to land on a cold index are
therefore slower and may exhaust the caller's fetch budget (8s for small and
medium text, 12s for large text), which is why warm floors are sized to peak
offered load rather than mean demand.

### Derived Monthly Cost Estimate

The warm floor is what the warmup cron pins. Because the cron runs every 5
minutes and `sleepAfter` is `10m`, warmed instances do not sleep between
warmup cycles. This estimate uses 720 awake hours per month.

For a `standard-4` analyzer instance, the stated memory and disk rates produce
approximately `$0.113` per awake instance-hour before CPU
(`12 GiB × $0.0000025/GiB-second + 20 GB × $0.00000007/GB-second`, multiplied
by 3,600 seconds). The `basic` anonymizer costs approximately `$0.010` per
awake instance-hour.

| Component | Calculation | Derived monthly cost |
|-----------|-------------|----------------------|
| Analyzer warm floor | `177 × $0.113 × 720` | ~$14,401 |
| Anonymizer warm floor | `16 × $0.010 × 720` | ~$115 |
| **Total warm floor** | | **~$14,516/month** |

The per-colo topology pinned 249 analyzer and 276 anonymizer instances
across 23 table colos (~$21,254/month at these rates). The four-hub topology
pins 177 analyzer and 16 anonymizer instances (~$14,516/month), roughly
$6,700/month lower warm spend, with the anonymizer floor collapsing hardest
because per-colo sizing pinned 12 anonymizer instances in every table colo.
The analyzer figure excludes CPU; on-demand instances outside the warm floor
add cost.

This is a derived estimate, not an invoice figure. Actual infrastructure
billing may differ from these stated rates.

## Performance Characteristics

Benchmarked 2026-02-22 against live Cloudflare Containers (Analyzer: `standard-3` / 8 GiB, Anonymizer: `basic` / 1 GiB). Note: benchmarks have not yet been re-run on `standard-4` / 12 GiB.

### Default Configuration

| Parameter | Value |
|-----------|-------|
| Chunk size | 50,000 chars |
| Max concurrent chunks | 10 |
| Chunk overlap | 200 chars |
| Per-chunk timeout | 15s |
| Total analyze timeout | 60s |

### Comprehensive Benchmark (v3, 10 runs/cell, 3-way parallel batches)

480 total requests across 48 cells (3 chunk configs × 4 entity scopes × 4 payload sizes).
Runs 1-2 are classified as "cold", runs 3-10 as "warm" for percentile calculations.

#### Warm Latency by Entity Scope (50K/10 config)

| Scope | 10K warm p50 | 100K warm p50 | 500K warm p50 | 1.6M warm p50 |
|-------|-------------|--------------|--------------|---------------|
| **single** (EMAIL only) | **441ms** | **2,238ms** | 9,222ms | 23,190ms |
| **structured** (5 regex entities) | 529ms | 2,604ms | **9,367ms** | - |
| **nlp** (PERSON, LOCATION, DATE) | 599ms | 2,896ms | 10,050ms | 20,728ms |
| **all** (no filter) | 696ms | 3,904ms | 12,072ms | 28,104ms |

Filtering to fewer entity types provides ~30-40% speedup vs scanning all entities.

#### Cold vs Warm (50K/10, all entities)

| Payload | Cold p50 | Warm p50 | Cold overhead |
|---------|----------|----------|---------------|
| 10K | 743ms | 696ms | 7% |
| 100K | 6,734ms | 3,904ms | 72% |
| 500K | 12,114ms | 12,072ms | ~0% |
| 1.6M | 31,430ms | 28,104ms | 12% |

Cold starts are most impactful on medium payloads (~72% overhead). Small and large payloads show minimal cold start impact because small payloads are fast regardless, and large payloads are dominated by NLP processing time.

#### Chunk Config Comparison (warm p50, all entities)

| Config | 10K | 100K | 500K | 1.6M | 1.6M status |
|--------|-----|------|------|------|-------------|
| **50K/10** | 696ms | 3,904ms | **12,072ms** | 28,104ms | **5/10 OK** |
| 50K/15 | 929ms | 1,971ms | 11,990ms | - | 1/10 OK |
| 100K/10 | 651ms | 3,718ms | 10,375ms | FAIL | 0/10 |

50K/10 remains the most reliable config with best XL success rate.

#### Small Payload (10K) Leaderboard — warm p50

1. `[50K/10][single]` **441ms** p95=673ms
2. `[50K/15][nlp]` 461ms p95=503ms
3. `[100K/10][nlp]` 495ms p95=893ms
4. `[50K/15][structured]` 518ms p95=779ms
5. `[50K/10][structured]` 529ms p95=771ms

#### Medium Payload (100K) Leaderboard — warm p50

1. `[50K/15][all]` **1,971ms** p95=3,605ms
2. `[50K/15][nlp]` 2,060ms p95=4,224ms
3. `[50K/10][single]` 2,238ms p95=4,606ms
4. `[50K/10][structured]` 2,604ms p95=4,015ms
5. `[100K/10][structured]` 2,885ms p95=3,257ms

#### Large Payload (500K) Leaderboard — warm p50

1. `[100K/10][structured]` **8,383ms** p95=10,399ms
2. `[50K/15][structured]` 8,685ms p95=11,368ms
3. `[50K/10][single]` 9,222ms p95=13,505ms
4. `[50K/10][structured]` 9,367ms p95=13,074ms
5. `[50K/10][nlp]` 10,050ms p95=12,132ms

### Performance Floor Analysis

The bottleneck is Presidio's NLP model speed, not chunking overhead:
- **10K chars (1 chunk):** ~440-700ms warm p50 — this is the irreducible per-chunk NLP processing time
- **100K chars:** ~2.0-3.9s warm p50 depending on entity scope
- **500K chars:** ~8-12s warm p50 — parallelized chunking helps but NLP dominates
- **1.6M chars:** ~20-30s — only 50K/10 config reliably completes (5/10 with all entities)

Entity scope has meaningful impact: scanning a single entity (EMAIL) is ~40% faster than scanning all entities.

Achieving sub-1s latency for payloads >10K chars would require replacing Presidio's NLP backend (e.g., regex-first approach for structured PII, ML only for fuzzy entities like names).
