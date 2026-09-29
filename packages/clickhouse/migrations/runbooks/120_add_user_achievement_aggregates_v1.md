# Runbook — `user_achievement_aggregates_daily_v1`

Companion to migration
[`120_add_user_achievement_aggregates_v1.sql`](../120_add_user_achievement_aggregates_v1.sql).

This MV is the single per-user roll-up that backs the achievement evaluation
pipeline (`packages/achievements/queries.ts`). It captures both the
day-grain dimensions used by the existing 7 queries (request counts, tokens,
modality flags, streaks) **and** the per-session cost dimensions needed for
the two new signals — most-expensive single generation, most-expensive
session-summed cost. Sourced directly from `default.generations` because
`user_activity_minute_v7` sums `usage` per minute (losing per-generation
granularity) and drops `session_id`.

Migration creates the table and the forward-only MV. **Backfill is
operator-driven**, run separately after the MV is live, in month-bounded
chunks against `default.generations`.

---

## 0. Set the cutover date

The migration's MV body has
`WHERE created_at >= toDateTime('2026-05-21 00:00:00')`. Set this literal
to a date in the **future** — at or after the calendar day you intend to
apply the migration — so the migration itself does not insert any rows.
The MV starts capturing live `default.generations` inserts once the wall
clock crosses the cutover.

The same literal is used as the upper bound of the backfill below — keep
them in sync. The cutover is at day granularity (00:00:00 UTC) so it
aligns with the monthly `toYYYYMM(date)` partition boundary cleanly; each
(clerk_user_id, day, model, variant, session_id) bucket is owned by
exactly one of {backfill, MV}.

---

## 1. Apply the migration

```bash
cd packages/clickhouse
bun run ch:migrate
bun run ch:check
```

After this point, `default.user_achievement_aggregates_daily_v1_mv` will start
capturing every new INSERT into `default.generations` whose `created_at`
≥ cutover. The target table is empty for all dates < cutover until you run
the backfill in §2.

Verify the MV is wired up:

```sql
SELECT count() AS forward_rows
FROM default.user_achievement_aggregates_daily_v1
WHERE date >= toDate('<CUTOVER_DATE>');
```

You should see this number grow over the next few minutes. `count()` over
an AggregatingMergeTree is approximate until merges land; that's fine for
the smoke check.

---

## 2. Backfill historical data

Source: `default.generations` (raw fact table — has all history, all sessions,
all per-generation usage values). Target:
`default.user_achievement_aggregates_daily_v1`.

> **Backfill cost note:** sourcing from `generations` means each per-month
> chunk reads O(10x) more bytes than the equivalent
> `user_activity_daily_v7`-based chunk would. The trade-off buys us
> `max_request_usage` and `session_id` in a single MV instead of two. Run
> during off-peak hours and monitor cluster query queue.

Run **one INSERT per month**, oldest to newest, for every partition returned
by the list query in §2b (which includes the cutover month — the template's
`AND created_at < toDateTime('<CUTOVER_DATE> 00:00:00')` filter excludes the
cutover-day-and-after rows so they remain owned by the MV). Per-month
chunking keeps each query under ClickHouse's `max_memory_usage` and lets
you resume cleanly if any chunk fails.

> **Idempotency note:** AggregatingMergeTree uses
> `(clerk_user_id, creator_user_id, session_id, model_permaslug, variant, date)`
> as its key. Re-running an already-completed month INSERT will *double* the
> sum-aggregates and at-best leave the max-aggregates unchanged. Track which
> chunks you've completed (e.g. in a scratch table or a checklist) and use
> the rollback pattern in §2c if a chunk needs to be re-run.

### 2a. Template — one chunk

Replace `{YYYYMM}` with the target month and run for each month from the
oldest data forward.

