# Intern-provisioner E2E — local testing

Two tiers exist for exercising the `cfw-intern-provisioner`
workflow. Reach for the hermetic tier first; the real-VM tier is a
gated, cost-bearing pre-deploy smoke.

| Tier | Location | Real cloud? | When |
|------|----------|-------------|------|
| Hermetic | `tests/e2e/intern-provisioner/` | No (localhost stubs) | Default local loop — not wired into CI (`tests/e2e/vitest.config.ts` only includes the project when `TEST_ENV=local`); run it by hand after touching the worker or stub |
| Real-resources | `tests/manual/intern-provisioner/` (this dir) | **Yes** (GCP VM, CF tunnel/DNS, Slack) | Pre-deploy smoke, provider drift, by hand |

Both run the **real** `InternProvisioningWorkflow` via
`wrangler dev`. The only difference is whether the four provider
clients (GCP Compute, GCP OAuth/GCS, Cloudflare API, Slack) hit a
localhost stub or the real APIs.

The provisioning workflow is 3 steps (see
`packages/db/interns/intern-metadata-schema.ts`):

1. `ensure_or_key` — mint/fetch the per-intern OpenRouter key
2. `create_cf_tunnel` — Cloudflare tunnel + DNS CNAME
3. `create_gcp_vm` — GCE VM boot + health probe

The per-intern Slack app is minted + OAuth-installed by the web tier
**before** enqueue (status `awaiting_slack_install` → `queued`), so
both tiers seed a `(chat, slack)` credential row up front rather than
provisioning it in-workflow.

---

## Tier 1 — Hermetic (use this first)

Runs the whole workflow against a Node stub server that impersonates
GCP/Cloudflare/GCS/Slack. Exercises dispatch, per-step OCC metadata
patching, resume-from-failed-step, and every DB status transition —
everything except actually creating cloud resources.
`INTERN_SKIP_CF_TUNNEL=true` is baked into `[env.e2e.vars]`, so the
tunnel step short-circuits and the VM step skips its `/health` poll.

**Prereqs:** local Postgres + a `tests/e2e/.env.local` with the
`PG_*_POOL_DB_URL` vars (same file the rest of the e2e suite uses).

```bash
bun run db:start                       # local Postgres on 127.0.0.1:54322
cd tests/e2e
bunx vitest run --project intern-provisioner   # boots wrangler dev --env e2e :8794 + stub :8795
```

The fixture (`tests/e2e/intern-provisioner/fixture.ts`) writes a
throwaway `.dev.vars.e2e`, boots the worker, and tears everything
down in `afterAll`. Set `DEBUG_E2E=1` to stream worker logs. This
tier is safe to run repeatedly and needs no secrets.

---

## Tier 2 — Real provisioning VM (gated, creates cloud resources)

`index.test.ts` is `describe.skipIf(!MANUAL_E2E_RUN)` — it never runs
under `bun run test`. It seeds an intern + real Slack credential,
POSTs `/api/v1/interns/enqueue` to a **locally-running** worker, polls
until `metadata.status === 'running'`, asserts the promoted
`openrouter_key_id` + Slack `slack_app_id`, then **always** tears
down the VM/tunnel/DNS in `afterAll`.

The test harness does **not** boot the worker — you run it yourself.

### Blast-radius rule

Point the worker at the **test** GCP project (`openrouter-core-test`)
and **test** CF zone (`onetrouper.test`), never prod. A real GCE VM
boots and costs money until teardown runs. Teardown is idempotent and
best-effort; if it fails the test prints the exact `gcloud` /
Cloudflare cleanup to run by hand.

### Secret storage — `/tests/e2e`, `E2E_INTERN_*` namespace

