---
name: add-cloudflare-worker
description: Add a new Cloudflare Worker service to the OpenRouter monorepo — covers scaffold, wrangler config, CI/CD, Tiltfile, and production checklist
user-invocable: true
---

# Add a new Cloudflare Worker

Checklist for creating a new `cfw-*` service in the OpenRouter monorepo.

## Decide worker type

- **Inference-path** (rerank, embeddings, video) — shares cfw-api code via `@/` path alias, uses Hyperdrive/KV/rate limiters/usage-record. Ref: `services/cfw-rerank-api/`
- **Standalone** (internal, webhooks) — own env type, own middleware, `createApp()` factory. Still needs Hyperdrive if using `packages/db` (DB middleware requires it). Ref: `services/cfw-internal/`
- **Lightweight** (docs-proxy, eu-probe) — minimal deps, simple wrangler.toml. Ref: `services/cfw-eu-probe/`

## 1. Scaffold

```bash
mkdir -p services/cfw-<name>/src
```

Convention: directory = `cfw-<name>`, wrangler name = `<name>` (no `cfw-` prefix).

## 2. package.json

Copy from the closest reference worker and adjust:
- `name`: `@openrouter-monorepo/cfw-<name>`
- `datadog:sourcemaps --service`: must match `cloudflare-dashboard-name` in CI
- `dev`/`start`: include `--persist-to ../../.wrangler/shared-state` (see Step 14)
- `x` script: update `--path=/services/cfw-<name>` (Infisical project ID: `771b7bc0-6578-41b0-886e-9fcdb66e9173`)
- Use `catalog:` for shared versions (hono, wrangler, vitest), `workspace:*` for monorepo packages

Add `services/cfw-<name>/scripts/dev.ts` that calls `wranglerDevEnv()` and starts wrangler with `zx({ env: wranglerEnv })`, so the worker's Infisical secrets reach wrangler in memory (no `.dev.vars`), then set `"dev": "bun run x scripts/dev.ts"`. Ref: `services/cfw-internal/scripts/dev.ts`

## 3. tsconfig.json

Copy from reference worker. Key difference by type:

- **Inference-path**: `"@/*": ["./src/*", "../cfw-api/src/*"]` — falls back to cfw-api source. Ref: `services/cfw-rerank-api/tsconfig.json`
- **Standalone**: `"@/*": ["./src/*"]` only. Ref: `services/cfw-internal/tsconfig.json`

## 4. tsconfig.build.json

- [ ] Copy from reference worker — the `references` array and root `tsconfig.json` entry are auto-synced by `bun run sync-tsconfig-refs` (runs on `postinstall`). Just run `bun install` after creating the file. Ref: `scripts/sync-tsconfig-refs.ts`

## 5. wrangler.toml

Copy from the closest reference worker. Key fields:

- `name` = dashboard name (e.g. `rerank-api`)
- `account_id` = `056879e63aa83db17aadc76220f52953`
- `compatibility_date` = `2024-09-25` or `2025-02-04`
- `compatibility_flags` — copy from reference worker
- Hyperdrive, KV, rate limiter, and service binding configs — copy IDs from `services/cfw-api/wrangler.toml`
- Service binding: `SVC_USAGE_RECORD` → `usage-record`
- `[vars]` must include `SERVICE_NAME = "<name>"` so `packages/db` attributes
  Postgres queries to the worker, and `OR_ENV = "production"` so
  `packages/instrumentation/logger.ts` takes its structured-logging branch.
  Set `OR_ENV` in `[vars]`, not Infisical — the value is the constant string
  `"production"` and is not a secret (cfw-fusion, usage-record, and
  cfw-secret-vault all set it here); without it `isProduction()` returns false
  and context fields reach Datadog as `[object Object]`.

For Durable Objects, add `[[durable_objects.bindings]]` + `[[migrations]]` and re-export class from `src/index.ts`. Ref: `services/cfw-video-api/wrangler.toml`

**Note:** Adding a DO migration will cause `wrangler versions upload` to fail with Cloudflare error code 10211 (migrations must be applied via non-versioned deployment). The deploy workflow (`.github/workflows/deploy-cloudflare-worker.yaml`) handles this automatically by falling back to `wrangler deploy`. Expect to see "falling back to bare deploy" in CI logs — this is normal.

For cron triggers, add `[triggers] crons = [...]` and `--test-scheduled` to start script. Ref: `services/cfw-internal/wrangler.toml`

## 6. Test setup

- [ ] `bunfig.toml` — copy from `services/cfw-rerank-api/bunfig.toml`
- [ ] `bun-test.setup.ts` — mock `@openrouter-monorepo/clients/clerk/hono-middleware` and `cloudflare:workers`. Copy from `services/cfw-rerank-api/bun-test.setup.ts`
- [ ] CI auto-discovers `test` script via `scripts/ci/run-unit-tests.ts` — no manual CI config needed

