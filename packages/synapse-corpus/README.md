# Synapse corpus storage

Dedicated PostgreSQL schema and generated Kysely types for Synapse's internal organizational corpus. This package does not use platform Postgres or `packages/db`.

For the local database workflow and environment rules, see `AGENTS.md`.

The core migration creates the evidence, identity, and ACL schema; search projections, embeddings, scopes, and ingestion/outbox tables land in later stack layers.

## Current deployment scope

This greenfield capability is intended for internal-only users and public-only source data. The library's general ACL, encryption and redaction capabilities do not authorize private-source ingestion or external-user serving; either would be a separate scope expansion.

Merging this package does not activate ingestion or Slack replies, provision production resources, or run production migrations. Ordinary source updates and deletion handling remain correctness requirements within the public-data scope. The documented runtime configuration gates still apply.

## Search / embeddings (PR5)

- Chunk + embedding profile registries (`corpus_chunk_profiles`, `corpus_embedding_profiles`)
- Evaluation-only physical vectors: `corpus_embeddings_eval_d8` (`eval_deterministic_d8`, 8 dimensions)
- Hybrid retrieval: exact + lexical FTS + vector + freshness/authority → RRF → diversity caps → ACL hydration → neighbor expansion → optional reranker (RRF fallback)
- Indexing worker entrypoint: `consumeIndexTask` (project_revision / delete_object)
- Production profile: `openai/text-embedding-3-small`, 1536 dimensions, separate physical storage and explicit operator activation; deterministic evaluation vectors remain evaluation-only.

Production activation of an embedding profile is gated; see the convention in `AGENTS.md` and `evaluation/baseline-report.md`.

## Slack export + live ingestion (PR6)

Package-local Slack connector under `connectors/slack/`:

- whole-thread snapshots (reply/edit/delete refetch the thread; deletions tombstone via `deletedTs`)
- extracted export JSON import (no ZIP dependency; bulk ZIP belongs in a worker)
- Events API signature/timestamp/workspace verification; durable Worker admission and query execution live in `services/cfw-synapse`.
- team binding via `expectedTeamId` on accept/reconcile
- sealed ACL mapping with **atomic** fail-closed unresolved identities (no partial grants)
- live ACL reconcile for archive / channel_deleted / member join-leave; unarchive requires full re-import
- restoration re-observes the final ACL, preserves explicitly approved org visibility, and keeps private/unresolved membership restricted
- restoration reuses unchanged source content within an archive generation; reactivation and unseal commit together only for matching current revisions with unredacted evidence
- monotonic `enumerateSequence` independent of opaque Slack cursors; full per-channel thread pagination
- raw blob `retention_policy_json` stamped non-empty; purge owner `synapse-corpus-retention-sweeper`
- workspaceDomain / permalinks pinned to HTTPS `*.slack.com`
- reconciliation checkpoints watermarked from max snapshot `sourceUpdatedAt` (never wall clock)

`services/cfw-synapse` now wires signed Slack ingress, separate ingestion/index/query queues, scoped encrypted raw storage, approved model clients and verified one-to-one DM replies. All admission gates default off. See `services/cfw-synapse/docs/operations.md` for source/identity approvals, provisioning, sandbox pilot and restore requirements. Other connector transports and bulk ZIP import remain separately scoped.

## Linear connector (PR10)

Package-local Linear connector under `connectors/linear/`:

- injected `LinearApiClient` (no Linear SDK; no secrets beyond `credentialRef`)
- versioned config/cursor/snapshot Zod schemas for issues, comments, projects,
  milestones, initiatives, documents, and status updates
- source comparator on `updatedAt` + deterministic hash; immutable full snapshots
- exact Linear URL citations in anchors
- team container + ACL fail-closed (restricted by default)
- tenant binding via `workspaceSlug`; included team filtering
- explicit archive/delete lifecycle via `archivedAt`/`canceledAt`
- reconciliation watermark from max snapshot `updatedAt` (never wall clock)
- conformance harness and fixture-backed unit tests

See `connectors/linear/DEFERRALS.md` for Worker/SDK deferrals.

## Notion connector (PR10)

Package-local Notion connector under `connectors/notion/`:

- injected `NotionApiClient` (no Notion SDK; no secrets beyond `credentialRef`)
- page/database snapshot with full block tree traversal
- chunking by heading/block structure with exact page/block citation anchors
- parent container/share ACL fail-closed (restricted by default)
- full refetch hint (any change = full page re-fetch)
- explicit archived/trash/404 delete only, never search absence
- source ordering via `lastEditedTime`; reconciliation watermark
- conformance harness and fixture-backed unit tests

