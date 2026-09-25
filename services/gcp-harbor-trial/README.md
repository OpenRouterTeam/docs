# GCP Harbor Trial

One image, three entrypoints, all built on the Harbor library's own models so nothing is re-described in another language:

- `gcp-harbor-plan`: clones the benchmark dataset, lets Harbor's `DatasetConfig` discover and filter the tasks, sizes one pod per task from `task.toml`, and expands tasks x attempts into `TrialConfig`s with Harbor's `JobPlan.build_trial_configs`.
- `gcp-harbor-trial`: runs one trial per process with `Trial.create(config)` / `trial.run()`.
- `gcp-harbor-finalize`: collects every trial's `result.json` from the artifact bucket and folds them into Harbor's job-level `JobResult` (stats, mean reward, pass@k), so a run reads like a Harbor job directory. It also emits one v2 benchmark result row per planned trial attempt (`result_row.py`, the Parquet contract from `packages/bench-harness/src/results/parquet.ts`), written as `result.parquet` beside the job-level `result.json`. Attempts the plan scheduled but Harbor never scored (worker error, cancelled, no status) still get a row, scored `I` with `metadata` of `{"trial_name", "outcome", "scored": false}` (`scored: false` is the publisher's only marker for an unscored attempt), so accuracy counts them like the native harness would. Harbor attempt `-a<n>` maps to the zero-based `epoch` column (`n - 1`), matching native rows. The row copies the trial's `agent/trajectory.json` (ATIF) verbatim into `trajectory`, or null when the agent wrote none. `result-columns.json` is the checked-in export of the TS column specs; `tests/test_result_row.py` fails when the pyarrow schema drifts from it. `generation_ids` holds the sorted, deduplicated OpenRouter generation IDs found in the trial's `agent/trajectory.json` (Ori's ATIF `steps[].extra.generation_ids`) and, for Harbor's built-in Claude Code agent, the raw `agent/claude-code.txt` stream (assistant `message.id` and `model_refusal_fallback.request_id`), or null when none were found (`generation_ids.py`).

After the parquet is written, `finalize` reconciles the run's billing (`wastage.py`). The planner gives every trial the OpenRouter session ID `<runId>/<workflowUid>/<trial>` (`session_id.py`) and templates the agent's `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` and `ORI_OPENROUTER_BASE_URL` on `${HARBOR_*_BASE_URL}` placeholders. Before `Trial.create`, the worker starts a per-trial egress proxy (`proxy.py`) bound to the Docker bridge gateway, exports the placeholder values pointing at it, and allowlists the gateway for the agent and environment. The proxy forwards every request to `https://openrouter.ai` over TLS with a proxy-owned `X-Session-Id` (a caller-supplied one is dropped), and logs neither headers nor bodies, so every generation of a run, Claude Code's hidden helper calls included, lands in ClickHouse `generations.session_id` under the `<runId>/<workflowUid>/` prefix regardless of agent version. Trials whose config carries no `OPENROUTER_SESSION_ID` run without the proxy. Not yet verified in the deployed Argo pod: that the dind gateway address is bindable from the worker and reachable from task containers under Harbor's egress sidecar. When `CLICKHOUSE_URL` (https only), `CLICKHOUSE_USERNAME` and `CLICKHOUSE_PASSWORD` are set, `finalize` queries `default.generations FINAL` for that prefix inside the run's time window (plus one hour of slack), compares it with the union of recorded `generation_ids`, and writes `wastage.json` beside `result.parquet` with billed count and cost, recorded count and cost, unrecorded count and cost (the wastage), recorded IDs missing from ClickHouse, and a per-`model_permaslug` breakdown. `queried_at` records when ClickHouse was last read and `query_attempts` how many times it was queried. ClickHouse ingestion lags the last generation, so `finalize` sleeps `WASTAGE_INGESTION_WAIT_SECONDS` (default 0) before the first query and, while some recorded IDs are still missing from ClickHouse and each query finds fewer missing than the last, queries again after `WASTAGE_INGESTION_RETRY_INTERVAL_SECONDS` (default 60), at most `WASTAGE_INGESTION_MAX_RETRIES` times (default 5). Delays above 86400 seconds, retry counts above 1000, and any non-numeric or negative value fall back to the default. The last attempt is the summary, so rows ingested after it are not counted. Optional `CLICKHOUSE_BENCHMARK_CLERK_USER_ID` narrows the query to the benchmark account and `WASTAGE_MAX_USD` marks the summary `threshold_exceeded` when unrecorded cost is above it. The step is warn-only. Without ClickHouse configuration it is skipped, and a query, validation or upload failure is logged (class name only) and recorded in the summary's `error` without failing publication.

