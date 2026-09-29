---
name: verify-batch-billing
description: >-
  Prove the ECO-3228 incremental batch billing flow works, cold, from a fresh
  checkout: launch the Spanner and Pub/Sub emulators, doctor the instance, drive
  each built feature (contract parity in both languages, the settlement
  transaction, retry and DLQ routing, lane-extraction parity, deploy-script
  wiring, job completion, finalize DLQ replay) and capture evidence that
  survives cleanup. v1 covers the Dataflow consumer (ECO-3188), completion
  (ECO-3189) and finalize DLQ replay (ECO-3706); the feature map carries stubs
  for the producer (ECO-3186) and Datadog auditability (ECO-3193) and an
  operator runbook for the staging soak (ECO-3192, ECO-4062). Use after any change under services/usage-record or
  services/batch-api/src/finalize-dlq touching batch billing, or when asked to
  verify batch billing.
user-invocable: true
---

# Verify batch billing

This skill is written for an agent that has never seen the flow. Follow it top to bottom: Launch, Doctor, Drive every built feature in `features/`, write Evidence, Cleanup. A run that skips a built feature is incomplete; say so in the summary instead of marking it passed.

The flow under verification: `services/batch-api` (producer, active only for jobs whose accept-time `batch_billing_mode` LiveConfig target selected `incremental`) publishes billing-chunk messages; the Dataflow consumer in `services/usage-record/dataflow` settles each chunk in one Spanner transaction, deduped by `generation_id`, with three attempts and a typed dead-letter topic. The wire contract lives in both `services/usage-record/types/batch-billing-chunks.ts` and `dataflow/src/openrouter_monorepo/usage_record/batch_billing_chunk.py`, kept in lockstep by the shared fixtures under `services/usage-record/types/fixtures/`.

Accept selects the mode from the LiveConfig target at submit time and persists it on the job. During targeted rollout, a failed latest LiveConfig refresh intentionally sends new jobs to the compiled `legacy` default until a refresh succeeds. Before declaring full cutover, change that fallback to `incremental` and update the outage and recovery assertions. Existing jobs remain on their persisted mode through either policy.

## Scope and growth plan

Built (v1, ECO-3188): contract parity, settlement transaction, retry and DLQ routing, lane-extraction parity, deploy wiring. Built (ECO-3189): job completion. Built (ECO-3706): finalize DLQ replay. Each has a file in `features/` with the drive commands and the assertion lines that count as proof.

Stubs (evidence defined, not yet drivable): `features/producer.md`, `features/datadog-auditability.md`. Operator runbook, outside the cold Drive: `features/staging-soak.md` (ECO-4062) needs applied staging Terraform, prod endpoint rows and LiveConfig edits, so it is run by hand and its numbers are recorded there, not in `$RUN_DIR`. When a ticket lands, replace the stub's "Expected evidence" with real drive commands and add the feature to the Drive list below. Do not delete stubs; they are the growth plan.

## Launch

