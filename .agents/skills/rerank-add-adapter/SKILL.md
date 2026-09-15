---
name: rerank-add-adapter
description: "Phase 2: add an API-only rerank provider adapter with text/image document mapping, usage, pricing, registration, and tests. Sub-skill of rerank-provider-onboarding."
user-invocable: true
---

# Add Rerank Adapter

Implement from a completed research note and captured fixtures.

## Files and contract

- `packages/enums/adapters.ts`
- `packages/rerank/adapters/<provider>/index.ts` and tests
- `packages/rerank/adapters/adapter-factory.ts`
- `packages/rerank/configs/get-adapter-name.ts`
- Provider pricing strategy/SKU and metadata files when required

Extend `BaseRerankAdapter` (`packages/rerank/adapters/base.ts`). Map `model`, `query`, string and
structured text/image `documents`, `top_n`, provider options, and provider response fields
`index`, `relevance_score`, `document`, `usage`. Preserve no-streaming behavior, safe fetch,
offloading for large media, BYOK, and normalized errors.

Cover the provider's full advertised parameter surface from the research note. Where the provider
supports values our serving schemas lack, extend the serving schemas
(`packages/rerank-interfaces/schemas/request/index.ts`) in the same PR. Never author endpoint
capability metadata that the serving schema rejects, and never drop a capability field to bypass
validation — fix the payload.

## Pricing and tests

Register token/search-unit/cost SKUs and pricing JSON. Mock fetch and test text, image documents,
ordering, scores, invalid input, non-2xx/malformed responses, large payload offloading, usage,
redaction, and cost. Use `create-fixtures`.

```bash
bun run --filter @openrouter-monorepo/rerank test
bun run --filter @openrouter-monorepo/rerank typecheck
```

## Related skills

- `rerank-provider-onboarding`
- `rerank-research-provider`
- `create-fixtures`
- `add-provider-adapter`

Before opening the PR, review the change against `packages/rerank/REVIEW.md`.

## Key source files

- `packages/rerank/adapters/base.ts`
- `packages/rerank/adapters/adapter-factory.ts`
- `packages/rerank-interfaces/schemas/request/index.ts`
- `packages/rerank-interfaces/schemas/response/index.ts`
- `services/cfw-rerank-api/src/routes/rerank/submit.ts`
