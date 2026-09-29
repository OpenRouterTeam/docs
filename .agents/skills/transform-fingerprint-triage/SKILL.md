---
name: transform-fingerprint-triage
description: >-
  Triage of upstream 400/413/415/422 rejections our own request transform may
  have caused. Groups sampled provider errors by provider, model, error body
  and transform_ledger change, keeps the groups whose error names a field we
  changed, settles attribution with a four-arm synthetic experiment against the
  real provider (reproduce, counterfactual, negative control, confirm fix),
  files into the Transform Fingerprint Triage Linear project, and posts one
  Slack digest to #provider-error-triage. Runs on the Datadog surge
  alert, on a daily sweep, or on demand.
user-invocable: true
---

# Transform Fingerprint Triage

One question per group of upstream rejections: did our transform cause it, did
the client, or is it unknown. Record every answer in Linear, keep only the
answers the experiment proves ours open on the board, and fix only those. How
you query, read code and build the experiment is your call. This document is
the evidence you have, the constraints that keep a run safe and honest, and the
outputs the rest of the team depends on.

## Evidence

Every failed provider attempt logs `"Endpoint returned error"` with the
pre-mapping status in `@extra.raw_status`. A sampled share of 4xx (rate in the
`client_error_sample_rate` live-config key) also carries two instruments under
`@extra.`, both recording names and shapes, never values:

- `transform_fingerprint` (`packages/routing/helpers/build-transform-fingerprint.ts`,
  every surface): key names added and removed between the client request and
  the body we sent upstream, plus allowlisted nested keys. It cannot tell a
  rename from a drop, its lists are sorted and capped, and nested keys outside
  the allowlist are invisible. `nested_unknown_keys_count` is never evidence.
