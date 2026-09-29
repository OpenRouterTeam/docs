# Frontend Utils

Framework-agnostic browser utilities shared across OpenRouter's frontend projects (web, mission-control). Provides Tailwind class merging, browser capability detection, and on-device AI helpers.

## Architecture

```mermaid
graph TD
    Web["projects/web"] --> CN["cn.ts\nTailwind class merging"]
    MC["projects/mission-control"] --> CN
    Web --> BuiltInAI["built-in-ai.ts\nChrome Summarizer API"]
    Web --> Icons["homepage-provider-icons.ts\nauthor icon mapping"]
    Web --> WASM["wasm.ts\nWebAssembly detection"]
    CN --> TW["cn package"]
    BuiltInAI --> Nano["Gemini Nano\non-device, Chrome 138+"]
```

## Key Modules

| File | Purpose |
|------|---------|
| `cn.ts` | Tailwind class merging with custom z-index class group support |
| `built-in-ai.ts` | Chrome Built-in AI Summarizer — generates headlines on-device via Gemini Nano |
| `wasm.ts` | Cached WebAssembly support detection |
| `homepage-provider-icons.ts` | Author-to-icon path mapping for homepage featured models |

## Commands

| Command | Description |
|---------|-------------|
| `bun test` | Run unit tests |
| `tsgo --noEmit` | Type-check |
