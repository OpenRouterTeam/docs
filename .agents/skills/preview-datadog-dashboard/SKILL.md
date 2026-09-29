---
name: preview-datadog-dashboard
description: Preview a Datadog dashboard from Terraform locally without merging — creates a temporary dashboard in DD using a local terraform backend and the DD_API_KEY/DD_APP_KEY secrets.
user-invocable: true
---

# Preview a Datadog Dashboard Locally

The CI `/preview-dashboards` command uses the workflow YAML from `main`, so new or modified dashboards in a PR branch can't be previewed until merged. This skill bypasses that limitation by running OpenTofu locally with a local state backend.

## Prerequisites

- `DD_API_KEY` and `DD_APP_KEY` secrets must be available in the environment
- `tofu` CLI must be installed (v1.12+)

## Step-by-Step

### 1. Identify the dashboard module

Dashboard modules live in `configs/terraform-monitors/monitoring/`. Each module directory contains:
- `main.tf` — provider config
- `variables.tf` — `name_prefix` and `preview_mode` inputs
- `dashboard.tf` — the dashboard resource definition
- `outputs.tf` — exports `dashboard_url`

### 2. Create a temporary tofu workspace

```bash
mkdir -p $HOME/tf-preview
```

Create `$HOME/tf-preview/main.tf` with a local backend, the Datadog provider, and the variables the dashboard module expects. Check the module's `variables.tf` for variables beyond `name_prefix` / `preview_mode` (e.g. `batch_api` also requires `max_instance_count`) and declare each one with a sensible default, or `apply` fails with "input variable ... has not been declared":

```hcl
terraform {
  backend "local" {}
  required_providers {
    datadog = {
      source = "DataDog/datadog"
    }
  }
}

variable "name_prefix" {
  default = "[PREVIEW PR#<NUMBER>] "
}

variable "preview_mode" {
  default = true
}

provider "datadog" {
  api_url  = "https://app.us5.datadoghq.com"
  validate = true
}
```

Use the `app.` host, not `api.`: in a Devin sandbox `https://api.us5.datadoghq.com` is
TLS-intercepted by a locally-generated self-signed cert and answers **every** request —
including `GET /api/v1/validate` — with `202` and an empty body. Terraform reads that as
success and reports `Apply complete! Resources: 1 added` while creating nothing, and
`terraform.tfstate` ends up with zero resources. `https://app.us5.datadoghq.com` (or
`https://us5.datadoghq.com`) serves the same API unintercepted. Sanity-check the host before
apply — `curl -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY"
https://app.us5.datadoghq.com/api/v1/validate` must return `{"valid":true}`; treat any `202`
with an empty body as a stub, never as success.

### 3. Copy the dashboard definition

Copy `dashboard.tf` from the module directory into `$HOME/tf-preview/`. If the module ships its dashboard definition in JSON form, copy `dashboard.json` alongside it so the `file("${path.module}/dashboard.json")` reference still resolves. Do NOT copy `variables.tf` (the variables are already defined in `main.tf` above).

If the module takes more than `name_prefix` / `preview_mode` (e.g. `cfw_service_dashboard` needs `service_name` and `custom_widgets`, and renders `dashboard.json` through `templatefile(...)` with `${service}` placeholders), skip the copy and `source` the module directory by absolute path from the workspace `main.tf` instead (see "Previewing several modules at once"). Copying a templated `dashboard.tf` without its `variables.tf` fails on the undeclared inputs.

```bash
MODULE_DIR=configs/terraform-monitors/monitoring/<module_name>
cp "$MODULE_DIR/dashboard.tf" $HOME/tf-preview/dashboard.tf

# Only for JSON-shipped dashboards; HCL-only modules have no dashboard.json
if [ -f "$MODULE_DIR/dashboard.json" ]; then
  cp "$MODULE_DIR/dashboard.json" $HOME/tf-preview/dashboard.json
fi
```

