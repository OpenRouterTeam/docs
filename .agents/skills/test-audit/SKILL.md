---
name: test-audit
description: Audit unit, e2e, and RTL test files for drift, logic errors, slow tests, coverage gaps, and code quality. Use when asked to audit tests, check test health, or run the weekly test report.
user-invocable: true
---

# Test Audit

Scan the `openrouter-web` test suites (unit, e2e, RTL) for quality issues
and surface a prioritised report. Designed to run weekly as a scheduled
Devin session, but can be invoked on-demand.

## Scope

Target repo is the `openrouter-web` clone you point the audit at. Pass
`--repo <path>` to every script (or set `AUDIT_REPO=<path>` in the
environment); there is no implicit default, since scheduled sessions
may have the clone in a non-standard location. The scripts
auto-discover test files matching:

```text
**/*.test.ts        unit tests (vitest / bun:test)
**/*.test.tsx       React Testing Library (RTL) component tests
**/*.spec.ts        spec-style tests
**/*.spec.tsx       spec-style React tests
tests/e2e/**/*.test.ts(x)   e2e tests (helpers/fixtures excluded)
```

Exclusions: `node_modules`, `.next`, `dist`, `coverage`, `.venv`,
`*.d.ts`, generated files.

## Audit Categories

The orchestrator (`scripts/run-audit.ts`) runs each category and prints
a single Markdown report. Individual checks can also be invoked
directly.

### 1. Coverage gaps (< 95 %)

The orchestrator runs `bun scripts/ci/run-unit-tests.ts`, the same runner that CI uses for unit tests, from the repository root with `COVERAGE_ENABLED=true`. It then merges each workspace's lcov files (from `bun:test`) and `coverage/coverage-summary.json` file (from Vitest) into one summary for `coverage-gaps.ts`. When `JUNIT_SUFFIX` is set, `configs/bun-test/bun-test.sh` keeps a `coverage/lcov<suffix>.info` copy of each run, so a package that runs `bun test` more than once keeps every report. When several lcov reports cover the same source file, the audit counts a line as covered if any report executed it. The audit also drops `AFFECTED_PATHS_FILE`, so the runner tests every workspace. The script flags files whose lines, functions, statements, or branches coverage is below 95%, for each metric that the report records.

Bun's lcov report has no statement records and usually no branch records. The audit skips a metric that has no records instead of treating it as fully covered, so lcov files report only lines, functions, and branches that Bun recorded.

A test script that sets `COVERAGE_ENABLED=false` writes no coverage. The `test::node` and `test::dom` scripts in `projects/web` and `projects/mission-control`, and `test::activity-env` in `packages/temporal`, do this, so their files are missing from the report. A `test` script that calls `bun test` directly, as in `packages/decisions-interfaces`, `packages/bench-harness`, `services/switchyard`, `services/cfw-switchyard`, and `services/gcp-gateway-bench-runner`, skips `configs/bun-test/bun-test.sh` and also writes no coverage. Bun writes function and branch counts without per-function or per-branch records, so the combined function or branch coverage of a file that several reports cover is unknown. The audit leaves those metrics out for that file and checks only its line coverage, which it combines line by line.

If some unit tests fail, the audit still uses the coverage that the runner wrote and records the failure in the run log. The audit exits with a non-zero status only when no workspace writes a coverage report.

```bash
# Manual single-package invocation (e.g. for ad-hoc investigation)
cd ~/repos/openrouter-web/packages/router
COVERAGE_ENABLED=true bun run test

cd ~/repos/openrouter-web/.agents/skills/test-audit/scripts
node --import tsx ./coverage-gaps.ts \
  --repo ~/repos/openrouter-web \
  --input ~/repos/openrouter-web/packages/router/coverage/coverage-summary.json \
  --threshold 95
```

The script accepts either an absolute path via `--input` or — when
called without `--input` — falls back to looking under
`coverage/coverage-summary.json` in the target repo. It also accepts
the human-readable text-summary table.

**Confidence:** High. Coverage is deterministic. Bun reports only files that a test loads. A source file that no test imports is missing from the report, so the audit can't flag it. A workspace whose tests fail to load contributes no coverage. To find those workspaces, check the unit runner's failures in the run log.

### 2. Test drift / logic errors

Static heuristics over test sources (no runtime needed). Flags:

- `.skip` / `.todo` / `.only` / `xit(` / `xdescribe(` / `fdescribe(`
- Tests with **zero `expect()`** assertions. Tests that delegate to an
  asserting helper are not flagged — the helper may live in the same
  file or be named-imported from a relative, `@/`-aliased, or
  `@openrouter-monorepo/*` workspace module (e.g.
  `tests/manual/api/video/*.test.ts` awaiting `submitPollAndDownload`
  from `./helpers`, which wraps the submit/poll/download `expect`s).
  Import resolution is recursive for relative/aliased modules, so a
  helper that only delegates to another module's asserting helper
  (e.g. `testPromptCaching` → `testCompletions`) also counts;
  workspace-package imports resolve one hop deep only (recursing into
  the cyclic workspace graph made the check take minutes instead of
  seconds). Assertion helpers passed as function references
  (`results.forEach(assertErr)`) count as assertions. Helper bodies
  are parsed with full block-boundary tracking, so nested arrow
  declarations, `it.each` object tables, and regex literals containing
  braces don't truncate spans or corrupt block parsing (each of these
  previously produced false `appears empty` findings — regression
  fixtures live in `scripts/test-drift.test.ts`).
  Remaining `appears empty` findings are dominated by
  `writeJsonToFile`-style snapshot-dump manual tests, which genuinely
  contain no assertions — that is a human judgment call, not a
  detector bug. Compile-time probes whose only check is a
  `@ts-expect-error` line (e.g. `rejects a raw string id`) are also
  flagged; leave them alone.
- `node:assert` helpers (`assert.equal`, `assert.strictEqual`,
  `assert.ok`) — only convert to `expect()` when the call does not
  narrow a value used afterwards (`asserts` signatures narrow
  discriminants); otherwise typecheck breaks.
- `expect(...)` calls with no matcher (e.g. dangling `expect(value);`)
- Commented-out assertion blocks (`// expect(...`)
- Test names that no longer match what the body does (mismatched
  snake/kebab keywords vs. the function under test) — heuristic, low
  confidence, surfaced as suggestions only
- Tests using deprecated `assert.equal` instead of `expect`

```bash
node --import tsx ./test-drift.ts --repo ../../../..
```

**Confidence:** High for skip/only/no-assertion; Heuristic for name
drift.

### 3. Inline snapshot opportunities

Find `toMatchSnapshot()` calls whose stored snapshot is small enough
(< 2 KB and < 8 lines) to be converted to `toMatchInlineSnapshot()`,
which keeps assertions colocated with the test.

```bash
node --import tsx ./inline-snapshots.ts --repo ../../../..
```

Reads `__snapshots__/*.snap` files and reports the call sites that
should be migrated.

**Confidence:** Low value, not high noise. These are surfaced for
context but are **not** in the safe-auto-fix tier (see Section 4
Phase B). Convert opportunistically when the cleanup PR already
touches the same file for a higher-value reason.

### 4. Slow tests

Run vitest with the JSON reporter and flag tests above the slow
threshold (default 500 ms for unit, 30 s for e2e).

```bash
cd ~/repos/openrouter-web
bunx vitest run --reporter=json --outputFile=/tmp/vitest-results.json

cd .agents/skills/test-audit/scripts
node --import tsx ./slow-tests.ts \
  --repo ~/repos/openrouter-web \
  --input /tmp/vitest-results.json \
  --threshold-ms 500 \
  --threshold-ms-e2e 30000
```

The orchestrator passes both `--threshold-ms` (unit) and
`--threshold-ms-e2e` (e2e) automatically; `slow-tests.ts` matches
e2e tests by file path (`tests/e2e/`) and applies the larger
threshold.

**Confidence:** High — durations are measured.

### 5. Spelling

