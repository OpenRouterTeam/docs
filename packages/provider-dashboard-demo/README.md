# Provider Dashboard Demo

Synthetic, deterministic metrics for the FakeProvider dashboard in Mission Control. The package provides realistic model, endpoint, benchmark, routing, health, and usage series without contacting production data sources.

## Architecture

```mermaid
graph TD
    Dashboard["Provider Dashboard"] --> Gate["FakeProvider Gate"]
    Gate --> Demo["Demo Metrics\nsrc/index.ts"]
    Demo --> Series["Deterministic Series\nusage · health · incidents"]
    Demo --> Graphs["Dashboard Graphs\nvolume · latency · errors · tools"]
    Demo --> Tables["Dashboard Tables\nstatus · routing · monthly usage"]
    Demo --> Models["Demo Models\nOpenAI · Anthropic · Google · Meta · DeepSeek"]
    Demo --> Enums["packages/enums\nGraphWindow + ProviderName"]
```

## Commands

| Command | Description |
| --- | --- |
| `bun test` | Run unit tests |
| `bun run typecheck` | Type-check |
