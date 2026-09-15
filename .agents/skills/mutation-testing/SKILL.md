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

# Mutation testing

Coverage proves that a line ran. Mutation testing proves that a test notices when that line is wrong: Stryker edits the source (flips a comparison, empties a block, drops a `cancel()`) and reports every mutant that no test killed.

## Run it once

Run the harness once per session on the source files you changed, named explicitly:

```bash
bun run test:mutation --in-place --max-minutes 5 <changed-source-file>...
```

The run is a report, not a gate. If it hits the cap, refuses a file, finds no mutable sources, fails on tests you did not touch, or errors, record `not measured` (or `partial` with the packages it named) and stop. Do not rerun, narrow and retry, raise `--max-minutes`, wrap the command in `timeout`, use `--scope package` or `--incremental`, invoke Stryker directly, or read the harness source.

Triage the first three survivors in one batch of assertion edits, verify the batch with the package's own test script run from its directory (the same non-mutation command the harness printed), list the remaining survivors by file and line, and stop.

Stop immediately when the user asks to finish or messages while a run is in flight: kill the run or let it hit its cap, run `git status --porcelain`, and restore any source change you did not make.

Skip the run when the diff touches only tooling (`scripts/`, lint rules and their fixtures, CI and config files), touches no source file, or no changed source file has a colocated test. Record `not measured`.

## Harness behavior

The harness selects tests by the mutated source file's basename. Indirect coverage in another colocated test (for example, `registry.test.ts` covering `vercel.ts`) is not included, and a sibling variant of the same basename (`foo.route.test.ts` next to `foo.ts`) is not selected either, so its assertions score as survivors. Name the test `foo.test.ts` instead. The same blind spot applies to scoped test selection: when a change alters a module's output shape, find every test in the package that imports the module and run the whole package's tests, not only the source file's directory.

`--in-place` is required in this monorepo. Without it, Stryker mutates a sandbox copy that loses the workspace links the tests import. The flag edits your checkout and restores it afterwards, so commit or stash first. The restore can drop the executable bit on `.ts` files in the mutated workspace (mode-only `100755 -> 100644` changes in `git status`), so run `chmod +x` on them before committing. A dev server watching the same worktree hot-reloads every mutant, so do not capture browser or dev-log evidence while a run is in progress.

The harness accepts mutable sources only inside workspace package directories. Anything else is `not measured`.

Reports land in `reports/mutation/` (git-ignored), and the HTML report shows survivors inline. The directory is excluded from ls-lint (`.ls-lint.yml`).

The harness runs Stryker with the command runner and no TypeScript checker, but Stryker's sandbox preprocessor still calls `import('typescript')` and the classic API (`ts.parseConfigFileTextToJson`), which the repository's hoisted TypeScript 7 package drops. The harness therefore launches Stryker's Node process with `--import scripts/stryker-typescript-alias.mjs`, a resolve hook that redirects bare `typescript` imports to the root `typescript-api` alias (classic TypeScript 6). Do not downgrade repository dependencies to fix Stryker.

The harness might run a package-wide initial test suite for a path-scoped target. If unrelated baseline tests fail before Stryker starts, keep the exact failure output and report that mutation could not start instead of changing unrelated tests.

The default run mutes `StringLiteral` and `ObjectLiteral` mutants and reports them as ignored, not as survivors. For a serializer or decoder whose observable output is a string, those mutants are behavioral, so add `--all-mutators` and read that score.

A test-only diff gives the CI mutation job nothing to mutate. Name the source that the new tests cover in your one local run and put the result in the PR.

The harness runs tests through `bun run`, which puts `node_modules/.bin` first on `PATH`, so tests execute under the `bun` package that the root `package.json` pins rather than the global Bun. A fixture whose verdict depends on runtime parsing behavior can pass under bare `bun test` and fail the dry run. Reproduce with `node_modules/.bin/bun test <file>` and use input that both versions treat the same.

Service-local Bun tests can require the package's `bunfig.toml` preload configuration (for example, Cloudflare Worker mocks). Run those test commands from the service directory rather than from the repository root.

The default engine downloads a `stryker-rs` binary from GitHub on first use (`stryker-rs:downloading-binary`). In a sandbox without GitHub egress, the target fails with `exit_code: null` before any mutant runs. Pass `--legacy-stryker` to run the StrykerJS engine already in `node_modules`.

## CI report

CI runs the same command on every PR and posts the survivors as a sticky comment (`.github/workflows/mutation-report.yaml`). The comment is a report only, and a survivor does not fail the build. CI mutates every changed file the harness accepts and lists the refused ones under "Not run". A local run before CI lets you classify the survivors while you know the code.

The comment counts survivors for the whole changed file, so a small addition to a large existing module inherits its pre-existing survivors. Triage by line: download the run's `mutation-report` artifact (`gh run download <run-id> -n mutation-report`), filter the `reports/mutation/<package>.json` mutants to the line ranges your diff added, classify only those, and state the split in the PR. The comment's "missed" count sums `Survived` and `NoCoverage`, so a file whose colocated test exercises only part of it reads as a large regression. Read the statuses from the artifact JSON before triaging, because an unreached line and an unasserted one need different answers.

On a PR whose base is another PR's branch (a stack), CI checks out `refs/pull/<n>/merge`, which GitHub builds on the lower PR's own merge ref, so the harness's diff against the merge base also contains every `main` commit since the bottom of the stack last synced with `main`. The job then fails on packages the PR never touched. Syncing the bottom PR with `main` clears the drift until `main` moves again. Otherwise expect "failed to produce a report" on stacked layers and rely on your one local run for the score in the PR body.

