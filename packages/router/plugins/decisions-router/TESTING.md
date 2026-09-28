# Testing the decisions router

`typesafe/jev-router` classifies text and routes text, image, audio, video, and file inputs. The existing `DecisionModelClient` supplies judgments (initially Jev); the policy selects configured model/effort tuples using requirement profiles and estimated cost. Any decision-model failure fails the request, including when another model is present in the caller's fallback list. It never invokes the auto router.

## Local checks

### Optional max advisor and search routing

After deploying this schema and runtime, merge the following fields into the existing **Admin Utils → Live Config → decisions_router** value. Preserve existing exclusions, profiles, evidence and rollout settings. These are operator priors, not imported benchmark measurements.

```json
{
  "routing": {
    "policy": {
      "max": {
        "advisors": ["~openai/gpt-astra-latest", "~anthropic/claude-opus-latest"],
        "advisor_effort": "medium",
        "max_completion_tokens": 16384
      },
      "initial_effort": { "deep": "medium" },
      "gain_threshold": 0.5,
      "preferences": { "gain_discount": 0.1 }
    },
    "profiles": {
      "~openai/gpt-luna-latest": {
        "tasks": { "agent:web_search": 0.9 },
        "task_overrides": {
          "agent:web_search": { "tier": "deep", "initial_effort": "xhigh" }
        }
      },
      "openai/gpt-6-sol-20260922": {
        "tasks": { "agent:web_search": 0.9 },
        "task_overrides": {
          "agent:web_search": { "initial_effort": "high" }
        }
      }
    }
  }
}
```

`routing.policy.max` defines max-floor routing. Omit `pairs` (the default) to derive them from the measured agentic pool: the executor is drawn by the task-efficiency weights, then its advisor is drawn from `advisors` (default Astra and Opus) by the same weights at `advisor_effort` (default `medium`), falling back to config order when advisors are unmeasured. An executor never advises itself, so an Astra executor gets Opus and an Opus executor gets Astra, and a still-valid session pair stays sticky. Set explicit `pairs` to pin specific combinations instead. Each pair names a concrete executor effort and advisor effort. In a classified agentic session, a fresh task draws among viable pairs with measured rows for its session class, using the task-efficiency weights below; otherwise the first viable configured pair wins. A still-valid session pair stays sticky. Explicit pairs bypass tier caps but still honor exclusions, measured insufficiency, restrictions, pricing, and endpoint capability. Omit `max` to use ordinary max routing.

The executor is pinned to the selected concrete revision before the existing server-tool loop runs, so inner executor calls do not re-enter Jev. The advisor has a 16,384-token output budget by default (configurable via `max_completion_tokens`), the configured advisor reasoning effort, prompt-only input, and the existing two-successful-consultations-per-advisor-per-request limit. The budget includes reasoning tokens; an explicitly saved value (including 8192) takes precedence over the default. It is available, not forced; caller tool choice and existing advisor definitions take precedence. The server-tool loop retains its existing authorization, privacy and recursion checks and includes advisor cost in reported usage. This does not impose a session-wide spend cap. The configured expert stays stable across session continuations while still in the configured pair.

Advisor mode requires tool-capable executors. Basic/general throughput preference remains in place; only max requests receive the injected tool. Task tier overrides replace model and snapshot task priors for that task alone, while automatic effort caps and request restrictions still apply. Starting effort applies only to fresh, non-urgent requests, cannot override caller effort pins, and falls back to admitted efforts if unavailable. Profiles do not enroll models outside the selected pool. The gain settings above yield a cost-adjusted model upgrade threshold of 0.40–0.50 with the unchanged $0.01 cost scale; they do not change effort-gain questions or prove a quality improvement.

### Regression suite

```bash
cd packages/router
bun test plugins/decisions-router plugins/base/hipaa-plugin-policy.test.ts plugins/base/resolve-endpoints.test.ts baseline-attributes.test.ts
```

The tests exercise the actual placeholder-resolution pipeline with in-memory catalogs and an injected decision client. They do not prove live provider completion or routing quality.

## Provision and configure

1. Deploy the config contract before the runtime. In Mission Control, create a model with `slug` and `permaslug` = `typesafe/jev-router`, `group` = `Router`, `is_private` = `false`, `hidden` = `false`, text/image/audio/video/file inputs, text output, and an appropriate context limit. For an existing text-only catalog entry, enable the additional inputs after the multimodal runtime deploys. The public row appears in chat through the normal model catalog; a private row still requires an exact model grant. Do not create endpoint rows.
1. For a private rollout, set `is_private` = `true` and grant the model to the benchmark workspace. Public rows need no private-model grant; the plugin checks the catalog visibility before sending text to the decision model.
1. Authorized requests to `typesafe/jev-router` route with built-in defaults; no live-config opt-in is required. In **Admin Utils → Live Config → decisions_router**, use `routing.enabled: false` only to disable the router. An existing explicit `false` remains disabled until removed or changed to `true`. Missing configuration uses defaults; malformed configuration fails closed. `mode`, `pct`, and `entity_allowlist` govern only the separate auto-classifier rollout. Keep `TYPESAFE_AI_API_KEY` available to cfw-api through its existing secret binding.

