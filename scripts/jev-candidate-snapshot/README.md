# Jev candidate snapshot

Jev's default candidate pool uses the union of task spend and token-usage leaders. The background `refresh-decision-pool` job reads the existing seven-day ClickHouse ranking query (top twenty per metric per task), joins Artificial Analysis scores with same-family predecessor priors for missing indices, and publishes tier priors to KV hourly. Inference reads this snapshot and the existing model catalog; it never queries analytics or switches to auto's classifier.

## Preview

```bash
bun run jev:snapshot --task data:extraction --task code:general_impl --output /tmp/jev-candidate-snapshot
```

The command writes `snapshot.json` and `snapshot.md` using the same tier inference and pool selection functions as production. It only reads public APIs. Public rankings expose the top **ten**, and the public catalog omits internal version groups, so this preview can differ from production's top-twenty/latest-version shortlist. Missing shares stay null. Sources are independently cached, not a transactionally consistent snapshot. No model success rate is inferred from traffic.

Pass `--routing-config /path/to/routing.json` to inspect an exported `decisions_router.routing` object. The command does not read or mutate Mission Control config. Pass `--with-profiles` to read comparative profile sources from the database selected by `PG_US_CENTRAL1_POOL_DB_URL`; without it the report explicitly marks profiles as not loaded. This option requires database credentials and never falls back to an implicit local database. JSON output includes source IDs, source update times, sample counts, effort where known, and live-config overrides. The public shortlist limitations still apply.

## Automatic defaults

`routing.pool` replaces the whole pool in either mode and bypasses the snapshot. When it is omitted, `routing.dynamic_pool.enabled` chooses the source: `true` (default) uses snapshot discovery; `false` uses the eight built-in revisions and ceilings without reading snapshot tiers or generated preferences. Existing saved configurations containing a materialized pool continue to override either mode until that array is removed. Independent `routing.profiles`, questions, effort controls, and provider/privacy restrictions still apply in both modes.

The built-in pool retains DeepSeek V4.1 Flash and Luna at `basic`, standard Muse Spark 1.3 and Grok 4.6 at `general`, Sol and GLM 5.3 at `deep`, and Fable 5.1/Astra at `max`, all with automatic effort. These are fixed revisions, unlike snapshot discovery's latest-family resolution. Unavailable models are removed by the existing catalog/endpoint checks. Other `dynamic_pool` settings only affect snapshot discovery. A snapshot failure still fails the request in snapshot mode; switching to the built-in pool is an explicit operator action.

```json
{
  "dynamic_pool": {
    "enabled": true,
    "max_models": 13,
    "max_age_days": 90,
    "exclude_authors": ["xiaomi", "tencent"],
    "include_models": [],
    "exclude_models": ["anthropic/claude-opus-5-20260723", "anthropic/claude-opus-5-fast-20260723"]
  }
}
```

These fields live under `decisions_router.routing` in the existing Mission Control JSON editor. Default model exclusions remove Opus 5 and its Fast variant as an operator preference. A saved `exclude_models` array replaces these defaults, so existing explicit arrays must retain those revisions to exclude them. Author exclusions match the canonical namespace, so the defaults exclude all Xiaomi/MiMo and Tencent/HY4 models, including future releases. The configurable 90-day catalog-age limit is freshness policy, not quality evidence. Exclusions, public text-model eligibility, latest-version-group resolution and the age limit apply even to included models and incumbents.

Name-inferred families keep the newest eligible generation, then the newest dated revision: DeepSeek V4.1 Flash replaces V4 Flash even if catalog version groups differ or only the older model has traffic. Family names retain the author, product, size and capability labels; Flash/Pro, Flash/Lite, thinking/instruct and different parameter sizes remain separate. Common numeric generations, including fused names such as Kimi K3 and Qwen3.5, are inferred without author-specific rules. Unrecognized naming changes remain separate rather than guessing a successor.

Seeds, `include_models` and the incumbent protect their families from popularity eviction. Seed selectors use the catalog's `~latest` family names; Muse uses the versionless `meta/muse-spark` family because its catalog has no latest alias yet. Newest eligible successors retain discovery protection and explicit family-level operator preferences. The curated Luna `basic` and Fable/Astra `max` ceilings also follow their families. Other capability ceilings use the successor's own benchmark indices first, then missing indices use the newest benchmarked predecessor in the same inferred family. Each inherited tier prior includes `benchmark_model`, naming the measured revision. Without benchmarks, the existing adoption/provisional rules apply. Historical traffic and scoped sufficiency evidence are not copied onto the successor. Protected families can exceed the soft model limit. Include/exclude values are canonical revisions. `routing.pool` still replaces discovery and can pin an exact revision or use a registered `~latest` alias.

