[../243_add_byok_measures_to_app_and_provider_activity.sql](../243_add_byok_measures_to_app_and_provider_activity.sql)

# BYOK backfill for `app_and_provider_activity_daily_v8`

migration 243 adds BYOK-conditional sum columns and repoints the minute MV,
which only affects future inserts. Every aggregate row written before the
migration ran carries 0 in the new `byok_*` columns, so until this backfill
completes, history reads as if all traffic were non-BYOK: a wrong answer, not
a missing one. Consumers (provider dashboard filters, exports) must not trust
the new columns for date ranges before the watermark below.

## Why this is a hand-run runbook and not a `packages/backfill` task

`packages/backfill` is the reviewed control plane for chunked, resumable,
mutually excluded backfills, and `tasks/backfill-endpoint-perf-v5` is its
ClickHouse precedent. This repair deliberately stays outside it:

- It is a one-off with a bounded, small input: one daily-grain `INSERT …
  SELECT` per UTC day from `2026-06-18` (the v8 cutoff) to the activation day,
  on the order of 100 statements, each idempotent by construction (the delta
  form below inserts nothing on re-run). The control plane's chunking, lock,
  and resume machinery buys nothing for a run that short, while registering a
  task costs a `cfw-internal` registry entry, a queue consumer path, trigger
  and plan schemas, and colocated tests (the v5 precedent is ~6k lines).
- The delta join must read the target table's *current* state per key. That
  is a serial, whole-day read-then-write; the control plane's parallel chunk
  delivery would need explicit per-day serialization to stay correct, which
  is exactly the "do not run two statements for the same day concurrently"
  rule below, enforced by the operator instead.
- The statement runs under the ClickHouse operator role from a SQL console;
  it does not need worker credentials, KV, or Mission Control.

If a second BYOK-shaped repair is ever needed, promote this to a
`ReviewedBackfillTask` first rather than copying this file.

## Approach: additive delta rows into the daily table

The activity tables are `AggregatingMergeTree` with
`SimpleAggregateFunction(sum, …)` measures, so inserting rows that carry values
only in the `byok_*` columns (all other measures 0, i.e. omitted from the
insert column list) merges additively into the existing aggregates for the
same key. No rewrite of existing rows is needed.

The **daily** table is backfilled directly from `default.generations`. The
minute table is deliberately not backfilled: `app_and_provider_activity_minute_v8`
has a 1-month TTL, and the daily rollup does not re-read the minute table for
historical days.

Each insert writes the **delta** between what `default.generations` says the
day's BYOK totals should be and what the daily table already holds for that
key. This makes the backfill idempotent (a re-run inserts nothing) and
handles the two double-count hazards of a blind additive insert:

- **Interrupted runs.** A partially inserted day converges on re-run instead
  of double-counting.
- **Late-arriving rows.** The repointed MV processes rows by *insert* time,
  the backfill scans by `created_at`. A row with pre-activation `created_at`
  that is inserted after activation gets its BYOK measures from the live MV;
  a created_at-bounded blind insert would count it a second time. The delta
  subtracts whatever the live MV already wrote.

The delta is computed per rollup key. Do not run two backfill statements for
the same day concurrently (the second would read a stale "current" snapshot),
and prefer running a day only once ingestion for it has quiesced. For
historical days that is always true. For the activation day, wait until new
inserts with pre-activation `created_at` have stopped arriving (a few hours is
ample), then run it and re-check with the reconciliation query.

## Watermarks

Let `:activation` be the timestamp migration 243 was applied in production
(when the repointed MV started writing the `byok_*` columns).

There are **two** watermarks, because readers hit different tables:

- **Daily table**: trustworthy from the earliest backfilled day onward once
  this runbook has completed.
- **Minute table** (`app-and-provider-activity/endpoint-queries.ts`,
  `provider-queries.ts`, `lifetime-tokens/queries.ts` and any sub-day or
  timezone-bucketed read): never backfilled, so the `byok_*` columns are only
  trustworthy for `date >= :activation`. This holds for the whole 1-month TTL
  window; only after that have the pre-activation rows aged out on their own.

