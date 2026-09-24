# Service Agent Guidelines

Every live-config schema key must have a `.default()`. Every schema passed to
`createGetLiveConfig` must have a colocated test that calls
`validateLiveConfigSchema`. A cold isolate read throws for a key without a
default.

Worker integration tests run in workerd through miniflare against real
Postgres and KV. `services/cfw-api/integration/AGENTS.md` holds the
conventions (what may be mocked, KV seeding, response assertions, banned
patterns); other services follow their own `vitest.*.config.mts`.

Live-config reads must never block on KV. A cold isolate serves the schema
default and refreshes in the background, so do not add `awaitFirstSync` call
sites or any other wait on the KV read in a request path — see `REVIEW.md`.

## Route placement

**Do not add new routes to `cfw-api`.** It is frozen to mitigate startup-time increases that degrade inference performance. Place new routes in the appropriate worker:

- **`cfw-public-api`** — Publicly documented routes
- **`cfw-frontend-api`** — Routes serving the user-facing web app (`projects/web`) only
- **`cfw-internal`** — OpenRouter internal use only, including all Mission-Control-only routes (pinned to us-central1)

A unit test in `services/cfw-api/src/app.test.ts` enforces this by failing if unrecognized route prefixes appear. **Do not add entries to the allowlist in that test** — move the route to the correct worker instead.

## Scheduled and long-running work

Scheduled jobs and multi-step admin operations run as Cloudflare Workflows in `cfw-internal`, not as Vercel crons, Graphile jobs, or `waitUntil` fan-out. A scheduled job is a `CronTask` run by `CronTaskWorkflow` (`services/cfw-internal/src/routes/cron/AGENTS.md`). Work that an operator starts, that must survive a restart, or that needs a reviewable run record is its own Workflow recording into `workflow_runs` (`services/cfw-internal/src/workflows/AGENTS.md`).

## Cloudflare resources

Create and change Cloudflare resources (DNS records, zone settings, WAF and cache rules, KV namespaces, R2 buckets, queues, access policies) with Terraform in the `terraform/cloudflare-prod` stack of the [`openrouter-infra`](https://github.com/OpenRouterTeam/openrouter-infra) repo. Resources already declared by a Terraform stack in this repo (for example `projects/web/infra`, `services/cfw-api/infra`, `packages/db/infra`) stay with that stack until their state is imported and the old declaration removed; do not redeclare them elsewhere. Do not make changes in the Cloudflare dashboard: they leave no review trail and drift from Terraform state, which reverts or breaks them on the next apply. Worker code and `wrangler.toml` bindings stay in this repo.

## Worker bundle dependencies

Make new dependencies tree-shakeable in worker builds. Before adding or bumping a dependency reached from a Worker, check that its `exports` map serves ESM under wrangler's conditions (`workerd`, `worker`, `browser`). A package whose ESM entry sits only behind `esnext`/`module` resolves to CommonJS, which esbuild cannot tree-shake. Patch its `exports` to add `workerd`/`worker` entries pointing at the ESM build, and confirm the saving in `dist/bundle-meta.json` — see `.agents/skills/cfw-api-startup-optimization/SKILL.md`.

## Worker response caching

Prefer [Workers Cache](https://developers.cloudflare.com/workers/cache/) over the older Cache API (`caches.default` / `caches.open()`) for caching a worker's own responses. Workers Cache runs _before_ the worker, so a hit costs no worker execution at all, while a Cache API hit only happens once the worker is already running. Enable it per worker with `[cache] enabled = true` in `wrangler.toml` and control it with `Cache-Control` directives on the response. A response with neither a `Cache-Control` nor an `Expires` header is still cached for a default heuristic TTL (for example, a `200` for two hours), so set `Cache-Control` explicitly (e.g. `no-store`) on responses that must not be cached. No zone-level cache configuration (Cache Rules, Page Rules, cache level) applies to it, and its cache key includes the full query string. Because a hit is served before the worker runs, the cached worker cannot normalize the key for its own incoming requests — collapse URL variants with a gateway entrypoint (caching disabled) that rewrites the URL or sets a custom `cf.cacheKey` before dispatching to the cached entrypoint.

## Custom metrics for Worker services

Low-level Worker metrics (invocations, CPU/wall time, request duration,
memory, isolates, Workers Cache) are captured automatically by the shared
observability template. Service-specific metrics are owned by the service:

- Emit via `getStatsd()` from
  `@openrouter-monorepo/instrumentation/statsd`.
- Namespace as `openrouter.<service>.*` with snake_case metric names.
- Use only low-cardinality tags. Never tag with user IDs, raw request
  paths, or other unbounded values.
- In the same PR, add the metric's widgets to the service's dashboard by
  passing `custom_widgets` to the service's `cfw_service_dashboard` module
  instance in
  `configs/terraform-monitors/monitoring/cfw_service_dashboard.tf`.
  Do not fork the dashboard module.
