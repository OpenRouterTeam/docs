# @openrouter-monorepo/coding-agent-contracts

Provider contract goldens for real coding-agent harnesses.

This package captures real coding-agent HTTP conversations against native
providers, commits those conversations as provider goldens, and replays them
through OpenRouter's **production** request and response pipelines in required
CI — offline, deterministic, and secret-free.

> **GATED.** Corpus outcomes are hard-gated in required CI: every
> committed case must replay through production code drift-free
> (`verifyCorpus({replay:true})` in `src/replay.test.ts` asserts all cases
> pass all verdicts and acceptance is ACCEPTED). The `report` CI job still
> renders the replay-backed report to the job summary and a sticky PR
> comment (`bun src/cli.ts report --markdown --report <json>`) as a
> reporting surface — it never replaces the gate.
>
> The staged-fix train that turned the original baseline (0/11 against
> main) green, for archaeological reference:
>
> | Staged PR | Owned |
> |---|---|
> | B — llm-interfaces identity fields | request identity fields (`max_completion_tokens`, response ids) drift |
> | C — messages-wire | Anthropic-wire drift: `claude-code-anthropic-*`, `xformat-cc-messages-*`, `xformat-responses-messages-*` |
> | D — responses-wire | Responses-wire drift: `codex-openai-*`, `xformat-cc-responses-*`, `xformat-messages-responses-*` |
> | E — cc-wire deepseek/moonshot | chat-completions-wire drift: `deepseek-harness-*`, `kimi-code-moonshot-*`, `qwen-code-alibaba-*`, `xformat-messages-cc-*`, `xformat-responses-cc-*` |
> | F — gate | re-added corpus-outcome gating once B–E made the report green |

## Core comparison

A live direct-provider call and a second live OpenRouter call can never be
byte-equal (model output is nondeterministic). The stable comparison is:

1. Capture one real native-provider conversation (via Arbiter).
2. Replay the captured harness request through OpenRouter's production skin,
   router parsing, and the recorded adapter.
3. Assert the derived upstream request matches the request the native
   provider accepted.
4. Feed the exact captured provider response into the adapter/skin response
   pipeline.
5. Assert OpenRouter renders the same provider contract back to the harness,
   after only manifest-declared volatile-field normalization.

## Commands

```text
bun run verify [--case <case-id>] [--report <path>]  # offline; schema/secrets/contracts/invariants
bun test                                             # offline replay through production code
bun run derive --case <case-id> [--force]            # cross-format: replay and write candidate goldens
bun run sanitize <capture-dir>                       # trusted post-capture gate
bun run capture --harness <id> --gateway <url>       # live, local Arbiter gateway only; never CI
```

`verify` runs everywhere. Full production replay lives in bun test files
(`src/replay.test.ts` for the authoritative corpus-outcome gate and
framework-integrity tamper negatives, `src/report-run.test.ts` for the
corpus-outcome report run) because the
router's mock seams require the bun test runtime; CI runs both. The report
job writes the replay report JSON via `CODING_AGENT_CONTRACTS_REPLAY_REPORT`
and renders it with `bun src/cli.ts report --markdown --report <json>`.

## Corpus

`corpus/<case-id>/manifest.json` is Zod-validated and versioned
(`src/corpus.ts`). Bodies are native readable files next to the manifest,
path-traversal-checked, symlink-rejected, and size-capped. Every ignored field
is an explicit JSON pointer in the reviewed manifest — a new volatile field
fails until reviewed.

The required provider-owned matrix is entirely **provider-parity**:
Claude Code→Anthropic, Codex→OpenAI, DeepSeek Harness→DeepSeek,
Kimi Code→Moonshot, and Qwen Code→Alibaba. Each harness is captured directly
against its provider. Replay asserts upstream-request parity and
response-contract parity for all five.

The registry (`src/harnesses/registry.ts`) also carries every harness `ori`
launches (roster mirrored from Ori in `src/harnesses/ori-launchable.ts`),
with `oriSupport` distinguishing `launchable` kinds from `setup-only`
(`ori dsh` configures DSH and instructs the user to run `dsh web` — it never
launches) and `unsupported` (Kimi Code / Qwen Code have no Ori command).
Those entries have no capture recipe and never gate acceptance; the report's
`harnessCoverage` table lists each one as `required` or `reported` with its
case verdict, so a harness with no committed case is visible rather than
silently absent.

