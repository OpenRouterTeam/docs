# Fake Provider Service

A minimal OpenAI-compatible API service that returns Lorem Ipsum text, useful for testing streaming behavior, delays, and error handling.

## Leveraging end to end

You will have to stand up mission control (`bun run dev mission-control`) and un-hide "openai/gpt-4.1-2025-04-14" in the [hidden endpoints page](http://localhost:3001/endpoints/hidden). By default it will hit the [production Cloud Run deployment](https://fake-provider-2gagoduuea-uc.a.run.app/v1) which is seeded in Postgres.

You can make requests with the model name `openai/gpt-4.1-2025-04-14` and preference for "fake-provider". Set `X-Completion-Tokens` to the number of tokens you want generated; it defaults to 300 when the header is absent or invalid. The body's `max_tokens` still limits the response, so a smaller `max_tokens` wins, and generation never exceeds 100,000 tokens.

```
curl http://localhost:8787/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H Authorization:\ Bearer\ sk-or-v1-unlimitedkey \
  -d '{
  "model": "openai/gpt-4.1-2025-04-14",
  "provider": {
    "order": ["fake-provider"],
    "allow_fallbacks": false
  },
  "max_tokens": 20,
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "xyz"
    }
  ]
}'
```

When running against local cfw-api, you can pass in the other headers. For example to delay 1000ms between tokens with streaming enabled:

```
curl http://localhost:8787/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H Authorization:\ Bearer\ sk-or-v1-unlimitedkey \
  -H "X-Per-chunk-Delay-Ms: 1000" \
  -d '{
  "model": "openai/gpt-4.1-2025-04-14",
  "provider": {
    "order": ["fake-provider"],
    "allow_fallbacks": false
  },
  "max_tokens": 20,
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "xyz"
    }
  ]
}'
```

Fake-provider requests against production cfw-api support these headers. Router ingress preserves the registered headers, and `FakeAdapter` forwards them to the fake provider. This is used by `tests/performance/scenario/fake-provider/fake-provider-production-load.ts`, which targets the production API URL.

The fake provider admin pane is [here](http://localhost:3001/provider/fake-provider) if you instead want to direct the requests to local (`http://localhost:3002/v1`).

### The "stream" flag is ignored by the fake provider

The fake provider ignores the "stream" request property, streaming responses whether it is "true" or "false". To simulate non-streaming behavior, set the `X-Is-Upstream-SSE: false` header in your request. See "Simulate non-streaming upstream" below for an example.

The reason for this is that the user's preference for `"stream": true` or `"stream": false` currently has little influence on the request to the upstream provider. Streaming requests are preferred in all cases when they are supported upstream. If the end-user does not want a stream, cfw-api will accumulate the full JSON to send back to the user when `"stream": false` is requested. Therefore ignoring this flag is more similar to real-world usage.

So if you want to test:

* Streaming requests with streaming providers, eg gpt-4.1 etc. -- set `"stream": true`
* Non-streaming requests with streaming providers, eg gpt-4.1 etc. -- set `"stream": false` (or nothing)
  - This can exercise the codepath in cfw-api where the full JSON block is accumulated before sending to the user
* Streaming requests with non-streaming providers, eg O1 etc. -- set `"stream": true` and the `X-Is-Upstream-SSE: false` header
  - This can exercise the codepath in cfw-api where the large JSON block is turned into deltas to stream to the user
* Non-Streaming requests with non-streaming providers, eg O1 etc. -- set `"stream": false` and the `X-Is-Upstream-SSE: false` header

Here's an example request where cfw-api would stream data back to the user, even though the fake provider is not streaming data to cfw-api:

```
curl http://localhost:8787/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H Authorization:\ Bearer\ sk-or-v1-unlimitedkey \
  -H "X-Is-Upstream-SSE: false" \
  -H "X-Per-chunk-Delay-Ms: 1000" \
  -d '{
  "model": "openai/gpt-4.1-2025-04-14",
  "provider": {
    "order": ["fake-provider"],
    "allow_fallbacks": false
  },
  "max_tokens": 20,
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": "xyz"
    }
  ]
}'
```

## Running Locally

```bash
bun run dev fake-provider
```

## API Headers

The fake provider supports custom headers to control streaming behavior and generated output:

### `X-Initial-Delay-Ms`

Controls the delay before the first chunk is sent.

- **Type:** Integer (milliseconds)
- **Default:** 50
- **Example:** `X-Initial-Delay-Ms: 1000` (1 second delay before first chunk)

### `X-Per-Chunk-Delay-Ms`

Controls the delay between each chunk during streaming.

- **Type:** Integer (milliseconds)
- **Default:** 50
- **Example:** `X-Per-Chunk-Delay-Ms: 200` (200ms delay between chunks)

### `X-Simulate-Mid-Stream-Error`

Simulates a server error after the first chunk for testing error handling.

- **Type:** Boolean string
- **Default:** Not set
- **Example:** `X-Simulate-Mid-Stream-Error: true`
- **Behavior:** When enabled, the service will send the first chunk successfully, then inject an error object and terminate the stream

### `X-Is-Upstream-SSE`

Simulates an upstream that doesn't support streaming responses.

- **Type:** Boolean string
- **Default:** True
- **Example:** `X-Is-Upstream-SSE: False`
- **Behavior:** When disabled, the service will return the full JSON response at once instead of streaming chunks. It's up to cfw-api to convert this to the user's preference.

### `X-Text-Generation-Mode`

Generate different sorts of text.

- **Type:** enum of 'lorem-ipsum', 'random-letters', 'random-tokens' or 'custom'.
- **Default:** lorem-ipsum
- **Example:** `X-Text-Generation-Mode: random-tokens`
- **Behavior:** Customize the text generated by the fake provider. 

### `X-Custom-Text`

Generate different sorts of text.

- **Type:** string
- **Default:** not set
- **Example:** `X-Custom-Text: hello world`
- **Behavior:** Have the fake provider generate specific text, coupled with `X-Text-Generation-Mode: custom`

### `X-Completion-Tokens`

How many content tokens to generate.

- **Type:** Positive integer string
- **Default:** 300 when absent or invalid
- **Ceiling:** 100,000 tokens
- **Example:** `X-Completion-Tokens: 5000`
- **Behavior:** The fake provider generates this many tokens. The body's `max_tokens` still limits the response, so the response is the smaller of the two when both are present, and generation never exceeds 100,000 tokens. Reasoning tokens are counted separately, via `X-Reasoning-Tokens`.

### `X-Reasoning-Tokens`

Generate reasoning tokens in the response (simulates models like o1 that output reasoning).

- **Type:** Integer (number of reasoning tokens)
- **Default:** 0 (no reasoning tokens)
- **Example:** `X-Reasoning-Tokens: 50`
- **Behavior:** When set to a positive number, the fake provider will generate reasoning tokens before the main content, capped at 100,000 tokens. The reasoning appears in the `delta.reasoning` field for streaming responses and in `message.reasoning` for non-streaming responses. The usage object will include `completion_tokens_details.reasoning_tokens` to track the reasoning token count separately.

## Direct Usage Examples

### Basic Request (Default Delays)

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-fake-provider-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20
  }'
```

**Expected behavior:** Streaming starts after ~50ms, with ~50ms between chunks.

### Custom Initial Delay

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-fake-provider-api-key" \
  -H "Content-Type: application/json" \
  -H "X-Initial-Delay-Ms: 1000" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20
  }'
```

**Expected behavior:** 1 second delay before first chunk, then default 50ms between chunks.

### Custom Per-Chunk Delay

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-fake-provider-api-key" \
  -H "Content-Type: application/json" \
  -H "X-Per-Chunk-Delay-Ms: 200" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20
  }'
