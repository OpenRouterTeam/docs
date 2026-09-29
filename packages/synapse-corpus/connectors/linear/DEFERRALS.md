# Linear connector (PR10) deferrals

## Implemented in this package

- Versioned Linear connector manifest/config/cursor/snapshot Zod schemas
- Injected `LinearApiClient` (no Linear SDK; no secrets beyond `credentialRef`)
- Enumerate/fetch/normalize for issues only (live enumeration)
- Snapshot store path supports all object types via fixtures
- Source comparator on `updatedAt` + canonical content hash; immutable snapshots
- Exact Linear URL citations in anchors
- Team container + ACL storage operation (`ensureLinearContainerAndAcl`)
- ACL fail-closed (restricted by default; `orgVisibleTeamKeys` for org)
- Tenant binding via `workspaceSlug` config
- Source ordering via `updatedAt` + deterministic hash (never lexicographic ETag)
- Explicit archive/canceled lifecycle → delete intent via `classifyLinearDeleteIntent`
- Fail closed on teams not in `includedTeamKeys` (empty = no enumeration)
- Conformance harness and fixture-backed unit tests

## Supported streams (enumerate only)

| Stream | Status |
|---|---|
| issues | Implemented (live enumerate) |
| comments | Fixture path only; live enumerate returns empty page |
| projects | Fixture path only; live enumerate returns empty page |
| milestones | Fixture path only; live enumerate returns empty page |
| initiatives | Fixture path only; live enumerate returns empty page |
| documents | Fixture path only; live enumerate returns empty page |
| status_updates | Fixture path only; live enumerate returns empty page |

Live enumeration walks `LINEAR_LIVE_STREAM_ORDER` (issues only) so that
parent-scoped listings (comments/milestones/status_updates) are never called
with placeholder parent ids.

## Explicitly deferred

| Item | Why | Target |
|---|---|---|
| Raw HTTP adapter / Linear SDK | Connector boundary is injected client | `services/cfw-synapse` |
| `services/cfw-synapse` webhook route/queue wiring | Service absent on branch | future worker PR |
| Webhook HMAC verification | Requires Worker-level secrets/signing secret | PR11 worker wiring |
| Backfill/provisioning automation | Administrative workflow | PR11 |
| Write intents (comments, status transitions) | PR11 scope | PR11 |
| Full team membership ACL resolution | Requires Linear member list API + principal linking | future ACL PR |
| Production embedding model selection | Owned by PR5 bake-off | PR5 follow-up |
| Live enumeration of comments/projects/milestones/initiatives/documents/status_updates | Requires multi-stream cursor advancement logic | future connector iteration |
