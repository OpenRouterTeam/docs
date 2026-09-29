---
name: embeddings-research-provider
description: "Phase 1: research an embeddings provider API, batching, response, pricing, and fixtures. Sub-skill of embeddings-provider-onboarding."
user-invocable: true
---

# Research Embeddings Provider

Create `docs/embeddings-research/<provider>.md` from primary sources and redacted captures.

Before starting:

- Check the launch/chat thread for provider capabilities already dropped in by the requester;
  treat them as the primary capability input and reconcile them against provider documentation
  rather than starting from scratch.

## Documentation and capability matrix

Record model IDs, dimensions, encoding formats, max input/chunk size, batching, token limits,
text, image, audio, video, and file/PDF inputs, authentication, regions, and errors. Map each
capability to `packages/embedding-interfaces/schemas/request/index.ts`.

Enumerate the provider's full advertised parameter surface (dimensions, encoding formats, input
types, batch limits), not just the values the first model uses, so the adapter PR can extend the
serving schemas where needed (see the completeness rule in `embeddings-add-adapter`).

## Capture matrix

Capture single and array inputs, numeric inputs if supported, multimodal content, dimensions and
encoding options, batch/non-batch behavior, oversized/chunked inputs, provider errors, malformed
vectors, and usage/token details. Include request/response headers and redacted media.

## Billing reconciliation

Reconcile provider pricing with token estimator output, `prompt_tokens_details` (text/image/audio/
video/file tokens), batch pricing, minimums, and BYOK. Record exact pricing JSON and SKU names.

## Fixture and note shape

Use `create-fixtures`; store success, multimodal, batch, and error payloads. Include sources,
adapter/base choice, endpoint fields, pricing, open questions, and fixture inventory.

## Related skills

- `embeddings-provider-onboarding`
- `embeddings-add-adapter`
- `embeddings-stage-endpoint`
- `embeddings-e2e-testing`
- `create-fixtures`

## Key source files

- `packages/embeddings/README.md`
- `packages/embeddings/adapters/base.ts`
- `packages/embeddings/estimator/index.ts`
- `packages/embeddings/routing/filter-by-batch-support.ts`
- `packages/embedding-interfaces/schemas/request/index.ts`
- `packages/embedding-interfaces/schemas/response/index.ts`
