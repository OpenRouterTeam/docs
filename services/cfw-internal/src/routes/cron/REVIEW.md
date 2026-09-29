# Cron Review Guidelines

## Missed-run monitor entry

A change that adds a task to `CRON_SCHEDULE`, moves a task to a different slot, or removes a task from the schedule must change `cf_workflows_cron_tasks` in `configs/terraform-monitors/monitoring/cf_workflows/monitors.tf` in the same PR. Flag a schedule diff without the matching monitor diff. Check the entry is keyed by the `CronTask` value, carries the slot's cron, and has a `missed_window_minutes` of the longest gap between fires plus one hour. No test enforces this.

## Ordering between tasks

Flag any `after`, `dependsOn`, or similar field on `CronScheduleSlot`, and any predecessor lookup or status polling in `dispatch.ts` or a task workflow. Ordered work chains from the parent workflow, see `AGENTS.md`.
