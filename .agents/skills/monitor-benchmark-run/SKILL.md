---
name: monitor-benchmark-run
description: >-
  Monitor a running benchmark workflow (gpqa_diamond, tau_bench, terminal_bench,
  mmlu_pro, …), pull its accuracy, cost, throughput, latency, model mixture and
  router-decision counts from Temporal + BigQuery + ClickHouse + Datadog, and
  ship a self-contained HTML report comparing it against recent baselines.
  Use when someone says "monitor this run", "how is the bench doing", or asks
  what a run scored or whether it finished.
user-invocable: true
---

# Monitor and report on a benchmark run

- Use the four sources below; every source has a different join key.

| Source | Gives | Join key |
| --- | --- | --- |
| Temporal (`temporal` MCP) | status, start/close time, final `accuracy` / `chunkCount` / `failedChunkCount` | `workflow_id` |
| BigQuery (`cognition-bigquery` MCP) | per-sample scores as chunk parquets land | `parent_workflow_id` |
| ClickHouse (`clickhouse-analytics-mcp`) | per-generation cost, TTFT, tokens, model, provider | `session_id` = workflow id or `<workflow_id>.<epoch>.<sample_id>` |
| Datadog (logs analytics API) | router decisions, classifier timeouts, gateway errors/retries | `@breadcrumbs.session_id` or `@breadcrumbs.api_key_id` |

- Evals workspace id: `29cf899c-b3e9-49d7-9c2f-b6e7b4661f01`; scope every ClickHouse query to it or you are querying production traffic.
- The harness sends one `x-session-id` per sample, `<workflow_id>.<epoch>.<sample_id>`, so a run's generations never match `session_id = '<workflow_id>'` alone. Scope a run with `(session_id = '<workflow_id>' OR startsWith(session_id, '<workflow_id>.'))`. In Datadog, provider-side `@extra.session_id` has the same shape and `@extra.bench_run_id` holds the bare workflow id.

## 1. Poll

```text
temporal.describe_workflow(workflow_id)      # status, start_time, close_time
temporal.get_workflow_result(workflow_id)    # only after COMPLETED
```

- Never call a run finished until Temporal returns `WORKFLOW_EXECUTION_STATUS_COMPLETED`.
- BigQuery rows land before close; label accuracy and cost before close as provisional.
- Slow tasks are often harder, so tail accuracy can drift down as a run completes.
- Chunk parquets land in whole-chunk batches (e.g. 75 samples), so BigQuery counts can sit flat for hours on a healthy run; confirm liveness via `max(created_at)` on the run's ClickHouse generations before calling a run stalled. Low cost-tier lanes can run 2-4x longer than max-tier lanes of the same config.

Progress, at any moment:

```sql
SELECT COUNT(*) n, SUM(CASE WHEN score_value = 'C' THEN 1 ELSE 0 END) c
FROM `openrouter-core.benchmarks.benchmark_results`
WHERE parent_workflow_id = '<workflow_id>'
```

- `created_at` is a STRING; compare it with a string literal, not a TIMESTAMP.
- The benchmark column is `task`, not `benchmark_id`.
- One row is one sample × epoch; expected rows are `tasks × epochs`.
- `MAX(epoch)+1` is the number of epochs actually run.

## 2. Cost, throughput, latency, mixture

```sql
SELECT count() gens, round(sum(usage), 4) cost,
       round(quantile(0.5)(latency)) p50, round(quantile(0.95)(latency)) p95,
       round(sum(native_tokens_completion) / (sum(generation_time) / 1000), 1) tps,
       sum(native_tokens_prompt) in_tok, sum(native_tokens_completion) out_tok,
       countIf(cancelled) canc
FROM default.generations
WHERE workspace_id = '29cf899c-b3e9-49d7-9c2f-b6e7b4661f01'
  AND (session_id = '<workflow_id>' OR startsWith(session_id, '<workflow_id>.'))
  AND model_permaslug NOT IN ('<user-simulator-model>', '<grader-model>')
  AND generation_type != 'server_tool_root'
  AND coalesce(router_permaslug, '') != 'server-tools'  -- zero-usage wrappers
```

- Group mixture by `model_permaslug, provider_name`; use `created_at`, not `timestamp`.
- Exclude harness-side models by exact `model_permaslug`; never use `LIKE`.
- Sanity-check that the retained bucket contains the expected agent spend before reporting cost.
- Exclude `server-tools` wrapper rows from cost, token, and throughput aggregates.
- Wrappers mirror one row per agent request on server-tool runs; read their latency as end-to-end request duration.
- Cost per task is `sum(usage) / tasks`; state whether the denominator is tasks or task-epochs.
- Session-scoped sums overcount: sessions include sample-level retry generations (often 20-35% of gens, most of which completed fine upstream) that never made it into the graded parquet, even when Temporal reports `failedChunkCount: 0`. For final cost, pull the exact IDs from `benchmark_results_raw.generation_ids` (BYTES, double-JSON-encoded array; the table is external — get the workflow id from the `_FILE_NAME` pseudo-column) and filter ClickHouse by `generation_id IN (...)`. Report both numbers: the graded-generation cost (exact-ID sum) and the actual realized cost (full session sum), with the delta called out as retry wastage.
- Where each cost number lives: the Temporal workflow return value has no cost at all (only accuracy/question/chunk counts); the graded cost is aggregated by `benchmark-child.ts` into the Postgres `benchmark_results` row (`total_cost`) and appears in the parquet as a chunk-level `total_cost` replicated onto every row — dedupe to one value per chunk file (`_FILE_NAME`) before summing, or you overcount by roughly the chunk size. Both equal the exact-ID sum (harness only counts usage from responses it received), so neither surfaces retry wastage — only session-scoped ClickHouse sums do.

