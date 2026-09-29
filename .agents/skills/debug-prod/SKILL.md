---
name: debug-prod
description: >-
  Investigate production inference issues using Datadog logs and the ClickHouse
  inference tables. Given a Clerk user or org ID, generation ID, provider or
  endpoint, model slug, or a free-text symptom, runs targeted queries to surface
  transaction outcomes, provider errors, upstream status codes, raw error bodies,
  timeline metrics, retry amplification, and model/endpoint availability.
  Returns a structured RCA-ready summary.
  TRIGGER when: any request mentions querying Datadog or ClickHouse for
  inference, endpoint or model health; a prod issue, customer complaint, error
  spike, 429/rate-limit or capacity question; an availability or uptime drop
  (including a provider disputing our dashboard); or "what happened with
  generation X / user Y".
user-invocable: true
---

# Debug Prod

Investigate production issues by querying Datadog logs (MCP or HTTP API) with
the correct OpenRouter log schema, and the ClickHouse inference tables for
volume, attribution, and availability.

> **⚠️ Log retention is 14 days.** Datadog only retains logs for 14 days.
> Queries beyond 14 days ago return empty results due to retention, not because
> no events occurred. Never assert "zero errors in period X" for windows older
> than 14 days. When reporting trends, explicitly state the retention boundary
> and only draw conclusions within the valid window.

## Prerequisites

Two interchangeable Datadog paths — use whichever answers the question:

- **Datadog MCP.** Run `mcp_tool(command="list_servers")` and confirm `datadog`
  is listed.
- **Datadog HTTP API (us5), equally valid.** Use it directly when the MCP is
  unavailable, when an MCP tool errors, or when you need an aggregation the MCP
  does not expose. `DD_API_KEY` and `DD_APP_KEY` are in the session environment.
  A failing MCP is not a reason to stop.

```bash
curl -sS https://api.us5.datadoghq.com/api/v2/logs/events/search \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -H 'Content-Type: application/json' -d '{
    "filter": {"query": "<QUERY>", "from": "<ISO8601>", "to": "<ISO8601>"},
    "page": {"limit": 50}
  }'
```

The response carries `meta.page.after` whenever more logs match. Pass it back as
`page.cursor` and keep going until it is absent, or say the result is truncated
— a single page silently looks like the whole timeline. For counts and
group-bys prefer `/api/v2/logs/analytics/aggregate`, whose body takes `compute`
and `group_by` arrays; a bare `aggregation` field is rejected. An ungrouped
compute returns one scalar bucket, but a grouped aggregate pages the same way —
follow `meta.page.after` until it is absent. Grouped aggregate paging stops at
1,000 results, so split a wider aggregation by time or group value rather than
reporting the first page as the whole picture.

- **ClickHouse.** The analytics MCP works for the `analytics.*` daily rollups,
  but the inference tables in the `default` database are best queried over HTTP
  with the read-only credentials in the environment
  (`CLICKHOUSE_URL`, `CLICKHOUSE_READONLY_USER`, `CLICKHOUSE_READONLY_PASSWORD`).
  Append `FORMAT TSVWithNames` to every query.

## Important: Service Names

In production Datadog, a Cloudflare Worker's service name is **not** its worker
name. `cfw-api` logs land under `service:api`.

**The intern platform is the exception.** `cfw-secret-vault` and
`cfw-intern-provisioner` land under `service:cfw-secret-vault` and
`service:cfw-intern-provisioner` — not `service:api`
(`packages/instrumentation/log-service.ts`). A `service:api` query returns
nothing for either, silently, which bites hardest mid-incident. Each service
holds one worker, so no `@script_name` qualifier is needed. `service:interns`
is a third thing: the intern VMs.

The other modality workers (`cfw-video-api`, `cfw-image-api`, `cfw-stt-api`,
`cfw-tts-api`, `cfw-rerank-api`, `cfw-embeddings-api`) also log under
`service:api`, so isolating one needs a `@script_name` qualifier, for example
`service:api @script_name:video-api`. APM is the other way round: trace metrics
and span search key on the worker name (`service:cfw-video-api`), so a log query
copied from a trace query returns nothing.

The queries below are cfw-api drill-downs, so they are correctly scoped to
`service:api`. If unsure which services exist, run `get_all_services` first.

## Inputs

Determine the investigation type from the user's request:

- **Generation ID** (e.g. `gen-1234567890-abc123`) — single generation drill-down
- **Clerk user ID** (e.g. `user_abc123` or `org_abc123`) — recent generations for a user/org
- **Symptom / provider name** — broader error pattern search

Set the time window. Default to the last 24 hours unless the user specifies
otherwise:

```text
NOW_S = current epoch seconds
FROM_S = NOW_S - 86400   (24h ago)
TO_S = NOW_S
```

