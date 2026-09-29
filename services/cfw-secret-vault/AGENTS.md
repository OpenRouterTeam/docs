# Operating cfw-secret-vault

Architecture, module map, and commands live in [`README.md`](./README.md).
This file is the operational reality: who holds the vault's credentials, how
to rotate them (`VAULT_MASTER_KEY` has a zero-outage path and a drain you
have to finish; `VAULT_API_KEY` has no zero-outage path at all — one runbook
each below), and how to diagnose a failure when the vault itself tells you
nothing.

Every credential here has more than one copy, and a rotation that reaches
only some of them fails silently, so the rotation runbooks below are the
highest-value part of this file.

## Public customer vault scope

`/v1/customer-secrets` receives a real workspace UUID in `x-vault-workspace-id` and the owning Clerk entity in `x-vault-entity-id`. The service key gates the route. A primary lookup checks the live workspace, its entity, and any intern's workspace and entity. Writes, deletes, and copying use only that UUID namespace. Metadata lists read both spellings of the scope, the way the dashboard does: a UUID row shadows a legacy row of the same name, the legacy shared vault is read only by the workspace recorded as its owner, and an intern's legacy vault is read once the intern is authorized in the workspace.

`GET /v1/customer-secrets/effective?agent_id=` lists what egress would deliver for the intern, one row per name. It resolves namespaces with `resolveInternVaultNamespaces` and rows with `listEffectiveVaultSecrets`, which share `selectVaultSecretCandidates` with `readHostBoundVaultSecrets`, so the list and egress read one selection. `effective-secrets.integration.test.ts` asks egress for every fixture name and host and fails if the two disagree. Change the candidate query, the ranking, or the exclusion filter only in the shared code.

Existing intern HMACs still bind to the Clerk entity. Egress resolves the
intern's real workspace from Postgres. For each secret name, a row in that
workspace's UUID namespace takes precedence over all legacy rows of that name.
Namespace selection occurs before host checks and decryption. A denial, stale
version, or missing key cannot restore the legacy value.

Names absent from the UUID namespace retain existing internal behavior during
rollout. No legacy org-wide secret is automatically copied into a workspace.
Within the UUID namespace, intern-specific values override workspace-shared
values. Deleting that override restores the workspace value. Deleting all UUID
rows of a name restores the legacy internal behavior for that name.

Intern transfers refuse with `workspace_vault_secrets_present` (409) before any
rows move when that intern has UUID-scoped secret values. UUID writes and
copies lock the intern against transfer until commit. The legacy retenant flow
does not move UUID vaults. Destroy clears intern-specific secrets from both
namespaces, including after archival or workspace deletion; shared secrets stay.

## Shared admin API key copies

The vault authenticates admin callers by comparing the `x-vault-api-key`
request header against its own `VAULT_API_KEY` with a timing-safe compare
(`timingSafeStringEqual`, re-exported from
`@openrouter-monorepo/helpers/crypto`). Every admin endpoint gates on it, and
the single intern-facing door deliberately does not:

| Endpoint | Gate |
|----------|------|
| `GET /v1/secrets` | `VAULT_API_KEY` |
| `POST /v1/secrets` | `VAULT_API_KEY` |
| `DELETE /v1/secrets` | `VAULT_API_KEY` |
| `GET` / `PUT` / `DELETE` / `POST /v1/customer-secrets/**` | `VAULT_API_KEY` plus trusted entity/workspace scope checks |
| `POST /v1/vaults` | `VAULT_API_KEY` |
| `POST /v1/vaults/retenant` | `VAULT_API_KEY` |
| `GET` / `POST /v1/origins`, `POST /v1/origins/transfer` | `VAULT_API_KEY` (`isAuthorized` in `routes/origins.ts`) |
| `ALL /v1/egress` | per-agent HMAC token only — **not** `VAULT_API_KEY` |

`/v1/egress` is the entire intern-facing surface, and it runs
`authenticateAgent` in `src/authenticate.ts`: the HMAC, the agent and workspace
id validation, and the `interns` row lookup that authorises the pair. It is
registered with `.all()` because the agent's own method is the method used
upstream. ORI-1921 deleted the two other doors an agent credential used to
open — the stateful `GET /v1/tunnel` upgrade and `POST /v1/resolve`, which
returned resolved plaintext over HTTP behind the static `VAULT_API_KEY` — so
there is no second implementation of that check left to keep in step.

The Infisical paths below hold the same string under three variable names. Every caller must match the vault’s `VAULT_API_KEY`, which is the authority:

| Infisical path | Variable | Read by | Sent by |
|----------------|----------|---------|---------|
| `/services/cfw-secret-vault` | `VAULT_API_KEY` | `src/env.ts` | — this is the authority |
| `/services/cfw-frontend-api` | `SECRET_VAULT_API_KEY` | `services/cfw-frontend-api/src/env.ts` | `routes/byok/vault-secrets/call-vault.ts` |
| `/services/cfw-intern-provisioner` | `INTERN_VAULT_API_KEY` | `services/cfw-intern-provisioner/src/env.ts` | `clients/vault-secrets.ts` |
| `/services/cfw-intern-api` | `SECRET_VAULT_API_KEY` | `services/cfw-intern-api/src/env.ts` | `src/vault-client/vault-client.ts` |
| `/services/cfw-internal-api` | `SECRET_VAULT_API_KEY` | `services/cfw-internal/src/env.ts` | `src/routes/interns/transfer-intern.ts` |

A second credential is shared the same way and rotates under the same rules:
the vault's `VAULT_SIGNING_SECRET` is mirrored as the provisioner's
`INTERN_VAULT_SIGNING_SECRET`, which derives each intern's per-agent token.
It has only two copies, but a mismatch fails identically — silently, until an
intern makes its first outbound call.

**Rotating one copy without the others breaks the laggards silently.** The
failure surfaces only when someone exercises that path, which can be days
later. Two shapes to check for: a consumer copy written moments before the
vault's own rotation lands is stale from birth, and a partial rotation can look complete when only updated callers are tested.

### Consumers obtain the vault address from different sources

Address changes must reach each consumer’s source below. The provisioner uses a committed variable; the other callers use Infisical.

- **frontend-api** reads `SECRET_VAULT_URL` — a full origin — and
  concatenates: `` fetch(`${vaultUrl}${path}`) ``.
- **cfw-intern-api** reads `SECRET_VAULT_URL` from `/services/cfw-intern-api`. Set the full vault origin. Its client builds `/v1/customer-secrets` paths with `new URL()` and sends the matching `SECRET_VAULT_API_KEY`.
- **cfw-internal** reads `SECRET_VAULT_URL` and `SECRET_VAULT_API_KEY` from `/services/cfw-internal-api`. Its transfer client appends `/v1/vaults/retenant` to the origin.
- **cfw-intern-provisioner** has no `SECRET_VAULT_URL`. It reads
  `INTERN_VAULT_EGRESS_URL`, which is **a `[vars]` entry in its
  `wrangler.toml`, not an Infisical secret** — the origin is public, and the
  credentials beside it (`INTERN_VAULT_SIGNING_SECRET`,
  `INTERN_VAULT_API_KEY`) are what stay in Infisical. So rotating the address
  is a reviewed commit here, not an unlogged edit in a secret store. It is
  **an origin and not a URL with a path**
  (`https://secret-vault.openrouter.workers.dev`), and normalises it through
  `vaultEgressOrigin()` in `clients/vault-secrets.ts`. One value serves two
  consumers: the provisioner builds `${origin}/v1/secrets` for its own admin
  calls, and writes the same origin into the VM's sidecar env file as
  `ORI_VAULT_EGRESS_URL`, where the sidecar appends `/v1/egress` itself.
  A path, query or fragment is **rejected rather than stripped**, and so is
  any scheme but `http:`/`https:` — so a deployment still holding the retired
  `wss://…/v1/tunnel` value fails at the step boundary before a VM exists,
  on either count, instead of provisioning an intern whose egress goes
  nowhere. A stripped value would have reached the VM as a doubled path,
  which the vault logs as `GET /v1/egress/v1/egress 404` — reads as a missing
  route rather than a doubled path, and sends you into the wrong repository.
  Leaving `INTERN_VAULT_EGRESS_URL` **unset** disables vault egress wiring
  entirely OUTSIDE PRODUCTION, which is the pre-vault behaviour and what
  local dev and the hermetic e2e build run on. **In production it is a
  `VaultConfigError`**, surfaced as a `NonRetryableError` at the
  `create-gcp-vm` step boundary: an intern provisioned with no vault carries
  a real `OPENROUTER_API_KEY` and a real `SLACK_BOT_TOKEN` in
  `/etc/<bot>/env`, so "quietly no vault" is the expensive answer there, not
  the safe one. Do not try to disable it by blanking the value: the schema is
  `z.string().min(1).optional()`, so `undefined` is accepted but `''` is
  rejected, and the provisioner's `ensureEnv` *throws* on a vars parse
  failure — an empty string takes provisioning down entirely rather than
  reverting it.

## Cloudflare secrets are write-only, and a deploy never removes one

Two platform facts to internalise before you plan any rotation.

**Nobody can read back what a worker currently holds — not even an admin.**
`wrangler secret list` and the underlying
`/accounts/:id/workers/scripts/:name/secrets` API return binding *names* and
types, never values. This is why the curl probe below matters: it is the
only way to answer "does the vault hold the key I think it holds" without
read access to any secret store.

**Deleting a value from Infisical does not delete it from the worker.**
Workers deployed through `wrangler versions upload` inherit every unchanged
secret from the previous version — wrangler's `versionsUpload` hard-codes
`keepSecrets: true`, commented in its own source as "we never delete secret
bindings when uploading, even if we are setting secrets from a file / so
inherit all unchanged secrets from the previous Worker Version". Verified in
wrangler `4.107.0`, the version this repo's catalog pins.

The consequence is blunt, and for a secrets service it needs saying:
**rotating a key and retiring a key are different operations, and the second
one is not automatic.** A credential removed from Infisical persists on the
worker until someone explicitly removes it, and because secrets are
unreadable, an operator who assumes the next deploy cleaned it up has no way
to discover they were wrong.

The vault and its consumers ship through
`.github/workflows/deploy-cloudflare-worker.yaml`, which uses `wrangler
versions upload` followed by `versions deploy` — but not in the same mode, and
the mode decides whether a release can skip the deploy. `cfw-frontend-api` and
`cfw-intern-provisioner` run the split flow (`mode: build-upload`, then a
separate `mode: deploy` job), which is where the bundle-changed fingerprint can
skip. `cfw-secret-vault` runs the workflow in its default
`build-upload-deploy` mode as a single job, and the fingerprint check does not
run in that mode at all, so every release deploys it.

`cfw-secret-vault` deployed through `deploy-cloudflare-container.yaml` behind a
`skip-if-unchanged: true` gate until ORI-1921. That gate existed for one
reason: the worker carried a Cloudflare Container and two Durable Objects, and
every deploy reset them and dropped every live intern tunnel. Nothing on the
request path is stateful now — a deploy replaces isolates and the next request
is served by a new one — so the gate is gone from `release.yaml` and
`hotfix.yaml` rather than left suppressing deploys for a reason that no longer
holds.

### The retired root-CA secrets are still bound, and only a person removes them

ORI-1921 deleted the shared root CA. `ROOT_CA_CERT` and `ROOT_CA_KEY` are gone
from `src/env.ts`, `INTERN_VAULT_ROOT_CA_CERT` is gone from the provisioner's
schema, and all three are gone from `env.manifest.json` — and all three are
still bound on the deployed workers, because nothing in a deploy removes a
binding. `ROOT_CA_KEY` is a CA private key that no code reads and no agent
verifies against any more. Delete them by hand, once:

```sh
npx wrangler secret delete ROOT_CA_KEY \
  --config services/cfw-secret-vault/wrangler.toml
npx wrangler secret delete ROOT_CA_CERT \
  --config services/cfw-secret-vault/wrangler.toml
npx wrangler secret delete INTERN_VAULT_ROOT_CA_CERT \
  --config services/cfw-intern-provisioner/wrangler.toml
```

