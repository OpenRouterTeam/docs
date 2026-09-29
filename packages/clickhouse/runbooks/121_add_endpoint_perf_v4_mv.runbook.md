# Migration 121 — endpoint_perf v4 backfill runbook

This runbook documents the manual backfill an operator runs from the
ClickHouse console **after** migrations `121_add_endpoint_perf_v4_mv.sql`
**and** `122_fix_endpoint_perf_v4_throughput_overflow.sql` have been
deployed to production and **before** the follow-up PR that flips reader
helpers from v3 to v4 is merged.

Migration 122 patches a Decimal-overflow bug in the throughput formula
that surfaced on the first backfill attempt; without it the chunk SQL
below errors with `DB::Exception: Decimal math overflow`. It also flips
the live MV's cutoff WHERE from `>` to `>=` so the half-open intervals
used below tile cleanly with no gap at the boundary.

## Why backfill manually

Migration 121 deploys empty `endpoint_perf_minute_v4` /
`endpoint_perf_daily_v4` backing tables and live materialized views gated
by a future cutoff timestamp (`'2026-05-26 00:00:00'`). The MV trigger
does nothing for `generations` rows whose `created_at` is before the
cutoff, so the operator backfills the historical window directly into the
backing tables, in chunks, before the cutoff arrives. After the cutoff,
the live MVs take over for new traffic but cannot retroactively populate
the few days between deploy and cutoff where the data didn't exist yet —
those days need a small post-cutoff backfill too.

The two write paths tile cleanly with no overlap and no gap. Every
interval is half-open `[start, end)` so the exact-cutoff timestamp
`'2026-05-26 00:00:00'` is captured by the live MV exactly once.

- **Backfill chunks**: `INSERT … SELECT FROM generations WHERE created_at
  >= chunk_start AND created_at < chunk_end` — writes directly to the
  backing table, bypassing the MV trigger. Inter-chunk boundaries are
  not double-counted (chunk N's `< chunk_end` and chunk N+1's `>=
  chunk_start` line up exactly).
- **Live MV** (migration 122): `WHERE created_at >= '2026-05-26
  00:00:00'` — fires for the cutoff timestamp itself and every row after.

The final chunk's upper bound (`'2026-05-26 00:00:00'`) is the live MV's
lower bound, so the cutoff microsecond lands in the live MV and not in
the backfill.

## Backfill phases at a glance

The backfill splits into four phases by granularity (minute vs daily) and
by cutoff side (before vs after). Phase 1 / 3a run before the cutoff;
Phase 2 / 3b run on or after the cutoff. Within each granularity the
pre-cutoff phase covers most of the window; the post-cutoff phase covers
the small region between deploy and cutoff that didn't exist yet when
pre-cutoff backfill ran.

| Phase | Window                         | Granularity | When                          |
|-------|--------------------------------|-------------|-------------------------------|
| 1     | (lower bound) → deploy date    | minute      | NOW → before cutoff           |
| 2     | deploy date → cutoff (6 days)  | minute      | ON / AFTER cutoff             |
| 3a    | (lower bound) → deploy date    | daily       | Can run in parallel with Phase 1 |
| 3b    | deploy date → cutoff (6 days)  | daily       | ON / AFTER cutoff             |

Why Phase 3 isn't auto-populated by Phase 1: both v4 MVs read
`FROM generations` independently (see the comment block in
`migrations/121_add_endpoint_perf_v4_mv.sql`), so writing to
`endpoint_perf_minute_v4` does not trigger any insert into
`endpoint_perf_daily_v4`. Daily needs its own backfill INSERTs over the
same window.

Daily and minute writes do not interact at the SQL level, so Phase 3a
can run in parallel with Phase 1 if the cluster has headroom. If not,
finish Phase 1 first (it has TTL pressure — see below).

## Choosing the lower bound

There are two reasonable lower bounds for the backfill window, depending
on what consumers of the v4 series will display.

### Per-tier accuracy floor: 2026-05-09

