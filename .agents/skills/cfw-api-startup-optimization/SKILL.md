---
name: cfw-api-startup-optimization
description: Cloudflare Worker startup CPU time limit optimization history, measurement tools, and architecture reference for cfw-api. Use when investigating startup failures, optimizing bundle size, or planning changes that affect cfw-api's startup path.
user-invocable: true
---

# cfw-api Startup Optimization

Reference for the Cloudflare Worker startup CPU time limit constraint on `services/cfw-api`. See `services/cfw-api/AGENTS.md` for the contributing rules. The companion [`cfw-api-cpu-memory-optimization`](../cfw-api-cpu-memory-optimization/SKILL.md) skill covers per-request CPU, memory and latency measurement. The [`cfw-fusion-isolate-memory`](../cfw-fusion-isolate-memory/SKILL.md) skill covers fusion-specific isolate memory behavior.

---

## Cloudflare Worker Startup CPU Time Limit

cfw-api runs on Cloudflare Workers, which enforce a **1-second CPU time limit during script startup** (error code 10021: "Script startup exceeded CPU time limit"). This is the single most persistent operational constraint for this service and has been an ongoing optimization effort since late 2025.

### What counts as "startup time"

Startup time = **parsing + top-level code execution** of the entire bundled module graph. This includes:

- V8 parsing/compiling the JS bundle
- Evaluating all top-level expressions (Zod schema construction, `new` calls, object literals, `buildZodGuard` invocations)
- Running module-level side effects (`setStatsd`, `setBreadcrumbs`)

Startup time does **not** include request handling — only the work done before the first `fetch` event fires.

### How deploys work

The release train calls `wrangler versions upload`, which bundles the worker via esbuild and uploads it to Cloudflare. Cloudflare then validates the bundle by running it in a fresh isolate and checking that startup completes within the CPU budget. If it fails, the upload is rejected with error 10021.

The deploy workflow (`.github/workflows/deploy-cloudflare-worker.yaml`) retries startup-limit failures with a short, fixed backoff (see `scripts/ci/wrangler-retry-helpers.ts` for the schedule and the workflow for the current `--max-retries` value). Success is non-deterministic — the same bundle may pass or fail depending on CPU allocation variance in the validation environment.

### Measurement methodology

Startup time has **very high variance** between runs. One-off comparisons are misleading — a few milliseconds of movement in either direction is noise, not signal. Always use the timing script with `--sample-size 10` or higher to get min/max/median/p90 stats before claiming an improvement is real.

Each timing workflow run carries its own Cloudflare baseline offset. Comparing
one run of arm A with one run of arm B measures that offset rather than the
arm change. Never dispatch timing runs concurrently. The authoritative design
is strictly serial, alternating paired blocks such as `A, B, A, B, A, B`,
with the comparison made within each matched block. A previous concurrent
round and a subsequent serial round produced opposite arm orderings from the
same branches.

### Observability