For narrow investigations (single generation), shrink to ±2 hours around the
known timestamp if available.

## Query Patterns

All queries use the Datadog MCP `get_logs` tool:

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "<QUERY>", "from": <FROM_S>, "to": <TO_S>, "limit": <LIMIT>}'
)
```

### By generation ID (breadcrumbs)

```text
@breadcrumbs.generation_id:<gen_id>
```

Use when you have a specific generation ID. Returns logs that carry breadcrumbs
(Transaction attempt, Endpoint returned error, adapter error logs).

For a direct OpenAI BYOK request, the same logs carry
`@breadcrumbs.byok_upstream_region` (`global`, `us` or `eu`): the OpenAI host
OpenRouter selected once the key resolved. Read it against the request
hostname's required region and the key's `declared_region`; a mismatch is a
routing bug. It is absent when the request failed before upstream selection,
and only a direct OpenAI BYOK attempt sets it. Breadcrumbs are merged across
the whole invocation, so after an OpenAI BYOK attempt fails and another
endpoint serves the request, the serving attempt's log still carries the
failed attempt's region: pair the value with the OpenAI attempt's own
Transaction attempt log, not with whichever attempt served. It proves
which OpenAI host we called, not where OpenAI processed the request or that the
customer's project has a data-residency guarantee, which OpenRouter does not
verify. The full upstream URL is only in local and preview
`adapters/base-fetch-request` FS logs, never in production telemetry.

### Full sweep by generation ID (no breadcrumbs)

```text
*:<gen_id>
```

Use as a second pass — catches logs that reference the gen ID anywhere but don't
carry breadcrumbs (e.g. agent-route errors, middleware logs). Run this when the
breadcrumbs query misses the error the customer reported.

**Important:** This is a free-text wildcard search across all fields and can be
slow/expensive on wide time windows. Always narrow to ±2 hours around the
timestamp found in the primary breadcrumbs query before falling back to this
pattern. Only widen if the narrow window returns nothing.

### By CF ray ID (Cloudflare request identifier)

```text
@cf_ray_id:<ray_hex>
```

Use when the report gives a Cloudflare ray ID (from a browser 5xx page, a
support ticket, or a `cf-ray` response header). This is often the fastest way
to pin the exact failing request, including non-generation 5xx errors that
never produce a `Transaction attempt` (edge/route errors, `toHonoErrorResponse`
500s).

**Gotchas (these cost real time if you get them wrong):**

- `cf_ray_id` is a **top-level** attribute (`@cf_ray_id`), *not* under
  `@extra.` or `@breadcrumbs.`.
- Datadog stores the ray **without** the `-<COLO>` datacenter suffix. A ray
  shown as `a1f483fdb8876798-SJC` is stored as `a1f483fdb8876798` — strip the
  `-SJC` / `-FRA` / etc. before querying.
- Free-text search (`*<ray>*` or `"<ray>"`) does **not** match `cf_ray_id`;
  it is not full-text indexed. You must use the `@cf_ray_id:` facet.
- The same ray appears on multiple log lines for one request (error-level +
  info-level breadcrumb logs). Read the `error`-level line for the failure
  message and `extra.location` / `extra.message`; the `breadcrumbs` object
  carries `generation_id`, `model`, `preset_slug`, `response_status`, etc.

Once you have the `generation_id` from the breadcrumbs, pivot to the
generation-ID queries above for the full picture. Note that server-tools /
edge 500s (e.g. a `response.incomplete` whose reason isn't recognized as a
truncation, mapped to HTTP 500 in
`packages/router/plugins/server-tools/map-sdk-events.ts`) may have **no**
`Transaction attempt` or `Endpoint returned error` log — the top-level
`@cf_ray_id` error line is the primary evidence.

### Server-tools internal loop turns (sibling generations)

A server-tools `/responses` request runs its model turns as **separate
loopback generations** that carry no lineage field pointing at the outer
generation (the `parent_generation_id` breadcrumb is only stamped by
spawning tools like fusion/image-gen, not by loop turns). The outer
generation logs no `Transaction attempt` of its own (`No adapter
constructed` is its normal end-of-request accounting), so an error in a
follow-up turn is invisible under the outer gen ID.

To find the loop turns: pull `@breadcrumbs.clerk_user_id` from any outer-gen
log, then query that entity + `@breadcrumbs.model:*<model>*` in a ±20s
window around the outer request. Turn 1 shares the outer gen's epoch prefix
(`gen-<same-epoch>-...`); the follow-up turns start seconds later. A
follow-up that 400s upstream logs `Endpoint returned error` (raw provider
body in `extra.raw`) under its own gen ID while the outer stream still
closes with a clean `response.completed` (DEV-873).

### By user ID (Clerk entity ID)

```text
@breadcrumbs.clerk_user_id:<entity_id> "Transaction attempt"
```

Use when the report includes a user or org ID. The `clerk_user_id` breadcrumb is
set to the authenticated entity's ID (`context.user.entityId`), which can be
either a personal user ID (`user_*`) or an organization ID (`org_*`). Both
formats are valid for this query.

**Important:** `clerk_user_id` may resolve to the *org* ID when the user is
acting under an organization context. If a query by `clerk_user_id` returns
empty, also try `creator_user_id`:

```text
@breadcrumbs.creator_user_id:<user_id> "Transaction attempt"
```

`creator_user_id` is always the individual user's Clerk ID regardless of org
context. Try both fields when tracking down a specific user's requests.

Returns all transaction attempts for that entity in the time window. Use
`limit: 100` for broader coverage.

### By provider error pattern

```text
"Endpoint returned error" @extra.provider_name:<provider>
```

Use to check for a provider-wide error pattern in a time window.

`@extra.provider_name` values are case-sensitive display names (`OpenAI`,
`Azure`); a lowercase filter matches nothing. This log has no `error_message`
field: the provider's message is inside `@extra.raw` (#41339).

### By endpoint error status (midstream and pre-stream errors)

```text
"Transaction attempt" @extra.endpoint_error.status:>0
```

The `endpoint_error` object captures provider errors that may not be
reflected in `response_status`. This is especially important for
**midstream errors**, where a provider starts streaming a 200 response and
then errors partway through. In those cases `response_status` is `200`,
hiding the real error code.

Common `endpoint_error.status` values:

| Status | Meaning | Typical `response_status` | Midstream? |
|--------|---------|--------------------------|------------|
| `429` | Rate limited | `429` or `200` | Often |
| `502` | Bad gateway (provider down or reset) | `200` or `502` | Often |
| `504` | Gateway timeout | `200` or `504` | Sometimes |
| `500` | Internal server error | `200` | Often |
| `403` | Forbidden (auth/permission) | `200` | Sometimes |
| `405` | Method not allowed (unsupported feature) | `405` | Rarely |

When `response_status` is `200` but `endpoint_error.status` has a real
error code, the error arrived midstream.

Filter by specific status, entity, and model:

```text
"Transaction attempt" @extra.endpoint_error.status:429 @extra.clerk_user_id:<entity_id> @extra.model:openai/gpt-5.5*
```

Use `outcome_bucket` for classified outcomes (doesn't rely on status codes):

```text
"Transaction attempt" @extra.outcome_bucket:rate_limited @extra.clerk_user_id:<entity_id>
```

Other useful `outcome_bucket` values: `hard_failure`, `success`, `cancel`,
`timeout`.

### By raw upstream error body (symptom search)

```text
service:api @extra.metadata.raw:*<keyword>*
```

Use when you know a substring from the upstream provider's error message (e.g.
`context-1m`, `rate_limit`, `quota`). The `extra.metadata.raw` field contains
the raw JSON error body returned by the provider. This is often the fastest way
to find a specific class of upstream errors.

For provider-returned 400s that are logged as adapter warnings (not
`"Endpoint returned error"` entries), also try:

```text
service:api @extra.metadata.raw:*<keyword>* @extra.metadata.provider_name:<provider>
```

### Determining error onset (binary time search)

When you need to find *when* an error pattern started, use binary search over
time windows rather than scanning linearly:

1. Start with a wide window (e.g. last 7 days split into day-sized chunks).
2. Query each chunk — once you find the boundary day with hits, subdivide that
   day into 6-hour blocks.
3. Subdivide the boundary block into 1-hour windows, then 15-minute windows.
4. This typically finds the onset within 4–5 queries instead of 15+.

---

## Key Log Types

### `Transaction attempt` — one per API call

The final accounting record for a generation. Always present, even on errors.

Key fields from `extra.*`:

| Field | Meaning |
|---|---|
| `provider_name` | Which provider served the request (e.g. `"Google"`, `"Anthropic"`) |
| `success` | Whether the billing transaction committed — **not** whether the generation succeeded |
| `normalized_finish_reason` | OpenRouter's normalized outcome: `stop`, `error`, `length`, `tool_calls`, `cancel` |
| `finish_reason` | Raw upstream finish reason (e.g. `MALFORMED_FUNCTION_CALL`, `stop`, `MAX_TOKENS`) |
| `upstream_latency` | Total time waiting on the upstream provider, ms |
| `timeline.adapterRequest` | ms from request start to when OR dispatched to upstream (= router overhead) |
| `timeline.upstreamHeadersReceived` | ms to first byte from provider (TTFB) |
| `timeline.firstTokenReceived` | ms to first token (TTFT) — **absent if no tokens were produced before error** |
| `timeline.upstreamBodyEnded` | ms to full upstream stream end |
| `attempted_endpoints` | List of provider endpoints actually tried for this request |
| `potential_endpoints` | Full eligible list before filtering |
| `refund` | If present, why a credit refund was issued |
| `is_byok` | Whether this used the customer's own provider key |
| `endpoint_status` | **Routing health enum**, not an HTTP code. `0` = Default (healthy), `-1` = Deprioritized, `-2` = DegradedPerformance (uptime 80-95%), `-3` = Deranked (manual), `-5` = Down (uptime <80%), `-10` = Disabled (manual). Based on rolling 30-min uptime from ClickHouse. |
| `endpoint_error` | Nested error object from the upstream provider (see "Midstream errors" below) |
| `endpoint_error.status` | The **real HTTP status** from the provider (e.g. `429`, `502`, `500`). This is the actual error code. |
| `endpoint_error.message` | Provider error message (e.g. `"Too Many Requests"`) |
| `endpoint_error.location` | Where the error was caught. `"error response in stream"` = midstream; `"upstream"` or `"fetch"` = pre-stream |
| `raw_string` | Raw upstream response body as a string. **Only populated on 429 errors.** For other errors, the raw body is in `endpoint_error.metadata.raw` |
| `outcome_bucket` | Classified outcome: `success`, `rate_limited`, `hard_failure`, `cancel`, `timeout` |
| `model` | The model slug requested |
| `permaslug` | The resolved model slug |
| `turn_count` | Number of messages in the conversation |
| `turns_since_user_message` | Count of assistant messages after the last user message (0 = first generation after user message, resets on new user message, -1 = not applicable for prompt-style requests) |

**Midstream errors:**

When a provider starts streaming a 200 response but then errors partway
through, `response_status` is `200` (because the HTTP headers already
sent a 200). The actual error is only in the `endpoint_error` object:

```json
"endpoint_error": {
  "status": 429,
  "message": "Too Many Requests",
  "location": "router.#invoke (Azure) error response in stream"
}
```

This pattern is common across many providers and error types: Azure 429s
mid-stream, Alibaba/OpenAI/Groq 502s, Google 504s, and Cloudflare 500s.
The `location` field distinguishes midstream errors (containing
`"error response in stream"`) from pre-stream errors (containing
`"upstream"` or `"fetch"`).

Queries filtering on `@response_status:429` will miss midstream errors
entirely. Always check `@extra.endpoint_error.status:<CODE>` when
investigating provider errors.

Note: `endpoint_status` is **not an HTTP code** — it's the routing health
enum (see table above). Don't filter on it when looking for HTTP errors.

The `outcome_bucket` field correctly classifies these errors regardless of
where the status code surfaces: `rate_limited` for 429s, `hard_failure`
for 5xx/4xx errors.

**Timeline interpretation:**

- `adapterRequest` ≈ 5–20ms → normal router overhead. Spikes mean routing is slow.
- `upstreamHeadersReceived` − `adapterRequest` → provider TTFB. Large gaps = provider cold start or queue.
- `firstTokenReceived` absent → generation failed before producing any output.
- `upstreamBodyEnded` − `firstTokenReceived` → streaming throughput time.
- `upstreamBodyEnded` close to `tmp_request_timeout` in breadcrumbs → likely a timeout.

### `Endpoint returned error` — one per upstream request attempt

Fired each time a provider endpoint returns an error HTTP status. A single
generation may have multiple of these if OR retried across fallback endpoints.

Key fields from `extra.*`:

| Field | Meaning |
|---|---|
| `provider_name` | Which provider returned the error |
| `status` | Upstream HTTP status code (e.g. `400`, `429`, `500`, `402`) |
| `raw` | Raw error body from the provider — **this is where the provider's error message lives** |
| `raw_status` | Raw HTTP status line from the upstream response |
| `is_error_upstream_fault` | `true` if OR considers this the provider's fault |
| `latency` | How long this specific attempt took, ms |
| `retry_after_seconds` | Parsed `Retry-After` header value — present on 429s |
| `message` | OR's human-readable interpretation of the error |
| `location` | Where in the adapter code the error was caught |

### Adapter error logs — `status:error` and `status:warn` logs

Fired when an adapter encounters an upstream error. These come in two flavors:

- **`status:error`** — unexpected adapter exceptions (e.g. prompt cache write
  failure, malformed response parsing, stream aborts).
- **`status:warn`** — provider-returned HTTP errors (e.g. 400, 429) that the
  router caught and handled. These are the most common type for upstream
  provider rejections (invalid headers, bad requests, quota errors).

Both flavors store the raw upstream error body in `extra.metadata.raw`, **not**
in the log message. The log message contains OR's summary (e.g.
`"Error 400 (Bad Request) in adapter: complete (Google) upstream (...)"`) but
the actual provider error JSON is only in `extra.metadata.raw`.

Key fields:

| Field | Meaning |
|---|---|
| `extra.metadata.raw` | Raw upstream error body (JSON string) — **the provider's actual error message lives here** |
| `extra.metadata.provider_name` | Provider that returned the error |
| `extra.metadata.is_byok` | Whether this used the customer's own provider key |
| `extra.location` | Which adapter method threw |
| `extra.message` | Description of the failure |
| `error.message` | The JS exception message (only on `status:error`) |
| `error.stack` | Stack trace (only on `status:error`) |

---

## Steps

### Step 0: Identify the customer (if needed)

Most investigations start with a Clerk user or org ID (`user_*` or `org_*`).
If you only have an email or display name, look them up:

```sql
-- ClickHouse: find Clerk ID from email
SELECT
  argMax(clerk_user_id, _peerdb_version) AS clerk_user_id,
  argMax(email, _peerdb_version) AS email,
  argMax(display_name, _peerdb_version) AS display_name
