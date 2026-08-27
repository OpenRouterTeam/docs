---
name: tilt-testing
description: >-
  Validate Tilt service readiness before running tests. Covers unit tests
  (no Tilt needed), E2E / manual web / cURL tests (services must be ready),
  restarting and recovering resources, manual-trigger resource reference,
  Infisical machine-identity auth for non-interactive environments,
  and running cfw-api standalone (without Tilt / k8s).
user-invocable: true
---

# Tilt Service Readiness for Testing

This skill documents how to validate that the local Tilt dev stack is ready
before running different types of tests.

The dev stack is orchestrated by Tilt (see `Tiltfile` at repo root). Some
resources are **manual-trigger** (`auto_init=False`, `TRIGGER_MODE_MANUAL`) and
will never become ready unless explicitly triggered. The Tiltfile currently
defines 69 resource declarations: `local_resource`, `dc_resource`, and
`local_resource_with_skip` calls.

```bash
# Regenerate the full/lean manual and auto-init lists from Tiltfile.
python3 - <<'PY'
import ast

tree = ast.parse(open("Tiltfile").read())
resources = []
for node in ast.walk(tree):
    if not (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id
        in {"local_resource", "dc_resource", "local_resource_with_skip"}
    ):
        continue
    name = ast.literal_eval(node.args[0])
    kwargs = {item.arg: item.value for item in node.keywords if item.arg}
    stars = {ast.unparse(item.value) for item in node.keywords if item.arg is None}
    explicit_manual = (
        isinstance(kwargs.get("auto_init"), ast.Constant)
        and kwargs["auto_init"].value is False
    ) or (
        isinstance(kwargs.get("trigger_mode"), ast.Name)
        and kwargs["trigger_mode"].id == "TRIGGER_MODE_MANUAL"
    )
    resources.append((node.lineno, name, explicit_manual, stars))

resources.sort()
full_manual = {
    name for _, name, explicit, _ in resources if explicit or name == "docs"
}
lean_manual = {
    name
    for _, name, explicit, stars in resources
    if explicit or name == "docs" or "_LEAN_MANUAL" in stars
}
full_auto = {name for _, name, _, _ in resources} - full_manual
lean_auto = {name for _, name, _, _ in resources} - lean_manual
for label, names in (
    ("full_manual", full_manual),
    ("lean_manual", lean_manual),
    ("full_auto", full_auto),
    ("lean_auto", lean_auto),
):
    print(f"{label} ({len(names)}):")
    print(" ".join(name for _, name, _, _ in resources if name in names))
PY
```

---

## 0. Token bootstrap (run before any `bun run db:*` or `tilt` command)

The machine-identity token is cached by the shell hook installed by the
blueprint. For a shell without that hook, use this one-liner:

```bash
if [ -z "${INFISICAL_TOKEN:-}" ]; then INFISICAL_TOKEN="$(infisical login --method=universal-auth --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --plain --silent 2>/dev/null)" && export INFISICAL_TOKEN || { echo "Infisical login failed" >&2; exit 1; }; fi
```

`bun run dev:up` performs this bootstrap automatically.

---

## Shared machine etiquette (multi-agent hosts)

Several agent sessions may share one machine (DEV-714). The stack has
single-instance defaults — fixed ports, one global Postgres container
(`openrouter-web_db`, port 54322) with one schema — so sessions can
collide. Before and after `tilt up`:

- **Preflight first**: `bun run dev:doctor` reports occupied dev ports
  (with owning PID/command) and Postgres migration drift, each with the
  exact remedy. Run it before `tilt up`. On a stack that is already
  running, only the Postgres/migration half is meaningful — the port check
  will flag your own live processes (including your own tilt) as occupied
  and exit 1, which is expected, not a problem.
- **Check ownership before killing.** A listener on 8787/8801/etc. may be
  another agent's *live* session, not a corpse. Alive test: its Tilt API
  port responds (default 10350, or the session's `TILT_PORT` from its
  `.env.worktree`) and `ps -o command= -p <pid>` shows a current tilt/workerd
  tree. Only kill (`bun run kill-ports`, or `kill -9 <pid>`) when the owning
  Tilt is dead.
- **Prefer isolation over eviction**: `bun run dev:ports on` gives this
  worktree its own hashed port block (20000–29999), dissolving port fights
  without touching the other session. Note: Postgres is still shared —
  branches with divergent migrations will fight over the one schema; check
  `bun run db:status` and expect to `bun run db:reset` after branch switches.
- **Clean up on session end**: run `tilt down` so you don't leave stale
  `workerd`/node processes squatting ports for the next session.
- **Cold-start hygiene**: before a fresh bring-up, always run `tilt down` and,
  if ports remain occupied, `bun run kill-ports`. Prefer the lean profile
  unless you actually need the extra services; the full profile starts 39
  auto-init services and can exhaust a VM.
  If startup reports `Resource temporarily unavailable`, stop the stack and
  clean up before retrying; this indicates local process/resource exhaustion.
  `dev:up` only tears down a Tilt process it spawned itself; a preflight
  collision leaves an existing shared-machine stack untouched.
- **Seeding**: `db:reset` treats models/endpoints as critical (fails the
  run) but clerk-sync/promo-code style steps as best-effort (warns and
  continues) — a warning there does not mean the stack is unusable for E2E.

