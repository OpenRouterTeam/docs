# Presidio analyzer cache

This change adds an optional cache to the existing analyzer Durable Object (DO). The `presidio_analyze_cache` live-config key defaults to `{ "enabled": false, "rollout_fraction": 0 }`. Reuse requires enablement and a selected workspace. It can reduce repeated analysis of unchanged message segments. Production savings remain unmeasured.

Detection results use DO memory, never KV or DO storage. Rollout settings use the existing live-config KV namespace. The Worker gains a binding to that existing namespace; no new namespace or service is created. The existing analyzer remains authoritative. The anonymizer path has no cache.

## Cached work

The cache accepts only strict `/analyze` requests with nonempty segments, language `en`, `PERSON` or `LOCATION` entities, and a finite score threshold. Requests with other fields or shapes use the original analyzer path.

Each key includes the exact segment text, tenant scope, language, ordered entity list, score threshold, and analyzer version. A random HMAC key belongs to each cache instance. Cache keys and tenant scopes do not enter telemetry.

The cache stores successful analyzer entities with validated labels, character offsets, scores, and an optional null explanation. It does not store source text, redacted text, errors, or timeout results. A valid empty result is eligible. Request bodies still exist during normal request processing.

Repeated segments within one batch share analysis. Partial hits send only distinct missing segments to the analyzer. The response preserves the original segment order, duplicates, and scalar or array shape.

If a successful response to a reduced request has an unsupported shape, the cache repeats the original request unchanged. This fallback can add one analyzer call. Unsupported responses from unchanged requests pass through without another call. Non-success responses never enter the cache.

The analyzer version belongs in the key because detector changes can change results. An image, model, or recognizer change requires a version update in `src/analyzer-cache.ts`.

## Eligibility and retention

`withPresidioCacheScope` supplies the tenant scope from the authenticated entity and resolved workspace. It removes any existing scope header before it adds the trusted value. Only analyzer calls receive the header.

The helper excludes these requests:

- Requests outside the global data region.
- Requests on a HIPAA worker or with a HIPAA or unknown posture. Inference traffic with this posture never reaches this worker (ENT-2127): the router refuses a HIPAA or unknown posture whose guardrails configure a Presidio filter before any text is extracted (`packages/router/plugins/content-filter/check-hipaa-presidio.ts`), and the `api-hipaa` mirror has no `SVC_PRESIDIO` binding. (The guardrail preview route in `cfw-frontend-api`, `routes/guardrails/test-content-filter`, is a cookie-authenticated non-inference path and is gated separately by the ENT-2127 write boundary, PR 3.) The bypass in `withPresidioCacheScope` is cache hygiene, not the enforcement point.
- Requests with enforced ZDR or `provider.zdr: true`.
- Requests with `provider.data_collection: "deny"`.
- Requests without a resolved workspace or entity, or with an oversized scope.

A missing scope bypasses the cache. Tenant separation also prevents unrelated customers from sharing cached results for identical text. The cache does not change the existing region routing.

| Bound | Value | Meaning |
| --- | --- | --- |
| TTL | 60 seconds | Expired entries cannot serve a subsequent cache request. |
| Entries | 1,024 | Maximum retained entries per analyzer DO. |
| Retained strings | 4 MiB | Accounted key and result strings, plus a bookkeeping allowance. |
| Individual entry | 64 KiB | Larger results do not enter the cache. |

The TTL uses lazy eviction. Expired values can remain in idle DO memory until another cache request or object disposal. The TTL is not a physical deletion deadline. The byte bound is retained-string accounting, not a bound on total JavaScript heap or concurrent request memory.

Successful lookups update eviction order. Container start, stop, and error hooks clear the cache. A clear prevents pending requests from refilling it. If a pending mixed request already read hits, it repeats the full analyzer request without caching its result. DO replacement loses the cache and its HMAC key. Cache loss restores analyzer work without a correctness dependency on stored results.

## Why memory first

The existing pool routes requests across multiple analyzer DOs. Each DO has its own cache. A repeated conversation can reach a different DO and miss, even within the TTL. Frequent repeated prompts can populate more of the pool. Neither production hit rate nor cost savings follows from the presence of duplicate text alone.

KV can share cached results across more instances and improve reuse. It also adds a network dependency and persistent storage of detector metadata. That design needs explicit retention, region, access, version, and failure policies. A content hash does not remove those obligations.

This change measures the value of caching within the existing infrastructure first. Routing remains unchanged. Shared storage is a separate decision after measured savings and pool fragmentation justify the additional operations.

## Human rollout