Argo Workflows owns scheduling, concurrency and retries through the `benchmark-run` WorkflowTemplate, which OpenTofu applies from `OpenRouterTeam/openrouter-infra` (`terraform/benchmarking/helm/benchmarking-argo-workflows/files/benchmark-run-template.yaml`); Harbor's in-process job queue is never used. The only contract defined here is `RunSpec` (`run_spec.py`), the JSON a submitter passes to the WorkflowTemplate; `services/gcp-harbor-run` reads the same JSON and the published `result.json` to write `benchmark_results` rows.

## Planning a run

`gcp-harbor-plan` reads `RUN_SPEC_JSON` and writes two artifacts: `/outputs/tasks/<task>/` (the selected task directories, copied verbatim) and `/outputs/plan/` with `tasks.json` (the Argo fan-out list: task name, pod-name-safe trial prefix, isolation, `podSpecPatch` as a JSON object so Argo's `{{item.podSpecPatch}}` renders it as JSON rather than an escaped string), `attempts`, `plan.json` (dataset commit, counts, tasks rejected as unsupported and why) and `trial-configs/<trial>.json`, one Harbor `TrialConfig` per attempt, named `<prefix>-a<n>`.

When `TASK_IMAGE_MIRROR` is set (an Artifact Registry virtual repository such as `us-docker.pkg.dev/openrouter-ci/docker-mirror`), the planner rewrites image references in the copied task directories, not the checkout, so the trial dockerd pulls through the mirror: `docker_image` values in `task.toml` and `FROM` lines in every Dockerfile whose registry is listed in `images.py` (`public.ecr.aws` today; Docker Hub is left alone because the trial dockerd already has `--registry-mirror`). The trial CLI authenticates to the mirror through the `ARTIFACT_REGISTRY_HOSTS` credential helper below.

Pod sizing comes from the task's declared `cpus`/`memory_mb`/`storage_mb`/`gpus` plus fixed overhead for dockerd and the worker (`sizing.py`); a task that declares no `cpus`/`memory_mb` is reported as unsupported rather than defaulted, because with no cap its score would depend on the node it landed on. Agentic benchmarks get required pod anti-affinity so no two trial pods share a node. Only a pod whose ephemeral-storage request exceeds 200 GiB, more than the boot-disk pools can reliably hold, tolerates the `bench.openrouter.ai/highstorage` taint on the local-SSD pool, so smaller tasks never land there. Every trial pod also requires a node outside the untainted `system` pool, because a toleration permits the trial pools but does not exclude untainted nodes. Adding a benchmark is one entry in `benchmarks.py`.

## How a trial runs

Every trial is one Argo pod with two containers:

- `main`: this image. It loads a planner-emitted `TrialConfig`, calls `Trial.create(config)` / `trial.run()` from the Harbor library, and reports an outcome.
- `dockerd`: a privileged `docker:dind` sidecar listening on `tcp://127.0.0.1:2375`. Harbor's built-in `docker` environment drives it through `DOCKER_HOST`. It must mount the attempt tree (`/artifacts`) at the same absolute path as this container: Harbor bind-mounts `trials/<attempt-id>/{agent,verifier,artifacts}` into the sandbox, and the daemon resolves bind sources in its own filesystem.

The worker runs Harbor's reference Docker environment through a thin subclass, `BullseyeSecurityPinnedEnvironment`, whose only addition is pinning `bullseye-security` to the snapshot recorded in the image's `/etc/apt/sources.list` after the sandbox starts. The live `bullseye-security` index lists packages its pool no longer serves, so agent installs on bullseye images otherwise fail with 404s. Everything Harbor implements for Docker works here with no worker-side code: Dockerfile and compose tasks, prebuilt `docker_image` references, `network_mode = "no-network"` / allowlists / dynamic network policy through Harbor's egress sidecar, separate verifier environments, and `[[verifier.collect]]`. Onboarding a new Harbor-compatible benchmark is one registry entry in `benchmarks.py`. GPU tasks are the exception: Harbor 0.23's Docker environment cannot allocate GPUs, so a task whose effective environment (after any `override_*` in the trial config) needs a GPU or TPU, or targets Windows, is rejected as `INVALID_CONFIG` until nested GPU passthrough lands.

The image's entrypoint (`trial-entrypoint`) waits for the sidecar, then points the Docker CLI at the `gcp-metadata` credential helper for every host in `ARTIFACT_REGISTRY_HOSTS`. The helper mints a Workload Identity access token from the metadata server on each registry request, so long builds, agent phases, and late separate-verifier pulls never run on an expired token.

The pod boundary provides the second layer of isolation: pod resources come from `task.toml` via Argo `podSpecPatch`, agentic trials get a node to themselves through pod anti-affinity, the dind sidecar's `DOCKER-USER` chain rejects sandbox traffic to the metadata server and cluster ranges, a NetworkPolicy keeps the pod off the cluster network, and the daemon's state lives on a pod-scoped `emptyDir` that disappears with the pod. No sandbox cleanup runs in the worker because the daemon dies with the pod.

## Local development

Install `uv`, then run from this directory:

```bash
uv sync --frozen
bun run uv-lint
bun run uv-typecheck
bun run uv-test
```

The tests do not make model, Docker, or GCP calls. The Harbor contract test uses the installed library with a nop agent and mocked Docker start/stop operations; the plan tests clone a temporary local git repository and feed the emitted `trial-configs/*.json` back through the worker's config loader.

## Execute an attempt

Materialize the task directory before execution. Git/package task downloads and regrading are not supported. `task.path` must be an absolute path that resolves under `--tasks-root` (the mounted inputs directory) and contain a parseable `task.toml`; anything else is `INVALID_CONFIG`, not a retryable worker error.

```bash
uv run --frozen gcp-harbor-trial \
  --config /inputs/trial.json \
  --output-dir /artifacts \
  --attempt-id trial-pod-unique-uid \
  --tasks-root /inputs/tasks
```

`trial.json` uses Harbor's `TrialConfig` schema, not its `JobConfig` schema. `environment.type` may be omitted (it defaults to `docker`) or set to `docker`; any other type is rejected, as is a custom `import_path` on the environment or verifier (those load Python in this container, next to the Docker daemon). The worker sets the environment `import_path` to `BullseyeSecurityPinnedEnvironment` itself after validation. A custom agent `import_path` is accepted only when it is exactly `gcp_harbor_trial.agents.ori:OriAgent`. A setup-only smoke test looks like this:

```json
{
  "task": { "path": "/inputs/task" },
  "agent": { "name": "nop" },
  "install_only": true,
  "environment": { "type": "docker", "delete": true }
}
```

To evaluate an agent, configure the agent/model and remove `install_only`. Do not treat setup-only or verification-disabled results as benchmark scores.

### Ori agents

The run spec agent names `ori-pi`, `ori-claude`, `ori-prime-agent`, and `ori-omp` plan to the single custom agent `gcp_harbor_trial.agents.ori:OriAgent` with `kwargs.harness` set to the harness. Optional kwargs are `reasoning_effort` (default `medium`), `ori_channel` (`stable` or `alpha`), `agent_package` (an npm spec or tarball URL replacing the pinned default), and `ori_install_url`. `install()` bootstraps nvm, Node 22, the harness package, and ori into `/usr/local/bin` inside the task container, so the planner adds the package and installer hosts to the agent's `extra_allowed_hosts` for these agents only, plus the hosts of any custom `agent_package` or `ori_install_url` URL and, for `prime-agent`, the hosts its postinstall bootstrap (`fd`, `ripgrep`, `uv`, and the kernel Python) downloads from. `run()` invokes `ori <harness> --model ... -- <harness flags>` headlessly with `OPENROUTER_API_KEY` from the trial env and tees stdout to `/logs/agent/ori-<harness>.jsonl`. `populate_context_post_run()` parses the newest persisted pi session (`/logs/agent/sessions/*.jsonl`, or the stdout log for harnesses that do not persist one) into an `ATIF-v1.8` `trajectory.json` and sets the context token and cost totals from the summed per-message usage.

## Attempt contract

The caller supplies a globally unique physical attempt ID (the Argo pod name). IDs are 1–48 lowercase letters/digits with optional single interior hyphens; trailing or repeated hyphens are rejected because Harbor normalizes them into colliding container names. The worker sets Harbor's `trial_name` to this ID and overrides `trials_dir` so config-supplied output paths are not used.

Artifacts are written under `/artifacts/<attempt-id>/`:

- `trials/<attempt-id>/`: Harbor's config, lock, result, and collected logs/artifacts.
- `runner.log`: restricted stdout/stderr from Harbor, dependencies, and child processes during execution.
- `status.json`: atomically replaced worker outcome, containing only attempt ID, outcome, and exit code.

An existing attempt directory is an error, even if incomplete; the worker never deletes or reuses it. A retry needs a new attempt ID, which Argo provides because every retry is a new pod.

| Exit code | Outcome | Meaning |
| --- | --- | --- |
| 0 | `COMPLETED` | Harbor returned without recorded trial/step exceptions and its finished result was validated on disk. A zero reward is still completed. |
| 2 | `INVALID_CONFIG` | Invalid arguments, config, or unsupported task/environment. |
| 10 | `TRIAL_ERROR` | Harbor returned a result with a trial/step exception. Rewards may coexist with the exception and remain in the result. |
| 20 | `WORKER_ERROR` | Creation/execution raised, or artifact persistence/validation failed. |
| 130 | `CANCELLED` | SIGTERM/SIGINT cancellation; the worker awaits Harbor's cleanup. |

The Argo trial template retries only `20`, `130`, and pod-level errors. Agent timeouts and wrong answers (`0`, `10`) are results, not infrastructure failures, and are never retried.

## Credentials and trust boundary

This is an operator-controlled executable, not a public submission API. Only run reviewed task directories and trusted configs: Harbor supports host-side agent/verifier imports, scripts, skills, and arbitrary provider kwargs. Schema validation is not a security boundary for untrusted submissions.

The pod runs as `argo/harbor-trial` with `automountServiceAccountToken: false`; the Argo executor uploads artifacts to GCS. Inference credentials arrive from the `bench-openrouter-api-key` Kubernetes Secret (synced from Secret Manager by `openrouter-infra`) mounted as environment variables; do not put literal credentials into configs or command arguments. Treat the entire artifact directory as sensitive: it can contain prompts, completions, and upstream exception details despite Harbor's secret scrubbing.

Attempt directories are created with mode `0700`. Worker console logging emits outcome names and exception class names, not config bodies or exception messages. During Harbor execution, stdout/stderr file descriptors are redirected to the private `runner.log`, including dependency-owned console handlers and child processes. Harbor telemetry is disabled by the CLI and container.

## Container

Build with this service directory as the context:

```bash
docker build -t gcp-harbor-trial services/gcp-harbor-trial
```

The image includes Python, Harbor, the Docker CLI with the buildx and compose plugins, and runs as a non-root user with `DOCKER_HOST` pointing at the sidecar. `.github/workflows/deploy-gcp-harbor.yaml` publishes it to `us-docker.pkg.dev/openrouter-ci/harbor/trial`.

## Run lifecycle

A run is one `Workflow` created with `workflowTemplateRef: benchmark-run`, a `run-id`, the `RunSpec` JSON as `run-spec`, `trial-image` / `run-image` set to the SHA tags `.github/workflows/deploy-gcp-harbor.yaml` published, and `spec.parallelism` set to the spec's concurrency.

1. `plan` (image `harbor/trial`, `gcp-harbor-plan`, identity `harbor-run`) clones the dataset, lets Harbor discover and filter the tasks, sizes every task from `task.toml`, expands tasks x attempts into Harbor `TrialConfig`s and writes two artifacts: `runs/<workflow>/plan` (`tasks.json`, `attempts`, `plan.json`, `trial-configs/<trial>.json`) and `runs/<workflow>/tasks` (the selected task directories, verbatim).
2. `trials` fans out over `tasks.json`, then over attempts `1..N`. Each trial is one pod named `<prefix>-a<attempt>`: this worker plus a privileged `docker:dind` sidecar sized by the planner's `podSpecPatch`. Harbor builds the task image inside that dind. Output artifacts land unarchived at `runs/<workflow>/trials/<trial>/<retry>/`.
3. `exit-handler` runs on success, failure and `Stop`: `finalize` (`gcp-harbor-finalize`) folds every scored `result.json` into `gs://<results bucket>/runs/<runId>/<workflow>/result.json`, Harbor's job-level `JobResult`, and writes the per-trial v2 rows next to it as `result.parquet`; `publish` (`services/gcp-harbor-run`) turns that file into `benchmark_results` rows.

Cancel a run with `spec.shutdown: Stop` so the exit handler still publishes what finished; `Terminate` skips it.

Only infrastructure failures are retried (up to 3 times, on a fresh pod): worker exit 20, exit 130 and pod-level errors. Exit 0 (trial completed, whatever the reward), 2 (rejected config) and 10 (Harbor exception) are results, and the `run` DAG has `failFast: false` so one of them never stops the rest of the fan-out.

## Images

`.github/workflows/deploy-gcp-harbor.yaml` builds `harbor/trial` and `harbor/run` on every `main` push touching either service or a bundled package, tagging each with the commit SHA and `main`. Both `main` tags move only after both images built. The WorkflowTemplate has no image defaults: submit with the SHA tags so a long run never mixes revisions.