Then prove it, because secrets are unreadable and nothing else will tell you:

```sh
npx wrangler secret list --config services/cfw-secret-vault/wrangler.toml
npx wrangler secret list --config services/cfw-intern-provisioner/wrangler.toml
```

Neither `ROOT_CA_KEY` nor `ROOT_CA_CERT` may appear in the first listing, and
`INTERN_VAULT_ROOT_CA_CERT` must not appear in the second. Removing them from
Infisical — already done — changes nothing on either worker.

The same rule made the `INTERN_VAULT_TUNNEL_URL` → `INTERN_VAULT_EGRESS_URL`
rename two operations rather than one, and it still governs the cleanup.
`INTERN_VAULT_EGRESS_URL` now ships as a `[vars]` entry in the provisioner's
`wrangler.toml`, so nothing has to be written in Infisical for a release to
carry the origin — but any Worker secret of **either** name stays bound until
`wrangler secret delete` removes it, including one written to unblock interns
before the var landed. Delete both once the release is out, or the live name
exists twice with no way to see which one the Worker resolves.

That rename failed in the quiet direction, and that is the hole this closed:
an unset `INTERN_VAULT_EGRESS_URL` read as "this deployment has no vault", so
the provisioner wired no egress at all and every intern provisioned in the gap
came up without it, with nothing failing anywhere. It is a `VaultConfigError`
in production now — `buildVaultProvisioning` fails closed, and
`create-gcp-vm` raises it as a `NonRetryableError` — so the same gap costs one
visibly failed provision instead of a VM holding real credentials.

### The retired container application is a separate resource, and nothing in the deploy removes it

The `v3` migration deletes the two Durable Object classes and dropping `[[containers]]` stops the container from being deployed, but neither removes the **container application**, which is an account-level resource separate from both. In wrangler `4.107.0` the only callsite of the delete-application API in the entire CLI bundle is the `wrangler containers delete` command itself — the deploy path applies the containers *present* in the config and returns early when there are none — so no release will ever clean this up. Whether Cloudflare's control plane garbage-collects an application once the Durable Object namespace it points at is deleted is **unverified**: the [containers command reference](https://developers.cloudflare.com/workers/wrangler/commands/containers/), the [container lifecycle page](https://developers.cloudflare.com/containers/platform-details/architecture/) and the [Durable Object migrations page](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) are all silent on it. So treat it as manual, and check the account after the deploy that lands `v3` — the same pass as the `wrangler secret delete` calls above:

```sh
# `containers delete` takes an ID and not a name, so list first. Look for
# `secret-vault-agentcontainer`, the name wrangler derives from the worker name
# and the class when `containers.name` is unset.
npx wrangler containers list --config services/cfw-secret-vault/wrangler.toml
npx wrangler containers delete <ID>
```

