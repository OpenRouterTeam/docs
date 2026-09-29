# Seedance (token-based video billing) — Agent Guidelines

See [packages/pricing/AGENTS.md](../../AGENTS.md) for strategy-wide rules
(SKU merge semantics, display item order).

Seedance is the reference implementation for **token-based video billing**:
the provider advertises per-second resolution prices but bills on a token
count it only reports after the generation completes. Follow this contract
when launching any new model with the same shape.

## The billing contract

1. **Request time — estimate.** The request is authorized against an
   *estimated* SKU quantity derived from the requested duration/resolution
   (and a flat estimate when the exact quantity cannot be derived, e.g.
   video input). The estimate is appended as a normal `SKUItem`.
2. **Completion — provider-reported usage.** When the job settles, the
   provider's actual token usage is appended as another `SKUItem` with the
   **same SKU**. Do not remove, replace, or dedupe the estimate.
3. **Reconciliation — last write wins.** `reduceSkuItems`
   (`packages/video-generation/helpers/init-tx.ts`) keeps the last value per
   SKU, so the provider-reported quantity is what gets billed. Appending
   both never double-bills; replace/merge special cases are a known
   source of billing regressions (see #32847).
4. **Estimate and final must share the SKU.** If the completion path writes
   a different SKU than the estimate path, both get billed. A regression
   test asserting the reduced final quantity (see
   `services/cfw-video-api/src/durable-objects/video-generation-job.cfw.test.ts`,
   "lets the reducer select the completed Seedance quantity after merge")
   is required for any new token-billed model.

## Serialization across the Durable Object boundary

Video jobs cross a worker → Durable Object RPC boundary. Everything in that
payload must be **structured-clone-safe JSON primitives**: a `BigNumber`
(or any class instance) in the endpoint pricing object throws
`DataCloneError`, the DO job is never created, and the caller sees an
opaque 500 with no provider generation. Normalize pricing to
strings/numbers before the RPC (see #32912) and keep money math in
`BigNumber` only *inside* a single runtime.

## Where the logic lives

- **Pricing strategy (`strategy.ts`, `skus.ts`)** — SKU layout, estimates,
  final usage response, public/display pricing. All provider-specific
  billing logic belongs here, not in the Durable Object.
- **Durable Object (`services/cfw-video-api`)** — generic job lifecycle:
  appends the provider-reported `SKUItem`s the strategy defines and defers
  to the reducer. It must stay provider-agnostic.
- **Adapter (`packages/video-generation/adapters/byteplus-seedance`)** —
  parses the provider's usage report into the normalized shape the strategy
  consumes.
