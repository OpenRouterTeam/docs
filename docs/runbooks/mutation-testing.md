# Mutation testing (StrykerJS)

Mutation testing asks a different question than coverage: it edits the source
(flips a comparison, empties a block, drops a `clearTimeout`) and checks whether
any test notices. A mutant that survives is a line the suite executes but does
not actually pin down.

Run it on the code you are changing:

```bash
# everything changed on this branch vs origin/main
bun run test:mutation --in-place

# specific files
bun run test:mutation --in-place packages/router/plugins/web-search/exa-client.ts
```

`--in-place` is required in this monorepo: without it Stryker mutates a sandbox
copy of the package, which loses the workspace links its tests import, so the
suite dies before the first mutant. It restores the files afterwards, but it is
still editing your working tree — commit or stash first.

Reports land in `reports/mutation/` (git-ignored). Open the HTML report to browse
survivors line by line.

## Flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--base <ref>` | `origin/main` | Diff base when no files are passed. |
| `--scope package` | `file` | Run the whole package suite per mutant instead of only the tests colocated with the mutated file. Slower, but catches tests that live elsewhere. |
| `--concurrency <n>` | `4` | Stryker workers, `1`-`32`. Use roughly the core count. |
| `--all-mutators` | off | Also mutate string and object literals (see below). |
| `--threshold-break <n>` | none | Exit non-zero when the score is below `n` (`0`-`100`). |
| `--incremental` | off | Reuse the previous run's verdicts for mutants nothing has invalidated (see below). Ignored with `--scope package`. |
| `--list-files` | off | Print the source files that would be mutated and exit. Used by CI to price a run before starting it. |
| `--list-skipped` | off | Print the source files the harness refused and exit: a file outside every workspace (Stryker runs per package, so no suite can measure it), config and setup scaffolding with no test of its own, a colocated test outside the paths the package `test` script passes, or nothing that narrows the run to one test file — no colocated test, or a package whose runner ignores the file arguments — and a package suite too big to replay per mutant. CI folds them into the report's not-run list. Use `--scope package --in-place` to mutate one anyway, except for a file outside every workspace or one whose `test` script never reaches its colocated test. |
| `--list-skipped-to <path>` | off | Write that same refused list to `<path>` without exiting, so one invocation can emit both halves of the split. CI pairs it with `--list-files` rather than pricing the changeset twice. |
| `--in-place` | off | Mutate the checkout directly (Stryker restores it afterwards) instead of a sandbox copy, so tests that import workspace-linked dependencies or read repo files outside the target package still resolve them. Only for disposable checkouts — CI uses it; do not use it on a working tree with uncommitted changes. |

## In CI

`.github/workflows/mutation-report.yaml` runs the same command on every pull
request and posts the score plus every survivor as one sticky comment, updated
in place on each push. Only a real report earns the comment: when the run has
nothing to do (no mutable files) or fails, the notice replaces an
existing report comment but never creates one. It is a report, not a gate: no survivor and no score can
fail that job. The only thing that can is the comment renderer
(`.github/scripts/mutation-pr-comment.ts`) failing its own tests, which the job
runs first — so a red X there is about this tooling, not about your PR.

Each run also writes a snapshot of its surviving mutants as a workflow
artifact (`mutation-survivors-pr-<n>`, 30-day retention). The next push's run
diffs against it and opens the report with a delta line — "the commits since
`abc1234` killed 12 of the 109 mutants that survived on the previous report".
This closes the loop on whether a follow-up commit added the assertions the
survivors pointed at. The match is line-agnostic (file, mutator, mutated
fragment), so ordinary edits do not fake kills. A previous survivor counts as
killed only when the current run explicitly caught it, so a mutant that
merely vanished (a runner crash, a rescope) proves nothing. The credit per
mutation is also capped by how much its surviving count shrank, so checks
that already passed on the previous run earn nothing. Only files that
both runs mutated are compared, so a file that leaves the changeset does not
count as progress. A trusted job that never runs PR code fetches the
snapshot. It accepts one only from an earlier run of this same workflow on
the PR's branch, and among the candidates whose commit is a strict ancestor
of the current head it picks the one closest to the head. No usable snapshot
(first push, expired artifact, rerun on the same commit) just means no delta
line.

What it will and will not do:

- It mutates only the source files that the PR changed, minus the files the
  harness refuses because no suite can kill their mutants (`--list-skipped`
  above). A refusal removes a file until its package or its tests change. The
  report lists the files it did not mutate under "Not run". A run with entries
  there is not full coverage of the changeset. To check those files, run
  `bun run test:mutation --scope package --in-place <file>` locally.
