# Unsent-only current-service supplement

This one-off amendment covers 176 never-dispatched slots after the original client stopped on a Datadog credential error. It does not resume the original session. The original record remains stopped at 64 of 240 requests.

Independent review reconciled all 64 successful original requests with exact engine, API-version, and charge evidence. Every original observation reports no active transport. The frozen terminal, journal, schedule, admission, source receipt, supervisor receipt, and reconciliation hashes bind that finding. Any changed or missing evidence prevents dispatch. The client also verifies all 43 original source files and the original proposal and fixture hashes.

The supplement selects only the 14 remaining complete phases. It preserves each phase, fixture, body, ordinal, and engine order. It excludes the original first phase permanently. A durable exclusive claim in the original evidence directory prevents another launch against that evidence directory. The claim remains consumed after a failure. Copying the evidence directory to evade the claim is outside this protocol.

The new journal permits 176 requests and 88 telemetry reads. The original failed read and the separate recovery read consume two reads. The original 64 charges consume 467,200 nanodollars. Remaining limits are 999,532,800 nanodollars for planning and 749,532,800 nanodollars for the observed stop. The original expiry remains `2026-09-18T03:37:55.600Z`. Both wall time and monotonic elapsed time enforce that expiry. No fresh two-hour allowance applies.

The supplemental schedule and terminal identify `current-service-unsent-supplement-v1`, the excluded count, residual limits, and original evidence hashes. The saved `scheduledSlots: 176` field describes this separate measurement. `originalScheduledSlots: 240` describes the complete original protocol. Reports must retain the original credential failure and separate measurement boundary. Original and supplemental requests share the 240-request total allowance.

Run the command with a new output directory:

```sh
bun tests/manual/2026-09-16-bleep-header-benchmark/redact-supplement-run.ts PLAN.json FIXTURES.json ORIGINAL_DIRECTORY NEW_OUTPUT_DIRECTORY --execute
```

The operator supplies `BLEEP_REDACT_API_TOKEN` and `DD_ACCESS_TOKEN` through the environment. The client does not read shell configuration or Cloudflare credentials. All current-service interpretation limits and transport, deadline, telemetry, and charge stops still apply.
