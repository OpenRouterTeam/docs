# gcp-harbor-run

The `publish` step of the `benchmark-run` WorkflowTemplate's exit handler (run lifecycle in `services/gcp-harbor-trial/README.md`): the one part of a Harbor run that needs this repository's database types. Planning and Harbor-native aggregation live in Python next to the trial worker (`services/gcp-harbor-trial`, `gcp-harbor-plan` / `gcp-harbor-finalize`) so Harbor's `TrialConfig` and `JobResult` are never re-described here.

It is a Bun-bundled CLI (`index.cjs`) built into `us-docker.pkg.dev/openrouter-ci/harbor/run`.

## What it does

Environment: `RUN_SPEC_JSON`, `WORKFLOW_NAME`, `RESULTS_BUCKET`, `PG_US_CENTRAL1_POOL_DB_URL`, optional `PLAN_INPUT_DIR` (`/inputs/plan`).

1. Reads the plan artifact (`plan.json`, `tasks.json`) to know which trials were planned and the dataset commit.
2. Downloads `gs://<RESULTS_BUCKET>/runs/<runId>/<workflow>/result.json`, the Harbor `JobResult` `gcp-harbor-finalize` published, and reads only the fields the rows need (`trial_name`, `task_name`, `verifier_result.rewards`, `agent_result` tokens and cost, `agent_execution` timing); unknown fields are stripped, never rejected.
3. Joins planned trials to results by trial name; a pod that left no result counts as reward 0.
4. Inserts `benchmark_results` rows (`benchmark_source = 'Harbor'`): one aggregate row plus one per attempt, mirroring the legacy per-epoch layout. A task is a question, scored as the mean primary reward over its attempts and correct at the legacy `>= 0.5` threshold. `run_config` is the spec as submitted plus `datasetCommit`.

Exit 2 means the environment or spec was rejected (never retried); exit 1 means publishing failed and Argo may retry.

## Kepler runs

Set `RUN_KIND=kepler` with `RUN_SPEC_JSON`, `WORKFLOW_NAME`, `RUN_STARTED_AT`, `ARTIFACTS_BUCKET`, `RESULTS_BUCKET`, `PG_US_CENTRAL1_POOL_DB_URL`, and optional `PLAN_INPUT_DIR` (`/inputs/plan`).

The publisher reads `plan.json` and `tasks.json`, then lists `gs://<ARTIFACTS_BUCKET>/runs/<workflow>/trials/` once and selects the highest numeric retry containing `status.json` for every planned trial.

A completed trial's `results_path` is mapped relative to `/artifacts` onto its retry prefix, downloaded, and decoded as v2 Parquet. Missing status files, non-completed outcomes, missing Parquet files, download failures, and invalid Parquet files count as missing results without aborting collection.

The decoded trial files are merged into `gs://<RESULTS_BUCKET>/runs/<runId>/<workflow>/result.parquet`, with score aggregates recomputed and file-level usage summed.

The publisher also writes `result.json` beside the Parquet with `started_at`, `finished_at`, `n_total_trials`, and `n_missing_results`.

Publication fails when no trial produced a readable result. Otherwise the database rows are inserted with `benchmark_source = 'Kepler'` (rows written before the Kepler rename carry `'NativeTS'`), and the run is complete only when `n_missing_results` is zero.

## Development

```bash
bun test
bun run typecheck
bun run build   # dist/index.cjs, consumed by the Dockerfile
```
