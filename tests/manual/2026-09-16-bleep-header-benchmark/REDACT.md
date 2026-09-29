# Prospective REDACT session

This offline amendment selects only REDACT slots from the immutable 480-slot proposal with SHA256 `232b0a5e253c857a5849a69db4d50b7cc242b5b05bc27d1ea8954aad96a80fff`. It preserves all 60 fixtures, both repetitions, pair bodies, and opposite engine order. It does not change that proposal or authorize execution.

The schedule has 240 completion slots: three non-operational phases of 64 requests, then 12 operational phases of four requests. Operational phases preserve increasing codepoint length and UTF-8 size, with the previous 8,000-codepoint timeout fixture last. The 42 unambiguous and six uncertain non-operational fixtures retain their distinct label scopes. This session measures performance. It does not establish private-span removal or replacement readiness.

Each pair uses the same existing reviewed REDACT key, model, and body. One arm uses `x-openrouter-bleep-primary: 1`. The other omits it. Both disable the Router response cache. The model remains `google/gemini-2.5-flash-lite`, without a pinned provider, with streaming disabled and at most eight completion tokens.

Concurrency remains one. Each request retains the existing 12-second deadline and 65,536-byte response cap. Quality phases allow 300 seconds and operational phases 60 seconds, within one shared two-hour wall/monotonic deadline. No retries, warmups, restarted journals, carried slots, or automatic replacements are allowed.

A new journal must durably reserve cost before dispatch. The whole next phase must fit the remaining planning budget before its first request. The budget is $1, with a $0.75 observed-charge stop and reservations for outstanding charges. This is a planning spend limit, not an account billing cap or a proven bound on all remote work.

## Scalar evidence

The bounded response reader projects the completion ID and numeric `usage.cost` in USD. It retains the response hash and size, not completion content. It computes the SHA256 of the complete received CF-Ray header and its exact identifier, and records the actual parsed colo. Missing or malformed identifiers cannot be repaired with a guessed colo.

Datadog queries use the exact request window and known completion IDs. Admission requires one log row per exact CF-Ray identifier hash, the expected contextual engine, pass/redacted outcome, and frozen API version. Duplicates, foreign matches, missing fields, pagination, saturated groups, and version changes remain unresolved. An aggregate average is a scalar observation only when its count is exactly one.

Router `invocations` and `attempted_endpoint_count` measure Router endpoint attempts. `provider_count` measures recorded provider responses. Continuation requires each to equal one, with the two attempt fields agreeing. These values do not measure independently billable attempts. `billableAttempts` remains null in this evidence mode.

The actual customer charge is the numeric response `usage.cost`, reconciled against the uniquely matched Datadog `extra.usage`, both in USD. `extra.usage_upstream` remains a separate optional upstream amount. Generation `upstream_inference_cost` is BYOK-specific and is not substituted for that field. Response `usage.is_byok` is projected when present. A true value stops this OpenRouter-billed lane. The Datadog query requires `extra.is_byok:false`, and generation metadata must also report false.

Every accepted USD number must be finite and nonnegative. Strings, NaN, missing values, and infinities are not coerced. The conversion rounds amounts upward to integer nanodollars. Agreement permits at most one nanodollar (`0.000000001 USD`) difference after that conversion. Settlement charges the larger accepted customer amount.

When response charge is absent, a bounded authenticated generation-metadata GET can supply the known generation's scalar ID, total cost, and status fields. It requests no generation content. A missing metadata record remains unknown. Contradictory known charge evidence stops the session. A fallback cannot erase that contradiction.

## Reconciliation and stops

All telemetry reads, including failures, pagination attempts, and generation-metadata reads, consume the shared ceiling of 90. Each phase allows at most three bounded Datadog polls at elapsed offsets 0, 30, and 90 seconds after phase completion. Waits remain inside the shared deadline. No later phase starts until every dispatched request has accepted engine, version, attempt, and charge evidence.

Stop new dispatch immediately on transport uncertainty, request/body/sink failure, or HTTP 408/429/503/504. Three other consecutive unexpected outcomes also stop dispatch. Missing charge or telemetry after the bounded window ends the session. A guardrail duration of at least 3,500 ms or any relevant deployment-version change stops later phases. Preserve all scheduled slots and every outstanding reservation.

A timeout does not prove that the remote RPC drained. Without attributable completion or outstanding-work evidence, the session ends with drain state unknown. Neither a fixed wait nor quiet fleet telemetry permits resumption. Client elapsed time, Router guardrail/total/upstream timing, actual colo, and version remain separate measurements. API version is not per-request model identity.

The wrapper and its controls must be frozen and independently reviewed before any production request. Effective deployment, existing guardrail, price, and key-budget evidence must be renewed then. No infrastructure, deployment, guardrail, dashboard, or key-budget mutation belongs to this wrapper.

## Deployment reads

The executor reads the existing `api`, `bleep`, and `presidio` Workers in account `056879e63aa83db17aadc76220f52953`. It sends direct GET requests to the Cloudflare deployments API. It does not deploy a Worker or change traffic allocation.

The raw API returns the latest deployment first. The Wrangler CLI sorts its JSON output differently, so that output cannot supply this parser. Admission requires one version with 100% allocation. Each deployment identity contains its deployment ID, full version ID, and `created_on` timestamp. A rollback or redeployment stops later phases, even with an unchanged version ID.

The executor reads all three deployments before inference. It reads Bleep and Presidio again after each of the 15 phases. These 33 reads share the 90-read limit with at most 45 Datadog reads. Thus, the worst-case poll schedule leaves 12 generation-metadata reads. Missing evidence after that limit stops the session.

Each telemetry request has a ten-second deadline and a 65,536-byte body cap. The adapter makes one HTTP request per reservation. Redirects, retries, automatic login, and automatic token refresh are disabled. A failed read consumes its reservation.

## Run the reviewed session

1. Preserve the original proposal and fixture files.
1. Copy `redact-admission.example.json` to a private admission file.
1. Replace its placeholder identities and evidence hashes with current reviewed evidence.
1. Set each admission assertion only after its evidence review.
1. Supply `BLEEP_REDACT_API_TOKEN`, `DD_ACCESS_TOKEN`, and `CLOUDFLARE_API_TOKEN` through the approved credential environment.
1. After the execution review, set `enabled` to `true` in the private admission file.
1. Run the command through the repository credential launcher with a new output directory:

```sh
bun run x tests/manual/2026-09-16-bleep-header-benchmark/redact-run.ts \
  /private/path/plan.disabled.json \
  /private/path/fixtures.json \
  /private/path/admission.json \
  /private/path/new-session-output \
  --execute
```

The launcher must preserve the reviewed existing REDACT token. The executor reads all three credentials once, after source and admission checks. Credentials remain in memory. The executor does not read the Wrangler credential file. An operator can supply an already-refreshed OAuth token through the explicit Cloudflare environment variable.

The output directory uses mode `0700`. Scalar files and the journal use exclusive creation and mode `0600`. The sink synchronizes file contents and directory entries before continuation. Existing output files cannot be replaced. A process restart cannot resume the journal or its request budget.

The output retains response hashes, billing scalars, deployment identities, and terminal slot status. It retains no response content, raw CF-Ray identifiers, or credentials. A stopped run exits with a failure code. Its journal preserves pending reservations and the last durable observations.
