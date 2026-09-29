# Endpoint performance V5 backfill

This runbook populates the final 30 days of endpoint-first V5 minute and daily history as two separately reviewed Mission Control runs. It does not move readers or create `model_perf_v1`.

## Safety model

- Every chunk is delete, verify empty, then insert.
- The queue processes one chunk at a time.
- A deterministic ClickHouse query ID prevents a retry from deleting beneath an insert that is still running server-side.
- Failed chunks retry after 10 minutes and move to a dead-letter queue after eight attempts.
- Dead-letter payloads are retained in KV under `backfill:dead-letter:` keys.
- If a Worker crashes after delete verification succeeds but before insert
  dispatch reaches ClickHouse, the window can remain empty. Automatic retries
  stay fail-closed, suppress delete, and may dead-letter until a human operator
  proves the insert was never accepted.
- Both phases keep the same `backfill-endpoint-perf-v5` task type, dedicated queue, handler, cancellation contract, run history, and task-wide lock.
- The shared task lock rejects a second phase while either phase is active. The KV lock is still a best-effort duplicate-trigger guard rather than a distributed mutex; serialized delete-first chunks converge if two requests race at the exact lock boundary.

Do not run two phases concurrently. Starting Minute history never creates, enqueues, schedules, or automatically starts Daily history.

Only a human production operator may Start, Cancel, Pause delivery, Resume
delivery, clear locks, replay dead-letter payloads, purge queues, or run the
post-deploy canary. Implementation agents may update code or documentation and
may provide verification commands, but they must not execute production
backfill control actions.

## Required evidence

Record these values with the change ticket before triggering:

- `start_date`: earliest retained `generations` date to reconstruct
- `workload_audit_start_date` and `workload_audit_end_date`: bounds proven by the retained workload-classification audit
- `chat_image_marker_reliable_after`: earliest date at which chat image output is reliably identified by `num_media_completion`. `start_date` may predate this marker when the retained audit covers the full window; earlier chat-path rows are intentionally classified as `text_generation` fallback because raw fields cannot distinguish image output from text output.
- `workload_audit_artifact`: durable identifier for the audit evidence
- `deploy_boundary`: captured when the live V5 MVs were deployed
- `cutoff`: midnight UTC after the deploy boundary, used as the exclusive upper bound

The trigger rejects windows outside the recorded audit and deploy boundaries.

Both locked production presets cover exactly `2026-07-19 00:00:00` through the
exclusive `2026-08-18 00:00:00` cutoff. The retained classification audit starts
earlier than this write window and remains evidence for classification and
coverage semantics only; it does not validate operational chunk sizing. The
required `phase` discriminator selects exactly one phase for both Preview and
Start; batch widths are fixed by the reviewed presets rather than editable
operator input.

## Recovery sizing evidence

The cancelled six-hour production attempt `bf-OwkfU13dETAR4dhQnnIw` settled 3
of 150 chunks before cancellation. A successful minutely chunk took about 115
seconds, another insert returned HTTP 524 after about 133 seconds, and an active
six-hour insert was observed using 13.16 GiB while reading roughly 240 million
rows. Six-hour minutely chunks are therefore rejected for the production request
path. The corrected plan uses the minimum supported one-hour minutely interval,
one sixth of the failed window, while preserving the complete 30-day range.

Production job `bf-YwhEQJ7ixOBamqn2Edtv` completed all 720 minutely chunks.
Daily chunks measured about 130-250 seconds each, while the Cloudflare proxy
returned HTTP 524 near the 100 second boundary even though ClickHouse inserts
could continue server-side. In one six-hour observation window the job produced
116 HTTP 524 insert outcomes and 10 `running-check` refusals where the retry
correctly avoided deleting under a still-running prior insert. Eight daily
chunks reached delivery attempt 9 with `max_retries = 8` and dead-lettered.
Mission Control showed 742 completed chunks and 8 failed chunks at the time the
queue was paused. The failed ranges were not known from the run summary; recover
them only from the eight retained dead-letter KV payloads.

Treat a 524 as ambiguous, not failed, until recovery evidence resolves it. A
retried chunk may settle successfully when `system.query_log` later shows a
matching `QueryFinish` and insert verification matches written rows. The
completion gate is therefore no unresolved timeout: every 524 must be paired
with `timeout_recovered`, a confirmed ClickHouse exception followed by a later
successful attempt, or an explicitly retained dead-letter payload awaiting
human replay.