## 7. Source code

### env.ts

- **Inference-path**: extend `OpenRouterApiEnv` from `@openrouter-monorepo/cfw-api/env`. Must alias `CfwOpenRouterApiEnv = CfwNewWorkerEnv` so cfw-api imports resolve. Ref: `services/cfw-rerank-api/src/env.ts`
- **Standalone**: define own env type with Zod schema + `createEnsureEnvs()`. Ref: `services/cfw-internal/src/env.ts`

### app.ts

- **Inference-path**: direct `new OpenAPIHono<{Bindings}>()` export. Ref: `services/cfw-rerank-api/src/app.ts`
- **Standalone**: `createApp()` factory with error handler + `notFound404Err` catch-all. Ref: `services/cfw-internal/src/app.ts`

### index.ts

- Import `apply-patches` first (inference-path only), set up `CloudflareStatsd` + `setBreadcrumbs`, export via `instrumentWorker()`. Ref: `services/cfw-rerank-api/src/index.ts`
- For Durable Objects: re-export classes from index.ts. Ref: `services/cfw-video-api/src/index.ts`

### routes/health.ts

Simple `GET /` → `c.text('ok')`. Ref: `services/cfw-rerank-api/src/routes/health.ts`

### Route handlers

Use `createRoute()` from `@hono/zod-openapi` with tags, request/response schemas. Ref: `services/cfw-rerank-api/src/routes/rerank/submit.ts`

### DB context

No per-service file — `createDbMiddleware()` (mounted in `app.ts`) builds the context internally from `KV_LIVE_CONFIG` + Hyperdrive. Ref: `services/cfw-rerank-api/src/app.ts`

## 8. Middleware (standalone workers only)

- `middlewares/env.ts` — validate env with `ensureEnv()`. Ref: `services/cfw-internal/src/middlewares/env.ts`
- Admin auth — static API key via `checkStaticKeyHeader()`. Ref: `services/cfw-internal/src/middlewares/admin-auth.ts`
- Cron auth — `CRON_SECRET` check. Ref: `services/cfw-internal/src/middlewares/cron.ts`
- Inference-path workers get Clerk auth from cfw-api via `@/` alias — no custom middleware needed

## 9. Tiltfile

Add a `local_resource` block. Pick the next available port (current: 8787–8790).

```python
CFW_<UPPER>_PORT = os.environ.get('CFW_<UPPER>_PORT', '<port>')

local_resource(
    "<resource-name>",
    serve_cmd="cd services/cfw-<name> && bunx wrangler dev --port " + CFW_<UPPER>_PORT + " --persist-to " + SHARED_KV_PERSIST + DEV_COLLECTOR_WRANGLER_VARS,
    resource_deps=["postgres-seed", "usage-record"],
    labels=["apis"],
    links=[link('http://localhost:' + CFW_<UPPER>_PORT, '<Name>')],
)
```

`DEV_COLLECTOR_WRANGLER_VARS` (defined near the top of the `Tiltfile`) passes the per-worktree `OTEL_OTLP_HTTP_PORT` to a worker that reads no `.dev.vars`; `scripts/tilt-wrangler-dev-collector-port.test.ts` fails when a bare `wrangler dev` resource leaves it off. Workers started through `services/<worker>/scripts/dev.ts` (e.g. `cfw-api`, `video-api`, `embeddings-api`) go through `bun run dev` and do not need it.

Pick the label from the taxonomy comment near the top of the `Tiltfile` (e.g. `apis` for product API workers, `core` for request-path services).

If the worker reads KV, add `"api-kv-cron"` to `resource_deps` (see Step 14).

Ref: `Tiltfile` lines for `rerank-api` (note: `video-api` and `embeddings-api` use `bun run dev` locally via `services/<worker>/scripts/dev.ts`)

## 10. CI/CD workflows

### release.yaml

Add a deploy job to `.github/workflows/release.yaml`:

```yaml
deploy-cfw-<name>:
  needs: [migrate-prod, migrate-clickhouse-prod, announce-release, deploy-usage-record]
  name: Deploy cfw-<name>
  uses: ./.github/workflows/deploy-cloudflare-worker.yaml
  with:
    working-directory: services/cfw-<name>
    service-name: cfw-<name>
    cloudflare-dashboard-name: <dashboard-name>
    has-sourcemaps: true
    rollout-step-size: ${{ inputs.rollout_step_size }}
    rollout-delay-seconds: ${{ inputs.rollout_delay_seconds }}
    thread-ts: ${{ needs.announce-release.outputs.thread_ts }}
    suppress-success-reply: true
  secrets: ...  # Copy from adjacent deploy job
```

