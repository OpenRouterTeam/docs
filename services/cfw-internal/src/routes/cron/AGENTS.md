# Cron Agent Guidelines

Every Cron Trigger resolves to one `CronScheduleSlot` in `schedule.ts`, and `dispatch.ts` starts one `CronTaskWorkflow` instance per task of that slot (`src/workflows/cron-task/workflow.ts`). The instances start concurrently, and the schedule has no ordering primitive.

## Adding a task

1. Add the value to the `CronTask` enum in `tasks.ts` and its executor to `CRON_TASK_HANDLERS`. The executor receives `{ env, scheduledTime }`, runs inside `withWorkflowDbContext`, and throws to fail the instance. Put the task body in its own file next to `tasks.ts` with a colocated test, and keep the handler entry to a call.
2. Add the task to a slot in `CRON_SCHEDULE`, adding the cron expression to `[triggers].crons` in `wrangler.toml` if the slot is new.
3. Add the `cf_workflows_cron_tasks` monitor entry.
4. Do not add a `waitUntil` fan-out, a Queue, or a second Workflow inside the task body. A task is one `step.do` with a 15-minute timeout that retries only a `WorkflowInternalError` from the engine (3 times); a task error is not retried. Work that exceeds that, needs per-step retries, or needs a reviewable run record is a durable run started from the task: see `src/workflows/AGENTS.md` and the `credit-pool-expiration` task for the dispatch shape.

Every task is also triggerable by hand through `POST /api/v1/internal/cron/trigger`, so a task must not assume it runs only at its scheduled time.

## Re-execution

A cron task step is not at-most-once. When the Workflows engine restarts, it runs the in-flight step again from the start, and code outside `step.do` can run twice. A task body can therefore execute more than once per fire. Before you move a task here, make sure it tolerates re-execution. This matters most for settlement and reconciliation tasks. Source: https://developers.cloudflare.com/workflows/build/rules-of-workflows/

## Ordering between tasks

When a task must run after another one, chain the workflows from the parent:

1. Write the pair as one schedule entry, `{ task: PARENT, next: FOLLOW_UP }`. `next` can itself be a `{ task, next }` entry for a longer chain. Do not list the follow-up task on its own in the slot.
2. `dispatchCronTrigger` starts only the entry's `task`. `CronTaskWorkflow` looks up its `next` with `findCronFollowUp` and starts it in a second `step.do` after the task step, with the same `cron` and `scheduledTime` and an id from `cronWorkflowInstanceId`. The follow-up starts also when the task step throws, so a broken parent does not stall the chain.
3. Do not make the follow-up instance poll or wait for the parent. The parent creating it after its own step is the ordering.
4. Add the follow-up to `cf_workflows_cron_tasks` like any other task of the slot.

Do not add an `after`, `dependsOn`, or similar field to `CronScheduleSlot`, and do not add predecessor lookups to `dispatch.ts`.

## Schedule parity

`CRON_SCHEDULE` and `[triggers].crons` in `wrangler.toml` must cover the same set of cron expressions. `src/cron-triggers.test.ts` enforces this. When you add or remove a slot, change both in the same commit.

## Missed-run monitor

Every task in `CRON_SCHEDULE` needs an entry in `cf_workflows_cron_tasks` in `configs/terraform-monitors/monitoring/cf_workflows/monitors.tf`, keyed by the `CronTask` value, with the slot's cron and a `missed_window_minutes` of the longest gap between fires plus one hour. Add the entry in the same commit that adds or moves the task, and remove it when the task leaves the schedule. Nothing enforces this in tests. Monthly tasks go in `cf_workflows_monthly_cron_tasks` instead, because Datadog caps a metric monitor window at 43200 minutes. Give them the evaluation time on the fire day, the window that covers every fire of that day, and the number of fires expected.
