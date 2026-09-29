# OpenRouter SDK Devtools (TypeScript)

Development-only telemetry capture for OpenRouter TypeScript SDK.

## Features

- 📊 Normalize recognized SDK operations into a local telemetry format
- 💾 Store telemetry in local JSON file (`.devtools/openrouter-generations.json`)
- 🔔 Notify local devtools server of changes
- 🛡️ Production-safe (throws error if used in production)
- 🧯 Capture failures do not change SDK requests or responses

## Installation

Install the published package as a development dependency:

```bash
bun add --dev @openrouter/devtools
```

## Client Compatibility

There is currently no complete supported public client integration:

- `@openrouter/sdk` does not expose a typed public constructor option for attaching the plain DevTools hook object.
- `@openrouter/agent` accepts the hooks, but `callModel` uses a streaming Responses API request. DevTools does not yet parse that SSE response or normalize the Responses API schema, so the recorded run does not complete correctly.

The hooks and viewer remain pre-release. Do not document either published client as a working setup until its request and response path is supported end to end.

## Data Format

### Run Object

```json
{
  "id": "1702345678901-abc123",
  "started_at": "2024-12-11T10:30:00.000Z",
  "operation": "chat",
  "model": "openai/gpt-4",
  "status": "success",
  "steps": [...]
}
```

### Step Object

```json
{
  "run_id": "1702345678901-abc123",
  "step_number": 1,
  "type": "chat",
  "started_at": "2024-12-11T10:30:00.000Z",
  "completed_at": "2024-12-11T10:30:02.500Z",
  "request": {
    "model": "openai/gpt-4",
    "messages": [...],
    "parameters": {...}
  },
  "response": {
    "content": "Hello!",
    "usage": {
      "prompt_tokens": 10,
      "completion_tokens": 2,
      "total_tokens": 12
    },
    "provider": "openai",
    "model": "gpt-4-0613"
  },
  "duration_ms": 2500
}
```

The example above illustrates the stored chat telemetry schema; it is not a currently supported public client setup.

## Recognized Operation IDs

- `sendChatCompletionRequest` - Chat completions API
- `createResponses` - Responses API

These are internal operation IDs recognized by the hook implementation, not a list of working public client integrations. All other SDK operations are ignored.

## Environment Safety

Throws error if `NODE_ENV === 'production'`:

```
Error: OpenRouter devtools cannot be used in production.
Remove devtools initialization or use environment-based conditional initialization.
```

## Storage Location

Default: `.devtools/openrouter-generations.json`

- Auto-creates directory if missing
- Loads existing data on init
- Debounced writes (500ms)
- Flushes on process exit (SIGINT, SIGTERM, exit)

## Server Notification

Sends POST to `http://localhost:4983/api/notify` when data changes.

- Fire-and-forget (non-blocking)
- Silently ignores errors (server not running is OK)

## Error Handling

Devtools failures never break SDK operations:

- Storage errors: Silently ignored, continue without persistence
- Hook errors: Silently ignored, request/response unchanged
- Server errors: Silently ignored

## License

ISC
