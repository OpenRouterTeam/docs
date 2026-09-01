# Running the intern stack locally

Getting from `tilt up` to a real Slack app installed in your workspace, and provisioning that actually starts.

Everything through the Slack install works with no cloud credentials. Only the final VM/tunnel steps need GCP and Cloudflare secrets.

## Setup

Prerequisites, all checkable in a few seconds:

| Requirement | Check |
|---|---|
| `cloudflared` | `which cloudflared` — else `brew bundle` |
| Infisical session | `infisical secrets --env=dev --path=/services/cfw-intern-provisioner` |
| gcloud, authed | `gcloud auth list` |
| Docker running | `docker ps` |
| Slack config token | api.slack.com/apps → *Your App Configuration Tokens* → the `xoxe-` **refresh** token |

No GCP or Cloudflare credentials of your own are needed: they are in Infisical's
dev path and this service reads them itself once the bridge below is intact.

```bash
brew bundle                 # installs cloudflared
bun run dev:ports on        # per-worktree ports, so parallel sessions don't collide
```

Export the tunnel config before `tilt up` — Tilt reads it at load time:

```bash
export DEV_TUNNEL_NAME=<your-named-tunnel>
export DEV_TUNNEL_HOSTNAME=<the-hostname-that-tunnel-serves>
```

Then:

```bash
tilt up -- web frontend-api intern-provisioner
tilt trigger dev-tunnel
```

