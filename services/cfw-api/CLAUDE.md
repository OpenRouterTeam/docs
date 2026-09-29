# cfw-api Agent Guidelines

Service-specific rules for `services/cfw-api`. The root [AGENTS.md](../../AGENTS.md) still applies — this file adds constraints unique to the primary Cloudflare Worker API gateway.

## Startup CPU Time Constraint

cfw-api runs on Cloudflare Workers, which enforce a **1-second CPU time limit during script startup** (error code 10021). This is the single most persistent operational constraint for this service.

For startup optimization history, measurement tools, architecture context, and what has already been tried, see the **cfw-api-startup-optimization** skill (`.agents/skills/cfw-api-startup-optimization/SKILL.md`). For request-path CPU, memory and latency measurement, see the **cfw-api-cpu-memory-optimization** skill (`.agents/skills/cfw-api-cpu-memory-optimization/SKILL.md`).

---

## `buildZodGuard` AOT generation

cfw-api consumes an ordered list of guards generated ahead of time by
`zod-compiler`. The generator evaluates the complete production graph in an
isolated, build-only workerd, records every module-level `buildZodGuard` call,
and emits direct predicates plus complete program factories to
`src/generated-zod-guards.js`. Every generated slot is compiled. Predicates
that do not capture compiler state are used directly; the remaining slots are
`null` markers backed by a compact factory list that re-materializes each
zod-compiler program with the live schema. Native Zod remains an intentional
fallback outside the configured production graph or when a factory fails at
runtime. The deployed worker never imports `zod-compiler` or generates code.

The generated list is positional, so production import order is part of its
contract. `src/index.ts` imports `src/apply-patches-api.ts` as its first
non-type import. That module applies stream patches, then imports the aliased
`@/zod-guard-bootstrap`, which configures the generated guards before
importing guard-bearing modules. The bootstrap runs only in non-Bun production
or staging runtimes when `SERVICE_NAME` is `api` or `api-perf`. The shared
`src/apply-patches.ts` retains the JIT compiler path for sibling workers.
`src/router-streaming-startup.ts` pins the router preload order, and
`src/index.ts` asserts that startup consumed the exact list. Wrangler runs the
stale-artifact check before every production bundle. After changing a guarded
schema or its module-evaluation order, regenerate and check the artifact:

```sh
cd services/cfw-api
bun scripts/generate-zod-guards.ts
bun scripts/generate-zod-guards.ts --check
```

Bun tests, local development, partial Miniflare graphs, and guards constructed
after startup use native Zod. This prevents a partial or request-time graph from
pairing a generated predicate with the wrong schema. `importRouter()` remains
the single async accessor used by the inference routes to preserve their
existing call signatures.

---

## Rules for Contributing to cfw-api

### Do NOT do these things

1. **Do not add new barrel imports.** Always use named subpath imports (e.g., `import { pipe } from 'effect/Function'` not `import { Effect, pipe } from 'effect'`). Barrel imports pull entire packages into the bundle. The `openrouter/no-barrel-imports` oxlint rule enforces this. The cfw-api static `Router` import is a documented exception because `Router` is declared in `packages/router/index.ts`, which is the barrel itself, so there is no lighter module to import it from.

2. **Do not add large new dependencies** without measuring bundle impact. Run `bun run cf:bundle` before and after, compare sizes.

