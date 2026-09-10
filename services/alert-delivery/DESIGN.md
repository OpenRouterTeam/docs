# Alert delivery design and runbook

`alert-delivery` is an in-house Bun/TypeScript Cloud Run worker. The `svix`
package is used only as the MIT Standard Webhooks signing library; no
self-hosted server is deployed.

This document describes the service as it behaves on `main`. Decision history
lives in Git and Linear, not here.

For on-call recovery of stuck states, see
[`docs/runbooks/alert-platform-recovery.md`](../../docs/runbooks/alert-platform-recovery.md).

## Architecture

### Delivery projections and routing

Delivery failure reasons are defined once in `src/failure-taxonomy.ts`. Each
reason projects to its retry disposition, customer/terminal classification,
escalation policy, and circuit-breaker effect. Test events use the policy from
`src/test-event-policy.ts` for retry caps, ledger status, and rate-ceiling
projection. Delivery and rate-ceiling helpers return discriminated outcomes so
“allowed”, “fail open”, “denied”, and “already delivered” remain distinct.

Enabled alert policies retain their configured destination methods. The sender
registry maps endpoint types to policy methods before fan-out capping; webhook
and Slack both map to `webhook` because Slack has no separate policy method.
Email is delivered through the send-time `deliverEmailPolicy` path, not through
a sender-registry row. Email recipients are resolved at send time from
the policy's `alert_policy_settings.roles` and `people` selections. The worker
deduplicates active organization admins, scoped workspace admins, and explicit
people, omitting deleted, banned, or missing-email users. Addresses are never
persisted. Each email policy delivery creates one endpoint-less
`alert_event_delivery` row with `channel = 'email'` and `endpoint_id = NULL`,
then sends one addressed message per recipient through Resend's batch endpoint,
in requests of at most 100 messages. The delivery is marked delivered only
when no recipient batch failed or remained unattempted. Email uses
the fixed Resend API host and does not use the webhook SSRF guard or IP
pinning; webhook and Slack retain both protections. Resend provider error
bodies are capped at 4096 characters. The claimed `alert_event_delivery.id`
the batch index, and a 16-hex-character SHA-256 prefix of each sorted recipient
set are combined as the Resend `Idempotency-Key`. The resulting key is well
below Resend's documented 256-character maximum. Identical recipient batches
reuse the same key across redeliveries, so a failure partway through re-sends
earlier accepted batches within Resend's documented 24-hour idempotency window. Because the
key embeds the sorted recipient-set hash, a redelivery whose resolved recipient
set differs (a membership change between attempts) produces a different key and
so is not deduplicated by Resend — a recipient present in both sets can receive
the alert twice. This is accepted: recipient sets are stable within Resend's
idempotency window in practice, and a duplicate courtesy alert is preferable to
a dropped one. The single
ledger row retains only the final accepted batch's provider identifier. Email rate ceilings are
keyed per tenant for tenant-scoped policies, pooling that tenant's email policies into one bounded
recipient bucket, and per api key for api-key-scoped policies so each configured key has its own
ceiling rather than sharing its tenant's.

Resend rejects an entire batch request with a 422 when any single message is
invalid and does not identify the offending message. On a batch 422 the worker
falls back to sending each recipient as its own request under a stable
per-recipient idempotency key, so valid recipients still receive the alert and
invalid ones are isolated; the event is recorded delivered when at least one
recipient is accepted, and terminal only when every recipient is individually
rejected. Rejected-recipient counts are included in the delivered outcome log
so partial success is visible without making invalid addresses retryable. The
whole fallback loop shares one `DELIVERY_ATTEMPT_TIMEOUT_MS`
budget — the same bound as the single batch request it replaces — so it cannot
hold its delivery permit past the ack-deadline invariant; recipients not reached
within the budget return a retryable error and replay idempotently on the next
attempt.

