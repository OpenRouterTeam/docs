---
name: bump-provider-sdk
description: Bump a provider SDK package (`openai` or `@anthropic-ai/sdk`) safely — covers resolving TODO-tagged local type stubs onto shipped SDK types, auditing contract widenings/narrowings, Zod enum drift, deliberate deviations, fixture/snapshot fallout, OpenAPI + generated-client regeneration, and verification. Use when upgrading either SDK (typically the post-launch follow-up to a frontier model onboarding) or when a request fails Zod validation on a field the SDK type accepts.
user-invocable: true
---

# Bump a Provider SDK

The provider SDKs are the compile-time contract for the corresponding skin and
adapter schemas: `openai` for Chat Completions + Responses, `@anthropic-ai/sdk`
for Anthropic Messages (via `satisfies ZodShape<...>` /
`satisfies z.ZodSchema<...>` clauses). Frontier launches usually ship features
*before* the SDK types exist, using local widened/stub types tagged with a
greppable `TODO(<lab>-<feature>)` marker (e.g. `TODO(openai-sdk)`,
`TODO(anthropic-sdk-tool-changes)`). The bump PR is where those stubs collapse
onto official types — and where the SDK's actual contract gets audited against
what we shipped.

Reference bumps: #31475 (openai 6.46.0 → 7.2.0 major, new `fast` service tier
+ new Responses error code + zod-v4-native helpers dropping test casts),
#27785 (openai 6.26.0 → 6.46.0, TODO-widening collapse),
#30386 (anthropic 0.104.1 → 0.115.0, post Opus 5 launch), #22392 (anthropic
0.100.0, SDK-forced required field), #17892 (anthropic 0.87.0, `stop_details`
fallout across synthesized events + fixtures), #21077 (the Zod enum drift
production incident this skill exists to prevent).

## When to use

- Upgrading either SDK, typically right after a frontier launch to adopt the
  types the launch PRs stubbed locally.
- Diagnosing a request that fails Zod with `invalid_union` /
  `invalid_enum_value` for a value the current SDK type accepts (most common
  cause: a hand-written Zod enum that missed a prior bump).
- A new feature depends on types only present in a newer SDK version.

## Where each SDK is pinned

- **openai**: root `package.json (workspaces.catalog)` `catalog:` block;
  consumers reference `"openai": "catalog:"`. Update only the catalog.
- **@anthropic-ai/sdk**: pinned per-workspace (NOT in the catalog). Update
  every consumer in lockstep — `packages/router`, `packages/llm-interfaces`,
  `packages/batch`, `tests/e2e`, `tests/manual`; grep `"@anthropic-ai/sdk"`
  in package.json files to catch new consumers.

Then `bun install` from the root and commit `bun.lock` with the changes. If
the new SDK version is blocked by the release-age quarantine
(`minimumReleaseAge`), flag it to the requester — do not edit the policy or
its exclusion list yourself.

> The repo used to carry a `patches/openai@<version>.patch` with local type
> carve-outs; it was removed (June 2026). Deviations now live as widened local
> types (`Omit` + intersection, e.g. `LooseResponse*`) next to the schemas
> that need them, each with a comment documenting the deliberate deviation.
> Do not recreate the patch; extend or collapse those widened types instead.

## Post-bump audit (walk every step in order)

### 1. Resolve the TODO markers

