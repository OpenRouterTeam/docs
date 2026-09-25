# Synapse Corpus Infrastructure and Capacity RFC

**Status:** proposed decision gate — no resources or schema created
**Stack layer:** 2/11
**Depends on:** [`corpus-pr-stack.md`](./corpus-pr-stack.md), `@openrouter-monorepo/synapse-corpus-contracts`

## 1. Decision request

Approve a **dedicated Cloud SQL for PostgreSQL instance** for the Synapse
corpus, rather than another database inside the platform instance.

This RFC supersedes the earlier graduated/shared-instance default in
`corpus-architecture.md` and `corpus-pr-stack.md`: a shared instance is allowed
only for temporary local/non-production evaluation. The first production
private-source ingest requires the dedicated instance.

Recommended logical resources:

- Cloud SQL instance: `synapse-knowledge-pg` (final name owned by infra)
- database: `synapse_knowledge`
- runtime role: `synapse_runtime`
- migration role: `synapse_migrator`
- read-only/admin analysis role: `synapse_readonly`
- Hyperdrive configs: corpus primary/no-cache, with a read replica added only
  after measurements justify it
- R2 bucket: `synapse-knowledge-raw`
- queues: `synapse-corpus-ingest`, `synapse-corpus-index`, dedicated DLQs

This RFC does not create any of them. The next schema layer is blocked until
infra/database owners approve this decision and provide the connection and
migration path.

## 2. Why a dedicated instance

A separate database in the existing instance provides naming and permission
separation, but it still shares:

- CPU, memory, disk throughput and connection limits;
- maintenance and failover events;
- backup/PITR configuration and recovery blast radius;
- database flags/extensions;
- replicas;
- noisy-neighbor risk.

Corpus workloads differ materially from the platform workload:

- bursty Slack exports and repository backfills;
- potentially millions of immutable revisions/content units;
- FTS GIN and pgvector HNSW index builds;
- bulk embedding writes and re-indexing;
- long reconciliation and retention jobs;
- different deletion, audit and recovery needs.

The user requirement is to avoid polluting existing databases. A dedicated
instance is the only shape that provides actual resource, recovery, extension,
and operational isolation. The extra cost is justified before importing the
first large Slack export; moving a vector-heavy corpus off a shared production
instance later is more disruptive.

Rejected initial alternative: a separate database on `pg-us-central1`.
Use it only for an explicitly temporary development/staging corpus with no
production exports or continuous indexing.

## 3. Provider support evidence

The vendor capabilities cited in this section were verified against the linked
documentation at authoring time. They are external facts that drift; database/
infra owners must re-confirm them against current Cloud SQL and Cloudflare
docs as part of the approval checklist in section 14.

### pgvector

Cloud SQL's official extension list includes `pgvector`:

- PostgreSQL 13+ supports pgvector >= 0.8.0 (use the latest version Cloud SQL offers at provisioning time);
- PostgreSQL 12 supports up to 0.7.4;
- PostgreSQL 11 supports up to 0.5.1 and must not be selected for this new system;
- extension installation requires a `cloudsqlsuperuser` role.

Source: https://cloud.google.com/sql/docs/postgres/extensions

The instance major version must be selected by database/infra owners. Prefer
the same supported major as OpenRouter's current production standard unless
pgvector or operational tooling gives a concrete reason to differ.

Required validation before schema PR:

```sql
SELECT version();
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'vector';
```

