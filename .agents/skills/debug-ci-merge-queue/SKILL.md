---
name: debug-ci-merge-queue
description: >-
  Diagnose slow or evicted GitHub merge-queue entries and hanging CI jobs, especially when a PR is removed with no visible test failure. Distinguishes required-check timeouts from test failures, identifies Blacksmith sticky-disk read failures, and documents the runner-provider switch (Blacksmith, WarpBuild, GitHub-hosted) and vendor-escalation paths.
allowed-tools: Bash
user-invocable: true
---

# Debug CI Merge Queue

Use this when the merge queue is slow or evicting PRs, CI jobs hang, or a PR leaves the queue with no visible test failure.

## Fast Path

Run these checks before changing workflows or retrying blindly.

First, identify which fleet ran the job. Every `setup-environment-*` job summary
prints `Runner fleet: <GitHub-hosted | WarpBuild | Blacksmith>` and the runner
name (`warp-*` is WarpBuild, `blacksmith-*` is Blacksmith). Compare it with the
current provider variables. A mismatch has three possible causes, so rule out
the first two before attributing it to a provider flip: a `pull_request` run
uses the PR branch's workflow files (a branch that has not merged `main` keeps
the old `runs-on`), a workflow can default to a fleet on its own (`Lint Skills`
runs on WarpBuild with `CI_RUNNER_PROVIDER` unset), or the run was enqueued
before the flip and you are looking at the wrong fleet:

```bash
gh variable list -R OpenRouterTeam/openrouter-web | grep -E 'CI_RUNNER_PROVIDER|USE_GITHUB_RUNNERS|USE_STICKY_DISKS'
```

A merge-group `unit` failure in files the PR never touches is usually a
cross-file test-isolation leak, not the PR. Shards are per package, so a
web-package change cannot reshuffle the `packages/router` shard. Confirm by
running the named test files locally on the branch and by checking whether
another PR's merge-group run on the same base SHA passed the same job; if it
did, the entry only needs re-queuing.

### 1. Read the merge-queue removal reason

GitHub reports a required check cancelled by a timeout as `failed_checks`. Inspect the PR timeline directly:

```bash
gh api graphql \
  -f query='
    query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) {
        pullRequest(number:$number) {
          timelineItems(
            last: 100
            itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT, ADDED_TO_MERGE_QUEUE_EVENT]
          ) {
            nodes {
              ... on RemovedFromMergeQueueEvent {
                createdAt
                reason
              }
              ... on AddedToMergeQueueEvent {
                createdAt
              }
            }
          }
        }
      }
    }' \
  -f owner=OpenRouterTeam \
  -f name=openrouter-web \
  -F number=<PR_NUMBER>
```

Look for `RemovedFromMergeQueueEvent.reason: failed_checks`. This does not prove a test failed. It includes cancellation by a job timeout.

Known confirmed examples on 2026-08-03 UTC:

- PR 28998 was enqueued at `03:50:45Z` and removed at `04:01:31Z`.
- PR 31592 was evicted twice, at `03:03:21Z` and `03:16:16Z`.

### 2. Check whether required jobs timed out

The `unit` and `integration-shards` jobs in `.github/workflows/ci.yaml` each carry a `timeout-minutes` cap (currently 7 for `unit`, 10 for `integration-shards` — the `integration` check is a gate that aggregates the shards; re-check the file before relying on the exact value). Inspect the workflow and the run logs:

```bash
grep -n -C 4 -E 'timeout-minutes:|unit:|integration-shards:|integration:' .github/workflows/ci.yaml
gh run view --job <JOB_ID> --log \
  | grep -nE 'Resolved, downloaded and extracted \[24\]|bun install|sticky disk|Mount'
```

If the job was cancelled at its `timeout-minutes` boundary after printing `Resolved, downloaded and extracted [24]`, treat it as an environment timeout until the dependency-cache comparison below disproves that.

### 3. Compare sticky-disk and cache-based installs

This check applies to Blacksmith jobs only. WarpBuild jobs use `.github/actions/setup-environment-warpbuild` (WarpCache for the bun store and turbo cache, no sticky disks); a stalled `bun install` there points at WarpCache restore or the WarpBuild fleet, so compare the `Cache bun store (WarpCache)` and `Cache turbo (WarpCache)` step timings against a recent healthy WarpBuild run of the same job and escalate to WarpBuild, not Blacksmith.

