---
name: plan-linear-milestones
description: >-
  Convert a priority decision — a Slack thread, meeting notes, an RFC, or
  a stated "top 3 priorities" list — into correctly-shaped Linear
  milestones under the right projects, per linear-project-standards. Use
  when asked to "turn this thread into milestones", "get these priorities
  into Linear", or when a leadership re-rank needs to be reflected on the
  board the same day.
user-invocable: true
---

# Plan Linear Milestones

Take a decision source and land it in Linear as milestones (and seed
issues) that satisfy
[`linear-project-standards`](../linear-project-standards/SKILL.md). Read
that skill first.

This is the standing version of what happened in
[Matt's priorities thread](https://openrouter.slack.com/archives/C0BCDN7RHJM/p1784650509956449):
"lets make this a milestone actually… 'API skin compatibility tracking'
under the api skins project" → a milestone with a source link, in the
right project, at the right rank.

## Arguments

- `$SOURCE`: the decision input — Slack permalink, meeting notes, RFC
  link, or an inline priorities list. Required.
- `$OWNER` (optional): whose priorities these are; defaults to whoever is
  named in the source.

## Step 1 — Extract the decisions

Read the source in full (`slack_read_thread` for Slack permalinks — the
channel ID and message ts are in the URL: `/archives/<CHANNEL>/p<ts>` with
a decimal point inserted six digits from the end).

Extract, per work item:

- The outcome being committed to (not the area it belongs to)
- Priority signals — explicit ranks ("swap 2 and 3"), urgency language
  ("actively struggling to land deals"), who set the priority
- Which project (surface area) it belongs to
- Done criteria if stated or inferable
- The permalink to the exact message that decided it

Ignore chatter that isn't a commitment. A "top 3" reply is a commitment;
"I'll look into X someday" is not — list those as skipped.

## Step 2 — Map to projects

1. List the team's projects (plain `list_projects`, no
   `includeMilestones` — complexity limit).
2. Map each extracted item to exactly one project. An item spanning two
   surfaces gets its home where the DRI sits; cross-link the other via
   issue relations later.
3. No matching project? **Do not create one.** Projects are long-lived
   surface areas and creating them is a DRI/leadership call. Flag it and
   ask.

## Step 3 — Shape the milestones

For each item, apply the standard's milestone rules:

- **Name = outcome.** "API skin compatibility tracking", "Terraform
  provider published to registry". Never "Q3 misc" or an area name.
- **Description** (1–3 sentences): context, done criteria, and the source
  permalink. Template:

  ```
  <What and why, one sentence.>
  Done when: <observable end state>.
  Source: <permalink> (<who decided>, <date>)
  ```

- **Rank**: if the source establishes order (a top-3 list, an explicit
  re-rank), the milestone order under each project must match it.
- Check `list_milestones` for the target project first — if an
  equivalent milestone exists, update/re-rank it instead of duplicating.

## Step 4 — Confirm, then write

1. Present the plan: `project → milestone name → rank → description` for
   every item, plus the skipped list. Get one confirmation from the
   requester.
2. Apply via `save_milestone` (create or update; `sortOrder`/reordering
   per the confirmed rank).
3. If the source names concrete first steps, seed 1–3 issues per
   milestone via `save_issue` — actionable verb-phrase titles, project +
   milestone set, assignee only when the source names one. Do not invent
   work to pad a milestone; an empty milestone with clear done criteria
   is fine.

## Step 5 — Close the loop

- Reply where the decision happened (Slack thread, ticket) with links to
  the created/updated milestones, if the requester wants the loop closed
  there.
- Verify: re-fetch each project's milestones and confirm names, order,
  and descriptions match the confirmed plan; every milestone description
  carries its source permalink.

## Anti-patterns

- Creating projects because no surface fits — ask instead.
- Milestones named after areas or people ("Christine's stuff").
- Dropping the source link — future readers must be able to trace why a
  milestone exists.
- Padding milestones with invented issues.
- Writing before the requester confirmed the plan.
