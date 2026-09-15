---
name: local-intern-chat
description: >-
  Run a real intern locally with no provisioning: Tilt boots
  the production ori-runtime container, and the chatroom or the intern page's
  Chat tab talks to it. Also runs the whole intern stack — secret vault, vault
  sidecar, seeded secret, smoke check — under `tilt up -- --interns`. Use to
  test intern behaviour without GCP, Slack, or OAuth.
user-invocable: true
---

# Local intern chat (poof path)

A real ori intern — the same `ori-runtime` container production VMs run — on
your machine, talkable from the OpenRouter web UI, with model calls routed
through local cfw-api. Needs **no** cloudflared, no Slack workspace, no Slack
config token, and no GCP credentials beyond a one-time GAR docker pull auth.
That contrast is the reason to pick this skill over `intern-local-e2e`, which
covers the full provisioning path (wizard → Slack app → OAuth → real GCP VM).

Since ORI-1918 the same flag also stands up the **vault half** of the stack —
the secret vault, a seeded secret, and an `ori vault-tunnel` sidecar the
agent's egress is pointed through. See
[The whole intern stack](#the-whole-intern-stack-tilt-up----interns) below;
everything above it is unchanged and still works on its own.

Add what you learn. Where this file and reality disagree, reality wins.

## Putting an unreleased ori build under test — pick a loop first

Most of what you want from this skill is one of these two, so they are here
rather than at the bottom. They answer different questions and they build for
**different architectures**, which is the one mistake that wastes a morning.

- **Local, fast.** Build the ori branch into an image, run the whole stack
  around it under Tilt. Minutes, no cloud, and every resource on this page.
  **arm64** on Apple Silicon. Reach for it first for anything the sidecar, the
  daemon or the vault wiring can show you.
  → [Build an ori branch into a runtime image](#build-an-ori-branch-into-a-runtime-image)
- **One real VM, slower, higher fidelity.** Put a candidate on exactly ONE
  intern with a scratch tag and a metadata change, watch it reconcile, roll back
  in one command. **amd64**, because intern VMs are x86. Reach for it when the
  answer has to come from real hardware — systemd units, the boot path, netguard
  against real addresses — or when a Tilt run has already been wrong about this
  area.
  → [`services/cfw-intern-provisioner/RUNBOOK.md` → "Testing an unreleased build on one intern"](../../../services/cfw-intern-provisioner/RUNBOOK.md)

Neither replaces the other, and `tilt up -- --interns` is not the last word:
the 2026-09-11 egress outage was a sidecar bug that a Tilt run could not see.
See [Tilt is not the last word](#tilt-is-not-the-last-word--proving-a-change-on-a-real-vm).

### Build an ori branch into a runtime image

Point `ORI_SOURCE` at an **ori** checkout on the branch under test, and run
Tilt from **openrouter-web**:

```bash
ORI_SOURCE=~/c0de/ori tilt up -- --interns
```

That adds two resources and a button:

- **`ori-runtime-build`** runs `bun install --frozen-lockfile` in the checkout, then its own `bun run runtime-image:local` (ori#2667). That script reads the compile target, bun asset and checksum for this machine's architecture from ori's runtime-image workflow, stamps the binary `0.0.0-local+<short sha>` (`.dirty` for a dirty tree), builds the root `Dockerfile`, and checks `ori --version` from the built image. `local-intern` and `vault-sidecar` both wait for it. The install runs first because CI runs it first: a commit that changes the lockfile or a generated artifact would otherwise compile against the previous commit's install and still carry the new sha.
- **Both containers run the pinned tag**, `ori-runtime:source-<first 12 hex of the image id>`, which the build prints last and this resource writes to `.dev/local-intern/ori-source-image`. Never `ori-runtime:source`: that alias names whichever build finished last on this machine, from any checkout, so another checkout's build moves it under you.
- **`ori-source-version`** waits for both containers to run that image, then prints the checkout, its sha, and `ori --version` from inside each. It goes red when a container runs another image or the checkout has moved past the build.
- **Rebuild ori from source**, a button on `local-intern`, runs the build to completion, then restarts `vault-sidecar` and `local-intern` and re-runs `ori-source-version`. Rebuilds are manual on purpose: watching the checkout would restart the agent mid-turn on every save.

Setting both `ORI_SOURCE` and `ORI_RUNTIME_IMAGE` fails at load, and so does a checkout that predates ori#2667.

The same check by hand:

```bash
cat .dev/local-intern/ori-source-image
git -C ~/c0de/ori rev-parse --short HEAD
docker exec -e ORI_TELEMETRY=0 -e ORI_OUTPUT=json openrouter-local-intern ori --version
docker exec -e ORI_TELEMETRY=0 -e ORI_OUTPUT=json openrouter-local-vault-sidecar ori --version
```

Every distinct build keeps its pinned tag until someone removes it. ori's [Local runtime image](https://github.com/OpenRouterIncubator/ori/blob/main/docs/engineering/repository-tooling.md#local-runtime-image) doc has the command that clears them.

The image is **arm64** on Apple Silicon. For the amd64 half, use the RUNBOOK loop linked above.

## Telemetry, and the one place you can see it without a release

`tilt up -- --interns` brings up an **OpenTelemetry collector and Jaeger**
automatically, and points both intern containers at the collector. This is
second only to the build loops above because of what it buys: an intern's
telemetry is otherwise unobservable outside production, and getting it there
needs a release *and* a reprovision of every intern.

**An intern's sidecar has no route to Datadog except OTLP.** Measured
2026-09-12: the agent's own records arrive as `service:ori` — 2.4M in 7d,
carrying `span_id`, `trace_id` and `custom.service.instance.id`, the shape of an
OTLP export. The sidecar's own lines take the other path. COS ships them to the
serial console, they land in GCP Cloud Logging, and they stop there:
`"vault-tunnel proxy listening"` is present in Cloud Logging and returns **zero
results in Datadog**. And `/etc/vault-tunnel-<bot>/env` is written once and then
`chattr +i`, so `OTEL_EXPORTER_OTLP_ENDPOINT` reaches only interns provisioned
after ow#42404 deployed. On a laptop none of that waiting applies.

What comes up, and where things land:

| | where | what is in it |
| --- | --- | --- |
| traces | Jaeger UI, `http://localhost:16686` | agent spans, plus the cfw-\* workers' |
| metrics | `curl -s localhost:8889/metrics` | every `ori_*` series both containers export, plus the cfw-\* workers' statsd |
| logs | `.dev/otel/logs.jsonl` | both containers' OTLP logs and every cfw-\* worker's logger output, one OTLP/JSON request per line |
| Datadog | `env:local` | ori's own logs and metrics only; see below |

Every port the collector publishes follows `bun run dev:ports on`
(`OTEL_OTLP_HTTP_PORT`, `OTEL_PROMETHEUS_PORT`, `OTEL_COLLECTOR_TELEMETRY_PORT`,
`OTEL_HEALTH_CHECK_PORT`, plus `JAEGER_UI_PORT`), so on a worktree read the
numbers off the Tilt UI rather than from here. It publishes nothing else: the
pprof, OTLP-gRPC and zpages ports it used to map are gone, because the configs
enable neither those extensions nor a gRPC receiver, so all three published a
port nothing was listening on.

The containers are pointed at
`OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318`, written into
**both** env files by `vault-secret-seed`. That mirrors `otelEnvLines` in
`services/cfw-intern-provisioner/src/startup-script/otel.ts`, which writes the
same variable into `/etc/<bot>/env` and `/etc/vault-tunnel-<bot>/env` — both,
because the sidecar is a separate process with its own metric registry and
ori's exporter resolves to an empty layer when the endpoint is unset. A VM
spells the host `127.0.0.1`, because its collector binds loopback and every
unit runs `--network host`; here the containers are bridged and a loopback-only
listener would be unreachable to them, which is the same asymmetry
`CFW_SECRET_VAULT_IP` is scoped to `--interns` for.

The collector is deliberately **not** in any resource's `resource_deps`, the
same call the provisioner makes: telemetry is a diagnostic aid, never a boot
dependency, so a collector that will not start degrades this stack to "no
telemetry" rather than holding the intern down.

### The vault egress series, and why your stack probably cannot see them

The three series a production monitor would alert on —
`ori_vault_egress_exchanges_attempted`, `ori_vault_egress_exchanges` (named
`…_completed` before ori#2692, which tags it `outcome` and `code`),
`ori_vault_egress_exchange_duration_ms` — landed in ori#2650, **after the last
published runtime artifact**. `tilt up -- --interns` pulls `ori-runtime:alpha`
by default, and that image does not contain them. Verified 2026-09-12 against
`:alpha` and `:stable` alike: zero occurrences of all three names, against one
occurrence of the control string `vault_egress_forward_failed`.

**The gate drives two exchanges and requires the counter to rise between
them**, which is why `stack-fidelity` takes half a minute on an image that can
emit. Presence is not an assertion on this surface: the collector keeps
re-serving a series for five minutes after its source goes quiet, and nothing
in the export says which process wrote it — `service.instance.id` comes from
the env file and is the same for a sidecar and its replacement. A sidecar that
forwards traffic with its exporter switched off passed the first version of
this gate for exactly that reason. Reading one destination host rather than a
total matters too: a total over all hosts falls while other hosts' retained
series age out, which is how a healthy stack reported a counter going 5 then 3.

So the `intern-telemetry` gate does not pretend. On an image that cannot emit
them it reports a **blind spot** — `fidelity_gate_BLIND` at warning level, and
`blind_gates: 1` on the summary line — which is neither a red nobody can act on
nor a green that says the telemetry was checked. To see the series, build an
image that has them
([above](#build-an-ori-branch-into-a-runtime-image)) and run with it:

```bash
ORI_SOURCE=<ori checkout> tilt up -- --interns
curl -s localhost:8889/metrics | grep ori_vault_egress
```

### Reading the local log file

The collector's `file/logs` exporter writes every log record it receives to `.dev/otel/logs.jsonl`, one OTLP/JSON `ExportLogsServiceRequest` per line, rotated at 100 MB with three backups beside it, so it never holds more than 400 MB. The cfw-\* workers reach it through `packages/cloudflare/instrumentation/dev-log-exporter.ts`, which forwards the logger's development output as OTLP logs under the worker's Datadog service (`cfw-intern-provisioner`, `cfw-secret-vault`, `api`) and its statsd metrics to Prometheus on `:8889`. Fidelity gates read failure names from this file.

```bash
jq -c '.resourceLogs[] | {service: (.resource.attributes[] | select(.key == "service.name") | .value.stringValue), body: [.scopeLogs[].logRecords[].body.stringValue]}' .dev/otel/logs.jsonl | tail
```

### Datadog export (on by default under `--interns`)

`tilt up -- --interns` exports ori's own logs and metrics to the real Datadog org. Nothing else leaves the laptop:

- **Traces stay in Jaeger.** The local pipeline samples nothing, so APM cost would scale with every laptop.
- **Only `service:ori` is exported.** `filter/ori_only` in `dev/otel-collector-config.datadog.yaml` drops every record whose `service.name` is not `ori`. The workers emit statsd under production metric names, and many production monitors carry no `env:` filter, so a worker's records stay in the local file and Prometheus.
- **Every record is `env:local`** (the collector upserts `deployment.environment`, and both containers stamp it through `OTEL_RESOURCE_ATTRIBUTES`) **and names you**: logs carry `@developer.id:<git config user.email>`, metrics the tag `developer.id` with `@` normalized to `_`.

```text
env:local service:ori @developer.id:you@openrouter.ai     # logs
sum:ori_daemon_heartbeats{env:local,developer.id:you_openrouter.ai}.as_count()   # metrics
```

The Tiltfile fetches `DD_API_KEY` from Infisical and writes it, with your git email, to the gitignored `.datadog-export.env` in `dev/` that `dev/docker-compose.otel.datadog.yaml` names as its `env_file`. An `env_file` rather than Tilt's process environment, because `writeDevVars()` copies that whole environment into every worker's `.dev.vars`, and putenv-ing a live Datadog key would spread it across the repo. Without Infisical access or a git email, Tilt prints one line saying why and the stack comes up local-only.

```bash
OTEL_DATADOG_EXPORT=0 tilt up -- --interns   # local sinks only
OTEL_DATADOG_EXPORT=1 tilt up                 # export without --interns
```

### ori product telemetry

Both containers set `ORI_TELEMETRY_ENDPOINT` to the local public-api (`http://host.docker.internal:<CFW_PUBLIC_API_PORT>/api/v1/ori/telemetry`, or `127.0.0.1` on Linux). ori defaults that endpoint to `https://openrouter.ai`, so a container started without it posts laptop `cli_error` and `agent_run` events into production ingest. Locally they pass through public-api's own route, and its logs land in `.dev/otel/logs.jsonl`.

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

A workspace-ID URL canonicalizes to the slug and may drop `?tab=chat`, so
click the **Chat** tab after navigation and wait for the **Ask anything…**
composer before typing. There is one detail surface, the intern page; the
`ori-vault-redesign` gate no longer selects a sheet.

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

## The whole intern stack (`tilt up -- --interns`)

Everything above gives you a talkable intern. This gives you the shape a
**provisioned** intern actually runs in: its egress leaves through an
`ori vault-tunnel` sidecar, and the sidecar is the only process holding vault
credentials. It is what makes the ORI-1912 work (stateless vault egress)
provable on a laptop instead of in production.

```bash
tilt up -- --interns
```

Twelve resources, in dependency order:

| resource | what it is | expected state |
| --- | --- | --- |
| `secret-vault` | `wrangler dev` on 8796, bound `0.0.0.0` for this run only | Ready |
| `vault-edge` | Cloudflare's edge, locally: refuses a wrong `Host` with 403 before the vault runs | Ready — and reaching Ready IS the proof the guard is armed |
| `vault-secret-seed` | writes one secret through the vault admin route; writes both container env files | Ready (exits 0) |
| `api-tunnel` | `cloudflared` fronting local cfw-api on a publicly-trusted HTTPS hostname | Ready once a hostname is published |
| `local-intern` | the agent, now with `HTTPS_PROXY` at the sidecar | Ready |
| `vault-sidecar` | `ori vault-tunnel` from the same runtime image | Ready — and it carries real traffic |
| `local-intern-ca-mount` | asserts, from inside the agent container, that it holds `root.crt` and NOT `root.key` | Ready (exits 0) |
| `stack-fidelity` | the gates that assert this stack still reproduces production's shape | Ready (exits 0) — red means the stack is not testing what you think |
| `vault-smoke` | one streamed completion driven through the sidecar | manual |
| `stack-fidelity-control` | every gate against the input that must make it FAIL | manual |
| `otel-collector` | the OTLP receiver both intern containers export to | Ready — but nothing depends on it, on purpose |
| `jaeger` | where the collector's traces land, at `localhost:16686` | Ready |

`api-tunnel` is the resource that makes the harness test anything. Without it
the agent's model calls go straight to local cfw-api and never touch the
vault — see "Which traffic reaches the vault, and which does not" below, and
read it before drawing any conclusion from a chat session.

`secret-vault` and `local-intern` reaching Ready is the gate. Check both:

```bash
curl -s localhost:8796/health   # -> ok  (NOT misconfigured_environment)
curl -s localhost:7070/health   # -> {"ok":true,"service":"ori-runtime"}
```

### `vault-edge`, and the bug class it exists to catch

The sidecar does not dial `wrangler dev`. It dials `vault-edge`, a reverse
proxy that answers 403 to any request whose `Host` is not the vault's own —
because Cloudflare does exactly that in production, and until this resource
existed nothing local did.

A sidecar that forwarded the AGENT's `Host` onto its vault request took every
intern on the new architecture fully offline — no Slack, no model calls, and
silently — and **passed the whole `tilt up -- --interns` acceptance run with
the bug present.** `wrangler dev` serves whatever arrives on its port, so the
harness could not fail:

| `Host` presented | production | local, before | local, with `vault-edge` |
| --- | --- | --- | --- |
| the vault's own | `401` — Worker ran, auth refused | `401` | `401` |
| `slack.com` | `403` — edge refused, Worker never ran | `401` | `403` |

The resource's readiness probe is the load-bearing half, not the listener. It
drives both of those rows through the running guard every few seconds, and
`vault-sidecar` gates on it — so a stack that has stopped enforcing `Host`
sits red instead of going green. Run it by hand the same way Tilt does:

```bash
env ORI_LOCAL_VAULT_EDGE_EXPECTED_HOST=host.docker.internal:8822 \
    ORI_LOCAL_VAULT_EDGE_PORT=8822 \
  bun run services/cfw-secret-vault/scripts/local-vault-edge.ts probe
```

When it refuses something, `tilt logs vault-edge` has the whole answer in one
line — `vault_edge_host_refused` carries `presented_host` and `expected_host`,
and so does the 403 body. The original outage cost hours precisely because
nothing logged either of them anywhere.

It guards the sidecar's hop only. The host-side scripts and frontend-api each
reach the vault under a different spelling of loopback, so guarding them would
mean accepting a set of hostnames — a guard that fails open. That divergence
from production is left open on purpose.

### The fidelity gates, and where the next one goes

`vault-edge` was the first of these. The rest live together in
`services/cfw-secret-vault/scripts/local-fidelity/`, and `stack-fidelity` runs
the cheap ones on every `--interns` stack.

**The rule they serve is standing, not a fact about these eight.** When a bug
reaches production that the local stack could not have caught, the local stack
has a defect too, and closing it is part of the fix rather than a follow-up.
Three production defects passed a green `tilt up -- --interns` on 2026-09-11,
two of them invisible for structural reasons: nothing local routed by `Host`,
and no local destination answered a `3xx`, so neither code path was reachable
from a laptop at all.

What is gated today:

| gate | the production defect a green stack would otherwise hide |
| --- | --- |
| `intern-telemetry` | an intern whose telemetry never leaves the box — the sidecar reaches Datadog through OTLP or not at all, so a missing endpoint stays invisible until a monitor built on those series never fires |
| `container-health` | a container failing its Docker healthcheck behind a green Tilt resource — two independent truths, and on a real VM the same mismatch reports the sidecar healthy whenever the AGENT's daemon is up |
| `relayed-redirect` | a sidecar that refuses a relayed `3xx`, which broke MCP connects and every redirecting destination in production |
| `streamed-egress` | a hop that assembles the whole upstream response before relaying it, which an assembled-body assertion cannot see |
| `intern-turn` | an intern that cannot complete a turn, or whose model call goes somewhere other than its configured base URL — it drives one real turn at `/api/invoke` on `openai/gpt-4o-mini` in a fresh session of its own (a turn in the daemon's default session collides with anyone already chatting), requires `turn.succeeded`, and requires local cfw-api to have logged that session in `services/dev-fs-logs/.logs/gen-*/router/transaction-attempt.log`, with the same generation's `original-request.log` at the host `ORI_OPENROUTER_BASE_URL` names. `turn.succeeded` carries no generation id, and a probe id in the prompt got passed to a tool, so the session ori sends as `X-Session-Id` is the correlation. A turn that streams output and never reaches a terminal event within 120s is named as never settling. A retryable provider-stage failure on a call that did reach local cfw-api is named as a provider outage, not a stack defect, and a run that costs more than `STARTUP_GATE_COST_CEILING_USD` ($0.005) goes red. Its control uses an unknown model slug and must end `turn.failed` naming it. On 2026-09-14 ori ignored `ORI_OPENROUTER_BASE_URL`, so every local turn went to `openrouter.ai` and failed `ORI_ADAPTER_UNAUTHORIZED` while the other gates stayed green |
| `vault-edge-in-path` | local egress reaching something other than the vault edge on 8822 — from inside the sidecar, the edge must refuse `Host: slack.com` with 403 and answer unauthenticated `/v1/egress` with 401, and its control aimed at cfw-api must see cfw-api's 404. On 2026-09-14 intern-api shared the edge's port and every sidecar egress call reached intern-api's 404 (ORI-1980) |
| `vault-restart` | a vault deploy stranding the agent's own direct egress — the traffic class ori's retry layer does not cover |
| `local-telemetry-error` | an ori failure logged at info like every other telemetry event, or at a status its `failure_kind` does not name, so `status:error` and Datadog Error Tracking miss faults or page on user mistakes |

**Adding one is a module beside them and a line in `gate-registry.ts`.** Not a
new Tilt resource, not a new script to discover, and not an edit to the resource
graph three branches are editing at once.

**A gate ships with the input that makes it fail.** `FidelityGate` requires a
`control` as well as a `check`, and:

```bash
tilt trigger stack-fidelity-control
# or: bun run services/cfw-secret-vault/scripts/local-fidelity/index.ts control
```

drives every control and fails on any gate that came back green — because a gate
nobody has watched fail asserts nothing, which is how three defects shipped past
this stack in the first place. Run it after touching a gate, and when a green
stack feels too easy.

**A control that never reached its assertion is now a failure too**, reported as
`fidelity_control_DID_NOT_RUN`. Until 2026-09-12 the runner read every `Err`
from a control as "failed as required", so a sidecar that did not answer or a
collector that was down produced the same green line as a control that actually
rejected its input. Four of the five controls could hit that, and `vault-restart`
was returning the words "this drill measured nothing" into it. So a passing
`stack-fidelity-control` from before that date meant less than it looked like.
Each control now classifies its own failures (`ControlOutcome` in
`fidelity-gate.ts`), which is enforced by the type rather than by remembering.

**And a control passes only on the rejection it was built to provoke**, not on
any rejection. Decisions return a `GateRejection` naming which arm refused, and
a control declares the arm it expects; anything else is `DidNotRun`.
`decideStreamedDelivery` refuses a non-2xx before it looks at framing at all, so
a 503 from the vault was satisfying a control that is evidence about the frame
count — observed on this stack. Naming the arm is necessary and not sufficient:
`not-a-redirect` is tripped by a healthy 200 and a 502 alike, so each control
also checks that its engineered input actually arrived before it judges the
answer.

A check has a third answer besides pass and fail: **blind**. Not every gate can
observe its subject on every stack — `intern-telemetry` asserts series the
default runtime image does not contain — and both ordinary answers are wrong
there, one a false red on every run and the other a green that checked nothing.
Those come back as `fidelity_gate_BLIND` at warning level and are counted in
`blind_gates` on the summary line. A control must still come back `Err`: blind is
something a check reports about the world, and a control that cannot fail is a
broken gate either way.

`vault-restart` restarts `secret-vault` under a request already in flight, so it
is never in the startup path — and it has no Tilt resource at all, because
**a `tilt trigger` issued from inside a Tilt build does not land while that
build is running**. Measured twice on 2026-09-12: driven as a resource the vault
never went down and the drill reported that it had measured nothing; the same
command from a shell disturbed the request and returned a verdict. Run it
yourself, from the repo root:

```bash
bun run services/cfw-secret-vault/scripts/local-fidelity/index.ts gate vault-restart
```

On a stack using worktree ports, pass the ones the Tiltfile computed
(`ORI_LOCAL_VAULT_PROXY_PORT`, `VAULT_URL`); the defaults are the default-port
stack's.

The drill will not report a verdict it did not earn: if the response settles
before the vault stops answering, it says so and asks you to re-run rather than
reading "the request completed" as a result.

It **pins a known-bad outcome** rather than asserting a good one. Measured
2026-09-12 against `:stable`: a model turn survives a mid-flight vault restart
(ori retries it three times and the turn succeeds), but the agent's own direct
egress — a `curl` or a `git` the intern shells out to — neither completes nor
fails. The last byte landed 63ms after the restart and the connection then sat
open and silent for the whole 25s the probe waited, with nothing logged
anywhere. A green drill means that defect is exactly where it was; a red one
means the behaviour moved and somebody has to look.

`stack-fidelity` also prints what this stack cannot tell you: the checkout it is
serving, and the **known local-only divergences** — failures the stack
manufactures that production does not have. Examples include the
`Expect: 100-continue` 500 thrown by miniflare's dev-only request wrapper, and
adding another is three fields in `divergences.ts`. The list is meant to stay
cheap to append to rather than complete: one honest entry beats an empty
framework, and a local failure nobody can reproduce in production teaches people
to ignore the stack just as effectively as a missing gate does.

### Tilt is not the last word — proving a change on a real VM

`tilt up -- --interns` is the fast loop, not the complete one. It is a real
sidecar carrying real traffic, but it is not a provisioned VM, and today's
`Host` outage is the standing proof that a blind spot here is expensive.

When a change needs proving on real hardware — anything in the sidecar
especially — use **"Testing an unreleased build on one intern"** in
[`services/cfw-intern-provisioner/RUNBOOK.md`](../../../services/cfw-intern-provisioner/RUNBOOK.md).
It is a gcloud-only loop that points ONE intern at a scratch image tag and
rolls back in a single command, with no release and no `:stable` involved.

### Why a tunnel, and not a local HTTPS endpoint

The obvious cheaper answer is to give local cfw-api HTTPS with a self-signed
certificate and skip Cloudflare. It does not work, and the two reasons are
worth recording so nobody spends an afternoon rediscovering them:

- **The sidecar is CONNECT-only.** The agent has to be aimed at an `https://`
  URL or the sidecar is not exercised at all. A plain-HTTP upstream cannot
  reach it, which is why the original `http://host.docker.internal:8787`
  bypassed everything.
- **workerd refuses a self-signed peer.** Probed directly: it fails the
  request with `internal error` while accepting plain HTTP to loopback, and
  wrangler exposes no way to add a trusted CA to it.

So the upstream has to present a certificate the runtime already trusts, and
a Cloudflare tunnel is the cheapest way to get one on a laptop.

It also keeps the security model intact, which is the part that matters more
than convenience: `*.trycloudflare.com` resolves to public Cloudflare
addresses, so **netguard stays fully armed** and nothing has to set
`AGENT_VAULT_ALLOW_PRIVATE_RANGES`. If you find yourself reaching for that
variable to make local testing work, the approach has gone wrong.

Prefer a named tunnel when you have a Cloudflare account, for a stable
hostname:

```bash
export ORI_LOCAL_API_TUNNEL_NAME=my-dev-tunnel
export ORI_LOCAL_API_TUNNEL_HOSTNAME=api.dev.example.com
```

A quick tunnel is the default and needs no account, but its hostname rotates
every run, which is why it is read out of cloudflared's output at startup
rather than written down anywhere.

### The sidecar needs an egress-mode runtime image

The image is the only thing that matters here. A pre-ORI-1915
`ori-runtime` dials a WebSocket at `/v1/tunnel`, which the vault no longer
serves, so it binds its CONNECT listener, reads as **ready**, and fails every
proxied request. Point Tilt at an egress build, or at an ori checkout that has one:

```bash
ORI_RUNTIME_IMAGE=ori-runtime:egress-local tilt up -- --interns
ORI_SOURCE=<ori checkout> tilt up -- --interns
```

Prove the path end to end with the agent's own proxy credential. A 200 here
means the request reached the upstream through the sidecar and the vault; the
same request with the CA withheld must fail `ssl_verify=20`
(`unable to get local issuer certificate`), which is what proves the SIDECAR
terminated the TLS rather than the request leaking straight out:

```bash
PROXY=$(grep '^HTTPS_PROXY=' .dev/local-intern/vault-agent.env | cut -d= -f2- \
  | sed 's/host\.docker\.internal/127.0.0.1/')
curl -s -o /dev/null --proxy "$PROXY" \
  --cacert .dev/local-intern/vault-ca/root.crt \
  -w "status=%{http_code} ssl_verify=%{ssl_verify_result}\n" \
  https://openrouter.ai/api/v1/models
```

`tilt trigger vault-smoke` does the same thing and reports it in one line.

`host.docker.internal` only resolves **inside** a container, so from the host
you must substitute `127.0.0.1` as above. Forgetting that produces
`Could not resolve proxy` and `status=000`, which looks exactly like a TLS
failure and is not one.

This is better than the issue assumed: the old path is a working baseline to
diff the new one against, not a hole. What is still absent is the stateless
`/v1/egress` route, and that is what `vault-smoke` checks.

Still do not invest in the WebSocket path — it is deleted in ORI-1921. Just
know it runs, so a sidecar that is red is a real failure worth reading rather
than the expected state.

### The smoke check, and why it is built to fail

```bash
tilt trigger vault-smoke
# or: bun run services/cfw-secret-vault/scripts/local-egress-smoke.ts
```

It drives one request from the agent's position — CONNECT through the sidecar,
TLS terminated against the sidecar's own CA, then a **streamed completion** to
local cfw-api on its tunnel hostname — and prints one line. A GET used to be
enough for it; it is not, because body-up-tokens-down is the shape the agent's
own traffic has and the shape a buffering regression hides in. The last gate
counts the chunks the response body arrived in and needs more than one, so a hop
that assembles the whole body before writing it goes red here even though every
byte and every status is still correct.

A smoke check that went green before the feature did would hand every later PR a
signal that means nothing, so the gates run in dependency order and the reason
always names the nearest missing piece:

| one-line reason | what is missing |
| --- | --- |
| `secret-vault is not answering` | the vault resource is not up |
| `secret-vault /health returned 500 misconfigured_environment` | the worker cannot read its own secrets — Infisical session, then `tilt trigger secret-vault` |
| `egress route not present (POST /v1/egress -> 404)` | ORI-1914 |
| `sidecar not in egress mode (no CA at …)` | ORI-1915, plus an `ORI_RUNTIME_IMAGE` pointing at it |
| `sidecar not in egress mode (trust anchor … is still the vault's shared root CA)` | ORI-1915 — the sidecar runs, but on the old tunnel |
| `sidecar not listening for CONNECT on 127.0.0.1:8080` | the sidecar is up but has not bound; `tilt logs vault-sidecar` |
| `came back <status>, so it never reached the upstream` | the request crossed the sidecar and the vault refused it — read both logs |

#### Two gates that exist because the check false-passed without them

Both were added after a run showed the check going green while the feature
was absent. Neither is theoretical.

**The trust-anchor gate.** The sidecar comes up and carries traffic on the old
WebSocket path too, so "a CA file exists", "the CONNECT port is bound" and "a
proxied request returned 200" are all true before egress exists. With only
those, pointing `VAULT_URL` at a stub answering `/v1/egress` made the whole
check pass. What only an egress-mode sidecar can produce is a trust anchor
that is **not** the vault's shared root — ORI-1915 mints its own CA on the VM,
which is the thing ORI-1912 exists to achieve.

**The 2xx gate.** Every way the vault declines is *also* a parseable status
relayed back through the sidecar: 404 for a route that is not registered, 403
`destination_blocked`, 502 `dns_resolution_failed`, 401 `auth_failed`.
Measured 2026-09-11 with an egress sidecar running and the route still absent,
the check reported `PASS upstream_status: 404` — it had faithfully driven a
request through the sidecar and relayed the vault's own "no such route". Only
2xx means the upstream was actually reached.

Verify both rather than trusting them. Stand up a stub answering `/health` and
`/v1/egress`, point `VAULT_URL` at it, and confirm the reason moves on to the
next gate instead of passing:

- non-egress sidecar → `trust anchor … is still the vault's shared root CA`
- egress sidecar, no route → `came back 404, so it never reached the upstream`

The upstream is no longer configurable. It is local cfw-api reached on the
`api-tunnel` hostname, which is where the agent's own model calls go, and the
tunnel exists precisely because the vault's netguard blocks private ranges — a
loopback upstream would be refused by the protection this is meant to exercise.
With no tunnel serving, the check says so and stops, because nothing it could
measure would mean anything.

### What gets seeded, and by whom

The workspace and the intern row are **not** new. `postgres-seed` already
creates `seed-local` (`scripts/seed/seed-interns.ts`), and that stays the one
writer of those rows — a second one is how local fixtures drift.

`vault-secret-seed` adds the part a database seed structurally cannot: a
secret, which is envelope-encrypted under `VAULT_MASTER_KEY` and so can only
be written through the vault's own `POST /v1/secrets`. It then writes two env
files under `.dev/local-intern/` (both gitignored):

- `vault-sidecar.env` — the vault agent token, the workspace and agent ids,
  and both CA paths (`ORI_VAULT_CA_FILE` and `ORI_VAULT_CA_KEY_FILE`).
  Mirrors `/etc/vault-tunnel-<bot>/env` on a real VM.

  `ORI_VAULT_EGRESS_URL` is an **origin**, not a URL with a path, because the
  wire contract is `{ORI_VAULT_EGRESS_URL}/v1/egress` and the sidecar appends
  the path. Getting it wrong logs `GET /v1/egress/v1/egress 404` at the vault,
  which reads as a missing route and sends you hunting in the wrong
  repository.
- `vault-agent.env` — the proxy URL, `NO_PROXY`, and the trust bundle path,
  and **no vault credential and no CA key at all**. Mirrors the vault half of
  `/etc/<bot>/env`.

That split is a security boundary on the VM and it stays one here: the agent
container never sees a credential the vault would accept, and never sees the
CA private key.

#### The sidecar owns the CA directory — the harness must leave it empty

`.dev/local-intern/vault-ca/` is created by the seed and written by **nobody
else but the sidecar**, which mints `root.crt` and `root.key` there on first
boot. That locally-minted root is the point of ORI-1912: the vault holds no
root CA at all any more.

An earlier version of this harness pre-seeded the vault's then-shared root as
the agent's trust anchor. That was wrong twice: the egress sidecar refuses to
start against a half-written CA, and installing a shared root reproduces the
architecture the project deleted.

```text
EgressCaStateError: the egress CA is half-written: /etc/intern-vault/root.crt
exists but its pair does not; remove both /etc/intern-vault/root.crt and
/etc/intern-vault/root.key to mint a fresh CA
```

That guard is correct. The seed clears a lone certificate it wrote itself
(cert present, key absent) so an existing checkout does not trip over it after
upgrading, and touches nothing else — never a complete pair, never a lone key.

If you need to force a fresh CA, remove **both** files and restart the
sidecar. Do not remove just one.

#### Checking the CA on Colima: look inside the container

Colima uses virtiofs and a container's writes take a moment to appear on the
host mount, so an `ls` of `.dev/local-intern/vault-ca/` can show an empty
directory that is not empty. Ask the container:

```bash
docker exec openrouter-local-vault-sidecar ls -la /etc/intern-vault/
# root.crt 0644, root.key 0600
```

The AGENT container must show a different listing — `root.crt` and nothing
else. It runs as uid 0, so 0600 protects `root.key` from it not at all; only
mounting the certificate on its own does, which is why the two containers bind
different things (ORI-1943):

```bash
docker exec openrouter-local-intern ls -la /etc/intern-vault/
# root.crt ONLY. root.key here means the agent holds the CA private key.
```

`local-intern-ca-mount` asserts exactly that on every `--interns` run, so this
is a thing to read when it goes red rather than a check to remember to run.
Note the host directory always holds both halves whatever either container
mounted, so `ls .dev/local-intern/vault-ca/` cannot answer this question.

To re-seed after a `db:reset`, or if you repointed `seed-local` at your own
Clerk user: `tilt trigger vault-secret-seed`, then `tilt trigger local-intern`.

`local-intern` depends on `vault-sidecar`, and that is load-bearing rather
than cosmetic: the agent reads `NODE_EXTRA_CA_CERTS` once at process start, so
an agent started before the sidecar mints comes up with an empty trust store
and distrusts the sidecar for its whole lifetime.

### Which traffic reaches the vault, and which does not

**Read this before concluding anything from a working chat session.** A
conversation with the intern can complete perfectly while the vault serves
zero requests, and that looks identical to success.

`NO_PROXY` is loopback only — but "loopback" has two spellings here, because
the runtime uses host networking on Linux (`127.0.0.1`) and bridge networking
on macOS (`host.docker.internal`). Both name the same machine, the one the
developer is sitting at, and it is where local cfw-api lives.

So it depends entirely on where the agent's model calls are pointed:

| `api-tunnel` | `ORI_OPENROUTER_BASE_URL` | `OPENROUTER_API_KEY` | model calls | is egress under test? |
| --- | --- | --- | --- | --- |
| running | `https://<host>.trycloudflare.com/api/v1` | `__openrouter_api_key__` | through the sidecar and the vault | **yes** |
| not running | `http://host.docker.internal:8787/api/v1` | the real dev key | straight to local cfw-api | **no** |

The second row is the harness's original behaviour and the reason
`api-tunnel` exists. The tunnel host is a Cloudflare domain, so it is outside
the loopback exclusions and gets proxied with no change to `NO_PROXY` at all.
`local-intern` resolves the URL at container start from the hostname the
tunnel published; when there is no tunnel it falls back to the direct URL and
says so in one line, which is the line to look for before trusting a result.

The assertion that settles it is the vault's own request count, not whether
the chat replied. `tilt logs secret-vault | grep -c "POST /v1/egress"` before
and after a message: if it does not move, the tunnel is not carrying the
traffic no matter how well the conversation went.

Every genuinely remote host has no route but the sidecar either way. If the
sidecar is down those calls fail rather than going out unproxied, which is
fail-closed behaviour and not a bug — a request that silently went around the
vault would be the actual defect.

The key follows the route, and the two are resolved together for that reason.
Through the tunnel the agent sends the `__openrouter_api_key__` placeholder and
the vault injects the seeded secret; on the bypass path it sends the real dev
key, because nothing there resolves a placeholder. Mixing them fails in both
directions and neither failure names itself:

- a real key sent THROUGH the vault is refused `400
  smuggled_credential_rejected` — measured, and correct: agents may only send
  placeholders through the proxy.
- a placeholder sent on the BYPASS path reaches cfw-api verbatim and 401s.

`local-api-tunnel.ts agent-env` emits `ORI_OPENROUTER_BASE_URL` and
`OPENROUTER_API_KEY` as one pair from one decision, so they cannot disagree.
The seeded secret is the same dev fixture (`sk-or-v1-unlimitedkey`) the non-vault
chat loop uses, so the injected value is one local cfw-api accepts; override it
with `ORI_LOCAL_SEED_SECRET_VALUE` if you need a genuinely remote upstream to
answer.

### Running a plain `tilt up` alongside this

Without `--interns` nothing above happens: the vault stays bound to
`127.0.0.1`, `local-intern` runs exactly as it did before with no proxy env
and no CA mount, its model calls go direct to local cfw-api, and
`vault-secret-seed`, `api-tunnel`, `vault-sidecar` and `vault-smoke` do not
start. The flag is the whole switch.

### `intern-api` is not in that table because it is always on

The API-key twin of all this, `cfw-intern-api` on `/api/v1/interns/**`, is
not one of the twelve. It sits in the `apis` group with `frontend-api` and
`public-api` and starts on **every** `tilt up`, `--interns` or not, with no
`auto_init` gate and no `tilt trigger` needed. Its deps (`postgres-seed`,
`api-kv-cron`, `worker-gates-seed`) are ungated too. Port is
`CFW_INTERN_API_PORT`, default `8823`, and `dev:ports on` remaps it like the
others, into `.env.worktree` rather than your shell, so source that first.

```bash
[ ! -f .env.worktree ] || . ./.env.worktree
PORT=${CFW_INTERN_API_PORT:-8823}
curl -s localhost:$PORT/health                                            # 200 ok
curl -s -o /dev/null -w '%{http_code}\n' localhost:$PORT/api/v1/interns   # 401, no key
curl -s -o /dev/null -w '%{http_code}\n' localhost:$PORT/no-such-path     # 404
```

Those three are the whole smoke. Anything past them with a key is the
`ori-code-api` gate's call (`services/cfw-intern-api/AGENTS.md`), and the
interns sub-app registers middleware only, so even inside the gate you land
on the catch-all 404. There are no lifecycle routes yet (ORI-1875), so this
checks auth and the gate and nothing else. It does not read the `seed-local`
rows and is not a replacement for that seed or for the chat loop above.

## When it misbehaves

- `tilt logs local-intern` — resource start-up, pull, and init failures.
- `tilt logs vault-sidecar` — the sidecar's own output. `vault-tunnel proxy
  listening on 0.0.0.0:8080` is the line that says it is up. Three failures
  worth recognising:
  - `SchemaError(Expected string at ["ORI_VAULT_CA_KEY_FILE"])` — the sidecar
    env file is missing that variable; re-run `tilt trigger vault-secret-seed`.
  - `EgressCaStateError: the egress CA is half-written` — one of
    `root.crt`/`root.key` exists without the other. Remove **both**, then
    restart the sidecar.
  - `ignoring extra certs from /etc/intern-vault/root.crt, load failed` — the
    trust file is missing or malformed, which leaves the agent trusting
    nothing and surfaces later as an unexplained TLS error.
- `tilt logs vault-secret-seed` — an expired Infisical session is the usual
  cause of a failure here, because the vault's `.dev.vars` is what the seeder
  reads `VAULT_API_KEY` and `VAULT_SIGNING_SECRET` out of.
- `docker exec openrouter-local-intern env | grep -i proxy` — what the agent
  is **actually** running with, as opposed to what the env file says. On a
  vault-wired run the `-e` flags and the `--env-file` both apply, and `-e`
  wins, so read the container rather than the file.
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
tag it already has *implicitly*, so the Tiltfile preflights the image with its
own explicit `docker pull` step. An `ORI_RUNTIME_IMAGE` override falls back to
a pre-existing local copy when that pull fails, so a locally built image with
no registry behind it still works.

That preflight is load-bearing, and it does move a stale tag. Measured
2026-09-11: a local `:alpha` from 09-08 (`sha256:71217867…`,
`0.14.1-alpha+7d2e2e4`) was replaced by the pull with the 09-10 image
(`sha256:68dae65b…`, `0.14.1-alpha+ac352fe`). Without that explicit pull a
`docker run` would have gone on serving the two-day-old bytes while every
other signal said the stack was current.

**An `ORI_RUNTIME_IMAGE` override opts out of that freshness guarantee**, by
design — the fallback exists for unpushed local builds. If you override with a
*tag* rather than a digest, check what you are actually running before
trusting a result:

```bash
docker image inspect "$ORI_RUNTIME_IMAGE" --format '{{.Id}} {{.Created}}'
docker exec openrouter-local-intern sh -c 'ORI_TELEMETRY=0 ORI_OUTPUT=json ori --version'
```

To test an ori branch, use `ORI_SOURCE` rather than this override:
[Build an ori branch into a runtime image](#build-an-ori-branch-into-a-runtime-image)
builds, pins and checks the image for you.

One thing worth repeating here: `bun run dev:up` runs `tilt up` with no
arguments, so it does **not** pass `--interns`. For the full stack, run Tilt
directly:

```bash
ORI_RUNTIME_IMAGE=ori-runtime:local tilt up -- --interns
```

`vault-sidecar` and `local-intern` both run the one image, whether it came from
`ORI_RUNTIME_IMAGE` or `ORI_SOURCE`. Pointing either at an egress-mode build is
the *only* change needed to bring `vault-sidecar` up: its env file, CA
directory, proxy port and the agent's trust bundle are already wired.

Verify you are running the bytes you think you are, not the tag:

```bash
docker inspect --format '{{.Id}}' ori-runtime:local
docker inspect --format '{{.Image}}' openrouter-local-vault-sidecar
```

A mismatch means the sidecar is still running a container started from an
older image — `tilt trigger vault-sidecar` after the build, not before.

## Running this next to someone else's stack

**One `tilt up -- --interns` per machine, and the stack now enforces it.** Both
container-running resources hardcode their container names —
`openrouter-local-intern` and `openrouter-local-vault-sidecar` — so a second
stack used to force-remove the first one's intern AND its sidecar, silently and
mid-run, even though `ORI_LOCAL_INTERN_PORT` and `ORI_LOCAL_VAULT_PROXY_PORT`
are both correctly per-branch.

Each container now carries an `ori.local.stack.checkout` label, and
`local-container-claim.ts` reads it before anything is removed: your own
container is replaced as before, and one belonging to another checkout stops the
resource with `container_claim_refused` naming the other checkout. Nothing of
theirs is touched. Check what is running first anyway:

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

If Tilt is running from another checkout and you need interns, do not stop it
and do not start a second one: start an intern slot against it (next section).
Stop the other Tilt only when you need a whole stack of your own; run `tilt down`
there, then `bun run kill-ports` for remaining service listeners.

### Intern slots: your own intern on someone else's stack

A slot is three things of your own attached to the running
`tilt up -- --interns` stack: `openrouter-local-intern-<slot>`,
`openrouter-local-vault-sidecar-<slot>`, and a `local-vault-edge.ts` process. It
shares that stack's vault, cfw-api, tunnel, collector, database and seeded
intern, so there is no second Tilt and no seed change.

```sh
bun run intern:slot up agent1 --ori-source ~/c0de/ori   # omit --ori-source to run the stack's image
bun run services/cfw-secret-vault/scripts/local-fidelity/index.ts check --slot agent1
bun run services/cfw-secret-vault/scripts/local-fault.ts arm vault-5xx --slot agent1
bun run intern:slot list
bun run intern:slot down agent1
```

- `<slot>` matches `^[a-z0-9-]{1,20}$`. Run every command for a slot from the
  checkout that ran `up`: the state file is
  `.dev/local-intern/slots/<slot>.json` there.
- The containers are the base stack's, cloned by `docker inspect`: same command
  and env, with the proxy and vault-edge ports re-pointed at the slot's and
  `ori.slot=<slot>` added to `OTEL_RESOURCE_ATTRIBUTES`. Every port is assigned
  by Docker (`-p 127.0.0.1::<port>`) or the OS (the edge binds port 0) and read
  back into the state file. Nothing derives a port.
- A slot command never stops, restarts or re-claims the base stack's
  containers. `up` claims only `-<slot>` names, and refuses one that another
  checkout started; `down` removes only containers labelled
  `ori.local.slot=<slot>` with those names.
- Vault faults armed with `--slot` fire on the slot's edge only. Provider
  faults (`provider-429`, `provider-500`, `unknown-tool`) live on the one
  shared fake-provider, and arming or disarming any fault clears it, so they
  reach the base stack and every slot alike.
- Slots share the seeded intern's vault rate limit (6000 requests per minute).
- A slot is never reaped. `intern:slot list` shows what is running; `down` it
  when you are done.
- Linux runs the base stack with host networking, where Docker cannot assign
  ports, so `up` refuses there.

A stale checkout is the other half of this, and the stack says so itself: under
`--interns` the Tiltfile prints the checkout, branch, HEAD and distance from
`origin/main` at load, and raises it to a Tilt **warning** when the running code
is behind or dirty. A `tilt up -- --interns` left running for 13h from a
worktree whose PR merged 12 hours earlier was green on every resource while
missing a whole guard resource the branch never had — the missing tenth of ten
is invisible unless you already know to count.

## Related

- `.agents/skills/intern-local-e2e/SKILL.md` — the full provisioning path
  (wizard, Slack, vault, real GCP VM). Use it when the change under test is
  provisioning, Slack integration, or the VM lifecycle; use this skill when
  you only need a talkable intern.
- `local-dev-env` — resource readiness and service selection.
- `clerk-dev-signin-token` — headless sign-in for the web UI.