---

## 1. Unit Tests (no Tilt needed)

Unit tests use **bun** (installed as an npm dep at `node_modules/.bin/bun`,
version pinned in root `package.json`) and **vitest**. No running services are
required.

### Per-package

```bash
cd <package-dir> && bun run test
```

`bun run test` resolves `bun` automatically via the package scripts. If you need
bun on PATH for other commands, run from the repo root:

```bash
export PATH="$PWD/node_modules/.bin:$PATH"
```

### CI scripts for bulk runs

Run all bun + vitest packages in parallel:

```bash
bun scripts/ci/run-unit-tests.ts
```

Run CFW vitest-pool-workers tests only:

```bash
bun scripts/ci/run-cfw-unit-tests.ts
```

---

## 2. E2E / Manual Web / Manual cURL (services must be ready)

### Start the stack

```bash
TILT_PROFILE=lean tilt up
```

> **OOM issues?** If you encounter out-of-memory errors, use `TILT_PROFILE=lean tilt up` to start a reduced stack. Lean mode disables rarely-needed services; they can still be started on demand via `tilt trigger <resource>`.

> **Lean mode + Spanner-asserting tests:** `dataflow` does not auto-start in lean mode, but it is the pipeline that consumes usage-record pub/sub messages and inserts rows into the Spanner emulator's `generations` table. Any E2E test that polls Spanner for generation rows will time out with 0 rows unless you `tilt trigger dataflow` first (allow ~1 min for the Beam pipeline to start). Messages published before the pipeline's subscription exists are dropped, so trigger it before sending test traffic.

For a measured cold bring-up, prefer:

```bash
bun run dev:up
```

This defaults to the lean profile. Set `TILT_PROFILE=full` only when the
additional services are required.

### Wait for auto-init resources only

**Critical:** `tilt wait --for=condition=Ready uiresource --all` does **NOT**
work because manual-trigger resources (`triggerMode=2` in the Tilt API)
never report ready. You must explicitly list the auto-init resources:

`bun run dev:up` splits this derived list into three readiness classes:

- **Required:** whichever of `postgres`, `postgres-migrate`,
  `postgres-seed`, `redis`, and `web` exist in the active resource graph.
  These resources gate success, together with an HTTP probe of the configured
  web port (default `localhost:3000`; worktrees may set `WEB_PORT`).
- **Best effort:** every other non-manual, non-disabled resource. The script
  polls the Tilt API every second and waits up to 120 seconds, then continues
  with a warning listing resources that are still not Ready. The poll returns
  immediately when all of them are Ready, so a slow diagnostic resource cannot
  impose a fixed delay on every run.
- **Diagnostic:** known status-only resources such as `migrations-status`.
  These are reported as informational and do not gate success or consume the
  best-effort timeout.

```bash
# Derive the active profile's auto-init resources from the Tilt API.
AUTO_INIT_RESOURCES="$(
  tilt get uiresource -o json |
    jq -r '.items[] | select(.metadata.name != "(Tiltfile)" and .status.triggerMode != 2 and .status.disableStatus.state != "Disabled") | .metadata.name'
)"
tilt wait --for=condition=Ready \
  $(printf 'uiresource/%s ' $AUTO_INIT_RESOURCES) \
  --timeout=300s
```

Full profile (39 resources):

```text
postgres postgres-migrate postgres-seed clickhouse clickhouse-migrate migrations-status spanner spanner-init pubsub usage-record dataflow dataflow-async-jobs minio-s3 minio-init redis serverless-redis-http dev-fs-logs web clerk-webhook sequence-webhook mission-control cfw-sandbox api api-kv-cron video-api embeddings-api rerank-api workflow-api files-api image-api public-api frontend-api webhooks fake-gcs fake-gcs-init fake-provider gcp-batch-api cfw-batch-api portless
```

Lean profile (18 resources):

```text
postgres postgres-migrate postgres-seed clickhouse clickhouse-migrate migrations-status spanner spanner-init pubsub usage-record redis serverless-redis-http web api api-kv-cron frontend-api webhooks portless
```

#### Why `--all` doesn't work

