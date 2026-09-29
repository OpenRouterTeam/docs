# Dropped-stream cancellation repro + canary verification

Repro and verification harness for the dropped-stream billing bug.

- Slack: escalation thread `C05F41UHEE7`, eng thread `C076N2PHWGJ`
- Symptom: streaming requests dropped mid-stream are **not recorded or billed**;
  the worker dies with `waitUntil() tasks did not complete within the allowed
  time after invocation end and have been cancelled...`.
- Root cause (Abhinav, 5/30): client-cancellation detection is unreliable.
  `ReadableStream.cancel()` doesn't reliably fire and the downstream writer
  hangs instead of rejecting. The reliable signal is the incoming request's
  `AbortSignal`, which only fires `abort` with the `enable_request_signal`
  compat flag.

## The PR stack under test

| PR | What | Branch |
| --- | --- | --- |
| [#22656](https://github.com/OpenRouterTeam/openrouter-web/pull/22656) | `enable_request_signal` compat flag | `seawatts/enable-request-signal-flag` |
| [#22632](https://github.com/OpenRouterTeam/openrouter-web/pull/22632) | client-cancel breadcrumbs (+ chat-completions/messages coverage) | `devin/1780163476-client-cancel-breadcrumbs` |
| [#22657](https://github.com/OpenRouterTeam/openrouter-web/pull/22657) | Client Cancellation Detection dashboard | `seawatts/client-cancel-detection-dashboard` |

The flag and breadcrumbs must both be live on the canary worker version for the
`request_signal` path to fire.

## Breadcrumbs to look for

Emitted from cfw-api on the responses / chat-completions / messages routes:

| Breadcrumb | Meaning |
| --- | --- |
| `client_cancel_request_signal_exists` | request exposed an `AbortSignal` (proves the compat flag is live) |
| `client_cancel_request_signal_initially_aborted` | signal was already aborted at setup |
| `client_cancel_detected_by_request_signal` | **reliable** path — `AbortSignal` fired `abort` |
| `client_cancel_detected_by_response_body_cancel` | `ReadableStream.cancel()` fired (unreliable) |
| `client_cancel_detected_by_downstream_write_failure` | `StreamBreaker` downstream write/close rejected (unreliable) |

## Running the repro

This is a **manual** test (not run in CI). It needs live providers and should be
pointed at the canary worker version that has #22656 + #22632 deployed.

```bash
OPENROUTER_API_BASE=https://openrouter.ai \
OPENROUTER_API_KEY=sk-or-... \
CLOUDFLARE_VERSION=<canary-version-id> \
bunx vitest run tests/manual/bugs/05-30-2026-dropped-stream-cancellation
```

`CLOUDFLARE_VERSION` sets the `Cloudflare-Workers-Version-Overrides` header, so
the request is served by the canary version regardless of the 0% rollout
percentage (same mechanism as the `test-do-offloading` skill).

The test streams a long response across five cases — Bedrock and Vertex
(`can_abort=false`, the broken path), OpenAI and Azure (`can_abort=true`,
the working-but-flaky path), and a **supersize offload** case (Vertex with a
>128 KiB base64 image + `x-offload-large-fields`, which routes the request body
through the `ProcessStreamJson` Durable Object) — disconnects after the first
few content chunks, and logs the `generation_id` for each.

The supersize case proves the disconnect breadcrumbs + billing still fire when
the request was assembled in the DO. Confirm the request really took the
offload path in Datadog — the `durable_object_id` breadcrumb is only emitted
when a field is actually offloaded to the `ProcessStreamJson` DO:

```text
service:api @script_name:api @breadcrumbs.generation_id:<gen-id>
  @breadcrumbs.durable_object_id:*
```

## Verifying in Datadog

For each `generation_id` the test prints, confirm which detection path fired:

```text
service:api @script_name:api @breadcrumbs.generation_id:<gen-id>
  (@breadcrumbs.client_cancel_detected_by_request_signal:*
   OR @breadcrumbs.client_cancel_detected_by_response_body_cancel:*
   OR @breadcrumbs.client_cancel_detected_by_downstream_write_failure:*)
```

Also check the setup breadcrumb is present (proves the flag is live on the
canary):

```text
service:api @script_name:api @breadcrumbs.generation_id:<gen-id>
  @breadcrumbs.client_cancel_request_signal_exists:true
```

And confirm the request was billed (no silent drop):

```text
service:api @script_name:api "Transaction attempt" @breadcrumbs.generation_id:<gen-id>
```

The **Client Cancellation Detection** dashboard (#22657) aggregates all of the
above per `@breadcrumbs.last_endpoint`.

## Expected outcome (hypothesis to confirm)

- `can_abort=false` (Bedrock/Vertex): pre-flag, no detection breadcrumb fires
  and a `waitUntil() tasks did not complete...` timeout follows. Post-flag,
  `client_cancel_detected_by_request_signal` should fire reliably.
- `can_abort=true` (OpenAI/Azure): detection is flaky today; record which path
  fires (and how often it is `request_signal` vs `response_body_cancel` vs
  `downstream_write_failure`) per Abhinav's note.

## Status

- ⏳ **Blocked on a canary deploy.** As of writing, neither the compat flag nor
  the breadcrumbs are deployed, so the breadcrumb queries return 0 (verified
  baseline). Run the steps above once #22656 + #22632 are live on a canary
  version, then fill in the observed detection path per provider.