Keep queue concurrency at one until both daily and minutely chunk memory have
been measured. Increasing queue concurrency globally can overlap an unmeasured
daily insert with a minutely insert, so it is not an approved throughput lever.
The handler instead removes per-chunk diagnostic overhead: all correctness
checks still run for every chunk, while the expensive raw-generations text
comparison runs for one minutely chunk per UTC day.

## Preflight

Confirm the tables and views exist:

```sql
EXISTS TABLE default.endpoint_perf_minute_v5;
EXISTS TABLE default.endpoint_perf_daily_v5;
EXISTS TABLE default.endpoint_perf_minute_v5_mv;
EXISTS TABLE default.endpoint_perf_daily_v5_mv;
```

Confirm the backfill ClickHouse user can inspect running queries across the production cluster:

```sql
SELECT count()
FROM clusterAllReplicas('all_groups.default', system.processes)
WHERE query_id = 'endpoint-perf-v5-preflight';
```

The handler fails closed before deleting data if this probe is unavailable. Local and single-node environments use the `default` cluster.

Confirm the queue and dead-letter queue are empty before starting. Confirm no `backfill:running:backfill-endpoint-perf-v5` lock exists unless it belongs to the current job.

## Preview and Start

Use the generic Mission Control backfill page. Preview is side-effect free: it
does not create a run, take the lock, or enqueue work.

1. Select the locked **Minute history — run first** preset. Confirm Preview
   reports `phase = minute_history`, `tasks_planned = 720`,
   `minutely_chunks = 720`, and `daily_chunks = 0`. Confirm every chunk is a
   one-hour `minutely` window and the newest-first sequence covers the complete
   30-day interval without gaps.
2. Start that preset exactly once. Record its durable `job_id`; this Start
   creates only the Minute history run.
3. Wait for terminal completion and review the evidence gate below.
4. Only after explicit approval, select the locked **Daily history — run after
   approval** preset. Confirm Preview reports `phase = daily_history`,
   `tasks_planned = 30`, `daily_chunks = 30`, and `minutely_chunks = 0`.
   Confirm every chunk is a 24-hour `daily` window over the same complete
   30-day interval.
5. Start Daily history separately and record its distinct durable `job_id`.

Within each run, chunks execute newest to oldest so the most useful history
lands first. There is no parent run, phase fan-out, or automatic second Start.

The oldest chunk in a phase may be shorter than the configured batch width when
the requested interval is not evenly divisible. That chunk must end exactly
where the next chunk begins and start exactly at the requested boundary; it is
full coverage, not truncation.

## Monitor

Watch queue depth and retry counts for `backfill-endpoint-perf-v5`, dead-letter
depth for `backfill-endpoint-perf-v5-dead-letter`, queue-level processed and
latency metrics, endpoint-perf-v5 recovery metrics, recovery-event logs,
row-count comparison logs, ClickHouse query duration, bytes read, memory, and
background merge pressure.

Use the job id as a required filter in production except for the queue-level
dead-letter discovery query, which must still find malformed payloads that lack
parsed correlation fields. Replace `<job_id>` with the Mission Control run id.

Datadog log queries:

```text
# Attempts and terminal completions
service:cfw-internal env:prod "backfill-endpoint-perf-v5-recovery-event" @extra.job_id:<job_id> (@extra.event:attempt_started OR @extra.event:terminal_completion)

# 524s versus recovered inserts
service:cfw-internal env:prod "backfill-endpoint-perf-v5-recovery-event" @extra.job_id:<job_id> (@extra.event:proxy_timeout OR @extra.event:timeout_recovered)

# Unresolved timeout ambiguity
service:cfw-internal env:prod "backfill-endpoint-perf-v5-recovery-event" @extra.job_id:<job_id> @extra.event:outcome_ambiguous

# ClickHouse terminal exceptions found during retry reconciliation
service:cfw-internal env:prod "backfill-endpoint-perf-v5-recovery-event" @extra.job_id:<job_id> @extra.event:query_exception

# Delete allowed, delete performed, and delete suppressed
service:cfw-internal env:prod "backfill-endpoint-perf-v5-recovery-event" @extra.job_id:<job_id> (@extra.event:delete_allowed OR @extra.event:delete_suppressed OR @extra.delete_performed:true OR @extra.delete_performed:false)

# Verification mismatches and sampled row-count drift
service:cfw-internal env:prod (@extra.job_id:<job_id> @extra.event:verification_mismatch) OR ("backfill-endpoint-perf-v5-row-count-drift")

# Delivery attempts carried by queue retries
service:cfw-internal env:prod "backfill-endpoint-perf-v5-recovery-event" @extra.job_id:<job_id> @extra.delivery_attempt:*

# Running-check refusals that intentionally avoid deleting under an active insert
service:cfw-internal env:prod "backfill queue: handler returned error" @extra.job_id:<job_id> @extra.error_location:(backfill\:endpoint-perf-v5\:daily-running-check OR backfill\:endpoint-perf-v5\:minutely-running-check)

# Retained dead-letter payloads for this queue, emitted immediately after KV write and before lifecycle accounting
service:cfw-internal env:prod "backfill-dead-letter-payload-persisted" @extra.queue:backfill-endpoint-perf-v5-dead-letter

# Optional narrowing after the queue-level persisted-payload record is visible and parsed correlation exists
service:cfw-internal env:prod "backfill-dead-letter-payload-persisted" @extra.queue:backfill-endpoint-perf-v5-dead-letter @extra.task_type:backfill-endpoint-perf-v5 @extra.job_id:<job_id> @extra.chunk_id:*

# Durable lifecycle failure accounting after retained payload persistence
service:cfw-internal env:prod "backfill-dead-letter-message" @extra.queue:backfill-endpoint-perf-v5-dead-letter @extra.task_type:backfill-endpoint-perf-v5 @extra.job_id:<job_id> @extra.chunk_id:*

# Dead-letter payload KV write failures; these messages retry and are not retained yet
service:cfw-internal env:prod "backfill-dead-letter-kv-write-failed" @extra.queue:backfill-endpoint-perf-v5-dead-letter
```

Datadog metric queries:

```text
# Queue-level attempts by outcome
sum:openrouter.backfill.processed{task_type:backfill-endpoint-perf-v5} by {outcome}.as_count()

# Queue-level handler latency
p95:openrouter.backfill.latency{task_type:backfill-endpoint-perf-v5} by {outcome}

# Insert outcomes by table, outcome, and recovery decision
sum:openrouter.backfill.endpoint_perf_v5.insert_outcome{*} by {table_type,outcome,decision}.as_count()

# Insert duration; daily production measured about 130-250s
p95:openrouter.backfill.endpoint_perf_v5.insert_duration_ms{*} by {table_type}

# Query-log recovery probe latency
p95:openrouter.backfill.endpoint_perf_v5.recovery_latency_ms{*} by {table_type}

# Delivery attempt distribution; values of 9 mean max_retries=8 was exhausted
max:openrouter.backfill.endpoint_perf_v5.delivery_attempt{*} by {table_type}

# DLQ deliveries
sum:openrouter.backfill.dead_letter{queue:backfill-endpoint-perf-v5-dead-letter}.as_count()
```

Every ClickHouse operation has a deterministic query ID. The insert keeps the
durable `bf-epv5-<job-id>-<chunk-id>` ID so retries can find it. Legacy
non-durable contexts fall back to `bf-epv5-<table>-<start>-<end>`. Surrounding
operations append `-running-check`, `-delete`, `-delete-verify`,
`-insert-verify`, `-outcome-probe`, `-v5-text-count`, or `-raw-text-count`.
Use those suffixes to separate required work from supplemental
comparison overhead:

```sql
SELECT
    query_id,
    initial_query_id,
    type,
    query_duration_ms,
    written_rows,
    read_rows,
    read_bytes,
    formatReadableSize(memory_usage) AS peak_memory,
    substring(exception, 1, 500) AS exception
FROM clusterAllReplicas('all_groups.default', system.query_log)
WHERE type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
    AND startsWith(query_id, 'bf-epv5-')
ORDER BY event_time DESC;
```

Every terminal chunk emits `backfill-endpoint-perf-v5-recovery-event` with
`event = terminal_completion` and `verification_result = match`. Every terminal
chunk also emits `backfill-endpoint-perf-v5-row-count-comparison`.
`comparison_sampled = true` identifies the UTC-midnight minutely sample that
also ran the two text comparison queries. Unsampled chunks report
`delta = not-sampled`; that is expected and does not weaken insert verification.
The Minute history window therefore produces 30 sampled comparisons rather than
running the raw-generations reconstruction for all 720 minutely chunks.

Recovery-event states:

| Event | Meaning | Operator action |
| --- | --- | --- |
| `attempt_started` | Handler attempt began with the chunk's stable query identity and delivery attempt. | Use as the denominator for retries and long-running chunks. |
| `proxy_timeout` | The ClickHouse HTTP client saw a 524-like timeout after sending the insert. | Do not delete or replay from this event alone; wait for retry reconciliation. |
| `prior_query_probed` | A retry queried `system.query_log` for the prior insert's stable query id. | Inspect `query_log_type`, duration, rows, bytes, and memory. |
| `delete_allowed` | The retry saw a terminal prior exception and may delete and retry safely. | Confirm it is followed by a successful later completion. |
| `delete_suppressed` | The prior insert outcome is not safe to delete under. | Leave delivery paused or let the retry budget continue; do not manually delete. |
| `timeout_recovered` | A previous 524 resolved to `QueryFinish` and row verification matched. | Count the chunk as recovered success. |
| `query_exception` | `system.query_log` showed `ExceptionBeforeStart` or `ExceptionWhileProcessing`. | A later delete-and-retry may be safe; verify terminal completion. |
| `verification_mismatch` | Written rows and present rows did not match. | Treat as unresolved; do not replay until the mismatch is explained. |
| `outcome_ambiguous` | Query-log probing failed or the prior insert is not visible yet. | This blocks completion until recovered, explained, or represented by retained DLQ payload. |
| `terminal_completion` | The chunk reached a verified terminal success. | Count toward completion. |

## Minute-to-daily evidence gate

Do not start Daily history until the Minute history run is terminal and the
operator has reviewed and retained:

- 720 of 720 completed minutely chunks and zero daily chunks for that run
- empty primary and dead-letter queues for the run, with no retained dead-letter records
- no server-side Minute insert still running for the recorded run. Use the
  durable query-id contract, not the legacy table/window prefix: sanitize the
  Minute history `job_id` by replacing every non-`[A-Za-z0-9_-]` character
  with `-`, collapsing repeated `-`, truncating the sanitized part to 96
  characters, and matching
  `bf-epv5-<sanitized-job-id>-<sanitized-chunk-id>` query IDs. The inserted
  chunk itself has no operation suffix; `-running-check`, `-delete`,
  `-delete-verify`, `-insert-verify`, `-outcome-probe`, `-v5-text-count`,
  and `-raw-text-count` are surrounding operations. Replace
  `<minute_job_id>` and run:

  ```sql
  WITH substring(
      replaceRegexpAll(
          replaceRegexpAll('<minute_job_id>', '[^A-Za-z0-9_-]', '-'),
          '-+',
          '-'
      ),
      1,
      96
  ) AS sanitized_job_id
  SELECT
      query_id,
      initial_query_id,
      query_duration_ms,
      read_rows,
      read_bytes,
      formatReadableSize(memory_usage) AS peak_memory,
      query
  FROM clusterAllReplicas('all_groups.default', system.processes)
  WHERE startsWith(query_id, concat('bf-epv5-', sanitized_job_id, '-'))
      AND query_id NOT LIKE '%-running-check'
      AND query_id NOT LIKE '%-delete'
      AND query_id NOT LIKE '%-delete-verify'
      AND query_id NOT LIKE '%-insert-verify'
      AND query_id NOT LIKE '%-outcome-probe'
      AND query_id NOT LIKE '%-v5-text-count'
      AND query_id NOT LIKE '%-raw-text-count'
      AND positionCaseInsensitive(query, 'endpoint_perf_minute_v5') > 0;
  ```
- completion logs for every planned window, with no unexplained count-query or row-count drift warning
- ClickHouse duration, rows read, peak memory, HTTP 524s, and retry attempts for the one-hour workload

Record the approval next to the Minute history `job_id`. Daily remains an
independently measured workload; do not infer its duration or memory from the
minutely evidence.

The `bf-YwhEQJ7ixOBamqn2Edtv` minute phase satisfied this gate with 720 of 720
minutely chunks completed. Its daily phase did not finish: the observed state
was 742 completed chunks, 8 failed chunks, and the queue paused.

## Current recovery state

The current production recovery state is paused with eight daily payloads
expected in KV under `backfill:dead-letter:backfill-endpoint-perf-v5-dead-letter:*`.
Those payloads are the only authoritative source for the failed windows because
the run summary does not expose the ranges. Preserve all eight payloads. Do not
purge the queue, delete dead-letter KV records, or run a broad replay.

The real `backfill-endpoint-perf-v5-dead-letter` consumer persists each payload
to KV, emits `backfill-dead-letter-payload-persisted`, and then calls durable
lifecycle failure accounting for chunk payloads. The later
`backfill-dead-letter-message` log and `tasks_failed = 8` prove the eight
failures reached durable accounting; they are not the first proof that the
payload exists, and they are not evidence that the failed windows are known
without reading the retained KV records.

