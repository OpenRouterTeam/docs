---
name: verify-do-offloading
description: >-
  Verify in Datadog that a Cloudflare Worker request was offloaded
  to the supersize-streaming Durable Object. Covers the URL-fetch
  path (file-parser / PDF, image_url URLs), the inline-substitution
  path (embeddings with base64 data-URIs), and the response-side
  path for image-generation base64 payloads (different breadcrumbs).
  Use post-hoc given a generation_id or cf-ray; pair with the
  test-do-offloading skill when you need to first send a request
  against a 0% deploy.
user-invocable: true
---

# Verify DO Offloading

Post-hoc verification that a request actually hit the supersize-streaming Durable Object (DO) hydration pipeline. Use this:

- After sending a test request through the `test-do-offloading` skill against a 0% deploy.
- When triaging a production request a user reported and you need to confirm whether DO offloading kicked in.
- When validating a new code path that should route large payloads through the DO.

The DO offloading mechanism has **several distinct paths**, and they emit different breadcrumbs. Pick the right checklist below based on the request shape — do not require fields from the wrong path.

## Prerequisites

- Datadog MCP access (logs).
- One of: a `generation_id` (preferred), a `cf-ray`, a `durable_object_id`, or a narrow time window for the request.
- Log ingestion lag is ~15 s; wait that long before querying.

## Step 1 — Pull the outer Worker log

Query Datadog logs (any of these will work as the primary key):

```text
@extra.generation_id:<generation_id>
@breadcrumbs.durable_object_id:<do_id>
@cf_ray_id:<full_ray_with_-colo_suffix>   # @cf.ray is NOT a Datadog attribute; instrumentation stores the full CF-Ray header value including the colo suffix (e.g. `9fac82a4490fe8a6-EWR`). Use the full value, or a wildcard (`@cf_ray_id:<bare_ray>*`) if you only have the bare ray ID.
```

The first hit you care about is the `Transaction attempt` log with `script_name: api` (chat completions) or `script_name: embeddings-api` (embeddings). This is the outer Worker log and contains the `breadcrumbs` object you'll spot-check.

Note `attributes.cf_ray_id` from this log — it is your **first-choice** correlation key. The outer Worker and the DO emit logs with different `extra.runtime_id` values (the DO has its own runtime), so do **not** filter the DO log by the outer Worker's `runtime_id`.

> **`cf_ray_id` propagation caveat:** on the chat-completion URL-fetch path the DO sub-request inherits the outer `cf_ray_id`, but on the embeddings inline-substitution path the DO log usually has **no `cf_ray_id`** (the embeddings adapter constructs a fresh `Request` for the DO call). If `@cf_ray_id:<ray>` returns no DO log, fall back to: `@script_name:<script> @entrypoint:ProcessStreamJson` (where `<script>` is `api` or `embeddings-api`) plus a tight time window around the outer log's `cf_event_timestamp` (a few seconds for single-attempt requests; up to `router_latency` ms for retrying ones), then match the DO log by its upstream `attributes.url` matching the outer `extra.fetch_url`.

## Step 2 — Identify the offload path

| If the request was… | Path | Where substitution happens |
| --- | --- | --- |
| Chat completion with a `file` part (PDF) or an `image_url` whose `.url` is a remote `http(s)://` URL | **URL-fetch** | `packages/router/plugins/file-parser/hydrate-files.ts` → `streamingRequestContext.offloadRemoteContent()` → `packages/supersize-streaming/offload-remote-content.ts` |
| Embeddings request with inline `image_url.url` / `input_audio.data` / `file.file_data` that's a `data:` URI or base64 blob | **Inline substitution** | `packages/supersize-streaming/multimodal-stream-parser.ts` (called from the DO during `embeddings-do-offload:parse-*`) |
| Image generation response with a base64 image field above the chunk threshold (e.g. `data[i].b64_json`, Gemini `candidates[i].content.parts[j].inlineData.data`) **AND** `image_response_offload_enabled` gate is active **AND** the adapter supplies response field patterns **AND** a `StreamingRequestContext` was set up for the request | **Response-side offload** | `packages/image-generation/adapters/base/read-upstream-image-body.ts` → `packages/supersize-streaming/parse-response-with-offloading.ts` → `services/cfw-image-api/src/routes/images/hydrate-offloaded-response.ts` |

The two request-side paths (URL-fetch and inline-substitution) both set `breadcrumbs.offloaded_request: true` and a `breadcrumbs.durable_object_id`. The response-side image path uses a fresh per-response DO and does **not** set `offloaded_request: true`.

