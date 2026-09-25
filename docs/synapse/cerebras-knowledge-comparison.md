# Synapse Corpus vs. the Cerebras Knowledge Architecture

**Status:** historical gap analysis — superseded where it disagrees with the architecture doc
**Created:** 2026-08-05
**Updated:** 2026-08-06
**Reviewed source:** [How Cerebras Built Its Enterprise Knowledge Base](https://www.cerebras.ai/blog/how-we-built-our-knowledge-base), Cerebras, 2026-07-15
**Companion design:** [`corpus-architecture.md`](./corpus-architecture.md)

> **Superseded note.** Every correction this document proposed (§5) has been folded into [`corpus-architecture.md`](./corpus-architecture.md), which is the single normative design. The schema sketches in §3, the missing-concept sections in §4, and the "Current Synapse plan" and "Gap / decision" columns of the §2 table describe the *pre-correction* plan and are kept as the record of why the design changed — every gap listed there is now resolved in the architecture doc (see §5 for the mapping). Where this document and the architecture doc disagree, the architecture doc wins.

## 1. Summary

The Synapse corpus plan is stronger than the Cerebras design on provenance,
temporal revisions, deletion, derived-claim lineage, ACL versioning, and audited
external writes. Cerebras is stronger and more concrete on the actual search
product:

- one connector interface that becomes queryable immediately;
- Postgres FTS + pgvector in one operational store;
- Slack-specific retrieval representations (thread distillation and bursts);
- specialized retrieval tools alongside unified search;
- query planning and parallel fan-out;
- project/default scopes for relevance;
- exact RRF/rerank/diversity/context-expansion behavior;
- self-service connector and source onboarding;
- adoption and query analytics as first-class platform requirements.

The most important revision from this comparison is:

> Use **pgvector in the dedicated corpus Postgres** initially, not Vectorize.
> Keep a vector-store adapter and index records so Vectorize remains a future
> scale/migration option.

The earlier objection to pgvector was pollution of the platform database. A
separate corpus database removes that objection. Keeping lexical search,
embeddings, source metadata, sync state, and transactions together materially
simplifies correctness and replay, which Cerebras explicitly reports as an
advantage for incremental code indexing.

## 2. Direct comparison

| Area | Cerebras | Current Synapse plan | Gap / decision |
|---|---|---|---|
| Canonical evidence | One shared embeddings table with summaries and metadata | Stable objects, immutable revisions, derived units/artifacts | Keep Synapse's evidence model; add one denormalized search projection so connector/query ergonomics remain simple |
| Vector storage | pgvector, 3,072 dimensions, HNSW | Was Vectorize-first; revised | pgvector in dedicated corpus DB (applied — architecture §3.3, decision D2); provisional v1 profile decided (D3) rather than copying 3,072 blindly |
| Lexical search | Postgres GIN FTS over raw Slack content | Postgres exact/FTS candidates | Good; specify search-document table and language-specific text-search configuration |
| Slack semantic representation | Distilled question + summary + resolution + systems/code refs | Thread artifact proposed | Good, but define exact schema and keep raw transcript separately |
| Slack detail recovery | Same-author bursts, topic-prefixed; gate by IDF ≥4, ≥200 chars, reactions | Not explicitly planned | Missing; add burst/content-salience pipeline and evaluate thresholds on OpenRouter Slack |
| Slack live transport | Socket Mode, immediate ACK, event dedupe, whole-thread re-fetch | Events API named generally | Need explicit transport/hosting decision. Socket Mode requires a long-lived service; HTTP Events API fits Workers. Both still need thread re-fetch and reconciliation |
| Code indexing | CocoIndex incremental changed chunks; language-aware coarse-to-fine; summaries | Symbol/heading chunking + reconciliation | Missing implementation choice, clone/cache topology, changed-chunk algorithm, huge repo handling and file-summary/subsystem index |
| Custom connectors | PR-added Python plugins emit shared row schema | Generic envelope | Missing connector SDK, manifest, sandbox, test harness, secret grants, health/cursor contract and ownership model |
| Retrieval signals | Six lists; vector, FTS, Slack FTS, thread summaries, graph, wiki vector | Exact + FTS + ANN + optional time/authority/entity | Need a concrete retriever registry and query profiles; specialized retrievers must normalize to one evidence schema |
| Fusion | Weighted RRF, k=60 | RRF proposed | Specify configurable weights/k, trace each list, evaluate rather than hard-code forever |
| Diversity | Dedupe chunks to source, per-file/source cap, top 20 | Dedupe/caps proposed | Define exact grouping keys and representation-aware caps |
| Reranking | Small LLM scores 0–10, keep top 10 | Rerank with fallback | Define model, prompt/schema, latency/cost budget, confidence calibration and offline eval |
| Context expansion | Pull neighboring wiki sections after ranking | Neighbor expansion proposed | Define source-specific expansion: adjacent chunks, thread parent/replies, symbol/file context |
| Planner | LLM chooses sources/tools from compact indexed-project catalog | Not concretely modeled | Missing query planner, capability catalog, tool budget, fallback and planner evaluation |
| MCP | Direct, mostly LLM-free primitives; client orchestrates | Internal MCP search/context tools | Align with Cerebras: expose stable primitives plus optional answer tool; do not hide all retrieval behind one answer endpoint |
| Web chat | Planner → parallel executor → synthesis with citations | Web chat named | Missing explicit pipeline, streaming contract, answer/citation schema and failure UX |
| Specialized tools | `search_slack`, `search_code`, `recent_prs`, `who_knows`, `subsystem_index` | Mostly unified retrieval | Missing direct code grep, recent-PR retriever, expertise retrieval and subsystem summaries |
| Organization | Projects bundle shared sources; default project per user | `corpus_id` only | Major missing concept: relevance scopes/projects separate from ACLs; user/agent default scopes |
| Auth/audit/analytics | One of the three core platform functions | ACL and observability sections | Need query audit, access-decision trace, product analytics, answer feedback, adoption metrics and sensitive-query retention policy |
| External writes | Not the focus of the article | Typed intents + durable workflows | Synapse extension is appropriate; keep evidence/policy/approval boundary |
| Temporal/history | Current shared rows | Immutable revisions and validity | Synapse is stronger; preserve despite added complexity |
| Evaluation | Article states experiments improved accuracy but little benchmark detail | Small retrieval benchmark proposed | Needs much more concrete evaluation plan before model/chunk/rank choices |

## 3. Revised query-ready model

Cerebras's one-table design is valuable because every connector has one simple
output and every result is immediately queryable. Synapse should preserve this
operational simplicity without making that table canonical evidence.

Add a derived projection:

### `corpus_search_documents`

One row per queryable representation, sourced from a content unit or artifact.

Suggested fields:

- `id`
- `corpus_id`
- `scope_keys`
- `object_id`, `revision_id`, `content_unit_id`, `artifact_id`
- `source_type`, `object_type`, `representation_type`
- `container_id`
- `title`
- `document_text`
- `search_vector` (`tsvector`, generated or maintained)
- `source_created_at`, `source_updated_at`, `last_activity_at`
- `authority_class`
- `acl_version_id`
- `metadata_json`
- `active`
- `created_at`

Representation types include:

- raw/normalized source chunk;
- Slack thread distillation;
- Slack burst;
- code symbol;
- file summary;
- Notion section;
- Linear issue composite;
- merged-PR impact;
- project-status artifact;
- work update.

### `corpus_embeddings`

- `search_document_id`
- `embedding_profile_id`
- `embedding vector(N)`
- `input_hash`
- `indexed_at`
- `active`
- unique `(search_document_id, embedding_profile_id)`

This preserves versioned embedding profiles and lets FTS/search metadata stay
stable when embeddings are regenerated. For the first production profile,
choose a single dimension/model through evaluation, create an HNSW index, and
add a second physical embedding table/index if a future model changes vector
dimension.

The connector API never writes these tables directly. It emits object snapshots
through the ingestion SDK; the corpus library creates revisions/units/search
projections and indexing tasks.

## 4. Major missing concepts to add

### 4.1 Projects / query scopes

ACL answers **may this principal see it?** A project answers **is this source
likely relevant by default?** These must be separate.

Add:

- `corpus_scopes` — team/project/initiative/situation query scopes;
- `corpus_scope_containers` — references shared source containers without
  duplicating content;
- `corpus_scope_retrievers` — enabled specialized retrievers and weights;
- `corpus_principal_default_scopes` — human/agent default;
- `corpus_scope_memberships` — who may select/administer a scope.

Examples: Platform, Provider Operations, Image API, Batch API, Enterprise,
Incidents, All Engineering. Shared repositories or incident channels can belong
to multiple scopes.

Queries should accept explicit scopes; otherwise use the authenticated
principal's default. "Search all" is an intentional opt-in, not the default.

### 4.2 Retriever registry and capability catalog

Define a retriever interface and registry, for example:

```ts
type Retriever = {
  name: string;
  description: string;
  supportedScopes: string[];
  costClass: 'cheap' | 'moderate' | 'expensive';
  execute(query: RetrievalQuery): Promise<EvidenceCandidate[]>;
};
```

Initial retrievers:

- unified Postgres FTS;
- pgvector semantic search;
- Slack raw-message/thread lexical search;
- distilled Slack thread search;
- direct repository ripgrep;
- indexed code semantic search;
- recent/linked PR retrieval;
- Linear/project lookup;
- Notion policy lookup;
- entity/relationship retrieval;
- `who_knows` (subject to explicit privacy policy);
- subsystem/file summary index.

All return the same evidence-candidate shape. The query trace records every
selected retriever, latency, candidates and final contribution.

### 4.3 Query planner and executor

Add an optional planner that sees:

- query;
- selected/default scope;
- available source/container catalog;
- retriever descriptions and cost classes;
- user constraints (time range, exact IDs, source filters).

It returns a typed, bounded plan. The executor fans out independent retrieval
calls in parallel, applies per-tool timeouts, and degrades to deterministic
retrievers when the planner/model is unavailable.

Planner evaluation is separate from retrieval evaluation: did it choose the
right tools, avoid expensive irrelevant tools, and stay within latency/cost
budget?

### 4.4 Slack burst and salience design

The original plan includes thread artifacts but misses Cerebras's second Slack
representation: salient message bursts.

Add a versioned Slack representation pipeline:

- full thread evidence and FTS;
- distilled thread artifact for semantic search;
- same-author bursts with thread topic prepended;
- optional individual exact-citation messages.

Candidate salience signals:

- character/token length;
- reactions and unique reactors;
- rare-term/identifier IDF;
- code/error/URL/reference density;
- author role or bot penalty;
- reply position/resolution marker;
- message age.

Do not copy Cerebras thresholds blindly. Build a labeled OpenRouter Slack set
and tune precision/recall and index volume.

### 4.5 Code-index implementation

The plan needs an explicit code ingestion strategy comparable to Cerebras's
CocoIndex choice:

- repository clone/cache location and lifecycle;
- webhook-driven changed-file indexing at merge SHA;
- periodic full reconciliation;
- blob/hash skip state;
- language parser/regex fallback hierarchy;
- file/symbol/section representations;
- allow/deny/generated-file rules as code;
- large repo limits and submodules/LFS;
- direct ripgrep service for exact current-repo search;
- file summaries and subsystem index generation;
- deletion/rename handling;
- source SHA/line anchors for citations.

Evaluate CocoIndex rather than assuming it, and compare against tree-sitter plus
our own incremental pipeline. The connector contract must remain independent of
that implementation choice.

### 4.6 Connector SDK and governance

Cerebras lets teams submit Python scripts that write the shared schema. Synapse
should offer the same extensibility with a safer boundary.

A connector package contains:

- manifest (provider/name/owner/schedule/capabilities);
- config Zod/JSON schema;
- source credential requirements;
- enumerate/fetch/normalize/delete functions;
- cursor/checkpoint schema;
- fixture captures;
- replay/idempotency tests;
- data classification/ACL/retention declaration;
- rate-limit and backoff policy;
- health/SLO metadata.

Custom connectors run in an isolated bulk-ingestion service with least-privilege
credentials. They emit validated ingestion envelopes; they never receive raw DB
or vector-store access.

### 4.7 Product analytics and audit

Cerebras names authentication, authorization, auditing and analytics as a core
platform function. Add explicit query telemetry tables/streams:

- `corpus_query_runs`
- `corpus_retriever_runs`
- `corpus_answer_runs`
- `corpus_feedback`
- `corpus_access_decisions`

Track:

- user/agent/surface and scope;
- query hash or redacted query (sensitive-query retention policy required);
- planner choice;
- candidate and final source IDs;
- latency/cost/token use;
- reranker degradation;
- citations shown/clicked;
- answer copied/accepted/downvoted;
- no-result and reformulation rate.

Never log full private evidence into ordinary application logs.

### 4.8 Evaluation program

Before choosing embedding model, dimensions, chunk sizes, burst thresholds,
RRF weights, or reranker model, define:

- 100–300 representative questions across teams;
- expected documents/citations, not just expected prose answers;
- exact-token cases (errors, flags, commit IDs);
- paraphrase cases;
- freshness/supersession cases;
- multi-source synthesis cases;
- ACL-negative cases;
- "who knows" and recent-change cases;
- deliberately unanswerable questions.

Metrics:

- Recall@K and nDCG/MRR per retriever and fused pipeline;
- citation precision/coverage;
- stale-result rate;
- ACL leakage rate (must be zero);
- answer factuality grounded in retrieved evidence;
- planner tool-selection accuracy;
- p50/p95 latency and cost;
- source/diversity balance;
- no-answer calibration.

Use online feedback only after offline safety/relevance gates pass.

### 4.9 Capacity, SLOs and cost model

Cerebras reports 15,000 questions/day. Before implementation, estimate for
OpenRouter:

- source objects/revisions/content units by connector;
- Slack export bytes/messages/threads/files;
- code LOC/repos/change rate;
- embeddings/day and full-reindex cost;
- index size and Postgres/R2 growth;
- queries/day by MCP/Slack/web/PR review;
- planner/reranker/synthesis model cost;
- retention and backup cost.

Define SLOs:

- live-event ACK < 3 seconds;
- important live source freshness < 5 minutes;
- ordinary reconciliation freshness < 1–24 hours by connector;
- retrieval p95 target (e.g. < 1.5 seconds before synthesis);
- answer first-token target;
- outbox/index lag alarm;
- source sync failure budget;
- deletion propagation deadline;
- corpus recovery point/time objectives.

## 5. Corrections to the companion design

**All nine corrections below have been applied to `corpus-architecture.md`** (2026-08-06): 1 → §3.3, 2 → §4.6, 3 → §4.7, 4 → §9, 5 → §8 Slack, 6 → §8 GitHub, 7 → §7 connector SDK, 8 → §13/§14 and the stack manifest, 9 → §11. This list remains as the change record:

1. **Vector store:** pgvector/HNSW in dedicated corpus Postgres is the default.
   Vectorize is the future offload/migration option.
2. **Query projection:** add `corpus_search_documents` and
   `corpus_embeddings` as the simple common query interface.
3. **Organization:** add project/query scopes and principal defaults.
4. **Retrieval:** add specialized retriever registry, planner, parallel executor
   and direct MCP primitives.
5. **Slack:** add burst/salience representation.
6. **Code:** plan the incremental indexing implementation and direct grep path.
7. **Extensibility:** add connector SDK/manifest/sandbox.
8. **Product:** add explicit analytics, audit, evaluation, SLO and capacity plans.
9. **Events:** add normalized corpus domain events and workflow subscriptions so
   merge/update workflows do not couple directly to connector payloads.

## 6. Additional schema required

Add to the prior proposal:

- `corpus_search_documents`
- `corpus_embeddings`
- `corpus_scopes`
- `corpus_scope_containers`
- `corpus_scope_retrievers`
- `corpus_principal_default_scopes`
- `corpus_query_runs`
- `corpus_retriever_runs`
- `corpus_answer_runs`
- `corpus_feedback`
- `corpus_access_decisions`
- `corpus_domain_events`
- `corpus_workflow_subscriptions`
- `corpus_connector_definitions`
- `corpus_sync_runs`
- `corpus_sync_checkpoints`

## 7. Planning questions that now block implementation

**Disposition (2026-08-06):** these questions are now tracked in the architecture doc's decision log (§19) and the stack manifest's provisional-policy table, several with decisions recorded (database → D1, embedding → D3, Slack transport → D9, who-knows → D14). The list below is the original formulation:

1. **Database deployment:** Can the dedicated corpus database enable pgvector,
   and will it start in the existing Postgres instance or a dedicated instance?
2. **Embedding evaluation:** Which models/dimensions enter the bake-off, and
   what labeled query set decides the winner?
3. **Scope taxonomy:** Which initial project/query scopes exist, and who owns
   each source bundle?
4. **Slack transport:** HTTP Events API into the Worker, or Socket Mode in the
   long-lived ingestion service? Recommendation: HTTP Events API for live
   events unless private network policy requires Socket Mode.
5. **Slack import:** Which export tier/data types are approved, and how are DMs,
   private channels, files, deletions and retention handled?
6. **Identity authority:** Clerk or Google Workspace? Who owns external identity
   linking and offboarding?
7. **ACL intent:** mirror source ACLs everywhere, or ingest only approved
   containers into intentionally broad org scopes?
8. **Code indexing:** CocoIndex, tree-sitter/custom, or a bake-off? Where do
   clones/caches run and persist?
9. **Raw retention:** export ZIPs, deleted messages, attachments and web
   snapshots by classification/license.
10. **Evaluation ownership:** which team supplies gold questions and signs off
    relevance/ACL gates?
11. **Workflow policy:** which Linear/Notion write intents require approval, and
    which may eventually automate?
12. **Who-knows policy:** employee transparency, opt-out, restricted-source use,
    and how expertise evidence is presented without becoming surveillance.