Generate a Slack configuration token once per account at [api.slack.com/apps](https://api.slack.com/apps) (*Your App Configuration Tokens* → *Generate Token*, copy the `xoxe-` **refresh** token, not the `xoxe.xoxp-` access token) and save it on the Slack setup page under your workspace's interns section.

Finally, **sign in on the tunnel hostname**, not localhost. Clerk sessions are per-origin, so a localhost session does not carry over.

## Retrying after a failure

Use the **Retry provisioning** button on the provisioning step. It calls
`/retry-enqueue`, which is the route for this: it requires status `failed` with
`last_failure.step === Queued`, and clears back to `queued`.

Do **not** re-open the wizard's `review` URL to retry. That calls
`start-provisioning`, which transitions with
`expectedStatus: AwaitingSlackInstall` and so will not pick up a `failed`
intern. The two routes cover two different states; neither is broken, but
reaching for the wrong one looks like a broken retry and tempts you into
hand-editing `interns.status`.

Creating a fresh intern mints a **new** Slack app every time, so abandoned
attempts leave orphaned apps at api.slack.com/apps. Delete them.

## Use a named tunnel, not a quick one

`DEV_TUNNEL_NAME` unset falls back to a quick tunnel with a random `*.trycloudflare.com` hostname. That is fine for a one-off look and wrong for anything else, because the hostname must be stable in three places at once:

1. It is baked into every minted Slack app's manifest as the OAuth redirect URL. A new hostname breaks every app minted in a previous session.
2. It scopes your Clerk session.
3. It must appear in web's `allowedDevOrigins`.

## Seeding states

`bun run db:reset` seeds one intern per lifecycle state via `scripts/seed/seed-interns.ts`, so you can jump straight to a state instead of driving the whole flow:

| Intern | State it exercises |
|---|---|
| `seed-await` | Slack app minted, never installed (`awaiting_install`) |
| `seed-queued` | enqueued, worker has not picked it up |
| `seed-vm` | mid-provisioning |
| `seed-failed` | failed, with the recovery surface |
| `seed-running` | live, Slack installed |

**Do not hand-write an `INSERT` to add a state.** `slackInstallState` is derived from the intern's *linked credential* via the `intern_connection_credentials` join table, not from the intern row, so an intern seeded without a credential silently reads as `not_provisioned` whatever you intended. Add a fixture to `seed-interns.ts` instead — it already handles the fixed ids, the upsert, `encryptSecret`, and the join rows.

The distinction that matters most when testing: **`not_provisioned` and `awaiting_install` are different states with different paths through the wizard.** The first means the mint never succeeded (no credential row at all); the second means it was minted but never installed. Any intern with no linked credential is the former.

## When something silently does nothing

Each of these fails without an error. `bun run dev:doctor` names them, but here they are by symptom.

**Clerk never loads — `Clerk.status` stuck at `"loading"`, browser console empty.**
`DEV_TUNNEL_HOSTNAME` is not reaching web's `allowedDevOrigins`. The real error is in the **web dev-server log**, not the browser: `Blocked cross-origin request to Next.js dev resource /_next/hmr`.

Two things have to be true, and the second is easy to miss: the variable must be exported **before `tilt up`** (the Tiltfile reads it at load time), and it must be listed in the `dev` task's `passThroughEnv` in `turbo.json`. Web runs under `bunx turbo run dev`, and turbo passes through only the variables on that allowlist — a variable set in your shell and threaded through Tilt still arrives empty without it. Restart the web resource after changing either.

**Provisioning never starts; the UI spins forever.**
`INTERN_PROVISIONER_URL` is missing its `/api/v1/interns` suffix. `enqueue-provisioning` appends `/enqueue` and the worker matches full pathnames, so a bare origin 404s silently. Tilt sets this correctly; only a manual override gets it wrong.

**Provisioning is rejected.**
`INTERN_PROVISIONER_ENQUEUE_SECRET` differs between `frontend-api` and the provisioner. Both must read the same value.

**The provisioner shows ready but every request fails.**
Check `/api/v1/interns/health` (not `/health` — that path does not exist).

**Slack refuses the redirect.**
Slack only accepts `https` redirect URLs and cannot reach `localhost`. The tunnel must be running and `INTERN_SLACK_REDIRECT_BASE_URL` must point at it.

**The Slack app mint fails with `slack_unconfigured`.**
`INTERN_DNS_ZONE` is unset. The message names `INTERN_SLACK_REDIRECT_BASE_URL`, which is usually set correctly — it sends you looking in the wrong place. frontend-api declares the zone optional with no default, unlike the provisioner, which defaults to `or.bot`.

**Saving the Slack config token 400s with `Couldn't save your Slack token`.**
The `xoxe-` refresh token is **single-use** and expires after 12 hours. Generate a fresh one. Do not paste the `xoxe.xoxp-` access token — the mint needs the refresh token.

**The install callback dies on Clerk `host_invalid`.**
Web's dev proxy (`devCorsProxyRequest`) forwards `/api/frontend/*` with a plain `fetch()`, which **follows redirects by default**. The worker's Clerk handshake 307 was therefore chased by the Next dev server, re-sending `host: localhost:<port>` to Clerk, which could not attribute it. Fixed with `redirect: 'manual'` so the 3xx reaches the browser that owns the handshake. If this returns, first check you are not running more than one `cloudflared`.

**Provisioning is rejected with `missing/invalid secrets`.**
The provisioner is starting without its Infisical bridge. See the section below — it was the only `cfw-*` worker lacking one.

**`INTERN_GCP_SERVICE_ACCOUNT_JSON must be valid JSON`.**
The stored secret ends with a trailing newline. `serializeDevVar` escapes newlines to a literal `\n` and single-quote wraps; dotenv does not unescape single-quoted values, so the worker receives `{...}` followed by two characters `JSON.parse` rejects as trailing non-whitespace. `writeDevVars` now trims trailing whitespace. A `grep -q '^KEY='` check cannot catch this class of bug — parse the value.

**The Credential Vault page says "the vault could not be reached".**
`secret-vault` is a separate Tilt resource and is not started by `tilt up -- web frontend-api intern-provisioner`. If you filtered resources at startup it is *disabled*, not merely stopped: `tilt enable secret-vault && tilt trigger secret-vault`, then confirm `curl localhost:8796/health` returns `ok` — `misconfigured_environment` means the worker cannot read its own secrets.

**A resource you named in `tilt up -- …` never becomes ready.**
`intern-provisioner`, `secret-vault`, and `dev-tunnel` are all `auto_init=False`. Naming one in the `tilt up` filter *enables* it but does not *start* it, so `tilt wait` sits there until it times out. Trigger them explicitly:

```bash
tilt trigger intern-provisioner secret-vault
```

## How env vars actually reach a worker (and when they do not)

Worth understanding before adding any config here, because getting it wrong fails silently.

`wrangler dev` reads `.dev.vars`, not the shell. `scripts/dev.ts` bridges the two by writing every `process.env` entry into `.dev.vars` — which is why exporting a variable in a Tilt `serve_cmd` reaches the worker at all.

**But `bun run dev` runs under `infisical run`, and Infisical's values win.** Verified 2026-08-14: exporting `SECRET_VAULT_URL=http://localhost:9999/...` and running under Infisical yielded `http://localhost:8796` — the Infisical value. `INTERN_PROVISIONER_URL` and `INTERN_SLACK_REDIRECT_BASE_URL` work only because neither is set in Infisical's dev path; adding either there would silently override the Tiltfile.

This is also why `CFW_SECRET_VAULT_PORT` is deliberately **not** in the worktree port block. Isolating it per worktree would move the vault off `8796` while `SECRET_VAULT_URL` stays pinned to `8796` by Infisical, and the Tiltfile cannot override it. Two concurrent sessions therefore still contend for `8796`; fixing that means changing the Infisical dev value, which affects everyone and belongs in its own change.

### Moving a secret into `[vars]`

Two facts about the deployed worker, both learned the hard way and neither documented by Cloudflare.

**A deploy never removes a secret.** This service deploys with `wrangler versions upload`, which hard-codes `keepSecrets: true` — "we never delete secret bindings when uploading … so inherit all unchanged secrets from the previous Worker Version". Deleting a value from Infisical therefore does **not** delete it from the worker; the binding survives every subsequent deploy until someone runs `wrangler secret delete`. And because secrets are write-only, nobody can see they were wrong about this.

**A `[vars]` entry and a secret of the same name collide, and the var wins.** Observed directly: after a deploy that declared the name in `[vars]`, the secret was gone from `wrangler secret list`. Cloudflare's docs are silent on the precedence and wrangler has no client-side validation for the collision — it resolves server-side, so there is no way to determine the outcome in advance.

So the safe recipe for any secret → var move, `INTERN_RUNTIME_IMAGE` or otherwise:

1. Set the `[vars]` entry to the **exact string the secret already holds**. Both sides of the collision then carry the same value, so precedence cannot change behaviour whichever way it resolves.
2. Deploy, and confirm with `wrangler secret list` plus whatever route reads the value back.
3. Delete the secret explicitly, as a separate step.

Never let step 1 change the value and the binding kind at once. If the precedence surprises you, you want it to be undetectable rather than an incident.

## This service's Infisical bridge

`wrangler dev` reads `.dev.vars`, never the shell and never Infisical. Every
`cfw-*` service closes that gap the same way, and until 2026-08-16 this one did
not — its `package.json` had neither an `x` script nor `scripts/dev.ts`, and its
Tilt resource ran `bunx wrangler dev` directly. It therefore started with **no
cloud credentials and no error saying so**, and rejected every enqueue with
`missing/invalid secrets`. Provisioning could not have worked locally.

The chain, which must stay intact:

```
package.json "x"   → infisical run --path=/services/cfw-intern-provisioner -- tsx
package.json "dev" → bun run x scripts/dev.ts
scripts/dev.ts     → writeDevVars()   # process.env → .dev.vars
                   → wrangler dev
```

Two secrets still need help from the Tiltfile, both for reasons worth knowing:

- **`INTERN_PROVISIONER_ENQUEUE_SECRET`** lives under *this* service's Infisical
  path, so the provisioner gets it for free — but frontend-api reads its own
  path, which carries no `INTERN_*` key, and the two values must be identical.
  The Tiltfile reads it from here and hands it to frontend-api.
- **`PROVIDER_ENCRYPTION_KEY`** must be byte-identical to the value
  frontend-api used to encrypt the credential this service decrypts. It was
  missing from this service's dev folder until 2026-08-16 (the Tiltfile injected
  it from `/services/cfw-frontend-api` as a stopgap); it is now set here
  directly, as `env.manifest.json` always declared.

