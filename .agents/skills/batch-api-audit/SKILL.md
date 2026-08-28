---
name: batch-api-audit
description: >-
  Read-only audit of a Batch API PR or PR stack against the batch layer
  boundary rules, streaming/memory invariants, error-handling contracts, and
  stack scoping. Produces a checklist report with file:line evidence for
  every gap. Run before requesting review on any batch PR. Sub-skill of
  batch-api-development.
user-invocable: true
---

# Batch API Audit

Read-only audit of batch code. It never edits code — the output is a
report; fixes land per
[`stacked-prs`](../stacked-prs/SKILL.md) §Handling review feedback
(lowest owning PR first, then `gh stack rebase` + `gh stack push`).

## Inputs

- The PR or stack under audit. Get each layer's real base from
  `gh pr view --json baseRefName` (or
  `gh api repos/{owner}/{repo}/stacks`), and the owned-file matrix
  from the feature manifest
- The relevant READMEs, which are the source of truth for boundaries:
  `packages/batch/README.md`, `services/batch-api/README.md`,
  `services/cfw-batch-api/README.md` (if present)

## Output

A Markdown report (uncommitted, e.g. `/tmp/batch-audit-<pr>.md`) with one
row per checklist item: PASS / FAIL / N-A, plus `file:line` evidence for
every FAIL. Attach conclusions (not open questions) to the PR description
or review comment.

## Checklist

### A. Layer boundaries

- [ ] `packages/batch` stays runtime-agnostic: no Cloudflare bindings,
      Cloud Run clients, Spanner, GCS clients, or runtime credentials
- [ ] `services/cfw-batch-api` contains only edge auth/CORS/token
      minting/zero-copy forwarding — no batch parsing, provider calls,
      storage, Pub/Sub, or Spanner
- [ ] `services/batch-api` does not fork package-internal schemas — batch
      contracts are imported, not redefined
- [ ] Consumers import only subpaths listed in `packages/batch`
      `package.json#exports` (check the current exports map — it is the
      source of truth); no imports of paths outside that map or into
      `services/batch-api` internals

### B. Error handling and results

- [ ] Use-case modules return `ErrorT` / `Result`; only
      `services/batch-api/src/routes/` serializes HTTP error responses
- [ ] No `try/catch` — `wrap()` from
      `@openrouter-monorepo/type-utils/result-monad`; no `any`, no `as`
      casts (use Zod schemas / type guards)
- [ ] External data (provider responses, JSONL lines, Pub/Sub payloads) is
      parsed with Zod at the boundary, not trusted

### C. Streaming / memory invariants

- [ ] Submit parsing stays incremental (`JSONSaxParser` path) — no code
      collects the full request body in memory
- [ ] GCS writes, result finalization, and provider file upload use the
      streaming helpers; no buffering of full output bodies
- [ ] Every `fetch()` whose body is not consumed cancels it via
      `response.body?.cancel()`
- [ ] No `Promise.race` — `safeRace` from
      `@openrouter-monorepo/helpers/safe-race`

### D. Shared helpers (no hand-rolling)

- [ ] GCS URIs built via `src/storage/batch-gcs-store.ts` — no hand-built
      `gs://…/input_file` or artifact strings
- [ ] Pub/Sub REST publishes go through `createPubSubPublisher`
- [ ] Batch generation IDs come from `genBatchId`
      (`packages/batch/batch-generation-id.ts`), never string-formatted
      inline
- [ ] Logging via `iLog`/`wLog`/`eLog` with snake_case context — no
      `console.log`

### E. Status, billing, and sweep semantics

- [ ] GET path reports **stored** status faithfully — no upstream polling
      added to the read path
- [ ] Spanner `async_jobs` reads stay scoped to the caller's billable
      entity; sweep reads force the current sweep index (`async_jobs_sweep_v2`
      as of migration 000044 — confirm against
      `services/usage-record/helpers/select-sweep-candidates.ts`, not this doc)
- [ ] Finalize remains idempotent: re-delivery of a finalize message must
      not double-emit generations or double-copy output
- [ ] Any new Spanner/Postgres migration is idempotent (`IF NOT EXISTS` /
      `IF EXISTS`) and follows the lock-analysis procedure in
      `postgres/migrations/AGENTS.md`

### F. BYOK semantics

- [ ] `is_byok` is carried from the submit-time resolved endpoint into the
      `async_jobs` row (`submit-batch.ts`) and re-resolved at finalize via
      `resolveBatchEndpointById` (by the stored `endpoint_id`, not by model
      — finalize runs as the system without the submitter's private
      endpoint grants)
