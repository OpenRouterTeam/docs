# Decisions Review Checklist

Patterns to flag when reviewing decisions adapter and pricing changes.

## Adapter contract

- Adapter must extend `BaseDecisionsAdapter` (`adapters/base.ts`); flag hand-rolled transport,
  retry, logging, or SKU plumbing.
- Factory/name mapping and provider configuration must be exhaustive
  (`adapters/adapter-factory.ts`, `configs/get-adapter-name.ts`).
- `state` and `questions` are validated before provider-specific mapping.
- Streaming must not be advertised or implemented — decisions is API-only and non-streaming.
- Large request bodies use the shared Durable Object offloading path, not inline buffering.

## Capability metadata

- Provider values missing from the serving schemas
  (`packages/decisions-interfaces/schemas/request/index.ts`) must be extended in the same
  adapter PR, never dropped from capability metadata.
- Endpoint capability metadata must be schema-valid; flag payloads authored to bypass
  validation.

## Response handling and errors

- Answer keys, answer types, usage, and cost normalize correctly.
- Non-2xx and malformed provider responses map to normalized errors with safe details;
  API keys and provider payloads are redacted in logs.
- Tests cover malformed provider responses and provider failures.

## Pricing and usage

- Pricing JSON, token SKUs, emitted usage, and public metadata reconcile.
- Prompt and completion tokens reconcile against a live capture or invoice.

## Fixtures

- Research captures and fixtures represent real provider behavior; tests use real captured
  payloads where upstream behavior changed.
