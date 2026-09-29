---
name: create-server-tool
description: >-
  This skill should be used when creating a new OpenRouter
  server tool — a tool that executes server-side during
  model inference (e.g., datetime, web search). It covers
  the full workflow: defining the tool with the agent SDK
  tool() function, registering it, wiring up request
  schemas, and optional advanced features like shared
  context, citation extraction, native passthrough, and
  custom stream formats.
user-invocable: true
---

# Create a Server Tool

## Overview

Server tools are OpenRouter-native tools that execute
server-side during model inference. Each tool is a native
`tool()` instance from `@openrouter/agent` with a
`contextSchema` for client configuration and access to
shared context for cross-tool state.

## Before you start: ask the user

Two scope questions decide which sections of the
checklist apply. Ask both before writing code — the
answers can each remove ~30% of the work.

1. **Is this tool user-facing in the chatroom, or
   agent-only?**

   - User-facing → wire the full Playground / chatroom
     UI section (chip, expanded panel, settings card,
     `SERVER_TOOL_UI_DEFINITIONS` entry).
   - Agent-only / experimental / no chatroom config —
     skip the chatroom UI but still add an entry to
     `SERVER_TOOL_UI_EXCLUSIONS` in
     `projects/web/features/playground/ui/Composer/server-tool-ui-definitions.ts`
     with a one-line `reason`. The colocated test
     enforces every registered tool is **either**
     configurable in the composer **or** explicitly
     excluded; without the exclusion entry CI fails on
     `expect(missingTypes).toEqual([])`.

   Example agent-only tools:
   `openrouter:experimental__search_models` (model
   search; no compact result renderer in the chatroom
   yet — it's an agent-facing query tool).

   Even agent-only tools still need a chip + output
   schema so generations the API returns from
   non-chatroom clients render correctly when a user
   later opens the conversation in the playground —
   only the **composer settings card** is skipped.

2. **Does this tool produce structured `toolData`?**

   - Yes → wire the full Responses-skin output section
     (output item schema, stream format).
   - No (return value is just a string the model reads)
     → the generic dispatch handles it; you can skip
     the output item schema and stream format entirely.
     Datetime is the canonical example.

## Checklist

### Router / wire layer

1. Create a directory under
   `packages/router/plugins/server-tools/<tool-name>/`
1. Define the SDK tool using `tool()` from
   `@openrouter/agent/tool`
1. Export a `ServerToolDefinition` with all metadata
   (own `TOOL_NAME` inline in the tool module — see the
   minimal example below)
1. Register in `registry.ts`. Then add a matching
   leaf-copy literal + `OpenRouterServerToolType` entry
   to `packages/enums/server-tools.ts` (sync-tested
   against the registry by
   `registry-leaf-sync.test.ts`; a missed entry fails
   CI rather than silently drifting).
1. Add a schema entry in chat completions `request.ts`
   (the `ToolSchema` union). Skipping this rejects the
   `{ type: "openrouter:<tool>" }` request at Zod
   validation before the tool ever runs.
1. Wire the tool through **all five** Responses-skin
   input touchpoints (any single one missed surfaces as
   the dreaded "Invalid Responses API request" error
   with five `invalid_value` arms in the dump). See
   "Responses-skin input wiring" below.

### Responses-skin output (do this whenever your tool

produces structured `toolData`)

1. Add an output item schema in responses
   `response-output-items.ts`:
   - Define `OpenResponses<Tool>OutputSchema` extending
     `ServerToolOutputBaseSchema`, with every
     `parseResult` field marked `.optional()` (the
     in-flight `OutputItemAdded` event has no extras).
   - Add the new schema to the
     `OpenResponsesOutputItemSchema` discriminatedUnion.
   - **Also** add an entry to the schema's
     `.openapi({ discriminator: { mapping: { ... } } })`
     so generated SDKs and OpenAPI consumers can
     resolve `type: "openrouter:<tool>"` to the right
     component.
   - Add a colocated
     `response-output-items.test.ts` that parses an
     `in_progress` (no extras), a `completed` (full
     extras), and an `incomplete`/error variant — the
     playground saves every streamed item through this
     schema; a missing variant breaks every save.
