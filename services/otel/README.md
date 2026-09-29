# OpenTelemetry Observability Pipeline

These are the deployed components that make up our OpenTelemetry observability
pipeline.

## Architecture

Currently we only use OpenTelemetry for traces. The pipeline is as follows
* API worker emits traces in JSON to a [diagnostic channel][diagnostic-channel].
* Instrumentation worker aggregates and serializes traces to OLTP JSON requests,
which are pushed to GCP PubSub.
* [OpenTelemetry collector][collector] reads the entries from PubSub and writes
  all traces to an o11y-specific ClickHouse database, while exporting only
  benchmark-tagged spans to Datadog APM

We manage the collector instances with the
[OpenTelemetry Kubernetes Operator][k8s-operator].

## Local development

`wrangler dev` does not run `tail_consumers`, so locally the instrumentation
worker never sees the diagnostic channels and every span, statsd metric and
console line is dropped. To close that gap, two dev-only exporters POST OTLP
straight to a local collector: `packages/cloudflare/instrumentation/dev-span-exporter.ts`
for spans, and `dev-log-exporter.ts` for logger output and statsd.

```text
cfw-* worker ─ otel_traces channel ─► dev-span-exporter ─┐
             ─ logger + statsd ─────► dev-log-exporter ──┤ OTLP/HTTP
                                                         ▼
                                             otel-collector :4318
                                                ├──► Jaeger :16686 (traces)
                                                ├──► Prometheus :8889 (metrics)
                                                └──► .dev/otel/logs.jsonl (logs)
```

Head sampling is already 100% in development, so no configuration is needed
beyond starting the containers.

### Jaeger only (default)

In Tilt, press **enable telemetry** in the nav bar (or
`tilt enable jaeger otel-collector && tilt trigger jaeger && tilt trigger
otel-collector`). Then open <http://localhost:16686> and pick the `cfw-api`
service.

### Datadog export

Local traces never go to Datadog: the pipeline samples nothing, so APM cost
would scale with every laptop. Under `tilt up -- --interns` the collector
exports the intern containers' `service:ori` logs and metrics to Datadog,
tagged `env:local` and `developer.id`, and drops everything else before the
exporter — worker statsd shares production metric names that many production
monitors read without an `env:` filter. See the Datadog export section of
`.agents/skills/local-intern-chat/SKILL.md`.

The key is written to a gitignored `dev/.datadog-export.env` (mode 600) that
only the collector container reads, rather than being injected into Tilt's
process environment — everything Tilt spawns inherits that environment, so a
live key there would spread well beyond the one container that needs it.

### Generating traffic for free

To exercise traces without paying for inference, route to the local
fake-provider instead of a real one:

```sh
tilt enable fake-provider && tilt trigger fake-provider
bun run x scripts/use-local-fake-provider.ts
```

That repoints `providers.base_url` for `FakeProvider` at `localhost:3002`,
re-warms KV, and restarts cfw-api (which caches the router config per isolate).
`--remote` reverts to the seeded Cloud Run URL.

Then request `openai/gpt-4.1-2025-04-14`, pinning the provider so the router
does not fail over to a paid endpoint:

```sh
curl http://localhost:8787/api/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer sk-or-v1-unlimitedkey' \
  -d '{
    "model": "openai/gpt-4.1-2025-04-14",
    "provider": { "order": ["fake-provider"], "allow_fallbacks": false },
    "messages": [{ "role": "user", "content": "trace me" }],
    "max_tokens": 64
  }'
```

Pass `max_tokens`. Without it, a non-streaming request against the fake
provider comes back HTTP 200 with a body of nothing but keep-alive whitespace
and no JSON — the trace is still emitted, but the response is unusable. This
reproduces with the tracing exporter removed, so it is a pre-existing cfw-api
quirk on this path rather than anything tracing-related. Streaming
(`"stream": true`) is unaffected. The caveat is about the body field, not the
generated length — it reproduced back when the fake provider defaulted to its
own token count, so `X-Completion-Tokens` alone does not substitute for it.