Edit model, tier, and effort entries at **Admin Utils → Live Config → decisions_router → routing.pool**. The array replaces the complete pool in both modes: delete entries to exclude models, keeping at least one. With `pool` omitted, `routing.dynamic_pool.enabled: true` (default) selects snapshot discovery and `false` selects the eight built-in revisions without reading a snapshot. Independent `routing.profiles` and all request/provider restrictions apply in either mode. No deploy is needed to switch modes or change an existing live pool after this schema/runtime is deployed.

Use `routing.policy.exclusions` to exclude models without replacing the pool. Rules apply to snapshot, built-in and strict override pools, including incumbents and fallback candidates. Model selectors use the existing catalog resolution for public slugs, exact revisions and `~latest` aliases; there are no wildcard or author-wide rules. The default list is empty. Unlike `routing.dynamic_pool.exclude_models`, these rules apply beyond discovery.

After deploying the schema and runtime, merge this into the existing `decisions_router` config to exclude GLM 5.3 from every task:

```json
{
  "routing": {
    "policy": {
      "exclusions": [{ "model": "z-ai/glm-5.3" }]
    }
  }
}
```

For only knowledge QA and math, use `{ "model": "z-ai/glm-5.3", "tasks": ["qa_knowledge", "math"] }` instead. Omitting `tasks` means all tasks; an empty or invalid task list is rejected. Multiple rules combine as exclusions, with a global rule taking precedence. Set `exclusions: []` to clear them. The existing Jev task answer determines task-specific matches; no new question is introduced. If all candidates are excluded, the request fails rather than using auto. Existing decision metadata reports `model_exclusion` or `task_exclusion`.

For an optional custom pool and question (merge these fields into the existing config):

```json
{
  "version": "decisions-v0",
  "routing": {
    "questions": {
      "craft": { "type": "noul", "instructions": "Does presentation quality matter?" }
    },
    "pool": [
      { "model": "deepseek/deepseek-v4.1-flash", "tier": "general" },
      { "model": "openai/gpt-5.6-luna", "tier": "basic", "effort": "medium", "output_multiplier": 2 },
      { "model": "openai/gpt-5.6-sol", "tier": "general", "effort": "low" },
      { "model": "anthropic/claude-fable-5.1", "tier": "max", "effort": "high", "output_multiplier": 4 },
      { "model": "openai/gpt-6-astra", "tier": "max", "effort": "high", "output_multiplier": 4 }
    ]
  }
}
```

Verify these example model IDs and effort support against the target catalog before using them. Pool entries accept any catalog model. The config layer owns Jev's question defaults under `routing.questions`; the plugin passes those questions to Jev, expanding the `cheaper_model_sufficient` template only for potential session downshifts. Top-level `questions` belongs to the auto classifier. Both reuse the same `task` choice primitive and full `TaskTypeTag` taxonomy, with independent wording overrides. Additional questions accept any valid ID and primitive; unused answers are recorded as numeric judgments without affecting routing. Set `requires_high_gain: true` on costly variants that should require exact precision, high expected gain, and no latency constraint; model names carry no policy meaning.

Omitted or `"auto"` effort expands to the model’s advertised reasoning efforts at or above `policy.minimum_effort`. Explicit `null` preserves the provider default; a concrete effort pins that pool entry. Models without advertised efforts retain their provider default. If a valid effort is not advertised by the model, the router uses the catalog's default effort, mapped through the existing supported-effort helper, or the provider default when the catalog has none. The resolved effort drives pricing, policy checks, session continuity, upstream requests, and pipeline metadata. An unsupported configured effort emits a structured warning. Invalid effort names and tier names are rejected by the editor; policy restrictions still apply after defaulting.

Caller effort cannot pin `typesafe/jev-router`. `reasoning.effort`, `reasoning_effort`, `reasoning.enabled: false`, and incoming `configuration_update` directives only set the preferred starting effort on a fresh or newly reselected task. They never remove candidates, and the router strips them from the upstream request before sending its selected effort. Continuations, trouble escalation, and verified downshifts remain adaptive. Measured whole-task efficiency takes precedence over the proxy when benchmark evidence exists.

## Adaptive effort