### 4. Validate template variable syntax

Datadog template variables already include the tag prefix configured by the dashboard. Reference them directly in metric scopes:

```text
# Correct
{$env,$edge_response_status,$edge_response_content_type,$path,$domain}

# Incorrect: duplicates each configured prefix
{env:$env,edge_response_status:$edge_response_status,path:$path,domain:$domain}
```

Hard-coded tag filters still use normal `tag:value` syntax and can be mixed with variables, for example `{$env,path:/api/v1/chat/completions}`.

### 5. Initialize and apply

```bash
cd $HOME/tf-preview
DATADOG_API_KEY="${DD_API_KEY}" DATADOG_APP_KEY="${DD_APP_KEY}" TF_INPUT=false tofu init
DATADOG_API_KEY="${DD_API_KEY}" DATADOG_APP_KEY="${DD_APP_KEY}" TF_INPUT=false tofu apply -auto-approve
```

If `apply` fails, a partial apply may have created resources in Datadog. Clean up immediately:

```bash
DATADOG_API_KEY="${DD_API_KEY}" DATADOG_APP_KEY="${DD_APP_KEY}" TF_INPUT=false tofu destroy -auto-approve
rm -rf $HOME/tf-preview
```

Fix the dashboard definition and retry from step 2.

### 6. Extract the dashboard URL

```bash
DATADOG_API_KEY="${DD_API_KEY}" DATADOG_APP_KEY="${DD_APP_KEY}" \
  tofu state show 'datadog_dashboard.<resource_name>' -no-color \
  | grep '^\s*url\s' | head -1 | sed 's/.*"\(.*\)".*/\1/'
```

The full URL is `https://us5.datadoghq.com` + the extracted path.

For a JSON-shipped dashboard the resource type is `datadog_dashboard_json`, not
`datadog_dashboard`, so use `tofu state show 'datadog_dashboard_json.<resource_name>'`.
Adding an `outputs.tf` with `output "dashboard_url" { value = datadog_dashboard_json.<name>.url }`
is simpler and prints the path straight out of `apply`.

### 7. Share the link

Send the full dashboard URL to the user so they can review it in Datadog.

Devin sessions normally have **no Datadog web UI login** — only `DD_API_KEY` / `DD_APP_KEY`.
The browser is not signed in and there is no Datadog SSO/password secret, so an agent cannot
screenshot the rendered dashboard itself. Creating a shared/public dashboard token
(`POST /api/v1/dashboard/public`) would work technically but **exposes request volumes and error
rates to anyone with the URL — do not do it without explicit human authorisation.** Verify
headlessly instead (see "Verifying a preview without a UI login" below).

### 8. Cleanup

After the user has reviewed the dashboard, destroy it:

```bash
cd $HOME/tf-preview
DATADOG_API_KEY="${DD_API_KEY}" DATADOG_APP_KEY="${DD_APP_KEY}" TF_INPUT=false tofu destroy -auto-approve
rm -rf $HOME/tf-preview
```

If the user merges the PR, the dashboard will be created in production by the CI pipeline — the preview copy should be destroyed to avoid duplicates.

## Verifying a preview without a UI login

Everything a reviewer would eyeball can be asserted through the API:

- **What Datadog actually accepted**: `GET /api/v1/dashboard/{id}` and assert on the returned
  JSON, not on the source file. This is the only way to prove Datadog persisted a widget option
  (markers, units, `slo_id` substitution) rather than silently dropping it.
