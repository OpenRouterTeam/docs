---
name: unit-test-writing
description: Guidelines for writing high-quality unit tests — covers naming, structure,
  assertions, branching, coverage, fixtures and mocks (process-global bun:test mocks,
  `@ts-expect-error` probes), fake timers, ClickHouse TTL fixture timestamps, pinning a
  known bug with `@existingBuggyBehavior`, tests that cannot fail, and test organization.
user-invocable: false
---

# Unit Test Writing Skill

Guidelines for writing and reviewing unit tests in the OpenRouter monorepo. These
apply when creating new tests or modifying existing ones.

## Test Frameworks

- **`bun:test`** for packages (check for `bun test` in the package's `package.json` scripts)
- **`vitest`** for services (check for `vitest.config.ts` or `vitest.config.mts` in the package)
- Colocate tests with modules (`.test.ts` next to source)

---

## 1. Test Name Accuracy

Each test name (`it(...)` / `test(...)`) must accurately describe the **behavior**
under test, not the implementation.

- Describe what the function returns or does given specific inputs/conditions
- Avoid names that just restate the function name or describe internal steps

---

## 2. Arrange-Act-Assert Structure

Every test must follow the Arrange-Act-Assert pattern:

1. **Arrange** — set up inputs, mocks, and preconditions
2. **Act** — execute the function under test
3. **Assert** — verify the result

Mock hygiene:
- Set up mocks before the action
- Clean up properly (e.g., `afterEach`, `vi.restoreAllMocks()`)

Mocking rules:
- **Never mock the function under test.** Mock its underlying dependencies
  instead and test the real function's logic flow and behavior.
- **Never mock the database layer.** New tests of DB queries/calls
  (Postgres or Spanner) must be integration tests against a real database,
  not unit tests with a mocked `dbRead`/`dbWrite`, Kysely, or Spanner
  client. See the
  [db-integration-tests skill](../db-integration-tests/SKILL.md).
- When creating test helper classes that extend adapters or other classes,
  do NOT create wrapper methods for public methods. Only create wrappers
  for protected/private methods that need exposure for testing. Public
  methods can be called directly on the instance.

---

## 3. No Logical Branching in Tests

Tests must be flat and linear — no `if/else`, `switch`, ternary operators,
or conditional logic. The human reading the test should not have to trace
control flow.

- Use assertion functions (e.g., `assert(value !== undefined)`) to narrow
  types rather than `expect` followed by conditional code.
- When testing Result types, use `assertOk(result)` / `assertErr(result)` —
  these provide better type narrowing than `expect(isOk(result)).toBe(true)`.
- For `it.each` tables, type the table `as const` so each row stays a tuple
  under `bun run typecheck`, and keep the callback at two parameters
  (`max-params` lint) by grouping several inputs into one object argument.

---

## 4. Necessary and Sufficient Assertions

Each test case must read like a proof:

- Every assertion must be **necessary** — removing it would weaken the test.
- Collectively they must be **sufficient** — they fully prove the behavior.
- Remove redundant assertions that test the same thing twice.
- Add missing assertions where the test doesn't fully verify the behavior.
- Do not assert exact equality on a log payload that spreads
  `errorToLogFields(zodError)`. Under `bun test`, zod's stack suppression
  stops working once the `ZodError` constructor has run a few dozen times in
  the process, so `error_stack` is present in a full-package run and absent
  in a single-file rerun. Match the named fields with
  `expect.objectContaining(...)` instead.

---

## 5. Test Fragmentation

- Combine tests that could trivially be merged — e.g., two tests each
  asserting one property of the same return object.
- Use inline snapshots (`toMatchInlineSnapshot`) for complex objects where
  practical, instead of asserting individual properties in separate tests.
- Do NOT combine tests that test genuinely different behaviors or different
  code paths.

---

## 6. `describe` Block Usage

- A single top-level `describe` wrapping all tests in a file is fine —
  that is the codebase convention.
- Remove unnecessary *nested* `describe` blocks that add no organizational
  value — e.g., a nested `describe` that repeats the function name or groups
  only one or two tests without shared setup.
- Keep nested `describe` blocks when they genuinely group related tests with
  shared setup (`beforeEach`) or when the file tests multiple distinct
  functions/behaviors that benefit from visual separation.

---

## 7. Branch Coverage

- Check for missing edge cases: error paths, null/undefined inputs, boundary
  conditions, empty arrays.
- Read the source file being tested to identify untested branches and add
  tests for missing important branches.
- Running coverage:
  - **vitest**: `bunx vitest run --coverage <path-to-test-file>` from the
    package directory
  - **bun**: `bun test --coverage <path-to-test-file>` from the package
    directory

---

## 8. Fixtures and Mocks

- **Build fixtures real object > existing fake > typed `createMockX` factory** (one owner per factory). Module mocks are banned. A cast in test setup means the fixture is wrong.
- **Probe statically-invalid input with `@ts-expect-error`, not a cast.** A cast claims the value is valid, so it keeps passing once the type moves; `@ts-expect-error` fails the day the input becomes legal.
- **Everything `bun:test` mocks is process-global, and CI runs many files in one process.** A `mock.module` (only where the `no-module-mocks` baseline still allows one) must spread the real module and override only what the file needs; a stub that omits an export breaks the next file that imports it. There is no undo: re-mocking with the real exports in `afterAll` is a no-op, so every override stays live for the rest of the process. Anything a later file may need real (a layout component, `useToast`, a URL-state hook) is not mockable; use a prop, a testing adapter, or the shared process-wide stub (`test-utils/posthog-test-stub`). A fire-and-forget chain (`waitUntil`, `void promise`) is awaited through an injected seam that captures the promise, never through a `setTimeout(0)` drain. Frontend seams: `packages/frontend/test-utils/AGENTS.md`.

---

## 9. Timers

**Never sleep on real timers in tests.** Use `jest.useFakeTimers()` plus `jest.advanceTimersByTime()` for timer-driven code, and `waitFor` / `findBy*` / `await act(async () => {})` for async UI updates. Fixed `setTimeout` sleeps with a nonzero delay are banned in frontend tests by the `openrouter/no-real-timer-sleeps` lint rule. Never mix fake timers with the polling helpers in one test — they hang, and Bun has no `advanceTimersByTimeAsync`. Bun fake timers are process-global: a test that times out while they are on leaves every later test in the process without working timers. For a component that polls, inject the interval as a prop, pass a ~1ms value in the test, and assert with `waitFor`/`findBy*` instead of advancing fake timers through `act()`. One exception: proving out-of-process work did *not* happen may keep a real grace window — justify it in a comment and disable the rule on that line.

---

## 10. ClickHouse Integration Fixture Timestamps

**Derive ClickHouse integration fixture timestamps from the clock.** Tables with a `TTL` (most minute and hourly rollups, `user_signals`, `feature_gate_checks`) drop rows once the wall clock passes `timestamp + TTL`, so a fixture seeded at an absolute date expires. Seed from `Date.now()` (offset by `oneDayMS` / `oneWeekMS` from `@openrouter-monorepo/helpers/date`, rounded to the granularity under test) and freeze time with `setSystemTime` only where the query itself reads the clock. Absolute dates are allowed for tables without a TTL and for deliberately expired or far-future rows, with a disable comment naming the table. `openrouter/no-absolute-date-in-clickhouse-integration-test` enforces this for `packages/clickhouse/integration/**`. Files listed in `scripts/oxlint/clickhouse-absolute-date-baseline.ts` are grandfathered until audited.

---

## 11. Pinning a Known Bug

**Tag tests that pin a known bug.** When you knowingly write a passing test that asserts pre-existing buggy behavior, put a `/** @existingBuggyBehavior */` comment directly above the `it`, and follow it with an `it.failing` (`it.fails` under vitest) asserting the fixed behavior. The pin keeps regression coverage today; the failing test turns red once the bug is fixed. `openrouter/require-buggy-behavior-failing-pair` enforces the pair.

---

## 12. Logs, Metrics, and fs-log

This section also covers breadcrumbs and PostHog captures.

**Do not assert on log lines, metric emissions, breadcrumbs, PostHog captures, or fs-log calls.** They pin message strings, event names, and tag or property lists, break on every wording change, and do not prove the behavior worked. Assert on the return value, the persisted row, or the response instead. Do not install `setStatsd(createSpyStatsd())`, `setStatsd(noopStatsd)`, `spyOn(logger, 'eLog')`, or a `sendToFSLog` mock to keep a test quiet: `getStatsd()` defaults to a no-op, and log output in tests is harmless. When the code under test takes a logger or statsd as a required injected dependency, pass a no-op and assert nothing on it.

Three cases are worth a test:

- **Redaction.** A key, prompt, PII, ePHI, or payment value never reaches the log context, metric tags, breadcrumbs, PostHog event properties, or fs-log payload, or a scrubber runs before the sink. Assert the absence, after a minimal positive control that the line or event fired; without one the check passes when nothing is emitted.
- **Monitor-critical metrics.** The metric is the only input to a no-data (dead-man's-switch) monitor, such as a liveness heartbeat or a cron `*_complete` counter, or it is a data-loss counter on a write, replay, or billing path (`*.insert_failed`, `*.dead_lettered`, `generation_billing.publish_failed`, the Spanner generations inserter). A silent emission break disables the alert. Assert only that metric, and name the monitor in the test.
- **PostHog as behavior.** Feature flags, a `get_session_id` / `get_distinct_id` value the code forwards, `reset()` on logout, `identify` with the right user, and consent gating are behavior, not analytics.
- **The sinks themselves.** Tests in `packages/instrumentation`, `packages/clients/fs-logs`, and `services/dev-fs-logs`, and e2e tests that read dev-fs-logs to check what was sent upstream.

---

## 13. Tests That Cannot Fail

**Delete or rewrite a test that would still pass if every function it imports returned `undefined`.** It observes no behavior, so it catches no defect. Call the subject inside the test body with one concrete input and assert the literal output or the observable effect. Full principle: `principle-test-behavior-not-implementation` in OpenRouterTeam/agent-plugins.

- **Constant pin.** The assertion restates an exported constant, config default, or table row (`expect(MAX_RETRIES).toBe(3)`). Test the code that reads the value with one input instead. Keep a pin only when something outside the code depends on the literal (a HIPAA plugin allowlist, a fail-open security default, a public API enum, a metric name a monitor reads), and name that consumer in the test name.
- **Weak assertion.** Only `toBeDefined`, `toBeTruthy`, `typeof x === 'function'`, `not.toThrow`, or `expect(true).toBe(true)`. Assert the exact value.
- **Mock echo.** The assertion checks the value a stub was set up to return, or only that a mock was called. Assert the payload the dependency received or the state after the call.
- **Self-referential.** The expected value comes from the code under test (`expect(parse(x)).toEqual(parse(x))`).
- **Duplicate of integration coverage.** A mocked-client DB or ClickHouse test that checks only SQL shape, parameter forwarding, or error passthrough while an integration test runs the same query. Move any filtering, scoping, ordering, or error-mapping case the integration suite lacks into it, then delete the mocked test.
