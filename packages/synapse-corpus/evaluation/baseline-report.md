# Synapse Corpus PR5 — Retrieval Baseline Report

**Status:** evaluation baseline only  
**Date:** 2026-08-05  
**Dataset:** `synapse-corpus-pr5-baseline`  
**Package:** `@openrouter-monorepo/synapse-corpus`

## Decision

**The v1 production embedding profile is decided (D3): `openai/text-embedding-3-small` @ 1536 via `cfw-embeddings-api`.** This layer ships the evaluation-only deterministic profile; the v1 profile's physical table, embedder client, and `production_active` flip land with the deployment layer that owns runtime credentials.

| Field | Value |
|---|---|
| Decided v1 production profile | `openai/text-embedding-3-small` @ 1536 via `cfw-embeddings-api` (D3) |
| `production_active` in this layer | `false` (registry gate: requires committed `decision_ref`) |
| Evaluation-only profile | `eval_deterministic_d8` |
| Evaluation model id | `deterministic_test_embedder_v1` |
| Evaluation dimensions | `8` |
| Evaluation physical table | `corpus_embeddings_eval_d8` |
| Decision ref for production | committed decision document reference, recorded when the v1 profile is wired |

This report documents the **lexical baseline** and a **deterministic test
embedder** so the retrieval stack, RRF fusion, ACL hydration, and evaluation
harness land without the production ANN wiring. Embedding bake-offs are
**post-launch profile comparisons** against this baseline (D3/F10), not
pre-production gates.

## Baseline configuration

- **Chunk profile:** `raw_v1` (identity projection of content units)
- **Lexical:** Postgres `simple` FTS on `corpus_search_documents.search_vector`
- **Exact:** identifier-aware ILIKE / FTS candidate list
- **Vector:** cosine ANN over `corpus_embeddings_eval_d8` via deterministic
  SHA-256 → 8-d L2-normalized vectors (evaluation only)
- **Freshness/authority:** recency × authority-class prior
- **Fusion:** Reciprocal Rank Fusion (`k=60`) with exact-heavy weights
- **Diversity:** per-object cap 2, per-source cap 4
- **Hydration:** CURRENT object lifecycle + CURRENT sealed container ACL
- **Reranker:** interface present; default path is RRF fallback
- **Neighbor expansion:** same-revision ordinal ±1 with ACL recheck

## Metrics harness

The evaluation runner reports:

- Recall@K
- MRR
- nDCG@K
- citation precision (object-id level)
- ACL-negative pass/fail (zero leaks required)

Fixture cases cover exact identifiers, lexical paraphrase, and an ACL-negative
query. Integration tests assert zero ACL leaks and non-zero lexical baseline
quality on the fixture corpus.

## Post-launch profile comparison (D3/F10)

The v1 profile ships without a pre-production bake-off. After launch:

1. Build a 100–300 question evidence set (architecture § evaluation).
2. Compare candidate embedding profiles against the live v1 profile and this
   lexical + deterministic baseline on Recall@K / MRR / nDCG / citation /
   ACL-negative / latency / cost.
3. Switching profiles requires a committed decision document and a
   `corpus_embedding_profiles.decision_ref` update through the profile seam,
   plus a matching physical `vector(N)` table + HNSW migration.

Retrieval must always degrade gracefully to exact + lexical + freshness when
no vector list is available.
