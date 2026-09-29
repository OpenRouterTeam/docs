# Alert delivery agent guidance

- Keep the worker single-container and Bun/tsup bundled.
- Parse received Pub/Sub messages as CloudEvents envelopes with
  `AlertEventV1ConsumingEnvelopeSchema`; keep the strict producer schemas for
  event construction and outbound webhook payloads. A context kind the
  consumer does not recognize is acknowledged without delivery.
- Use `Webhook.sign` for Standard Webhooks signatures; do not implement HMAC.
- Keep `fetchWithSsrfGuard` and the response-size cap on every outbound call to
  customer-controlled webhook and Slack destinations. The email transport uses
  the fixed Resend API host and client instead, with a capped provider error
  body read.
- Use structured `iLog`, `wLog`, and `eLog`; do not add console logging.
- Record one idempotent `alert_event_delivery` row per tenant/event/endpoint for
  webhook and Slack; email uses one endpoint-less row per tenant/event/policy
  with `channel = 'email'` and `endpoint_id = NULL`.
- Never modify the existing queue delivery task as part of this service.

## Test entrypoints

Four test entrypoints across three CI jobs — keep new tests inside one of them:

- `bun run test` — unit suites under `src`, excluding `*.integration.test.ts`
  (`bunfig.toml`). Runs in the shared `unit` job.
- `bun run test:integration` — Postgres-backed suites under `integration/`.
  Runs in the shared `integration` job via `scripts/ci/run-integration-tests.ts`
  (the service must stay listed in `ELIGIBLE_SUITES`).
- `src/pubsub-wire.integration.test.ts` — Pub/Sub-emulator wire test of the
  evaluator to delivery envelope seam. Runs in `ci-alert-delivery.yaml`, which
  provides both the emulator and Postgres.
- `src/cross-service-e2e.integration.test.ts` — full billing-signal through
  evaluator, alert-event, delivery, signing, sink, and ledger chain. Runs in
  `ci-alert-delivery.yaml`, whose job provisions the Spanner emulator and
  Postgres, with `integration/cross-service-preload.ts` providing the
  deterministic alert-delivery key and development Spanner environment.
