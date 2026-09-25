# Task Taxonomy — Contracts, Rollout, and Learning Loop

**Status:** Layer 1 (contracts and compatibility) implemented; shadow runtime not yet built
**Code:** `packages/db/classifiers/task-taxonomy/`
**Registry version:** `2.0.0-draft.5`

---

## 1. Why a second classifier

The existing `TaskTypeClassifier` (`packages/classifier/classifiers/task-type-classifier.ts`)
emits one of 30 `TaskTypeTag` values. That single axis conflates several
independent aspects of a request: what the user wants done, whether tools are
involved, which subject area it belongs to, what input modalities are present,
and the register of the writing. The task taxonomy represents those as independent
dimensions so each can evolve on its own.

The task taxonomy does **not** replace the legacy classifier. The legacy classifier keeps driving routing, the customer-facing
task-type preset, and historical analytics. The taxonomy starts in shadow mode, disabled
by default, and is compared against the legacy tag through the compatibility map before
any consumer is allowed to depend on it.

## 2. Dimensions

| Dimension           | Label field                | Cardinality              |
| ------------------- | -------------------------- | ------------------------ |
| `task`              | `task.primary/secondary`   | 1 primary, up to 2 extra |
| `execution_mode`    | `execution.mode`           | 1                        |
| `execution_surface` | `execution.surfaces`       | 0..n, tied to `uses_tools` |
| `domain`            | `domain.primary/secondary` | 1 primary, up to 2 extra |
| `input`             | `input.modalities`         | 1..4                     |
| `output`            | `output.modalities`        | 1..4                     |
| `visual_style`      | `output.visual_style`      | 0..1                     |
| `language`          | `input.language`, `output.language` | 1 input, 0..1 output |
| `complexity`        | `complexity`               | 1                        |
| `response_entropy`  | `response_entropy`         | 1                        |

The three scalar facets were added in `2.0.0-draft.3`. They describe the request independently of what it asks for. `language` is bound twice: `input.language` is the natural language of the supplied text or audio and `output.language` is the natural language the response is expected in, `null` when the output is not language (an image, a number, code with no prose). Both draw from one vocabulary of stable lowercase registry ids inspired by BCP-47 conventions, with `_` for subtags (`en`, `zh_hans`, `zh_hant`, ...) and the legacy ISO 639-3 id `als`; they are not guaranteed to be valid BCP-47 locale tags. The set covers the 58 languages of the legacy spoken-language tagger plus `mixed` and `unknown`. `complexity` is the reasoning depth and constraint count the request demands (`trivial`, `simple`, `moderate`, `complex`, `expert`). `response_entropy` is how open the space of acceptable responses is (`low`, `medium`, `high`, `very_high`). Each is a registry dimension with the same status, alias, hash, and facet-signal treatment as the other facets, so a candidate value such as a new language surfaces through `learning.facet_signals` and is promoted by the same policy.

`2.0.0-draft.5` renames the input values to content modalities and adds the two output facets. `input.modalities` draws from `text`, `image`, `audio`, `video`, `code`, and `structured_data`, sharing ids with the model catalog's `InputModality` where the meaning matches (the draft.4 `natural_language`, `image_processing`, `document_processing`, and `audio_video_processing` ids are gone, with documents recorded by their content and audio/video split into atomic values). `output.modalities` is the kind of artifact the response produces, drawing from `text`, `image`, `video`, `audio`, `speech`, and `transcription` (ids shared with `OutputModality`), and `output.visual_style` is the dominant look of a generated image or video (`photoreal`, `anime`, `cartoon`, `painterly`, `sketch`, `graphic`, `pixel_art`, `other_stylized`). Values name the look a viewer would describe, never the production technique: a 3D animated film is `cartoon`, photoreal CGI is `photoreal`. `output.visual_style` is a single nullable value and must be `null` unless `output.modalities` includes `image` or `video`.

