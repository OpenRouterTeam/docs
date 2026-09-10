# Regional Residency Runbook

This runbook separates three different layers of evidence for EU residency. The repo can validate routing intent and the internal Presidio Durable Object policy, but Cloudflare account configuration is still required for the full hostname-level and logging-locality story.

## Proof Layers

1. Hostname-level Cloudflare controls:
   `Regional Services` on the `eu.openrouter.ai` custom hostname is what proves HTTP/TLS/Workers processing for the public `eu.openrouter.ai -> cfw-api` boundary is serviced in-region. `Data Localization Suite` is the umbrella account prerequisite that makes this possible. This layer is not proven by `workers.dev`.

2. Public EU probe behavior:
   `services/cfw-eu-probe` is a worker configured with EU placement and `global_fetch_strictly_public` so it makes an explicit public fetch to `https://eu.openrouter.ai/api/internal/v1/presidio-regional-debug`. Its response is useful corroborating evidence that the request entered the public EU hostname path, but the worker-returned JSON is not a standalone attestation of actual runtime placement.

3. Internal Presidio routing controls:
   Repo code proves `eu.*` hostnames map to `data_region = europe`, `cfw-api` reaches Presidio over the internal `SVC_PRESIDIO` service binding, and `cfw-presidio` requests EU Durable Object jurisdiction. The Presidio debug payload now labels ingress metadata, routing-derived fields, and Durable Object policy separately so we do not overclaim execution attestation.

## How the Endpoints Relate

`cfw-api` exposes `/api/internal/v1/presidio-regional-debug`, which returns a diagnostic payload describing how the request was routed — hostname, data region, service binding path, Durable Object jurisdiction, etc. This is the source of truth for internal routing.

`cfw-eu-probe` wraps that debug endpoint. It is deployed with EU placement and `global_fetch_strictly_public`, so when it calls the debug endpoint it must go through the public `eu.openrouter.ai` hostname — proving the full public path works, not just the internal routing. It attaches its own metadata (colo, placement region, fetch mode) alongside the debug response.

The two manual tests exercise these independently:
- `presidio.test.ts` calls the debug endpoint directly with `OPENROUTER_API_KEY`, verifying internal routing.
- `eu-probe.test.ts` calls the probe worker, which in turn calls the debug endpoint, verifying the full public EU path end-to-end.

## Important Caveat

Cloudflare documents that `Regional Services` does not apply to subrequests. That means the hostname layer can lock the public `eu.openrouter.ai -> cfw-api` boundary, but it does not independently prove the downstream `cfw-api -> cfw-presidio` service-binding hop. The internal hop is validated separately by the Presidio routing and debug metadata in this repo.

## Required Secrets

- `OPENROUTER_API_KEY`:
  API key accepted by `cfw-api` for `/api/internal/v1/presidio-regional-debug`.
- `EU_PROBE_WORKER_URL`:
  URL of the deployed `services/cfw-eu-probe` worker, typically a `workers.dev` hostname unless you assign a custom domain.
- `EU_PROBE_API_KEY`:
  Required bearer token for the EU probe worker. The worker refuses to proxy the admin-only debug request unless this matches its `EU_PROBE_API_KEY` secret.
- `EU_OPENROUTER_BASE_URL`:
  Optional override for the EU hostname. Defaults to `https://eu.openrouter.ai`.

## Local Testing Setup

To smoke-test the debug endpoint locally (auth + full service binding chain):

1. **Start cfw-presidio** (in a separate terminal). cfw-api reaches presidio via a wrangler service binding, so cfw-presidio must be running locally for the binding to resolve:

```bash
cd services/cfw-presidio && bun run start
```

2. **Start the local stack** using [local-dev-env](../../../../.agents/skills/local-dev-env/SKILL.md).

```bash
bun run dev:up
tilt wait --for=condition=Ready uiresource/api --timeout=300s
```

3. **Set `ADMIN_API_KEY`** in your root `.env.development.local`. The debug endpoint uses `AdminApiKeyAuthMiddleware`, which checks the Bearer token against this value:

```
ADMIN_API_KEY=local-dev-admin-key-1234
```

   Restart tilt after changing this value so cfw-api picks it up.

4. **Create `tests/manual/.env.local`** with the same key value as `OPENROUTER_API_KEY` (this is what the test sends as the Bearer token) and point at localhost:

```
OPENROUTER_API_KEY=local-dev-admin-key-1234
EU_OPENROUTER_BASE_URL=http://localhost:8787
```

5. **Unset any stale shell exports** before running the test. The dotenv loader in `vitest.setup.ts` does not override existing `process.env` values, so a previously exported `OPENROUTER_API_KEY` will take precedence over `.env.local`:

```bash
unset OPENROUTER_API_KEY EU_OPENROUTER_BASE_URL
```

6. **Run the test:**

```bash
cd tests/manual
bunx vitest run router/regional/presidio.test.ts
```

The EU-specific assertions (`data_region = europe`, `durable_object_jurisdiction = eu`) will fail locally because `localhost` isn't an `eu.*` hostname. This is expected — the local setup confirms the endpoint and service binding chain work end-to-end. The full assertion suite passes only against the deployed `eu.openrouter.ai`.

## Manual Test Commands

Run the direct admin debug check:

```bash
cd tests/manual
OPENROUTER_API_KEY=... bunx vitest run router/regional/presidio.test.ts
```

Run the EU regional probe check:

```bash
cd tests/manual
OPENROUTER_API_KEY=... \
EU_PROBE_WORKER_URL=https://eu-probe.<subdomain>.workers.dev \
EU_PROBE_API_KEY=... \
bunx vitest run router/regional/eu-probe.test.ts
```

Run all regional tests:

```bash
cd tests/manual
bun run test:presidio
```

## Expected Assertions

- Direct admin debug:
  `api_request.original_host` contains `eu.`, `api_request.data_region = europe`, `presidio.call_path = service_binding`, `presidio.durable_object_jurisdiction = eu`, `presidio.durable_object_name` is non-empty, and `presidio.default_colo_fallback_used = false`.
- Regional probe:
  `probe.fetch_mode = public_fetch`, `probe.configured_placement_region = gcp:europe-west1`, `probe.request_colo` is populated, and the nested Presidio payload still shows `data_region = europe`, `call_path = service_binding`, `durable_object_jurisdiction = eu`, and no fallback to the default colo.

## Deploying the Probe Worker

The `services/cfw-eu-probe` worker requires two Cloudflare Worker secrets that are not in `wrangler.toml` (they must be set via the dashboard or CLI):

```bash
wrangler secret put EU_PROBE_API_KEY --name eu-probe
wrangler secret put EU_PROBE_OPENROUTER_API_KEY --name eu-probe
```

- `EU_PROBE_API_KEY`: Bearer token that callers must present to access `/probe/presidio`. Same secret used by the manual integration tests.
- `EU_PROBE_OPENROUTER_API_KEY`: API key forwarded to `eu.openrouter.ai/api/internal/v1/presidio-regional-debug`.

## Cloudflare Infrastructure Compliance Tests

`cloudflare-compliance.test.ts` verifies that the Cloudflare account is configured correctly by calling the Cloudflare API. These tests assert:

- **Regional Services**: `eu.openrouter.ai` has a regional hostname entry with an EU-related `region_key` (`eu` or `isoeu`).

Run locally:

```bash
cd tests/manual
CLOUDFLARE_API_TOKEN=... \
bun run test:presidio-cf-compliance
```

## Cloudflare Operator Checklist

- Enable `Data Localization Suite` on the account that owns `eu.openrouter.ai`.
- Configure `Regional Services` on the `eu.openrouter.ai` custom hostname.
- If you want the EU probe worker itself covered by `Regional Services`, give it a dedicated custom domain. `workers.dev` does not prove Regional Services coverage.

## What This Branch Can Prove

- Requests to `eu.openrouter.ai` are treated as `data_region = europe` inside the repo.
- `cfw-api` forwards Presidio calls over the internal service binding and preserves region intent in forwarded headers.
- `cfw-presidio` requests EU Durable Object jurisdiction for EU traffic and now fails closed instead of silently falling back to the default colo when EU requests are missing routing metadata.
- The EU probe worker can publicly fetch the EU hostname and return a combined payload showing its configured EU placement, ingress metadata, and the downstream Presidio routing metadata.

## What Still Requires Cloudflare Attestation

- Whether `Regional Services` is enabled on the production `eu.openrouter.ai` custom hostname.
