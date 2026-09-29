# Job completion (ECO-3189)

**Status**: Built (ECO-3189)

`try_complete_batch_job` in `batch_completion.py` no longer always returns `NOT_READY`. It evaluates one completion predicate over the existing receipt columns and, when it holds, performs final settlement inside the caller's transaction: release the remaining estimated hold, mark `pending_charges.settled = true` with `settled_at`, and set `async_jobs.status = 'completed'`.

Two triggers call the same helper:

1. The billing chunk that carries the last unseen generation (`batch_billing_chunk_writer.py`), after counters and the incremental release are applied.
2. The `reconcile` message, in its own one-job transaction (`batch_billing_reconcile_writer.py`).

## Sub-features

1. **Final chunk closes**: the chunk that brings `settled_generation_count` to `expected_settlement_generation_count` returns `COMPLETED` and closes the job in the same commit.
2. **Reconcile is a no-op after the close**: it returns `ALREADY_COMPLETED` and mutates nothing.
3. **Reconcile before the close**: returns `NOT_READY`, with no financial or status write, and does not stop the later chunk from closing.
4. **Zero-generation job**: expected and settled counts of zero close on reconcile alone.
5. **Final release bounds**: an under-run releases exactly `estimated_cost - released_estimated_cost`; an over-run releases nothing beyond the estimate and keeps full usage.
6. **Idempotence**: a redelivered final chunk or reconcile after the close changes nothing.
7. **Impossible state**: a settled count above expected, or a missing `result.batch_results_gcs_uri`, returns `INVARIANT_VIOLATION` without closing the job or releasing money.
8. **Atomicity**: a failure inside final settlement rolls back the release, the settle flag, and the status together.
9. **Legacy terminal status (Case A)**: a terminal legacy `async_jobs` write is skipped for a receipted job (`async_job.legacy_settle_skipped_receipt_job`), so the billing lane still owns the close.

## How to get to it (user POV)

A receipted batch job stays `in_progress` while its chunks settle, and flips to `completed` with `pending_charges.settled = true` once the last chunk lands. An operator sees a stuck job as `in_progress` with `settled_generation_count < expected_settlement_generation_count`, and money still held.

## Driving it with the harness

```bash
cd services/usage-record/dataflow
OR_ENV=development SPANNER_EMULATOR_HOST=localhost:9010 PUBSUB_EMULATOR_HOST=localhost:8086 uv run pytest tests/integration/test_batch_completion_integration.py -v
```

This is SKILL.md Drive step 7. The focused unit half is `uv run pytest tests/test_batch_completion.py tests/test_batch_billing_chunk_writer.py -q` with no emulator env.

### Expected output

- Exit code: 0
- Every test in `test_batch_completion_integration.py` passes

### Key test assertions in output

One named test per acceptance criterion; the AC number is in the test name.

1. **`test_ac1_final_chunk_closes_the_job_and_releases_the_remaining_hold`** - the last chunk returns `completion_outcome=COMPLETED`, `async_jobs.status = 'completed'`, `pending_charges.settled = true` with a non-NULL `settled_at`, `released_estimated_cost = estimated_cost`.
2. **`test_ac2_reconcile_after_the_final_chunk_is_already_completed_and_changes_nothing`** - reconcile returns `ALREADY_COMPLETED` and the before/after snapshots are identical.
3. **`test_ac3_reconcile_before_the_final_chunk_is_a_not_ready_noop`** and **`test_ac3_the_final_chunk_still_closes_after_an_early_reconcile`** - `NOT_READY` writes nothing and does not block the later close.
4. **`test_ac4_a_zero_generation_job_closes_on_reconcile_alone`** - expected count 0 closes with the whole hold released.
5. **`test_ac5_an_under_run_releases_only_the_remaining_estimate`** and **`test_ac5_an_over_run_releases_nothing_beyond_the_estimate_and_keeps_usage`**.
6. **`test_ac6_a_redelivered_final_chunk_after_the_close_is_a_noop`** and **`test_ac6_a_redelivered_reconcile_after_the_close_is_a_noop`**.
7. **`test_ac7_a_settled_count_above_expected_is_an_invariant_violation`**, **`test_ac7_a_missing_results_uri_is_an_invariant_violation`**, **`test_ac7_an_incomplete_receipt_closes_nothing_and_releases_nothing`**.
8. **`test_ac8_a_failure_inside_final_settlement_rolls_back_every_mutation`** - an invalid statement appended to the settlement batch leaves the snapshot unchanged.
9. **`test_ac9_a_legacy_terminal_status_does_not_close_a_receipted_job`** - the job stays `in_progress` after the legacy write, and the final chunk then closes it.

## Gotchas

- **Reconcile owns the close only when the chunks did not**: a chunk that reaches the expected count closes the job itself, so a test that wants reconcile to perform the final settlement must seed a receipt whose chunks leave the close undone (expected count 0 is the simplest).
- **Monkeypatching the statement builder**: capture `batch_completion.build_settled_budget_statements` before patching it. Calling it through the module inside the replacement recurses into the patch.
- **Emulator-only unit failures**: `tests/` (non-integration) must run without `OR_ENV=development`. Under that env `LOCK_HINT` is empty (the emulator lacks `LOCK_SCANNED_RANGES`), so lock-hint and pipeline-graph unit tests fail for environment reasons, not code reasons.
- **Pre-existing integration expectations**: `test_batch_billing_integration.py` now seeds one more expected generation than its chunks carry, so the ECO-3188 scenarios stay in the incremental phase instead of closing mid-assertion.
- **A legacy generation row can still claim a receipted job's generation id**: the consumer takes no shared `pending_charges` read on the generation hot path, so a legacy row for a receipted job inserts normally and the lane's own row for that id dedupes to a no-op, leaving the count short of expected. Keeping a receipted job off the legacy generations stream belongs to the producer (sticky billing mode).
