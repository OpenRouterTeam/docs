# GitHub connector (PR7) deferrals

## Implemented in this package

- Versioned GitHub connector manifest/config/cursor/snapshot Zod schemas
- Injected `GitHubApiClient` (no Octokit; no secrets beyond `credentialRef`)
- Enumerate/fetch/normalize for repos, PRs, issues, comments/reviews, commits,
  releases, selected code/docs
- Source comparator on authoritative `updatedAt` + content SHA/digest
- Immutable full snapshots; reusable connector conformance harness
- Merged/open PR evidence: title/body/commits/changed files/review threads/
  linked issue IDs/merge SHA
- Code/docs chunking by symbol/heading with exact path/line/SHA citation anchors
- Diff/file size bounds; binary/generated/denied path filtering
- Webhook HMAC verify (WebCrypto), delivery dedupe, freshness timestamp skew,
  event classification — package-local, no secrets retained
- Reconciliation checkpoints watermarked from max snapshot `sourceUpdatedAt`
- ACL mapping from repo visibility + installation scope; private fail-closed;
  unresolved org principals preserve prior sealed ACL via `sealAclSnapshot`
- `buildPrReviewContextPack` consuming PR5 `retrieveKnowledge` (not a second
  search stack); two-pass guideline budget reserve; exact repo/path scope (no
  substring cross-repo leak); untrusted delimiters; injection neutralization;
  AGENTS/REVIEW priority. Specialized/local ripgrep providers deliberately
  removed — they cannot be ACL-hydrated through the corpus.
- Fixtures: opened/sync/merged PR, issue comments, commit diff, review thread,
  guideline files, malicious prompt-injection text
- Unit + integration tests

## Explicitly deferred

| Item | Why | Target |
|---|---|---|
| Raw `fetch` HTTP adapter / Octokit | Connector boundary is injected client; keeps package free of network + Octokit | `services/cfw-synapse` or bulk worker |
| `services/cfw-synapse` webhook route/queue wiring | Service absent on this branch; package-local helpers ready | future worker PR |
| Linear/Notion full ticket hydration in PR pack | Only linked ticket **ids** are in scope; full issue bodies arrive with PR10 connectors | PR10 |
| Specialized/local ripgrep candidate provider in PR pack | Cannot be ACL-hydrated through corpus retrieval; pack is corpus-only | future ACL-aware workspace search |
| Production embedding model selection | Owned by PR5 bake-off gate | PR5 follow-up |
| Merge-impact **derived artifact** synthesis | PR evidence object is source evidence; derived impact claims are synthesis | PR10 / PR11 |
| GitHub App JWT / installation token minting | Secrets stay in Worker `creds.ts` | worker wiring |

## Worker note

`services/cfw-synapse` is not present. Prefer importing
`acceptGitHubWebhookRequest` / `runGitHubReconciliation` /
`buildPrReviewContextPack` from `@openrouter-monorepo/synapse-corpus` when a
Worker is introduced. Keep secrets in `src/creds.ts` only.
