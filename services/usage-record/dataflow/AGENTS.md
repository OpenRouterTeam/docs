# Dataflow agent guidelines

## A new message field needs the consumer deployed before the producer merges

The generation and async-job models set `extra="allow"`, and
`get_columns_for_insert` derives the Spanner column list from the dumped
model minus that model's exclusion set. A field a producer adds to a
Pub/Sub message therefore becomes an insert column on the running job
unless that job's code excludes it, and Spanner rejects the whole batch to
the DLQ with `Column not found in table <table>: <field>`. The running
Dataflow job is a separate deploy from the producer service, so both
changes sitting on main does not make the lane safe.

When a generation or async-job message contract gains a field that is not a
column:

1. Add it to the consuming model with a default, so the lane still accepts
   messages from the undeployed producer. Pydantic treats a nullable field
   as required unless it is also defaulted, so write
   `field: T | None = None`, not `field: T | None`. Add it to that model's
   insert exclusion set, `_EXCLUDED_INSERT_COLUMNS` for generations or
   `_EXCLUDED_INSERT_FIELDS` for async jobs, in the same change. Make the
   field required only in a later release, once no old message can arrive.
2. Deploy the consumer lane and wait for the replaced job to reach a
   terminal state before the producer change merges. A deploy starts a
   parallel replacement, so both jobs consume for the overlap and the old
   one still dead-letters anything carrying the new field. State in the
   producer PR which pipeline was deployed, at which SHA, and that the
   previous job is done. A field that is a real column needs its Spanner
   migration applied first instead.
3. Confirm the lane's DLQ rate is zero before replaying, or the replay
   dead-letters again.

## Spanner mutation limit bounds batch sizes

Spanner enforces the [80,000-mutation limit differently for DML and the Mutation API](https://docs.cloud.google.com/spanner/docs/dml-versus-mutations). DML has a separate limit per statement, which resets after execution. Mutation API writes share a cumulative limit per commit across all affected tables. Both include index mutations. More rows, written columns, or affected indexes can increase the cost, and `NULL_FILTERED` index cost depends on the data.

`write_generation_batch` mixes both APIs. The `generations` insert and the `async_jobs` insert for jobs without an existing row (in `process_async_job_batch`) use `transaction.insert`, the Mutation API, and share one commit budget. The `billable_entities`, `generation_shards`, async-job settlement, and budget writes are DML statements, each checked against its own limit. Those DML writes scale with the distinct billable entities and async jobs in the batch and with every budget row key that `generate_budget_usage_rows` in `budget_usage.py` emits (workspaces, creators, API keys, credit pools, and their combinations), not with row count, so a worst case is a batch that is both large and high-cardinality.

Google's [best practice is to avoid mixing DML and mutations in one transaction](https://docs.cloud.google.com/spanner/docs/dml-versus-mutations#best_practice_-_avoid_mixing_dml_and_mutation_in_the_same_transaction). DML executes before buffered mutations, and reads within the transaction cannot see those buffered writes. Prefer one API for new transactions. The existing mixed path needs that execution order preserved when changed.

When changing batch size, written columns, indexes, or other writes in the transaction:

1. Measure the Mutation API cost on its own: commit only the buffered inserts (`generations` plus an `async_jobs` row for every job) for a worst-case batch against staging Spanner with opt-in [commit statistics](https://cloud.google.com/spanner/docs/commit-statistics#python) enabled. That commit's `mutation_count` is the number to compare with 80,000. Commit statistics report one cumulative `mutation_count` per transaction, DML included, so a mixed transaction's count cannot be split by API after the fact.
2. Measure each changed DML statement the same way, alone in its own transaction, and compare its `mutation_count` with the per-statement limit.
3. Run the full mixed transaction at the maximum batch size and cardinality against staging to confirm it commits. Record the per-API counts and remaining headroom in the PR, and reduce the batch size if needed. Keep commit-stat logging disabled in production.
4. Update the estimate in `test_max_batch_size_keeps_the_widest_batch_under_spanners_mutation_limit` in `tests/test_generation_lane.py` and run the test. Its hard-coded estimate does not detect schema growth automatically, and passing it does not prove the transaction fits.

A rejected batch goes to the DLQ. The existing [batch generations DLQ monitor](../../../configs/terraform-monitors/monitoring/batch_generations_lane_dlq_failures.tf) catches these failures, not approaching-limit conditions. Fix the batch size or write shape before replaying mutation-limit failures.

## Point lookups by ID filter on the hash column too

`generations_by_id`, `async_jobs_by_job_id` and `pending_charges_by_job_id` are keyed `(<id>_hash, <id>)`, where the hash is a non-stored generated column `SUBSTR(SHA256(<id>), 1, 4)` (`../spanner/migrations/000001.sql`, `000004.sql`, `000006.sql`). A predicate on the ID alone does not seek the index; it scans it. Every by-id-index lookup, in code and in ad-hoc or documented SQL, pairs the ID with its hash (a write scoped by the full primary key does not need it): `WHERE generation_id_hash = SUBSTR(SHA256(@generation_id), 1, 4) AND generation_id = @generation_id`, or the `IN (SELECT STRUCT<...>(id, SUBSTR(SHA256(id), 1, 4)) FROM UNNEST(@ids))` form `generation_writer.py` and `async_job_charge_handler.py` use for lists.
