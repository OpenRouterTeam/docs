# Fusion API — User Story Matrix

## Columns

| Column | Purpose |
|--------|---------|
| **User Story** | The need and the reason behind it |
| **Capacities** | Distinct capabilities that serve this story |
| **Acceptance Criteria** | What "working" looks like |
| **Constraints** | Hard rules that must hold |
| **Implementation** | How it's built |
| **Issues** | What's currently wrong — failures, bugs, gaps |
| **Disharmonies** | Where this story creates tension with the others |

---

## 1 — Multi-model analysis

| | |
|---|---|
| **User Story** | As a consumer, I want my prompt analyzed by multiple models so that the final response benefits from diverse reasoning and is more thorough than any single model could produce. |
| **Capacities** | Parallel model dispatch — all panel models run concurrently. Streaming text accumulation — inner calls stream SSE chunks and accumulate only `delta.content` into `O(final_text)`, reducing parent Worker heap pressure. Web-grounded panel + analysis — the analyst always has `openrouter:web_search` and `openrouter:web_fetch`, and panels have them by default (gated by the `web_search` param, default `true`), enabling independent claim verification and blind spot discovery. Live streaming — panels, the structured analysis, and the caller-model synthesis stream incrementally to consumers over the Responses API via additive `response.fusion_call.*` events. Epistemic framing — analysis prompt anchors the analyst in truth-seeking (epistemically rigorous, ontologically grounded) rather than consensus-seeking. Instruction forwarding — system/developer messages from the outer request are passed to panel models. Graceful degradation — partial panel failure still produces results with typed error reporting. Two public entry points — server tool and model alias route through the same fusion tool execution path; plugin preferences configure runs started by either entry point. Prompt injection mitigation — panel responses are wrapped in XML tags with guards. Header sanitization — inner calls strip dangerous headers (auth, forwarding, depth). Session continuity — cookie-authed users get short-lived internal auth tokens for inner calls. Per-call timeout — each inner call is capped at 300s. Typed failure reasons — `FUSION_FAILURE_REASON` enum surfaces actionable error codes (`all_panels_failed`, `insufficient_credits`, `rate_limited`, `judge_not_valid_json`, `judge_upstream_error`, `judge_empty_completion`, `judge_schema_mismatch` (the analysis-stage codes keep their pre-rename spelling)). Status code preservation — inner-call errors preserve HTTP status codes so 402/429 are distinguishable from true 500s. |
| **Acceptance Criteria** | With the default panel and at least two successful panel calls, tool result contains `responses` array with entries from ≥2 distinct model slugs. Tool result contains a populated `analysis` object with the five schema-required fields. System/developer instructions are extracted, joined, and forwarded as the system message in each panel call. Analyst calls always include `openrouter:web_search` and `openrouter:web_fetch`; panel calls include them unless `web_search: false` is set. When 1+ panel models fail but others succeed, tool result has `status: "ok"` with a non-empty `failed_models` array. When all panel models fail, tool result has `status: "error"` with a typed `failure_reason`. The server tool and model alias entry points make `runFusion()` reachable; plugin preferences configure either path. Panel response content containing `</response>` is escaped before interpolation into the analyst prompt. Cookie-authed requests complete the full pipeline without 401/403 on inner calls. No inner call blocks longer than 300s. |
| **Constraints** | At least 1 panel model must succeed. In the server tool path, the calling model controls the final response — fusion only provides analysis data. Instructions are forwarded to panel models only, not to the analyst. Web tools are always enabled for the analyst; panel web tools are enabled by default but can be disabled per-request via `web_search: false`. 300s per-call timeout on all inner calls. Tool input is a single prompt string — full conversation history from the outer request is not forwarded to the panel. |
| **Implementation** | `runFusion()` dispatches all panel models (`analysisModels`) via `Promise.all` with streaming. Two public entry points: server tool and model alias; plugin preferences configure the model-alias path. Server tool returns `{ status, analysis, responses, failed_models }`. System/developer messages are extracted and passed as a system message to each panel call. Analyst does not receive caller instructions. Web search and web fetch are always enabled for the analyst and enabled for panels by default (the `web_search` param, default `true`, gates the panel side). Analyst output is parsed via a two-layer strategy: `parseWith` (response-healing cascade) with a fusion-specific `extractLargestMatchingJson` fallback that scans all balanced JSON blocks and validates against the analysis schema. Panel responses are wrapped in `<response>` XML tags with injection guards before analyst analysis. Inner call headers are sanitized via a denylist. Cookie-authed sessions mint short-lived internal auth tokens for inner calls. **Labs-only:** the main run streams the whole pipeline — panels, analysis, and the caller-model synthesis in-band — over the `openrouter/fusion` alias on the Responses API (no separate client-side synthesis pass); a client-side synthesis/analysis call is retained only for manual re-synthesis and single-model retry. |
| **Issues** | Single-model degradation produces hollow comparative fields with no signal to the consumer. Instructions not forwarded to analyst — if caller says "focus on European markets," panel will receive that instruction but the analyst may not weight it accordingly. Web tools add cost on every invocation even when training data would suffice; the analyst's web tools have no opt-out (panels can opt out via `web_search: false`), and the analyst prompt instructs selective use based on epistemic confidence but cannot guarantee minimal tool use. API path has no direct enforcement that the outer model must use the analysis well — calling model may ignore analysis entirely. No minimum panel success threshold beyond 1. Conversation history is lost — only the prompt string reaches the panel. No prompt injection mitigation on the API synthesis path — the server tool path hands raw analysis JSON to the calling model with no guard. Inner calls bill under the consumer's account but per-call cost breakdown is invisible. No retry on individual panel model failure. `x-openrouter-no-server-tools` header on the outer request is stripped for inner calls. Outer model thrashing on fusion error — when fusion returns `{status: "error"}`, the outer model tends to re-call fusion. Panel models can time out (300s) or produce empty streams due to upstream provider issues (content filters, extended reasoning loops). Worker OOMs may be related to `web_fetch` memory pressure — each fetch can buffer ~30-40MB transient. Refusal-only streams become empty completions and are reported as panel failures rather than surfaced as refusals. |
| **Disharmonies** | Partial degradation undermines **1.3** — comparative analysis dimensions have little evidentiary basis with 1 model. The analyst's non-optional web tools limit **1.4** — cost can't be fully controlled even though panels can now opt out via `web_search: false`; the analyst uses tools selectively via epistemic framing but this is guidance, not enforcement. Outer model thrashing on error can create a feedback loop that compounds **1.4** cost. Fixed 300s timeout conflicts with **1.2** — consumers who pick slow reasoning-heavy models may hit timeouts. |

