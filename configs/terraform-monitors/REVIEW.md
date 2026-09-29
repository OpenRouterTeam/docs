# Terraform monitors review notes

Patterns to flag when reviewing a change under `configs/terraform-monitors/`.

## Dashboard authored as HCL widgets

A new or rewritten dashboard using `datadog_dashboard` with `widget` blocks
should become a `datadog_dashboard_json` module backed by `dashboard.json`. HCL
widget blocks cannot round-trip through the Datadog UI and cannot express widget
options the provider does not model. Existing HCL dashboards may stay until they
are next edited.

## No preview link

A dashboard change without a `https://us5.datadoghq.com/dashboard/...` preview
link in the PR description has not been shown to render. Ask for the preview
rather than approving from the JSON.

## Preview evidence that only quotes the source file

Datadog accepts a widget definition and can drop parts of it. Evidence must come
from the applied dashboard read back over the API, including the persisted
queries. A widget expected to read "No data" because the PR also ships its metric
should say so explicitly.

## `query_value` metric query with no aggregator

A metrics query inside a `query_value` request (JSON `queries[]`, HCL `metric_query`) with no `aggregator` is reduced with `avg`, so a count tile shows the per-interval average instead of the total. `bun run check:query-value-aggregators` (part of `bun run lint`) fails on the omission. Still read the value that is set: it must match what the title claims, `sum` for count totals, `avg` for averages and percentile queries, `max`/`min` for peaks, `last` for a current-state gauge. A `sum` on a `p95:` query or an `avg` on an `.as_count()` count is wrong even though the lint accepts it.

## Unbounded group-by

Grouping a widget by a tag whose value space is unbounded (IDs, raw provider
error strings, model-supplied text) makes the widget unreadable and the metric
expensive. Group by the bounded vocabulary the emitting code defines, and check
that the tag values named in the query exist in that code.

## Dashboard layout conventions

- Put the most important cross-cutting stats at the top as single-number
  `query_value` widgets, followed by one `group` widget per logical concern.
  Flag loose widgets between sections.
- Flag panels with more than one graph unless the panel genuinely needs two
  y-axes.
- Use line charts for rates and durations, and bar charts for counts.
- Grouped-by-tag formulas should set `limit.count` to at least 50. A lower
  limit needs a stated reason because the default top-10 hides long tails.
- Flag note panels that read as essays. They should be short descriptive
  sentences: what the metric counts and what an anomaly in it means.
- Flag a charted metric that carries no unit in Datadog metric metadata: the fix is a `datadog_metric_metadata` resource setting its `unit`, not a per-formula unit override. Flag per-formula unit overrides (`number_format.unit`, `custom_unit`, a module formula `unit`) unless the formula itself changes the unit, such as a nanosecond-to-millisecond division.

## Module not wired into the monitoring root

A module directory with no `module` block in `monitoring/` is created by nothing
in production, so it applies only in a preview workspace. Check the wrapper `.tf`
exists and passes `name_prefix` and `preview_mode`.

## Alert with no owner or no action

A monitor whose message names no channel, or whose threshold implies no operator
action, becomes noise. A first-of-its-kind metric belongs on a dashboard until
its baseline is known.

## Paging monitor missing the handle or the priority

A monitor whose message says it pages, or whose PR says it should, needs both `@oncall-engineers` in the message and `priority = 1` or `priority = 2` on the resource that notifies. `bun run check:monitor-paging` catches one without the other. Flag a `@oncall-<other>` handle (only the `Engineers` team has an escalation policy), a priority that disagrees with the severity the message claims, and a `priority` set on a gate or rate constituent instead of the composite that carries the message. See [README.md → Paging the on-call](./README.md#paging-the-on-call).

## P1 or P2 monitor without human sign-off

A PR that adds a `priority = 1` or `priority = 2` monitor, or raises an existing monitor to P1 or P2, must show that the requesting human explicitly agreed the monitor should be able to page someone at any hour within the P1/P2 response window. Flag the PR if its description does not name who agreed and where. An agent-authored PR approved only by the requesting human's general go-ahead does not count. Without the sign-off, ask for `priority = 3` or lower. See [AGENTS.md → Paging the on-call](./AGENTS.md#paging-the-on-call).

## Title does not describe the query

A widget or monitor title must describe the grouping and metric its query
actually uses. Calling a query grouped `by {config}` "by pool", or naming a
resource for a replication leg it does not measure, is a defect.

## Message or note does not match the query

<!-- src: #37010 talos 2026-09-01 -->
<!-- src: #30835 talos 2026-09-01 -->
<!-- src: #40878 jamespsterling 2026-09-15 -->
<!-- src: #42812 charlesrockhead-OR 2026-09-15 -->
<!-- src: #43625 Cybourgeoisie 2026-09-16 -->
<!-- src: #43413 jamespsterling 2026-09-23 -->

Every piece of text that an operator reads must match the query and the code that it describes: the monitor message, the recovery and warning blocks, the file header comment, the dashboard description, and each note panel. When you widen a query, add a cause, or change a threshold, update that text in the same diff.

Flag these kinds of out-of-date text:

- A recovery block that names one column when the query also covers another, which points on-call at the wrong column.
- A cause list that omits a branch that the code emits.
- A value that the code doesn't produce, such as `batch_reconcile` for a message type that the code writes as `reconcile`.
- A recovery condition that ignores the `warning` threshold. The `{{#is_recovery}}` block renders only when the monitor returns to OK, so the block must quote the warning threshold, not the critical threshold.
- A description that uses a term that every panel title has dropped.

## No-op provider fields

Remove configuration that cannot affect the selected Datadog resource rather
than leaving misleading intent in the definition.

## First-seen groups

When a monitor groups by a tag whose values come and go, set
`new_group_delay` so a newly observed group is not alerted on a one-point
window.

## Free text on a HIPAA-covering monitor

A log-derived monitor whose filter does not rule out `service:api-hipaa`, or any
monitor named `[HIPAA]` / tagged `hipaa`, may render identifiers and counts only
([`HIPAA.md`](./HIPAA.md)). Flag `enable_logs_sample` that is not literally
`false`, a `.by()`, `event_query { group_by }` or metric `by {...}` on a
message-like or person-identifying facet (`email`, `ip`, `phone`), a
`{{[@extra.message].name}}`-style variable, anything under `{{log.*}}` /
`{{issue.attributes.error.*}}` other than `.type`, a notification handle outside
Slack, the `cfw-internal` webhooks and `@openrouter.ai` email (including one
glued to a `{{#is_alert}}` tag), and a `query` or `message` that is wholly — or,
for a log query, ahead of the comparison operator — a `var.` / function
expression the lint cannot read.
`bun run check:hipaa-monitor-payloads` reports the exact line. A
`-service:api-hipaa` added to satisfy it needs the ticket inline like any other
exclusion, and a new special case in the lint's facet rule needs a stated reason
rather than a monitor name.

## Unlinked exclusions

Put the Linear issue URL inline next to each exclusion or suppression.