- `transform_ledger` (`packages/router/helpers/transform-ledger.ts`, chat only):
  one `<stage>:<field>` token per request-shape field that changed at `plugins`
  (`packages/router/plugins`), `adapter_input` (the adapter's `getBaseInput`
  and input transforms) or `serialize` (the adapter's serializer). Only
  `serialize` reaches the wire directly.

Both say we changed something, not that the change was wrong. Attribution
starts from the provider's error text and is settled by the experiment.

Ledger tokens name shape fields, not wire keys:

| Ledger field | What changed | Provider fields it can explain |
| -- | -- | -- |
| `roles` | role vocabulary, ordering, system placement | `role`, `system`, `messages`, `instructions` |
| `turn_count` | messages merged, split, inserted | `messages`, alternation rules |
| `tool_count` | tools added or dropped | `tools`, `functions`, `tool_config` |
| `tool_choice` | tool choice set, cleared, renamed | `tool_choice`, `tool_config.function_calling_config` |
| `response_format` | structured output added, dropped, reshaped | `response_format`, `text.format`, `response_schema`, `generationConfig` |
| `messages_with_tool_calls` | tool-call messages rewritten | `tool_calls`, `tool_use`, `functionCall` |
| `messages_with_reasoning` | reasoning parts added or stripped | `reasoning`, `reasoning_content`, `thinking` |
| `empty_content_messages` | empty content introduced or removed | `content`, empty-message rejections |

## Triggers

- **Alert.** `configs/terraform-monitors/monitoring/transform_ledger_change_surge.tf`
  posts to `#alerts-providers-low-signal` when one (provider, `raw_status`,
  `ledger_change`) group of `openrouter.transform_ledger.change_4xx` clears
  its volume gate and exceeds a multiple of the trailing 24h baseline, the
  mean of the previous four 6h windows. Pin every query to those three values
  over the 6h window ending at the alert, quoting the ledger token because of
  its colon. Recovery messages are not triggers. If `#provider-error-triage`
  already holds a verdict for the same group and field within 24h, post the
  dedupe reply in section 6 and stop.
- **Daily sweep.** Steady-state groups never alert. Cover the last 24h across
  all providers, file, post the sweep readout.
- **Manual.** Same as the sweep, but show candidates before filing and ask
  before posting to Slack.

## Access

- `DD_API_KEY` and an unscoped `DD_APP_KEY` on `us5.datadoghq.com`. Scoped app
  keys get `Forbidden` from logs analytics.
- Linear MCP: team Ecosystem, project Transform Fingerprint Triage,
  suppression registry issue `ECO-3140`.
- Slack via the native tool: `#provider-error-triage` (`C0BRDK698EN`). The
  alert itself lands in `#alerts-providers-low-signal` (`C08E2981G3B`), which
  the run reads and never posts to.
- Experiment only: an OpenRouter API key reserved for triage, plus the
  provider's own key for the provider-native arm. Without them, report the
  experiment as not run.

## Guardrails

- Datadog is read-only. Monitors change through Terraform.
- Never quote request values or paste a provider body carrying user content.
  Quote the normalized error sentence only.
- Experiment requests are synthetic, built from the group's shape tokens and
  key names with placeholder values. No captured traffic is stored or replayed.
- Experiments spend real provider calls: triage keys, the group's cheapest
  endpoint, `max_tokens: 1`, at most ten attempts per arm.
- Findings live in Linear. Only adapter/transform fixes live in the repo,
  never auto-merged. Metadata, capability, security, billing, routing and
  privacy findings get an issue only. A run never edits this skill or opens
  any other PR.
- Every verdict, issue and digest leads with the mechanism in one plain
  sentence: what we changed at which stage and what the provider rejected, or
  what the caller sent untouched and why the provider rejected it. Gate
  conditions, matrix rows and class labels never stand in for that sentence.

## 1. Pull and group

The alert and sweep population is what the metric counts:

```
env:production "Endpoint returned error" @extra.raw_status:(400 OR 413 OR 415 OR 422) @extra.transform_ledger.changes:*
```

A manual run may swap the ledger term for
`@extra.transform_fingerprint.nested_unknown_keys_count:>=0` to reach non-chat
surfaces. The two populations overlap only partly; never read a count from one
against a threshold set on the other.

An error group is (provider, model, normalized error body), plus the ledger
token on the ledger population. Normalize bodies by stripping ids, numbers and
quoted values. Group facets together in one aggregate, since marginal counts
from separate calls share no key.

Sweep and manual runs keep groups at or above 50 sampled events per day and
must be able to say they saw every group above that floor. Enumerate
partitions on the bounded facets first (provider, status, ledger token), drop
those under the floor, then pull groups per partition. Status and ledger token
are closed sets (four statuses; three stages by eight fields), so a full result
there is complete. Any open facet (provider, model, body, endpoint) returned at
its limit may be truncated: widen it, or name the partition as truncated and
keep it out of any total that claims coverage.

Datadog aggregate calls (`POST /api/v2/logs/analytics/aggregate` on
`api.us5.datadoghq.com`) fail silently in five ways: `from` / `to` in epoch
seconds return an empty 200 (use ISO-8601 or milliseconds); a `group_by`
without `sort` comes back alphabetical; the provider must be the quoted,
case-sensitive display name (`@extra.provider_name:"Novita"`, not the alert's
lowercase tag); `keys_*` and `changes` are arrays, so their counts and the
metric's points are pairs, not attempts; an error sentence needs an unquoted
wildcard with escaped spaces and colons
(`@extra.raw:*does\ not\ support\ feature\:\ structured-outputs*`). Keep the
product of `group_by` limits under 10,000 and back off on 429.

Some ledger tokens fire on every request of a serialization path and carry no
signal about the failing field. Before attributing from a token, count it over
the ledger-bearing population at the same provider, status, model and window
and compare with that population's total; a constant token means attribute
from the error bodies instead, and an unfinished count means constancy is
unknown.

Report the sampled count and, when the sample rate is at hand, the implied
real count. A group with 24h volume but nothing in the last 6h is likely
already resolved.

## 2. Attribution gate

A group is a candidate for our fault only when the normalized body names a
specific field (generic tokens such as `model`, `messages`, `input`, `content`,
`request`, `parameter`, `format` do not count), that field appears in the same
attempts' fingerprint keys or ledger change (nested keys match by `*.<field>`
suffix, since substrings over-count siblings), and the signature is bounded to
the buckets that carry the field. A signature spanning providers is escalated
as shared, never suppressed. Work the ten heaviest field-naming groups; the
rest are `unknown`, never client-caused by default.

A zero same-group match with uncapped key lists proves only that we kept the
key. Neither instrument sees a value rewritten in place, so call the group
client content only after the transform path shows the value passes through
unchanged; otherwise it is `unknown` and stays in triage.

## 3. Classify

| Class | Signal | Fix surface |
| -- | -- | -- |
| Client input / content | field arrived from the client, is in neither key list, and its value passes through unchanged | none, suppression-eligible |
| Provider auth | credential wording on a 400 | none |
| Policy / content refusal | provider policy or safety wording | none |
| Capability mismatch (metadata) | we send the value only when endpoint metadata claims support | issue once the experiment confirms, no PR, correct the row, suppression-eligible once filed |
| Adapter / transform bug | the adapter constructs the rejected shape unconditionally or fails to clamp | issue and PR once the experiment confirms |
| Unknown | field outside the observable set, or body names nothing localizable | no issue, re-triaged by the sweep |