- **Log facet reachability**: for a production-log facet, use
  `POST /api/v2/logs/analytics/aggregate` with the real log query and a `group_by` on the facet.
  Numeric log computes use `metric` (not `facet`) for the measured field. The MCP log search
  helper cannot provide aggregate counts or grouped numeric sums/averages. The logs analytics
  endpoint is rate-limited to two requests per ten seconds in this workspace, so serialize or
  throttle aggregate calls and retry `429` responses before classifying a query as broken.
  Dashboard-persisted `group_by.sort` objects may omit `type` and be rejected by the replay API
  with `input_validation_error(Field 'aggregation' is invalid: Unrecognized parameter)`.
  Preserve the persisted facet and limit, but omit that sort for replay or add
  `"type": "measure"` to the sort object. HCL `log_query` widgets persist as
  `requests[].log_query.search.query` / `.compute` / `.group_by` (not `search_query`), and a
  persisted `compute.aggregation: "median"` must be replayed as `pc50`; the aggregate API
  rejects `median`. Strip `$template_vars` from the persisted search before replaying.
- **A quoted log-message phrase is not an exact match.** It also matches other log lines
  that share the words. When replaying a log query, group by a facet only the intended line
  sets and check for values the emitting code cannot produce. Anchor the search on such a
  facet (`@extra.<field>:*`) rather than on the message text alone.
- **Widget numbers**: pull `requests[].queries` and `requests[].formulas` verbatim out of the
  returned definition and replay them with an absolute `from`/`to` window. Use
  `POST /api/v2/query/scalar` for scalar and toplist metric requests. Use
  `POST /api/v2/query/timeseries` for persisted timeseries requests, preserving their query
  and formula objects and adding an interval such as `60000`. Replay a `query_value` request with the persisted `aggregator` unchanged. If the persisted query has none, do not paper over it in the replay: that is the bug described under "Scalar aggregation on `query_value` widgets" and the fix belongs in the source file. A card that would render
  blank comes back `null`/`0` here — that is the cheap way to catch the classic "count metric
  mixed with a distribution in one formula" bug.
- **Scalar aggregation on `query_value` widgets**: every metrics query in a `query_value` request must carry an explicit `"aggregator"` (JSON `queries[].aggregator`, HCL `metric_query { aggregator = ... }`). Without it Datadog reduces the window with `avg`, so a `sum:metric{*}.as_count()` tile shows the average per-interval count instead of the total and looks like a small, plausible number. Choose it from what the tile claims to show, never mechanically: `sum` for count totals (`.as_count()`, `as_rate()` inputs to a ratio formula), `avg` for averages, `percentile` for a percentile query (`p50:`/`p95:` with `avg`, `max` or `last` replays and renders as an empty tile, while the same query on a timeseries widget works), `max`/`min` for peaks and troughs, `last` for a current-state gauge such as a queue backlog or the last run's row count. Confirm the choice by replaying the same query twice with `aggregator: "sum"` and `"avg"` over the dashboard window; for a count tile the `sum` result must equal the total of the timeseries replay. Rate metrics submitted through statsd `incr` need `.as_count()` before a `sum` aggregator makes sense. Audit: `rg -n '"type": "query_value"'` for JSON and `query_value_definition` for HCL, then check every `metric_query`/`queries[]` under them has an aggregator.
- **Layout**: rasterize each `layout` `{x,y,width,height}` into 12-column grid cells and assert
  zero double-covered cells and zero uncovered cells inside the bounding box.
  On a tabbed dashboard every tab starts at `y = 0`, so rasterize per tab (the widgets in one
  `tabs[].widget_ids`), not across the whole `widgets` array.
- **Ordered-layout groups**: on an `ordered` dashboard the top-level `group` widgets carry no `layout` at all; rasterize each group's inner `widgets` separately.
- **Template variables in replays**: `POST /api/v2/query/*` does not resolve `$var` scopes and returns an empty result instead of an error, so a persisted query such as `{env:production,$workflow}` reads as "No data". Drop the `$var` tokens from the scope (an empty scope becomes `{*}`) before replaying.
- **Tab membership**: the persisted `tabs[].widget_ids` come back as integer widget ids, not the
  `@N` positional refs the source uses. Map `widgets[i].id` to its index before asserting which
  tab a widget landed in, and check every widget appears in exactly one tab.