The harness narrows a file-scoped run through the package's `test:mutation` script when the manifest defines one, and otherwise through a `test` script that accepts file arguments. A package whose `test` script is a non-narrowable wrapper (for example, `packages/provider-monitors`) falls back to the whole suite, and when that suite has more than 100 test files the harness refuses the target with `refusing-sources-nothing-could-measure` or `no-mutable-source-files-in-scope`. A refused target, or one whose initial run fails on unrelated baseline tests, is `not measured`. Do not change production tests to accommodate the runner.

The harness runs every selected colocated test file in one `bun test` process, so a test that installs `mock.module()` over a sibling module leaks that mock into the sibling's own test file and the dry run fails with "failed tests in the initial test run". Bun keeps that override live for the rest of the process, and re-mocking the real exports in `afterAll` is a no-op. A test that needs a dependency real in a later file must use a prop, an injected seam, or the shared process-wide stub instead of `mock.module()`. If the leaking test is not one you touched, treat the CI report as a harness artifact and record `not measured`.

A run with a few hundred survivors can pass every mutant and still end with `mutation-test:target-failed` (`exit_code: 101`) and a "failed to produce a report" comment: `stryker-rs` panics with `failed printing to stdout: Resource temporarily unavailable (os error 11)` while listing survivors on CI's inherited stdout pipe, after the report is already written. Read the score from the job log's final `tested N/N` line.

A colocated test that drives the source through a child process (for example, a test that spawns a harness script with `execFile`) leaves the in-process coverage probe blind: every mutant in that source reports `NoCoverage` and the file scores 0% even though the harness exercises it. Classify those as a file-scope artifact and prove the behavior with the harness run itself. Do not add in-process tests to satisfy the mutation runner.

## When to run it

Run it once, before you finish a PR that adds or changes tests or logic-heavy code. Survivors in DB-backed functions need integration tests (see `db-integration-tests`); note them and move on.

## Acting on survivors

Classify the first three survivors, then fix only the first kind:

1. **Missing assertion**: the test drives the line but never checks its effect. Add the assertion or the missing case.
2. **Equivalent mutant**: the edit cannot change observable behavior (a defensive re-check, a redundant guard, a log payload). Leave it. If a guard is provably unreachable, that is a finding about the source, not the test.
3. **Wrong level**: only an integration or end-to-end test can kill it. Note it and do not contort the unit test.
4. **Harness false positive**: the engine can report `Survived` for a whole-condition `ConditionalExpression` mutant (`if (a || b)` to `if (false)`) that an existing assertion kills. When the covering test already looks decisive, apply the mutant by hand and run the colocated test file with the harness command. If it fails, record the survivor as a harness false positive in the PR instead of adding a duplicate test.

Recurring equivalent shapes: the `false` arm of a conditional spread `...(x === undefined ? {} : { x })` (spreading `{ x: undefined }` is indistinguishable downstream), and an `?? []` fallback whose mutant array still takes the same length-guarded branch. The `true` arm of the same spread (value silently dropped) is behavioral, so assert the propagation. Before classifying, apply the mutant by hand and print the result: a `["Stryker was here"]` sentinel that the next `.map` projects to `undefined`, or a null guard whose only effect is a `TypeError` swallowed by an enclosing `try/catch` that returns the same fallback, is equivalent. A surviving `status !== 200` arm usually means every non-200 fixture also fails the shape check; serve a well-formed body on a tolerated error status to kill it.

A survivor on an error branch whose test asserts a message that also appears as a literal in the source is a missing assertion, not a wrong-level one: an uncaught crash prints the surrounding source lines, so the literal matches even when the branch never ran. Assert on the emitted form (the structured log field or annotation), not the bare message text.

Survivors clustered in a function that spawns a process or reads a file are not automatically wrong level. Check whether the decision it makes (what to compare, when to throw) is separable from the I/O it performs: taking that I/O as a parameter that defaults to the real implementation makes the decision unit-killable while leaving only the spawn wiring at the integration level.

A survivor on a line inside a callback that the unit test injects into a mocked collaborator is a missing assertion, not wrong level: have the mock capture the callback and call it from the test, then assert what it passes downstream. Route tests that mock a query orchestrator are the common case.

A surviving condition that gates a rendered element whose DOM test asserts absence with `expect(screen.queryBy*(...)).toBeNull()` is a missing assertion, not an equivalent mutant: Bun's `toBeNull()` and `toBe(null)` pass against a React-attached element inside a large tree, so that assertion cannot fail. Assert absence with `expect(screen.queryAllBy*(...)).toHaveLength(0)` instead.

A surviving default or fallback that feeds a list is likewise a missing assertion when the test checks the list with `toEqual`: Bun's `toEqual` treats `[undefined]` as equal to `[]`, so a mutant that pushes an `undefined` element passes. Assert lists with `toStrictEqual`.

A surviving optional chain or nullish fallback (`a?.b ?? d`) on a recovery path is a missing assertion, not an equivalent mutant, when no test reaches it with the left operand actually `undefined`: the suite only exercised the happy operand, so the mutant's `TypeError` never fires. Add the case where the operand is absent (for a cache fallback, the cold or empty state) and assert the recovered value.

Never change production code, weaken a test, or assert a value you know is wrong to raise the score. The score is triage, not a target.

For the full flag reference and cost model, see `docs/runbooks/mutation-testing.md`. The runbook documents every flag for human and CI use; the limits in this skill override its suggestions to add `--incremental`, use `--scope package`, or raise the cap.
