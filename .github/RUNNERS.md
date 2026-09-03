# CI runners

By default, workflows use the existing Blacksmith runners. Set the repository variable below to route Blacksmith jobs to GitHub-hosted runners:

```sh
gh variable set USE_GITHUB_RUNNERS --body true -R OpenRouterTeam/openrouter-web
```

## Runner provider selection

The `CI_RUNNER_PROVIDER` repository Actions variable selects the runner fleet for jobs whose `runs-on` expression has been migrated to it. GitHub Actions variables are plain strings with no enum or choice type, so the valid values are enforced by convention and by the `validate-runner-provider` job in `ci.yaml`, which fails on any other value. The following table lists the valid values:

| Value        | Fleet                                               |
| ------------ | --------------------------------------------------- |
| `github`     | GitHub-hosted runners (emergency fallback)          |
| `blacksmith` | Blacksmith self-hosted runners (default when unset) |
| `warpbuild`  | WarpBuild self-hosted runners                       |

To select a provider, set the variable:

```sh
gh variable set CI_RUNNER_PROVIDER --body warpbuild -R OpenRouterTeam/openrouter-web
```

To restore the default (`blacksmith`), delete the variable:

```sh
gh variable delete CI_RUNNER_PROVIDER -R OpenRouterTeam/openrouter-web
```

The selector follows these rules:

- A single variable makes Blacksmith and WarpBuild mutually exclusive,
  because only one value can be set at a time.
- `USE_GITHUB_RUNNERS=true` (the legacy override described in the following
  section) and `CI_RUNNER_PROVIDER=github` both force GitHub-hosted runners.
  The legacy boolean wins, so the existing emergency procedure keeps working
  during the migration.
- `runs-on` expressions compare against the exact known values and never
  interpolate the raw variable into a runner label. An unrecognized value
  falls through to the default provider, so jobs run on a real fleet instead
  of queueing indefinitely on a nonexistent label, and the
  `validate-runner-provider` job fails and prints the valid values.

Each size class uses the following canonical `runs-on` expression:

```yaml
runs-on: ${{ (vars.USE_GITHUB_RUNNERS == 'true' || vars.CI_RUNNER_PROVIDER == 'github') && '<github-label>' || vars.CI_RUNNER_PROVIDER == 'warpbuild' && '<warpbuild-label>' || '<blacksmith-label>' }}
```

Size-class label mapping:

| GitHub-hosted      | Blacksmith                      | WarpBuild                  |
| ------------------ | ------------------------------- | -------------------------- |
| `ubuntu-latest-md` | `blacksmith-2vcpu-ubuntu-2404`  | `warp-ubuntu-2404-x64-2x`  |
| `ubuntu-latest-md` | `blacksmith-4vcpu-ubuntu-2404`  | `warp-ubuntu-2404-x64-4x`  |
| `ubuntu-latest-md` | `blacksmith-8vcpu-ubuntu-2404`  | `warp-ubuntu-2404-x64-8x`  |
| `ubuntu-latest-xl` | `blacksmith-16vcpu-ubuntu-2404` | `warp-ubuntu-2404-x64-16x` |
| `ubuntu-latest-xl` | `blacksmith-32vcpu-ubuntu-2404` | `warp-ubuntu-2404-x64-32x` |

macOS has no WarpBuild equivalent of `blacksmith-12vcpu-macos-latest` (WarpBuild macOS is a fixed M4 Pro 6-vCPU/14 GB size), so macOS jobs keep their current expression until WarpBuild offers a comparable size.

`runs-on` sites are converted to the canonical expression incrementally, workflow by workflow, starting with the WarpBuild pilot workflows, because each converted site also changes checkout and cache action selection. Until a site is converted, it honors only `USE_GITHUB_RUNNERS`.

GitHub-hosted fallback jobs use `ubuntu-latest-md` (16-core) for 2/4/8-vCPU Blacksmith jobs, `ubuntu-latest-xl` (64-core) for 16/32-vCPU jobs, and `macos-latest` for the macOS job. They have cold-ish caches and skip Blacksmith sticky disks. Note: `actions/cache` entries live in Blacksmith's cache backend on Blacksmith runners and GitHub's backend on GitHub-hosted runners — cross-backend state (e.g. the release-freeze marker) does not carry across a toggle, and a freeze set on one backend reads as thawed on the other.

Delete the variable to restore the Blacksmith default:

```sh
gh variable delete USE_GITHUB_RUNNERS -R OpenRouterTeam/openrouter-web
```

## Debug a runner over SSH

