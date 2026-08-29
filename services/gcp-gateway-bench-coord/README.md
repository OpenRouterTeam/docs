# GCP Gateway Bench Coord

Cloud Run service that orchestrates per-region gcp-gateway-bench-runner
fan-outs. Accepts a chat completions request, looks up each configured
gateway or provider API key, dispatches the same request to every runner in
parallel, aggregates per-region latency, and writes a row per region
to a ClickHouse table.

Single-region deploy (us-central1). Scaled to zero, max 4 instances.

## Endpoints

### `POST /run-benchmark`

Request body is a pass-through OpenAI chat completions body (must
contain `model` and `messages`; everything else is forwarded to the
gateways — arms that use the Anthropic Messages API translate OpenAI
fields to the Anthropic wire format first). The optional `routing`
field controls the routing
preference (`default`, `price`, `throughput`, `latency`):

```json
{
  "model": "openai/gpt-4o-mini",
  "messages": [{"role": "user", "content": "say hi"}],
  "max_tokens": 50,
  "routing": "latency"
}
```

The coord fans out this body to **every enabled gateway × every
deployed runner region** in parallel. Enabled gateways are those whose
API key (and base URL, for Cloudflare) are set on the coord. Supported
gateway names: `openrouter`, `vercel`, `cloudflare`, `anthropic`, `openai`.
Anthropic and OpenAI are direct-provider baseline arms: they call the
provider APIs directly rather than through a gateway and have no
upstream-provider pin or routing preference.

Response (200, synchronous — blocks until all calls complete):

```json
{
  "run_id": "...",
  "model": "openai/gpt-4o-mini",
  "started_at": "...",
  "finished_at": "...",
  "enabled_gateways": ["openrouter", "vercel"],
  "results": [
    {
      "gateway": "openrouter",
      "region": "us-central1",
      "runner_url": "...",
      "status": 200,
      "metrics": {
        "ttfbMs": 287,
        "ttftMs": 312,
        "totalDurationMs": 1450,
        "promptTokens": 12,
        "outputTokens": 34,
        "totalTokens": 46
      },
      "responseHeaders": {"...": "..."},
      "location": "us-central1",
      "cloudProvider": "gcp",
      "coordinates": {"lat": 41.59, "lon": -93.62},
      "error": null,
      "warmup_error": null,
      "coord_error": null
    }
  ],
  "ingest": {
    "enabled": false,
    "rows_inserted": 0,
    "error_message": null
  }
}
```

Warm rows prime the exact inference URL with a credential-free `HEAD` request.
`warmup_error` is set only when priming fails and the inference request is
skipped. Warmup-failed rows are retained in raw results but excluded from
benchmark aggregates.

Each result is independently fail-soft: a 5xx, network error, or coord
auth failure on one (gateway, region) pair doesn't poison the rest.
`error` carries upstream gateway/provider failures; `coord_error`
carries fanout-side issues (e.g. ID-token mint failure, fetch error,
unparseable response).

### `POST /tick`

Scheduler-driven endpoint. Queries `gateway_benchmark_schedules` for due schedules (using `SELECT ... FOR UPDATE SKIP LOCKED`), stamps them as running, and dispatches `/run-benchmark` for each. The schedule's `model` field is injected into the request body before fanout. Called by Cloud Scheduler via the coord's own service account.

### `POST /schedules/:id/run-now`

Manually triggers a single schedule by ID. Looks up the schedule from `gateway_benchmark_schedules`, injects its `model` into the request body, and dispatches `/run-benchmark`. Used by Mission Control's "Run Now" button.

## Configuration versioning

Every ClickHouse result row includes `prompt_version` and `mapping_set_version`. These identify the immutable
configuration snapshots used for that benchmark: the prompt is the exact request body sent to the runners, and the
mapping version covers the complete enabled model-mapping set.

ClickHouse uses `0` as the unknown sentinel for rows written before configuration versioning or when registration
fails. The corresponding Postgres benchmark run stores `NULL` for each version whose registration failed, so a
registration problem never prevents the run from being recorded.

To reconstruct a run's configuration, resolve the version numbers in Postgres:

- `prompt_version` → `gateway_benchmark_prompt_versions.version` and its `request_body`
- `mapping_set_version` → `gateway_benchmark_mapping_set_versions.version` and its `mappings`

## Local usage

The service runs on port `8678` and boots with no required env vars
(everything has a default, ClickHouse insert is gated off). All gateway
API keys are optional — the coord skips any gateway whose key is unset.

### Tilt (full local stack)

The recommended path. `bun run dev` is wrapped with `infisical run`
against `/services/gcp-gateway-bench-coord`, so all gateway keys,
ClickHouse creds, and `OPENROUTER_BASE_URL` are injected from
Infisical. The coord and runner resources are manual-trigger; the
local ClickHouse comes up via the `clickhouse` Docker Compose
resource.

```bash
tilt up
tilt trigger gateway-bench-runner   # port 8677
tilt trigger gateway-bench-coord    # port 8678
```

Once both runners are green, fire a benchmark:

