# Lane-extraction parity

SQL snapshot test and end-to-end emulator tests validate that the refactored `select_unseen_generations` and `insert_unseen_generations` helpers generate identical Spanner SQL to the pre-refactor `write_generation_batch` procedure and that lane behavior is preserved.

## Sub-features

1. **SQL text equivalence**: Every `execute_sql`, `execute_update`, and `batch_update` call in the refactored path produces identical SQL text to the pre-refactor path.
2. **Execution order**: Statements are executed in the same order.
3. **Parameter binding**: Bound parameters are identical (same values, same types).

## How to get to it (user POV)

The operator does not directly interact with this. The refactor extracted helpers for reuse by the batch billing lane. The snapshot test ensures the extraction is mechanical—SQL semantics are unchanged, so existing lanes (async-job settlement, generation commits) continue to work identically.

## Driving it with the harness

```bash
cd services/usage-record/dataflow
uv run pytest tests/test_generation_writer_sql_snapshot.py -v
```

This records all Spanner operations during `write_generation_batch` and compares to the baseline snapshot.

### Expected output

- Exit code: 0
- Contains: `PASSED` (snapshot matches baseline)
- Snapshot file: `tests/snapshots/write-generation-batch-sql.json`

### What passes

The snapshot file records every SQL operation in order. A new snapshot is created on first run; subsequent runs compare to the stored baseline. If the refactor introduces a new statement or reorders them, the diff is shown:

```
AssertionError: Snapshot mismatch:
Expected:
  ...
Actual:
  ...
```

A mismatch means the refactored extraction changed the SQL semantics. This test catches it before merge.

## Gotchas

- `spanner_util.LOCK_HINT` is empty under `OR_ENV=development` because the emulator lacks `LOCK_SCANNED_RANGES`. The SQL snapshot pins the production hint by monkeypatching `LOCK_HINT` in `generation_writer`, `budget_usage` and `async_job_charge_handler`; a lock-hint-only diff means that pin was lost, not that the lane SQL changed.
- Three pre-existing schema-alignment tests in `test_generation_integration.py` and `test_async_job_integration.py` need generated inputs: `cd services/usage-record && bunx tsx scripts/export-emitted-generation-schema.ts && bunx tsx scripts/export-emitted-async-job-schema.ts`. Without them they fail on a missing `.emitted-*-schema.json`, which is not a lane regression.

- **Snapshot file location**: The snapshot is stored at `tests/snapshots/write-generation-batch-sql.json` (kebab-case, required by `.ls-lint.yml`). If you move the test file, update the snapshot path reference.

- **First-run update**: On first run, the snapshot is created. Subsequent runs compare to it. To reset the snapshot (e.g., after an intentional refactor): `rm tests/snapshots/write-generation-batch-sql.json` and re-run.

- **Baseline freshness**: The baseline snapshot was captured on `origin/main` (commit `1c597c6d2a8`) before the refactor. A PR that changes `write_generation_batch` will show a mismatch. This test catches unintended changes.

- **Multi-lane impact**: `write_generation_batch` is called by: - `test_generation_lane.py`: tests the generation-commit lane - `test_generation_inserter.py`: tests the insert helper - `test_batch_generation_divert.py`: tests the divert logic All of these continue to pass without modification (proof that the extraction preserved semantics).