Image, document, and audio/video understanding are **input** facets, not tasks. The draft.1 task leaves for them are deprecated and aliased with `kind: 'move'` to the corresponding input values. Speech synthesis, speech transcription, image generation, and video generation are tasks (`media.speech_synthesis`, `media.speech_transcription`, added in `2.0.0-draft.4`, and `media.video_generation`, added in `2.0.0-draft.5` beside the existing `media.image_generation_editing`) because the request asks for them; the surface they arrive on is recorded by the producer, not inferred by the model.

Explicit-content classification and the register or tone of text responses are out of scope for the taxonomy (prose style is low signal). The label schema is `strict()` and rejects `content.explicit` and `style` fields; the response JSON schema never emits them. Visual style of generated images and video is in scope as `output.visual_style` because it describes the artifact, not the writing.

## 3. Registry

`registry.ts` holds the curated registry as a typed `as const` constant so
the set of active task ids is a literal union (`ActiveTaskId`). Every entry
is `active`, `candidate`, or `deprecated`.

`parseRegistry` / `validateRegistry` enforce:

- no duplicate ids within a dimension, at least one active value per dimension
- adjacent boundaries reference two distinct active tasks
- every alias source is deprecated, every alias target is active
- cross-dimension aliases are only allowed with `kind: 'move'`
- every deprecated value has an alias (historical labels stay interpretable)
- migrations form a chain: following targets from any source reaches the current `version` without revisiting a version, sources are unique, and nothing migrates away from the current `version`

### Filtering by surface

There is one registry. Every entry carries `surfaces`: either `'all'` or the generation types it applies to. Pass `{ registry, surface }` to the active-value helpers, schema builder, and label parser to select values applicable to that surface. Omitting `surface` selects all active values. Candidate collision checks and result hashing always use that same, complete registry; no filtered registry copy is created.

`validateRegistry(registry, surface)` checks the whole registry, including entries the surface cannot select, then checks that each dimension has an active value for the surface and that applicable aliases have applicable targets. Validate before constructing a model request; surface-aware label parsing also performs these checks. Invalid configuration fails rather than widening the allowed values.

### Registry identity

`registryHash(registry)` is the SHA-256 of a canonical JSON serialization
(keys sorted at every depth, array order preserved). It is independent of
property insertion order and changes when any definition, status, alias,
migration, or policy value changes. Every stored taxonomy result carries both
`taxonomy_version` and `registry_hash` (`TaskTaxonomyResultSchema`) so a
version string that was edited without a bump is still detectable.

### Aliases and migrations

Aliases are read when interpreting a label produced under an older registry:
resolve `source` → `target`, moving the value to `target.dimension` for
`move`. Migrations record the field-level shape changes between versions
(`field_moves`, `removed_fields`) and the dimensions whose meaning changed
enough to require **semantic backfill** (`backfill_dimensions`) rather than a
mechanical rename. `2.0.0-draft.1 → 2.0.0-draft.2` requires semantic backfill
for `task`, `domain`, and `input`. `2.0.0-draft.2 → 2.0.0-draft.3` moves or removes no fields and requires backfill of `language`, `complexity`, and `response_entropy`, which draft.2 labels do not carry. `2.0.0-draft.3 → 2.0.0-draft.4` moves or removes no fields and requires backfill of `task` for the two speech tasks, which draft.3 labels cannot carry. `2.0.0-draft.4 → 2.0.0-draft.5` moves or removes no fields and requires backfill of `task`, `input`, `output`, and `visual_style`: draft.4 labels carry the retired input ids and no output facets. The `media.audio_video_understanding → input.audio` alias is a required single-target placeholder for a value that covered both media: backfill of `input` decides `audio`, `video`, or both from the request, and the alias must not be read as a claim that every historical occurrence was audio.

## 4. Label validation

`parseClassifierLabel(value, { registry, surface? })` runs the strict Zod schema and then
the registry-bound invariants: active membership of every forced value,
no duplicates, primary not repeated as secondary, `execution.surfaces`
non-empty iff `uses_tools`, and the learning-signal rules below. All
violations are reported together in the error string.

