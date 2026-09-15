---
name: audio-provider-onboarding
description: "Entrypoint for onboarding a speech-to-text (STT) and/or text-to-speech (TTS) provider. Discovers capabilities, owns the shared provider-foundation PR, and coordinates the full aspect-combined stack."
user-invocable: true
---

# Audio Provider Onboarding

Top-level orchestrator for bringing a new audio provider onto OpenRouter.
It owns three things and delegates everything else:

1. **Capability discovery** — what the provider offers vs. what this task
   actually onboards.
2. **The shared provider-foundation phase** — the bottom PR that both
   modality stacks build on.
3. **Overall stack shape** — which layers exist and in what order
   across foundation, STT, and TTS. Generic stack policy (slicing,
   metadata, merging) lives in [`stacked-prs`](../stacked-prs/SKILL.md);
   `gh stack` commands live in [`gh-stack`](../gh-stack/SKILL.md).

STT and TTS implementation phases live in the labeled sections below and in the four phase skills they reference. This skill keeps the modality stacks coordinated without mixing their adapter-specific contracts.

## Required answers at invocation

Do not start work until the human has answered all four:

1. **Does the provider offer STT, TTS, or both?**
2. **Which offered modalities are included in the current task?**
3. **Does `ProviderName.<Provider>` and its shared configuration already
   exist?** (Check `packages/enums/providers.ts`,
   `packages/providers/env.ts`, `packages/providers/configs/api-key.ts`.)
4. **Has the human requested a specific PR decomposition?** (e.g. a
   fine-grained research-doc/schema/SKU/adapter split.)

Availability and current onboarding scope are separate questions. A
provider may support only one modality, or the task may intentionally
onboard only one of two. Current repo examples:

- **STT-only adapters**: Groq, Microsoft
- **TTS-only adapters**: Azure
- **Both**: Alibaba, Deepgram, Google Vertex, Mistral, OpenAI, Together, xAI

Never infer scope from availability. "Deepgram has TTS" does not mean
"this task onboards Deepgram TTS".

## Composition

```text
STT only: foundation → STT stack
TTS only: foundation → TTS stack
Both:     foundation → research (STT+TTS) → schemas/fixtures (STT+TTS)
          → pricing/SKUs + preauth (STT+TTS) → STT adapter → TTS adapter
```

For combined onboarding, **combine layers by aspect, not by modality**:
each cross-cutting layer (research notes, schemas/fixtures, pricing
strategies + preauthorization) carries both modalities' content, while the
adapters remain separate PRs — one STT adapter PR, then one TTS adapter PR
on top. Do not serialize a full STT stack followed by a full TTS stack,
and do not collapse all TTS work into a single final PR. The TTS adapter
PR stays adapter-only (adapter class + tests + enum/factory/format
registrations); its research, schemas, and pricing live in the shared
aspect layers below. the TTS layer accepts the **STT adapter branch** as its parent, and the final TTS PR remains the branch containing
  the complete provider for local testing.

If the provider already exists (question 3 = yes), skip the foundation
phase entirely: reuse the existing provider and start the modality stack
from the existing parent branch or `main`.

## Phase 1 — Provider foundation (new providers only)

The orchestrator owns a shared bottom foundation PR containing everything
that establishes provider identity, credentials, and development-tooling
wiring:

- `ProviderName.<Provider>` and its slug in
  `packages/enums/providers.ts`
- API-key env schema in `packages/providers/env.ts` and mock env in
  `packages/providers/mock-env.ts`
- API-key lookup/auth configuration in
  `packages/providers/configs/api-key.ts`
- Infisical manifest entries for `<PROVIDER>_API_KEY` in
  `env.manifest.json`: add the key under the manifest path of every worker
  that serves the provider's modality — `/services/cfw-stt-api` for STT,
  `/services/cfw-tts-api` for TTS (create those blocks if missing),
  mirroring how `/services/cfw-image-api` lists its image-provider keys.
  Audio inference runs on those dedicated workers, which read provider
  keys straight off their own worker env via `ensureProvidersEnv` —
  not on `cfw-api`, which is frozen. The key must ALSO be listed under
  `/services/cfw-api`: the mapping validator builds that path's expected
  set from every key in `packages/providers/env.ts`
  (`getProviderApiKeys()` in `scripts/infisical/config.ts`), so a key
  declared in the foundation PR but absent from `/services/cfw-api`
  fails the gate with `Missing from manifest` — this is a
  manifest-completeness requirement, not a statement that `cfw-api`
  serves audio at runtime. Also add the key under
  `/projects/mission-control` when Mission Control will exercise
  it for endpoint testing. Per
  [`INFISICAL.md`](../../../scripts/infisical/INFISICAL.md), the secret
  value lives in `/_providers`; the manifest lists the consuming paths
  that reference it, not `/_providers` itself. Do not add the key under
  `/services/cfw-internal-api` even though the provider monitor runs in
  `cfw-internal`: that block lists no monitored-provider keys and the
  validator does not map the path. The monitor's runtime key is a
  provisioning concern, covered below.
