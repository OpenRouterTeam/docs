[../270_add_api_key_origin_v1.sql](../270_add_api_key_origin_v1.sql), [../279_add_ip_hash_to_api_key_origin_minute_v1.sql](../279_add_ip_hash_to_api_key_origin_minute_v1.sql)

# Backfill for `api_key_origin_minute_v1` / `api_key_origin_daily_v1`

migration 270 creates the two tables and their insert-triggered MVs with no `POPULATE`, so they hold traffic from the apply time forward. The per-key 30-day baseline that reads them (drift scoring, the API-key page origin summary) is therefore partial until 30 days after apply, or until this backfill runs. `API_KEY_ORIGIN_HISTORY_START` in `packages/clickhouse/api-key-origin/queries.ts` must be set to the first UTC day the tables hold complete data, whether that is the apply day or the first backfilled day. Migration 279 widens the minute grain with `ip_hash` and `ua80` in place, so minute rows written before its apply time carry empty values for both and this task fills them when it rebuilds a day.

## How to run it

The backfill is the reviewed Mission Control task `clickhouse-api-key-origin-v1` (`packages/backfill/tasks/clickhouse-api-key-origin-v1/`), driven from Preview -> Review -> Start at `https://internal.openrouter.ai/admin-utils/backfill/clickhouse-api-key-origin-v1`. Do not run any of the DDL or INSERT statements by hand from a SQL console. The verification query at the end is read-only and is the one thing safe to run directly. The rest of this runbook records the DDL rationale and the exact source semantics so they stay next to the migration.

Operator input is an inclusive UTC day range, `start_date` and `end_date`. Preview rejects rather than trims any range that:

- is malformed, not a real calendar day, or has `end_date` before `start_date`;
- spans more than 32 days (the repairable window: the completed days still fully inside the 35-day minute TTL, minus the 3 settle days, see below);
- includes the current UTC day, a future day, or a day that ended less than 3 UTC days ago (see Live-write ownership below);
- starts on a day the minute TTL has already expired as of now.

Days the live MVs wrote, including days written before migration 279 at the old grain, are accepted once they have settled: hour 00 drops the day before rebuilding it, after proving that nothing else is still writing it. The `Full retained history` preset covers every settled day still inside the TTL, through 3 days ago; `Single day re-run` covers 3 days ago. Both are computed by the task from the clock of the request that lists or validates them, so a single request sees one consistent window, and both are unlocked so the range can be narrowed.

## Live-write ownership

The live minute MV fires on `generations` inserts, and those inserts carry `created_at` values that are hours old: on the production cluster, `system.part_log` shows non-backfill parts landing in the minute partition of a UTC day up to about 24 hours after that day ended (808, 1,428 and 981 minutes after day end for three consecutive September days). A rebuild that ran during that window would drop the partition, re-insert from `generations`, and then receive the late live-MV part as well, double counting those requests with no step able to notice, because the hour sums are checked before the late part lands. Dropping hour 00 does not make a live-MV-written day safe on its own.

The task therefore requires two things before it clears a day:

1. **Settle boundary.** The planner and the handler both refuse any day that ended less than `API_KEY_ORIGIN_LIVE_SETTLE_DAYS` (3) UTC days ago, so the newest repairable day is 3 days back. This is a margin over the roughly one day of delayed writes observed.
2. **`system.part_log` probe.** Hour 00, once it has decided the day is incomplete and immediately before the `DROP PARTITION`, counts `NewPart` events on `clusterAllReplicas(<system cluster>, system.part_log)` for `default.api_key_origin_minute_v1` in the day's partition within the last 24 hours whose `query_id` does not start with `api-key-origin-v1-{day}-` (the task's own inserts for that day, which are the only expected writers). Any other part means the live MV, or someone else, is still writing the day, and the chunk fails with a retryable `live-write-check` error before any destructive statement runs. The probe also fails closed: if `system.clusters` or `system.part_log` cannot be read, the chunk fails with `live-write-check` and nothing is dropped. The system cluster is `all_groups.default` when it exists, otherwise `default`, the same resolution the endpoint-perf backfill uses for `system.processes`.

The active-insert check (step 1 below) is separate and still runs for every hour; it catches this task's own orphaned inserts, which the ownership probe deliberately ignores. A day that is already complete at the exact grain is never probed and never cleared.

## Approach