Consumers gating a BYOK filter must gate against the watermark of the table
they actually read, not just the daily one.

Backfill scope: days up to and including the activation day get the delta
backfill for the whole day (the delta form makes the activation-day overlap
with live MV writes safe, no `created_at < :activation` clamp is needed). Days
after need nothing, live inserts carry the values.

## Backfill statement (`app_and_provider_activity_daily_v8`)

One statement per UTC day, oldest first. Replace `:day` (Date). The
`expected` filters mirror the minute MV (migration 243): the private-model /
private-endpoint exclusion and the server-tool guard on `byok_requests`.
`:day` must not precede `2026-06-18` (the v8 table only aggregates from that
cutoff, so earlier delta rows would have no blended totals to split).

### Pre-check: the table must not already exceed expected

The delta below is a plain `expected - current`. If the table already holds
more than `generations` says it should for some key, that is a data-integrity
error (double insert, corrupted source, wrong day) and must not be papered
over. Run this first; it must return **zero rows** before running the insert
for `:day`. As a second line of defense, `byok_requests` goes through
`accurateCast(…, 'UInt64')`, which throws on a negative delta instead of
wrapping. The `Int64` / `Decimal` columns would accept a negative delta
silently, so the pre-check is the real guard for them.

```sql
WITH
    expected AS (<the `e` subquery from the insert below, verbatim>),
    current AS (<the `c` subquery from the insert below, verbatim>)
SELECT
    e.*,
    c.byok_upstream_prompt_cost AS cur_byok_upstream_prompt_cost,
    c.byok_upstream_completion_cost AS cur_byok_upstream_completion_cost,
    c.byok_requests AS cur_byok_requests,
    c.byok_prompt_tokens AS cur_byok_prompt_tokens,
    c.byok_completion_tokens AS cur_byok_completion_tokens,
    c.byok_native_tokens_cached AS cur_byok_native_tokens_cached
FROM expected AS e
INNER JOIN current AS c
    USING (date, app_id, model_permaslug, variant, provider_name, endpoint_id, api_type, context_length_bucket)
WHERE c.byok_upstream_prompt_cost > e.byok_upstream_prompt_cost
    OR c.byok_upstream_completion_cost > e.byok_upstream_completion_cost
    OR c.byok_requests > e.byok_requests
    OR c.byok_prompt_tokens > e.byok_prompt_tokens
    OR c.byok_completion_tokens > e.byok_completion_tokens
    OR c.byok_native_tokens_cached > e.byok_native_tokens_cached;
```

Any row returned means: stop, investigate that key, do not run the insert.

### Insert

The delta `SELECT` is wrapped in a subquery so the outer `WHERE` filters on
the projected delta names only (the same names exist on `e`, `c`, and as
`SELECT` aliases, and ClickHouse alias precedence is not something to lean on).