### Launch provenance

`capture.launch` (optional on the manifest) records HOW a capture was
actually executed: `executor` (`direct` | `ori`), the exact secret-free
`command`, the probed child `harness_version` (must equal
`harness.version`), and — for Ori runs — `ori_version` or
`ori_source_revision` (at least one required; forbidden on direct runs).
Absent `launch` means legacy/unknown: the report renders `unknown` and never
infers execution from the registry's `oriKind`. A provider-parity case must
not record an `ori` launch — an Ori-mediated run reaches OpenRouter and is
`platform-compatibility` evidence. The report's `oriCoverage` table counts a
harness as Ori-captured ONLY when a committed platform-compatibility case
records `launch.executor: "ori"`. Absence means no published CI replay golden, not that the harness has never run locally.

### Report sections

`renderMarkdownReport` (helpers in `src/render/`) groups native captures into one row per harness. Every capture contributes to the result; versions, dates, launch provenance and per-case diagnostics are collapsed. The conversion grid shows pass/fail/skip counts per direction, with case IDs and derivation sources in its details. Malformed cases remain visible outside the known sections, and failure details retain the full expected/actual differences.

Ori local execution and CI replay are separate. `capture-evidence/ori-local-runs.json` is a dated, curated ledger projected from the independent September 8 local verification report: all 13 attempts and their model-call checks are retained, and the Ori table shows the latest task and wire result per harness alongside its independent CI-golden status. The renderer validates this ledger and displays errors rather than silently ignoring invalid evidence. This is historical ingress-only evidence, not a live run or paired replay in CI. It never enters `verifyCorpus` acceptance, native coverage or Ori corpus coverage; only committed platform-compatibility goldens populate Ori CI replay results.

Conversions claim no task execution: a derived case's task verdict is `skipped` and its evidence is `derived_from_case_id` → the source capture, which stays gated.

### Case kinds

Three kinds, distinguished by how the client ingress dialect (X) relates to
the adapter's provider wire format (Y):

- `provider-parity` — X = Y. The captured direct-provider request is both
  the replay input and the upstream golden. Forbids provider-side turn
  fixtures.
- `platform-compatibility` — the captured request is OpenRouter ingress.
  Requires `provider_response_body` (the provider-native fixture fed to the
  adapter); the upstream-request verdict is skipped by design.
- `cross-format` — X ≠ Y. Requires all four per-turn artifacts:
  `request_body` (ingress, X), `provider_request_body` (upstream request
  golden, Y), `provider_response_body` (provider response, Y), and
  `response_body` (client golden, X). The upstream-request verdict is
  asserted against `provider_request_body`, never skipped. Contract
  validation splits: the ingress request validates against X; the provider
  request and response validate against Y
  (`providerProtocolForAdapter(target.adapter)`).

The verification report includes a 3×3 matrix (ingress dialect × provider
wire) with the case id, verdict, and provenance per cell. Acceptance gates
the matrix: every cell must be populated, diagonal cells must be
provider-parity `arbiter-exact-capture`, off-diagonal cells must be
cross-format with `derived-blessed` or `arbiter-exact-capture` provenance,
and `derived_from_case_id` must chain to a committed parity capture.

### Deriving cross-format cases

`scripts/xformat-cells/dialects.ts` (one-off cell-generation tooling, not
part of the package surface — see `scripts/xformat-cells/AGENTS.md`)
converts a request conversation between the three
dialects (anthropic-messages ↔ openai-chat-completions ↔ openai-responses)
through a canonical IR. It is semantics-preserving and explicit about what
cannot translate: every untranslatable construct is reported as a
structured `declaredConversionLoss` (JSON pointer + reason), never silently
dropped, and constructs outside the supported seed set are hard errors.

The derive workflow bootstraps a `derived-blessed` cell:

1. Author the case directory: converted ingress `turn-NNN.request.json`,
   copied provider-native `turn-NNN.provider-response.sse`, and a manifest
   (`capture.method: derived-blessed` + `derived_from_case_id`).
2. `bun run derive --case <id>` replays offline and writes candidate
   goldens (`turn-NNN.upstream.json`, `turn-NNN.response.sse`). It refuses
   to overwrite existing goldens without `--force` and prints every
   residual diff it tolerated.
