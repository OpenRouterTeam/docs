# GCP Gateway Bench Runner Service

Lightweight benchmarking service that accepts OpenAI-compatible
`/api/v1/chat/completions` requests, forwards them through AI gateways
(OpenRouter, Vercel AI Gateway, Cloudflare AI Gateway), measures
performance metrics, and returns results as JSON.

Also serves `/hello` (public, IAM-gated) and `/healthz` (Cloud-Run-internal
probe path only — see "Hitting a deployed instance" below).

Streaming-only. Measures time to first byte (TTFB), time to first token of any
kind (TTFT), and time to first visible answer (TTVA). Tracks the number of
upstream providers tried per request
via gateway-specific metadata (OpenRouter `openrouter_metadata.attempts`,
Vercel `delta.provider_metadata.gateway.routing.totalProviderAttemptCount`, Cloudflare `cf-aig-step` header).
Captures full response body and headers for all supported gateways
for storage in ClickHouse. No workspace dependencies — designed to be
open-sourced independently.

## Supported gateways

| Gateway    | Header value   | Default base URL                          |
| ---------- | -------------- | ----------------------------------------- |
| OpenRouter | `openrouter`   | `https://openrouter.ai/api/v1`            |
| Vercel     | `vercel`       | `https://gateway.vercel.ai/v1`            |
| Cloudflare | `cloudflare`   | _(required via header — includes account/gateway IDs)_ |

## Local usage

```bash
bun run --filter @openrouter-monorepo/gcp-gateway-bench-runner dev
```

The service runs on port **8677**.

### Health check

```bash
curl http://localhost:8677/healthz
```

### Benchmark request

```bash
curl -X POST http://localhost:8677/api/v1/chat/completions \
  -H "X-Api-Key: $OPENROUTER_API_KEY" \
  -H "X-Benchmark-Gateway: openrouter" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello"}]
  }'
```

### Custom headers

| Header                           | Required | Description                                |
| -------------------------------- | -------- | ------------------------------------------ |
| `X-Api-Key`                     | Yes      | Upstream gateway API key                   |
| `X-Benchmark-Gateway`           | Yes      | `openrouter`, `vercel`, `cloudflare`       |
| `X-Benchmark-Gateway-Base-URL`  | CF only  | Cloudflare gateway base URL                |
| `X-Benchmark-Run-ID`            | No       | Correlation ID for the run                 |
| `X-Benchmark-Timeout-Ms`        | No       | Request timeout (default 120 000 ms)       |
| `X-Benchmark-Routing`           | No       | Routing option (`default`, `price`, `throughput`, `latency`) |
| `X-Benchmark-Trace-Key`         | No       | When targeting OpenRouter, enables trace origination when it matches the worker's `BENCHMARK_TRACE_KEY` |

When `X-Benchmark-Trace-Key` is present for an OpenRouter request, the runner
generates a sampled W3C `traceparent`, forwards it with the
`X-Benchmark-Trace-Key` value as `x-benchmark-trace`, and records the trace ID.
OpenRouter stream generation IDs are recorded alongside the metrics. Other
gateways and requests without the header record null trace and generation IDs.

### Response

```json
{
  "run_id": null,
  "gateway": "openrouter",
  "model": "openai/gpt-4o-mini",
  "started_at": "2025-05-20T12:00:00.000Z",
  "routing": "default",
  "upstream_provider_requested": null,
  "upstream_provider_used": null,
  "runner_location": null,
  "runner_cloud_provider": "gcp",
  "runner_latitude": 37.7749,
  "runner_longitude": -122.4194,
  "ttfb": 150.2,
  "ttft": 320.5,
  "ttva": 450.7,
  "reasoning": false,
  "total_duration": 1200.8,
  "tokens_prompt": 10,
  "tokens_completion": 42,
  "num_providers_tried": 1,
  "warmup_error": null,
  "status": 200,
  "error": null
}
```

Warm requests prime the exact inference URL with a credential-free `GET`
request before measuring the `POST`. A non-2xx warmup response is acceptable
because only the socket is used. If priming fails, the response is `502` with
`warmup_error` set and `error` set to `null`; no inference request is sent.

Timing fields are measured from request start:

- `ttfb`: response headers (first byte).
- `ttft`: first non-empty token of any supported kind, including reasoning or
  thinking.
