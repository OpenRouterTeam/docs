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

The harness selects tests by the mutated source file's basename; indirect
coverage in another colocated test (for example, `registry.test.ts` covering
`vercel.ts`) is not included automatically. Use a direct Stryker config with
the relevant test command when those assertions need to be measured.
Nested route sources can likewise be refused when their regression test lives
in a parent directory; point a direct in-place config at that parent-level test.

When the worktree changes are unstaged, the default diff scope sees only
committed files and may report no mutable source files; pass the changed paths
explicitly (including newly added files) or stage the intended files first.

`--in-place` is required in this monorepo: without it Stryker mutates a
sandbox copy that loses the workspace links the tests import. It edits
your checkout and restores it afterwards, so commit or stash first.
The restore can drop the executable bit on `.ts` files in the mutated
workspace (mode-only `100755 -> 100644` changes in `git status`), so
`chmod +x` them back before committing.
The harness only accepts mutable sources inside workspace package
directories; for targets under `.agents/skills/`, run Stryker directly
with an in-place config and a command-runner test command.

A hand-written in-place config must keep the harness's `ignorePatterns`
(`'**'` plus the package allowlist) and a `tempDirName` inside the repo:
without the ignore list Stryker rewrites every `.ts` in the checkout (it
prepends `// @ts-nocheck`), and a backup on another filesystem such as
`/tmp` fails to restore with `EXDEV: cross-device link not permitted`.
If that happens, `cp -a <backup>/. <repo>/` puts the files back, but file
modes are lost, so re-run `git status` and `chmod` the scripts it lists.

Reports land in `reports/mutation/` (git-ignored); the HTML report
shows survivors inline. The directory is excluded from ls-lint
(`.ls-lint.yml`), so leaving reports around does not fail
`bun run verify`. The harness runs Stryker with the command runner
and no TypeScript checker, but Stryker's sandbox preprocessor still
does `import('typescript')` and calls the classic API
(`ts.parseConfigFileTextToJson`), which the repository's hoisted
TypeScript 7 package drops. The harness therefore launches Stryker's
node process with `--import scripts/stryker-typescript-alias.mjs`, a
resolve hook that redirects bare `typescript` imports to the root
`typescript-api` alias (classic TypeScript 6); do not downgrade
repository dependencies to "fix" Stryker.
The repository harness may still run a package-wide initial test suite for a
path-scoped target; if unrelated baseline tests fail before Stryker starts,
preserve the exact failure evidence and report that mutation could not start
instead of changing unrelated tests.

The harness builds the command-runner test command without quoting
(`scripts/mutation-test.ts` `buildTestCommand`), so source files under
parenthesized route directories (e.g.
`projects/web/app/(user)/...`) fail the dry run with
`/bin/sh: Syntax error: "(" unexpected`. Workaround: run Stryker
directly, keeping the resolve hook
(`node --import ./scripts/stryker-typescript-alias.mjs node_modules/.bun/@stryker-mutator+core@*/node_modules/.bin/stryker run <config>.json`)
with a config mirroring `buildStrykerConfig` and a test command that
filters by bare test-file name (e.g.
`cd projects/web && bun run test::node export-date-windows.test.ts` —
note `bun run test <filter>` appends the filter only to the last
chained script, so target `test::node`/`test::dom` directly).

The default run mutes `StringLiteral` and `ObjectLiteral` mutants and reports them as "ignored", not as survivors. For a serializer or decoder whose observable output is a string, those mutants are behavioural, so add `--all-mutators` and read that score.

A test-only diff gives the CI mutation job nothing to mutate. Run the harness locally on the source the new tests cover and put the result in the PR.

Service-local Bun tests may require the package's `bunfig.toml` preload
configuration (for example, Cloudflare Worker mocks); run those test
commands from the service directory rather than from the repository root.

`--incremental` is safe to leave on while you iterate: the harness
discards the cache whenever the test command or any test file
changes, so a new assertion is always really executed. It is skipped
under `--scope package`.

CI runs the same command on every PR and posts the survivors as a
sticky comment (`.github/workflows/mutation-report.yaml`). The
comment is a report only. A survivor does not fail the build. CI
mutates every changed file the harness accepts; the comment lists
the refused ones under "Not run". A local run before CI lets you
classify the survivors while you know the code.

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

`packages/provider-monitors` is refused outright by the harness: its `test`
script is a bash wrapper the runner cannot narrow, and the package has more
test files than `MAX_FALLBACK_TEST_FILES`, so file-scoped targets report
`refusing-sources-nothing-could-measure`. Run Stryker directly with an
in-place config whose command runner is
`cd packages/provider-monitors && bun test <colocated test file>` and a
line-scoped mutate glob for the diff.

Check whether a package test script is narrowable before mutation testing: a non-narrowable wrapper prices every source as a whole-suite fallback, so packages over the 100-test-file cap are refused with `no-mutable-source-files-in-scope`; use a direct in-place Stryker config with a narrowed test command.

`packages/batch` can likewise fail its package-wide initial suite on unrelated
baseline Mistral tests. When mutating a batch parser, run Stryker directly with
an in-place config whose command targets the colocated test file, then classify
survivors from that narrowed report rather than changing unrelated tests.

A colocated test that drives the source through a child process (for
example `packages/stt/router.test.ts` spawning `router.harness.ts` with
`execFile`) leaves the in-process coverage probe blind: every mutant in
that source reports `NoCoverage` and the file scores 0% even though the
harness exercises it. Classify those as a file-scope artifact and prove
the behaviour with the harness run itself, do not add in-process tests
to satisfy the mutation runner.

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
   finding about the source, not the test. Recurring shapes: the
   `false` arm of a conditional spread
   `...(x === undefined ? {} : { x })` (spreading `{ x: undefined }`
   is indistinguishable downstream), and an `?? []` fallback whose
   mutant array still takes the same length-guarded branch. The
   `true` arm of the same spread (value silently dropped) IS
   behavioral — assert the propagation. Before classifying, apply the
   mutant by hand and print the result: a `["Stryker was here"]`
   sentinel that the next `.map` projects to `undefined`, or a
   null-guard whose only effect is a `TypeError` swallowed by an
   enclosing `try/catch` returning the same fallback, is equivalent.
   A surviving `status !== 200` arm usually means every non-200
   fixture also fails the shape check — serve a well-formed body on a
   tolerated error status to kill it.
3. **Wrong level** — only an integration or E2E test can kill it.
   Note it; do not contort the unit test.

A survivor on an error branch whose test asserts a message that also
appears as a literal in the source is a missing assertion, not a wrong-level
one: an uncaught crash prints the surrounding source lines, so the literal
matches even when the branch never ran. Assert on the emitted form (the
structured log field or annotation), not the bare message text.

Survivors clustered in a function that spawns a process or reads a
file are not automatically wrong-level. Check whether the decision it
makes (what to compare, when to throw) is separable from the I/O it
performs: taking that I/O as a parameter defaulting to the real
implementation makes the decision unit-killable while leaving only the
spawn wiring at integration level. `scripts/lint-dead-code.ts` is the
worked example.

A survivor on a line inside a callback the unit test injects into a
mocked collaborator is a missing assertion, not wrong level: have the
mock capture the callback and call it from the test, then assert what
it passes downstream. Route tests that mock a query orchestrator are
the common case (PR #39232).

Never change production code, weaken a test, or assert a value you
know is wrong to raise the score. The score is triage, not a target.

Full flag reference and cost model: `docs/runbooks/mutation-testing.md`.
