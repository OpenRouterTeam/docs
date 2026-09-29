---
name: prove-intern-change
description: >-
  Prove an intern change end to end on the local `tilt up -- --interns` stack
  before a PR claims it works: an ori runtime change, a provisioner startup
  script change, a vault or intern-api change, or a dashboard change, alone or
  together. Uses intern slots with branch sources and the committed
  `intern:e2e` scenarios. Use when a PR's "How I verified" needs a live run.
user-invocable: true
---

# Proving an intern change end to end

A change to an intern crosses at least two of: the ori runtime, the startup script the provisioner renders, the vault and intern-api workers, and the dashboard's frontend-api. Each has its own unit tests, and every real bug in this stack has lived in the seam between two of them. The proof is a run of the real pieces together, from the branches under review, on the shared stack, recorded as a transcript.

## The rule

Never restart, retrigger or `tilt down` the shared stack for a proof. Take a slot. A slot runs your branches beside the stack and is its own intern, so nothing you do reaches `seed-local` or another agent's slot. [local-intern-chat](../local-intern-chat/SKILL.md) → "Intern slots" has every flag.

## Steps

1. Check out each branch under test into its own worktree, pinned to the commit you are proving, and run `bun install` in each. Do not borrow another agent's worktree; the transcript names the commit it ran, and a worktree someone is still pushing to cannot be named.
2. Pick the sources:
   - `--ori-source <ori checkout>`: the runtime, built into `ori-runtime:source-<id>`.
   - `--web-source <openrouter-web checkout>`: that branch's secret-vault, intern-api, tunnel edge and frontend-api (add `--web` for the web app).
   - `--provisioned [--provisioner-source <checkout>]`: start the agent from that branch's startup script, `ExecStartPre` and `TimeoutStartSec` included. Use it whenever the change touches what a deployed intern's env or unit does.
3. Run the scenario that covers the change, or add one (below):

   ```sh
   bun run intern:e2e list
   bun run intern:e2e run vault-preflight --ori-source ~/c0de/ori-3078 --provisioner-source ~/c0de/ow-47744 --web-source ~/c0de/ow-47746
   ```

   It brings its slots up, drives them, asserts, tears them down (`--keep` leaves them), and exits non-zero on the first failed step. The transcript lands in `.dev/local-intern/e2e/<scenario>-<time>.md`, with each source's path and commit.
4. Paste the transcript into the PR's "How I verified". A green scenario on a commit you did not push proves nothing about the one you did; re-run after pushing.
5. When a scenario fails on a branch you do not own, the failing step and its evidence are the bug report. Hand them to that branch's owner; do not patch around it in the tooling.

## The committed scenarios

- `vault-preflight`: `ori features add` refused while a required secret is missing and granted once seeded, through the intern's own base URL and key, against the stack's intern-api (the fallback listing) and a web source's (effective secrets, intern key confined to its intern).
- `feature-reload`: add, in-place upgrade, the first `ori.md`, a local edit and remove on a running `ori start --watch`, under the container's polling watcher and under inotify, with no restart.
- `catalog-selection`: the provisioner's catalog selection in `ExecStartPre`, from packages to `ori.md` and back across image swaps, `google-workspace` loaded once each time, and a failed install that leaves the workspace byte-identical.
- `dashboard-api`: frontend-api's features, vault and operations endpoints for a slot's intern, as its seeded owner.
- `provisioned-env`: `ORI_INTERN_ID` in a provisioned agent's env, the unit's pre-start inside its budget, and `/api/operations` through the branch's tunnel edge and not the stack's.

## Adding a scenario

A scenario is a file in `services/cfw-secret-vault/scripts/local-intern-e2e/scenarios/` exporting a `Scenario` (`needs`, `summary`, `run`) and an entry in `SCENARIOS` in `index.ts`. Build it from `upSlot`, `runStep`, and the helpers in `slot-driver.ts` (exec in the agent, the daemon through the edge, frontend-api as the owner, vault seeding). Every step returns ok or a reason and notes its evidence. A step that asserts a change also needs a control that fails without it: `provisioned-env` renders the stack checkout's startup script beside the branch's, and runs `/api/operations` through both edges.

## What a slot cannot prove

- Anything about GCP: the VM, its metadata, IAP, Cloud Logging. The provisioned slot runs the agent unit's pre-start and start, not the timers, cloudflared, the `/var/lib/interns` remount or the image pull. Use the VM loop in `services/cfw-intern-provisioner/RUNBOOK.md` for those.
- Cloudflare's own routing: the zone router reads intern-api's `routes` from `wrangler.toml` and applies them the way Cloudflare does, but it is a stand-in.
- Slack: slot interns carry the local placeholder token.
