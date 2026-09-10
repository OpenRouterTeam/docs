---
name: local-intern-chat
description: >-
  Run a real intern locally with no provisioning: Tilt boots
  the production ori-runtime container, and the chatroom or the intern page's
  Chat tab talks to it. Use to test intern behaviour without GCP, Slack, OAuth,
  or the vault.
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

1. Start the stack using [local-dev-env](../local-dev-env/SKILL.md).
1. Ensure Docker can pull the runtime image from `us-central1-docker.pkg.dev`. If registry authentication fails, check `gcloud auth list` and configure its Docker credential helper with `gcloud auth configure-docker us-central1-docker.pkg.dev`.
1. Start the local runtime:

   ```bash
   tilt enable local-intern
   tilt trigger local-intern
   tilt wait --for=condition=Ready uiresource/local-intern --timeout=300s
   ```

1. **Health check**:

   ```bash
   curl -s http://localhost:7070/health   # {"ok":true,"service":"ori-runtime"}
   ```

   7070 is the default; `ORI_LOCAL_INTERN_PORT` or an opt-in `.env.worktree` can change it. Read the actual port from Tilt.

1. **Smoke test the daemon directly** — no browser session or UI gates. This is
   the fastest proof the intern is alive:

   ```bash
   curl -N -X POST http://localhost:7070/api/invoke \
     -H "Authorization: Bearer ${ORI_DAEMON_TOKEN:-dev-daemon-not-a-credential}" \
     -d '{"type":"agent.invoke","commandId":"t1","prompt":"say hi"}'
   ```

   Streams NDJSON. Each line wraps the real event: `{"type":"runtime.event",
   "event":{"type":"turn.succeeded", ...}}`. A `turn.succeeded` carrying
   `generationIds` is a real model call through local cfw-api — cross-check it
   against a fresh directory under `services/dev-fs-logs/.logs/`.

At this point you have a working intern. Everything below is about talking to
it from the web UI, which needs a logged-in user and therefore more setup.

## Enable the browser gates (required, not troubleshooting)

Two client gates decide what renders, and both fail closed:

- `ori-code` — the interns hub and the intern page. Without it the page
  **silently redirects to `/`** with no error, which looks like a routing bug
  and costs the most time.
- `ori-chat` — interns in the chatroom picker and the Chat tab on the intern
  page. Without it neither surface exists; there is nothing to click.

The dev panel's default `Customer` flag mode forces every gate off and takes
precedence over per-gate overrides, so set the mode and both overrides in
DevTools on a fresh profile:

```js
localStorage.setItem('devpanel.flagMode', 'internal');
localStorage.setItem(
  'devpanel.statsig-gate-overrides',
  JSON.stringify({ 'ori-code': true, 'ori-chat': true }),
);
```

Verify which gate is still closed:

```js
window.__STATSIG__.instance().getFeatureGate('ori-chat', { disableExposureLog: true })
// reason:'CustomerMode:DevPanel'  → flagMode is still customer
// reason:'LocalOverride:DevPanel' → the override is live
```

Equivalent UI path: dev panel (bottom-left OpenRouter button) → **Feature
Flags** → search the gate → **On** (this also flips the panel to Internal
mode). No server restart needed.

## Two chat surfaces, one path

**The web app is not on port 3000 under Tilt.** Each worktree gets its own
port block from `scripts/worktree-ports.sh`; read the real one from
`tilt get uiresources -o json | jq -r '.items[]|select(.metadata.name=="web")|.status.endpointLinks[]?.url'`.

Both surfaces below are the production code path with one substitution at the
last hop. The dev-only page at `/workspaces/<id>/interns/<id>/chat` and its
`/api/dev/intern-chat` proxy are **deleted** (ORI-1460): they never read the
intern row, so they proved the daemon worked and nothing about the routing,
auth or gating production uses; the `curl` against `localhost:7070/api/invoke`
above covers that with no page at all.

