# Datadog for the intern stack

The intern platform reports under three Datadog services, one per
producer: `service:cfw-intern-provisioner` (the provisioner worker),
`service:cfw-secret-vault` (the vault worker), and `service:interns`
(the intern VMs). This file is the map — which producers fall under
which service, how each one gets labelled, where the dashboards and
monitors live, and what is deliberately not covered.

Terraform for this sits in two places and they are not interchangeable:

| Path | Owns |
|---|---|
| `configs/terraform-monitors/monitoring/` | dashboards and monitors |
| `services/datadog/infra/` | log pipelines, GCP sinks, the Dataflow path |

Only `configs/terraform-monitors` has a CI terraform job. Changes under
`services/datadog/infra/` are validated by nothing automated, so run
`terraform validate` there by hand before opening a PR.

## Renaming a service is a deploy, not a terraform apply

The labelling lives in the `cfw-instrumentation` tail worker
(`logServiceForScriptName`), so a service name only changes when **that
worker deploys**. Merging is not enough, and `terraform apply` cannot
do it.

`release.yaml` runs `apply-terraform-monitors` well before
`deploy-cfw-instrumentation`, so within a single release run the
monitors are repointed at a service nothing emits yet. Every monitor in
both intern modules is a presence check (`> N`) with
`notify_no_data = false`, so that window costs missed detection, not a
false page — but the window is real and it is the whole reason the tag
change and its consumers must ship together.

Two past cutovers hit this and are worth knowing about:

- An earlier version of this stack had `[Intern Provisioner] No
  Workflow Starts`, an absence check (`< 1` over 15m) with
  `require_full_window = false`. Pointed at a service with no producer
  it sat permanently in alert. It has since been replaced by a
  metric-based stuck-queued monitor. **Do not add an absence check on a
  log query in these modules** without solving the ordering first.
- `frontend-api` moved from `service:api` to `service:cfw-frontend-api`.
  Pre-cutover logs stayed on `service:api` forever, which is why the
  enqueue monitors still query the `(api OR cfw-frontend-api)` union.

### A rename has two stages, not one

Both are deploys. Neither is a terraform boundary.

1. **The tail worker deploy** moves the direct-submit path, which is
   the large majority of log volume.
2. **The GKE `telemetry-pipeline` consumer redeploy** moves the
   remaining slice — roughly 1% of logs go through Pub/Sub rather than
   direct submit, and that slice only picks up the new service once the
   consumer is running #34823's `packages/queues` change. Until then it
   lands on `service:api`.

So there is a window where the same worker's logs are split across two
services. **Logs are never relabelled retroactively.** Widen when
looking back across any cutover:

| Looking back across | Widen to |
|---|---|
| the `interns` split (this one) | `service:(cfw-secret-vault OR interns)`, `service:(cfw-intern-provisioner OR interns)` |
| the original `api` → `interns` move | `service:(interns OR api) @script_name:<worker>` |

Do not read a low-but-nonzero `service:api` count for an intern worker
as a bug until the consumer has rolled.

## Three producers, three services

### The two Cloudflare workers

`service:cfw-intern-provisioner` and `service:cfw-secret-vault`.

Cloudflare does not set the Datadog service from the worker's `name`.
The shared `instrumentation` tail worker ships every worker's logs, so
after #34823 it resolves the service per tail event from the event's
`scriptName` (`logServiceForScriptName`,
`packages/instrumentation/log-service.ts`) and stamps it at submit time
on both the direct and queued paths. The allowlist is three names, each
mapped to `cfw-${scriptName}` so a worker's logs share the service its
APM spans already carry — `intern-provisioner` to
`cfw-intern-provisioner`, `secret-vault` to `cfw-secret-vault`,
`frontend-api` to `cfw-frontend-api` — and everything else stays `api`.

That map keys on the literal script name, so renaming either worker in
its `wrangler.toml` silently drops it back to `service:api`.

