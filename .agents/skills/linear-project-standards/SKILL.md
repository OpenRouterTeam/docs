---
name: linear-project-standards
description: >-
  Normative reference for how the DevEx team organizes Linear — the
  Initiative → Project → Milestone → Issue hierarchy, required fields at
  each level, the minimal label policy (Bug / Blocked / Needs Design),
  status freshness rules, and the DRI model. Read this first whenever a
  task touches Linear structure: grooming a project
  (maintain-linear-project), converting decisions into milestones
  (plan-linear-milestones), or auditing the workspace
  (audit-linear-workspace). Never writes to Linear itself.
user-invocable: true
---

# Linear Project Standards

The contract for what a healthy DevEx Linear board looks like. This skill
is the operational copy of
[RFC: Linear Project Standards & Agent-Maintained Hygiene](https://app.notion.com/p/3a42fd57c4dc81dc833aeac6b5c91832);
the RFC is the decision record. **If you change the standard, change both
in the same PR/session.**

North star: **"top 3 priorities for X" must be answerable from Linear
alone** — X's led projects → their top milestones, in order. No Slack
round-trips ([the thread that motivated this](https://openrouter.slack.com/archives/C0BCDN7RHJM/p1784650509956449)),
no work-planning conversation in PR comments.

## The hierarchy

Agreed model ([source](https://openrouter.slack.com/archives/C0BCDN7RHJM/p1784610088429689)):

| Level | What it is | Owner | Completable? |
|-------|------------|-------|--------------|
| **Initiative** | Top-level company priority; teams map to initiatives loosely, many-to-one | Leadership | No — long-running |
| **Project** | A core surface area or product the team owns (CLI, Server Tools, MCP Server, …) | Project lead = DRI | No — long-lived area |
| **Milestone** | A completable body of work laddering up to exactly one project | Project DRI | Yes — unambiguous done state |
| **Issue** | Tactical task laddering to a milestone, or an isolated action item (e.g. a bug) | Assignee | Yes |

**Litmus test:** projects are *areas* (never "done"); milestones are
*outcomes* (unambiguously done). If a proposed "project" can be finished,
it's a milestone under the surface area it belongs to. If a milestone has
no done state, it's mis-scoped — rewrite it as an outcome.

## Required fields

### Project

- [ ] **Lead set** — the lead IS the DRI for the surface.
- [ ] **≥ 1 initiative** — no orphan projects.
- [ ] **One-line summary** naming what the surface covers.
- [ ] **Status reflects reality** — `In Progress` if actively worked, not
      `Backlog`.
- [ ] **Every in-flight effort has a milestone.**
- [ ] SHOULD have a project status update roughly weekly while active
      (DRI or their agent).

### Milestone

- [ ] **Name is an outcome**, not an area. Good: "API skin compatibility
      tracking". Bad: "API skins misc".
- [ ] **Description**: 1–3 sentences of context, done criteria, and a
      source link (Slack permalink, RFC) when born from a decision.
- [ ] **Ordered by priority** within the project — top milestone = current
      focus. When leadership re-ranks, reorder the same day.
- [ ] Target date only when there's a real commitment.

### Issue

- [ ] **Belongs to a project** (issues sitting in team Triage are exempt
      until triaged).
- [ ] Part of a larger effort → **milestone set**; otherwise it's an
      isolated action item (typically `Bug`).
- [ ] `In Progress` → **has an assignee** and activity within 14 days.
- [ ] Title is an actionable verb phrase.
- [ ] Scope/decision conversation happens **on the issue, not in PR
      comments**. PRs link to issues via the Linear GitHub integration
      (branch names / magic words), keeping review threads about the code.

## Label policy

Canonical team label set — exactly three:

| Label | Meaning |
|-------|---------|
| `Bug` | Defect; may exist without a milestone |
| `Blocked` | Blocked on something external to the assignee |
| `Needs Design` | Requires design input before implementation |

- **Never invent labels ad hoc.** Additions require team-channel agreement
  and an amendment to the RFC + this skill.
- Automation-owned labels (`cve-watch`, Devin playbook labels `!triage` /
  `!plan` / `!implement`, etc.) are exempt — they belong to their playbooks.
  Leave them alone.
- Near-duplicates in the workspace (`Bugs` vs `Bug`, `Good First Ticket`
  vs `Good First Issue`) get *flagged* by `audit-linear-workspace`, never
  auto-consolidated — renames touch other teams' views and need human
  approval.
- DEV also has a `Blocked` **workflow status**. For DEV issues prefer the
  status (visible on the board); treat the label as the cross-team signal.

## Status & freshness rules

DEV workflow statuses: `Triage`, `Backlog`, `Todo`, `In Progress`,
`Blocked`, `In Review`, `Done`, `Duplicate`, `Canceled`.

- **Triage drained weekly** by the DRI or their agent.
- **`In Progress` means active.** Stale = no activity for 14 days →
  flag; move back to `Todo` or ping the assignee (with DRI confirmation).
- **Close promptly** — completed work lingering in `In Review` hides real
  state.

## DRI model

- The Linear project lead is the DRI for that surface area.
- Agents (Perry, Devin, Ori sessions) do the mechanical upkeep; the DRI
  owns the judgment calls: priority order, what gets a milestone, what
  gets cancelled.
- DRIs pull teammates into PR reviews so context disseminates across the
  team — velocity via agents must not create knowledge silos.

## Team registry

| Fact | Value |
|------|-------|
| Team | DevEx, key `DEV` |
| Team channel (Slack) | `C0BCDN7RHJM` |
| Projects list | https://linear.app/openrouter/team/DEV/projects/all |
| Initiatives | https://linear.app/openrouter/initiatives/active |

## Linear MCP gotchas

- `list_projects` with `team: "DevEx"` + `includeMilestones: true` can
  exceed the API complexity limit (observed: 16060 > 10000 max). Query
  the project list plain, then `list_milestones` per project.
- `save_issue` sets assignee via `assignee` (ID, name, email, or "me"),
  not `assigneeId`.
- Milestones are addressed by name or UUID via `get_milestone` /
  `list_milestones` scoped to a project; comments on milestones need the
  UUID (resolve via `list_milestones` first).

## The skill set

| Skill | Kind | Writes to Linear? |
|-------|------|-------------------|
| `linear-project-standards` (this) | Reference / hub | Never |
| [`maintain-linear-project`](../maintain-linear-project/SKILL.md) | Groom one project to standard | Yes — plan confirmed first |
| [`plan-linear-milestones`](../plan-linear-milestones/SKILL.md) | Convert a decision/thread into milestones | Yes — creates milestones + seed issues |
| [`audit-linear-workspace`](../audit-linear-workspace/SKILL.md) | Team-wide weekly sweep | Never — reports only |
