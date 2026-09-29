---
name: arena-studio
description: Operate Arena Studio through the internal Buddy API — challenge rubric checks and judge guidance, fills, result curation (approve/reject/unapprove), judge runs, and publishing or unpublishing public rankings. Use whenever a request names an Arena challenge, challenge checks, result approval, judge run, public ranking, or an Arena Studio URL. Shared operational knowledge for Buddy (the Slack agent) and Devin. Do not use for ordinary model/endpoint staging (that is the buddy skill).
user-invocable: true
---

# Arena Studio — challenge, curation, and judging operations

Arena Studio is the internal tool behind the public Arena pages. Every operation
here runs against **production** through the internal Buddy API and follows the
[`buddy`](../buddy/SKILL.md) skill's auth and approval rules. Read that skill's
Non-negotiables first: `BUDDY_API_KEY` bearer auth, `X-Buddy-Actor-Email` set to
the approving human on every write, never print the key, and never supply the
human's approval yourself.

**This skill is a living document** (see [`../AGENTS.md`](../AGENTS.md)). The
route list below is a digest of `services/cfw-internal/src/routes/buddy-api/`
and drifts from it; fix it in the same PR when a run finds a difference.

## Source of truth

1. The live contract: `GET https://openrouter.ai/api/v1/internal/buddy/openapi.json`
   (bearer auth). The public OpenAPI file does not include Buddy routes.
2. The route code, which is authoritative when the contract and this skill
   disagree:
   - `arena-authoring.ts` — tree, sections, challenges, prompt versions
   - `arena-review.ts` — review queue, fills, fill coverage, input assets
   - `curate-arena-result.ts` — approve / reject / unapprove one result
   - `arena-judging.ts` — checks, judge runs, publication, unpublish
   - `arena-judging-batch.ts` — the same judge run across many challenges
   - `arena-model-backfill.ts` — fill every challenge of a model's modality

Do not work from a cached route list. Arena routes change independently of the
public API.

## Route families

Base: `https://openrouter.ai/api/v1/internal/buddy`. Public explore data comes
from `GET https://openrouter.ai/api/frontend/v1/arena/explore` (no Buddy auth).

```text
Reads
GET    /arena-tree
GET    /arena-challenge/{challengeId}
GET    /arena-challenge/{challengeId}/checks
GET    /arena-challenge/{challengeId}/fill-coverage
GET    /arena-challenge/{challengeId}/fill-attempts
GET    /arena-challenge/{challengeId}/result-counts
GET    /arena-challenge/{challengeId}/rejected-cells
GET    /arena-challenge/{challengeId}/eval-runs
GET    /arena-eval-run/{runId}
GET    /arena-review-queue
GET    /arena-result/{resultId}
GET    /arena-explore-preview

Challenge configuration
PUT    /arena-challenge/{challengeId}/checks
PATCH  /arena-challenge/{challengeId}
POST   /arena-challenge/{challengeId}/version
POST   /arena-challenge, /arena-section, reorder and convert-to-parent routes

Generation (billed)
POST   /arena-challenge/{challengeId}/fill
POST   /arena-model-backfill
POST   /arena-input-asset

Curation
POST   /arena-result/{resultId}/approve | reject | unapprove
POST   /arena-results/approve | reject | unapprove        (bulk)

Judging (billed) and publication (public-facing)
POST   /arena-eval-run
POST   /arena-eval-runs                                   (many challenges)
POST   /arena-eval-run/{runId}/publish
POST   /arena-eval-runs/publish
POST   /arena-challenge/{challengeId}/eval-publication/unpublish
```

## Read first

Before any mutation, resolve the live resource and collect the current state:

1. Resolve the challenge from `/arena-tree` or the public explore response.
   Distinguish grouping-only parents from promptable variant challenges.