3. Review every diff against the source parity conversation and author the
   manifest normalization (declared conversion losses and volatility →
   `*_drop_json_pointers`; asserted transformations → `*_expected_values`)
   until `bun run verify` and `bun test` go green with zero undeclared
   drift.

### Synthetic self-test fixtures

Every manifest carries `capture.method`, which declares provenance honestly:

- `synthetic-fixture` — hand-constructed, provider-shaped conversation that
  exercises the full replay path and proves corruption detection. **Not** a
  real harness capture; the initial corpus entries are all synthetic and are
  additionally marked `repository_commit: "SELF-TEST-FIXTURE"`.
- `derived-blessed` — transformed from a committed parity conversation by a
  reviewed converter, replayed once, and the derived goldens human-blessed.
  Must record `capture.derived_from_case_id` naming the source parity case
  (other methods must not). Its task outcome is reported `skipped`: no
  harness task ran for the derived conversation, and the source capture's
  task evidence belongs to the source case only.
- `arbiter-exact-capture` — a real conversation captured through Arbiter's
  exact proxy, sanitized, and converted to corpus format.

A test enforces the pairing (synthetic fixtures cannot claim real capture
provenance). The committed required matrix now consists only of sanitized
`arbiter-exact-capture` cases. CI replays those committed live captures
offline; it never performs capture or provider calls.

## Contract authority

All validators are **curated runtime schemas** maintained in this repo
(`src/contracts/index.ts`). No committed case may claim `official-openapi`
until a pinned first-party artifact is vendored and hash-checked; a test
enforces this. The verification report states authority per case.

## Arbiter dependency

Arbiter owns capture, redaction, sanitization, export, and replay transport.
This package never implements a proxy.

Pinned: `@parke.dev/arbiter@1.1.0` (`./bundle`, `./capture`, `./replay`,
`./validation`, `./gateway`). `src/arbiter.ts` is the single seam: it wraps
official `loadBundle` in a Result, applies corpus-acceptance gates the
loader does not (failed / incomplete / aborted / unvalidated /
unterminated-SSE exchanges), and WeakSet-brands verified bundles so
`arbiter-exact-capture` provenance cannot be forged.

Refresh is a local loopback gateway run; required CI only verifies the
committed sanitized live-capture bytes.

## Security model

- Required CI: no secrets, no network beyond dependency setup, no harness
  processes, no databases.
- Capture is local: `CODING_AGENT_CONTRACTS_ALLOW_LOCAL_CAPTURE=1` plus a
  loopback Arbiter gateway. That env var is an accident brake (tests/CI
  must not spawn harnesses), not isolation. Converted `arbiter-exact-capture`
  cases from this path are acceptance-grade. The harness child receives a
  minimal environment and exactly one credential — an opaque, short-lived
  Arbiter gateway token; the gateway must be loopback http(s); config values
  are canonicalized and TOML-escaped; the token is redacted from bounded
  (2 MiB) stdout/stderr; the harness executable's real version is probed and
  recorded. Real provider keys never enter the harness environment.
- `sanitize` fails closed on secret patterns, caller-supplied exact values,
  symlinks, path escapes, and oversized files. Findings never contain the
  full secret.

## Paired Ori publication gate

`convertPairedBundlesToCase({ ingress, provider }, options)` accepts two bundles loaded by `loadArbiterBundle`, an unknown capture-emitted `receipt`, exact `rejectValues`, and the existing converter's case ID, target, contract, normalization and corpus root. It delegates publication to `convertBundleToCase`; platform cases remain response-compatibility evidence, with no upstream request golden/assertion. Provider requests are checked for model identity and curated request-contract validity before their paired responses become replay fixtures.

The minimal producer contract is `DualCaptureSessionReceiptSchema`: shared session ID repeated on both legs; bundle digests and credential-free target origins; serving-router commit; registry harness package, probed version, `scenario: "file-edit-v1"` and successful task exit; exact target; reject-value fingerprints; and `launch` from the actual capture run, validated by the existing `LaunchProvenanceSchema`. No launch is inferred from registry commands. Each leg also requires `timing_digest = fingerprintBundleTiming(bundle.exchanges)`: Arbiter's bundle digest **excludes timing**, so the capture controller must bind timing when emitting the receipt, not reconstruct it during publication. `fingerprintRejectValues` computes the exact nonempty unique reject set without retaining the values in evidence.