The evaluator publishes a CloudEvents `AlertEventV1Envelope` to the
evaluator-owned `alert-events` topic. This worker uses a streaming pull
subscription with a configurable `DELIVERY_MAX_CONCURRENT_MESSAGES` limit
(default 8) and validates the canonical envelope from
`packages/queues/signals/alert-event.ts`. Endpoint delivery is bounded by
`DELIVERY_MAX_GLOBAL_ENDPOINT_CONCURRENCY` (default 12),
`DELIVERY_MAX_ENDPOINT_CONCURRENCY_PER_EVENT` (default 4), and
`DELIVERY_MAX_ENDPOINTS_PER_EVENT` (default 100). `DELIVERY_DB_POOL_MAX`
defaults to 28. The capacity arithmetic is
`2 x (8 messages x 1 notice fallback) + 12 permits = 28 connections`; boot
environment validation rejects configurations whose requirement exceeds the
pool maximum,
accounting for two database connections per concurrently resolved notice-batch
fallback tenant. Email recipient
resolution and endpoint lookup start concurrently, so each message can hold
two database connections before endpoint fan-out.
Waiting for a global endpoint-concurrency permit is bounded by
`DELIVERY_PERMIT_WAIT_TIMEOUT_MS` (default 60000), so a saturated worker
reports the stall instead of queueing behind slow deliveries indefinitely.
Notice-class endpoint and per-tenant email work additionally takes a permit
from a `DELIVERY_NOTICE_ENDPOINT_CONCURRENCY` sub-cap before the global permit.
When unset, the cap is derived as
`max(per_event, global - per_event - 1)`, which is 7 at the defaults of 12 and
4. An explicit override remains supported. Boot validation requires an
explicit sub-cap to be at least the per-event cap and at most
`global - per_event`; a derived default additionally requires
`global >= 2 x per_event` so the notice window is not empty. Notice-batch bulk email does not take
endpoint permits; it is bounded only by the Resend pacer, where
`RESEND_NOTICE_REQUESTS_PER_SECOND` (default 7) caps the notice share of
`RESEND_REQUESTS_PER_SECOND` (default 10) and validation keeps at least 1
request/s for transactional email.
The consumer prefers the published `alert_event_class` attribute and falls
back to its computed class when the attribute is absent or unsupported. A
recognized publisher/consumer divergence uses the published class, matching
the subscription routing decision. Notice-batch envelopes remain notice by
their envelope discriminant and do not consult the attribute.

Preferring the published class makes both the subscription routing and the
notice sub-cap only as strong as what the publisher stamps: a publisher that
stamps `transactional` on notice traffic defeats the filter and the
reservation together, where a purely in-process classification would still
have held the cap. This is deliberate. A class that disagrees between the
routing layer and the capacity layer is the worse failure, because the
sub-cap would then bound traffic that arrived on the other subscription. A
recognized disagreement logs `alert-delivery:event-class-divergence` with both
values. Divergence requires publisher/consumer deploy skew and self-heals once
both sides are on the same revision, so the warn log is the proportionate
signal and no monitor is warranted.

Email batches acquire and release that permit one batch at a time. The loop
normally attempts every batch before the row status is decided, unless a permit
acquisition times out or a provider-wide retryable failure stops it: accepted
batches are replayed by their deterministic idempotency keys,
while failed and unattempted recipient counts are recorded in the failure log
and row's last error. A permit timeout stops further acquisition attempts
because it indicates worker saturation; all remaining batches are counted as
unattempted and the row remains retryable for replay. The row is never marked
delivered while any batch remains failed or unattempted. If any batch fails with
a retryable error (timeout, 5xx, 429), the whole event is retried;
Resend suppresses identical requests for 24 hours, so only failed batches can
make progress on replay. A terminal batch failure (`email_terminal_4xx`) does
not stop later batches from being attempted. After all batches are attempted,
the row is terminal only when no retryable failure remains; the likely cause is
a bad recipient, which the per-recipient 422 fallback above already isolates
so the other recipients are not lost.

Provider-wide retryable failures stop the loop after the current batch, just as
permit saturation does: a rate limit (`rate_limited`), provider error
(`provider_error`), retriable server error (`retriable_5xx`), or transport
failure (`fetch_error`) says nothing about the remaining batches and continuing
would spend more permits while the provider is already unavailable. The
current batch is therefore failed because it was attempted, while later
batches are unattempted. Only `permit_timeout` means the current batch itself
never started. This distinction keeps the row retryable without misreporting
which recipients were actually handed to the provider.

Each failed batch also emits a batch-scoped diagnostic record with
`outcome_scope = 'batch'`, while the aggregate record represents the delivery
as a whole. Batch records preserve each independent provider or recipient
diagnosis, but are excluded from the aggregate attempt and failure metrics so
one delivery is not counted once per batch. The aggregate failure reason
prefers an attempted retryable failure, then any attempted failure, then the
first failure; the row's retryable status is derived independently from
whether any retryable failure exists. `fan_out_capped`, like
`permit_timeout` and `circuit_open`, is excluded from those aggregate metrics
because no customer delivery attempt occurred; batch-scoped diagnostics are
excluded because the unscoped aggregate record already represents the
delivery attempt. In the monitoring taxonomy the three still differ:
`permit_timeout` has its own dedicated monitor, `fan_out_capped` is covered by
its own endpoint-fan-out-capped event monitor, and `circuit_open` has no
dedicated monitor because operators are signalled by the breaker itself: the
repeatedly-opening-circuit monitor watches breaker open transitions, so the
per-message short-circuit records would only restate what that monitor already
alerts on.

