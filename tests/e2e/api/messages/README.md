# Anthropic Messages API E2E Test Suite

Comprehensive end-to-end test suite for the Anthropic Messages API (`/api/v1/messages`).

## ✅ Completed Infrastructure (5 files)

### Core Utilities

1. **`fixtures/messages-request-factory.ts`** - Request builders for all scenarios
   - `MessagesRequestBuilder.simple()` - Basic completions
   - `MessagesRequestBuilder.streaming()` - Streaming mode
   - `MessagesRequestBuilder.withTools()` - Tool calling
   - `MessagesRequestBuilder.withImages()` - Image input
   - `MessagesRequestBuilder.withThinking()` - Extended thinking
   - `MessagesRequestBuilder.withCaching()` - Prompt caching
   - `MessagesRequestBuilder.withStructuredOutput()` - JSON schema
   - `MessagesRequestBuilder.withWebSearch()` - Native web search
   - `MessagesRequestBuilder.withFallback()` - Multi-model fallback
   - `TestTools` - Pre-configured tool definitions (weather, stock, time)

2. **`api/shared/messages-stream-parser.ts`** - SSE event parsing
   - `parseMessagesStream()` - Parse Anthropic SSE events
   - `assembleMessagesStreamedContent()` - Assemble text from deltas
   - `assembleMessagesStreamedToolUse()` - Assemble tool calls
   - `assembleMessagesStreamedThinking()` - Assemble thinking blocks
   - `validateMessagesStreamEnd()` - Verify proper termination
   - `extractMessagesStreamUsage()` - Extract usage info
   - `extractMessagesStreamId/Model/StopReason()` - Extract metadata

3. **`api/shared/messages-validators.ts`** - Boolean predicates
   - `hasMessagesContent()` - Check for text content
   - `hasMessagesToolUse()` - Check for tool_use blocks
   - `hasMessagesThinking()` - Check for thinking blocks
   - `hasCacheCreationTokens()` - Cache validation
   - `hasValidStopReason()` - Validate stop_reason
   - `hasValidMessagesUsage()` - Validate usage structure
   - `hasValidMessagesStructure()` - Full response validation
   - `hasTextDelta()` / `hasToolUseDelta()` / `hasThinkingDelta()` - Stream deltas

4. **`api/shared/messages-assertions.ts`** - High-level assertions
   - `assertSuccessfulMessagesCompletion()` - Full response validation
   - `assertHasMessagesToolUse()` - Tool use validation
   - `assertHasMessagesThinking()` - Thinking validation
   - `assertMessagesStreamComplete()` - Stream validation
   - `assertMessagesErrorResponse()` - Error validation
   - `assertMinimumMessagesTokens()` - Token validation
   - `assertMessagesStopReason()` - Stop reason validation
   - `assertHasCacheTokens()` - Cache token validation

5. **`api/shared/messages-multi-turn-helpers.ts`** - Conversation helpers
   - `buildMessagesToolResult()` - Build tool_result blocks
   - `runMessagesToolConversation()` - Complete tool calling flow
   - `runMessagesMultiTurn()` - Multi-step conversations

## ✅ Completed Tests (6 files)

### Basic Tests (4 files)

1. **`basic/simple.test.ts`** ✅
   - Non-streaming completion across multiple models
   - Respects max_tokens parameter
   - Respects temperature parameter
   - Validates response structure with inline snapshot
   - Checks message type and role

2. **`basic/streaming.test.ts`** ✅
   - Streaming completion across multiple models
   - Assembles streamed content correctly
   - Includes message metadata (id, model, stop_reason)
   - Includes usage in stream
   - Validates event order (message_start → deltas → message_stop)
   - Respects max_tokens in streaming

3. **`basic/error-handling.test.ts`** ✅
   - Invalid model
   - Missing max_tokens (required field)
   - Empty messages array
   - Invalid message role
   - Invalid max_tokens
   - Invalid API key
   - Very large max_tokens

4. **`basic/authentication.test.ts`** ✅
   - Valid API key
   - Invalid API key
   - Disabled API key
   - Deleted API key
   - Depleted API key
   - Missing API key header
   - Free tier limits

### Tool Calling Tests (2 files)

5. **`tool-calling/single-turn.test.ts`** ✅
   - Returns tool_use block (non-streaming)
   - Returns tool_use block (streaming)
   - Tool_use block has correct structure (id, name, input)
   - Tool input contains expected parameters
   - Handles multiple tools correctly

6. **`tool-calling/multi-turn.test.ts`** ✅
   - Completes full tool calling conversation
   - Handles tool result correctly
   - Handles multiple sequential tool uses
   - Preserves message history correctly

## 📋 Remaining Tests (22 files)

### Tool Calling (2 more files)

- [ ] `tool-calling/parallel.test.ts` - Multiple parallel tool calls
- [ ] `tool-calling/web-search.test.ts` - Native Anthropic web search

### Reasoning/Thinking (3 files)

- [ ] `reasoning/basic.test.ts` - Extended thinking validation
- [ ] `reasoning/streaming.test.ts` - Streaming thinking deltas
- [ ] `reasoning/with-tool-calling.test.ts` - Thinking + tools

