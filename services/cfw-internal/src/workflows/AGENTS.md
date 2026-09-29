# Workflow Agent Guidelines

Every Cloudflare Workflow in cfw-internal is one of two shapes. Pick the shape before writing code.

- **Cron task.** A scheduled job with no operator-visible run history. It is a `CronTask` executed by `CronTaskWorkflow` (`cron-task/workflow.ts`), one instance per task per fire, 15-minute step timeout, retried only on `WorkflowInternalError` (3 times). Rules live in `src/routes/cron/AGENTS.md`. Do not write a new `WorkflowEntrypoint` for this shape.
- **Durable run.** Multi-step work that an operator starts from Mission Control or a cron starts daily, that must survive a restart, retry a failed step alone, and leave a reviewable record. It is its own `WorkflowEntrypoint` class recording into `workflow_runs`. This file is about that shape. Reference implementation: `credit-pool-expiration/` with its routes in `src/routes/credit-pool-expiration/` and its Mission Control page in `projects/mission-control/app/admin-utils/credit-pool-expiration/`. The checklist at the end of this file is the order to build one in.

`credit-expiration.ts` still records into `credit_expiration_runs`. It is legacy, not a template. `arena-eval-*`, `model-example-*`, `bulk-refund` and `data-deletion` predate the shared mechanics and are not templates either.

## The run row is the contract

- One `workflow_runs` row per run, discriminated by `WorkflowRunKind` (`packages/db/workflow-runs/constants.ts`). Add a kind there for every new durable run and document what it does in the docblock. Never write ad hoc run tables.
- Admit the row before dispatching the Workflow with `admitWorkflowRun`, never `insertWorkflowRun` directly. Admission holds a per-kind advisory lock, refuses a second live run of the kind (or more than `maxActiveRuns`), and supersedes in-flight rows that stopped writing for 24 hours. A `claim` reserves entity ids for the run's lifetime when two runs of the kind may touch overlapping entities.
- Dispatch with `workflow.create({ id: `<kind>-${runId}`, params })`, then `setWorkflowRunInstanceId`. If `create` throws, `failWorkflowRun` the row. Put this in one `start-run.ts` function that both the manual route and the cron task call, so the two entry points cannot diverge.
- The payload carries `runId`, `requestedBy`, `dryRun` and the run's targeting inputs. Validate the targeting inputs with Zod in `start-run.ts` before `admitWorkflowRun`, since by the time `execute()` sees the payload the row already exists and a bare throw leaves it `queued`, where admission counts it as live for 24 hours. The Zod parse at the top of `execute()` is a second line of defence: when it fails and `runId` is readable from the raw payload, `failWorkflowRun` that row before rethrowing.
- All lifecycle writes go through `createWorkflowRunSteps({ store: workflowRunQueries, logTag })` from `expiration-workflow/run-steps.ts`. Do not call `markWorkflowRunStarted`, `mergeWorkflowRunState`, `completeWorkflowRun` or `failWorkflowRun` from a workflow directly. The helpers convert `Result` errors into thrown errors so the step retries.
- Wrap the whole pipeline in `steps.runRecordingFailure`, which records the first uncaught error to the row in its own `record-failure` step and rethrows so the Workflow instance also ends errored. A run must never sit in `running` after its instance died.
- End with one `store-result` step calling `steps.storeResult(runId, result, removeStateKeys)`. `result` is a flat, Zod-typed summary of counts and the `dryRun` flag, declared in a `run-schemas.ts` shared with Mission Control. Name the state keys to drop at completion; keep the ones a reviewer needs (a dry run keeps its candidates, a live run keeps its deliveries).

## Steps

- Wrap `step.do` once as a `WorkflowStepRunner` (`expiration-workflow/step-runner.ts`) with the workflow's retry config and `withRpcDbContext(this.env, fn, this.ctx.waitUntil.bind(this.ctx))`, and pass that runner down. Pipeline functions take `runStep` as a parameter and default it to `runInline`, so tests run the pipeline without a Workflow engine.
- Retry config is `{ retries: { limit: 3, delay: '1 minute', backoff: 'exponential' }, timeout: '30 minutes' }` unless a step has a reason to differ. The 30-minute timeout is what the 24-hour liveness window in `admitWorkflowRun` assumes.
- A step is a unit of retry, so its body must be safe to run again from the start: a restarted engine re-runs the in-flight step, and `retries.limit` does not change that. Anything outside `step.do` can run more than once too. Keep `execute()` down to payload parsing, building the runner and calling the pipeline.
- A step returns only what the next step needs to decide (counts, flags). Anything larger, and anything a later step or Mission Control must read, goes into the row's `result` jsonb under a named state key via `steps.mergeState` inside the step that produced it, and is read back with `steps.loadStateKey({ runId, key, schema })`. Step return values are the engine's, the row is ours.
- Persist the inputs of a side effect before performing it, in an earlier step. Recipients and the render timestamp are stored by `resolve-recipients` so a retried `notify-users` re-renders identical emails under identical idempotency keys. Derive idempotency keys from `runId` plus stable entity ids, never from `Date.now()` inside the sending step.
- Gate every side effect on `dryRun === false`. A dry run walks the discovery steps, stores its candidates and its result, and sends nothing.
- Record what was done (notification log rows, ledger entries) in the same step as the side effect, keyed so the next run's discovery skips it.
- Use `sendNoticeBatch` from `expiration-workflow/send-notice-batch.ts` for email fan-out. It sends one Resend batch and falls back to per-recipient sends on a rejected batch so one bad address does not suppress the rest.
- Log with `iLog`/`eLog` using a `<kind>:<event>` tag and `run_id` in every line. Never log recipients, payloads or row objects.

