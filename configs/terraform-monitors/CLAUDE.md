# configs/terraform-monitors — agent guide

Terraform for our Datadog monitors, dashboards, and SLOs, run with OpenTofu
(`tofu`, never `terraform`: the lock files pin `registry.opentofu.org`
providers that Terraform ignores). Applied by CI, so a change that only works
with your local credentials still has to plan cleanly.

## Dashboards ship as JSON, not HCL

Author every new dashboard as a `datadog_dashboard_json` resource backed by a
JSON file. Do not add new `datadog_dashboard` HCL widget blocks. JSON is what the
Datadog UI exports and imports, so a reviewer can paste it into Datadog, an
operator can round-trip UI edits back into the repo, and widget options the HCL
provider does not model are still expressible.

A dashboard is its own module directory:

```text
monitoring/<name>/
  main.tf         # required_providers only, no provider block
  variables.tf    # name_prefix, preview_mode
  dashboard.json  # the dashboard, exactly as Datadog returns it
  dashboard.tf    # datadog_dashboard_json wrapping dashboard.json
  outputs.tf      # output "dashboard_url"
monitoring/<name>.tf   # module block wiring it into the monitoring root
```

`dashboard.tf` overlays the preview prefix and tag without duplicating the JSON:

```hcl
locals {
  <name>_dashboard = jsondecode(file("${path.module}/dashboard.json"))
}

resource "datadog_dashboard_json" "<name>" {
  dashboard = jsonencode(merge(local.<name>_dashboard, {
    title = "${var.name_prefix}${local.<name>_dashboard.title}"
    tags  = var.preview_mode ? ["team:preview"] : local.<name>_dashboard.tags
  }))
}
```

JSON details the Datadog API rejects or silently drops:

- `timeseries` and `toplist` requests using `formulas` + `queries` need
  `response_format` (`"timeseries"` for timeseries, `"scalar"` for toplist and
  query values). Omitting it fails apply with "is not valid under any of the
  given schemas".
- Every metrics query inside a `query_value` request needs an explicit `aggregator` (JSON `queries[].aggregator`, HCL `metric_query { aggregator = "..." }`). Datadog persists the widget without one and silently reduces the window with `avg`, so a `sum:...as_count()` count tile shows the per-interval average instead of the total. Pick `sum` for count totals, `avg` for averages, `percentile` for a `p50:`/`p95:` query (`avg` renders it blank), `max`/`min` for peaks, `last` for current-state gauges. The aggregator has to agree with the query's own space aggregation on a distribution metric, so `avg:<dist>` pairs with `avg` and `max:<dist>` with `max`, never crossed. Details and the replay check are in `.agents/skills/preview-datadog-dashboard/SKILL.md`.
- The legacy `custom_unit` field is accepted on `query_value` only, never on
  `timeseries` or `toplist`. Do not use it; units come from metric metadata
  (see Dashboard layout conventions).
- Formula `limit` works on `toplist` but is ignored on `timeseries` — select
  series with `top(query2, <n>, 'sum', 'desc')` in the formula (`top`, not
  `topN`). Functions such as `top`, `cutoff_min`, `default_zero` go in the
  `formula` string referencing query names, never inside a metric `query`. The
  API accepts the in-query form but the UI editor rejects it.
- Tag filters inside `{...}` are comma-separated. A boolean clause such as
  `AND status:5*` persists but breaks the query API.
- Dashboard `tags` must use a `team:` or `ai:` key.
- Group a dashboard by bounded tags. A group-by on a tag whose values are
  unbounded (IDs, error strings) makes the widget unreadable and the metric
  expensive.

## Dashboard layout conventions

- Put the most important cross-cutting stats first as single-number
  `query_value` widgets, then use one `group` widget per logical concern. Do
  not leave loose widgets between sections.
- Use one graph per panel unless the panel genuinely needs two y-axes.
- Use line charts for rates and durations, and bar charts for counts.
- When grouping by tags, set the formula `limit.count` to at least 50. The
  default top-10 hides long tails. Use a lower limit only with a stated reason.