`X-Completion-Tokens` is how many tokens you want the fake provider to
generate, defaulting to 300 when the header is absent or invalid. The body's
`max_tokens` still limits the response, so a smaller `max_tokens` wins.
Pass the header when you want an output length other than 300.

The upstream call is an ordinary `fetch`, so it still produces a CLIENT span
(`POST http://localhost:3002/v1/chat/completions`) — the span tree has the same
shape as a real provider's. Pinning also keeps the trace small: one
`or.endpoint.attempt` instead of the several a fallback chain produces.

`services/fake-provider/README.md` documents headers for shaping the upstream
response (`X-Completion-Tokens`, `X-Per-Chunk-Delay-Ms`, `X-Is-Upstream-SSE`,
`X-Simulate-Mid-Stream-Error`, `X-Reasoning-Tokens`), which is how to get
realistic streaming or error traces on demand.

### Worktrees

The collector's OTLP/HTTP receiver and the Jaeger UI resolve through the
Tiltfile's `_port()` helper (`OTEL_OTLP_HTTP_PORT`, default 4318;
`JAEGER_UI_PORT`, default 16686), so `bun run dev:ports on` isolates them per
worktree along with the app ports, and two worktrees can run trace pipelines
side by side. The Jaeger UI link in Tilt follows the resolved port.

Note the collector's other host ports (4317 gRPC, 8888, 13133, …) are still
fixed, matching every other `dev/docker-compose.*.yaml` — only the two the dev
loop actually uses are overridable. A second concurrent collector needs those
freed too, so run one collector per machine unless you also override them.

### Notes

* Three kinds of dev-only span are dropped by a `filter` processor, none of
  which exist in production: `dev-fs-logs` calls (~300 of the ~370 spans in one
  chat-completion trace), `GET /health` (Tilt's readiness probe), and the
  unnamed `cf.wait_until` fallback along with the `dev_fs_log_write` task that
  wraps each of those log writes. Every other named task uses
  `cf.wait_until <task>` with a `cf.wait_until.task` attribute and remains visible
  in Jaeger. To get the dropped spans back, comment the matching line out of
  `dev/otel-collector-config.yaml` and restart the collector.
* Spans are **not** benchmark-gated locally. The prod collector forwards only
  `or.benchmark.trace` spans to Datadog; the dev config deliberately omits that
  `filter/benchmark`, so no `x-benchmark-trace` header is needed and nothing
  needs enabling per-request.
* `curl http://localhost:8888/metrics | grep otelcol_exporter_sent_spans` shows
  (`$OTEL_COLLECTOR_TELEMETRY_PORT` rather than 8888 on a worktree running
  `bun run dev:ports on`)
  per-exporter counts — the quickest way to distinguish "not exported" from
  "exported but hard to find in the UI".

  **The `datadog` exporter's `sent_*` counters alone do not prove Datadog
  accepted the data.** They count records handed to the exporter, and still
  increment when Datadog rejects the payload. Verified against a deliberately invalid key: `sent_spans` went to 1
  while the log showed `403 Forbidden` and `Dropping Payload`. To confirm
  acceptance, check the collector log instead:

  ```sh
  # Should print "API key validation successful." and nothing else.
  docker logs dev-otel-collector-1 2>&1 \
    | grep -iE "API key validation|Dropping Payload|rejected by edge|non-retryable"
  ```

  The read-only `DD_API_KEY`/`DD_APP_KEY` in Infisical are scoped to logs, so
  the Datadog spans-search API returns 403 and cannot be used to verify this
  from the outside.

[diagnostic-channel]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/diagnostics-channel
[collector]: https://github.com/open-telemetry/opentelemetry-collector
[k8s-operator]: https://github.com/open-telemetry/opentelemetry-operator