Treat `backfill-dead-letter-kv-write-failed` separately from retained-payload
and lifecycle-settlement logs. A KV write failure means the current DLQ attempt
did not retain the recovery payload and the message should retry instead of
acking. Do not count that attempt as a retained failed window until a later
`backfill-dead-letter-payload-persisted` log and KV record exist for the same
queue/message.

After a recovery deploy, a human production operator must run a single-window
canary before replaying the remaining failures:

1. Keep delivery paused and retain the eight KV payloads.
2. Read and archive the exact `kv_key`, `message_id`, `job_id`, `chunk_id`,
   `query_id`, `table_type`, `batch_start`, and `batch_end` for each payload.
3. Select one daily payload as the canary. Do not select or synthesize a range
   from logs when the payload exists.
4. Replay only that one retained payload as a fresh queue message, then verify
   the single window: `terminal_completion`, `verification_result = match`, no
   unresolved `outcome_ambiguous`, and no active server-side insert for its
   query id.
5. Only after the canary passes, replay the remaining seven exact payloads one
   at a time or in the approved operator flow that preserves one-chunk queue
   concurrency.
6. Re-check durable run history; recovery is incomplete while any retained
   dead-letter payload remains unresolved.

The queue is currently paused. A human production operator may use these queue
controls only under the approved recovery change:

```bash
npx wrangler queues pause-delivery backfill-endpoint-perf-v5
```

Resume delivery only for an approved canary or replay window while actively
watching the recovery queries above:

```bash
npx wrangler queues resume-delivery backfill-endpoint-perf-v5
```

Cancel the durable run only when abandoning the remaining queued work. Do not
purge the queue or manually clear the run lock while queued chunks are still
draining.

## Completion gates

The run is complete when:

- the primary queue is empty
- no server-side `bf-epv5-` insert remains in `system.processes`
- the dead-letter queue is empty
- there are no retained dead-letter KV records for the job
- every planned chunk emitted a successful completion log
- the Minute history durable run completes all 720 planned minutely chunks with zero failed chunks
- after separate approval, the Daily history durable run completes all 30 planned daily chunks with zero failed chunks
- no HTTP 524 remains unresolved by `timeout_recovered`, a confirmed ClickHouse
  exception followed by successful retry, or an exact retained dead-letter
  payload still under active human recovery
- daily history covers the approved 30-day window
- minute history covers the approved 30-day window, subject to TTL
- workload and slice distributions agree with raw `generations` for the 30
  UTC-midnight minutely samples
- daily aggregate parity is checked after the run across the approved window
- text cohorts retain matching latency, E2E, and throughput values against raw `generations`

Queries that omit a workload-specific slice must merge every bucket for that workload. `254` remains unknown and `255` remains not applicable.

## Recovery

If a chunk dead-letters, use its retained KV payload to identify the exact table
and window. Confirm no matching `bf-epv5-` insert is still running, stop any
replay source writing old `created_at` rows into that window, then re-enqueue
only that payload. Never synthesize replacement payloads from approximate log
timestamps when the KV record exists.

For the unavoidable Worker crash window between verified delete and insert
dispatch, automatic retries must stay fail-closed. Preserve the retained
dead-letter payload if the retry budget exhausts without another delete. Human
recovery is allowed only after pausing the queue and proving from the exact
`job_id`, `chunk_id`, and `query_id` across the retained KV payload,
`system.processes`, `system.query_log`, authoritative external evidence,
Cloudflare trace evidence, or ClickHouse support that the insert was never
accepted. Re-enqueue only the exact retained payload as a fresh message, then
verify that single window before any further replay.

If proof is absent, or the only evidence is that the query is not visible in
`system.query_log`, do not clear the lock, replay the payload, purge queues,
synthesize a payload, or run a broad replay. Retain the KV payload and escalate
the case as a platform blocker.

If delete verification repeatedly fails, a late or replayed generation is repopulating the window between delete and verification. Stop the source before retrying. The handler intentionally fails rather than inserting on top of residual aggregate states.

Clear the run lock only after the queue drains or when abandoning the job. The
clear operation records a cancellation tombstone for the current job before
deleting the lock, so a racing queue renewal cannot silently revive the run:

```bash
curl --request DELETE "$CFW_INTERNAL_URL/api/v1/internal/backfill/endpoint-perf-v5/lock" \
  --header "Authorization: Bearer $ADMIN_API_KEY"
```

The cancellation tombstone lasts as long as the lock TTL. The lock otherwise
renews after each settled chunk and expires automatically.