- It reuses verdicts across pushes of the same PR. The incremental stores
  (`*.incremental.json` and `*.fingerprint` in the report directory) are kept in
  a per-PR `actions/cache` entry keyed on the PR number and head commit, so a
  later push re-tests only mutants whose source, covering tests, first-hop test
  imports, or run configuration (lockfile, bunfig, package manifests, preloads)
  changed. Another PR cannot feed the cache, and a missing or corrupt entry
  degrades to a full cold run. The first push of a PR, and any run after the
  cache expires, is cold.
- Cost, measured in CI on stryker-rs: packages that the native bun runner
  can drive process 10-15 mutants per second, so a 24-file changeset (about
  1,300 mutants) takes about two minutes of mutation on top of checkout and
  dependency install. Packages whose `test` script the runner cannot narrow
  (a `test:cfw` wrangler suite, `projects/web` DOM tests) re-run the whole
  command for each mutant at 3-4 seconds each, and they dominate the slow
  runs. Files with thousands of mutants against a large suite (for example
  `packages/router/index.ts`) run at about 2 mutants per second and take
  12-30 minutes. The run has no cap on the number of files. `timeout-minutes`
  (25) is the only ceiling. A changeset of hundreds of files, such as a branch
  far behind main, hits the timeout and gets no report.
- Each run also submits its numbers to Datadog for the "Mutation Testing
  Quality" dashboard (`configs/terraform-monitors/monitoring/mutation_testing`).
  The metrics are per package: `openrouter.mutation_testing.score`,
  `mutants_detected`, and `mutants_survived`. Two more measure the feedback
  loop across the whole run: `survivors_killed` counts the previous push's
  survivors that the new commits killed, and `survivors_comparable` counts
  the previous survivors the run could re-check. Every series carries a
  `branch_kind` tag (`agent` for `devin/*` branches, `human` otherwise) and a
  `partial` tag (`true` when the report lists any file under "Not run"). A separate
  trusted job submits them, so a Datadog outage cannot fail the report. Files
  a partial run did not mutate produce no series, so the metrics never claim
  coverage the run did not do. Metrics
  are submitted only on the first attempt of `opened`/`synchronize` runs —
  most are counts, so a re-run or a reopen would double them. A metric-absence
  monitor alerts when no score point has arrived for three days, since every
  stage of the metrics path is otherwise non-blocking.

## What to expect

- **It is slow.** Every mutant re-runs a test command, because our suites run on
  `bun test` and Stryker's `command` runner cannot map individual tests to
  mutants (`coverageAnalysis` must be `off`). Budget roughly a second per mutant
  per worker: a real 8-file PR in `packages/router` produced 1,155 mutants and
  took ~4 minutes at concurrency 8. Keep runs diff-scoped; a whole package is
  fine overnight, the monorepo is not.
- **`--incremental` makes a re-run nearly free.** Stryker stores each mutant's
  verdict in `reports/mutation/<pkg>.incremental.json` and only retests mutants
  on source lines that changed: the same run drops from ~35s to ~2s on a
  348-line file. Because the `command` runner exposes a single synthetic test,
  Stryker cannot tell that a *test* changed, so the harness fingerprints the
  test command and test-file contents and discards the store when they move —
  otherwise an assertion you just wrote would be answered with the stale
  "survived" verdict it was written to overturn. `--scope package` runs test
  files the harness never enumerates, so it cannot be fingerprinted and caching
  is skipped there.
- **The mutation engine itself runs under node, not bun.** Stryker's instrumenter
  reads `@babel/generator`'s CJS default export, which bun's interop leaves
  undefined from @babel/generator 7.29 on, so `bun stryker` dies with
  `generator is not a function` before placing a mutant. The harness invokes the
  binary with `node`; every mutant still re-runs the package's own `bun test`
  command.
- **Scores look low.** ~50-60% on healthy code is normal for this codebase, not a
  crisis. Read individual survivors; ignore the aggregate.
- **`StringLiteral` and `ObjectLiteral` mutants are muted by default.** They
  mostly rewrite `iLog`/`wLog` event names or empty a `z.object({...})` shape —
  36% of survivors in the pilot, almost none worth a test. `--all-mutators`
  brings them back.
- **File scope understates coverage.** With `--scope file`, mutants in a source
  file whose tests live in another file (an integration or sibling test) have no
  test to kill them and always survive. Re-check such files with
  `--scope package` before acting on them.

## Triaging a survivor

For each survivor, decide which it is:

1. **A missing assertion** — the test drives the line but never checks its
   effect. Fix the test.
2. **An equivalent mutant** — the edit cannot change observable behavior (a
   defensive re-check, a log payload, a timeout constant). Ignore it.
3. **Untestable at this level** — needs an integration or E2E test. Note it, do
   not contort the unit test.

Only (1) is a real finding. Do not chase the score.