This is a trusted local capture-to-publication seam, not receipt signing or proof of process execution. The parent controller owns the actual Ori execution, task check, sanitization and authoritative receipt emission; callers must retain that receipt and both bundles as capture evidence. Conversion validates the receipt once, checks its bindings and scans both legs (including skipped exchanges), decoded JSON/SSE bodies, percent-decoded request paths and publication metadata before writing. Receipts are not added to the corpus manifest schema. Failed publication does not promote an old ingress recording into paired evidence.

Without `receipt.correlation_header`, pairing requires each provider call to be wholly contained in exactly one ingress interval, and each ingress to contain exactly one provider call, with no clock-skew tolerance; shared-window candidates remain ambiguous even when headers could distinguish them. A capture controller may instead opt in with `correlation_header: "cf-ray"` (the only permitted header): it must mint a unique nonsecret per-request value at ingress, forwarded by the production adapter and retained in the actual request recording on both legs. These header values are already bound by each receipt-bound authenticated Arbiter bundle digest; conversion never invents or rewrites them. In this mode, every selected model call must have exactly one nonempty header value, matched exactly across legs, with no duplicate identities, multivalue/comma-folded headers or case-colliding header names on either leg. Fully overlapping title/main windows can then pair by identity, but each matched provider interval must still be wholly contained in its ingress interval under the unchanged strict timing validator. Missing or mismatched identities never fall back to timing, order, nearest-call or elimination matching. Both modes reject retries, orphans, mixed models/protocols and malformed, non-2xx or non-SSE model calls. This alternative is covered by deterministic synthetic tests; it does not claim new real captures exist. Protocol-valid error/failed/incomplete stream events are also rejected, even with HTTP 200 and completed transport. Same-model auxiliary model calls remain separate selected turns; they are never filtered by purpose or rewritten. Other exchanges stay in the retained bundles and are reported as `skippedExchanges` and `skippedProviderExchanges`. Unrecognized endpoints are rejected, not guessed to be auxiliary. The diagnostic-only allowlist is GET `/v1/models`, `/api/v1/models` or `/api/v1/models/user`, POST `/v1/messages/count_tokens` or `/api/v1/messages/count_tokens`, and non-model-shaped POST `/telemetry`; these must not stream SSE. Extending this list requires review of the actual diagnostic endpoint. This gate does not run harnesses, manage stacks, capture traffic or provide a CLI; real eight-harness corpus publication and deferred Grok startup remain parent-owned work.

The controller emits the following typed shape from its **actual** run (identifiers/digests below are producer values, not publication-time defaults):

```typescript
import type { DualCaptureSessionReceipt } from '@openrouter-monorepo/coding-agent-contracts';

const receipt = {
  schema_version: 1,
  scenario: 'file-edit-v1',
  session_id: sessionId,
  serving_router_commit: servingRouterCommit, // 40 lowercase hex characters
  launch: actualLaunch, // LaunchProvenanceSchema; executor must be "ori"
  harness: {
    id: harnessId,
    package: registryDistribution,
    version: probedHarnessVersion,
    task_passed: taskPassed,
    exit_code: exitCode,
  },
  target: recordedTarget, // protocol, model, provider, endpoint_id, provider_model_id, adapter
  reject_value_fingerprints: exactRejectFingerprints, // sorted unique SHA-256 values
  bundles: {
    ingress: { session_id: sessionId, target_origin: ingressOrigin, bundle_digest: ingressDigest, timing_digest: ingressTimingDigest },
    provider: { session_id: sessionId, target_origin: providerOrigin, bundle_digest: providerDigest, timing_digest: providerTimingDigest },
  },
} satisfies DualCaptureSessionReceipt;
```

### Capture-bound replay context

`DualCaptureSessionReceiptSchema.replay_context` is optional and imports the strict `ReplayContextSchema` from `src/replay-context.ts`; it does not define a second shape. The controller must build this sanitized pricing/capabilities/accounting context **before capture** and include it in the authoritative receipt. Identity remains in `target`: endpoint/model/provider/account/workspace identifiers, credentials and arbitrary production objects are not context fields. The context is part of the whole immutable parsed receipt, not a new digest or receipt version; retain that complete receipt with both bundles as the capture binding.