FROM clickpipe_postgres_gcp_uscentral1.public_users
WHERE email ILIKE '%<EMAIL>%'
GROUP BY clerk_user_id
```

If you have a Clerk org ID, Datadog queries use it directly via
`@extra.clerk_user_id:<ORG_ID>`. Individual users within an org can be
found via `@extra.creator_user_id:<USER_ID>`.

### Step 1: Determine investigation type and time window

Parse the user's request to identify:

- Generation ID, Clerk user ID, or symptom keywords
- Approximate time window (default: last 24h)

### Step 2: Run primary query

**For a generation ID:**

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "@breadcrumbs.generation_id:<GEN_ID>", "from": <FROM_S>, "to": <TO_S>, "limit": 50}'
)
```

**For a user ID:**

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "@breadcrumbs.clerk_user_id:<USER_ID> \"Transaction attempt\"", "from": <FROM_S>, "to": <TO_S>, "limit": 100}'
)
```

If the above returns empty, try `creator_user_id` (always the individual user,
even when acting under an org):

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "@breadcrumbs.creator_user_id:<USER_ID> \"Transaction attempt\"", "from": <FROM_S>, "to": <TO_S>, "limit": 100}'
)
```

**For a symptom/provider:**

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "\"Endpoint returned error\" @extra.provider_name:<PROVIDER>", "from": <FROM_S>, "to": <TO_S>, "limit": 100}'
)
```

### Step 3: Run secondary sweep (generation ID investigations only)

If the primary breadcrumbs query returned few or no results, run a full sweep.
**Narrow the time window first** — use ±2 hours around the timestamp from the
primary query (or the user-reported time). The `*:` wildcard is expensive on
wide windows:

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "*:<GEN_ID>", "from": <NARROW_FROM_S>, "to": <NARROW_TO_S>, "limit": 50}'
)
```