Run [`codespell`](https://github.com/codespell-project/codespell)
restricted to test files. The wrapper resolves codespell in this order
so scheduled runs are deterministic without requiring a pre-baked
runner image:

1. `uvx --from codespell==<pinned> codespell` — `uv` is preinstalled on
   the Devin runner, and `uvx` lazily fetches the pinned version into a
   per-invocation cache (no global `pip install` required).
2. Whatever `codespell` is on `PATH` — for local invocations on
   developer machines that already have it.
3. A built-in tiny dictionary (only ~30 common English typos) — last
   resort so the audit never silently no-ops.

The pinned version lives next to the script (`CODESPELL_VERSION` in
`scripts/spelling.ts`); bump it when you want to roll forward. The
wrapper does **not** read `.codespellrc` / ignore-words files; project
false positives are allowlisted inline in `CODESPELL_IGNORE` in that
same file.

```bash
node --import tsx ./spelling.ts --repo ../../../..
```

**Confidence:** Medium — codespell has known false positives on
identifier-heavy test code.

### 6. Cognitive load

Heuristics for tests that are hard to read:

- `describe`/`it` block longer than **80 lines** of body
- `describe` nesting depth > **3**
- Single test with > **10 `expect()`** calls (split into multiple
  tests or use `expect.objectContaining`)
- `beforeEach` / `beforeAll` longer than **40 lines**
- Conditional branching inside test bodies (`if`, `switch`, ternaries
  guarding `expect`) — see knowledge note "Write maintainable, simple
  E2E tests"

```bash
node --import tsx ./cognitive-load.ts --repo ../../../..
```

Block boundaries come from the same shared parser (`findBlockEnd` in
`lib.ts`) as the empty-test check, so parser regressions silently drop
blocks from every heuristic here; `cognitive-load.test.ts` pins the
parser cases through this script's own output.

Note: the `scripts/*.test.ts` files are NOT run by repo CI — the unit
job only discovers workspace packages, and this skill directory is not
a workspace. Run `bun test` from `scripts/` after touching `lib.ts` or
either consumer.

**Confidence:** Medium — long tests are sometimes intentional.

## Execution Procedure

### 1. Setup

```bash
# 1. Clone / update the repo
test -d ~/repos/openrouter-web || \
  git clone https://github.com/OpenRouterTeam/openrouter-web ~/repos/openrouter-web
cd ~/repos/openrouter-web && git fetch origin && git checkout main && git pull

# 2. Install workspace deps (provides tsx; no extra install needed for the
#    audit scripts — they live inside this repo and use the workspace tsx).
bun install --frozen-lockfile
```

### 2. Run the orchestrator

Reports are **never** committed to the repo. Write them to a tmp path
or `/dev/stdout` so they live in the session, not in git history.

```bash
cd ~/repos/openrouter-web/.agents/skills/test-audit/scripts
node --import tsx ./run-audit.ts \
  --repo ../../../.. \
  --threshold 95 \
  --output /tmp/test-audit-$(date -u +%F).md
```

Flags:

| Flag | Default | Purpose |
|---|---|---|
| `--repo <path>` | _required_ (or `AUDIT_REPO` env var) | Target repo to audit |
| `--threshold <pct>` | `95` | Coverage failure threshold |
| `--slow-unit-ms <n>` | `500` | Unit-test slow threshold |
| `--slow-e2e-ms <n>` | `30000` | E2E slow threshold |
| `--skip-coverage` | `false` | Skip the unit-test coverage run, which is slow |
| `--skip <name,name>` | `""` | Skip named categories |
| `--top <n>` | `5` | Cap each `(severity, category)` bucket to the top N findings. Set `0` to disable the cap. |
| `--output <file>` | stdout | Write Markdown report to file |
| `--format <md\|json>` | `md` | Report format |

The `--top` cap exists so the **weekly cleanup PR stays small**: each
run surfaces at most 5 instances per category per severity (≤ 90
findings total across 6 categories × 3 severities). Untruncated runs
produce 1500+ findings on `openrouter-web`, which is too large for one
PR to review.

Gotcha: when running an individual checker script directly, its
Markdown output is hard-capped at 30 findings per `(severity, category)`
bucket by `formatFindings` in `scripts/lib.ts`, regardless of `--top`.
To verify whether a specific file/finding exists, use `--format json`
and filter — an absence in the Markdown output is not evidence.

### 3. Report

The Markdown report is structured:

```text
# Test Audit — <date>
Scope: <repo> @ <commit>
Cap: top 5 per category

## Summary (kept / total)
- High:   5 / 273
- Medium: 25 / 567
- Low:    20 / 922

## Truncated buckets
- high · coverage: showing 5 of 273 — re-run with `--top 0` to see the rest
- medium · cognitive-load: showing 5 of 205 — re-run with `--top 0` to see the rest
...

## High Severity
### coverage
- packages/foo/bar.ts — Lines 84.2 % (-10.8)

## Medium Severity
...

## Low Severity / Suggestions
...
```

### 4. Weekly scheduled run — two-phase flow

The scheduled run is **report-first, cleanup-on-approval**. We learned
from the 2026-05-04 run that opening a cleanup PR for every category
unconditionally produces noise (e.g. inline-snapshot conversions on
tests Jakob is actively rewriting), and that the audit is most useful
when a human picks which findings are worth fixing this week.

#### Phase A — Audit and DM (always runs)

1. **Run the audit with `--top 5`.** Cap each `(severity, category)`
   bucket at 5 findings. Write the report to a tmp path
   (e.g. `/tmp/test-audit-<YYYY-MM-DD>.md`); do **not** commit it.
2. **Send the report as a Slack DM** to the recipient configured in the
   schedule prompt. Include:
   - Summary table (kept / total per severity).
   - Top 5 actionable findings — those a small PR could fix.
   - Any audit-tooling failures (e.g. `Coverage gaps: vitest run failed`).
   - The week's carry-over count (compared to the previous report,
     pulled from the prior session's stored summary).
3. **Stop here unless the human (or follow-up `/devin` command) approves
   a cleanup PR.** The DM is the deliverable for Phase A.

#### Phase B — Cleanup PR (only when explicitly approved)

When the human asks for a cleanup PR (or the schedule prompt says
"open a PR if any High-severity Test drift findings exist", etc.):

1. **Fix only narrowly-scoped, mechanically-safe categories.** In
   priority order:
   - **Test drift** — `.only` removal, dangling/commented `expect()`
     deletion, `assert.equal` → `expect(...).toBe(...)`. For `.skip`,
     prefer leaving alone unless the human asked for cleanup; never
     silently delete a skipped test.
   - **Spelling** — codespell-style fixes one word at a time, only
     when the word is unambiguously wrong and the fix touches comments
     or strings (never identifiers).
2. **Inline snapshots are NOT in the safe-auto-fix tier.** They have a
   poor cost/value ratio on their own — converting a tiny
   `toMatchSnapshot()` to `toMatchInlineSnapshot()` is rarely worth a
   dedicated PR review cycle. Only include inline-snapshot conversions
   if the same PR is already touching that file for a higher-value
   reason (e.g. a Test drift fix in the same test). Surface the
   findings in the report regardless so the human can act on them
   alongside other work.
3. **Never auto-fix** coverage gaps, slow tests, or cognitive-load
   findings — those need design judgement. They live in the report
   only.
4. **Self-validate.** After the cleanup commits:
   - Run the affected package's test suite (`bun run --filter <pkg> test`).
   - Re-run `run-audit.ts --top 5` and confirm the fixed bucket(s)
     shrank by at least the number of items the PR claims to address.
5. **Open the PR as a draft** titled
   `chore(tests): test-audit cleanup — <YYYY-MM-DD>`. Body includes:
   - Summary table (kept / total per severity).
   - Per-category list of items addressed and items deferred.
   - Re-run output proving the buckets shrank.
   - **Do not** include the audit report file as a committed artefact;
     paste the relevant excerpt into the PR description instead.
6. If the cleanup PR fails CI or the re-audit numbers do not move,
   the schedule should `notify_on="failure"` so a human can take over.

### 5. Manual runs

Print the report to the terminal. Use `--top 0` to surface every
finding when you want to triage exhaustively, otherwise leave the
default cap. Offer to open a draft PR fixing any **single-line,
low-risk** findings (e.g. removing a stray `.only`, converting a
small `toMatchSnapshot` to inline). Anything larger requires explicit
user confirmation.

## Allow-lists

- **Coverage:** seed/migration/types/generated files (`*.generated.*`,
  `**/seeds/**`, `**/migrations/**`, `**/__generated__/**`) are
  excluded from the < 95 % check.
- **Snapshots:** files larger than 2 KB stay external.
- **Spelling:** the wrapper does not honour `.codespellrc` or
  `codespell-ignore-words.txt`; persistent false positives live in
  `CODESPELL_IGNORE` in `scripts/spelling.ts` — this includes valid
  variant spellings the repo has standardized on (e.g. `unparseable`,
  which codespell would "correct" to `unparsable` against the
  repo-wide convention); do not rename such words in code to satisfy
  codespell.
- **Slow tests:** any test under `tests/manual/` is exempt (these are
  documented as expensive).

## Exit Codes

`run-audit.ts` exits non-zero only on **infrastructure** failures
(missing repo, vitest crash, etc.). Audit findings themselves never
fail the run — the report is the deliverable.