- Pinned-model runs: the agent is the pinned model with null `router_permaslug`; exclude wrappers separately.
- Auto-routed runs: agents have `router_permaslug = 'openrouter/auto'` across several models.
- Auto-routed null-router rows are simulator or grader traffic; use the positive route predicate when model sets overlap.
- Never apply the pinned-model filter to auto-routed runs, or the auto-routed filter to pinned runs.

- tau-bench `UserSimulator` shares the session id and uses a harness model; exclude that exact model.
- Its source path is `packages/bench-harness/src/benchmarks/tau-bench-airline/`.
- The simulator can be a large traffic fraction; do not infer the agent set from one model.

### terminal_bench session id

- The harness sets `x-session-id` for the pi subprocess (PR #31140), so scope by workflow id prefix like other benchmarks. The `http_referer` is `https://pi.dev/`.
- For older runs started before that change, `session_id` may be empty; fall back to splitting concurrent runs by `client_ip_hash` and start time, and label that attribution inferred.
- `conversation_id` is per task and stable across runs and epochs, so it cannot split runs.

```sql
SELECT client_ip_hash, min(created_at) t0, count() n, sum(usage) c
FROM default.generations
WHERE workspace_id = '29cf899c-b3e9-49d7-9c2f-b6e7b4661f01' AND session_id = ''
GROUP BY client_ip_hash   -- t0 before run 2's start_time → run 1, else run 2
```

- Filtering terminal_bench by user agent or referer alone over-counts unrelated traffic.

## 3. Router decisions in Datadog

- MCP `get_logs` truncates results and cannot count; use the logs analytics API directly.
- Use Datadog site **us5** with `$DD_API_KEY` and `$DD_APP_KEY`.
- The router decision messages come from `packages/router/plugins/auto-router/beta/model-router.ts`.

```bash
curl -s -X POST "https://api.us5.datadoghq.com/api/v2/logs/analytics/aggregate" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"compute":[{"aggregation":"count"}],
       "filter":{"query":"\"auto-router used fallback\" @breadcrumbs.session_id:*<run_suffix>*",
                 "from":"<ISO>","to":"<ISO>"}}'
```

- Count `auto-router resolved from rankings`, `auto-router task classification timed out`, and `auto-router used fallback`.
- `openrouter/auto` and `openrouter/auto-beta` share the same resolver (`beta/model-router.ts`), so these phrases apply to both. Each plugin also emits its own `AutoRouterPlugin resolved model` / `AutoBetaRouterPlugin resolved model` line per request; use those only to attribute a resolved model to a specific router, not for timeout/fallback counts.
- Timeout and fallback counts should match 1:1; mismatches indicate empty-rankings fallbacks.
- A model pick is not necessarily a classifier fallback; count the explicit fallback message.
- Query `*:<workflow-id>*` as a free-text fallback when the workflow id's log attribute is unknown.
- Without a session id, scope by `@breadcrumbs.api_key_id` from ClickHouse, not user agent or referer.
- Pinned-model runs with provider auto-routing have no model-selector decisions; provider mixture is the routing signal.
- Datadog rate limits aggressively; space aggregate calls about 15 seconds apart.

## 4. Baselines

- Query BigQuery for the same `task` across routers.
- Cut the comparison window at the last routing change, not an arbitrary recent date.

```sql
SELECT model_permaslug, max(created_at)
FROM default.generations
WHERE router_permaslug = 'openrouter/auto' AND model_permaslug ILIKE '%<model>%'
GROUP BY 1
```

- Pool epochs for identical configurations: `sum(correct) / sum(rows)`.
- State the denominator used by both the run and baseline.
- ClickHouse `completion_tokens / generation_time` is not the harness throughput column.
- Tau harness throughput includes simulator tokens; do not compare it directly with ClickHouse TPS.

## 5. Report

- Follow `code-diagram-html` for brand style and self-contained HTML conventions.
- Keep the generator script and its data file outside the repository; the report itself gets no PR.
- Generate inline CSS, a base64 font, one self-contained HTML file, and a full-page PNG.
- Screenshot with Playwright over CDP at `http://localhost:29229`.
- Do not use headless `google-chrome --screenshot`; it silently produces no file.
- Read the PNG back and verify it is non-blank and fully rendered before sending.
- Include run cards, cost/throughput/latency, mixture, router decisions, baselines, reliability, and method.
- Keep observed, inferred, and provisional values visually distinct.
- Place each caveat next to the number it qualifies, not in a footnote.

## 6. Resume and failure diagnosis

- Runs can resume via `benchmarkChildWorkflow` input `resumeFromWorkflowId`. Resume is per chunk: surviving chunk parquets are imported, only missing chunks rerun, and a fresh result row is written under the new workflow id. A chunk that dies mid-run leaves nothing to resume.
- A workflow can fail after every benchmark chunk succeeds if `insertBenchmarkResultsPostgres` times out after 180s; it has no retry policy. A full-reuse resume reruns only this cheap insert.
- Temporal MCP `get_workflow_history` output is large and truncates. Grep the overflow file for `"message"` and `ACTIVITY_TASK_FAILED` to find the failure cause.
