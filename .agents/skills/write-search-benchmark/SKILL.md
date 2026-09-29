---
name: write-search-benchmark
description: Add a Kepler search benchmark (HLE, DSQA, WideSearch) to the benchmark harness, covering dataset, search solver, grading, registration, and cost-gated validation.
user-invocable: true
---

> **`packages/bench-harness` is externally owned and synced in as a read-only
> Git subtree.** Make changes upstream in `OpenRouterTeam/benchmark-harness`,
> then pull back via `scripts/subtree-pull-bench-harness.sh`. Direct edits to the
> vendor fail the CI subtree-integrity check (`scripts/check-subtree-integrity.ts`).

# Write a Search Benchmark

Adds a suite to the search-benchmark family in
`packages/bench-harness/src/benchmarks/search/`. Distilled from the browsecomp
port — follow it for hle, dsqa, widesearch, or any new search suite.

Prerequisite reading (in order):

1. `OpenRouterTeam/benchmark-harness` `add-benchmark` skill — harness primitives
   (Benchmark = Layer providing `Dataset | Solver | Scorer`)
2. `src/benchmarks/search/browsecomp/benchmark.ts` — the reference suite,
   end-to-end

## What the search family shares (do NOT rebuild these)

Paths are relative to `packages/bench-harness/src/` (the upstream repo keeps
source under `src/`):

- `benchmarks/search/core/config.ts` — lane config schema
  (engine/surface/turn-budget knobs; persists per-row via
  `benchmark_config`)
- `benchmarks/search/core/benchmark.ts` — shared layer composition and config
  projection
- `benchmarks/search/core/progress.ts` — streamed search progress reporting
- `benchmarks/search/core/request.ts` — lane → `ResponsesRequest`
  builder (server-tool + plugin surfaces)
- `benchmarks/search/core/solver.ts` — one `/responses` call; the
  tool loop is server-side; captures citations/usage
- `benchmarks/search/core/usage.ts` — generation + judging usage rollup
- `judge/judge.ts` — `judgeCall<T>`: strict json_schema verdicts,
  shared retry
- `benchmarks/search/grading/answer-equivalence.ts` — the
  browsecomp/hle grader (LLM judges answer ↔ reference equivalence)
- `benchmarks/search/grading/answer-equivalence-benchmark.ts` — shared
  generation → judge composition and pure score rollup
- `benchmarks/search/core/prompts.ts` — suite instructions derived from the
  benchmark specification
- `providers/responses-client.ts` — `Responses` service, `toModelError`,
  `usageFromResponses`

A new suite typically adds only `benchmarks/search/<suite>/dataset.ts`,
`benchmarks/search/<suite>/benchmark.ts`, a colocated `grader.ts` if its
grading is suite-specific, and the registration entries. Graders shared by
multiple suites belong under `benchmarks/search/grading/`.

## Step 1 — Dataset

Three shapes seen so far; pick the matching pattern:

- **HF dataset (ungated)**: `makeHfDatasetLayer` with a `recordToSample` —
  see `benchmarks/gpqa.ts`. Pin the revision.
- **Official gated dataset (HLE)**: keep its filtering, revision, and count
  validation inside the HLE dataset module rather than expanding the generic
  Hugging Face loader.
- **Raw file over HTTP (browsecomp)**: see
  `benchmarks/search/browsecomp/dataset.ts` —
  fetch once (memoized `cached` effect), verify a pinned SHA-256, validate
  the row count, honor `[start, end)` chunking with absolute row indices as
  sample identity (`<suite>-<row_idx>`).

Encrypted fields (BrowseComp scheme): key = SHA-256(canary) repeated,
plaintext = base64(ciphertext) ⊕ key — `decryptField` in
`benchmarks/search/browsecomp/dataset.ts`. Test decrypt round-trip with an
inverse encrypt helper, including multi-byte UTF-8 and content longer than one
hash block.

Map the official dataset schema directly and retain useful metadata fields
(topic/category/answer_type) as filterable diagnostics.

## Step 2 — Grading

The scorer must be pure (`Effect<Score, never>`), so LLM judging runs in the
**solver** and stashes its verdict in `sample.metadata`; the scorer only
validates + rolls up. Two paths:

- **Same binary grade as browsecomp** (hle): reuse
  `answerEquivalenceJudgeSpec` + `ANSWER_EQUIVALENCE_JUDGE_CONFIG` as-is.