`grep -rn "TODO(openai-sdk\|TODO(anthropic" packages/` — each marker documents
a local stub or deviation waiting on the SDK (or on vendor rollout). For type
stubs the SDK now covers: replace the local type with the official SDK type in
the `satisfies` clause, keeping the Zod schema as the runtime validator with
its `.openapi()` metadata. Markers waiting on non-SDK conditions (e.g. vendor
transport rollout) stay. Aim for zero stale markers (#27785 collapsed all
three launch PRs' widenings in one pass).

### 2. Diff the SDK contract against what we shipped

Diff the relevant `.d.ts` between versions (or read the SDK changelog, then
verify suspected changes in the type files directly):

```bash
# openai
node_modules/.bun/openai@<ver>/node_modules/openai/resources/responses/responses.d.ts
node_modules/.bun/openai@<ver>/node_modules/openai/resources/chat/completions/completions.d.ts
# anthropic
node_modules/.bun/@anthropic-ai/sdk@<ver>/node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts
```

The SDK contract is often **wider** than what was live-verified at launch —
from #30386: tool-change refs also allow `mcp_tool_reference`/
`mcp_toolset_reference`; tool-change blocks accept `cache_control`
(contradicting launch-time assumptions); custom tools gained `defer_loading`.
Narrower-than-SDK schemas 400 valid requests or silently strip fields.
**Live-test claims that matter** against the provider API (Infisical
`/_providers` secrets — see `CLAUDE.md`) instead of trusting either the docs
or the types. Also catch narrowings/removals: SDKs delete enum values too
(#13274 removed a stop reason) — grep business logic before assuming a
removed value was unused.

### 3. `as const satisfies <SDKType>` constants and required-field fallout

Typed constants (e.g. `packages/llm-interfaces/openai-responses/enums.ts`,
`.../anthropic-messages/enums.ts`) are keyed off SDK type aliases — `tsc`
fails until widened members are added. This is the compiler-enforced layer;
run `bun run typecheck` early and let the `satisfies` failures enumerate the
work. When the SDK adds a **required** field (e.g. `stop_details` in #17892),
update every site that constructs that shape: response schemas, all stream
message_start/message_delta variants, synthesized events/responses in
handlers, `.openapi()` examples, test mocks, and snapshot fixtures.

### 4. Trace new enum members end-to-end (the dead-branch trap)

Adding a widened enum value to the schema layer is NOT enough:

- **Anthropic**: `packages/router/skins/anthropic-messages/utils/stop-reason-mapper.ts`
  flattens unknown finish reasons (e.g. → `max_tokens`), so a new native stop
  reason needs an explicit preserve case or every downstream branch keyed on
  it is dead code (Devin Review caught this in #30386). Check
  `from-internal-stream/empty-content-monitor.ts` and other exhaustive
  stop-reason registries — their `Record<ORAnthropicStopReasonType, …>`
  maps make typecheck find them.
- **openai**: decide the normalization-boundary policy per widened value —
  map it to an existing value at the inbound boundary if it's meaningful to
  only one API surface, or propagate it if every downstream adapter accepts
  it. Make the decision explicit in the skin's request-transformer, not by
  widening the internal CC schema (#21077 mapped `'original'` → `'auto'`).

### 5. Hand-written Zod enums (the silent drift)

`rg 'z\.enum\(\[' packages/router/skins/openai-responses/schemas packages/router/skins/openai-chat-completions/schemas`
(and the Anthropic schema dirs). For each hit whose values mirror an SDK-typed
constant, derive it: `z.enum(<Constant>)`, not a hardcoded literal list — this
is the layer with no compile-time link to the SDK, and it is what shipped the
#21077 production incident. If a Zod enum is intentionally a strict subset,
keep it hand-written with a comment explaining the boundary. Fields the SDK
types as open unions (`(string & {}) | ...`) should be `z.string()`, not a
strict enum (#27785 fixed two such hazards).

### 6. Deliberate deviations from SDK types

Where our schema intentionally differs, keep the deviation and document it
with a comment at the schema so a future bump doesn't "fix" it:

- Stricter: e.g. compaction `content` required-nullable locally (clients
  replay the block verbatim from a response that always carries it) vs. the
  SDK's optional; `reasoning.mode` pinned to our closed enum vs. the SDK's
  open union (#27785).
- Looser: e.g. `encrypted_content` optional-nullable locally because the live
  API omits the field despite the SDK typing it required-nullable (#30386);
  `BetaMessageIterationUsage.model` optional because pre-beta responses omit
  it (#23805). Live-verify before trusting an SDK-declared response field —
  don't trust vendor types blindly, mirror what the API actually sends.

### 7. Fixtures and snapshots

Per `fixtures/AGENTS.md`: response-behavior changes want a raw
live capture + snapshot; existing snapshot fixtures may need regeneration when
required fields appear (#17892 updated 4 skin snapshots). If an SDK-declared
behavior cannot be triggered live (API doesn't emit the field yet; stop
reason not reachable — raw context overflow does NOT trigger
`model_context_window_exceeded`, the 1M limit is input-side validation), say
so explicitly in the PR body instead of fabricating a fixture, and unit-test
the mapping layers.

### 8. Re-audit old vendor-bug workarounds

A bump is a natural checkpoint: workarounds for observed upstream bugs may be
obsolete. Re-run the original repro live (fresh unique prompt prefixes, run
twice to observe cache write→read) before keeping OR deleting. #30386 deleted
`ensureTrailingSystemCacheBreakpoint` this way — Anthropic had fixed automatic
cache placement. Document the evidence matrix in the PR body; deletion needs
explicit human sign-off.

### 9. OpenAPI + generated clients

```bash
bun run generate:openapi
cd services/cfw-mcp && bun run regen   # if Anthropic Messages schemas changed
bun run generate:sdk:all               # if the public spec changed
```

Never hand-edit generated output (pinned Speakeasy version matters — see the
"Rebuilding the SDKs" knowledge). If a public schema widening trips
`openapi-breaking-check`, review the diff; apply the
`accept-breaking-sdk-changes` label only when the break is the intentional
SDK adoption (e.g. a field becoming a `oneOf`).

`sdk-build-check` reads the label from the `pull_request` event payload, and
the workflow only triggers on `opened`/`synchronize`/`reopened`. Labeling an
already-failed PR does not clear it and reruns replay the stale payload —
push a commit after labeling so the check sees the label.

## Verification

- `bun run typecheck` at the root (the `satisfies` clauses are the
  enforcement layer), or scoped `bun run typecheck` in the touched packages
  for fast iteration.
- Focused tests, e.g.:

```bash
bun test packages/router/skins/anthropic-messages \
  packages/router/adapters/anthropic-message \
  packages/router/adapters/internal-stream-anthropic-message \
  packages/llm-interfaces
# or the openai equivalents:
bun test packages/router/skins/openai-responses \
  packages/router/skins/openai-chat-completions \
  packages/router/adapters/openai-responses \
  packages/router/adapters/internal-stream-openai-responses
```

- Round-trip any request-schema widening through local `cfw-api` +
  `dev-fs-logs` to confirm the upstream body carries the new fields. For a
  suspected real-world failure mode (e.g. a client hitting a widened enum),
  reproduce the failing payload in a unit test before claiming the bump safe.
- Flag to the requester anything the new SDK is *missing* that we need, and
  any unexpected breakage — that report is part of the deliverable.
