---
name: mission-control-ori-fleet
description: What Mission Control can do for ORI interns and the secret vault, and how to exercise every Ori Fleet action on the local intern stack without reaching real GCP or Cloudflare. Covers the action inventory (UI action, server action, cfw-internal route, backend), the auth model, the batch outcome values, the seeded teardown rows, and the legacy Interns Overview and Vault Origin Backfill pages. Use before testing or changing Ori Fleet, before clicking Delete intern anywhere, or when asked what Mission Control can do for interns or the vault.
---

# Mission Control for interns and the vault

Mission Control has three pages that touch interns or the vault:

- **Ori Fleet** (`/admin-utils/ori-fleet`, `projects/mission-control/app/admin-utils/ori-fleet`) lists every intern row in Postgres and runs the operator actions below. It is the page this skill is about.
- **Interns Overview** (`/admin-utils/interns`, `projects/mission-control/app/admin-utils/interns`) is a legacy read-only page. It fetches `ORI_MC_API_URL`, which defaults to `https://ori.onetrouper.com/api/v1`, with `MISSION_CONTROL_ORI_ACCESS_TOKEN`, and renders nothing when that token is unset. Nothing local serves that API, so the page cannot be tested on the local stack.
- **Vault Origin Backfill** (`/admin-utils/backfill-vault-origin-ids`, `projects/mission-control/app/admin-utils/backfill-vault-origin-ids`) is the only vault page. Its server action calls `runVaultOriginIdBackfill` (`packages/db/vault-origins/backfill-origin-ids.ts`), which reads and writes Postgres directly, with a dry run by default.

Only Move to workspace reaches the secret vault worker (`services/cfw-secret-vault`), and it does so through cfw-internal's `POST /v1/vaults/retenant` call. Restart intern and Read the VM are not on main; they were closed with ow#46225, together with the provisioner's `runtime-image/observe` route and the fixture's runtime-image timer.

## Ori Fleet action inventory

Every server action lives in `projects/mission-control/app/admin-utils/ori-fleet/actions.ts` and calls `/api/v1/internal/interns` on cfw-internal (`services/cfw-internal/src/routes/interns/route.ts`) through `cfwInternalEmployeeFetch`.

- **List, filters, pagination.** `listOriFleetSA` calls `GET /interns`. Postgres only.
- **Detail sheet.** `getOriFleetInternSA` calls `GET /interns/{internId}`. Postgres only. The response carries `stuckTeardown`, computed by `classifyStuckTeardown` (`packages/db/interns/stuck-teardown.ts`), which decides which teardown section the sheet shows.
- **Current image** (inside the Update Ori version dialog). `getOriFleetCurrentImageSA` calls `GET /interns/runtime-image/current`, which asks the provisioner's `/runtime-image/current`.
- **Update Ori version…** `batchUpdateOriFleetRuntimeImageSA` calls `POST /interns/runtime-image/batch`, which asks the provisioner's `/runtime-image` once per selected intern, ten at a time.
- **Clear stuck teardown…** `clearOriFleetStuckTeardownSA` calls `POST /interns/{internId}/clear-stuck-teardown`. Postgres only: `clearStuckInternTeardown` (`packages/db/interns/queries-clear-stuck-teardown.ts`) deletes the row, its cascades and its exclusively-owned credentials once `verifiedSteps` covers every recorded failure. It releases nothing in the cloud.
- **Delete intern…** `deleteOriFleetInternSA` calls `POST /interns/{internId}/delete` (`services/cfw-internal/src/routes/interns/delete-intern.ts`), which sends the provisioner's `/destroy-safe`, the contract the owner's own Delete button uses (`delete-intern-client.ts`). It is offered on every row except a `destroying` one, and the route answers 409 `already_destroying` for that status without calling the provisioner, because a second dispatch onto a teardown in flight is how rows wedged before (ORI-2254, ORI-2256). The dialog defaults to **Delete with backup**, which sends `acknowledgeWorkspaceLoss: false` so the archive gate still protects the workspace; **Delete without backup** also needs the workspace-loss checkbox and sends it true. `acknowledgeOrphans` is always true. Confirm stays disabled until the operator types the intern's exact name. That is a real destroy: it deletes whatever the row points at.

- **Move to workspace…** (on `running` rows) calls two routes in `services/cfw-internal/src/routes/interns/move-intern-workspace-route.ts`. `getOriFleetMoveDestinationsSA` calls `GET /interns/{internId}/move-workspace/destinations` to list the entity's live workspaces. `moveOriFleetInternWorkspaceSA` calls `POST /interns/{internId}/move-workspace`.
  - Picking a destination runs a dry run. The dry run takes the same locks and checks as the real move and returns a report of the shared connections and secrets the intern loses and gains.
  - Confirming runs the real move: rows, then the intern's own vault retenanted between the two workspace UUIDs, then completion, then the provisioner's `/mcp-servers` and `/instructions`.
  - If the VM refresh fails, **Retry VM refresh** re-sends the same move, which repeats only that step.
  - Refusals come back as the standard error body, and their message is what the dialog shows.
  - On the lifecycle fixture the provisioner calls reach the fixture worker. Without it they answer `unreachable` and the move reports `vmConfig: "failed"`.
  - The provisioner RUNBOOK → Transferring an intern has the full contract.