```sql
INSERT INTO default.app_and_provider_activity_daily_v8
(
    date,
    app_id,
    model_permaslug,
    variant,
    provider_name,
    endpoint_id,
    api_type,
    context_length_bucket,
    byok_upstream_prompt_cost,
    byok_upstream_completion_cost,
    byok_requests,
    byok_prompt_tokens,
    byok_completion_tokens,
    byok_native_tokens_cached
)
SELECT *
FROM
(
    SELECT
        e.date,
        e.app_id,
        e.model_permaslug,
        e.variant,
        e.provider_name,
        e.endpoint_id,
        e.api_type,
        e.context_length_bucket,
        e.byok_upstream_prompt_cost - coalesce(c.byok_upstream_prompt_cost, toDecimal64(0, 6)) AS delta_byok_upstream_prompt_cost,
        e.byok_upstream_completion_cost - coalesce(c.byok_upstream_completion_cost, toDecimal64(0, 6)) AS delta_byok_upstream_completion_cost,
        accurateCast(toInt64(e.byok_requests) - toInt64(coalesce(c.byok_requests, 0)), 'UInt64') AS delta_byok_requests,
        e.byok_prompt_tokens - coalesce(c.byok_prompt_tokens, 0) AS delta_byok_prompt_tokens,
        e.byok_completion_tokens - coalesce(c.byok_completion_tokens, 0) AS delta_byok_completion_tokens,
        e.byok_native_tokens_cached - coalesce(c.byok_native_tokens_cached, 0) AS delta_byok_native_tokens_cached
    FROM
    (
        SELECT
            toDate(created_at) AS date,
            coalesce(app_id, -1) AS app_id,
            model_permaslug,
            variant,
            provider_name,
            coalesce(endpoint_id, toUUID('00000000-0000-0000-0000-000000000000')) AS endpoint_id,
            coalesce(api_type, '') AS api_type,
            CASE
                WHEN (coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)) < 1e3 THEN '1K'
                WHEN (coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)) < 1e4 THEN '10K'
                WHEN (coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)) < 1e5 THEN '100K'
                WHEN (coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)) < 1e6 THEN '1M'
                WHEN (coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)) < 1e7 THEN '10M'
                WHEN (coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)) < 1e8 THEN '100M'
                WHEN (coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)) < 1e9 THEN '1B'
                ELSE '10B'
            END AS context_length_bucket,
            sum(coalesce(upstream_inference_prompt_cost, toDecimal64(0, 6))) AS byok_upstream_prompt_cost,
            sum(coalesce(upstream_inference_completions_cost, toDecimal64(0, 6))) AS byok_upstream_completion_cost,
            countIf(generation_type NOT IN ('server_tool_call', 'server_tool_checkpoint')) AS byok_requests,
            sum(coalesce(native_tokens_prompt, 0)) AS byok_prompt_tokens,
            sum(coalesce(native_tokens_completion, 0)) AS byok_completion_tokens,
            sum(coalesce(native_tokens_cached, 0)) AS byok_native_tokens_cached
        FROM default.generations
        WHERE created_at >= toDateTime(:day)
            AND created_at < toDateTime(:day) + INTERVAL 1 DAY
            AND provider_api_key_id IS NOT NULL
            AND coalesce(is_private_model, false) = false
            AND coalesce(is_private_endpoint, false) = false
        GROUP BY model_permaslug, variant, provider_name, app_id, endpoint_id, api_type, context_length_bucket, date
    ) AS e
    LEFT JOIN
    (
        SELECT
            toDate(date) AS date,
            app_id,
            model_permaslug,
            variant,
            provider_name,
            endpoint_id,
            api_type,
            context_length_bucket,
            sum(byok_upstream_prompt_cost) AS byok_upstream_prompt_cost,
            sum(byok_upstream_completion_cost) AS byok_upstream_completion_cost,
            sum(byok_requests) AS byok_requests,
            sum(byok_prompt_tokens) AS byok_prompt_tokens,
            sum(byok_completion_tokens) AS byok_completion_tokens,
            sum(byok_native_tokens_cached) AS byok_native_tokens_cached
        FROM default.app_and_provider_activity_daily_v8
        WHERE toDate(date) = toDate(:day)
        GROUP BY date, app_id, model_permaslug, variant, provider_name, endpoint_id, api_type, context_length_bucket
    ) AS c
        USING (date, app_id, model_permaslug, variant, provider_name, endpoint_id, api_type, context_length_bucket)
)
WHERE delta_byok_upstream_prompt_cost > 0
    OR delta_byok_upstream_completion_cost > 0
    OR delta_byok_requests > 0
    OR delta_byok_prompt_tokens > 0
    OR delta_byok_completion_tokens > 0
    OR delta_byok_native_tokens_cached > 0;
```

## Reconciliation

Per backfilled day, the BYOK columns must not exceed their blended totals and
must match a direct aggregation of `generations`. Every `*_ok` column must be
`1` and every `*_diff` column must be `0`.

