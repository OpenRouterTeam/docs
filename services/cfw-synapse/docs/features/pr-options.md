# Interactive PR options

The consolidated comment opens with two task-list checkboxes:

- **Keep up to date** — applies the `synapse-keep-updated` label; the
  existing keep-fresh machinery keeps the branch tracking its base.
- **Merge when ready** — arms GitHub's NATIVE auto-merge (squash).
  GitHub enforces branch protection/checks/approvals and performs the
  merge; Synapse only toggles the setting.

## Flow

```
PR opened → placeholder comment posted in ~1s (options + "review in progress")
          → panel round finalizes into the same comment (options pinned on top)
human clicks a checkbox → issue_comment.edited
  → classify (Bot senders ignored — our own edits fire this event too)
  → editor write-access verified (fail closed)
  → apply: diff desired (comment body) vs applied (Postgres, authoritative)
  → keep_fresh: label add/remove (the labeled webhook drives keep-fresh)
  → auto_merge: enable/disablePullRequestAutoMerge (degrades visibly)
  → persist + canonically re-render ONLY the options block
```

Postgres is the applied-state source of truth; the body is just the input
channel — mangled or deleted blocks self-heal on the next render, and
`desired == applied` edits are no-ops (second loop guard).

## Requirements

- App subscribed to the **Issue comment** event.
- Repo setting **Allow auto-merge** enabled (else the toggle degrades
  with a visible notice and the box unchecks).
- `synapse-keep-updated` label exists in the repo.

## Log events

`options.comment_posted/adopted` · `options.edit_enqueued` ·
`options.applied` · `options.noop` · `options.degraded` (WARN) ·
`options.unauthorized_editor` (WARN)