- **Different grader** (dsqa, widesearch): add
  `search/<suite>/grader.ts` implementing the official benchmark decision
  rule with the smallest native TypeScript contract that preserves it.

Use official benchmark examples and recorded grader outputs as golden vectors.
Do not add Python/pandas compatibility layers solely to mirror another port.

Per-item scoring (widesearch): map the aggregate to `Score.value`
(Correct iff perfect), put the real metrics (F1 etc.) in
`Benchmark.runLevelScores` → the `extra_scores` parquet column.

## Step 3 — Suite module

`benchmarks/search/<suite>/benchmark.ts`, mirroring
`browsecomp/benchmark.ts`:

- **Compose generation → judge with `flatMap`, NOT `chain()`** — the search
  solver marks the state `completed`, and `chain()` short-circuits on
  completed, silently skipping the judge. This bug cost a paid run; there is
  a regression test in `browsecomp/benchmark.test.ts` — write the same test
  for your suite.
- Skip the judge call when the answer is empty (can't be correct; saves a
  paid call).
- Export the composed solver factory (`make<Suite>Solver`) for fixture-driven
  tests (fixture `ResponsesService` distinguishes generation vs judge calls
  by `body.text !== undefined`).

## Step 4 — Registration (complete list; miss one and CI tells you)

1. `src/benchmarks/benchmark-meta.ts` — `<SUITE>_META` + map entry
2. `src/benchmarks/benchmark-config.ts` — config variant
   (`benchmarkId` literal, `model`,
   `lane: SearchLaneConfigSchema.default(...)`, the
   `InferenceOverrideSchema` spread, `maxRetries`), union entry,
   and add the options schema to `BENCHMARK_OPTIONS_SCHEMAS`
   (its `satisfies Record<ModelBenchmarkId, …>` is the
   exhaustiveness check). `modelFromConfig` / `endpointIdFromConfig`
   are shared schema-driven helpers — no per-benchmark switch to add.
3. `src/benchmarks/registry.ts` — import + map entry
4. `src/cli/index.ts` `buildBenchmarkConfig` — add the id to the
   `buildSchemaValidatedConfig` case group (lane comes in via
   `--solver-config` JSON)
5. `packages/temporal/src/schemas.ts` — add
   `startRequestVariant('search_<suite>')` to
   `BenchmarkStartRequestSchema`.
6. Regenerate the OpenAPI contract:
   `cd packages/temporal && bun run generate:benchmark-openapi`
   (a staleness test fails CI if you forget)

## Step 5 — Verify: smoke → calibrate → scale (cost gates)

Never jump to a full run. Escalate with explicit approval between tiers:

1. **Unit** — `bun test src/benchmarks/search/` (fixture layers, no network)
2. **Dataset smoke (free-ish)** — stream 3 samples through the real dataset
   layer; eyeball decrypted/mapped fields
3. **Run smoke (~$0.10)** — `--limit 5` through the CLI:

   ```bash
   OPENROUTER_API_KEY=... bun run src/cli/index.ts --benchmark <id> \
     --model openai/gpt-5.4-nano --limit 5 --concurrency 5 \
     --solver-config '{"reasoningEffort":"high",
       "lane":{"engine":"exa","maxAgentTurns":3,
               "maxResults":10,"maxTotalResults":100}}'
   ```

   Record every inference knob used by the run so calibration comparisons are
   reproducible.

   Read the parquet back (`readResultRows`) and check: verdicts present in
   `scorer_trajectory` (if empty, you probably hit the chain() bug),
   per-row `benchmark_config` carries the full lane, usage/cost non-zero.
4. **Calibration (~$2–3 at 3-turn)** — `--limit 100` on one engine; compare
   against the benchmark's published or official baseline before scaling.
5. **Matrix runs** — only after calibration matches; costs scale with
   `maxAgentTurns`.

## Style rules that reviews enforce here

- Reuse before redeclare: engines/enums from `internal/enums`,
  helpers from `providers/responses-client.ts` — grep first. The harness is standalone:
  no `@openrouter-monorepo/*` imports (see the upstream
  `AGENTS.md` at
  https://github.com/OpenRouterTeam/benchmark-harness/blob/main/AGENTS.md).
- Config knobs must plausibly vary across lanes or they don't exist
  (e.g. `userLocation` was cut).
- Comments: one line, why-not-what, no external planning-doc references.