### 1.1 — Selective invocation

| | |
|---|---|
| **User Story** | As a consumer, I want fusion to run only when the task warrants it, so I don't pay the cost and latency penalty on simple prompts. |
| **Capacities** | Tool-description guidance — the model reads a description to decide whether to invoke. Forced invocation — `tool_choice` overrides the model's decision. Forced fan-out on the model alias — the `openrouter/fusion` path injects an analyst directive requiring the tool be called exactly once on every request, including trivial/one-word prompts, so the alias always fans out (the directive is not forwarded to panels). Auto-injection — model-alias path attaches the tool automatically. Explicit disable — `enabled: false` in plugin config is a hard kill-switch. Single-invocation cap — model alias path defaults `max_tool_calls` to 1 so the outer model can invoke fusion at most once per request. Config propagation — plugin config core fields are forwarded to the server tool's `parameters` (partial — `max_completion_tokens`, `reasoning`, `temperature` are not propagated from the plugin schema). Paid plugin credit hold — request is pre-authorized as a paid plugin regardless of entry point. |
| **Acceptance Criteria** | On the server-tool path, a trivial prompt produces no `openrouter:fusion` tool call while a complex research prompt does. On the `openrouter/fusion` model-alias path, every prompt — including trivial ones — produces exactly one fusion tool call (via the injected analyst directive). When `tool_choice` specifies fusion, the response always contains a fusion tool call. When `plugins: [{id: "fusion", enabled: false}]` is sent alongside `model: "openrouter/fusion"`, no fusion tool call and no inner calls are made. Plugin-only activation on a non-Fusion model returns HTTP 400. When using the model alias, `max_tool_calls` defaults to 1. Plugin config fields `analysis_models`, `model`, and `max_tool_calls` appear in the injected tool entry's `parameters` object. |
| **Constraints** | The tool description is the only mechanism guiding the model's decision — no programmatic heuristic. When using the model alias, the outer model sees the resolved analyst model slug, not `openrouter/fusion`. |
| **Implementation** | A tool description tells the model when fusion is/isn't valuable. `tool_choice` can force invocation. The FusionPlugin resolves the model alias, injects the `openrouter:fusion` tool, and enforces the recursion guard. `enabled: false` is a hard kill-switch. Model alias path defaults `max_tool_calls` to 1. Plugin config merges into the tool's `parameters` field when the tool entry doesn't already have its own parameters. |
| **Issues** | No middle ground between full model autonomy and forced invocation — binary control only. Model decision quality varies across models and is not observable. Tool description is static — can't adapt to the consumer's domain. Plugin schema has a reduced config surface — three cost-control knobs are missing. Composability gap with other server tools — model might invoke other tools instead of fusion. Agentic client re-firing — in agentic clients that re-issue requests on every tool result, `model=openrouter/fusion` makes fusion available on every agent-loop turn; 10 agent rounds can become 10 full fusion runs. `max_tool_calls: 1` addresses per-request re-firing but not per-session re-firing. |
| **Disharmonies** | If the model decides not to invoke, **1** is not fulfilled. The `max_tool_calls: 1` asymmetry between entry points undermines **1.4**. Per-session re-firing in agentic clients multiplies **1.4** cost exposure unboundedly. Selective invocation can't account for **1.3**'s fixed analysis scope. |