The Tilt API Server exposes each resource as a `uiresource` custom resource
(see https://docs.tilt.dev/api.html). Each `uiresource` has a
`status.conditions[type=Ready].status` field. Manual-trigger resources have
`triggerMode=2` and their Ready condition remains `False` unless you explicitly
`tilt trigger` them. Using `--all` causes `tilt wait` to block forever waiting
on those resources.

### Endpoints and ports

| Service | URL | Notes |
|---|---|---|
| web | `http://localhost:$WEB_PORT/` (default `3000`) | Main Next.js app |
| mission-control | http://localhost:3001/ | Internal admin UI |
| cfw-api | http://localhost:8787 | Health check: `curl -sf http://localhost:8787/health` |
| cfw-video-api | http://localhost:8788 | |
| cfw-embeddings-api | http://localhost:8789 | |
| cfw-rerank-api | http://localhost:8790 | |
| usage-record | http://localhost:8801 | |
| auth | http://localhost:8802 | Manual trigger |
| ClickHouse Play | http://localhost:8123/play | |
| CH-UI | http://localhost:5521 | Manual trigger |
| MinIO Console | http://127.0.0.1:9001 | Manual trigger |

### View resource logs

Tilt v0.37.5 supports:

```text
--tail  --since  --follow  --source
```

`--source` accepts `all`, `build`, or `runtime`; `--follow` also has the
short form `-f`. The flags `--lines` and `--only` do **not** exist.

```bash
tilt logs --tail=100 --source=runtime web api
```

### Check migration status

`bun run db:status` does not inject the complete Infisical environment and can
report `PG_US_CENTRAL1_POOL_DB_URL is not set`. Use the wrapped command for a
complete status check:

```bash
bun run x scripts/check-migrations.ts
```

---

## 3. Restarting / Recovering (CLI)

### Restart a specific resource

```bash
tilt trigger <resource-name>
tilt wait --for=condition=Ready uiresource/<resource-name> --timeout=120s
```

### Enable / disable resources

```bash
tilt disable <resource>
tilt enable <resource>
tilt enable --all
```

### Nuclear option

Tear everything down and start fresh:

```bash
tilt down
tilt up
```

If the crash was caused by OOM, restart with `TILT_PROFILE=lean tilt up` instead.

Then re-run the wait command from Section 2 to confirm all auto-init resources
are ready.

### Wrangler build fails with `Could not resolve "@openrouter-monorepo/..."`

If a worker resource (api, frontend-api, stt-api, …) fails its esbuild
step with an unresolvable workspace import, the Bun workspace links are
stale (common after switching branches or pulling new packages). Fix:

```bash
bun install   # from the repo root — refreshes workspace links
tilt trigger <resource-name>
```

### Stale Tilt instance recovery

If `tilt up` fails with "another process on port 10350", a previous Tilt
instance may still be running or stuck:

```bash
# Check if port 10350 is bound
ss -tlnp | grep 10350

# Check for running/zombie tilt processes
ps aux | grep tilt | grep -v grep

# Tear down the old instance first
tilt down

# If tilt down hangs or fails, kill the process directly
kill -9 $(pgrep -f "tilt")

# Then start fresh
TILT_PROFILE=lean tilt up
```

Note: `tilt get uiresource` may hang with TLS handshake timeouts if the Tilt
API server is in a bad state. Always `tilt down` and restart in that case.

### Standalone service port conflicts

Before starting the full stack, stop any standalone `next dev` or
`cfw-frontend-api` processes. They can retain ports 3000 or 8795 after their
shell is terminated, preventing Tilt's `web` or `frontend-api` resources from
becoming ready.

### Tilt may be serving a different checkout than yours

On multi-agent hosts, the running Tilt stack may have been started from a
*different git worktree* (e.g. `~/.cursor/worktrees/<repo>/<id>`), so branch
switches in your checkout never reach the running workers, and `tilt trigger`
rebuilds from the *other* worktree's code. Before doing before/after behavior
comparisons, verify which checkout the stack serves:

```bash
ps -o command -p $(lsof -tnP -iTCP:8787 -sTCP:LISTEN | head -1) | rg -o '/[^" ]*node_modules'
```

Worker serve resources also do not hot-reload changes to workspace packages
(e.g. `packages/router`) — `tilt trigger <resource>` is required to pick them
up.

### Service-binding calls hang after restarting one worker

After `tilt trigger api` alone, cross-worker service bindings (e.g.
`SVC_IMAGE_API` for the image tool's inner `/api/v1/images` call) can hang
until timeout with **no request ever logged by the target worker** — the
wrangler dev-registry link is stale. Restart the target worker too, then the
caller (`tilt trigger image-api && tilt trigger api`).

### Alpha tools route caps at 10s

`POST /api/alpha/tools/:toolName` sits behind cfw-api's default 10s timeout
middleware, so slow tools (image generation on a slow provider day) surface
as 408 there even when healthy. Tests against that route should treat 408 as
an infra skip, not a failure.

---

## 4. Manual-trigger resources reference

The following resources have `auto_init=False` and
`TRIGGER_MODE_MANUAL` in the Tiltfile, or are assigned `_LEAN_MANUAL` when
`TILT_PROFILE=lean`. They will **not** start automatically with `tilt up` and
will **not** report ready unless explicitly triggered with
`tilt trigger <name>`.

> **Note:** Resources marked "Disabled in lean mode" are manual-trigger only
> when `TILT_PROFILE=lean`; they auto-start in the full profile.

| Resource | Type | What it does | When to trigger |
|---|---|---|---|
| `postgres-reset` | local_resource | Destructively drops, recreates, migrates, types, and seeds local Postgres. | Resetting all Postgres data after a branch switch or schema change. |
| `ch-ui` | dc_resource | ClickHouse web UI on port 5521. | Browsing ClickHouse tables or running ad-hoc queries visually. |
| `clickhouse-reset` | local_resource | Destructively resets local ClickHouse migrations and data. | Resetting ClickHouse after migration or schema changes. |
| `auth` | local_resource | Auth service (`services/auth`) on port 8802. Depends on postgres-seed, spanner-init, and valkey. | Testing auth flows, token validation, or services that call the auth API. |
| `post-generation-checks` | local_resource | Pub/Sub worker for post-generation checks. | Testing post-generation validation or Pub/Sub queue processing. |
| `notification-checks` | local_resource | Pub/Sub worker for notification checks. | Testing notification-check processing. |
| `alert-evaluator` | local_resource | Alert evaluator worker consuming local alert events. | Testing alert evaluation and rule execution. |
| `alert-delivery` | local_resource | Alert delivery worker for sending evaluated alerts. | Testing alert delivery and downstream notification behavior. |
| `custom-classifier` | local_resource | GCP queue worker for custom classifiers. | Testing custom-classifier jobs or Pub/Sub classification tags. |
| `insert-generations-clickhouse` | local_resource | One-shot worker that inserts generation records into ClickHouse. | Testing or manually replaying generation ingestion. |
| `otel-collector` | dc_resource | OpenTelemetry collector for local traces and metrics. | Debugging distributed tracing or testing observability pipelines. |
| `valkey` | dc_resource | Valkey (Redis-compatible) store on port 6380. | Required by `auth`; trigger it before `auth`. |
| `presidio-analyzer` | dc_resource | Microsoft Presidio PII analyzer. | Testing PII detection in prompts or responses. |
| `presidio-anonymizer` | dc_resource | Microsoft Presidio PII anonymizer. | Testing PII redaction and anonymization pipelines. |
| `presidio` | local_resource | Worker proxy for the local Presidio analyzer and anonymizer. | Testing PII detection/redaction through the worker interface. |
| `stripe-webhook` | local_resource | Forwards Stripe webhooks to the local web app via `stripe listen`. | Testing Stripe payments, subscriptions, or webhook handling. |
| `docs` | local_resource | Local documentation site. Manual unless selected with the Tilt resource filter. | Working on or manually testing the documentation site. |
| `mcp` | local_resource | Local MCP worker and explorer endpoint. | Developing or testing MCP tools and resources. |
| `bleep` | local_resource | WASM PII span-classifier worker. | Developing the bleep worker or testing its detection endpoints. |
| `internal` | local_resource | Admin-key-gated internal API worker. | Testing internal/admin API endpoints. |
| `tts-api` | local_resource | Local text-to-speech API worker on port 8791. | Testing TTS API behavior locally. |
| `stt-api` | local_resource | Local speech-to-text API worker on port 8792. | Testing STT API behavior locally. |
| `kv-cache` | local_resource | Local KV-cache worker on port 8805. | Testing KV-cache behavior or integrations. |
| `fusion` | local_resource | Local Fusion worker on port 8807. | Developing or testing Fusion behavior. |
| `intern-provisioner` | local_resource | Worker that provisions intern repositories, apps, tunnels, and VMs. | Testing the intern provisioning backend with its required secrets. |
| `temporal` | local_resource | Local Temporal development server and UI on port 8233. | Running benchmark workflows or other Temporal-backed jobs. |
| `bench-worker` | local_resource | Benchmark worker backed by Temporal. | Running benchmark jobs locally. |
| `gateway-bench-runner` | local_resource | Gateway benchmark runner service. | Running gateway benchmark scenarios. |
| `gateway-bench-coord` | local_resource | Gateway benchmark coordinator. Depends on Postgres and the benchmark runner. | Coordinating gateway benchmark runs. |
| `gcp-data-deletions` | local_resource | Graphile-worker service for processing data-deletion jobs. | Testing data-deletion workflows and job processing. |
| `local-intern` | local_resource | Runs the production `ori-runtime` container as a local intern daemon on `ORI_LOCAL_INTERN_PORT` (default 7070). Auto-starts with `tilt up -- --interns`; manual-trigger otherwise. Depends on api. | Testing intern behavior locally with no provisioning — see `.agents/skills/local-intern-chat/SKILL.md`. |
| `dataflow` | dc_resource | Local Dataflow emulator/service. **Disabled in lean mode.** | Testing Dataflow-backed usage or processing flows. |
| `dataflow-async-jobs` | dc_resource | Async-jobs Dataflow worker. **Disabled in lean mode.** | Testing asynchronous Dataflow jobs. |
| `minio-s3` | dc_resource | MinIO S3-compatible object storage. **Disabled in lean mode.** | Testing file uploads, S3-backed storage, or object retrieval. |
| `minio-init` | local_resource | Creates default MinIO buckets. **Disabled in lean mode.** Depends on `minio-s3`. | Trigger after enabling `minio-s3`. |
| `dev-fs-logs` | local_resource | Local development filesystem logs service/viewer. **Disabled in lean mode.** | Debugging request and worker logs locally. |
| `clerk-webhook` | local_resource | Local Clerk webhook receiver. **Disabled in lean mode.** | Testing Clerk webhook handling. |
| `sequence-webhook` | local_resource | Local sequence webhook receiver. **Disabled in lean mode.** | Testing sequence webhook handling. |
| `mission-control` | local_resource | Internal Mission Control web application. **Disabled in lean mode.** | Developing or testing Mission Control. |
| `cfw-sandbox` | local_resource | Local Cloudflare sandbox worker. **Disabled in lean mode.** | Testing sandbox execution and worker integrations. |
| `video-api` | local_resource | Local video-generation API worker. **Disabled in lean mode.** | Testing video-generation API behavior. |
| `embeddings-api` | local_resource | Local embeddings API worker. **Disabled in lean mode.** | Testing embeddings API behavior. |
| `rerank-api` | local_resource | Local reranking API worker. **Disabled in lean mode.** | Testing reranking API behavior. |
| `workflow-api` | local_resource | Local workflow API worker. **Disabled in lean mode.** | Testing workflow API behavior. |
| `files-api` | local_resource | Local files API worker. **Disabled in lean mode.** | Testing files API behavior. |
| `image-api` | local_resource | Local image-generation API worker. **Disabled in lean mode.** | Testing image-generation API behavior. |
| `public-api` | local_resource | Public API worker on port 8793. **Disabled in lean mode.** | Testing unauthenticated public API endpoints. |
| `fake-gcs` | dc_resource | Local fake GCS emulator for batch artifacts. **Disabled in lean mode.** | Testing batch flows against fake object storage. |
| `fake-gcs-init` | local_resource | Creates the fake GCS batch-jobs bucket. **Disabled in lean mode.** | Trigger after enabling `fake-gcs`. |
| `fake-provider` | local_resource | Local fake batch/chat provider with controllable lifecycle. **Disabled in lean mode.** | Testing batch submit, poll, finalize, and billing flows without real providers. |
| `gcp-batch-api` | local_resource | Local batch API service using the fake provider and emulators. **Disabled in lean mode.** | Testing batch API ingress and processing. |
| `cfw-batch-api` | local_resource | Local Cloudflare batch API ingress. **Disabled in lean mode.** | Testing the batch API worker boundary. |

Full profile has 31 manual resources:

```text
postgres-reset ch-ui clickhouse-reset auth post-generation-checks notification-checks alert-evaluator alert-delivery custom-classifier insert-generations-clickhouse otel-collector valkey presidio-analyzer presidio-anonymizer presidio stripe-webhook docs mcp bleep internal tts-api stt-api kv-cache fusion intern-provisioner temporal bench-worker gateway-bench-runner gateway-bench-coord gcp-data-deletions local-intern
```

Lean profile:

```text
postgres-reset ch-ui clickhouse-reset auth post-generation-checks notification-checks alert-evaluator alert-delivery custom-classifier insert-generations-clickhouse dataflow dataflow-async-jobs otel-collector minio-s3 minio-init valkey presidio-analyzer presidio-anonymizer presidio dev-fs-logs clerk-webhook sequence-webhook stripe-webhook mission-control docs cfw-sandbox video-api embeddings-api rerank-api workflow-api files-api image-api public-api mcp bleep internal tts-api stt-api kv-cache fusion fake-gcs fake-gcs-init fake-provider gcp-batch-api cfw-batch-api intern-provisioner temporal bench-worker gateway-bench-runner gcp-data-deletions local-intern
```

The 21 resources that are auto-init in full but manual in lean are:

```text
dataflow dataflow-async-jobs minio-s3 minio-init dev-fs-logs clerk-webhook sequence-webhook mission-control cfw-sandbox video-api embeddings-api rerank-api workflow-api files-api image-api public-api fake-gcs fake-gcs-init fake-provider gcp-batch-api cfw-batch-api
```

To trigger a manual resource:

```bash
tilt trigger <resource-name>
tilt wait --for=condition=Ready uiresource/<resource-name> --timeout=120s
```

For resources with dependencies (e.g. `auth` depends on `valkey`), trigger
the dependencies first:

```bash
tilt trigger valkey
tilt wait --for=condition=Ready uiresource/valkey --timeout=120s
tilt trigger auth
tilt wait --for=condition=Ready uiresource/auth --timeout=120s
```

---

## 5. Docker image audit verification

When auditing or changing Docker image versions (tags, pins, bumps), use this
pre-flight checklist before running `tilt up`:

```bash
# 1. Pull each changed image individually to verify tags exist
docker pull <image>:<new-tag>

# 2. Start Tilt (use TILT_PROFILE=lean tilt up if encountering OOM)
tilt up

# 3. Wait for auto-init services that use the changed images
tilt wait --for=condition=Ready uiresource/<service> --timeout=180s

# 4. Verify running containers use the expected image tags
docker ps --format '{{.Image}} {{.Names}}' | grep <service-name>

# 5. For manual-trigger services with changed images
tilt trigger <service>
tilt wait --for=condition=Ready uiresource/<service> --timeout=120s
docker ps --format '{{.Image}} {{.Names}}' | grep <service-name>

# 6. Confirm full stack health (no collateral damage)
# Re-run the full auto-init wait command from Section 2
```

Key image locations in the repo:
- `dev/docker-compose.*.yaml` — dev infrastructure services
- `packages/clickhouse/docker-compose.yaml` — ClickHouse + ch-ui
- `services/usage-record/dataflow/Dockerfile.dev` — dev Dataflow image
- `services/usage-record/dataflow/Dockerfile` — production Dataflow image

---

## 6. Testing Frontend Components with Mock Data

Some frontend features depend on Clerk-authenticated API endpoints (e.g.,
`/api/internal/v1/api-keys`, `/api/internal/v1/organization/members`) that
may not return data locally due to Clerk auth limitations. When this happens,
you can temporarily mock the SWR hooks to test UI behavior with controlled data.

### When to use hook mocking

- The feature depends on org membership data from Clerk (e.g., user filters)
- The feature depends on API keys with `creator_user_id` attribution
- The local Clerk dev instance doesn't have the right org/user setup
- You need deterministic data for adversarial testing (exact counts, specific combinations)

### How to mock

1. **Identify the hooks**: Find the SWR hooks that fetch the data (e.g.,
   `useSlimAPIKeys` in `packages/frontend/hooks/use-api-keys.ts`,
   `useListOrgUsers` in `projects/web/features/orgs/api/list-org-users/use-list-org-users.ts`)

2. **Replace temporarily**: Overwrite the hook file with a version that returns
   hardcoded mock data matching the expected types. Add a `// TEMPORARY MOCK FOR TESTING - REVERT AFTER TESTING` comment.

3. **Test in browser**: The Next.js dev server picks up changes via HMR. Wait
   ~5-10 seconds for the hot reload to take effect.

4. **Revert immediately**: After testing, restore the original files:
   ```bash
   git checkout HEAD -- <path-to-hook-file>
   ```

5. **Verify clean state**: Run `git status` to confirm no mock files remain.

### Important notes

- **Never commit mock data** to the repository.
- Mock data should match the real types exactly (e.g., `SlimPublicAPIKey`,
  `OrgUser`) to catch type-level issues.
- Include edge cases in mock data: null `creator_user_id` for workspace/legacy
  keys, multiple users with different roles, etc.
- This approach is equivalent to "mocking at the SA/API call level" since
  the hooks are the boundary between the component and the API.

---

## 7. Infisical Authentication for Local Services

In `services/cfw-api`, `cfw-video-api`, and `cfw-embeddings-api`,
`bun run dev` invokes `scripts/dev.ts` which calls `writeDevVars()` to
pull secrets from Infisical before starting `wrangler dev`. In
non-interactive environments (remote VMs, CI), Infisical may prompt
for interactive login. To bypass this:

### Machine identity auth

Requires `INFISICAL_CLIENT` and `INFISICAL_SECRET` env vars. The blueprint
installs a silent cached hook at `/home/ubuntu/.devin-infisical-token.sh` and
sources it from the top of `~/.bashrc`, before Ubuntu's noninteractive-shell
early return. It caches the token for approximately 30 minutes, so normal
noninteractive shells do not log in repeatedly.

For a shell without that hook, run the bootstrap from Section 0 before any
local service command:

```bash
if [ -z "${INFISICAL_TOKEN:-}" ]; then INFISICAL_TOKEN="$(infisical login --method=universal-auth --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --plain --silent 2>/dev/null)" && export INFISICAL_TOKEN || { echo "Infisical login failed" >&2; exit 1; }; fi
```

The same applies to `tilt up` itself: resources like `postgres-migrate`
wrap their commands in `infisical run`, and inherit tilt's environment.
Export `INFISICAL_TOKEN` **before** launching `tilt up`, otherwise those
resources fail with an interactive login prompt (`No valid login session
found`) and never become ready.

### Required environment variables

- `INFISICAL_CLIENT` — machine identity client ID
- `INFISICAL_SECRET` — machine identity client secret

If both credentials are absent (for example during a snapshot build), the
cached hook is a no-op and does not fail or print anything.

### Signing in to the local web app

To get an authenticated browser session on the configured web port (default
`localhost:3000`; worktrees may set `WEB_PORT`) for manual web testing against
the Tilt stack, use the
[`clerk-dev-signin-token`](../clerk-dev-signin-token/SKILL.md) skill —
it reuses this same machine-identity auth to mint a headless Clerk
sign-in ticket (no shared password account, no lockouts).

---

## 8. Sandbox R2 Mounts in Local Containers

`cfw-sandbox` uses `s3fs` plus `fuse-overlayfs`. If a mounted `/exec` request
logs `fuse: device not found, try 'modprobe fuse' first`, inspect the spawned
application container:

```bash
docker inspect <container-id> \
  --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.Devices}} {{json .HostConfig.SecurityOpt}}'
```

On macOS, a FUSE-capable Wrangler/Miniflare should supply `SYS_ADMIN`,
`/dev/fuse`, and `apparmor:unconfined`. Cloudflare added that support in
[workers-sdk PR #15134](https://github.com/cloudflare/workers-sdk/pull/15134).
Do not infer support from Wrangler's version banner alone: during the August
2026 release transition, Wrangler 4.125.0 named the matching Miniflare version
but its published bundle did not contain the merged privilege-detection code.
Confirm the generated workerd config or Docker `HostConfig` before debugging
application mounts. Until the catalog includes a release containing that PR,
the merged preview can reproduce the production mount path locally:

```bash
WRANGLER_DOCKER_HOST=unix://<docker-socket> \
  npx --yes https://pkg.pr.new/cloudflare/workers-sdk/wrangler@15134 \
  dev --cwd services/cfw-sandbox --port 8798 --inspector-port 0
```

The changelog and requirements are documented in
[Use FUSE in local Containers development](https://developers.cloudflare.com/changelog/post/2026-08-20-fuse-local-development/).

Two network-policy gotchas confirmed on this local setup (DEV-906, PR #36471):

- Registering ANY interception allowlist (`setAllowedHosts`) promotes the
  container to catch-all interception, whose `allowedHosts` gate runs before
  per-host handler dispatch — so `r2.internal` mount traffic 520s (→
  `S3FSMountError`) unless `r2.internal` is on the list AND the SDK's
  `r2EgressMount` handler is re-registered via `setOutboundByHost` (see
  `services/cfw-sandbox/src/network-policy-manager.ts`).
- Local `enableInternet: false` kills DNS for all external hosts entirely
  (prod docs describe port/DNS restrictions instead); `r2.internal` keeps
  routing either way. Don't treat local DNS failure shape as prod behavior.

---

## 9. Firecracker / Lightweight-VM Known Issues

Devin VMs and other Firecracker-based environments have a stripped-down kernel
(e.g. 5.15.200) that is missing several modules the default Tilt stack assumes
are present. These issues do **not** affect standard Docker Desktop or
bare-metal Linux.

### Flannel VXLAN crash (k3d only)

> **Note:** This section applies to **k3d** clusters (k3s defaults to
> Flannel+VXLAN). `scripts/tilt-dev.ts` creates a **Kind** cluster (`or-dev`),
> which uses kindnet (not Flannel) and is unaffected by this crash.

If you are running a k3d cluster on a Firecracker VM, k3s's Flannel CNI defaults
to the VXLAN backend, which requires the `vxlan`, `br_netfilter`, and `overlay`
kernel modules. On Firecracker kernels these modules are absent:

```text
flannel exited: failed to register flannel network: operation not supported
# modprobe vxlan → "Module vxlan not found in directory /lib/modules/5.15.200"
```

**Fix:** Recreate the k3d cluster with the `host-gw` backend (substitute your
own cluster name if different):

```bash
k3d cluster delete openrouter-dev
k3d cluster create openrouter-dev \
  --k3s-arg '--flannel-backend=host-gw@server:*' --wait
```

### DNS resolution failure inside k3d containers

After fixing Flannel, pods may get stuck in `ContainerCreating` with image-pull
DNS errors (`lookup registry-1.docker.io: Try again`). The k3d container's
`/etc/resolv.conf` points to the Docker bridge gateway which may not resolve
external DNS on lightweight VMs.

**Fix (durable):** Pass a custom `resolv.conf` at cluster-creation time so it
survives container restarts:

```bash
cat > /tmp/k3s-resolv.conf <<EOF
nameserver 1.1.1.1
nameserver 8.8.8.8
EOF
k3d cluster create openrouter-dev \
  --k3s-arg '--flannel-backend=host-gw@server:*' \
  --k3s-arg '--resolv-conf=/tmp/k3s-resolv.conf@server:*' --wait
```

This passes the resolv.conf to k3s at creation time, which propagates it to
CoreDNS. Unlike `docker exec ... > /etc/resolv.conf`, this persists across
container restarts.

**Quick fix (ephemeral, must re-apply after cluster restart):**

```bash
docker exec k3d-openrouter-dev-server-0 sh -c \
  'echo "nameserver 1.1.1.1" > /etc/resolv.conf && echo "nameserver 8.8.8.8" >> /etc/resolv.conf'
```

### Memory constraints (≤16 GB RAM)

Even with `TILT_PROFILE=lean`, the baseline docker-compose services (Postgres,
ClickHouse, Spanner emulator, Redis, PubSub) consume ~10-12 GB. On machines
with ≤16 GB total RAM this leaves very little headroom for Next.js compilation
and the wrangler workers. Symptoms: services report healthy but `curl` to the
configured web port (default 3000) times out; `free -h` shows <500 MB
available.

Lean mode already applies `mem_limit` caps to ClickHouse (1 GB), PubSub
(256 MB), Minio (256 MB), Spanner (256 MB), Redis (128 MB), and
serverless-redis-http (64 MB), and disables minio-s3, public-api, and all
modality workers by default.

If you still hit OOM on a ≤16 GB machine:

1. Ensure no leftover k3d/Kind clusters are running:
   ```bash
   docker ps --filter name=k3d --filter name=kind -q | xargs -r docker stop
   ```
2. Disable non-essential Tilt resources:
   ```bash
   tilt disable spanner spanner-init
   ```
   (This breaks usage-record and api, but frees ~250 MB.)
3. Consider running **standalone cfw-api** (Section 10 below) or unit tests
   only (Section 1) instead of the full Tilt stack.

### Measured lean-mode memory profile

Tested on a 32 GB VM with `TILT_PROFILE=lean tilt up`, navigating 30 pages via
curl to trigger on-demand ISR/SSR compilation. Results on a 15-16 GB machine
would have proportionally less headroom.

#### Progression during 30-page navigation

| Stage | RAM used | Delta |
|---|---|---|
| Clean baseline (no containers) | 1.6 GB | — |
| Lean mode fully up (11 containers + Node) | 7.5 GB | +5.9 GB |
| After first page compile (`/`) | 10.1 GB | +2.6 GB |
| After 10 pages (models, docs) | 11.7 GB | +1.6 GB |
| After 20 pages (+rankings, chat) | 13.0 GB | +1.3 GB |
| After 30 pages (peak) | 13.9 GB | +0.9 GB |
| 60 s after last request (GC settled) | 12.9 GB | −1.0 GB |

#### Per-container memory (lean mode)

| Container | Usage | Limit |
|---|---|---|
| ClickHouse | 439 MB | 1 GB |
| Postgres | ~45 MB | — |
| PubSub | 99 MB | 256 MB |
| serverless-redis-http | 53 MB | 64 MB |
| Spanner emulator | 31 MB | 256 MB |
| Redis | 3 MB | 128 MB |
| **All containers total** | **~700 MB** | |

#### The real bottleneck: Next.js dev server

The `next-server` process alone consumes **6.5 GB** after compiling 30 routes —
more than all 11 Docker containers combined. This is a known upstream issue
([vercel/next.js#78069](https://github.com/vercel/next.js/issues/78069),
confirmed, tracked by the Next.js team). Root cause: Turbopack/webpack loads and
retains compiled modules for every visited route with no eviction policy in dev
mode.

#### Lean-mode savings vs full mode

| Source | Estimated savings |
|---|---|
| 24 disabled services | ~2-4 GB |
| Memory caps (Spanner, Redis) | ~200-500 MB |
| **Total infrastructure savings** | **~2.5-4.5 GB** |

The Tiltfile also sets `NODE_OPTIONS=--max-old-space-size=4096` in lean mode,
which caps the V8 heap at 4 GB and triggers more aggressive GC. This is a
ceiling, not a savings — if Next.js requests more than 4 GB of JS heap, V8 will
OOM-kill the process rather than allocate beyond the cap.

On a 15 GB machine with lean mode, expect ~1-2 GB headroom after compiling
~30 pages. Full mode would OOM.

#### Turbopack vs webpack (benchmarked)

Switching from Turbopack to webpack (`next dev --webpack`) was tested as a
potential memory optimization. **Result: webpack is worse on both axes.**

| Metric | Turbopack | Webpack |
|---|---|---|
| Peak RAM (30 pages) | 13.2 GB | 14.3 GB (+1 GB) |
| Post-GC settle (60s) | 12.4 GB | 13.8 GB (+1.5 GB) |
| Total compile time (30 pages) | 60 s | 174 s (2.9× slower) |

Webpack also throws `pg-native` and `fs` module resolution warnings that
Turbopack handles transparently. **Stay with Turbopack** — the
`--max-old-space-size` heap cap is the more effective lever regardless of
bundler.

### Next.js memory optimization (dev mode)

The Tiltfile already sets `NODE_OPTIONS=--max-old-space-size=4096` for the web
resource in lean mode, which caps the V8 heap and triggers more aggressive GC.
Additional options to reduce Next.js memory in constrained environments:

**1. `experimental.preloadEntriesOnStart: false`** (in `next.config.ts`)

Next.js preloads every page's JS module into memory at startup for faster first
response. Disabling this defers module loading to request time, reducing initial
memory. The eventual footprint is the same once all pages are visited, but it
spreads the cost and avoids a spike at startup.

```ts
// projects/web/next.config.ts
experimental: {
  preloadEntriesOnStart: false,  // defer page module loading
  // ...existing options
}
```

**2. `turbopackFileSystemCacheForDev: true`** (default since Next.js 16.1)

Turbopack's persistent filesystem cache means restarting `next dev` doesn't
recompile from scratch. Already enabled by default on Next.js ≥16.1, but verify
your `.next/cache` directory persists between restarts.

**3. Heap cap via `NODE_OPTIONS`** (already applied in lean mode)

```bash
# For manual use outside Tilt:
NODE_OPTIONS="--max-old-space-size=4096" bun run dev web
```

4 GB is the recommended cap for ≤16 GB machines. Going lower (e.g. 2048) risks
OOM-killing the Node process on pages with heavy SSR. Going higher defeats the
purpose on constrained machines.

**4. Skip web entirely when testing API only**

If you only need `cfw-api`, disable the web resource to reclaim ~6.5 GB:
```bash
tilt disable web
```
Or use standalone cfw-api mode (Section 10 below).

---

## 10. Standalone cfw-api (without Tilt)

If Tilt or k8s is not available, you can run cfw-api standalone
using the Infisical auth method above (Section 7). However,
standalone cfw-api has limitations depending on which secrets
are available in your Infisical path.

### What works

- Health check: `curl http://localhost:8787/health` returns `ok`
- Route validation: API endpoints return proper error codes
  (400, not 404)
- Error handling: missing model returns
  `{"error":{"message":"No models provided","code":400}}`
- Authentication: `sk-or-v1-unlimitedkey` is accepted locally
  (dev-only seeded key — bypasses real auth, not a production
  credential)

### Common pitfall: do not run `wrangler dev` directly

Always use `bun run dev` (which invokes `scripts/dev.ts` →
`writeDevVars()` → `wrangler dev`). Running `wrangler dev`
directly skips the Infisical-sourced `.dev.vars` refresh and
the worker will start with stale or missing secrets, surfacing
as opaque 500s or "missing binding" errors.

### What may not work

If your Infisical path is missing required secrets (e.g.
`PG_US_CENTRAL1_POOL_DB_URL`, `PROVIDER_ENCRYPTION_KEY`), full API
requests will fail with env validation errors. To fix this,
ensure the secrets are present in your Infisical path — or
use Tilt, which provides them automatically.

Other standalone limitations:

- KV models/endpoints are not seeded — `Models not found in KV`
- Auth service is not connected — user lookups fail
- usage-record service binding is not connected

### When to use standalone vs Tilt

- **Standalone**: endpoint existence checks, error handling
  validation, health checks, Postman collection path validation
- **Tilt**: full end-to-end API requests, before/after behavior
  comparison via API responses, dev-fs-logs inspection
- **Unit tests**: best option when testing pure functions
  (adapters, transformers) that don't need a running service.
  Use `cd packages/router && bunx vitest run <test-file>`