Moving these workers off `service:api` narrows anything that queried
the whole service. Every `datadog_monitor` and `datadog_dashboard`
lives in `configs/terraform-monitors`. For the intern workers nothing
depended on it: every broad `service:api` query there is pinned to
router, guardrail, or managed-skill event names neither intern worker
emits. `frontend-api` was different — it is the web app's API worker,
and the coordinated-abuse, intern-enqueue, startup-application, and
errors-across-services queries read its log lines, so those were
widened to `service:(api OR cfw-frontend-api)` rather than repointed.
The errors-across-services one is the easiest to miss: its worker
bucket is a `service:api` local that feeds both a per-`@script_name`
breakdown and, by negation, the "everything else" catch-all, so a
worker that leaves the bucket does not go blank — it quietly moves to
the catch-all. Re-run that check before moving a fourth worker off
`service:api`.

### The intern VMs

`@data.resource.type:gce_instance` in project
`ext-interns-spawner-000`.

Container stdout and the serial console reach Cloud Logging because the
provisioner stamps `google-logging-enabled = true` into the instance
metadata (`REQUIRED_INSTANCE_METADATA`,
`services/cfw-intern-provisioner/src/clients/gcp-instance.ts`). From
there a project sink exports to Pub/Sub and a Dataflow job drains into
Datadog (`services/datadog/infra/logging-pipeline.tf`).

The VMs get their service label from the `GCE Interns` pipeline in
`services/datadog/infra/log-pipelines.tf`, not at the source. These
entries never touch the tail worker, so a pipeline is the only place to
label this half — which is why the Cloudflare pipeline could be dropped
and this one could not.

Match the fleet on the project:

```
@data.resource.type:gce_instance @data.resource.labels.project_id:ext-interns-spawner-000
```

`project_id` is a clean discriminator because `ext-interns-spawner-000`
hosts nothing but intern VMs.

Two ways to get this wrong:

- **The instance name does not survive.** A real `cos_containers` entry
  read from the live project carries exactly three resource labels —
  `instance_id`, `project_id`, `zone` — and an empty top-level `labels`
  map. There is no `labels."compute.googleapis.com/resource_name"`, so
  matching `intern-*` on the name silently matches nothing.
- **Do not filter on `@data.resource.labels.instance_id`.** That is the
  numeric GCE id, minted fresh per reprovision, so it pins exactly one
  VM instead of matching the fleet.

Nothing carries the intern's identity into a log entry. Network tags
and instance metadata (including `intern-id`, the one field that maps a
line back to an `interns` row) are not part of a `LogEntry`. Mapping a
log line to an intern needs a real GCP resource `labels` block on the
instance, which is a provisioner code change, not a Datadog one.

## One service per producer

Each of the three producers has a service of its own, so the service
tag identifies the component and no `@script_name` qualifier is needed
to disambiguate within the intern stack.

`service:interns` used to cover all three. It now means the intern VMs
and nothing else — so a pre-split query that reads `service:interns`
and expects worker logs returns nothing, silently.

## Two Datadog facts you will otherwise rediscover the hard way

Both are already documented, with the measurements behind them, under
"Diagnosing from the caller's logs" in
[`services/cfw-secret-vault/AGENTS.md`](../cfw-secret-vault/AGENTS.md):

1. Every Cloudflare worker logs under `service: api` by default, and
   the discriminator is `@script_name:<worker>`, not the service facet.
2. Fields displayed as `custom.extra.X` are queried as `@extra.X`, and
   `analyze_datadog_logs` fails **silently** on the display path —
   correct row counts, blank values, no error.

Do not restate them here. Two notes on how the intern services
interact with them:

- They only partly retire the first. Each intern worker has its own
  service, which closes the "until it ships" caveat that file records
  against ORI-1188, but every other worker is still `service:api` and
  `@script_name` remains the general answer there.
- It does not touch the second at all. `@extra.X` is how the monitors
  and dashboards here are written, and the silent-failure behaviour is
  unchanged.

## Where the enqueue monitors point, and why

Two of the five provisioner monitors deliberately query
`service:(api OR cfw-frontend-api) @script_name:frontend-api` rather
than `service:cfw-intern-provisioner`. That is not drift. Enqueue happens in the
`frontend-api` worker, which has its own service (`cfw-frontend-api`,
matching its APM service) with pre-cutover lines still on
`service:api` — hence the union. The provisioning workflow itself runs
in `intern-provisioner` and is on `service:cfw-intern-provisioner`.

This is the clearest working example of the first fact above: one
feature, two workers, and the service facet does not follow the
feature.

