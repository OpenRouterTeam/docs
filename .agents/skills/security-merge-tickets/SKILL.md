---
name: security-merge-tickets
description: >-
  Pass over pull requests the security owner opened and merged into main, judging
  each on its diff for security significance and filing the Linear SEC artifact
  ticket itself when it qualifies. Files without approval and messages the owner
  only when a run is stuck. Use for the merge-triggered or on-demand security
  artifact automation.
---

# Security Merge Tickets

Every security change that ships wants a SEC ticket behind it, and that ticket
is written after the fact from memory or not at all. This run judges a merge for
security significance and, when it qualifies, files the ticket itself. The
judgment is the run's to make, and filing is the consequence of it, not a
request to file.

## Scope

One pull request per run: opened by the security owner and merged into `main`.
A merge that fails either half is out of scope, including a PR the owner merged
but did not open.

For a catch-up over a window, or when no trigger delivered the merge:

```bash
bun .agents/skills/security-merge-tickets/scripts/list-owner-merges.ts
```

Emits one NDJSON row per in-scope merge. Flags: `--since=<iso timestamp>`,
`--login=<github login>`, `--repo=<owner/name>`, `--base=<branch>`. The window
defaults to the last 26 hours, so successive catch-up runs overlap rather than
gap; the dedupe step absorbs the overlap.

Nothing here decides significance. There is no keyword gate, because the
security work worth an artifact routinely ships under a neutral title.

## Judge

Read the diff and the body (`gh pr diff <pr>`, `gh pr view <pr>`), then answer
one question: does this change what an attacker can do, or what the system
exposes when something goes wrong?

Qualifies:

- A vulnerability fixed, whether or not the title says so.
- A control added, tightened, or moved to fail closed: authentication,
  authorization, tenancy, rate limits, input validation, egress guards.
- A change to secret, token, key, or credential handling.
- A change to what is logged, stored, retained, or returned to a caller.
- A change to trust in outside input or code: model or user content reaching a
  privileged sink, dependency trust, CI and workflow permissions.
- A deliberate risk acceptance, which is an artifact even though nothing was
  fixed.

Does not qualify:

- A refactor, rename, revert, copy, or test-only change with no behavior
  difference at the boundary.
- A dependency bump with no advisory behind it.
- A change whose only security content is the template checkbox.

Judge the diff, not the title. A PR that reverts a security fix qualifies, and
a PR titled `fix(auth)` that only renames a variable does not.

## Dedupe

Search Linear for the PR number and URL before filing. A merge already
covered by a SEC issue is a no-op, not a second ticket. Report it as covered
only if the existing ticket is wrong or incomplete for the change that shipped.

## File

One ticket per qualifying merge, created in the SEC team, assigned to the
security owner, in the project the change belongs to, containing:

- What changed, at the boundary a reviewer cares about.
- What was reachable before the change, stated plainly enough to survive a year
  of forgetting.
- Why it qualified, in one line.
- The PR link, both as a reference in the body and as a link attachment, and the
  class from `.agents/skills/security-review/classes/` if one fits.

Write the ticket the way you would have written the draft, then create it. A
qualifying merge with no ticket at the end of the run is a failed run.

The standing authority is this and nothing wider: create one SEC issue per
qualifying in-scope merge. Editing an existing ticket, closing anything,
writing to GitHub, and writing to the repository all still need the owner.

## Deliver

The ticket is the output. A filed ticket is not a reason to DM the owner, and
neither is a merge that did not qualify.

DM the security owner only when the run needs them: it could not file the
ticket, the merge is covered by an existing ticket that is wrong or incomplete
for what shipped, or the skill itself is missing where the run expected it. One
line, naming the merge and what is stuck.

No message asks for approval, and no run waits on a reply.

## Improve this skill

The judgment bar above is the whole product, and it is only correct until the
owner disagrees with it. Filing without approval raises the cost of a wrong
bar, so record every correction. When a filed ticket is edited or closed as
not worth filing, or a skipped merge is called out as one that should have
qualified, record the correction here as a rule for the next run: a line under
Qualifies, a line under Does not qualify, or a change to the filed fields. One
line per correction, in the language a future run can apply to a diff it has
not seen.