- Keep note panels to short descriptive text in tight sentences: what the metric
  counts and what an anomaly in it means. No essays.
- Units belong to the metric, not the chart. When a metric has no unit in Datadog metric metadata, declare it with a `datadog_metric_metadata` resource (`type` and `unit`, e.g. `millisecond`) next to the dashboard that charts it, as `monitoring/cf_workflows/metrics.tf` does. Do not add per-formula unit overrides (`number_format.unit`, `custom_unit`, or a `unit` field on a module formula input) to paper over a missing metric unit. A formula keeps a unit only when the formula changes the unit, such as `query1 / 1000000` converting nanoseconds to milliseconds.

## Preview a dashboard before asking for review

Every PR that adds or changes a dashboard carries a preview link. Follow
`.agents/skills/preview-datadog-dashboard/SKILL.md`: apply the module from a
local-backend workspace with `DD_API_KEY` / `DD_APP_KEY`, put the resulting
`https://us5.datadoghq.com/dashboard/...` URL in the PR description, and destroy
the preview once the dashboard is reviewed or merged.

Verify the preview through the API rather than trusting the source file, since
Datadog can accept a definition and drop part of it. Read the applied dashboard
back with `GET /api/v1/dashboard/{id}` and confirm the widgets, the layout grid,
and each persisted query. Replay the queries against
`POST /api/v2/query/timeseries` or `POST /api/v2/query/scalar` to tell a
misspelled tag apart from an empty window, and state in the PR when a widget is
expected to read "No data" because its metric ships in the same PR.

## Monitor or dashboard

Default to a dashboard. Add a monitor only when the PR description states all
four of these. If one is missing, ship a dashboard panel instead.

1. **The threshold, and why that number** — from an observed baseline or a
   contractual limit, not a round number.
2. **The action it triggers** — what a human does when it fires. "Investigate"
   is not an action.
3. **The owner** — who responds, and who deletes the monitor when it stops
   earning its channel.
4. **A traffic gate** — a minimum-volume condition, so a few events on an idle
   path cannot alert. See the `api_error_rate` composite pattern.

A new metric has no baseline to set a threshold from, so chart it first and add
the monitor once you have one.

Route a new monitor to a low-signal Slack channel (default
`@slack-OpenRouter-test-slack-messages`) unless the PR author names another, and
promote it once it has proven quiet. See
`.agents/skills/add-datadog-monitor/SKILL.md` for monitor conventions.

Delete a monitor that no longer earns its channel. That needs no justification.

## Paging the on-call

A paging monitor carries `@oncall-engineers` in its message and `priority = 1` or `priority = 2` on the resource; the mechanism, the Engineers team's routing-rule table and the example are in [README.md → Paging the on-call](./README.md#paging-the-on-call). What matters when editing:

- A P1 or P2 needs explicit human sign-off. Under the Engineers P1/SEV-1 and P2/SEV-2 escalation policies in Datadog On-Call, both are covered 24/7: `priority = 1` pages at any hour, including at night, expecting a response within 5 minutes, and `priority = 2` within 15 minutes. Before adding a P1/P2 monitor or raising one to P1/P2, ask the requesting human directly, naming the priority and window, whether it should be able to wake someone up at any hour. Do not infer agreement from a general go-ahead, a PR approval, or silence. Record who agreed and where in the PR description. Without that agreement, ship it at `priority = 3` or lower.
- Both or neither. `scripts/check-monitor-paging.ts` (in `bun run lint`) fails a monitor with only one of them. A Slack-only monitor sets no `priority`.
- Only the monitor that notifies carries the handle and the priority. In a gate-and-rate composite that is the composite; the constituents keep their "does not notify directly" message and no `priority`.
- The priority must match the severity the runbook in the message claims. `priority` 3 to 5 does not page, and no `priority` falls through to the default policy at low urgency.
- Pair the page with the matching high-impact Slack channel (`@slack-OpenRouter-alerts-p2-high-impact` for a P2) and say "pages the engineering on-call" in the alert text.
- The routing rules live in Datadog On-Call, not in this repo. When the README table and a page disagree, re-read the rules there and fix the README.

