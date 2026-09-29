# Possible-cache hourly rollup

Companion to migration
[`../204_create_possible_cache_hourly_rollup.sql`](../204_create_possible_cache_hourly_rollup.sql).

That migration creates the
`default.possible_cache_hourly_v1` table and its fifteen-minute refreshable
materialized view with two years of retention. The view only fills the
current and previous UTC hour, so history requires a one-off backfill after
deployment.

## Metric semantics

Per request, the opportunity estimate is the previous request's prompt plus
completion tokens, capped at the current prompt, credited only when the
previous request shares the same user, conversation and model and is no more
than five minutes older.

- `possible_cached_tokens` — total opportunity. The predecessor partition
  ignores provider, so a provider switch counts as opportunity.
- `same_provider_possible_cached_tokens` — the subset where the predecessor
  used the same provider as the current request: the opportunity the provider
  had a fair chance to cache. A large gap to `possible_cached_tokens` means
  routing broke cache continuity; low capture against the same-provider
  subset means the provider is not caching.
- `matched_cached_tokens` — observed cached tokens capped per request at
  that request's own opportunity, so `matched / possible` lies in [0, 1] by
  construction. Raw `cached_tokens` is retained so the unbounded directional
  ratio (`cached / possible`, which can exceed 100% when provider caching
  reaches further back than the one-turn estimate) stays one ad-hoc query
  away.

## Backfill

Run the following statement once for each UTC hour that should be retained,
oldest first, one hour per statement. Replace `:hour_start` with the start of
the hour being emitted. The statement derives the end of the target hour. The
source starts five minutes before `:hour_start` so a predecessor across the
hour boundary is visible, but only rows inside the target hour are written.

The backfill is idempotent per hour: the table is a
`ReplacingMergeTree(computed_at)` and each run writes a strictly newer
`computed_at`, so re-running an hour supersedes the previous row for every
key in that hour. An interrupted backfill can therefore be resumed by
re-running from the last hour attempted.

```sql
INSERT INTO default.possible_cache_hourly_v1
(
    clerk_user_id,
    model_permaslug,
    provider_name,
    hour,
    computed_at,
    requests,
    prompt_tokens,
    cached_tokens,
    possible_cached_tokens,
    same_provider_possible_cached_tokens,
    matched_cached_tokens
)
WITH
    toDateTime(':hour_start', 'UTC') AS target_start,
    target_start + INTERVAL 1 HOUR AS target_end
SELECT
    clerk_user_id,
    model_permaslug,
    provider_name,
    toStartOfHour(created_at) AS hour,
    now64(3, 'UTC') AS computed_at,
    count() AS requests,
    sum(coalesce(native_tokens_prompt, 0)) AS prompt_tokens,
    sum(coalesce(native_tokens_cached, 0)) AS cached_tokens,
    sum(possible_cached_tokens) AS possible_cached_tokens,
    sum(same_provider_possible_cached_tokens) AS same_provider_possible_cached_tokens,
    sum(matched_cached_tokens) AS matched_cached_tokens
FROM (
    SELECT
        clerk_user_id,
        model_permaslug,
        provider_name,
        created_at,
        native_tokens_prompt,
        native_tokens_cached,
        if(
            conversation_id IS NOT NULL
                AND conversation_id != '00000000'
                AND prev_generation_id != generation_id
                AND prev_total > 0
                AND dateDiff('second', prev_at, created_at) <= 300,
            least(prev_total, coalesce(native_tokens_prompt, 0)),
            0
        ) AS possible_cached_tokens,
        if(prev_provider_name = provider_name, possible_cached_tokens, 0)
            AS same_provider_possible_cached_tokens,
        least(coalesce(native_tokens_cached, 0), possible_cached_tokens) AS matched_cached_tokens
    FROM (
        SELECT
            generation_id,
            clerk_user_id,
            conversation_id,
            model_permaslug,
            provider_name,
            created_at,
            native_tokens_prompt,
            native_tokens_completion,
            native_tokens_cached,
            lagInFrame(
                coalesce(native_tokens_prompt, 0) + coalesce(native_tokens_completion, 0)
            ) OVER (
                PARTITION BY clerk_user_id, conversation_id, model_permaslug
                ORDER BY created_at ASC, generation_id ASC
                ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
            ) AS prev_total,
            lagInFrame(created_at) OVER (
                PARTITION BY clerk_user_id, conversation_id, model_permaslug
                ORDER BY created_at ASC, generation_id ASC
                ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
            ) AS prev_at,
            lagInFrame(generation_id) OVER (
                PARTITION BY clerk_user_id, conversation_id, model_permaslug
                ORDER BY created_at ASC, generation_id ASC
                ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
            ) AS prev_generation_id,
            lagInFrame(provider_name) OVER (
                PARTITION BY clerk_user_id, conversation_id, model_permaslug
                ORDER BY created_at ASC, generation_id ASC
                ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
            ) AS prev_provider_name
        FROM default.generations
        WHERE generation_type NOT IN ('server_tool_call', 'server_tool_checkpoint')
          AND created_at >= target_start - INTERVAL 5 MINUTE
          AND created_at < target_end
    )
    WHERE created_at >= target_start
      AND created_at < target_end
)
GROUP BY clerk_user_id, model_permaslug, provider_name, hour
SETTINGS
    max_bytes_before_external_sort = 4000000000,
    max_bytes_before_external_group_by = 4000000000,
    max_memory_usage = 16000000000,
    distributed_aggregation_memory_efficient = 1,
    max_threads = 8;
```

The backfill scans approximately one hour and five minutes of generations per
statement, plus the indexed grouping state for that hour. Run it in bounded
batches during a low-traffic period and monitor ClickHouse read bytes,
duration, and memory before increasing concurrency. Do not run this from the
application request path.

An hour is final once it ages out of the refresh window. A generation written
late can therefore leave that hour undercounted rather than empty, which the
gap query cannot detect. Repair affected hours by running the backfill
statement above for those hours.

## Gap detection

The refresh view only rewrites the current and previous UTC hour. After an
outage or delayed refresh, find missing rollup hours with the following query.
Run the backfill statement above once for each returned hour.

```sql
WITH
    toDateTime(':range_start', 'UTC') AS range_start,
    toDateTime(':range_end', 'UTC') AS range_end
SELECT formatDateTime(toDateTime(hours.hour, 'UTC'), '%Y-%m-%d %H:00:00') AS hour_start
FROM
(
    SELECT arrayJoin(
        range(
            toUInt32(toStartOfHour(range_start)),
            toUInt32(toStartOfHour(range_end)),
            3600
        )
    ) AS hour
) AS hours
LEFT JOIN
(
    SELECT DISTINCT hour
    FROM default.possible_cache_hourly_v1 FINAL
    WHERE hour >= toStartOfHour(range_start)
      AND hour < toStartOfHour(range_end)
) AS rollup ON rollup.hour = toDateTime(hours.hour, 'UTC')
WHERE rollup.hour IS NULL
ORDER BY hour_start
SETTINGS join_use_nulls = 1;
```
