# Memory module

Universal agent memory, fully Cloudflare-native, running in-process inside
the synapse worker on direct bindings (`MEMORY_DB` D1, `MEMORY_VECTORIZE`
Vectorize, `AI` Workers AI). One contract, any memory space:
`repo:openrouterteam/openrouter-web`, `slack:#agents`, `agent:synapse` —
the `scope` string is the only partitioning key.

## Why this design

Benchmarked against Graphiti, Cloudflare Agent Memory, Supermemory, and
several hand-rolled candidates (see `~/synapse-membench/REPORT.md`): LLM
extraction pipelines destroy recall (Graphiti scored worst at 0.603
recall@12), while verbatim fact storage with hybrid lexical+dense retrieval
scored best (RRF hybrid: 0.691 nDCG). Hence:

- **Facts are stored verbatim** — never summarized or LLM-extracted — with
  `date` and `source` provenance.
- **D1 is the consistency-bearing store**: synchronous writes, FTS5 (bm25)
  lexical search, read-after-write.
- **Vectorize is breadth-only**: dense recall via `@cf/baai/bge-m3`
  embeddings (1024-dim cosine), upserted in the background (Vectorize
  indexing itself is async, 5–30 s to queryable). The worker's 15-minute
  cron re-sweeps facts whose upsert failed (`vectorized = 0`).

## API

Two in-process entry points, both taking the worker env (`envOf()`):

### `retainFacts(env, {scope, facts}, {consent?, waitUntil?}?)`

Facts land in D1 synchronously; embedding + Vectorize upsert run via
`waitUntil` when provided, else awaited inline (non-fatal either way).
A fact's optional `topicKey` supersedes all prior live facts sharing
`(scope, topicKey)`. Returns `{retained, superseded, ids}`.

Admission captures the scope's consent generation before asynchronous work. Review callers carry that snapshot through fact shaping and retention; a changed generation refuses the write. Direct generic calls capture current state at entry. A null generation means the scope had no policy, not permission to bypass a managed scope.

Production vectorization runs only in the reviewer queue and scheduled sweeps. Its durable in-flight guards rely on Cloudflare's [15-minute invocation limit](https://developers.cloudflare.com/queues/platform/limits/); an unbounded HTTP, Durable Object, or Workflow caller needs a different lifetime fence.

Supersession removes the old facts' FTS rows and records durable Vectorize deletion work in the same D1 batch. Best-effort immediate cleanup still runs, but a late upsert or a failed rearm cannot discard the pending deletion intent. The deletion sweep waits for live upsert guards before completing that work. Explicit purges adopt existing unowned supersession work and remain sweeping until it completes. The legacy `memory_superseded_sweep` also retries facts still marked `vectorized = 1`; recall filters superseded facts at hydration independently of cleanup.

### `recallFacts(env, {scope, channels, topK?})`

Each channel (`{query, weight}`, up to 8) runs D1 FTS5 (bm25) and Vectorize
in parallel, merged by RRF (k=60); channels fuse by
`weight × 1/(rank+1)`, deduped keeping the best score. Channel failures
degrade to empty rather than failing the recall. Returns
`[{id, content, date, source, score}]` with content capped at 400 chars.

### Scope → Vectorize namespace

Repository scopes are case-insensitive and canonicalized to lowercase by `canonicalMemoryScope`; policy approval, retain, recall, pattern storage and purge all share that identity. Slack and other non-repository scopes remain case-sensitive. D1 stores the canonical scope (up to `MAX_SCOPE_CHARS`). Vectorize namespaces are capped at 64 bytes, so upsert and query derive the namespace from that identity via `scopeToNamespace` (`scope.ts`): verbatim when it fits, otherwise the first 40 chars + `~` + 16 hex chars of SHA-256.

