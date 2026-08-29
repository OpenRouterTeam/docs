---
name: add-batch-provider
description: >-
  Implement a new batch provider (e.g. Anthropic, Gemini) from its committed
  research note — file-by-file recipe for the endpoint-family schema entry,
  skin selection/creation, adapter lifecycle methods, enum/factory
  registration, runtime env plumbing, and the tests each file needs.
  Sub-skill of batch-api-development; the layers map 1:1 onto the
  batch-api-stacked-pr provider decomposition.
user-invocable: true
---

# Add Batch Provider

Owns the actual provider implementation. Prerequisites: an approved
research note at `docs/batch-research/<provider>.md`
([`research-batch-provider`](../research-batch-provider/SKILL.md)) and
committed fixtures. Every design decision below (skin reuse, status
mapping, file semantics) comes from that note — do not improvise from the
OpenAI reference adapter.

Fixtures the research phase deferred (see
[`research-batch-provider`](../research-batch-provider/SKILL.md) →
Deferred captures) may be doc-derived and tagged `provenance: 'docs'`.
Steps 1 to 3 may land on them. Traffic needs both a step 4 registry entry
(whose entry throws at boot without the provisioned key, so there is no
inactive registration state) and enabled `:batch` endpoint rows for the
provider's models. Hold whichever of the two the onboarding introduces
until the real payloads have been replayed through `pollBatch`,
`parseResult`, and `parseUsage` and the doc-derived fixtures are replaced.

The five steps below are the stack layers of
[`batch-api-stacked-pr` §Provider-onboarding decomposition](../batch-api-stacked-pr/SKILL.md#provider-onboarding-decomposition);
cut one PR per step. Mechanics for cutting and
submitting those PRs: [`stacked-prs`](../stacked-prs/SKILL.md).

## Ownership axis (read first)

Two axes cross here — keep them separate:

- The **endpoint skin** owns the *client-facing* endpoint: request
  normalization, render-context recovery, and response rendering. Provider-
  independent.
- The **provider adapter** owns the *upstream wire*: request lowering,
  polling, result parsing, and billing-usage parsing.

The stored output wire is chosen by the routed provider, not the submitted
endpoint (a `/v1/messages` batch can run through an OpenAI-shaped provider,
and vice versa). So **output parsing — the result line and the billing
usage — is owned by the adapter, not the skin.** Putting it on the skin
forces every endpoint to discriminate provider formats and makes each new
provider an edit to every skin. If you find yourself importing a provider's
wire schema into a skin, it belongs on the adapter instead.

## 1. Schemas (`packages/batch/schemas`)

- Add the provider's public endpoint to `BATCH_ENDPOINT_FAMILY`
  (`batch-endpoint-family.ts`) mapping it to its skin family.
- Add any new wire schemas (Zod) for provider-native line shapes the
  layers above will parse.
- Tests: schema round-trip tests against the research-note captures.

## 2. Skin (`packages/batch/skins/<skin>/`) — only when needed

Skip when the provider's line shape is already covered (chat completions,
OpenAI Responses, Anthropic Messages). Otherwise mirror
`packages/batch/skins/anthropic-messages/`:

- `index.ts` — a `BatchSkinContract` (`contract.ts`) implementing
  `toInternalRequest`, `fromInternalResponse` (deriving `id`/`created_at`
  from `BatchResultIdentity`, validating the opaque `renderCtx` with Zod),
  and `validateLinePolicy`. Result-line and billing-usage parsing live on
  the adapter (see the Ownership axis above), not here.
- Register it in `BATCH_SKIN_CONTRACTS` (`skins/index.ts`) — the
  `satisfies Record<BatchEndpoint, BatchSkinContract>` makes a missing
  entry a compile error.
