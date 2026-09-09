---
name: add-datadog-monitor
description: Add a new Datadog monitor via Terraform — covers log alerts, metric alerts, composite api_error_rate pattern, naming conventions, and CI validation
user-invocable: true
---

# Adding a Datadog Monitor via Terraform

Before using this skill, confirm the monitor is warranted at all. The default for
a new metric is a dashboard panel. A monitor requires all four parts of the
monitor bar in `configs/terraform-monitors/AGENTS.md` — the threshold and why
that number, the human action its alert triggers, the owner, and a traffic gate —
stated in the PR description. This skill covers how to write a monitor, not
whether to.

Datadog monitors in this repo are managed exclusively via Terraform. Do NOT use the Datadog API directly — the DD_API_KEY/DD_APP_KEY available in the environment are read-only and will return 403 on write operations.

## Location

All monitor `.tf` files live in:
```text
configs/terraform-monitors/monitoring/
```

## Step-by-Step

1. **Create a new `.tf` file** in `configs/terraform-monitors/monitoring/` with a descriptive snake_case name (e.g., `generation_dlq_insert_failures.tf`).

2. **Define a `datadog_monitor` resource** following one of the two common types:

### Log Alert (for log-based queries)

```hcl
resource "datadog_monitor" "my_monitor_name" {
  name = "${var.name_prefix}[Service] Monitor Description"
  type = "log alert"
  tags = ["alerts-<channel>", "terraform", "<service-tag>"]

  query = <<EOT
logs("\"exact log message\" @attribute:value").index("*").rollup("count").last("1h") > 5
EOT

  message = <<EOT
@slack-OpenRouter-<channel>

{{#is_alert}}
Description of the alert condition.

[View logs](https://us5.datadoghq.com/logs?query=<url-encoded-query>&live=true)
{{/is_alert}}

{{#is_recovery}}
Condition has recovered.
{{/is_recovery}}
EOT

  groupby_simple_monitor   = true
  include_tags             = false
  notify_no_data           = false
  notification_preset_name = "hide_all"
  require_full_window      = false

  monitor_thresholds {
    critical = 5
  }
}
```

### Metric / Query Alert (for metric-based queries)

```hcl
resource "datadog_monitor" "my_monitor_name" {
  name = "${var.name_prefix}[Service] Monitor Description"
  type = "query alert"
  tags = ["alerts-<channel>", "terraform", "<service-tag>"]

  query = <<-EOT
    min(last_15m):sum:metric.name{*}.rollup(sum, 300) > 5
  EOT

  message = <<-EOT
    @slack-OpenRouter-<channel>

    {{#is_alert}}
    Alert description with context.
    {{/is_alert}}

    {{#is_recovery}}
    Condition has recovered.
    {{/is_recovery}}
  EOT

  monitor_thresholds {
    critical = 5
  }

  on_missing_data          = "default"
  require_full_window      = false
  include_tags             = false
  notification_preset_name = "hide_all"
}
```

Set the rollup interval explicitly to the window the threshold was calibrated
on. `min(last_30m)` without `.rollup(...)` compares the metric's native points
(60s), so one dip clears a sustained breach — a threshold picked from 15-minute
percentile windows needs `.rollup(avg, 900)`. Both forms validate 200 against
`/api/v1/monitor/validate`, so replay the query over a known incident with
`GET /api/v1/query` and check `interval` in the response.

### Log-Based Metric + Query Alert (for high-volume log counting)

When you need to count logs via a custom metric (more efficient for high-volume):

```hcl
resource "datadog_logs_metric" "my_log_count" {
  name = "my_service.log.count"

  compute {
    aggregation_type = "count"
  }

  filter {
    query = "\"LOG_PATTERN\""
  }
}

resource "datadog_monitor" "my_log_spike" {
  name  = "My Log Spike Detected"
  type  = "query alert"
  tags  = ["alerts-api", "terraform"]
  query = "min(last_30m):sum:my_service.log.count{*}.rollup(sum, 300) > 1000"
  # ... rest of monitor config
}
```

### API Error Rate Monitors (composite pattern)

For monitoring error rates on API routes, use the existing `api_error_rate` module rather than creating standalone monitors. This module creates a 3-monitor composite pattern per route:

1. **Traffic monitor** — gates alerts on minimum request volume
2. **Error rate monitor** — calculates error percentage
3. **Composite monitor** — fires only when both traffic is sufficient AND error rate exceeds threshold

To add a new route or error monitor, edit `configs/terraform-monitors/monitoring/api_error_rate.tf` and add entries to the `route_groups` list. No new files or modules needed.

#### Adding a route group with error monitors

```hcl
# In api_error_rate.tf, add to the route_groups list:
{
  name          = "my-service"           # unique group identifier
  display_name  = "My Service API"       # dashboard title
  slack_channel = "alerts-enterprise"    # optional, default "alerts-api"

  routes = [
    {
      method       = "GET"
      path         = "/api/v1/my-resource"
      display_name = "List Resources"     # optional, for dashboard labels
      min_requests = 100                  # optional, default 50 — minimum traffic to gate alerts

      error_monitors = [                  # optional — routes without monitors still appear on dashboards
        {
          name              = "5xx"
          include_status    = "5*"        # wildcard supported (e.g., "5*", "4*", "401")
          exclude_status    = ["503"]     # optional, default [] — exclude specific codes
          threshold_percent = 10          # optional, default 15 — error rate % to trigger alert
          is_warning        = false       # optional, default false — true = warning-only (no critical)
          here_mention      = true        # optional, default false — true = <!here> in Slack
        },
        {
          name              = "401 Outage"
          include_status    = "401"
          threshold_percent = 100
        }
      ]
    },
    {
      method       = "POST"
      path         = "/api/v1/my-resource"
      display_name = "Create Resource"
      # No error_monitors — route still appears on the group dashboard
    }
  ]
}
```

#### Key details

- **`include_status`** supports wildcards: `"5*"` matches all 5xx, `"4*"` all 4xx, or use exact codes like `"401"`
- **`exclude_status`** is a list of codes to exclude from the match (e.g., `["503"]` to ignore 503s from a 5xx monitor)
- **`min_requests`** (default 50) prevents noisy alerts on low-traffic routes — the composite only fires when the traffic monitor confirms enough requests in the evaluation window (`last_30m` by default)
- **`is_warning = true`** makes the monitor warning-only (sets critical to 100% so it effectively never fires as critical, and uses warning at your threshold)
- Routes without `error_monitors` still appear on the auto-generated group dashboard for visibility
- Each group gets its own "API Status: {display_name}" dashboard automatically
- The module is in `configs/terraform-monitors/monitoring/api_error_rate/` — don't modify the module internals, just add entries to the `route_groups` variable in `api_error_rate.tf`

#### API metric and path verification

- Composite queries use `openrouter.api.latency`, emitted per request by `timingMiddleware` (`packages/cloudflare/timing.ts`); apply it to every monitored route sub-app.
- Use the exact Hono route template from `c.req.routePath`, not a concrete path (for example, `/api/v1/internal/skills/:id`).
- Datadog lowercases tag values, so write camelCase parameters in Terraform lowercased (`:endpointId` becomes `:endpointid`).
- Before merge, verify one real request in Metric Explorer with `count:openrouter.api.latency{path:<route>} by {path,method}`.

### Synthetic HTTP Checks (external probes)

For a public URL that must stay up regardless of Worker metrics, use `datadog_synthetics_test` (`type = "api"`, `subtype = "http"`) following `public_api_route_coverage.tf` / `docs_site_availability.tf`: skip it in preview mode, assert status + content-type + a body fragment, and set `min_location_failed` with 2+ locations so one region cannot page. `follow_redirects` belongs in `options_list`, not `request_definition` — `terraform validate` rejects it there. `retry.interval` is milliseconds (max 5000), so retries cannot ride out an outage; rely on locations for that. An active probe has no traffic gate; say so in the PR's monitor bar.

### Monitors Referenced by Composite Monitors

When a monitor's ID is used in a composite monitor's query, add a `lifecycle` block with `create_before_destroy = true`:

```hcl
resource "datadog_monitor" "my_rate_monitor" {
  # ... monitor config ...

  lifecycle {
    create_before_destroy = true
  }
}
```

**Why:** Changing a monitor's `type` (e.g., query alert → log alert) forces Terraform to destroy and recreate the resource. Datadog blocks deletion while any composite monitor still references the old ID, causing:

```
Error: error deleting monitor 12345: 400 Bad Request:
monitor is referenced in composite monitors: [67890]
```

`create_before_destroy` creates the replacement first, lets Terraform update the composite's reference to the new ID, then tears down the old monitor.

### Distinct-Customer Share Gates

For a customer-impact gate using a metric tagged by entity, group the numerator and denominator by `{entity_id}` and wrap each query with `count_nonzero()` before dividing. This collapses both sides to one series and avoids tag-join issues. Use `on_missing_data = "resolve"` while the denominator metric is being rolled out so the gate stays quiet without data, and add `create_before_destroy = true` when a composite references the gate.

### Grouped Ratio Tradeoffs

Grouped ratios with `by {…}` on both sides cannot carry an absolute traffic gate like the composite pattern; near-zero-traffic groups can move the ratio on a handful of events. `POST /api/v1/monitor/validate` accepts this shape, so document the tradeoff.

For ungrouped composite ratios, check the minimum event count implied by the traffic floor and percentage threshold. If `min_requests * threshold_percent / 100` is below the intended absolute signal, add a numerator count gate to the composite so one event cannot alert during a traffic collapse.

### Recovery Thresholds on Gate and Rate Composites

A composite of a traffic gate and a rate monitor re-notifies on every crossing of either line, so one incident becomes a stream of warning and recovery messages. Give each sub-monitor a recovery threshold on the non-alerting side of its own trigger, one for each threshold it declares:

- Rate monitor (`> threshold`): set `critical_recovery`, and set `warning_recovery` when the monitor also declares a warning threshold. Both sit below their triggers but above the metric's normal p90, so routine noise cannot clear the state.
- Traffic gate (`>= min_events`): set only `critical_recovery`, below the count trigger and derived from normal traffic volume rather than the rate baseline.

Size the window to the length of an episode rather than a minute, so a dip in the middle of an episode does not resolve the alert. `terraform validate` does not check recovery thresholds, but `POST /api/v1/monitor/validate` does.

## Key Conventions

### Monitor Name
- Always prefix with `${var.name_prefix}` to support preview deployments
- Use format: `[Service/Category] Description` (e.g., `[Usage Record] Dead Letter Queue - Generation Batch Insert Failures`)

### Slack Notification Channels
A monitor for a brand-new feature starts in a low-signal channel: default `@slack-OpenRouter-test-slack-messages` unless the PR author names another, and promote it once it has proven it is not noisy. Use `@slack-OpenRouter-<channel>` or `@slack-<channel>` format. Common channels in use:
- `@slack-OpenRouter-alerts-api` — most common, general API alerts
- `@slack-OpenRouter-alerts-providers` — provider-specific issues
- `@slack-OpenRouter-alerts-providers-low-signal` — noisy provider alerts
- `@slack-OpenRouter-alerts-frontend` — frontend errors
- `@slack-OpenRouter-alerts-enterprise` — enterprise features
- `@slack-OpenRouter-alerts-platform` — platform performance/stability, including database alerts
- `@slack-OpenRouter-proj-guardrails` — guardrails subsystem alerts
- `@slack-alerts-api` — alternative shorter format
- `@slack-alerts-providers` — alternative shorter format
- `@slack-monitors` — general monitors

### Paging Devin
When a monitor message hands the investigation to Devin, mention it with the Slack member-ID form `<@U076RQCCF2P>`. A bare `@devin` renders as plain text and notifies nobody.

