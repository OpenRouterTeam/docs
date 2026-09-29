# Model deprecation alert producer

This Cloud Run Job periodically discovers organizations that have opted into
`model-deprecated` alerts, reads their recent model usage, and publishes
endpoint-scoped and model-scoped alert events.

The job runs once per invocation. A Postgres cursor tracks the changelog
position and advances only after a complete publish pass succeeds. Alert event
delivery IDs are SHA-256 digests of `entity_id:alert_key`, so reruns are
idempotent through the alert delivery ledger.

Apply the producer stack (`services/gcp-model-dep-alert-producer/infra`) before
the evaluator stack (`services/alert-evaluator/infra`), because the evaluator
grants Pub/Sub publish to the service account created by the producer stack;
applying it first fails on a nonexistent IAM member.
