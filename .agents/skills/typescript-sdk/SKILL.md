---
name: typescript-sdk
description: >
  OpenRouter TypeScript SDK reference for building AI applications. Provides
  type-safe access to 400+ models with callModel API, tool system, streaming,
  and multi-turn conversations.
allowed-tools: Read, Write, Edit, Bash
user-invocable: false
---

# OpenRouter TypeScript SDK

Type-safe toolkit for building AI applications with access to 400+ language
models. Auto-generated from OpenAPI specifications ensuring zero version drift.

## Installation and Setup

```bash
npm install @openrouter/sdk
```

```typescript
import { OpenRouter } from '@openrouter/sdk';

const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

## Authentication

### API Key Authentication

Get API keys from [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).

```typescript
// Environment variable (recommended)
const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Direct configuration
const client = new OpenRouter({
  apiKey: 'sk-or-v1-...',
});
```

### OAuth PKCE Flow

For user-authorized access without storing API keys:

```typescript
import { createAuthCode, exchangeAuthCodeForAPIKey } from '@openrouter/sdk';

// Step 1: Generate auth URL with PKCE
const { url, codeVerifier } = await createAuthCode({
  clientId: 'your-client-id',
  redirectUri: 'https://yourapp.com/callback',
  scopes: ['chat', 'models'],
});

// Step 2: Redirect user to url, receive code at callback

// Step 3: Exchange code for API key
const { apiKey } = await exchangeAuthCodeForAPIKey({
  code: authorizationCode,
  codeVerifier,
  clientId: 'your-client-id',
  redirectUri: 'https://yourapp.com/callback',
});

// Step 4: Use the API key
const client = new OpenRouter({ apiKey });
```

## Core API: callModel

The `callModel` API provides a simplified interface for AI operations.

### Input Formats

```typescript
// Simple string input
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'What is quantum computing?',
});

// Message array input
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' },
  ],
});

// With system instructions
const result = client.callModel({
  model: 'openai/gpt-4o',
  instructions: 'You are a helpful coding assistant.',
  input: 'Write a function to sort an array',
});

// Multimodal input
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
    },
  ],
});
```

### Response Methods

```typescript
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Hello!',
});

// Plain text output
const text = await result.getText();

// Full response with token usage
const response = await result.getResponse();
// response.usage.prompt_tokens, response.usage.completion_tokens

// Stream text deltas
for await (const delta of result.getTextStream()) {
  process.stdout.write(delta);
}

// Stream reasoning (for reasoning models)
for await (const delta of result.getReasoningStream()) {
  process.stdout.write(delta);
}

// Stream cumulative message snapshots (NOT deltas).
// Each yield contains the full message text so far for that turn.
// Replace your display text on each event rather than appending.
for await (const messages of result.getNewMessagesStream()) {
  // messages contains the complete text up to this point, not a delta
  console.log('Current messages snapshot:', messages);
}

// Stream all events including tool progress
for await (const event of result.getFullResponsesStream()) {
  console.log('Event:', event.type, event);
}
```

### Generation Parameters

```typescript
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Write a story',
  temperature: 0.7,
  maxTokens: 1000,
  topP: 0.9,
  frequencyPenalty: 0.5,
  presencePenalty: 0.5,
  stop: ['\n\n'],
});
```

## Responses API Message Shapes

### Message Roles and Types

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
}

interface UserMessage {
  role: 'user';
  content: string | ContentPart[];
}

interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

interface SystemMessage {
  role: 'system';
  content: string;
}
```

### Content Parts

```typescript
type ContentPart = TextPart | ImagePart | AudioPart;

interface TextPart {
  type: 'text';
  text: string;
}

interface ImagePart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

interface AudioPart {
  type: 'input_audio';
  input_audio: {
    data: string; // base64
    format: 'wav' | 'mp3';
  };
}
```

### Tool Call Structures

```typescript
interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

interface ParsedToolCall<T = unknown> {
  id: string;
  name: string;
  arguments: T; // Parsed and validated
}

interface ToolExecutionResult<T = unknown> {
  toolCallId: string;
  name: string;
  result: T;
}
```

### Response Objects