`boundClassifierLabelSchema({ registry, surface? })` narrows every dimension to its applicable active ids. `classifierResponseJsonSchema(schema)` converts a Zod schema's input shape to Azure's supported structured-output subset (`anyOf`, without local-only length, pattern, numeric-bound, and array-cardinality constraints). Deprecated and candidate values are unavailable as selected values; local parsing still enforces the complete Zod constraints.

### Surface facts: classify only unknown values

`surfaceFacts(surface)` returns the label fields an API surface fixes for every generation, or `undefined` when the model judges the whole label. Today `tts` fixes `media.speech_synthesis` with a `speech` output, `stt` fixes `media.speech_transcription` with a `transcription` output, `image` fixes `media.image_generation_editing` with an `image` output, and `video` fixes `media.video_generation` with a `video` output. Input modalities come from the producer's message. No language override is involved: the model classifies language directly.

`factBoundClassifierLabelSchema(options, facts)` is the response schema for a surface with facts. The model returns task summary and a nullable abstention decision, domain, one language, a nullable visual style, complexity, response entropy, sufficiency, confidence, decision notes, and learning signals for the inferred facets. The visual style is kept only when the surface's fixed output is `image` or `video` and is forced to `null` otherwise. It does not return task identifiers (other than an abstention), secondary tasks, execution, modalities, output language, or task-learning fields. Those fields are not in the model's response schema, and extra fields are rejected rather than overwritten or discarded.

`applyFacts(judged, facts)` assembles the complete label: the surface task is the primary unless the model abstains; execution is `answer_only` without tools; modalities come from the facts; `input.language` uses the model's single language judgment, and `output.language` repeats it unless the fixed output is `image` or `video`, where it is `null`. Task learning is derived (`clear_fit`, the chosen primary as the sole nearest task, and no task candidate). Facet signals are retained unchanged and validated, not repaired. The full label and versioned result formats remain shared with other classifiers.

Use the same schema for the model request and local response parsing:

```ts
const schema = factBoundClassifierLabelSchema(options, facts);
const responseSchema = classifierResponseJsonSchema(schema);
// Send responseSchema to the model; keep known request facts in the prompt context.
const parsed = parseSchema(schema, rawModelResponse);
if (isErr(parsed)) {
  return parsed;
}
return createTaskTaxonomyResult(parsed.data, options);
```

`createTaskTaxonomyResult` checks the assembled label's registry membership and learning invariants before attaching the registry version and hash. A surface whose projected task menu holds only the fallback tasks (`other.abstain_insufficient_context`, `other.unclassifiable`) is rejected before a request is built. Facts must not be used for translation or non-language outputs.

## 5. Learning loop

Every label carries a `learning` block. It is evidence, not authority: no
code path mutates the registry from a label.

- `task_fit` is `clear_fit`, `adjacent_boundary` (needs ≥2 `nearest_tasks`),
  or `candidate_new_leaf` (needs a `task_candidate`). `nearest_tasks` must
  include the chosen primary.
- Facet signals (≤1 per dimension) follow the same shape with `FacetFit`.
- A candidate must carry `proposed_*`, `definition`, `not_captured_by`, and
  `recurring_signal`, and must not collide with any existing registry id.

### Promotion policy

A candidate becomes a review item when it recurs across at least
`minimum_examples` (5) labels, `minimum_dates` (3) UTC days, and
`minimum_segments` (2) user segments. Promotion always requires human
review, a `version` bump, a `migrations` entry, and an explicit backfill
decision. `automatic_promotion` is `false` and nothing in this package can
promote.

### Evidence hygiene

Aggregate recurrence counts, not prompts. The research evaluation kept the
production-weighted natural cohort separate from the balanced challenge
cohort; prevalence claims must come from the natural cohort only. Nothing
committed here or in the runtime layer may contain raw prompts, R2 logs,
request/generation/user/API-key ids, or per-record model outputs.

## 6. Compatibility with `TaskTypeTag`

