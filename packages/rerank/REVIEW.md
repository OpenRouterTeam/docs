# Rerank Review Checklist

Patterns to flag when reviewing rerank adapter and pricing changes.

## Adapter contract

- Adapter must extend `BaseRerankAdapter` (`adapters/base.ts`); flag hand-rolled transport,
  retry, logging, or SKU plumbing.
- Factory/name mapping and provider configuration must be exhaustive
  (`adapters/adapter-factory.ts`, `configs/get-adapter-name.ts`).
- `query`, `documents`, `top_n`, provider options, and structured text/image inputs are
  validated before provider-specific mapping.
- Streaming must not be advertised or implemented — rerank is API-only and non-streaming.
- Large image documents use the shared Durable Object offloading path, not inline buffering.

## Capability metadata

- Provider values missing from the serving schemas
  (`packages/rerank-interfaces/schemas/request/index.ts`) must be extended in the same
  adapter PR, never dropped from capability metadata.
- Endpoint capability metadata must be schema-valid; flag payloads authored to bypass
  validation.

## Response handling and errors

- Response ordering, `index`, `relevance_score`, `document`, usage, search units, and cost
  normalize correctly.
- Non-2xx and malformed provider responses map to normalized errors with safe details;
  API keys, documents, and provider payloads are redacted in logs.
- Tests cover invalid documents, invalid `top_n`, and provider failures.

## Pricing and SKUs

- Pricing JSON, token/search-unit SKUs, emitted usage, and public metadata reconcile.
- `total_tokens`, `search_units`, and `cost` are reconciled against a live capture or
  invoice.

## Fixtures

- Research captures and fixtures represent real provider behavior; tests use real captured
  payloads where upstream behavior changed.