### Caching (2 files)

- [ ] `caching/basic.test.ts` - Cache creation and reading
- [ ] `caching/with-tools.test.ts` - Cached tools

### Multimodal (3 files)

- [ ] `multimodal/image-input.test.ts` - Base64 and URL images
- [ ] `multimodal/pdf-input.test.ts` - PDF processing
- [ ] `multimodal/large-media.test.ts` - Large file handling

### Structured Output (1 file)

- [ ] `structured-output/json-schema.test.ts` - JSON schema validation

### Parameters (4 files)

- [ ] `parameters/temperature.test.ts` - Temperature range testing
- [ ] `parameters/max-tokens.test.ts` - Token limit testing
- [ ] `parameters/stop-sequences.test.ts` - Custom stop sequences
- [ ] `parameters/top-p-top-k.test.ts` - Sampling parameters

### Beta Features (2 files)

- [ ] `beta-features/fine-grained-tool-streaming.test.ts` - Beta tool streaming
- [ ] `beta-features/interleaved-thinking.test.ts` - Interleaved thinking

### Edge Cases (4 files)

- [ ] `edge-cases/orphaned-tool-use.test.ts` - Orphaned tool_use fixing
- [ ] `edge-cases/incomplete-responses.test.ts` - Low max_tokens
- [ ] `edge-cases/refusals.test.ts` - Content policy violations
- [ ] `edge-cases/annotations.test.ts` - System annotations

### OpenRouter Features (3 files)

- [ ] `openrouter-features/model-fallback.test.ts` - Multi-model fallback
- [ ] `openrouter-features/router-config.test.ts` - Router configuration
- [ ] `openrouter-features/reasoning-details.test.ts` - Reasoning token breakdown

## 🎯 Progress Summary

**Completed:** 11 files (5 utilities + 6 tests)
**Remaining:** 22 test files
**Total:** 33 files

**Coverage Achieved:**
- ✅ Core infrastructure (100%)
- ✅ Basic functionality (100%)
- ✅ Tool calling basics (50%)
- ⏳ Advanced features (0%)
- ⏳ Edge cases (0%)

## 🚀 Quick Start

### Running Tests

```bash
# Run all Messages API tests
cd tests/e2e
bun run test api/messages

# Run specific test suite
bun run test api/messages/basic
bun run test api/messages/tool-calling

# Run single test file
bun run test api/messages/basic/simple.test.ts
```

### Adding New Tests

1. **Use existing builders:**
   ```typescript
   import { MessagesRequestBuilder, TestTools } from '@/fixtures/messages-request-factory';
   ```

2. **Use assertions:**
   ```typescript
   import { assertSuccessfulMessagesCompletion } from '../../shared/messages-assertions';
   ```

3. **Follow patterns:**
   - Test with multiple models using `describe.each(TestModelGroups.X)`
   - Test both streaming and non-streaming modes
   - Use Result monad with `assertOk()`/`assertErr()`
   - Validate structure with inline snapshots

### Example Test

```typescript
import { assertOk } from '@openrouter-monorepo/lib-result';
import { describe, it } from 'vitest';
import { assertSuccessfulMessagesCompletion } from '../../shared/messages-assertions';
import { MessagesRequestBuilder } from '@/fixtures/messages-request-factory';
import { callApi } from '@/utils/call-api';

describe('New Feature', () => {
  it('works correctly', async () => {
    const result = await callApi('/api/v1/messages', {
      body: MessagesRequestBuilder.simple(),
    });

    assertOk(result);
    assertSuccessfulMessagesCompletion(result.data.data);
  });
});
```

## 📚 Key Differences from Chat Completions API

The Messages API uses different formats than Chat Completions:

**Request:**
- `system` parameter separate from `messages` array
- `messages` contains only `user`/`assistant` roles
- `max_tokens` is required (not `max_completion_tokens`)
- Tool results are `tool_result` blocks in user messages

**Response:**
- `stop_reason` instead of `finish_reason`
- Values: `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `refusal`, `pause_turn`, `compaction`
- `content` array with typed blocks
- Block types: `text`, `tool_use`, `thinking`, etc.
- `usage` with `input_tokens`, `output_tokens`, cache tokens

**Streaming:**
- SSE events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`
- Each event has `type` and event-specific data
- Different from OpenAI's `data: [DONE]` pattern

## 🔧 Troubleshooting

**Tests failing with auth errors:**
- Check `.env.local` has valid API keys
- Verify `config.specialKeys` in test config

**Streaming tests failing:**
- Ensure SSE parsing handles all event types
- Check for proper stream termination with `message_stop`

**Type errors:**
- Import types from `@anthropic-ai/sdk`
- Use type assertions for response data

## 📖 References

- [Anthropic Messages API Docs](https://docs.anthropic.com/en/api/messages)
- [OpenRouter Messages API](https://openrouter.ai/docs#anthropic-messages)
- [Test Plan](https://github.com/openrouter/openrouter-web/tree/main/.claude/plans)