```bash
curl -X POST http://localhost:8678/run-benchmark \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }' | jq
```

The response includes `ingest.rows_inserted: 1` once the
ClickHouse insert lands. Inspect rows via the ClickHouse Play UI
at <http://localhost:8123/play>:

```sql
SELECT * FROM default.gateway_benchmark_results
ORDER BY started_at DESC
LIMIT 10;
```

### Boot (standalone, without Tilt)

```bash
bun run --filter @openrouter-monorepo/gcp-gateway-bench-coord dev
```

You should see a single log line:

```text
GCP gateway-bench-coord starting on port 8678 (location=unknown)
```

The `missing DD_API_KEY` warning above it is expected — telemetry is a
no-op locally.

### Health check

```bash
curl http://localhost:8678/healthz
# → {"status":"ok"}
```

### Trigger a benchmark

With no gateway keys set, `/run-benchmark` short-circuits to a `400`
before runner discovery — useful for confirming the validation chain:

```bash
curl -sS -X POST http://localhost:8678/run-benchmark \
  -H 'content-type: application/json' \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "hi"}]
  }'
# → 400 with body:
# {"error":{"message":"no gateways configured — set at least one gateway API key (OPENROUTER_API_KEY, VERCEL_AI_GATEWAY_API_KEY, CLOUDFLARE_AI_GATEWAY_API_KEY + CLOUDFLARE_ACCOUNT_ID, ANTHROPIC_API_KEY, or OPENAI_API_KEY)"}}
```

To exercise the full fanout path, set at least one real gateway key
(the runner will use it to authenticate to the upstream gateway):

```bash
OPENROUTER_API_KEY=sk-or-... \
  bun run --filter @openrouter-monorepo/gcp-gateway-bench-coord dev
```

```bash
curl -sS -X POST http://localhost:8678/run-benchmark \
  -H 'content-type: application/json' \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "hi"}]
  }' | jq
```

Two outcomes are interesting on a workstation (no Cloud Run metadata
server reachable):

- **`runner discovery failed: ...`** (`502`) — expected locally. The
  coord's metadata-server access-token fetch fails because the
  `metadata.google.internal` host doesn't resolve outside GCP. Confirms
  everything up to discovery wires correctly.
- **`no gcp-gateway-bench-runner services found ...`** (`502`) — only
  reachable on a GCE/Cloud Run host with API access but no runners
  deployed in the target project.

Once deployed to Cloud Run, you'll get a `200` with one result per
(gateway × region) call, each carrying full BenchmarkResult metrics
(`ttfbMs`, `ttftMs`, `totalDurationMs`, token counts, `num_providers_tried`, response headers).

### Run the test suite

```bash
cd services/gcp-gateway-bench-coord
bun test
```

`src/index.test.ts` covers `/healthz`, invalid-JSON rejection, and
missing `model`/`messages`. `src/gateways/registry.test.ts` covers
gateway enablement logic. `src/routes/tick.test.ts` covers
`isStillRunning` and `buildRequestBody` (model injection into
`request_body` before fanout). The fanout itself isn't unit-tested
yet — it makes real HTTPS calls to the runner, which is
integration-tested in production.

## Status

- Runner fanout: **live**. Coord mints Google-signed ID tokens for each
  runner audience via the metadata server (cached 50 min), POSTs to
  `<runner>/api/v1/chat/completions` with the per-gateway headers, and
  parses `BenchmarkResult` shapes back. Each (region × gateway) call is
  independently fail-soft.
- ClickHouse insert: **live** when `CLICKHOUSE_URL`/`USERNAME`/`PASSWORD`
  are set in Infisical. Row shape in `src/clickhouse/insert.ts`
  (`BenchmarkRow`) carries the full runner metrics plus response body and
  headers for all supported gateways, aligned with
  `packages/clickhouse/migrations/123_add_gateway_benchmark_results.sql`.
- Telemetry / logging: wired to `@openrouter-monorepo/cloudrun/telemetry`
  and `@openrouter-monorepo/instrumentation` (same shape as `services/auth`).
- DataDog metrics: **live** when `DD_API_KEY` is set. Emits per-result
  histogram/counter metrics under the `openrouter.gateway_bench.gateway.*`
  namespace (e.g., `openrouter.gateway_bench.gateway.ttfb`,
  `openrouter.gateway_bench.gateway.total_duration`,
  `openrouter.gateway_bench.gateway.tps`, and
  `openrouter.gateway_bench.gateway.warmup_error.count`) tagged by gateway, region,
  model, status, routing, and runner geo coordinates (`runner.lat`, `runner.lon`).
  Metrics are submitted directly to the Datadog series/distribution_points
  intake (counters as `/api/v1/series`, latency/token distributions as
  `/api/v1/distribution_points`); submission is skipped when `DD_API_KEY`
  is unset.

## Hitting a deployed instance

Coord runs with `invoker_iam_disabled = true` and verifies auth at the
application layer via `src/middlewares/oidc.ts` (dual-issuer:
Vercel-MC + Google SA callers). The middleware checks:

1. The JWT's `aud` claim matches the custom audience
   `openrouter-internal-api` (Google branch) or the Vercel audience.
2. The JWT's `email` is in `GOOGLE_OIDC_ALLOWED_EMAILS` (Google
   branch) or the `owner`/`project` matches `VERCEL_OIDC_*` allowlists
   (Vercel branch).

Currently in `GOOGLE_OIDC_ALLOWED_EMAILS` (Infisical):

- `mission-control-worker@openrouter-core.iam.gserviceaccount.com`
- `coord-scheduler@openrouter-core.iam.gserviceaccount.com`
- `gcp-gateway-bench-runner-coord@openrouter-core.iam.gserviceaccount.com`

Two ways to call the coord by hand:

### Option A: Quick test via gcloud's built-in proxy

Easiest for one-off checks. The proxy handles the OIDC token dance
with your user creds transparently. Works because `engineering@` is
still bound to `roles/run.invoker` and the proxy mints a token under
the hood that the middleware accepts.

```bash
# Terminal 1: start the proxy on localhost:8080
gcloud run services proxy gcp-gateway-bench-coord \
  --region=us-central1 --project=openrouter-core

# Terminal 2: hit the local proxy (no token needed — proxy injects it)
curl -i -X POST http://localhost:8080/run-benchmark \
  -H "content-type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "hi"}]
  }'
```

### Option B: Impersonate an allowlisted SA

Requires `roles/iam.serviceAccountTokenCreator` on the target SA,
which is granted to `engineering@openrouter.ai` via the runner
module's `infra/iam.tf`.

Two flags matter and must both be set:

- `--audiences="openrouter-internal-api"` — the middleware checks the
  JWT's `aud` claim against this exact string (the value of
  `GOOGLE_OIDC_AUDIENCE` in Infisical). It is NOT the Cloud Run URL.
- `--include-email` — without this, `print-identity-token` omits the
  `email` and `email_verified` claims. The middleware's claim parse
  requires both; without them you get a 404 from
  `verifyGoogleOidcToken.parseClaims`.

```bash
SA=gcp-gateway-bench-runner-coord@openrouter-core.iam.gserviceaccount.com && \
URL=$(gcloud run services describe gcp-gateway-bench-coord \
  --project=openrouter-core --region=us-central1 \
  --format='value(status.url)') && \
TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account=$SA \
  --audiences="openrouter-internal-api" \
  --include-email) && \
curl -i -X POST "$URL/run-benchmark" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "hi"}]
  }'
```

Token good for ~1 hour.

### Smoke-test response codes

With a valid token + valid body, expect `200` plus per-(region,
gateway) result rows.

The middleware returns a single HTTP status — **404 with empty body
and `content-type: text/html`** — for **every** auth failure mode,
deliberately, so unauthenticated probers see "endpoint does not exist"
rather than "endpoint exists but you can't use it." That means a
debugging 404 could be any of:

- No `Authorization` header
- `Authorization` header not `Bearer …`
- Token isn't a parseable JWT
- Signature didn't verify against Google's or Vercel's JWKS
- `aud` doesn't match (`GOOGLE_OIDC_AUDIENCE` /
  `VERCEL_OIDC_AUDIENCE`)
- Claims schema parse failed (Google: missing `email`, missing
  `email_verified: true`, or non-`accounts.google.com` `iss`;
  Vercel: missing `owner` / `project` / `environment`)
- Email not in `GOOGLE_OIDC_ALLOWED_EMAILS`
- Vercel `owner` mismatch / `project` not in
  `VERCEL_OIDC_ALLOWED_PROJECTS`

The actual reason lives in the container logs as an `ErrorT` with
`status: 401` and a `location` field that identifies the failure mode.
The status code in the log is the *internal* classification — it does
NOT escape as a 401 HTTP response. Useful log `location` values
(grep these in Cloud Logging):

| `location` | Meaning |
| --- | --- |
| `oidcMiddleware.decodeJwt` | Token isn't a parseable JWT |
| `verifyGoogleOidcToken.jwtVerify` | Google signature / aud / exp mismatch |
| `verifyGoogleOidcToken.parseClaims` | Google claims missing or wrong type |
| `verifyGoogleOidcToken.emailCheck` | Google `email` not in allowlist |
| `verifyOidcToken.jwtVerify` | Vercel signature / aud / exp mismatch |
| `verifyOidcToken.parseClaims` | Vercel claims missing or wrong type |
| `verifyOidcToken.ownerCheck` | Vercel `owner` mismatch |
| `verifyOidcToken.projectCheck` | Vercel `project` not in allowlist |
| `verifyOidcToken.environmentCheck` | Vercel environment mismatch |

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="gcp-gateway-bench-coord"
   AND jsonPayload.location:verify' \
  --project=openrouter-core --limit=20 \
  --format='value(timestamp,jsonPayload.location,jsonPayload.rawError)'
```

A `200` (with valid body) means middleware passed and the handler
ran. A `403` from Cloud Run's frontend should not happen anymore
(`invoker_iam_disabled = true`); if it does, the IAM toggle has been
reverted in `cloudrun.tf`.