```

**Expected behavior:** Default 50ms initial delay, then 200ms between each chunk.

### Simulate Mid-Stream Error

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-fake-provider-api-key" \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Mid-Stream-Error: true" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20
  }'
```

**Expected output:**
```
data: {"id":"chatcmpl-1234567890","object":"chat.completion.chunk","created":1234567890,"model":"fake-provider-model","provider":"FakeProvider","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null,"index":0,"logprobs":null}]}

data: {"id":"chatcmpl-1234567890","object":"chat.completion.chunk","created":1234567890,"model":"fake-provider-model","provider":"FakeProvider","choices":[{"delta":{"role":"assistant","content":"Lorem"},"finish_reason":null,"index":0,"logprobs":null}]}

data: {"id":"chatcmpl-1234567890","object":"chat.completion.chunk","created":1234567890,"model":"fake-provider-model","provider":"FakeProvider","choices":[],"error":{"code":500,"message":"The server had an error processing your request"}}

data: [DONE]
```

**Expected behavior:** Sends the first chunk successfully, then injects an error and terminates the stream.

### Simulate non-streaming upstream

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-fake-provider-api-key" \
  -H "Content-Type: application/json" \
  -H "X-Is-Upstream-SSE: false" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20
  }'
```

**Expected output:**
```
{"id":"chatcmpl-1761972439822","object":"chat.completion","created":1761972439,"model":"fake-provider-model","choices":[{"index":0,"finish_reason":"stop","logprobs":null,"message":{"role":"assistant","content":"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor i","refusal":null}}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}
```

**Expected behavior:** Returns the full response without streaming, akin to O1 and other provider/model combos that do not support streaming.

### Generate Reasoning Tokens (Streaming)

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-fake-provider-api-key" \
  -H "Content-Type: application/json" \
  -H "X-Reasoning-Tokens: 30" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20
  }'
```

**Expected behavior:** Streams reasoning tokens first (in `delta.reasoning` field), followed by content tokens (in `delta.content` field). The final chunk includes usage information with `completion_tokens_details.reasoning_tokens` showing the reasoning token count.

### Generate Reasoning Tokens (Non-Streaming)

```bash
curl -X POST http://localhost:3002/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-fake-provider-api-key" \
  -H "Content-Type: application/json" \
  -H "X-Reasoning-Tokens: 30" \
  -H "X-Is-Upstream-SSE: false" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 20
  }'
```

**Expected output:**
```json
{
  "id": "chatcmpl-1761972439822",
  "object": "chat.completion",
  "created": 1761972439,
  "model": "fake-provider-model",
  "choices": [{
    "index": 0,
    "finish_reason": "stop",
    "logprobs": null,
    "message": {
      "role": "assistant",
      "content": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor i",
      "reasoning": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud",
      "refusal": null
    }
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 50,
    "total_tokens": 60,
    "completion_tokens_details": {
      "reasoning_tokens": 30
    }
  }
}
```

**Expected behavior:** Returns a non-streaming response with both reasoning and content fields populated. The usage object shows the reasoning tokens separately.

## Authentication

All requests require the `Authorization` header with a Bearer token matching the `FAKE_PROVIDER_API_KEY` environment variable:

```bash
Authorization: Bearer sk-or-v1-fake-provider-api-key
```