See `connectors/notion/DEFERRALS.md` for Worker/SDK deferrals.

## Web/RSS connector (PR10)

Package-local Web/RSS connector under `connectors/web/`:

- injected `SsrfSafeFetchClient` interface only (no arbitrary network)
- pure HTTPS URL canonicalization + allowlisted host validation
- reject credentials, private IP literals, non-HTTPS, link-local
- bounded bytes (5MB) and MIME type validation
- robots/license/retention policy fields
- canonical URL and feed GUID identity
- ETag/Last-Modified/content hash source ordering
- publication time != observed time separation
- excerpt-only when full retention not licensed
- external citation via canonical URL
- poll reconciliation; conformance and fixture-backed unit tests

See `connectors/web/DEFERRALS.md` for Worker/HTTP adapter deferrals.

## Artifacts and synthesis (PR10)

Package-local artifact and entity resolution under `artifacts/` and `entities/`:

- `corpus_artifacts`: immutable, versioned, typed synthesis outputs
- `corpus_artifact_evidence`: mandatory evidence links (rejects empty/cross-corpus)
- Deterministic synthesis helpers: `synthesizeDecision`, `synthesizeClaim`,
  `synthesizeProjectStatus`, `synthesizeTopicDigest`, `synthesizeEntityProfile`,
  `synthesizeThreadDistillation`, `synthesizeChangeImpact`
- All helpers cite exact revisions/units
- Supersession: append-only, constrained (no self-ref, no double-supersede)
- `corpus_entities`: resolved domain entities with type constraints
- `corpus_mentions`: unit/artifact → entity links
- `upsertEntity`: create/update by canonical name
- `linkEntityToPrincipal`: privileged identity link (caller payload cannot mint)
- Integration tests for cross-corpus rejection, supersession constraints

## GitHub ingestion + PR-review context (PR7)

Package-local GitHub connector under `connectors/github/`:

- injected `GitHubApiClient` (no Octokit; raw fetch adapter deferred to service)
- versioned config/cursor/snapshot Zod schemas for repos, PRs, issues, commits,
  releases, selected code/docs
- source comparator on authoritative `updatedAt` + content SHA/digest; immutable
  full snapshots; reusable conformance harness
- merged/open PR evidence (title/body/commits/changed files/review threads/
  linked issues/merge SHA) with path/line/SHA code citations
- diff/file size bounds; binary/generated/denied path filtering
- webhook HMAC verify + delivery dedupe + freshness; reconciliation checkpoints
  watermarked from snapshot `sourceUpdatedAt` (never wall clock)
- ACL from repository visibility/installation scope; unresolved current restricted membership fails closed rather than preserving old grants.
- `buildPrReviewContextPack` consumes PR5 `retrieveKnowledge` (not a second
  search stack); token/item caps; untrusted delimiters; injection neutralization;
  AGENTS/REVIEW priority; optional injected local code/ripgrep candidate provider

See `connectors/github/DEFERRALS.md` for Worker/Octokit deferrals.

## MCP work updates + retrieval primitives (PR8)

Package-local MCP tool surface under `mcp/`:

- authenticated runtime context (`corpusId` / `principalId` / `serviceIdentity`)
  — tool args never accept a trusted human principal
- `report-work-update` ingest via contract v1 → agent envelope + durable outbox
- LLM-free cited tools: `search`, `search-slack`, `search-code`, `recent-prs`,
  `subsystem-index` (all consume PR5 `retrieveKnowledge`)
- query scope/default selection with SQL membership checks; `searchAll` opt-in
- `corpus_query_runs` / `corpus_access_decisions` audit tables
- adapter-neutral registry (`listMcpTools` / `executeMcpTool`) — no dependency
  on public `cfw-mcp` generated surface
- no raw external write tools

The Synapse Worker has Slack and operator routes. An internal/public MCP HTTP transport and live agent-connector consumption are not enabled by that integration; see `mcp/DEFERRALS.md`.

## Privacy and durable conversation guarantees

Complete ACL observations have a five-minute freshness bound. Partial or failed refreshes cannot extend old authorization. A content-free external SQLite Durable Object journal survives corpus Postgres restore; serving requires a matching checkpoint/restore epoch and explicit recovery verification. Source/raw/vector/result writes capture a per-corpus privacy revision before reading and recheck it under the shared corpus transaction fence before committing.

