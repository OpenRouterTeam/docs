# Alert event builder

- Broadcast producers must derive delivery IDs deterministically from the
  announced identity, such as entity, endpoint, and deprecation date; never use
  `crypto.randomUUID()`. The recipient must be part of the identity because the
  email ledger's partial unique index is `(dedup_key, channel)` where
  `endpoint_id IS NULL`, without `entity_id`. The envelope builder already
  derives `dedupKey` as `entityId:alertKey:deliveryId`, so hosts must not bypass
  that derivation.
- A broadcast producer imports this package only, with zero imports from
  `services/alert-evaluator` and zero imports from `packages/db/alert-state`.
  Cross-run idempotency comes from deterministic keys plus an optional one-row
  cursor, never from firing state.