The worker also exits
non-zero when `ALERT_DELIVERY_ENCRYPTION_KEY` is absent or does not decode to
32 bytes, before any DB or Pub/Sub setup. If `RESEND_API_KEY` is absent, email
delivery records a provider error at send time while webhook and Slack
delivery continue. `DELIVERY_CONSUMER_ENABLED`
defaults to `false`: the worker starts and serves `/healthz`, always attaches
its Pub/Sub message and error listeners, and acknowledges real events
in-handler without delivery while gated.

The event is PII-free and recipient-free. At delivery time the worker reads
tenant-scoped endpoint configuration and policy routing from Postgres. It
decrypts each stored webhook or Slack `EncryptedSecret`, signs the
customer-facing `WebhookPayloadV1` JSON with `Webhook.sign`, and sends
`svix-id`, `svix-timestamp`, and `svix-signature`; email resolves recipients
from the policy routing without storing their addresses.
Test events bypass the real-traffic gate only when `test` is true and their
deduplication key starts with `test:`; they use a capped retry path. Pub/Sub
retries with bounded backoff and moves poison messages to a seven-day DLQ
after the configured delivery-attempt cap. The worker's explicit per-endpoint
retry cap normally dead-letters retry exhaustion before the subscription cap.

Each webhook or Slack endpoint attempt claims one `alert_event_delivery` row
keyed by `(dedup_key, endpoint_id, channel)`. Email claims one endpoint-less
row keyed by `(dedup_key, channel)` where `endpoint_id IS NULL`. All paths
perform tenant-scoped reads using `entity_id`; pending, delivered, and failed
states make redelivery idempotent and ensure the message is acknowledged only
after the attempt outcome is recorded. Delivery history persists and returns the
structured `failure_reason`.

`alert_state.event_published_at` records publication to Pub/Sub, not customer
notification. Alert state remains evaluator-owned current-condition state and
deliberately carries no delivery outcome. The delivery ledger and the
event-level delivery outcome log are jointly the delivery evidence. Suppression
reasons are a separate axis from the delivery-failure taxonomy because retry,
terminality, customer causation, and breaker effects do not apply to them.
Skipped and failed outcomes carry whether a ledger row exists. An internal rate
ceiling or a permit timeout can defer work before the claim, leaving no durable
evidence. An event containing only rate-ceiling deferrals is labelled
`rate_ceiling_deferred`; one containing only permit timeouts is labelled
`worker_saturated`. `eligible_endpoints_no_evidence` covers errored or
delivered-but-unrecorded attempts and takes precedence over saturation and
pacing when an event contains an errored attempt. Saturation takes precedence
over pacing. Unevidenced skips retain their own log count. The event-outcome
record describes one processing attempt: at-least-once redelivery can produce
several records for one deferred alert, and a suppression reason means this
attempt produced no new durable evidence, not that the alert was never
delivered. Saturation is decided before any ledger read, so it cannot exclude
an alert delivered on an earlier attempt; consult the ledger for the alert's
delivery history.

Delivery also applies the retired-policy guard independently of the evaluator.
Before reading policy routing or endpoints, it checks the shared retired-policy
set. A retired-policy event is acknowledged without retrying and produces no
delivery or failure. Instead, the event outcome records one skipped outcome,
one unevidenced skipped outcome, and `retired_policy` as its suppression reason.
This is defense in depth for events published before the evaluator guard
existed or by the topic's other producer — the frontend API also holds
publisher rights on `alert-events` and publishes test events from the
notification-settings test route — while keeping the suppression visible in
delivery outcome logging rather than silently dropping the event.

### Endpoint auto-disable and owner notification

An endpoint is auto-disabled only when both conditions hold: it has at least
the configured count of consecutive terminal failures and there has been no
successful delivery for at least the configured spread period. Failures do not
need to be evenly distributed across that period. Only terminal failures
advance the counter, and any successful delivery resets the streak, so an old
streak start followed by recent terminal failures means the endpoint has
continued to reject delivery without a success in the intervening period.
Retryable failures cannot produce that shape because they do not advance the
counter.

The spread period is configured by
`DELIVERY_TERMINAL_FAILURE_SPREAD_DAYS`, defaults to
`TERMINAL_FAILURE_SPREAD_DAYS` (one day), and cannot be configured below that
one-day floor. The floor prevents configuration from turning the rule back
into count-only disabling; the period must also not exceed the terminal-failure
staleness window.