`fatal: could not read Username for 'https://github.com'` in a `lint` job is an anonymous `git fetch` outside the checkout being refused on the fleet's shared egress addresses, not a permissions problem. Such fetches must authenticate with the job's `GITHUB_TOKEN` through `GIT_CONFIG_*` environment variables (never argv, which leaks into `ps` and error text); `scripts/check-subtree-integrity.ts` is the reference implementation. A branch that predates that fix fails until it merges `main`.

Any workflow calling `.github/actions/setup-environment-blacksmith` without setting `use-sticky-disks: "false"` uses the sticky-disk path. In this incident, the observed stalling workflows were `ci.yaml`, `ci-clickhouse.yaml`, and `ci-python.yaml`. The control path is `.github/actions/setup-environment`, which uses `actions/cache@v5` and no sticky disk. Compare runs from the same minute and Blacksmith fleet:

```bash
gh run view --job <JOB_ID> --log \
  | grep -nE 'Resolved, downloaded and extracted \[24\]|bun install|Mount'
gh run view --job <JOB_ID> --log \
  | grep -nE 'bun install|packages downloaded|installed'
```

The decisive comparison from this incident was:

- Sticky-disk jobs printed `Resolved, downloaded and extracted [24]`, then went silent. The warm bun store was on a disk that stopped serving reads, so almost nothing was fetched from the network.
- The sticky-disk mount still succeeded in about `435ms`. A fast mount does not prove that the mounted disk can serve reads.
- The cache-based control installed in `13.15s` on the same Blacksmith fleet at the same minute, downloading `641` packages and installing `4498`.
- The healthy non-sticky workflows were `ci-auth.yaml`, `ci-postgres.yaml`, and `ci-broadcast.yaml`.

That comparison rules out the registry, the network, and the fleet generally. This is degradation, not necessarily a hard stop: a Python job without a timeout eventually succeeded after `29m59s`. Jobs with a ten-minute timeout died; jobs without one crawled.

Do not stop at vendor or npm aggregate status pages. Both reported operational during this incident, which was never posted there at all. The vendor had published a separate `us-west` storage cluster incident naming stickydisks the previous morning, resolved well before our window, so a matching past incident is a hint about failure modes rather than evidence about the present.

Recovery has its own signature. The hung jobs completed on their own once the disks began serving again, so a sudden batch of very long jobs finishing at the same moment marks the end of the degradation.

## Mitigation Decision

Two repository variables select the runner fleet. The full runbook is in `.github/RUNNERS.md` (section "Rollout and fallback runbook"). You need repository admin access to change them.

| Goal                                  | Command                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Emergency: everything GitHub-hosted   | `gh variable set USE_GITHUB_RUNNERS --body true -R OpenRouterTeam/openrouter-web`      |
| Leave GitHub-hosted fallback          | `gh variable delete USE_GITHUB_RUNNERS -R OpenRouterTeam/openrouter-web`               |
| Migrated `ci.yaml` jobs on WarpBuild  | `gh variable set CI_RUNNER_PROVIDER --body warpbuild -R OpenRouterTeam/openrouter-web` |
| Migrated `ci.yaml` jobs on Blacksmith | `gh variable delete CI_RUNNER_PROVIDER -R OpenRouterTeam/openrouter-web`               |

Precedence: `USE_GITHUB_RUNNERS=true` overrides `CI_RUNNER_PROVIDER`. `CI_RUNNER_PROVIDER` only moves workflows that use the three-provider `runs-on` expression (`ci.yaml`, `check-skill-frontmatter.yaml`); other workflows still follow only `USE_GITHUB_RUNNERS`. `USE_STICKY_DISKS` is independent and only gates Blacksmith sticky-disk mounts.

The following caveats apply to every flip:

- Only runs enqueued after the flip move. Queued and in-flight runs keep their requested label: cancel them, wait for the cancellation to complete (`gh run watch`), then rerun them, and remove and re-add merge-queue entries.
- `pull_request` runs use the workflow files on the PR branch, so a branch that has not merged `main` since a `runs-on` change lands on the old fleet even though `validate-runner-provider` accepts the new variable. Check the run's head SHA before suspecting the variable, then merge `main` into the branch.
- Caches are per backend (sticky disks, WarpCache, `actions/cache`), so the first run on the new fleet is cold and slower. Do not read that first run as a regression.
- Toggling the runner variable silently drops any active release freeze: the marker is cached per backend, so see `.github/RUNNERS.md`.
- `validate-runner-provider` in `ci.yaml` fails with an explicit error on a mistyped `CI_RUNNER_PROVIDER`. The rest of CI still runs on the Blacksmith default.