This catches logs that reference the gen ID but don't carry breadcrumbs.

### Step 3b: Check for midstream / hidden provider errors

When investigating error reports where top-level status queries return empty,
check the `endpoint_error` object. Many provider errors (429s, 502s, 500s,
504s) arrive midstream after a 200 header and are only visible here:

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "\"Transaction attempt\" @extra.endpoint_error.status:>0 @extra.clerk_user_id:<ENTITY_ID>", "from": <FROM_S>, "to": <TO_S>, "limit": 100}'
)
```

Narrow to a specific error type when you know what you're looking for:

```python
# Rate limits specifically
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "\"Transaction attempt\" @extra.endpoint_error.status:429 @extra.clerk_user_id:<ENTITY_ID>", "from": <FROM_S>, "to": <TO_S>, "limit": 100}'
)

# Or use outcome_bucket for classified outcomes
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "\"Transaction attempt\" @extra.outcome_bucket:rate_limited @extra.clerk_user_id:<ENTITY_ID>", "from": <FROM_S>, "to": <TO_S>, "limit": 100}'
)
```

### Step 4: Extract key fields

From `Transaction attempt` logs, extract:

- `extra.provider_name`
- `extra.success`
- `extra.normalized_finish_reason`
- `extra.finish_reason`
- `extra.upstream_latency`
- `extra.timeline.*` (adapterRequest, upstreamHeadersReceived, firstTokenReceived, upstreamBodyEnded)
- `extra.attempted_endpoints`
- `extra.refund`
- `extra.is_byok`
- `extra.model`
- `extra.permaslug`
- `extra.endpoint_status` — routing health enum (0=healthy, -2=degraded, -5=down), **not** an HTTP code
- `extra.endpoint_error.status` — the real HTTP status from the provider (e.g. `429`, `502`)
- `extra.endpoint_error.message` — provider error message
- `extra.endpoint_error.metadata.raw` — raw provider error body (for non-429 errors)
- `extra.raw_string` — raw provider response body (429 errors only)
- `extra.outcome_bucket` — classified outcome (`rate_limited`, `success`, `hard_failure`, etc.)

From `Endpoint returned error` logs, extract:

- `extra.provider_name`
- `extra.status`
- `extra.raw`
- `extra.is_error_upstream_fault`
- `extra.latency`
- `extra.retry_after_seconds`

From adapter error logs (`status:error`), extract:

- `extra.metadata.raw`
- `extra.location`
- `error.message`

### Step 5: Optionally check for broader provider error patterns

If the investigation suggests a provider-wide issue, query failed transactions
for that provider to see if the error is isolated or widespread:

```python
mcp_tool(
  command="call_tool",
  server="datadog",
  tool_name="get_logs",
  tool_args='{"query": "\"Transaction attempt\" @extra.success:false @extra.is_error_upstream_fault:true @extra.provider_name:<PROVIDER>", "from": <FROM_S>, "to": <TO_S>, "limit": 100}'
)
```

This mirrors the query pattern used in production monitoring
(`configs/terraform-monitors/monitoring/endpoint_error_surge_detected.tf`). Count the results
and compare against total transactions for that provider to estimate error rate.

### Step 6: Format and report findings

Structure the summary using the output format below. Send to the user via
`message_user` with a `.md` file attachment for detailed findings.

---

## Output Format

### Single generation investigation

```text
🔍 *Generation <gen_id>*