When a disable transition occurs for `terminal_4xx`, `http_error`,
`ssrf_blocked`, or `redirect_blocked`, delivery makes a best-effort owner
notification. The notification claims a row keyed by the endpoint and disable
transition timestamp before sending. That claim gives the email at-most-once
semantics: concurrent deliveries and redeliveries collapse onto one claim, and
a failed send still consumes the transition, so it is logged rather than
retried. Notification failure never rolls back the endpoint disable. The
feature is disabled by default and the send is bounded to ten seconds.

The recipient is the single canonical account-owner contact, and this
account-integrity email deliberately ignores account notification preferences.
Honoring an opt-out would be self-defeating when the endpoint just disabled may
be the account's only alerting channel: the account would lose all alerting
without a warning. Endpoint and owner reads are primary-pinned, and the
destination is masked before rendering. If the endpoint disappears between
the disable and notification reads, the worker records a skipped outcome
rather than treating the expected absence as a query failure.

## Customer-facing payload

`WebhookPayloadV1` is the version 1 customer-facing payload. Additive optional
fields and new `context.kind` members are non-breaking, and consumers must
ignore unknown fields and kinds. Renames, removals, and unit changes require
`WebhookPayloadV2`. Strict validation applies to producer-side validation of
payloads we emit; receivers should parse permissively and ignore unknown fields
and kinds. Received envelopes are parsed with
`AlertEventV1ConsumingEnvelopeSchema`: unknown fields are stripped and the event
is delivered normally, while an internal enum value this consumer does not
recognize (`context.kind`, `policyKey`, `state`, `context.interval`) is
acknowledged without delivery under the `unsupported-event` outcome, with a
warning naming the unsupported aspect and a monitor on that warning. Such events
are not dead-lettered, and the evaluator has already stamped the event published
and will not re-emit it for the same firing episode, so the alerts produced
during a skew window are lost rather than parked. Deploy enum widening
consumer-first: violating that order costs the skew-window alerts. Strict
validation
(`AlertEventV1Schema`) still applies where events are constructed, and a
recognized event that fails it is dead-lettered as a poison envelope.

## Network and SSRF boundary

Cloud Run uses `ALL_TRAFFIC` through a dedicated VPC, subnet, Cloud Router,
and Cloud NAT. The VPC has no peering or routes to internal service/database
networks. Egress firewall rules deny:

- `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`;
- `169.254.0.0/16` and `100.64.0.0/10`;
- IPv6 `fc00::/7` and `fe80::/10`.

The enforced rule precedence is:

- priority 1000 denies the private and special-use ranges above;
- priority 1100 allows TCP 443 to public IPv4 and IPv6 destinations;
- priority 1200 denies all remaining egress, overriding GCP's implied
  allow-all rule at priority 65535.

The priority-1050 exception allows TCP/6432 only to the concrete public IP of
the pg-us-central1 Cloud SQL primary used by the standard database pool. This
narrowly scoped database exception preserves the private-range SSRF boundary
and is a security-owner provisioning review item. Replica routing is currently
disabled; enabling it with positive replica weights would require adding the
replica public IPs to this rule.

GCP firewall evaluation uses resolved destination IPs, closing the DNS-rebinding
gap that URL-only validation cannot close. The application additionally uses
`fetchWithSsrfGuard`, which validates the initial URL and its resolved host and
pins the connect address. Because delivery passes `acceptNon2xx: true`, a 3xx
is returned to the caller rather than followed, so redirects are terminal,
customer-caused, non-retrying `endpoint_redirected` outcomes that do not
escalate the auto-disable counter on this path; the guard's per-hop
revalidation applies only to other consumers of the shared guard. The breaker
records that 3xx as a successful completed round trip and reachability result,
while the delivery ledger records a terminal failure because the alert was not
delivered. There is no Smokescreen sidecar.

Deployment owners must provision the dedicated subnet, NAT, and Terraform
permissions for Compute, Cloud Run, Pub/Sub, Secret Manager, and IAM. This
topology is not assumed to pre-exist.

## Signing and secret storage

Endpoint secrets are minted as random `whsec_` values and stored in
`alert_delivery_endpoint.signing_secret` as the canonical
`EncryptedSecret` JSON envelope:

```json
{ "ciphertext": "...", "nonce": "..." }
```

The database layer lives in `packages/db/alert-delivery-endpoints`. Plaintext
secrets never enter the database row, Pub/Sub envelope, or Terraform state.

### Secret transport tradeoff

Slack incoming-webhook URLs are bearer credentials and remain a
storage-at-rest risk until encrypted custody is implemented. The worker reads
the encrypted endpoint envelope from Postgres at delivery time and holds
`ALERT_DELIVERY_ENCRYPTION_KEY` to decrypt it. This keeps both plaintext
secrets and encrypted envelopes out of Pub/Sub; the key's blast radius
remains a security-owner review item.

