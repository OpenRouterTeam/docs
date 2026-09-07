# configs/terraform-monitors — agent guide

Terraform for our Datadog monitors, dashboards, and SLOs. Applied by CI, so a
change that only works with your local credentials still has to plan cleanly.

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
- The legacy `custom_unit` field is accepted on `query_value` only, never on
  `timeseries` or `toplist`. Label units on every widget type through the
  formula's `number_format.unit` (type `custom_unit_label`) instead.
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
- Set an explicit unit on every formula (`number_format.unit` with a
  `custom_unit_label`) when the metric has no unit in Datadog metric metadata,
  so panels do not render bare numbers.

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

## Terraform expressions

Never build two different-length widget lists in the arms of a `? :`. Terraform
type-unifies both arms whichever is taken, so a filtered/unfiltered pair fails
`terraform validate` in production mode too. Filter in a `local` with one
`[for ... if ...]` comprehension. Run `terraform validate` and
`terraform plan -var preview_mode=false` (plan only) so the production-mode
expression is exercised as well.

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
