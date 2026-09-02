# CI test-runner scripts

Conventions and hard-won findings for the scripts that fan out test suites in CI (`run-integration-tests.ts`, `run-unit-tests.ts`, `run-cfw-unit-tests.ts`).

## Integration-test performance

The `integration` job (`run-integration-tests.ts`, on `blacksmith-16vcpu`) is slow because of **workerd startup cost**, not the runner script. Understand this before "optimizing" it.

### Where the time goes

Per-suite self-timings from a full unsharded run (absolute numbers drift as suites grow — the runner's per-suite duration table has current values):

| Suite | Files | Duration |
| --- | --- | --- |
| cfw-public-api | 35 | 89.3s |
| cfw-frontend-api | 17 | 58.6s |
| cfw-api | 6 | 18.6s |
| cfw-internal | 1 | 18.2s |
| rest (bun / node-vitest) | 1-3 | < 10s |

- Wall time ≈ the single longest suite (`cfw-public-api`). The suites run concurrently in limited job slots, so total time is the **critical path**, not the sum.
- Inside a workerd (`vitest-pool-workers`) suite, `tests` are ~1s of an ~18s run. The rest is per-file isolate startup + worker-bundle import. `isolate: true` (the default) spins a fresh workerd isolate **per test file**.
- bun / node-vitest suites have near-zero startup and scale by file count.

### Two levers that work (both shipped)

1. **Launch heaviest-first.** Total time is set by the longest suite, so it must start at `t=0`. If it launches late it sits behind cheap suites and its wait is added onto the finish line. The runner weights suites (workerd `100 + files*30`, node-vitest `files*5`, bun `files*1`) and launches in descending order.
2. **Bound oversubscription.** Each vitest self-sizes its worker pool to the core count, so N concurrent suites spawn ~N×cores workerd isolates. Cold isolate startup is CPU-bound, so that thrashes the CPU. The runner caps per-suite workers via `INTEGRATION_MAX_WORKERS` (computed by `resolveIntegrationMaxWorkers` in `utils/run-tests-helpers.ts`, consumed by `getIntegrationConcurrencyConfig()` in `configs/vitest`) and keeps `MAX_JOBS × workers ≈ cores`.

### Sharded CI topology (2026-08)

The two largest suites (`cfw-frontend-api`, `cfw-public-api`) are the merge-queue critical path on their own, so the `integration` job runs as parallel shard jobs in `ci.yaml` (`integration-shards` matrix):

- `integration-core` — every suite except the two giants (`--exclude=...`), 16 vcpu
- `integration-public-api` — `--only=services/cfw-public-api`, 32 vcpu
- `integration-frontend-api-1..4` — `--only=services/cfw-frontend-api --shard=N/4` (vitest file-level sharding), 16 vcpu each — the shard is bound by the single-threaded vitest main process (see below), so 32 vcpu measured no faster. Add shards when one shard's per-suite duration becomes the critical path again.

A tiny `integration` gate job `needs:` the matrix and fails unless every shard succeeded, so the branch-protection/merge-queue required context (`integration`) is unchanged. `run-integration-tests.ts` accepts `--only` / `--exclude` / `--shard` (parsed in `utils/integration-runner-args.ts`); a `--only` run shrinks `MAX_JOBS` to the suite count so a dedicated shard gets the runner's full core count as its worker cap. Each shard still runs `compute-affected.sh` and self-skips when its suite is unaffected.

The workload is long-pole dominated, so **fewer concurrent suites with more workers each** wins. Measured on CI:

| config | wall | cfw-public-api |
| --- | --- | --- |
| `MAX_JOBS=8` (old default) | 91s | 89.3s |
| `MAX_JOBS=4` / cap 4 | 87s | 84.6s |
| `MAX_JOBS=2` / cap 8 | 78-88s | 64-71s |

`MAX_JOBS=4`/cap 4 was a wash — it starved the long pole (4 workers) in its tail, where it runs alone. `MAX_JOBS=2`/cap 8 moved the two giants ~20-25% faster consistently across runs. Single-run *wall* has ±15% runner variance, so trust the per-suite giant times (the runner prints a per-suite duration table on every run — read that, not one wall number). Both knobs are env-overridable (`MAX_TEST_JOBS`, `INTEGRATION_MAX_WORKERS`) so the split can be retuned from the duration report without code changes.

### The main-process module-RPC bottleneck (2026-09)

A dedicated frontend-api shard does not scale with workers: 51 files / 32 workers on CI ran 4.1s per file, 102 files / 8 workers locally ran 3.0s per file. The vitest main process sits at ~100% CPU while the box is mostly idle — it is single-threaded, and every fresh isolate fetches its whole module graph from it over the pool's module-fallback WebSocket (~4,400 modules per file, ~2,200 of them `node_modules` ESM files: `cloudflare` 758, `@smithy`/`@aws-sdk` ~600, `kysely` 263, `stripe` 149, `zod` 95), each one inflated, `devalue`-parsed, matched against the module rules, and serialized back. Module count per isolate is the cost; file count is the multiplier.

**Pre-bundling heavy deps** (`test.deps.optimizer.ssr.include` in `vitest.integration.config.mts`) collapses each dependency into one `deps_ssr` chunk: 4,379 → ~2,300 module fetches per file, single-file run 30.6s → 18.7s, full 102-file suite 309s → 190s locally. Two gotchas, both a consequence of Bun's isolated linker (a package is only resolvable from the workspace that declares it):

- Vite resolves `include` entries from the vitest project root, so a dep that only `packages/*` declares (`cloudflare`, `kysely`, ...) resolves to `null` and is **silently skipped** — `DEBUG=vite:deps` shows `Dependencies bundled in ~130ms` and `vite:resolve … cloudflare -> null`. The suite declares those deps as `devDependencies` so the include list resolves. Vite's nested `pkg > dep` syntax also works but only for that one importer.
- Subpath imports are separate entries (`kysely/helpers/postgres`, `zod/v4/core`, `@bufbuild/protobuf/codegenv2`); a bare `kysely` entry does not cover them. Use `DEBUG=vite:transform` on a one-file run and count `node_modules/.bun/<pkg>` hits to find what is still unbundled.

### Dead ends (measured — do not retry)

- **`isolate: false`** — ~3-6× faster (cfw-public-api 89s→~20s on CI) BUT breaks the suites (34/212 fail on cfw-public-api). A fresh isolate per file is load-bearing: every suite assumes fresh mocks + DB context + seeded KV + module singletons per file. The most common single leak is `getUser` (files call `vi.clearAllMocks()` in their own `beforeEach` and set one-shot `mockResolvedValueOnce`, so the load-time default is consumed and never reinstated → later files 401). A central `afterEach`/`beforeEach` in `vitest.setup.mts` re-establishing that default cleared only 4 of 34; a setup `beforeEach` can't help at all because the file's own `clearAllMocks()` runs after it. The residual failures span DB rows, KV, and other mocks across ~18 files. Capturing this prize requires a per-file test-isolation refactor (replace `clearAllMocks` + `Once` with explicit per-test state + DB/KV cleanup), not a config change. `mockReset`/`restoreMocks`/`unstub*` are *worse* than `clearMocks` (they wipe module-scope `mockResolvedValue` defaults); there is no CLI flag for these in vitest 4.
- **`singleWorker` / `isolatedStorage` pool options** — removed in the vitest-v4 pool rewrite; absent in the installed pool (0.16.18) and latest (0.18.2).
- **Persisting the vite optimizeDeps cache across runs** — cold vs warm is only ~1s/suite (bundling itself takes <1s even with the full include list). Not worth the plumbing.
- **Bumping `@cloudflare/vitest-pool-workers`** — buys no perf lever (the useful knobs are gone) and forces re-porting the local patch at `patches/@cloudflare%2Fvitest-pool-workers@0.16.18.patch`.

## Related

- Test-writing conventions: see `services/cfw-api/integration/AGENTS.md`
- Concurrency helpers: `scripts/ci/utils/run-tests-helpers.ts` (`resolveIntegrationMaxWorkers`) and `configs/vitest/index.mjs` (`getIntegrationConcurrencyConfig`)

## Failure output

Captured child logs can contain nested `::group::` markers. Because GitHub Actions
does not support nested groups, a child `::endgroup::` can close the wrapper
group early. Failing packages must name their failed tests in uncollapsed
human-readable output and as `::error file=…` annotations.