The encrypted envelope carries no key identifier, so a rotation preserves
decryptability of existing endpoint secrets through the dual-key read path
rather than through a key version. See the key rotation runbook below.

## Retry, idempotency, and circuit breaking

Each endpoint attempt is recorded in `alert_event_delivery` before the
outbound request. Network and timeout errors, 5xx responses, circuit-open
outcomes, and ledger failures are retryable. Real alerts have a configurable
`DELIVERY_MAX_ATTEMPTS_PER_ENDPOINT` cap (default 8), below the
subscription's `max_delivery_attempts = 20`. This exhaustion cap applies only
to real alerts. Test events use their capped retry path and never enter this
exhaustion branch. Once a real alert's claimed endpoint attempt count
exceeds the cap, the worker does not make another outbound request. It records a
failed ledger row with `failure_reason = retry_exhausted` and
`is_terminal_failure = false`, then explicitly publishes the raw message to the
DLQ with `dead_letter_reason = retry-exhausted` and acknowledges the source
message. If publication fails, the source message is nacked. Exhaustion is a
non-terminal failure because the DLQ preserves the message for future recovery.
The delivery ledger row is the system of record for this evidence: it carries
the exhausted failure reason, is retained for thirty days, is queryable, and
feeds later delivery-history reporting. The DLQ copy is a seven-day artifact
that preserves the raw message for depth monitoring and manual inspection. The
ledger is authoritative. The only queue-only cases are the two poison paths,
undecodable messages and invalid envelopes, because they have no valid identity
from which to key a ledger row.

A permit wait that expires is this worker's own resource exhaustion rather than
an endpoint failing, so it is handled before the claim. The endpoint returns
`failure_reason = permit_timeout`, which is retryable, leaves the endpoint's
consecutive-terminal-failure counter and circuit breaker untouched, and writes
no ledger row: no attempt was claimed, and the claim owns the authoritative
attempt count. The failed outcome marks that absence of durable evidence, and
an event made up only of these outcomes is labelled `worker_saturated`. The
aggregated message result nacks, and Pub/Sub redelivers.
`alert_delivery_permit_timeout.tf` is the signal. Like `circuit_open`, the
reason is filtered out of the `openrouter.alert_delivery.attempt` and
`openrouter.alert_delivery.failure` metrics, because counting a permit we never
got as a delivery attempt would report our own saturation as customer endpoints
failing and drive the failure-rate ratio with a denominator of endpoints that
were never contacted.

That nack spends one of the subscription's delivery attempts without
advancing the per-endpoint attempt cap, because no ledger row is written. A
saturation that outlasts the whole backoff sequence therefore dead-letters the
message without the `retry_exhausted` ledger row that normally accompanies a
dead letter, leaving the DLQ copy, the failure logs, and the permit-timeout
monitor as its record. The ledger query that normally answers "did this endpoint
get the alert?" will not surface it, so a dead letter with no ledger row is
correlated back to an endpoint through those logs. Reaching that state means
delivery was saturated across hours of backoff, which the monitor
exists to surface long before.

The rate-ceiling check reads the current counter before the ledger claim. A
denied real alert therefore consumes no endpoint attempt and is nacked for
ordinary Pub/Sub backoff. Once the atomic ledger claim succeeds for a first
attempt, the worker consumes one rate slot before sending. The counter's
conditional increment prevents concurrent first attempts from inflating it
when the limit is already reached. Counter-read failures fail open so a
database read outage does not block delivery. A fresh pending ledger row is
never written off by the broker-attempt exhaustion check: it falls through to
the atomic claim, which returns the existing in-flight claim as retryable. The
ceiling bounds distinct alerts rather than attempts, so a pass that already
owns a ledger row is never denied, and an alert that loses the race for the
last slot in a window inherits that exemption and is delivered without
consuming one. This overshoot is bounded by the per-event endpoint
concurrency. Removing it entirely would require the ledger row to carry
whether a slot was ever spent, which was deliberately not built.
In a mixed fan-out, the aggregate uses the generic retry-exhausted reason while
the per-endpoint ledger rows remain authoritative for the individual reasons.
The broker's own dead-letter delivery may still have no reason attribute.

