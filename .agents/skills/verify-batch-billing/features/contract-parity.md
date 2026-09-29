# Contract parity

Fixture-driven assertion that both TypeScript and Python decoders handle the same shared fixtures identically with matching accept/reject counts.

## Sub-features

1. TypeScript decoder (`types/batch-billing-chunks.ts`): Zod schema validates message structure, rejects malformed JSON, invalid enum members, and missing required fields. Acceptance is deterministic.
2. Python decoder (`dataflow/src/openrouter_monorepo/usage_record/batch_billing_chunk.py`): Pydantic models mirror the TS schema. Python custom validators reject the same cases as Zod.
3. Fixture sharing (`types/fixtures/batch-billing-chunks/`): the fixture objects in that directory are consumed by both `types/batch-billing-chunks.test.ts` and `dataflow/tests/test_batch_billing_chunk.py`; the count grows with every case added, so the parity line, not a number, is the pin.

## How to get to it (user POV)

The operator does not directly interact with this. It is verified as part of the CI build and the verification skill.

For development: a mismatch between the two decoders means a message accepted by one but rejected by the other could pass through the Pub/Sub pipeline and fail at runtime. The test suite catches this before merge.

## Driving it with the harness

Run both language implementations:

```bash
# TypeScript
cd services/usage-record
bun test ./types/batch-billing-chunks.test.ts

# Python (test_json_patch.py covers the JSON patches the derived fixtures are built from)
cd services/usage-record/dataflow
uv run pytest tests/test_batch_billing_chunk.py tests/test_json_patch.py -v
```

### Expected output

**TypeScript:**
- Exit code: 0
- Test output contains: `batch-billing-chunks fixtures: accepted=<N> rejected=<N> total=<N>`
- All tests pass

**Python:**
- Exit code: 0
- Test output contains: `batch-billing-chunks fixtures: accepted=<N> rejected=<N> total=<N>`
- Same fixture counts as TS

### What passes

Both must:
1. Accept all valid fixtures without error.
2. Reject all invalid fixtures with the same `error_code` (e.g., both reject a fixture with `attempt_number=4` as `too_many_attempts`).
3. Print identical fixture category counts to stdout.

## Gotchas

- **Fixture format**: Fixtures are JSON objects in `types/fixtures/batch-billing-chunks/`. The loader expects a flat directory; nested subdirectories are not traversed.
- **Python datetime grammar**: Timestamps are ISO 8601 with timezone offset (e.g., `2026-09-01T12:00:00.000Z`). Python uses `datetime.fromisoformat()` which requires the `Z` to be explicit in tests (the pydantic model uses a custom validator to normalize it).
- **Rejection category names**: A fixture's rejection category is keyed by the issue it raises (e.g., `"too_many_attempts"` for attempt overflow). Both decoders map the same input to the same category name. If category names diverge, the test assertion `expected_issue == actual_issue` fails.
- **Shared fixture mutations**: The fixture directory is read-only during tests. Do not modify fixtures mid-test; they are cached in memory and reused.