The remaining slots are ordered by the highest adoption score among each family's revisions: the mean of classified spend share and token share across tasks. This lets a successor remain discoverable without treating its predecessor's traffic as its own quality evidence. One bounded model universe exists before the Jev call. After Jev answers, the candidate's task ceiling is combined with the existing effort cap. Continuation questions cover all possible model downshifts so a task-specific ceiling cannot introduce an unassessed downshift. Provider restrictions, scoped sufficiency evidence, costs, cache estimates and sticky session policy continue to govern selection.

## Tier priors

Dynamic defaults assign `basic` to the newest eligible Luna models and reserve `max` for Fable and Astra, labelled `curated` for every task. These are explicit family-level operator priors, independent of benchmark coverage. Other models use `general` or `deep`: coding tasks use the AA coding index, agent tasks the agentic index, and other tasks the intelligence index. Missing task indices can use the explicitly labelled intelligence proxy. These are model-level priors without effort-specific evaluation guarantees. An explicit `routing.pool` still replaces the defaults, including their tiers.

| Index | deep |
| --- | --- |
| Intelligence | 43 |
| Coding | 74 |
| Agentic | 48 |

Scores below `deep` yield `general` unless a curated family ceiling applies. The four tiers are `basic`, `general`, `deep`, and `max`; saved pool tiers and effort caps using `fast` normalize to `basic`. None/minimal effort is capped at `basic`, low at `general`, medium at `deep`, and high or above at `max`, always bounded by the model ceiling. Luna/high therefore remains `basic`, while Sol/low can qualify for `general`. Difficulty 0–1 starts at `basic`, difficulty 2 at `general`, difficulty 3 at `deep`, and difficulty 4 at `max`. Precision alone never raises the capability floor: exact multi-step work remains eligible for `general` when difficulty is 2 and gain is below the promotion threshold. Precision still scopes sufficiency evidence, configured preferences and high-gain requirements. The existing high-gain floor increase remains. Scoped sufficiency evidence can admit a basic candidate above the heuristic floor. These initial fixed thresholds are experimental; removing strong models from the pool does not promote a weaker model.

Without scores, an adoption prior assigns `deep` when both task spend and token shares reach 1%. Other unbenchmarked candidates use a provisional `general`. Neither adoption nor benchmark scores assign `max`. Missing shares cannot establish an upper-tier adoption prior. The snapshot labels every source, including curated choices, benchmark proxies and adoption priors; none substitutes for scoped evaluation evidence.

## Rollout and failures

Deploy the publisher and run `refresh-decision-pool` before activating snapshot routing. The reader accepts a valid snapshot for up to 48 hours while hourly refreshes recover; missing, malformed, future-dated or older snapshots return 503. Refresh failures preserve the last published snapshot. Set `routing.dynamic_pool.enabled: false` to use built-in defaults independently of snapshot publication, or supply a strict pool override. Jev failures still fail the request.

## Automatic task preferences

The same hourly refresh generates comparative task preferences from existing Design Arena and internal benchmark tables. Inference consumes only the published records. Fresh requests with difficulty at least 2 select a clear specialist when its profile advantage clears the configured margin; they do not also need to clear a cache-switching gain gate. Routine requests keep the cheapest eligible candidate. Later switches retain the existing gain/cost and session continuity rules. Explicit visual/codebase requirements reduce the weight of broad task and precision priors in proportion to their strength; precision preference does not apply to difficulty 0–1. These remain heuristic preference scores, not calibrated quality probabilities. No extra Jev questions or inference-time database reads are added. A preference cannot bypass request constraints or the heuristic tier floor; only the existing scoped sufficiency evidence can do that.

Among qualifying specialists within the existing preference margin of the strongest score, the cheaper candidate wins; tiny score differences do not justify arbitrary premiums. Fable retains its codebase-integration seed preference, but no blanket precision bonus: exactness alone does not establish it as a specialist for every task.

The existing `codebase_integration` question covers substantial read-only repository analysis and root-cause investigation as well as edits. Simple file lookups remain insufficient. `big_model_gain` considers repeated incorrect conclusions and failed approaches caused by misunderstanding, while distinguishing expected exploration, external waits, and provider errors. Neither elapsed time nor turn count independently triggers escalation; the existing gain/cache gates remain. API failure counters do not count failed shell commands.

