---
name: mutation-testing
description: >-
  Challenge the tests you just wrote with StrykerJS mutation testing.
  Use after adding or changing tests for a pure function, parser,
  serializer, or other logic-heavy module, to find assertions the
  suite executes but never checks. Also use it before you open a PR
  that adds or changes tests or logic-heavy modules, so you can
  classify the survivors locally before CI posts its report.
user-invocable: true
---

# Mutation Testing

Coverage proves a line ran. Mutation testing proves a test would
notice if that line were wrong: Stryker edits the source (flips a
comparison, empties a block, drops a `cancel()`) and reports every
mutant no test killed.

Run it on the files you touched, not the repo.

```bash
# every source file changed on this branch vs origin/main
bun run test:mutation --in-place

# specific files
bun run test:mutation --in-place packages/mcp/src/json-rpc.ts

# add --incremental when iterating on the same file: mutants
# nothing invalidated are read from the last run's verdicts
bun run test:mutation --in-place --incremental packages/mcp/src/json-rpc.ts
```

When the worktree changes are unstaged, the default diff scope sees only
committed files and may report no mutable source files; pass the changed paths
explicitly (including newly added files) or stage the intended files first.

`--in-place` is required in this monorepo: without it Stryker mutates a
sandbox copy that loses the workspace links the tests import. It edits
your checkout and restores it afterwards, so commit or stash first.

Reports land in `reports/mutation/` (git-ignored); the HTML report
shows survivors inline. The directory is excluded from ls-lint
(`.ls-lint.yml`), so leaving reports around does not fail
`bun run verify`. The harness runs Stryker with the command runner
and no TypeScript checker, so it works with the repository's
TypeScript 7 package even though that version drops older
`typescript` APIs (e.g. `ts.parseConfigFileTextToJson`); do
not downgrade repository dependencies to "fix" Stryker.
The repository harness may still run a package-wide initial test suite for a
path-scoped target; if unrelated baseline tests fail before Stryker starts,
preserve the exact failure evidence and report that mutation could not start
instead of changing unrelated tests.

The harness builds the command-runner test command without quoting
(`scripts/mutation-test.ts` `buildTestCommand`), so source files under
parenthesized route directories (e.g.
`projects/web/app/(user)/...`) fail the dry run with
`/bin/sh: Syntax error: "(" unexpected`. Workaround: run Stryker
directly (`node_modules/.bun/@stryker-mutator+core@*/node_modules/.bin/stryker run <config>.json`)
with a config mirroring `buildStrykerConfig` and a test command that
filters by bare test-file name (e.g.
`cd projects/web && bun run test::node export-date-windows.test.ts` —
note `bun run test <filter>` appends the filter only to the last
chained script, so target `test::node`/`test::dom` directly).

`--incremental` is safe to leave on while you iterate: the harness
discards the cache whenever the test command or any test file
changes, so a new assertion is always really executed. It is skipped
under `--scope package`.

CI runs the same command on every PR and posts the survivors as a
sticky comment (`.github/workflows/mutation-report.yaml`). The
comment is a report only. A survivor does not fail the build. If a
changeset has more files than the per-run cap, CI does not mutate
all of the files. The comment tells you when that happens. For a
wide PR, run the command locally on the files that you want to
check. A local run before CI lets you classify the survivors while
you know the code.

`projects/web` cannot be narrowed by the harness: its `test` script
runs the whole node and dom suites and ignores the file arguments
`buildTestCommand` passes, and a handful of those tests read files the
Stryker sandbox allowlist excludes, so the dry run fails with "failed
tests in the initial test run". Mutate a web file by pointing Stryker
at the colocated test directly, e.g. a config whose `commandRunner`
command is `cd projects/web && bun test '<relative test path>'` with
the same `mutate` and `ignorePatterns` the harness builds.

`packages/router` has the same file-argument limitation for
`index.ts`: its `bun run test` script still launches the package-wide
suite, so a file-scoped mutation run can fail its initial test run
before producing a score. Treat that as a harness limitation and use a
disposable in-place checkout for a manually narrowed `bun test
index.test.ts` command; do not change production tests to accommodate
the mutation runner. For a small diff inside `index.ts`, a direct
Stryker run with a line-scoped mutate glob
(`"mutate": ["packages/router/index.ts:<start>-<end>"]`) and a
command that targets the colocated test file keeps the run fast and
the survivor list relevant.

`packages/batch` can likewise fail its package-wide initial suite on unrelated
baseline Mistral tests. When mutating a batch parser, run Stryker directly with
an in-place config whose command targets the colocated test file, then classify
survivors from that narrowed report rather than changing unrelated tests.

## When to run it

- After writing or modifying tests for a pure function, parser,
  serializer, estimator, or reducer.
- Before you open or finish a PR that adds or changes tests or
  logic-heavy code.
- Before claiming a module is well tested.

Skip it for DB-backed functions (they need integration tests — see
`db-integration-tests`), React components, and thin glue code.

## Acting on survivors

Classify every survivor, then fix only the first kind:

1. **Missing assertion** — the test drives the line but never checks
   its effect. Add the assertion or the missing case.
2. **Equivalent mutant** — the edit cannot change observable
   behavior (a defensive re-check, a redundant guard, a log
   payload). Leave it. If a guard is provably unreachable, that is a
   finding about the source, not the test.
3. **Wrong level** — only an integration or E2E test can kill it.
   Note it; do not contort the unit test.

Never change production code, weaken a test, or assert a value you
know is wrong to raise the score. The score is triage, not a target.

Full flag reference and cost model: `docs/runbooks/mutation-testing.md`.
