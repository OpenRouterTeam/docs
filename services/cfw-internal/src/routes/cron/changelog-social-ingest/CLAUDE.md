# Changelog social ingest — credentials and operation

`CHANGELOG_SOCIAL_INGEST` (hourly at `:42`, plus the "Check changelogs" button in Mission Control's social-posts page) polls GitHub for SDK releases, the API changelog, merged PRs, and tooling commits, turns the notable ones into draft social posts, and drives the remotion-render service until each has a video.

Everything below is provisioning knowledge that is otherwise only discoverable by reading the code. All of it fails **soft**: a missing or mis-scoped credential produces zero posts and a `wLog` line, never an error the operator sees. That is deliberate (a cron must not fail the worker) but it means *"nothing appeared"* is the symptom of every misconfiguration.

## Infisical path and shared secrets

This worker reads from **`/services/cfw-internal-api`** — not `/services/cfw-internal`. Nothing in the directory name implies this; see the `x` script in `services/cfw-internal/package.json` and `env.manifest.json`.

Secrets auto-sync from Infisical to Cloudflare via `.github/workflows/deploy-cloudflare-worker.yaml`, so a non-empty Production value in Infisical is sufficient — unlike `cfw-api`, which also needs a manual Cloudflare step.

**Do not paste a second copy of a value that already exists elsewhere.** Every credential this task needs is also used by Mission Control. Per `scripts/infisical/INFISICAL.md`, a secret needed by more than one service belongs in `/_shared` (or `/_providers` for provider API keys), with each service folder holding a *reference*:

```text
${dev._shared.MISSION_CONTROL_GH_APP_PRIVATE_KEY}    # Development
${prod._shared.MISSION_CONTROL_GH_APP_PRIVATE_KEY}   # Production
```

The environment prefix must match the environment the reference lives in, so create both — the `x` script runs `infisical run --env=dev`, so a prod-only reference leaves local dev unresolved.

One value, one place to rotate. Duplicated values drift silently — and because these are one-way encrypted in Cloudflare, a stale copy is invisible until the ingest starts failing. `bun run x scripts/infisical/create-env-var.ts` automates the store-and-reference flow; `cli-operations.ts` writes the reference through a temp `.env` file so the `${...}` is not mangled by the shell.

Note `env.manifest.json` intentionally lists no `/_shared` or `/_providers` paths — it records which vars each *service* needs, and a reference satisfies that the same way a literal does.

## GitHub credentials

Resolved **per repo** by `resolve-github-token.ts`, in this order:

| Credential | Reaches |
|---|---|
| GitHub App installation token | only repos in `APP_SCOPED_REPOS` |
| `CHANGELOG_INGEST_GITHUB_TOKEN` (deprecated PAT) | every visible repo |
| none — anonymous | public repos only, 60 req/hr by IP |

The App is preferred (short-lived, ~1h). It is the same App Mission Control's `guide-factory` uses, so the three `MISSION_CONTROL_GH_APP_*` values are shared and should be referenced rather than copied.

**Why per repo, not per run.** An installation token is scoped to the repositories in its installation, and GitHub answers **404 for repos outside that scope even when they are public**. Sending it everywhere would silently regress the public SDK sources, which work anonymously today. Out-of-scope repos therefore fall through to the PAT when one exists, and go anonymous only when none does.

**`APP_SCOPED_REPOS` must match reality.** It currently lists only `OpenRouterTeam/openrouter-web`. If the App is later installed on more repos, add them there or their token keeps being withheld. Adding a repo to `SDK_SOURCES` / `TOOLING_SOURCES` needs no change here — unlisted repos are simply not sent the App token, which fails safe rather than 404ing.

### Private key format

`MISSION_CONTROL_GH_APP_PRIVATE_KEY` is the **base64 of the PEM exactly as GitHub issues it** — no `openssl pkcs8` conversion. GitHub hands out App keys in **PKCS#1** (`-----BEGIN RSA PRIVATE KEY-----`); Cloudflare's WebCrypto — which the Worker signs with, because `jsonwebtoken` is Node-only — imports only **PKCS#8**, so the shared signer wraps PKCS#1 into a PKCS#8 envelope at import time (`packages/helpers/pkcs1-to-pkcs8.ts`, via `@openrouter-monorepo/helpers/github-app`). Both formats work and the stored value never needs re-encoding. The Node `jsonwebtoken` path Mission Control's `guide-factory` uses accepts both formats too.

## Other credentials

- **`OPENROUTER_API_KEY`** — gates notability curation, and gates it hard. Without it only candidates whose notes a human wrote survive (`keepWithoutCurator`), which is hard-coded **false for 3 of the 4 sources**. SDK releases are the exception, and only when the body is *not* Speakeasy-generated (`!isGeneratedReleaseBody`) — but the SDK repos release through Speakeasy, so their bodies are field diffs and get dropped too. Expect ~zero posts with no key, not a degraded trickle. Already used by the arXiv monitor at this path.
- **`OPENROUTER_BASE_URL`** — optional; points local dev at a local cfw-api.
- **`REMOTION_RENDER_URL` / `_AUTH_TOKEN`** — when unset the task still ingests, but posts stay `draft` with no video. Requires the Cloud Run service to be deployed (`apply-cloudrun-terraform` → `remotion-render`, then `deploy-cloudrun-service`).

## Verifying a run

`wrangler tail --name internal`, then click "Check changelogs". The button returns `200` as soon as the run is *enqueued* (`background: true`), so the toast never reflects the outcome — the logs are the only signal.

```text
changelog ingest: github auth resolved
  { mode, app_scoped_repos, out_of_scope_fallback }
changelog ingest: collected events
  { collected, fresh, curated, valid }
changelog ingest: run complete
  { collected, attempted, created }
```

| Symptom | Cause |
|---|---|
| `mode: anonymous` | no App vars and no PAT |
| `github app token mint failed` | bad key (valid base64 PEM?), wrong installation id, or GitHub down |
| `collected > 0` but `curated: 0` | no `OPENROUTER_API_KEY` |
| `collected: 0` + `failed to fetch` | rate-limited, or a repo the credential cannot reach |
| posts created, no video | `REMOTION_RENDER_*` unset or service not deployed |

`env.manifest.json` entries are validated by `validate-infisical-mapping.ts`, which **logs** missing names and returns normally — so a manifest entry without a matching Infisical secret does not fail lint or CI. Do not read green CI as proof the secrets exist.
