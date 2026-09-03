---
name: onboard-frontier-model
description: Onboard a new frontier-lab text model (Anthropic Claude, Google Gemini, OpenAI GPT) — covers model ID enums, aliases and mapper families, provider configs (incl. Azure), adapter capability gating, new API params, docs, and the follow-up surfaces that are easy to miss. Use when a lab ships a new model or snapshot (e.g. "onboard claude-5-fable", "add gemini-3.5-flash", "onboard gpt-5.5").
user-invocable: true
---

# Onboard a Frontier Model

**This skill is a living document** (see `.agents/skills/AGENTS.md`).
Updating this file is part of the onboarding itself — see "Improve this
skill" at the bottom.

Checklist-driven skill for onboarding a new model from Anthropic, Google, or
OpenAI. Most onboardings are "parity with the previous flagship" plus zero or
more new capabilities. Work in two passes:

0. **DB-only check** — first decide whether any code change is needed at
   all. The ideal launch is pure DB ops (model/endpoint rows via
   `stage-endpoint`): permaslug-derived logic (thinking budget profiles,
   Gemini version gating, media resolution) covers new models
   automatically. Register the model in code only if code must reference
   it by name: an alias the lab's native API needs, model-gated adapter
   behavior, provider-config switches (Azure/Foundry), sibling maps, etc.
   The predecessor-key grep alone cannot settle this: it misses
   whole-enum consumers (code keyed on membership in `AnthropicModel` /
   `GoogleGeminiModel` / `OpenAIResponsesModel` as a set, e.g. adapter
   selection or supported-parameter derivation — grep the enum type
   names too) and a novel native alias the lab introduces (no
   predecessor reference exists — check the announcement/API id against
   our slug). Only after the parity grep, the whole-enum-consumer audit,
   and the alias check all come up empty, ship zero code changes
   (gemini-3.8-flash needed none, #39446). Consequence: the model ID
   enums are not a complete inventory of frontier models, and nothing
   should treat them as one. The alias-decision completeness check still
   fires at the right time — whoever later adds the enum entry (because
   code then needs it) is forced to record the alias decision then.
1. **Parity pass** — register the model everywhere its predecessor is
   registered. Small diff, ship fast (often pre-launch under embargo).
2. **Capability pass** — wire any genuinely new API behavior (new params,
   new message semantics) with fixtures and tests. Separate PR(s).

For non-frontier providers (new adapters), use `add-provider-adapter` instead.
For staging the model/endpoint rows in the local DB, use `stage-endpoint`.

## Arguments

- `$LAB`: `anthropic` | `google` | `openai`
- `$PERMASLUG`: dated OpenRouter slug (e.g. `anthropic/claude-5-fable-20260609`)
- `$PARITY_MODEL`: the predecessor whose capabilities this model inherits
  (e.g. `anthropic/claude-4.8-opus-20260528`)
- `$NEW_CAPABILITIES`: list of new API behaviors, if any (e.g. mid-session
  system messages, `phase` param, new effort level)

## Pass 1 — Parity registration

The reliable technique: `grep -rn "$PARITY_MODEL_ENUM_KEY" packages/` and
visit every hit. Decide per-site whether the new model belongs there. If no
hit requires naming the new model AND pass 0's whole-enum-consumer audit
and native-alias check also came up empty, stop — DB-only launch, no code
PR (see pass 0). Reference
onboardings: #23456 (fable), #22274 (Opus 4.8), #21568 (Gemini 3.5 Flash),
# 19098 (GPT-5.5).

### All labs

- [ ] Add the permaslug to the model ID enum:
  - Anthropic: `packages/models/id/anthropic.ts` (`AnthropicModel`, plus
    `AnthropicReasoningModel`, structured-outputs list, automatic-caching list
    as applicable)
  - Google: `packages/models/id/google.ts` (`GoogleGeminiModel`)
  - OpenAI: `packages/models/id/openai.ts` (`OpenAIResponsesModel` etc.)
- [ ] Azure config if the model is served on Azure/Foundry:
  `packages/providers/configs/azure.ts`. Endpoints on the
  `openrouter-foundry-east-resource` account get their API key from the
  base URL host, so a new OpenAI/Foundry East model needs no key case.
  Only a model on a different Azure resource needs a new key case, and
  then cover every switch that enumerates models (API key, completion
  URL), not just the first one you find.
- [ ] Alias decision: adding the model to its enum fails typecheck until you
  add an entry to `packages/models/id/frontier-alias-decisions.ts` — decide
  explicitly whether the lab's native API accepts an id that differs from our
  slug (e.g. `claude-5-fable` → `claude-fable-5`, bare `gpt-5.6` →
  `openai/gpt-5.6-sol`) and record `{ aliases, target }` or `null`. Include
  both author-prefixed and bare forms where the lab accepts a bare id.
  One-off/legacy aliases still live in `packages/models/id/alias.ts`
  (`DEV_rawSlugAliasMap`).
- [ ] Provider-mirrored numbering: do not add or remove numeric padding in the
  public slug. Compare its numeric token with the upstream `provider_model_id`,
  the official announcement, and same-family sibling slugs. If they disagree,
  reconcile the value with a human before staging. See `stage-endpoint` for
  the catalog evidence and the Hailuo failure case.
- [ ] Slug tests: `packages/models/slug.test.ts`.
- [ ] Double-check the **date suffix** in the permaslug against the lab's
  official announcement before merging; a wrong date means a renamed slug
  later. If the launch date slips after staging, remember the permaslug is
  OpenRouter's own immutable ID, not the lab's dated API string (the
  model-mapper resolves those by family regardless) — keeping the original
  date is functionally harmless; changing it is a cosmetic call that must
  move code + staged DB rows in lockstep.
- [ ] The permaslug must align with the slug (family-first, e.g.
  `claude-opus-5-...`) — historical version-first permaslugs
  (`claude-4.8-opus-...`) are legacy; new models follow the slug's ordering
  like sonnet 5 (jakob, PR #29793).

### Abuse controls and guardrails

The enum grep misses surfaces keyed on the dated permaslug string or an endpoint ID. Also grep `configs/terraform-monitors` and `packages/routing` for the predecessor's permaslug and decide per site:

- [ ] Per-model Datadog abuse monitors, e.g. `configs/terraform-monitors/monitoring/fable_transaction_attempt_spike.tf` (`local.fable_spike_models`).
- [ ] New-account RPM whitelist `NEW_ACCOUNT_RATE_LIMITED_MODELS` (`packages/rate-limit/new-account-rate-limit.ts`) — a product call, see the model-launch runbook.
- [ ] BYOK-only gating: set `is_byok_only` on the endpoint row. The `BYOK_ONLY_ENDPOINT_IDS` blocklist (`packages/routing/filters/by-non-byok-endpoint-blocklist.ts`) is keyed by endpoint ID and does not carry over to new endpoints.
- [ ] Endpoint `limit_rpm` caps on the predecessor's endpoint rows are DB, not code — carry them over when staging.

### Anthropic-specific

- [ ] `packages/providers/configs/anthropic.ts`: the per-model beta-header
  switches (caching, max tokens, etc.).
- [ ] Capability sets in `packages/router/adapters/anthropic-message/`
  (effort levels, thinking support).
- [ ] New model **family** (beyond opus/sonnet/haiku)? Register it in the
  model-mapper in `packages/router/skins/anthropic-messages/utils/` so SDK
  model names resolve (#23483).
- [ ] Fast mode? **Do not create a dedicated `*-fast` sibling model — that
  concept is deprecated.** New models support Anthropic fast mode with a
  persisted `service_tier: fast` endpoint row under the regular model (fast
  pricing baked into the row's own pricing, no code change): the tier row
  drives routing admission, upstream `speed: "fast"` + beta-header
  injection, billing reconciliation against returned `usage.speed`, the
  `/fast` slug segment, and footer presentation automatically. Do NOT add a
  `FAST_SIBLING_BY_PERMASLUG` entry for new models — that map (and the
  anthropic-speed-router plugin's model swap) exists only for the four
  legacy `*-fast` models (opus 4.6/4.7/4.8, opus 5), which stay for
  request compatibility; the plugin prefers a persisted fast row when one
  exists and serves legacy `*-fast` requests from it. Speed/fast mode is
  currently supported by the Anthropic 1P provider only — only create fast
  tier rows on providers with verified upstream fast-mode support.
  `service_tier: "fast"` ([OpenAI's Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)
  alias for `priority`, #31475) is admitted by the generic tier machinery.
- [ ] Azure additions also want a row in the Foundry URL param table in
  `packages/providers/configs/provider-url.test.ts`.
- [ ] Check how thinking/reasoning is gated for the new model — mandatory-
  reasoning models must not end up with thinking disabled, and workarounds
  scoped to older snapshots must not leak onto the new one. The gating code
  gets refactored often, so read the current implementation rather than
  trusting this file.
- [ ] Permaslug naming flipped to family-first for the 5.x line
  (`anthropic/claude-sonnet-5-<date>`, not `claude-5-sonnet-<date>`). Use the
  exact slug the announcement/DB gives; the model-mapper + alias map already
  handle both orderings.
- [ ] Adding a new `{version}_{family}` key to the model-mapper
  `VERSION_FAMILY_MAP` can flip an existing "unknown version falls back" test
  into a real mapping — update that test instead of leaving the bare-prefix
  assertion (Sonnet 5 hit this in model-mapper.test.ts).
- [ ] For new beta headers announced with the model (e.g. mid-conversation
  tool changes), decide per-beta whether to auto-derive server-side or keep
  it a client opt-in via `ALLOWED_CLIENT_BETA_FEATURES`. Auto-derive only
  when sending the header is safe for the user: it doesn't change the
  request/response contract beyond the feature the request already opted
  into by its shape (e.g. it only unlocks blocks/fields the request itself
  contains). Keep it end-user opt-in when the beta alters behavior,
  response format, pricing, or semantics on its own (or when in doubt).
  When auto-deriving: add a `get*BetaHeader()` helper in
  `packages/providers/configs/anthropic.ts`, and list the token in
  `CONSUMED_CLIENT_BETA_FEATURES` (not `ALLOWED_CLIENT_BETA_FEATURES`) so a
  client-sent copy is never forwarded verbatim. Prefer usage-derived
  emission: only send the token when the request actually uses the feature
  (mid-conversation tool changes detects `tool_addition`/`tool_removal`
  blocks and custom-tool `defer_loading` via
  `usesMidConversationToolChanges(rawRequestBody)` — #29815), so ordinary
  traffic never carries a token a transport might reject pre-launch. Keep
  the detection hot-path-lean (structural short-circuits + per-item
  `buildZodGuard`, no whole-array parsing). Gate on a denylist (new models default to
  supported) matching the vendor's confirmed support list; verify related
  feature sets actually align before reusing one (mid-conversation tool
  changes needed its own `anthropicMidConversationToolChangesUnsupportedModelSet`
  because Sonnet 5 supports inline mid-session system but NOT tool changes).
  Do not provider-gate the helper (e.g. Vertex) without confirmed provider
  divergence. When transports genuinely diverge (e.g. Bedrock rejects a beta
  token at the AWS layer while 1P accepts it), gate by **endpoint adapter
  name**: a supported-adapter set in `packages/models/id/anthropic.ts` shared
  by the beta helper AND a routing filter
  (`packages/routing/filters/by-mid-conversation-tool-changes-support.ts`,
  #29917) so feature-bearing requests never route to unsupported transports.
  Make the routing filter model-aware too: drop unsupported-model endpoints
  per-endpoint (mixed `models` pools must not route a feature request to an
  unsupported sibling) and return a clear 400 naming the model when no
  endpoint supports the feature — honest model-level errors beat opaque
  upstream/transport 400s (follow the `by-cache-control-support` /
  advisor-filter patterns). Transport support can be model-specific within
  a lab (Bedrock launched tool changes for Opus 5 only), so prefer a
  model+transport predicate over a blanket transport exclusion, and share
  it between beta emission and the routing filter.
  Key by `endpoint.adapter_name` (metadata names like
  `AnthropicMessageAdapter`), not the concrete classes `adapterFactory`
  instantiates. Gotcha: `createMockModelEndpoint` defaults `adapter_name` to
  `OpenAIAdapter` regardless of provider — tests of adapter-gated behavior
  must set `endpointOverrides.adapter_name` explicitly.
  Expect the
  EAP/preview model id to reject the beta token until public launch — verify
  the forwarded header + body via dev-fs-logs
  (`adapters/base-fetch-request.log`) and re-test at launch.
- [ ] Wire any `getHeaders` beta-header change into
  `packages/router/adapters/internal-stream-anthropic-message/index.ts`
  and any Bedrock/Vertex/Azure subclasses that override `getHeaders`
  (e.g. `amazon-bedrock/invoke/internal-stream-anthropic.ts`); each
  override has its own independent `getHeaders`, so changing only the
  base passes unit tests but silently no-ops in production for the
  subclass endpoints.
- [ ] Note `this.rawRequestBody` in adapters is the post-skin *normalized*
  body for skin traffic: native Anthropic content blocks arrive wrapped as
  `anthropic-v1-messages:passthrough` envelopes, so detection helpers must
  handle both the native shape and the passthrough-wrapped shape.
- [ ] Adaptive-only thinking (no `budget_tokens`) needs no code: any model not
  in the `anthropicBudgetOnlyThinkingModels` denylist defaults to adaptive.
  Disabling temperature/top_p/top_k and the `supported_reasoning_efforts`
  (e.g. adding `xhigh`) are DB/seed levers, not code.

### Google-specific

- [ ] Thinking budget profile derived correctly for the permaslug in
  `packages/router/adapters/google-gemini/` (Flash / FlashLite / Pro is
  derived from the slug — verify the new model lands on the right one).

### OpenAI-specific

- [ ] `packages/models/id/openai.ts` — check the announcement for sibling
  models (mini/nano/pro) released alongside; sometimes it's just one model,
  sometimes several. Don't assume either way.
- [ ] Responses-API pricing schema if new SKUs ship with the model
  (image output token tables, cached-token SKUs, service tiers).
- [ ] Pro variant reachable via `reasoning.mode`? Pair standard→pro in the
  openai-reasoning-mode-router plugin's sibling map (#27592).
- [ ] Azure `getAzureAPIKey` (`packages/providers/configs/azure.ts`) only
  needs a new permaslug case when the model is served from a resource other
  than the Foundry East account (that one is matched by base URL host). The
  completion-URL switch never needs Responses models, since the Responses
  adapter builds its URL from the endpoint config (#27592 initially missed
  this).

## Pass 2 — New capabilities (if any)

Each new API behavior follows the same shape (see `phase` param, #15387, and
mid-session system, #22274):

1. Capture a **real upstream fixture** (`create-fixtures` skill) of the new
   behavior.
2. Wire request side: skin request schemas → adapter request transform.
   When the lab's SDK does not yet ship types for the new feature, write
   local stub types next to the Zod schemas and tag every one with a
   greppable `TODO(<lab>-<feature>)` marker — the post-launch SDK bump
   (see Follow-up surfaces) resolves them onto official types.
3. Wire response side: adapter response schemas → skin stream/non-stream
   handlers (`from-internal-stream/`).
4. Decide cross-skin policy explicitly: does the new field surface in
   chat/completions, or only the native skin? (e.g. `phase` ended up
   Responses-only, #15387.)
5. Regenerate the OpenAPI spec, SDKs, and docs. The OpenAPI YAML files
   (`openrouter-openapi.yaml`, `projects/docs/openapi/openapi.yaml`) are
   **generated** from the Zod schemas you edited in steps 2-3, never hand-edit
   them. Run `bun run generate:openapi`,
   then commit the regenerated output (see "Rebuilding the SDKs" knowledge —
   pinned Speakeasy version matters).
6. Migration guide if user-facing:
   `projects/docs/cookbook/evaluate-and-optimize/model-migrations/` (#15169).
   Wording gotchas from #29992: keep prose API-neutral ("reasoning
   enabled/disabled") and name concrete parameters only inside labeled
   per-API code examples; time-anchor provider-support claims ("As of
   launch, Bedrock supports X on <model> only") so they stay true as
   support expands; skip stale-news claims (features prior models already
   shipped); link the lab's feature docs once live — and verify their
   claims against the live API before echoing them (their docs wrongly
   denied Sonnet 5 mid-conversation system support at Opus 5 launch).

## Follow-up surfaces (the PRs you'll otherwise ship next week)

- [ ] Public docs references to the new flagship. Under embargo, strip
  publicly-visible references until launch.
- [ ] Caching behavior: verify prompt-cache breakpoints land correctly with
  the model's typical message patterns.
- [ ] Mission-control dropdowns/toggles that enumerate models or adapters.
- [ ] Provider-monitor pricing schema for the new model's pricing shape.
- [ ] Quickstart examples if the model introduces a new modality (follow the
  quickstart formatting knowledge).
- [ ] `~<family>-latest` repointing: do NOT move the tilde-latest alias (a DB
  version-group change, not code) to the new model at launch. Hold it on the
  previous model until the new one is proven stable AND all providers support
  it; repoint as a deliberate follow-up.
- [ ] Post-launch SDK bump: once the lab publishes the SDK release carrying
  the launch's types, ship a follow-up PR bumping the SDK
  (`bump-provider-sdk` skill) resolving the `TODO(<lab>-<feature>)`
  stubs, auditing the SDK
  contract against what launched (it is often wider: MCP tool refs and
  `cache_control` on tool-change blocks in #30386), tracing new enum
  members end-to-end, and re-testing old vendor-bug workarounds for
  obsolescence.
- [ ] Launch-day re-verification: pre-launch live tests run against EAP
  ids and staged assumptions — at launch, confirm the 1P upstream model
  string (labs may accept only the undated id, e.g. `claude-opus-5`, with
  dated strings 404ing and the EAP alias removed), and re-run any positive
  paths that were unit-test-only because no live endpoint existed (e.g.
  Bedrock × new-model beta support).
- [ ] Post-launch general sweep (big frontier launches only): one PR to main
  updating every platform reference to the previous flagship — workflow model
  defaults (`.github/workflows/agent-mentions.yml`), pareto-router code tiers,
  homepage featured models / routing visualization, the hand-maintained
  auto-router featured shortlist
  (`packages/models/id/auto-router-featured-models.ts`), chat dev-seed, storybook
  model fixtures, and tests/stories using the old slug as generic example
  data. Mirror the prior sweep (#22420 → 4.8, #29997 → Opus 5). Leave
  untouched: captured fixtures/SSE payloads, version-specific behavior tests
  (model-mapper, speed router), the old model's own configs/alias decisions,
  comments, and seeds.

## Verification

- `bun run typecheck` at workspace root (never bare `tsc`).
- `bun run lint && bun run format`.
- Targeted tests: `bun test packages/router/adapters/<adapter>` plus
  model-mapper / slug tests.
- Every new upstream behavior from Pass 2 has a captured raw fixture in
  `fixtures/<provider>/` and a snapshot test (`create-fixtures` skill) —
  no capability change merges on synthetic payloads alone.
- Stage the model locally (`stage-endpoint`) and send a real request through
  `bun run dev cfw-api`; inspect dev-fs-logs for the adapter request/response.
- Before staging, verify every endpoint's effective
  `context_length_override ?? model.context_length` is positive (image-
  generation endpoints use the runtime default).
- Embargoed launches: keep the **PR title completely free of model names** —
  no marketing name and no permaslug (the permaslug leaks the name too). Use a
  generic title like `feat(google): parity registration for upcoming models`.
  Unlaunched models are under NDA on a need-to-know basis; the title shows up
  in notifications, changelogs, and search. Permaslugs are fine inside the
  diff and PR description body when the repo is private, but keep the
  marketing name out of the description as well.

## Improve this skill (required final step)

Apply the universal checklist in `.agents/skills/AGENTS.md`, plus these
onboarding-specific points:

1. **New sites**: did `grep` for the parity model surface a registration site
   this file doesn't list? Add it, with the file path.
2. **Post-launch fixes**: if you're back in this skill because a previous
   onboarding needed a follow-up fix, fold that fix into the "Follow-up
   surfaces" section so the next run catches it pre-merge.

Commit the skill edit in the onboarding PR itself (or a sibling PR if the
onboarding is embargoed). Keep edits surgical: this file should stay a tight
checklist, not accumulate prose. If a learning is big enough to need
paragraphs, it probably wants its own skill or a nested `AGENTS.md`, link
to it from here instead.