Both tables are `AggregatingMergeTree` with `SimpleAggregateFunction` and `AggregateFunction` state columns, so a backfill is an `INSERT ... SELECT` that re-runs the MV's own SELECT over `default.generations` bounded by `created_at`, one UTC day at a time. The daily MV reads the minute table, so the daily table is rebuilt by the same insert: the minute `INSERT` fires `api_key_origin_daily_v1_mv` exactly as a live insert does. There is no generations-sourced daily statement, so days older than the minute TTL are not backfilled and `API_KEY_ORIGIN_HISTORY_START` can move back at most 34 days (day D starts expiring once now >= D + 35 days, so the 35th day back is already partially expired).

Double-count hazards, and how the task avoids them:

- **Overlap with the live MV.** The MV processes rows by insert time, so a day the live MVs wrote (or partially wrote, or wrote before migration 279 at the old grain) already holds rows that a blind insert would double. Hour 00 therefore never inserts on top of existing rows: it either proves the day complete or drops the whole day from both tables first, and it drops only after the settle boundary and the `system.part_log` probe above show that the live MV has stopped writing the day. Days that ended less than 3 UTC days ago are refused, in the planner and again in the handler, because delayed `generations` inserts keep reaching the live MV for about a day after a day ends.
- **Interrupted runs and queue retries.** Aggregate states merge additively, so a blind re-insert doubles the hour. Hour 00 compares the whole day (minute and daily request totals against generations, then the exact-grain check below) and is skipped only when everything matches; otherwise it clears the whole day from both tables and verifies the clear before inserting. Hours 01-23 check their own range: a matching hour is skipped, an empty hour is inserted, and any other total is refused so the operator re-runs the day.
- **Hour order.** The queue serializes deliveries but does not order them: a redelivered hour 00 could otherwise run after hour 05 completed and wipe it. Every hour 01-23 is therefore gated on the durable ledger status of the previous hour before it runs (see Retry below).
- **Queue consumer wall clock.** A Cloudflare Queue consumer invocation is limited to 15 minutes. One hourly insert takes about 60-80 seconds on the ecru compute group, so a day's 24 inserts (about 28 minutes) cannot share one queue message. Each queue message therefore carries exactly one hour.

## What one chunk does

The plan is 24 chunks per UTC day, one per hour (`{ chunk_index, chunk_count, day, hour }`), ordered oldest day first and hour 00 to 23 within the day, at most 768 chunks for the 32-day repairable window. Both tables are repaired by the same inserts: the daily table is populated by the minute insert through the live daily MV, so there is no separate daily insert. Each chunk, with `alter_sync=2` on the mutations, runs:

1. Refuse if any `api-key-origin-v1-{day}-minute-insert-*` query for the day is still running anywhere in the cluster (`system.processes` on `clusterAllReplicas`). This catches an insert orphaned by a previous invocation that hit the consumer wall clock.
2. `count()` of admissible `generations` rows for the hour, the request total the hour must reproduce (`hour-source-count`).
3. Hour 00 only: `count()` of admissible `generations` rows for the whole day (`day-source-count`), then `sum(requests)` over the minute table and over the daily table for the day, both with `select_sequential_consistency=1` (`day-minute-check`, `day-daily-check`). When both sums equal the day count, `countIf` of minute rows whose `ip_hash` is empty while the `ip_hashes` sketch holds a value other than the empty string, or whose `ua80` is empty while the `user_agents` sketch holds a value other than the empty string (`day-grain-check`, `select_sequential_consistency=1`). Each test merges the empty string into the sketch (`arrayReduce('uniqCombinedMerge', [sketch, initializeAggregation('uniqCombinedState', '')]) > 1`): at the exact grain a row whose dimension is `''` grouped only requests with a NULL or explicitly empty header, so the merged sketch holds at most the empty string, while a row the live MV wrote before migration 279 keeps the real hashes or user agents behind the defaulted dimension and merges to two or more. This is why an explicitly empty `user_agent` header, which the live MV sketches as the empty string, does not count as stale. A zero count over a day whose totals match means the day was already repaired at the exact grain, and the chunk succeeds without inserting. Otherwise: the `system.part_log` ownership probe (`live-write-check`, see Live-write ownership), then `ALTER TABLE default.api_key_origin_minute_v1 DROP PARTITION {yyyymmdd}` (the minute table is partitioned by `toYYYYMMDD(date)`), then `count()` of minute rows for the day with `select_sequential_consistency=1`, failing if any remain. Then `DELETE FROM default.api_key_origin_daily_v1 WHERE date = toDate('{day}')` (a lightweight delete; the daily table is partitioned by month, so the day cannot be dropped), then `count()` of daily rows for the day, failing if any remain.
4. Hours 01-23 only: `sum(requests)` of minute rows for the hour with `select_sequential_consistency=1` (`hour-check`). A sum equal to step 2 means the hour was already repaired by an earlier delivery, and the chunk succeeds without inserting. A zero sum means insert. Any other sum fails the chunk, because the daily table has no per-hour delete, so a partial hour can only be repaired by re-running the day from hour 00.
5. `INSERT INTO default.api_key_origin_minute_v1 SELECT <minute MV body> FROM default.generations WHERE <admission> AND created_at >= '{day} {HH}:00:00' AND created_at < '{day} {HH+1}:00:00' GROUP BY <minute MV keys> SETTINGS max_bytes_before_external_group_by = 10000000000`, query id `api-key-origin-v1-{day}-minute-insert-{HH}`. The daily MV cascades from the insert. A single full-day insert was tried first and hit the cluster's memory limit (code 241 at 138-163 GiB). One hour peaks around 30 GiB.
6. `sum(requests)` over the minute table for the hour with `select_sequential_consistency=1`, which must equal step 2 (`hour-verify`).
7. Hour 23 only: `count()` of admissible `generations` rows for the whole day, then `sum(requests)` over the minute table and over the daily table for the day, both with `select_sequential_consistency=1`; each must equal the day count (`source-count`, `minute-verify`, `daily-verify`). This is the only place the daily table is checked, so a day whose hour 23 chunk dead-letters has not been verified. `minute-verify` is skipped, and logged as `null`, when the minute TTL has begun expiring the day since hour 00 accepted it (see Timing), because the minute total then no longer proves anything; the daily total is still verified.