- [ ] The affordability preflight skips BYOK endpoints (BYOK bills the
      user's own provider key, not OpenRouter credits) — see
      `checkBatchAffordability` in
      `services/batch-api/src/submit/accept/submit-batch.ts`
- [ ] Emitted generations classify BYOK inference cost as
      `byok_usage_inference` with credits usage `0`, matching the
      submit-time pending-charge classification
      (`services/batch-api/src/finalize/emit-batch-generations.ts`) —
      never as credits usage
- [ ] BYOK-exempt preflight gates (e.g. provider bans) keep their
      exemption; new preflights state explicitly whether BYOK is exempt
- [ ] New code paths that touch billing carry `is_byok` through usage
      rollups (`finalize-batch-job.ts` attaches it to `usage`) rather than
      recomputing or defaulting it

### G. Provider files functionality

- [ ] Provider file upload streams the JSONL body (multipart stream
      helpers per `packages/batch/adapters/openai/file-uploader.ts`) — no
      buffering of the full input file to build the request
- [ ] File download returns the response body as a stream piped to GCS
      (`file-downloader.ts` pattern) — never `response.text()` on a
      results file
- [ ] Upload/download responses are Zod-validated (e.g.
      `OpenAIFileObjectSchema`) and errors flow through the provider error
      handler as `ErrorT`
- [ ] Upstream file ids (`upstream_input_file_id`, output/error file
      handles) are persisted on the job row, not re-derived or assumed
- [ ] New file-based providers implement upload → create-batch → poll →
      download against their own Files API semantics; non-file providers
      (e.g. Vertex-style inline) must not fake a file id

### H. Skin contract correctness

- [ ] Every `BatchEndpoint` has a `BatchSkinContract` registered in
      `BATCH_SKIN_CONTRACTS` (`packages/batch/skins/index.ts`) — the
      `satisfies Record<BatchEndpoint, BatchSkinContract>` clause stays
      intact
- [ ] `toInternalRequest` / `fromInternalResponse` round-trip: the skin
      renders the internal event stream back into the endpoint's response
      shape, verified by sync-parity tests against committed sync fixtures
      (`sync-parity.test.ts` pattern), not just type-checks
- [ ] `fromInternalResponse` derives `id`/`created_at` from
      `BatchResultIdentity` (stable `jobId:custom_id` + stored upstream
      timestamp) — no fresh UUID / `Date.now()` that would change across
      reads of the same line
- [ ] `renderCtx` is validated inside `fromInternalResponse` (it is opaque
      at the contract boundary) — no unchecked casts on recovery
- [ ] `validateLinePolicy` covers the batch-specific gates the sync schema
      allows (stream ban, text-only content, web-search ban, …) and new
      gates document their BYOK/model exemptions
- [ ] `parseUsage` / `parseResult` (adapter-owned, not skin — see
      [`add-batch-provider`](../add-batch-provider/SKILL.md) ownership
      axis) parse with Zod and return `BatchAdapterOutputError` — no
      throwing parsers, no imports from `packages/batch/skins`

### I. Provider registration (new-provider PRs only)

- [ ] `BatchAdapterName` entry exists and `batchAdapterFactory`
      (`packages/batch/adapters/batch-adapter-factory.ts`) has a matching
      constructor — the `satisfies Record<…>` clause must stay intact, no
      partial casts around it
- [ ] Runtime registry (`services/batch-api/src/adapters/adapter-factory.ts`)
      wires the provider with a Zod-validated env schema, validated eagerly
      in `buildAdapterRegistry` — missing/invalid env **throws at startup**
      (fail fast, the service must not boot); only the per-request
      `AdapterRegistry#getAdapter` boundary returns `Result`/`ErrorT`
- [ ] The provider's batch endpoint is mapped in `BATCH_ENDPOINT_FAMILY`
      (`packages/batch/schemas/batch-endpoint-family.ts`)
- [ ] `OpenAIBatchAdapter` was not reused for a provider whose sync
      adapter overrides `transformRequest`/`getReasoningEffort`

### J. Provider semantics (new-provider PRs only)

Registration can be complete while the adapter is semantically wrong.
Audit against the committed research note
(`docs/batch-research/<provider>.md`) as the contract:

- [ ] Every upstream batch status maps exhaustively to an internal status
      (`switch` with `satisfies never` default) — no silent fall-through
      for states like `expired`, `cancelling`, or partial-completion
- [ ] Polling respects the provider's documented limits/backoff hints
      (rate-limit headers, retry-after) — no fixed tight loops
- [ ] Submit / fetch / cancel calls match the provider's actual API
      semantics per the research note's live captures, not the OpenAI
      reference adapter's assumptions
- [ ] Partial failures and separate error-file outputs are handled: a job
      with mixed success/error lines produces both result sets, neither
      silently dropped
- [ ] `custom_id` values and line identity are preserved through
      submit → poll → download; output ordering assumptions are explicit
- [ ] Terminal and expired states finalize idempotently — re-delivery of
      a terminal status cannot double-emit or wedge the job
- [ ] Paginated or multi-file result downloads are drained completely —
      no silent truncation at the first page/file

### K. Stack scoping (per layer)

- [ ] `git diff <base>...HEAD --name-only` contains only the layer's
      owned files, where `<base>` is the PR's actual base branch
      (`gh pr view --json baseRefName -q .baseRefName`), not `main`
- [ ] No layer imports symbols introduced only in a higher layer
- [ ] The layer typechecks and its scoped tests pass with nothing
      above it applied
- [ ] The stack has linear history (`gh stack view` shows no
      `⚠ Needs rebase` markers; no "Rebase stack" banner in the
      UI) — do not run `gh stack rebase` as the check; it rewrites
      the stack's branches
- [ ] PR metadata (ordinal, owned scope, exclusions) matches the
      ownership matrix in the manifest

### L. Fixtures and tests presence

- [ ] New adapters/skins ship with committed fixtures per
      [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md) — no
      hand-rolled minimal inline objects standing in for real provider
      output
- [ ] Changed behavior has covering tests per
      [`batch-api-testing`](../batch-api-testing/SKILL.md) (this item only
      checks presence; test quality is the test audit's job)

## Related skills

- [`batch-api-development`](../batch-api-development/SKILL.md)
- [`stacked-prs`](../stacked-prs/SKILL.md) — how fixes cascade
- [`batch-api-stacked-pr`](../batch-api-stacked-pr/SKILL.md) — batch
  layer decomposition
- [`test-audit`](../test-audit/SKILL.md) — quality audit of the tests
  themselves