The v4 MV's `service_tier_bucket` dimension is derived from
`generations.service_tier`. That column was added to `generations` by
ClickHouse migration `114_add_service_tier_to_generations.sql`, which
shipped together with the accounting-writer changes that populate it in
[PR #20568](https://github.com/OpenRouterTeam/openrouter-web/pull/20568)
(merged 2026-05-08).

For any `generations` row inserted **before** that deploy, `service_tier`
is `NULL` permanently — `ALTER TABLE … ADD COLUMN … DEFAULT NULL` does not
retroactively populate historical rows. The v4 bucket derivation treats
NULL as `default` (see the comment block at the top of
`migrations/121_add_endpoint_perf_v4_mv.sql`), so backfilling pre-2026-05-09
rows would silently attribute 100% of that traffic to the `default` bucket
regardless of what tier was actually served.

**If the only consumer of v4 is per-tier UI**, stop the backfill window at
`2026-05-09 00:00:00` (a 1-day margin past the PR #20568 deploy). This is
the safe default.

### All-tier rollup history: expand the window as desired

For consumers that read `quantilesMerge` across all buckets (e.g. the
flipped all-tier helpers in
[PR #21589](https://github.com/OpenRouterTeam/openrouter-web/pull/21589)),
expanding the window further back is safe: `quantileMerge` over
`{flex, priority, default}` is mathematically equivalent to `quantileMerge`
over `{default}` alone, so the all-tier rollups match v3 regardless of
whether the pre-2026-05-09 sub-buckets are accurate.

Per-tier UI consumers must filter to `date >= 2026-05-09` themselves;
this constraint belongs in the consuming helper, not in the backfill.

### TTL implications

- `endpoint_perf_minute_v4` has a 30-day TTL (mirrors v3). Backfilling
  minute data older than 30 days is wasted cluster time — those rows age
  out immediately.
- `endpoint_perf_daily_v4` has no TTL. Daily backfill can extend as far
  back as `generations` retains data.

A reasonable broad-window default:
- Minute: 30 days back from deploy date.
- Daily: as far back as desired (e.g. start of `generations` retention).

## Prerequisites

- Migration 121 deployed (verify with
  `SHOW TABLES LIKE 'endpoint_perf_%_v4%'`; expect 4 rows: the two backing
  tables and their two MVs).
- Migration 122 deployed (verify by checking the live MV's `as_select`
  contains both `toFloat64` and `>= '2026-05-26 00:00:00'`).
- ClickHouse console / cluster access on the production primary.
- The current UTC time is **before** `'2026-05-26 00:00:00'`. The whole
  point of the future cutoff is to give the operator a comfortable window
  to run all pre-cutoff chunks; if the cutoff has already passed, the
  live MV is already ingesting and the pre-cutoff / post-cutoff phase
  split below stops working as written.

## Pre-flight checks

Run all four queries once before touching anything. If anything looks
off, stop and investigate before continuing.

```sql
-- 1. Verify migrations 121 + 122 are deployed.
SHOW TABLES LIKE 'endpoint_perf_%_v4%';
-- Expect 4 rows:
--   endpoint_perf_daily_v4
--   endpoint_perf_daily_v4_mv
--   endpoint_perf_minute_v4
--   endpoint_perf_minute_v4_mv
```

```sql
-- 2. Verify the v4 backing tables are empty. Failed backfill INSERTs are
--    atomic (errored chunks roll back fully), so this should be 0 even
--    after a prior aborted attempt.
SELECT 'minute' AS table_name, count() AS rows FROM endpoint_perf_minute_v4
UNION ALL
SELECT 'daily',  count() FROM endpoint_perf_daily_v4;
-- Expect both to return 0. Non-zero indicates either a prior partial
-- insert (investigate) or that the cutoff has already passed (stop).
```

```sql
-- 3. Verify the live MV is correctly gated and not yet ingesting.
SELECT count() FROM endpoint_perf_minute_v4 WHERE date >= '2026-05-26 00:00:00';
-- Expect 0. If non-zero, the cutoff has passed and you are no longer in
-- the pre-cutoff phase.
```

```sql
-- 4. Confirm current UTC time vs. the cutoff. Defends against running
--    pre-cutoff phases past the cutoff by accident.
SELECT now('UTC') AS now_utc, toDateTime('2026-05-26 00:00:00') AS cutoff,
       cutoff > now_utc AS pre_cutoff;
-- Expect pre_cutoff = 1 before starting Phase 1 / Phase 3a.
```

## Operational gotchas

Read these once before starting; they catch the most common ways a
backfill goes sideways.

1. **Do not re-run a chunk that succeeded.** `endpoint_perf_*_v4` use
   `AggregatingMergeTree`, which merges duplicate `(endpoint_id, colo,
   service_tier_bucket, date)` keys by accumulating their states —
   re-running the same chunk doubles `request_count` and biases the
   t-digest quantile states. If a chunk errors, the INSERT is atomic and
   nothing landed; retry that chunk. If a chunk succeeded (rows appeared
   in the backing table for the chunk's date range), never retry it.
2. **Copy SQL from this runbook, not from terminal history.** Earlier
   versions of the chunk SQL (pre-migration 122) lacked the Float64
   throughput cast and will re-trip `Decimal math overflow` on any row
   with sub-microsecond `generation_time`.
3. **One chunk at a time, sequentially.** The INSERTs are heavy on
   intermediate aggregation state; running multiple in parallel can OOM
   the cluster and creates retry ambiguity if one of them errors.
4. **Keep a checklist file.** 17 chunks is the bare minimum; broader
   windows easily reach 100+ chunks. Track which chunks have completed
   and which have been sanity-checked. A `chunks.txt` with one line per
   chunk is plenty.
5. **Sanity-check after every chunk** before moving to the next. The
   v3-vs-v4 row-count delta query below should show v3 slightly higher
   than v4 (typically <0.5% of v3). That gap is expected: v3's live MV
   captured peerdb insert events for rows that were later dedup-removed
   from `generations`; ClickHouse MVs are insert-only and don't see those
   deletes, so v3 retains the pre-dedup counts while v4's backfill SELECT
   reads the current (post-dedup) state. v4 is the more accurate number.
   Investigate only if v4 > v3 (reversed sign) or if the delta exceeds
   ~0.5%.
6. **`Network error. Please check your connection and try again.` does
   not mean the INSERT failed.** Minute-grain backfill INSERTs regularly
   run longer than the ClickHouse Cloud console's HTTP keepalive timeout.
   When the connection drops, the server keeps executing the query in the
   background and commits parts normally if it succeeds. Wait 2-3 minutes,
   then re-run the per-chunk sanity check below before deciding whether
   to retry. Retrying immediately is the most dangerous case — if the
   background INSERT committed, the retry will double-count (see gotcha
   #1). To know for sure whether the original committed, use the
   `system.query_log` lookup in **Verifying an INSERT actually committed**
   below.
7. **"INSERT succeeded" in the CH Cloud console UI does not always mean
   the server accepted the write.** There is a known UI bug where queries
   that ultimately fail with `MEMORY_LIMIT_EXCEEDED` (code 241) are
   rendered with a green success banner and a non-zero `Read: <N> rows`
   count, while the underlying transaction was aborted by the
   OvercommitTracker and no parts were ever committed. The sanity check
   would then correctly report `v4 = 0` for the chunk's window. If a
   chunk's sanity check shows v4 at zero (or far below v3) despite the
   UI claiming success, verify the server-side outcome via
   `system.query_log` (see **Verifying an INSERT actually committed**
   below) before doing anything else — do not retry blindly.

## Verifying an INSERT actually committed

If the console-level outcome of a chunk is in doubt (a "Network error"
banner, a too-fast "INSERT succeeded" that doesn't match the row volume,
or a sanity check that returns v4 = 0), inspect the server-side outcome
via `system.query_log` directly.

The ClickHouse Cloud warehouse runs the compute nodes across multiple
compute services that share object storage but have independent
`system.query_log` tables — and per-service query_log retention can be
very short (under 30 minutes on the busier compute pool). Use
`clusterAllReplicas('all_groups.default', system.query_log)` to scan
every replica in the warehouse, and run it within a few minutes of the
INSERT — older rows age out and are unrecoverable:

```sql
SELECT
    event_time,
    type,
    written_rows,
    read_rows,
    query_duration_ms,
    exception_code,
    substring(exception, 1, 200) AS exc,
    substring(query, 1, 120) AS q_head,
    hostName() AS host
FROM clusterAllReplicas('all_groups.default', system.query_log)
WHERE event_date = today()
  AND user = currentUser()
  AND query_kind = 'Insert'
ORDER BY event_time DESC
LIMIT 10;
```

Look for the row matching your chunk:

- `type = 'QueryFinish'` and `exception_code = 0` → the INSERT committed;
  `written_rows` is the number of aggregate rows that landed in the
  backing table.
- `type = 'ExceptionWhileProcessing'` with `exception_code = 241` →
  MEMORY_LIMIT_EXCEEDED. The INSERT was killed by the OvercommitTracker
  and no parts were committed. Retry with stronger spill settings or a
  smaller chunk window (see "Chunking strategy" below).
- No matching row found → query_log already aged out on the replica that
  ran the INSERT and the only evidence available is the v3-vs-v4 sanity
  check. If v4 stays at 0 after several minutes, the INSERT did not
  commit and is safe to retry.

For a stronger guarantee that nothing was written, also confirm that no
active parts landed for the chunk's partition(s):

```sql
SELECT partition_id, count() AS parts, sum(rows) AS rows
FROM system.parts
WHERE table = 'endpoint_perf_minute_v4'
  AND partition_id IN ('20260520', '20260521')  -- chunk's UTC dates
  AND active = 1
GROUP BY partition_id;
```

## Chunking strategy

- **Minute chunks**: 1 day per chunk. A single multi-day INSERT into
  minute can OOM ClickHouse on the intermediate aggregation state. One
  day per chunk is conservative and easy to retry on failure.
- **Minute chunks require spill-to-disk SETTINGS.** Even 1-day minute
  chunks routinely exceed the per-query memory cap on ClickHouse Cloud
  compute (observed at ~75 GiB) — the `service_tier_bucket` dimension
  roughly triples GROUP BY cardinality vs the v3 MVs. Always append the
  following `SETTINGS` clause to every minute-grain INSERT in this
  runbook (the canonical SQL block in Phase 1 already includes it):

  ```sql
  SETTINGS
      max_bytes_before_external_group_by = 10000000000,
      max_threads = 4
  ```

  These two settings force aggregation state to spill to disk once it
  exceeds ~10 GiB and cap parallel aggregation streams at 4, which keeps
  peak memory well below the per-query ceiling. The trade-off is ~2-5×
  slower wall time per chunk; that is the expected behaviour and is fine.
  If a minute chunk still errors with `Code: 241. DB::Exception: (total)
  memory limit exceeded` even with the SETTINGS above, halve the chunk
  window (12 hours) and retry; halve again if the half-day chunk still
  OOMs.
- **Daily chunks**: small windows (~17 days) fit in a single chunk; broader
  windows should be split into 1-week chunks, expanding to 2-week and
  monthly chunks as confidence grows. Day-grain output is tiny (one row
  per `(endpoint, colo, service_tier_bucket, day)`) so chunks can safely
  be much larger than for minute. Daily chunks do not normally need the
  spill-to-disk SETTINGS above, but adding them is harmless if a broader
  daily chunk ever OOMs.
- **Order for pre-cutoff phases**:
  - For the narrow 17-day default window, forward chronological order
    (oldest → newest) is fine — every chunk is "recent" with respect to
    the 30-day rolling window.
  - For broader windows (Phase 1 going back ≥ 30 days, Phase 3a going
    back beyond ~1 month), prefer **backwards** order (newest → oldest).
    If the operator bails partway, the most-recent days are covered
    first, which is what populates the live rolling 30-day window and
    matches what users actually see in charts.
- **Order for post-cutoff phases**: forward chronological order. Only
  6 chunks, all recent — direction barely matters.

## Phase 1 — minute backfill, pre-cutoff

**Goal:** populate `endpoint_perf_minute_v4` for every UTC day from the
chosen lower bound through `2026-05-20 00:00:00` (the deploy date).

For each chunk, copy the SQL below, set the two date literals to the
chunk's `[chunk_start, chunk_end)` interval, execute, and verify row
count with the sanity-check query that follows.

The SELECT body is intentionally **identical** to the MV's SELECT as of
migration 122 (`Float64` casts in the throughput formula); any divergence
will produce a backfill-vs-live-MV seam.

```sql
INSERT INTO default.endpoint_perf_minute_v4
WITH throughput AS (
    SELECT
        toStartOfMinute(created_at) AS date,
        endpoint_id,
        colo,
        multiIf(
            lower(service_tier) = 'flex', 'flex',
            lower(service_tier) = 'priority', 'priority',
            'default'
        ) AS service_tier_bucket,
        toUInt32(least(
            round(coalesce(latency, 0)),
            4294967295
        )) AS latency_u32,
        toUInt32(least(
            round(coalesce(latency, 0) + coalesce(generation_time, 0)),
            4294967295
        )) AS latency_e2e_u32,
        -- Operands cast to Float64 to avoid Decimal(18, 6) overflow on
        -- rows with small generation_time / large native_tokens_completion.
        -- See migration 122 for the diagnosis.
        toUInt32(least(
            round(toFloat64(coalesce(native_tokens_completion, 0))
                  / toFloat64(coalesce(generation_time, 0)) * 1000),
            1000000
        )) AS throughput_u32
    FROM generations
    -- <<< EDIT FOR EACH CHUNK >>>
    -- Half-open interval [start, end) so consecutive chunks tile without
    -- double-counting their shared boundary.
    WHERE created_at >= '2026-05-19 00:00:00'
        AND created_at < '2026-05-20 00:00:00'
    -- <<< END EDIT >>>
        AND endpoint_id IS NOT NULL
        AND colo IS NOT NULL
        AND native_tokens_completion IS NOT NULL
        AND latency IS NOT NULL
        AND generation_time IS NOT NULL
        AND native_tokens_completion > 1
        AND latency > 0
        AND generation_time > 0
        -- Mirror the v3 MVs' private-resource exclusion added in
        -- migration 112_add_private_flags_to_activity_aggregates.sql.
        AND coalesce(is_private_model, false) = false
        AND coalesce(is_private_endpoint, false) = false
)
SELECT
    date,
    endpoint_id,
    colo,
    service_tier_bucket,
    quantileState(0.5)(latency_u32) AS p50_latency,
    quantileState(0.75)(latency_u32) AS p75_latency,
    quantileState(0.90)(latency_u32) AS p90_latency,
    quantileState(0.95)(latency_u32) AS p95_latency,
    quantileState(0.99)(latency_u32) AS p99_latency,
    minSimpleState(latency_u32) AS min_latency,
    maxSimpleState(latency_u32) AS max_latency,
    quantileState(0.5)(throughput_u32) AS p50_throughput,
    quantileState(0.75)(throughput_u32) AS p75_throughput,
    quantileState(0.90)(throughput_u32) AS p90_throughput,
    quantileState(0.95)(throughput_u32) AS p95_throughput,
    quantileState(0.99)(throughput_u32) AS p99_throughput,
    minSimpleState(throughput_u32) AS min_throughput,
    maxSimpleState(throughput_u32) AS max_throughput,
    quantileState(0.5)(latency_e2e_u32) AS p50_latency_e2e,
    quantileState(0.75)(latency_e2e_u32) AS p75_latency_e2e,
    quantileState(0.90)(latency_e2e_u32) AS p90_latency_e2e,
    quantileState(0.95)(latency_e2e_u32) AS p95_latency_e2e,
    quantileState(0.99)(latency_e2e_u32) AS p99_latency_e2e,
    minSimpleState(latency_e2e_u32) AS min_latency_e2e,
    maxSimpleState(latency_e2e_u32) AS max_latency_e2e,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(latency_u32) AS latency_quantiles,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(throughput_u32) AS throughput_quantiles,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(latency_e2e_u32) AS latency_e2e_quantiles,
    count() AS request_count
FROM throughput
-- GROUP BY column order mirrors the ORDER BY on the target table.
GROUP BY endpoint_id, service_tier_bucket, colo, date
-- Force GROUP BY to spill above ~10 GiB and cap parallelism at 4 threads
-- so the per-query memory ceiling (~75 GiB on CH Cloud compute) is not
-- exceeded. See "Chunking strategy" above and operational gotcha #7 for
-- the OOM diagnosis behind these values.
SETTINGS
    max_bytes_before_external_group_by = 10000000000,
    max_threads = 4;
```

### Chunk schedule (narrow default: 11 chunks)

If the chosen lower bound is `2026-05-09 00:00:00` (per-tier safe floor),
Phase 1 is 11 one-day chunks covering `2026-05-09 → 2026-05-20`. Set the
WHERE clause to each row's interval, in chronological order, and
sanity-check after each one. The shared timestamp between adjacent chunks
lands in the higher chunk (half-open `[start, end)`).

| # | chunk_start            | chunk_end (`<`)         |
|---|------------------------|--------------------------|
|  1| `'2026-05-09 00:00:00'`| `'2026-05-10 00:00:00'` |
|  2| `'2026-05-10 00:00:00'`| `'2026-05-11 00:00:00'` |
|  3| `'2026-05-11 00:00:00'`| `'2026-05-12 00:00:00'` |
|  4| `'2026-05-12 00:00:00'`| `'2026-05-13 00:00:00'` |
|  5| `'2026-05-13 00:00:00'`| `'2026-05-14 00:00:00'` |
|  6| `'2026-05-14 00:00:00'`| `'2026-05-15 00:00:00'` |
|  7| `'2026-05-15 00:00:00'`| `'2026-05-16 00:00:00'` |
|  8| `'2026-05-16 00:00:00'`| `'2026-05-17 00:00:00'` |
|  9| `'2026-05-17 00:00:00'`| `'2026-05-18 00:00:00'` |
| 10| `'2026-05-18 00:00:00'`| `'2026-05-19 00:00:00'` |
| 11| `'2026-05-19 00:00:00'`| `'2026-05-20 00:00:00'` |

The last chunk's upper bound matches the cutoff that Phase 2 will fill
in post-cutoff; the cutoff timestamp itself lands in the live MV (per
migration 122's `>=` cutoff WHERE).

### Chunk schedule (broader window: up to 30 chunks)

For all-tier rollup history, expand backwards from `2026-05-20` in
backwards chronological order. Useful expansion points:

- Back to `2026-04-20`: ~30 chunks total. Fills the rolling 30-day window
  that the live MV will start ingesting once the cutoff passes.
- Further back than 30 days: wasted minute work (TTL drops these rows).

### Per-chunk sanity check

After each chunk, confirm the backfilled minute slice lines up with the
v3 rollup for the same time range. v3 will run slightly higher than v4
by a small fraction of a percent (see operational gotcha #5); the goal
here is to confirm the chunk landed and that the delta sits in the
expected band, not to match v3 byte-for-byte.

```sql
SELECT
    'v3' AS source,
    sum(request_count) AS request_count
FROM endpoint_perf_minute_v3
WHERE date >= '<chunk_start>' AND date < '<chunk_end>'
UNION ALL
SELECT
    'v4' AS source,
    sum(request_count) AS request_count
FROM endpoint_perf_minute_v4
WHERE date >= '<chunk_start>' AND date < '<chunk_end>';
```

Expected: v3 ≥ v4 with delta typically <0.5% of v3. Stop and investigate
before continuing if v4 > v3 (reversed sign) or if the delta exceeds
~0.5%. Do **not** re-run the chunk to chase a small delta — it would
double-count what v4 already has (see operational gotcha #1).

## Phase 2 — minute backfill, post-cutoff

**Goal:** populate `endpoint_perf_minute_v4` for the 6 days between
deploy date and cutoff (`2026-05-20 → 2026-05-26`). Those days didn't
exist when Phase 1 ran, so the live MV is the only thing writing them
once the cutoff passes — and it only writes data from `now()` forward,
not retroactively. Phase 2 fills in the gap.

**Run on or after `2026-05-26 00:00:00 UTC`.** Before running, verify the
live MV started ingesting:

```sql
SELECT min(date), max(date), count()
FROM endpoint_perf_minute_v4
WHERE date >= '2026-05-26 00:00:00';
-- Expect at least a handful of rows for the post-cutoff window. If 0,
-- the live MV isn't ingesting yet — wait or investigate before Phase 2.
```

Then run the 6 one-day chunks in chronological order, using the same SQL
as Phase 1:

| # | chunk_start            | chunk_end (`<`)         |
|---|------------------------|--------------------------|
|  1| `'2026-05-20 00:00:00'`| `'2026-05-21 00:00:00'` |
|  2| `'2026-05-21 00:00:00'`| `'2026-05-22 00:00:00'` |
|  3| `'2026-05-22 00:00:00'`| `'2026-05-23 00:00:00'` |
|  4| `'2026-05-23 00:00:00'`| `'2026-05-24 00:00:00'` |
|  5| `'2026-05-24 00:00:00'`| `'2026-05-25 00:00:00'` |
|  6| `'2026-05-25 00:00:00'`| `'2026-05-26 00:00:00'` |

Sanity-check after each chunk with the same query as Phase 1.

## Phase 3a — daily backfill, pre-cutoff

**Goal:** populate `endpoint_perf_daily_v4` for the same window as
Phase 1, in larger chunks. Can run in parallel with Phase 1 if the
cluster has headroom; otherwise finish Phase 1 first.

```sql
INSERT INTO default.endpoint_perf_daily_v4
WITH throughput AS (
    SELECT
        toStartOfDay(created_at) AS date,
        endpoint_id,
        colo,
        multiIf(
            lower(service_tier) = 'flex', 'flex',
            lower(service_tier) = 'priority', 'priority',
            'default'
        ) AS service_tier_bucket,
        toUInt32(least(
            round(coalesce(latency, 0)),
            4294967295
        )) AS latency_u32,
        toUInt32(least(
            round(coalesce(latency, 0) + coalesce(generation_time, 0)),
            4294967295
        )) AS latency_e2e_u32,
        -- Operands cast to Float64 to avoid Decimal(18, 6) overflow; see
        -- migration 122 and the same comment on the minute chunk above.
        toUInt32(least(
            round(toFloat64(coalesce(native_tokens_completion, 0))
                  / toFloat64(coalesce(generation_time, 0)) * 1000),
            1000000
        )) AS throughput_u32
    FROM generations
    -- <<< EDIT FOR EACH CHUNK >>>
    -- Half-open interval [start, end); the cutoff timestamp itself
    -- lands in the live daily MV (migration 122 `>=` cutoff), not here.
    WHERE created_at >= '2026-05-09 00:00:00'
        AND created_at < '2026-05-20 00:00:00'
    -- <<< END EDIT >>>
        AND endpoint_id IS NOT NULL
        AND colo IS NOT NULL
        AND native_tokens_completion IS NOT NULL
        AND latency IS NOT NULL
        AND generation_time IS NOT NULL
        AND native_tokens_completion > 1
        AND latency > 0
        AND generation_time > 0
        -- Mirror the v3 MVs' private-resource exclusion added in
        -- migration 112_add_private_flags_to_activity_aggregates.sql.
        AND coalesce(is_private_model, false) = false
        AND coalesce(is_private_endpoint, false) = false
)
SELECT
    date,
    endpoint_id,
    colo,
    service_tier_bucket,
    quantileState(0.5)(latency_u32) AS p50_latency,
    quantileState(0.75)(latency_u32) AS p75_latency,
    quantileState(0.90)(latency_u32) AS p90_latency,
    quantileState(0.95)(latency_u32) AS p95_latency,
    quantileState(0.99)(latency_u32) AS p99_latency,
    minSimpleState(latency_u32) AS min_latency,
    maxSimpleState(latency_u32) AS max_latency,
    quantileState(0.5)(throughput_u32) AS p50_throughput,
    quantileState(0.75)(throughput_u32) AS p75_throughput,
    quantileState(0.90)(throughput_u32) AS p90_throughput,
    quantileState(0.95)(throughput_u32) AS p95_throughput,
    quantileState(0.99)(throughput_u32) AS p99_throughput,
    minSimpleState(throughput_u32) AS min_throughput,
    maxSimpleState(throughput_u32) AS max_throughput,
    quantileState(0.5)(latency_e2e_u32) AS p50_latency_e2e,
    quantileState(0.75)(latency_e2e_u32) AS p75_latency_e2e,
    quantileState(0.90)(latency_e2e_u32) AS p90_latency_e2e,
    quantileState(0.95)(latency_e2e_u32) AS p95_latency_e2e,
    quantileState(0.99)(latency_e2e_u32) AS p99_latency_e2e,
    minSimpleState(latency_e2e_u32) AS min_latency_e2e,
    maxSimpleState(latency_e2e_u32) AS max_latency_e2e,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(latency_u32) AS latency_quantiles,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(throughput_u32) AS throughput_quantiles,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(latency_e2e_u32) AS latency_e2e_quantiles,
    count() AS request_count
FROM throughput
-- GROUP BY column order mirrors the ORDER BY on the target table.
GROUP BY endpoint_id, service_tier_bucket, colo, date;
```

### Chunk schedule (narrow default: 1 chunk)

If Phase 1 used the narrow 2026-05-09 floor, Phase 3a is a single 11-day
chunk:

| # | chunk_start            | chunk_end (`<`)         |
|---|------------------------|--------------------------|
|  1| `'2026-05-09 00:00:00'`| `'2026-05-20 00:00:00'` |

### Chunk schedule (broader window: many chunks)

For broader windows, chunk backwards from `2026-05-20` in expanding
sizes. Suggested expansion path:

- First 4-6 chunks: 1 week each, going backwards from `2026-05-20`.
- After ~1 month covered cleanly: 2-week chunks.
- After ~3 months covered cleanly: 1-month chunks.

If a larger chunk fails (OOM, decimal overflow, etc.), split it back
into smaller chunks for that range and retry.

### Per-chunk sanity check

```sql
SELECT
    'v3' AS source,
    sum(request_count) AS total
FROM endpoint_perf_daily_v3
WHERE date >= toDate('<chunk_start>') AND date < toDate('<chunk_end>')
UNION ALL
SELECT
    'v4' AS source,
    sum(request_count) AS total
FROM endpoint_perf_daily_v4
WHERE date >= toDate('<chunk_start>') AND date < toDate('<chunk_end>');
```

Same tolerance as Phase 1: v3 ≥ v4 with delta typically <0.5% of v3 is
fine. Investigate if v4 > v3 or if the delta exceeds ~0.5%.

## Phase 3b — daily backfill, post-cutoff

**Goal:** fill the 6-day daily gap between deploy date and cutoff. Same
reason as Phase 2 — those days don't exist when Phase 3a runs, and the
live daily MV doesn't retroactively populate them.

**Run on or after `2026-05-26 00:00:00 UTC`.** Same pre-flight as
Phase 2 — verify the live daily MV started ingesting:

```sql
SELECT min(date), max(date), count()
FROM endpoint_perf_daily_v4
WHERE date >= toDate('2026-05-26');
-- Expect at least 1 row for the cutoff day itself once it has rolled
-- over. If 0, the live MV isn't ingesting yet.
```

Then run a single 6-day chunk using the Phase 3a SQL with this WHERE:

| # | chunk_start            | chunk_end (`<`)         |
|---|------------------------|--------------------------|
|  1| `'2026-05-20 00:00:00'`| `'2026-05-26 00:00:00'` |

One chunk is fine — daily output across 6 days is tiny.

## Final verification (before merging the helper-flip PR)

The follow-up PR flips reader helpers from v3 to v4. Before merging it,
run the cross-version sanity checks below over the chosen backfill window
and confirm they pass. The queries below use the narrow default window;
substitute the chosen start_date if Phase 1 / 3a went further back.

### 1. Request-count parity

```sql
WITH window AS (SELECT toDate('2026-05-09') AS start_date, toDate('2026-05-26') AS end_date)
SELECT
    'v3 daily' AS source,
    sum(request_count) AS total
FROM endpoint_perf_daily_v3, window
WHERE date >= window.start_date AND date < window.end_date
UNION ALL
SELECT
    'v4 daily (all buckets)' AS source,
    sum(request_count) AS total
FROM endpoint_perf_daily_v4, window
WHERE date >= window.start_date AND date < window.end_date;
```

Expected: v3 daily ≥ v4 daily (all buckets) by typically <0.5% (same
peerdb pre-dedup artifact as the per-chunk checks; see operational
gotcha #5). Investigate before flipping helpers if v4 exceeds v3, if the
delta is materially larger than per-chunk readings, or if the delta
grows after merges have had time to run.

### 2. Per-tier breakdown sanity-check

```sql
SELECT
    service_tier_bucket,
    sum(request_count) AS request_count
FROM endpoint_perf_daily_v4
-- Half-open interval matches the backfill chunks; the cutoff date itself
-- is partial (live MV only) until the next day rolls over.
WHERE date >= toDate('2026-05-09') AND date < toDate('2026-05-26')
GROUP BY service_tier_bucket
ORDER BY request_count DESC;
```

Expect `default` to dominate (most providers don't emit flex/priority).
A material `flex` / `priority` share is fine — flag only if `default` is
unexpectedly small (could indicate a casing or `multiIf` bug).

### 3. Quantile parity spot-check on a top endpoint

```sql
WITH top_endpoint AS (
    SELECT endpoint_id
    FROM endpoint_perf_daily_v4
    WHERE date >= toDate('2026-05-09') AND date < toDate('2026-05-26')
    GROUP BY endpoint_id
    ORDER BY sum(request_count) DESC
    LIMIT 1
)
SELECT
    'v3' AS source,
    quantilesMerge(0.5, 0.95, 0.99)(latency_quantiles) AS latency_p50_p95_p99
FROM endpoint_perf_daily_v3
WHERE endpoint_id = (SELECT endpoint_id FROM top_endpoint)
  AND date >= toDate('2026-05-09') AND date < toDate('2026-05-26')
UNION ALL
SELECT
    'v4' AS source,
    quantilesMerge(0.5, 0.95, 0.99)(latency_quantiles) AS latency_p50_p95_p99
FROM endpoint_perf_daily_v4
WHERE endpoint_id = (SELECT endpoint_id FROM top_endpoint)
  AND date >= toDate('2026-05-09') AND date < toDate('2026-05-26');
```

t-digest is approximate; expect p50/p95/p99 to agree within a few percent.
Significant divergence (e.g. p95 differs by 20%+) means the backfill SELECT
does not match the live MV SELECT — investigate before flipping helpers.

## Rollback

If parity checks fail and the issue is not quickly fixable, drop the v4
tables and re-deploy the migration with a fresh future cutoff:

```sql
DROP VIEW IF EXISTS default.endpoint_perf_daily_v4_mv;
DROP TABLE IF EXISTS default.endpoint_perf_daily_v4;
DROP VIEW IF EXISTS default.endpoint_perf_minute_v4_mv;
DROP TABLE IF EXISTS default.endpoint_perf_minute_v4;
```

Then add a new migration (don't edit 121 or 122 in place — those are
applied) that recreates the v4 tables and MVs with a fresh future cutoff,
deploy it, and restart this runbook from the top. Helpers remain on v3
throughout so user-facing reads are unaffected by either the failure or
the rollback.