```typescript
interface CallModelResponse {
  id: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: Choice[];
}

interface Choice {
  index: number;
  message: AssistantMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}
```

### TurnContext and StepResult

```typescript
interface TurnContext {
  numberOfTurns: number;
  messages: Message[];
  totalTokensUsed: number;
  totalCost: number;
  lastResponse: CallModelResponse | null;
  instructions: string | undefined;
}

interface StepResult {
  response: CallModelResponse;
  toolResults: ToolExecutionResult[];
  shouldStop: boolean;
  stopReason?: string;
}
```

## Event Shapes

### Streaming Event Types

```typescript
type StreamEvent =
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallCompleteEvent
  | ToolResultEvent
  | ResponseCompleteEvent
  | ErrorEvent;

interface TextDeltaEvent {
  type: 'text_delta';
  delta: string;
  snapshot: string; // Accumulated text so far
}

interface ReasoningDeltaEvent {
  type: 'reasoning_delta';
  delta: string;
  snapshot: string;
}

interface ToolCallStartEvent {
  type: 'tool_call_start';
  toolCallId: string;
  toolName: string;
}

interface ToolCallDeltaEvent {
  type: 'tool_call_delta';
  toolCallId: string;
  argumentsDelta: string;
}

interface ToolCallCompleteEvent {
  type: 'tool_call_complete';
  toolCall: ParsedToolCall;
}

interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  result: unknown;
}

interface ResponseCompleteEvent {
  type: 'response_complete';
  response: CallModelResponse;
}

interface ErrorEvent {
  type: 'error';
  error: Error;
}
```

### Processing Stream Events

```typescript
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Search for weather in Tokyo',
  tools: [weatherTool],
});

for await (const event of result.getFullResponsesStream()) {
  switch (event.type) {
    case 'text_delta':
      process.stdout.write(event.delta);
      break;

    case 'tool_call_start':
      console.log(`Calling tool: ${event.toolName}`);
      break;

    case 'tool_call_complete':
      console.log(`Tool args: ${JSON.stringify(event.toolCall.arguments)}`);
      break;

    case 'tool_result':
      console.log(`Tool result: ${JSON.stringify(event.result)}`);
      break;

    case 'response_complete':
      console.log(`Tokens used: ${event.response.usage.total_tokens}`);
      break;

    case 'error':
      console.error('Stream error:', event.error);
      break;
  }
}
```

## Tool System

### Defining Tools with Zod

```typescript
import { tool } from '@openrouter/sdk';
import { z } from 'zod';

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    conditions: z.string(),
    humidity: z.number(),
  }),
  execute: async (params) => {
    const weather = await fetchWeather(params.location, params.units);
    return {
      temperature: weather.temp,
      conditions: weather.description,
      humidity: weather.humidity,
    };
  },
});

const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'What is the weather in Tokyo?',
  tools: [weatherTool],
});
```

### Tool Types

#### Regular Tools

Standard tools with execute function returning output:

```typescript
const calculatorTool = tool({
  name: 'calculate',
  description: 'Perform arithmetic calculations',
  inputSchema: z.object({
    expression: z.string(),
  }),
  execute: async ({ expression }) => {
    return { result: eval(expression) };
  },
});
```

#### Generator Tools

Async generators yielding progress events:

```typescript
const searchTool = tool({
  name: 'search',
  description: 'Search the web',
  inputSchema: z.object({ query: z.string() }),
  eventSchema: z.object({
    type: z.enum(['progress', 'result']),
    data: z.unknown(),
  }),
  execute: async function* ({ query }) {
    yield { type: 'progress', data: 'Searching...' };

    const results = await performSearch(query);

    yield { type: 'progress', data: `Found ${results.length} results` };

    return { results };
  },
});
```

#### Manual Tools

User-controlled handling without automatic execution:

```typescript
const approvalTool = tool({
  name: 'request_approval',
  description: 'Request human approval for an action',
  inputSchema: z.object({
    action: z.string(),
    reason: z.string(),
  }),
  execute: false, // Manual handling required
});

// Handle manually in your code
for await (const event of result.getFullResponsesStream()) {
  if (event.type === 'tool_call_complete') {
    if (event.toolCall.name === 'request_approval') {
      const approved = await getUserApproval(event.toolCall.arguments);
      // Submit result back to conversation
    }
  }
}
```

