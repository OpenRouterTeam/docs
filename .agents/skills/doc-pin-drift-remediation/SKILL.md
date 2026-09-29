---
name: doc-pin-drift-remediation
description: >-
  Turn one doc-pin drift finding (a row in packages/router/adapters/doc-pin-drift.md, or a falsified pin from the weekly doc-pin sweep) into either an evidence-backed adapter change PR or a register status with no code change. Measures production exposure in ClickHouse, runs a four-arm native probe against the provider's own API with the /_providers dev key, applies the smallest mechanical edit, and writes a PR whose How to test carries the probe table and a ready-to-paste Datadog monitoring section for the affected provider and models.
user-invocable: true
---

# Doc-pin drift remediation

Input: one drift row (`packages/router/adapters/doc-pin-drift.md`) or one falsified pin from the doc-pin sweep. Output: one PR that changes what reaches the provider and carries the evidence for it, or a PR that removes the register row with the evidence for leaving the code alone. Either way the row leaves the register. Never both for the same row without evidence, never a code change on a doc quote alone.

The register's own rule governs: an entry changes nothing until it has exposure numbers and, where a key exists, a native probe result.

## 1. Triage

Classify before touching code. The row's Class column (or the sweep's classification of the pin) decides the path.

| Class | Default disposition |
| - | - |
| informational, matching, `changed_but_holds` | Delete the row, reason in the PR. No code change. |
| `unpublished` (doc is silent, code cites an observed 400 or a measured gateway behavior) | Keep the guard. Delete the row as `kept by measurement` once a probe shows the provider still rejects what the guard prevents, or `kept, unprobed` if no key. Only open a code PR if a probe shows the provider now accepts the guarded value, and exposure shows real traffic hitting the guard. |
| `stricter`, `looser`, `scope` | Proceed to exposure and probe. These change real traffic. |
| documented provider feature a proxy cannot offer (for example a source that the provider fetches with the caller's own cloud identity) | `not applicable (by design)`. Delete the row, no code change. Reword the pin comment to name the gap and the reason so the weekly sweep reads it as a match, not as stricter. |
| provider with no key in Infisical `dev` `/_providers` | `unverifiable (no <provider> key)`. Stop. Leave the row in place and name the missing key in the report so someone can add it. |

A pin that merely became undocumented (the claim vanished from the doc) is `unpublished`, not `looser`. Do not remove a guard because the doc stopped mentioning it.

Check which keys exist without printing values:

```bash
infisical secrets --env=dev --path=/_providers --include-imports=false --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 --plain 2>/dev/null | cut -d= -f1
```

If the CLI prompts for login, mint a token first: `infisical login --method=universal-auth --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --silent --plain` and pass it with `--token`.

## 2. Exposure (ClickHouse, production)

Use the ClickHouse MCP (read-only) against `default.generations`, last 30 days, filtered to the adapter's `provider_name` and, for per-model rows, `model_permaslug`. Report: request count, distinct API keys, top 5 models, and, where the field is visible in `request`, the count of requests whose value the change would alter.

Expect scrubbing. `messages`, `stop`, and similar fields are often redacted in `request`; a scrubbed field reads as the JSON string `"[scrubbed]"` (`JSONExtractString(assumeNotNull(request), 'stop') = '[scrubbed]'`) and an absent one as the string `"null"`, so `JSONHas` alone says nothing. Count presence with the `[scrubbed]` marker, write `field not measurable (scrubbed)` for the value, and fall back to the provider-level count. Never report a scrubbed field as zero exposure. Use `assumeNotNull(request)` before `JSONExtract*` to avoid `Nested type ... cannot be inside Nullable`. `tools` is in the scrub set too, so when the key is present it reads `"[scrubbed]"`. Check for the key before assuming a tool-shape row (server tools, `allowed_callers`, tool_choice variants) is measurable, since some request paths store no `tools` key at all. When it is absent, the stored `plugins` array (`{"identifier":"web","engine":"native"}`) is the only proxy for native web tools, and it must be labeled as a proxy.

The MCP query has a fixed timeout and `SETTINGS max_execution_time` is refused in read-only mode. On high-volume providers, narrow the window until the query returns (expressions over `request` need a much shorter window than a plain `count()`). Report the window you actually measured and label any extrapolation to 30 days as such; do not shrink the window silently.

For gateway providers (Bedrock, Vertex, Azure Foundry) break the presence count down by model author (`splitByChar('/', model_permaslug)[1]`) and read `provider_model_id` for each. Every author with traffic is a model family that step 3 must probe separately; the gateway's API schema bound is an envelope and the model behind it enforces its own, lower limit.

Exposure decides the rollout recommendation in step 6, not whether to proceed.

## 3. Native probe (four arms)

Direct calls to the provider's own API, bypassing OpenRouter, with the `/_providers` dev key. The runner lives next to the register:

```bash
cd packages/router
infisical run --env=dev --path=/_providers --include-imports=false --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
  -- bun adapters/doc-pin-probe/probe.ts <row> [--model <id>] [--arm baseline|proposed|negative]
```

Cases are declared in `adapters/doc-pin-probe/cases.ts`; transports (auth, signing, endpoint) in `transports.ts`; the fixed-format Markdown table in `report.ts`. For a new row, add a `ProbeCase` (row id, provider, field, models, three arms) locally and, if the provider is new, a transport. Do not commit the case: nothing reruns it and it dwarfs the behavior change a reviewer is there to read. Commit only transport or runner changes a later row cannot do without, and put the evidence in the PR instead, the probe table in How to test plus the request bodies and the raw runner transcript (key already scrubbed by the runner) in a collapsed `<details>` block, so a reviewer can rerun the probe without the case file. The runner prints only status, a bounded redacted error excerpt, model, region, environment and timestamp. A reject arm counts as `as expected` only on 400 or 422 whose error text matches the arm's `rejectionMatch` (a regex naming the field under test, e.g. `/generation_config\.top_k/`); any other non-2xx (401/403 bad key, 404 wrong model, 429, 5xx, redirects) or a 400 that names some other field is `INCONCLUSIVE` because the field under test was never evaluated. Capture the matcher from a first live run's excerpt. The runner exits 1 if any arm is `UNEXPECTED` or `INCONCLUSIVE`, or if the run is partial (`--arm`), so a standalone `--arm negative` run is a debugging aid and never a passing verdict; only a full run of every arm on every model prints `Verdict: every arm behaved as the case predicts.` The report header lists the models actually sent (so `--model` overrides are reflected), and the excerpt is scrubbed of the key we sent plus common token shapes a provider might echo back (bearer values, `?key=` query params, `sk-`/`AKIA`/`AIza`/`gsk_`/`csk-` prefixes, JWTs).

The three native arms and what each proves:

| Arm | Sends | Expect | Proves |
| - | - | - | - |
| baseline | the value the adapter forwards today | accept | key, model and request shape are valid; the table's 200s mean something |
| proposed | the value the adapter would forward after the change | accept for `stricter` (we widen), reject for `looser` (we must add a cap), per-doc for `scope` | the actual claim under test |
| negative | a value the doc says is invalid for the same field | reject | the provider validates this field at all, so a 200 on `proposed` is not silent ignoring |

If `negative` returns 200, the provider does not validate that bound. Change the negative value to one the provider does reject (a negative integer, an empty string, an incompatible parameter) and rerun. If nothing on that field is rejected, the field's range is unenforced and the row cannot be settled by probe; say so.

The fourth arm, confirm through OpenRouter, runs after the code edit in step 4: start local `cfw-api` (`bun run dev` per its AGENTS.md), send the `proposed` value through `/api/v1/chat/completions` pinned to the provider with `provider: { only: [<slug>] }`, and read `dev-fs-logs` to show the value reached the provider unchanged and the provider returned 200. Paste the log line (redacted) under the probe table. Send a value that exceeds every cap under test so `dev-fs-logs/.logs/<gen>/adapters/base-fetch-request.log` shows exactly the capped value reaching the provider. Follow `stage-endpoint` if `cfw-api` answers `Router config unavailable: could not be read from KV`: that is a catalog-publish failure in `cfw-internal`, not a routing problem, and clears once the scheduled refresh (`curl "http://localhost:8794/__scheduled?cron=*/5+*+*+*+*"`) logs a publish. `__scheduled` answers 200 when it enqueues the slot, not when the publish lands, and the publish is chained behind `provider-monitor`. If the 503 persists, run the publish directly (`curl -X POST http://localhost:8794/api/v1/internal/cron/trigger -H 'Content-Type: application/json' -d '{"task":"refresh-kv-models-and-endpoints"}'`, no auth in dev), then `tilt trigger kv-cache api` to drop the in-memory catalog caches. Bedrock `file` parts are sent as `format: pdf`, so the fourth-arm body must be a real PDF or Bedrock rejects it before validating the name. Start `cfw-api` with `WRANGLER_INSPECTOR_PORT=9239` when `cfw-internal` already owns 9229. Local endpoints may route to a different region or model prefix than the native probe, so read the model and region from the upstream URL in the log rather than assuming the native probe's.

Scope of a result: it holds for the provider account, model, region and timestamp in the table, under `dev` credentials. Per-model rows (Gemini ranges, Anthropic model generations, partner models) run one probe per model family via `--model`. Do not extend a result to models or regions not probed; list them as untested in the PR.

Runs are paced (1.5 s between calls) and sequential. Keep them that way; do not fan out.

## 4. Code change

Smallest mechanical edit at the pinned site. Update the `doc-pin` comment (claim and `checked YYYY-MM-DD`) and, if the source URL moved, the file's `doc-pin-source`. Add or adjust the unit test that asserts the new boundary; use `unit-test-writing` first. Delete the register row in the same PR. The register is a to-do list, not a record: the evidence lives in the PR description and the `doc-pin` comment at the site, so a fixed row has nothing left to track. Rows that end in a terminal status with no code change (`kept by measurement`, `kept, unprobed`, `unverifiable`) are also deleted, with the reason in the PR that removes them.

Group changes only when every row in the PR has its own probe table and exposure numbers. One PR per adapter or provider; mixed providers only when the change is a single shared helper.

## 5. PR description contract

`How to test` is functional evidence only, no lint or typecheck commands. Required, in order:

1. Current behavior, one sentence, with the file and line.
2. Post-fix behavior, one sentence.
3. Exposure block from step 2, with the query window and any `not measurable` note.
4. Probe table from step 3 verbatim, including `Key:` and `Region:` lines (they name the environment).
5. Through-OpenRouter confirmation line from the fourth arm, or `not run` with the reason.
6. Untested scope: models, regions, or providers the change touches that were not probed, and why.
7. Monitoring section (below).

## 6. Monitoring section (Datadog, `us5`)

Every behavior-change PR ends with this section, values filled in, as a top-level `## Post-deploy monitoring` heading with the queries visible. Do not put it inside the template's collapsed `<details>` block; a collapsed section reads as absent. Provider name matches `@extra.provider_name` (the display name, e.g. `Amazon Bedrock`, `Google AI Studio`, `Anthropic`); model uses the permaslug prefix.

```text
Provider/model rejections (primary):
  env:production "Endpoint returned error" @extra.provider_name:"<Provider>" @extra.raw_status:(400 OR 422) @extra.model:<slug-prefix>*
Provider error rate (broader):
  env:production "Transaction attempt" @extra.endpoint_error.status:>0 @extra.provider_name:"<Provider>"
Transform ledger (when the field is ledger-tracked):
  env:production "Endpoint returned error" @extra.raw_status:(400 OR 413 OR 415 OR 422) @extra.transform_ledger.changes:<field>
Baseline: same three queries over the 7 days before merge; state the daily count so "elevated" has a number.
Window: 24h after deploy for exposure < 1k req/day, 72h for more or for per-model rows.
Existing alert: transform_ledger_change_surge (configs/terraform-monitors/monitoring/) fires on 4xx spikes with a ledger change; note whether this field is in the ledger.
Revert: single commit, no migration. Name the commit.
```

Link the Logs explorer as `https://us5.datadoghq.com/logs?query=<url-encoded query>`.

Rollout gate: not required. Recommend a Statsig gate (per `dev-workflows/README.md`) when exposure is high (thousands of requests per day or hundreds of keys), the change is per-model and only some models were probed, or the negative arm needed more than one attempt to get a rejection. Say in the PR whether a gate was used and why not otherwise.

## 7. Register and skill upkeep

Update the row's Status and Checked columns in the same PR. If the run hit a gotcha (a provider that ignores a bound, a scrubbed exposure field, a model the dev key cannot reach), add one line to this skill.

## Gotchas

- Gemini `generateContent` accepts `topK: 0` (200) but rejects `topK: -1`; use a negative integer as the negative control for Gemini ranges.
- Anthropic with `thinking` enabled rejects `top_p < 0.95` and any `temperature != 1` on current Sonnet and Opus 4.x, so row 6 is `looser`-shaped: the guard is what keeps traffic alive, not a stricter-than-doc clamp.
- Bedrock `AMAZON_BEDROCK_API_KEY` is JSON `{ accessKeyId, secretAccessKey, region }`; the region in the table is the key's region, not the caller's.
- Status-only probes cannot settle "is the accepted field honored" rows. Measure the effect (usage counters, stream chunk sizes) with a one-off raw script, put the script and table in the PR, do not commit it.
- `dev` keys may sit behind different model allowlists and quotas than production; a 404 or 403 on `baseline` is an access problem, not a finding. Mark the model untested.
- A gateway schema bound is not a model bound (Bedrock Converse `stopSequences`: the envelope allows 2500, individual models cap at 4 or 10). A `stricter` row on a gateway adapter resolves per model family, and a shared guard stays unless every family with traffic was probed above it.
- `report.test.ts` asserts `PROBE_CASES` is empty, so a case left in `cases.ts` fails `bun run verify` before push. When the row leaves the register, also drop `see drift register` from the pin's commentary; the sweep skips validation of any pin still carrying it.
- Put the URL inline in each `doc-pin` when only one pin cites that document; use `doc-pin-source` only when several pins in the file share it.
- When the boundary lives in an extracted pure helper, test the helper only. Do not re-assert the same cap through the adapter's `transformRequest`.
- A `baseline` 400 saying the model "doesn't support" the field (Bedrock gpt-oss and GLM for `stopSequences`) is not a production defect: the serializer strips parameters the endpoint does not declare in `supported_parameters`, so the probe sends something OpenRouter never would. Record it as `not applicable (parameter stripped upstream)` and confirm with the exposure query that those models' requests with the field present finish normally.