The dynamic default pool has one entry per model, with automatic effort and a task-specific ceiling. Its tiers are `basic`, `general`, `deep`, and `max`; saved `fast` values normalize to `basic`. `routing.policy.efforts` supplies provisional capability caps and output multipliers for each effort: low → basic ×1, medium → deep ×2, high → max ×4, xhigh → max ×6, max → max ×8. The automatic `policy.minimum_effort` defaults to `low`, excluding advertised `none` and `minimal` efforts; explicit caller and operator pins remain authoritative. `policy.initial_effort` defaults to `{ "deep": "high" }`; an empty map disables starting preferences. Fresh deep requests prefer an admitted high-effort option within each model unless latency is prioritized; subsequent turns can adapt down to medium through the existing sufficiency and savings checks. The effective tier is capped by the model ceiling: the Luna family defaults to `basic` even at medium/high effort, while DeepSeek Flash follows its own task priors without a family cap (the fixed pool uses `general`). Low effort remains capped at `basic`; general work requires at least medium under the default heuristic. DeepSeek V4.1 Flash advertises low/high/max, so high is its lowest automatic effort eligible for general work. These are operator hypotheses, not measured quality guarantees. Scoped sufficiency evidence can still admit a basic candidate above the heuristic floor without changing its tier. Explicit pool entries replace the family defaults; concrete effort entries retain their configured tier, and an explicit output multiplier overrides the effort default. Partial `policy.efforts` overrides merge with code defaults.

On following requests, `big_model_gain` can raise effort without a tier jump. Lower effort needs candidate-specific sufficiency and the existing next-request savings margin. Same-model adjustments take precedence over quality-driven model switches, while caller pins, provider restrictions and capability floors remain enforced. Repeated provider failures instead prefer an eligible different model; without one, the incumbent effort stays unchanged. Effort changes preserve the task anchor and its selection evidence. Jev judges current work with unresolved requirements in context; no completion flag, passing test, elapsed time or session reset unlocks a downshift.

On models and transports already supporting `configuration_update` (including Astra/Responses and Fable/Anthropic), the router keeps root effort fixed and replays scalar effort-change positions in the verified caller history. New changes insert a contentless system directive before the newly appended user/tool input, because Anthropic applies effort from the next user turn. An effort change without a new input boundary uses root effort and a conservative cache estimate. The existing session store saves these positions only after successful completion; it never stores message text. Prefix changes, provider/model changes, caller-supplied directives, unsupported transports, or an effort change without appended messages retain conservative cache-break estimates. Responses automatic truncation keeps the caller's truncation setting, sends the selected effort at the request root, and omits managed effort history; removing previously injected directives receives no prefix-cache credit. Anthropic reasoning-off cannot use per-message effort updates. OpenAI and Anthropic document prefix preservation for these updates, but this PR has not observed a live cross-effort cache hit; provider eligibility is not evidence of a measured hit. Cache hits and output multipliers remain estimates. Caller-supplied configuration updates pin to the latest effort and pass through unchanged.

For example, this keeps Astra adaptive, pins Fable, and configures starting efforts and capability ceilings without replacing the other effort defaults:

```json
{
  "routing": {
    "pool": [
      { "model": "openai/gpt-6-astra", "tier": "max" },
      { "model": "anthropic/claude-fable-5.1", "tier": "max", "effort": "high" }
    ],
    "policy": {
      "minimum_effort": "low",
      "initial_effort": { "deep": "high" },
      "efforts": {
        "low": { "tier_cap": "basic", "output_multiplier": 1 },
        "medium": { "tier_cap": "deep", "output_multiplier": 2 },
        "high": { "tier_cap": "max", "output_multiplier": 4 }
      }
    }
  }
}
```

Existing strict pool overrides retain their configured model tiers; update a saved DeepSeek Flash `basic` tier to `general` to adopt its new fixed-pool default. Dynamic pools use the generated task priors; a snapshot generated with the old family cap needs to refresh before that cap disappears. Existing strict pool overrides keep their explicit effort pins; remove those fields to opt into adaptation. Deploy this schema/runtime before writing `policy.minimum_effort` or `policy.initial_effort` to Mission Control. Existing explicit `policy.efforts` overrides still win over code defaults; change a saved low-effort `tier_cap` to `basic` to adopt the general/medium floor. The earlier 0.75 signal study below used the previous question wording and does not validate adaptive-effort quality or the new current-request wording.

## Fresh-session price and profile weighting

Without an incumbent, sample admitted models using `weight = (cheapest_cost / model_cost)² × initial_weight^profile_score`. Existing caller, admission, urgency, and starting-effort constraints apply first. Draw among the cheapest candidate's effective-tier peers; for difficulty 2–4, also admit higher-tier specialists whose profile advantage over the cheapest reaches `preferences.min_margin`. Profiles influence the odds instead of receiving absolute priority. Keep each model's strongest price/profile effort once, so configuring extra efforts does not buy extra traffic. If the cheapest candidate is free, sample only free candidates with profile weights; paid candidates remain fallbacks. Keep the selected model first and retain existing fallback ordering. Recovery and session switching keep their existing deterministic gates.

`routing.policy.preferences.initial_weight` is editable in Mission Control, defaults to `16`, and accepts numbers from `1` to `100`. A score of `0.5` multiplies price weight by 4, `0.8` by about 9.2, and `1` by 16. Set `initial_weight: 1` to disable the profile boost. Equal profile scores cancel out, leaving the original price weighting. This is an experimental preference, not measured accuracy. Deploy both the Mission Control schema and router runtime before saving this new field.

```json
{
  "routing": {
    "policy": {
      "preferences": { "initial_weight": 16 }
    }
  }
}
```