Inferred latency sensitivity prefers eligible low-effort candidates at initial selection, but retains capable alternatives when none qualify at low effort. It no longer makes the default pool impossible to satisfy. An explicit `policy.evidence.max_response_ms` keeps the existing admission check using available response-time estimates or its conservative effort proxy when timing is unknown.

| Family | Source and scope | Routing use |
| --- | --- | --- |
| Structured extraction | Existing targeted evaluations in `routing.profiles[revision].evidence`, with their original effort and scope | Sufficiency admission. The benchmark tables do not contain the extraction experiment's full scoped records; no evidence is fabricated from formatting scores or AA indices. |
| Frontend/visual creation | Design Arena's Models/Web Dev overall category, refreshed within 30 days | Its existing ELO percentile divided by 100 becomes a `code:frontend_ui` preference. This is a comparative prior, not a success probability. Zero/missing tournament counts are recorded as unknown (`samples: null`); no confidence interval is inferred. Explicit effort suffixes such as `Max` or `(xhigh)` restrict the preference to that effort; ambiguous variants such as `(Thinking)` are excluded. Unlabelled rows remain model-level priors. Specialized image, 3D and agent categories are not generalized to all frontend work. |
| Repository engineering | Kepler `deep_swe` → `code:general_impl` | Latest qualifying run accuracy becomes a preference only at its explicit reasoning effort. Requires a visible successful aggregate run, the standard `mini_swe` harness, no custom system prompt or candidate-model list, and at least 30 tasks. NativeTS aggregate `total_questions` already counts distinct evaluated tasks, so it is not divided by epochs; an explicit task subset further bounds it. AA remains a tier prior. |

SWE-Atlas QA is excluded from automatic preferences pending an audit of its rubric/scorer polarity: the local k6 task marked positively worded “avoids…” requirements as negative and inverted the judge's affirmative results. Its aggregate score is therefore unsuitable as an automatic comparative prior. The five-task local spot-check also cannot establish scoped sufficiency evidence; operator profiles remain independent and editable.

The snapshot retains at most 2,000 generated preference rows. If inheritance exceeds that budget, retain complete per-model preference sets: catalog targets first, then the most recently updated observations, with stable family/revision tie-breaking. Never retain a generic prior while dropping that model’s effort-specific overrides. Omitted sets produce no automatic preference; tier priors remain available, and publication logs the truncation.

Source refresh times do not establish when an external benchmark was evaluated. Preferences retain this distinction and expire after 30 days, including at consumption time. Internal run history is bounded to the newest 1,000 aggregate rows per benchmark; hitting that cap emits a warning. Missing, stale, sparse, unsupported-harness or unknown-effort internal runs produce no preference. The newest qualifying run wins rather than the best historical score. Sources are not directly calibrated against each other; they apply to separate task tags and feed experimental preference strengths, not probabilities.

Generated preferences target the resolved concrete revision. Missing Design Arena and DeepSWE task/effort priors inherit from the newest benchmarked predecessor in the same inferred family, with `benchmark_model` naming the measured revision. Source IDs, timestamps, sample counts and effort scope remain unchanged; inherited preferences still expire against their original timestamp. Current-revision observations supersede inherited ones even when weaker, and a newer model-level observation supersedes older effort-specific priors. Within one revision, an effort-specific observation takes precedence over an unlabelled prior. These are inherited comparative priors, not measurements or sufficiency guarantees for the successor. Precedence is family seed preferences, the selected revision's generated task preferences, `routing.profiles[latestAlias]`, then `routing.profiles[revision]` per-field overrides. Latest profile keys use the existing catalog version-group resolver, so all effort candidates for that latest target receive the same operator profile while effort-specific benchmark records keep their original scope. An unavailable or malformed alias is never treated as an older concrete model. Setting `tasks: {}` clears automatic task preferences for that model; individual task values can instead be supplied explicitly. Existing `evidence` remains independently configurable and still requires the tested concrete revision and effort. `routing.pool` is still a strict replacement and bypasses both dynamic discovery and generated profiles.

For example, this profile follows the latest Astra release without replacing the pool:

```json
{
  "profiles": {
    "~openai/gpt-astra-latest": { "visual_quality": 1 }
  }
}
```

The three-family rollout should compare existing selection, the cheapest eligible candidate, and the profile-selected candidate on held-out tasks, including session continuations. Measure acceptance/artifact quality, total cost and completion time. The implementation and routing checks do not by themselves establish improved quality or savings.