### 1.2 — Model configuration

| | |
|---|---|
| **User Story** | As a consumer, I want to control which models answer and which model analyzes them, so I can optimize for quality, cost, or domain expertise — or trust reasonable defaults when I don't have a preference. |
| **Capacities** | Panel model selection — custom list or curated presets (Quality, Budget). Analyst model selection — explicit choice or intelligent default via three-step cascade (explicit param → caller model → default). Self-reference validation — circular configs are caught and rejected. Preset system — pre-built model combinations for common use cases. Tilde-latest alias resolution — slugs like `~anthropic/claude-opus-latest` resolve to the newest concrete model. Fallback defaults — hardcoded fallback keeps the default panel non-empty when preset data is missing. Model variant support — fusion works with model variants (e.g., `:extended`, `:free`). Panel model independence — each panel model runs in its own invocation with independent auth, timeout, and error handling. |
| **Acceptance Criteria** | When `analysis_models` is provided, the panel contains only those slugs. When omitted, the panel uses the Quality preset. When `model` is provided, the analysis JSON is produced by that model. When `model` is omitted, the analyst defaults to the calling model's slug. When `analysis_models` includes `openrouter/fusion`, the request returns a 400 error. When empty, Zod validation rejects. When containing `~latest` aliases, inner calls target concrete model slugs. When Quality preset data is missing, the hardcoded fallback is used. |
| **Constraints** | Panel capped at 8 models, minimum 1. Self-referential slugs rejected after alias resolution. Analyst cannot be `openrouter/fusion`. Tilde-latest resolution happens at request time. |
| **Implementation** | Zod schema validates `analysis_models` (min 1, max 8) and `model` fields. Quality preset provides defaults with a hardcoded fallback. Self-reference check runs after alias resolution. Tilde-latest resolution via `resolveTildeLatestAlias()`. Analyst default cascade: `params.model ?? callerModel ?? DEFAULT_FUSION_MODEL`. Analyst receives strict JSON response format. |
| **Issues** | No cost estimate at config time. No validation that specified models exist or are available before dispatching. Budget preset is only available in the labs UI. No way to mix presets. Consumer can't predict which concrete model a tilde-latest alias will resolve to. No model capability validation — consumer can specify a model that doesn't support strict JSON as the analyst; the pipeline attempts it and the bulletproof parser handles most failures, but weak models (e.g., gpt-4o-mini, kimi-k2) can still produce low-quality analysis. |
| **Disharmonies** | When the analyst defaults to the caller model, the same model analyzes the panel — potential self-evaluation loop. Cost opacity limits **1.4**. Freedom to choose cheap panel models can degrade **1.3** output quality with no signal to the consumer. Tilde-latest aliases undermine **1.4** cost predictability. |

### 1.3 — Analysis output

