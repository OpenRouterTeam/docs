# Tool Catalog

Compiled server-tool catalog contract for Server Tools v2: the
artifact schemas the runtime consumes, O(1) lookup indexes, and
cached JSON-Schema validators.

Tool identity becomes runtime data: tools are registered in a
database, compiled into an immutable hash-pinned artifact at
publish time, and served from KV. This package defines that
artifact and the read-side machinery. It is intentionally
dependency-light (no router, no DB) so every layer — the router
plugin, cfw-api, mission-control, scripts — can share it.

## Key Modules

| File                 | Purpose                                  |
|----------------------|------------------------------------------|
| `schemas.ts`         | Zod schemas for the compiled artifact    |
| `catalog-index.ts`   | byName/byShorthand/byCanonicalName maps  |
| `validator-cache.ts` | Cached JSON-Schema validators per hash   |
| `artifact-hash.ts`   | Canonical SHA-256 release hash           |

## Lifecycle

1. Author: registry rows (Postgres) or, during migration Phase 0,
   the static in-process registry
   (`@openrouter-monorepo/tools/catalog/compile-static-registry`).
2. Publish: compile rows → `ToolCatalogArtifact`, hash it, store
   the release, write through to KV.
3. Run: load artifact from KV, `buildCatalogIndex()`, validate
   request `parameters` via `CatalogValidatorCache`.

See RFC: "Server Tools v2 — O(1) Dynamic Tool Platform"
(server-tools-v2-architecture.html).

## Commands

| Command         | Description    |
|-----------------|----------------|
| `bun test`      | Run unit tests |
| `tsgo --noEmit` | Type-check     |