The worker's endpoint attempt cap, rather than the subscription's delivery cap,
uses the 10-second to 600-second bounded backoff and deliberately puts an
outage lasting roughly 20–30 minutes into the DLQ for manual recovery because
alerts are time-sensitive, rather than adopting a multi-day Svix-style retry
schedule. The subscription's delivery-attempt policy remains a fallback for
failures before the worker can record exhaustion. Nothing consumes either DLQ:
there is no replay worker, replay command, or DLQ subscription consumer, because
a dead-lettered alert describes a moment that has passed and is stale by the
time the queue is reviewed. The DLQ preserves the raw messages and its depth
monitor surfaces non-empty queues. The recovery route for an exhausted alert is
a new fire edge, which carries a new delivery identity and therefore a fresh
retry budget.

429 responses are transient failures like 5xx responses and are retried with
the bounded Pub/Sub backoff, starting at approximately 10 seconds. A
permanently throttled receiver reaches the DLQ after roughly 20–30 minutes
under the worker's bounded endpoint-attempt backoff, where DLQ-depth monitoring
surfaces it.
Non-429 4xx responses and
SSRF/redirect validation failures are terminal configuration or recipient
failures: they are recorded as `failed` ledger rows, logged, and `ack`ed.
Internal rate-ceiling denials are nacked without a ledger row or endpoint
failure, so retrying uses the subscription's bounded backoff rather than
polluting the DLQ. If the broker delivery cap is reached while the ceiling is
still denied, the worker records `retry_exhausted_rate_ceiling`, emits the
standard failure metric, and dead-letters with the same distinct reason without
incrementing terminal-failure or auto-disable state. Decryption/signing failures are nacked and redelivered. They remain
non-terminal `failed` ledger rows so they can be claimed again after the
underlying key or secret is fixed; acking them dropped the alert permanently
because nothing else redelivered the reclaimable row. Redelivery is bounded by
the per-endpoint attempt cap and the subscription's `max_delivery_attempts`;
after that, the failure becomes `retry_exhausted` and reaches the DLQ. The
delivery-failure disposition table defines this retry versus no-retry behavior.
A 3xx is classified as customer-caused, terminal, non-retrying
`endpoint_redirected` and does not escalate the auto-disable counter on this
path, while the shared guard's `redirect_blocked` classification is
unreachable because delivery accepts non-2xx responses.

The DLQ therefore contains only retryable outcomes that exhaust the per-endpoint
cap (5xx/network faults and decrypt/signing failures) and nacked processing
faults such as a ledger-write failure. Undecodable messages and invalid
envelopes are published directly to the `alert-delivery-dlq` topic with their
raw message bytes and `dead_letter_reason` attribute, plus `message_id` when
available, then acknowledged. If that publish fails, the source message is
nacked so Pub/Sub can retry it. Determining whether a customer got an alert
requires ledger rows with `status = 'failed'` and no `is_terminal_failure`
filter, plus the DLQ (retry-exhausted/infrastructure failures); otherwise a
global decrypt outage is invisible. Monitors and any delivery-history surface
must cover both.

The consumer attempts every endpoint for an event before deciding whether to
acknowledge or nack, with endpoint attempts fanned out concurrently. On
redelivery, an endpoint whose `(dedup_key, endpoint_id, channel)` row is
already `delivered` is skipped and is not POSTed again. A `failed` row marked
`is_terminal_failure` (terminal 4xx, SSRF validation, `http_error`, or
`endpoint_redirected`, including 3xx responses) is likewise skipped, since the
next attempt would fail identically. Otherwise, one atomic
`INSERT ... ON CONFLICT DO UPDATE ... WHERE status <> 'delivered'` claims the
attempt and increments its authoritative attempt count. A conflict against a
delivered row returns no row, so concurrent consumers cannot both claim and
POST the same delivered endpoint. The database unique constraint and receiver
`svix-id` deduplication remain additional safety backstops.

Post-claim ledger writes use the claimed `{status, attempts}` as an optimistic
concurrency guard, so a worker cannot overwrite a transition made by a
concurrent consumer. A delivered write that loses this race is logged as a
provider-accepted delivered no-op, preserving evidence that the provider
accepted the send while allowing the other consumer's outcome to stand.
Aggregate failure is logged before its guarded write, so a failure that loses
the race is observable rather than disappearing with the stale worker.

Each endpoint also has an in-process closed/open/half-open circuit breaker.
Five consecutive failures open the breaker for sixty seconds; one half-open
probe is permitted after the cooldown. State is process-local and approximate
under concurrency and scale-out; the registry is bounded by size and idle
eviction. Breaker state is not shared between instances.

Delivery is at-least-once, not exactly-once. A successful POST followed by a
ledger-write failure can cause a duplicate POST on redelivery. Generic webhook
receivers should deduplicate using `svix-id` (the event deduplication key);
Slack has no equivalent receiver-side idempotency header in this worker.

## Scale-out headroom and capacity