Every hour re-checks the settle boundary, since a day that has settled stays settled. Only hour 00 checks the minute TTL boundary: it decides once whether the whole day is still retained, and hours 01-23 are chained behind it, so a run that crosses UTC midnight finishes the day it started instead of leaving it partially rebuilt.

The chunk succeeds only when every verification passes, and any failure returns a `Result` error naming the failed step (`insert-running-check`, `hour-source-count`, `day-source-count`, `day-minute-check`, `day-daily-check`, `day-grain-check`, `live-write-check`, `minute-drop`, `minute-drop-verify`, `daily-delete`, `daily-delete-verify`, `hour-check`, `minute-insert`, `hour-verify`, `source-count`, `minute-verify`, `daily-verify`, or `refused`).

`sql-consistency.test.ts` asserts that the insert in step 5 is byte-for-byte the minute MV SELECT from the migration plus the range bound and the spill setting, so the task cannot drift from the live MV.

## Retry, cancellation, and dead letters

The task runs on the shared `backfill-tasks` queue under the generic per-task run lock, so two runs never overlap, and the predecessor chain below serializes every chunk of a run so two hourly inserts never execute at once on the cluster. The first delivery of a run is delayed 120 seconds so the lock propagates before any chunk executes, and a chunk whose lock is missing or held by another run is discarded. The queue redelivers a failed chunk after 600 seconds, long enough for an orphaned insert to finish so that step 1 stops refusing, and for a `live-write-check` refusal to be re-evaluated once the late part is outside the 24 hour window. A redelivered hour that already completed is a no-op, and a redelivered hour that was cut off mid-insert either finds an empty range (the insert was rolled back) and inserts, or finds the completed insert and skips.

Each chunk is gated on the ledger state of the chunk before it in the run. Before any ClickHouse work, the consumer reads the chunk's own row and its predecessor's row (`chunk_index - 1`, none for the first chunk of the run) in `backfill_run_chunks` with primary-pinned reads, since the predecessor may have settled moments earlier. The chain does not reset at UTC day boundaries: hour 00 of a day waits on hour 23 of the previous day, so a multi-day run is strictly serial. Without this the shared queue (`max_concurrency = 10`) would start up to ten hour-00 inserts at once, each peaking around 30 GiB, which is the memory-limit failure the hourly slicing was introduced to avoid.

- Own row `completed` or `failed`: acknowledge without running.
- Predecessor `completed` (or first chunk of the run): run the hour.
- Predecessor `planned`: re-send the same message with a 120 second delay and acknowledge this delivery. The payload and `chunk_id` are unchanged, so the ledger still holds exactly one row for the hour.
- Predecessor `failed` or missing: mark this hour `failed` in the ledger and do not run it, because the day cannot be verified past a dead hour. On a run-wide chain this fails every later chunk of the run through the 120 second re-send cascade, so cancel the run and re-run the affected days rather than waiting for the cascade to drain.
- Ledger read error: retry the delivery after 600 seconds.

The gate runs after the cancellation tombstone and run-lock checks, so a cancelled run still discards queued hours without reading the ledger, and before the handler, so a deferred hour touches ClickHouse only once its predecessor is `completed`.