> **⚠️ Production verifiability caveat (response-side path):** The `image_generation.response_offload` StatsD counter (`outcome:offloaded` / `outcome:hydrated`) carries only `outcome` and `provider` tags — it cannot be correlated to a specific `generation_id` or `cf-ray` in Datadog. The `image-generation/*` FS-logs come from `sendToFSLog`, which is a no-op in production. As a result, the response-side path **cannot be verified post-hoc in production** using currently available signals. Use this path only for local/staging verification (via dev-fs-logs). If you suspect the response-side path is failing in production, instrument `read-upstream-image-body.ts` or `hydrate-offloaded-response.ts` with correlated structured logging before relying on this skill.
>
> **Local Tilt recipe (response-side):** `tilt enable image-api && tilt trigger image-api`, then write the whole `supersize_streaming_image` block to the local `KV_LIVE_CONFIG` namespace (`d585bc8446184f5488b55d038337e839`) with `image_response_offload_enabled: true` and a small `response_chunked_field_threshold_kib_image` (e.g. 64) so any generated image offloads. Use `bunx wrangler kv key put ... --local --persist-to ../../.wrangler/shared-state` from `services/cfw-image-api`. The first request after a worker (re)start still sees the schema default because live-config never blocks on KV, so send two requests. Proof is in `tilt logs image-api`: `multimodal-stream-parser:store-chunk-enqueue` per chunk on one `durable_object_id`, matching `process-stream-json:store-chunk-complete` lines, then `hydration-read:complete`. `image-do-offload:setup` / `parse-complete` lines describe the request-side path only.
>
> To distinguish an ineligible or disabled request from a failed offload: if the outer cfw-image-api log shows no `response_offload` counter at all, the `image_response_offload_enabled` gate is likely inactive or the adapter does not supply response field patterns. A counter with `outcome:parsed_inline` means the field was present but below the chunk threshold (no fields were offloaded). Only `outcome:offloaded` confirms the offload was attempted.

The byte-count and MIME breadcrumbs differ — see the per-path checklists below.

## Step 3 — Shared verification (request-side paths)

Confirm on the outer Worker `Transaction attempt` log:

- `attributes.version` matches the deploy you intended to exercise (e.g. the 0% deploy UUID). The override only applies to the outer Worker — the DO instance keeps its own version due to CF DO version stickiness, so a different `version` on the DO-side log is **expected and not a failure**.
- `breadcrumbs.durable_object_id` present and non-empty → DO was instantiated.
- `breadcrumbs.offloaded_request: true` → adapter took the DO branch.
- `breadcrumbs.cache_eligible: false` → caching correctly bypassed for the offloaded path. The exact `cache_ineligible_reason` varies (e.g. `"Caching is not available for offloaded requests"` when the workspace has caching enabled, `"Caching not enabled"` when it does not). Either is fine — what matters is that `cache_eligible` is `false`.

Confirm the adapter's iLog events fired. Search by `@extra.generation_id:<id>` (or `@breadcrumbs.runtime_id:<id>`) and look for:

**Chat completions** (router base adapter <ref_snippet file="/home/ubuntu/repos/openrouter-web/packages/router/adapters/base/index.ts" lines="746-795" />):
- `supersize-streaming DO fetch start`
- `supersize-streaming DO fetch complete` with `duration_ms` and `status`