## Terraform expressions

Never build two different-length widget lists in the arms of a `? :`. Terraform
type-unifies both arms whichever is taken, so a filtered/unfiltered pair fails
`tofu validate` in production mode too. Filter in a `local` with one
`[for ... if ...]` comprehension. Run `tofu validate` and
`tofu plan -var preview_mode=false` (plan only) so the production-mode
expression is exercised as well.

## HIPAA-covering monitors carry identifiers and counts only

No notification destination here is BAA-covered (Slack is not), so a monitor
whose query can match a HIPAA service's telemetry may render identifiers and
counts and nothing else: no `enable_logs_sample`, no free-text or
person-identifying group-by facet (`@extra.message`, `@extra.alert.markdown`,
`@error.message`, `@extra.user_email`, `@extra.client_ip`), no template
variable that quotes the sampled event (`log.*`, `issue.attributes.error.message`,
`issue.attributes.error.stack`). `bun run check:hipaa-monitor-payloads` enforces
it as part of `bun run lint`; the rule, the inventory and the destination
assessment are in [`HIPAA.md`](./HIPAA.md).

A monitor is covering when its name contains `[HIPAA]` or its tags contain
`hipaa`, or when it is log-derived (log alert, error-tracking alert, CI, RUM,
event, audit) and its filter does not rule out `service:api-hipaa`.
`service:api` is an exact match and already rules it out; a monitor with no
service term, a glob like `service:api*`, or a `type` / `query` the lint cannot
read does not. The lint reads literals, locals in the same module directory,
and `for_each = local.<map>` / `var.<flag> ? {} : local.<map>` over a literal
map whose every value is an object literal (one `merge(...)` value leaves the
whole map unexpanded); a `query`, `message` or `escalation_message` that is
wholly some other expression, a log query whose `.by()` chain sits inside
`${...}`, a metric query whose whole selector is one interpolation, or a facet
or handle class that still contains `${...}`, is reported as opaque on a
covering monitor. Declared metric monitors are checked on their `by {...}` tags too, and
handles are read after `{{...}}` tags are rendered away, so
`{{#is_alert}}@slack-...{{/is_alert}}` counts.

The `[HIPAA]` name or `hipaa` tag must itself be readable by the lint — a
literal, a same-module string local, or a literal `for_each` map entry — because
a declaration hidden behind an unresolvable expression is not a declaration.

To satisfy the lint on a monitor that must render free text, add
`-service:api-hipaa` to the filter with a one-line comment naming the ticket;
on a declared `[HIPAA]` monitor, render the identifier instead. Add a second
HIPAA worker to `HIPAA_TELEMETRY_PRODUCERS` in
`scripts/check-hipaa-monitor-payloads.ts`. A `@webhook-` handle is accepted only
when its `datadog_webhook` resource posts to `${var.cfw_internal_url}`; `@team-`,
pager, ticketing and other webhook handles fail assessment. Assess any other
destination class in `HIPAA.md` before teaching `classifyDestination` about it.

## Monitor ownership is not the Datadog `creator`

The `creator` field the Datadog API reports on a monitor is the account
whose API and application keys were authorized for the Terraform sync
that applied it. It is not the monitor's owner and carries no
information about who is responsible for the alert.

Do not route an alert, assign a ticket, or tag anyone in Slack based on
that field. Route to the owner the monitor declares — the responder named
under "Monitor or dashboard" in the PR that added it, or the team that
owns the emitting service. Only when no declared owner survives, fall
back to the git history of the monitor's `.tf` file here and of the
service that emits the metric or log it queries, and say in the thread
that the owner was inferred from authorship.