After the retry budget the chunk lands in `backfill-tasks-dead-letter`, and its payload (`chunk_index`, `chunk_count`, `day`, `hour`, nothing else) is kept for 30 days in the shared `KV_MODELS_AND_ENDPOINTS` namespace by the generic control plane. Re-run that day with the `Single day re-run` preset rather than replaying the dead letter, because the later hours of that day were never verified against it.

Cancel from the run page writes the per-job cancellation tombstone and clears the lock. Chunks still in the queue are discarded without running, and a chunk already executing runs its step sequence to the end. If the tombstone cannot be read, the delivery is retried without executing the chunk. A cancelled run leaves a day whose hour 23 completed verified, and leaves a day cancelled mid-way partially populated; re-run that day from hour 00 with the `Single day re-run` preset.

## Timing

With the run-wide predecessor chain, a full 768-chunk run is 768 sequential hours of work plus queue handoff latency. One hourly insert takes about 60-80 seconds of ClickHouse time on the ecru compute group, so the ClickHouse work alone is about 13-23 hours. Each handoff between chunks costs on average another 60 seconds (a chunk that finds its predecessor `planned` re-sends itself with a 120 second delay), or about 12.8 hours across 767 handoffs. A realistic full run is therefore about 28 hours, and the ceiling with no failures and every handoff paying the full 120 second delay is about 49 hours. Every failed chunk adds its 600 second redelivery interval on top. Start the full run with these figures in mind: the `Full retained history` preset repairs the oldest day first, and the oldest retained day starts expiring from the minute TTL 35 days after it ended. Hour 00 refuses a day the TTL has already reached, and a day accepted at hour 00 is finished by hours 01-23 even when UTC midnight passes mid-day, but the TTL then starts deleting that day's earliest minute rows while the later hours are still being inserted. Re-run such a day only if it is still inside the window, and otherwise let the TTL finish removing it.

For the migration 279 rebuild specifically, apply 279 and start `Full retained history` right away. Every day in that plan (apply day minus 34 through apply day minus 3) was written before 279 at the old grain and stopped receiving live writes at least two days earlier, so hour 00 finds the stale grain, a quiet `system.part_log`, and rebuilds without waiting. The settle boundary only excludes the three newest days: the apply day itself (its pre-apply hours are at the old grain) and the two days before it. Repair those in a second run three days after apply, entering that three-day range (72 chunks, about 2.5 hours) in the date fields. Complete days the live MV wrote after apply pass the totals and grain checks at hour 00 and are skipped without a probe or a rebuild, so a wider range on the second run costs only the hour 00 checks. The three newest days cannot ride along in the first run: the planner rejects a range that ends on an unsettled day, and the queue has no way to park a chunk until its day settles (a `refused` chunk is retried five times ten minutes apart and then dead-letters, blocking every chunk behind it).

## Monitoring

Each chunk emits `openrouter.backfill.api_key_origin_v1.chunk_outcome` tagged `outcome:{success|failure}` and `step:<step>`, and logs `backfill-api-key-origin-v1-chunk-complete` (with `hour`, `hour_outcome` of `inserted` or `already-complete`, and on hour 23 the three matching day request totals) or `backfill-api-key-origin-v1-chunk-failed` (with the hour, step and message). A day is healthy when its hour 23 chunk logs complete with the three totals; any `chunk-failed` line names the day, hour and step to look at.

Residual invariant to check by hand for a sampled backfilled day, all three must match:

```sql
SELECT count() FROM default.generations
WHERE generation_type NOT IN ('server_tool_call', 'server_tool_checkpoint', 'server_tool_root')
  AND toDate(created_at, 'UTC') = '{day}';

SELECT sum(requests) FROM default.api_key_origin_minute_v1
WHERE toDate(date) = '{day}';

SELECT sum(requests) FROM default.api_key_origin_daily_v1
WHERE date = '{day}';
```

Then set `API_KEY_ORIGIN_HISTORY_START` to the first backfilled day and ship that change.

## Production verification without running it

Preview is read-only: it plans and validates the range but enqueues nothing. To verify the task in production before a Start, open the task page, pick the `Full retained history` preset, and confirm Preview lists the expected day count (32 or fewer, the newest 3 days back) and `first_day` / `last_day` in the details. Confirm migration 279 has been applied on the analytics cluster (`ip_hash` and `ua80` exist on `default.api_key_origin_minute_v1`) before the first Start; the insert and the exact-grain check both reference those columns.

## Rollback

Forward-only: a new migration that drops the daily MV, daily table, minute MV, minute table, in that order. Backfilled data is dropped with the tables.
