# Architecture

Synapse is one standalone Cloudflare Worker with three event types:

- `fetch`: reviewer health/GitHub/manual-review routes, signed `/webhooks/slack`, authenticated `/api/corpus/*` and `/api/memory/*`, and local-only `/__smoke/*`.
- `queue`: review actions, plus separate corpus ingestion, indexing and query consumers.
- `scheduled` (`*/15`): review watchdog/retention, gated model repair, corpus outbox/query recovery, independent privacy/raw-retention and vector-deletion cleanup.

## Review flow

1. Two round entry points, both enqueueing one `review_pr` message:
   - **Webhook** (requires the `synapse-webhook-reviews` Statsig gate):
     verify the GitHub signature, enforce `REVIEW_REPOS`, dedupe
     delivery/head SHA.
   - **Manual** (`POST /api/review`, bearer-authorized via `API_TOKENS`):
     enforce `REVIEW_REPOS`, resolve the named PR against live GitHub, and
     open a round for its current head SHA with `trigger: 'manual'` — the
     only entry point that works while auto reviews are off.
2. Materialize one Postgres run-ledger row per enabled agent and enqueue
   one `agent_review` message per row.
3. Each agent runs one `callModel` loop over the round's workspace — a
   checkout of the PR head on container disk (one Container DO per round,
   `src/connections/workspace/review-container.ts`) with read-only
   shell/history tools — plus `get_diff` and `submit_findings`, its only
   output channel. When the prime or shell probe fails, the round ships
   the API-backed fallback read tools instead; one set or the other, never
   both (`src/uses/review/toolset.ts`).
4. The last finisher wins the monotonic finalize claim in `synapse_pr_state`.
5. The coordinator consolidates worst-of verdicts, applies the unconditional
   advisory-only cap (all GitHub review events are `COMMENT`), diffs finding
   fingerprints, updates one consolidated comment, posts new line comments,
   and resolves addressed threads.
6. `finalized_seq` makes a crashed finalize re-entrant; the watchdog requeues
   complete-but-unfinalized rounds and fails agent rows stuck over 35 minutes.

## Storage

Review state uses the shared Postgres fleet through Hyperdrive and `@openrouter-monorepo/db/synapse/*`:

- `synapse_review_rounds`: roster, status, findings, cost, watchdog payload
- `synapse_pr_state`: finalize claim/completion, consolidated comment, options
- `synapse_line_comments`: finding fingerprint to GitHub thread mapping
- `synapse_seen_deliveries`: webhook dedupe, one-shot markers, TTL locks

`uses/review/round-store.ts` (review's orchestration reads + the FORCE
terminal path) and `connections/db/store.ts` (delivery markers/locks)
delegate to the Kysely query layer. Review state has no D1 — the only D1
binding is the memory feature's `MEMORY_DB` (see "Review memory" below).

## Review memory

Semantic recall/ingest for review rounds (gated by the
`synapse-review-memory` Statsig gate) lives in `src/memory/`, fully
in-process on direct bindings: `MEMORY_DB` (D1, migrations in
`migrations/memory`), `MEMORY_VECTORIZE`, and `AI` (Workers AI
embeddings). Facts are stored verbatim in D1 (FTS5 lexical search);
Vectorize adds dense recall, fused by RRF; the `*/15` cron re-sweeps
facts whose async vector upsert failed. Review state stays in Postgres. See
`src/memory/README.md`.

Facts and pattern admission require an operator-approved exact repository-scope retention policy in addition to the global gate. Memory OFF stops recall/extraction/model repair, not erasure and vector-delete retries.

## Organizational corpus and Slack

`packages/synapse-corpus` owns a separate Postgres evidence/ACL/ingestion/query ledger. `CORPUS_DB` is dedicated and uncached; there is no platform-database fallback. Raw evidence is encrypted under per-container DEKs in `CORPUS_RAW_BUCKET`. Content-free erasure decisions live in the independent `CORPUS_PRIVACY` SQLite Durable Object, outside corpus Postgres backup restoration.

