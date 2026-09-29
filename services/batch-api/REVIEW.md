# batch-api — review patterns

Flag these in review. `packages/batch/REVIEW.md` covers shared contracts,
per-line policy, and submit-worker failure semantics.

## Billing identity and double billing

Batch billing is idempotent only because a replayed finalize republishes
byte-identical generation IDs and the downstream pipeline dedupes on a
unique generation-ID index. Every rule below protects that chain.

- Flag any billing field derived from wall-clock time, a random value, a
  per-run execution ID, or a retry counter. Generation identity must come
  from persisted job fields only.
- Flag any write that mutates a persisted job field that billing identity is
  derived from. Those fields are write-once at accept.
- Flag divergence between the Spanner billing publish and the ClickHouse
  publish. Both sinks carry the same generation ID for the same line, and a
  change to one without the other splits billing from reporting.
- Flag billing idempotency that depends on journal state, Pub/Sub state, or
  any artifact. Journals and artifacts are deleted on the bucket retention
  schedule, so a late replay finds them gone.
- Flag checkpointing or resume-from-offset of generation emission. A failed
  emission is re-run whole; per-line billing progress would become a second
  source of truth.
- Flag a stale finalize fence that leads to re-emission under new identity.
  Losing the lease mid-emission means rows are already published.

## Finalization that never completes

- Flag a failure path that leaves a job non-terminal with no route back to
  finalization. Provider results and our artifacts expire, so work that is
  never finalized is never billed.
- Flag retry behavior changes without tests for redelivery, partial
  completion, and ambiguous provider outcomes.
- Flag a terminal status published before the artifact a reader needs is
  durable.

## Observability that has to hold up

- Flag skip and abort paths that return without a distinguishable reason on
  the metric or log line.
- Flag a raw error, provider object, or request body reaching a log line.
  Named scalar fields plus `error.message` and a stable code.
- Flag entity, batch, request, or generation IDs used as metric tags.

## Streaming

- Flag `.json()` or full-body accumulation on a client payload, a JSONL
  artifact, or a provider result. Control envelopes and status responses are
  fine.
- Flag an unconsumed stream that is not cancelled on failure, early return,
  or consumer cancellation.
- Flag per-line concurrency that is not bounded by both chunk size and
  concurrency.
- Flag reordering of results or any change that breaks `custom_id` identity.

## Boundaries

- Flag shared schema, skin, or provider lifecycle logic added here instead
  of `packages/batch`, and deep imports past its subpath exports.
- Flag HTTP status or response shaping outside `src/routes/`, except the
  established read-path helpers in `src/read/`, which construct the gated
  and streamed responses by design.
- Flag a route mounted for a production role beyond its own routes and
  `/healthz`.
- Flag a parallel storage, Pub/Sub, or routing helper alongside an existing
  one.
- Flag an unvalidated provider response or persisted metadata shape.
- Flag a public error carrying payloads, credentials, or internal
  identifiers, and billing fields reaching a public result.