Cloud Run runs this worker at `min_instance_count = 1` and
`max_instance_count = 1`, so the bounds above are also the whole fleet's
bounds: 8 messages in flight, 12 concurrent endpoint attempts, and up to
`DELIVERY_DB_POOL_MAX` (28) connections against the pg-us-central1 primary.
The boot-environment parity test enforces these instance limits because the
circuit breaker and rate counters are process-local.
`DELIVERY_MAX_CONCURRENT_MESSAGES` shapes how much work one process admits; it
is per-process flow control and does not add capacity, so enough concurrently
slow endpoints saturate the message slots and the input subscription backs up
with no relief.

The two Datadog monitors on `alert-delivery-alert-events`
(`alert_delivery_subscription_backlog.tf` for oldest unacked message age,
`alert_delivery_input_backlog_depth.tf` for undelivered depth) exist to make
that saturation visible well before the subscription's 600s ack deadline and
`max_delivery_attempts = 20` convert a sustained backlog into dead-lettered
alerts. Their firing history is the evidence a capacity decision should be
made on.

Raising the instance ceiling above one requires three things the service does
not have:

- A stated fleet ceiling reconciled with the primary's connection budget. Each
  instance holds up to `DELIVERY_DB_POOL_MAX` connections, so an instance
  ceiling of N is a commitment of 28N connections; the ceiling must be chosen
  against the primary's remaining headroom rather than left implicit.
- A backlog-driven scaling signal. A pull consumer blocked on slow endpoints is
  nearly idle on CPU, so Cloud Run's CPU-based autoscaling never reacts to the
  failure mode that matters. Scaling has to be driven from
  `num_undelivered_messages` or `oldest_unacked_message_age`, which requires a
  mechanism outside the built-in autoscaler.
- An accepted per-endpoint pressure multiplier. Circuit-breaker state and
  in-process rate counters are process-local, so a fleet of N instances can
  send up to N times the concurrent attempts to one endpoint and needs N
  consecutive failures per instance before that endpoint is shed. Duplicate
  delivery stays bounded by the idempotent ledger claim, not by breaker state.

## Secrets and release

Infisical `/services/alert-delivery` synchronizes through
`ALERT_DELIVERY_{{secretKey}}` to Google Secret Manager. The dedicated key
chain is raw Infisical `ENCRYPTION_KEY` → GSM
`ALERT_DELIVERY_ENCRYPTION_KEY` → env `ALERT_DELIVERY_ENCRYPTION_KEY`.
Cloud Run receives the standard pg-us-central1 connection environment. The worker
reads its per-service SQL password through Secret Manager and composes the
pool URL at startup. Endpoint secret minting remains in the database package.

Release jobs are nursery/non-blocking:

- `build-alert-delivery`;
- `deploy-alert-delivery`;
- `apply-terraform-alert-delivery`.

The worker is single-container, so its deploy job does not use the optional
Cloud Run container selector.

### Key rotation runbook

The operational procedure is documented in the
[alert-delivery encryption key rotation runbook](../../docs/runbooks/alert-delivery-encryption-key-rotation.md).
The design rationale is that the alert-delivery encryption code supports
dual-key decryption, so no code change is needed during a key rotation.
Envelope versions identify the format generation, not the key used to encrypt a
row. For every recognized envelope version, decryption tries the current key
and then the configured previous key. AEAD authentication identifies the key
that actually encrypted the row.

Endpoint URL fingerprints are a keyed HMAC, so they change with the key and
cannot be probed by AEAD. Settings saves therefore match existing rows against
the fingerprints of *both* keys (`fingerprintAlertDeliveryEndpointUrlCandidates`)
and rewrite a matched pre-rotation row's `endpoint_url_encrypted` and
`endpoint_url_fingerprint` onto the current key in the same transaction. A save
during the rotation window keeps the endpoint row and its `whsec_` signing
secret; it does not mint a new secret. Settings saves need no operational gate.

The bulk re-encrypt job writes each row under a compare-and-swap guard on the
values it read (`applyAlertDeliveryReencryptWithQuery`), so a settings save that
lands mid-backfill is never clobbered or double-encrypted. A rejected row is
re-read and retried once; a row that still loses is counted as
`skipped_conflict`, logged, and left for the next run.
The script logs every count and exits non-zero when `skipped_conflict` or
`failed` is above zero, so an incomplete backfill cannot pass unnoticed. The
runbook covers the key ring setup, deployment ordering, re-encryption gate, and
previous-key retirement.

### Encrypted-column rollback

Rolling the encrypted endpoint columns back needs plaintext `endpoint_url`
values restored from the encrypted envelopes before `migrate:down` runs.
`scripts/reencrypt-alert-delivery-secrets.ts` only re-encrypts, so a rollback
needs a decrypt-and-backfill entry point written first.

