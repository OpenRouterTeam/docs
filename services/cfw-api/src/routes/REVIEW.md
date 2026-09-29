# Route Schema Review Checklist

Common pitfalls and patterns to watch for when authoring or reviewing Hono route schemas that feed into our OpenAPI spec and Speakeasy SDK generation.

## Zod + OpenAPI type alignment

**Problem:** Zod schemas that use `z.string().transform(...)` to coerce query params into numbers will cause Speakeasy to infer the _input_ type (`string`) rather than the _output_ type (`number`). This produces SDK functions with incorrect parameter types (e.g. `string | number` instead of `number`), which can break downstream TypeScript compilation.

**Fix:** When a query parameter is semantically numeric, prefer `z.coerce.number()` (which handles the string-to-number conversion automatically) and add an explicit `.openapi({ type: 'integer' })` override so the generated spec reflects the intended type.

```ts
// Bad - Speakeasy infers `string` from the Zod input type
z.string()
  .optional()
  .transform((v) => parseInt(v ?? '0', 10))
  .openapi({ description: '...' });

// Good - coerce handles parsing; openapi metadata matches the output type
z.coerce.number().int().min(0).default(0).openapi({
  type: 'integer',
  description: '...',
  example: 0,
});
```

### Why this matters

The OpenAPI spec is the single source of truth for our generated TypeScript and Python SDKs. A type mismatch in the spec silently propagates through Speakeasy generation, Copybara export, and npm/PyPI publish before anyone notices. Catching it at the schema level is the cheapest place to fix it.

### Checklist

- [ ] Every `.openapi()` call has an explicit `type` that matches the parameter's semantic type, not its raw HTTP wire type.
- [ ] `example` values conform to the declared `type` (e.g. `example: 0` for `type: 'integer'`, not `example: '0'`).
- [ ] Numeric query params use `z.coerce.number()` instead of `z.string().transform(...)`.
- [ ] After adding or changing `.openapi()` metadata, run `bun run generate:openapi` locally and check that the `openrouter-openapi.yaml` diff carries the intended `type`; SDK regeneration runs in CI (`.github/workflows/sdk-auto-regenerate-on-merge.yaml`).

## Keys API write rate limits stay on Redis

The create/update/delete API key routes use the Upstash Redis slow limiters from `packages/rate-limit` (`rate-limits.ts`). A migration to Cloudflare-native rate limiting was reverted; don't re-introduce CF-native bindings for these write limits without revisiting that revert.

*Source: [PR #26925](https://github.com/OpenRouterTeam/openrouter-web/pull/26925), reverting [PR #26830](https://github.com/OpenRouterTeam/openrouter-web/pull/26830).*

## Datadog monitoring for new routes

When adding or modifying API routes, register them in the `api_error_rate` Terraform module at `configs/terraform-monitors/monitoring/api_error_rate.tf`. This gives you traffic-gated error rate monitors and auto-generated dashboards. Do not create standalone log-based monitor modules — they lack traffic gating and false-alarm on low volume.
