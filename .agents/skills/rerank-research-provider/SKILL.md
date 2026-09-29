---
name: rerank-research-provider
description: "Phase 1: research an API-only rerank provider's request, text/image documents, scores, usage, pricing, and fixtures. Sub-skill of rerank-provider-onboarding."
user-invocable: true
---

# Research Rerank Provider

Create `docs/rerank-research/<provider>.md` from primary sources and redacted captures.

Before starting, check the launch/chat thread for provider capabilities already dropped in by
the requester; treat them as the primary capability input and reconcile them against provider
documentation rather than starting from scratch.

## Capability and capture matrix

Record query, string documents, structured `{text,image}` documents, `top_n`, max sizes, result
ordering, relevance-score range, provider model IDs, auth, regions, and errors. Capture success,
invalid documents, empty documents, invalid `top_n`, provider failures, and large image payloads.
Rerank has no streaming path (`services/cfw-rerank-api/src/routes/rerank/submit.ts`).

Enumerate the provider's full advertised parameter surface (document types, size limits, provider
options, and every enumerated value), so the adapter PR can extend the serving schemas where
needed (see the completeness rule in `rerank-add-adapter`).

## Billing and fixtures

Reconcile `total_tokens`, `search_units`, `cost`, minimums, batch-like provider behavior if any,
and BYOK with the pricing strategy. Use `create-fixtures` for requests/responses/errors and record
the adapter/base choice, endpoint fields, pricing JSON, and open questions.

## Related skills

- `rerank-provider-onboarding`
- `rerank-add-adapter`
- `rerank-stage-endpoint`
- `rerank-e2e-testing`
- `create-fixtures`

## Key source files

- `packages/rerank/adapters/base.ts`
- `packages/rerank/adapters/adapter-factory.ts`
- `packages/rerank-interfaces/schemas/request/index.ts`
- `packages/rerank-interfaces/schemas/response/index.ts`
- `services/cfw-rerank-api/src/routes/rerank/submit.ts`