Merge this fragment into the existing `decisions_router` value, retaining its version, rollout controls, exclusions and profiles. Individual strengths remain editable in `routing.profiles`; measured `evidence` still affects admission and is not converted into a sampling score.

For two equally priced models, a matching score of 0.5 versus no preference gives expected shares of 80%/20% at the default weight. With equal profile scores, costs of $0.004638 and $0.006184 imply 64%/36%; a fivefold cost difference implies approximately 96%/4%. These are expected fresh-session shares, not guarantees for a small sample or evidence of equal output quality. Existing estimates may differ from the eventual serving provider and bill. No new Jev question is needed.

With metadata enabled (`X-OpenRouter-Metadata: enabled`), fresh selections expose `data.selection_probabilities` in the `decisions-router` pipeline stage: an array of `{ model, effort, probability }`, ordered by descending probability and normalized to sum to 1. These are the exact deduplicated draw weights after request eligibility, tier/effort constraints, estimated cost, and task/requirement profile weighting. They describe this request's initial model draw, not historical task token/spend share, model quality, or the eventual serving model after provider failures. The existing `answers` fields describe the classification used for this draw. Fallback-only candidates are excluded. Deterministic continuations, recovery, and session switches omit the field; use the existing `reason` to explain those choices. No frontend rendering is added here.

## Requirement profiles

`routing.profiles` holds optional profiles keyed by the resolved model revision, independently of `routing.pool`. Omit `pool` to retain the default model set and adaptive efforts. A profile never enrolls a model: it applies only after pool membership and request restrictions are resolved. Strengths are operator-authored preferences from 0 to 1, not benchmark scores or success probabilities. The default pool seeds hypotheses for visual quality (Astra) and codebase integration (Sol/Fable). Price favors cheaper candidates; matching strengths increase their fresh-selection weight.

```json
{
  "version": "profiles-v1",
  "routing": {
    "profiles": {
      "openai/gpt-5.6-luna-20260709": {
        "tasks": { "data:extraction": 0.6 }
      }
    }
  }
}
```

Profile fields are `visual_quality`, `codebase_integration`, `precision`, and optional `tasks` keyed by the existing taxonomy. The first two use `noul` questions in the same Jev call, both phrased around the remaining overall task. Precision reuses the existing score; task preferences use its choice distribution. Policy code evaluates profiles without adding them to Jev context. Missing profiles contribute no preference; missing or invalid answers used by a profile fail the request.

Existing `pool[].profile` preferences remain supported. Each field in `routing.profiles[resolved_model]` overrides its pool-profile counterpart; omitted fields retain it, so adding evidence preserves existing strengths. A supplied `tasks` map or `evidence` array replaces that field in full. Set a strength to zero or `tasks` to `{}` to disable a preference. Unsupported effort remapping still discards pool-scoped preferences; independent model-level preferences apply to every resolved effort, while measurements match their own exact effort. Custom pools remain strict replacements and do not inherit the default pool's inline preferences.

The helper averages preference contributions over active requirement weights. Visual/codebase signals below `boolean_threshold` are inactive; precision contributes only at levels 3–4. Task preferences are weighted by the task distribution. Fresh sessions use this score in the weighted draw above. During recovery or an existing session, it prefers an admissible alternative only when its advantage reaches `routing.policy.preferences.min_margin` (default 0.2) and Jev's gain reaches a cost-dependent threshold. The candidate with the largest qualifying advantage wins; estimated cost breaks ties. Existing tier, effort, latency and provider restrictions still apply. Session preferences can switch to a same-or-higher-tier model. A same-tier peer with a known effort can earn a profile upgrade even when its effort label is lower than the incumbent's: effort labels are not comparable across models. Same-model effort decreases, lower-tier candidates, and unknown-effort peers retain sufficiency protection. A lower-effort peer does not enter cost-only switching, failure recovery, or fallbacks merely because it can be compared for a profile upgrade.

`routing.policy.preferences.gain_discount` (default 0.25) lowers the normal gain threshold for improvements with little additional cost. The discount decreases linearly to zero at `cost_scale_usd` (default $0.01 additional estimated turn cost). With the default normal threshold of 0.85, a free improvement requires 0.60, a $0.005 increase requires 0.725, and an increase of $0.01 or more requires 0.85. These are experimental operator knobs, not calibrated quality economics. Cache loss is already included in stay/switch estimates and is not charged again. The threshold still gates profile upgrades and effort increases. Escalation to satisfy an unmet tier requirement selects the cheapest admitted higher-tier candidate without a gain gate; the required gain is still logged for comparison.

No benchmark ingestion or automatic model-strength claims are introduced. Validate profiles with finished-work evaluations at the exact configured model/effort before treating them as established strengths. Edit or remove profiles and tune question wording and preference thresholds through the existing Mission Control JSON configuration.

## Measured candidate admission

