# Alert evaluator

This README describes the service as it behaves on `main`. Decision history
lives in Git and Linear, not here.

The alert evaluator is a Cloud Run service and Pub/Sub pull consumer. Its
runtime evaluation loop evaluates alert-platform policies, fires and
resolves `alert_state`, and publishes validated `AlertEventV1` CloudEvents to
`alert-events`. The shared runtime registry also contains `credits-low`, but
`RETIRED_ALERT_POLICY_KEYS` explicitly excludes that key from the composed
evaluator because it remains served by the legacy notification path.

Threshold policies run in the alert evaluator. Broadcast-type alerts — no
threshold, no clear edge, no hysteresis, for example model deprecation — do not
run in the evaluator. They consume `packages/alert-event-builder` from their
own host and never enter the evaluator. The evaluator is a threshold engine on
a single-instance service whose job is keeping up with its signal subscription,
so a second scheduler and heavy audience queries do not belong in that process.

The eligible-entity refresh is derived from configured entities with at least
one enabled setting for an active policy, excluding ineligible entities
(deleted, banned, or restricted). Consequently, an entity whose only enabled
configuration is `credits-low` can remain in the eligible set: the set does not
know that this policy is retired. The evaluator's runtime guard tolerates that
residue by omitting the retired key from evaluation and reconciliation, so the
entity produces no new-system evaluation or event for `credits-low`. The
consumer's eligible-set filter is advisory and fail-open while the set is
unready; the cycle's settings checks remain authoritative.
For on-call recovery of stuck states, see
[`docs/runbooks/alert-platform-recovery.md`](../../docs/runbooks/alert-platform-recovery.md).

## Terraform

From this service directory:

```bash
bun run terraform-or init
bun run terraform-or plan
bun run terraform-or apply
```

Terraform provisions the Cloud Run service, its service account, the
`alert-events` topic, plus a pull subscription on the existing
`signals-billing-entity-usage` topic. The output topic retains messages for
seven days. The evaluator reads live
policy and spend state from Postgres and Spanner, and writes current-condition
transitions to `alert_state` in Postgres.

## Local development

```bash
bun run dev
```

The service listens on `PORT` (default `8080`). Set `PUBSUB_PROJECT_ID`
and `PUBSUB_SUBSCRIPTION_NAME` explicitly to non-production values before
running locally; the service has no defaults for either and refuses to start
without them. It also requires `ALERT_EVENTS_TOPIC` (must be `alert-events`).

## Gating and kill switch

Every cycle evaluates a policy for an entity only when that entity holds an
enabled configuration for it. There is no plan or feature-entitlement gate in
the evaluator, and it never calls Statsig.

`EVALUATION_ENABLED` (default `"true"`, mirroring `DELIVERY_CONSUMER_ENABLED`
in alert-delivery) is checked at cycle entry. Setting it to `"false"` skips
every cycle and acks the buffered signals instead of redelivering them.
In production, a disabled evaluator emits the
`alert-evaluator:evaluation-disabled-in-prod` log once at boot. The
`alert-evaluator:evaluation-disabled` heartbeat is emitted every 60 seconds
while disabled on a timer independent of signal traffic, configured entities,
and sweep duration. The `[Alert Evaluator] Evaluation disabled in production`
Datadog monitor tracks both signals. It is not silenced, and it interpolates
the alert-platform paging target, so whether it reaches anyone depends on that
target's value in
`configs/terraform-monitors/monitoring/alert_platform_targets.tf`. Read its
state in Datadog rather than waiting for a page.

## Evaluation contract

Policy evaluation returns a tri-state result: `breach`, `hold`, or `clear`.
Debounced clears commit only when `event_published_at` confirms publication.
A falling-edge clear is debounced by arming `clear_pending_since` and
committing only after the configured window has elapsed continuously. A
per-channel rate ceiling over a one-hour window is the backstop against
redelivery storms; the approved defaults live in `DEFAULT_RATE_CEILINGS` in
`packages/alert-policies`.

## Reconciliation sweep

The evaluator runs a non-overlapping reconciliation sweep every five minutes.
It lists configured entities, evaluates them in batches of fifty, then heals
old wedged firing rows and garbage-collects `alert_state` rows that are no
longer derivable from the current policy settings. The sweep uses the same
evaluation and publication rules as signal-triggered work.

After each entity evaluation, a firing row is reconciled only when the entity
did not fail, the row has a confirmed publication, its policy is still known
and running, and the alert key was not produced by that evaluation. The normal
clear or debounce transition then resolves an alert whose later evaluation
omits it. Rows that no longer correspond to an enabled policy or configured
threshold are removed by the garbage-collection pass. Disabled configurations,
unknown policies, unconfirmed fire edges, and failed entity evaluations are not
cleared by omission.

The wedged-row age threshold defaults to fifteen minutes and must exceed the
sweep interval plus a two-minute publication-latency buffer. A sweep already
in progress runs to completion; ticks that fire while a sweep is in flight are
skipped, so the next sweep starts at the first tick after the current one
finishes.

## Re-deriving the per-cycle entity cap

`DEFAULT_MAX_WORK` and `MAX_ENTITIES_PER_EVALUATION_CYCLE` in
`src/consumer.ts` bound how many buffered entities one signal cycle
evaluates. The value is derived from production cycle cost, not chosen by
hand. Re-run the derivation when the cost per cycle changes (a read path is
added or removed) or when the eligible population changes (anything that
moves `entity_count` p99 toward the cap).

```bash
# Datadog US5 credentials, read-only logs scope
export DD_API_KEY=... DD_APP_KEY=...
bun scripts/derive-alert-evaluator-cycle-cap.ts --from now-7d --to now
```

The script reads `alert-evaluator.evaluation-cycle-summary` and
`alert-evaluator.policy-evaluation-cycle-summary` for signal cycles in the
window and prints, per entity-count bucket, cycle durations and read cost,
then the fixed cost (p50 of one-entity cycles), the marginal cost per entity
(from cap-sized cycles), how many entities fit the 2,000 ms flush interval at
the worst observed marginal cost, and a recommended cap. It keeps the current
value while the flush timer fires first in more than 99% of cycles and a
full-cap cycle fits the interval. If there are no cap-sized cycles in the
window the marginal cost is reported as unmeasured and the current value
stands.

When the recommendation changes, update both constants, paste the report into
the docblock above `DEFAULT_MAX_WORK`, and link the run in the PR.
