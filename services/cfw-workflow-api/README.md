# Workflow API

Synchronous workflow execution worker. `POST /api/v1/workflows/runs` accepts an
inline graph and inputs, then returns declared outputs and per-node results.
This endpoint is internal-only in v1 and is deliberately absent from the
unified public OpenAPI specification.

Model nodes call the existing public modality endpoints over HTTP and forward
the caller's `Authorization` header unchanged. The worker never logs or
persists that header. V1 media is passed inline as a URL, data URI, or an
explicitly typed base64 object because this service has no workflow or media
storage; audio input and output are subject to the configured size cap and
outputs are never truncated.

In the local Tilt stack, the workflow worker receives `WORKFLOW_*_BASE_URL`
overrides that point all child calls at the local `cfw-api` port. Direct
`wrangler dev` runs use the public `https://openrouter.ai` defaults from
`wrangler.toml`; use the same local overrides when running the worker manually.

Workflow limits are read from the `workflow_limits` LiveConfig key, with
conservative environment defaults. `max_total_cost_usd` is a stop-loss based on
completed child costs: a node already in flight can overshoot because exact
provider usage is unavailable before execution.
Speech responses expose no synchronous cost, so speak nodes use the service
estimate for stop-loss accounting and report it separately from billed cost.

V1 intentionally does not accept an `idempotency_key`; runs are synchronous and
are not stored for replay or polling.

The v1 node palette is flat: `chat`, `embed`, `rerank`, `transcribe`, `speak`,
`vision`, `parse_file`, `classify`, `router`, `branch`, and `transform`.
Product inference nodes desugar onto chat requests before the child call;
`parse_file` leaves file parsing to the existing router plugin.

The request reserves `stream` for a future SSE mode. It currently accepts only
`false` (or an omitted field); `true` is rejected. When streaming is added, the
event vocabulary will reuse Dify's names: `workflow_started`, `node_started`,
`node_finished`, `workflow_finished`, `text_chunk`, `error`, and `ping`.
`ping` is a keepalive for long runs. `node_finished` will carry the same
per-node record as the blocking response and will discriminate success, failure,
and skip through its `status` field.
