# gcp-bench-trial

This image runs one Kepler benchmark trial or creates a Kepler benchmark plan for an Argo Workflows job.

Trial mode is the default; pass `plan` as argv or set `MODE=plan` for plan mode.

Trial mode reads `RUN_SPEC_JSON` with a spec such as:

```json
{"runId":"smoke-1","benchmarkId":"gpqa_diamond","model":"openai/gpt-4o-mini","range":{"start":0,"limit":2},"outputDir":"/artifacts"}
```

Plan mode reads `RUN_SPEC_JSON` with a spec such as the following; every Kepler trial runs exactly one sample:

```json
{"runId":"smoke-1","benchmarkId":"gpqa_diamond","model":"openai/gpt-4o-mini","limit":25}
```

| Field | Trial | Plan |
| --- | --- | --- |
| `runId` | Required; matches `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; maximum 40 characters | Required; matches `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; maximum 40 characters |
| `benchmarkId` | Required, non-empty benchmark identifier | Required, non-empty benchmark identifier |
| `model` | Required, non-empty model identifier | Required, non-empty model identifier |
| `providerName` | Optional pinned provider; disables fallbacks | Optional pinned provider; disables fallbacks |
| `endpointId` | Optional endpoint UUID | Optional endpoint UUID |
| `epochs` | Positive integer; defaults to `1` | Positive integer; defaults to `1` |
| `maxConcurrency` | Positive integer; defaults to `10` | Positive integer; defaults to `10` |
| `range` | Required object with nonnegative integer `start` and positive integer `limit` | — |
| `chunkIndex` | Optional nonnegative integer; defaults to session suffix `0` when absent | — |
| `outputDir` | Non-empty artifact directory; defaults to `/artifacts` | — |
| `limit` | — | Optional positive total sample count |
| `offset` | — | Optional nonnegative first sample index |
| `temperature` | Optional number | Optional number |
| `maxTokens` | Optional positive integer | Optional positive integer |
| `reasoningEffort` | Optional supported reasoning-effort value | Optional supported reasoning-effort value |
| `timeoutMs` | Optional positive integer request timeout in milliseconds | Optional positive integer request timeout in milliseconds |
| `maxRetries` | Optional nonnegative integer retry count | Optional nonnegative integer retry count |
| `baseUrl` | Optional URL; only allowlisted inference origins are accepted | Optional URL; only allowlisted inference origins are accepted |
| `benchmarkOptions` | Benchmark-specific object; defaults to `{}` | Benchmark-specific object; defaults to `{}` |

`range` is a half-open sample window: `start` is the first sample index and `limit` is the sample count.

`maxTokens` should normally be left unset because truncation invalidates benchmark results.

Set `BENCHMARKING_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY` for trial mode, and optionally set `ATTEMPT_ID` for status identity.

Set `PLAN_OUTPUT_DIR` to change the plan artifact directory; it defaults to `/outputs/plan`.

Trial output is `<outputDir>/<benchmarkId>-<safeModel>-<sessionId>.parquet` in harness result format version 2 plus `status.json`.

`status.json` contains `attempt_id`, `outcome`, `exit_code`, `results_path`, and an optional `error_message`.

Plan output contains `plan.json` with the Kepler summary and `tasks.json` with Kepler task entries, trial prefixes, chunks, and run specs.

| Outcome | Exit code | Argo behavior |
| --- | ---: | --- |
| `COMPLETED` | 0 | success |
| `INVALID_CONFIG` | 2 | do not retry |
| `TRIAL_ERROR` | 10 | do not retry |
| `WORKER_ERROR` | 20 | retry |
| `CANCELLED` | 130 | do not retry |

The intended image name is `us-docker.pkg.dev/openrouter-ci/harbor/bench-trial`.

Build locally with `bun run --cwd services/gcp-bench-trial build` followed by `docker build -t gcp-bench-trial:dev services/gcp-bench-trial`.

Run a trial locally with `docker run --rm -e RUN_SPEC_JSON='{"runId":"smoke-1","benchmarkId":"gpqa_diamond","model":"openai/gpt-4o-mini","range":{"start":0,"limit":2},"outputDir":"/artifacts"}' -e OPENROUTER_API_KEY -v "$PWD/tmp-artifacts:/artifacts" gcp-bench-trial:dev`.

Run planning locally with `docker run --rm -e MODE=plan -e RUN_SPEC_JSON='{"runId":"smoke-1","benchmarkId":"gpqa_diamond","model":"openai/gpt-4o-mini","limit":25}' -v "$PWD/tmp-plan:/outputs/plan" gcp-bench-trial:dev`.

Epochs run inside a trial and are not expanded into separate trials.

The Argo template change belongs in the `openrouter-infra` repository.
