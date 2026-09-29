# Alert delivery

This README describes the service as it behaves on `main`. Decision history
lives in Git and Linear, not here.

`alert-delivery` is an in-house Bun/TypeScript Cloud Run worker and Pub/Sub pull
consumer. It consumes validated `AlertEventV1` CloudEvents published by the
alert evaluator and the alert-event builder, resolves recipients, and delivers
each event to the tenant's configured webhook, Slack and email destinations,
recording one idempotent `alert_event_delivery` ledger row per delivery. The
`svix` package is used only as the MIT Standard Webhooks signing library; no
self-hosted server is deployed.

- [`DESIGN.md`](./DESIGN.md) is the authoritative description of routing,
  recipient resolution, the ledger and its claim, concurrency and rate
  ceilings, retries, the DLQ, endpoint auto-disable, retention and
  finalization, and scale-out limits.
- [`AGENTS.md`](./AGENTS.md) holds the invariants to preserve when changing the
  service, and its test entrypoints.
- [`REVIEW.md`](./REVIEW.md) is the review checklist.
- [`docs/runbooks/alert-platform-recovery.md`](../../docs/runbooks/alert-platform-recovery.md)
  is the on-call runbook for stuck states across the alert platform, delivery
  included.

## Local development

```bash
bun run dev
```

The runtime env parser has no defaults for `PUBSUB_PROJECT_ID`, its two
subscription names or `ALERT_DELIVERY_ENCRYPTION_KEY`. `bun run dev` supplies
non-production Pub/Sub project and subscription defaults and maps Infisical's
`ENCRYPTION_KEY` to `ALERT_DELIVERY_ENCRYPTION_KEY`; production startup refuses
to start without the required Pub/Sub values or a usable encryption key.
`DELIVERY_CONSUMER_ENABLED` defaults to `false`: a local worker serves health
but consumes nothing until it is set.

## Terraform

From this service directory:

```bash
bun run terraform-or init
bun run terraform-or plan
bun run terraform-or apply
```

## Tests

See [`AGENTS.md`](./AGENTS.md) → Test entrypoints. Unit suites run under
`bun run test`; the Postgres, Pub/Sub-emulator and cross-service suites have
their own entrypoints and CI jobs.