*Outcome:* <normalized_finish_reason> (<finish_reason> from <provider_name>)
*Charged:* success=<success> | refund: <refund or "none">
*BYOK:* <is_byok>
*Model:* <model> → <permaslug>

*Timeline (ms from request start):*
  Router overhead:    <adapterRequest>ms
  Provider TTFB:      <upstreamHeadersReceived>ms
  First token (TTFT): <firstTokenReceived>ms  ← absent = no tokens before error
  Stream end:         <upstreamBodyEnded>ms
  Total upstream:     <upstream_latency>ms

*Endpoints tried:* <attempted_endpoints>

*Provider errors:*
  • [<provider_name>] HTTP <status>: <raw> (upstream_fault=<is_error_upstream_fault>)

*Adapter errors:*
  • [<location>]: <extra.metadata.raw>
```

### User-level investigation

List generations in reverse-chronological order with one line each:

```text
🔍 *Recent generations for <user_id>*

| Time | Gen ID | Model | Provider | Outcome | Latency |
|------|--------|-------|----------|---------|---------|
| ... | ... | ... | ... | ... | ... |

*Failures:* <count> of <total>
```

Then drill into each failure using the single-generation format above.

### Provider error pattern investigation

```text
🔍 *<provider> errors (<time_window>)*

*Error breakdown:*
  • HTTP <status>: <count> occurrences
    Sample: <raw error body>