- **Data window**: before trusting any expected numbers, confirm the metric actually has points
  in the window. `POST /api/v2/query/timeseries` with `interval: 60000` and check for the first and
  last non-null bucket; new Logpush-derived metrics often only start hours before you test, and
  `GET /api/v1/query` returns an empty `series` array (not an error) for a window with no data.
  `GET /api/v1/search?q=metrics:...` is 403 for these keys, so probe with a query instead.
- **Formula syntax**: run the dashboard verifier's balanced-parenthesis check; Terraform and
  Datadog can persist an unbalanced formula without rejecting it.

## Gotchas that only appear at apply/validate time

- **Datadog rejects `custom_unit` on `timeseries` and `toplist` widgets** with
  `400 Bad Request: Invalid widget definition at position N of type timeseries. $: Additional
  properties are not allowed ('custom_unit' was unexpected)`. It is accepted on `query_value`.
  Set the unit on the metric with `datadog_metric_metadata` instead (`configs/terraform-monitors/AGENTS.md`). The error names the widget
  by index into the (possibly filtered) widget array, so count from the widgets actually sent.
- **Formula `number_format.unit` with a `canonical_unit` (second, millisecond, dollar, …) is
  accepted on `timeseries` widgets** and persists as `{"type":"canonical_unit","unit_name":…}`
  (verified on preview `z4a-rsa-mrh`, provider 4.9.0, `server_tools_usage/dashboard.tf`). Only
  free-text custom units have no timeseries home: put those in the title or a formula alias.
- **Metric tag filters inside `{...}` are comma-separated.** Do not append
  `AND status:5*` or similar clauses inside the braces; Datadog can persist
  those dashboard queries without validating them, but the query API rejects
  them. Replay every persisted query to catch this. The same applies to a per-tag disjunction:
  `{outcome:(skip OR fail),capture_surface:x}` persists but replays as
  `400 Error parsing query: 'AND' and 'OR' cannot be mixed with ','`. Express the exclusion as
  `!outcome:success` or split it into two queries plus a formula. The same goes for
  `{outcome:x,reason IN (a,b)}`: the monitor validate endpoint accepts the `AND reason IN (...)`
  form, but a dashboard widget needs one query per value summed in the formula
  (`monitoring/hipaa_pre_relay_guard/dashboard.json`).
- **Strip template variables before replaying.** A persisted `{env:production,$service}` scope
  replays as zero series on `/api/v2/query/*`, not as an error, so drop `,$service` (or substitute
  the default) in the replay body or every widget looks like "No data".
- **A re-apply can orphan the previous preview.** `tofu state list` in `$HOME/tf-preview`
  can come back empty while the dashboard it created still exists in Datadog, so the next
  `apply` creates a second copy. Check the state list before applying, and delete any dashboard
  the state no longer tracks with `DELETE /api/v1/dashboard/{id}` before sharing a new link.
- **`tofu validate` at `configs/terraform-monitors/` needs `tofu init -backend=false`.**
  A plain `init` tries to reach the R2 S3 backend and fails with "No valid credential sources
  found" in a Devin sandbox. For the production-mode check, run
  `tofu plan -var preview_mode=false` in the `$HOME/tf-preview` workspace instead, which has
  a local backend and already holds the module.