## Dashboards

| Dashboard | Source |
|---|---|
| Intern Provisioning | `configs/terraform-monitors/monitoring/intern_provisioner/dashboard.tf` |
| Secret Vault | `configs/terraform-monitors/monitoring/secret_vault/dashboard.tf` |

## What the monitors alert on

Provisioner
(`configs/terraform-monitors/monitoring/intern_provisioner/monitors.tf`):

| Monitor | Fires when |
|---|---|
| Workflow Failed | any `workflow failed` in 10m, grouped by `@extra.failed_step` |
| Enqueue Failed | any enqueue/reprovision/destroy enqueue failure in 10m |
| Enqueue Accepted Gate | at least one enqueue accepted in 15m (gate, not a page) |
| No Workflow Starts | fewer than one workflow start in 15m (absence check) |
| Interns Stuck in Queued | composite: enqueue accepted **and** no workflow start |

The last three are one alert. The two gates exist so the composite only
pages when something was actually enqueued and then never started, and
the composites carry `create_before_destroy` because Datadog refuses to
delete a monitor a composite still references.

Vault (`configs/terraform-monitors/monitoring/secret_vault/monitors.tf`),
all scoped `service:cfw-secret-vault`:

| Monitor | Threshold |
|---|---|
| Tunnel Certificate Minting Failures | any in 15m |
| Agent Auth Failures | more than 5 in 15m |
| Rate Limit Exceeded | more than 20 in 15m, by `@extra.route` |
| Secret Decryption Failures | any in 15m |
| Secret Resolution Failures | any in 15m |
| Smuggled Credential Rejected | any in 15m |
| Egress Guard Blocking Destinations | more than 10 in 30m |
| SSRF Protection Disabled | any in 1d |

Audit-log write failures are monitored separately in
`monitoring/vault_audit_log_write_failures.tf` — a metric alert on
`openrouter.vault_audit.write_failed` (any in 15m), not log-scoped like
the table above.

Most zero-threshold monitors exclude `-@preview_slug:*` so preview
deploys cannot page. Smuggled Credential Rejected deliberately does
not: it is the highest-signal security event the vault emits and is
worth hearing about from a preview too.

`intermediate_ca_near_expiry` is charted but is deliberately **not** a
monitor. It fires on the healthy rotation path immediately before a
successful re-mint, so it would page permanently.

## Facets have to exist before the apply

Two monitors group by `@extra.route` and `@extra.failed_step`. A
missing facet does not merely render an empty widget — it can fail the
`terraform apply` on a `by(...)` monitor. There is no terraform
resource for Datadog facets, so creating them is a console step that
has to happen first.

The two are not equally risky:

- `@extra.failed_step` sits on live provisioner logs. It is fine.
- `@extra.route` has produced **zero logs in 30 days**, so the facet
  does not exist yet and the vault's rate-limit monitor is the one that
  can fail at apply. It also stays untestable until a rate limit
  actually trips, so a green apply is not evidence the alert works.

The same console-first rule applies to the dashboard template variables
(`@extra.intern_id`, `@extra.entity_id`, `@extra.caller_user_id`),
whose dropdowns are broken until all three exist.

## Known blind spots

- **The vault's container data plane is unmonitored.**
  `services/cfw-secret-vault/container-app/tunnel-proxy.ts` contains no
  log calls at all, and Cloudflare Container stdout does not reach the
  `instrumentation` tail worker in any case. The TLS-terminating proxy
  handling every agent request is invisible in Datadog. Do not let a
  dashboard imply otherwise.
- **The vault access log is not an audit trail.** It is unsigned,
  sampled, lossy, and silently dropped when the pipeline consumer has
  no `DD_API_KEY`. See `services/cfw-secret-vault/AGENTS.md` before
  citing it as evidence of anything.
- **Intern VM metrics are a dead path.** `roles/monitoring.metricWriter`
  is bound, but COS runs no Ops Agent and
  `google-monitoring-enabled` is not in the instance metadata, so
  nothing collects. A working log path is not evidence that metrics
  work.
- **Structured context is not full-text indexed.** Searching for an
  error string that only appears inside `extra.*` finds nothing. Search
  the message, then read the field.