Adjust `needs` by type:
- Inference-path: `[migrate-prod, migrate-clickhouse-prod, announce-release, deploy-usage-record]`
- Standalone (DB only): `[migrate-prod, migrate-clickhouse-prod, announce-release]`
- Lightweight (no DB): `[preflight, announce-release]`

### hotfix.yaml

Same pattern in `.github/workflows/hotfix.yaml`. Ref: existing `deploy-cfw-rerank-api` job.

### Service bindings that point at the new worker

Cloudflare resolves `[[services]]` bindings while a version is uploaded, so a consumer (usually `cfw-api`) cannot upload a version that references a worker which does not exist in the account yet (error 10143). The Worker shell is bootstrapped in openrouter-infra first (Step 15), so it exists before the release. Every consumer's upload also waits (up to 5 min) for its binding targets to exist before uploading.

Adding the new worker's upload job to the consumer upload job's `needs` makes the ordering explicit and skips that wait, but is not required.

That first publication happens in the upload stage, which runs alongside the prod migrations rather than after them, so uploads are not serialized behind migrations. If the new worker's `wrangler.toml` declares `routes`, a custom domain, `[triggers]` crons, or `[[queues.consumers]]`, its first publication starts taking traffic pre-migration — add `migrate-prod` and `migrate-clickhouse-prod` to that worker's upload job.

### time-cloudflare-worker-upload.yaml

Add worker name to `script_name` options list.

### Nursery (WIP workers)

Add `nursery: true` to make failures non-blocking. Remove when stable.

## 11. Durable Objects (if needed)

- [ ] Define class extending `DurableObject<Env>` in `src/durable-objects/`. Ref: `services/cfw-video-api/src/durable-objects/`
- [ ] Add bindings interface, compose into env type
- [ ] Add `[[durable_objects.bindings]]` + `[[migrations]]` to wrangler.toml
- [ ] Re-export from `src/index.ts`
- [ ] Expect "bare deploy fallback" in CI on first deploy with new migration (error 10211 is handled automatically)

## 12. Vitest pool-workers (if needed for CF runtime tests)

Only needed for Durable Object or CF runtime API tests.

- [ ] Add `@cloudflare/vitest-pool-workers` devDependency
- [ ] Create `test-deps/` dir with `test-wrangler.toml`, `test-worker.ts`, `test-env.d.ts`. Ref: `services/cfw-video-api/src/durable-objects/test-deps/`
- [ ] Create `vitest.worker.config.mts`. Ref: `services/cfw-video-api/src/durable-objects/vitest.worker.config.mts`
- [ ] Import `workerdCjsResolvePlugin` from `@openrouter-monorepo/vitest-config` and add to plugins array (required for Vite 8 CJS/ESM compat with cloudflare vitest pool)
- [ ] If the worker uses `pg` (Node-only CJS), add `resolve.alias: { pg: '/dev/null' }` to mock it
- [ ] Add `"test:cfw"` script — CI auto-discovers via `scripts/ci/run-cfw-unit-tests.ts`
- [ ] Name test files `*.cfw.test.ts`

## 13. OpenAPI spec assembly (if worker has public API routes)

If the worker adds new public endpoints (like `/api/v1/embeddings`, `/api/v1/rerank`), integrate into the unified OpenAPI spec.

- [ ] Export the route app from the worker: `export const myRoute = app;`. Ref: `services/cfw-rerank-api/src/routes/rerank/submit.ts` (line 213)
- [ ] In `packages/sdk-generation/src/openapi/export-openapi.build.ts`, import and mount:
  ```ts
  import { myRoute } from '@openrouter-monorepo/cfw-<name>/routes/<path>';
  app.route('/api/v1/<resource>', myRoute);
  ```
- [ ] Add `.openapi('<RefName>')` to Zod schemas for named spec components
- [ ] Run `bun run generate:openapi` to regenerate spec + lint

Pipeline: `export:openapi` (assembles spec) → `generate-openapi.ts` (post-processes) → `speakeasy lint`. Ref: root `package.json` `generate:openapi` script

Current routes in spec:

| Worker | Mount path | Import |
|--------|-----------|--------|
| cfw-api | (base) | `cfw-api/app` → `createApp()` |
| cfw-embeddings-api | `/api/v1/embeddings` | `cfw-embeddings-api/routes/embeddings/submit` |
| cfw-image-api | `/api/v1/images` | `cfw-image-api/routes/images/generations` + `cfw-image-api/routes/models` |
| cfw-public-api | `/api/v1/model` | `cfw-public-api/routes/model` |
| cfw-rerank-api | `/api/v1/rerank` | `cfw-rerank-api/routes/rerank/submit` |
| cfw-stt-api | `/api/v1/audio/transcriptions` | `cfw-stt-api/app` |
| cfw-tts-api | `/api/v1/audio/speech` | `cfw-tts-api/app` |
| cfw-video-api | `/api/v1/videos` | `cfw-video-api/routes/video` |

