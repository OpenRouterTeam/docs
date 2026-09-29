# Keep-fresh: label-driven branch updating

Add the **`synapse-keep-updated`** label to an open PR → Synapse resolves
merge conflicts with the base branch as they appear. It acts **only when
GitHub reports the PR conflicted** (`mergeable_state == 'dirty'`);
clean-but-behind PRs are deliberately left untouched. Remove the label → it
stops. Per-PR
opt-in; the policy is deterministic code (`src/uses/keep-fresh/` — labels/guards,
diff3 merge machinery, the Git Data conflict-merge, and the model hunk
resolver each in their own module), the
model only ever fills conflicting hunks under a provenance gate.

All three triggers (and the queue consumer) ride the `synapse-webhook-reviews`
Statsig gate — the service's automatic-activity brake — so flipping that gate
off stops keep-fresh fleet-wide without a deploy; removing the label stops it
per PR.

## Triggers

| Trigger | Latency |
|---|---|
| `pull_request.labeled` webhook (our label) | immediate |
| `push` webhook to any branch | ~10s (scan of labeled PRs based on it) — requires the App's Push event subscription |
| cron `*/15` scan across the `REVIEW_REPOS` allowlist | ≤15 min backstop; no-ops instantly when nothing is labeled/behind |

## Decision ladder (per PR)

1. **Guards** (all fail-closed no-ops): PR open, not draft, label present,
   head is NOT a fork (can't push), actually behind base (`behind_by > 0`).
2. **Conflict-only trigger**: act only when GitHub reports an actual merge
   conflict (`mergeable_state == 'dirty'`). Do NOT merge the base forever
   merely because it moved — clean-but-behind PRs remain untouched (no CI
   churn, no review spend); a conflict is the only base movement that
   blocks the author.
3. **Clean path**: GitHub `update-branch` API — a server-side real git
   merge with exact semantics, tried first even on `dirty` (the reported
   state can be stale and a server-side merge is the cheapest resolution).
   The resulting `synchronize` event is
   consumed via a one-shot Postgres marker → `review.self_update_skipped` — the
   diff vs base didn't change, so no review spend.
4. **Conflict path** (update-branch returns 409/422): build the merge
   ourselves —
   - merge-base via compare API; contested set = files changed on BOTH
     sides since the merge base
   - per contested file: **diff3** (`node-diff3`, false conflicts
     excluded). Non-overlapping regions merge deterministically; each
     overlapping hunk goes to the model resolver with full context
   - **provenance gate**: every non-blank resolver line must literally
     exist on one of the three sides — the model selects/interleaves,
     never authors (violation → unresolvable)
   - merge tree = base-tip tree + resolutions + our-side-only overlays
     (including deletions); commit created with **both parents** (honest
     merge topology); ref updated with `force: false`
   - PR comment discloses model-merged vs deterministically-merged files;
     this push **is** re-reviewed
5. **Bail to human** (comment + `Synapse-merge-conflict` label): lockfiles/
   binaries (regenerate, don't merge), delete/modify conflicts, files
   >300 KB, >6 overlapping hunks per file, >8 contested files per run,
   >40 PR-only overlay files per run (`MAX_OURS_ONLY_FILES_PER_RUN`),
   a base-side rename of a file this PR changed (needs git rename
   detection), resolver not confident (`<<UNRESOLVABLE>>`), or any
   unexpected API state.

## Requirements

- App permission **Contents: Read & write** (403 on update-branch means
  the installation hasn't accepted the write grant).
- Labels exist per repo (`synapse-keep-updated`, `synapse-merge-conflict`) —
  create once via API or UI.

## Bounds

Hunk resolution capped at $0.05/hunk on the review model; one queue message
per trigger; `behind_by == 0` short-circuits before any write. Worst-case
blast radius is a bad merge commit on a PR **head branch** (never base),
reversible with `git reset` to the pre-merge SHA, and surfaced by the
mandatory re-review + CI.
