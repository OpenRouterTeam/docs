# Synapse Org Corpus Architecture

**Status:** design of record — implementation is authored and in review as the stacked PRs listed in [`corpus-pr-stack.md`](./corpus-pr-stack.md)
**Scope:** private OpenRouter organizational memory, retrieval, context, and agent-maintained external systems
**Created:** 2026-08-05
**Updated:** 2026-08-06 — absorbed the adversarial review of [#32290](https://github.com/OpenRouterTeam/openrouter-web/pull/32290); see [`review-findings.md`](./review-findings.md) for the finding-by-finding disposition

This document is the single normative design. The [Cerebras comparison](./cerebras-knowledge-comparison.md) is a historical gap analysis whose corrections have been folded in here; where the two disagree, this document wins. The Zod contracts in `packages/synapse-corpus-contracts` (authored in [#32299](https://github.com/OpenRouterTeam/openrouter-web/pull/32299), not yet on `main`) are normative for wire shapes; this document describes their invariants, not their field lists.

## 1. Executive recommendation

Build Synapse Knowledge as an **evidence-first, revisioned corpus**, not as an "embeddings table" and not as an Ori Knowledge product fork.

The canonical shape is:

```text
source connection
  → source object (stable identity)
    → immutable revision (what the source said at a point in time)
      → content units (content-addressed, searchable chunks/sections/thread composites)
        → search documents + embeddings + lexical index entries (replaceable indexes)
        → derived artifacts (summaries, decisions, change impacts, claims)
          → evidence links back to exact revisions/units
          → artifact ACL = intersection of cited evidence ACLs
            → write intents / workflow runs / external action audit
```

This separation is the main architectural decision. Raw evidence must remain recoverable and citable; chunks, vectors, summaries, claims, relationships, and workflow proposals are derived and can be regenerated when models or chunking strategies change.

Two review-driven qualifications now bound that principle:

- **Immutability is the default, not an absolute.** Legal, retention, and source-mandated deletion (Slack message deletion, GDPR erasure, offboarding) override it through the first-class redaction/purge flow in §4.8. "Never rewrite evidence" means "never rewrite evidence *silently*" — every purge is itself audited.
- **Derived artifacts are access-controlled.** Synthesis must never launder restricted evidence into wider visibility; artifacts carry the most-restrictive ACL of everything they cite (§4.4, §6).

The corpus has one **logical query surface** but multiple physical stores:

- dedicated Postgres for identities, revisions, ACLs, lexical search, lineage, workflow state, and audit;
- R2 for immutable raw exports and large source payloads;
- pgvector/HNSW in the dedicated corpus Postgres for ANN vectors initially;
- Cloudflare Queues for at-least-once ingestion and indexing;
- Cloudflare Workflows for low-volume, durable external writes.

Do **not** place the corpus tables in the platform Postgres used by `packages/db`. The review-state tables in the Synapse review-worker stack are small operational state; the full corpus has a very different scale, retention, write, and migration profile. Give it a **dedicated Cloud SQL instance and database before the first production private-source ingest**, plus its own Hyperdrive binding, migrations, Kysely types, and package (`packages/synapse-corpus`). A shared instance is allowed only for temporary non-production evaluation; the corpus infrastructure RFC (stack layer 2, [#32301](https://github.com/OpenRouterTeam/openrouter-web/pull/32301)) owns instance sizing, roles, recovery, and the pgvector bootstrap path.

## 2. Lessons from prior art

The deleted Cortex KB already proved several good ideas:

- one source-neutral retrieval contract;
- whole-thread Slack re-fetch rather than appending orphan replies;
- distill-before-embed for conversational sources;
- hybrid exact + semantic + rare-term + freshness ranking;
- Reciprocal Rank Fusion and reranker degradation;
- immutable source refs and idempotent `(source, ref)` upserts;
- paired vector deletion when a row disappears.

Evidence: cortex history and pre-deletion tree around commits `30efd37899c518cec04095c2081fdbc7109efaa9` and `13a38831999a08a7498f0b1fd705e25a586d4bb8`.

The old one-table `embeddings` design was useful for fast iteration but should not remain the canonical model. It mixed:

- source identity;
- current source content;
- source-specific metadata;
- derived chunks;
- derived summaries/questions/resolutions;
- retrieval/index state.

That makes model upgrades, re-chunking, temporal queries, deletion, citations, and disputed/superseded knowledge unnecessarily hard. The reusable lesson is **one common contract**, not literally one physical table. §4.6 keeps the operational simplicity of one queryable projection without making it canonical evidence.

Reusable monorepo prior art exists on the `cortex/*` and `ori-knowledge/*` branches, especially:

- source-neutral store contracts and entity-scoped methods;
- connector cursors and explicit sync outcomes;
- event dedupe before side effects;
- visibility checks both during candidate generation and hydration;
- separate credentials from rapidly changing sync state;
- disarmed write paths with durable audit.

Ori remains a separate product. Those branches are implementation evidence, not the product base for Synapse.

## 3. Storage topology

### 3.1 Dedicated corpus Postgres

Create a dedicated database named conceptually `synapse_knowledge`, with its own connection pool, Hyperdrive config, migrations, Kysely generation, backup, and retention policy — on a **dedicated Cloud SQL instance** per the infrastructure RFC.

Reasons not to use the platform DB or instance:

- potentially millions of content units and revisions;
- large, bursty Slack exports and repository backfills;
- frequent index-state writes;
- FTS GIN and pgvector HNSW index builds compete for shared CPU/memory/IO;
- different restore/deletion/retention requirements;
- the root monorepo warns that Hyperdrive/platform Postgres is a last resort for hot inference traffic;
- no pgvector extension is currently enabled (`postgres/migrations/20260709000000_enable_cloud_sql_extensions.sql`).

The dedicated DB is authoritative for metadata, normalized text, FTS, and initial vector search. Vectorize remains a future offload option.

Connection topology (from the infrastructure RFC): Hyperdrive is used **only** for interactive Worker traffic (retrieval, MCP, Slack bot, webhook ACK paths). Bulk imports, backfills, reconciliation, and embedding workers run in Cloud Run and connect directly to Cloud SQL via the Auth Proxy/private-IP pattern with their own bounded pools — never through Hyperdrive.

### 3.2 R2 raw evidence store

Use a dedicated bucket such as `synapse-knowledge-raw` for:

- Slack export ZIPs and normalized channel files;
- raw webhook payloads beyond the short replay window;
- Notion block trees;
- GitHub/Linear API snapshots when useful for replay;
- fetched article HTML/PDF/media when licensing permits;
- large attachments;
- normalized text offloaded from superseded revisions (§4.2);
- corpus snapshots and exports.

Objects should be immutable and content-addressed:

```text
raw/{connection_id}/{source_object_id}/{content_hash}
imports/{import_job_id}/original.zip
exports/{snapshot_id}/...
```

Postgres stores the blob key, checksum, byte length, MIME type, capture time, and retention/license policy. Raw blobs for private sources are encrypted with per-container data keys so that a legal purge of a container (or principal) can be completed against backups by destroying the key (§4.8).

### 3.3 pgvector as the initial ANN index

Enable pgvector in the dedicated corpus database. Keep embeddings in a versioned `corpus_embeddings` table keyed by search document and embedding profile, with HNSW indexes selected through evaluation.

Keeping FTS, vectors, source metadata, sync state, and transactional indexing in one database is a meaningful operational advantage and mirrors the Cerebras architecture. The earlier objection to pgvector was pollution of the platform database; a dedicated corpus database removes that objection.

The embedding interface remains adapter-backed so Vectorize, OpenSearch, or another ANN service can replace/offload pgvector later without changing the corpus contract.

**Default embedding profile.** To remove the bake-off deadlock (review finding F10), the first production profile is decided now rather than blocked on an unowned evaluation dataset: embedding profile `v1` routes through OpenRouter's own embeddings surface (`packages/embeddings` / `cfw-embeddings-api`) using `openai/text-embedding-3-small` at 1536 dimensions. This is a *versioned, provisional* decision: the embedding-profile seam (§16) exists precisely so the first choice is cheap to revise, and the downscoped launch evaluation (§14) compares alternatives after the system is queryable, not before it exists. Changing the default requires a benchmark comparison, not a redesign.

**Model-call data policy.** Every model call that sees private corpus content — embedding, distillation, reranking, synthesis, planning — processes private organizational data, including private-channel Slack text. All such calls must go through OpenRouter endpoints restricted to ZDR-enforced or explicitly approved providers, recorded per embedding/prompt profile. This is a provisional policy in the stack manifest (D4) and must be finalized before the first private-source content is embedded.

### 3.4 Queue + transactional outbox

Parsing, model embedding calls, R2 operations, and any future external ANN store remain asynchronous. Use a transactional outbox:

1. transaction commits object/revision/units plus `index_tasks` rows;
2. queue dispatcher publishes pending tasks;
3. indexing consumer generates embeddings and writes `corpus_embeddings`;
4. index task becomes `ready` only after success;
5. retrieval hydrates only active/current units whose index record is ready.

The same pattern handles re-embedding, deletion, redaction/purge propagation (§4.8), and future Vectorize writes and R2 retention work.

**Stale-event guard.** Cloudflare Queues provide at-least-once delivery with no ordering, so the revision-commit transaction — not the envelope — is what prevents older events from overwriting newer state:

- `SELECT ... FOR UPDATE` on the delivery receipt row serializes concurrent duplicate deliveries; the loser observes the durable processed outcome and exits idempotently;
- `SELECT ... FOR UPDATE` on `corpus_objects`, then advance `current_revision_id` only if the incoming `(source_version, source_updated_at, observed_at)` tuple is strictly newer than the object's current state; otherwise persist the revision as historical without moving the pointer (or record a `stale` outcome);
- `source_updated_at` (or a documented per-connector surrogate such as Slack edit `ts` or GitHub `updated_at`) is **required** at the storage layer for every upsert-type event; connectors that cannot supply one may not ship.

### 3.5 Index maintenance

Immutable revisions plus supersession make the hottest sources (active Slack threads) a steady generator of dead and inactive index entries. This is a routine Postgres operations problem, but it must be operated deliberately:

- HNSW does not rebalance or reclaim deleted graph entries until vacuum, and never shrinks without reindex. The embeddings and search-document tables get tuned autovacuum settings and a scheduled `REINDEX CONCURRENTLY` policy;
- churn metrics — inactive-row ratio per table, HNSW/GIN index size growth vs. active-row growth, vacuum lag — are first-class observability (§13), with alerts before recall or latency degrades;
- the content-addressed unit layer (§4.3) exists partly to *prevent* churn: unchanged content must never produce new index entries.

## 4. Canonical relational model

All core tables carry `corpus_id`, even if the first corpus is a single OpenRouter-wide corpus. This provides a safe future seam for restricted corpora, acquisitions, sandboxes, or legal partitions without adding product multi-tenancy now.

### 4.1 Connections and containers

#### `corpus_connections`

One authenticated connector installation.

- `id`
- `corpus_id`
- `provider` (`slack`, `github`, `linear`, `notion`, `web`, `rss`, `agent`)
- `external_tenant_id`
- `credential_ref` (encrypted credential reference, not secret material)
- `config_json`
- `enabled`
- `created_at`, `updated_at`

#### `corpus_containers`

A source visibility/sync boundary: Slack channel, GitHub repo, Linear team, Notion page/database tree, RSS feed, or agent workspace.

- `id`
- `connection_id`
- `external_id`
- `container_type`
- `name`, `canonical_url`
- `parent_container_id`
- `visibility_class`
- `sync_policy_json`
- `current_acl_version_id`
- `acl_synced_at` (drives the fail-closed staleness rule in §6)
- `archived_at`

Containers are separate because ACL and sync policy usually inherit from a channel/repo/team/page tree rather than each message/chunk independently.

### 4.2 Stable objects and immutable revisions

#### `corpus_objects`

Stable identity of the logical source object.

Examples:

- one Slack thread;
- one GitHub PR, issue, commit, review, file, or release;
- one Linear issue/document/project/milestone;
- one Notion page;
- one web article URL;
- one local-agent work update.

Fields:

- `id`
- `corpus_id`
- `connection_id`, `container_id`
- `source_type`
- `object_type`
- `external_id`
- `canonical_url`
- `title`
- `author_principal_id`
- `source_created_at`, `source_updated_at`
- `current_revision_id`
- `lifecycle` (`active`, `deleted`, `redacted`, `archived`)
- `authority_class`
- `metadata_json`
- unique `(connection_id, object_type, external_id)`

#### `corpus_revisions`

Immutable snapshot of what an object said at a point in time.

- `id`
- `object_id`
- `source_version`
- `content_hash`
- `normalized_text` (nullable; see text-offload note below)
- `text_blob_id` (R2 offload target when `normalized_text` is null)
- `raw_blob_id`
- `source_created_at`, `source_updated_at`
- `observed_at`
- `effective_at`
- `supersedes_revision_id`
- `parser_profile_id`
- `metadata_json`
- unique `(object_id, content_hash)`

The object points at its current revision. Old revisions remain available for "what did we believe then?", audits, diffing, and replay. Source deletion creates a tombstone/current lifecycle transition and schedules de-indexing; retention/legal purge goes through the redaction flow in §4.8, which is the *only* sanctioned way revision content is ever altered.

**Text offload for high-churn sources.** Whole-thread revisioning (§8 Slack) means an N-reply thread accumulates O(N²) message-copies if every revision inlines full text. Superseded revisions of high-churn objects may have `normalized_text` moved to a content-addressed R2 blob (`text_blob_id`) by a compaction job; the current revision stays inline. Search never reads superseded revision text — the content-addressed unit layer carries all searchable copies — so offload does not affect retrieval.

### 4.3 Searchable content units — content-addressed

Review finding F3: units keyed only by `revision_id` regenerate every unit, search document, and embedding on every revision, making live Slack threads quadratic in storage and embedding spend and a continuous source of index churn. Units are therefore **content-addressed and revision-independent**, joined to revisions through a membership table.

#### `corpus_content_units`

A retrieval-sized, immutable derived unit, deduplicated across revisions of the same object.

- `id`
- `object_id`
- `unit_type` (`document`, `section`, `chunk`, `thread_composite`, `slack_burst`, `comment`, `code_symbol`, `file_summary`, `work_update`, ...)
- `anchor_json` (line range, block IDs, Slack timestamp range, comment IDs)
- `title`
- `text`
- `context_text` (heading/path/thread question used for embedding)
- `token_count`
- `chunk_profile_id`
- `content_hash`
- unique `(object_id, chunk_profile_id, unit_type, content_hash)`

#### `corpus_revision_units`

Membership of a unit in a revision.

- `revision_id`
- `unit_id`
- `ordinal`
- `parent_unit_id`
- unique `(revision_id, unit_id)`

A new revision of a 40-message thread whose only change is one appended reply creates **one or two** new units (the new message chunk and the refreshed thread composite/tail) and links all unchanged units unchanged; their search documents and embeddings never churn. Re-chunking creates new units under a new `chunk_profile_id` and retires the old profile after indexes are ready. Chunks never overwrite source evidence.

### 4.4 Derived artifacts and evidence

#### `corpus_artifacts`

Versioned model- or code-derived outputs:

- `artifact_type` (`summary`, `thread_distillation`, `decision`, `claim`, `change_impact`, `project_status`, `topic_digest`, `entity_profile`)
- `artifact_schema_version`
- `content_json`
- `rendered_text`
- `model_id`, `prompt_version`, `code_version`
- `confidence`
- `status` (`proposed`, `accepted`, `superseded`, `disputed`, `redacted`)
- `valid_from`, `valid_to`
- `acl_container_ids` (denormalized set of containers whose evidence the artifact cites)
- `created_at`

#### `corpus_artifact_evidence`

Many-to-many links from an artifact to exact source revisions/content units. Every claim, decision, impact summary, and workflow proposal must cite evidence through this table.

**Artifact ACL (review finding F1 — mandatory).** An artifact is exactly as restricted as the most restricted evidence it cites:

- an artifact's effective visibility is the **intersection** of the current ACLs of every container whose evidence it cites — a principal may see the artifact only if they may currently see *all* of its cited containers;
- the citing containers are denormalized onto the artifact (`acl_container_ids`) at creation and re-derived whenever evidence links change;
- artifacts citing evidence from a single container may be projected into search documents under that container's ACL; cross-container artifacts are projected only where the intersection is enforceable at candidate generation, and hydration re-checks every cited container's current ACL regardless;
- when any cited container's ACL changes, an outbox task re-evaluates the artifact's projection;
- when cited evidence is tombstoned or purged, the artifact is superseded and de-indexed (and transitioned to `redacted` if purged) — see §4.8.

Synthesis pipelines that want broad visibility must synthesize **from broadly visible evidence only**; restricting inputs is the mechanism, not post-hoc reclassification.

This supports useful synthesis without promoting model output to truth. The retriever can return evidence, artifacts, or both, and answer generation can show the original citations.

### 4.5 Optional entities and relationships

Do not start with a graph database. Add simple Postgres tables when entity queries become valuable:

- `corpus_entities` (person, project, service, repo, model, provider, customer, incident, decision topic);
- `corpus_identity_links` (Slack/GitHub/Linear/Notion identities → one org principal);
- `corpus_mentions` (unit/artifact → entity);
- `corpus_relations` (entity/object/artifact subject-predicate-object, with evidence and validity interval).

These tables can later be exported to a graph store if real traversal use cases justify it. They should not be canonical ahead of source evidence.

### 4.6 Search projection

One row per queryable representation, sourced from a content unit or artifact. This preserves the Cerebras one-table operational simplicity — every connector output is immediately queryable through one projection — without making the projection canonical evidence.

#### `corpus_search_documents`

- `id`
- `corpus_id`
- `object_id`, `revision_id`, `content_unit_id`, `artifact_id`
- `source_type`, `object_type`, `representation_type`
- `container_id`
- `acl_version_id` (provenance stamp only — authorization always evaluates the container's *current* ACL; §6)
- `title`
- `document_text`
- `search_vector` (`tsvector`, generated or maintained)
- `source_created_at`, `source_updated_at`, `last_activity_at`
- `authority_class`
- `supersession_state` (`current`, `superseded`, `disputed`) — review finding F7: supersession must reach the queryable surface; updated via outbox tasks when a superseding artifact is accepted or a revision is superseded
- `valid_to`
- `metadata_json`
- `active`
- `created_at`

Representation types include: raw/normalized source chunk, Slack thread distillation, Slack burst, code symbol, file summary, Notion section, Linear issue composite, merged-PR impact, project-status artifact, work update.

#### `corpus_embeddings`

- `search_document_id`
- `embedding_profile_id`
- `embedding vector(N)`
- `input_hash`
- `indexed_at`
- `active`
- unique `(search_document_id, embedding_profile_id)`

**`input_hash` is a hard dedupe, not just replay idempotency.** Before calling the embedding model, the indexing worker looks up an existing active vector for `(embedding_profile_id, input_hash)` across the corpus and reuses it; the model is called only for genuinely new input text. Combined with content-addressed units, unchanged content costs zero embedding tokens on re-ingestion or revision advance.

Connector code never writes these tables directly. Connectors emit object snapshots through the ingestion SDK; the corpus library creates revisions/units/search projections and indexing tasks.

### 4.7 Query scopes

ACL answers **may this principal see it?** A scope answers **is this source likely relevant by default?** These are separate systems and must never be conflated: scopes are a relevance convenience with no authorization power.

- `corpus_scopes` — team/project/initiative/situation query scopes;
- `corpus_scope_containers` — references shared source containers without duplicating content;
- `corpus_scope_retrievers` — enabled specialized retrievers and weights per scope;
- `corpus_principal_default_scopes` — human/agent default scope;
- `corpus_scope_memberships` — who may select/administer a scope.

Examples: Platform, Provider Operations, Image API, Batch API, Enterprise, Incidents, All Engineering. Shared repositories or incident channels can belong to multiple scopes. Queries accept explicit scopes; otherwise the authenticated principal's default applies. "Search all" is an intentional opt-in, not the default.

### 4.8 Redaction and purge

Review finding F2: the design invokes legal/retention purge but must define its mechanics, because purge contradicts the immutability invariants and this corpus ingests sources with *mandatory* deletion semantics — Slack deletions must be honored in downstream copies, GDPR/UK-GDPR erasure and employee offboarding require destruction, not tombstones. Purge is therefore **Phase A schema**, not a later add-on.

#### `corpus_redactions`

An auditable purge request and its execution state.

- `id`
- `corpus_id`
- `target` (object / revision / unit / principal / container scoped)
- `reason` (`source_deletion`, `retention_policy`, `legal_erasure`, `security` — e.g. leaked secret)
- `requested_by`, `requested_at`
- `policy_ref`
- `status` (`pending`, `executing`, `completed`, `failed`)
- `completed_at`

Executing a redaction drives outbox tasks that cascade across **every copy** of the affected text:

1. `corpus_revisions.normalized_text` in *all* revisions containing the target content (under whole-thread revisioning, one purged message contaminates every subsequent revision of the thread — the cascade must sweep them all), replacing content with a redaction marker;
2. offloaded revision text blobs and raw blobs in R2 (delete, or destroy the per-container data key when purging whole containers/principals — this is what makes backup purge tractable);
3. `corpus_content_units.text` / `context_text` for affected units;
4. `corpus_search_documents.document_text` and its `tsvector`;
5. `corpus_embeddings` rows for affected search documents (vectors of purged text are deleted, not just deactivated);
6. derived artifacts citing the purged evidence: transitioned to `redacted`, de-indexed, and either regenerated from remaining evidence or left superseded with blanked `rendered_text`/`content_json`;
7. query/analytics telemetry snippets referencing the purged text.

What remains afterward is a content-free audit stub: object/revision identity, hashes, timestamps, the redaction record. Redaction records are append-only; the *content* is destroyed, the *fact that content existed and was purged* is not.

Connector deletion semantics build on this: ordinary source deletion produces a tombstone + de-indexing (evidence retained per retention policy); sources whose terms require true deletion (Slack message deletes, user-initiated erasure) map to `corpus_redactions` with `reason = source_deletion`. Each connector declares which of the two applies per event type, and the deletion-propagation SLO (§13) covers both.

## 5. Provenance, authority, time, and trust

A useful organizational corpus must answer not only "is this similar?" but:

- who said it;
- where;
- when;
- whether it is current;
- whether it was discussion, decision, implementation, or external opinion;
- what superseded it.

Store separately:

- `source_created_at`: when the source object began;
- `source_updated_at`: source's current update time;
- `observed_at`: when Synapse captured this revision;
- `effective_at`: when a decision/change became effective;
- `valid_from` / `valid_to`: derived fact validity;
- `authority_class`: e.g. merged code, accepted Linear issue, maintained Notion policy, Slack discussion, public article;
- `author_trust_tier`: internal employee / internal service / external contributor / public web — derived from identity links, never claimed by payloads. This is the input the write-intent policy engine requires (§11);
- `confidence`: extraction confidence, never source authority.

Ranking may prefer authoritative/current evidence, but should expose the reason. A merged PR is strong evidence of code change; it is not automatically strong evidence of business intent. A Slack decision may explain intent but can be superseded by a later policy page.

## 6. ACL and identity model

Even for a private org-wide system, "internal" must not mean "every employee can retrieve every private channel/DM/private customer document."

Use source-derived access control:

- `corpus_principals`: users, groups, service accounts;
- `corpus_external_identities`: Slack/GitHub/Linear/Notion external IDs;
- `corpus_acl_versions`: immutable, sealed snapshots of container ACL state; publication is monotonic — a stale permissive snapshot can never be replayed over a newer one;
- `corpus_acl_grants`: principal/group grants;
- each container points to its current sealed ACL snapshot.

**Current, not pinned (review finding F5).** Authorization always evaluates the container's *current* sealed ACL version. ACL versions stamped on revisions and search documents (`acl_version_id`) are provenance/audit metadata only — they record what the ACL was when the row was created and are never an access path. Historical revisions ("what did we believe then?") require *current* permission on the container; losing access to a channel means losing access to its entire history, including revisions captured while access existed.

Enforce visibility twice:

1. candidate generation filters to permitted container/object IDs;
2. hydration re-checks each row against the container's current ACL before text leaves the store.

ANN filtering is only candidate generation. Never trust an index result as the final authorization boundary; re-check ACLs during hydration.

**Revocation propagation is an SLO, not best-effort.** Both enforcement layers read the same mirrored ACL state, so the dominant risk is mirror staleness, not enforcement order. Therefore:

- each connector maintains an explicit inventory of membership/visibility events it subscribes to (Slack channel privacy change, member removal; GitHub repo visibility flip, collaborator removal; Notion share revocation; Linear team membership) and maps each to an ACL re-snapshot;
- event-driven ACL updates target propagation in **minutes** (provisional SLO: under 5 minutes), with reconciliation as backstop, not primary mechanism;
- `corpus_containers.acl_synced_at` drives a **fail-closed staleness rule**: containers whose ACL sync is stale beyond a per-connector threshold are excluded from retrieval until re-verified;
- ACL-event lag is an alerting metric (§13).

**Artifacts** are governed by §4.4: intersection of cited containers' current ACLs, re-evaluated when any cited ACL changes.

For public material, store licensing/crawl policy separately from visibility: public does not automatically mean redistributable.

## 7. Source-agnostic ingestion contract

Every connector produces a canonical event envelope before normalization. The **normative schema is `CorpusIngestEnvelopeSchema` in `packages/synapse-corpus-contracts`** ([#32299](https://github.com/OpenRouterTeam/openrouter-web/pull/32299)); this document specifies its invariants rather than duplicating the field list (inline type snippets drift — review finding F13):

- explicitly versioned (`schemaVersion`), JSON-serializable, safe over queues/MCP/HTTP;
- identifies corpus, connection, provider, external object type/ID/container, and event type (`upsert` | `delete` | `reconcile` | `import`);
- `deliveryId` dedupes provider retries; object identity dedupes semantically identical deliveries;
- non-delete events must carry an inline payload **or** a raw R2 blob reference — never neither;
- ordering metadata is mandatory at the contract boundary (D21): `sourceVersion` **and** `sourceUpdatedAt` are required on every envelope regardless of event type, so stale deletes and upserts cannot clobber newer state — the storage-layer stale-event guard (§3.4) compares them. The legacy `schemaVersion`-1 parser keeps both optional as a migration path, except for delete events, which still require both;
- whole-envelope byte size is bounded below Cloudflare Queue limits; anything larger goes to R2 and is referenced;
- URLs are HTTP(S), bounded, and cannot embed credentials.

Connectors whose source exposes no native version or update timestamp must synthesize per-connector surrogates into `sourceVersion`/`sourceUpdatedAt` — the contract does not exempt them.

The envelope is a delivery contract, not the final document schema.

### Required pipeline ordering

1. verify source signature/auth;
2. ensure the queue/storage capability exists;
3. append the raw delivery and idempotency key;
4. enqueue by raw delivery ID;
5. return quickly;
6. normalize/fetch full current object in the consumer;
7. resolve identities, container and ACL;
8. create immutable revision if content changed — under the FOR-UPDATE monotonic guard of §3.4;
9. create/link content units (content-addressed; unchanged units are linked, not recreated);
10. commit index outbox tasks;
11. asynchronously embed/index/de-index (with `input_hash` dedupe);
12. advance cursor only after the final page/checkpoint commits.

At-least-once delivery is assumed everywhere. Every step is idempotent.

### Connector SDK and governance

Connectors are packages with a declared contract, not ad-hoc scripts with database access:

- manifest: provider/name/owner/schedule/capabilities;
- config Zod schema and credential requirements;
- enumerate/fetch/normalize/delete functions emitting validated envelopes;
- cursor/checkpoint schema and explicit sync outcomes;
- fixture captures and replay/idempotency tests (connector conformance suite);
- data classification, ACL mapping, deletion semantics (tombstone vs. redaction per event type — §4.8), and retention declaration;
- rate-limit and backoff policy;
- health/SLO metadata.

Custom connectors run in the isolated bulk-ingestion service with least-privilege credentials. They emit validated ingestion envelopes; they never receive raw DB or vector-store access.

## 8. Connector behavior

### Slack

Initial value comes from a Slack export, then live Events API ingestion (HTTP Events API into the Worker; Socket Mode only if network policy later forces it — decision D9).

- Import ZIP/raw JSON to R2 unchanged.
- Normalize users, channels, messages and files.
- Treat a Slack thread as one stable object; a reply/edit re-fetches and creates a new whole-thread revision. The content-addressed unit layer (§4.3) makes this affordable: unchanged messages produce no new units, search documents, or embeddings.
- Optionally keep individual messages as child objects for exact citations.
- Maintain **three searchable representations**, each versioned:
  1. full thread evidence and raw-message FTS;
  2. distilled thread question/summary/resolution artifact for semantic search;
  3. same-author message **bursts** with the thread topic prepended — salient long-form fragments recovered for retrieval. Candidate salience signals: length, reactions and unique reactors, rare-term/identifier IDF, code/error/URL density, author role or bot penalty, reply position/resolution markers, age. Thresholds are tuned on a labeled OpenRouter Slack set — do not copy Cerebras's gates blindly.
- Never discard the transcript evidence in favor of distillations.
- Handle edit, deletion, redaction, retention, and private-channel ACL changes. **Slack message deletion maps to `corpus_redactions` (`reason = source_deletion`)** — true purge across revisions, units, projections, vectors, and R2, not just a tombstone (§4.8). Channel privacy/membership changes map to the ACL revocation inventory (§6).
- Rate-limit and checkpoint `conversations.history/replies` reconciliation.

Official references:

- Slack exports: https://slack.com/help/articles/201658943-Export-your-workspace-data
- Events API: https://api.slack.com/apis/connections/events-api
- rate limits: https://api.slack.com/docs/rate-limits

### GitHub

Use webhooks for freshness plus periodic reconciliation.

Objects include repositories, PRs, issues, comments/reviews, commits, releases, selected code/docs, and workflow/incident evidence.

- `X-GitHub-Delivery` is the delivery key.
- A merged PR revision should include title/body, commits, changed files, review discussion, linked issue IDs, merge SHA, author/reviewers, timestamps.
- Repo visibility/installation selection informs ACLs; visibility flips and collaborator removals are ACL revocation events (§6).
- Periodic tree/issue reconciliation catches missed webhooks and deletions.

**Code indexing** is planned explicitly rather than left as "chunk by symbol":

- repository clones/caches live in the bulk-ingestion service (Cloud Run with persistent disk or GCS-backed cache) — Workers have no filesystem; clone lifecycle, size limits, and submodule/LFS policy are part of the connector manifest;
- webhook-driven changed-file indexing at merge SHA, with blob/hash skip state so unchanged files cost nothing; periodic full reconciliation;
- language-aware parsing (evaluate CocoIndex vs. tree-sitter + custom incremental pipeline — decision D13; the connector contract stays implementation-neutral) with regex fallback;
- representations: symbol chunks, file summaries, subsystem index;
- allow/deny/generated-file rules as code; SHA/path/line anchors for citations; deletion/rename handling;
- a **direct ripgrep retriever** over current clones for exact-token search — served by the bulk service, which is the only component with checkouts.

Official reference: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks

### Linear

Use webhooks plus cursor/watermark reconciliation.

Objects include issue, comment, project, milestone, initiative, document and status update. Keep explicit links among them.

- Source `updatedAt`/webhook delivery IDs drive idempotency.
- Fetch the full current issue/document after webhook receipt.
- Treat archived/deleted state as a lifecycle transition.
- Preserve team/project/access boundaries; membership changes are ACL revocation events.

Official reference: https://linear.app/developers/webhooks

### Notion

Use page/database webhooks where available plus periodic reconciliation.

- One page is a stable object; a page revision contains the complete traversed block tree or references an R2 snapshot.
- Chunk by heading/block hierarchy and preserve block IDs for citations.
- Never infer deletion solely from absence in search; require explicit archived, trash, 404, or authoritative reconciliation evidence.
- Preserve page/database sharing boundaries; share revocations are ACL revocation events.

Official references:

- webhooks: https://developers.notion.com/reference/webhooks
- limits: https://developers.notion.com/reference/request-limits

### Web, news, RSS, public posts

Use URL/feed identity plus normalized canonical URL.

- Respect robots.txt, site terms, API terms, copyright and redistribution.
- Store full snapshots only when permitted; otherwise store metadata, allowed excerpts, checksum and source URL.
- Capture ETag/Last-Modified/content hash for updates.
- Keep publication time separate from fetch time.
- Record license and retention policy on the object/blob.
- Never allow an arbitrary URL fetcher to bypass SSRF protection, redirect validation, content-size limits or MIME checks.
- Web content carries `author_trust_tier = public web` and is subject to the write-intent provenance policy (§11): it can inform answers but never justify an automated external write.

### Local coding agents via MCP

Treat each local agent connection as a source connection and every work update as a structured object, not unstructured chat exhaust.

The **normative schema is `AgentWorkUpdateSchema` in `packages/synapse-corpus-contracts`**. Its trust invariants (stronger than the earlier sketch in this document — the shipped contract is authoritative):

- human identity is **server-derived from the authenticated MCP session** — the payload cannot claim a principal; any `agentKind` field is an observability label, never an identity;
- `updateId` is a caller-generated idempotency key;
- updates carry repo/branch/commits/PR/ticket references, status, summary, decisions, tests, blockers, and next steps — validated against known repos/tickets before linking;
- `visibility` defaults to **private**, widening is explicit;
- the raw update is stored as evidence; derived project-status artifacts come later, with citations.

## 9. Retrieval

All consumers — PR review, MCP, Slack bot, and web chat — call one internal retrieval service and receive the same evidence-rich result shape. The normative hit schema is `KnowledgeHitSchema` in `packages/synapse-corpus-contracts`; it includes source/object identity, snippet, citation anchor, authority class, per-list scores, and fused score. A merge-blocking layer-1 amendment (F7) adds the **supersession state with reason** to the hit schema so consumers can display "superseded by X" rather than silently reranking.

### Retriever registry

Retrieval is a registry of typed retrievers, not one hard-coded pipeline:

```ts
type Retriever = {
  name: string;
  description: string;
  supportedScopes: string[];
  costClass: 'cheap' | 'moderate' | 'expensive';
  execute(query: RetrievalQuery): Promise<EvidenceCandidate[]>;
};
```

Initial retrievers: unified Postgres FTS; pgvector semantic search; Slack raw-message/thread lexical search; distilled-thread search; direct repository ripgrep; indexed code semantic search; recent/linked-PR retrieval; Linear/project lookup; Notion policy lookup; entity/relationship retrieval; subsystem/file-summary index. (`who_knows` stays disabled until the transparency/opt-out policy exists — decision D14.) All return the same evidence-candidate shape. The query trace records every selected retriever, latency, candidates, and final contribution.

### Planner and executor

An optional LLM planner sees the query, selected/default scope, source/container catalog, retriever descriptions and cost classes, and user constraints, and returns a typed, bounded plan. The executor fans out independent retrieval calls in parallel with per-tool timeouts.

**Degradation is deadline-triggered, not just failure-triggered.** A planner or reranker that is *slow* is treated exactly like one that is *down*:

| Stage | Budget (provisional) | On deadline/failure |
|---|---|---|
| planner | ≤ 300 ms | deterministic default plan for the scope |
| retriever fan-out | ≤ 600 ms per tool, parallel | drop the late tool, note it in the trace |
| fusion + diversity | in-process | — |
| reranker | ≤ 400 ms | return RRF order |
| hydration + ACL recheck | ≤ 200 ms | fail closed per-row |

Budgets are validated against the retrieval-evaluation baseline (measured p50/p95 per stage) and revised there — the table above is the starting allocation for the provisional "retrieval p95 ≈ 1.5 s before synthesis" target, not a promise. MCP primitives (§12) are LLM-free and skip the planner entirely; the planner is opt-in per surface.

### Candidate pipeline

1. parse filters/identifiers/time range/source/scope;
2. ACL-scoped Postgres exact/FTS candidates;
3. ACL-scoped pgvector ANN candidates (mechanics below);
4. optional recency/authority/linked-entity candidates;
5. Reciprocal Rank Fusion (configurable weights and `k`, traced per list — evaluated, not hard-coded forever);
6. dedupe and per-object/per-source caps — grouping keys are representation-aware so a thread's distillation, bursts, and raw chunks collapse to the object before caps apply;
7. rerank top candidates (deadline-bounded);
8. hydrate from Postgres, re-check the container's **current** ACL and lifecycle;
9. exclude or penalize `supersession_state != 'current'` per query profile — "current state" profiles exclude superseded documents from candidates; historical/timeline profiles include them with the state surfaced on the hit;
10. expand neighboring units when useful (adjacent chunks, thread parent/replies, symbol/file context — source-specific);
11. answer only from hydrated evidence, with citations.

### ACL-filtered ANN (review finding F4)

pgvector HNSW post-filters: a WHERE clause is applied to the `ef_search` nearest neighbors *after* the graph walk, so a principal entitled to a small slice of the corpus can receive few or zero permitted candidates from a default scan. The design commits to a concrete mechanism rather than a one-line aspiration:

- resolve the principal's **permitted container set** (plus object-level exceptions) into a flat array *before* the ANN query, and filter with a sargable per-row predicate (`container_id = ANY($permitted)`) — never the multi-table grant join inside the ANN query;
- run with pgvector ≥ 0.8.0 **iterative index scans**: `SET hnsw.iterative_scan = strict_order` with an explicit `hnsw.max_scan_tuples` budget so low-selectivity principals trade bounded latency for recall;
- oversample (fetch M×K candidates, post-filter) with M derived from measured per-principal visibility selectivity;
- when permitted survivors < K after the scan budget, **degrade to FTS-only candidates and say so in the trace** — never silently return an empty semantic list;
- emit a metric for "ANN scan exhausted before K permitted candidates" (§13);
- the evaluation program includes restricted-principal recall cases (not just ACL-leakage cases): a principal with narrow visibility must still get useful recall on their permitted slice.

### Query profiles

Do not make one static source ranking universal:

- exact identifier/error/commit query: lexical-heavy;
- conceptual question: vector-heavy;
- "what changed this week?": time + change-impact artifacts;
- "why did we decide X?": decisions/claims plus evidence timeline (superseded evidence *included*, labeled);
- PR review: repo/path/linked-ticket scoped context pack.

### PR review context

Before running reviewer agents, build a bounded context pack from:

- linked Linear issues/projects;
- prior PRs touching the same paths/subsystem;
- current Notion policies/decisions;
- recent Slack decisions with strong evidence;
- current project/work updates;
- known incidents or constraints tied to the affected services.

This context is untrusted evidence, clearly delimited from instructions, capped by tokens, and citation-linked. Repository `AGENTS.md`/`REVIEW.md` remains the highest-priority code-review policy source. The GitHub-layer gate includes adversarial injection tests: instructions embedded in ingested issue bodies/comments must not steer the reviewer.

## 10. Synthesis and claims

Synthesis should be a separate, versioned pipeline — not a side effect that replaces the source text.

Useful artifact types: Slack thread question/summary/resolution; merged-PR impact assessment; project status snapshot; decision record; subsystem overview; person/expertise profile; topic digest; claim with evidence and validity.

Claims must support:

- proposed/accepted/disputed/superseded status;
- validity interval;
- confidence;
- authority class;
- evidence links;
- explicit supersession — and acceptance of a superseding claim propagates `supersession_state` to the superseded document's search projection (§4.6).

A model may propose claims. Code or approved workflows determine whether they become accepted/current. Answers should prefer original evidence and show when a statement is derived or disputed. Every artifact inherits the intersection ACL of its evidence (§4.4); pipelines that need org-visible outputs restrict their inputs to org-visible evidence.

## 11. External-write workflows

Never expose raw Linear/Notion/GitHub write tools directly to a model. The model produces a typed **write intent**; deterministic code owns the action.

Workflows subscribe to **normalized corpus domain events** (`corpus_domain_events`, e.g. `github.pr.merged`, with an independent payload version) through `corpus_workflow_subscriptions` — they never couple directly to connector payloads.

Tables:

- `corpus_workflow_definitions`
- `corpus_workflow_runs`
- `corpus_write_intents`
- `corpus_external_actions`
- `corpus_action_approvals`

A write intent contains:

- trigger event/revision;
- target system/object;
- proposed patch, not whole replacement where possible;
- evidence artifact IDs — **with the authority class and author trust tier of every cited evidence item denormalized onto the intent**;
- confidence and rationale;
- idempotency key;
- expected source version/ETag;
- required policy/approval;
- dry-run result.

### Policy engine: provenance, not just quantity (review finding F6)

The corpus is a stored-prompt-injection amplifier by construction: attacker-influenced text (external GitHub comments, public web/RSS articles, inbound Linear/Notion content) becomes "evidence" that a synthesis model reads before proposing writes. Counting evidence items is not a defense. The policy engine enforces, in addition to target allowlists and actor scopes:

- **provenance floor:** minimum evidence requirements are expressed over `authority_class` and `author_trust_tier`, not raw counts — e.g. "a Linear status change requires at least one merged-PR or accepted-artifact citation authored by an internal principal";
- **taint rule:** intents whose justifying evidence includes *any* external-author or public-web content are hard-blocked from automatic execution and flagged in the approval UI with the exact suspect passages quoted;
- minimum confidence, dry-run arm flag, human approval where required, no state transitions/creation outside configured teams/spaces — as before;
- the external-write layer's gate includes red-team cases: a malicious issue body or web article attempting to induce a write intent must be demonstrably blocked by the taint rule.

### Example: PR merged → Linear/Notion update

1. GitHub merge webhook is stored and the full merged PR/commit is ingested.
2. A `github.pr.merged` domain event is published; the merge-impact workflow subscription fires.
3. Synapse derives a `change_impact` artifact citing the PR, commits, files, linked Linear issue, discussion, and relevant policy evidence.
4. Relationship resolver identifies candidate Linear issues/projects and Notion pages from explicit links first, retrieval second.
5. Model proposes typed write intents.
6. Policy engine enforces the provenance/taint rules above.
7. Cloudflare Workflow fetches current external state and version.
8. Apply minimal patch with optimistic concurrency/idempotency.
9. Record request/response/outcome even on failure.
10. Re-ingest the destination object so corpus state closes the loop.

Initial policy requires human approval for Notion body edits, Linear status/priority changes, issue creation, and any destructive action. Automatic comments or appended merge-impact notes can be enabled per project after a measured dry-run period — and even then only for intents whose evidence is entirely internal.

## 12. Service boundaries

### `cfw-synapse`

Owns:

- signed webhook/MCP/query ingress;
- low-latency retrieval orchestration;
- Slack bot interaction;
- PR review integration;
- queue publication;
- low-volume live event normalization;
- CF Workflow external-write orchestration.

### Bulk ingestion worker (Cloud Run)

A separate Cloud Run service owns:

- Slack export ZIP processing;
- large GitHub/Notion/Linear backfills;
- article/PDF/media parsing;
- high-volume chunking and embedding batches;
- repository clones/caches and the direct ripgrep retriever (§8 GitHub);
- long reconciliation, compaction (§4.2 text offload), and redaction-cascade jobs;
- custom connector execution (sandboxed, least-privilege).

It consumes the same canonical envelope and writes through the same corpus package, connecting directly to Cloud SQL (never Hyperdrive). Start live small-event ingestion in the Synapse queue consumer if simpler; add the bulk worker before the first export/backfill.

### Query surfaces

- Internal MCP endpoint on Synapse for coding agents — **LLM-free primitives** (`search`, `search-slack`, `search-code`, `recent-prs`, `subsystem-index`) plus `report-work-update`; the client orchestrates. Do not hide all retrieval behind one answer endpoint.
- Slack bot calls the same retrieval API.
- Mission Control/web chat uses authenticated private `cfw-frontend-api` routes and a service binding/internal auth hop to Synapse; it does not import the corpus DB directly. The chat pipeline is planner → bounded parallel executor → synthesis with citations, streaming, with explicit failure UX.
- PR reviewer calls a bounded context-pack endpoint internally.

Existing patterns:

- Worker DB context: `packages/cloudflare/db-context.ts`.
- Public MCP transport reference: `services/cfw-mcp/src/mcp/build-mcp-server.ts`.
- Slack outbound client: `packages/clients/slack/index.ts`.
- Linear client precedent: `projects/mission-control/app/clients/linear/index.ts`.
- Durable workflow examples: `services/cfw-intern-provisioner/src/workflow.ts` and `services/cfw-internal/src/workflows/`.
- Embeddings routing: `packages/embeddings` / `services/cfw-embeddings-api` (§3.3).

## 13. Observability, analytics, and audit

Track the pipeline, not just endpoint uptime:

- source freshness and cursor lag;
- raw deliveries received/deduped/replayed/dead-lettered;
- objects/revisions/units created and deleted;
- parse/chunk/embed failures by connector/profile;
- index outbox age and embedding/index orphan/missing counts;
- **index churn**: inactive-row ratios, HNSW/GIN size growth, vacuum lag (§3.5);
- **ACL-event lag and staleness exclusions** (§6);
- **deletion/redaction propagation time** against SLO (§4.8);
- **ANN scan exhaustion** rate (§9);
- query zero-result rate, lexical/vector overlap, reranker degradation rate, citation coverage;
- ACL-filtered candidate counts;
- answer feedback and source usefulness;
- write-intent approval/rejection/failure/taint-block rates;
- stale/superseded claim usage.

Query telemetry is first-class product analytics, stored in dedicated tables/streams:

- `corpus_query_runs` — user/agent/surface, scope, planner choice, latency/cost;
- `corpus_retriever_runs` — per-retriever candidates, latency, final contribution;
- `corpus_answer_runs` — synthesis model/tokens, citations shown;
- `corpus_feedback` — clicks, copies, up/down votes, reformulations;
- `corpus_access_decisions` — ACL allow/deny traces for audit.

Queries are stored as hashes or redacted text under an explicit sensitive-query retention policy. **Never log full private evidence into ordinary application logs**; telemetry snippets participate in the redaction cascade (§4.8).

## 14. Evaluation

The launch evaluation is deliberately small and owned, not aspirational (review finding F10):

- **Launch set:** ~40 questions with expected source citations, assembled by the corpus owner with one nominee per ingesting team. Cases: exact-token (errors, flags, commit IDs), paraphrase, freshness/supersession, ACL-negative (restricted evidence must not surface), restricted-principal recall (narrow-visibility principals must still get useful results), and deliberately unanswerable questions.
- **Metrics:** Recall@K and citation precision per retriever and fused; ACL leakage (must be zero — verified by running the ACL-negative set as multiple principals); stale-result rate; p50/p95 per pipeline stage against the §9 budget table.
- **Gates:** no embedding/chunk/ranking change ships without a benchmark comparison; the production HNSW index ships on the default v1 embedding profile (§3.3), with the first bake-off run as a *post-launch comparison* through the profile seam.
- The fuller 100–300-question program, planner tool-selection evaluation, and online feedback loops come after the system is queryable, and online feedback is used only behind the offline safety/relevance gates.

## 15. Ownership and sustainability

This system is an internal tool at a company whose product is an AI gateway. It must not become an unowned second product (review finding F11).

- **Corpus owner:** Luke Parke (design, stack, evaluation sign-off) until explicitly handed over. The stack manifest's gate table designates the accountable approver role per gate (corpus owner, infra owner, security review); each role must resolve to a specific person before its first gate approval, recorded in the manifest.
- **Operations:** connector breakage, DLQ/outbox lag, ACL-sync incidents, and corpus-DB health alert the corpus owner; there is no on-call rotation until the tool has proven adoption. ACL-sync incidents are treated as security incidents.
- **Budget:** infra cost (dedicated Cloud SQL instance, R2, queues, Cloud Run, model calls) is sized through the infrastructure RFC's capacity model (RFC §9), which derives estimates from measured exports before final sizing — no dollar figures are committed until that measurement runs. Cost is reviewed at each phase gate, and a monthly embedding/model spend cap with an alert is an infra-approval requirement (RFC §14) before ingestion starts — spend is never open-ended.
- **Adoption checkpoints gate expansion:** Phase D (additional sources and synthesis) does not start unless the Phase C surfaces show real usage (provisional: ≥10 weekly active internal queriers sustained for 4 weeks). Phase E (external writes) additionally requires a reviewed dry-run period.
- **Freeze/kill criterion:** if adoption checkpoints fail for two consecutive months, the corpus freezes at its current phase — connectors keep syncing or are paused by explicit decision, and no new surface work lands. A frozen corpus with clean deletion semantics can be resumed or decommissioned (the redaction flow doubles as decommission tooling).

## 16. Evolution seams

The design deliberately supports later changes:

- **Embedding model migration:** multiple embedding profiles per search document; index new profile, compare, switch, delete old. This is how the provisional v1 default gets revised.
- **Vector store migration:** pgvector behind an adapter plus authoritative Postgres profiles/outbox; Vectorize is the first offload option.
- **Re-chunking:** immutable revision + versioned chunk profile; content-addressed units make profile transitions cheap for unchanged content.
- **New connectors:** new adapter emits the same envelope through the connector SDK; source-specific fields stay in metadata until proven common.
- **New derived schemas:** artifact schema/model/prompt/code versions.
- **ACL growth:** sealed, monotonic container ACL versions already exist; object-level overrides extend the same model.
- **Graph features:** entities/mentions/relations can be populated from existing revisions and units.
- **Claims correction:** append superseding/disputing artifacts; never rewrite evidence — except through the audited redaction flow (§4.8), which is the sanctioned override, not a violation.
- **Separate physical stores:** `corpus_id` and dedicated package allow future partitioning or dedicated instances without changing query contracts.

## 17. Rejected shapes

### One giant `embeddings` table

Good prototype, poor long-term source of truth. It conflates evidence, revisions, chunks, summaries and index state.

### Vector database as canonical memory

Vectors are lossy and difficult to audit, version, delete and cite. They are an index only.

### Store only summaries/distillations

Loses evidence and prevents better future models from re-deriving knowledge. Store raw evidence plus derived artifacts.

### Graph database first

Most initial questions are hybrid retrieval with metadata/time/ACL filters. Start relational; add graph projection when traversal use cases are measured.

### Model directly writes Linear/Notion

Breaks audit, idempotency, authorization, concurrency and prompt-injection containment. Use typed intents and durable policy-controlled workflows.

### One synchronous ingest request

Backfills and exports exceed request budgets and make retries dangerous. Accept, append, queue, checkpoint and replay.

### Pinned-ACL access to historical revisions

Rejected during review (F5): letting a revision's stamped ACL version authorize access would leave revoked users able to read history. Stamped versions are audit provenance; authorization is always current-ACL.

### Purge as a later phase

Rejected during review (F2): a corpus of Slack/GDPR-governed content without purge mechanics is a liability from the first private ingest, and retrofitting a cascade across revisions/units/projections/vectors/blobs/artifacts is far more expensive than building it into the foundation schema.

## 18. Recommended rollout

Phases map to the stack layers in [`corpus-pr-stack.md`](./corpus-pr-stack.md), which carries the live PR links and gate states.

### Phase A — Corpus foundation

- dedicated corpus Postgres (dedicated Cloud SQL instance) + Kysely package;
- R2 raw bucket with per-container data keys;
- object/revision/content-unit (content-addressed)/ACL/outbox schema;
- **redaction/purge schema and cascade tasks**;
- ingestion envelope SDK (contracts package);
- queue/DLQ and index worker with `input_hash` dedupe;
- pgvector/HNSW index on the v1 embedding profile;
- exact/FTS/vector retrieval with citations and the filtered-ANN mechanics of §9;
- replay/deletion/redaction/admin observability.

### Phase B — Highest-value ingestion

- Slack export importer;
- GitHub live webhook + reconciliation;
- MCP `report-work-update` source;
- live Slack thread updates (with deletion→redaction propagation).

### Phase C — Query surfaces

- internal retrieval/answer API;
- coding-agent MCP search/context tools (LLM-free primitives);
- Slack bot;
- Mission Control/web chat and corpus admin;
- bounded PR-review context packs (with injection gates).

### Phase D — Additional sources and synthesis *(gated on Phase C adoption — §15)*

- Linear and Notion connectors;
- web/RSS/articles/public posts;
- entity resolution;
- decisions/claims/change-impact/project-status artifacts with intersection ACLs;
- retrieval evaluation expansion and ranking tuning.

### Phase E — Maintainer workflows *(gated on Phase D + reviewed dry-run — §15)*

- PR-merge impact workflow in dry-run;
- write-intent review UI with taint flagging;
- approved Linear comments/status updates;
- approved Notion updates;
- re-ingestion/audit loop;
- narrowly scoped automatic writes (internal-evidence-only) after measured success.

## 19. Decision log

Every load-bearing decision, its status, and where it is owned. New reversals append here; they do not silently edit prose above.

| # | Decision | Status | Owner / where |
|---|---|---|---|
| D1 | Dedicated Cloud SQL instance + database before first production private ingest; shared instance only for temporary non-production evaluation | **decided** (revised from "separate database initially"; instance approval re-gated to layer 6 by D17) | infra RFC ([#32301](https://github.com/OpenRouterTeam/openrouter-web/pull/32301)); infra owner approval gates layer 6 |
| D2 | pgvector/HNSW in corpus DB as initial ANN index; Vectorize is future offload | **decided** (revised from Vectorize-first) | §3.3; Cerebras comparison |
| D3 | Default embedding profile v1: `openai/text-embedding-3-small` @ 1536 via `cfw-embeddings-api`; revisable through the profile seam post-launch | **decided (provisional)** | §3.3, §14 |
| D4 | Model calls on private content restricted to ZDR-enforced/approved providers | **policy pending** — final before first private-content embedding | §3.3; stack manifest |
| D5 | ACL semantics: authorization always evaluates the current sealed container ACL; stamped versions are audit-only | **decided** | §6 (review F5) |
| D6 | Artifact ACL = intersection of cited containers' current ACLs | **decided** | §4.4 (review F1) |
| D7 | Purge/redaction is Phase A schema with full cascade | **decided** | §4.8 (review F2) |
| D8 | Content-addressed units + revision-membership join; `input_hash` hard dedupe | **decided** | §4.3, §4.6 (review F3) |
| D9 | Slack live transport: HTTP Events API into the Worker | **decided** (Socket Mode only if network policy forces) | §8 |
| D10 | ACL policy: mirror source permissions; explicitly configured containers may be org-visible | **policy pending** — final before first private-source ingest | stack manifest |
| D11 | Identity authority: Clerk/Google Workspace principal, external identities linked | **policy pending** — final before ACL/query surface layer | stack manifest |
| D12 | Raw retention/classification matrix; per-container data keys | **policy pending** — final before first Slack export upload | infra RFC + stack manifest |
| D13 | Code indexing implementation: CocoIndex vs tree-sitter/custom bake-off; contract stays neutral | **open** — final before code-indexing work in the GitHub layer | §8 GitHub |
| D14 | `who_knows` disabled until transparency/opt-out policy exists | **decided** | stack manifest |
| D15 | Write policy: all external writes require approval initially; auto-writes only for fully-internal evidence after dry-run | **decided** | §11 |
| D16 | Adoption checkpoints gate Phases D/E; freeze/kill criterion | **decided** (per D18 the checkpoints gate runtime enablement, not merge) | §15 |
| D17 | Infra-owner instance approval re-gated from layer 2 to layer 6: the RFC merges on docs review; the dedicated-instance approval is merge-blocking for the first private-source ingest, matching D1's actual constraint | **proposed 2026-08-17** — decided when the plan-amendments PR merges | stack manifest §3 |
| D18 | Calendar-time gates (Phase D adoption checkpoint, Phase E dry-run period) move from merge conditions on layers 10/11 to post-merge runtime feature-flag gates; the code merges dark and the checkpoints gate ENABLEMENT | **proposed 2026-08-17** — decided when the plan-amendments PR merges | stack manifest §3; §15 |
| D19 | The stack gains explicit deployment layers (worker mount + MCP transport, Slack app, provisioning/Terraform); every gate element that requires a running system (latency budgets, review benchmark, product review, adoption analytics, dry-run) moves to POST-DEPLOYMENT VALIDATION unblocked by those layers, so no lower layer's merge deadlocks on evidence only a higher layer can produce | **proposed 2026-08-17** — decided when the plan-amendments PR merges | stack manifest §3 |
| D20 | Gate approvers resolve to named people before the next gate approval; where the corpus owner authored the PR, approval is recorded by a second maintainer's PR review or a linked sign-off issue — never self-approval | **proposed 2026-08-17** — decided when the plan-amendments PR merges | stack manifest §6 |
| D21 | Ordering metadata is mandatory at the contract boundary: `sourceVersion` AND `sourceUpdatedAt` are required on every ingest envelope regardless of event type (`CorpusIngestEnvelopeSchema`, `schemaVersion` 2). The legacy `schemaVersion`-1 parser stays available per the package AGENTS.md rule with both fields optional as a migration path — except delete events, which still require both. This makes contract-boundary rejection of unordered envelopes the documented norm rather than a runtime backstop, and closes the upsert stale-overwrite window | **decided** (@LukasParke ruling, 2026-08-21; V1 relaxation recorded 2026-08-24) | §7; `packages/synapse-corpus-contracts` |

The 2026-08-17 verified review register lives in [`review-findings-2026-08-17.md`](./review-findings-2026-08-17.md); its G-findings carry the same disposition discipline as F1–F19.