Then, through a one-time infrastructure/bootstrap credential that is already
`cloudsqlsuperuser`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';
```

The normal `synapse_migrator` role must not receive `cloudsqlsuperuser`.
Repeatable application migrations assume `vector` is already installed and
fail early if the extension is absent. Local/CI Postgres must use an image with
pgvector available. Do not guard the extension away in tests: CI must exercise
the actual vector type and indexes.

### Hyperdrive

Cloudflare Hyperdrive is configured with a database-specific Postgres
connection string and supports node-postgres/Kysely.

Source: https://developers.cloudflare.com/hyperdrive/configuration/connect-to-postgres/

Create independent Hyperdrive configs for the corpus instance. Do not reuse the
platform Hyperdrive IDs. Start with only required primary bindings; add replica
routing after query/load measurements rather than copying the six platform
bindings speculatively.

The repository's root `AGENTS.md` records degraded Hyperdrive reliability under
heavy load. Hyperdrive is therefore limited to interactive Cloudflare Worker
query/event traffic. Bulk imports, backfills, reconciliation, and embedding
workers in Cloud Run connect directly to Cloud SQL through the approved Cloud
SQL Auth Proxy/private-IP pattern with their own bounded pool. They must not
route bulk traffic through Hyperdrive.

## 4. Proposed environments

### Development / CI

- Docker Postgres with pgvector installed;
- one local `synapse_knowledge` database;
- dbmate-style corpus migrations in a dedicated directory/package;
- generated Kysely types for corpus schema only;
- test data is ephemeral and reset independently of platform Postgres;
- local R2 adapter may use filesystem or Wrangler R2 persistence but must obey
  the same content-addressed key contract.

### Staging

- dedicated database (preferably dedicated small instance; shared non-prod
  instance acceptable if cost requires it);
- if a shared non-prod instance is used, infra owners must confirm the
  extension-creation path (`cloudsqlsuperuser` per section 3) is available on
  that instance before approval — the fallback is infeasible without it;
- production-equivalent pgvector version and migration path;
- separate R2 bucket, queues and Hyperdrive IDs;
- synthetic/sanitized data only until privacy review.

### Production

- dedicated regional Cloud SQL instance in the same GCP region/VPC pattern as
  Synapse access;
- HA/regional configuration decided by database owners;
- PITR enabled;
- automated backups and retained-backup policy;
- deletion protection;
- connection and query metrics exported;
- dedicated R2 bucket and queue/DLQ resources;
- no public database endpoint beyond the existing approved Cloud
  SQL/Hyperdrive connectivity pattern.

## 5. Database roles and boundaries

### `synapse_migrator`

- owns corpus schema objects, but not instance extensions or roles;
- used only by deployment migration job;
- never receives `cloudsqlsuperuser`;
- never available to the Worker or connectors.

### `synapse_runtime`

- SELECT/INSERT/UPDATE/DELETE on corpus application tables;
- no extension, role, schema or DDL privileges;
- no access to platform database;
- used by Synapse query/ingest/index services through Hyperdrive or direct
  Cloud Run connection.

### `synapse_readonly`

- read-only access for approved operators/analytics;
- sensitive raw payload columns should not be exposed by default views;
- no R2 credentials implied by DB access.

Connectors do not receive DB credentials. They emit validated contract
envelopes to ingestion APIs/queues.

## 6. Migration and package structure

Proposed repository layout after approval:

```text
packages/synapse-corpus/
  context.ts
  kysely-types.gen.d.ts
  migrations/
  schema/
  objects/
  revisions/
  content-units/
  search-documents/
  acl/
  outbox/
  integration/

packages/synapse-corpus-contracts/   # already stack PR 1
services/cfw-synapse/                # live ingress/query/workflow surface
services/synapse-corpus-worker/      # bulk importer/index/reconcile (Cloud Run)
```

Do not add corpus tables to `postgres/migrations/` or `packages/db`.
The corpus package owns its own connection context, migrations, code generation
and real-database integration tests.

Migration rules still mirror platform quality standards:

- UUIDv7 internal primary keys;
- idempotent DDL;
- comments on every table/column;
- lock analysis;
- CHECK/unique/FK constraints where invariants are stable;
- no mock database tests;
- destructive drops split across releases;
- explicit vector-index creation strategy and operational risk notes.

## 7. pgvector/index strategy

Do not choose vector dimension until the retrieval bake-off.

The schema foundation may define embedding profiles first, but the physical
vector table/HNSW index is created only after selecting the first profile.
Postgres vector columns have fixed dimensions; model changes can require a new
table/index.

Recommended shape:

```text
corpus_embedding_profiles
  id, model_id, dimensions, input_template_version, active

