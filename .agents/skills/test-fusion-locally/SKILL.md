---
name: test-fusion-locally
description: Run fusion server-tool requests end-to-end against the local Tilt stack — required resources (cfw-fusion worker), request shape, roster overrides, and where panel/classification logs land.
---

# Testing Fusion Locally

## Stack requirements
- Lean Tilt is enough for cfw-api, but **fusion runs in the dedicated `fusion` worker (services/cfw-fusion, port 8813 = CFW_FUSION_PORT)** which is manual-trigger: `tilt trigger fusion && tilt wait --for=condition=Ready uiresource/fusion`. Without it, every fusion call fails with `fusion-tool:service-binding-http-error` 503 `Worker "fusion" not found` — there is NO in-isolate fallback.
- Tilt must be started with `INFISICAL_TOKEN` exported (machine-identity login per AGENTS.md), otherwise postgres-migrate/seed and worker dev-vars fail with "Failed to automatically trigger login flow".
- On a cold/lean stack, also check `kv-cache` and (when needed by auth) `valkey` then `auth`; manually trigger missing resources individually. `api-kv-cron` being Ready does not prove the cache worker is running. A request returning `503 Router config unavailable` has not reached Fusion.
- If shared dev Clerk synchronization rate-limits catalog seeding, API-only tests can temporarily set the supported `DB_SEED_WITHOUT_CLERK=true` override (`scripts/db-seed.ts`), then retrigger `postgres-seed`. This skips Clerk-dependent fixtures; restore the override afterward.

## Invoking fusion
POST `http://localhost:8787/api/v1/chat/completions` with key `sk-or-v1-unlimitedkey`:
```json
{"model":"anthropic/claude-haiku-4.5",
 "messages":[{"role":"user","content":"..."}],
 "tools":[{"type":"openrouter:fusion","parameters":{"analysis_models":["openai/gpt-4o-mini","anthropic/claude-haiku-4.5"],"max_tool_calls":1}}],
 "tool_choice":{"type":"function","function":{"name":"openrouter_fusion"}},
 "max_tokens":4000,"stream":false}
```
Successful runs take 50–120s and fold `## Panel responses` into the assistant content. Seeded embedding models (`nvidia/nemotron-3-embed-1b`, `voyageai/voyage-4`) are useful non-text-output panelists.

## Where logs land
- Pre-fan-out filters and dispatch (`fusion-tool:*` incl. `panelists-skipped-no-text-output`, and the final `failure_reason`/error surfaced back): `tilt logs api`. The api log buffer rotates quickly — grep immediately after the request, keyed by the response `id` (generation_id).
- Panel/analyst execution (`fusion:panel-call-completed`, `fusion:run-complete`, `fusion:run-failed` with `reason`): `tilt logs fusion`.
- Strip ANSI: `sed -e 's/\x1b\[[0-9;]*m//g'`.

