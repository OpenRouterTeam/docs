# Post-mortem: Datadog logging outage after syncpack migration

**Date:** 2025-11-19, 21:42 to 22:28 EST (2025-11-20, 02:42 to 03:28 UTC)
**Duration:** About 17 minutes of lost logs, 21:47 to 22:04 EST
**Severity:** Medium. Observability only; no customer-facing or inference impact observed.
**Affected systems:** `cfw-instrumentation` (telemetry pipeline), `cfw-api` (rolled back as a precaution), Datadog logs
**Author:** Devin, from the incident thread and the summary that James Sterling posted

---

## TL;DR

A release that introduced [syncpack](https://jamiemason.github.io/syncpack/) for `package.json` formatting ([#9679](https://github.com/OpenRouterTeam/openrouter-web/pull/9679)) reordered the conditional exports of `@openrouter-monorepo/env` so that `default` came before `workerd`. Because export conditions match in object order, Cloudflare Workers resolved the Node implementation instead of the Cloudflare one, and the instrumentation worker stopped sending logs to Datadog. Requests, Postgres writes, and inference kept working. Rolling back `cfw-instrumentation` restored logs within a minute. The team reverted the syncpack change ([#9756](https://github.com/OpenRouterTeam/openrouter-web/pull/9756)) and added a continuous integration (CI) check that rejects this ordering ([#9758](https://github.com/OpenRouterTeam/openrouter-web/pull/9758)).

---

## Impact

- Datadog lost API logs for about 17 minutes, from about 21:47 to 22:04 EST. A small percentage of logs still arrived, likely from instrumentation worker instances that were still running the previous version.
- Dashboards that read from Datadog logs, including the API status dashboard, showed traffic dropping to zero, which at first looked like a full outage.
- Inference was unaffected. Cloudflare request metrics and Postgres inserts stayed normal throughout, and the chatroom kept working.
- Releases paused for about 25 minutes until the revert deployed and the team verified it.

---

## Root cause

`packages/env/package.json` exposes a platform-specific entry point via conditional exports:

```json
"./platform": {
  "workerd": "./cloudflare/platform.ts",
  "default": "./node/platform.ts"
}
```

Runtimes and bundlers pick the first matching condition in object order, and `default` matches everything. The syncpack formatter sorted the keys alphabetically, producing:

```json
"./platform": {
  "default": "./node/platform.ts",
  "workerd": "./cloudflare/platform.ts"
}
```

With `default` first, the Cloudflare Workers build resolved `node/platform.ts`, which reads the core environment from `process.env` instead of the `cloudflare:workers` `env` bindings. The instrumentation worker therefore ran without its expected environment (Datadog configuration and related core values) and stopped publishing to the telemetry pipeline. Other queues were unaffected, which is why only logging broke.

The build emitted a warning about the export order, but reviewers missed it. The syncpack PR was large (63 `package.json` files changed) and had no lockfile version changes, so it looked low risk.

---

## Timeline (2025-11-19, EST)

| Time | Event |
| --- | --- |
| 21:42 | The release containing the syncpack migration (#9679) deploys ([run 19523658302](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/19523658302)). |
| About 21:47 | Datadog log volume drops to near zero as instrumentation worker instances pick up the new version. |
| 21:52 | John Krauss notices dashboards showing zero traffic and raises it in `#backend`. |
| 21:54 | John rolls `cfw-api` back to the previous version. |
| 21:55 to 21:58 | Tomas Oliva confirms that the chatroom works and Postgres writes continue: a logging issue, not downtime. Cloudflare shows normal request volume. |
| 22:00 | Sam Barnes observes that nothing is publishing to the telemetry queue and asks whether `cfw-instrumentation` was also reverted. |
| 22:03 | Tomas rolls back `cfw-instrumentation`. |
| 22:04 | Logs resume in Datadog. |
| 22:05 | Tomas links the syncpack PR (#9679) as the likely dependency-related change. |
| 22:14 | John opens the revert PR (#9756). |
| 22:18 | James Sterling approves merging the revert. |
| 22:20 | The revert release deploys ([run 19524408692](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/19524408692)). |
| 22:24 to 22:28 | The new version is rolled out and logs are confirmed still flowing. Releases resume. |
| 23:03 | James confirms the missed export-order warning as the root cause. |
| 23:13 | James opens the CI check that requires `workerd` before `default` (#9758). It merges the next day. |

---

## What went well

- Detection to full mitigation took about 12 minutes, at night, with some responders on mobile.
- The team separated "logging is broken" from "the API is down" within a few minutes by checking Cloudflare metrics and Postgres directly, which avoided a broader rollback.
- Rolling back the specific worker (`cfw-instrumentation`) identified the failure and fixed it in the same step.
- The team identified the root cause and shipped a CI guard the same night.

## What could be improved

- Rolling back `cfw-api` alone did not help because the broken code lived in `cfw-instrumentation`. A one-click rollback across all workers would have shortened mitigation. Sam raised this during the incident.
- The export-order build warning was easy to miss. [#9758](https://github.com/OpenRouterTeam/openrouter-web/pull/9758) turns the wrong order into a CI failure.
- Dashboards that depend on Datadog logs looked identical to a full outage. When logs vanish, check a signal that does not depend on Datadog first, such as Cloudflare metrics. A monitor on the telemetry-queue publish rate would make this explicit.
- Large formatting-only PRs need targeted review of any file where key order carries meaning, such as the `exports`, `imports`, and `browser` fields.

---

## Action items

| Action | Status | Reference |
| --- | --- | --- |
| Revert syncpack migration | Done | [#9756](https://github.com/OpenRouterTeam/openrouter-web/pull/9756) |
| Roll back `cfw-instrumentation` and `cfw-api` | Done | Incident thread |
| Add a CI check that requires `workerd` before `default` in the `@openrouter-monorepo/env` exports (`validateConditionalExportOrder` in `scripts/lint-package.ts`) | Done | [#9758](https://github.com/OpenRouterTeam/openrouter-web/pull/9758) |
| Reintroduce syncpack with exports sorting turned off for all packages (`sortExports: []`) | Done | `.syncpackrc.json` |
| One-click rollback action across all workers | Not confirmed | Suggested by Sam Barnes |
| Datadog monitor on telemetry-pipeline publish rate | Not confirmed | Suggested in this write-up |

---

## References

- Incident thread: https://openrouter.slack.com/archives/C076N2PHWGJ/p1763607178289289
- Post-mortem summary: https://openrouter.slack.com/archives/C05MYP9UPRU/p1763613295794659
- Syncpack migration PR: https://github.com/OpenRouterTeam/openrouter-web/pull/9679
- Revert PR: https://github.com/OpenRouterTeam/openrouter-web/pull/9756
- CI guard PR: https://github.com/OpenRouterTeam/openrouter-web/pull/9758
- Broken `package.json` at the reverted commit: https://github.com/OpenRouterTeam/openrouter-web/blob/43b13d3da2820eb86d028ad278b3969e1c3362aa/packages/env/package.json#L8-L14