The image in the managed registry has its own listing again (`npx wrangler containers images list`). Neither is obviously costing anything — [pricing](https://developers.cloudflare.com/containers/pricing/) charges from the request that starts an instance until it sleeps, and says nothing about an application with no instances — so the reason to clear them is that they hold names and misrepresent what the account runs, not spend.

### This stack must land on a release, and no hotfix may run before it

The other direction of the same problem: not what a deploy fails to remove, but what a deploy ships on its own.

The vault and the provisioner are two halves of one contract. This stack changes both — the vault stops serving `/v1/tunnel`, and the provisioner stops writing it — so they have to go out together. `release.yaml` deploys both. **`hotfix.yaml` had no `cfw-intern-provisioner` job when this stack landed** (ORI-1874 added one, ordered after `migrate-prod`), and it deploys every service it lists on every run, so any hotfix taken from a `main` that carried this stack before that job existed shipped the stateless server half while production provisioning was still writing the old client half.

So, in order:

1. Merge the stack.
2. Run a **release** — the one that deploys `cfw-secret-vault` and `cfw-intern-provisioner` together.
3. Run no hotfix between 1 and 2.

The window is bounded and closes at step 2. It is worth respecting inside that window because the failure is silent in both of the ways that matter. Freshly provisioned interns are the victims, not the ones already running: existing interns breaking is the accepted cost of this migration, and reprovisioning is the documented recovery for it. But an intern provisioned in this gap comes up with **no egress at all** and nothing errors anywhere — the rename fails in the quiet direction, as "The retired root-CA secrets are still bound, and only a person removes them" above sets out, so an unset `INTERN_VAULT_EGRESS_URL` reads as "this deployment has no vault". That is what makes it expensive: it removes reprovisioning as the recovery, because reprovisioning is what produces the broken intern.

The silent half of that is fixed: the origin now ships in the provisioner's `[vars]`, and an unset value in production is a `VaultConfigError` rather than "no vault", so a deployment in that state fails the provision visibly instead of handing a VM real credentials. The sequencing above still stands — a release that carries only one half of the contract is still a broken contract, it just announces itself now.

Do not reach for `skip-if-unchanged: true` on the vault's hotfix job as the guard. It is an input of `deploy-cloudflare-container.yaml`, and since ORI-1921 that job calls `deploy-cloudflare-worker.yaml`, which does not define it — actionlint fails the workflow rather than ignoring the key. It would not close this window either: the gate skips only when the vault's bundle and working directory are both unchanged, and in exactly this window the vault has changed, so it would deploy.

### Schema-dependent vault code waits on `migrate-prod` in both workflows

The host-policy stack (ORI-1874) reads `agent_vault_secrets.hosts` on every
egress lookup, and the column arrives with
`postgres/migrations/20260916171000_add_vault_secret_host_policy.sql`. The
audit log's `source` CHECK admits `customer-api` only after
`postgres/migrations/20260916171010_add_customer_api_vault_audit_source.sql`,
and every public-route write inserts that source. A vault deployed ahead of
either migration fails on every egress lookup or every customer write until
the migration runs or the vault is rolled back.

Both `release.yaml` and `hotfix.yaml` order `deploy-cfw-secret-vault` after
their own `migrate-prod` job, so neither path can ship the reader before the
schema. The hotfix `migrate-prod` is a copy of the release one (same runner
class, same `db-migrate` service account, same `scripts/db-migrate-gcp.ts`),
and it runs every pending migration on `main`, not only the vault's. Keep the
two jobs in step when either changes, and do not add a vault-schema-dependent
consumer to `hotfix.yaml` without the same `needs: [..., migrate-prod]` edge.
`deploy-cfw-internal` and the ORI-1874 `deploy-cfw-intern-provisioner` job
carry that edge in `hotfix.yaml` too: both read Postgres through
`packages/db`, and the internal transfer refusal and the provisioner destroy
purge query the workspace UUID vault namespace.

### Public vault writes open by gate, after the compatible fleet is live

A secret written through `PUT`/`DELETE /api/v1/vault/**` or
`POST .../secrets/copy` on `cfw-intern-api` lands in the workspace UUID
namespace. Three other workers must already understand that namespace before
the first such write exists:

- `cfw-secret-vault`, which serves the customer-secrets contract and prefers
  the UUID row on egress.
- `cfw-internal`, whose transfer path refuses with
  `workspace_vault_secrets_present` when an intern holds UUID-scoped values.
  The previous transfer code moves the intern and leaves those rows behind
  under the old workspace, so the secret silently stops resolving.
- `cfw-intern-provisioner`, whose destroy cleanup purges the intern's UUID
  namespace. The previous cleanup only knows the entity namespace and orphans
  the UUID rows.

Neither workflow can prove that from job status. `release.yaml` and
`hotfix.yaml` now order `deploy-cfw-intern-api` after `deploy-cfw-secret-vault`,
`deploy-cfw-internal` and `deploy-cfw-intern-provisioner`, which fixes the
order the deploys run in. It does not establish that the new versions serve
all traffic: the vault and intern-api deploy jobs are nursery jobs
(`continue-on-error`), a failed vault deploy therefore still lets the API job
run, a skipped `deploy-cfw-internal` or provisioner job means "bundle
unchanged" rather than "verified live", and a worker deployed with a nonzero
`rollout-step-size` (the release inputs, applied to the workers that opt in)
can sit at a partial split with the old version still serving.

So the write routes carry their own gate, `ori-vault-write-api` in
`packages/feature-flags-edge/worker-gates.ts`, default `false`. While it is
closed, or while a cold isolate has no ruleset yet, every write answers `503
Vault writes are not enabled` before any parsing, database lookup or vault
call, and `GET` metadata reads stay open. `internsGateMiddleware` still runs
first, so a caller outside `ori-code-api` sees 404 as before. The gate is
never flipped by a workflow. The supported sequence is:

1. Merge, then let `migrate-prod` apply the two ORI-1874 migrations (a hotfix
   runs it too).
2. Deploy `cfw-secret-vault`, `cfw-internal` and `cfw-intern-provisioner` on
   the same release or hotfix. Confirm each worker's live version is the one
   built from that commit and serves 100% of traffic:
   `npx wrangler deployments status --config services/<worker>/wrangler.toml`
   lists the active version split, and `npx wrangler versions list` shows
   each version's tag, which the deploy workflow sets to the short commit
   SHA. A nursery job's green check is not this confirmation.
3. Deploy `cfw-intern-api` (same train, ordered after the three above) and
   confirm `GET /api/v1/vault/secrets` answers 200 for an enabled key.
4. Open `ori-vault-write-api` in Statsig for the callers who should write,
   the same way `ori-code-api` is administered. The cfw-internal warmer syncs
   the ruleset into `KV_LIVE_CONFIG`; isolates pick it up on their next
   refresh without a deploy.

Closing the gate does not stop writes at once, and it never authorizes a
lifecycle rollback. The ruleset reaches an isolate through three 60 s stages
(warmer cron, KV edge cache, the in-isolate TTL in
`packages/feature-flags-edge/worker-statsig-ruleset.ts`), an isolate whose KV
read fails keeps serving its last cached ruleset for as long as KV stays
down, and `vaultWriteGateMiddleware` reads the gate once per request, so a
write admitted before the closure landed still runs to commit. A 503 sampled
from each deployed version proves only that the sampled isolates refreshed,
and a quiet audit log does not exclude a write whose transaction is still
open.

So the rule after the gate has been opened once is: the compatible
`cfw-secret-vault`, `cfw-internal` and `cfw-intern-provisioner` versions stay
deployed, and problems are fixed forward. Closing `ori-vault-write-api`, or
redeploying `cfw-intern-api` to a version without the `/api/v1/vault` routes,
stops new admission and is the right first move for an API-side incident. It
does not authorize rolling the three lifecycle workers back: a build without
the UUID guard or purge misplaces or orphans the secrets of every intern that
already holds UUID rows, and nothing here removes those rows. Such a rollback
needs a proven storage-level write fence plus a reconciliation procedure for
the rows written in the meantime. Neither exists in this PR, and this file
does not describe one.

Local dev opens the gate through
`services/cfw-frontend-api/scripts/seed-worker-gates.ts` alongside
`ori-code-api` and `ori-chat-api`.

### Infisical syncs to the worker outside the deploy, and it can be blocked

Secret sync is not a deploy step. It is Infisical's own push to Cloudflare,
which means a rotation can land without any release — and can also fail to
land while every release stays green.

`deploy-cloudflare-worker.yaml` documents the trap in its own comments:
Cloudflare **blocks secret modifications when the latest uploaded version
is not the deployed version**, which breaks Infisical auto-sync for the
affected worker. The workflow works around it by deleting an unchanged
uploaded version, and, failing that, by promoting it (`versions deploy`) so
that `latest == deployed`. `cfw-intern-provisioner` is on the explicit
fallback list for this, alongside `cfw-image-api` and `cfw-mcp`.

So "I rotated it in Infisical" is not evidence the worker received it.
Verify.

### Prod writes go through the Infisical web UI only

`infisical secrets set` performs a read before it writes, and prod denies
reads — it always returns `403 You are not allowed to readValue on secrets`
(see "`INTERN_VAULT_API_KEY` is deliberately unregistered" below, which records
the exact error). The CLI is therefore not an option for any prod value, no
matter how the command is shaped. **Use the web UI.** People lose an hour to
this; it looks like a permissions bug and it is not.

It is also why every rotation in this file is manual. No unattended job can
install a prod secret while programmatic reads return `403`, so automating one
starts with an Infisical machine identity holding prod write scope — a security
decision, not an engineering one.

## Rotating `VAULT_MASTER_KEY`

The master key rotates through the re-wrap path ([ORI-1320]). It is a
sequenced procedure with one unrecoverable step, not a value swap. **The
runbook after this one is for `VAULT_API_KEY`. Do not read the two as
interchangeable.** That one trades a short outage for simplicity; this one
has no outage window at all, and pays for it with an overlap you have to
drain and then explicitly end.

[ORI-1320]: https://linear.app/openrouter/issue/ORI-1320/build-the-vault-master-key-re-wrap-path

Two things make it possible. The vault accepts a second key,
`VAULT_MASTER_KEY_PREVIOUS`, validated by exactly the same schema as
`VAULT_MASTER_KEY` and optional outside a rotation. And a stored vault key
names the key that sealed it: `agent_vaults.encrypted_key` at
`envelope_version = 2` is `<kid>.<base64 ciphertext>`, where `kid` is the
first eight bytes of SHA-256 over the master key's decoded bytes, base64url
(`deriveMasterKeyId` in `src/master-key.ts`). The vault resolves a row by its
`kid` rather than by trying keys in turn, which means **"how many rows are
still on the old key" is a SQL question, answerable with no key material in
hand.** That query is the primary retirement gate below.

Mind that two different base64 alphabets sit side by side in that envelope.
The **key** env vars must be *standard* base64 — `VaultMasterKeySchema`
rejects the URL-safe alphabet outright, because `atob` does — while the `kid`
prefixed onto the ciphertext is *base64url*, precisely so it cannot
contain the `.` used as the delimiter. Generate a key with
`openssl rand -base64 32`; if a key you were handed contains `-` or `_`, it is
in the wrong alphabet and the vault will refuse it at boot rather than
silently accept a different key.

Version 1 and NULL rows carry no `kid`, so they can be counted by version but
not by key. They still open — both keys are tried, and a wrong key fails the
Poly1305 tag rather than returning garbage — and every re-wrap writes version
2, so that population only shrinks.

Secrets themselves are untouched by any of this. `agent_vault_secrets.cipher`
is sealed under the *vault* key, never the master key, so its envelope stays
at version 1 and a master-key rotation never rewrites a secret row.

### Lazy re-wrap is a safety net, not the drain

`putSecret` re-wraps a vault key when it notices the row is not on the current
key (`classifyVaultKeyRewrapNeed` in `src/secret-store/vault-crypto.ts`, the
one predicate the lazy path and the backfill share). Nothing else does.
`getSecrets` — the high-traffic path, and the only one most vaults ever take
after onboarding — deliberately never re-wraps.

So a vault whose secrets were written once at provisioning and only read since
will **never** re-wrap lazily, however much traffic it serves. An operator
told to "wait for lazy re-wrap to drain the rotation" waits forever. **The
backfill script is the drain.** Lazy re-wrap only stops actively-written
vaults from accumulating while you get to it.

### Never start a second rotation before the first has drained

The keyring holds exactly two entries. Rotate A→B, then B→C before the A rows
are gone, and every remaining A row is sealed under a key the vault no longer
holds. Nothing recovers it in place: lazy re-wrap cannot open those rows
either, and the backfill can only report them as `unresolvable`.

The same arithmetic is why a rollback is a rotation and not an undo — step 1.

### Once a version 2 row exists, rolling the worker back is an outage

Envelope version 2 arrives with the *deploy*, not with the rotation. From the
moment [ORI-1320] is live every vault created or re-wrapped is written at
version 2, and the build before it accepts version 1 and the unversioned NULL
rows, nothing else: `decryptVaultKey` in `src/secret-store/vault-crypto.ts`
refuses a version 2 row outright with `Unsupported vault envelope version 2`,
before it looks at a key at all. So a `wrangler rollback`, a `wrangler
versions deploy` back to the prior version, or just an old isolate still
serving during the deploy window, cannot open those vaults at all — and every
write since the deploy has been minting more of them.

Nothing is lost. The rows are intact and the current build still reads them,
so **the remedy is to roll forward, and only forward.** Redeploy the current
version and the affected vaults read again.

The trap is what it looks like while it is happening. Unreadable vaults
present as a key problem, and the instinctive fix — try the other master key,
put something else in `VAULT_MASTER_KEY` — is a rotation, started while a
whole generation of rows is stranded behind a version check. That is how a
recoverable outage becomes the permanent kind above. **Do not touch either
key.** The monitors will not talk you out of it either: `master_key_decrypt`
has no call sites in the build you rolled back to, so
`master_key_decrypt{key:unknown}` stays silent through the entire event. The
symptom is caller-side — see "Diagnosing from the caller's logs".

### Steps, in order

1. **Deploy the outgoing key as `VAULT_MASTER_KEY_PREVIOUS` first, and
   confirm it landed, before `VAULT_MASTER_KEY` changes at all.**
   `/services/cfw-secret-vault` → `VAULT_MASTER_KEY_PREVIOUS`, set to the
   value `VAULT_MASTER_KEY` currently holds.

   Backwards, this is not a slower rotation, it is an outage: a vault holding
   only the new key cannot open a single existing envelope. And the
   instinctive fix makes it permanent. Putting the old key back into
   `VAULT_MASTER_KEY` strands every vault created or re-wrapped during the
   gap, because those rows are sealed under the new key and the new key is by
   then nowhere in the keyring. **A rollback is itself a rotation**: the key
   you are rolling back *from* has to become `VAULT_MASTER_KEY_PREVIOUS`.

2. **Write the new key, then verify the worker received both.**
   `/services/cfw-secret-vault` → `VAULT_MASTER_KEY`.

   ```sh
   npx wrangler secret list --config services/cfw-secret-vault/wrangler.toml
   ```

   Both names must appear. Do not skip this on the grounds that Infisical
   shows the right values — "I rotated it in Infisical" is not evidence the
   worker received it, for the reasons in the sync section above. Cloudflare
   secrets are unreadable, so this proves the bindings exist and nothing more;
   the *values* are proven by step 3 running clean and by step 5.

3. **Run the backfill. This is the drain, not a cleanup pass.**

   ```sh
   cd services/cfw-secret-vault
   bun run x scripts/rewrap-vault-keys.ts           # dry run — writes nothing
   bun run x scripts/rewrap-vault-keys.ts --apply   # writes
   ```

   `--dry-run` is the default, so the first form is safe to run at any time,
   including outside a rotation — there it reports the legacy (version 1 and
   NULL) rows that a re-wrap would also lift to version 2.
   `--limit=N`, `--batch-size=N` (1–1000, default 200) and `--workspace-id=ID`
   bound a run; it is idempotent and resumable, so an interrupted run just
   leaves work for the next one. Exit code 0 means a clean drain, 1 means rows
   were left unresolvable or errored, 2 means it refused to run.

   **`bun run x` pins `--env=dev`** (see the `x` script in `package.json`), so
   that invocation drains the *dev* database and prints a perfectly clean
   summary while production is untouched. A production drain is:

   ```bash
   cd services/cfw-secret-vault
   infisical run --env=prod --path=/services/cfw-secret-vault \
     --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
     -- tsx scripts/rewrap-vault-keys.ts --apply
   ```

   Ordinary developer credentials get `403` on prod reads, and a swallowed
   `403` looks exactly like "no secrets configured" — see the
   `INTERN_VAULT_API_KEY` section below. Confirm the run is pointed where you
   think before trusting its counts.

   Before it touches anything the script samples 25 candidate rows and tries
   to open each. It refuses to `--apply` if **any one** of them carries no key
   id and did not open (`isKeyringUnusable` in the script) — not if none
   opened. A row with no key id predates version 2, so it was sealed under
   whichever single master key was current then, and one of the two configured
   keys should open it. One that does not is a fact about the keyring, and the
   script will not trade it for 24 successes elsewhere in the sample. A row
   that *does* carry a key id names the key it wants, which is a fact about
   the data: it never blocks, and the run reports it as `unresolvable`
   instead.

   That asymmetry is the point, not strictness for its own sake. Counting the
   sample instead — refuse only when nothing opened — gets it backwards at the
   tail of a *successful* rotation, where the only rows left are stranded
   version 2 ones no key opens, and would refuse there while blaming a
   previous key that is set and correct.

   The refusal is the cheap catch for step 1 done wrong. A dry run prints the
   same warning and continues, since it writes nothing — which is also how you
   work out whether it is the keyring or one bad row, below.

4. **Confirm `remaining: 0` *and* `unresolvable: 0`.** Both, not either —
   `remaining` alone will report a finished drain when it is not one.

   Read these off an `--apply` run. A dry run labels the same counter
   `would-remain` and prints a `DRY RUN — NOTHING WAS WRITTEN` banner, because
   the number is a post-apply prediction: a dry run against a full backlog
   still says zero, and mistaking that for a completed drain is how the
   previous key gets retired while it is still sealing live rows.

   The run prints `scanned / re-wrapped / skipped / unresolvable / failed /
   remaining`, plus the current key id.

   - `remaining` is rows still off the current key, **excluding the ones this
     run proved no key can open.** That exclusion is deliberate — without it
     an unresolvable row would pin `remaining` above zero forever and the
     retirement gate could never clear — but it means **`remaining: 0` with
     `unresolvable: 3` is not a drained vault.** It is a drain that walked
     past three rows nobody can open.
   - `unresolvable` counts rows no configured key opens. That is a keyring
     problem, not a sweep problem: a third-key row from an overlapping
     rotation, or a `VAULT_MASTER_KEY_PREVIOUS` that is not the key you think
     it is. Re-running will not move it. Find the key those rows want, or
     re-seed those vaults from source, before going further — and **do not
     proceed to step 7 under any circumstances.** Each one is logged as
     `vault_key_rewrap_unresolvable` with `vault_id` and `workspace_id`.
   - `failed` is transient database errors. Those rows are untouched and stay
     counted in `remaining`; re-run to retry them.

   Exit code 1 covers `unresolvable > 0` or `failed > 0`, so a scripted check
   can gate on the exit status rather than on parsing the summary.

5. **Confirm `openrouter.vault.master_key_decrypt{key:previous}` is zero —
   and that the metric is arriving at all.**

   The second half is not pedantry. A zero reading from a pipeline nobody has
   confirmed is indistinguishable from a working drain, and it fails in the
   reassuring direction. Query the metric grouped by `key` so both series are
   on screen:

   ```
   sum:openrouter.vault.master_key_decrypt{service:cfw-secret-vault} by {key}
   ```

   `key:current` must be *non-zero* over the window. That is the proof the
   pipeline delivers. If both series are empty you have learned nothing about
   the drain — fix the metric path, or retire on the row count in the next
   section alone and say out loud that you did.

6. **Wait out the ciphertext cache before you retire anything.** The backfill
   drains Postgres, and a clean row count says nothing about KV. `rewrap-vault-keys.ts` runs under `tsx` in a plain Node process with no KV binding, so it structurally cannot purge the vault-scope entries it invalidates — a warmed entry written before the backfill still holds an envelope sealed by the OUTGOING key, and it stays readable only while that key is configured. So after the backfill reports clean, wait at least `VAULT_CACHE_TTL_SECONDS` (one hour, `secret-store/vault-ciphertext-cache.ts`) before step 7. Retiring the key inside that hour makes every warmed vault unreadable until its entry expires, and the symptom is a decrypt failure on a vault the backfill just reported as drained.

   The lazy re-wrap in `putSecret` does purge, so this applies to the backfill path only. There is no flush and no way to enumerate warmed entries; the TTL is the whole instrument.

7. **Only then remove `VAULT_MASTER_KEY_PREVIOUS`** — and remove it from the
   worker, not just from Infisical:

   ```sh
   npx wrangler secret delete VAULT_MASTER_KEY_PREVIOUS \
     --config services/cfw-secret-vault/wrangler.toml
   ```

   Deleting it from Infisical alone leaves it live on the worker (see above),
   which is harmless but means the rotation is not actually finished and the
   next one starts from a state nobody has described.

### The preflight refuses on one bad row, and there is no override

Because the rule is per row, a single unopenable no-kid row stops a global
`--apply` with exit 2 before it writes anything. There is no force flag.
`--limit` does not reach the preflight — that always samples 25, before the
drain starts — and the sample is deterministic: the 25 lowest `id`s among
candidates, which with a `uuidv7` primary key means the 25 oldest, which is
exactly where the legacy rows are. Re-running gives you the identical refusal.

**First, tell the two causes apart.** The refusal line already does it: it
prints how many of the sampled rows carry no key id and failed to open. A
wrong keyring fails every legacy row it touches, so that count runs up to the
size of the sample. One or two against a sample that otherwise opened is not a
mis-sequenced rotation, it is a specific row — a corrupt envelope, or one
sealed under a key generation older than both of the two you hold.

**Then name the rows.** The dry run does not refuse; it walks past the warning
and classifies the whole candidate set, logging one
`vault_key_rewrap_unresolvable` per row it could not open, with `vault_id`,
`workspace_id` and `current_key_id`. Those are warnings, so the default log
level already prints them. The drain walks the same predicate in the same
`id` order the sample used, so `--limit=25` classifies exactly the rows the
preflight looked at and nothing else.

Or read the same rows out of Postgres. The summary prints the current key id;
the predicate below is the script's own, using `^@` rather than `LIKE` because
a base64url key id can contain `_`, which `LIKE` reads as a wildcard:

```sql
SELECT id, workspace_id, envelope_version
FROM agent_vaults
WHERE envelope_version IS DISTINCT FROM 2
   OR NOT (encrypted_key ^@ '<current key id>.')
ORDER BY id ASC
LIMIT 25;
```

**Then work around it, because nothing else will.** `--workspace-id` narrows
the preflight sample as well as the drain, and it is the only lever the script
has. Group the same predicate to get the affected workspaces:

```sql
SELECT workspace_id, count(*)
FROM agent_vaults
WHERE envelope_version IS DISTINCT FROM 2
   OR NOT (encrypted_key ^@ '<current key id>.')
GROUP BY 1
ORDER BY 2 DESC;
```

Then run `--apply --workspace-id=…` for each workspace that does not hold a
blocking row. The one that does stays blocked: its sample is the 25 lowest
`id`s *within that workspace*, so unless it has 25 openable candidates ahead
of the bad row, `--apply` refuses there too. Those vaults keep the old
envelope until the row itself is dealt with — find the key that opens it, or
re-seed the vault from source, exactly as for `unresolvable` in step 4.

A drain assembled workspace by workspace with one workspace skipped has not
drained. Step 6 stays off the table until it has, and the row count in the
next section is what proves it, since it counts every row rather than the ones
you got to.

### Retiring the previous key is an observable condition, not a judgement call

Two independent instruments gate step 7, and **neither is sufficient alone**.
Both read Postgres, so neither says anything about the ciphertext cache — that
is what step 6's wait is for.

**Primary — the stored row count.** It reads what is actually on disk and
cannot silently report a false zero: the query either returns a number or it
errors. Run it yourself rather than taking the backfill's `remaining` for it —
partly because a sweep grading its own homework is one instrument and not two,
and partly because `remaining` excludes unresolvable rows by design (step 4)
while this counts every row that is not on the current key:

```sql
SELECT
  envelope_version,
  CASE WHEN envelope_version = 2
       THEN split_part(encrypted_key, '.', 1) END AS kid,
  count(*)
FROM agent_vaults
GROUP BY 1, 2
ORDER BY 3 DESC;
```

Anything that is not `(2, <current kid>)` still needs re-wrapping. The backfill
prints the current key id in its summary, so you can read this without
deriving the `kid` yourself.

**Secondary — the `key:previous` counter.** It reads what live isolates are
actually doing, which the row count cannot see. A clean table still leaves open
the possibility that an isolate is holding an older secret set and decrypting
under the previous key; only the counter shows that.

The two fail in opposite directions:

- **The counter alone reads zero when it should not.** A metric pipeline that
  is silently down reads zero forever, and so does a vault nobody has read
  lately — a cold vault still sealed under the old key emits no `key:previous`
  precisely because nothing opened it. Silence is not a drain.
- **The row count alone is a point-in-time snapshot of storage.** It says
  nothing about what is running, and nothing about a row written a moment
  later by an isolate on a stale deploy.

They answer different questions, so a disagreement is information rather than a
contradiction: a clean table with a live `key:previous` means work is still
arriving from somewhere; a dirty table with a silent counter means cold rows
nobody has touched. Neither state is safe to retire from. Retire only when the
count is zero and the counter is zero *and* `key:current` proves the counter is
being delivered at all.

### The vault checks the key's shape, not whether it is the right key

`src/master-key.ts` requires standard base64 decoding to exactly 32 bytes and
fails `ensureEnv` at boot otherwise, so a truncated or mis-pasted key takes
the service down loudly instead of serving reads and failing the first write.
`VAULT_MASTER_KEY_PREVIOUS` goes through the same schema, so a mis-pasted
outgoing key fails at boot rather than at the first decrypt that needs it.

It cannot catch a well-formed *wrong* key — that boots clean and then decrypts
nothing. That caveat is what makes the rest of this section honest: every
verification step above is an observation of behaviour, not of the value,
because the value cannot be checked.

### Monitors

Two Datadog monitors watch this path, both in
`configs/terraform-monitors/monitoring/vault_master_key_rewrap.tf` and both
routed to `#test-slack-messages` until they have proven they are not noisy:

- `openrouter.vault.key_rewrap{outcome:failure}` — a re-wrap failed, so the
  rotation has stopped draining. Read the `reason:` tag before anything else:
  the re-wrap `UPDATE` runs inside the caller's `putSecret` transaction, so a
  failure at that write aborts the caller's write with it and that request got
  a 500. A failure raised earlier is isolated and the secret still landed.
- `openrouter.vault.master_key_decrypt{key:unknown}` — a live isolate cannot
  open a stored vault key with any key it holds. This is the rotation's real
  alarm, and it is user-visible immediately. It is what fires if
  `VAULT_MASTER_KEY_PREVIOUS` is removed too early or an isolate is holding a
  stale key.

### The other key tier rotates differently

Two key tiers live in this service and their procedures do not transfer.
`VAULT_MASTER_KEY` is this section. `VAULT_API_KEY` and `VAULT_SIGNING_SECRET`
are the runbook below.

There is no third tier. This service held a root CA and minted intermediates
from it until ORI-1921; it now signs nothing. Each intern's `ori vault-tunnel`
sidecar mints its own CA at boot, on its own VM, and keeps it on root-owned
disk for that VM's lifetime, so no key is shared between two interns and none
of it is reachable from here. **Rotating an intern's certificate is a VM
reprovision**, carried out on the intern rather than on this worker; nothing in
this service can move it, and there is no fleet-wide CA operation left to
perform.

## `VAULT_API_KEY` rotation runbook

**Rotation is not seamless, and it cannot be made seamless today.** Every
gated endpoint compares the presented header against exactly one
`VAULT_API_KEY` (`routes/secrets.ts`, `routes/origins.ts`, `routes/customer-secrets.ts`, and `routes/vaults.ts`). There is no
previous-key grace period, so *every* ordering has a window in which one
side is rejected:

- **consumers first** — they present the new key to a vault that still holds
  the old one;
- **vault first** — it holds the new key while the consumers still present
  the old one.

The only questions are which side is broken and for how long. Plan for the
outage rather than trying to avoid it. If you are reading this because
someone reported 401s during a rotation: that is expected behaviour, not a
separate bug to chase.

### What breaks during the window

Every consumer fails closed. Recovery differs by caller.

| Caller | Symptom | Recovers by itself? |
|--------|---------|---------------------|
| `cfw-frontend-api` | vault answers `401` → `callVault` returns `vault_unauthorized` → the route answers **`502`** with `{"code":"vault_unauthorized"}`. The Credential Vault page fails to load. | **Yes** — the next request after the window closes succeeds. |
| `cfw-intern-provisioner` | vault answers `401` → `isNonRetryableVaultStatus(401)` is true → `NonRetryableClientError` → the provisioning step fails **non-retryably**. | **No** — it does not retry through the window. The provision or teardown must be re-run by hand. |
| `cfw-intern-api` | The private vault answers `401`; the public route returns **502** with `Vault request failed`. | The next customer request can succeed after all copies match. Failed writes need a caller retry. |
| `cfw-internal` | The vault step of an intern transfer fails after a `401`. | Resume the transfer after the key copies match. |

That asymmetry is the whole timing argument: a page that fails to load heals
itself, a provisioning run that lands in the window is dead and stays dead.
**Rotate when intern provisioning, teardown, and transfers are quiet.** Customer vault requests can also fail during this window.

One consolation on the provisioner side: vault seeding runs *before*
`createComputeInstance` (documented in `clients/vault-secrets.ts`), so a
provision that dies this way leaves no half-built VM behind. Teardown is the
worse case — `deleteAllVaultSecrets` throws, and an intern whose teardown
failed still has live credentials in the vault.

### Ordering: consumers first, vault last

This does not remove the window. It minimises it, and it is the only
ordering whose progress you can check as you go.

- **Consumers first** makes the window one propagation long — the vault's —
  and you enter it already knowing both consumers are updated.
- **Vault first** means racing two independent consumer syncs, governed by
  the slower one. Because Cloudflare secrets are unreadable you cannot
  confirm either value landed until you exercise it, so you would be
  guessing at when the window ended.

### How long the window lasts

It is bounded by Infisical's sync to Cloudflare, which is not part of a
deploy and can itself be blocked (see above). **This repo does not pin that
interval, and it is not verifiable from here — do not assume a number.**

Measure it instead. The probe in the next section turns the window into an
observable event: poll it after step 4 and the window closes on the first
`200`.

### Not implemented: dual-key acceptance

The change that would make this seamless is the vault accepting a *previous*
`VAULT_API_KEY` for a grace period. **The vault does not do that today**, and
nothing in this runbook depends on it — the steps below are written for the
vault as it currently behaves.

The precedent already exists one file over, which is why the gap is worth
naming. `verifyAgentToken` in `crypto-utils.ts` accepts a timed agent token
for both the current *and* the previous window, and its own docblock calls
that "a grace period for rotation" for "seamless rotation". The admin API key
has no equivalent. Until something similar ships for `VAULT_API_KEY`, the
window below is unavoidable rather than a procedure that someone forgot to
write down.

The same idea is already written down for the *other* shared credential:
[ORI-1173] (backlog) notes that rotating `INTERN_VAULT_SIGNING_SECRET`
invalidates every derived agent and proxy token fleet-wide at once and
"probably needs an overlap window where the vault accepts both the old and
new derivation". That is the same overlap this section asks for, one
credential over.

[ORI-1173]: https://linear.app/openrouter/issue/ORI-1173/vault-rotation-story-for-per-intern-derived-credentials

### Steps

1. **Generate the new key once.** Keep it in your shell as `$NEW_KEY` for
   the duration; do not paste it more than necessary and never into a URL
   variable (see the landmine below).

2. **Record the current state first.** Run the probe in the next section
   with the *old* key and confirm it returns `200`. If it does not, you are
   not rotating — you are recovering, and you need to find out what the
   vault actually holds before changing it.

3. **Update every consumer, then confirm each one landed.**
   - `/services/cfw-frontend-api` → `SECRET_VAULT_API_KEY`
   - `/services/cfw-intern-provisioner` → `INTERN_VAULT_API_KEY`
   - `/services/cfw-intern-api` → `SECRET_VAULT_API_KEY`
   - `/services/cfw-internal-api` → `SECRET_VAULT_API_KEY` (the `cfw-internal` worker)

   For each, confirm the binding exists on the deployed worker:

   ```sh
   npx wrangler secret list --config services/cfw-frontend-api/wrangler.toml
   npx wrangler secret list --config services/cfw-intern-provisioner/wrangler.toml
   npx wrangler secret list --config services/cfw-intern-api/wrangler.toml
   npx wrangler secret list --config services/cfw-internal/wrangler.toml
   ```

   This proves the *name* is bound, not that the value is current — secrets
   are unreadable. For the value, use step 6.

   If the sync did not land, check `latest == deployed` for that worker
   before re-trying; a stuck undeployed version blocks secret modification
   entirely (see above).

   **The outage window opens here**, as soon as the first consumer picks up
   the new key. Everything from this point is about closing it quickly.

4. **Rotate the vault last.** `/services/cfw-secret-vault` → `VAULT_API_KEY`.

5. **Poll until the window closes.** The window ends the moment the vault
   starts accepting the new key, which the probe below observes directly:

   ```sh
   until [ "$(curl -s -o /dev/null -w '%{http_code}' \
     -H "x-vault-api-key: $NEW_KEY" \
     -H "x-vault-workspace-id: $WORKSPACE" \
     'https://secret-vault.openrouter.workers.dev/v1/secrets?agent_id=x')" = "200" ]; do
     sleep 5
   done
   echo "window closed"
   ```

   Then confirm the old key now returns `401`. Both halves matter: a new key
   returning `200` while the old one *also* returns `200` means you are
   reading a stale version and the rotation has not actually taken.

6. **Exercise each consumer path.** The vault records nothing when it
   rejects a key (see below), so a consumer holding a stale key looks
   identical to a consumer nobody has called. Drive one real call through
   each:
   - frontend-api: load the Credential Vault page for a workspace, which
     issues `GET /v1/secrets`.
   - provisioner: provision or tear down an intern, which issues
     `POST /v1/secrets` / `DELETE /v1/secrets`.
   - intern-api: call `GET /api/v1/vault/secrets` with an enabled customer key for an active workspace. Confirm **200**, metadata only, and `Cache-Control: no-store`.
   - internal: resume the planned intern transfer and confirm its vault step succeeds.

   Confirm each operation succeeds. For frontend-api and provisioner, also check the caller’s logs for `vault_call_failed`. The public intern-api client returns bounded errors without this log event, so absence of that event does not verify its key.

7. **If you are retiring the old key rather than replacing it**, remove it
   explicitly from each worker — `wrangler secret delete` — because the
   deploy will not. Removing it from Infisical alone leaves it live on the
   worker.

### Verifying which key the vault holds

This probe answers "does the vault accept this key" without read access to
any secret store.

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "x-vault-api-key: $KEY" \
  -H "x-vault-workspace-id: $WORKSPACE" \
  'https://secret-vault.openrouter.workers.dev/v1/secrets?agent_id=x'
# 200 = the vault holds this key
# 401 = it does not
# 400 = the key was accepted but x-vault-workspace-id was missing
```

Read the codes exactly. `GET /v1/secrets` checks the API key **before** it
checks the workspace header, so a `400` proves the key passed. It is not an
auth failure — it only tells you the probe was missing
`x-vault-workspace-id`. Send the header and re-run to get a clean `200`.
`agent_id=x` is arbitrary: `listSecrets` filters rather than looking up, so
an unknown agent returns `200 {"secrets":[]}`.

An unauthenticated liveness check needs no credentials at all:

```sh
curl -s https://secret-vault.openrouter.workers.dev/health   # -> ok
```

## A rejected API key logs one record

`GET`/`POST`/`DELETE /v1/secrets`, the `/v1/origins` and `/v1/vaults` routes
and `POST /v1/mcp/probe` return `{"error":"unauthorized"}` with a `401`, and
since ORI-1974 each rejection logs `vault_api_key_rejected` with `@error.kind`
`VAULT_API_KEY_MISSING` or `VAULT_API_KEY_MISMATCH` and the route's pattern as
`@extra.route`. The body is unchanged because the frontend API and the
provisioner read it. The key is never logged. Before ORI-1974 these 401s
called no logger at all, so a vault-side record of one older than that change
does not exist; diagnose those from the caller's logs.

The intern-facing door logs its refusals the same way: a bad agent token
leaves a vault-side record. `authenticateAgent` logs `egress_auth_failed` with
an `agent_id` and a `reason`, and **`[Secret Vault] Agent Auth Failures` alerts
on it above 15 per 15 minutes.** ORI-1921 had deleted that monitor along with
the two routes whose credential-mismatch events it queried; ORI-1945 rebuilt it
against `/v1/egress` and re-derived the number, because the retired 5-per-15m
was calibrated against tunnel *sessions* — one reconnect per agent per deploy —
while `/v1/egress` authenticates once per outbound HTTP *request*. The
derivation, the two production measurements behind it, and the runbook the
alert carries are in the header above monitor 7 in
`configs/terraform-monitors/monitoring/secret_vault/monitors.tf`. The series and
its KPI card are on Section 1 of the secret-vault dashboard.

## `SECRET_VAULT_URL` is a landmine

`call-vault.ts` builds every request as `` fetch(`${vaultUrl}${path}`) ``
with no validation of `vaultUrl`. Put a non-URL in `SECRET_VAULT_URL` and
`fetch` throws `TypeError: Invalid URL: <value>/v1/secrets` before anything
leaves the worker. The throw is caught by `wrap()` and reported as:

```
vault_call_failed  vault_error_code=vault_unreachable
```

The way this happens in practice is the API key being pasted into the URL
variable, so check the value's shape before anything else.

The provisioner does not share this failure mode: `vaultEgressOrigin()` parses
`INTERN_VAULT_EGRESS_URL` with `new URL()` and returns a `VaultConfigError`
naming the variable, at the step boundary, before a VM exists. Only the
frontend-api path fails opaquely.

### Error codes, and what `vault_unreachable` actually means

From `VaultErrorCode` in `packages/helpers/secret-vault.ts`, as logged by
`call-vault.ts` in the `vault_error_code` field:

| Code | Emitted when | First thing to check |
|------|--------------|----------------------|
| `vault_not_configured` | `SECRET_VAULT_URL` or `SECRET_VAULT_API_KEY` is unset — both are `.optional()`, so the worker boots without them | whether the sync ever landed |
| `vault_unreachable` | the `fetch` call **threw** | **the shape of `SECRET_VAULT_URL`** — see below |
| `vault_unauthorized` | the vault answered `401` or `403` | key mismatch between the caller and vault copies |
| `vault_upstream_error` | the vault answered some other non-2xx | `vault_status` and `vault_error_label` on the same event |
| `vault_invalid_response` | the body did not parse or did not match the schema | `vault_content_type` — a proxy returning HTML |

**`vault_unreachable` does not mean the vault is down.** It means the `fetch`
threw, and a `TypeError: Invalid URL` thrown while *constructing* the request
lands in exactly the same bucket as a genuine DNS or connect failure. The
name reads as a network or availability fault and pulls an investigation
toward the vault being down or misaddressed when the cause is a malformed
`SECRET_VAULT_URL`. Check the shape of the URL before you check the vault's
health.

One user-visible symptom can be several of these codes in sequence, each with
its own cause, so read the code distribution over time rather than treating
the first code you see as the diagnosis.

### Zero traffic at the vault does not tell you what you think

Tailing the vault and seeing nothing is consistent with **both** of these:

1. the caller was misconfigured and never sent anything, and
2. the caller is pointed at a different vault instance.

Silence does not discriminate between them, so do not build a theory on it.
**The caller's own error log is what separates them** — `vault_unreachable`
says the request was never sent, `vault_unauthorized` says it arrived and was
rejected.

## Diagnosing from the caller's logs

Searching Datadog by symptom drowns. Searching by event name hits
immediately. The technique:

1. `git grep` the exact error string the user reports, to find the code that
   produces it.
2. Read that call site for the `wLog`/`eLog` event name and its exact field
   names.
3. Query Datadog by that event name.

For the vault's callers, step 2 lands on `vault_call_failed` in
`services/cfw-frontend-api/src/routes/byok/vault-secrets/call-vault.ts`, which
carries `vault_error_code`, `vault_path`, `vault_method`, `workspace_id`,
and — depending on the branch — `vault_status`, `vault_error_label`,
`vault_content_type`.

Two facts about this Datadog setup that nobody could guess, both measured
rather than assumed:

- **A worker's logs land under the Datadog service that
  `logServiceForScriptName` (`packages/instrumentation/log-service.ts`)
  assigns to its script name, and the default is `service: api`.** The
  producer is always identified by `@script_name`, the worker's `name` from
  its `wrangler.toml` — `frontend-api`, `secret-vault`, `intern-provisioner`.
  All three workers in this story are mapped off the default, each to the
  `cfw-<script name>` service its APM traces already use: `secret-vault` →
  `cfw-secret-vault`, `intern-provisioner` → `cfw-intern-provisioner`,
  `frontend-api` → `cfw-frontend-api`. A worker not in that map lands under
  `service:api`, so `service:<worker>` returns **zero** for it while
  `@script_name:<worker>` matches. Logs written before a mapping was
  deployed keep `service:api`, so look-backs across a worker's cutover need
  `service:(api OR cfw-<worker>) @script_name:<worker>`.
- **Fields shown as `custom.extra.X` in a returned event are queried as
  `@extra.X`.** The field logged as `vault_error_code` appears in the event
  JSON at `attributes.custom.extra.vault_error_code` and is queried
  `@extra.vault_error_code:vault_unreachable`.

So the query that finds a vault auth failure is:

```
@script_name:frontend-api vault_call_failed @extra.vault_error_code:*
```

**The naive copied path fails silently, and where it fails depends on the
tool.** `search_datadog_logs`'s `extra_fields` is lenient — passing the full
display path `custom.extra.vault_error_code` still resolves. But
`analyze_datadog_logs` takes `extra_columns` instead, and that one is
strict *and* silent: given `custom.extra.vault_error_code` it runs without
error, counts every row correctly, and returns a **blank value for every
row**. No error, just wrong data. Use `@extra.vault_error_code` there.

When named fields come back empty, request all fields on a single event
(`extra_fields: ["*"]`) to reveal the real paths rather than guessing.

## Address

`https://secret-vault.openrouter.workers.dev`, from `name = "secret-vault"`
plus `workers_dev = true` in `wrangler.toml`, with `preview_urls = false` so
that only the deployed version is addressable rather than every uploaded
one. Verified live: `/health` returns `200 ok` and an unauthenticated
`GET /v1/secrets` returns `401`.

**This is still labelled temporary in `wrangler.toml`, and that is current,
not historical.** The config comment says RFC 0013 wants
`vault.openrouter.ai` and that the workers.dev address is the interim so
interns are not blocked on DNS, and asks for `workers_dev` to be reverted to
`false` the moment the real hostname exists. No `vault.openrouter.ai` route
exists in this repo today, and the name was still NXDOMAIN when that comment
was last checked (2026-09-11). Every request to `/v1/egress` is authenticated
(`x-agent-id` + `x-workspace-id` + the HMAC agent token) and every admin route
takes `VAULT_API_KEY`, so the open URL is not an unauthenticated entry point,
but it is a public address for a secrets service.

**The tracking ticket is [ORI-1176], and both of its halves are still open.**
It was filed with two: retire the workers.dev address, and rate-limit before
authentication. Neither has shipped. The ticket carries the ordered procedure
for the hostname move, which is not the one-line commit the `wrangler.toml`
comment suggests.

Do not read the earlier PR #33959 as having closed the throttle half. That one
threw its limiter in front of the `GET /v1/tunnel` upgrade in
`src/routes/tunnel.ts`, and ORI-1921 deleted that file with the rest of the
stateful architecture, so the code went with it.

The throttle was then built against the stateless route and removed before it
shipped (#42436). The reason is worth keeping, so that it is not rebuilt the
same way. An IP-scoped counter is the obvious shape and it is the wrong one
here: intern VMs have no external IP and egress through one regional Cloud NAT
(`services/cfw-intern-provisioner/infra/network.tf`), so up to 63 of them
present the same source address and today's whole fleet of 28 sits behind one.
Counting only failed identity proofs does not rescue it. That protects healthy
interns from each other and says nothing about one intern whose token has gone
stale, whose failures land on the address they all share and which the
post-auth per-agent limiter never sees, because a rejected token returns before
`enforceRateLimit` runs. So the shape trades a cheap, recoverable, one-intern
failure for a fleet-wide egress outage. What it defends against is already
refused by the HMAC gate at one verify per request, edge-absorbed, and part 1
of this ticket removes the public address the defence was for.

[ORI-1176]: https://linear.app/openrouter/issue/ORI-1176/vault-retire-the-workersdev-address-and-throttle-pre-auth

## `INTERN_VAULT_API_KEY` is deliberately unregistered in `env.manifest.json`

Worth stating because it looks like an oversight and is not.

`env.manifest.json` registers `SECRET_VAULT_API_KEY` and `SECRET_VAULT_URL`
under `/services/cfw-frontend-api`, `/services/cfw-intern-api`, and `/services/cfw-internal-api`. It registers `VAULT_API_KEY`, `VAULT_MASTER_KEY`,
`VAULT_MASTER_KEY_PREVIOUS` and `VAULT_SIGNING_SECRET` under
`/services/cfw-secret-vault`.
It does **not** register `INTERN_VAULT_API_KEY` (or
`INTERN_VAULT_EGRESS_URL`) under `/services/cfw-intern-provisioner`.

`services/cfw-intern-provisioner/AGENTS.md` explains why: the manifest is one
list per path with **no per-environment distinction**, so registering a name
asserts it should exist in *every* environment, while
`validate-infisical-mapping.ts` defaults to `INFISICAL_ENV=dev`. Registering
a prod-only value therefore buys a permanent false `❌ Missing in Infisical`
against dev. `INTERN_VAULT_API_KEY` is listed there as a confirmed prod-only
override: bound on the deployed worker, absent from the dev path.

The two names are no longer the same kind of thing, which is why they are
unregistered for different reasons. `INTERN_VAULT_EGRESS_URL` is not a secret
at all any more — it is a `[vars]` entry in the provisioner's `wrangler.toml`,
committed, reviewed and deployed with the code, so there is nothing for
Infisical to hold and nothing for the manifest to assert. A Worker secret of
that name may nonetheless still be bound from before the move; see the
outstanding-bindings note above for why only `wrangler secret delete` clears
it.

Infisical **prod** reads return `403 You are not allowed to readValue on
secrets` under ordinary developer credentials, so "is it bound in prod" is
answered from the worker instead:

```sh
npx wrangler secret list --config services/cfw-intern-provisioner/wrangler.toml
```

That answers whether the override is real. It does not answer whether to
register it — registration stays gated on the name existing at
`/services/cfw-intern-provisioner` in **dev**, because that is what the
validator checks. Registering it while dev lacks it is not a no-op, it
degrades the dev validator's output for everyone.

Note also that `/services/cfw-intern-provisioner` and
`/services/cfw-secret-vault` are absent from `PATH_SCHEMA_MAPPING` in
`validate-infisical-mapping.ts`, so neither path gets schema-vs-manifest
validation at all. A credential missing from the manifest for these two
services is checked by nothing.

## Local development

The vault runs as its own Tilt resource on `http://localhost:8796` and starts
with every `tilt up`. It has not been `auto_init=False` since #41479 removed
its `_LEAN_MANUAL` flags; the `tilt enable secret-vault && tilt trigger secret-vault`
dance this section used to prescribe has been unnecessary since then, and is
still worth knowing only because a filtered run (`tilt up -- web api`) starts
nothing else.

```sh
curl localhost:8796/health   # -> ok
```

`misconfigured_environment` from that health check means the worker cannot
read its own secrets — `envMiddleware` failed `ensureEnv` and every request
is 500ing before it reaches a route.

### Which interface it binds

`127.0.0.1` by default, because the vault serves credential endpoints and
every `tilt up` binding them to every interface would expose them to anything
routable to the machine.

`tilt up -- --interns` is the exception and flips the default to `0.0.0.0`
for that run, because the intern runtime and its vault sidecar are Docker
containers that reach the host across a bridge rather than on its loopback.
`CFW_SECRET_VAULT_IP` overrides both defaults in either direction; set it to
`127.0.0.1` under `--interns` if you are on a network you do not trust, and
accept that the containers then cannot reach the vault.

### The whole intern stack, locally

`tilt up -- --interns` brings up the vault, a `vault-edge` Host guard, a
`vault-secret-seed` step, an `api-tunnel`, an `ori vault-tunnel` sidecar and a
`local-intern` wired through it. What each resource is for, and how to point it
at a locally built ori, live
in [`.agents/skills/local-intern-chat/SKILL.md`](../../.agents/skills/local-intern-chat/SKILL.md).

Nine things about it belong here, because they are facts about this service or about the gates that hold the stack honest:

- **The sidecar reaches this service through `vault-edge`, not through
  `wrangler dev`, and that exists to make a wrong `Host` fail locally.**
  Cloudflare routes the deployed vault by `Host` and answers 403 to anything
  else, so the Worker never runs. Measured against the real deployment on
  2026-09-11, and reproduced through `vault-edge` on the same day:

  | `Host` presented | production | local, before | local, with `vault-edge` |
  | --- | --- | --- | --- |
  | the vault's own | `401` — Worker ran, auth refused | `401` | `401` |
  | `slack.com` | `403` — edge refused, Worker never ran | `401` | `403` |

  The middle column is the gap. Nothing local routed by `Host`; `wrangler dev`
  serves whatever arrives on its port. So a sidecar that forwarded the AGENT's
  `Host` onto its own vault request took every intern fully offline in
  production — no Slack, no model calls, and silently — while passing the
  complete `tilt up -- --interns` acceptance run.

  `vault-edge` (`scripts/local-vault-edge.ts`) is a reverse proxy on
  `ORI_LOCAL_VAULT_EDGE_PORT` that refuses any request whose `Host` is not the
  authority the sidecar was pointed at, with 403, before this Worker is
  dialled — and logs `vault_edge_host_refused` with `presented_host` and
  `expected_host`, because the original bug cost hours entirely for want of
  that line. Its readiness probe drives both halves on every poll (the right
  `Host` must come back 2xx, `Host: slack.com` must come back 403) and
  `vault-sidecar` gates on it, so a harness that has stopped enforcing `Host`
  holds the stack red instead of passing.

  It guards the SIDECAR's hop only. That hop is the one that builds a vault
  request out of agent-controlled data, and the only local caller with a
  single canonical hostname to check against — the host-side scripts and
  frontend-api each reach this service under a different spelling of loopback,
  so covering them would mean accepting a SET of hostnames, which is a guard
  that fails open. Their divergence from production is real and is left open
  deliberately.

- **A working chat session does NOT mean egress was exercised.** The agent's
  model calls only traverse this service when `api-tunnel` is up. Without it
  `ORI_OPENROUTER_BASE_URL` is `http://host.docker.internal:<port>/api/v1`,
  that alias is in the agent's `NO_PROXY` because it names the developer's own
  machine, and every model call goes straight to local cfw-api — a whole
  conversation completes with `/v1/egress` serving nothing. The assertion that
  distinguishes the two is this worker's own request count, not whether the
  intern replied.

  The tunnel is what fixes it, and a cheaper local HTTPS endpoint does not:
  the sidecar is CONNECT-only so the agent must be aimed at `https://`, and
  **workerd refuses a self-signed peer** (`internal error`) while accepting
  plain HTTP to loopback, with no wrangler option to add a trusted CA. So the
  upstream has to present a genuinely trusted certificate. Using a Cloudflare
  hostname also means netguard stays fully armed — it resolves to public
  addresses, so nothing has to set `AGENT_VAULT_ALLOW_PRIVATE_RANGES`, and
  reaching for that variable to make local testing work means the approach has
  gone wrong.

- **The whole egress path runs locally, and one command proves it.**
  `wrangler dev` runs this Worker and nothing else — there is no Durable
  Object and no container to start, and `docker ps` shows only the two intern
  containers, `openrouter-local-vault-sidecar` and `openrouter-local-intern`.
  `tilt trigger vault-smoke` (`scripts/local-egress-smoke.ts`, manual trigger
  only) drives one request from the agent's own position — CONNECT to the
  sidecar, TLS terminated against the sidecar's certificate, through
  `POST /v1/egress`, out to a public upstream — and passes only on a **2xx**.
  That last condition is the whole point: every way the vault can refuse the
  request comes back through the sidecar as a parseable status like any other
  answer, and measured on 2026-09-11, with the egress route absent, the gate
  took the vault's own `404` and reported PASS.
- **The sidecar image must be an egress build.** A pre-ORI-1915 `ori-runtime`
  dials a WebSocket at the retired `/v1/tunnel`, and it mints no CA — start it
  with `ORI_RUNTIME_IMAGE=<egress build> tilt up -- --interns`. The Tilt
  readiness probe catches this, because it gates on the minted CA as well as
  the CONNECT port: a tunnel-era sidecar binds the listener happily but never
  produces a trust anchor, so it stays not-ready rather than handing the agent
  an empty trust store. `vault-smoke` is the backstop behind it.
- **The harness creates the CA directory and writes nothing into it.**
  `local-egress-seed.ts` creates `.dev/local-intern/vault-ca` — so docker does
  not create it as root on Linux — and leaves it empty. The sidecar mints its
  own CA pair there at `ORI_VAULT_CA_FILE` / `ORI_VAULT_CA_KEY_FILE` and
  mounts the directory writable; `local-intern` mounts the same directory
  read-only, because anything able to write there can substitute a CA the
  agent would trust. A certificate with no matching key makes the sidecar
  refuse to start with `EgressCaStateError: the egress CA is half-written`,
  and the seeder clears exactly that leftover — certificate present, key
  absent, which is what an earlier version of itself produced by pre-seeding
  the then-shared root — and nothing else. There is no shared root CA left to
  install. `local-intern` depends on `vault-sidecar` for the same reason: the
  agent reads `NODE_EXTRA_CA_CERTS` once at process start, so an agent started
  before the CA exists distrusts the sidecar for its whole lifetime, and a
  restart hides it.
- **The seeded secret is written through this service's own admin route**
  (`POST /v1/secrets` with `x-vault-api-key`), not into Postgres. It has to
  be: the value is envelope-encrypted under `VAULT_MASTER_KEY`, which only
  the worker holds. That is why `postgres-seed` owns the workspace and the
  intern row while `vault-secret-seed` owns the secret.
  The secret is `seed-local`'s own OpenRouter key, minted the way
  `ensure-openrouter-api-key` mints one for a provisioned intern (an
  entity-owned key with no creator, recorded as `interns.openrouter_key_id`)
  and derived from `VAULT_SIGNING_SECRET` and the intern id, so a re-seed lands
  on the same key. It used to be the stack-wide `sk-or-v1-unlimitedkey`, which
  an intern-key check reads as a member's key and a teardown of the intern
  would revoke for every service. Every intern slot gets its own intern and
  key the same way (`scripts/local-intern-slot/intern-identity.ts`).
- **`api-tunnel` fronts a zone router, not cfw-api.** An intern's base URL is
  `https://<tunnel>/api/v1`, and in production openrouter.ai sends
  `/api/v1/interns*` and `/api/v1/vault*` to cfw-intern-api by its `routes`.
  `scripts/local-api-zone-router.ts` reads those patterns from
  cfw-intern-api's `wrangler.toml` and routes the same way, so an intern
  listing its own vault through its base URL reaches intern-api locally
  instead of a cfw-api 404.
- **The `daemon-read-auth` gate is about ori's daemon, not this service, and it
  is here because a red one on `tilt up -- --interns` needs a reader who knows
  what it means.** ori closed its daemon read routes behind the bearer in
  SEC-326: `/api/sessions*`, `/api/events`, `/api/events/stream`,
  `/api/logs/runs`, `/api/logs/stream`, `/api/features` and `/api/schedules` all
  answer 401 without one. `/api/runtime/info` was already credentialed before
  SEC-326, because it returns filesystem paths, and the gate probes it too. Only
  `/health` and feature-authored routes stay open. Before that they answered anyone who reached the port, which on a live
  intern meant 4,052 journalled events across 109 sessions to an anonymous
  caller: prompt text, the model's replies and reasoning, tool arguments naming
  absolute workspace paths, and the contents of files the agent had read.

  The gate asks the agent container's binary for `RuntimeHttp.logRouteCredential`
  first, so an `ori-runtime` image that predates the change reports a BLIND SPOT
  instead of a failure, the way `intern-telemetry` does. A genuine red means the
  running build has the gate and a route answered anyway, and the verdict names
  the two faults it cannot separate from outside the container rather than
  picking one. Its control hands the check `/health`, which is open by design,
  so proving the gate can fail costs no stack mutation.

- **`x-vault-workspace-id` on the admin routes and `x-workspace-id` on
  `/v1/egress` are both `interns.entity_id`, not `interns.workspace_id`.**
  `findInternWorkspace` authorises on `id = agentId AND entity_id =
  workspaceId`. Passing the workspace UUID looks right and fails as
  `403 VAULT_AGENT_WORKSPACE_MISMATCH`, which reads like an authorisation bug rather
  than the wrong column.

One precedence rule governs local config, and it fails silently when
violated: `wrangler dev` reads `.dev.vars`, never the shell, and
`bun run dev` runs under `infisical run` — **Infisical's values win over
anything a Tiltfile exports**, so an exported `SECRET_VAULT_URL` is silently
replaced by the Infisical value. It is also why `CFW_SECRET_VAULT_PORT` is
deliberately not per-worktree: moving the vault off `8796` while Infisical
pins `SECRET_VAULT_URL` to `8796` would break the pairing, and the Tiltfile
cannot override it.

## The access log is not an audit log

The vault emits access records (`secret_resolved`, `outbound_secrets_injected`,
`put_secret`, `delete_secret`, `list_secrets`) and they reach Datadog under
`service:cfw-secret-vault`. See the README for the field
tables and worked queries.

**Do not treat these records as evidence.** They are unsigned,
mutable-by-retention application logs on a lossy pipeline, with no chain of
custody and no tamper-evidence. Specifically:

- **Logs are dropped silently when the pipeline consumer has no `DD_API_KEY`.**
  `packages/queues/tasks/telemetry-pipeline.ts` performs the Datadog upload
  only inside an `if (process.env.DD_API_KEY)` guard but returns `ok` either
  way, so the queue batch is acknowledged and the records are discarded with no
  error and no signal. This is a property of the *consumer's* environment, not
  the vault's.
- **Delivery is at-least-once with no deduplication**, so a record may appear
  more than once. Never count events to derive a usage total.
- **Sampling applies.** The tail worker submits a percentage of logs
  (`direct_log_submit_pct`) and some messages carry their own sample rates.
  Absence of a record is not evidence that access did not happen.
- **Cloudflare truncates oversized per-invocation output.** Entries carry a
  `truncated` flag; a busy invocation can lose log lines entirely.
- **Retention is bounded** by the Datadog index, so records age out.

A real audit requirement (compliance, incident forensics, customer
commitment) needs a durable append-only store written on the request path
and reconciled independently — not this pipeline. **Do not extend these logs
and call the result an audit trail.**

### The durable store: `public.agent_vault_audit_log` (ORI-1249)

Item mutations are recorded in `public.agent_vault_audit_log`, written by
`PostgresSecretVaultAdmin` inside the mutation's own transaction and readable
through `GET /api/frontend/v1/private/vault-secrets/audit`. It records actor,
tenant, intern, item name, action and timestamp — never a value, ciphertext,
nonce or envelope. Use it, not the access logs above, for "who changed which
secret and when".

What it does **not** cover, so nobody assumes more than it delivers:

- **Reads are not audited.** Only create/update/delete. Secret *resolution* is
  still only the best-effort access log described above.
- **Deletes fail open.** If the audit insert fails, the delete still commits,
  emits `openrouter.vault_audit.write_failed{reason:delete_audit_orphaned}`
  and logs `vault_audit_delete_orphaned`. That is deliberate — refusing the
  delete would strand a live credential — but it means a delete row can be
  missing. Alert on that metric; it will not self-heal.
- **Raw SQL bypasses it.** Deleting an `agent_vaults` row cascades its secrets
  away without writing audit rows. The store layer is the chokepoint for
  routes, not for hand-written SQL.
- **Provisioner writes are at-least-once.** A retried provisioning call that
  already committed writes a second row, labelled `secret_updated`. There is
  no idempotency key yet.
- **No pagination.** The read surface returns only the newest page
  (`MAX_VAULT_AUDIT_LOG_LIMIT`); there is no cursor for older history yet.

## The secret cache holds CIPHERTEXT, in KV, for an hour

ORI-1913 replaced the in-isolate `CachedSecretStore` with a KV cache that sits
**below** decryption. Two things follow, and both matter more than they look.

### Where the cache sits, and why it may not move

`SecretStore.getSecret` returns **plaintext** — `PostgresSecretStoreAdapter`
runs the query and the decryption in one method. A cache wrapped around that
interface therefore caches resolved provider credentials, and a KV cache
there would write them to Cloudflare's edge. That is the one change nobody
may make here, and it is also the most natural-looking one.

What is cached is the result of the two QUERIES:

| query | key | value |
|---|---|---|
| `findAgentVaults` | `(workspaceId, agentId)`, with the shared vault under its own `agentId: null` key | the `agent_vaults` row: `encrypted_key`, `key_nonce`, `envelope_version` |
| `findAgentVaultSecrets` | `(vaultId, name)` | the `agent_vault_secrets` row: `cipher`, `nonce`, `envelope_version`, `origin_id`, `origin_kind` |

Unwrapping with `VAULT_MASTER_KEY` still happens per request, in the Worker.
A KV compromise yields envelopes and nothing else.

The shared vault gets its OWN key rather than riding along in each intern's
entry. Both shapes are "keyed by `(workspaceId, agentId)`", but inlining the
shared row would mean that creating a workspace's first shared vault has to
purge every intern's entry — a key listing. Split, that purge is one delete.

`findInternWorkspace` — the tenant-authorisation read `#openVaults` runs first
— is deliberately **not** cached. It is an authorisation decision, and caching
it for an hour would keep authorising an archived intern. So a warm intern
still costs one Postgres round trip per request, not zero.
`findAgentVaultSecretsByOrigin` (arbitrary-MCP injection) is uncached for the
same reason it is not in the table: it is keyed by origin, not by name.

### KV purges are eventually consistent — about 60 s to every edge

**This is not reproducible under `wrangler dev`**, where KV is a local
SQLite file and a delete is immediate. In production a purge propagates
asynchronously, so for roughly a minute after a write:

- a secret rotated at one edge can still be served with its old value at
  another;
- a secret created where a negative entry was cached can still read as
  absent at another edge;
- a `DELETE /v1/secrets` can still be served from an edge that has the row.

That is accepted. The old credential is usually still valid during the
window, and the alternative (no cache) is the Hyperdrive round trip per
request this replaced. **Do not design a test, a runbook step, or a support
answer that assumes a purge is immediate**, and do not "fix" a flake in
production by shortening the TTL — the window is propagation, not expiry.

If a stale read must be forced out within the window, the only lever is to
write the secret again from a different edge; there is no flush.

### A purge outranks a write-back that raced it

Propagation is the only staleness this cache accepts. It is NOT the worst case that cache-aside gives you for free, and the difference is worth being precise about because the free version is an hour.

A read is read-query-write. A reader can miss, read the old row from Postgres, and still be holding it when a `deleteSecret` commits and purges — so the purge deletes a key the reader has not written yet, and the write-back then creates it. Nothing about that is slow or unlikely; it is the width of one Postgres query. The entry it restores carries a fresh `VAULT_CACHE_TTL_SECONDS`, so a revoked credential would keep working for an hour, long after the purge that was supposed to end it.

So a purge writes a tombstone (`PURGE_TOMBSTONE_TTL_SECONDS`, 60 s) before it deletes, and a write-back checks for one both before and after it stores, undoing its own write if a purge landed mid-flight. Marking before deleting is what makes the after-check sufficient: if the delete has already run, the tombstone was written earlier still. `cached-vault-reads.test.ts` pins all three parts — both interleavings and the ordering — and the ordering is pinned as a sequence assertion because both orders reach the same end state.

Two consequences to know:

- **A mutated slot is uncacheable for 60 s.** The tombstone suppresses repopulates indiscriminately, including the legitimate one that would cache the NEW value, so that slot is served from Postgres for a minute after every write. Deliberate, bounded, and the safe direction.
- **This fixes the edge that ran the purge, not the fleet.** A write-back in another colo cannot see a tombstone that has not reached it, so the residual exposure is exactly the ~60 s propagation window above — which is the floor for anything built on KV, and why that window is documented as accepted rather than fixed.

Do not "simplify" the write-back back to an unconditional `put`. It reads as
dead defensiveness and it is the revocation bug.

### Every mutation purges, and a test enforces that it stays that way

`PostgresSecretVaultAdmin` is the single choke point: `routes/secrets.ts` and
`routes/origins.ts` reach the rows only through `putSecret`, `deleteSecret`
and `transferSecret`, and each purges after its write COMMITS.

`postgres-secret-vault-admin.cache.test.ts` derives the mutation surface from
what each method body does rather than from a hand-written list, so a new
write path cannot be green until it either purges or is genuinely read-only.
If that test fails after you add a method, the test is right.

Purge, never repopulate. The admin holds plaintext because it encrypts it —
the moment it starts WRITING cache entries, a resolved value can reach KV
from there. Dropping entries is the only operation it may perform.

### Consequences for rotation

A lazy re-wrap changes `agent_vaults.encrypted_key`, so `putSecret` purges the
vault scope entry whenever it re-wraps. The BACKFILL does not: `scripts/rewrap-vault-keys.ts` runs under `tsx` in a plain Node process with no KV binding, so it rewrites the row and leaves any warmed entry holding the outgoing key's envelope.

That entry is readable only while `VAULT_MASTER_KEY_PREVIOUS` is still configured, and nothing in the backfill's output or in the row count that gates retirement can see it. Hence the explicit wait at step 6 of "Rotating `VAULT_MASTER_KEY`" — a cached envelope is at most `VAULT_CACHE_TTL_SECONDS` stale, and that hour has to elapse after the drain, not during it.

## Never log a secret value

`secret_names` and `modes` are the boundary for what may appear in a log line.
Do not add a field that could carry decrypted material, a placeholder's
resolved value, or an inbound `Authorization` header.

## One intern request is one trace (ORI-1950)

`src/index.ts` wraps the worker in `instrumentWorker` with two options no other worker sets, and both are load-bearing:

- **`shouldContinueInboundTrace`**, scoped to `/v1/egress`: that route continues the intern sidecar's W3C `traceparent`, so the sidecar's `vault_egress.exchange` span, this worker's `GET /v1/egress` server span and the upstream fetch share one trace id. Every other vault route, and every other worker, keeps a root span unless benchmark-gated, so a caller of the health or admin routes cannot choose their trace or force their sampling. Only `traceparent` and `tracestate` are read; the `x-or-traceparent` mirror is not, because on this door it could only be a header the agent sent and the sidecar forwarded. A missing or malformed `traceparent` starts a root span and changes nothing else.
- **`shouldRedactRequestDetail`**: the server span records no `http.request.header.*`, and client spans carry the destination origin but not its path (`GET https://api.openai.com`, no `url.full`). The upstream path is the agent's, routinely carries a credential, and a span attribute is a copy in Datadog. Do not turn this off to get richer spans.

The trace ends here: `buildUpstreamRequest` deletes `traceparent` and `tracestate` before the upstream call, and `egress-route.test.ts` pins it end to end.

Locally the spans go to Jaeger (`http://localhost:16686`), not Datadog. `dev/otel-collector-config.datadog.yaml` exports only ori's logs and metrics, so an `env:local` trace never reaches APM. The `trace-continuity` fidelity gate reads the trace back from Jaeger and asserts the one-trace-id chain and the redaction; its control asks `vault-edge` to strip `traceparent` and must refuse at `vault-span-absent`.

`vault-span-absent` is the one rejection that cannot name its own cause, and reading it as "propagation broke" is how ORI-2001 spent a day. Two faults reach it and one trace read separates neither: the traceparent did not arrive and the vault rooted a `/v1/egress` span in a trace of its own, or no vault span reached Jaeger at all. Tell those apart in Jaeger by searching `cfw-secret-vault` for `/v1/egress` spans started around the exchange — a root one is the first fault, none at all is the second. The second says nothing about which hop dropped the span: the gate reads Jaeger, so the vault's exporter, the collector and indexing are all still in play, and only instrumenting them separates those. `instrumentWorker` gives every path a span whether or not `shouldContinueInboundTrace` accepts it (`GET /v1/origins` and `GET /v1/secrets` are in Jaeger as roots), so "the request reached a path the wrapper skips" predicts a root span and cannot explain one that is missing everywhere.

## The acting member on `/v1/egress`

A member-bound credential, today a member's Google link, is released only to a turn that member opened. Who opened the turn is never read from the agent: the intern's vault sidecar asserts it on every forwarded request as `x-agent-acting-user` (`slack:<teamId>:<userId>`, `clerk:<userId>`, or `-` for a request outside any turn) beside `x-agent-acting-user-mac`, hex `HMAC-SHA256(agentToken, "ori-acting-user-v1" NUL value)`. The MAC is keyed with the agent token because that token never enters the agent's container, and because an OLD sidecar forwards the agent's headers verbatim: a forged `x-agent-acting-user` arrives without a MAC the vault can verify and is classed `invalid`, never trusted. The design, including how the sidecar learns the identity, is ori's RFC 0013 child "Acting Identity" (`docs/rfcs/0013-secret-egress/acting-identity.md` in `OpenRouterIncubator/ori`).

`src/egress/acting-user.ts` classifies the pair once per request, after `authenticateAgent`, as `absent` (neither header: a sidecar from before the assertion), `asserted`, `none` (`-`), or `invalid`. `handleOutboundRequest` takes the class as `identity.actingUser`, a required field, and every credential-failure and injection record carries it as `acting_user`. Google injection (`src/google-grant-injection.ts`) takes it as a required input and applies the policy in `actingMemberOf`:

| Class | Google's grant |
| --- | --- |
| `asserted` | minted for the asserted principal's own link; the agent's `x-openrouter-act-as` is ignored |
| `none` | refused, `VAULT_GOOGLE_ACTING_USER_MISSING` |
| `invalid` | refused, `VAULT_ACTING_USER_INVALID`, and `egress_acting_user_invalid` was already logged at the door |
| `absent` | the agent's `x-openrouter-act-as` header is honoured, exactly as before the assertion existed |

The `absent` row is the rollout, not the design. It exists so this deploy changes nothing for a fleet whose sidecars do not assert yet, and it is retired once they all do. The gate is a query, not a date: when

```text
service:cfw-secret-vault message:outbound_secrets_injected @extra.acting_user:absent
```

has returned nothing for a week, change `actingMemberOf` to treat `absent` as `none`, delete `parseGoogleActAs` and `GOOGLE_ACT_AS_HEADER` on both sides, and drop `--as` from the Google skill in the feature catalog. Do not retire it on the calendar: an intern that has not been refreshed keeps working under `absent` and stops the day this row goes.

A member can also delegate their Google link to specific interns from the dashboard: `delegations` on the link row, `[{ intern_id, capabilities }]`, written only by the link's owner through `POST /api/frontend/v1/private/interns-google-link/delegation` and clamped to the link's own consented grants. When the agent names an account with `x-openrouter-google-account: <email>`, the vault releases it only if it is the asserted member's own link, or its owner delegated it to this exact intern (`linkForNamedAccount` in `src/google-grant-injection.ts`); every other link in the workspace is unreachable by name. A delegated release is also scoped: the call's method, host and path must match an explicit allowlist for one of that intern's capabilities (`isCallAllowedByDelegation` in `packages/helpers/google-delegation.ts`), default deny, so Gmail's `batch` endpoint and any unlisted API are refused as `VAULT_GOOGLE_DELEGATION_SCOPE_DENIED`. Capabilities are independent: Gmail has read, write drafts and send; Calendar, Drive, Docs and Sheets have read and edit, where edit always brings read. The member's own turns are never limited by a delegation. A delegated link is released on any turn of that intern, including a turn-less schedule (`none`), because the owner's consent is the filter; an `invalid` assertion still reaches nothing. The pin and the per-intern client exclusions apply exactly as for the acting member. Refusals are `VAULT_GOOGLE_ACCOUNT_NOT_DELEGATED` and `VAULT_GOOGLE_DELEGATION_SCOPE_DENIED`, counted on `openrouter.vault_egress.google_delegated_grant{outcome:failure,reason:not_delegated|scope_denied}`. A header that is present but not an email is `VAULT_GOOGLE_ACCOUNT_MALFORMED` and mints nothing. A member with several links picks one by naming its email. Revoking or narrowing a delegation reaches the vault within the link-metadata cache's 60 s TTL (`LINK_LOOKUP_TTL_MS`).

A Slack principal is matched to a link in two steps (`linksForMember` in `src/google-grant-injection.ts`): first by `slack_user_id`, which only a link started from Slack carries; then, when no link names the user, by the email Slack reports for them through `users.info` with the intern's own bot token (`src/slack-member-email.ts`, cached ten minutes per member and intern, failures never cached). That call needs the `users:read.email` bot scope. A workspace whose app predates the scope gets `VAULT_GOOGLE_MEMBER_UNRESOLVED` with `google_grant_member_email_unresolved` carrying Slack's own `missing_scope`, and its dashboard-started links do not resolve from Slack turns until the app is reinstalled from the dashboard. A `clerk` principal matches `creator_user_id`, the member who linked from the dashboard, and never asks Slack.

A linked GitHub account is member-bound on request (`src/github-member-injection.ts`). GitHub requests are answered by the workspace's App and the routed PATs as before; when the agent sets `x-openrouter-github-as: member` on an `api.github.com` or `codeload.github.com` request, the vault instead injects the acting member's own token from the member slot (`githubMemberTokenSecretName`, written workspace-wide by the link flow and the provisioner's refresh) and forwards nothing else. The ask is honoured only for an `asserted` principal: `none` refuses `VAULT_GITHUB_ACTING_USER_MISSING`, `absent` refuses `VAULT_GITHUB_MEMBER_UNASSERTED` (there is no rollout row here; the member cannot be named by an older sidecar), a member with no link this intern may use refuses `VAULT_GITHUB_MEMBER_LINK_MISSING`, and a refused ask goes out with no credential at all rather than as the App. A Slack principal reaches a link through the row's `owner_email` and the same `users.info` lookup as Google; rows from before the email was recorded are reachable from the dashboard only. The header is stripped whatever the destination.

Every other credential is unaffected by the class. A workspace credential (the Slack bot token, the OpenRouter key, a GitHub App token, an MCP client credential, a named secret) is released to any request. A delegated member credential (a member's GitHub PAT under repo or owner routing, a member's MCP OAuth grant) is released to any turn of an intern it covers, which is the consent the member gave when connecting it.

### Adding a member-scoped credential

The identity logic is shared, in `src/egress/member-credential.ts`, and an injector never reads an identity header itself. Google is the reference: `resolveGoogleGrantInjection` in `src/google-grant-injection.ts` is built entirely from the helper plus its own row reader and token mint, and `resolveGithubMemberInjection` in `src/github-member-injection.ts` is the second. A new member-scoped credential brings:

1. A row reader whose rows satisfy `MemberOwnedRow`: `creatorUserId` (the dashboard member who created it), `slackUserId` when it was started from Slack, the member's lowercased `email` when the row records one, and `scopeInternId`. A row without an email cannot be reached from a Slack turn unless it was started from Slack.
2. A call to `assertedMemberOf(identity.actingUser)`. `no_turn` and `invalid` map to the credential's own refusal codes. `unasserted` is a sidecar from before the assertion; a new credential refuses it, and only Google's rollout row above still honours anything older.
3. A call to `memberRowsForPrincipal` with the rows, the agent and a `resolveSlackEmail` that wraps `resolveSlackMemberEmail` and logs its own refusal. It matches a Slack principal by user id first and by resolved email second, a dashboard principal by creator, and prefers a row pinned to this intern over a workspace-wide one.
4. Its own mint from the vault's copy of the credential, keyed by the row id, and its own refusal codes in `refusal-codes.ts`.

Whether the member's credential is released on every turn (Google) or only when the agent asks for it in place of a workspace credential (a linked GitHub account) is the injector's policy, decided after step 2 and before step 3.

### Personal MCP accounts

A personal MCP connection (`access: 'personal'` on the `mcp` row) is one member's own OAuth account, stored under a derived account key (`mcpMemberAccountKey`, `member-<hash>`) so it gets its own slot and `host#member-…` origin. `resolveMcpOriginInjection` picks it through `choosePersonalMcpAccount` in `src/mcp-personal-account.ts`, built on the member helper above:

- Only a host with a personal origin runs the member lookup; every other request is unchanged.
- The turn's member gets their own account. A member without one, and a turn without a member, falls back to the shared connection. No other member's account is ever a fallback; with no shared connection the request is refused with `VAULT_MCP_PERSONAL_ACCOUNT_MISSING` or `VAULT_MCP_PERSONAL_ACTING_USER_MISSING`.
- An agent naming a `member-` account in `x-openrouter-mcp-account` is refused (`VAULT_MCP_PERSONAL_ACCOUNT_NAMED`). The probe, a platform caller with no turn, names the account outright.

`[Secret Vault] Acting User Assertion Invalid` (monitor 8, `monitors.tf`) pages on a single `egress_acting_user_invalid` in 15 minutes. From one intern it is a forged header from inside that container, which is an attempt to act as another member; from many at once it is a sidecar release and a vault deploy that disagree about the MAC.

## Every refusal has one name (ORI-1974)

`src/egress/refusal-codes.ts` owns the closed set. A `/v1/egress` refusal answers with its `VAULT_*` code as the body's `error` and as the `x-ori-egress-refusal` header, logs it as the root `@error.kind` (never under `@extra`), tags `openrouter.vault_egress.request` with `result:<code>` and sets `ori.egress.refusal` on the route span. Datadog lowercases metric tag values, so the metric reads `result:vault_agent_token_mismatch`; the log keeps the case.

- **The status codes did not move.** Only the body's `error` string and the header changed, because ori and the sidecar name a failure and decide retries from the status (ORI-1972, ORI-1973).
- **The header is set only on responses the vault originates.** `withoutUpstreamRefusalHeader` drops one a destination sent, so a destination cannot make ori blame the vault.
- **Log messages kept their event names.** The monitors filter on `message:`, and `error.kind` carries the name, so no monitor query changed meaning.
- **Fail-open stays.** A request whose injection failed still goes upstream. It counts as `result:forwarded_without_credential` with a `reason:VAULT_CREDENTIAL_*`, `VAULT_GITHUB_*` or `VAULT_MCP_*` tag taken from the store error actually returned (`credentialFailureForStoreError`), never a hardcoded not-found. Do not make it fail closed under this name; that is a separate decision.
- **An injected credential the upstream answers 401 or 403** logs `outbound_injected_credential_rejected` with `VAULT_INJECTED_CREDENTIAL_REJECTED_UPSTREAM` and `origin_kind` (`host_rule`, `mcp_origin`, `placeholder`). This is how an expired MCP token shows up.
- **Every refusal and credential failure carries `agent_id` and `session_id`**, the ori session from `x-session-id`. `loggableId` logs a header value only when it is id-shaped, so an agent cannot write text into the log through it. No record carries the target URL, its path, its query or a header value; `withoutUrls` strips URLs a fetch error quotes.
- **Admin refusals and failed secret writes** log `VAULT_API_KEY_*`, `VAULT_SECRET_WRITE_FAILED` and `VAULT_SECRET_DELETE_FAILED` (`reason` is the store code) and keep their wire bodies.
- **The provisioner's MCP token refresh** counts one outcome per cause (`grant_revoked`, `token_endpoint_rejected`, `origin_ensure_failed`, …) and logs `PROVISIONER_MCP_TOKEN_<OUTCOME>`.

`refusal-naming.test.ts` drives every code through the app and asserts all four places at the old status; `credential-failure-naming.test.ts` does the same for the forwarded-without-credential names, the upstream-rejected record and the span.
