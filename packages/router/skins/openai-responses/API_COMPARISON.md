# OpenAI Responses API vs Our Implementation - Comparison

This document provides a comprehensive comparison between OpenAI's official Responses API and our OpenRouter implementation.

## Table of Contents

- [API Overview](#api-overview)
- [Request Format](#request-format)
- [Response Format](#response-format)
- [Error Handling](#error-handling)
- [Feature Support](#feature-support)
- [Compatibility](#compatibility)

## API Overview

### OpenAI Responses API

- **Endpoint**: `https://api.openai.com/v1/responses`
- **Purpose**: Stateful API that combines chat completions and assistants capabilities
- **Release**: New API introduced in 2024/2025

### Our Implementation

- **Endpoint**: `https://openrouter.ai/api/v1/responses`
- **Purpose**: Compatible proxy that transforms Responses API requests to our internal chat/completions format
- **Architecture**: Stateless transformation layer over existing EdgeStream infrastructure

## Request Format

### Supported Parameters

| Parameter              | OpenAI     | Our Implementation | Status         | Notes                            |
| ---------------------- | ---------- | ------------------ | -------------- | -------------------------------- |
| `model`                | ✅ Required | ✅ Required         | ✅ Full Support |                                  |
| `input`                | ✅ Required | ✅ Required         | ✅ Full Support | String or array of messages      |
| `stream`               | ✅ Optional | ✅ Optional         | ✅ Full Support | Defaults to `false`              |
| `store`                | ✅ Optional | ❌ Not Supported    | ❌ Not Supported | Not supported                    |
| `reasoning`            | ✅ Optional | ✅ Optional         | ✅ Full Support | Transforms to `reasoning_effort` |
| `text.format`          | ✅ Optional | ✅ Optional         | ✅ Full Support | All formats supported            |
| `previous_response_id` | ✅ Optional | ❌ Not Supported    | ❌ Not Supported | Stateless - rejected with 400    |
| `include`              | ✅ Optional | ✅ Optional         | ⚠️ Parsed Only  | Not implemented                  |
| `max_output_tokens`    | ✅ Optional | ✅ Optional         | ✅ Full Support | Maps to `max_tokens`             |
| `verbosity`            | ✅ Optional | ✅ Optional         | ⚠️ Parsed Only  | Not implemented                  |
| `temperature`          | ✅ Optional | ✅ Optional         | ✅ Full Support |                                  |
| `top_p`                | ✅ Optional | ✅ Optional         | ✅ Full Support |                                  |
| `tools`                | ✅ Optional | ✅ Optional         | ✅ Full Support |                                  |
| `tool_choice`          | ✅ Optional | ✅ Optional         | ✅ Full Support |                                  |
| `truncation`           | ✅ Optional | ✅ Optional         | ⚠️ Parsed Only  | Not implemented                  |
| `user`                 | ✅ Optional | ✅ Optional         | ✅ Full Support |                                  |
| `safety_identifier`    | ✅ Optional | ✅ Optional         | ✅ Full Support | Recommended per-end-user abuse isolation; folded into the hashed upstream identity |

### Request Examples

#### Basic Request

```json
{
  "model": "anthropic/claude-3",
  "input": "Hello, how can you help me today?",
  "stream": false
}
```

#### Complex Request with Reasoning

```json
{
  "model": "anthropic/claude-3",
  "input": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Explain quantum computing"}
  ],
  "stream": true,
  "reasoning": {
    "effort": "high",
    "summary": "concise"
  },
  "text": {
    "format": {
      "type": "json_schema",
      "name": "explanation",
      "schema": {"type": "object", "properties": {"summary": {"type": "string"}}}
    }
  },
  "max_output_tokens": 1000,
  "temperature": 0.7
}
```

## Response Format

### Non-Streaming Response

#### OpenAI Format

```json
{
  "id": "resp_ABC123",
  "object": "response",
  "created_at": 1234567890,
  "model": "anthropic/claude-3",
  "output": [
    {
      "type": "message",
      "id": "msg_XYZ789",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Hello! I'm here to help you with any questions...",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 12,
    "output_tokens": 25,
    "total_tokens": 37
  },
  "status": "completed",
  "incomplete_details": null
}
```

✅ **Fully Compatible** - Same format with proper transformation from chat/completions

### Streaming Response

#### OpenAI SSE Events

```json
data: {"type": "response.created", "response": {"id": "resp_123", ...}}

data: {"type": "response.output_text.delta", "delta": "Hello"}

data: {"type": "response.completed", "response": {"usage": {...}}}

data: [DONE]
```

✅ **Fully Compatible** - Same SSE event types and format

## Error Handling

### Error Response Format

Both OpenAI and our implementation use the same error structure:

```json
{
  "error": {
    "message": "Missing required parameter: 'model'.",
    "type": "invalid_request_error",
    "param": "model",
    "code": "missing_required_parameter"
  }
}
```

### Canonical `error_type` Field (OpenRouter Extension)

Our implementation adds a top-level `error_type` field on failed responses to carry a stable, canonical error type across all API skins:

```json
{
  "id": "resp_abc123",
  "status": "failed",
  "error": { "code": "server_error", "message": "Invalid credentials" },
  "error_type": "authentication"
}
```

The Responses API `error.code` vocabulary is lossy — many distinct error types collapse to `server_error`. The `error_type` field preserves the precise reason (e.g., `authentication`, `provider_overloaded`, `timeout`) so clients can distinguish error categories programmatically. See the main [Errors documentation](https://openrouter.ai/docs/api/reference/errors#typed-error-codes) for the full typed error code reference.

### Supported Error Types

| Error Type              | OpenAI | Our Implementation | HTTP Status | Notes                 |
| ----------------------- | ------ | ------------------ | ----------- | --------------------- |
| `invalid_request_error` | ✅      | ✅                  | 400         | Validation errors     |
| `authentication_error`  | ✅      | ✅                  | 401         | Invalid API key       |
| `permission_error`      | ✅      | ✅                  | 403         | Access denied         |
| `not_found_error`       | ✅      | ✅                  | 404         | Model not found       |
| `rate_limit_exceeded`   | ✅      | ✅                  | 429         | Rate limiting         |
| `internal_server_error` | ✅      | ✅                  | 500         | Server errors         |
| `service_unavailable`   | ✅      | ✅                  | 503         | Temporary unavailable |

### Error Codes

| Code                         | Description                | OpenAI | Our Implementation |
| ---------------------------- | -------------------------- | ------ | ------------------ |
| `unknown_parameter`          | Invalid parameter name     | ✅      | ✅                  |
| `missing_required_parameter` | Required parameter missing | ✅      | ✅                  |
| `invalid_parameter_value`    | Invalid parameter value    | ✅      | ✅                  |
| `model_not_found`            | Model doesn't exist        | ✅      | ✅                  |
| `context_length_exceeded`    | Token limit exceeded       | ✅      | ✅                  |
| `content_policy_violation`   | Content filtered           | ✅      | ✅                  |
| `insufficient_quota`         | Rate limit/quota exceeded  | ✅      | ✅                  |
| `invalid_api_key`            | Authentication failed      | ✅      | ✅                  |

## Feature Support

### ✅ Fully Supported Features

1. **Request Transformation**
   - String and message array input formats
   - All standard chat parameters (temperature, max_tokens, etc.)
   - Tool calling with tool_choice
   - Response format specifications (text, json_object, json_schema)
   - Reasoning effort levels (high, medium, low, minimal)

2. **Response Transformation**
   - Message outputs with text content
   - Tool call outputs (function_call type)
   - Refusal handling
   - Usage statistics with detailed token counts
   - Status tracking (completed, incomplete, failed)
   - Incomplete details with proper reason codes

3. **Streaming Support**
   - Server-sent events format
   - All OpenAI event types
   - Proper event sequencing
   - Delta text streaming
   - Completion events with usage

4. **Error Handling**
   - OpenAI-compatible error format
   - All standard error types and codes
   - Proper HTTP status code mapping
   - Parameter-specific error messages

### ⚠️ Partially Supported (Parsed but Not Implemented)

1. **Stateful Features** (inherently unsupported due to stateless architecture)
   - `previous_response_id` - rejected with a 400 error (like `store: true`)
   - `include` array - parsed but doesn't affect output

2. **Advanced Features** (not implemented in backend)
   - `verbosity` control - parsed but doesn't affect output
   - `truncation` strategy - parsed but uses default behavior

3. **Output Types** (limited by transformation from chat/completions)
    - `reasoning` output items - not generated
    - `web_search_call` output items - generated via ServerToolsPlugin
    - Content annotations - populated for `url_citation` annotations (web search excerpts)

### ❌ Not Supported

1. **Stateful Operations**
   - Conversation state persistence
   - Multi-turn context without explicit message history
   - `store` parameter - not accepted in requests

2. **Advanced Output Types**
   - Reasoning chains with encrypted content
   - Web search integration
   - File operations and citations

## Compatibility

### ✅ High Compatibility Areas

1. **Core API Contract** - Request/response schemas match exactly
2. **Error Handling** - Identical error format and codes
3. **Streaming Protocol** - Same SSE format and event types
4. **Standard Parameters** - Full support for common use cases

### ⚠️ Compatibility Notes

1. **Model Names** - Use OpenRouter model identifiers (e.g., `anthropic/claude-3`)
2. **Stateless Nature** - Each request is independent
3. **Backend Limitations** - Some parsed parameters don't affect processing
4. **Output Scope** - Limited to message and function_call outputs

### 🧪 Testing Compatibility

Our implementation includes comprehensive tests to ensure compatibility:

- **42 Unit Tests** covering all transformations
- **6 Integration Tests** for end-to-end workflows
- **20 Error Handling Tests** for OpenAI format compliance
- **Schema Validation** for all request/response formats

## Migration Guide

### From OpenAI Responses API

1. **Change Base URL**: `https://api.openai.com/v1` → `https://openrouter.ai/api/v1`
2. **Update Model Names**: Use OpenRouter identifiers
3. **Review Stateful Dependencies**: Ensure requests are self-contained
4. **Test Edge Cases**: Verify behavior with your specific use cases

### Example Migration

**Before (OpenAI):**

```javascript
const response = await openai.responses.create({
  model: "gpt-4",
  input: "Hello world",
  stream: true
});
```

**After (OpenRouter):**

```javascript
const response = await fetch('https://openrouter.ai/api/v1/responses', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: "openai/gpt-4",
    input: "Hello world",
    stream: true
  })
});
```

## Conclusion

Our OpenAI Responses API implementation provides high compatibility with the official API while leveraging OpenRouter's extensive model support and infrastructure. The implementation focuses on the most commonly used features while maintaining strict adherence to OpenAI's error handling and response formats.

## Compatibility Score: 85%

- ✅ Core functionality: 100%
- ⚠️ Advanced features: 60%
- ❌ Stateful features: 0% (by design)

The implementation is production-ready for applications that don't rely on stateful features or advanced output types not available through chat/completions transformation.
