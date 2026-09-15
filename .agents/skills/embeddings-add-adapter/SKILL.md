---
name: embeddings-add-adapter
description: "Phase 2: add an embeddings provider adapter with multimodal mapping, batch routing, pricing, registration, and tests. Sub-skill of embeddings-provider-onboarding."
user-invocable: true
---

# Add Embeddings Adapter

Implement from a completed embeddings research note and captured fixtures.

## Files to touch

- `packages/enums/adapters.ts`
- `packages/embeddings/adapters/<provider>/index.ts` and tests
- `packages/embeddings/adapters/adapter-factory.ts`
- `packages/embeddings/configs/get-adapter-name.ts`
- `packages/embeddings/configs/model-capabilities.ts`
- Pricing strategy/SKU registration and provider metadata when needed

## Adapter contract

Extend `BaseEmbeddingsAdapter` in `packages/embeddings/adapters/base.ts`. Transform text, arrays,
numeric inputs, and structured `text`, `image_url`, `input_audio`, `input_video`, and `input_file`
content. Preserve dimensions and `encoding_format`; parse vectors, indexes, model, usage, and
`prompt_tokens_details` with Zod.

Respect batch support routing, chunking, token estimation, provider keys/BYOK, safe fetch, and
Durable Object hydration/offloading. Do not retain request media on long-lived fields.

If the research note documents provider values the serving schemas in
`packages/embedding-interfaces/schemas/request/index.ts` lack, extend those schemas in the same
adapter PR. Fix the payload rather than dropping a capability field to bypass validation.

## Pricing and tests

Register per-token and modality-specific SKUs, pricing JSON, and strategy. Mock fetch and cover
single/batch requests, multimodal mappings, dimensions/encoding, malformed vectors, errors,
chunking, usage, redaction, and SKU totals. Use `create-fixtures`.

```bash
bun run --filter @openrouter-monorepo/embeddings test
bun run --filter @openrouter-monorepo/embeddings typecheck
```

## Related skills

- `embeddings-provider-onboarding`
- `embeddings-research-provider`
- `create-fixtures`
- `add-provider-adapter`

Before opening the PR, review the change against `packages/embeddings/REVIEW.md`.

## Key source files

- `packages/embeddings/adapters/base.ts`
- `packages/embeddings/adapters/adapter-factory.ts`
- `packages/embeddings/configs/get-adapter-name.ts`
- `packages/embeddings/estimator/index.ts`
- `packages/embedding-interfaces/schemas/request/index.ts`
- `packages/embedding-interfaces/schemas/response/index.ts`
