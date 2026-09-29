# Settlement transaction

Emulator proof that each Pub/Sub message is a single atomic Spanner transaction, deduped by `generation_id`, with capped hold release and deterministic result.

## Sub-features

1. **Atomicity**: 100-row chunk commit inserts all 100 generations at once or not at all. Rollback on error leaves zero rows inserted.
2. **Dedupe**: Delivering the same chunk twice inserts rows only once. Second delivery is a `noop` with 0 rows inserted.
3. **Concurrency**: Two threads delivering the same chunk concurrently serialize on the charge-row lock; exactly one commits, the other is a `noop`.
4. **Hold release cap**: Released estimated cost is `min(requested, remaining_estimate)`. Usage is recorded in full regardless of cap.
5. **Charge settlement**: After settlement, `pending_charges.settled = false` (job is not closed; that is ECO-3189). Budget rows reflect the correct `async_jobs_settled_usage_total`.
6. **Fault injection**: Injecting a fault mid-transaction (e.g., exception before charge update) rolls back. Retry without fault commits once.

## How to get to it (user POV)

The operator verifies this by monitoring Spanner metrics: if `settled_generation_count` does not match the production chunk count, or if budget totals diverge from usage, the settlement invariant is broken. The emulator test exercises all codepaths.

## Driving it with the harness

```bash
cd services/usage-record/dataflow
OR_ENV=development SPANNER_EMULATOR_HOST=localhost:9010 PUBSUB_EMULATOR_HOST=localhost:8086 uv run pytest tests/integration/test_batch_billing_integration.py -v
```

This is SKILL.md Drive step 3: the single file against the local emulator. `bun run dataflow:test:integration` runs the whole `tests/integration/` directory and its exit code would mix unrelated suites into this feature's evidence.

### Expected output

- Exit code: 0
- Every test in `test_batch_billing_integration.py` passes

### Key test assertions in output

Run the tests and look for these test names (pytest will print them):

1. **`test_100_row_chunk_commits_all_accounting_atomically`** - Seeds receipt state for a 100-row chunk from a real batch job - Commits the chunk via the writer - Asserts: - `settled_generation_count = 100` - `released_estimated_cost = Decimal("4")` (on the four charge budget rows) - `async_jobs_settled_usage_total = Decimal("4")` on all four budget rows - `async_jobs.status = 'in_progress'` (not completed) - `pending_charges.settled = false`

2. **`test_out_of_order_and_duplicate_delivery_settles_each_row_once`** - Delivers a 3-row chunk in order B, A, A, B (two duplicates, one out of order) - Each delivery commits or returns `noop` - Asserts: - Only the first A and first B commit (settled_generation_count = 2) - The second A and second B are noop (settled_generation_count unchanged) - Final generation rows equal ordered A, B (no corruption)

3. **`test_concurrent_delivery_of_same_chunk_settles_once`** - Uses `ThreadPoolExecutor` to run two threads delivering the same chunk - Both hit the charge-row `LOCK_HINT`, serializing execution - Asserts: - Only one commits (settled_generation_count = rows in chunk) - The other is a `noop` - No duplicate-key error

4. **`test_usage_exceeding_estimate_caps_release_and_keeps_usage`** - Chunk requests release of 6, then 5 against estimate 10 - First chunk: release 6 against 10 → `released_estimated_cost = 6` - Second chunk: release 5 against 4 remaining → capped release 4 → `released_estimated_cost = 10` total - Third chunk with new rows: release amount is 0 (cap exhausted) - Asserts: - `released_estimated_cost = Decimal("10")` (capped) - Budget `async_jobs_settled_usage_total = Decimal("11")` (full usage despite cap)

5. **`test_fault_before_charge_update_rolls_back_and_retry_commits_once`** - Injects fault via `stage_hook` before charge-counter update - Transaction rolls back, all rows unchanged - Retry without fault commits in full - Asserts: - Before/after snapshots of Spanner tables are identical after rollback - Retry commits all rows exactly once

## Gotchas

- **Lock hints under emulator**: `LOCK_HINT` is empty under `OR_ENV=development` because the Spanner emulator lacks `LOCK_SCANNED_RANGES`. The concurrency test therefore exercises abort-and-retry rather than the exclusive-lock path. On production (with `LOCK_SCANNED_RANGES`), the lock is acquired.

- **Emulator timeout**: The integration test takes ~27 seconds. If it times out, check: - Spanner emulator is answering on port 9010 (`nc -z localhost 9010`) - Migrations were applied (`./node_modules/.bin/tsx scripts/dev-migrate.ts`) - Emulator has not been restarted recently (stale connections)

- **Committed rows persist**: The emulator retains data between test runs. Each test re-seeds the receipt state it needs, but if a test is interrupted, rows may remain. The next run will see them as duplicates (which is correct behavior). To reset: `docker compose down` and restart the emulator.

- **Estimate format**: Estimates are `Decimal` in Spanner. The tests use Python's `decimal.Decimal` for assertions. Precision issues arise if a value has more than 9 fractional digits (truncated at Spanner boundary). Test fixtures use realistic 2–4 digit fractions.

- **Timezone**: All timestamps are UTC. If the test runs in a different timezone, the Spanner emulator still interprets them as UTC (correct). Do not use local time in test fixtures.