## Behavior notes
- Caller-written non-text panelists fail the whole request fast: `fusion-tool:execute-failed` with `failure_reason: 'invalid_model'` in `tilt logs api`, zero `fusion-tool:service-binding-dispatch` / `fusion:panel-call-*` entries. Server-derived non-text panelists are just dropped (`fusion-tool:panelists-skipped-no-text-output`).
- Invalid config keeps the invocation slot consumed: expect exactly 1 `execute-failed` then `invocation-capped` rejections. With a FORCED `tool_choice` the outer model is compelled to call the tool every turn regardless, so you'll still see ~30 tool calls / ~50s; use `tool_choice: "auto"` with a prompt asking for the fusion tool to observe realistic behavior (1 call, ~8s, error relayed to the user).
- The exact user-facing tool error string is not printed in api logs and not visible in the SSE stream; assert on the structured `execute-failed` fields instead.
- A 200 response with normal prose does not mean fusion succeeded; check logs.
- Inner `/responses` rejection for embedding models surfaced with status_code 400 in `failed_models` locally (body `"code":400`), even though `packages/router/helpers/request.ts` returns 404 for the embeddings-only case on chat/completions.
- Fan-out-stage `invalid_model` (run fails only after dispatch, classified by run-fusion's all-panels-failed classifier) also keeps the slot consumed: expect exactly 1 `fusion-tool:service-binding-dispatch` + 1 `service-binding-run-failed { failure_reason: 'invalid_model' }` then `invocation-capped`. Local repro: roster `["perplexity/sonar-reasoning-pro"]` — panels require tool use, and it has no tool-use endpoints locally, so the panel fails 404 `No endpoints found that support tool use` (this is the easiest live exercise of the 404 classifier branch).
- Transient run failures still release the slot. Local repro: `["inclusionai/ling-2.6-flash"]` (Novita-only, no local key) fails panels with 429 `rate_limited`; under forced tool_choice expect multiple dispatches/run-faileds for one generation.
- Model discovery for rosters: query local Postgres via `docker exec openrouter-web_db psql -U postgres -d postgres` — `models.slug` (API slug), `models.output_modalities`, `endpoints.model_permaslug`/`provider_name`. There is no `/api/v1/models` route on local cfw-api.
- Log capture for long runs: the static `tilt logs api` buffer rotates within ~30s under fusion load; start `tilt logs -f api > file &` BEFORE sending the request or the first invocation's logs are lost.

## Inner-request evidence via dev-fs-logs
- To inspect the inner `/responses` bodies fusion sends per panel/analyst (e.g. verify `reasoning` propagation), run `tilt trigger dev-fs-logs`; generations land in `services/dev-fs-logs/.logs/<gen>/router/original-request.log`.
- Each panel call appears twice (worker-outbound and router-normalized with `enabled:true`). Distinguish panel vs analyst by the prompt: panels carry the "independent panel member" preamble; the analyst carries "Compare the independent responses" plus `temperature: 0`.

## Continuation-ladder (token-ceiling) live repro
- Trigger a textless token-ceiling panel round with roster `["openai/gpt-5.1"]` and tool `parameters` `{"max_completion_tokens": 500, "reasoning": {"effort": "high"}}` — gpt-5.1 burns the whole budget on reasoning and finishes `max_output_tokens` with no visible text. Note the override also reaches the ANALYST, which then degrades with `judge_not_valid_json`; expected under this deliberate config.
- Evidence: `fusion:continuation-round { round, textless, prior_output_chars }` / `continuation-round-failed` in `tilt logs fusion`; the continuation inner body in dev-fs-logs is a multi-turn `input` array (user prompt, assistant reasoning/text tail, user turn starting "Continue."). Ladder is bounded by `FUSION_MAX_CONTINUATIONS` (4); an exhausted textless ladder must produce exactly ONE `fusion-tool:service-binding-dispatch` + ONE `service-binding-run-failed` (outer transient retry suppressed). Recovery is nondeterministic — the same request sometimes recovers visible text mid-ladder and sometimes exhausts all 4 rounds.
- `fusion-trace` records (incl. the `continuation.continue_prompt` / `replayed_assistant_chars` block) do NOT land in dev-fs-logs by default: `services/cfw-fusion/wrangler.toml` sets `OR_ENV = "production"`, which no-ops `sendToFSLog` in the local fusion worker. Temporarily add `services/cfw-fusion/.dev.vars` with `OR_ENV = "development"` and retrigger fusion; traces then land in `.logs/default/fusion-trace.log` (no per-gen prefix — the worker lacks the fs-log ALS middleware). Remove the file and retrigger afterwards.
- Editing files under `packages/fusion-core` while the api resource runs can restart the cfw-api worker mid-request ("Your worker restarted mid-request"); just retry the request.

## Failed-run billing checks
- Controlled continuations may arrive as either strings or text-part arrays; normalize the message content before matching `Continue.`. Otherwise a fixture can keep billing textless responses instead of sending the intended 402.
- After editing local provider routing, verify the actual `http://localhost:8805/model-config?model=<slug>` URL. If scheduled refresh lags, start `internal` and POST `{"task":"refresh-kv-models-and-endpoints"}` to its local `/api/v1/internal/cron/trigger` route, then refresh `kv-cache` and `api`. The generic five-minute cron chains catalog rebuilding after provider monitoring (`services/cfw-internal/src/routes/cron/schedule.ts`), so Ready alone does not prove catalog freshness. Use the same verification after restoration.
- Dev-fs-logs writes are asynchronous; newly appearing directories can belong to a previous request. Correlate generation timestamps, request contents, and provider generation IDs before summing costs.
- A mixed successful/failed panel roster normally continues, so it does not by itself test `RunFusionError` with prior spend. A controlled upstream can first return a billed textless `length` response, then return HTTP 402 to the continuation's `Continue.` turn. Route it behind local FakeProvider and keep the API, Fusion worker, and accounting code unchanged; label this as controlled upstream evidence, not natural account-balance exhaustion.
- Public seeded `openrouter/fake-hipaa` and `openrouter/fake-hipaa-ineligible` fixtures avoid private-catalog publishing prerequisites. Check current seeded prices and provider URL before using them; restore local provider settings and any access grants after testing.
- Reconcile the failed run's `total_inner_cost` with actual panel `/responses` usage in dev-fs-logs. Outer `usage.cost` also includes its own model turns: compare `outer cost - outer cost_details.upstream_inference_cost` with the billed panels, rather than requiring the entire outer cost to equal only the panel sum.
- On successful runs, this difference includes the analyst call too: compare it with **panels plus analyst**, not panels alone.
- Error tool results may be absent from the final assistant's `reasoning_details`. Inspect the tool message sent on the next outer-model turn and the `fusion-tool:service-binding-run-failed` / `fusion:run-failed` logs; do not infer structured error contents from final prose.

## Adaptive panel timeout live repro
- Seed p99 first-token latency: insert `quantilesState` rows into ClickHouse `default.endpoint_perf_minute_v4` for the target endpoint UUID. Target a **base-variant** endpoint — the first-listed endpoint UUID for a model is often the `:batch` virtual copy, whose heuristics the resolver correctly ignores for the base slug.
- Rebuild and bust caches: `tilt trigger api-kv-cron`, then `tilt trigger kv-cache` and `tilt trigger api` (router config is isolate-cached, so the override lags a heuristics refresh until the api resource restarts).
- Verify the config via `http://localhost:8805/model-config?model=<slug>`; a successful override logs `fusion-tool:panel-adaptive-timeouts` with `panel_first_content_timeouts_ms` = max(60000, round(p99 × 1.33)), uncapped. Every panelist with observed heuristics gets an entry, including fast models floored at 60000. No entry means unknown latency (120s window in fusion-core).
- Seeded rows age out of the 5-minute rolling window in ~5 minutes, so run test requests promptly after the KV rebuild.
