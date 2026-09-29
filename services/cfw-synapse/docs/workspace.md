# Review workspace — Cloudflare Containers

**Status: CORE.** The workspace is the primary read surface for live
review rounds: every live round primes a checkout of the PR head and the
agent toolset runs on it (`src/uses/review/toolset.ts`). A failed prime
degrades that round to the API fallback read tools — it never fails the
run. Fixture (smoke/eval) rounds never prime, staying hermetic.

## What it provides

Review agents get `run_command`: a read-only command pipeline over a real
checkout of the PR head on real container disk. It allows `awk`, `cat`,
`diff`, `find`, `grep`, `head`, `ls`, `pwd`, `sed`, `sort`, `tail`,
`uniq`, and `wc`, with plain `|` pipelines. Command chaining, redirection,
command substitution, and mutating or in-place flags plus sed/awk script
write or exec primitives are rejected. The API alternative explored the
repo one `read_file` / `search_repo` call at a time (rate-limited, one
file per guess); the checkout lets an agent `grep -rn` across the whole
tree, `find` call sites, and slice context with `sed` — plus real
`git log`/`blame`-grade history over the depth-50 fetch window
(`file_history`).

## Why Containers (vs the previous in-isolate VFS)

The previous implementation (`@cloudflare/computer`) ran the checkout in
a Dynamic Worker over a SQLite-backed VFS with isomorphic-git in-process.
It could not carry this workload: isomorphic-git buffers the whole
received pack in memory (`collect()` + pack indexing), and openrouter-web's
depth-50 pack (~345 MiB) exceeds the documented 128 MB Worker isolate
budget. It also lacked protocol `filter` support, so no blobless-clone
mitigation existed. A container moves git to native code streaming to
disk — the pack size becomes a disk cost (20 GB available), not a memory
ceiling — and gives the agent real `git`.

## Architecture

```
agent_review message (run.ts)
  → REVIEW_WORKSPACE Container DO, name = roundKey   one workspace per round
      primeRepo: fetch --depth 50 origin <head-sha>,
        checkout --detach, rev-parse HEAD == ref (ready gate),
        canonical tree mode-locked root-owned read-only
        (single-flight; all agents share one clone;
         auth added by the egress handler, never the sandbox)
  → run_command tool → stub.execShell → containerFetch /exec
      → exec server drops to the unprivileged `agent` user
finalize (dispatch.ts)
  → workspace.destroy()                              container stopped
```

Files:

| File | Role |
| --- | --- |
| `src/connections/workspace/review-container.ts` | The round container DO: prime/exec/history/reclaim |
| `src/connections/workspace/container-test-jobs.ts` | `TestContainer`: one disposable instance per test job (registry egress stays out of the review container) |
| `src/connections/workspace/contract.ts` | Structural types (breaks the env↔DO type cycle) |
| `src/connections/workspace/container-prime.ts` | The prime command sequence as pure data (unit-tested) |
| `src/connections/workspace/egress-policy.ts` | The egress decision core: assigned repo + read-only git transport only (unit-tested) |
| `src/connections/workspace/git-log-parser.ts` | `git log` output parser for `file_history` (unit-tested) |
| `src/tools/workspace-tools.ts` | The `run_command` + `file_history` agent tools |
| `src/connections/workspace/capabilities.ts` | Prime + shell probe; degrade to the API fallback set |
| `src/uses/review/toolset.ts` | The one-set toolset policy (workspace vs API fallback) |
| `src/creds.ts` `forwardGithubGit` | Clone-credential confinement: auth attached OUTSIDE the sandbox |
| `containers/synapse-workspace/` | Image: node-slim + git; exec server + CA-trusting entrypoint |
| `src/server/dispatch.ts` `destroyRoundWorkspace` | Post-finalize container reclaim |

## Credential confinement (the load-bearing boundary)

PR-derived content shares the sandbox with nothing trusted, so the
container authenticates nothing:

- The sandbox's git requests leave **without credentials**. The platform
  egress interceptor (`enableInternet = false`, `interceptHttps = true`,
  exported `ContainerProxy`) routes them to the instance outbound handler,
  which runs in the Workers runtime — outside the container.
- The handler allows only the read-only git transport
  (`info/refs?service=git-upload-pack` GET, `git-upload-pack` POST) of the
  **assigned repo** for the round. Push (`git-receive-pack`) and the REST
  API are denied; publication is coordinator-side.
- `creds.ts` `forwardGithubGit` mints the installation token and attaches
  it to the forwarded request. No token is in the image, the environment,
  or any command line; a PR-planted process cannot steal what is not there.
- Test jobs run in their own disposable container instance
  (`TestContainer`) whose whole-container registry allowlist
  (github.com + npmjs) can never apply to the review container.

## Invariants preserved

- Agents still cannot write to GitHub: the workspace is scratch space;
  `submit_findings` remains the only output channel; the sandbox cannot
  push even if it tries (proxy denies `git-receive-pack`).
- No workspace failure fails a review round. The toolset is ONE set per
  round (`uses/review/toolset.ts`): a prime failure (clone error, start
  timeout) or a failed shell probe ships the API fallback read set for
  that round; a failure that only surfaces mid-run returns a non-zero
  tool result telling the agent to narrow the command. Either way the
  round completes.
- Reclaim: the SDK owns `alarm()` (overriding it breaks container
  lifecycle), so the TTL backstop is `schedule(TTL, 'reclaim')` armed
  after a verified prime; `destroy()` also runs after finalize.
- Container disk is ephemeral by design. Reviews keep no state on it;
  a future dev-work use must checkpoint acknowledged edits to durable
  storage (git/R2 + Postgres metadata) before any stop — restore after
  container loss is a required test for that use, not an assumption.

## Known limitations / watchpoints

- **First-prime latency**: cold container start + clone. Watch
  `workspace.primed` ms; `sleepAfter` keeps warm instances for follow-up
  rounds.
- **Immutable boundary is ownership, not modes alone**: the canonical
  tree is root-owned with write bits off and commands drop to the
  unprivileged user. Verified in the prime smoke (agent `touch` denied).
  Anything running as root inside the container is controller-only.
- **Read-only command policy**: `run_command` exposes selected
  utilities only and rejects write/exec primitives in `sed`/`awk`.
- **Test jobs** (TestContainer) are wired but the review toolset does not
  call them yet — enabling test-running is a toolset-policy decision with
  its own budget (container seconds) and eval cases.

## Observing a round (dev)

1. `wrangler dev` (Docker required for containers) and trigger a live-ish
   round (fixture rounds skip the workspace by design).
2. Watch `workspace.primed` ms, `workspace.ready`, and the container
   reclaim after finalize. `workspace.prime_rejected` means that round
   ran on the API fallback toolset.