- Icon exhaustiveness in `packages/providers/configs/icons.ts` (return
  `undefined` if no icon asset exists yet — the switch must stay
  exhaustive)
- Provider monitor at `packages/provider-monitors/configs/<slug>/index.ts`
  and registration in `packages/provider-monitors/configs/all/index.ts` —
  follow [`add-provider-monitor`](../add-provider-monitor/SKILL.md)
- Required regeneration: OpenAPI (`bun run generate:openapi`), MCP
  (`bun run regen` in `services/cfw-mcp`), management SDK
  (`bun run generate:management-sdk`), and docs. Adding a `ProviderName`
  value changes generated enums, so the foundation PR is the only PR in
  the stack that should touch generated MCP/OpenAPI/SDK files.

If a descendant discovers a missing manifest entry, treat it as a
foundation-layer invariant: fix it in the lowest owning PR and cascade
the change upward per [`stacked-prs`](../stacked-prs/SKILL.md)
§Handling review feedback.

### Phase 1 credential-wiring gate

Before opening the foundation PR, confirm every item:

- [ ] `<PROVIDER>_API_KEY` is declared in `packages/providers/env.ts`.
- [ ] A mock value exists in `packages/providers/mock-env.ts`.
- [ ] An API-key getter exists in `packages/providers/configs/api-key.ts`.
- [ ] The icon registry has a case or explicit `undefined` in
      `packages/providers/configs/icons.ts`.
- [ ] `<PROVIDER>_API_KEY` appears in `env.manifest.json` under the
      manifest path of every worker serving the provider's modality
      (`/services/cfw-stt-api` and/or `/services/cfw-tts-api`), under
      `/services/cfw-api` (required by the validator for every key in
      `packages/providers/env.ts` — see above), and under
      `/projects/mission-control` when Mission Control needs it for
      endpoint testing.
- [ ] `bun run x scripts/infisical/validate-infisical-mapping.ts` reports
      no `Missing from manifest` finding for the new key. Three caveats:
      (1) the cfw-api provider-key check applies to EVERY key extracted
      from `packages/providers/env.ts`, so omitting the new key from
      `/services/cfw-api` triggers a finding even for audio-only
      providers; (2) the validator is informational — it always exits 0
      and main already carries preexisting `Missing from manifest`
      findings for other provider keys, so grep the output for YOUR key
      rather than expecting a clean run; (3) the validator's
      `PATH_SCHEMA_MAPPING` does not yet cover the media workers
      (`cfw-stt-api`, `cfw-tts-api`, `cfw-image-api`), so it cannot flag
      a key missing from those blocks — check them manually until the
      validator learns those paths.

This gate validates tracked credential wiring only. It does not create the
Infisical secret or provision production Worker secrets; those remain a
separate release-runbook step. That step must reference the `/_providers`
value from `/services/cfw-internal-api` as well as the modality worker
path: `executeProviderMonitors` runs in `cfw-internal`, whose Infisical
folder is `/services/cfw-internal-api` (the `x` script in
`services/cfw-internal/package.json`). Until then the monitor probe fails
auth on every run. Say so in the PR's provisioning note.

