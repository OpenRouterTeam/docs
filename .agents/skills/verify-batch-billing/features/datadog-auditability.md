# Datadog auditability (ECO-3193)

**Status**: Stub (planned expansion, not in v1)

Metrics emitted by `batch_billing_stream.py` are queryable on the Datadog dashboard with correct tag cardinality and event rates. Metric names are defined at module level in `batch_billing_stream.py` (exported through the `init_telemetry()` helper in `telemetry.py`) and are the source of truth.

## Expected metrics (from batch_billing_stream.py)

- `batch_billing.messages.received` (attr: `message_type`)
- `batch_billing.messages.malformed`
- `batch_billing.chunks.committed`
- `batch_billing.chunks.noop`
- `batch_billing.rows.inserted`
- `batch_billing.rows.duplicate`
- `batch_billing.republished` (attr: `attempt_number`)
- `batch_billing.dead_lettered` (attrs: `retry_classification`, `error_code`, `pipeline_stage`)
- `batch_billing.reconcile.received`
- `batch_billing.settlement_lag_seconds` (histogram)

Note: No `job_id`, `generation_id`, or `billable_entity_id` attributes on any metric (high cardinality risk).

## Expected evidence (to be added when ECO-3193 lands)

- Dashboard tile showing `batch_billing.chunks.committed` and `batch_billing.dead_lettered`
- Sample Datadog query: `batch_billing.chunks.committed{pipeline:batch_billing}`
- Query shows attribute cardinality as expected (e.g., `message_type` has 2 values: `"billing_chunk"`, `"billing_reconcile"`)
- Settlement lag histogram shows reasonable distribution

## How to verify (draft)

1. Deploy consumer to staging
2. Send a batch and monitor settlement
3. In Datadog, query each metric and verify attributes match expectations

## Known unknowns

- What is the expected p99 for settlement lag?