- **Datadog dashboard**: [Worker CPU & Memory](https://us5.datadoghq.com/dashboard/kba-dj8-6qk) — tracks `cfw.deploy.startup_time_ms`, `cfw.deploy.upload_size_kib`, `cfw.deploy.gzip_size_kib`, and `cfw.deploy.retry_count` per deploy.
- **CI profiles**: Cloudflare returns a CPU profile of the startup phase with every 10021 rejection, and wrangler writes it to `.wrangler/tmp/startup-profile-*/worker.cpuprofile` on the runner. #37976 (Aug 2026) uploaded these as `startup-cpuprofile-<service>-<sha>` artifacts, but it was reverted in #37978, so CI currently discards them when the job ends. A rejected upload is the only source of a profile taken in Cloudflare's own validator, so when a rejection profile is needed, re-add a capture step on a branch (or dispatch the timing workflow from a branch that streams the profile into the log) rather than reasoning from bundle bytes.
- **Local profiling**: `bunx wrangler check startup --workerBundle <bundle>` produces a `.cpuprofile` with real, attributable work in it, with no Cloudflare credentials needed. Two things separate a useless flamegraph from a usable one, and the skepticism previously recorded here came from skipping both:
  - Profile the **already-built bundle** rather than the source tree, and aggregate **10 serial runs**. A single run is noise; idle time alone moves tens of ms between runs, so carry it as a control.
  - Frames are minified. Map them through the build's sourcemap and aggregate self time by npm package and by nearest first-party frame. Raw subtree names mislead badly: reading two named Zod subtrees suggested Zod was ~5% of startup when the aggregate was over half of it.

  ```sh
  cd services/cfw-api
  bunx wrangler deploy --dry-run --outdir dist --outfile /tmp/worker.bundle
  for i in $(seq 1 10); do
    bunx wrangler check startup --workerBundle /tmp/worker.bundle \
      --outfile /tmp/run-$i.cpuprofile
  done
  ```

  `precompiled_zod_guards_missing` is expected in this harness and does not invalidate the profile. Absolute ms are not Cloudflare's numbers: use the local profile to decide **where** the cost is, and the timing workflow to decide **whether** a change helped.
- **Upload timing workflow**: Use `repository_dispatch` to trigger
  `.github/workflows/time-cloudflare-worker-upload.yaml`, which runs repeated
  uploads to collect min/max/median/p90 stats. It needs `Contents:write`:
  ```sh
  gh api repos/OpenRouterTeam/openrouter-web/dispatches \
    -f event_type=time-worker-upload \
    -f 'client_payload[script_name]=cfw-api' \
    -f 'client_payload[sample_size]=10' \
    -f 'client_payload[ref]=main'
  ```
  A human can trigger the workflow from the Actions UI. An agent token cannot
  use `workflow_dispatch`, so a 403 `Resource not accessible by integration`
  means that path was used instead of `repository_dispatch`.
- **Local timing script** (requires `bunx wrangler login`, run from the **monorepo root**):

  ```sh
  # From the monorepo root:
  bun scripts/time-cloudflare-worker-upload.ts \
    --script-name cfw-api --sample-size 10
  ```

  This is the primary tool for measuring startup time with statistical rigor.

- **Request-path, memory and latency measurement**: Use the
  [`cfw-api-cpu-memory-optimization`](../cfw-api-cpu-memory-optimization/SKILL.md)
  skill for real-request profiling with the `api-perf` Preview. The
  [`cfw-fusion-isolate-memory`](../cfw-fusion-isolate-memory/SKILL.md) skill
  covers fusion-specific heap retainers and OOM analysis.

### Startup guard AOT generation

cfw-api follows zod-compiler's
[Workers/serverless startup guidance](https://github.com/gajus/zod-compiler#workers-and-serverless-startup)
to precompile module-level `buildZodGuard` validators. The build script creates a separate worker from
`wrangler.zod-guards.toml`, evaluates the complete production module graph in
workerd, and records validators in `buildZodGuard` evaluation order. That
build-only worker enables `allow_eval_during_startup` and calls
`zod-compiler/jit`; the deployed worker imports only plain generated functions
and performs no guard code generation.

Predicates are emitted directly only when a TypeScript AST scan proves they are
self-contained. Predicates that reference compiler closure state become
positional `null` markers backed by a compact factory list that re-materializes
the complete captured program against `Object.create(schema)`. The generation
worker differentially validates both the original compiled predicate and this
exact production wrapper path against native Zod before emitting the artifact.
The [#34913](https://github.com/OpenRouterTeam/openrouter-web/pull/34913)
program-capture graph has 132 positions: 96 direct predicates and 36 factories.

Production imports `src/apply-patches-api.ts` first so
`src/zod-guard-bootstrap.ts` configures the generated list before any
guard-bearing module evaluates. `router-streaming-startup.ts` preserves the
explicit router preload order, and `src/index.ts` asserts exact list
consumption after the full graph loads. The Wrangler build hook regenerates the
complete graph and rejects a stale artifact before bundling. Regenerate after
changing a guarded schema or the module-evaluation order:

```sh
cd services/cfw-api
bun scripts/generate-zod-guards.ts
bun scripts/generate-zod-guards.ts --check
```

Bun tests, local development, partial Miniflare graphs, and guards first built
at request time use native Zod. A partial graph therefore cannot consume a
generated predicate intended for a different schema. The
`router.import.success` metric still records
`router_streaming_guard:compiled|fallback` by probing the preloaded refusal
guard; exact startup consumption is enforced separately by the production
assertion.

The superseded runtime path used Traversable's `zx.check` during isolate
startup. Its final matched round had 39/40 successful main uploads (676 ms
median, 781 ms p90) and 35/40 successful runtime-compilation uploads (653 ms
median, 767 ms p90). The earlier narrowed-preload round had 18/20 successes on
main and 20/20 on the experiment. Retain those figures as historical context;
they do not describe the current AOT architecture.

---

## What Has Been Tried (and What Didn't Work)

> **Do not re-attempt these approaches.** Each was investigated, implemented, measured, and either shipped or rejected with data.

### Approaches that DID NOT reduce startup time

#### 1. Minification (`minify = true` in wrangler.toml)

- **PR**: #21204 (May 2026)
- **Result**: Reduces bundle from 13.3 MB to 5.6 MB (58% smaller), but startup CPU time is **identical** (~206ms locally). Minification rewrites the same code in fewer characters — it does not reduce the amount of work V8 does at startup. Parsing time is a small fraction of the budget; top-level execution dominates.
- **Status**: Merged (still useful for upload size / bandwidth), but does not fix startup failures.

#### 2. Lazy-loading all route handlers via dynamic `import()`

- **Commits**: `312017229e`, `28cbbd1c23`, `4d112bf1ac` (May 7, 2026)
- **Result**: Moved every route import to `await import()` inside an async `registerLazyRoutes` helper. Reduced startup time significantly (75% upload failure rate to 0% at n=20, ~800ms median). However:
  - Broke OpenAPI schema generation. The order that matters is route registration order, not schema construction order, and awaiting imports inside `registerLazyRoutes` changes it
  - Caused integration test hangs in miniflare/vitest-pool-workers
  - Required static re-imports of `modelsRoute` and `internalRoutes` to fix those issues, which eroded the savings
  - The approach was **abandoned** in favor of extracting routes to `cfw-public-api` (see "what worked" below)
- **Key lesson**: Dynamic `import()` in Cloudflare Workers is effective for deferring work, but it breaks OpenAPI doc generation (which requires synchronous route registration) and causes test runner issues. Only the **backfill route** retains this pattern because it's hidden from OpenAPI (`hide: true`).
- **What pins skin schemas eager** (counts as of Aug 2026, expect drift): 25 OpenAI Responses exports are held directly by statically registered route definitions, and 15 Anthropic response and stream exports are consumed by AOT guard generation and the positional production guard list. Both sets have to stay eager for as long as those consumers are static.

#### 3. Dynamic `import()` for `@openrouter/sdk` in server-tools plugin

- **Commit**: `d1a5025762` (Apr 2026) — reverted in `b91ea7be17`
- **Result**: Deferred SDK loading to when server-tools plugin executes. Reverted because it became redundant once `importRouter()` already deferred the router — the SDK's startup cost was covered by that path. That deferral has since been removed (see "Removing the dynamic `import()` for `packages/router`" below), so the SDK now evaluates during startup again. Async-importing the SDK is worth revisiting if server-tools startup cost becomes material, since it tends to attract large additions.

#### 4. Removing the dynamic `import()` for `packages/router` in cfw-api

- **File**: `services/cfw-api/src/helpers/import-router.ts` (Aug 2026)
- **What**: Replaced the request-time `await import('@openrouter-monorepo/router')` with a static top-level import, keeping `importRouter(route)` as the single async accessor used by the five inference routes (chat-completions, completions, messages, responses, cursor). Removed the attempt, duration, and failure instrumentation that only applied to a call-time dynamic import. The `router.import.success` counter and its streaming-guard tag remain.
- **Measurement**: Three matched serial blocks of 10 uploads per arm. Main had 28/30 successes, 2 10021 failures, a 687 ms median, and a 921 ms p90. The static-import branch had 26/30 successes, 4 10021 failures, a 766 ms median, and an 873 ms p90. Runs: [main 1](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/31478031275), [static import 1](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/31478136947), [main 2](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/31478260551), [static import 2](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/31478384448), [main 3](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/31478483991), [static import 3](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/31478595005). The six runs predated `980e565943c`'s named-import narrowing; that does not affect startup work because `packages/router/index.ts` has one value export, so both forms evaluate the same module graph.
- **Result**: Startup time did not improve and the 10021 failure rate was higher, so this is not a startup optimization. It ships for the removed first-request router-import latency. The bundle delta was not explained, and no esbuild metafile comparison was retained.
- **Status**: Shipped in [openrouter-web#33289](https://github.com/OpenRouterTeam/openrouter-web/pull/33289) for the first-request-latency benefit, not a startup win. Open items: reassess whether the `router-streaming-startup.ts` preload list still provides value now that the whole router graph evaluates at startup, and measure the hot-path effect of moving guards into the startup window on the shared `cpuTime / upstream_chunk_count` metric used by the #33226 gate.

#### 5. Caching `buildZodGuard` eval failure

- **Commit**: `db880fd552` (Mar 2026)
- **What**: The commit message says eval was blocked and that `buildZodGuard` threw more than 50 times at startup, but its historical `wrangler.toml` already enabled `allow_eval_during_startup`. The commit therefore fixed repeated post-window failures or stale wording in the message, not a universally blocked startup path. Caching the first failure eliminated repeated error log noise. This reduced error noise but did not measurably reduce startup time or bundle size.

### Approaches that DID reduce startup time / bundle size

#### 1. Extracting routes to separate workers (ongoing, ~100ms saved)

- **PRs**: #20685, #20756, #20758, #20760, and stacked PRs (May 2026)
- **What**: Extracting non-inference routes from cfw-api to dedicated workers (`cfw-public-api` for public API routes, `cfw-internal` for OR-specific routes, `cfw-frontend-api` for routes needed by the web app), then unmounting them from cfw-api. Cloudflare zone routes direct traffic to the correct worker.
  - **Extracted so far** (unmounted from cfw-api): organization, guardrails, workspaces, secret-alert, activity, analytics
  - **Still in cfw-api** (pending extraction): keys, internal (50 files, ~8,800 lines, 624 KiB bundle contribution)
- **Impact**: ~100ms startup time reduction. This is the **primary ongoing strategy** — keep extracting routes to slim the bundle.

#### 2. Dependency stubbing via wrangler `[alias]` (proposed)

- **Commit**: `90242d512b` (Apr 2026) — feature branch, not merged to main
- **What**: Stubbed `fast-check` (-216 KB) and `juice` (-805 KB) via wrangler aliases. Used `@traversable/zod/check` subpath import instead of barrel (-176 KB). Measured 12,663→11,467 KB.
- **Status**: The branch was superseded by route extraction (which removed the deps entirely). The technique remains viable for future use if heavy transitive deps reappear.

#### 3. Removing test data constants from production bundle (~1.1 MB)

- **Commit**: `900c970b87` (Mar 2026)
- **What**: Large base64-encoded test assets (video, PDF, image, audio) were being pulled into the production bundle via import chains. Refactored to read from filesystem at test time and broke the import chain.

#### 4. Subpath imports replacing barrel imports

- **effect**: `f401e5c933`, `de95a15ecd` (Mar 2026) — replaced `effect` barrel/namespace imports with named subpath imports for tree-shaking.
- **DataDog**: `8f7c02eaa9` (Feb 2026) — used DD v2 sub-package imports to eliminate bundle bloat.
- **SDK**: `379e8991f5` (Mar 2026) — replaced SDK barrel import with subpath, -245 KB.

#### 5. Separating metering queue consumers into dedicated worker

- **Commit**: `e2fe131cfc` (Apr 2026)
- **What**: Moved metering queue consumers into `gcp-queue-worker`. Removed Stripe SDK, Orb client, and GCP KMS from cfw-api bundle entirely.

#### 6. Lazy-loading broadcast-fanout and email/juice chain

- **Commit**: `b30e535046` (Apr 2026)
- **What**: Converted two static imports to dynamic `import()` for modules only needed on specific request paths (not at startup). Deferred ~1,090 KiB from startup path.

#### 7. Replacing luxon with native Date/Intl APIs

- **PR**: #18015 (Apr 2026)
- **What**: Removed luxon runtime dependency from router and cfw-api. Replaced with native `Date`/`Intl.DateTimeFormat`. Added Oxlint import guardrail.

#### 8. Tree-shaking safe-regex and sub-path imports (~426 KiB)

- **Commit**: `99ad640580` (Feb 2026)
- **What**: Replaced `safe-regex` with a lighter alternative and used subpath imports in guardrails package.

#### 9. Keeping `@openrouter/agent` hot subpaths leaf-clean (Aug 2026)

- **Incident**: the `@openrouter/agent` 0.7.2 → 0.9.0 bump (#33597) made `@openrouter/agent/tool` — statically imported by every server tool in `packages/router` — transitively reach `import * as models from '@openrouter/sdk/models'` (via `agent-tool.js` → `conversation-state.js` → `turn-context.js`, to read one enum whose value is `'user'`). That Speakeasy barrel evaluates ~600 modules of top-level Zod schema construction, adding ~200ms startup across seven workers; cfw-api and cfw-internal failed all 10 upload retries with 10021 and the train was unblocked by reverting (#33740). Local V8 evaluation of the three hot subpaths measured 0.007ms (0.7.2) → ~233ms (0.9.0) → ~8ms with the import removed.
- **Fix**: re-land (DEV-823) with an extra hunk in the `@openrouter/agent` patch under `patches/` inlining the `'user'` literal in `esm/lib/turn-context.js`, plus the same fix upstream in typescript-agent.
- **Guard**: `packages/router/agent-sdk-startup-closure.test.ts` discovers the statically imported agent subpaths in `packages/router` + `packages/tools` and pins each one's runtime import closure to an external allowlist (`zod` only). Dynamic `import()` edges (e.g. `@openrouter/agent/call-model`) are exempt because esbuild defers them behind `init_*` wrappers — bytes in the bundle, but not startup work.
- **Key lesson** (re-confirming the minification entry): startup cost is top-level *evaluation*, not bytes. The patched 0.9.0 bundle stays ~237 KB larger than 0.7.2, with no startup cost, because the remaining new modules sit behind lazy wrappers.

#### 10. Dynamic `import()` for `packages/router` in cfw-api (removed Aug 2026)

- **File**: `src/helpers/import-router.ts`
- **What**: Deferred the heavy router package (~2+ MB) from the startup path via `await import()`. Initially tried in Nov 2025 (`0785355e9d`) and reverted, then brought back with instrumented metrics (`router.import.attempt`, `router.import.success`, `router.import.duration`), moving the cost from startup to first-request latency on each isolate.
- **Status**: Removed in Aug 2026 after a paired measurement showed startup time did not improve and the 10021 failure rate was higher — see "Removing the dynamic `import()` for `packages/router`" in the DID-NOT section above.

#### 11. Forcing ESM resolution on dependencies that hide their ESM build behind unused `exports` conditions

- **What to check**: for any dependency whose bytes look unshakeable, read its `exports` map. Wrangler resolves with the `workerd`, `worker`, `browser` conditions, so a package that only offers ESM behind `esnext`/`module` falls through to `default` — usually CommonJS, whose namespace object esbuild cannot drop unused exports from.
- **Fix pattern**: patch the package's `exports` to add `workerd` and `worker` entries pointing at its ESM build, leaving `default` and `types` intact so Node, Next and TypeScript resolution are unchanged. `patches/@opentelemetry%2Fsemantic-conventions@1.37.0.patch` is the reference. Prefer this over `WRANGLER_BUILD_CONDITIONS`, which changes resolution for every dependency at once.
- **Verify before shipping**: rebuild with `bun run cf:bundle:min` and compare the package's `bytesInOutput` in `dist/bundle-meta.json`, and diff the ESM and CJS entrypoints' export names and values to confirm parity.

#### 12. Precompiling `buildZodGuard` with zod-compiler (Aug 2026)

- **PR**: [#34474](https://github.com/OpenRouterTeam/openrouter-web/pull/34474)
- **What**: Replaced production startup-time Traversable compilation with a
  build-only workerd that uses `zod-compiler/jit`. The deployed worker consumes
  an ordered artifact of self-contained predicates and native-Zod fallback
  markers. `zod-compiler` is absent from the production module graph.
- **Measurement**: Two strictly serial `main → experiment` pairs, 10 uploads
  per block. Runs: [main 1](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/32020908857),
  [experiment 1](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/32021047558),
  [main 2](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/32021182402),
  [experiment 2](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/32021306384).
  Main had 19/20 successes, a 720 ms median, 726.7 ms mean, and 787 ms p90.
  The AOT branch had 20/20 successes, a 679 ms median, 686.5 ms mean, and
  729 ms p90. Delta: median -41 ms (-5.7%), mean -40.2 ms (-5.5%), p90
  -58 ms (-7.4%), and failures 1 → 0.
- **Bundle impact**: The timing bundle decreased 20.43 KiB raw and 5.45 KiB
  gzip. A local minified production bundle decreased 5,851 bytes raw and 3,858
  bytes gzip.
- **Status**: Proposed as the standalone AOT implementation. Keep the generated
   artifact fresh and watch production deploy retries after merge.

 ---
#### 13. Emitting closure-free predicates directly (Aug 2026)

- **Context**: [#34913](https://github.com/OpenRouterTeam/openrouter-web/pull/34913)
  captured complete zod-compiler programs so schemas whose predicates close
  over compiler state could be compiled instead of falling back to native Zod.
  Emitting every guard as a factory was correct, but it also made production
  instantiate all 132 programs during module evaluation.
- **What**: Capture both the returned predicate source and the full compiler
  program. Emit the 96 predicates that have no free compiler identifiers
  directly, and retain compact factories for only the 36 predicates that
  capture state. Factory schemas inherit from the live schema through
  `Object.create(schema)`, avoiding descriptor snapshot and restore work. The
  build worker exercises that exact wrapper path against native probe results
  for every captured program.
- **Bundle impact**: The generated artifact decreased from 766,323 to 578,439
  bytes (-187,884, -24.5%). The local production bundle decreased from 6,441.52
  to 6,308.08 KiB raw (-133.44 KiB, -2.1%) and from 1,660.33 to 1,644.02 KiB
  gzip (-16.31 KiB, -1.0%).
- **Local startup profile**: Ten serial, alternating all-factory → hybrid pairs
  produced a paired median delta of -2.33 ms and mean delta of -1.21 ms, with
  the hybrid faster in 7/10 pairs. The all-factory arm had a 399.98 ms median
  and 401.64 ms mean; the hybrid arm had a 400.48 ms median and 400.44 ms mean.
  Pair deltas ranged from -20.93 to +25.27 ms, so this is a small, noisy local
  signal rather than evidence of a material startup-time win. Cloudflare upload
  timing remains necessary for a production startup claim.
- **Status**: Implemented as the direct-predicate follow-up to #34913. Keep the
  factories: the remaining 36 predicates require their captured compiler state.

---

## Current Architecture

As of August 2026, cfw-api's build and startup path is:

1. The Wrangler build hook runs `bun scripts/generate-zod-guards.ts --check`.
   An isolated build-only workerd evaluates the complete production graph with
   `zod-compiler/jit`, validates direct and factory guards against native Zod,
   and rejects stale generated guards.
2. `src/index.ts` evaluates `apply-patches-api` first, which configures the ordered
   direct-predicate/null list and its compact factory list, followed by
   `router-streaming-startup`,
   instrumentation setup (`setStatsd`, `setBreadcrumbs`), DO class re-exports,
   and backfill task registration.
3. `src/app.ts` statically imports all remaining route modules, constructs the
   Hono app, registers middleware, and mounts routes. After that graph has
   evaluated, `src/index.ts` asserts that production consumed the exact guard
   list.
4. The backfill route is the **only** lazy-loaded route (via dynamic `import()`
   in a catch-all handler). The five inference routes (chat-completions,
   completions, messages, responses, cursor) access the statically imported
   `packages/router` through the async `importRouter()` accessor, which obtains
   its `Router` binding from `router-streaming-startup.ts`.

The heaviest packages in the bundle (by contribution):

- `packages/router` (~2+ MB) — statically imported during startup and returned through `importRouter()`
- `zod` (~591 KB total across the graph)
- `packages/broadcast` (~487 KB) — OTel protobuf definitions
- `packages/llm-interfaces` (~416 KB) — response schemas
- `effect` (~452 KB) — runtime effect system
- `@aws-sdk/client-s3` (~372 KB)

`zod-compiler` is a build-only dependency and is not present in the deployed
module graph.

---

## Ongoing Optimization Efforts

The primary strategies being pursued to further reduce startup time:

1. **Route extraction** — continuing to move non-inference routes from cfw-api to `cfw-public-api`, `cfw-internal`, and `cfw-frontend-api`.
2. **Tree-shaking** — replacing barrel imports with subpath imports, removing unused re-exports, and ensuring esbuild can eliminate dead code.
3. **Bundle size reduction** — stubbing unused transitive deps, splitting heavy modules into separate workers, and auditing new dependency additions for size impact.

---

## How to Use the Upload Timing Workflow

The "Time Cloudflare Worker Upload" workflow (`.github/workflows/time-cloudflare-worker-upload.yaml`) measures actual Cloudflare startup time by uploading a worker bundle repeatedly and collecting stats.

### Triggering a timing run

```sh
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=time-worker-upload \
  -f 'client_payload[script_name]=cfw-api' \
  -f 'client_payload[sample_size]=10' \
  -f 'client_payload[ref]=main'
```

- `script_name`: any service under `services/` (e.g. `cfw-api`, `cfw-internal`, `usage-record`)
- `sample_size`: number of uploads (use ≥10 for meaningful stats)
- `ref`: branch to check out and bundle from

### Comparing two branches

Trigger strictly serial alternating blocks of 10 uploads. Dispatch one baseline
block, wait for it to finish, dispatch one experiment block, and repeat. Never
dispatch the two arms concurrently or compare unpaired runs:

```sh
# Block 1A: baseline
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=time-worker-upload \
  -f 'client_payload[script_name]=cfw-api' \
  -f 'client_payload[sample_size]=10' \
  -f 'client_payload[ref]=main'

# After 1A finishes, block 1B: experiment
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=time-worker-upload \
  -f 'client_payload[script_name]=cfw-api' \
  -f 'client_payload[sample_size]=10' \
  -f 'client_payload[ref]=your-feature-branch'
```

Repeat as `A, B, A, B` for the desired number of blocks. Compare each
experiment block with its immediately preceding baseline block, then aggregate
the paired results. Never compare runs from different days because Cloudflare's
infrastructure load varies.

### Reading the results

Check workflow logs in GitHub Actions. The report includes bundle sizes, success/failure counts, per-run startup times, and aggregate stats (min/max/median/p90). The workflow always completes (even when uploads fail) — check the `::warning::` annotation if the script exited non-zero.

### Quick local check

Use `bun run cf:bundle` from `services/cfw-api/` for instant bundle size comparison without waiting for CI. Bundle size correlates with startup time when the removed code executes at top-level (Zod schemas, route registrations), but not when it's just dead code or minification savings.

### Measured example: internal routes removal (June 2026)

Removing `/api/internal/v1/` routes (50 files, ~8,800 lines). Branch: `devin/1781845310-remove-internal-routes-timing-test`

| Metric | Main (run 27808350080) | No internal routes (run 27808352444) |
|--------|----------------------|--------------------------------------|
| Bundle | 13,464 KiB / gzip 2,253 KiB | 12,840 KiB / gzip 2,141 KiB (-4.6%) |
| Success rate | 40% (4/10) | **100% (10/10)** |
| Startup median | 948ms | **751ms** |
| Startup p90 | 989ms | **818ms** |

Route registration + transitive Zod schema construction at import time is the dominant cost. This data supports extracting `/api/internal/v1/` to `cfw-internal`.

---

## Keeping This Skill Current

This document is a living record. After trying a new optimization approach or technique — whether it worked or not — update this skill so future agents and contributors don't re-attempt it. Specifically:

- **Add new entries** to the "DID reduce" or "DID NOT reduce" sections with PR/commit refs, measured impact, and why it was kept or rejected.
- **Update the "Current Architecture" section** if the startup path, heaviest packages, or lazy-loading strategy changes.
- **Update "Ongoing Optimization Efforts"** as strategies are completed or new ones emerge.
- **Use git history** to discover recent optimization work that may not be documented here yet — search for commits touching `services/cfw-api/wrangler.toml`, `src/app.ts`, `src/index.ts`, or PRs mentioning "startup", "bundle size", or "10021".
