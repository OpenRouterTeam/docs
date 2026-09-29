# CFW Batch API

Cloudflare Worker service for OpenRouter's Batch API. This is the thin
Cloudflare ingress that fronts the role-isolated `batch-api` Cloud Run services: it
authenticates the API key, applies WAF / DDoS / rate limits, mints the internal
auth token, and streams the request body straight through to the upstream
service.

This worker wires up auth, secrets, instrumentation, and routes requests to
`/api/beta/batches` and `/api/v1/batches` paths for the Batch API, with the v1
prefix canonical. The deploy/dev plumbing is verified and batch route
forwarding is in place.

## Architecture

```mermaid
flowchart TD
    Client["Client Request\nJSON batch"] --> Worker["cfw-batch-api\nedge ingress"]
    Worker --> Auth["cfw-api auth helpers\ngetUser + management-key guard"]
    Worker --> Package["packages/batch\nroute shell + OpenAPI contracts"]
    Package --> Forwarder["createBatchUpstreamForwarder\nzero-copy Request.body forward"]
    Forwarder --> Ingest["batch-api\nPOST create"]
    Forwarder --> Control["batch-api-control\nstatus/results/control"]
    Ingest --> Response["Batch response\naccepted / stored status / results"]
    Control --> Response
```

## Ownership Boundary

`cfw-batch-api` owns edge concerns only:

- authenticate the public API key via the shared `cfw-api` auth path
- reject provisioning keys that cannot run inference
- mint `X-OpenRouter-Internal-Auth` for the Cloud Run service
- attach Cloud Run OIDC auth in deployed environments
- preserve zero-copy streaming by forwarding `request.body` directly

It does not parse batch payloads, call providers, write GCS, publish Pub/Sub, or
read Spanner. Those responsibilities live in `services/batch-api`; shared
schemas/routes/adapters/skins live in `packages/batch`.

The one exception is result delivery: when the `batch_direct_gcs_results` LiveConfig key is `{ "enabled": true }` (or the caller's billable entity id is in its `entity_allowlist`), a `GET /api/v1/batches/{id}` asks control for a results handoff. Control still runs the ownership, deletion, and payment checks, then returns the batch object without `results` plus the `output/results` URI, and the worker streams that object from GCS into `results` with a read-only OAuth access token minted from `BATCH_GOOGLE_APPLICATION_CREDENTIALS_JSON`.

Successful `GET /api/v1/batches` collection responses are cached at the edge
for ten seconds by default. Entries preserve the complete query string and are
isolated by a SHA-256 digest derived from the caller's Authorization header and
authenticated entity/workspace scope; raw API keys and identity values are
never included in cache keys. Set `BATCH_LIST_EDGE_CACHE_TTL_SECONDS` to an integer
from 1 through 60, or set it to `0` to disable caching. Clients receive
`Cache-Control: private`; errors, submits, deletes, and individual batch reads are never
cached. A cached collection page is not purged by a `DELETE`, so a batch deleted within the
TTL can still appear in a list for up to that window; its `GET` already returns `404`.

## Key Modules

| Path                      | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `src/index.ts`            | Worker entry point (instrumentation + statsd)               |
| `src/app.ts`              | Hono app setup, auth middleware, `packages/batch` app mount |
| `src/upstream.ts`         | Header scrubber + zero-copy Cloud Run forwarder             |
| `src/middlewares/auth.ts` | End-user auth and internal auth token minting               |
| `src/middlewares/env.ts`  | Environment validation and cached upstream forwarder        |
| `src/routes/`             | Worker-local routes (currently `health`)                    |
| `src/env.ts`              | Worker environment bindings + `ensureEnv`                   |

## Local dev

This worker is the ingress half of the batch stack; the other half is the
`services/batch-api` Cloud Run service. Run the full stack under Tilt:

- `gcp-batch-api` — the upstream Cloud Run service (`services/batch-api`) on
  port `8686`, healthy on `GET /healthz`.
- `cfw-batch-api` — this ingress on `CFW_BATCH_API_PORT` (default `8800`).

By default `wrangler.toml` points `BATCH_API_INGEST_URL` and
`BATCH_API_CONTROL_URL` at their production Cloud Run services. Root POST
creation goes to ingest; all other public operations go to control. For local
dev Tilt overrides both with `http://127.0.0.1:8686`, where the Cloud Run app
runs in production-rejected `dev-all` mode. No prod URL or GCP creds are
required. When running this worker on
its own (`bunx wrangler dev`), `cp .dev.vars.example .dev.vars` to get the
same override (see [.dev.vars.example](./.dev.vars.example)).

Exercise the full ingress -> Cloud Run hop:

```bash
curl -i -X POST http://localhost:8800/api/v1/batches \
  -H 'content-type: application/json' -d '{}'
```

> The ingress mounts batch routes at both `/api/beta/batches` and
> `/api/v1/batches`. The v1 prefix is canonical, and the beta prefix will be
> retired later under OPE-5383.

## Commands

| Command              | Description                      |
| -------------------- | -------------------------------- |
| `bun run dev`        | Start local development server   |
| `bun run test`       | Run unit tests                   |
| `bun run test:watch` | Run tests in watch mode (vitest) |
| `bun run submit`     | Deploy to Cloudflare             |
| `bun run typecheck`  | Type-check with tsgo             |
| `bun run cf:bundle`  | Dry-run deploy to inspect bundle |