Optional `routing.profiles[resolved_model].evidence` records qualify an exact resolved model and effort for a scoped task **before** the heuristic tier floor. Evidence belongs only in this independent registry, so operators can add measurements without copying or overriding the pool. The same evaluator handles initial selection, incumbent eligibility, and downshift candidates; it adds no Jev questions or calls. Provider, capability, caller-effort and explicit high-gain restrictions still apply. Session downshifts still require the existing candidate-sufficiency judgment and cache-aware savings margin.

Each record supplies a bounded ID, exact model revision and effort, evaluation timestamp, distinct task count, quality interval, existing task taxonomy label, difficulty/precision ranges, visual/integration/tool requirements, and input/output token ranges. The quality interval describes the evaluation rubric's acceptance rate; it is not Jev confidence. Do not count repeated attempts on one task as independent tasks.

`routing.policy.evidence` defaults to `min_tasks: 30`, `min_quality: 0.9`, `min_task_probability: 0.8`, and `max_age_days: 30`. Every matching record must have a lower quality bound at least `min_quality` to override the heuristic floor. Any matching upper bound below that threshold excludes the candidate, including an incumbent. Stale, future-dated, mismatched or uncertain evidence retains the current heuristics. These are conservative starting settings, not a calibrated guarantee; task coverage and rubric quality limit transfer to new requests. No measured profiles ship by default.

For latency-sensitive requests, optional `routing.policy.evidence.max_response_ms` replaces the low-effort proxy when endpoint timing is known. Estimated response time is the slowest eligible endpoint estimate, including private endpoints: median first-token latency plus predicted output divided by median throughput. Missing telemetry on any eligible endpoint keeps the effort proxy. These estimates exclude tools, future turns, and classifier overhead; they are neither tail-latency guarantees nor predictions of full agent completion time. Cost still uses the existing next-request/cache estimate and configured output multiplier.

The existing Mission Control JSON editor validates these fields through the write schema. Deploy the schema and runtime before adding evidence. Pipeline metadata includes admission reasons for each candidate; the existing selection log adds selected evidence ID/status and estimated response time. Raw measurements never enter Jev context.

## Guarded de-escalation

`routing.policy.deescalation` defaults to `{ "enabled": true, "sufficiency_threshold": 0.75, "min_savings_fraction": 0.2 }`. All three fields and the `routing.questions.cheaper_model_sufficient` noul template are editable through the existing Mission Control JSON editor, independently of classifier questions. Deploy the editor/config contract before writing these fields to fleets still running an older strict schema.

For an eligible incumbent, the router binds that template to each available lower-tier or lower-effort candidate after resolving catalog aliases, supported effort, and the input/explicit output budget. Candidates that cannot fit the known token budget are removed before question generation; when output length is inferred by Jev, the final budget check remains after that answer. Jev answers the generated `cheaper_model_sufficient_<index>` questions in its existing single call. No extra question is sent for a fresh session or disabled de-escalation. Generated IDs are reserved. Missing, malformed, or non-finite required judgments fail the request; they never invoke auto.

Recovery and same-model effort increases retain precedence; a sufficient same-model effort decrease is considered before cross-model profile/capability switches. A downshift must satisfy the existing task floor and request restrictions, score at least the sufficiency threshold, and cost no more than `stayCost * (1 - min_savings_fraction)` on the next request, including estimated cold context/cache-write costs. For a cross-model downshift, that estimate is the arithmetic mean across eligible endpoint costs, including granted private endpoints. It neither assumes the cheapest provider will serve the request nor lets the most expensive provider veto a switch. Equal endpoint weights are a heuristic, not measured routing probabilities: provider ordering, failures, and fallbacks can produce a cost above or below the mean. Provider ordering is unchanged; the incumbent and its alternative efforts still use its previous endpoint when eligible. Across different models a higher tier remains an escalation even if its effort is lower; within a tier, reduced known effort also requires sufficiency. Replacing a known effort with an unknown provider default also requires sufficiency; the policy does not assume that default preserves capability. Fallbacks cannot introduce another unjudged downshift. Routine tool steps and low `big_model_gain` alone do not justify downgrading. No remaining-turn forecast or completion boundary is introduced.

The 0.75 evidence and 20% savings defaults are hypotheses, not calibrated quality guarantees. In a September 21 Jev 1.13.0 signal check (12 authored scenarios, three repeats each, Astra/high incumbent and seven lower candidates), 0.75 admitted a candidate on all 18 plausible simple-work trials and none of the 18 difficult/ambiguous trials; 0.90 admitted none. This measured score separation, not candidate task success. The tests cover initial → stay → escalation → routine stay → de-escalation → stay → re-escalation, configured threshold changes, explicit effort, malformed answers, and cache-adjusted savings. Validate actual success and total conversation cost with sequential multi-turn workloads; single-prompt GPQA scores cannot establish downgrade safety.

## Question rules

`routing.question_rules` makes the Jev routing questions and their policy effects configurable through `decisions_router` or a `router_experiments` arm.

