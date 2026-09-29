---
name: fake-batch-provider
description: >-
  Extend services/fake-provider with a new provider's batch surface early in
  onboarding — upload/create/poll/results/cancel routes, status lifecycle,
  error shapes, and header overrides derived from the research captures — so
  the adapter and e2e tests run deterministically before any live provider
  call. Sub-skill of batch-api-development, run right after
  research-batch-provider.
user-invocable: true
---

# Fake Batch Provider

Deterministic testing starts here, not at the end. As soon as the research
note ([`research-batch-provider`](../research-batch-provider/SKILL.md)) is
approved, teach `services/fake-provider` the new provider's batch surface.
Everything above it — adapter unit tests, e2e in `tests/e2e/api/batches/`,
Tilt runs — then works from day one without provider keys, cost, or
flakiness.

The OpenAI-shaped surface in `services/fake-provider/batch/` is the
template: `routes.ts` (Hono routes), `fake-batch-store.ts` (in-memory job
lifecycle), `result-generator.ts` (output/error line synthesis),
`batch-config.ts` (env defaults + per-request header overrides), each with
colocated tests plus `adapter-e2e.test.ts` driving the real adapter
against the fake.

## What to build

Derive every shape from the research note's live captures — the fake must
mimic the provider, not the OpenAI reference:

1. **Routes** — the provider's actual upload/create/poll/results/cancel
   paths and auth header shape (or inline submission for Vertex-style
   providers; no fake file ids).
2. **Status lifecycle** — every status from the note's status table,
   including `expired`/`cancelling`/partial states, advancing per poll via
   the store. Derive all lifecycle timestamps (create/expire/cancel) from
   `Date.now()` at store time, never hard-coded date literals, and
   preserve the first cancellation timestamp across repeated transitions.
3. **Output/error synthesis** — success lines, error lines, separate
   error files, and mixed partial-success jobs matching the captured
   shapes; preserve `custom_id` semantics and documented ordering.
4. **Header overrides** — extend the `x-fake-batch-*` override pattern
   (`batch-config.ts`) so a single request can force polls-before-complete,
   terminal status, count mismatches, or upload errors without restarting.
5. **Adapter e2e** — a colocated `adapter-e2e.test.ts` that runs the new
   provider's real adapter end-to-end against the fake surface.

## When it lands

Layer it with (or immediately after) the schemas layer of the stack — it
depends only on `packages/batch/schemas` enums and must be merged before
the adapter layer's tests need it (see
[`batch-api-stacked-pr`](../batch-api-stacked-pr/SKILL.md)).

The fake never replaces live verification: golden vectors and fixtures
stay captured from the real provider
([`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md)), and the live
verification phase in [`batch-api-testing`](../batch-api-testing/SKILL.md)
still runs before hand-off. Never label fake-generated output as a prod
golden vector.

## Related skills

- [`research-batch-provider`](../research-batch-provider/SKILL.md) —
  supplies the captured shapes the fake mimics
- [`add-batch-provider`](../add-batch-provider/SKILL.md) — the adapter
  this unblocks
- [`batch-api-testing`](../batch-api-testing/SKILL.md) — consumes the
  fake in e2e
