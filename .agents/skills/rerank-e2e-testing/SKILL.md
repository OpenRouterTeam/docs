---
name: rerank-e2e-testing
description: "Phase 4: run API-only local rerank end-to-end tests with text/image documents, scores, usage, billing, and logs. Sub-skill of rerank-provider-onboarding."
user-invocable: true
---

# Rerank E2E Testing

Run the non-streaming API through `cfw-rerank-api` on port `8790`.

## Scenarios

Test text documents, structured text/image documents, `top_n`, invalid documents, empty input,
provider failure, large payload offloading, response ordering/indexes/relevance scores, and
absence of streaming behavior. Reconcile `total_tokens`, `search_units`, `cost`, pricing JSON,
and emitted SKUs; inspect `dev-fs-logs`.

## After local testing

Production verification is owned by the launch process, not this skill: see
`docs/runbooks/model-launch.md` (§3 staging/private access).

## Done when

- Text, image, invalid, score/order, usage, billing, logs, and no-stream assertions pass.
- Temporary local visibility changes and test data were cleaned up.

## Related skills

- `rerank-provider-onboarding`
- `rerank-stage-endpoint`
- `multimodal-daily-report`
- `debug-capsule`

## Key source files

- `packages/rerank-interfaces/schemas/request/index.ts`
- `packages/rerank-interfaces/schemas/response/index.ts`
- `services/cfw-rerank-api/src/routes/rerank/submit.ts`
