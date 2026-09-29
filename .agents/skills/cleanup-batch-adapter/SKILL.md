---
name: cleanup-batch-adapter
description: Read-only checklist review of a freshly written batch provider adapter against its committed research note. Run after add-batch-provider, before opening the adapter PR.
user-invocable: true
---

# Cleanup Batch Adapter

Audit a new batch adapter against the patterns the on-main adapters share
(`packages/batch/adapters/openai/` is the reference), the repo rules, and
the provider's research note. Read-only — it produces a markdown checklist
citing the lines that need fixing; it does not modify code.

Run after [`add-batch-provider`](../add-batch-provider/SKILL.md) step 3 and
after every push that touches the adapter, before opening its PR. This is
narrower and deeper than [`batch-api-audit`](../batch-api-audit/SKILL.md):
one adapter, method by method.

## Arguments

- `$ADAPTER_DIR`: directory under `packages/batch/adapters/` (e.g.
  `anthropic`)
- `$RESEARCH_NOTE`: `docs/batch-research/<provider>.md` — the contract the
  adapter is reviewed against

## Output format

A single markdown report at `/tmp/batch-adapter-review-<provider>.md`, one
section per category. Every item is `[x]` or has a cited
`<path>:<line>` gap quoting the offending fragment. Do not check a box
without reading the file.

## Categories

### Lifecycle completeness

- [ ] Every `BatchAdapter` method is implemented or explicitly returns
      `501` `ErrorT` with a ticket reference — no fake successes
- [ ] `transformBatchRequest` streams (`AsyncIterable` in, stream out);
      no full-batch buffering
- [ ] Upload/download follow the provider's real Files API semantics per
      the research note; inline providers do not fake file ids
- [ ] `ingestMode` is set (`'file'` | `'inline'`); inline adapters omit
      `uploadNativeInput`, and `inline` is understood as input delivery only
      (result discovery may still use a poll-produced provider handle)
- [ ] `nativeDeletion` matches the research note —
      `BATCH_NATIVE_DELETION_UNSUPPORTED` when the provider documents no
      batch-delete API, otherwise `{ supported: true, deleteBatch }` honoring
      the `BatchNativeDeletion` contract (never cancel, never `ok` while the
      upstream copy survives). Verified against the note, not copied from a
      sibling adapter — the field is required precisely so no provider is
      reported `unsupported` by omission.
- [ ] The adapter extends `BaseBatchAdapter` when its lifecycle fits; any
      parallel composition abstraction documents the concrete missing seam
- [ ] `fetchNativeResults` consumes every page/file/shard and treats
      `output_file_id` as a provider result handle rather than assuming it is
      always a Files API id
- [ ] `parseResult` and `parseUsage` are adapter-owned and do not import
      from `packages/batch/skins` (output parsing lives on the provider
      axis, not the endpoint-skin axis)
- [ ] `fetchBatchResults` drains all pages/files; body is a stream, never
      `response.text()`

### Status + polling

- [ ] Upstream status `switch` is exhaustive (`satisfies never` default)
      and covers every status in the research note's table, including
      `expired`/`cancelling`/partial states
- [ ] Backoff/rate-limit hints from the note are honored; no tight loops

### Request/response fidelity

- [ ] `fromInternalRequest` reuses the sync adapter's extracted serializer
      (`serialize-*-request.ts` + `build-serialize-context.ts`) rather than
      reimplementing request shaping — reasoning effort, supported-parameter
      picking, and tool gating come from the shared path, not a copy
- [ ] `toInternalResponse` handles success and error lines from the
      committed fixtures; `custom_id`/line identity preserved

### Contracts + type safety

- [ ] Every upstream payload Zod-parsed; failures return `ErrorT` (no
      throws); no `any`, no `as` casts on runtime data
- [ ] Unconsumed fetch bodies cancelled; `safeRace` not `Promise.race`;
      `iLog`/`wLog`/`eLog` only

### Registration + tests

- [ ] `BatchAdapterName` entry + `batchAdapterFactory` constructor with
      the `satisfies` clause intact
- [ ] Every module has a colocated test driven by committed fixtures with
      provenance comments; golden vectors are captured values, not
      invented
- [ ] If a sync serializer was extracted for reuse (see Request/response
      fidelity), it ships with a `serialize-*.golden.test.ts` pinning
      byte-identical `transformRequest` output and a
      `build-serialize-context.test.ts` for the offline builder — the
      regression guard proving the extraction did not change sync output

## Related skills

- [`add-batch-provider`](../add-batch-provider/SKILL.md) — produces what
  this reviews
- [`batch-api-audit`](../batch-api-audit/SKILL.md) — stack-wide audit
