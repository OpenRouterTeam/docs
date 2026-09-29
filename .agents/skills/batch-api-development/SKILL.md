---
name: batch-api-development
description: >-
  Entrypoint orchestrator for Batch API feature work. Sequences the modular
  batch sub-skills — sync-API fixture capture, provider research, fake
  provider, read-only code audits, test writing + test audits, and
  post-deploy production enablement + dogfooding — across
  packages/batch, services/batch-api, and services/cfw-batch-api. Use when a
  task adds or changes batch submit (accept or async validation worker),
  read, finalize, or sweep behavior, a batch
  provider adapter, or a batch endpoint skin. The primary use case is
  onboarding a new batch provider (e.g. Anthropic, Gemini).
user-invocable: true
---

# Batch API Development

Pointer skill that drives a Batch API change end to end. It implements
nothing itself — it sequences the phases and tells you which sub-skill owns
each one, mirroring the `audio-provider-onboarding` orchestration pattern.

Use this when the request is "add Anthropic batch support", "onboard
Gemini batch", "extend batch results delivery", or any multi-layer batch
feature. For a one-off fix to a single file, jump directly to the affected
sub-skill instead.

## Arguments (provider onboarding)

- `$PROVIDER_NAME`: PascalCase provider name matching `ProviderName.*`
  (e.g. `Anthropic`, `GoogleGemini`)
- `$PROVIDER_SLUG`: lowercase slug (e.g. `anthropic`, `google-gemini`)
- `$BATCH_ENDPOINT`: the public batch endpoint(s) the provider serves
  (e.g. `/v1/messages` for Anthropic, `/v1/chat/completions` for
  OpenAI-shaped providers)
- `$PARENT_BRANCH`: what the stack builds on — usually `main`
  (`gh stack init` starts from the default branch; supply an explicit
  parent only when basing on an unmerged branch). If the provider does
  not yet exist as a sync provider (`ProviderName`, env, API-key
  config), the foundation becomes the bottom layer of this same stack
  (see §Stack decomposition below)

## The three batch layers

Every batch change touches some subset of three layers (see
`packages/batch/README.md` and `services/batch-api/README.md`):

| Layer                    | Owns                                                                                   | Must not own                                                         |
| ------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/batch`         | Stable schemas, route contracts, adapter interfaces, provider adapters, endpoint skins | Runtime credentials, Cloudflare bindings, Cloud Run infra, databases |
| `services/batch-api`     | Cloud Run submit accept + async submit worker, read/finalize/sweep orchestration, GCS, Pub/Sub, Spanner              | Public edge auth, package-internal schema forks                      |
| `services/cfw-batch-api` | Edge auth, CORS, internal token minting, zero-copy forwarding                          | Batch parsing, provider calls, storage                               |

This layering is also the natural stacked-PR decomposition — contracts
below, orchestration above, edge on top.

## Stack decomposition

Stacking policy lives in the root `AGENTS.md` (§Pull Requests). The default provider stack is research note → fake provider → adapter (`packages/batch`) → runtime registration (`services/batch-api`). Add a `packages/router` layer at the bottom when the provider's sync adapter carries request fields the generic OpenAI serializer drops (for example vLLM `chat_template_kwargs`): extract the sync serializer into a shared function first so the batch adapter and the sync path serialize identically, and prove it with a parity test against the sync fixtures. Without that layer the batch adapter silently sends a narrower request than the sync endpoint does.

## Discovery is agent-owned

For provider onboarding, do **not** ask the human for the endpoint shape,
skin/adapter reuse decision, fixture needs, or touched layers — derive
them in the research phase
([`research-batch-provider`](../research-batch-provider/SKILL.md)) from
official provider docs, live captures, and the existing sync adapter, and
present the conclusions for approval. The only inputs the human supplies
up front:

1. The provider (or feature) being onboarded and any scoping Linear
   ticket (ECO-…) — reference it in every PR title/body of the stack.
2. Any specific PR decomposition they want — support what they approve;
   do not collapse requested layers.

For non-onboarding batch features, still confirm which of the three
layers the change touches and whether new fixtures are needed (new
adapter, skin, or output shape ⇒ yes).

Name the exact upstream product before scoping models. For example, Vertex AI
`BatchPredictionJob` and the Gemini Developer API Batch API are separate
products; Gemini support does not imply Anthropic-on-Vertex or every Model
Garden model is compatible. Build the allowlist as:

```text
documented provider batch support
∩ active OpenRouter endpoints
∩ requested modality
∩ models verified by a minimal live batch
```

## Phase map

```text
Phase 1 — Research             (research-batch-provider)
   ↓
   Human checkpoint: research note conclusions (skin/adapter decision,
   layer list, fixture plan) approved before any code lands.
   ↓
