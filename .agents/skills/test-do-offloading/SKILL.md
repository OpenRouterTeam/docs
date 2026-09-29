---
name: test-do-offloading
description: >-
  Test that a 0% Cloudflare Worker deploy with DO offloading is
  working by sending a request with a version override header and
  verifying the expected breadcrumbs appear in Datadog.
user-invocable: true
---

# Test DO Offloading

Test that a 0% Cloudflare Worker deploy with Durable Object (DO) offloading is working by sending a request with a version override header and verifying the expected breadcrumbs appear in Datadog.

## Prerequisites

- `DEVIN_OPENROUTER_API_KEY` or `OPENROUTER_API_KEY` secret available
- Access to Datadog MCP for log verification
- The 0% deploy version ID (CF worker version UUID from `wrangler versions deploy` output or CF dashboard)

## Steps

### 1. Get the 0% deploy version ID

Ask the user for the current 0% deploy version ID if not already provided. This is a UUID like `9db8ef1c-4dd6-4796-b119-e2e4537332a4`.

The version must be actively deployed (even at 0%). To deploy:
```bash
cd services/cfw-api
bunx wrangler versions deploy <100%-version>@100 <0%-version>@0
```

### 2. Send a test request targeting the 0% deploy

The `Cloudflare-Workers-Version-Overrides` header routes the request to a specific worker version. The header format is `api="<version-id>"`.

**PDF example** (forces file-parser plugin path via Google AI Studio, which has `supports_file_urls: false`):

```bash
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H 'Cloudflare-Workers-Version-Overrides: api="<VERSION_ID>"' \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Content-Length:" \
  -d '{
    "model": "google/gemini-2.5-flash",
    "provider": {"only": ["Google AI Studio"], "allow_fallbacks": false},
    "messages": [{"role": "user", "content": [
      {"type": "text", "text": "Summarize this PDF"},
      {"type": "file", "file": {"filename": "test.pdf", "file_data": "https://pdfobject.com/pdf/sample.pdf"}}
    ]}]
  }'
```

**Header format pitfalls:**
- Correct: `Cloudflare-Workers-Version-Overrides: api="<version>"`
- Wrong: `Cf-Worker-Version-Overrides` (different header name, ignored)
- Wrong: `{"api": "<version>"}` (JSON format, ignored)

**Provider selection:** Use `"only": ["Google AI Studio"]` to force a provider where offloading triggers. Google Vertex has `supports_file_urls: true` and the file-parser skips the file entirely.

**The empty `Content-Length:` header** omits the content-length value so the streaming parser activates.

**PDF URLs:** Must be publicly fetchable server-side. `https://pdfobject.com/pdf/sample.pdf` works. Some URLs (e.g. w3.org) block server-side fetches.

### 3. Extract the generation ID

From the response JSON `id` field (format: `gen-<timestamp>-<random>`).

### 4. Verify in Datadog

Wait ~15 seconds for log ingestion, then query:
```text
@extra.generation_id:<generation_id>
```

**Confirm the version override worked:**
- `attributes.version` should match the 0% deploy version ID

**Confirm DO offloading worked — check `breadcrumbs` (not `extra`):**
- `breadcrumbs.durable_object_id` — present and non-empty (DO was instantiated)
- `breadcrumbs.offloaded_request: true` — request was offloaded
- `breadcrumbs.offload_remote_bytes` — bytes transferred (should be > 0)
- `breadcrumbs.offload_remote_mime` — MIME type of offloaded content
- `breadcrumbs.offload_remote_ms` — offload latency

**Secondary confirmation:**
- `breadcrumbs.tmp_adapter_fetch_request_body_size` should be small (~858 bytes for a PDF) because the content lives in the DO, not inlined in the adapter request

### 5. Troubleshooting

**Version override not working (version field doesn't match):**
- Verify the header name and format (see pitfalls above)
- Confirm the version is actively deployed: `bunx wrangler versions deploy <100%>@100 <0%>@0`

**No `durable_object_id` or `offloaded_request` in breadcrumbs:**
- Check that the provider doesn't have `supports_file_urls: true` (Vertex does — use AI Studio instead)
- Check file-parser plugin in `extra.plugins` — if `page_count: 0` and `latency` is very low, the plugin skipped the file

**PDF fetch errors:**
- `"Invalid file URL"` → the URL returned an error server-side, try a different public PDF
- `"File is too large"` → exceeds 5MB limit, use a smaller file
