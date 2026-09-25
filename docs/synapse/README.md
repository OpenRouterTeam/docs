# Synapse Corpus Planning

Planning and design-of-record documents for the Synapse org knowledge corpus: OpenRouter's private, evidence-first organizational memory across Slack, GitHub, Linear, Notion, web/news, and local coding-agent work updates.

## Reading order

1. [`corpus-architecture.md`](./corpus-architecture.md) — **the single normative design**: evidence model, storage topology, ACLs, redaction/purge, ingestion, retrieval, query surfaces, external-write workflows, ownership, and the decision log.
2. [`corpus-pr-stack.md`](./corpus-pr-stack.md) — **the live merge-gate manifest**: every stack layer mapped to its open PR, merge gates with designated approver roles, and the review-driven amendments each layer must apply before merging. This is the operating document for iterating on the stack.
3. [`review-findings.md`](./review-findings.md) — disposition register for the adversarial review of [#32290](https://github.com/OpenRouterTeam/openrouter-web/pull/32290): every confirmed finding and where it was resolved; refuted objections kept for calibration.
4. [`cerebras-knowledge-comparison.md`](./cerebras-knowledge-comparison.md) — historical gap analysis against Cerebras's enterprise knowledge base. Its corrections are folded into the architecture doc; it is superseded where the two disagree.
5. `corpus-infrastructure-rfc.md` — stack layer 2 decision gate for dedicated Cloud SQL, pgvector, Hyperdrive, R2, queues, recovery, capacity, SLOs, and privacy ownership. Lands with [#32301](https://github.com/OpenRouterTeam/openrouter-web/pull/32301).

## Document contract

- `corpus-architecture.md` wins any disagreement between documents. Load-bearing reversals append to its decision log (§19); they do not silently edit prose.
- Wire shapes are normative in `packages/synapse-corpus-contracts` ([#32299](https://github.com/OpenRouterTeam/openrouter-web/pull/32299)); the architecture doc describes invariants.
- A PR that changes a contract, schema shape, or policy updates the architecture doc in the same PR (cross-layer "doc parity" gate).

## Implementation stacks

- **Corpus stack (this plan):** 13 open PRs, [#32299](https://github.com/OpenRouterTeam/openrouter-web/pull/32299) → [#32447](https://github.com/OpenRouterTeam/openrouter-web/pull/32447) — see the manifest's layer table for the full mapping and gate states.
- **Synapse PR-review worker (separate, earlier stack):** [#32266](https://github.com/OpenRouterTeam/openrouter-web/pull/32266) (review-state tables) → [#32272](https://github.com/OpenRouterTeam/openrouter-web/pull/32272) (worker port) → [#32274](https://github.com/OpenRouterTeam/openrouter-web/pull/32274) (deploy wiring). Its small review-state tables live in the platform database; the corpus does not.

The corpus is not Ori Knowledge (a separate product) and is not the deleted Cortex prototype (prior art only — these docs briefly lived under `docs/cortex-port/`, which now redirects here).
