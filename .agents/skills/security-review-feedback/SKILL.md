---
name: security-review-feedback
description: >-
  Weekly report-only sweep of merges to main that look like security fixes or
  hardening, checking each against the security-review and
  security-review-data-trust skills and proposing the concrete class-file or
  triage-table edits that are missing. Never edits either skill. Use for the
  scheduled or on-demand security-review feedback automation.
---

# Security Review Feedback

Sweep merges to `main` since the last fold into the `security-review` skill,
keep the ones that plausibly carry a security lesson, and report the edits the
skill is missing. This run proposes edits. It never applies them and never
opens a PR against the `security-review` skill.

## Candidate scan

```bash
bun .agents/skills/security-review-feedback/scripts/scan-security-merges.ts
```

The scanner reads merged pull requests from the GitHub API through `gh`, so it
needs an authenticated CLI and does not depend on local history depth. It emits
one NDJSON candidate per merge into `main` whose title claims a security outcome
(`tier: 'A'`) or which touched a path the skill already owns (`tier: 'B'`).
Override the window with `--since=<iso timestamp>`, the repository with
`--repo=<owner/name>`, and the swept base branch with `--base=<branch>`.

The default window opens at the most recent `docs(security-review)` commit on
the skill, so no week is skipped when a fold lands off-schedule, and falls back
to seven days when the API returns no fold.

Two fields qualify a candidate rather than select it. `declared: true` means the
author ticked `Security review required: Yes` in the template, so read those
first. `folded: true` means the skill already cites that PR number: report those
as covered and do not re-propose them.

Security words in free body text match almost every large PR, because reviewer
threads and template prompts carry them. Titles, watched paths, and the
declared checkbox are the signals; do not widen matching to body prose.

## Triage

For each unfolded candidate, in order:

1. Read the diff and the PR body (`gh pr diff <pr>`, and
   `gh api repos/<owner>/<name>/pulls/<pr> --jq .body` where agent tooling
   blocks `gh pr view` in favor of a builtin PR viewer). Titles overstate and
   understate. The diff decides.
2. Drop it when the change carries no reusable lesson: a revert, a rename, a
   dependency bump, a test-only or copy change, or a fix whose only lesson is
   specific to one call site.
3. Map it to a class file under
   `.agents/skills/security-review/classes/`. A candidate that maps to no
   existing class is a proposed new class, not a forced fit.
4. Check whether the class file and the owning skill's `SKILL.md` triage table
   already state the rule (access classes in `security-review/SKILL.md`,
   data-flow classes in `security-review-data-trust/SKILL.md`).
   Covered-but-uncited means propose a citation only.
5. Write the proposed edit as the rule a reviewer would apply to a future diff,
   not as a description of this PR.

## Reporting

DM the requester one message: proposed edits first, then covered candidates,
then dropped counts by reason. Include the PR link for every proposal so the
edit can be checked against its diff. Say nothing else when there is nothing to
propose.

Do not apply proposed edits, commit to `.agents/skills/security-review/`, or
open a PR. A human folds accepted proposals in.

## Scripts

The scanner uses Bun and emits newline-delimited JSON. Run it from the
repository root. Keep it and its test in sync with this playbook, and add a
watched path whenever the `security-review` skill takes ownership of a new
surface.
