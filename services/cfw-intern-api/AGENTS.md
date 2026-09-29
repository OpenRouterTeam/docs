# Working on cfw-intern-api

Architecture, module map and commands live in [`README.md`](./README.md). This file is what an agent needs before changing the worker: what it owns, what it must not do, how to run it locally, and the traps that have already cost a debugging session.

## What this worker owns

The API-key surface for interns at `openrouter.ai/api/v1/interns/**` and customer vault routes at `/api/v1/vault/**`. It is the twin of the dashboard's private routes under `/api/frontend/v1/private/interns`, for the same data, reached with an OpenRouter API key instead of a Clerk session.

It owns:

- The gate. Every intern route passes `internsGateMiddleware` in `src/routes/interns/interns-gate.ts` before its handler runs.
- The per-route timeouts in `src/routes/interns/interns-timeout.ts`. The chat completion route gets `INTERN_CHAT_TIMEOUT_MS` (5 minutes), invoke gets `INTERN_INVOKE_TIMEOUT_MS` (60 seconds, admission only); everything else gets the default.
- The data-region refusal in `src/routes/interns/interns-data-region.ts`. Intern routes are global; a request on a regional hostname such as `eu.openrouter.ai` gets 403 before authentication.

It does not own provisioning, VM lifecycle, secrets or egress. Those stay in `cfw-intern-provisioner` and `cfw-secret-vault`, and this worker calls them the same way the dashboard does.

Vault routes use the API key's real workspace UUID. Authorize both the workspace's entity and any intern's workspace on the primary database. Never substitute the entity ID or a default workspace. Forward the entity separately in `x-vault-entity-id`. The vault route deadline starts before the gate and covers body parsing and the upstream call.

## The gate, in order

1. `getAuthedKey`. No key, or an unknown key: 401. Any other lookup failure: 500, logged as `interns-gate-auth-failed`.
2. Provisioning keys: 401. They are for creating other keys, not for calling routes.
3. Identity. An org key resolves to its creator only while the creator is still an active member (`getOrganizationMember`). A key minted with no creator (`CreateKeyAuthorityType.Entity`, or reassigned to the workspace by an org admin) is the organization acting for itself and reads the whole org. A key whose recorded creator has left the org is gated as the org (so an outsider still gets 404) and then refused with 403 inside the gate: ordinary membership removal leaves API keys enabled and key authentication never rechecks the creator, so the surface must not let a departure widen a member's key to the org. An org admin reassigns such a key to an active member (`reassignApiKeyOwner`) to restore it. A membership read that fails is 500, like a failed key lookup. The identity comes from `@openrouter-monorepo/interns-gate`, shared with the dashboard so both surfaces answer the same for the same person.
4. The `ori-code-api` Statsig worker gate, read from `KV_LIVE_CONFIG`. Lifecycle routes (`src/routes/interns/lifecycle/paths.ts`) pass `shouldAwaitFirstSync: true` so a cold isolate does not 404 a caller inside the programme, and chat and vault routes pass `false`. Gate off: 404, not 403. A caller outside the programme learns nothing about the routes. Vault intern routes (`/interns/{id}/…`) also apply the interns visibility grant (`resolveInternsCallerVisibility` then `internVisibilityPredicate`, inside `authorizeCustomerVaultScope`), so a non-admin member key gets 404 on an intern it may not see, as on the interns routes. Vault routes admit one caller past a closed gate: an intern's own provisioned key (`interns.openrouter_key_id`, in the key's own entity and workspace, intern not archived) on `GET /interns/{that intern}/secrets` and `/effective-secrets` only (`vault/own-intern-key-admission.ts`). The provisioner mints that key with no creator, so the gate evaluates it as the bare organization and would otherwise 404 it. Nothing else widens: writes, the workspace list and other interns stay 404. That key is also confined to its own intern whatever the gates say, on both apps (`createOwnInternKeyBoundary` in `routes/interns/own-intern-key-boundary.ts`, keyed on `interns.openrouter_key_id` including archived interns, mounted right after the gate on the interns and vault apps): another intern's routes (detail, lifecycle, chat, invoke, daemon, vault) and every collection or workspace route answer 404 to it, so a prompt-injected intern cannot drive a sibling or reach its credentials. Every other key type passes the boundary untouched.
5. The chat and invoke routes check a second gate, `ori-chat-api`, through `isInternChatEnabledForCaller`.
6. Vault writes (`PUT`, `DELETE` and the copy `POST` under `/api/v1/vault/**`) check a third gate, `ori-vault-write-api`, through `vaultWriteGateMiddleware`. Gate off: 503 `Vault writes are not enabled`, before body parsing or any database or vault call. Vault `GET` reads are not behind it. The gate is default-off in the registry and is opened by an operator only after the compatible `cfw-secret-vault`, `cfw-internal` and `cfw-intern-provisioner` versions serve all traffic (see `services/cfw-secret-vault/AGENTS.md`, "Public vault writes open by gate").

Do not add another `awaitFirstSync` call site. `services/AGENTS.md` says live-config reads must never block on KV. The lifecycle routes are the one exception, because a lifecycle write is rare and a cold-isolate 404 on the first call is worse than the wait.

## Running it locally

```sh
tilt up
```

