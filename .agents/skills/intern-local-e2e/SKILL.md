---
name: intern-local-e2e
description: >-
  Run and test the full intern stack locally — create wizard, Slack app mint,
  OAuth install, provisioning, and a real GCP VM whose bot answers in Slack —
  with no deploy. Covers the prerequisites, the exact start-up order, and the
  failure modes whose error message names the wrong variable. Use before
  claiming an intern-stack change works, and when a wizard step fails.
user-invocable: true
---

# Running and testing interns locally

Verified end to end on 2026-08-16: wizard → Slack app mint → OAuth install →
enqueue → provisioner → real GCP VM → bot answering in Slack, driven entirely
from a laptop.

Add what you learn. Where this file and reality disagree, reality wins.

## What you need before you start

| Requirement | Check | If missing |
|---|---|---|
| `cloudflared` | `which cloudflared` | `brew bundle` |
| Infisical session | `infisical secrets --env=dev --path=/services/cfw-intern-provisioner` | `infisical login` |
| gcloud, authed | `gcloud auth list` | `gcloud auth login` |
| Docker running | `docker ps` | start OrbStack/Docker |
| Slack workspace you can install apps into | — | — |
| A Slack **configuration token** | api.slack.com/apps → *Your App Configuration Tokens* | Generate; copy the `xoxe-` **refresh** token, not `xoxe.xoxp-` |
| A real OpenRouter key, for the final step only | `~/.ori/credentials.json`, or openrouter.ai/keys | See *The intern's own key* below |

You do **not** need any GCP or Cloudflare credentials of your own — they are in
Infisical's dev path and the provisioner reads them itself.

## Start the stack, in this order

Order matters: the Tiltfile reads the tunnel hostname at load time, so a tunnel
started afterwards is invisible to it.

```bash
bun run dev:ports on                      # per-worktree ports
set -a && . ./.env.worktree && set +a     # Tilt does NOT read this by itself

cloudflared tunnel --url http://localhost:$WEB_PORT   # leave running; note the hostname
export DEV_TUNNEL_HOSTNAME=<hostname-without-scheme>

tilt up -- web frontend-api intern-provisioner api
tilt trigger intern-provisioner
```

Include **`api`** if you want the intern's model calls to work against your
local stack, or if you want `/api/v1/*` served at all. It is not in the minimal
set but pulls in `clickhouse-migrate`, `usage-record`, `pubsub` and `redis`,
which take a while the first time.

Run **exactly one** `cloudflared`. Multiple live tunnels is the most
disorienting state available here: Slack redirects to whichever hostname was
baked into the app manifest, Clerk scopes sessions per origin, and
`allowedDevOrigins` lists only one. The symptom is a Clerk error about your
publishable key, which has nothing to do with it.

Then **sign in on the tunnel hostname** — Clerk sessions are per-origin, so a
localhost session does not carry over. Use `clerk-dev-signin-token`.

## Walking the wizard

1. `https://<tunnel>/workspaces/<slug>/interns/create`
2. **Slack config token** — paste the `xoxe-` refresh token. Single-use and
   12h-lived, so generate a fresh one per attempt.
3. **Slack install** — mints a real Slack app from a manifest and sends you
   through OAuth. The redirect must come back to the tunnel.
4. **Review → provision** — enqueues to the provisioner, which creates a real
   GCP VM. Takes a few minutes; the step polls.

If provisioning fails, the UI shows a **Retry provisioning** button that hits
`/retry-enqueue`. Use it. Do not re-open the `review` URL — that calls
`start-provisioning`, which only transitions from `awaiting_slack_install`, so
it will not pick a `failed` intern back up. (There is no bug here; they are two
different routes for two different states.)

Every *new* intern mints a *new* Slack app, so abandoned attempts leave orphaned
apps at api.slack.com/apps. Delete them.

## The intern's own key — the one manual step

A locally provisioned intern boots, installs into Slack, and replies — then
fails every model call:

```
ORI_ADAPTER_UNAUTHORIZED · kind=configuration · stage=adapter · upstream=-32003
```

That is correct, not a bug. `ensure-openrouter-api-key` mints the key **straight
into your local Postgres** (it is a DB insert, not an API call), while the VM
runs in GCP. Worse, it cannot be redirected: `pi`, the agent runtime, hardcodes
`https://openrouter.ai/api/v1` both in its provider definition and on every
entry of its bundled model catalog, with no environment override.
`ORI_OPENROUTER_BASE_URL` exists and ori honours it, but only for ori's own
calls — pi never reads it.

So the intern needs a **real** key:

```bash
bun run intern:use-real-key -- \
  --vm=intern-<name>-<suffix> --bot=<name>-<suffix>
```

It defaults to the key `ori login` left in `~/.ori/credentials.json`; pass
`--key=sk-or-v1-…` for a different one. Inference then bills that key.

This does not survive re-provisioning, which re-mints a local key.

## Failures whose message points at the wrong thing