#### Human-in-the-Loop (HITL) Tools

HITL tools use `onToolCalled` and optional `onResponseReceived` hooks to decide per-call whether to respond programmatically or pause for human input:

```typescript
const approvePaymentTool = tool({
  name: 'approve_payment',
  description: 'Approve a payment, escalating large amounts to a human',
  inputSchema: z.object({
    amount: z.number(),
    recipient: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    reviewedAt: z.number().optional(),
  }),
  onToolCalled: async (input) => {
    // Auto-approve small amounts
    if (input.amount < 100) {
      return { ok: true };
    }
    // Escalate to human - pauses the loop
    return null;
  },
  onResponseReceived: async (raw) => {
    // Post-process caller-supplied result
    return { ...(raw as object), reviewedAt: Date.now() };
  },
});
```

### Multi-Turn Behavior with Manual Tools

When `callModel` runs its multi-turn loop and encounters tool calls where no
tool has an `execute` function (i.e., all are manual), the SDK:

1. **Stops the loop** — `hasExecutableToolCalls()` returns `false`
2. **Sets `finalResponse`** — the model's response that invoked the manual
   tool becomes the final response
3. **Preserves the `function_call` output** — the tool call (with its name
   and arguments) is available in `finalResponse.output`

This means `getText()`, `getResponse()`, and `getToolCalls()` all resolve
immediately with the response that triggered the manual tool. The SDK does
**not** attempt to execute or re-prompt — it simply returns control to you.

### Approval Flows with Manual Tools

The primary use case for manual tools is approval flows: the model proposes
an action, your code presents it to a human, and the human decides whether
to proceed. Here is the full pattern:

```typescript
import { OpenRouter, tool } from '@openrouter/sdk';
import { z } from 'zod';

const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// 1. Define a manual tool (execute: false)
const deployTool = tool({
  name: 'deploy_to_production',
  description: 'Deploy the given service to production',
  inputSchema: z.object({
    service: z.string().describe('Name of the service to deploy'),
    version: z.string().describe('Version tag to deploy'),
    reason: z.string().describe('Why this deployment is needed'),
  }),
  execute: false, // SDK will NOT auto-execute this tool
});

// 2. Call the model with the manual tool
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Deploy the auth-service v2.3.1 to production to fix the login bug',
  tools: [deployTool],
});

// 3. The SDK stops the loop when the model calls the manual tool.
//    getToolCalls() resolves with the model's proposed action.
const toolCalls = await result.getToolCalls();

for (const toolCall of toolCalls) {
  if (toolCall.name === 'deploy_to_production') {
    const { service, version, reason } = toolCall.arguments;

    // 4. Present to the user for approval
    console.log(`Deploy requested: ${service}@${version}`);
    console.log(`Reason: ${reason}`);

    const approved = await promptUser('Approve this deployment? (y/n)');

    if (approved) {
      // 5. Execute the action manually
      await performDeploy(service, version);
      console.log('Deployment complete.');
    } else {
      console.log('Deployment rejected.');
    }
  }
}

// Alternatively, use getResponse() to access the full response object
// including token usage alongside the function_call output items:
const response = await result.getResponse();
```

#### Mixing Manual and Executable Tools

When a response contains both manual and executable tool calls, the SDK
executes only the tools that have an `execute` function and skips the manual
ones. Once all executable tools finish, if only manual tool calls remain
unexecuted, the loop stops and returns control to you.

```typescript
const searchTool = tool({
  name: 'search',
  description: 'Search for information',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const results = await performSearch(query);
    return { results };
  },
});

const confirmTool = tool({
  name: 'confirm_action',
  description: 'Confirm a proposed action with the user',
  inputSchema: z.object({
    action: z.string(),
    details: z.string(),
  }),
  execute: false,
});

const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Find the best flight to Tokyo and book it for me',
  tools: [searchTool, confirmTool],
});

// The SDK auto-executes searchTool, but when the model calls
// confirmTool, the loop stops. Use getToolCalls() on the final
// response to detect and handle the confirmation request.
const finalToolCalls = await result.getToolCalls();
const confirmation = finalToolCalls.find(
  (tc) => tc.name === 'confirm_action',
);

if (confirmation) {
  const { action, details } = confirmation.arguments;
  const approved = await promptUser(`${action}: ${details}. Proceed?`);
  // Continue or abort based on user input
}
```