- `replace_questions: true` sends only `routing.questions`. Otherwise configured questions merge over the built-in defaults.
- `signals` maps built-in policy inputs to question IDs: `difficulty`, `precision`, `big_model_gain`, `latency_sensitive`, `output_length`, `visual_quality`, `codebase_integration`, and `task`.
- `rules` run in order. Conditions support score/noul comparisons (`gte`, `gt`, `lte`, `lt`), choice matches (`in`), and `all`, `any`, `not`.
- Actions can override policy signals (`set`), constrain the tier floor (`min_floor`, `max_floor`), require one effort (`effort`), or exclude models.

Invalid question references are rejected by the write schema. At runtime, missing or malformed referenced answers fail closed.

```json
{
  "routing": {
    "questions": {
      "frontier_needed": {
        "type": "noul",
        "instructions": "Would a frontier model materially improve the chance of finishing this task correctly?"
      }
    },
    "question_rules": {
      "signals": { "big_model_gain": "frontier_needed" },
      "rules": [
        {
          "id": "frontier-debugging",
          "when": {
            "all": [
              { "question": "frontier_needed", "gte": 0.8 },
              { "question": "task", "in": ["code:debugging"] }
            ]
          },
          "apply": { "min_floor": "max" }
        }
      ]
    }
  }
}
```

For task-specific behavior, add `task_sets` keyed by exact `TaskTypeTag`. Jev still answers every configured question in one call. After it answers `task`, the matching set can override signals and append rules to the global rules. Unmatched tasks use the global rules only.

```json
"question_rules": {
  "task_sets": {
    "code:debugging": {
      "questions": ["debug_frontier"],
      "signals": { "big_model_gain": "debug_frontier" },
      "rules": [
        {
          "id": "debug-frontier",
          "when": { "question": "debug_frontier", "gte": 0.8 },
          "apply": { "min_floor": "max" }
        }
      ]
    }
  }
}
```

For named preferences beyond the built-in profile fields, map a yes/no question with `profile_signals` and give models strengths under `profiles.<model>.signals`. The value is scored by the existing profile scorer, using `boolean_threshold`, `preferences.min_margin`, and fresh-selection `preferences.initial_weight`.

```json
{
  "profiles": {
    "anthropic/claude-opus-5.5": { "signals": { "security_risk": 0.9 } }
  },
  "questions": {
    "security_risk_question": {
      "type": "noul",
      "instructions": "Does success depend on careful security reasoning?"
    }
  },
  "question_rules": {
    "profile_signals": { "security_risk": "security_risk_question" }
  }
}
```

Task sets can override `profile_signals` with a different question for the same signal.

Use the same shape inside `router_experiments[].decisions_router` to compare question sets and policy rules end to end.

## Agent-session pipeline

`typesafe/jev-router` routes agent sessions on signals measured in code, not on forecasts from the prompt. A request takes this pipeline when it declares `tools`, carries tool calls or results, or has at least `routing.agentic.min_messages` messages; anything else uses the default pipeline.

- **State:** `agentic/` builds a fixed-order Jev state capped at `max_state_chars`: bucketed session signals, the task framing, recent step lines, and the latest user, assistant, and tool text.
- **Questions:** `routing.agentic.questions` merges over the built-in recognition questions (`new_goal`, `repeating_failure`, `false_success`, `user_rejection`, `off_task`, `work_scope`, `latency_sensitive`, `no_edits`, `task`). Override wording by redefining an ID, or set `routing.agentic.question_rules.replace_questions: true` to send only configured questions. The default pipeline's `routing.questions` never reaches agent sessions.
- **Selection:** coding sessions can admit low-effort frontier profiles through `coding_effort_tier_caps` (default `low: max`). Measured evidence is keyed by agentic session class, not by benchmark or task label. A session is `agentic_code_edit` when it declares or uses shell or edit tools; Jev's `no_edits` recognition keeps answer-only repository sessions off that evidence. Benchmarks are feeders mapped to a session class: DeepSWE currently feeds `agentic_code_edit`. When a fresh session has measured rows for its class and model/effort, it draws its executor by weight: the probability, given each run's sample size, that the candidate is within 5 points of the best measured pass rate, times relative cost per solved task, times relative generation time per solved task raised to `draw_time_exponent` (default 2). Per-solved-task values divide each run's per-attempt cost and time by its pass rate, so failed attempts are charged rather than dropped; squaring time favors fast tuples, since slow ones dominate agent-session wall time. Over-budget (`max_task_spend_usd`) and unmeasured candidates stay out of the draw and remain fallbacks. The weights are published as `selection_probabilities`. Continuations stay sticky; the draw only runs on fresh tasks and new goals. For example, Astra-low (78/113, $1.03) and Opus-low (69/109, $0.54) draw about 60/40; with Sol-high and Kimi-low added the draw is about 47/32/18/3.
- **Provider sort:** agent-session executors without a `provider_routing` rule sort providers by throughput at every tier. A model rule, or a caller's own provider order or sort, still wins.
- **Task budgets:** exploration before an edit (`max_steps_before_edit`, 24; skipped when Jev recognizes that the task forbids edits, for example repository Q&A), churn after the latest edit (`max_steps_since_edit`, 40), estimated router spend (`max_task_spend_usd`, $1.50), and session age (`max_task_elapsed_ms`, 15 minutes) count as trouble. Trouble raises effort first, but only up to `effort_ceiling` (default `medium`) unless the higher effort has its own measured row (so Sol-high stays reachable). At the ceiling, trouble attaches a `policy.max` advisor (Astra or Opus at `advisor_effort`, never the executor) instead of more effort, and the advisor stays for the rest of the task so the prompt prefix stays cacheable. `effort_limit` (default `high`) is a hard cap: agent sessions never route to `xhigh` or `max`, caller `max` hints and `configuration_update` directives included, and tier escalation skips candidates above it. After `escalate_after` consecutive trouble turns, the model moves up a tier. A new goal resets task accounting.
- **Question rules:** `routing.agentic.question_rules` has the same shape as `routing.question_rules` (`signals`, ordered `rules`, `task_sets`, `profile_signals`) and is validated the same way. Its `signals` remap the recognition inputs, for example `{ "repeating_failure": "loop_check" }`, so the policy reads the mapped answer instead of the built-in one. `min_floor`/`max_floor` clamp the work-scope floor, and `effort` and `exclude_models` filter candidates before selection. Top-level `routing.question_rules` applies only to the default pipeline.

