# Custom Classifiers — Design Spec

**Status:** Draft (design only, not scheduled for implementation)
**Last updated:** 2026-05-19
**Owner:** TBD

---

## 1. Vision & Positioning

OpenRouter is increasingly the AI gateway across an entire organization. Every
employee, agent, and pipeline call passing through us is a data point — but
today, that data is opaque to the people responsible for understanding how AI
is being used inside the company.

**Custom classifiers** let an organization define a structured taxonomy and run
a cheap classifier model over every generation. The output is a set of tags
stored alongside the generation. From those tags, OpenRouter can produce
dashboards and rollups that answer the questions a CIO, IT leader, or AI
governance owner actually has:

Classifiers are also available to individual accounts: the personal identity is
the entity, and the classifier runs against its configured workspace through the
same mechanism as the organization path.

- *Who* is using AI? (department / function)
- *What for*? (task type)
- *What's the sensitivity profile* of the traffic?
- *How is usage changing over time*?

The key product insight: **leadership doesn't need to see the prompts to
understand the program.** Tags are sufficient for the org-wide narrative, and
the individual employees' prompts stay where they were — visible to the
developer who wrote them, not exposed up the chain.

This positions OpenRouter as the natural place for AI program governance,
which is a category that does not yet have a clear winner.

## 2. User Stories

### Org admin (IT / AI program owner)
> *"I want to attach a department classifier to my org so I can show
> leadership how AI usage breaks down by team without reading anyone's
> prompts."*

Configures a classifier from a template, picks a cheap model, ships it.

### CIO / executive sponsor
> *"I want a single dashboard showing AI usage by department over the last
> 90 days."*

Opens the classifier dashboard, sees a stacked-area chart of generations by
department over time.

### Project owner
> *"My team uses OpenRouter for a specific product. I want my own taxonomy on
> top of the org-wide one, without affecting other teams."*

Attaches a project-scoped classifier. Both classifiers run; both sets of tags
are stored.

### Developer (end user of the API)
> *(invisible)*

Developers do not see classifications. The feature is admin-only by design —
this is the basis of the "we can govern usage without surveilling employees"
narrative.

## 3. Scope of v1

v1 is deliberately narrow. The goal is to ship the CIO narrative end-to-end
with the smallest credible surface.

**In scope:**

- Single classifier per org (configurable by org admins)
- Single classifier per project (additive, optional)
- Async, fire-and-forget execution after the user's response is returned
- Input to classifier: the last user message only
- Output: a constrained tag taxonomy (key/value pairs from a declared set)
- Tag storage: JSONB on the generation row + normalized analytics table
- Tags exposed in: activity log + one canonical dashboard
- Template gallery covering Department, Task Type, Sensitivity, Compliance
- Custom override of templates
- Versioned classifier schemas with opt-in backfill
- Passthrough token billing (classifier tokens bill like any other generation)
- Silent-drop failure mode with a classifier health panel

**Explicit non-goals for v1** (see §10):

- Inline policy enforcement (classifier influencing routing)
- Sampling (run on 100% of eligible requests in v1)
- Multiple classifiers per scope
- "Tags only, no prompt storage" privacy SKU
- SQL/BI exports
- Programmatic query API
- Per-API-key or per-app scope
- Request-level opt-out

## 4. Data Model

### `classifiers` (versioned)

A versioned configuration record. Editing a classifier creates a new version;
old versions are retained so historical generations remain interpretable.

| Field            | Type           | Notes                                                  |
|------------------|----------------|--------------------------------------------------------|
| `id`             | uuid           | Stable across versions                                 |
| `version`        | int            | Monotonic; `(id, version)` is unique                   |
| `org_id`         | uuid           | Tenant                                                 |
| `scope`          | enum           | `org` or `project`                                     |
| `project_id`     | uuid \| null   | Required when `scope = project`                        |
| `name`           | text           | Admin-facing label                                     |
| `template_id`    | text \| null   | Which built-in template this was forked from, if any   |
| `model_slug`     | text           | The classifier model (e.g. `anthropic/claude-haiku-*`) |
| `prompt`         | text           | The classification prompt                              |
| `schema`         | jsonb          | The structured-output schema (dimensions + values)     |
| `is_active`      | bool           | Only one active version per `(scope, scope_id)`        |
| `created_at`     | timestamptz    |                                                        |
| `created_by`     | uuid           |                                                        |

### `generations.classifications` (JSONB column)

Denormalized for read-path performance — the activity log and generation
detail views already read the generation row.

```json
{
  "<classifier_id>": {
    "classifier_version": 3,
    "department": "engineering",
    "task_type": "code_generation",
    "sensitivity": "internal",
    "classified_at": "2026-05-19T14:22:10Z"
  }
}
```

### `generation_classifications` (normalized analytics table)