- **A percentile or distribution `query_value` needs an aggregator that matches its query.** `p95:<metric>` needs `"aggregator": "percentile"`, and a distribution queried as `avg:`/`max:` needs the same word as its aggregator. A mismatch is accepted by the API, persisted, and replays as an empty column, so the tile reads "No data" next to a timeseries of the same query that has points. Measured on `openrouter.kv.kv_cache.latency` while previewing `monitoring/private_catalog_kv`.
- **A `query_value` metrics query without `"aggregator"` renders the time-average, not the total.** See "Scalar aggregation on `query_value` widgets" above for the rule and the replay check. Datadog persists and renders the widget without complaint, so only the number tells you.
- **`display_type` on a timeseries request is `line`, not `lines`.** The enum is `area`, `bars`, `adjacent_bars`, `line`, `overlay`; `lines` fails apply with a nested "Invalid inner widget definition" error that names the position inside the group, not the widget title.
- **Cloudflare quantile metrics carry the percentile in the suffix, not as a dotted segment.** `openrouter.cloudflare.workersInvocationsAdaptive.quantiles.memoryUsageBytesP999` exists, `...memoryUsageBytes.p999` does not, and Datadog persists the wrong name and replays it as zero series. Copy metric names from a dashboard that already renders them (`monitoring/cfw_api_perf/dashboard.json`) rather than guessing.
- **Wrap every subtracted log arm in `default_zero(...)`.** A formula like `all - large - multimodal` goes null for any bucket where one arm has no events, so the derived "other" line has holes. Datadog accepts the formula either way, so only the replayed series shows it.
- **A grouped scalar ratio across two log arms keeps groups present in only one arm.** For `(success / (success + errors)) * 100` grouped by provider, `POST /api/v2/query/scalar` treats a group missing from one arm as 0, so a failure-only provider renders `0` and a success-only provider `100`, with or without `default_zero(...)`. When a reviewer claims such groups disappear, answer with a replay that forces one arm empty (`@extra.provider_name:__nonexistent__`) and shows the other arm's group row, rather than restructuring the query (#44689).
- **Dashboard `tags` must use `team:` or `ai:` keys.** `team:preview` and `team:inference` are fine.
- **Never build a filtered and an unfiltered widget list in the two arms of a `? :` conditional.**
  Terraform type-unifies both arms regardless of which is taken, so a 11-element tuple against a
  12-element tuple fails with `Inconsistent conditional result types` at `tofu validate` — in
  *both* variable values, which means production apply is broken too, not just the preview. Build
  the list in a `local` with a single `[for ... if ...]` comprehension that both filters and
  rewrites. Always run `tofu validate` and `tofu plan -var preview_mode=false` (plan only,
  never apply) so you catch the production-mode expression too.
- Resources gated with `count = var.preview_mode ? 0 : 1` are safe to reference as `[0]` only from
  inside an expression that Terraform does not evaluate in preview mode — which a conditional arm
  is *not*.
- **`by {tag}` on a distribution percentile query fails at apply**, not `tofu validate`, with
  `configuration error :: type: disabled_tags :: location: group_by :: metric_name: …` when the
  tag is not in the distribution's percentile tag config (e.g. `framework`/`skin` on
  `openrouter.server_tools.call.duration_ms`). Replay `p50:<metric>{*} by {tag}` via
  `/api/v2/query/timeseries` before adding the group-by; otherwise keep percentile queries ungrouped.
- **Formula `limit` blocks on `timeseries` widgets are silently ignored.** Terraform and the
  Datadog API both accept them, but the widget renders every series anyway. Use a query-level
  `topN(...)` wrapper instead, and verify by replaying the persisted query via
  `/api/v2/query/timeseries` and counting the returned series. (`limit` does work on `toplist`.)
- **Infisical `/services/cfw-api` `DD_API_KEY`/`DD_APP_KEY` are logs-scoped.** `GET /api/v1/validate`
  returns `{"valid":true}` but `POST /api/v1/dashboard` returns `403 Forbidden: Failed permission
  authorization checks`. Those keys cannot create preview dashboards. Write-capable keys are GitHub
  Actions `TF_DATADOG_API_KEY` / `TF_DATADOG_APP_KEY` (not in Infisical). Do not treat Infisical
  validate-success as write access.