### A. The playground chatroom

An intern joins a room as a character whose model slug is `intern/<intern id>`
(`projects/web/features/playground/definitions/intern-character.ts`). That
prefix is what routes the turn to the daemon instead of the Responses API.
The turn goes to cfw-frontend-api:

```
POST /api/frontend/v1/private/interns/<intern id>/chat
```

`resolveDaemonTarget` in
`services/cfw-frontend-api/src/routes/labs/interns/chat/route.ts` then picks
the daemon. In production it decrypts the intern's `daemon_token_encrypted`
and dials its `cf_tunnel_hostname`. **Locally, `INTERN_DAEMON_ORIGIN_OVERRIDE`
and `INTERN_DAEMON_TOKEN_OVERRIDE` short-circuit that** — the Tiltfile sets
both to the `local-intern` daemon, so a turn for *any* intern row reaches the
one container `tilt up -- --interns` runs. Neither var exists in Infisical's
dev path, so they only ever apply locally.

This is the surface worth testing on: it is the same code production runs, with
one substitution at the last hop.

**The worker gates are seeded for you, and that is load-bearing.** The route
needs `ori-code-api` *and* `ori-chat-api` (`isInternChatEnabledForCaller`).
Those are worker gates read from a Statsig ruleset in `KV_LIVE_CONFIG`, which
a cfw-internal cron warmer syncs in production and nothing syncs locally — so
without help both fall through to their registry default of off. The
`worker-gates-seed` Tilt resource writes a minimal open ruleset, and
`frontend-api` depends on it.

Three things about that are worth knowing before you debug it:

- **The ruleset is read once per isolate and cached.** Seeding after
  `frontend-api` is already up leaves the routes 404ing until the worker
  restarts (`tilt trigger frontend-api`). That is why the dependency exists.
- **Both gates are required.** A ruleset opening only `ori-code-api` still
  404s — verified by seeding exactly that and watching the turn fail.
- **`--persist-to` matters.** Each worker's own dev launcher (e.g.
  `services/cfw-frontend-api/scripts/dev.ts`) starts wrangler with
  `--persist-to ../../.wrangler/shared-state`, so a `wrangler kv key put`
  without it writes to the per-service `.wrangler/state` that nothing reads,
  reports success, and changes nothing.

To re-seed by hand: `cd services/cfw-frontend-api && bun scripts/seed-worker-gates.ts`, then
restart `frontend-api`.

**When it 404s anyway, read the message — the two are one word apart:**

| body message | meaning |
| --- | --- |
| `Not found` | `FailureReason.GateClosed` — the gate, not the intern |
| `Intern not found` | the intern row genuinely is not there |

The dev panel's `localStorage` flags do **not** affect this. Those open the
*client* gate that renders the UI; this is the server-side twin evaluated in
the worker against your Clerk id and email.

### B. The intern page's Chat tab

`/workspaces/<workspace>/interns/<intern id>?tab=chat` (gated on `ori-chat`,
like the picker). It is the chatroom's message list, text-only composer, and
history rail over conversations tagged with the intern: the intern is the
room's one character, so a turn takes exactly the chatroom's route above,
and the conversations are persisted, so they land in the tab's own rail,
never in the chatroom's history sidebar. Use it when you want to talk to one
intern from its own page; use the chatroom when the test involves several
characters or composer features the tab lacks — attachments, modes, server
tools, memory.

The seeded `seed-local` and `seed-running` rows are `running`, which is what
the tab requires: a non-running intern gets a note instead of a composer. Do
not re-add routing metadata (e.g. `cf_tunnel_hostname`) to the seed fixture;
`INTERN_DAEMON_ORIGIN_OVERRIDE` is what routes every row to the local daemon.

### Getting a session without a password

Both surfaces need a logged-in user. Mint a throwaway one with the
`clerk-dev-signin-token` skill rather than sharing the dev account. The user
must also own the intern row (the chatroom lists only the workspace's interns,
and the page 404s otherwise) — repoint a seeded one if needed:

```sql
UPDATE interns SET
  entity_id       = '<clerk user id>',
  creator_user_id = '<clerk user id>',
  workspace_id    = (SELECT id FROM workspaces
                     WHERE entity_id = '<clerk user id>'
                       AND slug = 'default'
                       AND deleted_at IS NULL)
WHERE name = 'seed-local';
```

`workspace_id` is the easy one to miss, and leaving it out is what makes a
repointed intern invisible. The intern list query filters on `entity_id` **and**
`workspace_id`, so a row that is yours by `entity_id` while still carrying the
seed user's `workspace_id` is absent from the interns hub, the vault scope
pickers and the chatroom's intern picker; the detail page fetches by entity but
the client compares `intern.workspaceId` against the workspace in the URL, so it
renders the not-found state too.

Resolve the id from `workspaces` as above rather than pasting a uuid. The column
is `not null`, so a user with no workspace row fails loudly — `null value in
column "workspace_id" ... violates not-null constraint` — instead of silently
landing in the wrong one. The `deleted_at IS NULL` filter matters because
workspaces are soft-deleted and the `(entity_id, slug)` unique index is scoped to
live rows, so a stale `default` can otherwise make the subquery return two.

A workspace exists only once the user has a `users` row — an `AFTER INSERT`
trigger on `users` creates the `default` workspace — and locally that row arrives
through the Clerk `user.created` webhook, so the `clerk-webhook` (smee) resource
has to have delivered before any of this resolves. If the update fails, check
what the user actually has:

```sql
SELECT id, slug, deleted_at FROM workspaces WHERE entity_id = '<clerk user id>';
```

A `default` can be deleted while another workspace stays live, so having no
active `default` is a normal state rather than a broken one. When that is what
the query shows, point `workspace_id` at whichever live row you intend to browse
and use that workspace in the URL — the id has to be a workspace with
`deleted_at IS NULL`, because every workspace-scoped read excludes soft-deleted
ones and pointing at a deleted row recreates exactly the invisibility this is
meant to fix.

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
tag it already has, so the Tiltfile preflights the image with its own
`docker pull` step. An `ORI_RUNTIME_IMAGE` override falls back to a
pre-existing local copy when that pull fails, so a locally built image with
no registry behind it still works.

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
ORI_RUNTIME_IMAGE=ori-runtime:local bun run dev:up
tilt trigger local-intern
```

## Running this next to someone else's stack

**Do not start a second `tilt up -- --interns`.** The `local-intern` resource
hardcodes the container name (`docker rm -f openrouter-local-intern`, then
`--name openrouter-local-intern`), so a second stack force-removes the first
one's running intern — even though `ORI_LOCAL_INTERN_PORT` is correctly
per-branch. Check first:

```sh
for pid in $(pgrep -x tilt); do
  printf '%s\t%s\t%s\n' "$pid" \
    "$(lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p')" \
    "$(ps -o command= -p "$pid")"
done
```

Match on the process name (`-x tilt`), not the command line: `pgrep -f "tilt up"`
also matches the shell running the query, because that shell's own argv contains
the pattern. List every match rather than `head -1`, so a second stack cannot
hide behind a stale one, and print each PID's cwd so you can see which checkout
it belongs to.

If Tilt is running from another checkout, stop that Tilt process before starting this checkout. Run `tilt down` there to remove its resources; use `bun run kill-ports` for remaining service listeners.

## Related

- `.agents/skills/intern-local-e2e/SKILL.md` — the full provisioning path
  (wizard, Slack, vault, real GCP VM). Use it when the change under test is
  provisioning, Slack integration, or the VM lifecycle; use this skill when
  you only need a talkable intern.
- `local-dev-env` — resource readiness and service selection.
- `clerk-dev-signin-token` — headless sign-in for the web UI.
