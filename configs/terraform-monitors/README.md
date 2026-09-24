# Terraform Configuration

This directory contains Terraform configurations for managing Datadog resources. They are applied with OpenTofu (`tofu`), and the committed `.terraform.lock.hcl` files carry `registry.opentofu.org` provider pins that the `terraform` binary ignores, so always run `tofu` here.

## Prerequisites

- OpenTofu installed
- Datadog API and Application keys
- Cloudflare R2 API Key
  - Go to [R2 API Keys](https://dash.cloudflare.com/056879e63aa83db17aadc76220f52953/r2/api-tokens)
  - Create a user API token with admin read-only access
  - Set a TTL on the key (I touch this rarely, so I have mine expire within a month - @Nouser)
  - Take note of the `Access Key ID` and `Secret Access Key`. These will be used in the authentication flow, NOT the token value at the top.
![r2-access-key-guide.png](resources/r2-access-key-guide.png)

### Installing OpenTofu

#### macOS (using Homebrew)

```bash
brew install opentofu
```

For other operating systems, visit the [official OpenTofu installation guide](https://opentofu.org/docs/intro/install/).

## Setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your Datadog credentials:
   ```
   export TF_VAR_datadog_api_key="your-api-key-here"
   export TF_VAR_datadog_app_key="your-app-key-here"
   export AWS_ACCESS_KEY_ID="your-r2-access-key-id-here"
   export AWS_SECRET_ACCESS_KEY="your-r2-access-token-here"
   ```

## Usage

### Important: Environment Variables

Before running any OpenTofu commands, you **must** load the environment variables:

```bash
source .env
```

### Verify Environment Variables

After sourcing the `.env` file, verify the variables are properly exported:

```bash
printenv | grep TF_VAR
```

### OpenTofu Commands

After verifying your environment variables are set, you can run OpenTofu commands:

```bash
# Initialize OpenTofu
tofu init

# Plan changes
tofu plan

# Apply changes
tofu apply
```

## Monitoring Configuration

The monitoring module (`monitoring/`) contains configurations for Datadog monitors and alerts. Key features include:

- Endpoint error monitoring for various AI providers
- Automatic alerting for error surges

### Alert Configuration

The monitoring module includes:

- Error surge detection (500+ errors in 10 minutes)
- Provider-specific alerting
- Slack notifications for alerts
- Detailed error reporting including model and status information

### Paging the on-call

Most monitors post to Slack only. A monitor that must wake someone up pages through Datadog On-Call, and needs two things on the resource that sends the notification (the composite, in a gate-and-rate pair):

1. `@oncall-engineers` in the message. This is the On-Call handle of the `Engineers` team, the only team with an escalation policy.
2. `priority = N` on the resource. Datadog attaches it to the page as `priority:N`, and the Engineers team's On-Call routing rules match on that tag to pick the escalation policy and urgency.

The routing rules as read from the On-Call API on 2026-09-23 (`GET /api/v2/on-call/teams/<engineers>/routing-rules`):

| Routing condition | Result |
| --- | --- |
| `priority:1` | Engineers P1/SEV-1 escalation policy at high urgency, plus a Slack post |
| `priority:2` | Engineers P2/SEV-2 escalation policy at high urgency |
| `priority:(3 OR 4 OR 5)` | Slack post only, nobody is paged |
| no match | Engineers default escalation policy at low urgency |

```hcl
resource "datadog_monitor" "example_paging" {
  name     = "${var.name_prefix}[Service] Condition"
  type     = "composite"
  priority = 2

  query = "${datadog_monitor.example_gate.id} && ${datadog_monitor.example_rate.id}"

  message = <<-EOT
    @oncall-engineers @slack-OpenRouter-alerts-p2-high-impact
    {{#is_alert}}
    Condition and runbook. Sev 2, pages the engineering on-call.
    {{/is_alert}}
  EOT
}
```

[Monitor 22644258](https://us5.datadoghq.com/monitors/22644258) (`monitoring/nvidia/router_latency.tf`) is the live example. The routing rules themselves live in [Datadog On-Call](https://us5.datadoghq.com/on-call/teams), not in Terraform, so the table above is a snapshot. `bun run check:monitor-paging` (part of `bun run lint`) fails a monitor whose alert text has `@oncall-engineers` without `priority = 1` or `priority = 2`, or a `priority` without `@oncall-engineers`. A handle only inside `{{#is_recovery}}` does not count, and a `priority` the lint cannot read (a variable) fails.

### Creating Datadog Alert Monitors

Here's a guide on creating Datadog alert monitors in Terraform:

#### Basic Monitor Structure

```hcl
resource "datadog_monitor" "example_monitor" {
  name    = "Monitor Name"
  type    = "metric alert"  # or "log alert", "composite", "apm alert"
  message = "Alert message with {{#is_alert}}@slack-channel{{/is_alert}}"

  query = "sum(last_5m):sum:metric.name{*} > 100"

  monitor_thresholds {
    critical = 100
    warning  = 80  # optional
  }
}
```

#### Common Monitor Types

1. **Metric Alert**

   ```hcl
   type = "metric alert"
   query = "sum(last_5m):sum:metric.name{*} > 100"
   ```

2. **Log Alert**

   ```hcl
   type = "log alert"
   query = "logs('env:production service:myapp status:error').index('*').rollup('count').by('service').last('5m') > 10"
   ```

3. **Composite Alert**
   ```hcl
   type = "composite"
   query = "1 && 2"  # combines multiple monitor IDs
   ```

#### Monitor Configuration Options

```hcl
resource "datadog_monitor" "example" {
  # Basic settings
  name    = "Example Monitor"
  type    = "metric alert"
  message = "Alert message"
  query   = "..."

  # Thresholds
  monitor_thresholds {
    critical = 100
    warning  = 80
    ok       = 0
  }

  # Notification settings
  notify_no_data      = false
  renotify_interval   = 0  # minutes
  require_full_window = false
  timeout_h           = 0  # hours
  include_tags        = true

  # Evaluation settings
  evaluation_delay    = 900  # seconds
  new_host_delay     = 300   # seconds
  notify_audit       = true

  # Tags
  tags = ["env:prod", "service:myapp"]
}
```

#### Alert Message Variables

Use these variables in your alert messages:

- `{{#is_alert}}...{{/is_alert}}` - Content shown only when alerting
- `{{#is_warning}}...{{/is_warning}}` - Content shown only for warnings
- `{{#is_recovery}}...{{/is_recovery}}` - Content shown on recovery
- `{{#is_no_data}}...{{/is_no_data}}` - Content shown when no data
- `{{name}}` - Monitor name
- `{{value}}` - Current value
- `{{threshold}}` - Alert threshold
- `{{host.name}}` - Host name (for host-based alerts)

#### Best Practices

1. **Naming Convention**

   - Use consistent naming: `[Environment] [Service] [Metric] [Condition]`
   - Example: `[Prod] [API] [Error Rate] [High]`

2. **Thresholds**

   - Set appropriate warning and critical thresholds
   - Consider using different thresholds for different environments

3. **Notifications**

   - Include relevant context in alert messages
   - Use tags for better organization
   - Set appropriate renotification intervals

4. **Evaluation**

   - Consider data collection delays when setting evaluation delays
   - Use `require_full_window` carefully as it might miss alerts

5. **Tags**
   - Use consistent tagging strategy
   - Include environment, service, and team tags
   - Use tags for grouping and filtering

## Troubleshooting

If you see errors about missing environment variables:

1. Make sure you've created the `.env` file
2. Verify you've added your credentials to the `.env` file
3. Confirm you've sourced the environment variables:
   ```bash
   source .env
   ```
4. Check that the variables are actually exported:
   ```bash
   printenv | grep TF_VAR
   ```
5. If still having issues, try setting the variables directly in your shell:
   ```bash
   export TF_VAR_datadog_api_key="your-api-key-here"
   export TF_VAR_datadog_app_key="your-app-key-here"
   export AWS_ACCESS_KEY_ID="your-r2-access-key-id-here"
   export AWS_SECRET_ACCESS_KEY="your-r2-access-token-here"
   ```
