---
name: audit-linear-workspace
description: Read-only weekly sweep of every DevEx Linear project against linear-project-standards, producing one report. Never writes to Linear. Use for "audit Linear", project health questions, or the scheduled hygiene check.
user-invocable: true
---

# Audit Linear Workspace

Sweep the whole DevEx team against
[`linear-project-standards`](../linear-project-standards/SKILL.md)
(read it first) and report. **Strictly read-only** — this skill never
creates, updates, closes, or comments on anything in Linear. Fixes are
the DRIs' (or `maintain-linear-project`'s) job.

## Cadence & delivery

- **Scheduled:** weekly (wire via a Devin Automation whose prompt invokes
  this skill). Post exactly one summary to the DevEx Slack channel
  (`C0BCDN7RHJM`). Leave the automation's `slack_channel_id` unset so the
  platform doesn't mirror session progress into the channel (same rule as
  `image-api-error-triage`) — the one Slack artifact is the report.
- **Manual:** deliver the report to the requester; ask before posting to
  Slack.

## Step 1 — Collect

1. `list_projects` for team DevEx — **plain**, no `includeMilestones`
   (complexity limit; see gotchas in the standards skill).
2. Per project, in sequence: `list_milestones`, `list_issues`
   (paginate), latest `get_status_updates` (`type: "project"`).
3. Team triage: `list_issues` with `state: "Triage"` for team DevEx.
4. `list_issue_labels` for team DevEx (paginate — expect >50).

## Step 2 — Evaluate

Score each project on the standard's checklist:

| Check | Red flag |
|-------|----------|
| Lead set | none |
| ≥ 1 initiative | orphan project |
| Summary present | empty |
| Status honest | `Backlog` with issues actively moving (updatedAt within 14 days) |
| Completed work lingering | project remains `In Review` after all its issues are `Done` |
| ≥ 1 milestone while work is in flight | in-flight issues, zero milestones |
| Milestone shape | area-names, missing done criteria/source links |
| Stale `In Progress` | no activity ≥ 14 days |
| `In Progress` unassigned | any |
| Triage age | items sitting > 7 days |
| Status update freshness | none within 14 days while active |

Workspace-level checks:

- **Label drift**: labels visible to DEV outside the canonical three
  (`Bug`, `Blocked`, `Needs Design`) and the automation-owned set.
  Highlight near-duplicates (`Bugs`/`Bug`, `Good First Ticket`/`Good
  First Issue`) — flag only, consolidation needs human approval.
- **Repeat offenders**: violations also present in the previous report
  (link it) get a ⟳ marker so chronic gaps are visible.

## Step 3 — Report

One compact report, worst projects first:

```
## DevEx Linear audit — <date>
Overall: <n>/<m> projects fully conformant (last week: <n>)

| Project | DRI | Score | Top gaps |
|---------|-----|-------|----------|
| Server Tools | Dennis | 4/7 | no milestones ⟳, stale IP ×2 |
...

### Stale In Progress (>14d)
- <issue link> — <assignee> — last activity <date>

### Triage backlog
- <count> items > 7 days old: <links>

### Label drift
- <label> — <where seen> — nearest canonical: <label>

### Suggested next actions
- <DRI>: run maintain-linear-project on <project> (gaps: …)
```

Every flagged item links directly to the Linear entity. Keep the Slack
version under ~40 lines; overflow goes in a thread reply on the report
message.

## Guardrails

- **No Linear writes.** If asked to fix during an audit, hand off to
  [`maintain-linear-project`](../maintain-linear-project/SKILL.md).
- **No auto-filed tickets** about violations — the report is the
  artifact; DRIs decide what becomes work.
- **Do not commit findings to the repo.** Reports go to Slack / the
  user only (same rule as `audit-slow-db-queries`).
- Read-only applies to Slack history too: reading prior reports for the
  repeat-offender check is fine; the only post is the one summary.