```sql
INSERT INTO default.user_achievement_aggregates_daily_v1
SELECT
    toDate(created_at) AS date,
    clerk_user_id,
    coalesce(creator_user_id, '') AS creator_user_id,
    model_permaslug,
    variant,
    session_id,
    sum(usage),
    max(usage),
    count(),
    sum(if(provider_api_key_id IS NOT NULL, toUInt64(1), toUInt64(0))),
    sum(coalesce(native_tokens_prompt, 0)),
    sum(coalesce(native_tokens_completion, 0)),
    sum(coalesce(native_tokens_reasoning_int64, 0)),
    sum(coalesce(native_tokens_cached, 0)),
    sum(coalesce(num_media_prompt, 0)),
    sum(coalesce(num_media_completion, 0)),
    sum(coalesce(num_input_audio_prompt, 0))
FROM default.generations
WHERE toYYYYMM(created_at) = {YYYYMM}
  AND created_at < toDateTime('<CUTOVER_DATE> 00:00:00')
GROUP BY
    date,
    clerk_user_id,
    creator_user_id,
    session_id,
    model_permaslug,
    variant
SETTINGS max_memory_usage = 30000000000;
```

### 2b. List of partitions to backfill

```sql
SELECT DISTINCT toYYYYMM(created_at) AS partition
FROM default.generations
WHERE created_at < toDateTime('<CUTOVER_DATE> 00:00:00')
ORDER BY partition;
```

Use this as a checklist — tick off each partition after its chunk completes.

### 2c. Per-chunk validation

After each chunk, sanity-check the row count and aggregate totals match the
source for that partition:

```sql
SELECT 'src' AS side,
       count() AS rows,
       sum(usage) AS total_usage,
       max(usage) AS max_gen_usage,
       sum(coalesce(native_tokens_prompt, 0))
         + sum(coalesce(native_tokens_completion, 0)) AS tokens
FROM default.generations
WHERE toYYYYMM(created_at) = {YYYYMM}
  AND created_at < toDateTime('<CUTOVER_DATE> 00:00:00')
UNION ALL
SELECT 'tgt',
       sum(requests),
       sum(usage),
       max(max_request_usage),
       sum(prompt_tokens) + sum(completion_tokens)
FROM default.user_achievement_aggregates_daily_v1
WHERE toYYYYMM(date) = {YYYYMM}
  AND date < toDate('<CUTOVER_DATE>');
```

The target side mirrors the source's
`created_at < toDateTime('<CUTOVER_DATE> 00:00:00')` filter (translated to
`date < toDate('<CUTOVER_DATE>')` since the target stores Date, not
DateTime) so the comparison stays apples-to-apples even for the cutover
month's partition (which contains both backfill rows and MV-forwarded
rows). Without this filter the cutover-month check would always show
`tgt > src`.

Expect:

- `tgt.rows == src.rows` (target's `sum(requests)` is the bucketed row
  count and must equal the source row count).
- `tgt.total_usage == src.total_usage` (sum of usage must match exactly).
- `tgt.max_gen_usage == src.max_gen_usage` (max-of-max collapses to the
  global max single-generation usage).
- `tgt.tokens == src.tokens` (sum of tokens must match exactly).

If any sum or max mismatches, the chunk is bad.

**For non-cutover months:** `ALTER TABLE … DROP PARTITION {YYYYMM}` and
re-run that chunk's §2a INSERT.

**For the cutover month:** do *not* `DROP PARTITION` — that would also
delete the MV-forwarded rows for cutover-day-and-after, which the MV
will not re-emit (it only sees new INSERTs into `default.generations`).
Instead, use a lightweight DELETE bounded by the cutover filter, then
re-run the chunk:

```sql
ALTER TABLE default.user_achievement_aggregates_daily_v1
DELETE WHERE toYYYYMM(date) = {CUTOVER_YYYYMM}
          AND date < toDate('<CUTOVER_DATE>');
```

### 2d. End-to-end validation

Once all chunks are in, pick a handful of users with deep history and confirm
the daily-aggregate queries match the existing source, and the new session
signals look plausible:

```sql
-- Daily aggregates: new MV vs existing source
SELECT
    sum(requests) AS total_requests,
    sum(prompt_tokens) + sum(completion_tokens) AS total_tokens,
    count(DISTINCT model_permaslug) AS distinct_models,
    count(DISTINCT arrayElement(splitByChar('/', model_permaslug), 1))
        AS distinct_authors
FROM default.user_achievement_aggregates_daily_v1
WHERE clerk_user_id = '<test_user>';

SELECT
    sum(requests) AS total_requests,
    sum(prompt_tokens) + sum(completion_tokens) AS total_tokens,
    count(DISTINCT model_permaslug) AS distinct_models,
    count(DISTINCT arrayElement(splitByChar('/', model_permaslug), 1)) AS distinct_authors
FROM default.user_activity_daily_v7
WHERE clerk_user_id = '<test_user>';

-- New signal 1: most expensive single generation
SELECT max(max_request_usage) AS max_gen_usage
FROM default.user_achievement_aggregates_daily_v1
WHERE clerk_user_id = '<test_user>';

-- New signal 2: most expensive session (excludes session-less rows)
SELECT max(session_sum) AS max_session_usage
FROM (
    SELECT sum(usage) AS session_sum
    FROM default.user_achievement_aggregates_daily_v1
    WHERE clerk_user_id = '<test_user>'
      AND session_id != ''
    GROUP BY session_id
);

-- Cross-check the two new signals against raw generations
SELECT
    max(usage) AS src_max_gen_usage,
    max(session_sum) AS src_max_session_usage
FROM (
    SELECT
        usage,
        sum(usage) OVER (
            PARTITION BY clerk_user_id, creator_user_id, session_id
        ) AS session_sum
    FROM default.generations
    WHERE clerk_user_id = '<test_user>'
      AND session_id != ''
);
```

The daily totals should match exactly (assuming the backfill finished before
any wall-clock time crossed the next partition boundary). The two new
signals' `tgt` and `src` values should match within "any data ingested
after the cutover literal but before you finished the backfill". Pre-cutover
rows in `generations` with `session_id = ''` are excluded from the
"most expensive session" calculation in both source and target — that's
intentional.

---

## 3. Cut the application reads over

Once §2d looks clean, switch the achievement queries in
`packages/achievements/queries.ts` from
`ClickHouseMVName.UserActivityDailyV7` to
`ClickHouseMVName.UserAchievementAggregatesDailyV1`, and add the two new
queries for the session signals. Most existing queries are drop-in:

- `getAchievementAggregates` — no SQL change beyond table swap;
  `splitByChar('/', model_permaslug)[1]` runs at query time as before.
- `getAuthorPresenceList` — no SQL change beyond table swap; same
  `arrayElement(splitByChar('/', model_permaslug), 1)` expression.
- `getLongestStreak` — no SQL change beyond table swap; `requests` is
  the same `SimpleAggregateFunction` column.
- `getTimeBasedFlags` — no SQL change beyond table swap.
- `hasImageModelUsage` — no SQL change beyond table swap.
- `getImageRequestCount` — no SQL change beyond table swap.
- `getModalityTypeCount` — no SQL change beyond table swap; `num_media_*`
  and `num_audio_prompt` carry over.
- `getMaxRequestUsage` (NEW) — `SELECT max(max_request_usage) FROM
  user_achievement_aggregates_daily_v1 WHERE clerk_user_id = ?`.
- `getMaxSessionUsage` (NEW) — `SELECT max(s) FROM (SELECT sum(usage)
  AS s FROM ... WHERE clerk_user_id = ? AND session_id != '' GROUP BY
  session_id)`.

Roll out behind a flag (or per-user 0%→1%→100% sample) and watch
`achievement-check-timing` p50/p99 in Datadog. Expected p50 drop on the
existing daily queries: `250–470ms → ~20–40ms` per query. The two new
session queries share the same per-user prefix scan and complete an extra
hash-aggregation by session_id — expect similar p50.

---

## 4. Rollback

Two-step rollback if something goes wrong post-cutover:

1. Flip the application back to `UserActivityDailyV7`. Achievement queries
   immediately resume reading from the existing source — no data loss, just
   the original latency profile.
2. Optionally drop the new MV + table:

    ```sql
    DROP VIEW IF EXISTS default.user_achievement_aggregates_daily_v1_mv;
    DROP TABLE IF EXISTS default.user_achievement_aggregates_daily_v1;
    ```

    The drop is non-destructive — `user_activity_daily_v7` is unaffected.

If the bug is in the MV definition itself (rather than the query rewrites),
fix it forward in a follow-up migration; do not edit
`120_add_user_achievement_aggregates_v1.sql` after it has been applied to
prod.