Signed Slack channel events enter a durable metadata-only ingestion queue; mentions and fresh human one-to-one DMs additionally resolve a trusted principal and commit a query execution plus outbox before ACK. Ordinary channel messages and bot messages do not trigger query loops. Consumers fetch and validate full Slack snapshots, pin source versions, seal complete ACLs and index through the decided 1536-dimensional production profile. Incomplete membership fails closed; only a successful full refresh renews the five-minute ACL freshness bound.

Query executions own stable request UUIDs, leases, bounded saved answers, full current/historical source dependencies and private reply destinations. Synthesis has no action tools and rebuilds citations from authorized evidence. Before persistence, source privacy revisions are checked under the corpus fence; before DM output, policy, journal, identity and all source dependencies are reauthorized. Ambiguous sends reconcile the authenticated bot's request marker without blind reposting. Deletion scrubs every dependent copy and preserves unrelated replies; restoring an old database cannot bypass journal replay and cleanup.

The independent `synapse-corpus-ingestion` and `synapse-slack-replies` gates default off. Missing bindings, approval, identity or journal state never enable either surface. Operational provisioning, recovery and the sandbox pilot gates are in `operations.md`.

## Runtime boundaries

- HTTP requests install a request-scoped DB context through Hono middleware.
- Queue and scheduled handlers use `withRpcDbContext`.
- `src/creds.ts` is the only secret reader. `envOf()` retains a whitelist of
  non-secret bindings/vars and that stripped environment is passed to Hono.
- Queue bodies and stored JSON are Zod-validated before use.

## Keep-fresh

The `synapse-keep-updated` label opts a PR into branch updates. Labeled PRs
from the checked-in `REVIEW_REPOS` allowlist are acted on ONLY when GitHub
reports an actual merge conflict (`mergeable_state: dirty`); clean-but-behind
PRs are left untouched (see `docs/features/keep-fresh.md`). Acted-on PRs try
GitHub's update-branch API first. Conflicts use deterministic diff3; the model
may only select/interleave lines already present in base/ours/theirs. Any new
line fails the provenance gate and hands the conflict to a human.

## Module map

```text
src/index.ts              fetch / queue / scheduled + instrumentation
src/env.ts                secret-stripped runtime context + review config
src/creds.ts              GitHub/OpenRouter credentials and host-pinned I/O
src/server/http.ts        health, webhook, manual trigger, local smoke routes
src/protocol.ts           shared events, queue messages, identity keys
src/server/               ingress + routing ONLY: webhook/ (signature +
                          allowlist + per-event handlers), manual trigger,
                          queue dispatch (composes the uses' handler
                          registries), cron scheduler
src/connections/github/   GitHubClient interface + live (Octokit) and fixture
                          impls, auth, membership
src/connections/workspace/ container checkout: ReviewContainer, egress
                          policy, prime sequence, contract
src/connections/db/       shared delivery-marker/lock store
src/tools/                agent-facing tools over connections: generic
                          context, API fallback reads, workspace shell tools
src/harness/              the agent-run lifecycle envelope: lease claim +
                          heartbeat, group budget, salvage, owned terminal
                          CAS over the db run ledger
src/memory/               review memory: verbatim facts in MEMORY_DB D1
                          (FTS5 lexical) + Vectorize dense recall + Workers
                          AI embeddings, fused by RRF; cron re-sweep
src/uses/review/          the PR-review panel: handlers (queue registry),
                          fan-out, run, coordinator, prompt, toolset policy,
                          findings + fingerprint, finalize/ (one module per
                          step), gate, render, memory, responder,
                          options-comment + options-actions, round-store
src/uses/keep-fresh/      branch updating: handlers, labels/guards, github
                          endpoint wrappers, diff3 merge machinery, model
                          hunk resolver, Git Data conflict-merge
```