The same router also serves `POST /interns/{internId}/transfer` (cross-account), which has no Mission Control UI. The `intern-transfer-smoke` Tilt resource drives it.

### Which teardown section a row shows

`InternDetailSheet.tsx` shows at most two sections above the facts:

- **Stuck teardown** (Clear stuck teardown…) when `classifyStuckTeardown` returns a value: the row recorded failures on resource steps, either all `deletion_unverified` or past `DESTROY_SWEEP_MAX_ATTEMPTS`.
- **Delete intern** (Delete intern…) on every row that is not `destroying`. On a `destroy_failed` row with no stuck classification it is titled **Failed teardown**: the teardown stopped before releasing anything, usually at `confirm-workspace-archive`, so there is no leak list to confirm and deleting again is the next step. After a dispatch the section stays up and reports it while the row reads `destroying`.

### Batch outcome values

`POST /interns/runtime-image/batch` answers one result per intern (`InternConsoleBatchResponseSchema` in `packages/db/interns/console-api.ts`):

- `requested`: the provisioner accepted the desired image. It has not landed on the VM yet.
- `not_found`: no intern row with that id.
- `refused`: the provisioner answered 4xx or 5xx; `upstreamStatus` and `message` say why. A row with no VM answers 409 "no VM to reconcile".
- `unreachable`: the provisioner could not be reached or is not configured on cfw-internal.
- `skipped`: the request deadline ran out before this intern was sent.

## Auth model

- Every Ori Fleet server action runs `withContextSA` or `withValidatedContextSA` with `requireAdmin: true`, so the signed-in user needs `users.is_admin`. A non-admin gets a 404 page.
- `cfwInternalEmployeeFetch` (`projects/mission-control/utils/helpers/cfw-internal-employee-fetch.ts`) sends the Clerk session token as `Authorization: Bearer` and `x-openrouter-admin-key: $ADMIN_API_KEY`. With `ADMIN_API_KEY` unset in Mission Control's environment it returns 500 "ADMIN_API_KEY is not configured" before calling anything.
- cfw-internal checks both: the admin key (`services/cfw-internal/src/middlewares/admin-auth.ts`) and a verified OpenRouter employee (`services/cfw-internal/src/middlewares/clerk-employee-auth.ts`). When `isDev()` is true both pass every request and the employee is the dev admin, so a local `curl` to `http://localhost:8794/api/v1/internal/interns` needs no headers.

## Running it locally

Only one Tilt stack can run on a machine. Start it from your worktree with the lifecycle fixture as the provisioner target:

```bash
INTERN_PROVISIONER_TARGET=lifecycle-fixture tilt up -- --interns
```

That starts, with no `tilt trigger`:

- `mission-control` on `MISSION_CONTROL_PORT` (default 3001), on every profile including `TILT_PROFILE=lean`.
- `internal` (cfw-internal) with `INTERN_PROVISIONER_URL` pointed at the fixture and the fixture's enqueue credentials.
- `intern-lifecycle-fixture`, the real intern-provisioner worker and its Workflows on the local Postgres, with the Compute verbs run on Docker containers behind a fake GCE. It never reaches GCP or Cloudflare. It needs `127.0.0.1 host.docker.internal` in `/etc/hosts` and fails at start, naming that line, without it. It configures the worker with the runtime image pinned to the digest of the local copy (`tests/manual/intern-api-lifecycle/local-fixture/pin-runtime-image.ts`), because the worker cannot resolve an Artifact Registry tag from the fixture: an unpinned tag fails every create and every current-image read with a 401.

**Never point Ori Fleet at `intern-provisioner`.** That resource holds real dev GCP and Cloudflare credentials, and Delete intern against it runs a real destroy. It stays manual on every profile, and `scripts/tilt-ori-fleet-resources.test.ts` fails if a change makes it start on its own. Without `INTERN_PROVISIONER_TARGET=lifecycle-fixture`, the provisioner-backed actions answer `unreachable`, which is the safe state.

