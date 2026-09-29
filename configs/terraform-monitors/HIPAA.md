# HIPAA monitor payloads (ENT-2025)

Decision record for keeping Datadog monitor notifications inside the BAA boundary. Datadog renders group values, template variables and (when enabled) log samples into the notification, and delivers it to Slack — a vendor separate from Datadog — and to two webhooks whose receiver is OpenRouter's own `cfw-internal`. No signed BAA covers any of those paths (the webhook payload still transits Datadog's integration), so the control is on the payload, not the destination. This file records the rule, the inventory behind the three query exclusions shipped with it, and the destination assessment. The lint that enforces the rule in CI lands in [#41430](https://github.com/OpenRouterTeam/openrouter-web/pull/41430); see [Enforcement](#enforcement-41430) for what it checks.

## The rule

A monitor whose query can match a HIPAA service's telemetry carries identifiers and counts only: no log samples, no message excerpts, no free-text facets, in the query's group-by or in the notification body.

## How a monitor becomes HIPAA-covering

Either of these makes a monitor subject to the rule:

1. **Declared.** The name contains `[HIPAA]`, or the tags contain exactly `hipaa` or a `hipaa:<value>` tag (neither is case-sensitive; Datadog lowercases tags, and a `tags = local.<list>` resolves). This applies whatever the type, so a metric or composite monitor about HIPAA is held to the rule too, and so are the three ENT-2008 leak-detector monitors (`hipaa_leak_detector.tf`).
2. **Log-derived and not excluded.** The type is built from log-like events (`log alert`, `error-tracking alert`, `event-v2 alert`, `event alert`, `ci-tests alert`, `ci-pipelines alert`, `rum alert`, `audit alert`, `trace-analytics alert`) and the query's `service:`, `@script_name:` and `env:` terms do not rule out the HIPAA producer. The producer today is the `api-hipaa` mirror (`services/cfw-api/wrangler.toml` `[env.hipaa]`): `service:api-hipaa` and `@script_name:api-hipaa` per `LOG_SERVICE_BY_SCRIPT_NAME` in `packages/instrumentation/log-service.ts`, tagged `env:production` by the tail worker (`services/cfw-instrumentation/src/tail-direct.ts`). A second HIPAA worker is a second producer identity, added in one place in the lint.

`service:api` is an exact match and rules the mirror out (see the control below); a filter with no service term, or a glob such as `service:api*`, does not. A monitor whose type or query cannot be read counts as covering rather than as exempt.

Metric monitors (`query alert`, `metric alert`), composites, synthetics and SLO alerts are covered only by declaration. A metric notification can render tag values and numbers and nothing else — there is no sample to attach and no message to quote — and OpenRouter's statsd tags are a bounded vocabulary the emitting code defines. Note that the mirror's metrics carry the same default `service:cfw-api` tag as the primary (`services/cfw-api/src/index.ts`), so every cfw-api metric monitor already covers the mirror; that is fine by construction.

## `service:api` is an exact match

Datadog's log search matches a facet term exactly; only a glob (`service:api*`, `service:*`) or the absence of any `service:` / `@script_name:` term lets a monitor see the mirror. Live positive control, `POST /api/v2/logs/analytics/aggregate` on us5 grouped by `service`, 2026-09-09:

| Filter | Window | Buckets |
| --- | --- | --- |
| `service:batch-api` | 1h | `batch-api` (6,671) |
| `service:batch-api*` | 1h | `batch-api` (6,670), `batch-api-control` (43,528), `batch-api-finalize` (24,451), `batch-api-submit` (7,098), `batch-api-sweep` (829) |
| `service:api*` | 1d | `api` (4,213,947,783) |
| `service:api-hipaa OR @script_name:api-hipaa` | 15d | none |

The last two rows also record that the shared org held no `api-hipaa` logs at all in the 15 days before this change. The exclusions below are ahead of the traffic, not a response to a delivery.

## Inventory

Snapshot at #41429 (2026-09-10), with the covering counts re-run at #42563 (2026-09-14); the tree has grown since and the lint, not this paragraph, is the current inventory. 638 `datadog_monitor` resources across the tracked `.tf` files (690 monitor instances once `for_each` maps are expanded): 347 `query alert`, 214 `log alert`, 39 `composite`, 33 `metric alert`, 3 `error-tracking alert`, 1 `ci-pipelines alert`, 1 `ci-tests alert`. Of the 214 log alerts, 82 carry no `service:` or `@script_name:` term in any of their filters (measured with the #41430 parser after `local.` and `for_each` resolution); the rest restrict to a named service, most often `service:batch-api*`, `service:alert-delivery` or `service:api`.

Before the exclusions below, 109 monitor instances covered the mirror: 98 log alerts, 2 error-tracking alerts, 1 ci-pipelines alert and 1 ci-tests alert whose queries could match it, plus 7 declared (`[HIPAA]` name or `hipaa` tag: 5 query alerts, 1 composite, 1 log alert). Three of the 109 rendered free text; they are the three edited under ENT-2025, and after those edits 106 remained covering. ENT-2008 later added `raw` to the free-text tokens, which reclassified one more of the 106 (`Latest_Router_Silent_Breakage`, a log alert present since #20125) and excluded it the same way, so 105 remain covering (96 log alerts, the two CI monitors, the 7 declared). All 105 satisfy the rule: their group-bys and template variables render identifiers (`@extra.provider_name`, `@extra.model`, `@breadcrumbs.clerk_user_id`, `@extra.raw_status`, `issue.id`, …) and counts, none enables log samples, and every destination is Slack or one of the two webhooks below. The two CI Visibility monitors are counted because their type is log-derived; GitHub Actions events cannot carry worker telemetry, and they pass the rule regardless.

Each of the three that remain carries `-service:api-hipaa`, which removes only mirror matches and changes nothing for other traffic. The fourth, `Latest_Router_Silent_Breakage` (a log alert grouped by `@extra.raw_models`, the customer-supplied model slugs, excluded when ENT-2008 made `raw` a free-text token), has since been deleted, so its exclusion no longer applies to anything:

| Monitor | Type | What it rendered | Why exclusion rather than reduction |
| --- | --- | --- | --- |
| `eLogAlert` (`monitoring/elogalert_always.tf`) | log alert | group-by `@extra.alert.markdown`, free-form markdown a developer writes at the `eLogAlert()` call site | The markdown is the alert's whole content; reducing it would make the monitor useless. The mirror's `eLogAlert()` calls still reach the log index for a HIPAA-cleared reader. |
| `Frequent_Backend_Error_Detected` (`monitoring/frequent_backend_error_detected.tf`) | error-tracking alert | `{{issue.attributes.error.message}}` and `{{issue.attributes.error.stack}}`, into `#alerts-api` | Error Tracking fingerprints every issue per `service` and never groups across services ([error grouping docs](https://docs.datadoghq.com/error_tracking/error_grouping/)), so the mirror's errors form their own issues under `service:api-hipaa`. Those issues stay in Error Tracking for a HIPAA-cleared reader; the exclusion removes whole issues from this monitor's view, so none is quoted into Slack. |
| `New_issue_found` (`monitoring/new_issue_found.tf`) | error-tracking alert | the same two variables, rendered into the monitor's event only — it carries no `@` handle and notifies no destination today (live monitor 1231391 confirms) | Same per-service fingerprint, same effect. Excluded anyway: the rendered event is a payload Datadog stores and shows, and the day someone adds a handle it must already be clean. |

Both error-tracking queries use `source("all")`, which also admits APM-sourced issues. Those carry the tracer's `service.name`, and that is the literal `'cfw-api'` passed to `instrumentWorker` in `services/cfw-api/src/index.ts` (`packages/cloudflare/instrumentation/context.ts`), the same code serving `[env.hipaa]`: spans from the primary and the mirror are indistinguishable by service (live `POST /api/v2/spans/analytics/aggregate` on us5 for `service:cfw-api*` over 1d returns only `cfw-api`), and no script-name attribute rides on them. The `cfw-${scriptName}` convention belongs to the OTLP logs path (`services/cfw-instrumentation/src/otel/logs.ts`), which is HIPAA-gated. So `-service:api-hipaa` cannot touch APM issues and no query edit could; that vector is closed only by the mirror's zero-span posture, which is four controls, each verified on this branch: `DATADOG_TRACE_SAMPLE_RATE = "0"` in `[env.hipaa.vars]`, `[env.hipaa.observability.traces] enabled = false` (`services/cfw-api/wrangler.toml`), `shouldPushTraces` dropping HIPAA script names in the tail worker (`services/cfw-instrumentation/src/otel/tracing.ts`), and `forceSampleCurrentTrace` being a no-op when `isHipaaWorker()` (`packages/cloudflare/instrumentation/index.ts`). Reopening the mirror's traces therefore requires first giving it a distinct span identity — a different `service.name` on the mirror — before any monitor can exclude it; until then the answer to "can we sample mirror spans" is no.

## Destinations

Every notification handle across the 638 monitors, and the BAA position on each:

| Destination class | Handles in use | Carries | BAA-covered | Control |
| --- | --- | --- | --- | --- |
| Slack | `@slack-OpenRouter-<channel>` (plus a few legacy `@slack-<channel>`) | Rendered monitor message: title with group values, body with template variables, samples if enabled | No. Outreach to Salesforce recorded 2026-08-25 on ENT-2025; no signed BAA. | Payload reduction. |
| Datadog webhook → `cfw-internal` | `@webhook-endpoint-degradation-pylon`, `@webhook-endpoint-error-surge-baseline` (`monitoring/endpoint_degradation_webhook.tf`, `monitoring/endpoint_error_surge_webhook.tf`) | `$ALERT_TRANSITION`, `$AGGREG_KEY`, `$ALERT_SCOPE`, `$ALERT_TITLE`, `$TEXT_ONLY_MSG` — the same rendered message, as text | The receiver is OpenRouter-owned (`url` starts with `${var.cfw_internal_url}`), but the payload transits Datadog's webhook integration and the messages on both monitors render only endpoint, provider, model and status identifiers. | Same payload rule; only webhooks whose `url` is under `var.cfw_internal_url` are assessed. |
| Email (`@<user>@openrouter.ai`) | none in use | Rendered message | Not assessed for content; allowed as a class because it reaches an OpenRouter mailbox and is subject to the same payload rule. | Same payload rule. |
| PagerDuty, Opsgenie, Teams, on-call, incident and case integrations, non-`cfw-internal` webhooks, non-openrouter.ai email | none in use | — | Not assessed | Assess coverage and record it here before routing a HIPAA-covering monitor there. |

There is no destination to route HIPAA-covering alerts to that is BAA-covered, so routing is not the control; payload is. Slack messages never contain request content, whichever monitor fires.

## The ENT-2008 leak detector monitors

ENT-2008's continuous leak monitor exists as three `[HIPAA]`-named log alerts in `monitoring/hipaa_leak_detector.tf`, covering by declaration whatever their queries say. The producer is the `hipaa-leak-sweep` cron in `cfw-internal` (`services/cfw-internal/src/routes/cron/hipaa-leak-sweep.ts`), whose logs land under `service:api @script_name:internal` — not a HIPAA producer identity, which is why the declaration is what makes them covering. Every run emits one `hipaa_leak_detected` line per rule × sink finding, one `hipaa_leak_sweep_failed` line per rule × sink it could not evaluate, or one `hipaa_leak_sweep_ok` line, and the heartbeat monitor counts all three.

The detector's log line carries only identifiers and counts, each as its own `@extra.*` field named so the free-text facet rule below reads it as an identifier: `rule_id` (`scrub_column_populated`, `dispatch_miss`, `prompt_log_object_present`), `sink_name` (`clickhouse_generations`, `clickhouse_endpoint_requests`, `clickhouse_guardrail_events`, `clickhouse_user_signals`, `r2_chatml_prompt_logs`, `r2_raw_prompt_logs`, `r2_formatted_prompt_logs`, `gcs_customer_prompt_logs`), `generation_count`, `reported_generation_id_count`, `workspace_count`, `generation_ids` and `workspace_ids` (comma-joined, capped at twenty), `column_names` (policy keys, a bounded vocabulary), `window_start` and `window_end`, and on every line of a run that started the run summary `object_checked_generation_count` and `is_object_check_truncated` (the `reportSweepSetupFailure` line, `rule_id: none`, carries only the error fields). The `hipaa_leak_sweep_failed` line additionally carries the `errorToLogFields` fields, which on an `ErrorT` are five: `error_message`, `error_location`, `error_stack`, `error_metadata` and `error_raw` (the whole error, `safeStringify`'d and cut at 1,000 characters). Of those, `error_message`, `error_stack`, `error_metadata` and `error_raw` are free text the lint rejects by name (`message`, `stack`, `metadata` and `raw` are free-text tokens; `raw_status` still passes through its `_status` suffix); `error_location` passes the facet rule — it is a code-defined string and a legitimate dashboard facet elsewhere — so keeping it off a monitor is this policy, not the lint. So the complete set a leak-detector monitor may ever render is: generation ids, workspace ids, the sink name, the rule id, the populated scrub column names (policy keys) and counts. Never the matched content, the value that tripped a rule, or a log sample. Today the monitors group by `@extra.rule_id,@extra.sink_name` and render exactly those two plus `{{value}}`; the ids and column names stay on the log line for the responder to read in Datadog. Response procedure: `docs/runbooks/hipaa-phi-leak-response.md`.

## The ENT-2125 emergency cache posture monitor

`[HIPAA] Emergency auth cache served a HIPAA-workspace key` (`monitoring/hipaa_emergency_cache_posture.tf`) is a declared metric monitor on `openrouter.user_cache.emergency_fallback.hit{posture:hipaa AND site:open} by {service}`, added after the inventory above was taken. It renders `service` and `{{value}}` only: `service` is the default worker tag, a bounded vocabulary the emitting code defines (`services/cfw-api/src/auth/get-user.ts`), and a metric notification has no sample to attach.

## Enforcement (#41430)

[#41430](https://github.com/OpenRouterTeam/openrouter-web/pull/41430) adds `scripts/check-hipaa-monitor-payloads.ts`, run as `bun run check:hipaa-monitor-payloads` inside `bun run lint`. Until it merges this section describes the check as proposed; after it merges it describes what CI runs. It parses every `datadog_monitor` under this directory, decides coverage as described above, and reports a covering monitor for any of:

- `enable_logs_sample` or `enable_samples` that is not literally `false` (an unresolved expression counts).
- A `.by("…")` facet, an `event_query { group_by { facet } }` facet on a formula monitor, or a `by {…}` tag group on a declared metric monitor, that is free text.
- A `{{…}}` template variable (including inside `urlencode` / `eval`) that renders a free-text facet or the sampled event: `log.*`, `event.*` (other than `.link`), `issue.title`, `issue.attributes.error.*` other than `.type`.
- A notification handle outside the assessed classes above, read after `{{…}}` tags are rendered away so `{{#is_alert}}@slack-…{{/is_alert}}` counts; a `@webhook-` handle is accepted only when its `datadog_webhook` resource's `url` starts with `${var.cfw_internal_url}`, and `@team-`, pager, ticketing and `@all` handles fail assessment.
- A `query`, `message` or `escalation_message` that is wholly an unresolved Terraform expression, a log query with an interpolation ahead of its comparison operator (where the filter or the `.by()` chain would be), or a facet or handle class that still contains `${…}` — coverage fails closed on an opaque query, so inspection fails closed on an opaque payload too. Literals, locals in the same module directory, and `for_each = local.<map>` / `var.<flag> ? {} : local.<map>` over a literal map all resolve; `${var.name_prefix}` inside an otherwise literal string, or an interpolated threshold after the operator, is not opacity.

Coverage is decided by evaluating the filter in three-valued logic against a log from the producer: `service:api` is false, `-service:api-hipaa` is false, `service:api*`, `service:api??????` (`?` is a one-character wildcard) and `service:(api OR api-hipaa)` are true, and any term that is not an identity term — `env:production`, a quoted phrase, a `${var.…}` interpolation — is unknown. Only a filter that evaluates to false excludes the producer. Formula monitors are judged by their `variables { event_query { search { query } } }` filters. A missing or interpolated `type` counts as log-derived.

The free-text facet rule: split the facet path on `.`, and each segment on `_` / `-` (camelCase is split too). The facet is an identifier when its last segment starts with `is_` / `has_` or ends with `_id`, `_code`, `_class`, `_type`, `_kind`, `_category`, `_count`, `_hash`, `_name`, `_status` or `_domain`. Otherwise it is free text when the last segment is exactly `error` or any token is one of `message`, `msg`, `markdown`, `stack`, `body`, `prompt`, `completion`, `content`, `text`, `input`, `output`, `payload`, `metadata`, `raw`, `exception`, `detail`, `details`, `url`, `query`, `headers`, `title`, `description`, `sample`, `excerpt`, `snippet`, `html`, `arguments`, `args`, `email`, `ip`, `phone`, `address`, `ssn`, `dob`, `birthdate`. `_name` stays an identifier suffix on purpose (`provider_name`, `service_name`, `@test.full_name` are bounded vocabularies), so a `customer_name` facet would pass; keep person-naming fields out of monitors rather than out of the suffix list. If the rule is wrong for a real facet, fix the rule with a stated reason; do not special-case the monitor.

Monitors the check deliberately does not flag, as calibration:

- `auto_router_exhaustion_by_candidate_set` groups by `@extra.message`, but its query is built from `local.auto_router_exhaustion_query`, which carries `service:api`. Not covering.
- `batch_moderation_preflight` reads `each.value.query` from `local.batch_moderation_monitors`; the map is a literal, so each instance resolves to `service:batch-api*`. Not covering.
- `transform_fingerprint_surge` renders `@extra.raw_status`, an HTTP status the query constrains to four values. An identifier.
- `Frequent_Frontend_Error_Detected` quotes the same error variables but its filter is `env:vercel-production`, and the mirror logs `env:production`. Not covering; this is why `env` is part of the producer identity rather than a spurious `-service:api-hipaa` on a Vercel-only monitor.
- `hipaa_worker_identity_mismatch` is the reference for a covering monitor done right: `service:(api OR api-hipaa)`, grouped by `@script_name,@extra.service_name,@extra.is_hipaa_worker`, rendering exactly those three.
- `batch_model_failed_requests_high` renders sampled-log attributes through `{{log.attributes.[…]}}`, which the check would reject on a covering monitor; its query is `service:batch-api*`, which cannot match the mirror.

## Verification

Datadog Test Notifications is the literal test of "a test alert on a HIPAA-service monitor delivers no request content". It is a UI action: open `[HIPAA] Worker identity vars disagree` (monitor 22133504) in us5, press Test Notifications, and confirm the Slack message in `#test-slack-messages` carries only the script name, the service name and the `is_hipaa_worker` flag. Performed under [ENT-2075](https://linear.app/openrouter/issue/ENT-2075), a sub-issue of ENT-2025. Both the Alert and Recovery test messages carried the monitor's authored text and the three grouping tags only, with no log lines, `@message`, or samples. Repeat and update the row whenever the monitor's message or group-by changes.

| Field | Value |
| --- | --- |
| Tested on (date) | 2026-09-13 |
| Tested by | Ben Heidorn |
| Slack permalink | https://openrouter.slack.com/archives/C0A9N901UG1/p1789325882870649 |

Deployed state read back with `GET /api/v1/monitor/{id}` on 2026-09-09: `options.enable_logs_sample` is `false` on both log alerts (16367624 `eLogAlert`, 22133504 `[HIPAA] Worker identity vars disagree`) and absent on the error-tracking, metric and composite monitors (1231075, 1231391, 22277818, 22258840, 22119639, 22119638, 22277819, 22277817). Provider 4.9.0 sends `enable_logs_sample: false` for every log alert that does not set it, so the flag is the smaller risk; the group-by and template-variable vectors are the ones the flag does not govern.

## Related work

- **#41430** — the lint described under Enforcement. It reused the inventory above to confirm that these three monitors, and only these three, rendered free text on a covering query.
- **#39279 (ENT-2024)** — dedicated `api-hipaa` log index and read restriction in `services/datadog/infra`, still open. Once it lands, that is where the mirror's logs are read; this file is about what leaves Datadog through monitors.
- **#39280 (ENT-1943)** — dedicated `instrumentation-hipaa` tail consumer that moves all mirror logs and metrics to a separate, BAA-covered Datadog org. Once it lands the shared org receives no mirror telemetry and the exclusions here become belt-and-braces. Monitors recreated in the BAA org must satisfy the same rule, because that org's notifications still leave for Slack.
- **#37366** — source-side scrubbing in the tail worker and `LOG_SERVICE_BY_SCRIPT_NAME`, which is what makes `service:api-hipaa` an addressable identity in the first place.
