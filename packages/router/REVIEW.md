# Router Review Guidelines

Patterns to flag when reviewing changes to `packages/router`.

## Router latency coverage

- **Flag latency-accounting changes that leave the coverage map
  stale.** Check the diff for four kinds of change:
  - a new or moved `recordOwn`, `measureOwn`, `measureOwnWith`,
    `measureExcludedWith` or `startExcluded` call
  - a change to the upstream tracker or the first-dispatch stamp
  - a change to where `compute()` runs
  - a new awaited step before dispatch

  If the diff has any of these, ask for the matching rows in
  `docs/router-latency-coverage.html` to be updated in the same PR,
  following `packages/instrumentation/router-latency-v2/AGENTS.md`.

## Provider compatibility boundaries

- Provider-specific reasoning formats, tool identities, multimodal content
  conversions, and optional parameter semantics belong in the adapter or skin
  boundary; do not leak upstream wire conventions into the shared internal
  request/stream types.
- Preserve provider error status and privacy contracts when normalizing
  failures. In particular, masking an upstream message must not discard the
  status information needed by routing and client-fault classification.

## Memory Retention

- **Flag new instance fields that hold request bodies or response
  data.** Adapters and the Router live for the whole request
  (including endpoint fallback attempts), so a class field holding a
  request body, a transformed/serialized upstream request, or
  response data pins that payload — including base64 image/audio
  blobs — for the object's lifetime. Ask for the data to be threaded
  explicitly as function parameters instead, scoped to the narrowest
  lifecycle window.
- **Flag retained sources of derived values.** If a field is only
  read to compute a number or summary later (e.g. a flattened prompt
  string kept for token counting), the derived value should be
  computed eagerly and only the result retained.
- **Flag closures that capture large payloads past their last use.**
  A stream callback that needs a payload once (e.g. a debug echo on
  stream start) should hold it in a mutable local and clear it after
  use, so the reference is released while the stream is still running.

## Hot-path Allocations

- **Flag wrapper objects allocated only to satisfy `max-params` at
  per-chunk or per-token call sites.** Prefer a reused request-scoped
  context; when none exists, a narrow exemption explaining the avoided
  repeated allocation is safer than adding churn to the hot loop.

## Fixtures

- **Flag upstream-response-behavior changes that ship without a raw
  upstream fixture.** A PR that changes adapter response transforms,
  skin stream/non-stream handlers, or parsing of new upstream
  fields/events/params should include a captured fixture in
  `fixtures/<provider>/` and a snapshot test (see the
  `create-fixtures` skill). Unit tests built on synthetic inline
  payloads hand-written from vendor docs are not a substitute — they
  encode the author's assumptions, not the provider's actual wire
  format, and fixtures then get backfilled in follow-up PRs.
- **Flag fixtures that are not verbatim live captures.** A fixture
  built by copying an existing capture and splicing in expected
  fields (e.g. editing a usage object) is a forged capture — reject
  it and require a real capture from the live provider API.
- **Exempt** changes that never touch upstream response payloads:
  request-only transforms (reshaping the outgoing request body,
  covered by unit tests on `transformRequest`), pure
  routing/filtering, pricing metadata, model ID enums/aliases,
  provider configs, or refactors already covered by fixture
  snapshots.

## Zod schemas for non-serializable values

- **Flag `z.unknown()` used for a value with a known TS type that Zod
  cannot express** (closures, class instances, `AbortSignal`s). It
  erases the compile-time contract at every parse site and lets a
  malformed value flow to the call/read site unchecked. Use
  `z.custom<T>((v) => …)` with a runtime narrowing check (e.g.
  `typeof v === 'function'`), optionally `.catch(undefined)` when a
  malformed value should degrade rather than reject. `z.unknown()`
  remains correct for genuinely opaque passthrough data with no known
  type.

## Responses stream lifecycle

Responses output items must emit their content-end and
`output_item.done` events as soon as each item completes, including when
reasoning and text interleave. Do not defer item closure until the whole
response ends; downstream consumers rely on item ordering and the final
turn event separately.

Server-tool advisor and subagent calls should use the raw Responses request
path and the existing OpenAI Responses adapter converter. Keep web-search
result reservations synchronous across parallel tool calls so
`max_total_results` cannot be exceeded.