Phase 2 — Stack plan + manifest (this skill §Stack decomposition +
                                root AGENTS.md §Pull Requests)
   ↓
Phase 3 — Fake provider        (fake-batch-provider — early, so all
                                later phases test deterministically)
   ↓
Phase 4 — Fixtures             (batch-sync-fixtures — promote the
                                research phase's live captures; no
                                pre-generated/synthetic fixtures)
   ↓
Phase 5 — Implementation       (add-batch-provider, cut as a stack per
                                §Stack decomposition)
   ↓
Phase 6 — Code review          (cleanup-batch-adapter on the adapter,
                                batch-api-audit on every layer)
   ↓
Phase 7 — Verification + tests (batch-api-testing: fake-provider e2e,
                                live verification, intent tests)
   ↓
Phase 8 — Test audit           (batch-api-testing §Audit + test-audit)
   ↓
   Terminal contract: stack opened and review-ready (below).
   ↓  CHECKPOINT: stop and wait for the human to merge and deploy.
   ↓  Phase 9 must not start against an undeployed adapter.
Phase 9 — Production enablement (buddy skill: secret, private :batch
                                endpoint, pricing, unhide, smoke run —
                                below)
   ↓
Phase 10 — Provider dogfooding (batch-adapter-dogfooding — live parity
                                matrix vs the provider's native batch
                                API, billing evidence, per-provider
                                SAFE/NOT SAFE verdict)