Apply `0006_memory_repository_scopes.sql` through the atomic D1 migration runner before serving canonical-scope operations. Quiesce and drain old-scope writers, including their 15-minute Vectorize execution/lease bound. The migration updates facts, FTS, patterns, policies, purge requests, vector deletion/upsert work and audit scopes without changing IDs, provenance, policy values or lifecycle state. Renamed live facts without an erasure fence become repair candidates; superseded and deletion-fenced facts do not. Vectorize IDs are index-wide and [upserts replace the whole existing vector](https://developers.cloudflare.com/vectorize/reference/client-api/#upsert-vectors), so approved repair reuses the stable fact ID in the canonical namespace. Deletion remains addressable by that same ID.

Case-variant policy rows are not merged, even if their current values agree. `memory_repository_scope_policy_alias_collision` aborts the whole migration before changing existing rows or writer guards; an operator must reconcile the original approvals and retention requirements explicitly before retrying. Do not run its statements individually, discard history to bypass the guard, or enable canonical readers/writers after a failed migration. Distinct legacy pattern IDs survive scope convergence; non-repository scopes and literal source prefixes remain case-sensitive.

## Operations

- **Migrations**: `bunx wrangler d1 migrations apply memory --remote`
  (from `services/cfw-synapse`; `--local` for dev simulators).
- **Resources**: D1 `memory` (`cc303d38-1b38-4739-8f6b-b5f77a684ed6`),
  Vectorize `memory-facts` (1024-dim, cosine), Workers AI `@cf/baai/bge-m3`.
- **Sweeps**: scheduled-tick phases (`src/server/scheduler.ts`):
  `memory_sweep` re-vectorizes failed upserts only while the global review-memory gate is on. `sweepUnvectorized` checks that global gate before reading repair candidates and also requires active per-scope approval, including when called without Worker composition. The candidate query, pre-embedding check and upsert reservation enforce scope consent. Generic direct `vectorizeFacts` callers retain explicit unmanaged behavior; revoked scopes are denied. The
  `memory_superseded_sweep` purges superseded facts from Vectorize +
  `facts_fts` (capped batch per run; each step retryable).
  Operator retention (no default TTL): `approveMemoryRetentionPolicy`,
  `revokeMemoryRetentionPolicy`, `requestMemoryPurge`, `sweepMemoryRetention`, `sweepMemoryPurgeDeletes`
  in `retention.ts`. Main mounts authenticated operator routes and
  independent cron phases. Physical Vectorize deletion stays pending
  after D1 text erasure until `deleteByIds` succeeds.
- **Upsert guards**: apply `0004_memory_vector_upserts.sql` before deploying guard-aware code. Each write reserves a content-free D1 guard after embedding and before the external upsert. Purges remain sweeping while a guard is live, including when the post-upsert read or compensation fails. The guard releases after the write settles; abandoned guards expire on the D1 clock after 15 minutes, and the deletion sweep retries durable pending work. Do not clear guards or deletion ledgers during rollback.
- **Processing consent**: apply `0005_memory_policy_revocation.sql` before deploying revocation-aware code. `revokeMemoryRetentionPolicy(env, {scope, policyRef, revokedBy})` returns a Result with `{scope, revokedAt}`; a missing policy returns an error (the review scope is already unapproved). `POST /api/memory/policy/revoke` accepts only `{scope, policyRef}`, requires the authenticated server operator and `REVIEW_REPOS` authorization, and returns `{policy: {scope, revokedAt}}`. Caller-supplied actors are rejected. Revocation retains the approved TTL and content-free approval/revocation audit; it does not purge facts, FTS, patterns or previously settled vectors. Review retain, recall and pattern admission fail closed afterward. Reapproval permits newly admitted processing of remaining facts, never completion under an older approval; audit history and pending deletion fences survive. Do not roll back to code that infers consent from policy-row existence, or drop revocation state/triggers.
- **Consent generations**: apply `0007_memory_consent_generations.sql` after migrations 0001–0006, with old writers stopped and drained through their 15-minute execution/lease bound. Policy creation and approval/revocation metadata changes rotate a random generation, independent of timestamps. Fact/FTS insertion, pattern insertion/confirmation/pruning, and Vectorize reservation require the captured generation; repair candidates carry their selection-time snapshot. Missing generations are accepted only for unmanaged scopes with no policy. Legacy facts, patterns, policy values and erasure work survive the additive migration. Keep generation-aware code, columns, triggers and cleanup during rollback; old managed writers without a generation are intentionally rejected.
- **Revocation races**: native D1 triggers reject stale fact and pattern writes, rolling back the entire fact/FTS supersession batch even after reapproval. Recall and pattern context require the same active generation before returning. Withdrawal, first approval and approval changes durably fence older live upserts; compensation and physical cleanup wait for their guard release/expiry. Those fact IDs keep their deletion fence and remain lexical-only if still stored. No D1 lock spans external I/O. Already dispatched embedding/upsert calls cannot be cancelled, and no admission check retracts context already handed to a model: this is not synchronous remote-data erasure or a linearizable model-use fence. TTL, supersession cleanup, explicit purge and physical-delete retries remain independent of consent/global enablement.
- **Verbatim-content risk**: review facts retain PR title/author/branch metadata, agent summaries, the first finding line and bounded human decline quotes without secret/PII redaction. The PR body is not directly retained by `shapeRoundFacts`, but may influence summaries/findings and recall queries. Truncation is not redaction. An approved TTL is at most 3650 days, with removal performed by the bounded retryable sweep rather than a synchronous read-time expiry; unmanaged generic scopes have no default TTL. GitHub source deletion does not automatically purge this memory. Explicit purge erases D1/FTS synchronously and durably queues vector deletion; a whole-scope purge also removes patterns, while a source-prefix purge does not. Until that deletion completes, provider-side vectors may remain; the D1 hydration boundary prevents erased facts from returning. Sensitive text can therefore survive a source deletion until operator purge or successful TTL cleanup. Enabling a repository requires accepting that contract or separately defining a source-aware erasure/redaction policy; no regex can promise to remove arbitrary sensitive content.
- **Purge dependencies**: full-scope requests snapshot earlier pending vector work using content-free `vector_delete_required` audit associations. Those associations and `facts_erased` rows are part of the completion fence, not disposable diagnostics; preserve them while any dependent purge is pending. Stable fact IDs follow rearmed work without stealing the original purge owner or including later ingestion.
- **Source-prefix purges**: `sourcePrefix` is a literal, case-sensitive string prefix. ASCII case, Unicode composition and metacharacters (`%`, `_`, `\\`, `*`, `?`, brackets) are not normalized or expanded. This is independent of case-insensitive repository scope identity; facts, FTS and durable vector work use the same exact matching set.
- **Review deadline**: `recallForRound` includes feature-gate and policy lookup in its four-second budget. Pattern admission, detection and the final consent recheck share their original deadline; revoked matches are omitted before returning prompt context. Guidelines and workspace priming proceed independently. A late approval cannot start new recall or pattern work after the deadline.
- **Integration tests**: `bun run test:integration` (vitest +
  `@cloudflare/vitest-pool-workers`, real local D1 from
  `migrations/memory`, Vectorize/AI faked at the binding seam) — see
  `integration/memory/`.