## Registration

The `WorkflowEntrypoint` class is exported from `src/index.ts`, bound in `wrangler.toml` as `[[workflows]]` with `name = "<kind>-workflow"`, `binding = "<KIND>_WORKFLOW"`, `class_name`, and typed on `CfwInternalEnv` in `src/env.ts`. All three change in the same commit.

## Entry points

- **Manual.** A route group under `src/routes/<kind>/` guarded by `composeAuthMiddleware([getAuthedOidc, getAuthedAdminKey])`: `POST /run` (defaults to `dryRun: true`, returns `StartRunResponseSchema`, 409 on `skipped-active-run`), `GET /runs` (metadata only, newest first, with requester emails) and `GET /runs/{runId}` (the run, its stored config and result). Mount it in `src/app.ts` under `api/v1/internal/<kind>`.
- **Scheduled.** A `CronTask` whose executor calls the same `start-run.ts` function with `requestedBy: null, dryRun: false`. It throws when the start function returns an error, so the task instance fails visibly, and logs `skipped-active-run` without failing, since a healthy run already in flight is the expected overlap outcome (see `dispatchLiveExpirationRun` in `src/routes/cron/tasks.ts`). The task follows every rule in `src/routes/cron/AGENTS.md`, including the `cf_workflows_cron_tasks` monitor entry.
- **Mission Control.** A page under `projects/mission-control/app/admin-utils/<kind>/` with a run form, a runs table that polls while a run is in flight, and a run detail view. Fetch through server actions that call the cfw-internal routes, never the database.

## Tests

- Unit-test the pipeline with `runStep` left at `runInline` and the store replaced by an in-memory `WorkflowRunStore`. `expiration-workflow/run-steps.test.ts` shows the store shape.
- Test discovery, planning and rendering as pure functions in their own files next to the workflow. The `workflow.ts` should hold only step wiring.
- Assert that a failing step leaves the row `failed` with the error, and that a dry run performs no send.
- `bun run --filter @openrouter-monorepo/cfw-internal test` and `bun run lint` before opening the PR. `src/cron-triggers.test.ts` fails if a new cron slot has no wrangler trigger.

## Checklist for a new durable run

1. Decide before coding: the kind (`kebab-case`, reused as the `WorkflowRunKind`, the wrangler `name` prefix, the route prefix and the Mission Control folder), the ordered steps with what each reads, writes to state and does as a side effect, the overlap policy (`maxActiveRuns`, entity `claim`), what a dry run stores, and the result summary fields.
2. Add the kind to `WorkflowRunKind` in `packages/db/workflow-runs/constants.ts` with one docblock sentence. No migration, `workflow_runs.kind` is text validated in app code. Per-entity records of what a run did (notices sent, refunds issued) belong in a domain table, not in `workflow_runs.result`.
3. Put the run config, result, list and detail schemas in the package that owns the domain (for credit work, a subfolder of `packages/credit-expiration/` such as `credit-pool/run-schemas.ts`, built on `WorkflowRunRecordSchema`, named for the domain rather than the kind), so cfw-internal and Mission Control import the same types.
4. Create `src/workflows/<kind>/` with `constants.ts` (`RETRY_CONFIG`, tuning), `schemas.ts` (payload schema and `*_STATE_KEY` names), pure step-body files with colocated tests, and `workflow.ts` holding the `TracedWorkflowEntrypoint` subclass, `runPipeline` wrapped in `steps.runRecordingFailure`, and `executePipeline` as the ordered `runStep` calls. Build `steps` once at module scope.
5. Register the class per the Registration section.
6. Write `src/routes/<kind>/start-run.ts`, then the manual routes (`run.ts`, `runs.ts` with a tested `run-view.ts` projection, `route.ts`) and mount them in `src/app.ts`.
7. If scheduled, add the `CronTask` and its monitor entry per the Scheduled bullet above.
8. Add the Mission Control page: `page.tsx`, a content component, a run form with `form-schema.ts`, a runs table, a run detail, `actions.ts` and `queries.ts` (TanStack options polling while `isRunInFlight`). Reuse `StatusBadge`, `WorkflowLink` and `workflow-run-format.ts` from `admin-utils/credit-expiration` and `pollUntilSettled` from `admin-utils/bulk-refund/run-detail.ts`. Add stories for the content and detail components.
9. Before review: security review per the root `AGENTS.md` if the run touches user data or sends email, a PR description naming the kind, steps, dry-run contract, overlap policy and monitor, and a local dry run with the Mission Control run detail screenshot attached.

## Gotchas

- `workflow.create` with an existing id throws. The id embeds `runId`, so this only happens on a retried start function. Treat it as a dispatch failure.
- A step's return value must be `Rpc.Serializable`. Return counts and flags, store rows in state.
- `steps.loadStateKey` returns `null` when the key is absent. Treat that as a broken invariant and throw, do not default to an empty list.
- `withRpcDbContext` in the runner needs `this.ctx.waitUntil.bind(this.ctx)`. Passing the method unbound loses `this`.
- A live run that finds nothing to do still stores a result. Do not short-circuit before `store-result`.