- **Modules that also declare `datadog_logs_metric` resources fail the preview apply with
  `403 Forbidden` on those resources** (session keys are dashboard-scoped). The dashboards are
  still created and land in state, so read `tofu output` after the failure and `destroy`
  as usual. Sourcing such a module (e.g. `monitoring/ori`) by absolute path is still the right
  call: it exercises every `.tf` in the module, including generated locals. To skip the 403s
  outright, `tofu apply -target=module.<name>.datadog_dashboard_json.<name>` creates only
  the dashboard (`monitoring/spend_guard`, which also ships `datadog_logs_metric` resources).

- **Divide only series that share a counting unit.** A retry loop makes `*.attempted` count
  RPC dispatches while the outcome counters count admissions, so `fail_open / attempted`
  silently shrinks as retries rise. Replay the numerator and each candidate denominator over
  the same window and pick the one that reconciles (`spend_guard`: `allowed + denied +
  fail_open + fail_closed` matched `reserve.attempted` within 0.01% with retries off, while
  `gated_share{gated:true} - cheap_skipped - entity_limited` was 0.6% high because disarmed
  attempts never dispatch).

- **`.as_rate()` and `.as_count()` are no-ops on gauge metrics.** The CF GraphQL sync metrics
  (`openrouter.cloudflare.*.sum.*`) are per-minute sums stored as gauges, so all three spellings
  replay to the same per-minute value. To chart them per second, divide in the formula
  (`query1 / 60`) and check `GET /api/v1/metrics/<name>` reports `type: gauge` before trusting a
  rate modifier on any metric.

- **A template variable bound to a log facet cannot scope a metric query.** `{$rule}` with
  `prefix: "@breadcrumbs.abuse_rule_names"` persists, but replays as `Rule 'scope_or' didn't
  match at '@breadcrumbs...'` via `/api/v2/query/timeseries`. One variable has one prefix, so
  either declare a second variable with the metric tag prefix or leave metric widgets at `{*}`
  (`monitoring/abuse_rules/dashboard.json`). The reverse works without a second variable: a
  metric-tag variable scopes a log widget through `@facet:$var.value`, which substitutes the
  bare value (`@breadcrumbs.task:$task.value`, `monitoring/cf_cron_task_workflows/dashboard.json`).
  Replay both the `*` default and one concrete value, and confirm the facet's values match the
  metric tag's values (`GET /api/v1/query ... by {tag}` against a logs aggregate `group_by`).

- **Multi-facet `query_table` group-bys multiply.** Three facets at `limit: 50` each replay as
  `Cannot generate more than 10000 groups across all dimensions`; size each facet's limit to its
  real cardinality (e.g. mode 2 × restriction 2 × rule 25) so the product stays under 10000.

- **A `$var` bound to a facet the code has not shipped yet is a risk to every widget it is in.**
  Replaying the literal `@facet:*` expansion of the `*` default returns zero logs when the
  attribute does not exist on any line, so verify the rest of the query with that variable
  dropped, and state the deploy dependency in the PR. Whether the UI drops the clause for `*`
  is unverified from the API.

- **Percentile queries on a `distribution()` metric return empty series** when percentile aggregation is not enabled for that metric in Datadog. Probe with `avg:` before charting percentiles, and fall back to avg/max until percentiles are enabled. Re-probe before a later revision: a header comment saying "no percentiles" goes stale silently (`private_catalog_kv` did), since enabling percentiles is a metric-configuration change that lives outside the dashboard JSON. Track it in the repo with a `datadog_metric_tag_configuration` resource (`include_percentiles = true`) in the dashboard module (`monitoring/classification/metrics.tf`); if the API enabled it first to verify a preview, import it via the root `imports.tf` rather than re-creating — a second copy returns a 409.
- **`IN (...)` and `,` do not mix inside a metric scope.** `{mode IN (off,shadow),source:pg}` fails the query API with "'AND' and 'OR' cannot be mixed with ','". Drop the redundant tag or use separate queries per value.
- **`queries[].name` must match `[A-Za-z0-9_]+`.** The dashboard API persists a name with spaces or parentheses and the widget renders "Invalid query". Keep the human label in the formula `alias`. Replaying every request through `/api/v2/query/*` catches it.

