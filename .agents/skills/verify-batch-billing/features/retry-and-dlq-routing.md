# Retry and DLQ routing

TestPipeline proof that transient failures (attempts 1–2) republish with only `attempt_number` incremented, and permanent failures dead-letter.

## Sub-features

1. **Transient retry**: On `Aborted`, `RuntimeError`, or other transient exceptions, the message is republished to the billing topic with `attempt_number += 1`. Attempts 1–2 always republish.
2. **Permanent DLQ**: On `BadRequest`, `InvalidArgument`, `FailedPrecondition`, `OutOfRange`, or any `BatchBillingPermanentError` code, the message is sent to the dead-letter topic with context (job_id, error_code, attempt_number).
3. **Attempt-3 exhaustion**: On attempt 3, any failure (transient or permanent) dead-letters without retry.
4. **Republish payload preservation**: Republished messages are decoded from original JSON, mutated (`attempt_number += 1`), and re-serialized. Unknown fields survive round-trip.
5. **Reconcile passthrough**: Reconcile messages increment a metric and produce no output.

## How to get to it (user POV)

The operator monitors the DLQ topic for dead-lettered messages. High DLQ rates indicate permanent failures (configuration issues, bad data) or infrastructure problems (timeouts). The test suite verifies that messages are correctly routed and can be analyzed post-mortem.

## Driving it with the harness

```bash
cd services/usage-record/dataflow
uv run pytest tests/test_batch_billing_stream.py tests/test_batch_billing_failure.py tests/test_batch_billing_chunk_writer.py -v
```

This is SKILL.md Drive step 4: the `TestPipeline` routing tests over an injected writer, the failure-classification matrix, and the mock-transaction writer tests whose permanent error codes feed that matrix. The key assertions below span all three files.

### Expected output

- Exit code: 0
- Every test passes; do not pin the count
- Key test names appear in output

### Key test assertions

1. **`test_two_chunks_commit_as_two_transactions_with_their_own_rows`** - Publishes two distinct chunk messages - Asserts: writer is called twice, each with distinct `(job_id, generation_ids)` - Proves: messages are not merged or split across transactions

2. **`test_transient_failure_republishes_with_only_attempt_number_incremented`** - Chunk writer raises `Aborted` - Asserts: - Exactly one `republish` record output - Decoded JSON of republish differs from input only in `attempt_number` (incremented by 1) - No `dead_letter` record

3. **`test_aborted_until_deadline_republishes_once_without_counting_internal_retries`** - Chunk writer raises `Aborted` multiple times until deadline - Asserts: - One `republish` record (deadline exceeded after internal retries) - No proliferation of republish records for each internal retry

4. **`test_permanent_failure_dead_letters_on_every_attempt`** - Parametrized test over all attempt numbers and all permanent error codes - Example: attempt 1 with `BadRequest` → one `dead_letter` record - Asserts: - Zero `republish` records - Dead-letter record contains correct `error_code`, `attempt_number`, `job_id` - Batch-billing context (job_id, billable_entity_id, message_type) in record

5. **`test_permanent_failure_on_attempt_three_dead_letters_as_exhausted`** - Chunk writer raises `RuntimeError` (transient) on attempt 3 - Asserts: - Message is dead-lettered despite transient error - `retry_classification = "exhausted"` in record (not "transient")

6. **`test_permanent_failure_dead_letters_on_every_attempt`** (stream integration) - Same as failure classification test, but runs through `batch_billing_stream.py` - Asserts: output records match expected DLQ shape

7. **`test_transient_failure_on_attempt_three_dead_letters_as_exhausted`** - On attempt 3, any error (transient or permanent) is treated as exhausted - Dead-letter record reflects this

8. **`test_undecodable_bytes_dead_letter_at_decode_with_null_message`** - Malformed JSON in Pub/Sub message - Asserts: - One `dead_letter` record - `message` field is `null` (could not decode) - `raw_message_base64` contains the original bytes - `pipeline_stage = "decode"`

9. **`test_reconcile_is_acknowledged_without_spanner_or_output`** - Reconcile message (different `message_type`) - Asserts: - Zero Spanner calls (no transaction) - Zero output records (no republish, no DLQ) - Metric `batch_billing.reconcile.received` incremented

## Gotchas

- **TestPipeline isolation**: Each test runs in a separate `TestPipeline` instance. State does not leak between tests.

- **Error injection**: Tests inject errors via mock writer and exception handling. Real Spanner errors (e.g., `Aborted` during transaction) are simulated.

- **Attempt numbering**: `attempt_number` starts at 1 in the original message. First republish has `attempt_number=2`, second has `attempt_number=3`. On attempt 3, no further republish occurs.

- **Payload encoding**: Republished messages are JSON strings. If the decoder adds fields or changes the schema, republish will fail. The test catches this by re-decoding the republish payload and comparing to the original.

- **Reconcile message shape**: Reconcile messages have a different `message_type` and are handled in a separate branch before the writer is invoked. Ensure the message_type is exactly `"billing_reconcile"` or the test will route it as a chunk.
