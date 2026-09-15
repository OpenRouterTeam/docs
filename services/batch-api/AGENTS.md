# batch-api — agent guide

Cloud Run executor for the Batch API. `README.md` is the architecture
reference (role-isolated services, route mounting, artifact layout,
GCS/Pub/Sub/Spanner wiring). Read it before changing runtime behavior.
`REVIEW.md` holds the patterns to flag when reviewing this service.

Docs that own rules this file does not restate:

- Repository `AGENTS.md` — TypeScript style, Result monads, logging, Zod
  validation of external data, colocated tests, stacked PRs.
- `packages/batch/AGENTS.md` and `packages/batch/REVIEW.md` — shared
  contracts, endpoint families, skins, provider adapters, per-line policy,
  submit-worker failure semantics.
- `infra/AGENTS.md` — Terraform, secret injection, CI plan constraints.

Skills that own the workflows:

- `.agents/skills/batch-api-development` — entrypoint for any batch feature.
  It routes to the stacked-PR, testing, and audit skills.
- `.agents/skills/debug-batch-api` — production triage.

## Ownership boundaries

- Keep shared schemas, skins, and provider lifecycle contracts in
  `packages/batch`, imported only through its subpath exports.
- Keep HTTP parsing and response serialization in `src/routes/`. Use cases
  return `ErrorT`; routes convert it into a response. The read path is the
  exception: `src/read/` builds its gated and streamed `Response`s, and the
  route returns them unchanged.
- Use the existing storage, Pub/Sub, Spanner, routing, and lifecycle
  helpers rather than parallel implementations. GCS URIs come from
  `src/storage/batch-gcs-store.ts`, Pub/Sub publishes from the publishers in
  `src/pubsub/`.
- Preserve `BATCH_SERVICE_ROLE` isolation. A production role mounts only its
  own routes plus `/healthz`, and `dev-all` stays local-only.

## Streaming and order

- Treat client batch payloads, JSONL artifacts, and provider results as too
  large to buffer. Do not read them with `.json()` or accumulate them in
  memory. Small control payloads such as Pub/Sub push envelopes and provider
  status responses are exempt.
- Bound concurrent per-line work by both chunk size and concurrency.
- Preserve input order, `custom_id` identity, and existing first-error
  behavior under concurrency.
- Cancel readers and destroy streams on failure, early return, and consumer
  cancellation.

## Replay safety

- Assume Pub/Sub delivery, sweep execution, and finalization repeat.
- Persist the batch billing mode once at accept time and never recompute it
  downstream. Accept currently hard-wires `legacy`; the LiveConfig provider
  (`getBillingMode`) is wired into accept only once the incremental producer
  ships. LiveConfig reads never block. A failed latest refresh routes new jobs
  to the compiled legacy mode until a refresh succeeds; existing jobs stay on
  their persisted mode.
- Fence provider side effects with the existing submit and finalize
  journals. Journal state fences provider creation and finalize execution,
  never billing identity.
- Derive billing identity deterministically from persisted job fields, so a
  replay reproduces byte-identical generation IDs.
- Persist the accept-time endpoint, adapter, and provider key identity, and
  reuse them for the rest of the job lifecycle.
- Convert permanent provider states into terminal job outcomes, and return
  transient infrastructure failures for retry.

## Provider, public, and billing data

- Degrade an immutable malformed provider row into a deterministic
  non-billable row error where possible, and keep processing later rows.
- Model input ingestion and result addressing independently. Do not invent
  file identifiers for providers that address results by batch ID.
- Sanitize public errors. No payloads, credentials, or internal
  identifiers. Keep the raw provider error on the internal error value;
  log only sanitized named scalar fields such as `error.message` and a
  stable code.
- Keep billing fields out of public results, and keep the billing transform
  separate from the serving transform. Billing reads the raw artifact line.

## Retention

All batch bucket objects expire 30 days after creation. If a flow needs an
artifact later, update `infra/bucket.tf` first.

## Observability

- Keep the original error cause on the error value, and attach structured
  stage, artifact, provider, and job context as named scalar fields. Log
  `error.message` and a stable code, never a raw error or provider object.
- Metric tags stay low-cardinality. No entity, batch, request, or
  generation IDs.
- Logging and metric failures must never interrupt submission,
  finalization, or billing.

## Verification

Run from the repository root:

```bash
bun test packages/batch services/batch-api services/cfw-batch-api
```

For behavior changes, follow `.agents/skills/batch-api-testing` for E2E
selection, fixtures, and streaming and lifecycle coverage.
