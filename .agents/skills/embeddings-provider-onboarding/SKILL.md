---
name: embeddings-provider-onboarding
description: "Entrypoint for onboarding an embeddings provider from capability research through adapter, staging, and API end-to-end verification."
user-invocable: true
---

# Embeddings Provider Onboarding

Embeddings is an API-only modality with text and multimodal inputs, batch routing, token usage,
and vector output. Run the phases as one ordered stack:

1. `embeddings-research-provider`
2. `embeddings-add-adapter` — review the result against `packages/embeddings/REVIEW.md` before
   opening the PR.
3. `embeddings-stage-endpoint`
4. `embeddings-e2e-testing`

Capture provider model IDs, dimensions, encoding formats, input media, batch limits, token
estimation, pricing units, and error behavior before implementation. Keep capabilities in model
and endpoint metadata; do not hardcode them in an adapter.

## PR stack

Provider foundation → research/fixtures → adapter/pricing/tests → Postgres/KV staging → local
API evidence. The stack owns no UI phase; cross-reference `multimodal-daily-report` after
launch.

## Gates

- Request and response schemas support every advertised input and vector shape.
- Batch and non-batch routing, chunking, token estimation, and Durable Object offloading are tested.
- Dimensions, encoding format, prompt token details, and per-token SKU reconciliation agree.
- Production verification is owned by the launch process; see `docs/runbooks/model-launch.md`
  (§3 staging/private access).

## Related skills

- `embeddings-research-provider`
- `embeddings-add-adapter`
- `embeddings-stage-endpoint`
- `embeddings-e2e-testing`
- `stage-endpoint`
- `add-provider-adapter`
- `create-fixtures`
- `multimodal-daily-report`

## Key source files

- `packages/embeddings/README.md`
- `packages/embeddings/adapters/base.ts`
- `packages/embedding-interfaces/schemas/request/index.ts`
- `packages/embedding-interfaces/schemas/response/index.ts`
- `services/cfw-embeddings-api/src/app.ts`