```json
{
  "routing": {
    "agentic": {
      "questions": {
        "new_goal": { "type": "noul", "instructions": "Does latest.user start a different goal?" },
        "frontier_needed": { "type": "noul", "instructions": "Would a frontier model materially help?" }
      },
      "question_rules": {
        "rules": [
          {
            "id": "agent-frontier",
            "when": { "question": "frontier_needed", "gte": 0.8 },
            "apply": { "min_floor": "max" }
          }
        ]
      }
    }
  }
}
```
- **Outcomes:** each decision logs a `decision_id`. The next turn logs `decisions-router turn outcome`, joined by `previous_decision_id`.

**Configure** in **Admin Utils → Live Config → decisions_router → routing.agentic**. Estimated spend comes from the router's pre-call candidate estimate, not the final ledger. Elapsed time includes tool and user wait time.

**Live smoke check** of Jev on this state: `tests/manual/2026-09-25-jev-agentic-recognition/`.

## Datadog observability

Filter request logs on `@breadcrumbs.decisions_router_requested:true`, including requests rejected before Jev. The existing logger supplies trace/request correlation. `decisions-router policy selected` records the policy's initial/stay/switch choice, reason, incumbent and selected model/effort, task taxonomy label, tier floor, reconsideration, profile advantage, required gain, de-escalation sufficiency and estimated savings fraction, actual runtime question count, candidate counts, experimental gain, estimated costs/cache reuse, Jev token usage, and elapsed milliseconds. This is the policy selection, not proof of which provider ultimately served the request; use the existing transaction-attempt logs for actual provider, success, billed cost, and cache usage.

`decisions-router policy resolution failed` records a fixed reason and status without vendor error text. Catalog, session read/write, and invalid-state warnings identify preparation and continuity failures. The `openrouter.decisions_router.policy_resolution` counter covers resolver outcomes plus early disabled refusals, tagged only by outcome, fixed reason, and initial/stay/switch selection. `openrouter.decisions_router.jev_latency_ms` measures Jev calls with success/error/timeout tags; count and percentile aggregations expose call volume, failures, and latency. Earlier access/input/session errors remain in ordinary request telemetry.

Model IDs and config versions stay in logs, not metric tags. Prompt/context text, raw answers/errors, session keys, and arbitrary question values are excluded. Emissions add no awaited work and cannot change the routing result. No per-question metrics or new monitors are introduced.

## API verification

Start the local API and its dependencies using the local-dev-env skill, with a local model row, grant, and local live-config document. Send a small request using a granted key:

```bash
curl -sS http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"typesafe/jev-router","messages":[{"role":"user","content":"Write a short greeting"}],"stream":false,"openrouter_metadata":true}'
```

Use the port reported by your worktree. Verify the response's concrete `model` and the `decisions-router` pipeline stage: config version, numeric answers, tier floor, candidate costs/efforts, and resolved model order. Provider filters still apply after model selection. Check a provider restriction, explicit effort, and a provider failure that retries the next selected model with that model's own effort.

Disable `routing.enabled` and repeat: expect 503. Simulate decision-model failure or timeout: expect failure, even with a concrete model in `models`. Image input requires an image-capable pool; EU/US requests return 400; HIPAA and unknown posture return 403 before classification; a caller without the private-model grant receives 404.

## Session policy and cost estimates

The first successful response records the incumbent model, effort, provider, and task anchor. A normal continuation keeps the model and effort. A two-level increase in difficulty or precision reopens selection. An unmet higher tier remains reconsiderable without another two-level jump; capability escalation does not require the gain threshold. A sufficiently stronger requirement profile can also reopen selection within the same tier. Two failed provider attempts also reopen selection. Hard capability, pool, effort, or provider restrictions always win. A lower score or a different detailed task label alone never downgrades the session. The task distribution informs profiles that configure task preferences; a label change alone does not force a switch. Successful reconsideration advances the anchor and score baseline even when staying on the same model is cheapest; failed attempts retain the previous anchor.