1. Add a stream format under
   `packages/router/skins/openai-responses/from-internal-stream/stream-formats/<tool>.ts`
   and register it in `server-tool-stream-formats.ts`
   `SKIN_LOCAL_FORMATS`. The `buildOutputItem` function
   parses `outputItem.toolData` (Zod) and returns the
   extras that get spread into the `OutputItemDone`
   payload. Without this, the schema's optional fields
   stay empty even after the tool succeeds.

### Playground / chatroom UI (skip the composer card

when the tool is agent-only — see "Before you start")

**Always do** (even for agent-only tools, so existing
generations render correctly when opened later):

1. Add the tool name to `SERVER_TOOL_NAMES` in
   `projects/web/features/playground/definitions/server-tools.ts`.
   This is what `isServerTool()` narrows against;
   without it the chip falls through to a generic
   "unknown tool" renderer.
1. Extend the playground selector at
   `projects/web/features/playground/selectors/items.ts`:
   - Add the new field to `ServerToolOutputData`
     (e.g. `myTool?: MyToolOutput`).
   - Define a `<Tool>OutputSchema` (mirror of the
     response-output-items schema's optional fields)
     and an `extract<Tool>Output(data)` function that
     calls `parseToolOutput(<Tool>OutputSchema, data)`.
   - Add an `if (data.type === 'openrouter:<tool>')`
     branch in the streamed-item reducer to populate
     `outputData.<tool>`.
1. Add the chip component
   `ServerTool<Tool>.tsx` under
   `projects/web/features/playground/ui/Messages/MessageItem/ResponseItem/server-tools/`.
   Handle three states explicitly: in-progress,
   completed, ended-in-failure (union of `isFailed`
   and `isIncomplete` — Responses skin maps failures
   to `'incomplete'` because its enum has no
   `'failed'`).
1. (Optional) Add an expanded panel
   `ServerTool<Tool>Expanded.tsx` if the tool has rich
   structured output worth rendering inline.
1. Register the tool in `SERVER_TOOL_REGISTRY` in
   `projects/web/features/playground/ui/Messages/MessageItem/ResponseItem/server-tools/constants.ts`
   with `label`, `icon`, `DescriptionComponent`,
   optional `ExpandedComponent`, and
   `hasRichExpandedContent`. Without this entry the
   chip is unbranded and never expands.

**Pick one** based on the user's answer to scope
question 1:

- **User-facing tool** → add a definition to
  `SERVER_TOOL_UI_DEFINITIONS` in
  `projects/web/features/playground/ui/Composer/server-tool-ui-definitions.ts`
  with `label`, `icon`, `description`, `settingsLabel`,
  schema-derived `fields`, and a `getSummary`. This is
  the composer's settings card.
- **Agent-only tool** (e.g.
  `openrouter:experimental__search_models`,
  `openrouter:datetime` when there is no useful client
  config) → add an entry to `SERVER_TOOL_UI_EXCLUSIONS`
  in the same file with a one-line `reason`. The
  colocated test (`server-tool-ui-definitions.test.ts`,
  `covers every registered server tool or explicitly
  excludes it from the chatroom UI`) enforces every
  registered tool is **either** in `SERVER_TOOL_UI_DEFINITIONS`
  **or** in `SERVER_TOOL_UI_EXCLUSIONS` — it fails CI
  with `expect(missingTypes).toEqual([])` if you forget
  both.

### Docs

1. Update docs: add the tool to the "Available Server
   Tools" table and "Next Steps" in
   `projects/docs/guides/features/server-tools.mdx`
1. Create a dedicated docs page at
   `projects/docs/guides/features/server-tools/<tool-name>.mdx`
   and add it to the sidebar in
   `projects/docs/docs.json` under the
   Server Tools section

### Regenerate OpenAPI + SDKs

Adding a tool changes the `ToolSchema` union, the
response output item discriminator, and the request
schema. Run from repo root:

```bash
bun run generate:openapi
bun run generate:sdk:all
```

Commit the regenerated `openrouter-openapi.yaml` and
the SDK MDX changes under
`projects/docs/client-sdks/` alongside
your code.

### Verify it actually renders before merge

For any tool with a playground chip / expanded view,
start Tilt, send a request that triggers the tool from
the chatroom, and confirm:

- (a) the input request validates — toggling the tool
  on in the chatroom should not produce
  `Invalid Responses API request` with five
  `invalid_value` arms in the dump (that's the
  Responses-skin input-wiring failure mode; if you
  see it, revisit the five-step list above).
- (b) the chip appears with the right label and icon
- (c) in-flight status renders without console errors
- (d) the expanded panel shows the parsed `toolData`.

A missing `response-output-items.ts` variant fails
silently in the API but produces a discriminator
error every ~120ms in the playground save throttle —
only visible in the browser console.

## Context Architecture

Server tools use two context layers:

### Per-tool context (`context.local`)

Client-supplied configuration from the request
`parameters` field. Declared in `contextSchema`:

```typescript
const MyToolContextSchema = z.object({
  apiToolParams: MyToolApiRequestSchema,
  _callCount: zInt().optional(), // internal state
});
```

### Shared context (`context.shared`)

Cross-tool state visible to all tools. Injected by
the matching layer, not declared per-tool:

```typescript
// Shared context is defined once in shared-context.ts:
const SharedServerToolContextSchema = z.object({
  _authContext: z.unknown().optional(),
});
```

Tools read shared context via `context.shared`:

```typescript
const auth = context?.shared?._authContext;
```

## Tool Definition

### Minimal Example (datetime pattern)

```typescript
// plugins/server-tools/my-tool/my-tool.ts

import type { ServerToolDefinition }
  from '../server-tool';

import { tool } from '@openrouter/agent/tool';
import { z } from '@openrouter-monorepo/lib-zod';
import { toProviderSafeName } from '../server-tool';

export const MY_TOOL_NAME = 'openrouter:my_tool';
const PROVIDER_SAFE_NAME =
  toProviderSafeName(MY_TOOL_NAME);

// Client-supplied config (surfaced in OpenAPI spec)
const MyToolApiRequestSchema = z.object({
  locale: z.string().optional().openapi({
    description:
      'Locale for formatting. Defaults to en-US.',
    example: 'en-US',
  }),
});

export type MyToolApiConfig =
  z.infer<typeof MyToolApiRequestSchema>;

const MyToolContextSchema = z.object({
  apiToolParams: MyToolApiRequestSchema,
});

// Model-generated call arguments
const MyToolInputSchema = z.object({
  query: z.string().openapi({
    description: 'The input to process.',
  }),
});

const myToolSdkTool = tool({
  name: PROVIDER_SAFE_NAME,
  description: 'Does something useful.',
  inputSchema: MyToolInputSchema,
  contextSchema: MyToolContextSchema,
  execute: async (input, context) => {
    const params: MyToolApiConfig =
      context?.local?.apiToolParams ?? {};
    const locale = params.locale ?? 'en-US';
    return {
      result: `Processed ${input.query} for ${locale}`,
    };
  },
});

export const myTool: ServerToolDefinition = {
  name: MY_TOOL_NAME,
  displayName: 'My Tool',
  summary: 'Does something useful',
  docsPath: '/docs/guides/features/server-tools/my-tool',
  quickStart: {
    endpoint: '/api/v1/chat/completions',
    model: 'openai/gpt-5.2',
    prompt: 'Process my query.',
  },
  sdkTool: myToolSdkTool,
  apiRequestSchema: MyToolApiRequestSchema,
};
```

### Key Concepts

- **`name`** — Public colon-namespaced form:
  `openrouter:<tool_id>`. Uses `snake_case` after the
  colon.
- **`contextSchema`** — Zod schema with `apiToolParams`
  (client config) and optional `_` sibling fields
  (internal state). The matching layer validates
  `apiToolParams` against the request's `parameters`.
- **`inputSchema`** — Zod schema for model-generated
  call arguments.
- **`execute(input, context)`** — Receives model input
  and typed context. Access config via
  `context.local.apiToolParams`. Access shared context
  via `context.shared`.
- **`apiRequestSchema`** — Required. Validates the
  client-supplied `parameters` field.

## Naming Conventions

| Form            | Example              | Used By              |
|-----------------|----------------------|----------------------|
| Public (colon)  | `openrouter:datetime`| Requests, registry   |
| Provider-safe   | `openrouter_datetime`| SDK tool, context    |

Convert with `toProviderSafeName()` /
`fromProviderSafeName()` from `server-tool.ts`.

## Registration

Add the tool to `REGISTERED_SERVER_TOOLS` in
`registry.ts`:

```typescript
import { myTool } from './my-tool/my-tool';

export const REGISTERED_SERVER_TOOLS:
  ServerToolDefinition[] = [
    datetimeTool,
    webSearchTool,
    myTool,
  ];
```

Add the leaf-copy literal + map entry to
`packages/enums/server-tools.ts` (a sync-tested copy of
each tool's own `TOOL_NAME`; `registry-leaf-sync.test.ts`
fails CI if it drifts from `REGISTERED_SERVER_TOOLS`):

```typescript
const MY_TOOL_NAME = 'openrouter:my_tool' as const;

export const OpenRouterServerToolType = {
  // ...existing entries...
  OpenRouterMyTool: MY_TOOL_NAME,
} as const;

export const DISABLABLE_SERVER_TOOL_NAMES = [
  // ...existing entries...
  MY_TOOL_NAME,
] as const;
```

## Schema Registration

### Chat Completions

Add a schema entry in
`skins/openai-chat-completions/schemas/request.ts`
so the tool appears in the `ToolSchema` union:

```typescript
import { OpenRouterServerToolType }
  from '@openrouter-monorepo/enums/server-tools';
import { MyToolApiRequestSchema }
  from '../../../plugins/server-tools/my-tool/my-tool';

const MyServerToolSchema = z
  .object({
    type: z.literal(OpenRouterServerToolType.OpenRouterMyTool),
    parameters: MyToolApiRequestSchema.optional(),
  })
  .openapi('MyServerTool', {
    description:
      'OpenRouter built-in server tool: does something',
    example: {
      type: OpenRouterServerToolType.OpenRouterMyTool,
      parameters: { locale: 'en-US' },
    },
  });
```

### Responses API

Add the tool type in
`skins/openai-responses/schemas/request-tools.ts`
and an output item schema in
`skins/openai-responses/schemas/response-output-items.ts`.
See "Responses-skin input wiring" for the full list of
five touchpoints the input side requires.

## Responses-skin input wiring

The Responses API has a strict discriminated-union
input schema *and* a passthrough catch-all. Adding a
tool name to `OpenRouterServerToolType` (in
`packages/enums/server-tools.ts`) automatically
puts it in `KNOWN_RESPONSES_TOOL_TYPES`, which the
**passthrough refines against** — meaning if the
strict union doesn't have an arm for it, the
passthrough explicitly rejects with
`"Tool type is explicitly modeled and must match
its strict schema"` and the request 400s.

Every new server tool needs **all five** of these:

1. **`schemas/request-tools.ts`** — define
   `Responses<Tool>ServerToolSchema` with
   `z.literal(<TOOL_NAME>)` discriminator and
   `parameters: <Tool>ApiRequestSchema.optional()`.
   Add it to **both** `OpenAIResponsesToolUnionSchema`
   (the `z.union([...])`) **and** the union's
   `satisfies z.Schema<...>` annotation. Also add a
   `z.infer<typeof Responses<Tool>ServerToolSchema>`
   arm to `OpenRouterResponsesTool`.
1. **`schemas/request.ts`** — add
   `OpenResponsesToolType.OpenRouter<Tool>` to
   `SERVER_TOOL_TYPES` (drives request-echo filtering)
   **and** `{ type: 'openrouter:<tool>' }` to the
   `NativeTool` `Exclude<>` chain.
1. **`request-transformers/get-tools-config.ts`** —
   add `case OpenResponsesToolType.OpenRouter<Tool>:`
   to the switch alongside the other
   `OpenRouter*` arms. The `default: tool satisfies
   never` is a compile-time enforcement, so missing
   this surfaces as a typecheck error rather than a
   runtime regression.
1. **`enums.ts`** — usually free: as long as the tool
   name is in `OpenRouterServerToolType` (packages/enums/server-tools.ts),
   the spread `...OpenRouterServerToolType` in
   `OpenResponsesToolType` picks it up. Verify with a
   typecheck.
1. **OpenAPI regen** — `bun run generate:openapi` and
   `grep <Tool>ServerTool_OpenRouter
   projects/docs/openapi/openapi.yaml` should
   show the schema **and** a `$ref` under the `Tools`
   union (currently around the chat completions
   request `oneOf` near line 13778). Missing means a
   downstream SDK won't generate the input variant.

When adding the tool to the **chatroom server-tool
menu** (vs. just allowing it through the API), wire
the playground UI as well — see the playground section.

## Chatroom UI: custom field kinds

`server-tool-ui-definitions.ts` auto-derives field
controls from the schema (Zod string → text input,
enum → chips, etc.). If your tool needs a control
the inference can't produce — like fusion's
"analysis_models = N model selectors" — add a new
field kind end-to-end:

1. **Type the field**: extend `ToolField` union with
   `<MyKind>ToolField & BaseField`, including any
   per-kind config (defaults, modality, slot count).
1. **Allow the override**: add the field's per-kind
   config keys to `ToolFieldOverride`.
1. **Construct it**: add a `case '<my-kind>':` arm to
   `buildToolField` returning the typed field. If
   the override can be invalid (missing `defaults`,
   etc.), guard and return `undefined` so the field
   silently skips rather than crashing.
1. **Render it**: add a matching `case '<my-kind>':`
   arm to `ServerToolFieldRenderer.tsx`, calling a
   new component in `ServerToolInputs.tsx`.
1. **Wire payload semantics**: the renderer calls
   `setServerToolParameter(toolId, field.key, value)`
   which spreads into the tool's `parameters`. If
   "default" should *omit* the field from the request,
   send `undefined` from the renderer when the user
   matches the default in every slot — the
   `sanitize<Tool>Parameters` in
   `definitions/server-tool-config.ts` then drops it.
1. **Update tests**: the colocated
   `server-tool-ui-definitions.test.ts` snapshots
   `${field.key}:${field.kind}` for every tool plus
   a `hiddenSchemaFields` map. Update both — leaving
   the schema key in `hiddenSchemaFields` after you
   surface it produces a misleading "intentionally
   hidden" assertion.

## Optional: Result Parsing

To provide structured data to the Responses API stream
layer (e.g., for custom output items), add a
`parseResult` function:

```typescript
import { wLog } from
  '@openrouter-monorepo/instrumentation/logger';
import { isErr, wrap } from
  '@openrouter-monorepo/lib-result';
import { parseSchema, z } from
  '@openrouter-monorepo/lib-zod';

const MyResultSchema = z.object({
  result: z.string(),
});

function parseMyResult(
  toolResult: string,
): Record<string, unknown> | undefined {
  const json = wrap<unknown>(
    () => JSON.parse(toolResult),
  );
  if (isErr(json)) {
    wLog('my-tool:parse-result-failed', {});
    return undefined;
  }
  const parsed =
    parseSchema(MyResultSchema, json.data);
  if (isErr(parsed)) {
    wLog('my-tool:parse-result-failed', {});
    return undefined;
  }
  return parsed.data;
}

export const myTool: ServerToolDefinition = {
  // ...
  parseResult: parseMyResult,
};
```

## Optional: Citation Extraction

To emit citations from tool results (like web search
emits URL citations), add an `extractCitations` function:

```typescript
import type { CitationSource }
  from '@openrouter-monorepo/llm-interfaces/internal-stream';

function extractMyCitations(
  result: unknown,
): CitationSource[] {
  // Parse result and return citation objects
  return [{
    sourceType: 'web_search',
    url: 'https://example.com',
    title: 'Example',
  }];
}

export const myTool: ServerToolDefinition = {
  // ...
  extractCitations: extractMyCitations,
};
```

The event mapper (`map-sdk-events.ts`) calls
`extractCitations` generically on `tool.result` events
and emits `GenerationCitation` chunks for each citation.

## Optional: Shared Context Access

For tools that need auth credentials (BYOK) or
cross-tool state (session IDs), access shared context
inside `execute`:

- `context.local.apiToolParams` — client-supplied config
- `context.shared._authContext` — auth context (cast
  to `SharedServerToolContext` from `shared-context.ts`)
- `context.setContext({...})` — mutate this tool's state
- `context.setSharedContext({...})` — mutate shared state

See `web-search/web-search-tool.ts` for a full example
with BYOK auth, call counting, and cross-tool state.

## Optional: Canonical Tool Type

When a tool corresponds to a provider-native tool type
(web search, file search, image generation), declare
its `canonicalType` and `canonicalNames`.

`canonicalType` maps the tool to a dedicated internal
stream event type in `llm-interfaces`. `canonicalNames`
declares the per-skin provider names — canonical tool
names come from the providers who define each API skin
(OpenAI, Anthropic) and can differ between them.

```typescript
import { CanonicalServerToolType }
  from '../server-tool';

export const myTool: ServerToolDefinition = {
  // ...
  canonicalType: CanonicalServerToolType.WebSearch,
  canonicalNames: {
    openai: ['web_search_preview',
             'web_search_preview_2025_03_11'],
    anthropic: ['web_search'],
  },
};
```

Available canonical types:

| Type | Stream Event | OpenAI | Anthropic |
|------|-------------|--------|-----------|
| `WebSearch` | `tool.web_search` | `web_search_preview` | `web_search` |
| `FileSearch` | `tool.file_search` | `file_search` | — |
| `CodeInterpreter` | `tool.code_interpreter` | `code_interpreter` | — |
| `BrowserUse` | `tool.browser_use` | `computer_use_preview` | `computer_20241022` |
| `ImageGeneration` | `tool.image_generation` | `image_generation` | — |
| `Bash` | `tool.bash` | — | `bash_20241022` |
| `TextEditor` | `tool.text_editor` | — | `text_editor_20241022` |
| `Memory` | `tool.memory` | — | — |
| `ToolSearch` | `tool.tool_search` | — | — |
| `ApplyPatch` | `tool.apply_patch` | — | — |
| `WebFetch` | `tool.web_fetch` | — | — |
| `Mcp` | `mcp.call` | `mcp` | `mcp` |

## Optional: Native Provider Passthrough

For canonical tools that providers support natively,
combine `canonicalType` with `nativePassthrough`.
`mapToNativeConfig` returns both the native tool
object (inserted into the request) and plugin prefs:

```typescript
export const myTool: ServerToolDefinition = {
  // ...
  canonicalType: CanonicalServerToolType.Bash,
  canonicalNames: {
    anthropic: ['bash_20241022'],
  },
  nativePassthrough: {
    supports: (endpoint) =>
      endpoint.features?.supports_bash === true,
    mapToNativeConfig: (apiConfig) => ({
      nativeTool: { type: 'bash_20241022' },
      pluginPrefs: {
        id: PluginId.Bash,
        // Map tool config to prefs
      },
    }),
  },
};
```

### Native passthrough decision matrix

| Request tool type | Provider supports? | Engine | Behavior |
|---|---|---|---|
| Native name (e.g. `bash_20241022`) | Yes | N/A | Untouched — not a server tool |
| Native name | No | N/A | Normalized to `openrouter:*`, SDK |
| `openrouter:*` | Yes | `native`/`auto`/none | Map to native + prefs, skip callModel |
| `openrouter:*` | No | any | SDK interception |

When all matched tools map to native, `next.complete()`
is called directly — no `callModel` at all. Tools
without an engine concept auto-map to native when the
provider supports it.

## Optional: Shorthand Types

For tools with alternative type names (OpenAI compat):

```typescript
export const myTool: ServerToolDefinition = {
  // ...
  shorthands: ['my_tool', 'my_tool_preview'],
};
```

## Responses API Stream Format

Any tool whose `parseResult` writes structured data
into `outputItem.toolData` needs a stream format,
because the generic dispatch doesn't know which
fields are safe to spread onto the OpenAI Responses
output item. Without a stream format the
`OutputItemDone` payload only carries the base fields
(`id`, `type`, `status`) and every extra you defined
on `OpenResponses<Tool>OutputSchema` arrives empty.

Stream formats live in
`packages/router/skins/openai-responses/from-internal-stream/stream-formats/<tool>.ts`
and are wired into
`server-tool-stream-formats.ts` `SKIN_LOCAL_FORMATS`.
The most common shape is just a `buildOutputItem`
that re-parses `toolData` and returns the extras:

```typescript
import { isErr } from
  '@openrouter-monorepo/lib-result';
import { parseSchema, z } from
  '@openrouter-monorepo/lib-zod';

const MyToolDataSchema = z.object({
  result: z.string().optional(),
  details: z.array(z.string()).optional(),
});

export const myToolStreamFormat: ServerToolStreamFormat
  = {
    buildOutputItem: (item) => {
      if (!item.toolData) return {};
      const parsed =
        parseSchema(MyToolDataSchema, item.toolData);
      if (isErr(parsed)) return {};
      return parsed.data;
    },
  };
```

For tools that emit truly custom event sequences
(e.g. web search's queries / sources / results),
override `handleStart` and `handleEnd` — see
`web-search/` for the full pattern.

## Optional: Cost Tracking

Tools with billing (BYOK engines, per-invocation
pricing) need additional wiring beyond the base
checklist:

1. Create cost computation module at
   `plugins/web-<tool>/compute-web-<tool>-cost.ts`
   with per-engine cost functions, accumulator, and
   engine resolver
1. Create cost extraction from messages at
   `plugins/server-tool-cost/extract-web-<tool>-cost-from-messages.ts`
   to compute billing from tool results in inner
   recursive calls
1. Add engine header constant
   (`HEADER_WEB_<TOOL>_ENGINE`) to
   `llm-interfaces/schemas/request/index.ts` and
   `AdapterVisibleRequestHeadersSchema`
1. Wire cost into `ServerToolCostPlugin`
   (`plugins/server-tool-cost/index.ts`) — detect
   header, extract cost, attach to usage event
1. Add cost type to
   `TypedLifecycleUsageCompleteEvent` in
   `plugins/base/typed-usage-event.ts`
1. Wire into `get-accounting-data.ts` — add to
   `totalUserCost`/`totalPlatformCost` sums and
   populate DB fields
1. Add Spanner columns, ClickHouse fields, and
   frontend activity views — see `web-search/` and
   `web-fetch/` cost modules for the full Spanner +
   ClickHouse + frontend pattern.

## Reference: Key Files

All paths relative to
`packages/router/plugins/server-tools/` except where a
full repo-root path is shown.

| File                            | Purpose                           |
|---------------------------------|-----------------------------------|
| `server-tool.ts`                | `ServerToolDefinition`, helpers   |
| `registry.ts`                   | `REGISTERED_SERVER_TOOLS` array   |
| `packages/enums/server-tools.ts` | Tool name constants (repo root)   |
| `shared-context.ts`             | Shared context schema + type      |
| `find-matching-server-tools.ts` | Request matching, context map     |
| `build-callmodel-input.ts`      | Builds `CallModelInput`           |
| `map-sdk-events.ts`             | SDK events → internal chunks      |
| `native-passthrough.ts`         | Generic native passthrough handler|
| `normalize-server-tool-shorthands.ts` | Shorthand normalization     |
| `index.ts`                      | `ServerToolsPlugin` orchestration |

## Reference: Existing Tools

- **Datetime** (`datetime/datetime-tool.ts`) — Simplest
  example. No auth, no per-request state, minimal
  `apiToolParams`.
- **Web Search** (`web-search/web-search-tool.ts`) —
  Advanced example. Multiple engines, shared context for
  BYOK auth, `_totalResultsReturned` tracking via
  `setContext()`, native passthrough, custom stream
  format, citation extraction.
- **Web Fetch** (`web-fetch/web-fetch-tool.ts`) —
  Advanced example. Multiple engines, BYOK Firecrawl,
  native passthrough, URL validation, cost tracking.

## Common Pitfalls

### Type name collisions with billing enums

Server tools with multiple engines need two separate
types: an **API-facing engine option** (includes
`auto`, `native` — used in request schemas) and a
**billing engine enum** (only concrete engines —
used in cost computation). Name them distinctly
(e.g. `WebFetchEngineOption` vs `WebFetchEngine`).
See `web-fetch/` for the pattern.

### State counter semantics

When tracking usage counts (e.g.,
`_totalFetchesPerformed` for `max_uses`), decide
whether failed attempts count toward the limit and
document the choice. The `web_fetch` tool only
increments on `status === 'completed'` so failures
don't consume the user's budget.

## Reference: ServerToolDefinition Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | `openrouter:*` canonical name |
| `displayName` | Yes | Human-facing tool name (cards, search) |
| `summary` | Yes | One-sentence description for cards/search |
| `docsPath` | Yes | Guide URL under `/docs/` |
| `quickStart` | Yes | Minimal request example (endpoint, model, prompt) |
| `sdkTool` | Yes | Native SDK `tool()` instance |
| `apiRequestSchema` | Yes | Validates client `parameters` |
| `faqs` | No | Q&A pairs surfaced on the tool page |
| `parseResult` | No | Extracts structured data for stream layer |
| `canonicalType` | No | Maps to a `CanonicalServerToolType` |
| `canonicalNames` | No | Per-skin provider names (`{ openai, anthropic }`) |
| `streamFormat` | No | Responses API event shaping |
| `nativePassthrough` | No | Provider-native bypass config |
| `shorthands` | No | Alternative type names |
| `extractCitations` | No | Generic citation extraction |