3. **Do not move route handlers to dynamic `import()` for OpenAPI-registered routes.** `doc()` builds the document at request time from `openAPIRegistry.definitions`, whose order follows `openapi()` and `route()` registration order; schema construction order is not the mechanism. Dynamic route imports can still make route registration asynchronous and break OpenAPI generation and integration tests. Keep skin schemas eager when statically registered routes hold them directly or AOT guard generation consumes them; see [`buildZodGuard` AOT generation](#buildzodguard-aot-generation), item 5, and the `cfw-api-startup-optimization` skill for the current export counts.

4. **Do not assume minification fixes startup time.** It does not. Startup CPU is dominated by top-level code execution, not parsing.

5. **Do not add heavy top-level expressions** (large object literals, Zod schema construction, class instantiation) in files that are transitively imported by `app.ts` or `index.ts`. Prefer lazy initialization behind functions.

   `src/router-streaming-startup.ts` pins evaluation order relative to the
   `apply-patches-api` startup module and its aliased `@/zod-guard-bootstrap`
   import, and explicitly enumerates router modules whose guards must consume
   generated predicates during startup. Other statically reachable
   modules also consume their positional entries. A module first imported at
   request time falls back to native Zod. Regenerate the artifact after any
   guard or import-order change, and measure additions with the upload timing
   script.

### DO these things

1. **Measure before and after.** Use `bun run cf:bundle` for bundle size. For startup time, use the upload timing script (`scripts/time-cloudflare-worker-upload.ts`) from the monorepo root with `--sample-size 10` or higher — this measures actual upload success rate against Cloudflare's validation environment and is the only reliable measurement tool.

2. **Prefer extracting routes to other workers** (`cfw-public-api` for public API routes, `cfw-internal` for OR-specific routes, `cfw-frontend-api` for routes needed by the web app) over trying to defer them within cfw-api. This is the proven strategy that reliably reduces both bundle size and startup time.

3. **Use subpath imports** for all external and internal packages. Check that tree-shaking is effective by running `bun run cf:bundle:analyze`.

4. **Stub unused transitive dependencies** via wrangler `[alias]` in wrangler.toml when a runtime dep pulls in large libraries that are never called. Create a stub file exporting no-ops and point the alias at it. No hard evidence this reduces startup time specifically, but reducing bundle size is directionally helpful.

5. **Use `buildZodGuard`** for Zod schemas on hot paths (response transformation, anything running per-chunk or per-request). Construct it at module level and regenerate the AOT artifact. The generated predicate improves runtime validation while moving compiler work out of production startup; factory failures safely retain native Zod and emit a degraded-mode signal.

6. **Track deploy metrics.** After changes that affect the bundle, check the Datadog deploy dashboard (<https://us5.datadoghq.com/dashboard/fj3-pdx-vtk>) for `startup_time_ms` and `retry_count` trends.

7. **Read benchmark data from KV, not DB, on hot paths.** DA and AA benchmark rows are pre-warmed into KV by `cfw-internal`'s 12-hour ingestion cron (`refresh-aa-benchmarks` / `refresh-da-benchmarks`). Use `cfDABenchmarksCache` / `cfAABenchmarksCache` from `@/kv`. Never call `getDABenchmarks()` or `getAABenchmarks()` per-request — those queries `INNER JOIN public_models` and cause ~20k index scans/sec on the models table at production traffic levels. Direct DB reads are fine in the KV warmer itself (`warmKVModelsAndEndpoints`), in rate-limited Data API `/benchmarks/*` endpoints that use their own `ColoCache`, and in admin, internal, or cron routes.

8. **No database writes in inference paths.** `INSERT` / `UPDATE` / `DELETE` must not run in request-serving code. Writes belong in background jobs, usage-record pipelines, or post-response hooks.

9. **No per-isolate caching (unless rarely-updated and request-independent).** Do not cache data in module-level `Map`s, `Set`s, or plain objects. Isolate-local caches diverge across the fleet, are invisible to monitoring, and cause high query volume when the cached value varies per user or request. Per-isolate caches are acceptable **only** for rarely-updated, request-independent data (e.g., a global feature-flag set that changes once a day).

10. **Use auth service / `getUserByKey` for per-user data.** Any data scoped to a user or organization should come from the auth service or `getUserByKey`, which already runs once per request. Do not query the database directly during inference for per-user data.

11. **Use Hyperdrive-cached connection for necessary hot-path queries.** When a query genuinely cannot be moved into the auth service and must execute during inference, use the Hyperdrive-cached connection string so the connection is pooled and responses are cached at the Cloudflare edge. Never open a direct database connection from a hot inference path. **Caveat:** Hyperdrive has shown degraded reliability under heavy load — timeouts and failed deliveries increase significantly at high request volumes. Treat it as a last resort, not a default. Strongly prefer moving data into the auth service or KV before resorting to Hyperdrive queries on every inference request.

12. **Debug request processing through dev-fs-logs, not `console.log`.** Run `bun run dev dev-fs-logs` and read `services/dev-fs-logs/.logs/gen-<id>/`, which captures structured logs per generation: `router/original-request.trim.log` (raw incoming request), `router/request-body.trim.log` (parsed body), `router/transaction-attempt.trim.log` (transaction metadata, including each plugin's `getLogMeta()` output in the `plugins` array), `router/routing/step.trim.log` (routing decisions), and `adapters/base-fetch-request.trim.log` (upstream provider request).

13. **Shape route schemas for the OpenAPI generator.** Zod schemas under `src/routes/` feed the published spec and the generated SDKs — see [OpenAPI schemas](../../packages/router/AGENTS.md#openapi-schemas) in the router guidelines for the naming, example, discriminator, and numeric-format requirements.

14. **Capture flamegraphs through wrangler's own DevTools.** Run `bunx wrangler dev` from inside `services/cfw-api` and press `d`, which opens <https://devtools.devprod.cloudflare.dev/> with the Performance tab available. `bun run dev cfw-api` from the monorepo root cannot launch it, and `chrome://inspect` does not work against Workers.

15. **Use the perf worker's Previews for request-path measurement.** The upload timing script measures startup only and deploys nothing routable. Follow the [`cfw-api-cpu-memory-optimization`](../../.agents/skills/cfw-api-cpu-memory-optimization/SKILL.md) runbook for the Preview's isolation and binding deltas, deployment, request measurement, Access setup and cleanup.

16. **Keep the router latency coverage map current.** When a change to an inference route or its middleware moves where the `RouterLatencyV2Recorder` starts, or adds, moves or removes a step before first dispatch, update [`docs/router-latency-coverage.html`](../../docs/router-latency-coverage.html) in the same PR. Examples of such steps: auth, body read, HIPAA dispatch, response cache, region lock, Clerk. Follow [`packages/instrumentation/router-latency-v2/AGENTS.md`](../../packages/instrumentation/router-latency-v2/AGENTS.md).