The enqueue secret is read in a `$(...)` subshell rather than interpolated into
`serve_cmd`, because Tilt echoes commands to its log verbatim and an
interpolated secret would sit there in plaintext.

Note that `validate-infisical-mapping.ts` checks manifest entries against
Infisical, but only for paths belonging to files changed in the diff — so a
folder nobody edits can drift from the manifest indefinitely, which is exactly
how this one went missing.

### What `env.manifest.json` deliberately omits for this path

`env.ts` declares more names than the manifest registers, and the gap is intentional: the manifest is **one list per path with no per-environment distinction** — registering a name asserts it should exist in *every* environment, and `validate-infisical-mapping.ts` defaults to `INFISICAL_ENV=dev`. So registering a prod-only override buys a permanent false `❌ Missing in Infisical` against dev.

Register a name here only once it is confirmed set at `/services/cfw-intern-provisioner`. The names below are the ones deliberately unregistered today — keep this list complete rather than counting it, so a newly added var shows up as absent from it:

- **Config vars with committed defaults**, not secrets, and unset in dev: `INTERN_VM_ZONE`, `INTERN_VM_MACHINE_TYPE`, `INTERN_CLOUD_SDK_IMAGE`, `INTERN_LOGS_GCS_BUCKET`, `INTERN_VAULT_NO_PROXY`, `INTERN_VAULT_PROXY_PORT`, `INTERN_SKIP_CF_TUNNEL`, `SERVICE_NAME`, `INTERN_OTEL_COLLECTOR_IMAGE`, `INTERN_OTEL_COLLECTOR_PORT`, `INTERN_DD_SITE`, `INTERN_VM_REPORT_URL`.
- **Optional-everywhere secrets**: `INTERN_DD_API_KEY` — telemetry export is opt-in on this key and it is not yet set in any environment. Register it once it is confirmed set at this path in dev.
- **E2E-only base-URL overrides**, documented in `env.ts` as staying unset in production: `CF_API_BASE_URL`, `GCP_COMPUTE_API_BASE_URL`, `GCP_STORAGE_API_BASE_URL`, `GCP_ARTIFACT_REGISTRY_API_BASE_URL`.
- **Prod-only overrides — now confirmed.** Infisical **prod** reads return `403 You are not allowed to readValue on secrets` under ordinary developer credentials, so these cannot be confirmed *from Infisical* on a laptop. `npx wrangler secret list --config wrangler.toml` can: it prints the names bound on the deployed worker with no Infisical prod access at all. Run 2026-08-19, it settles the four names this list used to carry as "believed, unverified":
  - `INTERN_VAULT_API_KEY`, `INTERN_VAULT_TUNNEL_URL` — **bound in prod**. Genuine prod-only overrides.
  - `INTERN_CLOUDFLARED_IMAGE` — **not bound**. Production runs the committed `cloudflare/cloudflared:latest` default: a moving tag, on a non-Google registry, pulled anonymously.
  - `INTERN_RUNTIME_IMAGE` — **no longer a secret**. #34948 moved it to `[vars]` in `wrangler.toml`; see "Moving a secret into `[vars]`" above.

  Note the limit of that instrument. It answers "is this a real prod-only override?" It does **not** answer "should this be registered?" — `validate-infisical-mapping.ts` checks against **dev**, so a name bound in prod but absent from the dev path still buys the permanent false `❌`. Registration stays gated on the name existing at `/services/cfw-intern-provisioner` in dev, exactly as the paragraph above says. The two questions are easy to conflate because one command appears to answer both.

