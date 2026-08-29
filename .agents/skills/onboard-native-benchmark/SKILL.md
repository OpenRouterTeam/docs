---
name: onboard-native-benchmark
description: Land a benchmark that already exists upstream in the bench-harness into this monorepo — subtree pull, Temporal start-request registration, benchmark OpenAPI regeneration, mission-control catalog metadata, and the subtree-integrity check. Use after the benchmark is merged in OpenRouterTeam/benchmark-harness, or when a benchmark runs from the harness CLI but not from Temporal or mission-control.
user-invocable: true
---

# Onboard a native benchmark into the monorepo

`packages/bench-harness` is externally owned, synced in as a read-only Git
subtree from `OpenRouterTeam/benchmark-harness`. This skill covers only the
internal integration that follows an upstream merge. Implementing the benchmark
itself, its dataset, solver, scorer, config schema, registry entry and CLI
wiring, happens upstream and is documented by the `add-benchmark` skill in that
repository.

Direct edits to `packages/bench-harness` fail the CI subtree-integrity check
(`scripts/check-subtree-integrity.ts`). If you need a harness change, land it
upstream first and come back here.

## 1. Pull the subtree

Run from the repo root on the branch you will open the PR from.

```bash
scripts/subtree-pull-bench-harness.sh          # latest main
scripts/subtree-pull-bench-harness.sh <branch> # a specific upstream branch
```

The script performs the squashed subtree pull and rewrites
`scripts/bench-harness-subtree.sha`, the expected tree SHA the integrity check
compares against. Commit that file with the pull. A pull whose recorded SHA is
missing or stale fails CI.

## 2. Register the benchmark with Temporal

Add `startRequestVariant('<bench_id>')` to `BenchmarkStartRequestSchema` in
`packages/temporal/src/schemas.ts`. The variant reads the benchmark's options
schema from the harness, so the id must already exist upstream in
`BENCHMARK_OPTIONS_SCHEMAS`. Its `satisfies` constraint is the exhaustiveness
net, so `bun run typecheck` fails if the wiring is incomplete.

## 3. Regenerate the benchmark OpenAPI spec

```bash
cd packages/temporal && bun run generate:benchmark-openapi
```

Commit the regenerated spec. A staleness-guard test
(`packages/temporal/scripts/generate-benchmark-openapi.test.ts`) fails CI otherwise.

## 4. Add mission-control catalog metadata

Add the entry to `NATIVE_BENCHMARK_METADATA` in
`projects/mission-control/app/benchmarks/benchmark-constants.ts` with the
display name, dataset size for the chunking preview, summary, developer,
dataset URL and details. `benchmark-constants.test.ts` asserts every startable
benchmark appears exactly once, so a missing or duplicated entry fails there.

Dataset sizes in that file drive UI preview only. Execution probes the real size
through the `getBenchmarkDatasetSize` activity.

## 5. Verify

```bash
bun run verify
bun run --filter @openrouter-monorepo/temporal test
bun run --filter @openrouter-monorepo/mission-control test
```

The functional check is that the benchmark starts from mission-control and the
Temporal workflow accepts its start request. Accuracy calibration belongs to the
upstream smoke run, not to this integration.

## What this skill does not cover

- Writing or changing any file under `packages/bench-harness`. That is upstream
  work under the harness `add-benchmark` skill.
- Running a full sweep or publishing results. Registration makes the benchmark
  startable, running it is a separate operation.

## Related skills

- [`stacked-prs`](../stacked-prs/SKILL.md) if the integration is large enough to
  split by layer.
- [`monitor-benchmark-run`](../monitor-benchmark-run/SKILL.md) for watching a
  run once the benchmark is startable.
