---
name: local-intern-chat
description: >-
  Run a real intern locally with no provisioning: `tilt up -- --interns` boots
  the production ori-runtime container and a dev-only web chat talks to it. Use
  to test intern behaviour without GCP, Slack, OAuth, or the vault.
user-invocable: true
---

# Local intern chat (poof path)

A real ori intern — the same `ori-runtime` container production VMs run — on
your machine, talkable from the OpenRouter web UI, with model calls routed
through local cfw-api. Needs **no** cloudflared, no Slack workspace, no Slack
config token, and no GCP credentials beyond a one-time GAR docker pull auth.
That contrast is the reason to pick this skill over `intern-local-e2e`, which
covers the full provisioning path (wizard → Slack app → OAuth → real GCP VM).

Add what you learn. Where this file and reality disagree, reality wins.

## Setup, in start-up order

1. **Prerequisites**: Docker running (`docker ps`), and one-time GAR pull auth:

   ```bash
   gcloud auth configure-docker us-central1-docker.pkg.dev
   ```

2. **Start the stack**:

   ```bash
   tilt up -- --interns          # auto-starts local-intern with the stack
   tilt trigger local-intern     # or: manual trigger in an already-running stack
   ```

   Positional `tilt up -- <resources>` sets enabled resources exactly and does
   **not** pull in transitive deps, so prefer the full `tilt up -- --interns`.

3. **Health check** (the Tilt resource probes the same endpoint):

   ```bash
   curl -s http://localhost:7070/health   # {"ok":true,"service":"ori-runtime"}
   ```

   Set `ORI_LOCAL_INTERN_PORT` to use a different host port; worktrees get a
   per-branch port from `scripts/worktree-ports.sh` automatically.

4. **Terminal smoke test** (streams NDJSON: `run.started`,
   `assistant.text.delta`, `turn.succeeded` with usage + `generationIds`):

   ```bash
   curl -N -X POST http://localhost:7070/api/invoke \
     -H "Authorization: Bearer ${ORI_DAEMON_TOKEN:-dev-daemon-not-a-credential}" \
     -d '{"type":"agent.invoke","commandId":"t1","prompt":"say hi"}'
   ```

5. **Seed the intern row** so it appears in listings:

   ```bash
   bun run db:reset
   ```

## Enable the two browser gates (required, not troubleshooting)

Without both keys the chat page **silently redirects to `/`** with no error —
this looks like a routing bug and costs the most time. `InternsGate` fails
closed on the `ori-code` Statsig gate, *and* the dev panel's default
`Customer` flag mode forces every gate off and takes precedence over per-gate
overrides. Set both in DevTools on a fresh profile:

```js
localStorage.setItem('devpanel.flagMode', 'internal');
localStorage.setItem('devpanel.statsig-gate-overrides', JSON.stringify({ 'ori-code': true }));
```

Verify which gate is still closed:

```js
window.__STATSIG__.instance().getFeatureGate('ori-code', { disableExposureLog: true })
// reason:'CustomerMode:DevPanel'  → flagMode is still customer
// reason:'LocalOverride:DevPanel' → the override is live
```

Equivalent UI path: dev panel (bottom-left OpenRouter button) → **Feature
Flags** → search `ori-code` → **On** (this also flips the panel to Internal
mode). No server restart needed.

## Chat in the web UI

Open `/workspaces/<workspaceId>/interns/<internId>/chat` (`default` works as
the workspace slug). The page posts to the dev-only proxy
`/api/dev/intern-chat`, which dials the local daemon on
`ORI_LOCAL_INTERN_PORT` directly and **never reads the intern row** — the
intern id in the URL is not load-bearing; every id resolves to the same
daemon. The seeded `seed-local` row exists only so an intern shows up in
listings to click into. Do not re-add routing metadata (e.g.
`cf_tunnel_hostname`) to the seed fixture; it was removed because nothing
reads it.

Known quirk: **Enter does not submit** in the prompt textarea; it inserts a
newline. Click **Send** (it can be below the fold once the transcript grows).

## When it misbehaves

- `tilt logs local-intern` — resource start-up, pull, and init failures.
- `services/dev-fs-logs/.logs/<gen-id>/` — the router/adapter/skin trees of
  each turn. Fresh `gen-…` artifacts per turn prove the reply was a real model
  call through local cfw-api; an unchanged list means nothing reached it.
- `/workspace/.ori/logs/start-*.jsonl` inside the container — the daemon's own
  event log (`docker exec openrouter-local-intern ls /workspace/.ori/logs`).
- The workspace is bind-mounted at `.dev/local-intern/workspace/` (gitignored).
  Files the intern writes appear there on the host — the fastest way to
  confirm a tool actually ran. On Linux the workspace is root-owned by the
  container (root writes land as uid 0) and plain `rm -rf` fails with EPERM;
  clean it with
  `docker run --rm -v "$PWD/.dev:/host" alpine rm -rf /host/local-intern`.
  On macOS (Colima/Docker Desktop) virtiofs maps ownership back to your user,
  so plain `rm -rf .dev/local-intern` works.

## Testing an unreleased ori build (`ORI_RUNTIME_IMAGE`)

`:alpha` is a moving multi-arch (amd64+arm64) tag and Docker never re-pulls a
tag it already has — which is why the default path pins `--pull=always`. That
flag deliberately does **not** apply to an `ORI_RUNTIME_IMAGE` override: a
locally built image has no registry behind it and `--pull=always` would fail
the run.

To build the runtime image from an ori checkout (e.g. an unmerged branch):

```bash
# in the ori repo — compile the CLI for your architecture
bun run compile:cli -- --compile --target=bun-linux-x64-baseline --outfile=/tmp/ori-ctx/ori  # amd64
bun run compile:cli -- --compile --target=bun-linux-arm64 --outfile=/tmp/ori-ctx/ori         # arm64

# the Dockerfile expects a context holding only the compiled `ori` binary:
docker build -f docker/ori-runtime.Dockerfile -t ori-runtime:local /tmp/ori-ctx
# arm64 needs the matching bun asset:
#   --build-arg BUN_ASSET=bun-linux-aarch64 --build-arg BUN_SHA256=<sha for that asset>

# in openrouter-web:
ORI_RUNTIME_IMAGE=ori-runtime:local tilt up -- --interns
```

## Related

- `.agents/skills/intern-local-e2e/SKILL.md` — the full provisioning path
  (wizard, Slack, vault, real GCP VM). Use it when the change under test is
  provisioning, Slack integration, or the VM lifecycle; use this skill when
  you only need a talkable intern.
- `tilt-testing` — resource readiness, manual-trigger reference.
- `clerk-dev-signin-token` — headless sign-in for the web UI.
