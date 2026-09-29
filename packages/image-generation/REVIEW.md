# Image Generation Review Checklist

Patterns to flag when reviewing image-generation adapter and pricing changes.

## Adapter contract

- Adapter must extend `BaseSyncImageGenerationAdapter` or `BaseAsyncImageJobAdapter`; flag
  hand-rolled transport, retry, logging, or SKU plumbing.
- `validateImageRequestCapabilities` must run before provider-specific mapping in
  `buildUpstreamRequestBody`.
- No image capability constants hardcoded in the adapter — image limits are endpoint-owned in
  `supported_image_parameters`.
- Shared `resolve-artifact`, input-reference, provider-option, and sanitization helpers are
  reused, not reimplemented.
- Async polling is bounded; terminal states cannot loop forever.

## Capability metadata

- Every field declared in `supported_image_parameters` is honored by `buildUpstreamRequestBody`;
  conflict-only or ignored fields must be absent from the capability row.
- Capability values validate against `SupportedImageParametersSchema`
  (`packages/db/endpoints/index.ts`). Provider values missing from the serving enums
  (`packages/enums/image-parameters.ts`) must be added in the same adapter PR, never dropped
  from the row.
- `supported_image_parameters` is treated as nullable and never silently over-advertises a field.

## Error handling and logging

- Non-2xx responses preserve status and safe provider error details; invalid JSON, network
  errors, empty image data, timeout, moderation, and retry-after map to the shared error tree.
- Multipart and offloaded fetches do not materialize unbounded image bytes in the worker.
- API keys, base64 bodies, prompts, input references, and signed URLs are redacted;
  `this.logContext` fields and provider request IDs appear in structured logs.

## Pricing and SKUs

- SKU names and units match `packages/pricing/strategies/<provider>/skus.ts`; `pricing_json`
  validates and includes every required tier or variant.
- Per-image, token, megapixel, input-image, resolution, and minimum-charge rules are reconciled
  against a live capture or invoice; `get-image-pricing.ts` projects the intended public
  `PricingEntry[]`.
- Usage and cost are correct for `n > 1`, edits, streaming completion, partial streams, and
  async results.

## Response schema and fixtures

- `data[].b64_json` is non-empty and decodes to the expected image bytes; `media_type` is
  correct or omitted only when unknown.
- Success, refusal, malformed response, and provider error fixtures are checked in; tests use
  real captured payloads where upstream behavior changed.
