# Testing the Switchyard router

`nvidia/switchyard` routes among the caller's `models` using a decision from the `switchyard-router` Cloudflare Worker (`services/cfw-switchyard`), reached over the `SVC_SWITCHYARD` service binding. The worker only picks an order; cfw-api still resolves endpoints, applies provider policy and BYOK, bills, and falls back.

## Unit tests

Run the colocated tests:

```bash
bun run --filter @openrouter-monorepo/router test packages/router/plugins/switchyard-router
```

The suite has two files:

- [`index.test.ts`](./index.test.ts) covers plugin behavior: no-op without the placeholder, 400 without candidates, worker decision applied, caller-order degradation for every failure mode, and the pure helpers.
- [`switchyard-service.test.ts`](./switchyard-service.test.ts) covers request body projection (message cap, text truncation, binary-part markers) and response validation for the `/route` call.

## Local end to end

To exercise the plugin against a local worker, follow these steps:

1. Confirm the model row exists in your seed CSV. The row is created in prod Mission Control (`group = Router`, hidden) and reaches local dev through the `Refresh Models and Endpoints` auto-PR:

   ```bash
   grep nvidia/switchyard postgres/seeds/models_rows.csv
   ```

2. Run the worker locally and point the binding at it. In `services/cfw-switchyard`, run `bunx wrangler dev --port 8799`. For the Rust toolchain and the local Switchyard checkout, see that service's README. Then start cfw-api with `bun run dev cfw-api dev-fs-logs`; wrangler resolves the `switchyard-router` service binding to the running dev worker.

3. Send a request with at least two concrete models:

   ```bash
   curl -sS -X POST http://localhost:8787/api/v1/chat/completions \
     -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "nvidia/switchyard",
       "models": ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"],
       "messages": [{"role": "user", "content": "one word: hi"}],
       "stream": false
     }' | jq '{model, provider}'
   ```

   The response and logs show the following:

   - `model` is one of the two candidates and `provider` is a real provider.
   - The cfw-api log stream shows `SwitchyardRouterPlugin resolved model` with `strategy: "capability"`, no `degraded_reason`, and no `judge_failure`. A `judge_failure` value such as `no_credential` or `timeout` means the worker fell open to the capable tier without a verdict. The judge call is billed to the requesting user: the worker calls back into the local cfw-api with the same bearer key (or, for a cookie session, a signed internal-auth token plus the cookie), so the request needs a key that can pay for the judge model; `sk-or-v1-unlimitedkey` works locally.
   - With `openrouter_metadata` enabled, the response pipeline includes a `switchyard-router` stage with `resolved_to`, `strategy`, `fallback_models`, `judge_failure` when the worker reported one, and the worker's own `judge_ms` (judge call wall time) and `route_ms` (whole decision wall time).

4. Check degradation. Stop the dev worker and repeat the request. The call still succeeds using caller order, and the log line shows `strategy: "caller_order"` with a `degraded_reason`. Wrangler's dev registry answers for a stopped binding with a synthetic 503, so the reason is `non_2xx`; `fetch_failed` appears only when the binding throws or the 3 s timeout fires (for example, a stub worker that never responds).

5. Check validation. Send `"models": []`, omit `models`, or send only `"models": ["nvidia/switchyard"]`. The API returns 400 with a message naming `nvidia/switchyard`. Send `"models": ["openrouter/auto"]` or a tilde-latest alias such as `"~anthropic/claude-opus-latest"` alongside a concrete model. The API returns 400 naming both `nvidia/switchyard` and the offending router model; `SwitchyardRouterPlugin` runs before the other router plugins, so Auto never claims the request.

6. Select the algorithm for one request. In the request body from step 3, add a `switchyard-router` plugin entry, then confirm that the `strategy` field in the log line names the same algorithm:

   ```bash
   curl -sS -X POST http://localhost:8787/api/v1/chat/completions \
     -H "Authorization: Bearer sk-or-v1-unlimitedkey" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "nvidia/switchyard",
       "models": ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"],
       "plugins": [{"id": "switchyard-router", "algorithm": "auto"}],
       "messages": [{"role": "user", "content": "one word: hi"}],
       "stream": false
     }' | jq '{model, provider}'
   ```

   - The `auto` and `random` algorithms log their own name as `strategy` with no `judge_ms`, because neither calls the judge.
   - The `stage` algorithm logs `strategy: "stage"`. On a chat turn with no tool results, it calls the judge, so `judge_ms` is present.
   - The `passthrough` algorithm logs `strategy: "passthrough"` and the worker logs nothing: cfw-api serves the `models` order as sent.
   - The `composite` algorithm logs `strategy: "composite"`. On a tool continuation, the worker body carries `held_tier` for the model that served the last human turn. cfw-api stores that baseline under the `switchyard:router-state` suffix of the session key, separate from the session pin and from other routers' state, and writes it only after the human turn's inference completes with output other than a refusal and without an error.
   - For an entry with an unknown `algorithm`, the API returns 400 from request validation before any plugin runs.
   - Omit the entry to get the fleet default: `SWITCHYARD_ALGORITHM` in `services/cfw-api/wrangler.toml` (`capability`). To check the fallback, change the variable and restart cfw-api. When both are present, the request entry takes precedence.

When you need the full request path, inspect the request artifacts under `services/dev-fs-logs/.logs/`.

## Production

The `cfw-switchyard-wasm` CI job builds the worker, and the release workflow uploads and deploys it as `switchyard-router` (no public route; `workers_dev = false`). After cfw-api ships with the binding, run the curl in step 3 against `https://openrouter.ai/api/v1/chat/completions` with a real key, then confirm in Datadog that `SwitchyardRouterPlugin resolved model` lines carry `strategy: "capability"`. A sustained share of `caller_order` outcomes means the binding or worker is unhealthy; requests still succeed, so this degrades routing quality rather than availability. A sustained share of `judge_failure` values on the `openrouter.switchyard.decision` metric means the judge is slow, rejecting the caller's credentials, or returning verdicts that fail validation, so every request pays for the capable tier.
