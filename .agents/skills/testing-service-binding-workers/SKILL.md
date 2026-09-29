---
name: testing-service-binding-workers
description: Local E2E of cfw-api code that calls a sibling Cloudflare Worker over a `[[services]]` binding (for example SVC_SWITCHYARD -> switchyard-router). Covers the wrangler multi-worker dev registry, staging a router-only model row, and how to make the binding fail for degradation tests.
---

# Testing cfw-api service bindings against a local sibling worker

Use this skill when a router plugin or cfw-api path calls `c.env.SVC_<X>.fetch(...)` and you need to prove the boundary end to end (happy path and degradation) on one machine.

## Make the binding resolve

- Run the sibling worker with `bunx wrangler dev --port <p>` from its service directory. Its `name` in `wrangler.toml` must equal the `service = "..."` value in cfw-api's `[[services]]` entry. Wrangler registers it in `~/.config/.wrangler/registry/<name>`, and cfw-api's `wrangler dev` (the Tilt `api` resource) picks it up without extra flags. `ls ~/.config/.wrangler/registry/` lists the service name when registration worked.
- If the worker's `wrangler.toml` has a `[build]` hook you cannot run (for example, cargo git dependencies that do not resolve), copy the TOML without `[build]` to a temporary file and run `bunx wrangler dev -c <tmp>.toml --port <p>` against the prebuilt `main` artifact. Stop the worker first, then delete the temporary TOML, because wrangler watches it.
- Use a distinct `--inspector-port` if 9229 is taken by the Tilt workers.

## Stage a router-only model (no endpoints) in local Postgres

Seed CSVs are read-only. Check `select count(*) from models` first: the minimal launcher starts Postgres but does not seed the model catalog. If empty, run `DB_SEED_WITHOUT_CLERK=true bun run db:seed` with the usual Infisical token; this skips unrelated Clerk synchronization.

Copy the `openrouter/auto` row through `docker exec -i openrouter-web_db psql -U postgres -d postgres` (there is no host `psql`), changing slug, permaslug, name, and group.

Catalog refresh belongs to `cfw-internal`, not cfw-api. The API's old `/__scheduled` URL can answer 200 without warming anything. For a minimal stack, start `cfw-internal` with a distinct `WRANGLER_INSPECTOR_PORT` and the same persisted state. Run the narrow local refresh:

```bash
curl -sS --max-time 900 http://localhost:8794/api/v1/internal/cron/trigger \
  -H 'Content-Type: application/json' \
  -d '{"task":"refresh-kv-models-and-endpoints"}'
```

This uses the development-only authentication bypass in `services/cfw-internal/src/middlewares/cron.ts`; do not use it as a production recipe. `success:true` only means the task ran: a failed catalog publish is logged as `catalog-refresh-publish-failed` (see `packages/cloudflare/catalog/refresh.ts`) and still returns success. Restart the API (or touch the generated, gitignored `wrangler.dev.toml` inside `services/cfw-api` to reload it), then confirm the staged slug appears in `curl -s localhost:8787/api/v1/models`; if it does not, read the `cfw-internal` log for that error before retrying. The internal `__scheduled` trigger launches background workflows and also runs unrelated provider checks; HTTP 200 only confirms dispatch. A cold catalog can return `Router config unavailable: could not be read from KV` before a router plugin runs.

Repeat refresh and reload after later row changes (for example, `is_private` or `hidden`). Remove test-only rows and refresh again during cleanup.

## Degradation tests: two different failure modes

- **Worker gone:** killing the `wrangler` process can leave an orphaned `workerd` and a stale registry entry, so the binding keeps working. Check `ps -eo pid,command | grep workerd`, kill the orphan, remove `~/.config/.wrangler/registry/<name>`, and confirm `curl localhost:<p>/health` refuses the connection. Prefer SIGINT (`pkill -INT -f "wrangler dev ... --port <p>"`), which cleans up. In multi-worker dev, an unregistered binding returns a synthetic **503**, not a thrown fetch error, so expect the caller's `non_2xx`-style branch, not `fetch_failed`.
- **Worker hangs (timeout path):** run a throwaway worker with the same `name` whose `fetch` awaits longer than the caller's `AbortSignal.timeout(...)`. This is the way to exercise the `fetch_failed` or abort branch locally.

## Prove whether the worker was called

Service-binding calls that arrive through the dev registry do **not** appear in the sibling worker's `[wrangler:info] POST ...` request log; only direct HTTP to its port does. To count them, start the worker through a throwaway logging entrypoint placed in a gitignored directory (for example, `build/worker/logshim.dev.mjs`) and point the temporary TOML's `main` at it:

```js
import Worker from '../index.js'; // workers-rs default export is a WorkerEntrypoint class
export default {
  async fetch(req, env, ctx) {
    console.log(`[SY-INBOUND] ${req.method} ${new URL(req.url).pathname}`);
    return new Worker(ctx, env).fetch(req); // not Worker.fetch(...) — that throws "fetch is not a function"
  },
};
```

Run `grep -c 'SY-INBOUND] POST /route' <worker log>` before and after each request. For "must not call the worker" cases, also confirm that the dev-fs-logs generation folder has no `router/transaction-attempt.log` or `adapters/` files, which proves nothing was dispatched. Delete the shim afterwards.

For tracing tests, the shim can subscribe to `channel('otel_traces')` from `node:diagnostics_channel` and print JSON span objects. Log only selected inbound trace headers, never the bearer header or request body. Compare the route span's trace ID and parent span ID with inbound `traceparent`, and the judge span's parent ID with the route span ID. A local subscription proves publication to the channel, not delivery through the instrumentation tail worker to Datadog.

## Evidence

- For a minimal API-only run without Tilt, export the Infisical token with the universal-auth command below, then run `bun run dev cfw-api dev-fs-logs` from the root and run the sibling's Wrangler separately. Capture the launcher's stdout for plugin logs instead of using `tilt logs`; the launcher starts Postgres but not every downstream service.
- Distinguish **caller attribution and calculated usage** in `router/transaction-attempt.log` (`clerk_user_id`, `workspace_id`, `usage`) from **persisted billing**. The minimal launcher can serve real inference while `usage-record` is absent or Pub/Sub publishing fails. For durable billing assertions, start the usage resources listed in `local-dev-env` before sending the request.
- Scope privacy checks explicitly: generic dev-fs `original-request`, `request-body`, and adapter captures contain prompts by design. Inspect the sibling's structured events and the plugin's structured logger entries separately; never claim all `.logs` files are prompt-free based on those entries alone.
- Run `tilt logs --source=runtime api | sed 's/\x1b\[[0-9;]*m//g'` for plugin logs. The buffer is finite, so snapshot it to a file after each batch.
- If the Tilt stack is down when you return (containers `Exited`), bring it back with `export INFISICAL_TOKEN="$(infisical login --method=universal-auth --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --plain --silent)"` **before** `TILT_PROFILE=lean tilt up`; otherwise `postgres-migrate` dies on an interactive Infisical login prompt. Staged DB rows and KV survive the restart.
- `services/dev-fs-logs/.logs/<gen>/router/transaction-attempt.log` has `"router": "<router slug>"`, `permaslug`, and `fetch_url`, which prove normal provider routing after the plugin reordered candidates.
- Candidates must have local endpoints and keys. Try a model first with a plain request; `No endpoints found for <model>` (404) means pick another.

## Devin Secrets Needed

None beyond the normal local dev stack (Infisical dev keys through Tilt).