| | |
|---|---|
| **User Story** | As a consumer, I want to see exactly where models agree, disagree, or leave gaps, so I can assess confidence and coverage rather than receiving a blended answer that hides the disagreements. |
| **Capacities** | Five-dimensional analysis — consensus, contradictions, partial coverage, unique insights, blind spots. Schema validation — output conforms to a well-defined, validated JSON shape. Constrained response format — analyst is required to produce schema-compliant JSON. Raw panel responses — both the Chat Completions tool result and the Responses API output item include the panel's raw responses (model + content) alongside the analysis, and panels also stream live via `response.fusion_call.panel.*` events. Epistemic verification — analyst uses web tools to verify claims and discover blind spots rather than just comparing panel text. Status reporting — tool result includes `status` ("ok" or "error"). Failed model attribution — `failed_models` array tells the consumer exactly which models failed and why. |
| **Acceptance Criteria** | Tool result `analysis` object contains all five required keys. Each key's value is an array (possibly empty). Each `contradictions` entry has `topic` and `stances` with `model` + `stance` pairs. Each `partial_coverage` entry has `models` and `point`. Each `unique_insights` entry has `model` and `insight`. Analyst output that omits a required field is rejected by runtime schema validation. Both the Chat Completions tool result and the Responses API output item include a `responses` array with `model` + `content`. |
| **Constraints** | Requested JSON schema is strict — `additionalProperties: false`, all 5 fields required, each can be empty array. Analysis prompt prohibits the analyst from synthesizing. |
| **Implementation** | Zod schema and strict JSON schema define the five analysis fields. Analysis prompt anchors the analyst in epistemic rigor, instructs evaluation across all 5 dimensions with a "1-2 sentences max" guideline and "no synthesis" instruction. Analyst output is parsed via `parseWith` + `extractLargestMatchingJson` fallback — handles prose preamble/postamble, interleaved tool results, markdown fences, trailing content, and self-corrections. 18 adversarial unit tests cover every known agent-output pattern. **Labs-only:** `createStreamingAnalysisParser` uses SAX-style parsing for the UI analyst stream. |
| **Issues** | With only 1 panel model, contradictions and partial_coverage have little comparative basis. Analyst can cite model names not validated against actual panel participants. The "1-2 sentences max" instruction is a soft guideline. The five dimensions are fixed — consumer can't request a subset or add custom dimensions. Analysis quality degrades silently with model quality — the output schema is identical regardless of model capability. |
| **Disharmonies** | Depends on **1** delivering multiple successful panel responses. **1.2**'s freedom to choose cheap models determines analysis quality with no signal to the consumer. Fixed five dimensions can't be subsetted — **1.4**'s cost controls can't reduce the analyst's workload. |

### 1.4 — Cost control

| | |
|---|---|
| **User Story** | As a consumer, I want to control the cost of fusion and trust that it's bounded, so I can use it in production without risk of runaway spend. |
| **Capacities** | Agent step limits — cap how many tool-calling steps each inner model takes. Token budget — cap output tokens including reasoning. Reasoning effort control — set the effort level for inner calls. Temperature control — tune sampling for inner calls. Panel size cap — hard limit on how many models run in parallel. Per-call timeout — each inner call capped at 300s. Recursion prevention — fusion cannot invoke itself. Self-reference rejection — circular configs caught at validation. Signed header trust model — cost-escalating headers require cryptographic signature. Paid plugin credit pre-authorization — fusion is treated as a paid plugin for credit holds regardless of entry point. Uniform parameter propagation — cost-control parameters apply across all panel and analyst calls. |
| **Acceptance Criteria** | When `max_tool_calls: 4` is set, each inner call's `x-openrouter-fusion-max-steps` header is `4`. When `max_completion_tokens` is set, each inner call includes it. When `analysis_models` has >8 entries, Zod validation rejects with 400. Inner panel calls cannot trigger nested fusion — tool stripped at depth ≥ 1. Outer requests at depth ≥ 1 receive no fusion behavior. Unsigned `max-steps` headers are ignored. Credit pre-authorization works across all entry points. |
| **Constraints** | `max_tool_calls` capped at 16, defaults to 4. Panel capped at 8, defaults to 3. Depth ≥ 1 blocks re-entry. Self-referential configs rejected at validation. Even signed senders can't exceed the hard ceiling. |
| **Implementation** | Zod schema validates all cost-control fields with hard caps. `sharedCallOpts` propagates `maxToolCalls`, `maxCompletionTokens`, `reasoning`, and `temperature` uniformly. Agent step limit is conveyed via signed `HEADER_FUSION_MAX_STEPS`. Fusion depth header prevents recursive invocation. Self-reference check rejects circular configs. `hasFusionServerTool()` ensures paid plugin credit holds. |
| **Issues** | No way to disable the analyst's web tools to reduce cost (panels can be disabled via `web_search: false`); the analyst prompt instructs selective use based on epistemic confidence but cannot guarantee minimal tool use. No cost estimate or projection before a run. No per-run cost reporting after completion. Very low limits can produce low-value responses with no warning. Cost-control parameters apply uniformly to panel and analyst with no way to differentiate. No total cost budget mechanism. Cost amplification is multiplicative — with 8 panel models × 8 agent steps + 1 analyst × 8 agent steps, worst case is 72 inner completions per invocation; epistemic framing instructs the analyst to use tools selectively so typical usage is lower. In agentic clients: 10 agent rounds × 72 worst-case = 720 possible inner completions per session. Abort signal plumbing — `signal?: AbortSignal` threads through `runFusion` to every panel/analyst `fetch`, short-circuits before the transient retry ladder (cancelled runs don't retry), and preserves partial spend. The producer-side trigger (consumer disconnect) lands in a follow-up; 300s timeout remains the active circuit breaker until then. Typed `FUSION_FAILURE_REASON` enum enables monitoring and alerts by failure mode. Failure-mode distribution is only visible through manual Datadog investigation, not dashboards or consumer-facing reporting. |
| **Disharmonies** | **1**'s analyst web tools (always on; panels now gated by `web_search`) undermine full cost control; analyst uses tools selectively via epistemic framing but this is guidance not enforcement. **1.2**'s lack of cost projection means consumers can't make informed config choices. **1.1**'s `max_tool_calls: 1` default only applies to the model alias path. **1.1**'s agentic re-firing means per-session cost surface is unbounded and invisible. |