2. Read the challenge's current prompt version, checks, and judge guidance.
3. For fills, curation, or judge runs, resolve the eligible cells from
   `fill-coverage`, `result-counts`, and the review queue. Historical `approved`
   rows are not the same as judgeable cells at the current prompt version.
   `fill-coverage` also returns `eligibleModels`, the roster an omitted-roster fill would pay for; a model outside it fails the fill's gates (text-only challenge, reference-image count, pinned input readability, required input modality, minimum reference-image dimension, reference delivery mode, exact video duration and resolution pair, raster output), so intersect an explicit roster with it per challenge before posting. Null means the challenge cannot be filled or the catalog read failed. A fill with an explicit roster is refused whole (400, nothing charged) when any named model fails a gate, and the body names each rejected model with its reason. Common cases: svg/pixel-art challenges take text LLMs, not image models, and style/edit models whose `input_references.min >= 1` only fit challenges that pin fixtures. Video-input-only models (edit, upscale) have no fillable challenge today. The gates only encode deterministic provider constraints, so a model that passes them can still fail a cell on prompt or asset moderation. Read `fill-attempts` for that: a moderation failure is content-dependent and the model stays eligible, while a provider capability error that recurs across challenges means a gate is missing.
4. For judge runs, resolve the roster (sent or default), params, target count,
   existing runs (`eval-runs`), and whether a publication is live.
5. Keep the terms precise when reporting:
   - **checks** and **judge guidance** are challenge configuration.
   - **fill** dispatches paid generation and inserts pending results.
   - **approve**, **reject**, **unapprove** change curation state. They are not
     interchangeable: an approved result needs `unapprove`, not `reject`.
   - **judge run** is billed asynchronous work that snapshots the rubric. It
     does not change the challenge or publish anything.
   - **publish** flips a settled run to `live: true` on the public page.

## Confirmation gate

Arena write routes do **not** carry the `apply: false` preview that catalog
routes do. The preview is yours to assemble from the reads above, and the
approval rules are the same: post the preview, ask in a separate message, write
only after an explicit yes.

**Launch-readiness default.** For a model that is being staged for launch, the first fill scoped to that model's permaslug and the first judge run over that model's approved cells run without waiting for approval: post the preview, then write in the same turn and report what the API returned. Nothing these writes produce is public. The default covers first-pass spend only, and the API does not detect a repeat for you, so read first: `fill-attempts` and `rejected-cells` per challenge, because a rejected cell is uncovered and a repeated `arena-model-backfill` bills it again; and `eval-runs` per challenge, because `target_selection: "unjudged"` excludes only cells with live published scores, not cells an earlier unpublished or unsettled run already judged. `eval-runs` defaults to the challenge's current prompt version, so when `prompt_version` is above 1 read it once per earlier version too (`?prompt_version=`). The run list does not expose which cells or models a run targeted, and an unsettled run has no calls to inspect, so a run you cannot rule out for this model counts as prior work. Any cell with a prior fill attempt, and any challenge with a prior run that might cover this model, is a repeat: list them separately in the preview and get explicit approval before regenerating or re-judging them. Everything else keeps the gate too: curation (`approve` / `reject` / `unapprove`), any publish or unpublish, a fill whose roster is omitted or names other models, a rubric save, and a judge run that re-judges already-judged cells (`target_selection: "all"`) or targets more than one model.

**Single mutation** — the preview names the challenge or result and its stable
ID, the `before → after` state, the exact checks and guidance for a rubric save,
the eligible cell count × judge count = expected judge calls for a run, whether
the operation is billed, asynchronous, or public-facing, and the Arena Studio
link `https://internal.openrouter.ai/arena-studio`.

**Bulk request** (two or more resources, including `/arena-results/*`,
`/arena-eval-runs`, `/arena-model-backfill`, or a sweep over variants):

1. Resolve the complete affected set from live data.
2. Post one consolidated preview listing every resource with its exact change.
3. Total the billed and asynchronous work per challenge and overall.
4. State what is excluded and why (not live, not promptable, no eligible cells).
5. Offer exactly `Apply all`, `Edit first`, `Cancel`. Write nothing until
   `Apply all`. `Edit first` means resolve the revised set and preview again;
   confirmation does not carry over to a different set. Under the launch-readiness default (a backfill or `/arena-eval-runs` scoped to the launching model), skip the offer and write after posting the preview.

## API contracts (verified against the route code)

### Save rubric checks

```text
PUT /arena-challenge/{challengeId}/checks
{ "checks": [{ "label": "…", "ask": "…" },
             { "label": "…", "ask": "…", "params": { "scale": 10 } },
             { "label": "…", "ask": "…", "params": { "expected": 3, "region": { "x": 0, "w": 0.5 } } }],
  "judge_guidance": "string or null" }
```

