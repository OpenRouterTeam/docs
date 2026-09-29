# Notion connector (PR10) deferrals

## Implemented in this package

- Versioned Notion connector manifest/config/cursor/snapshot Zod schemas
- Injected `NotionApiClient` (no Notion SDK; no secrets beyond `credentialRef`)
- Page/database snapshot with full block tree traversal
- Chunking by heading/block structure with exact page/block citation anchors
- Parent container/share ACL fail-closed (restricted by default)
- Container + ACL storage operation (`ensureNotionContainerAndAcl`)
- Root page/database scope enforcement on enumerate and fetch (exact IDs only)
- Explicit archived/trash delete intent via `classifyNotionDeleteIntent`
- Full refetch hint (full page re-fetch on any change)
- Source ordering via `lastEditedTime` + deterministic hash
- Reconciliation watermark from snapshot `lastEditedTime`
- Database enumeration (rootDatabaseIds included in enumerate)
- Conformance harness and fixture-backed unit tests

## Scope enforcement note

Hierarchical descendant resolution (pages under a root page) cannot be resolved
within this package without network access. Only exact `rootPageIds` and
`rootDatabaseIds` are scoped. The production adapter must either:
1. Pre-resolve descendants before passing to the connector, OR
2. Configure all relevant page/database IDs explicitly in `rootPageIds`/`rootDatabaseIds`.

## Explicitly deferred

| Item | Why | Target |
|---|---|---|
| Raw HTTP adapter / Notion SDK | Connector boundary is injected client | `services/cfw-synapse` |
| Webhook subscription setup | Requires Notion webhook API access | future worker PR |
| `services/cfw-synapse` route/queue wiring | Service absent on branch | future worker PR |
| Backfill/provisioning automation | Administrative workflow | PR11 |
| Write intents (page append, property updates) | PR11 scope | PR11 |
| Full page sharing ACL resolution | Requires Notion sharing API + principal linking | future ACL PR |
| Production embedding model selection | Owned by PR5 bake-off | PR5 follow-up |
| Hierarchical descendant resolution (pages under root) | Requires network to traverse tree | production adapter or pre-resolution |
