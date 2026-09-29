---
name: cfw-api-perf
description: Test and optimize a cfw-api branch on an api-perf Preview (real Cloudflare Workers) - smoke tests, CPU/memory A/B, bug repros, config overrides, passthrough, and 0% smokes. Use for "use api-perf", "smoke test on perf-api", or "bench this PR".
user-invocable: true
---

# How to test and optimize cfw-api on real Cloudflare Workers

The `api-perf` worker gives every cfw-api branch its own Cloudflare Worker Preview: the real cfw-api bundle, FakeProvider-only inference by default, read-only bindings, per-Preview Durable Objects, and hostnames only reachable through Cloudflare Access. This skill is the task-level entry point. It lists the workflows people ask for and the rules they expect agents to follow. The [Preview reference](#preview-reference) below covers bindings, Access, passthrough and cleanup. Measurement methodology (Datadog queries, memory series, local profiling) is in [`cfw-api-cpu-memory-optimization`](../cfw-api-cpu-memory-optimization/SKILL.md). Read the section a step points to before improvising.

## Ground rules

- **Run it on api-perf.** Local workerd or Miniflare runs are for building the experiment, not for the result. This applies to CPU, memory, DO, and hang questions alike. If api-perf can't answer the question, say so and why. Don't quietly swap in a local run.
- **Don't silently give up.** If a deploy, credential or binding blocks you, report the exact error and what would unblock it. Don't carry on with something weaker.
- **CPU is `cpuTime` from the worker's Datadog events, never TTFB or client latency.** TTFB means nothing on a successful inference request because cfw-api emits keep-alive whitespace first. `scripts/ci/query-perf-preview.ts` generates load and checks Access and auth. It is not a CPU instrument.
- **Pin the workload.** Set `max_tokens` and `x-completion-tokens` on every request, and `stream: true` or `false` explicitly. FakeProvider defaults to 300 tokens, which is too short to see per-chunk costs.
- **Use `OPENROUTER_API_KEY`.** It's the same production key the e2e suites use against prod. The local seeded key returns 401 because the Preview validates keys against the production replica.
- **Use `tests/e2e` for smoke and correctness load, not k6.**
- **Measure differentially.** Always compare against a `main` arm deployed the same way, with non-overlapping load windows. Absolute numbers from one hostname don't mean anything.

## Setup (every workflow)

1. **Credentials, already in an agent session.** Set `OPENROUTER_API_KEY`, then `PERF_CF_ACCESS_CLIENT_ID=$CLOUDFLARE_ACCESS_ID` and `PERF_CF_ACCESS_CLIENT_SECRET=$CLOUDFLARE_SECRET`. The Datadog reads need `DD_API_KEY` and `DD_APP_KEY`.
2. **Deploy the branch.** Push it first, then trigger the Preview with `repository_dispatch`. An agent token can't use `workflow_dispatch` and gets a 403 `Resource not accessible by integration`:

   ```sh
   gh api repos/OpenRouterTeam/openrouter-web/dispatches \
     -f event_type=deploy-cfw-api-perf \
     -f 'client_payload[action]=deploy' \
     -f 'client_payload[ref]=<branch>' \
     -f 'client_payload[experiment]=<optional-suffix>'
   ```

   Use a distinct `experiment` suffix to run several arms off one branch. For the `main` arm, push a temporary branch cut from `main` and deploy it the same way.
3. **Read the run summary.** It prints two hostnames plus a link to the [api-perf dashboard](https://us5.datadoghq.com/dashboard/c9w-pnp-4rx) scoped to that version. The stable `<preview>-api-perf.openrouter.workers.dev` hostname follows the branch. The immutable `<deployment-id>-api-perf.openrouter.workers.dev` hostname is pinned to the commit. Point comparisons at the immutable hostname so a redeploy can't mix commits into one arm.
4. **Check the Preview answers:**

   ```sh
   bun scripts/ci/query-perf-preview.ts --url https://<host> --count 5 --max-tokens 1
   ```

   The script reports whether Access or cfw-api rejected a request. Both show up as a 401.
5. **Clean up when done.** Dispatch `action=delete` with the same `ref` and `experiment`, and delete any temporary baseline branch. The cleanup workflow also deletes Previews idle for an hour or older than six hours. Redeploy to keep a long experiment alive.

## Workflows

### Smoke-test a branch

Use this when a change carries some risk, but not enough to justify a full 0% production deploy: smoke tests before a dependency upgrade or a risky merge, or checking that a branch works on a real worker.

1. Deploy the branch, and a `main` arm too if you don't already have a baseline.
2. Run the relevant e2e suites against the Preview:

   ```sh
   cd tests/e2e
   TEST_ENV=production OPENROUTER_API_BASE=https://<host> \
     OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
     PERF_CF_ACCESS_CLIENT_ID="$CLOUDFLARE_ACCESS_ID" \
     PERF_CF_ACCESS_CLIENT_SECRET="$CLOUDFLARE_SECRET" \
     bun run test:e2e api/chat-completions api/responses api/messages
   ```

   `tests/e2e/vitest.setup.ts` loads `tests/e2e/.env.local` with `override: true`, so any `OPENROUTER_API_BASE` or `OPENROUTER_API_KEY` in that file silently replaces the shell values. Point those entries at the Preview, or remove them, for the run and restore them afterward. Then confirm the requests reached the Preview (Datadog `@script_name:api-perf` for the window) before you claim a Preview smoke.

3. Diff the failures against the `main` arm, or against the observed baseline in [Passthrough and the e2e baseline](#passthrough-and-the-e2e-baseline). The known failures aren't regressions:
   - capabilities `wrangler.perf.toml` omits (image generation, web search, sandbox, files-api, fusion);
   - reasoning-token usage and `service_tier` under passthrough;
   - raw-fetch tests that land on the Access login page.

   A `200 text/html` titled `Sign in ・ Cloudflare Access` is that last case, not a product response.
4. Check viability before promising a smoke. Service bindings always resolve to the bound worker's production deployment. A PR whose code lives behind `SVC_*` (for example cfw-spend-guard) therefore exercises prod code, not the branch. Say so and propose the alternative: a throwaway worker for that service, or the package's `test:cfw` workerd suite, which CI already runs.

### CPU A/B between a branch and main

Use this for CPU A/B or ablation benches of a PR (for example 5000 FakeProvider generations per arm).

1. Deploy the candidate and a `main` arm. For an ablation, deploy one arm per removed piece, each with its own `experiment` suffix.
2. Drive identical load at each immutable hostname, one arm at a time, and record each window in UTC:
   - Size: at least 1000 generations per arm, and aim for 5000 when the claim is a few percent.
   - Shape: pin generation length (for example 500 to 3000 or 500 to 5000 output tokens via `x-completion-tokens`) and pacing with `x-per-chunk-delay-ms`. Production streams arrive at 10 to 30 ms per chunk, and tight-loop pacing overstates pipeline wins.
   - Split: run streaming and non-streaming as separate cohorts when the change could affect them differently.
3. Read per-request `cpuTime` and `wallTime` from Datadog. Filter to `@script_name:api-perf` and the arm's `@url`, group by `@cf_ray_id` and take the `max`, then compute p50/p90/p95/p99 locally. The query is in the reference skill's [Measuring request-path changes](../cfw-api-cpu-memory-optimization/SKILL.md#measuring-request-path-changes) section. Don't use `pc50`-style aggregation, because it weights requests by how many log lines they emitted. The `@cf_ray_id` group-by returns at most 1000 groups, so for larger arms split the load window into sub-windows of under 1000 requests each. Merge the groups and dedupe by ray ID, then check that the group count matches the requests sent before you report percentiles.
4. Put cold starts and the first requests against a fresh Preview in their own bucket. End each query window well after load stops, because logs land late.
5. Report a verdict with `n` per arm, supported percentiles, bootstrap CIs on the delta, and the load windows. Treat overlapping CIs as no result.

Isolate variance is large. At low concurrency each arm lands on a handful of isolates, and identical code has shown medians up to 2x apart across isolates, so a claimed 2 to 5% effect can't be resolved that way. Before claiming anything, spread load across many isolates per arm and compare per isolate, or run replicate arms of the same code to measure the noise floor.

### Memory and leak bench

Use this for memory benches and reproducing a memory leak on a Preview.

1. Deploy the candidate and baseline arms, then sustain comparable load for long enough to produce many minute buckets. A short burst doesn't support percentiles.
2. Read Cloudflare's per-version series for each arm, not OOM counts. OOMs are rare even at scale.
   - Series: `openrouter.cloudflare.workersInvocationsAdaptive.byVersion.quantiles.memoryUsageBytesP50`, `P90`, `P99`, `P999`, and `...byVersion.max.memoryUsageBytes`.
   - Filter: `script_name:api-perf`, pinned by the full `version` UUID. The deploy run prints only the first eight characters.
   - Don't filter by `preview_slug` when load went to immutable hostnames.
3. Monotonic growth within an arm is a leak. A level shift between arms is a footprint change. See [Preview memory metrics](../cfw-api-cpu-memory-optimization/SKILL.md#preview-memory-metrics) for the query, and [`cfw-isolate-leak-probing`](../cfw-isolate-leak-probing/SKILL.md) for attributing a retainer.
4. Mix short and long requests (for example trivial requests plus 150-turn streaming). Say which you ran, because short and long requests stress different paths.

### Reproduce a production bug and prove the fix

Use this for reproducing a production bug (for example a wedge or hang) on a Preview and proving the fix on the branch.

1. Write the repro plan first. It needs the trigger, the observable, and at least two controls: the same request without the trigger, and the trigger applied after the vulnerable window. The plan also needs a probe that separates the suspected component from the whole isolate, such as a route that doesn't touch it.
2. Drive the failure with FakeProvider instead of waiting for it:
   - `x-initial-delay-ms` stalls the upstream;
   - `x-per-chunk-delay-ms` sets pacing;
   - `x-simulate-mid-stream-error` breaks the stream;
   - `x-completion-tokens` and `x-reasoning-tokens` set size.

   The full list is in [`services/fake-provider/README.md`](../../../services/fake-provider/README.md). A header not in `FAKE_PROVIDER_HEADERS` is dropped at ingress.
3. When the trigger is internal timing FakeProvider can't reach, add a perf-only knob on a throwaway draft branch. Gate it on `OR_PERF_SKIP_SIDE_EFFECTS` so it can't activate in production, and keep it in one droppable commit. Example: `x-or-perf-router-config-delay-ms` in https://github.com/OpenRouterTeam/openrouter-web/pull/46656 delayed the cold router-config load so a 100 ms client cancel reproduced the auth wedge.
4. Run the repro on `main` or the pre-fix commit and show it fails. Then deploy the fix branch, run the same repro, and show it passes along with both controls. https://github.com/OpenRouterTeam/openrouter-web/pull/46675 is the reference shape: a fix, an integration test, and before/after numbers from api-perf.
5. Durable Objects on a Preview are isolated per Preview with empty storage. That makes api-perf the right place to repro DO issues (alarms, TTLs, offloading, overload). Previews make each attempt cheap, so use them even when one attempt takes minutes.

### Hardcode config or mock missing bindings on the branch

Use this when the behavior depends on LiveConfig, a rollout flag, account state, or a binding the Preview lacks.

- **LiveConfig and flags.** Hardcode the value on the test branch (for example a lower size threshold or a forced mode knob) instead of flipping production config. It's also the fastest way past a gate that exempts the test key's account: comment out the exemption on the throwaway branch, redeploy, and reuse `OPENROUTER_API_KEY`. Revert before the PR is reviewed, or keep it on a separate throwaway branch.
- **Missing bindings.** The Preview omits `CF_AI`, presidio, sandbox, files-api, fusion, image-api and the usage-record binding, and every `SVC_*` points at production. Mock the missing seam in one droppable commit gated on `OR_PERF_SKIP_SIDE_EFFECTS`, with a unit test that keeps it off otherwise. Example: `private-catalog-perf-mock.ts` in https://github.com/OpenRouterTeam/openrouter-web/pull/45764 proved every mode and outcome (off/shadow/hedge/kv, mismatch, stale, absent, error, timeout). List in the report what the mock didn't exercise.
- **Account-specific paths.** If the path needs a particular entity (private grants, SpendGuard eligibility), check which keys in the environment qualify before firing. Ask for a key only when none does.

### Real inference through passthrough

Use this for confirming that real inference reaches the upstream and is billed and logged correctly on both workers, with a small batch of cheap low-`max_tokens` requests.

1. Deploy, then send requests for a real, cheap model with a small `max_tokens`. With `OR_PERF_SKIP_SIDE_EFFECTS=true` and a valid key, the Preview forwards to production OpenRouter pinned to the endpoint it selected. This spends the key's real credits. `openrouter/fake-*` models stay on FakeProvider and are free.
2. Reconcile both sides:
   - **Production `api` worker:** each generation logs `billable_outcome: recorded` and has a `default.generations` row.
   - **api-perf side:** its own generation ids have no ClickHouse rows, because side effects are skipped. That's why billing isn't doubled.
   - **The key:** its usage delta matches the requests sent.
3. Report `cpuTime` percentiles for the api-perf worker (warm-only and with cold starts), the upstream provider mix, and the reconciliation counts.

### Verify a code path with spans and breadcrumbs

Use this for confirming a code path or concurrency change (for example overlapping the auth fetch with the body read) through spans, using large or drip-fed bodies to hit each path.

1. Arm any sample-rate knob for the path on the branch (hardcode `sample_rate=1`).
2. Craft requests that force each branch of the code: large bodies, dripped bodies, cheap and expensive auth, rejects before auth. A request rejected at auth is still a cheap, low-variance probe for anything that runs before auth.
3. Read the path's breadcrumbs and StatsD from `@script_name:api-perf` events. Compare with production spans for the pre-change baseline. Preview spans may not be retained, so say so if span-level correlation isn't available.

### Follow-up: 0% production smoke

After api-perf, the usual next step is a 0% deploy and a smoke against that version: an end-to-end smoke against the 0% version ID.

- Send requests with `Cloudflare-Workers-Version-Overrides: api="<version-id>"`, with and without the override, and confirm in Datadog that `attributes.version` matches on the override requests. See [`test-do-offloading`](../test-do-offloading/SKILL.md).
- Or run the e2e suites with `TEST_ENV=production` plus the override.
- When the version goes to 1% or 10%, name the log fields and metrics you're watching to confirm there's no regression.

## Preview reference

Mechanics of the Preview itself. Measurement methodology (the Datadog `cpuTime` query, local CPU profiles, memory series, heap snapshots) lives in [`cfw-api-cpu-memory-optimization`](../cfw-api-cpu-memory-optimization/SKILL.md).

### What a Preview has and lacks

The `api-perf` worker is a throwaway Cloudflare Worker Preview of cfw-api. It uses the same cfw-api source with FakeProvider-only inference and read-only bindings, so several branches can be under load at once without sharing a deployment or Durable Object storage. The Preview name follows the branch. The run summary prints a stable hostname that follows the branch and an immutable hostname pinned to the commit. Use the immutable hostname when comparing two commits.

The Preview cannot write to Postgres, has no queue producer bindings and no usage-record binding. It holds exactly one secret, the FakeProvider key, set by hand in the worker's Previews settings with `bunx wrangler preview secret put FAKE_PROVIDER_API_KEY --config wrangler.perf.toml`. Every new Preview copies that secret. The workflow handles no secrets, no paid provider key and no `PROVIDER_ENCRYPTION_KEY`, so load points at FakeProvider endpoints by default; passthrough (see [Passthrough and the e2e baseline](#passthrough-and-the-e2e-baseline)) is the real-model option. The `FAKE_PROVIDER_API_KEY` is a Preview base-config secret, and a Preview never inherits secrets from the production deployment.

The Preview omits `CF_AI`, presidio, sandbox, files-api, fusion and image-api. Features behind those bindings report themselves unavailable and measurements of those paths are not meaningful. `R2_SKILL_BUNDLES` no longer exists in either config: nothing in cfw-api ever read it (the skills routes live in cfw-public-api), and an unused R2 binding carries put and delete against the immutable skill-bundles store, so the production binding was removed with the r2-audit rollout.

Its rate limiters fail open. Every Hyperdrive binding points at `pg-us-central1-replica`, so cross-region latency is not comparable to production. Every Preview shares those Hyperdrive configurations and the production KV namespaces, so KV-contention experiments need their own resources.

### Deploying

Use `repository_dispatch` to trigger `.github/workflows/deploy-cfw-api-perf.yaml` from the branch under test. It needs only `Contents: write` and deploys `wrangler.perf.toml` as the `api-perf` Preview:

```sh
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=deploy-cfw-api-perf \
  -f 'client_payload[action]=deploy' \
  -f 'client_payload[ref]=<branch>' \
  -f 'client_payload[experiment]=cpu-hunt'
```

`client_payload[ref]` is the branch to deploy. The run itself reports the default branch, so a dispatched run's `head_branch` is not the ref under test. `action: bootstrap` creates the worker once. `action: delete` ends an experiment early. Run the workflow from the branch under test so the Preview name and hostname come from the ref.

A human can trigger the workflow from the Actions UI. An agent token cannot use `workflow_dispatch`, so a 403 `Resource not accessible by integration` means that path was used instead of `repository_dispatch`.

### Sending requests and authentication

A request to a Preview passes two independent checks, and confusing them wastes time because both look like a 401.

1. **Cloudflare Access**, at the edge, before the worker runs. Satisfied by a service token sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Access strips both headers before the request reaches the worker.
2. **cfw-api**, in the worker. Satisfied by an OpenRouter API key sent as `Authorization: Bearer <key>`. The `Bearer` prefix is not optional. The header parser takes the second space-separated token, so a bare key reads as `undefined` and fails with `Missing Authentication header`.

The script reports which of the two rejected a request.

Query with service-token headers rather than a browser login. An Access cookie reaches cfw-api's Clerk middleware, which the perf worker has no secret for.

Any OpenRouter API key works. The Preview validates it against the production database replica and passes it upstream exactly as production does, so there is no perf-specific key and no allowlist. What it cannot do is validate a key that the replica has never seen: the Infisical dev seeded key under `/tests/e2e` and `/services/cfw-api` exists only in the local seed database and returns 401. An agent session already holds a production key in the `OPENROUTER_API_KEY` environment variable.

That key is shared org-wide and has a real monthly budget. The Preview defaults to FakeProvider, so it cannot spend, but pointing a run at a real model spends from the shared pool and shares its rate limits with every other session in the org. Use a separate key for load against real models.

Access credentials are not in Infisical. In CI, the pair lives in the `Cloudflare API Perf` GitHub environment. In an agent session, the same values are already in `CLOUDFLARE_ACCESS_ID` and `CLOUDFLARE_SECRET`. To mint a new pair in Cloudflare One, follow [Putting the Previews behind Access](#putting-the-previews-behind-access). In all cases, map the values to `PERF_CF_ACCESS_CLIENT_ID` and `PERF_CF_ACCESS_CLIENT_SECRET` below.

```bash
export OPENROUTER_API_KEY=...      # OpenRouter API key
export PERF_CF_ACCESS_CLIENT_ID=...     # Access service token
export PERF_CF_ACCESS_CLIENT_SECRET=...

bun scripts/ci/query-perf-preview.ts \
  --url https://<preview>-api-perf.openrouter.workers.dev \
  --count 100 \
  --initial-delay-ms 200
```

The script is a load generator and an Access/auth canary, not a CPU instrument. It prints per-request status and client-side wire timing, TTFB and total, which carries network, colo, cold start and FakeProvider delay alongside any worker cost. Read CPU from the worker's own events instead, per [Measuring request-path changes](../cfw-api-cpu-memory-optimization/SKILL.md#measuring-request-path-changes). The model defaults to `openrouter/fake-20260806`, so no request from it can reach a paid upstream. Both the stable Preview URL and the immutable Deployment URL of a single commit work as `--url`.

A Preview only picks up a merged fix on redeploy, including changes to how it logs.

### Passthrough and the e2e baseline

The `api-perf` Preview can optionally forward keyed inference to production OpenRouter instead of contacting a provider. Passthrough activates only when `OR_PERF_SKIP_SIDE_EFFECTS` is `true`, the Preview base URL is configured, the request has a valid API key, and the request is not already marked as passthrough. It pins production to the endpoint selected by the Preview and forwards the caller's own key, so real inference spends the caller's own credits. Use a dedicated account with a credit limit when profiling.

Requests for `openrouter/fake-*` remain on FakeProvider and are free. Cookie-authenticated requests, stealth adapters and non-inference requests (embeddings, rerank, media and batch) do not use passthrough. Paid inference needs a production-valid key in `OPENROUTER_API_KEY`, which agent sessions already have; the local seed key the e2e suite defaults to is not valid against the production replica.

Passthrough Previews reproduce production model output faithfully, including reasoning content and `reasoning_details`, but a few response metadata fields do not survive: reasoning-token usage fields (`completion_tokens_details.reasoning_tokens` and the Responses API equivalents) can be absent, zero or inconsistent, and `service_tier` is `null`. At commit `b279465d971`, a run of the chat-completions, completions, messages and responses suites produced 1004 passed, 54 failed and 259 skipped. The original 37 expected failures remain: 20 were capabilities deliberately omitted by `wrangler.perf.toml` (6 image-generation and 14 web-search), 15 were reasoning-token usage assertions in `api/chat-completions/reasoning/{basic,usage-tracking}.test.ts` and `api/responses/reasoning/usage-tracking.test.ts`, and 2 were `api/messages/regressions/service-tier.test.ts`. The remaining failures were nine raw-fetch Access-login artifacts in `api/responses/basic/error-handling.test.ts`, one `service_tier: null` snapshot in `api/chat-completions/basic/simple.test.ts`, one web-search 500 in `api/chat-completions/metadata/router-metadata.test.ts`, two additional reasoning-token usage failures for OpenAI o4-mini and xAI Grok 4.3, one timeout from the large-base64 video regression because the Preview omits the sandbox/files-api bindings, and provider-nondeterminism cases in `api/messages/edge-cases/incomplete-responses.test.ts` and `api/messages/reasoning/block-index-ordering.test.ts`. Do not treat these capability, passthrough, Access, binding, or provider-nondeterminism failures as regressions when validating a branch on a perf Preview; diff against this observed baseline instead.

#### Preview Access and raw-fetch gotcha

An e2e test that calls `fetch` directly against `config.apiBase` does not receive the Cloudflare Access service-token headers added by `getPerfPreviewHeaders` in `tests/e2e/utils/config.ts`. On a Preview, the request therefore follows Access's redirect to a `200 text/html` login page instead of reaching cfw-api; the tell is the title `Sign in ・ Cloudflare Access`. Check the raw-fetch sites in `tests/e2e/api/responses/basic/error-handling.test.ts`, `tests/e2e/api/messages/metadata/pipeline-guardrails.test.ts`, `tests/e2e/api/responses/metadata/pipeline-guardrails.test.ts`, and `tests/e2e/api/guardrails/accuracy-helpers.ts` before treating an unexpected 200 as a product response.

By hand:

```bash
curl https://<preview>-api-perf.openrouter.workers.dev/api/v1/chat/completions \
  -H "CF-Access-Client-Id: $PERF_CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $PERF_CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'x-initial-delay-ms: 200' \
  -d '{"model":"openrouter/fake-20260806","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'
```

#### FakeProvider response controls

The router forwards the headers in `FAKE_PROVIDER_HEADERS` from `packages/llm-interfaces/schemas/request/index.ts`. Examples include:

- `x-initial-delay-ms`, `x-completion-tokens`, `x-reasoning-tokens`

An unlisted header is silently dropped at ingress. Content length is `min(x-completion-tokens or 300, body max_tokens if present, 100,000)`, where the header fallback applies when it is absent, invalid or zero. `x-reasoning-tokens` adds reasoning tokens on top under the same 100,000-token ceiling. See [`services/fake-provider/README.md`](../../../services/fake-provider/README.md) for the full header reference.

To check the hostname from the outside, without any credentials:

```bash
bun scripts/ci/query-perf-preview.ts --url https://<preview>-api-perf.openrouter.workers.dev --check-access
```

It exits non-zero when cfw-api answers an unauthenticated request, which proves the hostname is reachable without Access. The deploy workflow runs this after every deploy and fails the run on a public Preview. Setting the repository (or `Cloudflare API Perf` environment) variable `PERF_REQUIRE_CF_ACCESS` to `false` downgrades that to a warning, which is only for bringing a Preview up before the Access application covers its hostname.

### Putting the Previews behind Access

Access is a Cloudflare One Access application, configured outside this repository. No wrangler setting makes a Preview hostname private: `workers_dev = false` does not cover Preview hostnames. The existing application covers `*-api-perf.openrouter.workers.dev`, including stable per-branch and immutable Deployment URLs, with a Service Auth policy for the token and an Allow policy for humans opening the URLs in a browser. An uncovered Preview fails its deploy instead of serving the public internet. `PERF_REQUIRE_CF_ACCESS=false` is the setup escape hatch. Access is the only rate limit in front of these hostnames because the perf worker's rate limiters fail open.

### Expiry and cleanup

Cloudflare never expires a Preview. It evicts the least recently deployed one when the worker reaches its Preview cap, which is not a time bound, so `cleanup-cfw-api-perf-previews.yaml` runs hourly and applies two:

- **Six hours since the last deploy.** Always enforced, because it needs no telemetry.
- **One hour with no requests.** Enforced only when the workflow has both Datadog keys, because without them a Preview under load and an abandoned one look identical, and deleting the former destroys a running experiment. When they are missing, or when the activity query for a Preview fails, the run reports `activity_unmeasured` for that Preview and only the age cap applies.

A Preview younger than the idle limit is never deleted for idleness, since a Preview is deployed before load is pointed at it. Redeploying resets both clocks, so a long experiment survives by redeploying, or by running the cleanup workflow with a larger `max-age-minutes`.

Which Previews exist comes from this repository's deploy-workflow run history, matched by the deploy workflow's `run-name`, because wrangler 4.107.0 has no `preview list` and the Previews REST API is in private beta. Consequences worth knowing:

- A Preview created outside CI is invisible to cleanup and has to be deleted by hand.
- Renaming the deploy workflow's `run-name` blinds cleanup until `perfPreviewEventFromRun` is updated to match.
- Cleanup's own deletions leave no run behind, so a Preview it deleted stays on the list until its deploy run leaves the history window. The window is the age cap plus two hours for that reason, and a delete that finds nothing is reported as `already_gone` rather than counted or alerted on. Override it with `--lookback-minutes` only alongside a larger `--max-age-minutes`. A window shorter than the age cap hides Previews before they are ever deleted.

Idle time comes from the hostname in cfw-api's own request logs, which is the only per-Preview signal available. Cloudflare's Workers metrics aggregate across a script's hostnames. A request counts for a Preview unless its hostname belongs to another live Preview, because a deployment's immutable hostname is named after the deployment id and cannot be reconstructed from a Preview name. Load pointed at a Deployment URL keeps its Preview alive, at the cost of holding the other live Previews open until the age cap too.

To see decisions without acting on them, a human can dispatch `cleanup-cfw-api-perf-previews.yaml` with `dry-run`; it is not an agent-triggerable workflow today. The summary lists every Preview with its age, idle time and reason.

To delete a Preview, dispatch the deploy workflow with `action: delete` from the branch that created it:

```bash
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=deploy-cfw-api-perf \
  -f 'client_payload[action]=delete' \
  -f 'client_payload[ref]=<branch>' \
  -f 'client_payload[experiment]=cpu-hunt'
```

Deleting a Preview deletes every deployment in it. A deleted Preview comes back by dispatching `action: deploy` again.

### Service bindings

Every `SVC_*` binding resolves to the bound worker's production deployment, so a change inside another worker isn't tested by an api-perf Preview of cfw-api.

## Reporting

Lead with the verdict (works, regressed, inconclusive, not viable) and one line of why. Then give:

- the deploy run links and immutable hostnames per arm;
- `n` per arm and the load windows in UTC;
- the supported percentiles with CIs;
- which controls ran;
- what wasn't exercised (mocked seams, omitted bindings, prod-only service bindings);
- confirmation that Previews and temporary branches are deleted.

Label each claim as measured, observed or inferred. Post the full report on the PR and update its test plan.

## Improve this skill

When a run hits something this skill didn't predict, add it here if it's about the workflow, or to [`cfw-api-cpu-memory-optimization`](../cfw-api-cpu-memory-optimization/SKILL.md) if it's about measurement methodology, in the same PR as the work.
