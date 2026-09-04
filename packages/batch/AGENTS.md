# packages/batch — agent guidance

See `README.md` for the three-layer architecture (edge ingress → this
package's contracts → the Cloud Run executor). This file covers the
conventions for extending the batch surface.

## Adding a new batch endpoint family (new modality)

The batch pipeline is organized around **endpoint families**
(`schemas/batch-endpoint-family.ts`): groups of endpoints sharing
per-line policy, usage estimation, and result rendering. `completions`
(chat/responses/messages) re-renders results through the internal event
stream; `embeddings` serves provider output verbatim. Future modalities
(video, TTS, STT, images) almost certainly follow the verbatim mold.

Adding `/v1/<modality>` is a compile-forced fan-out — add the endpoint to
`BATCH_SUPPORTED_ENDPOINTS` and the compiler demands each registry below.
Follow the sync path's conventions at every step: batch reuses sync schemas,
serializers, and predicates rather than parallel-implementing them.

1. **Endpoint tuple** — `schemas/batch-input-line.ts`
   (`BATCH_SUPPORTED_ENDPOINTS`).
2. **Family** — `schemas/batch-endpoint-family.ts`
   (`BatchEndpointFamily` + `BATCH_ENDPOINT_FAMILY`).
3. **Capabilities row** — `schemas/batch-family-capabilities.ts`:
   - `requiredOutputModality`: the `OutputModality` the family's models must
     carry (the submit guard enforces it both ways; completions admits
     exactly `isChattableModel`, the sync chat router's predicate).
   - `runsCompletionPreflights`: `false` unless the family's internal shape
     is the chat shape (the preflight plugins mutate messages/tools).
   - `rendersViaInternalStream`: `false` for verbatim families.
4. **Result body schema** — `schemas/batch-request.ts`
   (`BATCH_RESULT_RESPONSE_BODY_SCHEMAS`): the endpoint's *sync response
   schema* (import it from the sync package; never redefine the shape).
5. **Skin** — `skins/<modality>/index.ts` implementing `BatchSkinContract`:
   - `toInternalRequest`: validate against the provider-native request shape
     with `.strict()`. Reject sync-only OpenRouter extensions with
     *targeted* messages (say why + point at the sync API) — never silently
     coerce; a coerced batch line is wrong data discovered a day later.
   - Verbatim families compose `skins/verbatim-result.ts`:
     `buildVerbatimParseResult()`, `buildVerbatimParseUsage(schema, extract)`
     (map native usage into the shared billing shape; non-completion
     families set `completion_tokens: 0`), and `neverReRendered` for
     `fromInternalResponse`.
   - `estimateLineUsage`: token-exact where the input is tokens; reuse the
     sync path's estimator for the modality when one exists.
6. **Skin registry** — `skins/index.ts` (`BATCH_SKIN_CONTRACTS`).
7. **Adapter lowering** — the provider adapter's `fromInternalRequest`
   branches per family *ahead of* the chat/responses wire split, keyed on
   the model's `output_modalities` (never a model-id list), and lowers via
   the **sync path's pure serializer** for that modality (extract one if it
   doesn't exist yet — see `serializeOpenAiEmbeddingsRequest`).
8. **Wire usage union** — `schemas/batch-output-line.ts` if the
   modality's usage shape differs from the registered wires.
9. **Fake provider** — `services/fake-provider/batch/result-generator.ts`:
   deterministic output lines for the new `url`, plus an
   `adapter-e2e-<modality>.test.ts` sibling that parses output through the
   new adapter's `parseResult`/`parseUsage` (adapter-owned — see the
   ownership axis in [`add-batch-provider`](../../.agents/skills/add-batch-provider/SKILL.md)).
10. **Sync-side hardening** — the modality's sync router must fail closed on
    `BatchAdapterName` endpoint rows (see `resolveTextAdapterName` for chat,
    `getEmbeddingsAdapterName` for embeddings) and exclude `:batch` variants
    from its models listing. Without this, a `:batch` endpoint row is
    servable through the sync API at batch pricing.
11. **Endpoint rows** — `:batch` variant rows per model (`StaticVariant.Batch`,
    `provider_overrides.adapterName` = the batch adapter, pricing strategy +
    `pricing_versions` row at the batch price). The KV warm cron
    force-disables endpoints whose pricing strategy has no `pricing_json`.

## Provider research notes are the source of truth for provider behavior

`docs/batch-research/<provider>.md` is the committed research contract for
each provider. Read it before writing or changing that provider's adapter,
and treat it as normative over the provider's own prose docs: every claim is
tagged `[capture]` (observed live), `[docs]`, or `[unconfirmed]`, and the
notes record where the two disagree.

The nuances the notes carry are the ones that silently lose paid results if
an adapter ignores them:

- whether the provider exposes a batch **status string** at all or the
  lifecycle must be synthesized from counters, and whether those counters
  are monotonic — where they are not, one poll snapshot is not terminal;
- how a **failed sub-request of a completed batch** is reported: a separate
  error file, a discriminated inline row, or counters with no row, and what
  the error envelope actually contains;
- whether **results stay readable** on failed, cancelled, or expired jobs;
- native **remote URL** support (public image versus file/PDF URLs) and the
  exact field names, which the capability switches in
  `adapters/image-url-support.ts` and `adapters/file-url-support.ts` encode;
- per-artifact **retention** and expiry, which bound finalization.

When a change contradicts a note, update the note in the same PR — a note
that disagrees with the shipped adapter is worse than no note. When live
behavior is captured that the note lists as unconfirmed or deferred, record
it there too. `.agents/skills/research-batch-provider/SKILL.md` owns how the
notes are produced, including the gotchas learned from live runs.

## Adding a new provider adapter

Start from the provider's research note (above). Extend `adapters/base.ts`
(`BaseBatchAdapter`). The base owns the
provider-agnostic lifecycle — GCS persistence, ingest-mode guards, upstream
status validation, the identity results transform — so a concrete adapter
implements only the true provider seams:

 1. Declare both lifecycle modes with their literal enums:
    - `ingestMode`: `BatchIngestMode.File` uploads before submit;
      `BatchIngestMode.Inline` skips the upload step.
    - `resultMode`: `BatchResultMode.FileHandle` requires `output_file_id` or
      `error_file_id`; `BatchResultMode.BatchId` fetches with
      `upstream_batch_id` and permits both result handles to stay null.
2. Implement the abstract hooks: `transformBatchRequest` (client JSON →
   provider-native payload), `uploadNativeInput` (file mode only),
   `submitNativeBatch`, `pollBatch`, `fetchNativeResults`, plus the pure
   per-line `fromInternalRequest` / `toInternalResponse`. The file-id
   parameter of `submitNativeBatch` / `fetchNativeResults` is typed off the
   declared mode (`string` for file ingest / file-handle results, `null`
   otherwise), so do not re-check it for null inside the hook.
3. Override `transformBatchResponse` whenever the provider's native result
   rows are not already the canonical batch-output JSONL (`id`,
   `response.status_code`, `response.body`, `error`), as Vertex, xAI, and
   Fireworks require. The raw artifact stores native rows and finalization
   normalizes them on read through this method before billing, so leaving
   it as identity serves results correctly but bills zero. `parseResult`
   normalizing the same row does not cover billing.
4. Register in `services/batch-api/src/adapters/adapter-factory.ts` and read
   its warning: OpenAI-compatible sync adapters' `transformRequest`
   overrides are NOT reproduced by the OpenAI batch serializer — each such
   provider needs its own batch serializer.

## Per-adapter lowering (no shared grid)

Each provider adapter owns its own `fromInternalRequest` and lowers the
internal request independently — there is no shared
`Record<BatchEndpointFamily, serializer>` grid. This is deliberate:
provider wire formats differ enough (e.g. Gemini embeddings wire ≠ OpenAI
embeddings wire) that a shared abstraction would add ceremony without
clarity. `vertexGeminiInternalRequestToBatchInput` lives alongside
`openAiInternalRequestToBatchInput` and
`anthropicInternalRequestToBatchInput` as peers.

When adding a new provider adapter, add a new peer serializer rather
than trying to retrofit a shared registry.

Still deferred: inverting the skin dependency direction (each domain
package, e.g. `packages/embeddings/batch/`, owning its skin + lowering
and registering into batch's contract registry, so `packages/batch`
stays domain-agnostic). Do it when the registry gains a second writer.

## Invariants

- Do not deep-import package internals from outside this package; the
  subpath exports (`/schemas`, `/adapters`, `/skins`, `/app`, `/routes`) are
  the boundary.
- Streaming: submit parsing, GCS writes, and result finalizing must not
  buffer full payloads (see `services/batch-api/README.md`).
- Lowering must go through the sync path's production serializers so batch
  and sync produce identical upstream bodies (ECO-1670).
- Billing reads the raw artifact line while serving normalizes a separate
  copy. Do not compose those paths: billing from a normalized body would
  double count usage folded into prompt tokens.
