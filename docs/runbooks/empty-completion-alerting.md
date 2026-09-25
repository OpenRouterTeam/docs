# Empty and hollow completions as failures (ECO-3908, ECO-3909)

A 2xx attempt that produced no assistant output is recorded the same way as a
200 with `finish_reason=error`: the router calls
`ModelCallRecorder.observeUnsuccessfulFinish()` before sealing the outcome, the
finish row lands in `default.model_call_outcomes_v1` with
`is_unsuccessful_finish = true`, migration 213 classifies it as `silent_200`,
and the model uptime alert cron counts `silent_200` as a non-served call.

Shapes (`empty_completion_shape` on the transaction-attempt log line, and the
`shape` tag on `openrouter.empty_completion`):

| shape            | output | reasoning | upstream usage | ticket   |
| ---------------- | ------ | --------- | -------------- | -------- |
| `empty`          | none   | none      | present        | ECO-3908 |
| `reasoning_only` | none   | present   | any            | ECO-3908 |
| `hollow`         | none   | none      | missing        | ECO-3909 |

Finish reasons that explain an empty body on their own (`length`,
`content_filter`, `error`) and classified refusals are not shapes.

`hollow` keys off the adapter's `upstreamRawResponseUsage`, so a provider that
omits usage for transport reasons (for example a stream with no usage chunk)
labels a plain empty as `hollow`. The failure count is unaffected; only the
ECO-3908 / ECO-3909 split can over-attribute to `hollow`. Check
`sum:openrouter.empty_completion{shape:hollow} by {provider}` before reading
the split per provider.

## Downstream consumers of `silent_200`

The unsuccessful finish row feeds more than the uptime alert. Everything that
reads `unsuccessful_finish_count` at status 200 sees these attempts as failures
from the first deploy, the same way mid-stream broken streams already do:

- Model uptime alert cron (`services/cfw-internal/src/routes/cron/model-uptime-alerts.ts`)
- Fortuna endpoint scoring (`services/cfw-api/src/kv/fortuna-scoring.ts`), so
  affected endpoints lose quality score and can be deranked immediately
- Endpoint status (`packages/routing/endpoints/endpoint-status.ts`)
- Provider billing snapshot (`packages/clickhouse/provider-billing-snapshot/`)
  and the SDK catalog (`services/cfw-api/src/kv/transform-sdk-catalog.ts`),
  where the count is added to derankable errors

If a clean pre-#42269/#42284 baseline is needed, read it from the
`openrouter.empty_completion` counter and the `empty_completion` log event,
which are emitted regardless of the accounting.

## Datadog

Log query for the per-generation events:

```text
service:cfw-api "empty_completion" @extra.shape:(empty OR reasoning_only OR hollow)
```

Counter: `openrouter.empty_completion` tagged `shape`, `provider`, `model`,
`streamed`.

Transaction-attempt lines carry `@extra.empty_completion_shape` and
`@extra.outcome_bucket:silent_200_failure`.

No dedicated monitor ships with the instrumentation. Once a week of data gives
a baseline per provider, add one under `configs/terraform-monitors` following
its `AGENTS.md`. Until then the model uptime alert (`model-uptime-alerts` cron)
is the alert rule, because these shapes now count towards its `silent_200`
bucket.

## ClickHouse: verify the alert input sees the new failures

Finish rows written by the new path, last hour:

```sql
SELECT
    minute,
    request_model_permaslug,
    terminal_endpoint_id,
    countIf(finalizeAggregation(is_unsuccessful_finish)) AS unsuccessful_finishes
FROM default.model_call_outcomes_v1 FINAL
WHERE minute >= now() - INTERVAL 1 HOUR
  AND finalizeAggregation(terminal_status) = 200
GROUP BY minute, request_model_permaslug, terminal_endpoint_id
HAVING unsuccessful_finishes > 0
ORDER BY minute DESC
LIMIT 100;
```

Uptime rollup consumed by the alert cron. `silent_200` rising relative to
`served` for an endpoint is the condition that fires:

```sql
SELECT
    terminal_endpoint_id,
    request_model_permaslug,
    sum(served) AS served,
    sum(silent_200) AS silent_200,
    sum(upstream_fault) AS upstream_fault,
    silent_200 / greatest(served + silent_200 + upstream_fault, 1) AS silent_share
FROM default.model_endpoint_uptime_minute_v1 FINAL
WHERE minute >= now() - INTERVAL 1 HOUR
GROUP BY terminal_endpoint_id, request_model_permaslug
HAVING silent_200 > 0
ORDER BY silent_share DESC
LIMIT 50;
```

Cross-check a single generation from the Datadog event against the rollup by
matching `generation_id` in `default.endpoint_requests`
(`is_unsuccessful_finish = true`, `status = 200`).

## Local verification

```bash
cd packages/router && bun test ./helpers/empty-completion-instrumentation.test.ts
cd packages/routing && bun test ./helpers/classify-outcome.test.ts ./model-call-recorder.test.ts
```

The recorder test `observeUnsuccessfulFinish` + `finish(ok(true))` shows the
finish row written with `status: 200, is_unsuccessful_finish: true`.