- `fixtures/` + `parity.test.ts` — sync-parity tests against the
  committed sync fixtures ([`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md)).

## 3. Adapter (`packages/batch/adapters/<provider>/`)

Mirror the layout of `packages/batch/adapters/openai/`: **flat, one file
per concern** (no subfolders unless the sibling adapters grow them too, so
the tree stays consistent). Extend `BaseBatchAdapter` when its shared
persistence and file/inline lifecycle fit; prove a gap before introducing a
parallel composition abstraction.

| Method                                       | Module                                                | Notes                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ingestMode` (field)                         | `<provider>-batch-adapter.ts`                         | Declare `BatchIngestMode.File` for Files API uploads or `BatchIngestMode.Inline` when submit references persisted input directly. This field describes input delivery only. |
| `resultMode` (field)                         | `<provider>-batch-adapter.ts`                         | Declare `BatchResultMode.FileHandle` when fetching requires `output_file_id` or `error_file_id`, or `BatchResultMode.BatchId` when fetching uses `upstream_batch_id` and both handles may remain null. |
| `transformBatchRequest`                      | `transform.ts`                                        | pure client-JSON → provider-native JSONL, streaming (`AsyncIterable`), never buffers the batch. The service persists the client-wire `{custom_id, body}` copy (`input_file`) for render-context recovery separately from this lowered output (`input_file_lowered`) |
| `uploadNativeInput` (optional, protected)    | `file-uploader.ts`                                    | multipart **stream** upload for file-based providers; inline providers omit it and the base class rejects accidental upload dispatch                  |
| `submitNativeBatch`                          | `batch-submitter.ts`                                  | create the upstream job from `BatchSubmitParams`; inline providers may reference `input_uri` directly                                                  |
| `pollBatch`                                  | `batch-poller.ts`                                     | exhaustive upstream-status `switch` (`satisfies never` default); persist every terminal result/error handle and honor backoff hints                    |
| `fetchNativeResults`                         | `file-downloader.ts`                                  | return a `ReadableStream`; drain all pages/files/shards. `output_file_id` is a generic provider result handle, not necessarily a file id               |
| `transformBatchResponse`                     | `<provider>-batch-adapter.ts`                         | override identity when provider-native result rows must be normalized before persistence                                                              |
| `parseResult` / `parseUsage`                 | `output-parser.ts`                                    | validate one canonical result line and read billable usage. Adapter-owned; never import from `packages/batch/skins`                                   |
| `toInternalResponse` / `fromInternalRequest` | `to-internal-response.ts`, `from-internal-request.ts` | pure line pivots; reproduce sync request shaping (reasoning effort, supported params) rather than stripping keys                                      |

Every upstream response is Zod-parsed; every failure returns `ErrorT`
through the shared provider error handler. Cancel unconsumed response
bodies.

### Reusing the sync serializer (do not reimplement request shaping)

`fromInternalRequest` must produce the *same* upstream body the sync
adapter sends — reasoning-effort folding, `supported_parameters` picking,
tool gating, cache/thinking policy. Do **not** copy that logic into batch;
it will drift. Instead extract it once and share it, the way the OpenAI
adapters already do:

1. Extract the sync adapter's `transformRequest` body into a pure
   `serialize-<wire>-request.ts` (no `this`, no I/O — every input passed
   in) plus an offline `build-serialize-context.ts` that reproduces the
   adapter's init sequence (reasoning → token estimate → max-tokens →
   sampling params) from a plain internal request.
2. The sync adapter's `transformRequest` becomes a thin delegate to the
   serializer.
3. Batch's `from-internal-request.ts` calls the same
   `build-*-context` → `serialize-*-request` pair. One serializer, no
   drift.

Reference: `packages/router/adapters/openai/serialize-chat-request.ts` +
`build-serialize-context.ts`, consumed by
`packages/batch/adapters/openai/from-internal-request.ts`.

Registration:

- Add the provider to `BatchAdapterName`
  (`packages/enums/adapters.ts`).
- Declare the adapter's sync wire(s) in `BATCH_ADAPTER_SYNC_WIRES`
  (`packages/enums/adapters.ts`) — the `Record<BatchAdapterName, …>`
  makes a missing entry a compile error. List the sync adapter(s) whose
  serializers this batch adapter reuses when lowering lines (or `[]` for
  none); wire-level capability sets (e.g. cache-control support) derive
  batch membership from this map rather than hand-maintained registries.
- Add a constructor to `batchAdapterFactory`
  (`packages/batch/adapters/batch-adapter-factory.ts`) — keep the
  `satisfies Record<BatchAdapterName, BatchAdapterConstructor>` intact.

Tests: colocated unit tests per module driven by the committed fixtures,
plus `*.golden.test.ts` parity vectors (see
[`batch-api-testing`](../batch-api-testing/SKILL.md)).

## 4. Runtime env plumbing (`services/batch-api`)

There are two registration paths; pick by configuration shape:

- **API-key providers** (one key + base URL — OpenAI, Anthropic, Together):
  add a config entry to the `API_KEY_PROVIDER_CONFIGS` table in
  `src/adapters/api-key-providers.ts`. The shared `apiKeyAdapterEntry`
  factory supplies the env schema, eager fail-fast validation, and
  `ProviderName`-keyed registration; no new module or `adapter-factory.ts`
  edit is needed. Read the warning on the OpenAI table entry: OpenAI-
  compatible sync adapters' `transformRequest` overrides are NOT reproduced
  by the base OpenAI batch serializer — each such provider needs its own
  batch serializer.
- **Richer-config providers** (e.g. Mistral's trimmable key + URL
  normalization, Vertex's multi-field env + auth): add one registration
  module under `src/adapters/` and list it in `REGISTRATIONS` in
  `adapter-factory.ts`.

Both paths share these requirements:

- Validate env eagerly at boot — missing env **throws at startup** (fail
  fast); `getAdapter` stays the `Result`-returning request-time boundary.
- Validate platform and BYOK credential formats intentionally. Provider
  construction failures at the request boundary return a typed client error;
  they must not crash the request or silently fall back to platform auth.
  When a user credential cannot own the batch artifacts (Vertex jobs and
  GCS output run in the platform project), reject BYOK with a 400 rather
  than running a customer credential against platform-owned resources.
- Add the env vars to the service's Infisical path and deployment config.

Tests: registry construction tests asserting the fail-fast throw on
missing env and successful `getAdapter` lookup.

## 5. Tests / monitoring

Owned by [`batch-api-testing`](../batch-api-testing/SKILL.md): intent
tests traced from the research note, e2e coverage in
`tests/e2e/api/batches/`, live verification, and Datadog monitors.

## Before opening each PR

Run [`cleanup-batch-adapter`](../cleanup-batch-adapter/SKILL.md) on the
adapter layer and [`batch-api-audit`](../batch-api-audit/SKILL.md) on
every layer.

## Related skills

- [`research-batch-provider`](../research-batch-provider/SKILL.md)
- [`batch-api-stacked-pr`](../batch-api-stacked-pr/SKILL.md)
- [`cleanup-batch-adapter`](../cleanup-batch-adapter/SKILL.md)
- [`batch-api-audit`](../batch-api-audit/SKILL.md)
- [`batch-api-testing`](../batch-api-testing/SKILL.md)
- [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md)
