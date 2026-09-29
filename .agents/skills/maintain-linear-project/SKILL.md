---
name: maintain-linear-project
description: Groom one Linear project to the DevEx standard in linear-project-standards, fixing violations with the requester in the loop. Use for "clean up", "groom", "bring up to standard", or recurring DRI upkeep of a Linear project.
user-invocable: true
---

# Maintain Linear Project

Audit one Linear project against
[`linear-project-standards`](../linear-project-standards/SKILL.md) and fix
what's broken. Read that skill first — it is the contract; this skill is
the procedure.

Two modes:

- **Report mode** (default when the requester is not the project DRI, or
  on a scheduled run): produce the violation list + proposed fixes, apply
  nothing.
- **Fix mode**: propose the fix plan, get one confirmation from the
  requester, then apply. Never fix silently.

## Arguments

- `$PROJECT`: project name, ID, or slug (e.g. `Server Tools`). Required.
- `$MODE`: `report` (default) or `fix`.

## Guardrails

- **Never delete** issues, milestones, or projects. The strongest action
  is Cancel, and only with explicit human approval naming the item.
- **Never touch other teams' labels or projects** encountered via
  cross-team links.
- **Never reorder milestones on your own judgment** — priority order is a
  DRI decision. Propose an order; apply it only when confirmed.
- Automation-owned labels and tickets (cve-watch, Devin playbooks) are
  out of scope — leave them exactly as found.
- One confirmation covers one plan. If you discover more mid-flight,
  re-confirm the additions.

## Step 1 — Load project state

1. `get_project` with `includeMilestones: true, includeMembers: true`.
2. `list_milestones` for the project.
3. `list_issues` scoped to the project (paginate; `includeArchived: false`).
4. `get_status_updates` (`type: "project"`) — check freshness of the
   latest update.

Do **not** use `list_projects` with `includeMilestones` across a whole
team — it can blow the API complexity limit (see gotchas in
`linear-project-standards`).

## Step 2 — Run the checklist

Evaluate every item from the standard. For each violation record:
*what*, *where* (URL), *proposed fix*.

### Project-level

| Check | Fix |
|-------|-----|
| Lead set | Propose the obvious DRI (ask if unclear) |
| ≥ 1 initiative | Propose the matching initiative from the active set |
| One-line summary present | Draft one from the project's issues/description; DRI confirms wording |
| Status reflects reality | If issues are actively moving but project is `Backlog` → propose `In Progress` |
| Status update ≤ 14 days while active | Flag; offer to draft one from recent activity for the DRI to approve |

### Milestone-level

| Check | Fix |
|-------|-----|
| Every in-flight effort has a milestone | Cluster unmilestoned non-bug issues by theme; propose milestones (via [`plan-linear-milestones`](../plan-linear-milestones/SKILL.md) shape rules) |
| Names are outcomes | Propose a rename |
| Description has context + done criteria | Draft the missing pieces |
| Completed milestones closed out | If all issues Done, flag for the DRI to mark the milestone done |

### Issue-level

| Check | Fix |
|-------|-----|
| `In Progress` has assignee | Ask DRI who owns it, or propose `Todo` |
| `In Progress` activity within 14 days | Propose `Todo` + comment, or ping assignee — DRI picks |
| Triage empty | List triage items with a one-line disposition proposal each (project+milestone, `Bug`, duplicate, cancel) |
| Non-canonical labels (outside `Bug`/`Blocked`/`Needs Design` + automation set) | Flag only — label changes need team agreement |
| Vague titles ("fix stuff") | Propose an actionable verb-phrase rename |

## Step 3 — Report

Produce a compact report:

```
## <Project> — standards check (<date>)
Passed: N/M checks
### Violations
1. <what> — <url>
   Fix: <proposed action>
...
### Proposed plan (fix mode)
- [ ] action 1
- [ ] action 2
```

In **report mode**: deliver this and stop.

## Step 4 — Fix (fix mode only)

1. Present the plan; get one explicit confirmation.
2. Apply confirmed items via Linear MCP (`save_project`, `save_milestone`,
   `save_issue`, `save_comment`). When moving a stale issue to `Todo`,
   leave a comment naming the reason and this skill.
3. Anything the requester declined or deferred: record as a note in the
   final summary, do not apply.

## Step 5 — Verify & summarize

Re-fetch the project and re-run Step 2 mentally on the changed items;
confirm each applied fix took effect. Summarize: checks passed
before/after, actions applied, items intentionally left, and anything
needing a human decision (label consolidation, cancellations).
