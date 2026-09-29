# Embeddings Review Checklist

Patterns to flag when reviewing embeddings adapter and pricing changes.

## Adapter contract

- Adapter must extend `BaseEmbeddingsAdapter` (`packages/embeddings/adapters/base.ts`); flag
  hand-rolled transport, retry, logging, or SKU plumbing.
- Adapter factory/name mapping and provider config must be exhaustive
  (`packages/embeddings/adapters/adapter-factory.ts`,
  `packages/embeddings/configs/get-adapter-name.ts`).
- Text, numeric, image, audio, video, and file inputs are mapped only when the provider supports
  them; unsupported input types must be rejected, not silently dropped.
- Batch routing, chunking, token estimation, and Durable Object offloading are bounded; request
  media is not retained on long-lived fields.

## Response and usage

- Vectors, indexes, model, usage, and `prompt_tokens_details` are parsed with Zod against
  `packages/embedding-interfaces/schemas/response/index.ts`.
- Dimensions and `encoding_format` are preserved end-to-end; empty vectors and malformed JSON map
  to the shared error tree.
- Non-2xx responses preserve status and safe provider error details; keys and media are redacted
  in logs; unconsumed fetch bodies are cancelled.

## Pricing and SKUs

- Per-token and modality-specific SKUs, pricing JSON, and public metadata agree; mixed inputs
  split into per-modality SKUs rather than billing only a total.
- Usage details from the estimator (`packages/embeddings/estimator/index.ts`) reconcile with
  provider-reported token counts.

## Fixtures and tests

- Real provider fixtures exist for success, multimodal, batch, and error payloads; tests cover
  every advertised input and batch mode.
- Provider values missing from the serving schemas in
  `packages/embedding-interfaces/schemas/request/index.ts` are added in the same adapter PR,
  never dropped from the capability metadata.