*Affected models:* <list>
*Upstream fault rate:* <percentage where is_error_upstream_fault=true>
```

---

## Constructing Shareable Datadog Log Explorer URLs

When reporting findings, provide clickable Datadog Log Explorer URLs so
engineers can verify directly. The OpenRouter Datadog instance is at
`us5.datadoghq.com`.

**URL format:**

```text
https://us5.datadoghq.com/logs?query=<URL_ENCODED_QUERY>&from_ts=<EPOCH_MS>&to_ts=<EPOCH_MS>&live=false
```

- `query` — URL-encoded Datadog log query (same syntax as the MCP queries)
- `from_ts` / `to_ts` — epoch **milliseconds** (not seconds)
- `live=false` — prevents the time window from auto-advancing

**Examples:**

All provider errors (any status) for an org:

```text
https://us5.datadoghq.com/logs?query=%22Transaction%20attempt%22%20%40extra.endpoint_error.status%3A%3E0%20%40extra.clerk_user_id%3Aorg_EXAMPLE&from_ts=<7D_AGO_MS>&to_ts=<NOW_MS>&live=false
```

Midstream 429s for a specific org and model:

```text
https://us5.datadoghq.com/logs?query=%22Transaction%20attempt%22%20%40extra.endpoint_error.status%3A429%20%40extra.clerk_user_id%3Aorg_EXAMPLE%20%40extra.model%3Aopenai%2Fgpt-5.5*&from_ts=<7D_AGO_MS>&to_ts=<NOW_MS>&live=false
```

All rate-limited outcomes for an org:

```text
https://us5.datadoghq.com/logs?query=%22Transaction%20attempt%22%20%40extra.outcome_bucket%3Arate_limited%20%40extra.clerk_user_id%3Aorg_EXAMPLE&from_ts=<7D_AGO_MS>&to_ts=<NOW_MS>&live=false
```

**URL encoding reference** for common characters:

| Char | Encoded |
|------|---------|
| `@` | `%40` |
| `:` | `%3A` |
| `"` | `%22` |
| `/` | `%2F` |
| `*` | `*` (no encoding needed) |
| space | `%20` |