```

For non-onboarding batch features, skip phases 1 and 3 (and 4 when no new
shapes are involved). Phase 10 also runs standalone to re-certify an
already-shipped adapter.

## Phase 9 — Production enablement

The OpenRouter half of dogfooding cannot run until the adapter is deployed and a `:batch` endpoint row exists, so this phase sits between merge and Phase 10. It is a production data operation through the Buddy API, run with the [`buddy`](../buddy/SKILL.md) skill and its `references/private-endpoints.md`, never with direct SQL. Preview every write and get explicit approval before applying.

1. **Provider key.** The batch-api reads the container env var `<PROVIDER>_API_KEY` (`apiKeyEnvVar` in `services/batch-api/src/adapters/api-key-providers.ts`), which `services/batch-api/infra/cloudrun.tf` fills from the GSM secret `BATCH_API_<PROVIDER>_API_KEY`. Before staging anything, probe that exact key natively against the provider's create-batch route: a key that authenticates for file upload can still lack batch entitlement.
2. **Endpoint row.** Stage one private `variant: "batch"` endpoint from the provider's active sync sibling (same `provider_model_id`, quantization, context, capability flags), with `provider_overrides.adapterName` set to the adapter registered in `packages/enums/adapters.ts`, `is_private: true`, `private_access_grants` holding only the OpenRouter org entity, and the required batch data policy from `buddy/references/staging-reference.md`. Set `is_byok_only: false` explicitly, since private creates default it to true and that blocks the platform key.
3. **Pricing.** Create the pricing version in the same operation as the endpoint, derived from the sibling's live pricing version through the rules in the provider's research note (quantization-aware where the provider prices by quantization). Pricing versions are not retroactive.
4. **Unhide.** Buddy creates rows `hidden: true`, and hidden rows are not routable, so a submit against the slug returns `400 does not have a :batch endpoint`. PATCH `hidden: false` while leaving `is_private` and the grants untouched.
5. **Probe.** Submit a one-line batch through OpenRouter with an org-member key and confirm the submit worker resolves the new endpoint. Private `:batch` variants are not listed by `GET /api/v1/models` for any key, so dogfooding pins the row with `provider.only` rather than discovering it from the models list. Org-level keys cannot submit batches (`401 Batch requests require a concrete user identity`), use a user key.
6. **Smoke run.** Once the probe reaches `in_progress`, run a reduced [`batch-adapter-dogfooding`](../batch-adapter-dogfooding/SKILL.md) pass through OpenRouter only, pinned to the new row, covering four things: happy path, tools, errors, and billing. Run matrix case 1 (five valid requests, then four valid plus one invalid — the expected outcome follows the research note's partial-success finding: for a provider that isolates rows, the invalid row lands in the error file with the provider's error shape mapped and the four valid rows still complete; for a provider that rejects the whole batch, OpenRouter must surface that same batch-level failure), one case from section 2 (a single function tool), and the billing checks from section 5 (per-row usage including `cached_tokens`, and the billed cost reconciled line by line against the Phase 9 pricing version). `provider.only` narrows by provider slug, not by row, so when the provider already has another `:batch` row for the model, pin the exact row with the internal `X-OR-Endpoint-Id` header (approved internal entities only; see `services/batch-api/src/submit/accept/resolve-batch-submit-target.ts`) and, in every case, confirm each generation row's `endpoint_id` is the Phase 9 row before accepting the gate. Compare the output rows against the sync sibling's responses for the same requests. This is the gate for Phase 10, not a substitute for it: a smoke run that does not finish, mis-serializes, or bills at the sync price means fix and re-run before the full matrix.

## Manifest

Deliverable of Phase 2: a structured, schema-shaped onboarding manifest at
`~/<feature>-stack.json` (uncommitted, outside the checkout; `/tmp` is wiped between agent VM restarts) that any later agent session can
resume from, plus a human-readable stack map rendered from it
(`~/<feature>-stack.md`). The manifest records **intent** — the
file-ownership matrix, purposes, and decisions GitHub cannot store.
Branch bases, head SHAs, and restack state are GitHub's: read them with
`gh stack view --json` / `gh api repos/{owner}/{repo}/stacks`; do not mirror
them here. Required fields:

```jsonc
{
  "provider": { "name": "…", "slug": "…", "endpoint": "…" },
  "researchNote": "docs/batch-research/<provider>.md",
  "decisions": { "skin": "reuse|new:<name>", "adapter": "new:<name>" },
  "fixtures": [{ "path": "…", "provenance": "…" }],
  "stackNumber": 0, // GitHub stack id once submitted
  "layers": [
    {
      "ordinal": "2/6",
      "purpose": "one sentence the layer's reviewer confirms",
      "branch": "…",
      "prUrl": "…",
      "ownedFiles": ["…"],
    },
  ],
  "verification": [{ "command": "…", "status": "pending|passed" }],
  "phase": "research|fake|fixtures|implementation|review|tests|awaiting-deploy|enablement|dogfood|done",
}
```

Validate the manifest against this shape before every hand-off (a quick
Zod parse in a scratch script is fine); a layer missing `ownedFiles` is
an error, and `prUrl` is required once the stack is submitted. The
manifest is reconstructible from the stack plus the PR bodies (which
carry owned scope and exclusions), so losing it is recoverable. Get
the human's sign-off on the rendered stack map before writing code.

## Phase skills

| Phase            | Skill                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Research       | [`research-batch-provider`](../research-batch-provider/SKILL.md) + its capture matrix                                                                                                         |
| 2 Stack plan     | this skill (manifest + §Stack decomposition) + root `AGENTS.md` §Pull Requests (stacking policy)                                                                                              |
| 3 Fake provider  | [`fake-batch-provider`](../fake-batch-provider/SKILL.md)                                                                                                                                      |
| 4 Fixtures       | [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md) — promoted from the research phase's live provider captures (never pre-generated); ship in the PR of the adapter/skin consuming them |
| 5 Implementation | [`add-batch-provider`](../add-batch-provider/SKILL.md), cut per §Stack decomposition                                                                                                          |
| 6 Code review    | [`cleanup-batch-adapter`](../cleanup-batch-adapter/SKILL.md) (adapter) + [`batch-api-audit`](../batch-api-audit/SKILL.md) (every layer); fix findings in the lowest owning PR and cascade     |
| 7 Tests          | [`batch-api-testing`](../batch-api-testing/SKILL.md) — unit, fake-provider e2e, live verification, intent tests                                                                               |
| 8 Test audit     | [`batch-api-testing`](../batch-api-testing/SKILL.md) §Audit + [`test-audit`](../test-audit/SKILL.md) scoped to touched files                                                                  |
| 9 Enablement     | this skill §Phase 9 + [`buddy`](../buddy/SKILL.md) — deployed key probe, private `:batch` endpoint, pricing, unhide, submit probe, smoke run (post-deploy)                                    |
| 10 Dogfooding    | [`batch-adapter-dogfooding`](../batch-adapter-dogfooding/SKILL.md) — native-vs-OpenRouter parity matrix, billing/BYOK evidence, lifecycle-health checks, evidence report with per-provider verdict |

## Terminal contract — stack opened and review-ready

The skill's observable output is the stacked PR train, not an
intermediate manifest. Completion means all of:

- every approved layer is committed, pushed, and open as a linked PR;
  each diff is scoped against its actual parent
- the stack shows linear history (no "Rebase stack" banner;
  `gh stack view` shows no `⚠ Needs rebase` markers)
- fixtures and research/intent tests live in their owning PRs
- cleanup + audit reports are clean (or every finding fixed and cascaded)
- required unit/e2e/live checks passed without skips, with evidence in
  the PR bodies
- a billing-continuity probe passed: captured native provider result
  rows persisted as the raw output artifact, then read back through the
  real `transformBatchResponse` → `emitBatchGenerations` path, showing
  nonzero billed cost, correct per-row skip/emit accounting, and zero
  failed/unaccounted rows, with the evidence in the top PR body. The
  stored artifact is provider-native and finalization normalizes it on
  read, so the probe starts from the persisted native bytes, not from
  already-normalized rows. Passing per-layer unit suites does not
  substitute for this probe — each layer can be individually correct
  while the cross-layer contract (stored native rows → transform on
  read → billing) is broken
- live provider captures used for validation are sanitized and promoted
  into fixtures consumed by the adapter tests
- the manifest is fully populated and validates
- report back the ordered PR URLs bottom→top plus the top branch/PR
- the native-provider half of the dogfooding matrix has run against the provider's own batch API (the cases that need no OpenRouter endpoint), every case resolved to a verdict (`UNTESTED` is allowed but must be explicit), and a filed issue for every `BUG`/`COVERAGE GAP`

The OpenRouter half of the matrix and the provider verdict depend on Phases 9 and 10, which run after the human merges and deploys the stack, so they are not part of this contract. Once they run, the provider verdict must be `SAFE` or `SAFE WITH KNOWN LIMITS`, derived from the case verdicts per the dogfooding skill's rules (an all-`UNTESTED` report can never certify a provider). A `NOT SAFE` verdict means fix the blocking findings, re-run the affected cases, and re-issue the verdict before announcing the provider as batch-enabled (a standalone re-certification run of [`batch-adapter-dogfooding`](../batch-adapter-dogfooding/SKILL.md) may end report-only, but an onboarding may not).

## What this skill does NOT do

- Implement schemas, adapters, orchestration, or tests — the sub-skills own
  those
- Re-derive stacked-PR mechanics — policy lives in the root `AGENTS.md`
  §Pull Requests
- Perform the Buddy writes itself — Phase 9 names the steps and traps,
  the [`buddy`](../buddy/SKILL.md) skill owns the procedure

## Related skills

- [`research-batch-provider`](../research-batch-provider/SKILL.md)
- [`fake-batch-provider`](../fake-batch-provider/SKILL.md)
- [`add-batch-provider`](../add-batch-provider/SKILL.md)
- [`cleanup-batch-adapter`](../cleanup-batch-adapter/SKILL.md)
- [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md)
- [`buddy`](../buddy/SKILL.md)
- [`batch-api-audit`](../batch-api-audit/SKILL.md)
- [`batch-api-testing`](../batch-api-testing/SKILL.md)
- [`batch-adapter-dogfooding`](../batch-adapter-dogfooding/SKILL.md)
- [`test-audit`](../test-audit/SKILL.md)
- [`unit-test-writing`](../unit-test-writing/SKILL.md)
