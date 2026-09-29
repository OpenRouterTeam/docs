# cfw-rerank-api

Cloudflare Worker serving OpenRouter's `/api/v1/rerank` endpoint. Handles authentication, request validation, and delegates to the `packages/rerank` engine for provider-agnostic reranking with Durable Object offloading for large payloads.

## Architecture

```mermaid
graph TD
    Client["API Client\nPOST /api/v1/rerank"] --> CFW["cfw-rerank-api\nHono + Cloudflare Worker"]
    CFW --> Auth["Auth Middleware"]
    Auth --> Submit["submit.ts\nrequest validation + routing"]
    Submit --> Rerank["@openrouter-monorepo/rerank\nsubmitRerank"]
    Submit --> DO["ProcessStreamJson DO\nTier 1 offloading\nfor large image payloads"]
    CFW --> Health["GET /health"]
    CFW --> LiveConfig["KV Live Config\nstreaming thresholds + kill switch"]
```

## Key Modules

| Path | Purpose |
|------|---------|
| `src/index.ts` | Worker entrypoint — Hono app with Datadog instrumentation |
| `src/app.ts` | Hono app setup and route registration |
| `src/routes/rerank/submit.ts` | Rerank submission handler with Zod validation and DO offloading |
| `src/routes/health.ts` | Health check endpoint |
| `src/live-config.ts` | KV-backed runtime config for supersize streaming thresholds and the request body size cap |
| `../../packages/cloudflare/hono/content-length-cap.ts` | Shared `Content-Length` cap check backing the 413 middleware on the submit route |
| `src/utils/setup-streaming-request-if-needed.ts` | Durable Object streaming setup for large payloads |

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Start local dev server (wrangler) |
| `bun run test` | Run tests |
| `bun run submit` | Deploy to Cloudflare |
| `tsgo --noEmit` | Type-check |