`legacy-compat.ts` maps every active taxonomy primary task to exactly one
`TaskTypeTag`. The type `Record<ActiveTaskId, TaskTypeTag>` makes the map
total at compile time, and `legacy-compat.test.ts` checks it against the
registry at runtime. Deliberate fallbacks where V1 has no equivalent:

- `software.code_review` → `code:review_security` (V1's only review bucket)
- `software.testing_verification`, `software.refactoring_optimization` → `code:general_impl`
- `software.code_explanation_documentation`, `information.planning_decision_support` → `qa_knowledge`
- `data.analysis` → `research_report`; `data.reconciliation_consolidation`, `data.visualization` → `data:transformation`
- `assistance.advice_coaching` → `conversational_reply`
- `assistance.transactional_assistance` → `agent:tool_dispatch`
- `creative.creative_writing` → `roleplay_fiction`
- `media.image_generation_editing`, `other.*` → `other`

`legacyTagForTaxonomyTask(id)` returns `undefined` for deprecated, candidate, or
unknown ids so callers decide how to treat them; it never guesses.

The bridge exists for shadow comparison and for consumers that need a legacy
tag while the taxonomy is evaluated. It must not be used to change legacy classifier output, routing,
or presets.

## 7. Rollout plan

**Layer 1 (this change):** registry, contracts, hashing, compatibility map,
tests, this document. No runtime, no flag, no storage.

**Layer 2 (deferred, separate PR):** a `TaskTaxonomyClassifier` beside
`TaskTypeClassifier`, reusing the Azure Responses conventions (`store: false`,
JSON-schema-constrained output, `omitReasoning`), with:

- a distinct tagger identity including the registry version, e.g.
  `task_taxonomy@2.0.0-draft.3`
- a sampling flag that defaults to `0`; V1 keeps its current sample rate
- no paid model calls in tests
- telemetry: parse success/failure, per-dimension distributions, compat tag,
  latency, estimated cost, candidate counts. Never raw prompts.

### Storage (decided, storage layer PR)

Both of the following, from one validated result:

1. **Flattened tags in `tags_transactions`.** `flattenLabelToTags` emits one
   `(tagger_name, tag_name, confidence)` row per selected value, with the
   label's single confidence on every row. Taggers are `task_taxonomy:task`,
   `task_taxonomy:task_secondary`, `task_taxonomy:execution_mode`,
   `task_taxonomy:execution_surface`, `task_taxonomy:domain`,
   `task_taxonomy:domain_secondary`, `task_taxonomy:input`, `task_taxonomy:input_language`, `task_taxonomy:output_language`, `task_taxonomy:complexity`, `task_taxonomy:response_entropy`. Primary task,
   domain, execution mode, input language, complexity, and response entropy each produce exactly one row, so per-tagger
   request counts in `tags_activity_daily_v2` stay additive. `output_language` produces no row when `output.language` is `null`, and `visual_style` produces no row when `output.visual_style` is `null`. Summary,
   decision notes, sufficiency, learning, version, and hash are not tags.
2. **Raw results in `task_taxonomy_results`.** One row per
   classification: `taxonomy_version`, `registry_hash`, promoted
   `task_primary`/`execution_mode`/`domain_primary`/`confidence`, the full
   validated label as compressed JSON, the classifier model's unparsed
   `raw_output` text, a `parse_status` (`ok`, `parse_error`,
   `validation_error`) with `parse_error` so failed attempts are stored
   with empty label columns rather than fabricated ones, and the same
   non-identifying analytics keys `tags_transactions` carries. No prompt, completion,
   request, generation, user, or API-key identifiers.

Runtime writes to either table are Layer 2 work.

### Promotion of the taxonomy out of shadow

Requires, per registry version: parse-success rate, agreement with the legacy tag via the
compat map on the natural cohort, reviewed candidate backlog, and a backfill
decision for every migration since the last promoted version. Only then may
a consumer read the taxonomy, and only behind its own flag.