Registering an absent name does **not** fail CI: `validateInfisicalMapping` logs and returns, and `scripts/lint.ts` fails a task only when its promise rejects. `INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` is registered but unset in dev today and lint is green. The cost is misleading output, not a red build.

That key is unset in **production** too — the same `wrangler secret list` run above does not list it. So the enqueue signature is not merely optional in dev; it is inactive everywhere, and every request to this worker authenticates with the legacy shared secret. See "Auth on these routes" in `RUNBOOK.md` before assuming a signed path exists.

Remember the precedence rule: a Tiltfile `export` survives only for names
Infisical does **not** carry. Adding either of the above to this service's dev
folder would silently take over from the Tiltfile.

## Going all the way to a running intern

The GCP and Cloudflare credentials are already in Infisical's **dev** path
(`INTERN_GCP_SERVICE_ACCOUNT_JSON`, `INTERN_CF_ACCOUNT_ID`,
`INTERN_CF_API_TOKEN`, `INTERN_CF_DNS_ZONE_ID`), so with the bridge above in
place a local run provisions a real VM with no extra setup.

Understand what that means before running it. There is **one** GCP project —
`ext-interns-spawner-000`, which the dev service account points at — and no
sandbox. A local run creates a real VM there and a real DNS record under
`or.bot`, alongside production interns. That is already the established practice
(`intern-e2e-*` and `intern-test-*` VMs are in it), so the hazard is not safety
but litter: failed runs leave paid VMs running. Keep `INTERN_VM_MACHINE_TYPE`
small and delete what you create:

```bash
gcloud compute instances list --project=ext-interns-spawner-000
gcloud compute instances delete <name> --project=ext-interns-spawner-000 --zone=us-central1-a
```

### A locally provisioned intern needs a real OpenRouter key

It boots, installs into Slack and replies — then fails every model call:

```
ORI_ADAPTER_UNAUTHORIZED · kind=configuration · stage=adapter · upstream=-32003
```

Correct behavior, not a bug. `ensure-openrouter-api-key` mints the key **straight
into Postgres** — a DB insert via `insertApiKey` + `deriveInternOpenrouterSk`,
not a call to any API — so a key minted locally is only valid where the local
database is authoritative. The VM runs in GCP and talks to production.

It cannot be redirected. `pi`, the agent runtime, hardcodes
`https://openrouter.ai/api/v1` in its provider definition **and** on every entry
of its bundled model catalog, with no environment override. `ori` does read
`ORI_OPENROUTER_BASE_URL`, but only for its own calls (telemetry, skills,
models) — pi never consults it, which is why pointing it at a local stack still
produces an *unauthorized* rather than a *credits* error.

Swap in a real key:

```bash
bun run intern:use-real-key -- --vm=intern-<name>-<suffix> --bot=<name>-<suffix>
```

It defaults to the key `ori login` stored in `~/.ori/credentials.json`. The env
file is `chattr +i`, so the script clears the bit, rewrites the line, restores
it and restarts the unit. **Re-provisioning re-mints a local key and undoes
this.**

Fully local inference would need pi to accept a base-URL override — a change in
the pi/ori repos, not this one.

## Testing without the cloud

`GCP_COMPUTE_API_BASE_URL`, `GCP_STORAGE_API_BASE_URL`, and `CF_API_BASE_URL` are overridable env vars with production defaults, and `INTERN_SKIP_CF_TUNNEL` skips tunnel creation. Pointing them at a local fake is the intended path for exercising provisioning failure branches without touching a cloud account.
