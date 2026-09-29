# Tools

Server-side tool execution engine for OpenRouter's tool-use capabilities. Handles tool call lifecycle: lookup, cost estimation, submission, and usage recording for tools invoked during LLM interactions.

## Architecture

```mermaid
graph TD
    Router["Router Plugin\nserver-tools"] --> Lookup["lookup.ts\nresolve tool definition"]
    Lookup --> Submit["submit.ts\nexecute tool call"]
    Submit --> Cost["cost.ts\nestimate execution cost"]
    Submit --> Usage["usage-record.ts\nrecord tool usage"]
    Types["types.ts\ntool definitions and schemas"] --> Lookup
    Invoke["invoke.ts\ndirect invokeTool pipeline"] --> Lookup
    Invoke --> Cost
    Invoke --> Usage
```

## Key Modules

| File | Purpose |
|------|---------|
| `lookup.ts` | Resolves tool names to their definitions and execution endpoints |
| `invoke.ts` | End-to-end `invokeTool()` pipeline — lookup, execute, cost, and record in one call |
| `submit.ts` | Executes tool calls against provider endpoints |
| `cost.ts` | Estimates and calculates tool execution costs |
| `usage-record.ts` | Records tool usage for billing and analytics |
| `types.ts` | Shared type definitions for tool interfaces |

## Commands

| Command | Description |
|---------|-------------|
| `bun test` | Run unit tests |
| `bun test --watch` | Run tests in watch mode |
| `tsgo --noEmit` | Type-check |