Sign in with the `clerk-dev-signin-token` skill (`.agents/skills/clerk-dev-signin-token/SKILL.md`) on `http://localhost:3001`, then open `http://localhost:3001/admin-utils/ori-fleet`. The seeded `dev+clerk_test@openrouter.ai` account can stop at `needs_second_factor`; the per-machine generated account (no `--email`) signs in with a ticket, and `bun run db:test-user --user-id <user_id> --admin true` grants it the local admin flag. Set it back to `false` when you finish. After `setActive`, `window.Clerk.user` can stay `null` on the page you signed in from; navigate to the Ori Fleet URL and the session is there.

### Seeded rows

`scripts/seed/seed-interns.ts` (run by `postgres-seed`, or `bun scripts/seed/seed-interns.ts`) seeds, among others:

- `seed-local`: `running`, served by the local runtime container. Open its detail sheet to check the list and the sheet.
- `seed-clear-stuck`: `destroy_failed` with `deletion_unverified` on `delete-gcp-vm` and `delete-snapshots`, at the sweep's attempt cap. It shows **Stuck teardown**.
- `seed-retry-delete`: `destroy_failed` with `workspace_archive_failed` on `confirm-workspace-archive`, at the attempt cap, with the VM zone and project recorded as a real row that got that far has them. It shows **Failed teardown**.
- `seed-ghost-vm`: `running`, with an instance, zone and project recorded, but no VM: the fixture proves the project empty. This is the production ghost row only a staff delete clears (ORI-2355).
- `seed-stuck-delete`: `destroying` at the attempt cap. Ori Fleet offers no delete on it.

The two teardown rows are built in `scripts/seed/seed-teardown-failed-interns.ts` by the writers a real teardown runs (`markInternDestroying` and `stampInternDestroyFailureWithin`), so their `metadata.destroy` has the shape production rows have. The ghost row is `scripts/seed/seed-ghost-running-intern.ts`. `tilt trigger postgres-seed` puts all three back after an action consumed them.

Re-seeding resets the attempt counter, but the fixture remembers every destroy Workflow id it has run until it restarts. A retry of a re-seeded row reuses an id the fixture already finished, nothing runs, and the row sits in `destroying`. Run `tilt trigger intern-lifecycle-fixture` before retrying a row you have already retried once.

### Each action, locally

- **List and detail.** Works on any stack with the seed. The list is paginated across every intern in the database, so type the name into the Name filter and click Apply.
- **Current image.** Open **Update Ori version…** on any row; the Stable option shows the fixture's pinned image (`ori-runtime@sha256:…`). `curl http://localhost:8794/api/v1/internal/interns/runtime-image/current` answers the same with no headers, through the dev auth bypass.
- **Update Ori version…** needs a fixture-created intern: the seeded rows have no VM, so they answer `refused` with 409 "intern has no VM to reconcile". Create one through `intern-api` with the seeded key that owns the seed rows, which provisions a container on the fixture:

  ```bash
  curl -X POST http://localhost:8823/api/v1/interns \
    -H 'Authorization: Bearer sk-or-v1-unlimitedkey' -H 'Content-Type: application/json' \
    -H 'Idempotency-Key: fleet-roll-1' \
    -d '{"name":"fleet-roll","provision":true}'
  ```

  Names are 2 to 17 characters. Poll `GET /api/v1/interns/<id>` until `running` (about a minute), then filter Ori Fleet to it and run **Update Ori version…** with Stable. The run sheet shows Request `Requested` and Swap `Pending`. The swap never lands: the fixture runs every container on the image it started with and has no runtime-image timer. Delete the intern afterwards with `DELETE /api/v1/interns/<id>` and body `{"acknowledge_workspace_loss":true}`.
- **Clear stuck teardown…** Open `seed-clear-stuck`, click **Clear stuck teardown…**, tick both steps and click **Delete intern row**. The row disappears from the list.
- **Delete intern without backup.** Open `seed-ghost-vm` or `seed-retry-delete`, click **Delete intern…**, pick **Delete without backup**, tick the workspace-loss box, type the name and confirm. The fixture skips the archive (`workspace archive skipped with user acknowledgement`), `delete-gcp-vm` finds the VM absent from the recorded project, and the row is purged within a few seconds. Watch it in `tilt logs intern-lifecycle-fixture`. On a fixture-created intern (the `intern-api` curl above) the same choice removes its containers too.
- **Delete intern with backup.** Needs a fixture-created intern, since only a real container can upload its workspace. Keep the default, type the name and confirm. The fixture archives `/workspace` (an `intern_archives` row with status `stored`), then releases everything and purges the row within a few seconds.

## Restarting cfw-internal

Restart it with `tilt trigger internal`. That reruns `services/cfw-internal/scripts/dev.ts`, which regenerates `.dev.vars` and pins the local provisioner and vault URLs over the Infisical ones. Do not rerun wrangler against a `.dev.vars` left from an earlier start: one written before ow#46237 still holds the production provisioner and vault URLs, which points local Ori Fleet at production.