#### Streaming Manual Tool Calls

You can also detect manual tool calls via streaming instead of awaiting
the full response:

```typescript
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Delete all inactive users from the database',
  tools: [deleteUsersTool], // execute: false
});

for await (const event of result.getFullResponsesStream()) {
  if (event.type === 'tool_call_complete') {
    if (event.toolCall.name === 'delete_inactive_users') {
      const { userIds } = event.toolCall.arguments;
      console.log(`Model wants to delete ${userIds.length} users`);
      const approved = await promptUser('Approve deletion?');
      // Handle approval...
    }
  }
}
```

### Multi-Turn Tool Execution

```typescript
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Research quantum computing and summarize the key concepts',
  tools: [searchTool, analysisTool, summaryTool],
  maxToolRounds: 5, // Allow up to 5 rounds of tool execution
});

const text = await result.getText();
```

## Multi-Turn and Stop Conditions

### Built-in Stop Conditions

```typescript
import {
  stepCountIs,
  maxCost,
  maxTokensUsed,
  hasToolCall,
  finishReasonIs,
} from '@openrouter/sdk';

const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Research this topic thoroughly',
  tools: [searchTool, analyzeTool],
  stopWhen: [
    stepCountIs(10),            // Stop after 10 turns
    maxCost(1.00),              // Stop when cost exceeds $1
    maxTokensUsed(10000),       // Stop after 10k tokens
    hasToolCall('final_answer'), // Stop when specific tool called
    finishReasonIs('stop'),     // Stop on natural completion
  ],
});
```

### Custom Stop Conditions

```typescript
const result = client.callModel({
  model: 'openai/gpt-4o',
  input: 'Keep iterating until quality score > 0.9',
  tools: [evaluateTool],
  stopWhen: [
    // Custom condition receiving TurnContext
    (ctx) => {
      const lastToolResult = ctx.messages
        .filter((m) => m.role === 'tool')
        .pop();

      if (lastToolResult) {
        const result = JSON.parse(lastToolResult.content);
        return result.qualityScore > 0.9;
      }
      return false;
    },
  ],
});
```

### Dynamic Parameters

Any parameter can be a function receiving context:

```typescript
const result = client.callModel({
  // Upgrade model after several turns
  model: (ctx) => (ctx.numberOfTurns > 3 ? 'openai/gpt-4o' : 'openai/gpt-4o-mini'),

  // Async parameter fetching
  temperature: async (ctx) => {
    const prefs = await fetchUserPreferences();
    return prefs.temperature ?? 0.7;
  },

  // Adjust instructions based on context
  instructions: (ctx) => {
    if (ctx.totalCost > 0.5) {
      return 'Be more concise to reduce costs.';
    }
    return 'Provide detailed explanations.';
  },

  input: 'Help me with my task',
});
```

### Next Turn Params

Tools can modify callModel parameters for subsequent turns:

```typescript
const skillTool = tool({
  name: 'activate_skill',
  inputSchema: z.object({
    skillType: z.enum(['coding', 'research', 'creative']),
  }),
  nextTurnParams: {
    instructions: (params, context) => {
      const skillInstructions = {
        coding: 'Write clean, tested code with error handling.',
        research: 'Cite sources and verify facts.',
        creative: 'Be imaginative and explore novel ideas.',
      };
      return `${context.instructions}\n\n${skillInstructions[params.skillType]}`;
    },
    temperature: (params) => {
      return params.skillType === 'creative' ? 0.9 : 0.3;
    },
  },
  execute: async (params) => ({ activated: params.skillType }),
});
```

## API Reference

### Client Methods