- `ttva`: first non-empty visible answer token; reasoning and thinking do not
  count.

## Testing

```bash
bun run --filter @openrouter-monorepo/gcp-gateway-bench-runner test
```

### Hello

```bash
curl http://localhost:8677/hello
```

Response (JSON):

```json
{
  "location": "unknown",
  "cloud_provider": "unknown",
  "revision": "unknown",
  "received_at": "2026-05-20T17:30:00.000Z"
}
```

`location` and `cloud_provider` are explicit-override env vars
(`RUNNER_LOCATION`, `RUNNER_CLOUD_PROVIDER`) injected by Terraform — set
to the deployment region (e.g. `us-central1`) and the platform (`gcp`)
respectively. An AWS or Azure twin of this service would set the same
vars with `aws` / `azure`. `revision` is the Cloud Run revision name
(e.g. `gcp-gateway-bench-runner-00003-abc`), auto-set by Cloud Run as
`K_REVISION`. All three fall back to `"unknown"` locally where no env
vars are set.

This is what external clients use to exercise the service — `/healthz`
is intercepted by Cloud Run on deployed instances (see below).

## Hitting a deployed instance

Each region has its own Cloud Run service named `gcp-gateway-bench-runner`.
The services are private — only the `gcp-gateway-bench-runner-coord` service
account is bound to `roles/run.invoker`, so requests need a Google-signed
ID token with that SA's email in the claim. Browser hits and unauthed
curls get a `403` at the Cloud Run frontend.

External clients must hit `/hello`, not `/healthz`. Cloud Run reserves
"some paths ending with z" ([known issues][cr-known-issues]) and
intercepts `/healthz` before it reaches the container, returning `404`
regardless of auth. We keep `/healthz` in the app for use as Cloud Run's
internal startup and liveness probe — probes reach the container from
outside its loopback (so the server binds `0.0.0.0`) but bypass the
reserved-path filter, which only applies at the Cloud Run frontend.

[cr-known-issues]: https://cloud.google.com/run/docs/known-issues

### Quick test (europe-west1)

Requires `roles/iam.serviceAccountTokenCreator` on the coord SA —
granted to `engineering@openrouter.ai` via `infra/iam.tf`.

```bash
gcloud auth login
SA=gcp-gateway-bench-runner-coord@openrouter-core.iam.gserviceaccount.com
URL=$(gcloud run services describe gcp-gateway-bench-runner \
  --project=openrouter-core --region=europe-west1 \
  --format='value(status.url)')
TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account=$SA --audiences=$URL)
curl -H "Authorization: Bearer $TOKEN" "$URL/hello"
```

`--audiences` must match the service URL exactly — Cloud Run validates
the `aud` claim against the request host. Token is good for ~1 hour.
Swap `--region=europe-west1` to hit a different region; list all
deployed regions with:

```bash
gcloud run services list \
  --project=openrouter-core \
  --filter=metadata.name=gcp-gateway-bench-runner \
  --format='table(region,status.url)'
```

### Benchmark request against a deployed runner

Requires `OPENROUTER_API_KEY` exported in your shell. The response body
carries `metrics.{ttfbMs, ttftMs, totalDurationMs}` — no need to wrap
`curl` in `time`.

```bash
SA=gcp-gateway-bench-runner-coord@openrouter-core.iam.gserviceaccount.com; \
URL=$(gcloud run services describe gcp-gateway-bench-runner \
  --project=openrouter-core --region=europe-west1 \
  --format='value(status.url)'); \
TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account=$SA --audiences=$URL); \
curl -sS -X POST "$URL/api/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Api-Key: $OPENROUTER_API_KEY" \
  -H "X-Benchmark-Gateway: openrouter" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello"}]
  }' \
  | jq .
```

### Troubleshooting

- `403 Forbidden, "The request was not authorized..."` — the token's
  audience doesn't match the service URL, or the SA isn't bound to
  `roles/run.invoker` on the target service. Double-check `--audiences`
  matches the URL exactly (no trailing path, no port).
- `401 Unauthorized` — token is missing, malformed, or expired. Re-mint.
- `Permission 'iam.serviceAccounts.getOpenIdToken' denied` — your user
  doesn't have `roles/iam.serviceAccountTokenCreator` on the coord SA.
  Confirm you're in `engineering@openrouter.ai` (or request the grant).