**Embeddings** (embeddings base adapter <ref_snippet file="/home/ubuntu/repos/openrouter-web/packages/embeddings/adapters/base.ts" lines="191-295" />) — *requires ECO-614 ([#20827](https://github.com/OpenRouterTeam/openrouter-web/pull/20827)) to be deployed*:
- `embeddings-do-offload:setup` with `binding_available: true`, `offload_header: "true"`, `use_streaming_parser: true`
- `embeddings-do-offload:parse-complete` with `has_substituted_fields: true`, `parse_failed: false`, `parse_duration_ms`
- `supersize-streaming DO fetch start (embeddings)`
- `supersize-streaming DO fetch complete (embeddings)` with `duration_ms` and `status`

If `has_substituted_fields: false` on `parse-complete`, the parser never saw a substitutable field — the request did not need offloading, and the adapter should have fallen back to `globalThis.fetch`. That is a legitimate non-offload outcome, not a failure.

## Step 4 — URL-fetch path checks (file-parser / PDF)

These breadcrumbs are emitted by `offloadRemoteContent()` (<ref_snippet file="/home/ubuntu/repos/openrouter-web/packages/supersize-streaming/offload-remote-content.ts" lines="51-55" />) and live on the outer Worker `Transaction attempt` log:

- `breadcrumbs.offload_remote_bytes` — bytes fetched from the remote URL and stored in the DO (> 0).
- `breadcrumbs.offload_remote_mime` — MIME of the fetched content (e.g. `application/pdf` for PDFs, `image/jpeg` for JPEG image URLs).
- `breadcrumbs.offload_remote_ms` — fetch + digest latency.

Secondary signal:
- `breadcrumbs.tmp_adapter_fetch_request_body_size` is small (a few hundred bytes to a few KB) — the file bytes are no longer inlined in the adapter's outbound request body, only a placeholder reference is. Compare this to `offload_remote_bytes` to see the size reduction.

Note: these three `offload_remote_*` breadcrumbs are **only** emitted by the URL-fetch path. Their absence on an embeddings inline-substitution request is expected, not a bug.

Also verify on the DO-side `process-stream-json:fetch` log (see Step 6 for how to find it) that `breadcrumbs.hydration_total_bytes` ≈ `offload_remote_bytes` when the upstream provider requires the file bytes inlined (e.g. Google Gemini `inlineData`). Single-digit-percent overhead is normal (base64 encoding, JSON framing). For providers that accept file URIs / GCS references upstream, `hydration_total_bytes` may stay close to `tmp_adapter_fetch_request_body_size` instead — the offload still succeeded, the upstream just doesn't need the bytes inlined.

## Step 5 — Inline-substitution path checks (embeddings base64 / data-URI)

> **⚠️ ECO-614 prerequisite:** The breadcrumbs documented in this section (`embeddings-do-offload:*` iLogs, `has_substituted_fields`, `do_chunk_writes_*`, `offload_route`, `offload_provider`) are emitted by code in PR [#20827](https://github.com/OpenRouterTeam/openrouter-web/pull/20827) (ECO-614), which is **not yet merged to `main`**. These checks will return no results against production until ECO-614 is deployed.

On the outer Worker `Transaction attempt` log:

- `breadcrumbs.content_length` — bytes of the inbound JSON body (this is the closest equivalent of "bytes shipped to the DO" for inline payloads — there is no remote fetch, so no `offload_remote_*` breadcrumbs).
- `breadcrumbs.offload_route: embeddings` and `breadcrumbs.offload_provider: <provider name>` — set on the embeddings DO branch.
- `breadcrumbs.offload_status: 200` and `breadcrumbs.offload_duration_ms: <ms>` — the upstream call result the DO returned to the adapter.
- SAX-parser → chunk-writer telemetry (emitted from the adapter when it writes chunks into DO storage):
  - `breadcrumbs.do_chunk_writes_path: body_substitution`
  - `breadcrumbs.do_chunk_writes_count` — number of chunks written.
  - `breadcrumbs.do_chunk_writes_total_bytes` — should be ≈ `content_length` minus JSON-framing overhead (tens to hundreds of bytes).
  - `breadcrumbs.do_chunk_writes_max_bytes` — max chunk size (typically 524_288 = 512 KiB).
  - `breadcrumbs.do_chunk_writes_max_duration_ms` — slowest single chunk write.

The DO-side checks for this path are the same as for URL-fetch — see Step 6.

## Step 6 — Find the DO-side `process-stream-json:fetch` log

This log is the proof that the upstream call really went through the DO. Both request-side paths emit it; the response-side image path hydrates the client response through a separate `hydrateBodyStream` RPC on its fresh DO and does not emit this log. Query:

```text
@cf_ray_id:<ray> @entrypoint:ProcessStreamJson
```

The `cf_ray_id` on the DO log will match the outer Worker's — Cloudflare propagates it through the DO sub-request. `@script_name` will be `api` (chat completions) or `embeddings-api` (embeddings); the DO `executionModel` is `durableObject`.

> If the outer Worker logged `invocations > 1` (retries), you'll see one DO log per adapter attempt under the same `cf_ray_id`. Cancelled attempts may emit a log with empty `hydration_*` breadcrumbs — focus on the successful (`outcome: ok`, `response_status: 200`) entry.

Confirm on the DO log:

- `attributes.url` matches the upstream provider endpoint you expect (e.g. `https://generativelanguage.googleapis.com/v1alpha/models/<model>:streamGenerateContent` for Google AI Studio, `https://aiplatform.googleapis.com/...:streamGenerateContent` for Vertex, `https://api.openai.com/v1/embeddings` for OpenAI embeddings, etc.). Cross-check against the outer Worker's `extra.fetch_url` on `Transaction attempt`.
- `breadcrumbs.hydration_total_bytes` — bytes the DO hydrated and forwarded to the upstream provider.
  - **URL-fetch path:** ≈ `offload_remote_bytes` (within ~JSON-framing / base64 overhead) when the upstream wants the file inlined; may stay close to `tmp_adapter_fetch_request_body_size` when the upstream accepts a file URI / GCS reference.
  - **Inline-substitution path:** ≈ inbound `content_length` from the outer Worker, minus JSON-framing overhead (single-digit byte diff is normal).
- `breadcrumbs.hydration_chunk_count` > 0 — chunks re-assembled out of DO SQLite storage.
- `breadcrumbs.hydration_total_ms`, `hydration_first_byte_ms` — latency through the hydration TransformStream.
- `outcome: ok` and `response_status: 200` for a successful upstream call.

If the outer Worker shows `offloaded_request: true` but you cannot find a DO-side `process-stream-json:fetch` for the same `cf_ray_id` (after waiting ~15 s for ingestion), the upstream call did **not** actually traverse the DO — the offload "claim" is wrong and should be treated as a failure even if the outer request happened to return 200.

## Troubleshooting

**Outer log shows `offloaded_request: true` but no DO-side log:**
- Make sure you are filtering on `@cf_ray_id:<ray>`, not `@extra.runtime_id:<id>` — the DO's `runtime_id` is different from the outer Worker's. The shared key is `cf_ray_id`.
- The DO may have been short-circuited (e.g. the parse-complete branch returned before `processStreamJsonStub.fetch` was called). Re-read the adapter to confirm the DO fetch path was reached.
- Datadog tail-consumer drops are rare but possible — re-run the request if the only missing log is the DO `process-stream-json:fetch`.

**`has_substituted_fields: false` but you expected offloading:**
- The streaming parser only substitutes fields matching `SPECIAL_FIELD_PATTERNS` (see <ref_snippet file="/home/ubuntu/repos/openrouter-web/packages/supersize-streaming/multimodal-stream-parser.test.ts" lines="19-25" />). For embeddings, this is `image_url.url`, `input_audio.data`, and `file.file_data`. Anything else — including top-level base64 in a non-matching field — will not trigger substitution.
- If the inbound body was below the streaming-parser threshold or `Content-Length` was set to a value below the cutoff, the request will skip offloading entirely. Check `embeddings-do-offload:setup` for `use_streaming_parser: false`.

**Version override didn't apply to the DO:**
- This is expected. The `Cloudflare-Workers-Version-Overrides` header routes the outer Worker request, but DO instances are sticky to whatever version was active when the DO ID was first created. Compare `attributes.version` on the `Transaction attempt` log (should match the override) vs. the DO-side `process-stream-json:fetch` log (may differ — that's fine).

## Reference traces

Real production traces useful for sanity-checking your queries:

**URL-fetch (chat completion + PDF, Google AI Studio Gemini, single attempt, success):**
- `cf_ray_id: 9faca03f2cede786`
- `breadcrumbs.durable_object_id: a4c2ed5f7db71e6b689e22308ea1012e228e66aee48973fc56e88b17c806e98a`
- `breadcrumbs.offload_remote_bytes: 9_248_196` / `offload_remote_mime: application/pdf` / `offload_remote_ms: 13_908`
- `breadcrumbs.tmp_adapter_fetch_request_body_size: 2_527`
- DO-side `process-stream-json:fetch` on `@script_name:api @entrypoint:ProcessStreamJson`:
  - `attributes.url: https://generativelanguage.googleapis.com/v1alpha/models/gemini-2.5-flash:streamGenerateContent?alt=sse`
  - `breadcrumbs.hydration_total_bytes: 9_250_417` (≈ `offload_remote_bytes` + ~2 KB JSON framing)
  - `breadcrumbs.hydration_chunk_count: 1_831`

**Inline substitution (embeddings, Google AI Studio gemini-embedding-2-preview, ~20 MB inbound):**
- outer `breadcrumbs.content_length: 20_971_656`
- DO-side `process-stream-json:fetch` on `@script_name:embeddings-api @entrypoint:ProcessStreamJson`:
  - `attributes.url: https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent`
  - `breadcrumbs.hydration_total_bytes: 20_971_640` (≈ `content_length` − 16 bytes JSON framing)
  - `breadcrumbs.hydration_chunk_count: 49`