## 14. Shared KV cache directory (Tilt)

All workers share `--persist-to ../../.wrangler/shared-state` so cfw-internal's cron populates KV once (through cfw-api's `KVCacheController` DO) and other workers read from it.

How it works:
1. Tiltfile: `SHARED_KV_PERSIST = "../../.wrangler/shared-state"` — all `serve_cmd`s use this
2. cfw-internal cron (`CronTask.REFRESH_KV_MODELS_AND_ENDPOINTS`) → `KVCacheController` DO → `warmKVModelsAndEndpoints()` + `warmKVFeaturedModels()`. Ref: `services/cfw-internal/src/routes/cron/tasks.ts`, `services/cfw-api/src/durable-objects/kv-cache-controller.ts`
3. Tiltfile `api-kv-cron` resource auto-triggers cron after api boots. Ref: `Tiltfile` line ~328
4. `api:clear-cache` button removes `.wrangler/shared-state/v3/{cache,kv}`. Ref: `Tiltfile` line ~370

For new workers:
- [ ] Use `--persist-to ../../.wrangler/shared-state` in `dev`/`start` scripts and Tiltfile `serve_cmd`
- [ ] Add `"api-kv-cron"` to `resource_deps` if the worker reads `KV_MODELS_AND_ENDPOINTS` or `KV_LIVE_CONFIG`
- [ ] Do NOT create a separate KV cron — reuse cfw-internal's

## 15. Infrastructure provisioning

### Bootstrap the Worker in openrouter-infra first

The Worker identity (its `cloudflare_worker` shell) is owned by OpenTofu in [OpenRouterTeam/openrouter-infra](https://github.com/OpenRouterTeam/openrouter-infra), root `terraform/cloudflare-prod`, applied by the `openrouter-cloudflare-prod` Spacelift stack. Land the infra PR and let Spacelift apply it before the first production deploy from this repo, so the Worker already exists when the deploy workflow runs. That repo is OpenTofu (`tofu`), not Terraform. Read its `AGENTS.md` and `terraform/cloudflare-prod/README.md` for the ownership boundary.

- [ ] Add a `cloudflare_worker.<name_snake>` resource to `terraform/cloudflare-prod/workers.tf`, copying the exact shape of an existing entry (`account_id = local.account_id`, `name = "<wrangler name>"`, `prevent_destroy`, and the `ignore_changes` list). `name` must match `name` in `wrangler.toml`
- [ ] Bump the Worker counts in `terraform/cloudflare-prod/README.md`
- [ ] Run `tofu fmt -check`, `tofu init -backend=false`, `tofu validate` in the root. A real `tofu plan` runs in Spacelift, not locally
- [ ] Only the shell is managed there. Versions, deployments, bindings, routes, custom domains, crons, secrets, DO migrations, queue consumers, and Hyperdrive stay with `wrangler.toml` and the deploy workflow. Do not add them to the infra root

### Remaining provisioning

Before production deploy:
- [ ] Hyperdrive — reuse existing IDs (shared across workers)
- [ ] KV namespaces — reuse existing IDs for shared namespaces
- [ ] Infisical — create path `/services/cfw-<name>` in project `771b7bc0-6578-41b0-886e-9fcdb66e9173`
- [ ] Custom domain/route — configure in Cloudflare dashboard if needed
- [ ] Rate limiters — copy the full `RATE_LIMITER_RPM_*` block from
      `services/cfw-api/wrangler.toml` (namespace IDs are shared account-wide,
      no provisioning needed). A worker missing a bucket binding fails open for
      that bucket, so every worker using the limiter helpers must declare every
      bucket in `RPM_LIMITER_BUCKETS`.

## 16. Final checklist

- [ ] `bun install` from repo root
- [ ] `bun run typecheck` passes in service directory
- [ ] `bun run test` passes (or `--pass-with-no-tests`)
- [ ] `bunx oxlint --fix --config ../../oxlint.config.ts --no-error-on-unmatched-pattern .` passes in service directory
- [ ] `setStatsd(new CloudflareStatsd([...]))` wired in `index.ts` — without it `getStatsd()` is a no-op and every metric is dropped (see `services/README.md` → Metrics & instrumentation)
- [ ] Tilt resource starts + health endpoint works
- [ ] `release.yaml` and `hotfix.yaml` include deploy job
- [ ] `tsconfig.build.json` references synced (run `bun install` or `bun run sync-tsconfig-refs`)
- [ ] `time-cloudflare-worker-upload.yaml` includes worker name
- [ ] Infisical path created (production)
- [ ] `cloudflare_worker` shell merged and applied in openrouter-infra `terraform/cloudflare-prod` — Step 15
- [ ] OpenAPI spec updated (if public routes) — Step 13
- [ ] KV cache sharing configured (if uses KV) — Step 14
