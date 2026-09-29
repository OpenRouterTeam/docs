# Sizing CPU-only pre-dispatch steps

Some pre-dispatch steps do no I/O, so an own phase cannot measure them. Workers freeze `Date.now()` while JavaScript runs and advance it only at I/O, so a phase wrapped around pure CPU work records about 0ms. The step's cost lands in whichever interval spans the next I/O: the next own phase, an excluded interval, or `upstream` when no I/O comes before dispatch. Since every pre-dispatch await got an interval, none of it shows up as `unexplained` (see [Measured](#measured)). Size these steps from `cpuTime` instead.

## Steps this covers

- Skin request transforms: `transformChatCompletionsRequest` (chat-completions route), `transformResponsesRequestToChatCompletions` (responses route), `transformAnthropicMessagesRequestToInternal` (messages route).
- The full Zod parse in `validateRouterRequest` (`packages/router/helpers/request.ts`).
- Token estimate and budget checks: `RequestTokenEstimator.estimate` in `#getAdapterFromEndpoint` (`packages/router/index.ts`).
- The live-config read: `getRouterLiveConfigs` (`services/cfw-api/src/utils/router-live-configs.ts`). `LiveConfig.getMany` (`packages/cloudflare/live-config.ts`) returns cached, stale, or schema-default values and never awaits KV. A cold or stale key is revalidated in one background bulk read scheduled with `waitUntil` (`live_config_revalidate`), so KV latency is not on the request path. What remains is cache lookup and Zod parsing, which is CPU, so the step has no own phase. Measuring the background KV read would need a separate metric outside router latency.

## Method

`cpuTime` (milliseconds) is on every cfw-api `Transaction attempt` log line, next to the router latency fields under `@extra`. It covers the whole invocation, so one request's number cannot be split by step. Compare cohorts instead.

1. Pick a cohort split that turns the step on or off, or scales its input. Skin transforms differ by `@extra.skin`. The Zod parse and the token estimate grow with body size, so `@extra.router_latency_v2_tags.request_size` scales them.
2. Compare `cpuTime` against `@extra.router_latency_v2_unexplained` across the cohorts. If unexplained time moves with `cpuTime` across a split, and the own phases do not, that remainder is synchronous CPU.
3. For a number per step, use the Preview A/B method in `.agents/skills/cfw-api-cpu-memory-optimization/SKILL.md`: deploy one arm from `main` and one arm with the step skipped or run twice, send the same request shape to both, then compare per-request `cpuTime`. Production cohorts differ in more than one step, so they give a bound, not an attribution.

## Queries

Log search (Datadog UI, Logs > Analytics, measure `@cpuTime`, group by the facet):

```text
env:production service:api "Transaction attempt" @extra.router_latency_v2:*
```

The same breakdown from the API, grouped by skin. Swap the facet for `@extra.router_latency_v2_tags.request_size` to see the Zod parse and token estimate scale with body size. `DD_API_KEY` and `DD_APP_KEY` are already in an agent session.

```sh
curl -sS -X POST "https://api.us5.datadoghq.com/api/v2/logs/analytics/aggregate" \
  -H "Content-Type: application/json" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -d '{
    "compute": [
      { "aggregation": "pc50", "metric": "@cpuTime", "type": "total" },
      { "aggregation": "pc50", "metric": "@extra.router_latency_v2_unexplained", "type": "total" },
      { "aggregation": "pc50", "metric": "@extra.router_latency_v2", "type": "total" },
      { "aggregation": "count", "type": "total" }
    ],
    "filter": {
      "query": "env:production service:api \"Transaction attempt\" @extra.router_latency_v2:*",
      "from": "now-1h", "to": "now", "indexes": ["*"]
    },
    "group_by": [{ "facet": "@extra.skin", "limit": 10 }]
  }'
```

Unexplained share of router latency at p50, from metrics (Datadog UI, Metrics > Explorer, as a formula `a / b`):

```text
a = p50:openrouter.router.tx_attempt_latency{env:production,latency_type:router_v2_unexplained}
b = p50:openrouter.router.tx_attempt_latency{env:production,latency_type:router_v2}
```

The full breakdown, including every own phase and `unexplained`:

```text
p50:openrouter.router.tx_attempt_latency_breakdown{env:production} by {phase}
```

## Measured