---

## Problem / Solution Matrix

### Agentic re-firing

`model=openrouter/fusion` makes the fusion tool available on every independent agent-loop request in agentic clients (Claude Code, Cline, Aider). This can re-invoke the full panel+analyst pipeline across turns; 10 agent rounds can become 10 independent fusion runs. Design-correct but product-mismatched — amplifies cost (up to 720 inner completions per session worst-case), increases failure exposure, and may contribute to Worker OOMs. `max_tool_calls: 1` on the model alias path prevents per-request re-firing but not per-session re-firing. *(Stories: 1.1, 1.4, 1)*

| Solution | Status | Description | Risks / Trade-offs |
|----------|--------|-------------|-------------------|
| Cache fusion results per session | Pending | First call runs fusion; subsequent calls reuse cached analysis keyed on conversation prefix. | Cache invalidation is murky. Significant new infra. Papers over an architectural mismatch. |
| Deprecate model alias for agentic clients | Pending | Document the server-tool path as the correct agentic pattern. Model alias stays as one-shot convenience. | Breaking change for existing agentic users. Requires docs migration. |
| Suppress fusion when last message is a tool result | Pending | FusionPlugin inspects message history; if the most recent message is a tool result, don't inject the fusion tool. | Heuristic overrides model judgment. Adds entry-point behavioral difference. |

---

### Outer model thrashing on fusion error

When fusion returns `{status: "error"}`, the outer model tends to re-call fusion, which may fail again and produce `finish_reason: tool_use` with no user-facing answer. Each re-invocation fans out another N+1 inner calls. `max_tool_calls: 1` on the model alias path partially mitigates this. *(Stories: 1, 1.4)*

| Solution | Status | Description | Risks / Trade-offs |
|----------|--------|-------------|-------------------|
| Bypass outer model on hard failure | Pending | Stream a clear error to the consumer instead of handing it to the outer model. | Changes the API contract. Some consumers may prefer the model's attempt. |
| Limit fusion retry attempts | Partial | `max_tool_calls: 1` on model alias path. | Doesn't fix plugin/server-tool paths where default is 3. |

---

### Analyst output parse failures

The analyst can produce prose preamble/postamble around its JSON when using web tools in a multi-turn agent loop. Resolved by a bulletproof two-layer parser: `parseWith` cascade (jsonrepair → markdown extraction → grep-for-JSON → schema coercion) with a fusion-specific `extractLargestMatchingJson` fallback that scans all balanced JSON blocks and validates against the analysis schema. Handles preamble, postamble, interleaved tool results, and self-corrections. *(Stories: 1.3, 1.2)*

| Solution | Status | Description | Risks / Trade-offs |
|----------|--------|-------------|-------------------|
| Response-healing parser + schema-aware fallback | Done | `parseWith` + `extractLargestMatchingJson` fallback. | May mask genuinely broken analyst output, making model degradation harder to detect. |
| Upfront model capability validation | Pending | Validate at config time that the analyst model supports strict JSON. Reject with 400 instead of failing at parse time. | Requires a reliable capability flag per model. May block models that work in practice. |