### Switch to the other self-hosted fleet

When only one vendor is degraded and the affected jobs are migrated `ci.yaml` jobs, flip `CI_RUNNER_PROVIDER` to the healthy fleet (`warpbuild`, or delete the variable for Blacksmith). This keeps CI on self-hosted pricing and warm-pool sizes.

Watch the first runs after the flip in the **Runner Health** section of the CI Health dashboard in Datadog: pickup latency for the new fleet's labels (`warp-ubuntu-2404-x64-*` or `blacksmith-*`), `setup-environment-*` step durations, and merge-queue removals with `reason: failed_checks`. Do not compare the first (cold-cache) run against the old fleet's warm runs.

### Switch CI to GitHub-hosted runners

When both self-hosted fleets are suspect, or the degraded workflow is not migrated to `CI_RUNNER_PROVIDER`, set `USE_GITHUB_RUNNERS` to `true`. Every relevant `runs-on` expression reads this variable and switches to `ubuntu-latest-xl` or `ubuntu-latest-md`.

On GitHub-hosted runners, the setup composites skip sticky-disk and WarpCache steps and use `actions/cache` instead.

GitHub-hosted larger runners cost roughly twice the per-minute rate of the self-hosted fleets, so this is a temporary mitigation, not a resting state. Set the variable back once the vendor recovers.

### Reverting a fallback

Before reverting, confirm recovery rather than assuming it. While the fallback is active nothing exercises the degraded fleet, so the absence of failures proves nothing. Flip back, watch the first run, and confirm that dependency installation finishes in well under a minute. If the stall returns, flip to the fallback again immediately.

### Stay on Blacksmith and rotate cache keys

This is a secondary option, not the mitigation used in this incident. The sticky-disk keys include version suffixes; see `.github/actions/setup-environment-blacksmith/action.yaml` for the current values (e.g. `...-bun-store-vN`, `...-turbo-cache-vN`). The action comment there says to bump the suffix to provision clean disks. Use this option only when accepting the risk of staying on Blacksmith.

## Vendor Escalation

Check the following status pages first, but do not stop there, because a degradation can be live while every page reports operational:

- WarpBuild: <https://status.warpbuild.com/>
- Blacksmith: <https://status.blacksmith.sh/>
- GitHub Actions: <https://www.githubstatus.com/>

Every escalation needs the run URL, job name, runner name, requested label, and the queued and started timestamps.

### WarpBuild

Send the following to <support@warpbuild.com> or to the dashboard chat at <https://app.warpbuild.com/>:

- The runner names (`warp-<size>-x64-<id>`) and requested labels
- Whether the symptom is pickup latency (job stays queued) or a stalled step, and the WarpCache restore step log
- The same job from a recent healthy WarpBuild run for comparison

### Blacksmith

Send Blacksmith support:

- Disk keys (the current sticky-disk keys from `.github/actions/setup-environment-blacksmith/action.yaml`)
- Expose ID `01KZ2VZ0HDPWG2N1JJM4RT2NW3` from a hung job
- The specific runner instance names, for example `blacksmith-01kz2vmzxnqgqrvbkas3e0x8mh-32vcpu`
- The symptom that the sticky-disk mount succeeds in about `435ms`, then `bun install` prints `Resolved, downloaded and extracted [24]` and stalls while reads from the warm bun store do not complete
- The healthy same-fleet `actions/cache` control and its `13.15s` install

Support entry point:

<https://app.blacksmith.sh/?support=open>

## Report

Include:

1. The PR number and the GraphQL `reason` and timestamps.
2. The affected run and job IDs, timeout setting, and last visible install log.
3. The sticky-disk versus cache-based install comparison.
4. Which fleet ran the affected jobs, whether `USE_GITHUB_RUNNERS` or `CI_RUNNER_PROVIDER` was changed, and which stuck runs were re-run or re-enqueued.
5. The disk keys, expose ID, runner names, and support case details if escalating.
