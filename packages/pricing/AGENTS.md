# Pricing Package — Agent Guidelines

See the root [AGENTS.md](../../AGENTS.md) for repo-wide rules.

## SKU merge semantics

Last write wins, with no exceptions.

When the same SKU is recorded more than once for a job (e.g. a
request-time estimate followed by a provider-reported quantity at
completion), the later entry is the one billed — `reduceSkuItems` in
`packages/video-generation/helpers/init-tx.ts` keeps the last value
per SKU. Do not add replace-on-completion, first-write-wins, dedupe,
or other merge special cases; append the new item and let the reducer
pick the latest. Merge special cases are a known source of billing
regressions (see #32847).

## Display pricing item order

Each strategy's `getPublicPricing()` returns a `DisplayPricingItem[]`
that is rendered, in array order, by `PricingTooltipContent` on the
models marketplace page (see
[display-pricing-helpers.tsx](../../projects/web/app/[locale]/(marketplace)/models/display-pricing-helpers.tsx)).
The frontend does not sort — array order is the render order.

When a strategy exposes the **same media priced two ways** (e.g.
per-second resolution tiers *and* per-token rates for the same video
output), put the **resolution-based items first**, then the
token-based items. Resolution pricing is what users compare against
competitors; token pricing is the underlying detail.

Currently only [strategies/seedance/strategy.ts](./strategies/seedance/strategy.ts)
has this dual-view structure. If you add a new provider with both
shapes (e.g. a new video model that bills per token internally but
advertises per-second prices), follow the same ordering and add a
test asserting the order — see
[strategies/seedance/strategy.test.ts](./strategies/seedance/strategy.test.ts)
("orders resolution-based items before token-based items").

## Adding a new pricing strategy

- Place it under `strategies/<provider>/`
- Export a singleton instance and register it in
  [strategies/get-pricing-strategy.ts](./strategies/get-pricing-strategy.ts)
- Add a co-located `strategy.test.ts` covering `getPublicPricing()`
  and `getFinalUsageResponse()`
- For video generation, prefer
  [strategies/video-gen-helpers.ts](./strategies/video-gen-helpers.ts)
  to wrap the `DisplayPricingItem[]` into the public pricing shape
- For per-image billing, extend
  [strategies/per-image.ts](./strategies/per-image.ts)
  (`PerImagePricingStrategy`) and declare the SKU layout declaratively;
  the usage response, public pricing, and display pricing are all derived
  from the descriptor