corpus_embeddings_<profile>
  search_document_id, embedding vector(N), input_hash, indexed_at
```

Alternatively use one table per dimension, not one nullable column per model.
The corpus query interface hides physical tables behind a profile-aware adapter.

HNSW parameters (`m`, `ef_construction`, query `ef_search`) are benchmarked on
representative corpus size/queries. Do not copy Cerebras values without data.

Index builds/rebuilds must document:

- expected rows and disk/memory;
- duration and write impact;
- whether built before traffic or concurrently;
- rollback/rebuild procedure;
- bloat/vacuum maintenance;
- query plan verification with `EXPLAIN (ANALYZE, BUFFERS)`.

## 8. Backup, recovery and retention

Cloud SQL supports point-in-time recovery by cloning/restoring to a target
instance at a selected timestamp.

Source: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr

Required production policy before ingestion:

- PITR enabled with an approved recovery window;
- daily automated backups or enhanced backup-vault policy;
- retained backups after instance deletion;
- deletion protection;
- quarterly restore drill to a non-production instance;
- documented RPO/RTO;
- R2 versioning/retention aligned with DB revision retention;
- corpus export format sufficient to rebuild Postgres search documents and
  embeddings from raw evidence.

Recommended initial targets for approval:

- RPO: <= 15 minutes (subject to Cloud SQL PITR configuration);
- initial end-to-end RTO target: <= 8 hours, covering PITR clone creation,
  corpus validation, connection-secret rotation, Hyperdrive update/recreation,
  Worker/Cloud Run redeploy, and traffic re-enable;
- tighten the RTO only after a quarterly restore drill measures the full path;
- raw evidence is rebuildable from R2/source where legally retained;
- embeddings/search projections are rebuildable and not backup-critical;
- audit/write-action records have the longest approved retention.

These are proposals, not promises, until infra owners validate cost and Cloud
SQL settings.

## 9. Initial capacity model

The first capacity plan should be measured from actual exports before final
sizing. Collect these inputs:

### Slack

- export ZIP compressed/uncompressed bytes;
- total messages, threads, replies, files and canvases;
- approved/private channel split;
- daily message/update/delete volume;
- estimated thread composites and salient bursts.

### GitHub

- repositories and total indexed bytes/LOC;
- changed files/commits/PRs per day;
- issues/comments/reviews/releases;
- generated/binary/denied percentage;
- expected file-summary and code-symbol units.

### Agents and queries

- active engineers/agents;
- work updates per day;
- PR reviews per day;
- expected MCP/Slack/web queries per day;
- candidate counts and query concurrency.

### Derived estimates

For each source/profile calculate:

- objects;
- revisions/year;
- content units;
- search documents;
- embedding rows;
- normalized text bytes;
- raw R2 bytes;
- float32 vector bytes (`rows * dimensions * 4`, before HNSW/index overhead);
- halfvec/float16 vector bytes (`rows * dimensions * 2`) when profile quality
  and pgvector operator/index support pass the retrieval bake-off;
- GIN/HNSW/index multiplier;
- full embedding tokens/cost/duration;
- daily incremental embedding cost.

Plan instance size and storage only after a representative sample import and
index build. Use at least 2x projected first-year storage headroom and preserve
space for HNSW rebuilds.

## 10. Performance and SLO gates

Before production query traffic:

- live webhook ACK p95 < 3 seconds;
- important live source indexed p95 < 5 minutes;
- ordinary reconciliation freshness target per connector;
- outbox oldest-pending age alert;
- embedding/index failure and DLQ alert;
- retrieval p95 before synthesis target (proposed < 1.5 seconds);
- database CPU/memory/disk/connection alerts;
- FTS and ANN query plans captured at expected row counts;
- index integrity reconciliation (expected embeddings vs actual rows);
- zero ACL leakage in benchmark;
- deletion/ACL-loss propagation deadline defined and tested.

## 11. R2 and queue infrastructure

### R2

Create separate staging/production raw-evidence buckets. Required controls:

- no public access;
- least-privilege service token;
- content-addressed immutable objects;
- encryption mode decided explicitly — R2 default server-side encryption vs
  customer-managed keys (CMK) for the raw-evidence buckets, driven by the §12
  security gates and the legal/retention requirements behind the purge
  workflow below (decision recorded in the §14 checklist);
- lifecycle rules by data classification;
- upload size/MIME/checksum validation;
- Cloudflare account Audit Logs for bucket configuration changes;
- application-layer audit before every raw-object read/write because R2 does
  not provide native per-object request logs;
- explicit purge workflow for legal/retention requirements.

### Queues

Use separate ingestion and indexing queues because their retry/latency/resource
profiles differ. Queue messages carry IDs, never large source bodies.

- ingestion queue: normalize/fetch/revision transaction;
- indexing queue: chunk/embed/search projection;
- DLQ for each;
- transactional outbox is the source of truth for publication/replay;
- queue backlog and oldest age monitored.

Exact resource names, batch sizes and retry counts belong in the implementation
PR after load tests; do not copy review-agent queue settings.

## 12. Security/privacy gates

Before any private-source import:

- canonical human identity authority selected;
- external identity linking/offboarding flow defined;
- initial corpus scopes and source owners approved;
- ACL mirror vs intentionally org-visible container policy explicit;
- private channels, DMs, customer data, incidents and HR/legal sources classified;
- raw retention and deleted-message handling approved;
- `who_knows` disabled pending transparency/opt-out policy;
- query/audit log retention and redaction defined;
- connector service accounts are least privilege;
- no connector has corpus DB/vector/R2 credentials beyond its needed upload API.

## 13. Evaluation gate before physical embeddings

Create a 100-300 question evidence-retrieval set before choosing model or
vector dimension. Compare candidate embedding profiles and lexical-only
baseline on:

- Recall@K, nDCG/MRR;
- exact identifiers/errors/commits;
- paraphrases;
- freshness/supersession;
- source diversity;
- citation quality;
- unanswerable calibration;
- ACL-negative cases (zero leaks);
- p50/p95 latency;
- full/index incremental cost.

The selected model/dimension/profile and HNSW parameters require a committed
baseline report. No production embedding table/index before this gate.

## 14. Approval checklist

Database/infra owners must answer:

- [ ] Dedicated Cloud SQL instance approved (or explicitly approve a temporary shared non-prod exception).
- [ ] Postgres major version chosen.
- [ ] `pgvector` available; extension creation path/role confirmed.
- [ ] Instance region/VPC/connectivity chosen.
- [ ] Migration/runtime/read-only roles and secret ownership chosen.
- [ ] Dedicated Hyperdrive creation/rotation owner chosen.
- [ ] HA, PITR, backups, deletion protection, RPO and RTO approved.
- [ ] Staging and CI pgvector environment chosen.
- [ ] R2 buckets, retention and service access approved.
- [ ] Raw-evidence bucket encryption mode decided (R2 default server-side encryption vs customer-managed keys), consistent with the legal/retention requirements in §11.
- [ ] Queue/outbox resource ownership chosen.
- [ ] Initial capacity-measurement data owner assigned.
- [ ] Monthly embedding/model spend cap and alert threshold approved (sized from the §9 capacity measurement; no ingestion before the cap exists).
- [ ] ACL/identity/retention/evaluation owners assigned.

Only after this checklist is approved should stack PR 3 add corpus migrations,
Kysely storage, pgvector tables, or runtime credentials.
