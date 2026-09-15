# HIPAA Access Audit Trail (api-hipaa)

The per-request access record the HIPAA mirror emits for 45 CFR 164.312(b), where it lands, what is and is not guaranteed about it, and how to query it. Built under [ENT-2051](https://linear.app/openrouter/issue/ENT-2051) as a three-PR stack: [#41421](https://github.com/OpenRouterTeam/openrouter-web/pull/41421) (emitter and tail-sampling exemption, merged), [#41439](https://github.com/OpenRouterTeam/openrouter-web/pull/41439) (middleware and route wiring, merged) and the PR that adds this runbook (dashboard and quota monitor).

- **Log message:** `hipaa_access_audit`, under `service:api-hipaa`
- **Emitter:** `packages/instrumentation/hipaa-access-audit.ts`
- **Middleware:** `services/cfw-api/src/middlewares/hipaa-access-audit.ts`, mounted first in `createApp` (`services/cfw-api/src/app.ts`)
- **Dashboard:** `[HIPAA] Access audit trail (api-hipaa)` (`configs/terraform-monitors/monitoring/hipaa_access_audit/`)
- **Monitors:** `[HIPAA] api-hipaa log index daily quota reached` (`configs/terraform-monitors/monitoring/hipaa_access_audit.tf`); `[HIPAA] Access audit record not written` (`configs/terraform-monitors/monitoring/hipaa_fail_closed_signals.tf`, on `openrouter.hipaa_access_audit.emit_failed` — see "Emit failures are counted" below)
- **Related:** [ENT-1823](https://linear.app/openrouter/issue/ENT-1823) (six-year sink, Todo), [ENT-2024](https://linear.app/openrouter/issue/ENT-2024) (Datadog-side index controls), [ENT-417](https://linear.app/openrouter/issue/ENT-417) (HIPAA runbook), [#39279](https://github.com/OpenRouterTeam/openrouter-web/pull/39279) (dedicated `api-hipaa` index, draft), [#39280](https://github.com/OpenRouterTeam/openrouter-web/pull/39280) (fail-closed HIPAA tail consumer, draft)

## What the record is

The HIPAA mirror is cfw-api's `[env.hipaa]` deployment, script name `api-hipaa`, with `IS_HIPAA_WORKER = "true"`. On that worker only, `createHipaaAccessAuditMiddleware()` wraps every request and writes exactly one `hipaa_access_audit` log record when the response headers are known — after `await next()` returns, or, if the handler threw and Hono's error handler did not convert it, in the middleware's `catch` before it rethrows. The only path it skips is `/health`, whatever the method: no principal, no PHI, and it would dominate a six-year record. Every other path the mirror answers is recorded, including allowlist refusals (403 from `createHipaaMirrorEndpointAllowlistMiddleware`, which is mounted after the audit middleware) and authentication failures (401 from the route itself).

The record is built by the pure `buildHipaaAccessAuditRecord(...)` in the middleware file and written by `emitHipaaAccessAudit(record)` in the instrumentation package. The inference routes (`chat-completions`, `completions`, `messages`, `responses`, `cursor`) call `recordHipaaAccessAuditSource(c, router)` next to their existing `setRequestGenerationId` call, which puts the request's `Router` on the Hono context so the middleware can read who and what after the response is known. The direct tool route (`/api/alpha/tools/:toolName`, `services/cfw-api/src/routes/tools/index.ts`) has no `Router`; it calls the same function with a source it assembles itself — its own generation and request ids, the authenticated context, and `servedEndpoint: null` — once those ids are minted, and the record's `route_path` is what marks it as a tool call. On the primary `api` worker the middleware and both calls are inert.

The status and the served endpoint are taken when response headers are returned. For a stream that is the HTTP status the client saw; the post-stream outcome (finish reason, upstream failure mid-stream) lives in the generation record, joined by `generation_id`. One consequence for the endpoint fields: when the router falls back after a 200 was already committed (`canRetryInvisibly`), the record names the endpoint that committed the response and the generation row has the one that served the content.

## Fields

Every field is a scalar and lands as the Datadog attribute `@extra.<field>`. `null` means genuinely unknown for that request; the record never substitutes a placeholder.

| Field | Meaning | Source | When null |
| --- | --- | --- | --- |
| `api_key_id` | Numeric id of the API key that made the request | `router.context.user.data.key?.id` | Request never reached routing (auth refused, allowlist refused), or the principal is a cookie session rather than a key, or a tool invocation refused before its id was minted (`api_key_hash_prefix` still names the credential) |
| `api_key_hash_prefix` | First 10 hex characters of the SHA-256 of the presented bearer token or `x-api-key` header, the same `key_hash_first_ten` breadcrumb convention used elsewhere; answers "who" for requests auth refused before routing | `getBearerTokenHash(c)` (`services/cfw-api/src/auth/utils.ts`, memoized per request), sliced to 10 | No credential was presented, the credential fails `isValidKeyFormat` (for example `Bearer abc`), or hashing failed |
| `entity_id` | Clerk user or organization id the key belongs to | `router.context.user.entityId` | Request never reached routing, or a tool invocation refused before its id was minted (`api_key_hash_prefix` still names the credential) |
| `workspace_id` | Workspace the request is attributed to | `resolveAttributionWorkspaceId(user)` (`packages/helpers/require-workspace-id.ts`): `resolvedWorkspaceId`, else `workspace.id` | Request never reached routing, or no workspace resolved for the principal, or a tool invocation refused before its id was minted (`api_key_hash_prefix` still names the credential) |
| `received_at` | ISO-8601 time the middleware started, before the handler ran | `new Date().toISOString()` | Never |
| `model_permaslug` | Permaslug of the endpoint whose upstream response had committed the client response at record time | `router.servedEndpoint` → `ModelCallRecorder.servedEndpoint()`, which reports an endpoint only once its call closed successfully or the request finished; on a fallback that completed before the response was committed it names the endpoint that answered, not the one that failed | No provider was called (auth or allowlist refusal, request validation failure, routing found no endpoint); or a direct tool invocation (`route_path` `/api/alpha/tools/:toolName`), which has no model, provider or endpoint by construction; or the client response was committed by the streaming preflight timer (`packages/network/edge-stream.ts`, 10 s for SSE, 120 s for JSON) while the provider call was still open or between a failed attempt and the next — join `generation_id` to the generation row for the full attempt list |
| `provider_name` | Provider of that endpoint | Same | Same |
| `endpoint_id` | Endpoint id of that endpoint | Same | Same |
| `http_method` | HTTP method | `c.req.method` | Never |
| `route_path` | The matched Hono route pattern, read after `next()` so it names the handler that answered: the mounted path for a served route (for example `/api/v1/chat/completions`) and `/*` for anything the allowlist or the catch-all refused. Bounded and never client-controlled, unlike the request path | `routePath(c)` from `hono/route` | Never |
| `client_ip` | Raw client IP address | `resolveClientIp(headers, OR_PROXY_PSK)` (`services/cfw-api/src/utils/get-geo-data.ts`): the proxy client-IP header when the proxy PSK matches, else `cf-connecting-ipv6`, else `cf-connecting-ip`. The primary forwards the raw request to the mirror over the service binding, so these headers are the original client's | No such header, or the value is the Cloudflare worker static IP |
| `generation_id` | Generation id, the join key to the generation record | `router.generationID`; on the direct tool route, the id the handler mints itself (`orid(ORIDType.Generate)`) and supplies directly | Request never reached routing, or a tool invocation refused before its id was minted |
| `request_id` | Router request id | `router.requestID`; on the direct tool route, the id the handler mints itself (`orid(ORIDType.Request)`) and supplies directly | Request never reached routing, or a tool invocation refused before its id was minted |
| `cf_ray_id` | Cloudflare ray id | `cf-ray` request header | Header absent |
| `response_status` | HTTP status the client saw | `c.res.status` after `next()`. When the handler threw, `app.onError` in `createApp` converts it first, so this is what `onError` returned: an `HTTPException`'s own status, 500 for anything else. If an error propagates past `onError`, the middleware's `catch` records the same mapping and rethrows | Never |

`client_ip` is recorded raw on this record, by decision. The ticket names "from where" as a required audit field and a hash cannot answer it. The existing scrub of `client_ip_hash` in operational logs and the tail worker's IP stripping for the mirror are unchanged; they apply to logs and generation rows where the IP is not needed. `HipaaAccessAuditRecord` extends `HipaaSafeLogExtra`, so if `client_ip` is ever added to the HIPAA denylist the audit module stops compiling rather than silently blanking the field.

The record passes through the HIPAA scrubber (`scrubHipaaOptionalExtra`) on the way out. None of its fields is on the denylist, and none exceeds the scrubber's 256-character string truncation.

## Guarantees and where each is enforced

- **Not silenced by `LOG_LEVEL`.** `emitHipaaAccessAudit` calls `logConsoleOnly` with `isLevelGateBypassed: true`, the only caller of that option (`packages/instrumentation/logger.ts`). A log-level change on the mirror cannot suppress the record.
- **Not sampled by the tail worker.** `toTailJsonLogs` in `services/cfw-instrumentation/src/index.ts` skips `shouldDropSampledLog` for every line whose script name passes `isHipaaScriptName`, so no sampling rule can match the record by substring. The whole `api-hipaa` script is exempt, not just this message.
- **Not dropped by an index exclusion filter.** The `api-hipaa` index in #39279 has no `exclusion_filter` block, as a stated decision; volume is bounded by `daily_limit` instead.
- **Emit failures are counted.** If building or writing the record throws, the middleware increments `openrouter.hipaa_access_audit.emit_failed` and logs `hipaa_access_audit_emit_failed` with `error_name` and `response_status`; the request is unaffected. The line also carries `error_message`, but `_message` is a scrubbed suffix on the mirror, so read `error_name` there. The dashboard's Delivery group charts the counter. Any non-zero value is a request served without a record.
- **Refusals are recorded.** The audit middleware is mounted before the allowlist middleware in `createApp`, so an allowlist 403 produces a record with `route_path: "/*"`.

What is **not** guaranteed:

- **Tail delivery is best-effort.** The tail worker submits directly to Datadog, falls back to a queue, and logs a warning if both fail. A record the worker emitted can still fail to arrive; the completeness ratio below is how to see that.
- **Demoted platform exceptions are still sampled.** The tail worker samples the `DEMOTED_PLATFORM_ERRORS` exception warnings at 5% for every script including the mirror. Those are not the access record, but an investigation that relies on them will see a sample.
- **The index daily quota is a drop path.** Once the `api-hipaa` index reaches `daily_limit`, Datadog stops indexing it until the quota day resets, and every record emitted in that window is not in the index. That is why the quota monitor exists.
- **A worker that never ran the middleware emits nothing.** A request that failed inside the Cloudflare runtime before the Hono app ran (an isolate that exceeded memory at startup, for example) produces a tail event but no record. Those show up as a gap in the completeness ratio.

## Where it lands and retention ownership

Records ship through the shared tail worker to Datadog under `service:api-hipaa` (`LOG_SERVICE_BY_SCRIPT_NAME` in `packages/instrumentation/log-service.ts`).

- **Today:** the dedicated `api-hipaa` index exists only in the open draft #39279. Until it is applied, `service:api-hipaa` lands in the shared org's default `main` index with `main`'s retention and exclusion filters.
- **After #39279 is applied:** records land in the `api-hipaa` index with 15-day retention, no exclusion filters, a `daily_limit` (5,000,000 at the time of writing) and a warning event at 80% of it. `hipaa-logs.tf` is the authoritative index setting; the dashboard's quota tile and note and the quota monitor's message render the same number from `api_hipaa_index_daily_limit` in `configs/terraform-monitors/monitoring/hipaa_access_audit.tf`, and the two must change together. #39280, also draft, would move the mirror's telemetry behind a dedicated fail-closed tail consumer; the record's shape and service tag do not change.
- **The six-year PHI access record is owned by ENT-1823**, which is in Todo and has no artifact in the repo. Today no layer provides six-year retention: the index is 15 days once it exists, and the sink does not exist. This ticket documents that split; it does not close the retention requirement.

What the ENT-1823 sink must consume is exactly the query `service:api-hipaa "hipaa_access_audit"`, every record, unsampled. A Datadog Logs Archive filtered to that query is the least-effort form, because it reads the log stream before indexing and is therefore not subject to the index's `daily_limit`.

## Rollout gate

Do not deploy #41439 to the mirror before #39279 is applied. The record carries raw `client_ip`; while `service:api-hipaa` still lands in the shared `main` index, that value would be readable by everyone with access to `main` and retained under `main`'s rules rather than the HIPAA index's read restriction.

## Saved queries

Datadog has no Terraform resource for saved views, so the queries live here and as log-stream widgets on the dashboard. Save each once in the Log Explorer (`Save` → `Save as view`) under the name given, so the report views are one click for auditors.

| Saved view name | Query |
| --- | --- |
| `HIPAA audit: all records` | `service:api-hipaa "hipaa_access_audit"` |
| `HIPAA audit: by API key` | `service:api-hipaa "hipaa_access_audit" @extra.api_key_id:<id>` (or `@extra.api_key_hash_prefix:<10 hex chars>` for requests auth refused before routing) |
| `HIPAA audit: by entity` | `service:api-hipaa "hipaa_access_audit" @extra.entity_id:<entity_id>` |
| `HIPAA audit: by client IP` | `service:api-hipaa "hipaa_access_audit" @extra.client_ip:<ip>` |
| `HIPAA audit: non-2xx` | `service:api-hipaa "hipaa_access_audit" @extra.response_status:>=300` |
| `HIPAA audit: by model or provider` | `service:api-hipaa "hipaa_access_audit" @extra.model_permaslug:<permaslug>` or `... @extra.provider_name:<provider>` |

Add `env:production` to any of these when the shared org also receives staging or development mirror traffic.

Group-by widgets and the Log Explorer's group-by need facets, which Datadog creates only from the console. Before the dashboard's toplists and bar charts render, create a facet for each of these attributes (Log Explorer → click the attribute on any `hipaa_access_audit` record → `Create facet`), which requires at least one record to have landed:

1. `@extra.response_status`
2. `@extra.route_path`
3. `@extra.model_permaslug`
4. `@extra.provider_name`
5. `@extra.endpoint_id`
6. `@extra.api_key_id`
7. `@extra.entity_id`
8. `@extra.client_ip`

Filtering on an attribute (`@extra.api_key_id:123`) works without a facet; only grouping and the dashboard's log-stream columns benefit from one.

## Verifying completeness

The denominator is the tail worker's per-invocation metric: `openrouter.cloudflare.trace.wall_time_ms` is a distribution with one sample per tail `TraceItem`, tagged `script_name` and `entrypoint`. The mirror also hosts Durable Objects (`ProcessStreamJson`, the KV cache controller), whose fetches produce their own trace items under `script_name:api-hipaa` with `entrypoint:processstreamjson` and `entrypoint:kvcachecontroller`. The worker's default fetch handler has no entrypoint name, and the tail worker tags it `item.entrypoint ?? 'unknown'`, so `entrypoint:unknown` is the HTTP request path and the only value to count. Its count is the number of requests the mirror handled, including `/health` and invocations that failed before the Hono app ran. On the shared org that metric arrives today through the shared tail worker; #39280 would move it with the rest of the mirror's telemetry.

The ratio the dashboard's second tile shows, over 24 hours:

```text
count of logs matching   service:api-hipaa "hipaa_access_audit" env:production
--------------------------------------------------------------------------------------------------  × 100
count:openrouter.cloudflare.trace.wall_time_ms{script_name:api-hipaa,entrypoint:unknown,env:production}
```

An acceptable value is a little under 100%, because `/health` is unaudited and counts in the denominator. A step down from the mirror's own baseline means records are being lost somewhere between the worker and the index — check `openrouter.hipaa_access_audit.emit_failed` first (records that never left the worker), then the tail worker's own delivery warnings, then the quota monitor.

To find *when* a gap happened, put both series on one timeseries with a 5-minute rollup and look for buckets where the invocation count is non-zero and the record count is zero or steps down:

- Logs: `service:api-hipaa "hipaa_access_audit" env:production`, count, rollup 5 minutes
- Metric: `count:openrouter.cloudflare.trace.wall_time_ms{script_name:api-hipaa,entrypoint:unknown,env:production}.as_count()`, rollup `sum`, 5 minutes

A bucket where the metric is also zero is a mirror that received no traffic, not a loss.

## Dashboard and monitor

**Dashboard:** `[HIPAA] Access audit trail (api-hipaa)`, template variable `env` (default `production`). The top row is records in the last 24 hours, the completeness ratio, non-2xx records, and the `api-hipaa` index's share of its daily limit from `datadog.estimated_usage.logs.ingested_events` (the divisor is `api_hipaa_index_daily_limit` in `configs/terraform-monitors/monitoring/hipaa_access_audit.tf`, substituted into `dashboard.json` at apply time). Groups below: Volume (by response status and route pattern), What was accessed (by model, provider, endpoint), Who and from where (by API key, entity, client IP; capped at 50 because the values are unbounded), Audit reports (the saved queries as log streams plus a copy-paste note) and Delivery (`emit_failed`). Every panel reads "No data" until the mirror serves traffic (the two record-count tiles read `0`, which is an honest zero-records reading); the quota tile deliberately has no `default_zero`, so it reads "No data" rather than `0.0 % of limit` until #39279's index exists and the metric carries `datadog_index:api-hipaa` — a `0.0 %` there would hide a missing index behind an unused-quota reading.

**Monitor:** `[HIPAA] api-hipaa log index daily quota reached`, an event monitor on Datadog's own `source:datadog datadog_index:api-hipaa "daily quota reached"` event, threshold one event in a day. It fires when Datadog has stopped indexing `service:api-hipaa` for the rest of the quota day (reset at 14:00 UTC), which means every record emitted from that moment until the reset is missing from the index. The action, in order: raise `daily_limit` in `services/datadog/infra/hipaa-logs.tf` and apply it by hand (that directory has no CI), and set `api_hipaa_index_daily_limit` in `configs/terraform-monitors/monitoring/hipaa_access_audit.tf` to the same value so the dashboard and this monitor's message follow; check the dashboard's Volume group for a traffic anomaly, since a ceiling sized for expected volume is usually hit by a burst; record the gap window in the incident, because records inside it are recoverable only from the ENT-1823 sink once it exists. The monitor routes to `#alerts-enterprise` (`@slack-OpenRouter-alerts-enterprise`) from day one, by decision: a filled index means audit records are being dropped, and the event only exists when the quota was actually hit, so there is no false-positive mode to prove quiet first. It re-notifies every 24 hours while in alert, so a ceiling that is hit again the next day produces a fresh message rather than silence. Recovery means only that no quota event has arrived for 24 hours, whether or not `daily_limit` was raised; it does not mean the limit was raised.