`parseDualCaptureSessionReceipt(input)` preserves and deeply freezes context. `convertPairedBundlesToCase` scans it through the existing exact-secret metadata gate and forwards only `receipt.replay_context` to the existing staged, atomic manifest writer as `replay_context`. `PairedConvertOptions` remains `Pick<ConvertOptions, 'caseId' | 'target' | 'contract' | 'normalization' | 'corpusRoot'> & { readonly receipt: unknown; readonly rejectValues: readonly string[] }`: no separate context option. Runtime `replayContext` or `replay_context` overrides fail closed, even if identical to the receipt or explicitly `undefined`.

Ordinary conversion separately accepts `ConvertOptions.replayContext?: CaseManifest['replay_context']`, validated with the complete manifest before any output. Existing v1 receipts without context remain valid and publish no `replay_context`; replay retains its legacy defaults. Do not backfill context into old receipts or infer it from current production configuration. These passthrough tests are synthetic unit coverage, not new eight-harness capture evidence.

### Explicit conversation groups

A reviewer may annotate every manifest turn with `conversation_group` to distinguish independent conversations in one capture (for example, a title request and a file-edit task). This is explicit post-capture check policy, not an inferred native harness session ID. Labels must be 1–64 characters, start with an ASCII letter or digit, and contain only letters, digits, `.`, `_` or `-`. Annotations are all-or-none; unannotated legacy cases remain one conversation.

History, tool-definition stability, cache-key stability and cache-marker movement compare successive turns **within each group**, even when groups are interleaved. Ingress X checks always run; replay-derived upstream Y cache checks run under replay, with Y history/tool checks additionally asserted for cross-format cases. Per-turn contracts, cache-marker limits, response checks and replay comparisons still cover every turn, retaining original sequence numbers in diagnostics. No auxiliary model call is filtered or rewritten. Annotated reports include `conversationTurns`; legacy reports omit it. Native, Ori and conversion details show explicit membership and the scoped-check note inside their existing collapsed sections; overview tables are unchanged.

## Golden freshness (advisory)

JSON reports store a `freshness` evaluation at the report's `generatedAt` timestamp. Markdown renders that stored result, including a visible warning/unknown summary and collapsed per-capture versions, age, reasons and reference provenance; rendering a serialized report later never advances its clock or recomputes its references. Legacy reports without an evaluation explicitly say unknown. The existing three overview tables are unchanged.

A capture warns **strictly after 30 elapsed days**, or when its captured harness version is behind the highest comparable **same-harness major/minor release already verified in this repository**. SemVer comparison is numeric (including `0.x` and numeric prerelease identifiers); build metadata has no precedence. A patch/prerelease-only difference is displayed but does not warn. Unknown/non-semver versions, inconsistent launch versions, and missing, invalid or future capture timestamps are explicitly unknown/not comparable, never silently fresh or negative-aged. Independent known age/version warnings can still appear beside unknown metadata.

The captured version comes from `manifest.harness.version`, or the actual `capture.launch.harness_version` when present (the manifest schema requires them to agree), never today's registry version. References use successfully loaded, schema-valid `arbiter-exact-capture` native-provider parity or Ori platform manifests with successful original task/exit and HTTP statuses. Current replay failures cannot erase that historical verification. References also reuse the existing validator and all-model-call wire/task checks for `capture-evidence/ori-local-runs.json`; its dated ingress-only provenance remains explicit and is not relabeled as paired replay. Only evidence dated at or before the report clock is comparable. A scoped `--case` run may read other cases under the supplied corpus root for references, without replaying them or making their load failures fail the scoped run. No upstream version lookup, network request or harness process is involved.

Every non-derived capture row is included, including failed loads and synthetic self-tests (marked unknown/not real capture); derived conversion rows are excluded because the source capture owns their age and task evidence. Neither derived nor synthetic rows can establish a new verified version. Freshness warnings never change case failures, verdicts, `passed`, or acceptance. This feature never refreshes or blesses captures, changes their original timestamps, bodies or receipts, or rewrites the dated ledger.