Provider affinity uses the existing sticky-session rules: cache reads must be cheaper than uncached input, and a pin requires an explicit session ID, observed cache usage, or eligibility for the configured first-request-pin experiment. Jev has no unconditional pinning exception. Conversation-only traffic can change providers before a normal pin is established; Jev's task context and model continuity do not depend on that pin.

The policy treats quality and reliability requirements as constraints, then applies qualifying profile preferences or chooses the cheapest qualifying switch. It also permits a cheaper same-or-higher-tier alternative after a substantial change. It does not convert Jev's experimental gain score into expected dollars or a calibrated success probability. Pipeline metadata records the reason and estimated stay/switch costs, including when the switch is rejected.

Session metadata uses the existing authenticated session/conversation key and fleet cache with its 60-minute TTL. It stores scalar judgments, usage, and a prefix hash, never conversation text. Only successful accounting events without preceding stream errors replace the incumbent; provider failures increment the failure signal, while user faults and client disconnects do not. Writes within a request wait for the preceding cache operation to finish, so a slow failed-attempt write cannot overwrite a later successful attempt. There is no entity-wide incumbent for requests without a conversation identity. Concurrent requests use the existing last-writer-wins semantics; send benchmark turns sequentially. Cache read errors are logged and the session routes fresh without an incumbent, while post-response write errors are logged.

Candidates must fit endpoint context/input/output limits, including the caller’s output-token cap. Costs use eligible endpoint prices (including applicable long-context/time overrides), estimated output and configured effort multipliers. Staying uses the previous provider's actual prompt-token count plus estimated new text. Warm reuse is an estimate only when the prior input prefix and cache-affecting options match and the endpoint and model are unchanged. Effort must also match unless the supported directive-replay path preserves the earlier prefix. A five-minute conservative freshness window applies; changing providers or an effort change without that compatibility gets a cold estimate. Reuse additionally requires observed cache usage, explicit cache controls, or provider support for implicit caching. Prior cache-read/write telemetry is exposed as evidence, not a promised next hit. Explicit cache-write estimates use all input tokens as an upper bound. Inclusive write prices replace input charges; Gemini storage prices add the separate cache-consumption charge. Provider routing can still select another eligible endpoint, so these are routing estimates rather than a billing quote.

## Experiment limits

Tiers, thresholds, output-length estimates, and reasoning multipliers are hand-set hypotheses. The router benchmark matrix must establish any improvement over auto.

The v0 makes one bounded decision call per request. Alongside system context and incumbent model/effort/failure evidence, one chronological context list contains the first user message, authenticated task anchor, two latest nonempty user messages, and six recent messages (including assistant/tool failures). Each selected message appears once; the anchor refers to its original message index. Changed/compacted history makes the anchor unknown. Shared head/tail truncation caps user excerpts at 4000 characters and assistant/tool excerpts at 1000 without stripping code or paths; requirements buried in the middle of a long message can still be omitted. This borrows Phaser's anchoring method without depending on Phaser's preprocessing, classifier, or fallback. It reuses session storage and adds no task taxonomy, tiers, A/B allocation, dry-run API, shadow execution inside auto, or automatic tools/search. Explicit `reasoning.max_tokens` and pro mode are rejected. Decision-model usage is recorded in pipeline metadata but is not added to caller billing.

## Multimodal inputs

Jev evaluates only extracted conversation text and attachment modality names. Attachment URLs, filenames, and bytes are not added to its classifier state. An attachment-only request supplies modality context and explicitly marks the contents unavailable. Original attachments remain on the executor request, and every selected/fallback candidate must advertise all required input modalities. Uploaded file references resolve before routing; remaining file parts require a file-capable model. Existing provider, privacy, region, and HIPAA gates still apply. If no configured candidate supports the inputs, the request fails instead of dropping attachments or selecting a text-only model.

Run `bun test ./plugins/decisions-router/index.test.ts ./plugins/decisions-router/session.test.ts ./plugins/decisions-router/input.test.ts` from `packages/router`. Coverage includes image/audio/video/file inputs, attachment-only prompts, mixed/history modalities, byte-preserving forwarding, unsupported pools, and uploaded-image resolution.

Classification cannot assess attachment contents. Routing cost and context estimates remain text-based; downstream provider validation and billing remain authoritative for media tokens and charges.

With metadata enabled (`X-OpenRouter-Metadata: enabled`), the `decisions-router` entry in `openrouter_metadata.pipeline` includes `data.input_modalities` and `data.classification_input_modalities`. The former describes the full conversation after uploaded-file resolution (for example `["text", "image"]`, or `["image"]` for an attachment-only request); it is not the selected model's supported-modality list. The latter is `["text"]`: Jev receives extracted text and textual attachment-type context, not native media. Both streaming and non-streaming responses preserve these fields for future sidebar display. No attachment URLs, filenames, or bytes are included in these fields.