One row per `(generation_id, classifier_id, dimension)` tuple. Powers
aggregation queries and dashboards.

| Field               | Type        |
|---------------------|-------------|
| `generation_id`     | uuid        |
| `classifier_id`     | uuid        |
| `classifier_version`| int         |
| `dimension`         | text        |
| `value`             | text        |
| `org_id`            | uuid        |
| `project_id`        | uuid \| null|
| `created_at`        | timestamptz |

Indexed on `(org_id, dimension, value, created_at)` for time-series rollups.

### Schema constraints

- Up to **8 dimensions** per classifier
- Up to **35 enum values** per dimension
- Every dimension implicitly includes an `"Other"` value the classifier
  can emit when nothing else fits — this catches schema drift and gives
  the model an escape hatch. Title Case to match the rest of the
  values in the dimension library (e.g. `"Engineering"`, `"Sales"`).

## 5. Execution Model

### Lifecycle

1. Generation completes; response is returned to the client (zero added latency)
2. A classification job is enqueued (durable queue, same path as usage records)
3. Worker picks up the job, calls the classifier model with the last user
   message + the classifier's prompt + structured-output schema
4. Result is parsed against the schema, then written to both the JSONB column
   and the normalized table
5. The normalized writes update dashboard rollups (materialized views or
   periodic aggregation)

### Org + project interaction

- Org classifier always runs (if configured)
- Project classifier additionally runs if configured for the request's project
- Both write under their own `classifier_id` — no precedence resolution needed

### Failure handling

- **Silent drop**: a failure (timeout, model error, invalid JSON) results in
  no tags written for that generation
- **Health panel**: admins see a coverage % (e.g. "97.4% of last 24h classified")
  plus an error feed with cause buckets
- No retries in v1 — the operational complexity isn't justified until we see
  real-world failure rates. Adding retries is a fast-follow.

### Billing

- **Passthrough**: classifier tokens bill like any other generation against
  the org's credits, with a `classifier_id` reference for line-item attribution
- Admins control cost via model choice (favoring Haiku / Flash / Nano)
- No flat fee, no quota in v1

## 6. Configuration UX

### Template gallery (primary entry point)

Admins start by picking a template. v1 ships four:

1. **Department / Function** — Engineering, Sales, Marketing, Legal, HR,
   Finance, Operations, Other
2. **Task Type** — Code generation, Writing, Analysis, Q&A, Summarization,
   Translation, Agent/tool use, Other
3. **Sensitivity Tier** — Public, Internal, Confidential, Restricted
4. **Compliance Domain** — PII, PHI, Financial, IP, None

Each template includes a pre-tuned prompt, an opinionated dimension set, and
a recommended classifier model.

### Custom override

After forking a template (or starting from scratch), admins can:

- Rename, add, or remove dimensions (up to 8)
- Edit enum values (up to 35 per dimension)
- Edit the classification prompt
- Change the classifier model

Editing creates a new version. The previous version is retained.

### Backfill

When a new version is published, admins can opt into a backfill job for the
previous **N days** (cap TBD, suggest 30 in v1) of historical generations.
Backfill cost is shown up front using historical token volume.

## 7. Privacy & Governance

- **Admin-only visibility.** Developers making API calls never see
  classifications — not in their dashboard, not in the API response, not in
  the generation detail view they have access to.
- **No request-level opt-out.** If the org admin attaches a classifier, every
  eligible request gets classified. This is what makes the governance story
  credible.
- **Org-mandatory + project-additive.** Project owners can enrich, not opt
  out.
- **Tags are additive metadata on top of existing logging.** v1 does not
  change the existing prompt logging behavior. A future "no prompts stored,
  tags only" SKU is a v2+ option (see §10).
- **Eligible requests** in v1 means: chat completions and completions that
  have at least one user message. Embeddings, audio, and other request
  shapes are skipped at the system level.

## 8. Surfaces in v1

### Config UI

- List of classifiers (org + project)
- Create/edit flow built around the template gallery
- Health panel: coverage %, recent failures, classifier token spend

### Activity log

- New column / filter for each dimension in the active classifier
- Drill-down to generation detail shows the full tag set

### Canonical dashboard

One dashboard ships in v1: **Department over time** (stacked area chart of
generations-per-department over the selected time range). This single chart
delivers the CIO narrative end-to-end.

Additional per-dimension charts are fast-follow, not v1.

## 9. Explicit Non-Goals for v1

These are intentionally deferred. Calling them out prevents scope creep
during implementation and clarifies what to build in v2+.

- **Inline policy enforcement.** v1 is observational only. Tags do not affect
  routing.
- **Sampling.** v1 classifies 100% of eligible requests. Sampling is a cost
  lever we add once we see real customer volume.
