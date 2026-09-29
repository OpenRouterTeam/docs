---
name: rerank-provider-onboarding
description: "Entrypoint for onboarding an API-only rerank provider from capability research through adapter, staging, and end-to-end verification."
user-invocable: true
---

# Rerank Provider Onboarding

Rerank is API-only and does not support streaming. Run:

1. `rerank-research-provider`
2. `rerank-add-adapter`
   Review the result against `packages/rerank/REVIEW.md` before opening the PR.
3. `rerank-stage-endpoint`
4. `rerank-e2e-testing`

Capture query/document limits, `top_n`, text and image documents, result ordering, scores, usage,
search units, cost, provider errors, and Durable Object offloading behavior.

## PR stack and gates

Provider foundation → research/fixtures → adapter/pricing/tests → Postgres/KV staging → local
API evidence. Keep model/endpoint capabilities data-driven and reconcile token/search-unit
pricing. Cross-reference `multimodal-daily-report`.

## Related skills

- `rerank-research-provider`
- `rerank-add-adapter`
- `rerank-stage-endpoint`
- `rerank-e2e-testing`
- `stage-endpoint`
- `add-provider-adapter`
- `create-fixtures`
- `multimodal-daily-report`

## Key source files

- `packages/rerank/README.md`
- `packages/rerank/adapters/base.ts`
- `packages/rerank-interfaces/schemas/request/index.ts`
- `packages/rerank-interfaces/schemas/response/index.ts`
- `services/cfw-rerank-api/src/routes/rerank/submit.ts`