Raw metadata, the delivery's processing reference (or an export's receipt and reference), and write-intent completion commit together under that fence. Each intent freezes its row ID, scope, content hash, storage key, source object identity and first-reservation time before PUT; only lifecycle state may change. Erasure matches that exact source, not other in-flight threads in the same channel. Failed reference publication rolls back metadata and leaves pending physical cleanup discoverable. Unknown legacy source provenance blocks cleanup completion, not durable acceptance of the privacy decision.

Every observed Slack message records immutable thread membership before PUT, including replies with no author. Unknown author hashes and principals remain null and may be enriched once; known identity, thread and first-observation timestamps cannot be reassigned. Existing normalized Slack anchors can establish legacy membership for exact receipt and pending-intent erasure. A legacy reply with no resolvable membership remains incomplete while potentially affected raw evidence exists. Authorship is recorded before applying the ledger, so first-seen historical messages cannot bypass an already-completed principal erasure; unrelated authors remain intact.

Slack identity lookup covers every supplied unique user ID using bounded database queries; the query bound is not a thread-author limit. A failed mapping query rejects the lookup before any author provenance is published, rather than treating unqueried users as unresolved. Genuinely unlinked or inactive identities remain omitted.

A `null` result from `connector.fetch` means no usable snapshot, not proof of deletion: cache misses and scope exclusions remain retryable without manufacturing a tombstone. An in-process `SOURCE_OBJECT_DELETED` result represents authoritative absence; the web connector emits it for permitted HTTP 404/410 responses only after checking the final URL. Processing still enforces `supportsDelete` and source ordering: deletion wins an equal-version tie, but strictly older evidence cannot erase a newer revision. Explicit delete events and validated archived/trashed lifecycle snapshots keep their existing de-indexing paths.

Redaction removes raw, normalized, indexed, cached and persisted-answer copies, including inherited root previews, transitive conversation dependencies and bot replies. R2 erasure writes a content-free overwrite fence so delayed conditional uploads cannot recreate a known erased key. Interrupted/ambiguous external work remains durable cleanup work, not a false completion. Backup-media and exported-key destruction are separate operator obligations.

`retireActiveDek` is irreversible container-wide cryptographic erasure, not key rotation. Existing ciphertext is intentionally made unreadable even while it remains in R2; invoke this primitive only for an authorized container-wide erasure. Key retirement does not mark raw blobs physically purged: their R2 overwrite fences and success-only `purged_at` markers still require completed physical cleanup.

Container-key updates freeze the key ID, ownership, wrapping-key version, creation time and active wrapped bytes. The only material change is one-way retirement, which clears wrapped bytes and assigns a database-clock timestamp; retired identifiers cannot be reactivated by update. Both active keys and retired audit rows reject deletion, including from cleanup paths. The guard cannot be downgraded while any active or retired key row remains.

Redaction and raw-blob retention selectors rotate bounded pages using `last_sweep_selected_at`, distinct from immutable request/capture timestamps, processing leases and successful-erasure markers. Failed work stays durable while later expired data is removed. Real source archive observations similarly advance the channel restore generation; a placeholder used only to keep a live channel sealed during re-import does not advance it.

One deduplicated raw capture has one immutable policy snapshot and retention horizon. A later receipt does not promise a fresh raw-retention lease or silently extend that horizon. Reuse requires an identical policy and an unexpired, non-purging capture; incompatible or expired reuse is rejected without rewriting provenance. Pinned delivery reads also reject expired or purge-fenced captures before reading bytes or normalizing them. A late receipt can therefore outlive its raw snapshot and fail closed; it is not automatically repinned or refetched to evade the original deadline.

Expired legacy R2 rows without container ownership use a privileged deletion capability that resolves the storage provider, key and hash from the corpus-owned database row, never caller-supplied storage coordinates. It needs neither a fabricated container nor a wrapping key. `purge_requested_at` remains the durable read fence across failures; `purged_at` advances only after the content-free overwrite succeeds. Unsupported storage providers remain unresolved rather than being certified purged.

Slack executions persist one request UUID per authenticated event, lease-fenced results and send ownership. History admission, completion and final delivery authorize the full deduplicated evidence union in bounded queries, rather than truncating it to one retrieval page. Historical assistant turns are discarded in full if any dependency is no longer authorized. Ambiguous sends reconcile the authenticated bot's request marker without blind reposting. Synthesis has no action tools, requires approved ZDR routing and emits only server-rebuilt citations or an honest refusal.
