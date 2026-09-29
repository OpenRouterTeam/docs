# Alert evaluator agent guidance

- **Intake must make no database or network calls.** Buffer the signal first and perform I/O during flush. One serialized per-message round-trip on the singleton drops ack throughput below publish throughput (#31152).
- **Hot-path throughput must be quantified.** Every hot-path change must include `calls-per-message × arrival-rate × latency`, evaluated against a single instance, in the PR description.
- **Alert-state transitions must document column resets.** State which of `is_firing`, `last_triggered_at`, `last_delivery_id`, `event_published_at`, and `clear_pending_since` the transition touches and why (PLA-787).
- **Intake eligibility filtering is advisory and fail-open.** The cycle's per-policy enabled-config lookup remains authoritative; the reconciliation sweep is the correctness backstop.
- Threshold policies run in the evaluator. Broadcast-type alerts with no threshold, no clear edge, and no hysteresis do not run here. They consume `@openrouter-monorepo/alert-event-builder` from their own host. A second scheduler or heavy audience queries do not belong in the evaluator process.