Production, measured on 2026-09-28 for [PLA-2794](https://linear.app/openrouter/issue/PLA-2794). Unless a line says otherwise, the window is the 24 hours ending about 17:00 UTC on 2026-09-28, and the source is the cfw-api `Transaction attempt` log with one line per request:

```text
@script_name:api "Transaction attempt" @extra.is_first_attempt:true @extra.router_latency_v2:* -@executionModel:durableObject -@entrypoint:ProcessStreamJson
```

Each cohort below is this filter plus the clauses in its Cohort column, run through the aggregate call in [Queries](#queries) with `pc50` and `pc90` computes.

### Headline numbers

| Split | Requests | `router_latency_v2` p50 / p90 (ms) | `unexplained` p50 / p90 (ms) | `cpuTime` p50 / p90 (ms) |
| --- | --- | --- | --- | --- |
| All | 813M | 5 / 111 | 0 / 0 | 52 / 279 |
| `chat-completions` | 774M | 5 / 109 | 0 / 0 | 51 / 268 |
| `responses` | 24M | 11 / 107 | 0 / 0 | 125 / 416 |
| `anthropic-messages` | 15M | 7 / 141 | 0 / 0 | 81 / 369 |
| `completions` | 0.19M | 4 / 47 | 0 / 0 | 65 / 268 |
| `0_16kb` | 409M | 6 / 89 | 0 / 0 | 37 / 125 |
| `16kb_128kb` | 222M | 5 / 123 | 0 / 0 | 61 / 314 |
| `128kb_512kb` | 119M | 4 / 113 | 0 / 0 | 97 / 460 |
| `512kb_2mb` | 53M | 9 / 153 | 0 / 0 | 141 / 498 |
| `2mb_plus` | 10M | 49 / 384 | 0 / 0 | 233 / 646 |
| Not streamed | 573M | 6 / 107 | 0 / 0 | 41 / 180 |
| Streamed | 240M | 5 / 118 | 0 / 0 | 105 / 488 |

- Since 2026-09-26 00:00 UTC (2.04B requests): `router_latency_v2` p50 5 ms and p90 99 ms; `unexplained` p50 and p90 0 ms.
- Metrics, `service:cfw-api,is_hipaa_worker:false`, 24 hours: `router_v2` p50 6.0 ms and p90 115 ms; `router_v2_unexplained` p50 and p90 0 ms. Adding `server_tool_call:none,!server_tools_root:true` gives the same numbers.
- Daily metrics over 7 days: `unexplained` p50 is 0 ms every day from 2026-09-22. Its p99 was 7 to 8 ms and its mean 2.6 to 3.6 ms through 2026-09-25, then 0 ms.
- `is_hipaa_worker:true` has no `router_v2` samples in 7 days, so the HIPAA mirror is not measured.

### Unexplained went to zero on 2026-09-25

`unexplained` fell to exactly 0 during the 22:30 to 22:45 UTC rollout on 2026-09-25 that shipped [#47107](https://github.com/OpenRouterTeam/openrouter-web/pull/47107). Before it, about 2.8% of requests had `unexplained` above 0, and its mean grew with body size: 0.1, 1.4, 6.0, 13.1 and 97.9 ms by size bucket on 2026-09-24. The new `known_csam` phase has nearly the same profile (0.1, 1.3, 5.6, 18.9 and 105 ms). So most of the old remainder was the known-CSAM screen, which awaits I/O, not synchronous CPU. In the last 24 hours only 3 log lines, all retries, show `unexplained` above 0, at 1 ms each.

### Where CPU-only steps land

The data shows that every pre-dispatch wait now sits inside an interval. The clock advances only at I/O, so a CPU step never leaves a gap. Its time goes to the interval that spans the next I/O:

- an own phase, which it inflates (`spend_guard`, `auth`, `response_cache` and so on)
- an excluded interval, when the next I/O is a guardrail, tool or routing-model call
- `upstream`, for CPU after the last pre-dispatch I/O, because the dispatch stamp reads the frozen clock (`upstream-tracker.ts · begin`). That CPU is outside `router_latency_v2`. This case is inferred from the recorder code, not measured.

Step 2 of the method no longer separates anything, because `unexplained` is 0 in every split while `cpuTime` varies about fourfold. For non-streamed chat, `cpuTime` p50 is 35, 53, 59, 81 and 138 ms across the five size buckets, but `router_latency_v2` p50 stays at 6, 5 and 5 ms up to 512 KB and reaches 14 ms at 512 KB to 2 MB. The size-dependent CPU is either post-dispatch work (response handling, `waitUntil` logging) or pre-dispatch CPU inside `upstream`. Production cohorts cannot tell the two apart.

### Per-step bounds

Every number below is an upper bound from a production cohort, not an attribution. Cohorts differ in more than one step, and `cpuTime` covers the whole invocation. The comparisons use p50 over the same 24 hours.

| Step | Where its CPU lands | Bound | Cohort |
| --- | --- | --- | --- |
| Skin request transforms | The next own phase after the route calls `parseRequest` | Compared with chat, non-streamed `responses` costs 9.5 ms more `cpuTime` and 2.9 ms more `router_latency_v2`; `anthropic-messages` costs 2.9 ms and 1.9 ms more. Streamed requests show the opposite sign (-3.4 and -6.7 ms `cpuTime`), so the request transform itself is below what this cohort can resolve. | `0_16kb`, split by `@extra.skin` and `@extra.user_streamed` |
| `validateRouterRequest` Zod parse | The next own phase | The size-dependent part is at most about 1 ms up to 512 KB and at most 8 ms at 512 KB to 2 MB (`router_latency_v2` 6, 5, 5, 14 ms). This holds only if the parse runs before the last pre-dispatch I/O. | Chat, not streamed, split by `request_size` |
| Token estimate | `spend_guard` when a SpendGuard reserve runs (22% of non-streamed chat), otherwise `rate_limit` or `upstream` | `spend_guard` is 42, 44, 49, 55 and 53 ms by size bucket. The size-dependent part is at most 7 ms at 128 to 512 KB and at most 14 ms at 512 KB to 2 MB. | Chat, not streamed, `@extra.router_latency_v2_tags.spend_guard:allowed`, split by `request_size` |
| Live-config read | The first own phase to cross I/O | On a warm isolate, at most 6 ms (`router_latency_v2`); there is no cohort that turns the read off. Cold isolates (0.4% of requests) add 207 ms `cpuTime` and 150 ms `router_latency_v2`, but that covers every cold cache, not only live config. | Chat, `0_16kb`, not streamed, split by `@extra.router_latency_v2_tags.cold_isolate` |
| Body sha256 | `response_cache`, whose next I/O is `cache.get` | At most 2.9 ms `cpuTime` (37.7 compared with 34.8 ms) and at most 4 ms (`response_cache` p50 for chat, which also includes the `cache.get` wait). `router_latency_v2` is 4.9 ms higher. | Chat, `0_16kb`, not streamed, `@extra.router_latency_v2_own_by_phase.response_cache` above 0 compared with 0 |
| HIPAA dispatch check | The next own phase | No cohort: the check runs on every primary request, and the mirror emits no samples. Only the combined bound below applies. | None |

- All CPU-only steps that run before the last pre-dispatch I/O fit inside `router_latency_v2`. Together they take at most 5 ms at p50, or 6 ms for small non-streamed chat.
- All pre-dispatch CPU, including CPU inside `upstream`, is at most the `cpuTime` of a single-attempt failure, which skips response handling. For non-streamed chat those failures take 27, 29, 38, 43 and 113 ms by size bucket, against `router_latency_v2` of 4, 2, 3, 5 and 29 ms (`@extra.success:false @extra.provider_count:1`).

### Verdict

- **`unexplained` under 5% of `router_latency_v2` at p50: met.** It is 0 ms of 5 ms, and 0 ms at p90 and in the mean. It was already 0 at p50 before [#47107](https://github.com/OpenRouterTeam/openrouter-web/pull/47107), which cut the mean share from 5.1% to 0%.
- **CPU-only steps sized from `cpuTime`: bounds only.** The bounds are in the table above. A per-step number needs the Preview A/B in step 3 of the method.
- **Remainder:** no remainder is left in `unexplained`. Synchronous CPU now sits inside own phases and `upstream` instead. In the single-attempt failure cohort, `cpuTime` is 27 ms at p50 against 4 ms of `router_latency_v2`, so up to about 23 ms of per-request CPU does not show in `router_latency_v2`, before or after dispatch.

### Data quality

- Logs count 813M first attempts in 24 hours, but the `router_v2` metric has 618M samples, 24% fewer. The cause was not found.
- The metric's max `unexplained` in 24 hours is 604 ms, while the logs' max is 1 ms, so a few metric samples come from outside the first-attempt log line.
- Datadog percentiles are sketch estimates, and phase values are whole milliseconds.
- `response_cache` above 0 is a proxy for requests that opted in to response caching.