---

### all_panels_failed

Every panel model fails to produce a response, so the analyst is never called. Root causes: (1) user-state errors (402 insufficient credits, 429 rate limited) — now correctly classified as `insufficient_credits` / `rate_limited` via status code preservation on inner-call errors; (2) upstream provider issues — specific models timing out at the 300s cap (extended reasoning) or producing empty streams (content filters, reasoning loops). *(Story: 1)*

| Solution | Status | Description | Risks / Trade-offs |
|----------|--------|-------------|-------------------|
| Preserve HTTP status on inner-call errors | Done | `callChatCompletion` error path returns typed error carrying `statusCode`. Surfaces `insufficient_credits` and `rate_limited` as distinct failure reasons. | N/A |
| Short-circuit on user-state errors (402/429) | Done | Surfaces specific `failure_reason` instead of generic `all_panels_failed`. | Does not stop remaining panel calls (they run in parallel). |
| Pre-fanout budget check | Pending | Preflight `requiredTokens * panelCount` against user balance. Fail fast with 402. | Requires billing context inside fusion. Estimate may be inaccurate. |
| Panel retry with fallback models | Pending | On individual panel model failure, retry with a fallback model. | Adds latency. Fallback model selection is non-trivial. May mask persistent provider issues. |
| Panel success minimum threshold | Pending | Require ≥2 successful panel models before proceeding. | Raises failure rate. Some consumers prefer degraded results. |

---

### Cost opacity

Consumer cannot predict, observe, or bound the total cost of a fusion run. No estimate before, no breakdown during, no reporting after. Tilde-latest aliases can silently resolve to more expensive models. Cost amplification is multiplicative (up to 72 inner completions per invocation) and not surfaced to the consumer. *(Stories: 1.2, 1.4)*

| Solution | Status | Description | Risks / Trade-offs |
|----------|--------|-------------|-------------------|
| Cost projection API | Pending | Expose an estimate given panel size, model prices, and step limits. | Estimates are approximate. Inaccurate projections may be worse than none. |
| Per-run cost reporting | Pending | Include total cost breakdown in the fusion tool result or response metadata. | Requires aggregating usage across N+1 inner calls. |
| Web tools opt-out | Partial | Panel opt-out shipped via the `web_search` param (`false` disables `openrouter:web_search` / `openrouter:web_fetch` on panels). The analyst's web tools remain always-on. | Panel responses may be less current. Adds another config knob. Analyst cost is still non-optional. |

---

### Entry point inconsistency

The two entry points (model alias and server tool) behave differently: `max_tool_calls` defaults differ, plugin schema is missing three config fields, and behavioral differences are undocumented. Plugin preferences configure the model-alias path rather than providing a third entry point. *(Stories: 1.1, 1.4)*

| Solution | Status | Description | Risks / Trade-offs |
|----------|--------|-------------|-------------------|
| Unify plugin schema | Pending | Add the missing fields to the plugin preferences so both public entry points have the same config surface. | More fields to keep in sync. Risk of divergence. |
| Align `max_tool_calls` defaults | Pending | Apply `max_tool_calls: 1` consistently across both public entry points. | May break consumers who rely on the current default (3) on the server-tool path. |
| Document the differences | Pending | Clearly document which config fields are available on which entry point. | Doesn't fix the problem, just makes it visible. |

---

### Silent degradation

The system degrades without signaling it to the consumer: single-model analysis looks identical to multi-model in schema, budget-model analysis looks identical to frontier-model, refusal-only streams become empty panel completions, and there's no minimum quality threshold. *(Stories: 1, 1.3)*

| Solution | Status | Description | Risks / Trade-offs |
|----------|--------|-------------|-------------------|
| Panel success minimum threshold | Pending | Require ≥2 successful panel models. Fail instead of producing hollow comparative fields. | Raises failure rate. Some consumers prefer degraded results. |
| Analysis metadata | Pending | Include metadata in tool result: how many models contributed, which dimensions had meaningful content. | Doesn't prevent degradation, just makes it visible. |
| Handle Fusion refusal deltas | Pending | Surface refusal-only streams as refusals or typed panel failures instead of empty completions. | Narrow fix — only addresses the refusal case. |