1. Merge and release the implementation with the cache off.
2. Record the baseline by hub, text size, request volume, analyzer latency, timeout rate, and fail-open rate.
3. Use a small controlled workload with repeated synthetic segments and stable tenant scope.
4. In Mission Control Live Config, set `presidio_analyze_cache` to `{ "enabled": true, "rollout_fraction": 0.01 }` for an initial 1% cohort of eligible workspaces.
5. Compare repeated segments, unique segments, and mixed batches against uncached analyzer results.
6. Exercise policy changes, excluded requests, TTL expiry, malformed responses, and cache loss.
7. Compare the selected cohort and the `not_selected` control by hub, size, volume, latency, and errors. Increase the fraction gradually, for example 0.01 → 0.05 → 0.25 → 1, only after measured improvement.
8. If outputs differ or reliability regresses, disable the cache and inspect the uncached control workload.

The cache adds a `cache_state` tag (`disabled`, `bypass`, `not_selected`, `miss`, `mixed`, or `hit`) to existing completed-request duration metrics. Requests that throw before the RPC result keep their existing error telemetry. The `Presidio RPC completed` log includes `cache_hits`, `cache_misses`, `cache_deduplicated`, `cache_bypasses`, `cache_backend_calls`, `cache_fallbacks`, `cache_evictions`, `cache_entries`, and `cache_bytes` when the cache runs. Hits and misses count distinct segment keys; deduplicated counts additional occurrences in that request. No content or cache keys belong in these fields.

Measure backend calls and processed segments separately. One batch can contain many misses but still need one backend call. A high hit count does not establish reduced tail latency or fleet cost.

The decision to expand needs lower analyzer work or latency, unchanged outputs, and no increase in timeout or fail-open rates. Frequent fallback calls can offset savings. Cache errors, memory pressure, and additional foreground overhead also belong in the comparison.

Set `presidio_analyze_cache` to `{ "enabled": false, "rollout_fraction": 0 }` to stop reuse after config propagation. A zero fraction also disables and clears the cache when that DO next handles a request. An excluded workspace does not clear cached entries for other selected workspaces. This does not prove immediate physical erasure from idle objects. A continuing synthetic control verifies that the disabled path performs analyzer work.

### Cohorts and config propagation

Each analyzer RPC reads the shared live-config reader's local value. The read never waits for KV; `waitUntil` refreshes settings in the background. Cold reads, missing bindings, and missing keys default off. The shared reader uses a 10-second local refresh TTL, plus Cloudflare KV propagation and request activity. That TTL is not an upper bound on rollback time. During KV failures or malformed refreshes, an already-warm reader keeps its last-known-good setting until a valid refresh arrives.

Cohort selection uses a domain-separated FNV-1a hash of the authenticated entity/workspace scope. A workspace keeps the same assignment across requests and analyzer instances at a fixed fraction. Increasing the fraction expands the selected set. The percentage describes eligible workspaces, not a percentage of traffic or compute. All existing privacy exclusions still apply. Neither workspace scope nor its cohort hash enters telemetry.

Config changes affect subsequent decisions, not operations already in flight. Disabling clears the reached DO's cached generation and prevents pending fills from repopulating it. A request that already read a cache hit can finish. The standard reader is an eventual rollout control, not an instantaneous fleet-wide kill switch.

### Curl smoke test through your account

Use the public Chat Completions endpoint after a human releases this PR. This example makes one billable model request with synthetic text.

Before the test:

1. Use an API key assigned to a known, eligible workspace in your account.
2. Attach a guardrail with the `person-name` builtin and the `redact` action to that key.
3. Use a dedicated test key if your normal key has other guardrails that can block this request.
4. Keep the existing HIPAA, ZDR, data-collection, and residency policies intact. If those policies exclude the workspace, expect a cache bypass.
5. Confirm that the human rollout includes your workspace. A 1% rollout usually excludes an arbitrary test account.

The curl cannot select its cohort or supply a trusted cache scope. Do not expand the fleet rollout solely for this test. After config changes, cold readers can initially report `disabled` while background refresh completes.

Set `OPENROUTER_API_KEY` through your normal secret mechanism. Set `OPENROUTER_MODEL` to an available text model allowed by your key. The command requires `jq` and writes its response and headers to a fresh local directory.

```bash
: "${OPENROUTER_API_KEY:?Set your test workspace API key}"
: "${OPENROUTER_MODEL:?Set an available text model allowed by your key}"
PRESIDIO_SMOKE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/presidio-cache-smoke.XXXXXX")

jq -n --arg model "$OPENROUTER_MODEL" '{
  model: $model,
  stream: false,
  max_tokens: 16,
  messages: [
    {
      role: "user",
      content: [
        {type: "text", text: "Please contact John Smith about the project. Reply only OK."},
        {type: "text", text: "Please contact John Smith about the project. Reply only OK."},
        {type: "text", text: "Please contact John Smith about the project. Reply only OK."}
      ]
    }
  ]
}' > "$PRESIDIO_SMOKE_DIR/request.json"

date -u '+Started at %Y-%m-%dT%H:%M:%SZ'
curl --silent --show-error --fail-with-body --max-time 60 \
  'https://openrouter.ai/api/v1/chat/completions' \
  --header "Authorization: Bearer $OPENROUTER_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'X-OpenRouter-Cache: false' \
  --header 'X-OpenRouter-Metadata: enabled' \
  --data-binary "@$PRESIDIO_SMOKE_DIR/request.json" \
  --dump-header "$PRESIDIO_SMOKE_DIR/headers.txt" \
  --output "$PRESIDIO_SMOKE_DIR/response.json" \
  --write-out 'HTTP %{http_code}; total %{time_total}s\n'
jq '{id, error, openrouter_metadata, choices: [.choices[]? | {finish_reason, message}]}' \
  "$PRESIDIO_SMOKE_DIR/response.json"
printf 'Local capture: %s\n' "$PRESIDIO_SMOKE_DIR"
```