```sql
WITH gen AS (
    SELECT
        sumIf(coalesce(native_tokens_prompt, 0), provider_api_key_id IS NOT NULL) AS byok_prompt_tokens,
        sumIf(coalesce(native_tokens_completion, 0), provider_api_key_id IS NOT NULL) AS byok_completion_tokens,
        sumIf(coalesce(native_tokens_cached, 0), provider_api_key_id IS NOT NULL) AS byok_native_tokens_cached,
        sumIf(coalesce(upstream_inference_prompt_cost, toDecimal64(0, 6)), provider_api_key_id IS NOT NULL) AS byok_upstream_prompt_cost,
        sumIf(coalesce(upstream_inference_completions_cost, toDecimal64(0, 6)), provider_api_key_id IS NOT NULL) AS byok_upstream_completion_cost,
        countIf(
            provider_api_key_id IS NOT NULL
            AND generation_type NOT IN ('server_tool_call', 'server_tool_checkpoint')
        ) AS byok_requests
    FROM default.generations
    WHERE created_at >= toDateTime(:day)
        AND created_at < toDateTime(:day) + INTERVAL 1 DAY
        AND coalesce(is_private_model, false) = false
        AND coalesce(is_private_endpoint, false) = false
)
SELECT
    sum(byok_requests) <= sum(requests) AS requests_ok,
    sum(byok_prompt_tokens) <= sum(prompt_tokens) AS prompt_ok,
    sum(byok_completion_tokens) <= sum(completion_tokens) AS completion_ok,
    sum(byok_native_tokens_cached) <= sum(native_tokens_cached) AS cached_ok,
    sum(byok_upstream_prompt_cost) <= sum(upstream_prompt_cost) AS prompt_cost_ok,
    sum(byok_upstream_completion_cost) <= sum(upstream_completion_cost) AS completion_cost_ok,
    sum(byok_requests) - (SELECT byok_requests FROM gen) AS requests_diff,
    sum(byok_prompt_tokens) - (SELECT byok_prompt_tokens FROM gen) AS prompt_diff,
    sum(byok_completion_tokens) - (SELECT byok_completion_tokens FROM gen) AS completion_diff,
    sum(byok_native_tokens_cached) - (SELECT byok_native_tokens_cached FROM gen) AS cached_diff,
    sum(byok_upstream_prompt_cost) - (SELECT byok_upstream_prompt_cost FROM gen) AS prompt_cost_diff,
    sum(byok_upstream_completion_cost) - (SELECT byok_upstream_completion_cost FROM gen) AS completion_cost_diff
FROM default.app_and_provider_activity_daily_v8
WHERE toDate(date) = toDate(:day);
```

Record both watermarks (earliest backfilled day for the daily table,
`:activation` for the minute table) wherever the consuming dashboard change
gates its BYOK filter.

## After the backfill

Until this runbook has completed, no query in this repo reads the `byok_*`
columns (the provider and app activity queries under
`app-and-provider-activity/` do not reference them), and the column comments
written by migration 243 tell anyone introspecting the schema (`DESCRIBE`,
`system.columns`, the analytics MCP) that pre-activation rows are zero. That
comment is the only guard for ad-hoc SQL and future direct consumers: any new
reader of these columns must gate on the watermarks above (daily table after
this backfill, minute table from `:activation`). Once every day through
`:activation` has been backfilled and reconciled:

1. Replace the daily-table column comments so they no longer warn about the
   backfill. Keep the minute-table comments as they are, since that table is
   never backfilled.

   ```sql
   ALTER TABLE default.app_and_provider_activity_daily_v8
       COMMENT COLUMN byok_upstream_prompt_cost 'Backfilled from default.generations through :activation; trustworthy for every date in the table.',
       COMMENT COLUMN byok_upstream_completion_cost 'Backfilled from default.generations through :activation; trustworthy for every date in the table.',
       COMMENT COLUMN byok_requests 'Backfilled from default.generations through :activation; trustworthy for every date in the table.',
       COMMENT COLUMN byok_prompt_tokens 'Backfilled from default.generations through :activation; trustworthy for every date in the table.',
       COMMENT COLUMN byok_completion_tokens 'Backfilled from default.generations through :activation; trustworthy for every date in the table.',
       COMMENT COLUMN byok_native_tokens_cached 'Backfilled from default.generations through :activation; trustworthy for every date in the table.';
   ```

2. Ship the provider-dashboard BYOK filter, gated on the minute-table
   watermark (`date >= :activation`) for any sub-day or timezone-bucketed
   read.