Emulators run under Docker (OrbStack on this team's machines). From the repo root:

```bash
cd services/usage-record && bun run dataflow:emulators
```

This runs `docker compose` with `dev/docker-compose.spanner.yaml` and `dev/docker-compose.pubsub.yaml` as project `dev`. The migrate script logs a Postgres `DB Context Not Found` warning because it is run outside Infisical; that is noise, the Spanner migration still runs (`wrench` prints `no change` when current). Readiness: containers `dev-spanner-1` and `dev-pubsub-1` are `Up`, Spanner answers on `localhost:9010`, Pub/Sub answers on `localhost:8086` (not 8085; the compose file avoids it because it conflicts with `gcloud auth login`).

Apply migrations once per fresh emulator. The `bun run spanner:migrate` wrapper needs an interactive Infisical login, so call the script directly; it is idempotent (`wrench migrate up`):

```bash
cd services/usage-record && ./node_modules/.bin/tsx scripts/dev-migrate.ts
```

Python dependencies are per worktree:

```bash
cd services/usage-record/dataflow && uv sync
```

Every Python command below that touches the emulator needs `OR_ENV=development SPANNER_EMULATOR_HOST=localhost:9010 PUBSUB_EMULATOR_HOST=localhost:8086`.

## Doctor

Non-destructive. Answers "is this instance worth driving?" and names the action when it is not. The `dev-migrate.ts` line is the one write: it re-runs the idempotent `wrench migrate up` from Launch and prints `no change` when the schema is current, so it is safe on an instance another session owns.

```bash
set -e
cd "$(git rev-parse --show-toplevel)"
docker context show
nc -z localhost 9010 || { echo "Spanner emulator down: cd services/usage-record && bun run dataflow:emulators"; exit 1; }
nc -z localhost 8086 || { echo "Pub/Sub emulator down: same command; check dev-pubsub-1 with docker ps"; exit 1; }
docker ps --filter name=dev-spanner-1 --filter name=dev-pubsub-1 --format '{{.Names}} {{.Status}}'
(cd services/usage-record && ./node_modules/.bin/tsx scripts/dev-migrate.ts 2>&1 | grep -E 'no change|/up$' | tail -1) || { echo "migrations failed: is the emulator healthy?"; exit 1; }
(cd services/usage-record/dataflow && uv run python -c "import apache_beam") || { echo "python env missing: cd services/usage-record/dataflow && uv sync"; exit 1; }
[ -x node_modules/.bin/tsx ] || { echo "node_modules missing: bun install --frozen-lockfile"; exit 1; }
echo doctor-ok
```

If a container is unhealthy and you did not start it, stop here and report; another session may own it. Never `docker compose down` a project you did not bring up.

## Drive

Run every command from the repo root unless noted. Capture stdout, stderr and the exit code of each (see Evidence). The assertion lines to look for are in each feature file.

1. Contract parity, TypeScript: `cd services/usage-record && bun test ./types/batch-billing-chunks.test.ts`. Must print `batch-billing-chunks fixtures: accepted=A rejected=R total=N`.
2. Contract parity, Python: `cd services/usage-record/dataflow && uv run pytest tests/test_batch_billing_chunk.py tests/test_json_patch.py -q`. Must print the identical `accepted=A rejected=R total=N` line. A mismatch between 1 and 2 is a contract bug, not a flake.
3. Settlement transaction (emulator): `cd services/usage-record/dataflow && OR_ENV=development SPANNER_EMULATOR_HOST=localhost:9010 PUBSUB_EMULATOR_HOST=localhost:8086 uv run pytest tests/integration/test_batch_billing_integration.py -v`. See `features/settlement-transaction.md` for the per-test assertions (`settled_generation_count = 100`, `released_estimated_cost = 4`, capped release, rollback on injected fault, concurrent duplicate delivery).
4. Retry and DLQ routing: `cd services/usage-record/dataflow && uv run pytest tests/test_batch_billing_stream.py tests/test_batch_billing_failure.py tests/test_batch_billing_chunk_writer.py -v`. See `features/retry-and-dlq-routing.md`.
5. Lane-extraction parity: `cd services/usage-record/dataflow && OR_ENV=development SPANNER_EMULATOR_HOST=localhost:9010 PUBSUB_EMULATOR_HOST=localhost:8086 uv run pytest tests/test_generation_writer_sql_snapshot.py tests/integration/test_lane_extraction_parity_integration.py tests/integration/test_generation_writer_helpers_integration.py -v`. See `features/lane-extraction-parity.md`; the parity module is written to pass unchanged on `main`, which is the proof the refactor preserved behaviour. The snapshot test pins the production `LOCK_HINT` itself, so it is safe to run under the emulator env; if it ever reports a lock-hint-only diff, the pin was removed, not the SQL changed.
6. Deploy wiring: `cd services/usage-record && bun test ./scripts/dataflow-deploy.test.ts` plus `cd dataflow && uv run pytest tests/test_env_config.py -q`. See `features/deploy-wiring.md`.
7. Job completion (emulator): `cd services/usage-record/dataflow && OR_ENV=development SPANNER_EMULATOR_HOST=localhost:9010 PUBSUB_EMULATOR_HOST=localhost:8086 uv run pytest tests/integration/test_batch_completion_integration.py -v`. See `features/job-completion.md`; one named test per ECO-3189 acceptance criterion, the AC number is in the test name.
8. Finalize DLQ replay: `bun test services/batch-api/src/finalize-dlq services/batch-api/src/pubsub/pubsub-subscriber.test.ts`. See `features/dlq-replay.md` for the live-replay cases that count as proof and for the emulator drive of the CLI.

Do not pin test counts anywhere; they change with every fixture or case added. Pin the assertion lines and the parity line instead.

## Spanner point lookups name the hash column

Every ad-hoc read of `generations`, `async_jobs` or `pending_charges` by ID, in a feature file or a run summary, filters on the hash column as well as the ID; the by-id indexes are keyed `(<id>_hash, <id>)` and a predicate on the ID alone scans them (`services/usage-record/dataflow/AGENTS.md`, `Point lookups by ID filter on the hash column too`). Write the lookup as:

```sql
SELECT ... FROM generations@{FORCE_INDEX=generations_by_id}
WHERE generation_id_hash = SUBSTR(SHA256('<id>'), 1, 4) AND generation_id = '<id>'
LIMIT 1;
```

For `async_jobs` and `pending_charges` the pair is `job_id_hash = SUBSTR(SHA256('<id>'), 1, 4) AND job_id = '<id>'`. For a short list of IDs, OR-chain one pair per ID. A fast return against a small staging table without the hash is not evidence the shape is right.

## Evidence

Create one directory per run and never delete it:

```bash
RUN_DIR="/tmp/verify-batch-billing/$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$RUN_DIR"
git rev-parse HEAD > "$RUN_DIR/git-sha.txt"
```

For each Drive step write `$RUN_DIR/<feature>.log` containing the exact command, the exit code, and the full combined output (never a tail: with `-v` the named assertions scroll past any tail, and the log is the only place the evidence line can be copied from). Then write `$RUN_DIR/summary.md` with one row per feature: feature, command, exit code, the key evidence line copied verbatim (the parity line, the named assertion, or `not run: <reason>`). A feature you could not run is reported as not run, never as passed. Proof standards: real code paths only (emulator, `TestPipeline`), no mocked Spanner; quote the assertion line, not just `passed`; record the SHA verified.

## Cleanup

This skill starts nothing long-lived. If you brought the emulators up for this run and nothing else is using them, `docker compose -p dev down` from the repo root; if they were already running when you arrived, leave them. Never kill by process name. Confirm `$RUN_DIR/summary.md` still exists after cleanup and print its path in your final report.

## Feature map

`features/README.md` is the index. Built: `contract-parity.md`, `settlement-transaction.md`, `retry-and-dlq-routing.md`, `lane-extraction-parity.md`, `deploy-wiring.md`, `job-completion.md`, `dlq-replay.md`. Stubs: `producer.md`, `datadog-auditability.md`. Operator runbook: `staging-soak.md`. A proof that drives one convenient entry point is incomplete when the map lists others.