When the adapter guards the value behind a capability flag, the bug is the
flag, not the adapter. The class is a hypothesis, not a verdict: the digest
and any issue carry only what the matrix in section 4 supports for the arms
as run. A run that later lands a deferred arm files on that result and posts
its own digest, whether or not the group survives that run's selection.

## 4. Attribution experiment

Fingerprints prove the output changed, not that the provider rejects it, and
the provider's text does not prove we caused it. Four arms against the real
provider settle it. Build one synthetic minimal request from the group's ledger
shape and fingerprint key names, with the group's provider, model and cheapest
endpoint. It need not match any observed attempt; it needs to reproduce the
normalized error. Report each arm's accepted and rejected counts as landed;
an arm not run is omitted, never written as zero.

1. **Reproduce.** The request through the current transform. Expect the
   group's error.
2. **Counterfactual.** The same request with the suspected transform bypassed.
   Provider-native and sent directly needs no code; a local build with the
   transform site disabled is experiment code and runs before filing.
3. **Negative control.** A request the endpoint accepts through the unmodified
   transform, differing from arm 1 only in the suspected construct: arm 1
   without the construct when we add or rewrite it, arm 1 with the construct
   reaching the provider on a path the transform does not touch when we drop
   it, or the provider-native health check when no such path exists.
4. **Confirm fix.** Arm 1 against a build with the patch, plus a golden check
   that the patched build serializes the arm 3 request to the same wire body
   as before.

The health check in the matrix is a code-free request the endpoint is known
to accept, sent when arm 3 rejects.

Verdict matrix, first matching row wins:

| Reproduce | Counterfactual | Negative control | Confirm fix | Verdict |
| -- | -- | -- | -- | -- |
| rejects | any | rejects, health check rejects | — | endpoint or provider health; `attribution unknown`, escalate to provider ops, no PR |
| rejects | any | rejects, health check accepts | — | control malformed; arm 3 partial, Step 3 class stands, any PR stays draft, name the control to rebuild |
| accepts | — | — | — | stale or unreconstructed group; `attribution unknown`, `Watching` |
| rejects | accepts | accepts | 10/10 accepts | `gateway-caused`, non-draft PR |
| rejects | accepts | accepts | partial or not run | `gateway-caused`, open issue, draft PR stating the count |
| rejects | rejects | accepts | — | Client input class: `client-caused`, Canceled record, suppression-eligible, no PR. Capability mismatch class: `gateway-caused`, open issue, correct the row, no PR |
| rejects | not run | accepts | — | `unknown`, nothing filed until the bypass build lands, no PR |
| mixed counts | | | | report every count, treat the arm as partial, keep any PR draft, name the arm to rerun |

Arms 1 to 3 run before filing and before the digest on every run, alert runs
included; a local bypass build for arm 2 is experiment code, not a fix. Put
one arm 1 and one arm 4 request/response pair, redacted to keys and types, in
the issue and PR body, never in Slack.

## 5. Dedupe, file, fix

The board shows only groups we are confident are ours. A `gateway-caused`
matrix row opens an issue (state Todo, label `Bugs`). Every other settled
verdict is filed directly in state Canceled so it stays off the board and
still serves as the dedupe record. `unknown` groups get no issue; the sweep
re-triages them until an experiment settles them.

Read the project's issues once (`list_issues`, `includeArchived: true`) and
match in memory. Canceled is the not-ours record and suppresses re-filing; open
issues are updated in place; a completed issue with a live signature is a
regression, filed fresh and linked. Record one disposition per group: `Issue
filed` (opened on the board), `Issue updated`, `Already tracked`, `Watching`,
`Suppressed`, `No action` (nothing filed, or filed Canceled as a record).

Read the suppression list `ECO-3140` before the verdict posts. Only client
content, provider auth, policy and metadata groups may be suppressed, never
`unknown` or adapter/transform groups, and never a group whose provider-named
field is in its own key diff. Each line cites the arm or provider body that
proves it and expires 14 days after `last confirmed`. Alert runs read the list
as written and skip expired lines; the sweep reconfirms or strikes every line,
and a struck or class-changed group re-enters triage.

Title `<Provider> · <status> · <what we did to which field>`, under 70
characters, no model, no model count, no clause after the field. Example:
`Cohere · 400 · reasoning_content stripped from assistant turns`. The body is
these four lines, then an `Evidence` heading, and nothing else above it:

```
**Mechanism:** <one sentence: what we changed at which stage and what the provider rejected>
**Fix:** <surface and change, or "none, caller side">
**Confidence:** <each arm as landed, e.g. reproduce 10/10 rejected, counterfactual 10/10 accepted>, <gateway-caused | client-caused>
**Volume:** <N> sampled over <window>, heaviest <model>
```

Everything a reader needs to rerun or audit the verdict goes under
`Evidence`: the Datadog query, normalized error, matched keys or token,
transform file, endpoint ids, matrix row, what the instruments could not
observe, and the redacted arm pairs. Field names, param values, model ids
and file paths in inline backticks.

A PR opens only for an open issue with an identified transform site and
fixture tests, after the digest, linked to the issue. Search open PRs for the
issue key and the transform file first; when one exists, link it from the
issue and open nothing. Non-draft only with a 10/10 confirm arm; otherwise
draft, naming the arm a human should rerun.

## 6. Slack

Every run posts one top-level message in `#provider-error-triage` and
threads everything else under it. An alert run's top-level post is one
short status line when it starts, linking the alert message, followed by one
digest per surviving group (at most three, omitted count stated) when done. A
digest for a landed bypass result is posted in addition and does not count
against the three. Never edit an earlier post to change a verdict; a later
run that settles more posts its own digest. Write for a human skimming a
channel: plain sentences, no endpoint ids, UUIDs, Datadog facets, ledger
tokens, gate conditions, matrix rows or proposed skill edits. Those belong in
the issue or the closing reply. Field names, param values and model ids in
inline backticks. Under 1,200 characters, no tables.

The templates below are Slack mrkdwn and post as written through the native
tool (pre-post check: `.agents/skills/slack-mrkdwn/SKILL.md`). A template's
lines are its whole content: fill each placeholder, drop a line whose value
does not exist, add nothing else.

Emoji are scanning markers, not decoration. A post's first line carries one
from this table, and its body lines carry none apart from the sweep bullets
below.

| First line | Emoji |
| --- | --- |
| Digest, verdict our bug | `:red_circle:` |
| Digest, verdict not our bug | `:white_circle:` |
| Digest, verdict unknown | `:grey_question:` |
| Alert run's opening status line | `:hourglass_flowing_sand:` |
| Dedupe reply | `:repeat:` |
| Sweep header | `:calendar:` |

A sweep bullet takes its group's verdict emoji, and a group new since the
last sweep ends its bullet with `:new:`.

Group digest:

```
<verdict emoji> *<Provider> <status>, <our bug | not our bug | unknown>* (<Issue filed | Issue updated | Already tracked | Watching | Suppressed | No action>[, <ECO-NNNN link>])
• *What happened:* <one sentence, which requests to which model got which rejection>
• *Why:* <one sentence, the mechanism: what we changed at which stage, or what the caller sent that we left untouched>
• *Fix:* <one sentence, the surface and the change, with the PR link if one was opened, or "none, caller side" or "unknown, needs <X>">
• *Evidence:* <N> of <N> sampled carry this error. Tests: <arm counts in words, or "not run, <reason>">.
```

Dedupe reply, when `#provider-error-triage` already holds a verdict for the
group within 24h. One line, replied in the anchor's thread, and the run stops
there. It carries the earlier verdict and its disposition so a reader acts
without opening the old thread, restates no mechanism, and reports no count
other than the window's sampled total:

```
:repeat: *<Provider> <status>, already answered* — <url of the earlier verdict|verdict posted HH:MM UTC> covers this group: <our bug | not our bug | unknown>, <Issue filed | Issue updated | Already tracked | Watching | Suppressed | No action>[, <ECO-NNNN link>]. <N> sampled in this window.
```

Sweep readout, the sweep run's anchor:

```
:calendar: *Transform triage, daily sweep, <window>*
Ours: <N> sampled in <N> groups. Client: <N> in <N>. Unknown: <N> in <N>.[ <N> suppressed.]
• <verdict emoji> <Provider> <status>, <our bug | not our bug | unknown>: <mechanism sentence> (<disposition>, <ECO-NNNN link>)[ :new:]
… up to five lines, heaviest first, then "+<N> more groups"
```

The three totals partition the population past the floor; a truncated
partition is named in one line and left out of them. An unchanged day is
stated in one sentence, never skipped.

## Improve this skill

A run does not edit this file. It states any proposed edit in one line at the
end of its closing reply, and a human applies it.