The `Debug Runner (SSH)` workflow (`.github/workflows/debug-runner.yaml`) starts a runner on the fleet and size class that you choose and opens an SSH session on it with the WarpBuild [Action-Debugger](https://www.warpbuild.com/docs/ci/tools/action-debugger) action. The action works on every fleet, so you can compare a WarpBuild runner with a Blacksmith or GitHub-hosted runner from the same shell. The workflow runs only from `workflow_dispatch`. Nothing triggers it automatically, and the `actionlint` job in `ci.yaml` fails if `Warpbuilds/action-debugger` appears in any other workflow or composite action.

Before your first session, add a public SSH key to your GitHub account on the [SSH and GPG keys](https://github.com/settings/keys) page. The session accepts only the keys of the user who dispatched the run.

To start a session, follow these steps:

1. Dispatch the workflow with the runner label, whether to run the fleet-aware
   setup action before the session (it restores the bun store from the fleet's
   cache and installs `node_modules`), and the session timeout:

   ```sh
   gh workflow run debug-runner.yaml -R OpenRouterTeam/openrouter-web \
     -f runner=warp-ubuntu-2404-x64-4x -f setup=true -f session_timeout_minutes=30
   ```

2. Find the run and open it in your browser:

   ```sh
   gh run list -R OpenRouterTeam/openrouter-web -w debug-runner.yaml -L 1
   ```

3. In the **Open SSH session** step log, copy the `ssh` command. The command
   connects to `gha.warp.build` and also appears in the run's checks list.

4. Run the `ssh` command. The job stays paused while you are connected and
   ends when you exit the shell or when the timeout closes the session. Runner
   minutes are billed for the whole session.

The workflow keeps the following guardrails, and any new use of Action-Debugger must keep them too:

- `limit-access-to-actor: true`, so only the dispatching user's SSH keys can
  connect. Without it, anyone who obtains the session URL can connect.
- An explicit `timeout-minutes` on the debugger step, chosen from a bounded
  list, so an abandoned session can't run to the six-hour GitHub maximum.
- A SHA-pinned `Warpbuilds/action-debugger` reference with the version in a
  trailing comment.
- One session per actor at a time, enforced by the workflow's concurrency
  group.
- Restore-only caches: the setup action runs with `restore-only: "true"`, so
  the session reads the bun store and turbo caches but never saves an entry.
  Whatever you change on the machine can't reach the cache entries that CI
  restores by key prefix.

The runner input selects a label directly, so the session ignores `USE_GITHUB_RUNNERS` and `CI_RUNNER_PROVIDER`. This behavior is intentional: you can inspect a Blacksmith or WarpBuild machine while CI itself runs on the GitHub-hosted fallback.

## Runner pickup latency alert

The CI runner alert measures the average time, in seconds, from a job being enqueued until a runner picks it up. It groups by runner pool so an unhealthy pool is not hidden by the fleet-wide average, and evaluates a short fifteen-minute window to limit dilution by fast jobs. The requested instrument treats one job past the threshold as a real problem rather than noise. It deliberately does not alert on missing data because CI can legitimately go quiet.

Grouping follows the runner label, so GitHub-hosted fallback labels can alert as their own groups while the fallback is active. The alert identifies the specific label, whether it is a Blacksmith pool or a hosted runner class. During a planned fallback, Blacksmith groups stop producing samples and go quiet on their own because this alert does not fire on missing data, so they do not need to be muted. Hosted groups can page during a short fallback, which is useful signal that the fallback itself is struggling. For a long planned fallback, mute the monitor in Datadog for its duration rather than changing the threshold, then unmute it when Blacksmith runners are restored.

This signal has an important blind spot: abandoned waits are invisible because cancelled jobs have a distinct status and are excluded from the alert query. A severe outage therefore appears as fewer sampled jobs rather than a higher average. Historical data showed fifteen-minute pool means below one minute on ordinary recent days, while the July outage reached thousands of seconds. The **Runner Health** section of the **CI Health** Datadog dashboard pairs pickup latency with job volume by runner class so that abandonment remains visible. The alert links directly to this dashboard.

Response is observe-only — nothing flips `USE_GITHUB_RUNNERS` or re-runs stuck runs automatically. Runner labels are fixed at queue time, so flipping the variable never moves jobs that are already queued: recovery requires cancel + re-run. A flip mid-release-freeze reads as thawed on the other cache backend (see note above).

Every job using the `setup-environment*` composites writes `Runner fleet: Blacksmith|GitHub-hosted|Self-hosted (non-Blacksmith)` (the last covers non-Blacksmith self-hosted pools like arc-runners) to its run summary, and `slack-failure-alert` messages carry a `(runner: …)` suffix naming the fleet of the job that sent the alert, so each run and failure alert self-reports which fleet it used. Callers alerting from a different job than the one they report on (dedicated notifier jobs) can suppress the suffix with `include-runner-fleet: "false"`.

## Rollout and fallback runbook

Use this runbook to move migrated CI between fleets and to get back to a healthy fleet during an outage. Every step is a repository-variable change. You don't edit any workflow file.

### Switch the fleet

| Goal                                   | Command                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Pilot WarpBuild on migrated jobs       | `gh variable set CI_RUNNER_PROVIDER --body warpbuild -R OpenRouterTeam/openrouter-web` |
| Return to Blacksmith (default)         | `gh variable delete CI_RUNNER_PROVIDER -R OpenRouterTeam/openrouter-web`               |
| Emergency: everything on GitHub-hosted | `gh variable set USE_GITHUB_RUNNERS --body true -R OpenRouterTeam/openrouter-web`      |
| Leave GitHub-hosted after an outage    | `gh variable delete USE_GITHUB_RUNNERS -R OpenRouterTeam/openrouter-web`               |

`USE_GITHUB_RUNNERS=true` overrides any `CI_RUNNER_PROVIDER` value, so during a GitHub-hosted fallback you can leave `CI_RUNNER_PROVIDER` in place, and the pilot resumes when you delete `USE_GITHUB_RUNNERS`. Only `runs-on` sites that use the three-provider expression follow `CI_RUNNER_PROVIDER`. The `Lint Skills` pilot runs on WarpBuild unless the variable is `blacksmith` or GitHub-hosted mode is active. To check the current state, list the variables:

```sh
gh variable list -R OpenRouterTeam/openrouter-web | grep -E 'CI_RUNNER_PROVIDER|USE_GITHUB_RUNNERS'
```

### After each flip

A flip changes only jobs enqueued after it. Jobs already queued keep the label they were queued with and wait for that fleet.

1. Cancel queued runs on the old fleet and rerun them. Cancellation is
   asynchronous and `gh run rerun` rejects a run that has not completed, so
   wait for the run to finish before rerunning it:

   ```sh
   gh run list -R OpenRouterTeam/openrouter-web --status queued -L 50
   gh run cancel RUN_ID -R OpenRouterTeam/openrouter-web
   gh run watch RUN_ID -R OpenRouterTeam/openrouter-web
   gh run rerun RUN_ID -R OpenRouterTeam/openrouter-web
   ```

   Replace `RUN_ID` with a run ID from the first command. For merge-queue
   entries, remove the PR from the queue and add it again so that GitHub
   re-enqueues the checks.

2. Confirm the first new run landed on the intended fleet. Every job summary
   for `setup-environment*` starts with a `Runner fleet:` line, and the
   `validate-runner-provider` job fails on a mistyped value.
3. Expect one cold cache. Bun and Turbo caches are per backend (Blacksmith
   sticky disks, WarpCache, or `actions/cache`), so the first run after a flip
   installs from scratch, and a release freeze recorded on one backend does
   not carry over. Do not read the first run's timing as steady state.
4. Expect lagging PR branches to stay on the old fleet. `pull_request` runs
   use the workflow files on the PR branch, so a branch that has not merged
   `main` since the last `runs-on` change keeps its old fleet even though
   `validate-runner-provider` accepts the new variable. Merge `main` into the
   branch to move it.

### Monitor during a pilot

Watch the following signals for the first day after a flip and before widening a pilot:

- Pickup latency: the **Runner Health** section of the **CI Health** Datadog
  dashboard, and the alert described in the "Runner pickup latency alert"
  section. WarpBuild labels appear as their own groups
  (`warp-ubuntu-2404-x64-*`).
- Job duration and cache hit rate: compare the `Setup Environment` step and
  the whole `ci.yaml` run against a Blacksmith baseline from the same day.
  The WarpCache steps report `Cache restored from key` on a hit.
- Failures: `slack-failure-alert` messages in `#alerts-ci` carry a
  `(runner: FLEET)` suffix, so a fleet-specific failure pattern is visible
  without opening runs.
- Vendor status: <https://status.warpbuild.com/> and
  <https://status.blacksmith.sh/>.

Fall back when pickup latency for the pilot fleet stays above the alert threshold, a job fails on the pilot fleet but passes when re-run on the default, or the vendor status page reports an incident affecting Linux runners.

### Merge queue during a fleet problem

A merge-queue entry whose required check is cancelled by its timeout is removed with the same `failed_checks` reason as a real test failure. Follow `.agents/skills/debug-ci-merge-queue/SKILL.md` to read the removal reason and the per-job timeline. When the cause is the fleet, flip the fleet first, then re-add the PRs. Re-adding before the flip re-queues onto the same unhealthy fleet.

### Escalate to the vendor

Include the run URL, job name, runner name from the job's `Runner fleet:` summary line, the label requested, and the queued and started timestamps.

| Vendor     | Channel                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| WarpBuild  | <support@warpbuild.com>, dashboard chat at <https://app.warpbuild.com/> |
| Blacksmith | In-app support at <https://app.blacksmith.sh/?support=open>             |
| GitHub     | <https://www.githubstatus.com/> and <https://support.github.com/>       |

Post the flip and the reason in `#alerts-ci` so that the next person reading a red run knows the fleet changed.