---

## Cross-Referencing with ClickHouse

Datadog log retention is 14 days. For investigations that need longer windows
(e.g. "has this been happening for a month?") or volume/scope analysis (e.g.
"how many users are affected?"), cross-reference with ClickHouse analytics
tables via the ClickHouse MCP.

### Inference tables (`default` database)

Datadog answers "what did this request do"; these tables answer "how much, for
whom, and how healthy". Reach for them for any availability, capacity, retry
amplification, or per-account attribution question. Column names come from
`packages/clickhouse/schemas.ts` (`ClickHouseTableName`) and the query helpers
under `packages/clickhouse/model-uptime/`.

| Table | Grain | Use it for |
|---|---|---|
| `endpoint_requests` | one row per attempt, no-attempt outcome, or terminal update | per-provider status mix and 429 share, attempts per logical request, which endpoints actually served an account, `no_endpoints_reason` |
| `model_call_outcomes_v1` | one row per model call | logical request volume and success rate per `entity_id`, `attempts`, `terminal_status`, `first_attempt_status` |
| `model_endpoint_uptime_minute_v1`, `model_endpoint_uptime_hour_v1` | outcome counters per minute/hour per terminal endpoint | the published availability number, split by endpoint or model |
| `endpoint_attempt_status_minute_v1` | attempt counts per endpoint per status code per minute | endpoint-level error-code trends |
| `endpoint_status_minute_v1` | the legacy rollup, built from `generations` | billed traffic only, so requests that failed before billing and every attempt they made are missing — use the attempt-based table for incident work |

Gotchas that cost real time:

- **Account attribution is `entity_id`** (`clerk_user_id` on the generations
  tables), which is the **org** ID for org traffic; `creator_user_id` is the
  member who owns the key. Restrictions and rate limits key on the entity, so
  aggregate and target on `entity_id`, not the member.
- **Model filtering uses `request_model_permaslug`** (what the client asked
  for). `model_permaslug` / `served_model_permaslug` is what was served, so a
  filter on it silently drops the failures you are looking for.
- The uptime tables are ReplacingMergeTree — query them `FINAL`. The
  `_v1` outcome tables are aggregating, so wrap aggregate columns and never
  nest aggregate aliases in the same `SELECT`; use a subquery.
- **Filter `endpoint_requests` on `row_kind = 'attempt'`** for attempt counts,
  status distributions and retry amplification. The table also holds
  `no_attempt` rows (the model call reached no provider) and `finish` rows (a
  terminal outcome for an attempt already counted), so an unfiltered count
  inflates provider totals.
- Scope to the standard variant and non-BYOK unless asked otherwise
  (`variant = 'standard'`, `is_byok = 0`); other variants carry failure modes
  we do not operate.
- **The Postgres mirrors under `clickpipe_postgres_gcp_uscentral1` can lag
  Postgres by tens of minutes.** Check `max(_peerdb_synced_at)` before
  concluding that a row is missing or that a deploy has not taken effect.
  `public_routing_fortuna_score_snapshots` is the fastest read on whether a
  cfw-api Fortuna scoring deploy is live: the first snapshot with the new
  `computed_at` after the Worker reached 100% carries the new parameters
  (for example `rate_limit_kappa`), and joining consecutive snapshots on
  `endpoint_id` gives the per-endpoint Beta shift the change produced.

### Availability as published

```text
availability = served / (served + upstream_fault + silent_200 + no_endpoint_model_wide)
```

`rate_limited` is **excluded from the denominator** — a rate-limited caller does
not count against a model's availability, so enforcing a rate limit on a noisy
account moves the number even though nothing about the providers changed.
`no_endpoint_model_wide` **is** in the denominator, so requests that never
reached a provider count as unavailability of the model, not of any endpoint.

Two consequences when a provider disputes the dashboard:

- The published number is **model-wide**. A single healthy endpoint can hold
  four nines while the model reads far lower, so always split by
  `terminal_endpoint_id` before attributing a drop to a provider.
- Failed calls retry across the whole eligible pool, so one caller's failures
  are counted once per model call but generate many provider attempts. Compare
  `endpoint_requests` attempt counts against `model_call_outcomes_v1` calls to
  size the amplification before reading anything into raw attempt volume.

When a model's availability drops but its endpoints look healthy, group by
`entity_id` first. If one account explains the delta, the question is routing
eligibility or that account's retry behavior, not provider health.

### Error volume and rate-limit counts

Note: these two tables use different column names for the org/user identifier.
`fact_daily_user_facing_errors` uses `entity_id`; `fact_daily_generations_activity`
uses `clerk_user_id`. Both accept the same Clerk ID value (e.g. `org_...` or `user_...`).