The schema is strict (`packages/db/arena-evals/schemas.ts`): there is no `kind`
field, and unknown keys return 400. A check with no `params` is pass/fail,
`params.scale` (only `10`) makes it rated, `params.expected` makes it counting,
and the two are mutually exclusive. The `ask` of a counting check must not
contain the expected number. `params.region` optionally tells the judge to
consider only a horizontal slice of the full image (`x + w <= 1`); the image
itself is sent uncropped. Labels are unique, at most 50 checks. A
rubric save updates checks and guidance in place and does not bump the prompt
version.

### Start a fill

```text
POST /arena-challenge/{challengeId}/fill
{ "model_permaslugs": ["author/model-permaslug"], "idempotency_key": "arena:<challengeId>:v<version>:<uuid>" }
```

The route plans from the current prompt version, subtracts cells that already
hold a pending or approved result, and dispatches one batch for the rest. Every
generation is paid for. A reused `idempotency_key` returns the existing batch
and generates nothing, so retry with the same key and rerun with a new one.
Omitting `model_permaslugs` fills the whole catalog of the modality — only with
explicit approval for that scope. A roster of exactly the launching model falls under the launch-readiness default.

### Curate a result

```text
POST /arena-result/{resultId}/approve | reject | unapprove
POST /arena-results/approve | reject | unapprove   { "result_ids": ["…"] }
```

Preview each result's status transition. Curation changes which cells are
eligible for judging and public display.

The bulk routes accept at most 50 `result_ids` per call (400 above that, nothing applied), so chunk a larger approval and count the returned transitions per chunk. The review queue nests the id under `result.result_id`.

### Start a judge run

```text
POST /arena-eval-run
{ "challenge_id": "uuid",
  "judge_models": ["author/judge-permaslug"],          // optional, default roster if omitted, max 8
  "judge_params": { "temperature": 0.0, "reasoning_effort": "medium" },  // optional
  "target_selection": "all | unjudged",                // default all
  "model_permaslugs": [...] | "arena_result_ids": [...] }  // optional narrowing
```

Set the inference params you mean explicitly. `judge_params` deliberately has
no max tokens: a truncated verdict is a wrong verdict, so do not look for a way
to set one. There is **no idempotency key** on judge runs; a repeated call
creates a second run and pays again. Expected calls = targeted cells × judges.
One run judges at most 500 target cells (`MAX_ARENA_EVAL_TARGETS` in
`packages/db/arena-evals/schemas.ts`); a larger set is refused, so split it
across runs and preview each one.
The response carries `eval_run_id` and `target_count`; poll `GET /arena-eval-run/{runId}` until `run.status` settles. That read has no top-level `status`: `run.status` is the run state, `live` is the publication flag, and `calls[].status` is per judge call, so a settled run can still carry a failed call. Publishing is a separate step. For the same roster across many challenges use `/arena-eval-runs`, which returns one started run per challenge and reports the ones it refused.

`/arena-eval-runs` and `/arena-model-backfill` share the `arena_bulk` chunk gate under one batch id: each call is one apply, a full chunk answers 428 until you post its check-in, and a fresh chunk answers 429 with `Retry-After` (about ten minutes) before it accepts the next check-in. Budget one bulk call per wait window, sleep for the header rather than retrying, and never re-post a call that returned 200 because there is no idempotency key. Run status is per challenge: read `GET /arena-challenge/{challengeId}/eval-runs` for each targeted challenge and summarise the newest run's `status` and whether it is in `live_eval_run_ids`.

### Publish or unpublish

```text
POST /arena-eval-run/{runId}/publish
POST /arena-eval-runs/publish
POST /arena-challenge/{challengeId}/eval-publication/unpublish   { "prompt_version": n }  // optional
```

Only a settled run publishes. Preview `live: false → live: true`, the target
challenge and prompt version, and the verdict summary. This is customer-visible and always needs an explicit `Publish` from a human; the launch-readiness default never covers it.

## Reporting

After a write, re-read the resource and report only what the API returned. For
fills and judge runs report the batch or `eval_run_id`, current `status`,
`target_count`, and whether publication is still off. Do not claim completion
until the API reports it. Include the Arena Studio link on every reply.