| What you see | What it actually is |
|---|---|
| `Couldn't save your Slack token` (400) | The `xoxe-` refresh token is single-use and 12h-lived. Generate a fresh one; do not paste `xoxe.xoxp-`. |
| `Slack is not configured on this server` | `INTERN_DNS_ZONE` is unset. The text names `INTERN_SLACK_REDIRECT_BASE_URL`, which is fine. |
| `cookie mint failed` | `INTERN_SLACK_INSTALL_SIGNING_KEY` unset (needs ≥32 chars). |
| Clerk `host_invalid` at the OAuth callback | Web's dev proxy followed the worker's Clerk handshake 307 server-side, re-sending `host: localhost:<port>`. Fixed by `redirect: 'manual'` in `devCorsProxyRequest`. If it recurs, count your tunnels first. |
| `enqueue failed … config_missing` | `INTERN_PROVISIONER_ENQUEUE_SECRET` differs between frontend-api and the provisioner. It lives under the *provisioner's* Infisical path, which frontend-api cannot read. |
| `missing/invalid secrets: [...]` | The provisioner is starting without its Infisical bridge — check its `package.json` still has `x` + `dev`, and `scripts/dev.ts` still calls `writeDevVars()`. |
| `INTERN_GCP_SERVICE_ACCOUNT_JSON must be valid JSON` | The stored value ends with a newline; `serializeDevVar` escapes it to a literal `\n` that `JSON.parse` rejects. Fixed by trimming in `writeDevVars`. |
| `ORI_ADAPTER_UNAUTHORIZED` in Slack | Expected. See *The intern's own key*. |
| `402 Insufficient credits` from a local call | Your local `credits` table is empty: `INSERT INTO credits (created_at, amount, clerk_user_id, note) VALUES (now(), 100, '<clerk_user_id>', 'local testing');` |

## How secrets reach a worker

`wrangler dev` reads `.dev.vars` — not the shell, not Infisical. Each service
bridges the gap itself:

```
package.json "x"   → infisical run --path=/services/<svc> -- tsx
package.json "dev" → bun run x scripts/dev.ts
scripts/dev.ts     → writeDevVars()   # process.env → .dev.vars
                   → wrangler dev
```

A service without that chain starts with **no secrets and no error saying so**.
Two rules follow:

- **A Tiltfile `export` survives only for names Infisical does not carry.**
  `infisical run` overrides names it defines and leaves the rest alone.
- **Read secrets in a `$(...)` subshell, never interpolated into `serve_cmd`.**
  Tilt echoes commands to its log verbatim.

## Verifying, honestly

**Run `bun run dev:doctor` first.** It now names the traps that cost the most
time here: no `cloudflared`, a tunnel running with no `DEV_TUNNEL_HOSTNAME`,
**more than one tunnel**, a provisioner that has lost its Infisical bridge, and
a malformed `INTERN_PROVISIONER_URL`. Each of those fails silently at runtime.

**Your shell is not a clean environment.** The sharpest bug in this work shipped
green because I had run `set -a && . ./.env.worktree && set +a`, so Tilt
inherited the worktree ports and the provisioner bound the right one. The
Tiltfile reads `.env.worktree` with `read_file` and deliberately does *not* leak
it into the environment, so for anyone who had not sourced it the worker bound
the default port while the probe, the links and `INTERN_PROVISIONER_URL` all
used the worktree port. "It works" meant "it works with my shell's exports".
When a service resolves config from the environment, check what the *child
process* sees, not what your shell has.


`grep -q '^KEY=' .dev.vars` proves **presence, not usability**. It cannot see an
unparseable value, and it will happily read a file written before the restart
you are testing. Both produced false "all green" reports during the run this
came from. Parse the value, and check the service came back first.

The end-to-end check that actually means something, run from inside the
intern's container:

```bash
gcloud compute ssh <vm> --project=ext-interns-spawner-000 --zone=us-central1-a \
  --tunnel-through-iap --command='sudo docker exec ori-<bot> sh -c "
    curl -sS -o /dev/null -w \"%{http_code}\n\" https://openrouter.ai/api/v1/key \
      -H \"Authorization: Bearer \$OPENROUTER_API_KEY\""'
```

## Real resources, real money

There is one GCP project — `ext-interns-spawner-000` — and no sandbox. Local
runs create **real VMs** there and **real DNS records** under `or.bot`, beside
production interns. That is already the established practice (`intern-e2e-*`,
`intern-test-*` VMs are in it), so the hazard is litter, not safety: failed runs
leave paid VMs running.

```bash
gcloud compute instances list --project=ext-interns-spawner-000
gcloud compute instances delete <name> --project=ext-interns-spawner-000 --zone=us-central1-a
```

## Related

- `local-intern-chat` — when you only need a talkable intern with no
  provisioning: `tilt up -- --interns` runs the ori-runtime container locally
  with a dev-only web chat (no GCP VM, no Slack, no vault)
- `services/cfw-intern-provisioner/AGENTS.md` — the runbook, indexed by symptom
- `tilt-testing` — resource readiness, manual-trigger reference
- `clerk-dev-signin-token` — headless sign-in
- `ori-testing` — deploys, artifact verification, the vault injection contract
