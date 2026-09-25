# Synapse Corpus — Implementation PR Stack

**Status:** live merge-gate manifest — the whole stack is authored and open; gates govern *merging*, not authoring
**Created:** 2026-08-05
**Updated:** 2026-08-17 — applied decisions D17–D20 (infra gate re-gated to layer 6, calendar gates moved to feature flags, deployment layers required, approver rules), linked the [2026-08-17 verified register](./review-findings-2026-08-17.md); previous update 2026-08-06 (mapped layers to PRs, added amendments from the [#32290 review](./review-findings.md))
**Stack root:** [#32290](https://github.com/OpenRouterTeam/openrouter-web/pull/32290)
**Architecture:** [`corpus-architecture.md`](./corpus-architecture.md)

This is the operating document for iterating on the stack. Each layer below links its open PR, its merge gate, and the **required amendments** that the adversarial review of the architecture imposed on already-authored code. A layer may not merge until its gate is approved *and* its required amendments are applied — or explicitly re-dispositioned through the decision log (§4).

## 1. Locked architecture boundaries

These are defaults for implementation. A later decision may change a boundary through the decision log (`corpus-architecture.md` §19), but individual PRs must not silently choose a different one.

1. **Private internal system:** not Ori Knowledge and not a public product.
2. **Evidence first, with an audited override:** source objects and immutable revisions are canonical; chunks, embeddings, summaries, claims, and actions are derived. The redaction/purge flow (architecture §4.8) is the only sanctioned mutation of evidence.
3. **Dedicated corpus database on a dedicated Cloud SQL instance** before the first production private-source ingest — not the platform `packages/db` database, and not a long-term shared instance. Shared-instance use is limited to temporary non-production evaluation (decision D1, infra RFC).
4. **Initial vector index:** pgvector/HNSW in the corpus database, on the provisional v1 embedding profile (decision D3). The vector interface remains adapter-backed; Vectorize is the first offload option.
5. **Raw evidence:** immutable/content-addressed R2 objects for exports and large source snapshots, encrypted with per-container data keys.
6. **At-least-once ingestion:** transactional Postgres outbox + queues; connectors and indexers are idempotent and replayable; the FOR-UPDATE monotonic stale-event guard (architecture §3.4) is mandatory.
7. **Content-addressed units:** unchanged content never regenerates units, search documents, or embeddings (architecture §4.3; decision D8).
8. **ACLs and relevance scopes are separate:** ACL answers whether a principal may see evidence; a scope answers what is relevant by default. Authorization always evaluates the container's *current* sealed ACL (decision D5). Artifacts carry the intersection ACL of their evidence (decision D6).
9. **One retrieval contract:** MCP, Slack, web chat, PR review, and workflows consume the same cited evidence schema, including supersession state.
10. **No model-owned writes:** models propose typed write intents; policy code (with provenance/taint rules), approval gates, optimistic concurrency, durable workflows, and audit own external changes.
11. **No connector DB access:** connectors emit validated envelopes through a shared SDK; only corpus storage/index services write canonical tables.
12. **Purge is foundational:** the redaction schema and cascade land with the core schema, not in a later phase (decision D7).

## 2. Provisional policies

These unblock foundational work but MUST be resolved before the named merge gate.

| Policy | Provisional default | Must be resolved before |
|---|---|---|
| Human identity authority | Google Workspace or Clerk principal, external identities linked (D11) | query-surface layers (8/9) |
| Visibility | Mirror source ACLs; explicitly configured containers may be org-visible (D10) | first private-source ingest (layer 6) |
| Model-call data policy | All model calls on private content via ZDR-enforced/approved providers (D4) | first private-content embedding (layer 5) |
| Slack live transport | HTTP Events API into Synapse (D9 — decided) | Slack connector layer (6) |
| Raw export retention | encrypted/private R2, per-container data keys; retain until classification/legal review chooses TTL (D12) | first Slack export upload (layer 6) |
| Code indexing | evaluate CocoIndex vs tree-sitter/custom; contract stays implementation-neutral (D13) | code-indexing work in layer 7 |
| Embedding model/dimension | provisional v1 profile decided (D3): `openai/text-embedding-3-small` @ 1536 via `cfw-embeddings-api`; first bake-off is a post-launch comparison | — (deadlock removed; profile seam owns revisions) |
| Linear/Notion automation | all writes require approval; internal-evidence-only auto-writes considered after dry-run (D15) | write workflow layer (11) |
| `who_knows` | disabled until transparency/opt-out policy exists (D14) | expertise retriever/query UI |
| ACL revocation SLO | event-driven propagation under 5 minutes; fail-closed staleness exclusion | first private-source ingest (layer 6) |
| Adoption checkpoints | Phase D needs ≥10 weekly active queriers for 4 weeks; Phase E needs reviewed dry-run (D16). Per D18 these gate runtime ENABLEMENT, not merge | runtime enablement of layers 10/11 (D18) |

## 3. Layers, live PRs, and merge gates

Every layer is already authored as an open PR (GitHub-native stack: each PR targets the branch below it). **Authoring ahead of gates is intentional and sanctioned** — it front-loads review surface; gates control what *merges*. The 11 planned layers became 13 PRs when layer 3 split into 3a/3b/3c; the table is the source of truth, not the old "/11" numbering in PR descriptions.

| Layer | PR | Title | Merge gate | Gate approver |
|---|---|---|---|---|
| 0 | [#32290](https://github.com/OpenRouterTeam/openrouter-web/pull/32290) | architecture + manifest | docs review | corpus owner |
| 1 | [#32299](https://github.com/OpenRouterTeam/openrouter-web/pull/32299) | shared contracts | contracts source-neutral, versioned, queue/MCP/HTTP-safe | corpus owner |
| 2 | [#32301](https://github.com/OpenRouterTeam/openrouter-web/pull/32301) | infrastructure RFC | docs review; RFC reconciled with D3 (bake-off is post-launch), architecture §15 (capacity-model methodology in RFC §9; spend cap approved via RFC §14 before ingestion), and G04 (per-container data-key encryption in the approval surface). Instance approval re-gated to layer 6 per D17 | corpus owner |
| 3a | [#32328](https://github.com/OpenRouterTeam/openrouter-web/pull/32328) | core evidence schema | ACL joins, idempotent revisions, tombstones tested on real corpus Postgres | corpus owner + security review |
| 3b | [#32344](https://github.com/OpenRouterTeam/openrouter-web/pull/32344) | ingestion schema | outbox commit + delivery dedupe tested | corpus owner |
| 3c | [#32350](https://github.com/OpenRouterTeam/openrouter-web/pull/32350) | storage operations | replay creates no duplicates; stale events never overwrite | corpus owner |
| 4 | [#32363](https://github.com/OpenRouterTeam/openrouter-web/pull/32363) | connector runtime | conformance suite passes; connectors have no DB access | corpus owner |
| 5 | [#32370](https://github.com/OpenRouterTeam/openrouter-web/pull/32370) | retrieval + evaluation | zero ACL leaks in the integration suite; launch eval thresholds defined + met on local runs. Latency budgets move to post-deployment validation (D19) | corpus owner |
| 6 | [#32378](https://github.com/OpenRouterTeam/openrouter-web/pull/32378) | Slack ingestion | **human infra approval (D17)**: dedicated instance, pgvector bootstrap, roles, recovery, capacity, cost; approved channel scope + retention; export replay idempotent; deletion→redaction within SLO | infra owner + corpus owner + security review |
| 7 | [#32382](https://github.com/OpenRouterTeam/openrouter-web/pull/32382) | GitHub ingestion + PR context | injection tests pass; a review benchmark is DEFINED. The context-improves-benchmark check moves to post-deployment validation (D19) | corpus owner |
| 8 | [#32387](https://github.com/OpenRouterTeam/openrouter-web/pull/32387) | MCP tools | authenticated identity overrides payload; every hit ACL-checked | corpus owner |
| 9 | [#32407](https://github.com/OpenRouterTeam/openrouter-web/pull/32407) | query UX (Slack bot + web chat) | privacy review of the code + no private-source leakage in the integration suite; product review on the deployed surface moves to post-deployment validation (D19) | corpus owner + security review |
| 10 | [#32430](https://github.com/OpenRouterTeam/openrouter-web/pull/32430) | Linear/Notion/web connectors + synthesis | connector ACL/deletion tests; artifacts always cite evidence; merges DARK — the Phase D adoption checkpoint gates runtime enablement, not merge (D18) | corpus owner |
| 11 | [#32447](https://github.com/OpenRouterTeam/openrouter-web/pull/32447) | external write workflows | taint rule demonstrably blocks injected evidence (red-team tests in-repo); full action traceability; merges DARK — the Phase E dry-run review moves to post-deployment validation and gates runtime enablement, not merge (D18/D19) | corpus owner + security review |
| 12+ | *(unauthored — D19)* | deployment: worker mount + MCP transport, Slack app, provisioning/Terraform | infra + code review; deploys dark behind flags. Merging these layers unblocks the post-deployment validations deferred from layers 5/7/9/10/11 | corpus owner + infra owner |

Merge order is strictly top-down; a PR retargets `main` (or the previous merged layer) when its base lands. No layer merges before every gate above it has been approved.

## 4. Required amendments from the #32290 review

The stack was authored against the pre-review architecture. The following amendments are **merge-blocking** for the named layers. Each maps to a finding in [`review-findings.md`](./review-findings.md).

> **Application audit snapshot, 2026-08-17** ([full register](./review-findings-2026-08-17.md)): at the audited PR heads, most amendments were NOT applied — F7 absent from layers 1/3b/8/9, F3 unapplied in 3a/3b/5, F2 unapplied in 3a/3b/6/10, F5 partial in 6/7, F4 unapplied in 5, F6 absent from 11 — and no PR description carried the §6-required checklist. This snapshot is historical evidence, not the live application status. As each layer changes, update its disposition in the linked register and the layer PR's §6 checklist; remove this snapshot once every listed gap is settled. Before its gate, each layer must either apply its amendments or link an explicit decision-log re-disposition; the 2026-08-17 register's G-findings carry the same obligation.

### Layer 1 — shared contracts ([#32299](https://github.com/OpenRouterTeam/openrouter-web/pull/32299))

- **F7 (supersession):** add `supersessionState` (with reason) to `KnowledgeHitSchema` so layers 8/9 can surface "superseded by X" on hits (architecture §9).

### Layer 3a — core evidence schema ([#32328](https://github.com/OpenRouterTeam/openrouter-web/pull/32328))

- **F3 (content-addressed units):** replace `UNIQUE (revision_id, chunk_profile_id, unit_type, ordinal)` on `corpus_content_units` with content-addressed units — `unique (object_id, chunk_profile_id, unit_type, content_hash)` — plus a `corpus_revision_units(revision_id, unit_id, ordinal, parent_unit_id)` membership table (architecture §4.3). Per the same finding, add `text_blob_id` to `corpus_revisions` for compaction offload (architecture §4.2).
- **F2 (purge):** add the `corpus_redactions` table and the redaction lifecycle states (`redacted` on objects/artifacts) to the foundation schema (architecture §4.8).
- **F1 (artifact ACL):** when the artifact tables land (3a or the synthesis layer, wherever `corpus_artifacts` is created), they must include `acl_container_ids` and the `redacted` status (architecture §4.4).
- **F5 (ACL semantics):** document on the ACL tables that stamped `acl_version_id` is provenance-only; add `acl_synced_at` to `corpus_containers` for the fail-closed staleness rule (architecture §6).

### Layer 3b/3c — ingestion schema + storage ops ([#32344](https://github.com/OpenRouterTeam/openrouter-web/pull/32344) / [#32350](https://github.com/OpenRouterTeam/openrouter-web/pull/32350))

- **F3:** search-document projection must key off content units such that unchanged units keep their search documents across revision advance (no blanket `active=false` flip on revision supersession).
- **F7 (supersession):** add `supersession_state` and `valid_to` to `corpus_search_documents`, with outbox tasks that update it on artifact acceptance/revision supersession (architecture §4.6).
- **F12 (stale guard):** the shipped guard (FOR UPDATE + monotonic `source_updated_at` in `commit-normalized-delivery.ts`) covers the main race — keep it. Extend the staleness comparison to the full §3.4 `(source_version, source_updated_at, observed_at)` tuple (or document the per-connector surrogate ordering), and verify `sourceUpdatedAt` is storage-required for all upserts.
- **F2:** redaction cascade outbox task types (revision text, units, search docs, embeddings, R2 blobs, artifacts, telemetry).

### Layer 5 — retrieval + evaluation ([#32370](https://github.com/OpenRouterTeam/openrouter-web/pull/32370))

- **F3 (embedding dedupe):** the embed worker must check `input_hash` for an existing vector under the same `embedding_profile_id` **before** calling the model, corpus-wide — not merely per-search-document replay idempotency.
- **F4 (filtered ANN):** implement the §9 mechanics — permitted-container-set materialization, `container_id = ANY($permitted)` predicate, `hnsw.iterative_scan = strict_order` with an explicit `max_scan_tuples` budget, oversampling, FTS-only degradation with trace annotation, and the scan-exhaustion metric.
- **F7:** candidate generation and hydration must respect `supersession_state` per query profile.
- **F9 (latency):** deadline-triggered planner/reranker degradation per the §9 budget table; the eval baseline report must include measured p50/p95 per stage.
- **F10 (eval):** downscope to the ~40-question launch set with named owner; the embedding bake-off becomes a post-launch profile comparison. Add restricted-principal recall cases.
- **D3/D4:** wire the v1 embedding profile through `packages/embeddings` / `cfw-embeddings-api`; enforce the model-call data policy once finalized.

### Layer 6 — Slack ingestion ([#32378](https://github.com/OpenRouterTeam/openrouter-web/pull/32378))

- **F2:** Slack message deletion maps to `corpus_redactions` (`reason = source_deletion`) with the full cascade — not a tombstone-only path. Deletion-propagation SLO measured in tests.
- **F5:** implement the ACL revocation event inventory (channel privacy change, member removal) with re-snapshot within the propagation SLO, plus the fail-closed staleness exclusion.
- **F3:** verify unchanged thread messages produce no new units/search documents/embeddings on reply-driven revision advance (this is the hottest churn path).

### Layer 7 — GitHub ingestion ([#32382](https://github.com/OpenRouterTeam/openrouter-web/pull/32382))

- **F5:** repo visibility flips and collaborator removals enter the ACL revocation inventory.
- Injection gate as already specified (untrusted-context delimiters + adversarial tests).

### Layer 8/9 — MCP tools and query UX ([#32387](https://github.com/OpenRouterTeam/openrouter-web/pull/32387) / [#32407](https://github.com/OpenRouterTeam/openrouter-web/pull/32407))

- **F5:** every hit hydration checks the container's *current* ACL; historical revisions require current permission.
- **F7:** surfaces display supersession state ("superseded by X") rather than silently reranking.
- **F11/F19 (adoption analytics):** query analytics from layer 9 feed the Phase D adoption checkpoint.

### Layer 10 — connectors + synthesis ([#32430](https://github.com/OpenRouterTeam/openrouter-web/pull/32430))

- **F1:** artifact creation computes and stores `acl_container_ids`; cross-container artifacts are projected only under the intersection rule; ACL-change and evidence-tombstone/purge re-evaluation tasks exist and are tested.
- **F2:** artifacts citing purged evidence transition to `redacted` and are de-indexed.

### Layer 11 — external writes ([#32447](https://github.com/OpenRouterTeam/openrouter-web/pull/32447))

- **F6 (provenance policy):** extend `evaluatePolicy` beyond `distinctRevisionCount` / `distinctAcceptedArtifactCount` / `hasAcceptedChangeImpactArtifact`: denormalize `authority_class` + `author_trust_tier` of every cited evidence item onto the intent; enforce the provenance floor; hard-block auto-execution on any external-author or public-web evidence (taint rule); flag suspect passages in the approval UI.
- Red-team injection tests in the gate: a malicious issue body/web article inducing a write intent must be blocked.

## 5. Cross-layer acceptance gates

No layer may bypass these:

- **Authorization:** candidate filtering plus hydration-time enforcement of the container's **current** ACL; fail-closed on ACL staleness.
- **Replay:** all event/import/index/write operations have idempotency keys; stale events never advance state (FOR-UPDATE monotonic guard).
- **Deletion:** source deletion/ACL loss produces a tombstone and index removal; sources with mandatory deletion semantics (Slack) route to the redaction cascade; retention/legal purge is a first-class, separately auditable flow reaching every text copy (revisions, units, projections, vectors, R2, artifacts, telemetry).
- **Provenance:** every answer/claim/workflow proposal links exact revisions or content units; write intents carry evidence authority/trust tiers.
- **Versioning:** connectors, envelopes, parsers, chunks, embeddings, artifacts, prompts and policies carry explicit versions.
- **Degradation:** retrieval works without planner/reranker/model synthesis; degradation is deadline-triggered, not just failure-triggered.
- **Evaluation:** no embedding/chunk/ranking change merges without benchmark comparison against the launch set.
- **Observability:** source freshness, queue/outbox lag, indexing integrity and churn, ACL-event lag, deletion/redaction propagation, ANN scan exhaustion, query contribution, and action outcomes are measurable.
- **Cost/SLO:** each layer documents capacity estimates and p50/p95 targets; model spend is capped with alerts.
- **Doc parity:** a PR that changes a contract, schema shape, or policy also updates `corpus-architecture.md` (and the decision log §19) in the same PR. The architecture doc and the code may never disagree at merge time.

## 6. Working agreements for iterating on the stack

- **This manifest is the source of truth** for layer↔PR mapping and gate state. Update the table here when a PR merges, retargets, splits, or a gate is approved — in the same PR that makes the change when possible.
- **Amendments flow top-down.** A design change lands in `corpus-architecture.md` (+ decision log) first, then propagates to the affected layer PRs. Layer PRs never introduce silent design divergence; if implementation experience contradicts the design, amend the design doc explicitly.
- **Normative contracts live in `packages/synapse-corpus-contracts`**; the architecture doc describes invariants. Schema PRs are normative for DDL; the architecture doc describes tables at the level of fields-with-meaning, not column-exact DDL.
- **PR descriptions link back here.** Each layer PR's description names its layer, its gate, and its outstanding required amendments (§4) as a checklist.
- **Gate approvals are recorded** as PR review approvals from the designated approver on the layer PR, referenced in the merge commit. Each approver role (corpus owner, infra owner, security review) must resolve to a specific person before its first gate approval; record the person in the §3 table when resolved. Per D20, when the corpus owner authored the layer PR (currently: all of them), gate approval is a second maintainer's PR review or a linked sign-off issue — never self-approval, and a bot approval does not count as a gate.
- **The stack must not rot.** Restack onto fresh `main` (full `gh stack rebase`, bottom-up) at least weekly while the stack is open and immediately when any layer shows CONFLICTING — a conflict mid-stack blocks mergeability computation and CI dispatch for every layer above it. CI green on a stale base is not merge evidence; re-run after every restack.
- **Docs path migration.** Layers authored before the `docs/cortex-port/` → `docs/synapse/` rename ([#32301](https://github.com/OpenRouterTeam/openrouter-web/pull/32301) and [#32328](https://github.com/OpenRouterTeam/openrouter-web/pull/32328) touch the old path) must move their doc changes to `docs/synapse/` when they rebase onto the merged rename, leaving only the pointer stub under `docs/cortex-port/`.

## 7. Superseded planning notes

The original "Implement PR 1 only" instruction (pre-authoring) is obsolete: the entire stack is authored and open, which was a deliberate choice to front-load review surface. Gates were never authoring permissions — they are merge conditions, now stated as such in §3. The original 11-layer numbering survives in older PR descriptions as "/11"; the §3 table supersedes it.
