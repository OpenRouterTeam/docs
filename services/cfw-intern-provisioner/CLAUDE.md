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
bun run dev:ports on        # optional service-port overrides; databases and containers remain shared
```

Export the tunnel config before `tilt up` — Tilt reads it at load time:

```bash
export DEV_TUNNEL_NAME=<your-named-tunnel>
export DEV_TUNNEL_HOSTNAME=<the-hostname-that-tunnel-serves>
```

Then:

```bash
bun run dev:up
tilt trigger dev-tunnel intern-provisioner
tilt wait --for=condition=Ready uiresource/intern-provisioner --timeout=300s
```

Generate a Slack configuration token once per account at [api.slack.com/apps](https://api.slack.com/apps) (*Your App Configuration Tokens* → *Generate Token*, copy the `xoxe-` **refresh** token, not the `xoxe.xoxp-` access token) and save it on the Slack setup page under your workspace's interns section.

Finally, **sign in on the tunnel hostname**, not localhost. Clerk sessions are per-origin, so a localhost session does not carry over.

## Which ports this stack is actually on

`bun run dev:ports on` remaps this worktree into a hashed 20000-29999 block, so every port named in this document is a default your worktree may not be using. Read the effective values with `bun run dev:ports status`. It only *prints* the mapping — it runs in a subprocess and exports nothing, so `$CFW_INTERN_PROVISIONER_PORT` is still empty in your shell afterwards. Source `.env.worktree` when you want the values themselves.

The four that matter here, each resolved by the Tiltfile's `_port()` helper in the order override, then environment, then default:

- **`intern-provisioner`** — `CFW_INTERN_PROVISIONER_PORT`, default `8816`. Health is `/api/v1/interns/health`, not `/health`.
- **`intern-api`** — `CFW_INTERN_API_PORT`, default `8823`. Health is `/health`. Starts on every `tilt up`, with or without `--interns`; see [Hitting the API locally](#hitting-the-api-locally).
- **`local-intern`** — `ORI_LOCAL_INTERN_PORT`, default `7070`. Health is `/health`. Started by `tilt up -- --interns`.
- **`secret-vault`** — `CFW_SECRET_VAULT_PORT`, default `8796`, and never remapped.

That last one is the exception worth understanding rather than memorising. The Tiltfile resolves it through `_port()` like its siblings, but `scripts/worktree-ports.sh` deliberately never writes it into `.env.worktree`, so it falls through to `8796` on every worktree — see [How env vars actually reach a worker](#how-env-vars-actually-reach-a-worker-and-when-they-do-not) for why Infisical pins `SECRET_VAULT_URL` to that port and what moving the vault off it would break. The practical consequence is that two concurrent sessions still contend for `8796` while everything around it is isolated.

**A stale `.env.worktree` is silently partial.** The file is generated once and nothing migrates it afterwards, so a file written before a port variable existed reports `ON` while that service quietly keeps its default. The primary checkout is a live example: its file predates `ORI_LOCAL_INTERN_PORT` entirely, so the local intern sits on `7070` while cfw-api, frontend-api and the provisioner have all moved. Drift runs both ways — that same file still carries three `SAFER_*` ports the script no longer generates. `dev:ports status` greps for the current variable names, so it reveals neither half: it lists the twelve variables the file and the script agree on, and stays silent about both the four it is missing and the three that are dead. The header records the branch the file was generated for, which is the fastest way to spot one that has gone stale; `bun run dev:ports on` regenerates it.

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
| `seed-stuck-delete` | `destroying` at the sweep's attempt cap, unwritten for an hour: a teardown the sweep gave up on. Delete re-dispatches it (ORI-2254) |
| `seed-clear-stuck` | `destroy_failed` at the attempt cap with `deletion_unverified` on `delete-gcp-vm` and `delete-snapshots`: Ori Fleet shows Clear stuck teardown |
| `seed-retry-delete` | `destroy_failed` at the attempt cap with `workspace_archive_failed` on `confirm-workspace-archive`: Ori Fleet shows Failed teardown, cleared by Delete intern without backup |
| `seed-ghost-vm` | `running` with a VM recorded in a project the lifecycle fixture proves empty: the production ghost row, cleared by Ori Fleet's Delete intern without backup (ORI-2355) |

To drive Delete on `seed-stuck-delete` end to end, run the stack with `INTERN_PROVISIONER_TARGET=lifecycle-fixture tilt up -- --interns`, which starts `intern-lifecycle-fixture` and points `frontend-api` and `internal` at it with its own enqueue credentials. The first Delete answers 202 `teardown: "dispatched"`, and its run spends about 70 seconds retrying the workspace-archive step (the seeded row records no VM zone), so a second Delete inside that window answers 409 `teardown_in_flight`. Re-running the seed puts the row back.

The two `destroy_failed` rows are written by the real teardown writers (`scripts/seed/seed-teardown-failed-interns.ts`). Drive their Mission Control actions with the `mission-control-ori-fleet` skill, under `INTERN_PROVISIONER_TARGET=lifecycle-fixture` so Delete intern reaches the fixture and never real GCP. `seed-ghost-vm` (`scripts/seed/seed-ghost-running-intern.ts`) is driven the same way.

**Do not hand-write an `INSERT` to add a state.** `slackInstallState` is derived from the intern's *linked credential* via the `intern_connection_credentials` join table, not from the intern row, so an intern seeded without a credential silently reads as `not_provisioned` whatever you intended. Add a fixture to `seed-interns.ts` instead — it already handles the fixed ids, the upsert, `encryptSecret`, and the join rows.

The distinction that matters most when testing: **`not_provisioned` and `awaiting_install` are different states with different paths through the wizard.** The first means the mint never succeeded (no credential row at all); the second means it was minted but never installed. Any intern with no linked credential is the former.

## Hitting the API locally

The seed above is still how you land in a lifecycle state. The extra check beside it is `cfw-intern-api`, the API-key surface at `/api/v1/interns/**`, which a laptop can call the way a customer will.

It needs nothing from this document's setup: no tunnel, no Slack token, no `--interns`. The `intern-api` Tilt resource sits in the `apis` group with `frontend-api` and `public-api` and starts on **every** `tilt up`, ungated, as do its deps `postgres-seed`, `api-kv-cron` and `worker-gates-seed`. Port is `CFW_INTERN_API_PORT`, default `8823`, remapped by `bun run dev:ports on` like the provisioner's, and as noted above that remap lives in `.env.worktree`, not in your shell, so source it first.

```bash
[ ! -f .env.worktree ] || . ./.env.worktree
PORT=${CFW_INTERN_API_PORT:-8823}
curl -s localhost:$PORT/health                                            # 200 ok
curl -s -o /dev/null -w '%{http_code}\n' localhost:$PORT/api/v1/interns   # 401, no key
curl -s -o /dev/null -w '%{http_code}\n' localhost:$PORT/no-such-path     # 404
```

Note the two `/api/v1/interns` prefixes: the provisioner's health is `/api/v1/interns/health` on `8816`, while `intern-api` answers `/health` on `8823` and `401`s a bare `/api/v1/interns` without a key. By the gate's design, a 404 on an intern-api route you know exists means the key is outside `ori-code-api`, not that the route is missing ([`cfw-intern-api/AGENTS.md`](../cfw-intern-api/AGENTS.md)).

The chat completion route (`POST /:internId/chat/completions`, ORI-1877) is served; the rest of the sub-app still ends at the catch-all 404 until the lifecycle routes (ORI-1875) land, so the API still cannot create, suspend, resume or delete interns. `bun run db:reset` remains the way to put an intern in a given state.

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
First check you are not running more than one `cloudflared`. The other cause is web's dev proxy (`devCorsProxyRequest`) following the worker's Clerk handshake 307 itself and re-sending `host: localhost:<port>` to Clerk, which cannot attribute it; the proxy forwards `/api/frontend/*` with `redirect: 'manual'` so the 3xx reaches the browser that owns the handshake, and this symptom means that has regressed.

**Provisioning is rejected with `missing/invalid secrets`.**
The provisioner is starting without its Infisical bridge. See the section below.

**`INTERN_GCP_SERVICE_ACCOUNT_JSON must be valid JSON`.**
The stored secret ends with a trailing newline, so the worker receives `{...}` followed by characters `JSON.parse` rejects as trailing non-whitespace. `buildWranglerDevEnv` trims trailing whitespace from every Infisical value for exactly this reason, so check that path first. A `grep -q '^KEY='` check cannot catch this class of bug — parse the value.

**The Credential Vault page says "the vault could not be reached".**
`secret-vault` is a separate Tilt resource. Confirm it is Ready; if it was disabled or has not started, run `tilt enable secret-vault` and `tilt trigger secret-vault`. Its default health URL is `http://localhost:8796/health`; `misconfigured_environment` means the worker cannot read its own secrets.

**A resource you named in `tilt up -- …` never becomes ready.**
Naming a manual resource in a `tilt up` filter enables it but does not start it. Filtered startup also excludes resources not named in the filter. Use [local-dev-env](../../.agents/skills/local-dev-env/SKILL.md), then trigger resources that have not started:

```bash
tilt trigger intern-provisioner secret-vault
```

## How env vars actually reach a worker (and when they do not)

Worth understanding before adding any config here, because getting it wrong fails silently.

`wrangler dev` reads neither the shell nor Infisical on its own. `scripts/dev.ts` bridges the gap with `wranglerDevEnv()` (`packages/helpers/wrangler-dev-env.ts`): it exports this service's Infisical path in memory, adds the variables the Tilt resource names in `WRANGLER_DEV_KEYS`, and starts wrangler with that environment and `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`. Nothing is written to `.dev.vars`, and the shell that started Tilt is not copied — which is why a Tilt `serve_cmd` export reaches the worker only when the Tiltfile's `local_resource` wrapper lists its name.

**But `bun run dev` runs under `infisical run`, and Infisical's values win.** A shell export of a name Infisical carries (say `SECRET_VAULT_URL`) reaches the worker as the Infisical value, not the exported one. `INTERN_PROVISIONER_URL` and `INTERN_SLACK_REDIRECT_BASE_URL` work only because neither is set in Infisical's dev path; adding either there would silently override the Tiltfile.

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

### A third fact: `[vars]` is production config that local dev also reads

`wrangler dev` runs the top-level config — this service passes no `--env` — so every `[vars]` entry reaches a laptop too, and the environment `scripts/dev.ts` hands wrangler is the only thing that can override one. That is harmless for a value a local run simply uses (the image pins), and load-bearing for a value that means something about the *deployment*.

`OR_ENV = "production"` is the case in point. It is there so the deployed worker identifies itself, and until ORI-1921 nothing local read it except the OTel `env` tag. Now `buildVaultProvisioning` fails closed on `OR_ENV === 'production'`, so a laptop claiming to be production would demand a vault origin and a vault API key nobody has locally. `scripts/dev.ts` therefore defaults `OR_ENV=development` before `wranglerDevEnv()`, which forwards `OR_ENV` from the shell for every launcher (an explicit export still wins), and the Tiltfile exports it the same way it already does for every other `cfw-*` worker. Two entrypoints because Tilt's CI branch runs `wrangler dev` directly and skips `scripts/dev.ts`.

The general rule: before moving a value into `[vars]`, ask what a *local* run does with it. There is no "production only" side of this file.

## This service's Infisical bridge

`wrangler dev` reads neither the shell nor Infisical on its own. Every
`cfw-*` service closes that gap the same way. Without the bridge — an `x`
script, a `dev` script running `scripts/dev.ts`, and a Tilt resource that
goes through it rather than running `bunx wrangler dev` directly — the worker
starts with **no cloud credentials and no error saying so**, and rejects every
enqueue with `missing/invalid secrets`. `bun run dev:doctor` checks for it.

The chain, which must stay intact:

```
package.json "x"   → infisical run --path=/services/cfw-intern-provisioner -- tsx
package.json "dev" → bun run x scripts/dev.ts
scripts/dev.ts     → wranglerDevEnv()   # Infisical export + WRANGLER_DEV_KEYS, in memory
                   → wrangler dev       # with that environment, CLOUDFLARE_INCLUDE_PROCESS_ENV=true
```

Two secrets must match frontend-api's, for reasons worth knowing:

- **`INTERN_PROVISIONER_ENQUEUE_SECRET`** lives under *this* service's Infisical
  path, so the provisioner gets it for free — but frontend-api reads its own
  path, which carries no `INTERN_*` key, and the two values must be identical.
  The Tiltfile reads it from here and hands it to frontend-api.
- **`PROVIDER_ENCRYPTION_KEY`** must be byte-identical to the value
  frontend-api used to encrypt the credential this service decrypts. It is set
  in this service's dev folder, as `env.manifest.json` declares; keep it in
  step with `/services/cfw-frontend-api` rather than injecting it from there.

The enqueue secret is read in a `$(...)` subshell rather than interpolated into
`serve_cmd`, because Tilt echoes commands to its log verbatim and an
interpolated secret would sit there in plaintext.

Note that `validate-infisical-mapping.ts` checks manifest entries against
Infisical, but only for paths belonging to files changed in the diff — so a
folder nobody edits can drift from the manifest indefinitely.

### What `env.manifest.json` deliberately omits for this path

`env.ts` declares more names than the manifest registers, and the gap is intentional: the manifest is **one list per path with no per-environment distinction** — registering a name asserts it should exist in *every* environment, and `validate-infisical-mapping.ts` defaults to `INFISICAL_ENV=dev`. So registering a prod-only override buys a permanent false `❌ Missing in Infisical` against dev.

Register a name here only once it is confirmed set at `/services/cfw-intern-provisioner`. The names below are the ones deliberately unregistered today — keep this list complete rather than counting it, so a newly added var shows up as absent from it:

- **Config vars with committed defaults**, not secrets, and unset in dev: `INTERN_VM_ZONE`, `INTERN_VM_MACHINE_TYPE`, `INTERN_CLOUD_SDK_IMAGE`, `INTERN_LOGS_GCS_BUCKET`, `INTERN_VAULT_NO_PROXY`, `INTERN_VAULT_PROXY_PORT`, `INTERN_SKIP_CF_TUNNEL`, `INTERN_SNAPSHOT_SCHEDULE_ENABLED`, `INTERN_MCP_SERVERS_RECONCILE_ENABLED`, `INTERN_SNAPSHOT_SKIP_WORKSPACE_SLUGS`, `SERVICE_NAME`, `INTERN_OTEL_COLLECTOR_IMAGE`, `INTERN_OTEL_COLLECTOR_PORT`, `INTERN_DD_SITE`, `INTERN_VM_REPORT_URL`, `INTERN_VM_MCP_SECRETS_URL`. `INTERN_PREVIEW_INTERN_IDS` is a `[vars]` entry in `wrangler.toml` listing the interns opted into ori's localhost previews; its zod default is empty, so `[env.e2e]` and every unlisted intern keep previews off. `INTERN_TURN_IDENTITY_ENABLED` is a `[vars]` entry set to `"true"` (acting identity on, applied per VM only to a runtime at or past `TURN_IDENTITY_RUNTIME_FLOOR`; its zod default stays `"false"` so `[env.e2e]`, which inherits no top-level vars, keeps the hermetic shape). `INTERN_OTEL_COLLECTOR_IMAGE` is also a `[vars]` entry in `wrangler.toml` as of ORI-1878, on the same terms as the two images below; it was never bound as a secret on the deployed worker, so that move did not hit the var-vs-secret collision either.
- **`INTERN_INVOKE_PUBLIC_KEY`** — a `[vars]` entry in `wrangler.toml`, not a secret: it is the PUBLIC half of the key `cfw-frontend-api` signs dashboard requests with (`INTERN_INVOKE_SIGNING_KEY`), written to each intern's vault sidecar as `ORI_INVOKE_PUBLIC_KEY` once `INTERN_TURN_IDENTITY_ENABLED` is `"true"`. No zod default, like the egress URL below and for the same reason: `[env.e2e]` inherits no top-level `[vars]`. Rotating it needs the fleet refreshed onto the new public key BEFORE the private half changes, because a sidecar refuses a signature it cannot verify rather than falling back to the bearer.
- **`INTERN_VAULT_EGRESS_URL`** — a `[vars]` entry in `wrangler.toml`, not a secret: the vault's origin is a public URL, and the credentials that go with it (`INTERN_VAULT_SIGNING_SECRET`, `INTERN_VAULT_API_KEY`) stay in Infisical. It is one of two `[vars]` names with **no matching zod default** (the other is `INTERN_INVOKE_PUBLIC_KEY` above), deliberately: `[env.e2e]` inherits no top-level `[vars]`, so a default would point the hermetic suite at the production vault. See "Moving a secret into `[vars]`" above for the collision this move can hit — unlike the image pins, this name may already be bound as a Worker secret by the time the change deploys.
- **Optional-everywhere secrets**: `INTERN_DD_API_KEY` — telemetry export is opt-in on this key. It is **bound in prod** (confirmed via `wrangler secret list`, ORI-1878), so the collector sidecar does run on production interns; it stays unset in dev, which is what keeps it unregistered here. Register it once it is confirmed set at this path in dev.
- **E2E-only base-URL overrides**, documented in `env.ts` as staying unset in production: `CF_API_BASE_URL`, `GCP_COMPUTE_API_BASE_URL`, `GCP_STORAGE_API_BASE_URL`, `GCP_ARTIFACT_REGISTRY_API_BASE_URL`.
- **Prod-only overrides.** Infisical **prod** reads return `403 You are not allowed to readValue on secrets` under ordinary developer credentials, so these cannot be confirmed *from Infisical* on a laptop. `npx wrangler secret list --config wrangler.toml` can: it prints the names bound on the deployed worker with no Infisical prod access at all. Re-run it before trusting this classification of the four names:
  - `INTERN_VAULT_API_KEY` — a genuine prod-only override, and **bound in prod**. The vault's admin key: it is presented on `POST /v1/secrets` at provision time and is never written to a VM.
  - `INTERN_VAULT_EGRESS_URL` — **no longer a secret.** It moved into `[vars]` (see the bullet above), because the vault's origin is a public URL and only the two keys beside it are credentials. A Worker secret of that name may still be bound: a deploy never removes one, and a secret written to unblock interns before this moved survives every later release until `wrangler secret delete INTERN_VAULT_EGRESS_URL` runs. Delete it once this change is released, or the name exists as both a var and a secret and which one the Worker resolves is not something wrangler will tell you in advance.
  - `INTERN_RUNTIME_IMAGE`, `INTERN_CLOUDFLARED_IMAGE` — **not secrets**: `[vars]` entries in `wrangler.toml` (#34948 and ORI-1267 respectively); see "Moving a secret into `[vars]`" above. Neither was ever bound as a secret on the deployed worker, so neither move hit the var-vs-secret collision that section describes.

  Note the limit of that instrument. It answers "is this a real prod-only override?" It does **not** answer "should this be registered?" — `validate-infisical-mapping.ts` checks against **dev**, so a name bound in prod but absent from the dev path still buys the permanent false `❌`. Registration stays gated on the name existing at `/services/cfw-intern-provisioner` in dev, exactly as the paragraph above says. The two questions are easy to conflate because one command appears to answer both.

Registering an absent name does **not** fail CI: `validateInfisicalMapping` logs and returns, and `scripts/lint.ts` fails a task only when its promise rejects. `INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` is registered but unset in dev today and lint is green. The cost is misleading output, not a red build.

Do not "fix" that by making the validator throw. It cannot enforce what it appears to: it reads **one** Infisical environment (`dev` by default), it is gated on the diff touching a schema file, and the `lint` job in `ci.yaml` holds no Infisical credentials at all — so the Infisical half returns `null` and is skipped outright in CI. A throw there would fire on developers' laptops for every registered-but-unset name on every path, and never once in CI. That trades honest output for a green check that verifies nothing, which is worse than the misleading output it replaces.

The instrument that *can* answer "is this bound on the deployed worker" is `npx wrangler secret list --config wrangler.toml`, which reads the deployed script with no Infisical prod access at all. It is a command an operator runs, not a gate: wiring it into the deploy workflow would add a way for a production release to fail in order to enforce a security property, which is the wrong trade on a board whose goal is fewer things breaking. Add that gate once the key is actually bound, where it costs nothing.

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
but litter: failed runs leave paid VMs running. What keeps that litter out of
a production census is the `provisioning-source` label (ORI-2252): a local run
stamps `local` on every VM it creates, because `provisioningSourceForDeployment`
claims `production` only on the deployed worker's exact `OR_ENV = "production"`,
and Tilt and `bun run dev` both set `OR_ENV=development`. Never run this worker
locally with `OR_ENV=production` — a bare `wrangler dev` with no `.dev.vars`
inherits exactly that from `[vars]` — because it is the one way a laptop VM
joins `--filter="labels.provisioning-source=production"`. See RUNBOOK.md →
"Rolling the whole fleet". Keep `INTERN_VM_MACHINE_TYPE` small and delete what you
create:

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

A change to what the startup script gives the agent (its env file, the agent unit's `ExecStartPre` lines, `TimeoutStartSec`) or to the tunnel ingress rules is proven on a provisioned intern slot, not by reading the rendered script: `bun run intern:slot up <slot> --provisioned --web-source <this branch's checkout>` renders this branch's script for the slot's own intern, runs its workspace bootstrap and the agent unit's pre-start in order under its budget, starts the agent from its `ExecStart`, and puts this branch's `local-tunnel-edge` in front of it. `restart <slot> --image <ref>` is an image swap. `bun run intern:e2e run provisioned-env` and `catalog-selection` are the committed runs. Everything is in `.agents/skills/local-intern-chat/SKILL.md` ("A provisioned slot") and `.agents/skills/prove-intern-change/SKILL.md`.

## Driving the MCP token refresher locally

`bun run drill:mcp-refresh` (`scripts/local-mcp-refresh-drill.ts`) fires the refresher's own cron through wrangler's `/cdn-cgi/handler/scheduled` and prints what each tick did to the connection row. It runs against either kind of connection:

- **A real one, the default to reach for.** Under `tilt up -- --interns`, connect the stack's `mcp-fake` from the Interns dashboard (`.agents/skills/local-intern-chat/SKILL.md`, "Connecting an MCP server from the dashboard"), then `bun run drill:mcp-refresh --credential <id>`. That row came through the real connect flow: its token endpoint is the fake's public `/token` and its access token is in the local vault. The drill marks it due and leaves it in place, `tilt logs mcp-fake` shows the `refresh_token` mint, and the next `echo` call carries the rotated token.
- **A seeded one, for the failure paths.** Without `--credential` it inserts a row for the seeded local intern, pointed at an in-process `scripts/local-mcp-oauth-fake.ts`, and deletes it afterwards unless `--keep`. `--scenario revoked` is a member revoking the grant (the fake answers `invalid_grant`); `--scenario gone-scope` is a connection scoped to an archived intern, whose vault writes the vault refuses with `Agent is not in workspace`.

The refresher needs a vault, or it answers `no_vault` and the drill shows nothing happening. Under `--interns` the `intern-provisioner` resource is pointed at the local vault (`INTERN_VAULT_EGRESS_URL` and `INTERN_VAULT_API_KEY`, pinned over Infisical), so `tilt trigger intern-provisioner` is enough; it stays manual. Without `--interns` it inherits the production vault's origin from `wrangler.toml` with no key, and the script's header has the three lines that start one against the local vault on a spare port. The drill writes only to the local Postgres (`127.0.0.1:54322`).
