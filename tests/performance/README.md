# performance testing

Various test types are possible in k6, [check them out here](https://grafana.com/docs/k6/latest/testing-guides/test-types/).

Each scenario should get its own test file. For instance, [/scenario/smoke.js](./scenario/smoke.js) is a bare minimum smoke test. It checks that the system performs adequately under minimal load.

Guardrail-specific tests live under `scenario/guardrails/`, grouped by provider:

```
scenario/
├── guardrails/
│   ├── injection-shared.ts          # shared payloads across injection-detection suites
│   ├── bleep/                       # Bleep direct Worker tests
│   ├── lakera/                      # Lakera Guard tests
│   ├── model-armor/                 # Google Model Armor tests
│   └── presidio/                    # Presidio PII tests
├── smoke.ts
├── load-light.ts
└── ...                              # other non-guardrail scenarios
```

## Presidio E2E and baselines

Presidio scenarios hit the **full router** (OpenRouter API) with guardrail vs no-guardrail keys:

- **presidio-e2e-baseline.ts** — Compares latency: same payloads, **redact** guardrail key vs no-guardrail key. Use a redact key (not block) so both paths go through the LLM for an apples-to-apples comparison.
- **presidio-e2e-guardrail.ts** — Load test with a single guardrail key (redact or block).
- **presidio-shared.ts** — Shared payloads, helpers, and types used by both scripts.

Both scripts accept `PRESIDIO_MAX_VUS` to override the default VU target (e.g. `-e PRESIDIO_MAX_VUS=50` for higher concurrency).

Thresholds are calibrated from baseline runs. **When you add or change Presidio guardrails or the Presidio pipeline, re-run the baseline (redact vs none) and update thresholds and [scenario/guardrails/presidio/presidio-e2e-baselines.md](./scenario/guardrails/presidio/presidio-e2e-baselines.md) to avoid drift.** Do not loosen thresholds without re-baselining and documenting.

See [scenario/guardrails/presidio/presidio-e2e-baselines.md](./scenario/guardrails/presidio/presidio-e2e-baselines.md) for key setup, observed numbers, and run commands.

## Bleep direct Worker tests

Bleep scenarios hit the **direct `cfw-bleep` Worker** rather than the full
OpenRouter router. They are useful for local Tilt validation and raw
detect-endpoint latency:

- **bleep-smoke.ts** — OpenRouter-shaped PERSON/ADDRESS positives plus a hard
  negative against `/v1/detect`.
- **bleep-load.ts** — Reuses the existing Presidio PII payload mix for
  small/medium/large text sizes, with additional OpenRouter-shaped positives and
  hard negatives.

The Presidio service tests send:

```json
{"text":"...","language":"en","entities":["PERSON","LOCATION"],"score_threshold":0.5}
```

to `/analyze`, then call `/anonymize` with replacement rules. Bleep uses the
lighter endpoint:

```json
{"text":"...","include_confidence":true}
```

to `/v1/detect`, returning spans directly.

```shell
k6 run scenario/guardrails/bleep/bleep-smoke.ts \
  -e BLEEP_URL=http://127.0.0.1:8806

k6 run scenario/guardrails/bleep/bleep-load.ts \
  -e BLEEP_URL=http://127.0.0.1:8806 \
  -e BLEEP_MAX_VUS=10 \
  -e BLEEP_STAGE_SECONDS=30
```

## Model Armor E2E and baselines

Model Armor scenarios test the prompt-injection scanning guardrail through the full router:

- **model-armor-e2e-comparison.ts** — Compares latency: same payloads, Model Armor guardrail key vs no-guardrail key.
- **model-armor-e2e-guardrail.ts** — Load test with a single guardrail key (block mode).
- **model-armor-shared.ts** — Model Armor-specific helpers, re-exporting shared payloads from `injection-shared.ts`.

Both scripts accept `MODEL_ARMOR_MAX_VUS` to override the default VU target (e.g. `-e MODEL_ARMOR_MAX_VUS=50`).

### Payload categories

The test suite uses `pickStressPayload()` to draw from seven payload categories:

| Category | Description | Weight |
|---|---|---|
| `benign` | Legitimate user questions | 20% |
| `injection` | Direct prompt-injection attempts (classic patterns) | 15% |
| `injection` (heuristic) | Tag injection, role spoofing, evasion techniques (base64, hex, typoglycemia, character spacing) matching PR #10287 detection patterns | 15% |
| `fabricated_history_short` | 2-3 turn synthetic history with injection as final message — tests whether benign context dilutes detection | 15% |
| `fabricated_history_long` | 15-20 turn synthetic history with injection as final message — tests detection under heavier context dilution | 10% |
| `large_context` | 32k+ token payloads with injection buried in large document | 10% |
| `embedded_injection` | Injections hidden mid-document, surrounded by legitimate content | 15% |

> **Note on fabricated history payloads:** In a real multi-turn conversation every prior turn would have already been scanned by Model Armor when it was sent. The `fabricated_history_*` categories simulate a malicious client who manually constructs a request with synthetic prior turns to attempt to dilute the injection signal. They are not representative of normal usage.

Each category has per-category latency metrics and blocked-rate metrics. Injection payloads also have **per-pattern blocked rates** keyed by the exact `PatternName` values from `detection.ts` (PR #10287), e.g. `e2e_model_armor_pattern_system_tag_injection`, allowing direct comparison of Model Armor (GCP ML) vs the heuristic regex approach.

### Key findings

- **Only the latest user message is scanned.** `extractPromptText` sends only the last `role: 'user'` message to Model Armor, so prior turns (system prompts, assistant replies, earlier user messages) do not affect detection.
- **Detection is probabilistic, not a hard token cutoff.** Results become noisy around the boundary (~13k chars of prefix) rather than flipping cleanly.

### Running

```shell
# Guardrail-only (default 20 VUs, ~4 min)
k6 run scenario/guardrails/model-armor/model-armor-e2e-guardrail.ts \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  -e OPENROUTER_API_URL=$OPENROUTER_API_URL

# Baseline comparison (default 12 VUs, ~4 min)
k6 run scenario/guardrails/model-armor/model-armor-e2e-comparison.ts \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  -e OPENROUTER_BASELINE_API_KEY=$OPENROUTER_BASELINE_API_KEY \
  -e OPENROUTER_API_URL=$OPENROUTER_API_URL
```

## Lakera E2E and baselines

Lakera scenarios test the Lakera Guard prompt-injection scanning guardrail through the full router:

- **lakera-e2e-comparison.ts** — Compares latency: same payloads, Lakera guardrail key vs no-guardrail key.
- **lakera-e2e-guardrail.ts** — Load test with a single guardrail key (block mode).
- **lakera-shared.ts** — Lakera-specific helpers, re-exporting shared payloads from `injection-shared.ts`.

Both scripts accept `LAKERA_MAX_VUS` to override the default VU target (e.g. `-e LAKERA_MAX_VUS=50`).

> **Internal admin requirement:** Lakera injection protection is gated behind `is_internal_admin === true` in the `LakeraPreflightPlugin`. All API keys used for Lakera tests must belong to internal admin users, or the guardrail will silently be skipped.

Payloads are shared with the Model Armor tests (same prompt-injection categories — see above). Per-category latency and blocked-rate metrics are tracked under the `e2e_lakera_*` namespace.

Thresholds are initially set to match Model Armor. **After running the first baseline comparison, update thresholds and [scenario/guardrails/lakera/lakera-e2e-baselines.md](./scenario/guardrails/lakera/lakera-e2e-baselines.md) with observed numbers.**

### Running

```shell
# Guardrail-only (default 5 VUs, ~4 min)
k6 run scenario/guardrails/lakera/lakera-e2e-guardrail.ts \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  -e OPENROUTER_API_URL=$OPENROUTER_API_URL

# Baseline comparison (default 5 VUs, ~4 min)
k6 run scenario/guardrails/lakera/lakera-e2e-comparison.ts \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  -e OPENROUTER_BASELINE_API_KEY=$OPENROUTER_BASELINE_API_KEY \
  -e OPENROUTER_API_URL=$OPENROUTER_API_URL
```

## Frontend public routes

**frontend-public-routes.ts** — light load across the public (unauthenticated) cfw-frontend-api routes (catalog, models search/find, provider pages, stats, rankings, spawn-manifest). Each VU simulates a user session picking routes at random, weighted by real production traffic share (Datadog `service:edge` request counts for `/api/frontend/v1/*` over 24h, private/admin routes excluded). VUs ramp 0 → 15 → 0 over ~3 minutes. Each request is tagged with `endpoint:<name>` for per-route latency breakdowns, and a `frontend_public_cache_hit_rate` metric tracks `cf-cache-status: HIT` responses. Use it for before/after comparisons when changing edge caching (e.g. enabling Workers Cache).

```shell
# Defaults to https://openrouter.ai, no API key needed
k6 run scenario/frontend-public-routes.ts

# Override target host, VU count, or the permaslug used by the stats routes
k6 run scenario/frontend-public-routes.ts \
  -e OPENROUTER_FRONTEND_URL=https://openrouter.ai \
  -e FRONTEND_MAX_VUS=25 \
  -e FRONTEND_MODEL_PERMASLUG=meta-llama/llama-3.1-8b-instruct
```

## Production FakeProvider load test

`scenario/fake-provider/fake-provider-production-load.ts` exercises the production chat-completions
router while pinning every request to a private FakeProvider endpoint. It refuses non-production API URLs,
disables provider fallbacks, and verifies a FakeProvider-only marker before starting load.

Before running it:

1. Confirm the private model `openrouter/fake-20260806` and its private `FakeProvider` endpoint
   are enabled, unhidden, non-BYOK, and have valid zero pricing.
2. Ensure the dedicated load-test API key's Clerk user or organization belongs to
   `org_2uMVNwONqhSdZXQy1QtyWuCjTxZ`, which holds private access to the model and endpoint.
3. Confirm a single request pinned to `fake-provider` reports that endpoint in generation metadata.

The request intentionally omits app, session, trace, external-user, and preset attribution. A
load-test-specific User-Agent and FakeProvider response marker deliberately identify the synthetic
traffic operationally. The dedicated API key, model, endpoint, and provider remain available for
audit and filtering.

```shell
OPENROUTER_API_URL=https://openrouter.ai/api/v1 \
OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
OPENROUTER_LOAD_TEST_TOKEN="$OPENROUTER_LOAD_TEST_TOKEN" \
OPENROUTER_LOAD_TEST_RUN_ID="$OPENROUTER_LOAD_TEST_RUN_ID" \
  k6 run scenario/fake-provider/fake-provider-production-load.ts
```

Generate a short-lived, high-entropy `OPENROUTER_LOAD_TEST_TOKEN` of at least 32 characters for each approved run. Configure
the live `openrouter.ai` Cloudflare zone with a temporary custom **Skip** rule that requires this
exact header value, host `openrouter.ai`, method `POST`, and path `/api/v1/chat/completions`. Skip
only the required rate-limiting, managed WAF, and Super Bot Fight Mode phases; keep rule logging
enabled. Header matching is appropriate for an initial local run with changing egress IP, but the
token is a bearer secret: do not commit it, pass it with k6 `-e`, reuse it, or leave the rule enabled
after the run. HTTP DDoS protection may still require a separately scoped override or coordination
with Cloudflare.

Set a unique `OPENROUTER_LOAD_TEST_RUN_ID` for each run (1-64 URL-safe characters). It is included
in `generations.user_agent`, making consecutive runs distinguishable in ClickHouse. To target a
dummy 0% Worker deployment, optionally set `CLOUDFLARE_WORKERS_VERSION_OVERRIDE` to the `api`
Worker version UUID; only the Worker version is isolated, not its production bindings or downstream
dependencies.

The default six-minute profile ramps from 1 to 5 RPS, holds 20 RPS, ramps to and holds 50 RPS,
then recovers to 20 RPS. Override it with `FAKE_PROVIDER_BASE_RPS` and
`FAKE_PROVIDER_PEAK_RPS`. Capacity controls are `FAKE_PROVIDER_PREALLOCATED_VUS` (default 100)
and `FAKE_PROVIDER_MAX_VUS` (default 250). Response controls are
`FAKE_PROVIDER_MAX_TOKENS` (default 64), `FAKE_PROVIDER_INITIAL_DELAY_MS` (default 50), and
`FAKE_PROVIDER_CHUNK_DELAY_MS` (default 10). `FAKE_PROVIDER_TIMEOUT_HEADROOM_MS` defaults to 30
seconds to absorb router overhead and a possible FakeProvider cold start; it can be raised to 120
seconds.

The default request mix is 70% streaming and 30% non-streaming. Recheck the current production
streaming share in ClickHouse before a capacity run and update the mix when production behavior has
materially changed.

Before measuring steady-state latency, inspect the live FakeProvider Cloud Run scaling settings.
The service is managed out of band; allow it to scale out and consider a temporary warm minimum so
cold starts do not confound the router measurements.

Any base or peak rate above 50 RPS requires the explicit
`FAKE_PROVIDER_CONFIRM_HIGH_LOAD=true` acknowledgement after Cloudflare and production load-test
approval. The acknowledgement is a typo guard, not an edge-security or application-rate-limit
bypass.

Hard bounds reject rates above 2,000 RPS, more than 10,000 VUs, more than 4,096 output tokens, or
provider delays above 60 seconds. Output must be at least 9 tokens so the marker is not truncated.
The request timeout is derived from token count and simulated delays; configurations requiring more
than the production 300-second proxy limit are rejected. Raising those bounds requires a reviewed
code change.

The test fails if 1% or more of checks, HTTP requests, or marker validations fail, or if k6 drops
any scheduled iterations. It aborts the entire run immediately on any HTTP 429, a Cloudflare
`cf-mitigated: challenge` response, or a 403 HTML challenge page. The abort message includes the
`cf-ray` value for Cloudflare event correlation. Review the effective profile without sending
traffic with:

```shell
k6 inspect scenario/fake-provider/fake-provider-production-load.ts \
  -e OPENROUTER_API_URL=https://openrouter.ai/api/v1 \
  -e OPENROUTER_API_KEY=inspect-only \
  -e OPENROUTER_LOAD_TEST_TOKEN=inspect-only-placeholder-token-0000 \
  -e OPENROUTER_LOAD_TEST_RUN_ID=inspect-only
```

## Switchyard direct Worker test

`scenario/switchyard-route-direct.ts` posts to the `switchyard-router` Worker's `/route` endpoint directly, bypassing cfw-api. Production reaches the Worker only over the `SVC_SWITCHYARD` service binding, so the workers.dev route must be switched on by hand in the Cloudflare dashboard for the run and switched off afterwards; the next `wrangler deploy` also writes `workers_dev = false` back.

Every request makes one judge call billed to `OPENROUTER_API_KEY`; the default profile sends about 3,750 requests (5 requests/s for 2.5 minutes, then 20 requests/s for 2.5 minutes). The scenario reports the 2xx rate, the p95 latency against cfw-api's 3 s binding budget, the `judge_failure` rate, and the efficient/capable split. It does not cover cfw-api's tier derivation or binding timeout; use the api-perf Preview for those.

```shell
SWITCHYARD_ROUTE_URL=https://switchyard-router.<subdomain>.workers.dev \
OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  k6 run scenario/switchyard-route-direct.ts
```

`SWITCHYARD_ROUTE_URL` also accepts a local `wrangler dev` origin such as `http://127.0.0.1:8899`.
`SWITCHYARD_BASE_RPS`, `SWITCHYARD_PEAK_RPS`, and `SWITCHYARD_MAX_VUS` override the profile.

## HMA known-hash capacity test

`scenario/trust/hma-known-hash.ts` measures the HMA matcher independently of the OpenRouter router and Coop. It alternates between the two checked-in, harmless fixtures in `dev/coop-hma/fixtures/`, fixes every request to `POST /m/lookup` and the `OPENROUTER_TEST` bank, and reports separate exact-match/no-match throughput and p50/p95/p99 latency. The constant-arrival-rate executor and `dropped_iterations` show when the configured VU pool saturates. The pure helpers in `hma-known-hash-shared.ts` are covered by a `bun test` next to them.

Start the local Coop/HMA stack and seed the benign bank before running it:

```shell
bun run scripts/coop-hma-local-runtime.ts ensure-env
bun run scripts/coop-hma-local-runtime.ts start
bun run scripts/coop-hma-local-runtime.ts bootstrap-benign-bank
cd tests/performance
HMA_LOAD_TEST_URL="http://127.0.0.1:${COOP_HMA_HMA_PORT:-15100}" \
  k6 run ./scenario/trust/hma-known-hash.ts
```

The local target is explicit: the HMA port defaults to `15100`, and `bun run dev:ports on` overrides it per worktree through `COOP_HMA_HMA_PORT` in `.env.worktree`. The bounded local profile runs at 5 requests/second for 60 seconds. Override it with `HMA_LOAD_TEST_RATE`, `HMA_LOAD_TEST_DURATION_SECONDS`, `HMA_LOAD_TEST_PREALLOCATED_VUS`, `HMA_LOAD_TEST_MAX_VUS`, and `HMA_LOAD_TEST_TIMEOUT_MS`.

A remote target must be an HTTPS origin with no path, query, fragment, or embedded credentials. Remote runs also require an authenticated regional HMA origin, `HMA_LOAD_TEST_BEARER_TOKEN`, and the exact acknowledgement `HMA_LOAD_TEST_REMOTE_CONFIRMATION=OPENROUTER_TEST_ONLY`. The acknowledgement does not bootstrap the bank or authorize production-bank, Coop, reporting, or enforcement traffic. Confirm the remote `OPENROUTER_TEST` bank contains only the same harmless fixture before each approved run.

```shell
k6 run ./scenario/trust/hma-known-hash.ts \
  -e HMA_LOAD_TEST_URL=https://hma.staging.example \
  -e HMA_LOAD_TEST_BEARER_TOKEN="$HMA_LOAD_TEST_BEARER_TOKEN" \
  -e HMA_LOAD_TEST_REMOTE_CONFIRMATION=OPENROUTER_TEST_ONLY
```

## setup

Install [k6](https://grafana.com/docs/k6/latest/), a load testing tool from Grafana: `brew install k6`

Copy `.env.example` to a `.env.development.local` at the repository root, then include your OpenRouter API key and base url.

Expose the env vars, and forward them into the test:

```shell
$ source .env.development.local
$ k6 run scenario/smoke.ts -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY -e OPENROUTER_API_URL=$OPENROUTER_API_URL

          /\      |‾‾| /‾‾/   /‾‾/
     /\  /  \     |  |/  /   /  /
    /  \/    \    |     (   /   ‾‾\
   /          \   |  |\  \ |  (‾)  |
  / __________ \  |__| \__\ \_____/ .io

  execution: local
     script: k6/smoke.js
     output: -

  scenarios: (100.00%) 1 scenario, 3 max VUs, 1m30s max duration (incl. graceful stop):
           * default: 3 looping VUs for 1m0s (gracefulStop: 30s)

     ✓ is status 200

     checks.........................: 100.00% ✓ 63       ✗ 0
     data_received..................: 64 kB   1.0 kB/s
     data_sent......................: 14 kB   230 B/s
     http_req_blocked...............: avg=23.46ms  min=429ns    med=1.02µs   max=497.35ms p(90)=1.64µs   p(95)=6.04µs
     http_req_connecting............: avg=981.06µs min=0s       med=0s       max=21.21ms  p(90)=0s       p(95)=0s
     http_req_duration..............: avg=1.94s    min=843.65ms med=1.68s    max=6.79s    p(90)=2.51s    p(95)=3.3s
       { expected_response:true }...: avg=1.94s    min=843.65ms med=1.68s    max=6.79s    p(90)=2.51s    p(95)=3.3s
     http_req_failed................: 0.00%   ✓ 0        ✗ 63
     http_req_receiving.............: avg=1.17s    min=195.64ms med=999.23ms max=4.6s     p(90)=1.72s    p(95)=2.7s
     http_req_sending...............: avg=196.88µs min=85.05µs  med=193.23µs max=441.94µs p(90)=279.88µs p(95)=313.9µs
     http_req_tls_handshaking.......: avg=2.01ms   min=0s       med=0s       max=45.97ms  p(90)=0s       p(95)=0s
     http_req_waiting...............: avg=770.95ms min=581.96ms med=638.86ms max=2.49s    p(90)=943.04ms p(95)=1.02s
     http_reqs......................: 63      1.006009/s
     iteration_duration.............: avg=2.97s    min=1.84s    med=2.68s    max=8.28s    p(90)=3.51s    p(95)=4.3s
     iterations.....................: 63      1.006009/s
     vus............................: 3       min=3      max=3
     vus_max........................: 3       min=3      max=3


running (1m02.6s), 0/3 VUs, 63 complete and 0 interrupted iterations
default ✓ [======================================] 3 VUs  1m0s
```