The foundation PR puts the provider in `userFacingProviderNames` and
`byokProviders` by construction (both derive from `PublicProviderName`).
A reviewer may flag that as premature exposure. Decline: every foundation
PR has shipped this way (Deepgram
[#27781](https://github.com/OpenRouterTeam/openrouter-web/pull/27781),
Fish Audio
[#28621](https://github.com/OpenRouterTeam/openrouter-web/pull/28621)),
the BYOK integrations UI is gated by DB provider rows with active
endpoints rather than the enum set, and excluding the slug from
`byokProviders` would remove it from the generated `ByokProviderSlug`
enum only to re-add it at launch.

If `services/cfw-mcp` changes, invoke and follow the
[`add-mcp-tool`](../add-mcp-tool/SKILL.md) skill.

Worked example: Deepgram foundation PR
[#27781](https://github.com/OpenRouterTeam/openrouter-web/pull/27781) —
provider identity, env, api-key getter, icon case, provider monitor, and
the mechanical OpenAPI/MCP/management-SDK regen, with zero adapter code.
This example predates the manifest gate above; do not use it as evidence of
complete `env.manifest.json` coverage.

## Phase 2 — Modality stacks

- STT in scope → follow `## STT layers` below from the foundation branch (or existing parent / `main`).
- TTS in scope → follow `## TTS layers` below from the foundation parent (TTS-only) or the STT adapter branch (combined).

In a combined onboarding, the TTS research note, TTS schemas/fixtures, and
TTS pricing/preauth work land in the shared aspect layers (research, schemas,
pricing), and only the TTS adapter phase emits its own PR on top of the STT
adapter branch.

## Gates before implementation

Per in-scope modality, the research note must show — before any Phase 2
stack or PR split:

1. **Pricing from the provider's primary source** (URL + date), for the
   API mode the adapter uses — or an escalation to the invoker per
   [`audio-research-provider`](../audio-research-provider/SKILL.md) §A.2.
   Never an estimate.
2. **Every request-level pricing modifier** with a
   SKU/endpoint/pinned-param decision.
3. **Request + response capability matrices** (voice mapping, formats,
   verbose responses, timestamps) matching what the adapter will
   actually implement — staged capability data must not advertise more.
4. **Capability metadata the serving schema accepts.** Capability
   metadata is validated at write time; never drop a capability field to
   bypass validation (see the completeness rule in
   [`audio-add-adapter`](../audio-add-adapter/SKILL.md)).

Endpoints stay private until staging reconciliation, deployment of the
owning worker, and smoke tests pass.

Mission Control editor links must use the full model **permaslug**:
`https://internal.openrouter.ai/model/edit/{model-permaslug}` — never
`{author}/{model-slug}`; permaslugs can carry a `YYYYMMDD` suffix the
public slug omits. Endpoint editor:
`https://internal.openrouter.ai/endpoint/edit/{endpoint_id}`. Provider
editor: `https://internal.openrouter.ai/provider/{provider-permaslug}/edit`.

## PR-stack orchestration

After research and before implementation:

1. Build an import/dependency graph of every file the onboarding touches.
2. Propose the exact PR sequence and a file-ownership matrix.
3. Explain why each layer compiles independently.
4. Assign every shared file to exactly one PR.
5. Get human approval of the stack shape.
6. Create branches bottom→top before staging/e2e with
   `gh stack init` / `gh stack add` / `gh stack submit` — see
   [`stacked-prs`](../stacked-prs/SKILL.md) §The file-ownership
   matrix and [`gh-stack`](../gh-stack/SKILL.md) for the commands.

Honor explicit requests for fine-grained separation, including a
doc/schema/SKU/adapter split. Do not collapse requested layers based only
on cascade cost.

Worked example — the Fish Audio combined STT+TTS stack (aspect-combined
layers, separate adapters):

- foundation
  [#28621](https://github.com/OpenRouterTeam/openrouter-web/pull/28621) →
  research (STT + TTS notes)
  [#28622](https://github.com/OpenRouterTeam/openrouter-web/pull/28622) →
  schemas/fixtures
  [#28624](https://github.com/OpenRouterTeam/openrouter-web/pull/28624) →
  pricing/SKUs + TTS preauth
  [#28627](https://github.com/OpenRouterTeam/openrouter-web/pull/28627) →
  STT adapter
  [#28636](https://github.com/OpenRouterTeam/openrouter-web/pull/28636) →
  TTS adapter
  [#28641](https://github.com/OpenRouterTeam/openrouter-web/pull/28641)

Earlier single-modality reference — the Deepgram (ECO-1489) STT split:
foundation [#27781](https://github.com/OpenRouterTeam/openrouter-web/pull/27781),
research [#27807](https://github.com/OpenRouterTeam/openrouter-web/pull/27807) →
schema [#27808](https://github.com/OpenRouterTeam/openrouter-web/pull/27808) →
pricing [#27809](https://github.com/OpenRouterTeam/openrouter-web/pull/27809) →
adapter [#27782](https://github.com/OpenRouterTeam/openrouter-web/pull/27782),
then TTS [#27783](https://github.com/OpenRouterTeam/openrouter-web/pull/27783)
(single TTS PR — superseded by the aspect-combined shape above for
combined onboardings).

### Cutting layers

Generic per-layer testability and verification checks live in
[`stacked-prs`](../stacked-prs/SKILL.md). Audio-specific additions
before cutting children from a lower PR:

- allow docs-sync/generated-file automation to settle where practical
- run required generation locally

Intentional schema-only exports in a lower layer can be flagged as unused
exports by the Fallow dead-code check; add them to
`scripts/fallow-dead-code-baseline.json` and note the intent in the owning
PR's description.

### Feedback, cascades, and merging

Owned by [`stacked-prs`](../stacked-prs/SKILL.md): fix the invariant
in the lowest owning PR, then cascade with `gh stack rebase` +
`gh stack push`; merges land bottom→top by construction.

Worked example: ECO-1489's required `metadata.duration` fix — schema
change in #27808, redundant adapter guard removal in #27782, then cascade
through the TTS branch.

## PR metadata

Follow [`stacked-prs`](../stacked-prs/SKILL.md) §PR metadata. Audio
deltas:

- title includes `N/M` (e.g. `feat(deepgram): add STT schema (2/6)`)
- when feedback names a specific layer, replace singular "the PR"
  language with the exact owning PR or the top PR

## What this skill does NOT do

- Implement any adapter, schema, pricing, or e2e work — that belongs to
  the four phase skills
- Own generic stack policy or `gh stack` mechanics — those live in
  [`stacked-prs`](../stacked-prs/SKILL.md) and
  [`gh-stack`](../gh-stack/SKILL.md); this skill owns the audio
  stack's *shape* and the foundation phase
- Provision provider keys in production — separate release-runbook step

## Related skills

- [`stacked-prs`](../stacked-prs/SKILL.md)
- [`add-provider-monitor`](../add-provider-monitor/SKILL.md)
- [`add-mcp-tool`](../add-mcp-tool/SKILL.md)


## STT layers

For an STT-only onboarding, stack the research note, schemas/fixtures, pricing and preauthorization, adapter, staging, and e2e/PR metadata layers according to the human-approved decomposition. Use [`audio-research-provider`](../audio-research-provider/SKILL.md), [`audio-add-adapter`](../audio-add-adapter/SKILL.md), [`audio-stage-endpoint`](../audio-stage-endpoint/SKILL.md), and [`audio-e2e-testing`](../audio-e2e-testing/SKILL.md) for the phase work. Review the adapter result against `packages/stt/REVIEW.md` (or `packages/tts/REVIEW.md` for TTS) before opening the adapter PR.

The STT adapter layer includes the response schema, duration/token pricing strategy and SKUs, STT factory/provider mapping, fixtures, and unit tests. Return the top STT branch when TTS is out of scope; when both modalities are in scope, it is the parent for the TTS adapter layer.

### STT human checkpoints

- **After research, before any code lands.** Review the research note with the human and confirm:
  - Does the URL inherit from `provider_info.baseUrl`, or do we hard-code it in `getUrl()`?
  - Is there a billing floor? Does it match what the provider's docs claim, and did the short-audio capture confirm it?
  - Are there surcharges we are deferring to v2? Each deferral must have an open question in the research note.
  - Is the rate from the provider's primary source (URL + date), and does it match the API mode the adapter uses (pre-recorded vs streaming)? If pricing could not be verified, the note must show the [`audio-research-provider`](../audio-research-provider/SKILL.md) §A.2 escalation — do not proceed on an estimate.
  - Does every request-level pricing modifier have a SKU/endpoint/pinned-param decision?
  - Which response capabilities will the adapter support (verbose_json, word timestamps, segments)? Each deferral must be an explicit open question, not silently omitted.
  - Are there async-only fields the provider surfaces in sync responses that we should preserve?
- **During the e2e UI spot-check.** Eyeball the two failure modes:
  - Price column reads `$0.000035 per second` but invoices charge `$0.000035 per minute` (or vice versa) — usually a `displayMultiplier` bug in `getPublicPricing`.
  - ProviderCard shows duplicate PRICING lines — usually the strategy emits both a duration SKU and a token SKU when only one applies.

### When STT onboarding is the wrong tool

- "Update `<provider>` STT pricing" → not this stack. Jump directly to the pricing strategy.
- "Fix a bug in an existing STT adapter" → not this stack. Edit the adapter and review against `packages/stt/REVIEW.md`.
- "Add streaming STT" → not this stack. Streaming is a v2 surface; raise the request and discuss scope before kicking off any phase.

## TTS layers

For a TTS-only onboarding, stack the same aspect layers on the foundation parent and finish with the TTS adapter, supported-format registrations, voice/model mapping, PCM/stream handling, and tests. Use the same phase skills above; their `## TTS` sections contain the modality-specific contract.

For combined onboarding, keep research, schemas/fixtures, pricing/SKUs, and preauthorization combined by aspect. The TTS adapter remains its own PR on top of the STT adapter branch, and the final TTS branch contains the complete provider for local testing.

### TTS human checkpoints

- **After research, before any code lands.** The billable-character definition and generic-vs-custom SKU decision gate everything downstream — do not write adapter code until they're approved. Confirm the voice↔model mapping: if the provider encodes voice in its model ID, the adapter must map `request.voice` to the upstream param and Mission Control gets one model-family record — not one endpoint per voice.
- **During the e2e UI spot-check.** Price-unit mismatches (per character vs per 1M characters) and missing voice/format controls need eyeballs.

The orchestrator owns capability discovery, provider-neutral gates, foundation work, stack shape, and human checkpoints. Stack policy lives in [`stacked-prs`](../stacked-prs/SKILL.md) and `gh stack` mechanics in [`gh-stack`](../gh-stack/SKILL.md); phase details live in the four audio phase skills.