Running `migrate:down` without that restore fails safely rather than deleting
endpoint rows: SQL cannot decrypt the envelope, so the guard refuses to drop the
encrypted columns while active rows still depend on them. The URL is lost only
if the encrypted columns are dropped without restoring plaintext first.

## Boot and infrastructure invariants

Alert-delivery enforces its cross-value configuration invariants in the
`AlertDeliveryEnvSchema.superRefine()` startup validation: message plus global
endpoint concurrency must fit within the Postgres pool; per-event concurrency
must not exceed global endpoint concurrency; the per-endpoint attempt cap must
stay below the Pub/Sub dead-letter attempt budget; and the terminal-failure
staleness and spread windows must not exceed ledger retention and the
staleness window, respectively. Auto-disable requires both at least the
configured count of consecutive terminal failures and a period with no
successful delivery. It does not require terminal failures to be evenly
distributed across that period. The service boot-parity and queue-parity tests load the production
Cloud Run literals through the real environment loader and compare Terraform
queue settings with application constants. `failure-reason-monitoring.ts` and
monitor parity keep the declared failure-reason monitoring contract aligned
with Terraform. One endpoint's permit wait plus one attempt, or one email
batch permit acquisition, must fit inside the subscription's ack deadline,
which queue parity keeps aligned with the Terraform value. A mid-loop email
timeout records `permit_timeout` and retries the whole event, so that deadline
bounds the window in which an endpoint produces no outcome at all and a
saturated worker reports `permit_timeout` within the
deadline the subscription was provisioned with. We deliberately do not extend
that into a per-message invariant across fan-out waves: delivery's Pub/Sub
client auto-extends leases for up to its 60-minute default, and endpoint work
includes database operations around the HTTP call, so the Terraform ack
deadline is not the load-bearing upper bound on total message processing. Under
total saturation the per-message worst case is one permit wait per fan-out wave,
about 25 minutes for a 100-endpoint event at the default per-event concurrency
of 4, all of it inside the lease-extension window rather than the ack deadline.
The boot-parity test also enforces the
single-instance Cloud Run assumption that keeps process-local breaker state and
rate-counter thresholds fleet-wide.

## Known limitations

- Test-event provenance rests on trusted producer IAM and the `test:`
  dedup-key prefix. There is no signed provenance on the envelope.
- Circuit-breaker state and rate counters are process-local, which is why the
  fleet is pinned to one instance (see Scale-out headroom and capacity).

### Provisioning verification (apply-time)

When the infrastructure is provisioned, verify:

- Pull consumption is enabled only after the existing topic, subscription, and
  `INTERNAL_ONLY` Cloud Run service are verified; a misconfiguration should be
  visible in subscription backlog and DLQ metrics.
- When flipping `DELIVERY_CONSUMER_ENABLED` to `true`, confirm the
  `alert-delivery:consumer-gated-in-prod` startup log no longer appears for the
  new revision. A remaining startup log means the gate is still set to `false`.
- The alert-delivery monitors are not silenced. They evaluate and hold state
  from the moment they are applied. `notification_preset_name = "hide_all"`
  only strips the query, handles, snapshots and footer links out of the
  notification body, so it changes what a message looks like and not whether
  one is sent. What decides that is the notification target the monitor
  interpolates, which is set in
  `configs/terraform-monitors/monitoring/alert_platform_targets.tf`. Read
  monitor state in Datadog rather than waiting for a page.
- Log-based metrics do not backfill, so a monitor built on one sits in `No
  Data` for its full no-data timeframe after the first apply. The
  fingerprint-mismatch monitor uses 60 minutes and alerts on `No Data`
  deliberately, so expect it to alert for about an hour after apply.
- The worker's `ALERT_DELIVERY_ENCRYPTION_KEY` from Infisical/GSM is
  byte-identical to the producer key used by `encryptAlertDeliverySecret`.
  Missing or wrongly sized key material fails startup before DB or Pub/Sub
  setup. A valid but mismatched key records every event as a `failed` ledger
  row with `is_terminal_failure = false`, so it remains re-claimable once the
  key is corrected. The consumer nacks and redelivers those events without
  touching the breaker; after retry exhaustion they reach the DLQ. Operational
  alerting must query `status = 'failed'` without filtering on
  `is_terminal_failure` to catch this configuration error.
- DNS resolution works under 443-only egress. GCP exempts the
  `169.254.169.254` metadata server, so name resolution is unaffected by the
  `169.254.0.0/16` deny. Confirm observability and metrics egress uses 443 or
  a localhost agent, since UDP and other non-443 traffic is denied.
