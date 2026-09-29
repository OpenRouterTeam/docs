# Alert event builder agent guidance

- Threshold policies run in the alert evaluator. Broadcast-type alerts with no threshold, no clear edge, and no hysteresis do not run there. They consume `@openrouter-monorepo/alert-event-builder` from their own host.
- This package owns host-agnostic alert-event envelope and publication primitives.
- Broadcast producers import this package only, with zero imports from `services/alert-evaluator` and zero imports from `packages/db/alert-state`.
- Broadcast producers derive delivery IDs deterministically from the announced identity and never use `crypto.randomUUID()`.
- Do not bypass the envelope builder's `dedupKey` derivation.
- Include the recipient in the deduplication identity because the ledger's partial unique index uses `(dedup_key, channel)` without `entity_id`.
- Cross-run idempotency comes from deterministic keys plus an optional one-row cursor, never from firing state.
- Keep no direct dependency on `packages/db`. Runtime imports are limited to `alert-policies`, `alert-policies-runtime` (evaluation types and `formatAlertMessage`), `queues` (envelope schemas), `instrumentation`, and `helpers`.
- Notice producers publish through `publishNoticeShards` (`notice-shards.ts`): collect tenants per alert key with `addToNoticeAudience`, then publish each audience once. Never re-implement the shard loop in a service; pass the service's literal log event names as `logEvents` so its monitor-parity test keeps working.

## Adding a notice policy

A notice policy is externally produced, has no threshold, and fans out as tenant shards. Register it in this order; each step is compile-enforced except where noted.

1. `packages/alert-policies`: add the key to `ALERT_POLICY_KEYS` and `ALERT_NOTICE_POLICY_KEYS`, a `<key>-context.ts` module with the Zod context schema (`kind` literal equal to the key), the `ALERT_POLICY_META` entry, and the `NOTICE_POLICIES` entry in `notice-policies.ts` (event source, event type, accepted context scopes).
2. `packages/queues/signals/alert-event.ts`: add the context schema to `alertEventContextSchemas`, a producing arm and a consuming arm to the notice unions, and an envelope arm keyed on `NOTICE_POLICIES[key]`. Regenerate the committed artifacts with `bun run generate:alert-event-schema` and `bun run generate:webhook-payload-schema`.
3. `packages/alert-keys`: `ALERT_POLICY_KEY_DEFINITIONS` entry. `packages/alert-policies-runtime`: `AlertEvaluationSchemas` arm, `formatAlertMessage` branch, `ALERT_POLICY_RUNTIMES` entry. `packages/alert-formatters`: `ALERT_POLICY_PRESENTERS` entry. `packages/queues/signals/webhook-payload-registry.ts`: `WEBHOOK_PAYLOAD_REGISTRY` entry.
4. Producer: build the evaluation, call `addToNoticeAudience` per tenant, then `publishNoticeShards` with a literal `logEvents` table for the new prefix, and add those events to the failures monitor under `configs/terraform-monitors/monitoring/alert_producer_model_dep`. `cfw-frontend-api`'s test-webhook route needs a sample context in `getTestWebhookPolicyPayload`; its `default: policyKey satisfies never` arm fails to compile until the arm exists.
5. Runtime-only sites (no compile error if missed): the Postgres `CHECK` constraint on `alert_policy_settings.policy_key` needs a migration; `UNGATED_ALERT_POLICY_KEYS` in the web notifications page and `NOTIFICATION_DECORATIONS` in `packages/frontend/notification-settings` need entries.

Delivery needs no change: `services/alert-delivery` dispatches on `NOTICE_POLICIES` and the shard consumer is policy-agnostic.