- **Multi-classifier per scope.** One classifier per org, one per project.
- **No-prompt-storage privacy SKU.** v1 inherits existing logging.
- **Exports / BI integration.** No SQL endpoint, no warehouse sink in v1.
- **Programmatic query API.** Dashboards only.
- **Per-API-key / per-app classifier scope.** Org + project only.
- **Request-level opt-out header.** Admin policy is absolute.
- **Alerting on tag thresholds.** Tags persist; alerts come later.

## 10. v2+ Roadmap

The v1 primitives extend cleanly to several follow-ups:

- **Inline policy mode.** Same classifier, but executed in parallel with (or
  before) the upstream call. Tags become routing/blocking signals.
- **Alerting.** Threshold rules over the normalized analytics table
  ("notify when >5% of weekly calls are classified `sensitivity=restricted`").
- **Sampling.** Per-classifier rate + per-dimension filter (e.g. "100% of
  app X, 5% of app Y").
- **Cross-customer benchmarks.** Because v1 ships opinionated templates,
  data from customers who use the canonical taxonomy can power benchmarks
  ("your org runs 40% more code generation than median"). This is potentially
  bigger than the classifier itself.
- **"Tags only, no prompt storage" SKU.** A premium privacy posture for
  regulated industries — classifier runs in-flight, raw prompts are dropped.
- **Agent / app dimensions derived from request metadata.** Some dimensions
  (interactive vs. batch, agent name, app identity) are better extracted
  from request metadata than classified from the prompt. v2 should treat
  these as first-class.
- **Multi-classifier per scope.** Once customers ask for it.
- **Programmatic query API + warehouse exports.** Once dashboards prove out
  which dimensions customers slice by, expose them via API.

## 11. Open Questions

To resolve before implementation:

1. **Backfill window cap.** 30 days? 90? Bounded by classifier token cost.
2. **Default classifier model per template.** Suggest a single recommended
   model (latest cheap Haiku/Flash/Nano tier) and let admins override.
3. **Dashboard refresh cadence.** Real-time, 5-minute, hourly rollups?
   Affects materialized view design.
4. **Versioning UI.** How prominent is "version 2 of 4" in the admin UI?
   How do dashboards present mixed-version data?
5. **Health panel SLA.** What coverage % counts as "healthy" vs. degraded?
6. **"Other" / uncategorized handling.** How should dashboards visualize the
   `other` bucket — surfaced prominently (so admins notice schema drift) or
   collapsed by default?
7. **Project-scope inheritance.** When a project does not configure its own
   classifier, does the org-wide one still apply? (Assumed yes — confirm.)
8. **Eligible request shapes.** Confirm the list of skipped shapes
   (embeddings, audio, image-only, etc.) at the system level.
9. **Token attribution.** Should classifier spend be shown as a separate
   line item in the org's usage view, or rolled into a "platform overhead"
   bucket?
10. **Schema validation at config time.** Should we run the configured
    classifier prompt against a handful of sample prompts at save time to
    validate it emits parseable JSON before letting the admin activate it?

## 12. Phase 2 Loose Ends

These were identified during phase 2 implementation but deliberately
deferred to keep the diff focused. Each is small; revisit before phase 3
ships or when the matching pain point becomes real.

Items resolved on `feat/classifications-dashboard-poc` are not listed
here; see git history. The current shortlist:

1. **No E2E test for the per-generation flow.** The worker is covered
   by unit tests on `buildClassifierResponseSchema` only. The full path
   (chat-completion → enqueue → worker → ClickHouse row) has been
   smoke-tested by hand but not in CI. **Fix:** add a `tests/e2e/`
   scenario that fires a chat completion against an org with a
   classifier configured, polls
   `default.generation_classifications` for ~10s, asserts a row
   appears.

2. **Worker re-entry safety.** Job payload doesn't carry the
   classifier version (because phase 1 dropped versioning). If a
   classifier is edited between enqueue and consume, the worker uses
   the latest config — which can produce rows tagged with one config
   but attributed to a classifier whose schema has since changed.
   Low-impact today; matters when versioning lands.

3. **Per-classifier sampling.**
   Flat-rate sampling is in place:

   - Per-classifier `sample_rate` (0.0–1.0) on the classifiers row,
     enforced in the worker via `Math.random()` after the config
     fetch. UI exposes it as a 1–100% input.

   The earlier enqueue-time 4K-char truncation cap
   (`CLASSIFIER_INPUT_CHAR_CAP` / `truncateForClassification`) has
   been removed; full request text is passed through to the
   classifier.

   What's still open:

   - **Size-aware sampling.** Today's flat rate treats a 200-char
     prompt the same as a 100K-char one. Eventually we may want
     "always classify <2K, 10% of 2K-20K, 1% of >20K" so cost scales
     gently with prompt size.
   - **Dashboard semantics.** When sample_rate < 1 the analytics
     view should show "you're seeing N% of traffic" so users don't
     misread sparse data. Wait for the reporting overhaul.