The Tiltfile has an `intern-api` resource in the `apis` group on `CFW_INTERN_API_PORT` (default `8823`). It starts on every `tilt up`, with no `auto_init` gate and no `--interns` needed; that flag switches the local intern runtime and vault on, not this worker. It waits on `postgres-seed`, `api-kv-cron` and `worker-gates-seed`, because the gate reads its ruleset from KV on the isolate's first check and caches it. Without the seed, every request is 404.

It is not `8822`. That is `vault-edge`'s port, and the local seed writes the sidecar's egress URL from it, so when intern-api shared it every local intern request through the sidecar reached intern-api's 404 (ORI-1980). The `default ports` test in `services/cfw-secret-vault/scripts/local-fidelity/vault-edge-in-path.test.ts` fails if `8823` changes in the Tiltfile, `scripts/dev-multi.ts`, `scripts/kill-dev-ports.ts` or `scripts/dev.ts`, or if vault-edge's `8822` does.

Smoke test once it is green:

```sh
[ ! -f .env.worktree ] || . ./.env.worktree
PORT=${CFW_INTERN_API_PORT:-8823}
curl -s localhost:$PORT/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:$PORT/api/v1/interns/anything
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OPENROUTER_API_KEY" localhost:$PORT/api/v1/interns/anything
```

Expected: `ok`, `401`, then `404` for a key outside the gate or the route's own answer for a key inside it. The sub-app registers the chat completion route (`POST /:internId/chat/completions`, ORI-1877); every other path under the prefix still ends at the catch-all `404` until the lifecycle routes (ORI-1875) land. With `tilt up -- --interns` and a key inside both gates, the chat route streams a real turn from the local intern, and the two-request interaction flow in `projects/docs/guides/ori/intern-chat.mdx` runs end to end against it.

`bun run dev` inside the package runs the same thing standalone through Infisical. Prefer Tilt: it brings the provisioner, the vault and the seeds with it.

## Traps

**The provisioner shares the `/api/v1/interns` prefix.** `cfw-intern-provisioner` serves `/api/v1/interns/health`, `/vm-report`, `/logs`, `/enqueue`, `/deprovision`, `/archive-now`, `/instructions`, `/mcp-servers`, `/runtime-image` and `/runtime-image/current` under the same prefix. Cloudflare routes a request to the most specific matching pattern, so each of those paths must exist as its own route on the provisioner before the `openrouter.ai/api/v1/interns/*` wildcard is attached to this worker. Attach the wildcard first and the VMs' `vm-report` POSTs and frontend-api's `enqueue` calls land here and fail with 401. The full list is in `wrangler.toml` and in the provisioner's README.

**`workers_dev = false`.** Nothing is served from `*.workers.dev`. If a deploy looks fine and nothing answers, check the dashboard route, not the worker.

**The gate answers 404, not 403.** A 404 on a route you know exists means the caller's identity is outside `ori-code-api`. Check the Statsig gate for that user or org before reading route code.

**`wrangler.toml` pins `OR_ENV=production`.** The Tilt resource passes `--var OR_ENV:development` because it runs bare wrangler. If you run wrangler by hand without it, the worker believes it is in production.

**Env is the trimmed `CfwInternApiEnv`.** Two Hyperdrive bindings, `KV_LIVE_CONFIG`, the two Upstash secrets the chat route's turn limiter reads (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, listed under `/services/cfw-intern-api` in `env.manifest.json`; the schema defaults point at the local Redis, so Tilt needs nothing extra), and optional `SECRET_VAULT_URL` / `SECRET_VAULT_API_KEY` settings for the vault client. The per-package `tsgo --noEmit` pulls `cfw-api` sources through path mapping and fails on bindings this worker does not declare; that is not a real error. The gate CI runs is the root `tsgo --build`, which typechecks each worker against its own `Env`.

**Tests inject the gate's dependencies.** `internsGateDeps` (`getAuthedKey`, `getOrganizationMember`, `checkUserContextGate`) is the only seam. Tests replace it with `spyOn`; do not import `cloudflare:workers` or stub Statsig.

**Invoke answers before the run ends.** `POST /:internId/invoke` (`src/routes/interns/invoke/`) starts a turn with `detachOnDisconnect: true`, reads only the opening of the daemon stream, and answers `202 {session_id}`. It refuses with `409 intern_not_ready` and cancels the turn when the daemon response lacks `x-ori-run-ownership: daemon`, because an older runtime ignores the flag and would cancel the run the moment the route hangs up. Session ids it returns are `<uuid>.<hmac>`, signed with the intern's daemon token over the intern id and the caller's principal (`invoke/session-id.ts`), and a resume with any other id is `404`. Rotating an intern's daemon token therefore orphans its invoke sessions. It reuses the chat route's gate, turn limiter, target resolution, opening read and steering, so a change to any of those in `chat/` changes invoke too.

**The chat route is a plain Hono app, so its OpenAPI metadata is registered by hand.** `src/routes/interns/index.ts` calls `app.openAPIRegistry.registerPath(internChatCompletionsRoute)` from `chat/openapi.ts` and then mounts the handler with `app.route(...)`. Mounting alone registers nothing, and the public spec (`packages/sdk-generation/src/openapi/export-openapi.build.ts` mounts `internsRoute`) silently drops the route. After changing `chat/openapi.ts` or `chat/openapi-schemas.ts`, run `bun run generate:openapi` at the root and commit `projects/docs/openapi/openapi.yaml`, then follow `.agents/skills/add-mcp-tool/SKILL.md` for the MCP regeneration check; the route stays default-disabled there.