```typescript
const client = new OpenRouter({ apiKey: '...' });

// High-level API (recommended)
client.callModel(options);

// Low-level APIs
client.chat.send(options);           // Chat completions
client.completions.generate(options); // Text completions
client.embeddings.generate(options);  // Embeddings

// Management APIs
client.apikeys.list();
client.apikeys.create(options);
client.credits.get();
client.models.list();
client.analytics.get();
client.guardrails.create(options);
```

### Error Handling

```typescript
import { OpenRouterError } from '@openrouter/sdk';

try {
  const result = await client.callModel({
    model: 'openai/gpt-4o',
    input: 'Hello!',
  }).getText();
} catch (error) {
  if (error instanceof OpenRouterError) {
    switch (error.statusCode) {
      case 400:
        console.error('Bad request:', error.message);
        break;
      case 401:
        console.error('Invalid API key');
        break;
      case 402:
        console.error('Insufficient credits');
        break;
      case 403:
        console.error('Access forbidden');
        break;
      case 404:
        console.error('Model not found');
        break;
      case 429:
        console.error('Rate limited, retry after:', error.retryAfter);
        break;
      case 500:
        console.error('Server error');
        break;
      case 503:
        console.error('Service unavailable');
        break;
    }
  }
  throw error;
}
```

### Message Format Conversion

```typescript
import { fromChatMessages, toChatMessages } from '@openrouter/sdk';

// Convert from OpenAI chat format
const chatMessages = [
  { role: 'system', content: 'Be helpful' },
  { role: 'user', content: 'Hello!' },
];

const result = client.callModel({
  model: 'openai/gpt-4o',
  input: fromChatMessages(chatMessages),
});

// Convert back to chat format
const response = await result.getResponse();
const outputMessages = toChatMessages(response);
```

## Best Practices

### Production Agent Implementation

```typescript
import { OpenRouter, tool, stepCountIs, maxCost } from '@openrouter/sdk';
import { z } from 'zod';

// Initialize client
const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Define tools
const searchTool = tool({
  name: 'web_search',
  description: 'Search the web for information',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().optional().default(5),
  }),
  execute: async ({ query, maxResults }) => {
    const results = await performWebSearch(query, maxResults);
    return { results };
  },
});

const analyzeTool = tool({
  name: 'analyze_data',
  description: 'Analyze data and extract insights',
  inputSchema: z.object({
    data: z.unknown(),
    analysisType: z.enum(['summary', 'trends', 'anomalies']),
  }),
  execute: async ({ data, analysisType }) => {
    const analysis = await runAnalysis(data, analysisType);
    return { analysis };
  },
});

// Run agent
async function runResearchAgent(topic: string): Promise<string> {
  const result = client.callModel({
    model: 'openai/gpt-4o',
    instructions: `You are a research assistant. Research the given topic
      thoroughly using available tools, then provide a comprehensive summary.`,
    input: `Research topic: ${topic}`,
    tools: [searchTool, analyzeTool],
    maxToolRounds: 10,
    stopWhen: [
      stepCountIs(15),
      maxCost(2.00),
    ],
  });

  // Stream progress to console
  for await (const event of result.getFullResponsesStream()) {
    if (event.type === 'tool_call_start') {
      console.log(`Using tool: ${event.toolName}`);
    }
    if (event.type === 'text_delta') {
      process.stdout.write(event.delta);
    }
  }

  return result.getText();
}

// Execute
const summary = await runResearchAgent('quantum computing applications');
console.log('\n\nFinal Summary:', summary);
```

### Streaming Chat with Error Recovery

```typescript
async function streamChat(
  messages: Message[],
  onDelta: (text: string) => void
): Promise<string> {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const result = client.callModel({
        model: 'openai/gpt-4o',
        input: messages,
      });

      let fullText = '';

      for await (const delta of result.getTextStream()) {
        fullText += delta;
        onDelta(delta);
      }

      return fullText;
    } catch (error) {
      attempt++;

      if (error.statusCode === 429 && attempt < maxRetries) {
        const delay = error.retryAfter ?? 1000 * attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}
```

## Additional Resources

- [OpenRouter Documentation](https://openrouter.ai/docs)
- [API Reference](https://openrouter.ai/docs/api/reference)
- [Model List](https://openrouter.ai/models)
- [GitHub Repository](https://github.com/openrouter/sdk-typescript)