## Previewing several modules at once, including cross-module wiring

When two modules are wired together in the monitoring root (e.g. a wrapper `.tf` passes
`upstream_dashboard_id = module.upstream.dashboard_id` for a header cross-link), do **not** copy the
`dashboard.tf` files. Instead write a workspace `main.tf` whose `module` blocks `source` the real
module directories by absolute path:

```hcl
module "upstream" {
  source       = "/abs/path/configs/terraform-monitors/monitoring/upstream"
  name_prefix  = var.name_prefix
  preview_mode = var.preview_mode
}

module "downstream" {
  source                = "/abs/path/configs/terraform-monitors/monitoring/downstream"
  name_prefix           = var.name_prefix
  preview_mode          = var.preview_mode
  upstream_dashboard_id = module.upstream.dashboard_id
}

output "upstream_dashboard_id" { value = module.upstream.dashboard_id }
```

This exercises the wrapper wiring the root `.tf` files do (a copied `dashboard.tf` would need the
cross-link id hand-faked, which is exactly the thing worth verifying), and it keeps the preview in
sync with the branch instead of a snapshot. The submodules only declare `required_providers`, not a
`provider` block, so the workspace-level `provider "datadog"` applies to both.

After apply, assert the cross-link points at the *preview* dashboard, not prod: pull the header
`note` widget's `content` from `GET /api/v1/dashboard/{downstream_id}` and check it contains
`https://us5.datadoghq.com/dashboard/<applied_upstream_id>` by exact string match, then `GET` that id
and confirm the returned title carries the preview prefix.

## Pulling UI edits on a preview back into dashboard.json

When a reviewer edits the preview in the Datadog UI and asks for the repo to match, do not
hand-port the edits. `GET /api/v1/dashboard/{id}`, drop the instance fields (`id`, `url`,
`author_handle`, `author_name`, `created_at`, `modified_at`, `restricted_roles`, every widget
`id`), restore the unprefixed `title` and production `tags`, and write that as `dashboard.json`.
Datadog also normalizes on save, so a round-trip changes fields nobody edited: template variable
`defaults` becomes `default`, `aggregator` disappears from timeseries queries, a toplist formula
`limit` becomes a request `sort`, `log_stream` becomes `list_stream`, and switching the UI to grid
layout sets `reflow_type: "fixed"` plus a `layout` on every widget. Keep the normalized form.

Prove the file matches with terraform, not by eye. In a local-backend workspace whose `module`
block sources the real module directory, `tofu import module.<name>.datadog_dashboard_json.<name> <id>`
then `tofu plan` must print `No changes.` Import and plan need no write scope. Plan the
previous `dashboard.json` once too and confirm it shows `1 to change`, otherwise the no-diff proves
nothing.

The same import-then-plan proves an HCL `datadog_dashboard` to `datadog_dashboard_json` conversion is
behavior-preserving: import the HCL module's live preview into the JSON resource address and plan.
Expect a first diff on metadata the HCL provider defaulted silently (`notify_list: []`,
`template_variable_presets: []`, `on_right_yaxis: false` on every request); add those to the JSON
rather than accepting a permanent one-line plan.

## Distinguishing "No data" from a broken query without a UI

A widget replay that returns `200` with empty values is ambiguous: the query may be right and the
data absent, or the tag filter may be wrong. Resolve it with a **widened probe** — re-run the same
metric with `{*}` and `by {<the filtered tag>}` over 7 days:

- metric absent entirely → expected-empty, the dashboard is fine.
- metric present but the filtered tag *value* never appears (e.g.
  `p95:openrouter.user_lookup.latency{*} by {source}` returns eight sources, none of them the two
  the widget filters on) → report it as "cannot be proven against live data" and cross-check that
  the tag values exist in the emitting code (`grep` the source enum) before calling it correct.