### Metric Names
Logs-metric names use dot-separated segments, and a tagged triage companion appends a `.by_domain` segment rather than an underscore, such as `openrouter.coinbase_checkout.initiated` / `openrouter.coinbase_checkout.initiated.by_domain` and `openrouter.signups.by_domain` (the signup-burst suite's domain-tagged companion).

### Tags
Always include `"terraform"` tag. Add service/team tags as appropriate.

### Template Variables That Render As Hostnames

Slack auto-links any bare text that looks like a domain, so a template variable whose value is a hostname-like identifier (e.g. `{{service.name}}` or `{{quota_metric.name}}` on GCP quota monitors, which resolve to `monitoring.googleapis.com/ingestion_requests`) arrives as a clickable link to a page that does not exist. Wrap those variables in backticks so Slack renders them as code.

### Recovery Messages
- Use "have recovered" or "has recovered" — NOT "returned to 0" (Datadog log monitors recover at ≤ threshold, not strictly 0)
- Keep recovery messages brief
- For rolling-window counters (e.g. `last("1h") > 0` over a dead-letter log query), recovery just means new events stopped arriving — not that the underlying issue is resolved. Use "have stopped" (not "have recovered") and add a line stating what recovery does and does not mean, plus the manual replay/fix step. See `batch_generations_lane_dlq_failures.tf` for the canonical example.

### Common Options
- `include_tags = false` — almost always false
- `notification_preset_name = "hide_all"` — standard
- `require_full_window = false` — standard
- `notify_no_data = false` — standard for log alerts
- `groupby_simple_monitor = true` — for ungrouped monitors; set to `false` when using `.by()` in the query for grouped alerts (e.g., per provider/model)

### Log Query Syntax
- Wrap exact strings in escaped quotes: `\"exact match\"`
- Use `@attribute:value` for facet filters
- Wildcard with `*` (e.g., `@job_name:usage-record-generations-*`)
- Rollup types: `"count"`, `"sum"`, `"cardinality"` (unique count)
- Group by several facets with one comma-separated string, `.by("@extra.provider,@extra.model")`. Separate string arguments, `.by("a","b")`, are rejected by Datadog with `unable to parse log monitor query`, and `terraform validate` does not catch it because the query is only checked by `POST /api/v1/monitor/validate` during `terraform plan`.
- Time windows: `last("5m")`, `last("10m")`, `last("30m")`, `last("1h")`
- For once-daily cron tasks, size the log-alert window to at least the cron period (e.g. `last("1d")`) so the alert does not self-clear before anyone sees it.
- **Breadcrumbs vs Extra**: Properties set via `breadcrumbs()` appear under `@breadcrumbs.*` in logs (e.g., `@breadcrumbs.key_hash_first_ten`, `@breadcrumbs.clerk_user_id`). Properties passed as structured args to `iLog()`/`wLog()`/`eLog()` appear under `@extra.*`. Do not confuse the two — using the wrong prefix will return no results.
- **Cloud Run vs Cloudflare Workers**: For GCP Cloud Run services (e.g., `batch-api`), structured logs are nested under `@data.jsonPayload.*`. Context fields from `iLog`/`eLog`/`wLog` appear at `@data.jsonPayload.extra.*` (e.g., `@data.jsonPayload.extra.provider_name`), not `@extra.*`. Cloudflare Workers use the standard `@extra.*` prefix. Use the correct prefix based on the service's runtime.

### Datadog URL
The Datadog site for this org is `us5.datadoghq.com`. Use this for log links and dashboard references.

## CI Validation

CI runs `terraform validate` on the `configs/terraform-monitors` directory automatically. The check appears as `Terraform (configs/terraform-monitors)` in GitHub Actions. No manual terraform commands needed — just commit and push.

`terraform validate` only checks HCL, so a malformed query fails later in the same job at the `terraform plan` step, where Datadog validates it. The plan output is usually too large for the PR comment, so read the reason from the `terraform-plan-output` workflow artifact (`gh run download <run_id> -n terraform-plan-output`). To check a query before pushing, post it to `https://api.us5.datadoghq.com/api/v1/monitor/validate` with `DD_API_KEY` / `DD_APP_KEY`, where `{}` means valid.

## DO NOT

- Do NOT try to create monitors via the Datadog API (`DD_API_KEY`/`DD_APP_KEY` lack write permissions)
- Datadog dashboards only allow tag KEYS `team` and `ai` — never put arbitrary grouping tags (e.g. a ticket id like `ope-5618`) on a `datadog_dashboard`; that passes `terraform validate`/`plan` but 400s on `apply` and breaks the release train. Put grouping tags on the monitors only.
- Do NOT modify `versions.tf` or `outputs.tf` unless adding a new module; `variables.tf` may be modified when a flat monitor needs a configurable variable (e.g. an opt-out list)
- Do NOT create module directories for simple single-monitor alerts — use a flat `.tf` file
- Do NOT use `timestamp()` or other Terraform functions in Datadog message templates — they evaluate at plan time, not alert time