The cache header disables full-response caching so the request reaches the guardrail. It does not disable the Presidio analyzer cache. The metadata header includes the guardrail pipeline in the JSON response.

The three text blocks contain identical segments. They enter one analyzer batch without any customer text. This test needs the account guardrail; a `plugins` field alone does not configure this builtin.

Open `https://openrouter.ai/logs?generation_id=<response.id>` with the ID from the curl output. Inspect the `content-filter` guardrail stage in the request details or `openrouter_metadata.pipeline`. For a detected name, expect the `presidio` engine and a `redacted` action. Detection can vary; the model's `OK` response does not prove that redaction or caching succeeded.

Activity and response metadata currently do not expose `cache_state` or cache counters. The account's cached-token count measures provider prompt caching, not this analyzer cache. Account request details and pipeline metadata can confirm guardrail execution, but cannot prove cache reuse. An operator must inspect internal logs for that proof. Use the request's trace, where available, to locate its `Presidio RPC completed` events. Otherwise, the recorded UTC time only narrows the search; it does not identify your request uniquely. Presidio events do not contain your account ID or the synthetic text as explicit fields.

For the analyzer event (`endpoint:analyzer`), inspect these fields:

| Observation | Expected fields | Meaning |
| --- | --- | --- |
| Cold selected cache | `cache_state:miss`, `cache_misses:1`, `cache_deduplicated:2`, `cache_backend_calls:1`, `cache_fallbacks:0` | Three segments used one segment evaluation. This proves deduplication, not reuse across requests. |
| Warm selected cache | `cache_state:hit`, `cache_hits:1`, `cache_deduplicated:2`, `cache_backend_calls:0`, `cache_fallbacks:0` | The analyzer reused the previous result. |
| Rollout off or cold config | `cache_state:disabled` | The analyzer used the original path. |
| Workspace outside cohort | `cache_state:not_selected` | The config is on, but this workspace is outside the rollout. |
| Ineligible request or unsupported contract | `cache_state:bypass` | Inspect eligibility and fallback counters before judging the test. |

To test reuse across requests, repeat the curl command with the same request file, key, and workspace within 60 seconds. Each repeat overwrites the local capture; save any response ID you need first. A request can still miss because routing selects another DO, the cache expires, or the container restarts. Compare `durable_object_name` and `selected_hub` in the internal events. Do not treat a second-call miss as a cache failure.

Successful analyzer reuse can still require an anonymizer call. Model latency and anonymizer latency remain in the total curl time. A faster response alone does not prove a cache hit.

## Bleep evaluation

The initial Bleep shadow stack remains uncached so that observations include fresh candidate execution. Presidio cache hits become part of the live baseline. End-to-end latency remains relevant, but a cache hit is not a fresh detector timing or independent quality sample.

The complete shadow runner admits at most 16 segments and 32,768 total codepoints per request. The adapter also has a per-segment cap. Separate 128-window work limits can reject shorter dense Unicode segments. Small individual segments do not bypass the total request limits.

A future Bleep cache can reuse complete, exact segments under an immutable artifact version, boundary contract, and inference configuration. The current model label alone does not identify an immutable artifact. The caller must apply the current redaction policy after detection.

Window-level reuse needs the complete preceding context in its key. The same primary text with different carryover context is not the same detector input. Errors, truncated results, and old inference timings must not become cached evidence.

## Validation limits

Unit and controller integration tests cover cache contracts and failure paths. A separate local Docker check used the pinned analyzer image and synthetic text. All five scenarios matched uncached output, including Unicode, duplicate segments, mixed hits, and reordered history. The cached path evaluated 4 segments versus 14 and made 4 backend calls versus 5. These small local samples establish reuse and output parity, not production latency or hit rates.

Verbatim request and response captures, image provenance, and a fixture regression are included under `fixtures/` and `src/analyzer-cache-fixture.test.ts`. The DO lifecycle wiring has code review and type checks; these tests do not run a Cloudflare container DO. Production routing, concurrency, memory, and traffic locality still need validation during human rollout.