Also sanity-check ratio KPIs for a misleading-but-arithmetically-correct result: a
`(resolved / (resolved + rejected + error)) * 100` tile reads `0.00%` in red when a feature is
flagged off and all traffic lands on a fourth outcome (`disabled`) that is not in the denominator.
That is a dashboard-interpretation bug worth flagging even though no query errors.

## Concurrent previews

Other open PRs may have live preview dashboards. `tofu destroy` in your workspace only
touches resources in your own state file, but never run `destroy` in a workspace you did not
create, and use a per-PR directory (`$HOME/tf-preview-pr<NUMBER>`) when a session may overlap with
another preview. After cleanup, re-`GET` the other PR's dashboard id to prove it is still intact.

## Notes

- The preview dashboard is tagged `team:preview` (via `preview_mode = true`) so it's easy to find and distinguish from production dashboards
- The local tofu state is stored in `$HOME/tf-preview/terraform.tfstate` — do NOT commit this file
- This approach works for **simple dashboard-only modules** that follow the `{main.tf, variables.tf, dashboard.tf, outputs.tf}` layout (e.g. `client_query_metrics`, `convoy`). Modules with multiple `.tf` files, JSON-shipped dashboards, or non-`dashboard.tf` resource files (e.g. `api_error_rate`, `broadcast_destinations`) require adapting Step 3 so every referenced file is copied into the preview workspace
- The DD_API_KEY/DD_APP_KEY secrets have write access when used via the Datadog provider directly
- The Datadog MCP plugin is **not** read-only: `upsert_datadog_dashboard` can create and update dashboards (verified 2026-08 against us5) with no local keys at all. It has no delete tool, so MCP-created previews must be cleaned up in the Datadog UI. An MCP preview is a hand-translation of the HCL into widget JSON — useful for iterating on layout/queries with live data when no write-scoped keys are available, but it does not validate the Terraform itself; still run `tofu validate` (and this skill's apply flow when keys exist) before merging
- Large MCP previews can be upserted **in chunks**: an `upsert_datadog_dashboard` call replaces the whole widget list, but unchanged widgets can be carried over as bare `{"id": <numeric id>}` entries (ids come from the previous upsert's response) and referenced by numeric id in `tabs.widget_ids`, mixed freely with `"@N"` positional refs to widgets sent in full in the same call. Only widgets whose definition changed need to be re-sent
- **Render order within a tab follows the top-level widget array order, not the `tabs.widget_ids` order.** Listing group A before group B in `widget_ids` does nothing if B precedes A in `widgets` — to reorder groups in a tab, physically reorder the widget declarations (in HCL: move the `widget` block and renumber the `@N` comments/tab refs)
- A module may be missing `main.tf` / `variables.tf` / `outputs.tf` entirely, shipping only `dashboard.json` + `dashboard.tf`. Authoring `main.tf` per step 2 is then mandatory rather than optional, and a module in that state is usually also missing its `module` block in the monitoring root, meaning nothing creates it in production either. Check for the root `module` block before assuming the preview failure is yours
- A module may declare `datadog_monitor` / `datadog_service_level_objective` resources alongside the dashboard. With `preview_mode = true` these should have `count = 0`; confirm after apply that `Resources: 1 added` and that no monitor/SLO was created (`GET /api/v1/monitor/search`, `GET /api/v1/slo`)

## Devin Secrets Needed

- `DD_API_KEY`, `DD_APP_KEY` — sufficient for read and the query APIs. Dashboard create/destroy
  needs write-capable keys: the Infisical `/services/cfw-api` `DD_API_KEY`/`DD_APP_KEY` are
  logs-scoped and 403 on dashboard create (see the gotcha above); write-capable keys are GitHub
  Actions `TF_DATADOG_API_KEY`/`TF_DATADOG_APP_KEY` (not in Infisical). No Datadog UI credential
  exists, and none is needed if you verify via the API.
