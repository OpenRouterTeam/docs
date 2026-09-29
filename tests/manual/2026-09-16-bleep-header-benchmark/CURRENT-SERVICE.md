# Current-service REDACT comparison

This separate mode measures the Bleep and Presidio services that handle the benchmark requests. It supplies operational evidence toward the replacement goal. It does not replace the exact-candidate evaluation or its artifact gate.

The original `redact-run.ts` entry point retains its deployment checks and Cloudflare credential requirement. The new `redact-current-service-run.ts` entry point requires `mode: current-service-redact-v1`. Neither entry point accepts the other admission mode. The original frozen proposal and evidence remain unchanged.

## Measurement scope

The mode retains all 240 REDACT slots, all 60 fixtures, opposite engine order, exact paired bodies, and the original phase sequence. The model, concurrency, response bounds, two-hour session deadline, cost reservations, charge reconciliation, and timeout stops remain unchanged. The read ceiling remains 90. Removed deployment reads do not increase the inference allowance or introduce retries.

Admission binds a reviewed evidence record and a full expected API version. Those records do not prove a downstream artifact for each request.

Each accepted request requires one exact DD match for its CF-Ray identifier, requested engine, expected API version, successful helper outcome, attempt counts, and charge. Every phase, including the first, must satisfy these checks before the next phase starts. Missing, duplicate, contradictory, truncated, or malformed evidence stops the session under the existing rules.

The current key policy is user-provided evidence. Its source hash stays separate from the execution observations. Admission does not assert independently verified admin eligibility or effective inherited guardrails. The header itself is not engine proof. The exact transaction match supplies observed engine selection.

The saved scope contains `per_request_artifact_verified: false` and `downstream_stability: unknown`. The mode makes no Cloudflare deployments request and reads no Cloudflare credential. Existing service logs can corroborate a downstream version, but missing logs cannot prove stability. Fleet telemetry is not a request join.

## Operator supervision

The operator must stop the session on any observed downstream version or deployment change. This mode has no automatic downstream version detector. Its saved field states `downstream_change_detection: operator_observation_only`.

Send SIGINT or SIGTERM to the current-service process to stop new dispatch. The process aborts active client transport and retains durable reservations. An abort does not prove that remote work drained. The session cannot resume, replace slots, or restart its journal.

A client timeout, unsafe response, missing charge, missing request telemetry, or a guardrail duration of at least 3,500 ms retains the original stop behavior. Unknown RPC drain ends the session. No quiet period permits continuation.

## Run the reviewed mode

1. Copy `redact-current-service-admission.example.json` to a private admission file.
1. Replace all placeholder hashes with the reviewed evidence hashes.
1. Supply the full API version from the current DD observation.
1. Keep every unknown or unverified field unchanged.
1. After source and measurement-contract review, set `enabled` to `true`.
1. Supply `BLEEP_REDACT_API_TOKEN` and `DD_ACCESS_TOKEN` through the approved environment.
1. Run the command with a new output directory:

```sh
bun run x tests/manual/2026-09-16-bleep-header-benchmark/redact-current-service-run.ts \
  /private/path/plan.disabled.json \
  /private/path/fixtures.json \
  /private/path/current-service-admission.json \
  /private/path/new-session-output \
  --execute
```

The result compares current engine-attributed guardrail latency and operational failures on these fixtures. It cannot attribute changes to SIMD, establish a stable downstream artifact, or measure complete sensitive-span removal. The exact candidate gate and independent quality work remain separate.