All Tier-2 secrets live in the shared `/tests/e2e` Infisical folder
under an `E2E_INTERN_*` prefix (that folder's `E2E_*` convention).
The harness (`setup.ts`) reads these names directly, falling back to
the legacy `MANUAL_E2E_*` / `INTERN_*` names when unset:

| `/tests/e2e` secret | Source | Consumed by |
|---------------------|--------|-------------|
| `E2E_INTERN_CF_ACCOUNT_ID` | copy of `/services/cfw-intern-provisioner` `INTERN_CF_ACCOUNT_ID` | harness + worker |
| `E2E_INTERN_CF_API_TOKEN` | copy of `INTERN_CF_API_TOKEN` | harness + worker |
| `E2E_INTERN_CF_DNS_ZONE_ID` | copy of `INTERN_CF_DNS_ZONE_ID` | harness + worker |
| `E2E_INTERN_GCP_SERVICE_ACCOUNT_JSON` | copy of `INTERN_GCP_SERVICE_ACCOUNT_JSON` | harness + worker |
| `E2E_INTERN_PROVISIONER_ENQUEUE_SECRET` | copy of `INTERN_PROVISIONER_ENQUEUE_SECRET` | harness + worker |
| `E2E_INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` | copy of `INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` — **optional**, and unset in every environment today | harness + worker |
| `E2E_INTERN_PROVIDER_ENCRYPTION_KEY` | copy of `/scripts` `PROVIDER_ENCRYPTION_KEY` | harness + worker |
| `E2E_INTERN_SLACK_APP_ID` | test Slack app (not copyable) | harness (seeds DB row) |
| `E2E_INTERN_SLACK_BOT_TOKEN` | test Slack app (not copyable) | harness |
| `E2E_INTERN_SLACK_SIGNING_SECRET` | test Slack app (not copyable) | harness |
| `E2E_INTERN_CLERK_USER_ID` | operator-chosen test id (harness seeds it) | harness |

Copy the six provisioner-sourced values with (values piped, never
printed; `--path=/tests/e2e` writes go through Slack approval):

```bash
infisical run --path=/services/cfw-intern-provisioner --env=dev --include-imports=false --projectId=$PID -- \
  infisical run --path=/scripts --env=dev --include-imports=false --projectId=$PID -- \
    infisical secrets set --path=/tests/e2e --env=dev --projectId=$PID --silent \
      E2E_INTERN_CF_ACCOUNT_ID="$INTERN_CF_ACCOUNT_ID" \
      E2E_INTERN_CF_API_TOKEN="$INTERN_CF_API_TOKEN" \
      E2E_INTERN_CF_DNS_ZONE_ID="$INTERN_CF_DNS_ZONE_ID" \
      E2E_INTERN_GCP_SERVICE_ACCOUNT_JSON="$INTERN_GCP_SERVICE_ACCOUNT_JSON" \
      E2E_INTERN_PROVISIONER_ENQUEUE_SECRET="$INTERN_PROVISIONER_ENQUEUE_SECRET" \
      E2E_INTERN_PROVIDER_ENCRYPTION_KEY="$PROVIDER_ENCRYPTION_KEY"
```

`E2E_INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` is deliberately **not** in
that list. It is optional on both sides and unset everywhere today, so
copying it unconditionally would write an empty secret. Once
`INTERN_PROVISIONER_ENQUEUE_SIGNING_KEY` is bound (see `RUNBOOK.md` →
"Binding the enqueue signing key"), append it to the `secrets set` call
above and to the `.dev.vars` heredoc below.

Set it on **both** or neither. The harness signs whenever it has the key
and the worker verifies only when it has one, so a key on the harness
alone leaves every request falling through to the shared secret — the
signature is inert and nothing says so. That silent-downgrade shape is
the thing ORI-1777 exists to remove, so do not half-configure it here.

### Step 1 — Materialize the worker's `.dev.vars`

The worker reads a gitignored `services/cfw-intern-provisioner/.dev.vars`
(bare `wrangler dev`, no Infisical wrapper) with the **unprefixed**
names its `src/env.ts` schema expects. Generate it from the
`/tests/e2e` values so worker + harness share one source of truth:

```bash
infisical run --path=/tests/e2e --env=dev --include-imports=false --projectId=$PID -- bash -c '
  cat > services/cfw-intern-provisioner/.dev.vars <<EOF
INTERN_CF_ACCOUNT_ID=$E2E_INTERN_CF_ACCOUNT_ID
INTERN_CF_API_TOKEN=$E2E_INTERN_CF_API_TOKEN
INTERN_CF_DNS_ZONE_ID=$E2E_INTERN_CF_DNS_ZONE_ID
INTERN_GCP_SERVICE_ACCOUNT_JSON=$E2E_INTERN_GCP_SERVICE_ACCOUNT_JSON
INTERN_PROVISIONER_ENQUEUE_SECRET=$E2E_INTERN_PROVISIONER_ENQUEUE_SECRET
PROVIDER_ENCRYPTION_KEY=$E2E_INTERN_PROVIDER_ENCRYPTION_KEY
INTERN_DNS_ZONE=onetrouper.test
INTERN_SKIP_CF_TUNNEL=true
EOF'
```

`INTERN_SKIP_CF_TUNNEL=true` skips real CF tunnel/DNS + the VM health
poll (verify the box with `gcloud compute ssh`); drop it once you
have a real test CF zone wired. Then boot:
`cd services/cfw-intern-provisioner && bunx wrangler dev --port 8794`
and confirm `GET http://127.0.0.1:8794/api/v1/interns/health` → 200.

### Step 2 — Run the harness

```bash
MANUAL_E2E_RUN=1 infisical run --path=/tests/e2e --env=dev --include-imports=false --projectId=$PID -- \
  bunx vitest run tests/manual/intern-provisioner/
# optional: MANUAL_E2E_RUN_ID=<=19 chars   MANUAL_E2E_SKIP_TEARDOWN=1
```

Expected: enqueue → 202, VM cold-boot + health poll (~2-5 min, 10-min
budget), status `running`, assertions pass, `afterAll` deletes the
VM + tunnel + DNS. Use `MANUAL_E2E_SKIP_TEARDOWN=1` only when
debugging a live VM — then mop up manually
(`gcloud compute instances delete intern-<slug>`, CF dashboard,
`bun run db:reset`).

---

## Gaps to close before the first real run

- **Slack + clerk secrets aren't copyable.** `E2E_INTERN_SLACK_*`
  require a pre-installed test Slack app, and `E2E_INTERN_CLERK_USER_ID`
  is an operator-chosen id (the harness seeds the row). Set these in
  `/tests/e2e` by hand.
- **Blast radius.** The provisioner-sourced values may point at prod
  infra (`INTERN_DNS_ZONE=or.bot`, prod GCP project). Prefer a test
  GCP project + `INTERN_SKIP_CF_TUNNEL=true` until a test CF zone
  (`onetrouper.test`) is wired, so a run can't touch prod DNS.
