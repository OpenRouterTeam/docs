# Batch — Review Guidelines

Patterns to flag when reviewing changes in `packages/batch`:

- **Per-line policy lives behind the skin contract.** Line-level
  validation must go through the skin's `validateLinePolicy`, not
  ad-hoc checks in `services/batch-api` or the edge worker. Skins in
  the completions endpoint family should reuse the shared policy in
  `skins/completions-line-policy.ts` rather than duplicating it.
- **New endpoints need a family.** A new batch skin must register its
  endpoint in `schemas/batch-endpoint-family.ts`; flag skins that
  branch on raw endpoint strings instead of the family helpers.
- **Result serving follows the family capability, not a blanket
  re-render.** Completions-family skins re-render stored output through
  the internal event stream via `fromInternalResponse` (chat has three
  client shapes over one upstream wire). Verbatim families
  (`rendersViaInternalStream: false` in
  `schemas/batch-family-capabilities.ts` — embeddings today) have no
  event-stream representation; the adapter's `parseResult` must still
  validate stored bodies against the endpoint's own response schema
  before they are served as stored. Flag verbatim adapters whose
  `parseResult` skips that validation, and completions skins that bypass
  the re-render.
- **Provider adapters extend `BaseBatchAdapter`.** The base owns the
  provider-agnostic lifecycle (GCS persistence, `file` vs `inline`
  ingest-mode guards, upstream status validation); flag adapters that
  reimplement lifecycle steps instead of overriding only the abstract
  provider seams (`transformBatchRequest`, `submitNativeBatch`,
  `pollBatch`, `fetchNativeResults`).
- **Lowering goes through sync serializers.** `fromInternalRequest`
  must lower via the sync path's production serializer for the
  modality so batch and sync produce identical upstream bodies; flag
  hand-rolled provider payload construction.
- **Reject, don't coerce.** `toInternalRequest` must reject sync-only
  OpenRouter extensions (fast-mode service tiers, over-limit
  `max_output_tokens`) with targeted error messages; flag silent
  coercion of batch input lines.

## Async submit split

- **The accept path stays cheap.** `POST /batches`
  (`services/batch-api/src/submit/accept/submit-batch.ts`) runs only
  O(1)-per-line gates (envelope, model resolution, count cap,
  `custom_id`, affordability, admission) while streaming `raw_input` to
  GCS. Flag anything added to the accept path that does per-line network
  I/O (moderation, provider calls) or full-payload buffering — that work
  belongs in the async worker (`execute-submit-job.ts`).
- **Worker failure semantics are side-effect-aware.** Before the provider-create
  call, permanent 4xx failures fail the job and transient failures nack. After
  the create call starts, the journal must never return to a POST-eligible
  state or let a redelivery call the provider again. The only retry allowed is
  one immediate, in-worker retry for a platform-funded job estimated at $1 or
  less when the first outcome is ambiguous; OpenRouter accepts the possible
  duplicate cost. BYOK, more expensive jobs, and any remaining ambiguity fail
  terminally with a user-readable internal-error message. Target resolution,
  scan, and file upload use the pre-submit policy; provider creation uses this
  post-side-effect policy.
- **Redelivery must stay idempotent.** The worker skips rows that are
  terminal or already carry a `provider_job_id`, and its generation-CAS submit
  journal fences the provider call before the irreversible side effect. Flag
  worker changes that bypass the journal, reclaim `submitting` automatically,
  or produce a second upstream submit on redelivery. The bounded in-worker
  ambiguity retry above does not reopen the journal or permit another delivery
  to submit.

## Native tool passthrough and BYOK resolution

- **Native web-search passthrough stays at the batch skin boundary.** Provider
  tool support should be restored from the batch request through the provider
  serializer and response parser; do not make the orchestration service
  reinterpret provider-native search events.
- **Synthesized BYOK endpoints are resolution data, not a new provider family.**
  Keep endpoint synthesis in batch resolution and preserve the normal adapter
  and pricing contracts rather than adding batch-only provider behavior.
