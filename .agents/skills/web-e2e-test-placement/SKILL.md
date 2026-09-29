---
name: web-e2e-test-placement
description: >-
  Decide whether a tests/web-e2e test belongs on release smoke or the daily
  smoke run. Use when adding or moving a web E2E test, choosing Playwright
  tags, or triaging a recurring Release or Web Smoke failure.
user-invocable: true
---

# Web E2E Test Placement

Use this skill when adding or moving a test under `tests/web-e2e/`, or when a
Web Smoke/Release failure keeps recurring.

## Two entry points, one workflow

The release smoke job in `.github/workflows/release.yaml` (around line 1918)
and `.github/workflows/smoke-test-web-daily.yaml` both call the same reusable
workflow: `.github/workflows/smoke-test-web.yaml`. Both run against production
`https://openrouter.ai` with the E2E Clerk user from Infisical `/tests/e2e`
(`tests/web-e2e/package.json` documents that path).

The invocations differ only in operational wiring:

- Release waits for the deployed `commit_sha` via `verify_deployment`; daily
  sets `verify_deployment: false`.
- Release uses the direct failure alert path; daily uploads blob reports,
  merges them, and posts the richer Slack summary.
- Release and daily use different concurrency groups.
- Release supplies `test_grep_invert: "@propagation"`; daily leaves filters
  empty and runs the superset.

See `.github/workflows/release.yaml`, `.github/workflows/smoke-test-web-daily.yaml`,
and `.github/workflows/smoke-test-web.yaml` for the source of truth.

## Placement rule

A release gate must be deterministic and fast on a healthy system. Put a test
on nightly smoke when it depends on eventually-consistent propagation (such as
the Logs/user-transactions read model, about 10 seconds normally and 60–120
seconds under load or impairment), a live upstream provider's availability, or
multi-minute waits. If failure would not justify halting a release, it does
not belong on the release path.

Nightly placement is not test deletion: the daily run still exercises it and
alerts through `#alerts-tests`.

## Tags and changes

Use Playwright tags on the test or describe block, following the
`{ tag: '@critical' }` convention in `tests/web-e2e/suites/smoke/*.test.ts`.
The reusable workflow passes `test_grep` to `--grep` and
`test_grep_invert` to `--grep-invert` (`.github/workflows/smoke-test-web.yaml`).
Avoid a plain `test.skip`: it removes execution from both release and daily
coverage. Tag the test instead.

Release selection is exclusion-only: it passes no `test_grep`, so `@critical`
does not decide what runs on release. That tag now only scopes manual
`workflow_dispatch` runs to the critical-path subset (release was narrowed to
it before the runner-image speedup, see OPE-5160 in `release.yaml`).

### Add release coverage

Write a short, deterministic test under `tests/web-e2e/`. It is on the release
path by default; what keeps it there is *not* carrying an exclusion tag like
`@propagation`. Keep external dependencies and propagation waits out of it.

### Move coverage off release

Keep the test active, add an exclusion tag such as `{ tag: '@propagation' }`,
and pass that tag through `release.yaml`'s `test_grep_invert`. Do not skip or
delete the test; the daily workflow intentionally has no invert filter.

### Add an exclusion category

Declare the new tag on the test, then include it in the release
`test_grep_invert` value. That input accepts one string, so multiple excluded
categories need one Playwright regex with alternation, for example:
`"@propagation|@provider-dependent"`. `--grep-invert` excludes tests whose
title/tag metadata matches that regex.

## Verify selection

From `tests/web-e2e`:

```bash
# daily cron: no filter, the full suite
node_modules/.bin/playwright test --list
# release: exclusion only
node_modules/.bin/playwright test --list --grep-invert "@propagation"
# manual dispatch scoped to the critical-path subset
node_modules/.bin/playwright test --list --grep "@critical"
```

Confirm your test appears in the unfiltered list, and that the release list
contains it if it should gate a release and omits it if it should not.

## Run one file locally

The release and daily jobs are the only automatic runs, so a new smoke case is proven by running its file yourself. From `tests/web-e2e`:

```bash
# against production (BASE_URL defaults to https://openrouter.ai)
node_modules/.bin/playwright test suites/smoke/pricing.test.ts

# against a local production build of projects/web (bun run build && bun run start)
BASE_URL=http://localhost:3000 node_modules/.bin/playwright test suites/smoke/pricing.test.ts
```

No credentials are needed for signed-out coverage: `global-setup.ts` writes a signed-out storage state when none of `E2E_CLERK_USER`, `E2E_CLERK_PASSWORD` and `E2E_CLERK_SIGN_IN_TOKEN` is set, and every project inherits it. Cases that need a session get their credentials through `bun run e2e`, whose only difference is the `infisical run` wrapper.

Two things that look like shortcuts are not:

- `bun run e2e:local` runs only the all-routes suite, needs a Tilt stack plus an Infisical login, and refuses any base URL that is not localhost with a port, so it can never run a single smoke file.
- A production-only assertion (a link that ships with the change under test) can only go green against the local build until the change deploys; say so in the PR and expect one red daily run at most.

To pin a signed-out case inside a file whose other cases use the project default, nest a `test.describe` with `test.use({ storageState: SIGNED_OUT_STATE })` (`suites/smoke/signup-button.test.ts`); a further nested `test.use({ viewport })` gives a phone case without a second project.

Static pages hydrate after `goto()` resolves, and a control whose only behaviour is a React handler (a `SegmentedControl` radio, a tab) swallows a click that lands first. Put the interaction in the page object and retry it until the state change is observable (`aria-checked`, `aria-selected`, a URL hash) with `expect(async () => { ... }).toPass()`, the shape `setMode()` in `pages/mission-control-devin-shell-page.ts` and `suites/smoke/model-tabs.test.ts` use; a bare `click()` on such a control is a flake on the release path.

## Gotchas

- Daily smoke is the superset and alerts `#alerts-tests`; nightly-only means “not
  a per-release gate,” not “unobserved.”
- A propagation quarantine is not permission to let a test rot. Repeated
  nightly failures are signal about the read model and need investigation.
- A Vercel preview relays `/api/v1/*`, `/api/internal/*`, `/api/admin/*`, `/api/alpha/*` and `/api/frontend/v1/*` to production (`packages/frontend/middlewares/utils.ts`, `shouldPreviewProxy`), so a test that asserts on one of those paths against a `BASE_URL` preview is observing production, not the branch. Probe a non-relayed path on the preview, or wait for the release smoke, which runs against production after `verify_deployment`.
- Worked example: the guardrail lifecycle test failed in 18 Release smoke
  runs from July 28–30, while Datadog showed its generations completed. The
  failure was the Logs read-model row not surfacing within the test budget;
  see `tests/web-e2e/suites/lifecycle/guardrail-request-lifecycle.test.ts` and
  the Release investigation for run `30577820825`.
