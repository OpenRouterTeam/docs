# Endpoint performance

## Local reader checks

- For workload-aware V5 readers, seed distinct text/image fixtures in `endpoint_perf_minute_v5`; keep catalog fixtures within the 30-minute window and warm endpoint KV through the [local development workflow](../../../.agents/skills/local-dev-env/SKILL.md#fixtures-and-checks).
- Catalog selects a representative endpoint: inspect `models[].endpoint.id` in `models/find` before seeding, then check the exposed `endpoint_perf` values. Another endpoint's metrics do not exercise that selection.
- When checking sorting, use populated responses with distinct values and unknowns; account for response-cache staleness after KV warming.
