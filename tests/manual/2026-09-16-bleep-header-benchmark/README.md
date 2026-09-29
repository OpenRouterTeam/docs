# Header benchmark through the existing Router path

This manual client compares paired requests to `/api/v1/chat/completions`. One arm sends `x-openrouter-bleep-primary: 1`; the other omits it. Both use the same explicit API token, model, messages, and existing guardrail. This directory does not deploy a Worker, add a route, or change a guardrail.

[Selected schedules and session budgets](SELECTED.md) describes the explicit schedule API and durable budget journal. The [prospective REDACT session](REDACT.md) adds the executable 240-slot wrapper and bounded scalar telemetry reads. Its production run remains pending.

Both arms send `x-openrouter-cache: false` so a preset cannot serve a cached completion instead of running the guardrail. This header does not disable Presidio's separate analyzer cache.

## Prerequisites

An operator must confirm that the candidate service and Router integration are deployed before sending requests. Use an internal admin key with an existing PERSON/LOCATION guardrail. The header gate requires the global region and excludes HIPAA and performance mode. A request header alone does not prove that Bleep ran. The client deliberately records `engineEvidence: unverified` for both arms.

The admin and header checks occur in the upstream API worker. Any `SVC_BLEEP` caller can select the hybrid with `request_context_v2`; the RPC entrypoint does not repeat those checks. Artifact hashes verify the supplied Bleep export's identity, not network isolation. This integration does not enforce runtime egress restrictions.

Inspect the effective guardrail configuration before testing. PERSON and LOCATION confidence thresholds must both be **0.4** to reproduce the fixed candidate's evaluated helper thresholds. The candidate policy head uses **0.8**. The configuration's `guardrail` fields record the operator's assertion; they do not configure or discover the server's guardrail. Conflicting inherited guardrails or other filters can make comparisons invalid.

Run BLOCK and REDACT separately with a pre-existing key configuration for each action. Keep the same token within each paired run. Do not switch modes by assuming that a request field overrides the saved guardrail. This client does not edit guardrails or obtain credentials.

The target policy protects private person names and specific private addresses. Handles, usernames, and emails are outside PERSON. Standalone city/state/country information is preserved; those components are protected when part of a specific private address. Standalone postcode policy remains unresolved.

## First run

Copy `config.disabled.json` to a local file outside the repository. Replace `REPLACE_WITH_APPROVED_ENDPOINT` with the explicitly approved HTTPS endpoint ending in `/api/v1/chat/completions`. Set the approved model, enable execution, and confirm the two guardrail assertions after inspecting their effective values. Keep the initial one round and concurrency one: **12 requests total**, six per header arm. Fixtures include clean text, an invented private person, an invented private address, multiple text segments, long ASCII text, and long Unicode text. They are operational controls, not independently labeled quality data.

Create a separate, permission-restricted secrets file outside the repository with one field, `apiToken`. Never commit that file, paste the token into a command, or include it in a report. The client reads only the supplied file; it does not inspect environment variables or credential stores.

Run from the repository root after approval of the deployed revision and request budget:

```sh
bun run tests/manual/2026-09-16-bleep-header-benchmark/run.ts /absolute/path/config.json /absolute/path/secrets.json /absolute/path/new-results --execute
```

Execution requires both `enabled: true` and `--execute`. Output directories must be new. Each completed observation is appended as one physical JSONL line, containing scalar outcomes, sizes, elapsed times, and hashes. Each observation records whether a request was reserved and dispatched, and whether its transport may remain active after cancellation. Reports contain no response text, request text, or secrets. If the record sink fails, the client stops dispatch, aborts active requests, waits for their bounded outcomes, and returns `record_sink_failed`; incomplete output must not be treated as a complete benchmark. A hash of `cf-ray` permits matching independently hashed operational records without exporting the raw header. Preserve the local configuration alongside the results; `run.json` binds its hash.

Inspect failures and gate telemetry before approving another phase. A later phase may use up to 20 rounds and concurrency four: **240 requests maximum per invocation**. No phase starts automatically. The client sends no retries or warmups. Every request has a complete-response deadline; phase deadlines stop new dispatch and shorten in-flight deadlines. Any timeout stops the entire phase and aborts the other active requests. The dispatcher checks active absolute deadlines before reserving or dispatching more work, even when a timer callback is delayed. Transport errors and body-limit outcomes also stop the phase because remote work may remain active. Response bodies are capped. Redirects fail rather than forwarding authorization to another endpoint. These are end-to-end completion timings, including provider time; they are not detector CPU timings.

Client aborts do not establish cancellation of Worker RPCs. The Router's four-second filtering timeout leaves at most one unfinished RPC per invocation because scanning is sequential. Provider retries can restart filtering with a fresh deadline, allowing unfinished RPCs to accumulate across attempts. Use the bounded Cloudflare probe to measure timeouts, unfinished-call drain time, and CPU before increasing rounds or concurrency.

## Interpreting results

The client groups successful-completion latency separately from API errors, HTTP errors, malformed responses, body-limit failures, transport failures, deadlines, cancelled requests, and skipped requests. A guardrail BLOCK may be represented by an API error, so `api_error` alone does not prove an operational failure or a correct block. There is no automatic success threshold in this initial probe.

A non-null error in any response choice counts as `api_error`, including partial completions and mixed successful/error choices. These responses do not enter successful-completion latency percentiles. Error details and partial completion text are not saved.

Use server-side gate and service telemetry to establish which engine executed, the deployed candidate revision, detector latency, CPU, memory, initialization, and failures. Match requested arms and timestamps with those measurements. Do not infer engine selection or fallback behavior from the header alone. Do not infer cold starts from the first client request.

Existing post-filter `Transaction attempt` logs carry plugin metadata with `contextual_engine`, `contextual_outcome`, and, for errors, `contextual_error`. Confirm `contextual_engine: bleep` or `presidio` there; missing metadata means unknown or skipped. The earlier `Initializing plugins` log does not prove execution. Fail-closed Bleep requests also emit `bleep_primary_content_filter_failed_closed` with a generation ID. The `openrouter.plugin.content_filter.latency` metric has `filter_mode` and `outcome` tags; `filter_mode: combined` alone does not identify the contextual engine.

Repeated fixtures can hit Presidio's analyzer cache. Its `Presidio RPC completed` logs expose `cache_state`, cache hit/miss/backend-call counts, `total_ms`, `container_fetch_ms`, and `is_cold_start`. The `presidio.total.duration_ms` metric includes `cache_state`. Separate those states when interpreting timings; these six repeated inputs do not measure uncached inference alone. The existing Bleep HTTP instrumentation does not establish learned RPC CPU, memory, or model revision; obtain those independently before making those claims.

BLOCK correctness requires evidence that no provider dispatch occurred. REDACT correctness requires inspection of the provider-bound payload under an authorized test harness; the public completion cannot prove redaction. This client intentionally does not export production requests or capture provider-bound payloads. Existing local Router evidence remains the source of those product checks until an approved production measurement path exists.

The six fixtures do not establish representative production load, independent quality, full length coverage, or replacement readiness. They answer whether the actual header path is operational enough to justify the next benchmark phase.

## Offline controls

The test file injects fake fetch responses and sends no network requests. Its scoped Vitest configuration does not load the manual suite's database or environment setup:

```sh
bun run --cwd tests/manual vitest run --config 2026-09-16-bleep-header-benchmark/vitest.config.ts
```