```sql
SELECT
  toDate(date) as dt,
  model_permaslug,
  provider_name,
  sum(rate_limit_429) as rate_limit_429s,
  sum(total_errored_requests) as total_errors,
  sum(client_errors_4xx) as client_4xx,
  sum(server_errors_5xx) as server_5xx
FROM analytics.fact_daily_user_facing_errors
WHERE entity_id = '<ENTITY_ID>'
  AND date >= today() - 30
GROUP BY dt, model_permaslug, provider_name
ORDER BY dt DESC
```

**Caveat:** The `rate_limit_429` column in `fact_daily_user_facing_errors`
tracks errors categorized as rate-limit 429s at the user-facing level. Midstream
429s that arrive after a 200 header may not increment this counter, since the
HTTP status recorded is 200. When ClickHouse shows zero `rate_limit_429` but
customers report 429s, use Datadog's `@extra.endpoint_error.status:429` and
`@extra.outcome_bucket:rate_limited` queries to find the midstream errors.

### Request volume for context

```sql
SELECT
  toDate(date) as dt,
  model_permaslug,
  sum(requests) as total_requests
FROM analytics.fact_daily_generations_activity
WHERE clerk_user_id = '<ENTITY_ID>'
  AND date >= today() - 30
GROUP BY dt, model_permaslug
ORDER BY dt DESC, total_requests DESC
```

Use `today()` and `now()` instead of hardcoded dates to avoid year-mismatch
errors. Always aggregate SummingMergeTree tables with `GROUP BY`.

---

## MCP Limitations

- **No sort parameter** — results come back in default order. For
  reverse-chronological views, narrow the time window instead.
- **No pagination cursor** — if a query exceeds the limit, narrow the time
  window or add more specific filters.
- **Default limit is 100** — explicitly set `limit` in each query.

## Troubleshooting

- **Empty results:** Widen the time window or try the full-sweep query pattern
  (`*:<gen_id>`) instead of breadcrumbs-only.
- **Too many results:** Add filters like `"Transaction attempt"` or a specific
  `@extra.provider_name`.
- **Missing fields:** Not all log entries contain all fields. Check both
  `extra.*` and `extra.metadata.*` paths for error bodies.
- **Sampled error logs:** Some high-volume, deterministic error patterns
  (e.g. OpenAI permanent policy-violation blocks) are logged at 1% sampling
  in production via `inspectErrorT({ samplingRate })`. For these errors,
  `Endpoint returned error` and adapter error/warning logs will be sparse —
  only ~1% of occurrences appear. `Transaction attempt` logs are **not**
  sampled and always show the full `endpoint_error` details. If you suspect
  sampling is hiding errors, query `Transaction attempt` with
  `@extra.endpoint_error.status:>0` or the relevant `outcome_bucket` value
  instead of relying on `Endpoint returned error` counts.
- **Deploy correlation needs the SHA grouping, then the diff:** eyeballing
  onset against deploy times is unreliable — split the flagged trace metric
  by `version` (or spans by `@git.commit.sha`) to see which SHA actually
  served the bad window. Then diff that SHA range: no changes to the
  affected package points at rollout churn, but check shared dependencies,
  config, and lockfile moves in the range before ruling out a revert.
- **Spans REST API is budgeted at 5 requests/minute** (`x-ratelimit-name:
  spans_public_api`, covers `/api/v2/spans/analytics/aggregate` and
  `/api/v2/spans/events/search`). Space span calls ~13s apart and take every
  rate, count and percentile from `/api/v1/query` trace metrics instead; a
  retry loop without that spacing looks like a hang.
- **Parameterized resource names don't match in span queries:** a filter such
  as `resource_name:"GET /api/v1/videos/:jobid/content"` can return nothing
  when the literal casing/param name differs from what the tracer emitted.
  Run a `resource_name` group-by first and copy the value verbatim, or filter
  on `@http.route` / `@http.status_code` instead.
- **A provider with zero attempts may have been filtered, not failing:** no
  rows in `endpoint_requests` only proves it was never called. An eligible
  provider is also never called when an earlier candidate succeeded, so check
  the candidate set (`initial_endpoints_list_size`, `potential_endpoint_count`,
  the logged `potential_endpoints`) before concluding it was excluded. When it
  really was excluded, capability filters are the usual cause —
  `packages/routing/filters/by-parameters.ts` turns a `json_schema` response
  format into a required `structured_outputs` capability. Establish that before
  asking the provider about health, and confirm the capability upstream before
  proposing to add the flag.
- **Zero errors in ClickHouse but customer reports errors:** Midstream errors
  (where the provider starts a 200 stream then errors) may not be counted in
  ClickHouse aggregate columns like `rate_limit_429`. Use Datadog with
  `@extra.endpoint_error.status:>0` to find all provider errors including
  midstream ones, or filter by specific status/outcome_bucket.
