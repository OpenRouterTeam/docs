---
name: update-visual-regression
description: >-
  Run the Playwright visual regression (VR) and browser smoke suites from tests/web-e2e against a local production build of projects/web once a PR that changes rendered output or page behavior is out of draft, scoped to the workspaces `pacwich affected` reports, then update the committed baselines when every diff is intentional. Use when the PR itself changes markup, styling, layout, fonts, icons, navigation, interactions, a browser test, or the shape of data a page renders. pacwich listing @openrouter-monorepo/web or @openrouter-monorepo/test-web-e2e prompts inspecting the diff, not running: a backend-only change reaching web through a shared package, or unrelated commits merged from main, does not need the run. The PR workflow (`web-e2e-pr.yaml`) is manual-dispatch only, and the smoke suite runs against production after release, so this local run is the only pre-merge check. Also covers adding VR coverage for new pages and masking dynamic content. Note: projects/mission-control has no VR coverage.
user-invocable: true
---

# Frontend verification before merge

Both Playwright suites in `tests/web-e2e` run against production only after the change ships: the daily VR workflow compares production with the committed screenshots, and the smoke suite runs after every release. The PR workflow (`.github/workflows/web-e2e-pr.yaml`) is manual-dispatch only; its `pull_request` trigger stays off while Vercel preview pages render a banner that production does not, which shifts every screenshot against the baselines. When dispatched, it runs on Linux (the `*-linux.png` baselines the daily job refreshes), picks the same affected selection as the table below from `pacwich affected` plus the changed route directories, and tests the `base_url` input (default production; a `https://pr-<n>.preview.openrouter.ai` URL tests that PR once it serves the PR head SHA). The check therefore runs on your machine, once per tested commit, after the PR is marked ready for review (not on drafts), and covers both screenshots (VR) and behavior (smoke) in one Playwright run.

**Note:** `projects/mission-control/` has no VR coverage. A mission-control UI change needs a new suite (see "Add VR coverage for a new page") or an explicit `not measured` in the PR.

## Run it once

### Decide from the dependency tree

List the workspaces your branch affects:

```bash
bunx pacwich affected list --base "$(git merge-base origin/main HEAD)" --head HEAD --ignore-uncommitted --json
```

pacwich reports which workspaces the diff can reach through the dependency tree; it does not decide whether the check runs. When the output names `@openrouter-monorepo/web` or `@openrouter-monorepo/test-web-e2e`, add `--explain --detailed` and read the changed files: run the check when the PR itself changes rendered output or page behavior (markup, styling, layout, a browser test, or the shape of data a page renders). pacwich follows workspace dependencies, so a change in `packages/frontend`, `packages/frontend-utils`, or `packages/theme` surfaces as `web`, but so does a backend-only change in a shared package (a router type, an enum, a helper) that no page renders; skip the run for those and say why in the PR. The reverse also holds: a change to a `cfw-frontend-api` route the page renders does not surface as `web`, so treat a data-shape change as a change to every route that renders that data and run the check for those routes even when neither workspace is listed. `--base` takes the merge base, not `origin/main`, because pacwich diffs the two refs directly and would otherwise count commits that landed on main after the branch. If neither workspace is listed and the PR does not change the shape of data a page renders, skip the run and add no line to the PR. If pacwich errors, treat both as affected (the fail-safe `.github/scripts/compute-affected.sh` uses). `@openrouter-monorepo/mission-control` alone has no VR coverage, and its smoke files (`suites/smoke/mission-control-*.test.ts`) skip unless `MC_BASE_URL` points at a mission-control build; record `not measured` for whichever half you could not run.

### Pick the narrowest tests

Add `--explain --detailed` to list the changed files per workspace, then choose from both suites: `suites/visual-regression/public-pages.test.ts` (screenshots) and `suites/smoke/<page>.test.ts` (behavior).

- Files confined to one route directory under `projects/web/app/[locale]/` (for example `(static)/pricing/`): that route's VR tests and its smoke file, selected with one `-g "<page>"` filter. Playwright matches the filter against the file path and the test title, so `-g pricing` selects `pricing visual snapshot` and `smoke/pricing.test.ts` together. If the route has no smoke file, run VR only and say so.
- Files in `packages/frontend`, `packages/theme`, `packages/frontend-utils`, `projects/web/app/[locale]/layout.tsx`, Navbar, footer, fonts, or `tests/web-e2e/{utils,pages,playwright.config.ts}`: the whole public VR file plus the `@critical` smoke tests.
- A dashboard route (`/settings/*`, `/activity`, `/chat`): its smoke file runs signed in with the dev Clerk ticket described in "Run both suites in one command"; dashboard VR runs against production after deploy, as described in "Build and serve".

### Build and serve

Build the production app and serve it behind `tests/web-e2e/scripts/local-edge-proxy.ts`, with the local stack up (`local-dev-env`). `next dev` renders differently and is not a substitute. A bare `next start` is not one either: in production, Cloudflare routes `/api/frontend/v1/*` and the other worker prefixes to the workers, `next start` does not emulate that, and a client fetch from the production build lands on the Next.js not-found page. The proxy fronts Next.js on the public port and forwards those prefixes to the local workers. The Tilt `web` resource holds port 3000 and shares `.next` with the build, so run `tilt disable web` first and `tilt enable web` when done. `RUN_VISUAL_REGRESSION=true` stops the known Turbopack `/404` prerender failure from aborting the build (`prerenderEarlyExit` in `projects/web/next.config.ts`), and `NODE_ENV=production` goes inside `infisical run` because the `/projects/web` path injects `NODE_ENV=development`. These are the steps `tests/web-e2e/scripts/local-web-server.ts` runs for `bun run e2e:local`.

Build, serve, and wait for the proxy to answer:

```bash
tilt disable web
cd projects/web
RUN_VISUAL_REGRESSION=true infisical run --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 --env=dev --path=/projects/web -- env NODE_ENV=production bun run build; BUILD_STATUS=$?
[ "$BUILD_STATUS" = 0 ] && infisical run --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 --env=dev --path=/projects/web -- env NODE_ENV=production bunx next start --port 3001 &
cd ../../tests/web-e2e
WEB_PORT=3000 NEXT_PORT=3001 bun scripts/local-edge-proxy.ts &
DEADLINE=$((SECONDS + 600))
until curl -sf --max-time 5 -o /dev/null http://localhost:3000/api/frontend/v1/catalog/models; do [ "$SECONDS" -lt "$DEADLINE" ] || { echo "not ready after 600s: stop, record not measured"; break; }; sleep 1; done
```

The `BUILD_STATUS` gate keeps a failed build from being served: `.next` still holds the previous build after a failure, and a bare `next start` would serve those pages and compare your baselines with code that lacks your change. With the gate, the server never starts and the probe below times out. The wait is bounded by elapsed time at 600 s, the same `READY_TIMEOUT_MS` as `waitForProxy` in `local-web-server.ts`, and `--max-time 5` keeps one stalled response from holding the loop past the deadline; if the loop prints its message, kill the two background jobs, run `tilt enable web`, and record `not measured (server never answered)` instead of retrying. The probe answers `200` only after the proxy is up and `/api/frontend/v1/*` reaches the local `frontend-api` worker; a `502` means that Tilt resource is not up. If you started a subset of Tilt resources (`tilt up -- frontend-api api`), include `api-kv-cron` and wait for it to finish: the catalog route reads KV, and the probe stays red until that warm-up has written it.

The dashboard VR suite (`test:vr:dashboard`) signs in with the `/tests/e2e` Infisical credentials, which belong to the deployed Clerk tenant, so it runs against production after the change deploys; say so in the PR when a dashboard route changed.

### Run both suites in one command

If Chromium is missing, run `bun run e2e:setup` first. The smoke files run on `chromium` with the storage state `global-setup.ts` writes, and the release smoke runs signed in (`pricing.test.ts` asserts the signed-in CTA by default; the `@critical` set includes `api-keys` and `chat`), so sign in the same way: mint a dev Clerk ticket (`clerk-dev-signin-token`) with `--fresh` and pass it as `E2E_CLERK_SIGN_IN_TOKEN`, which `global-setup.ts` accepts only for a localhost `BASE_URL`. The seeded `dev+clerk_test` account has MFA enabled, so its ticket ends at `needs_second_factor` and `global-setup.ts` fails before any test runs; a fresh generated user signs in with the ticket alone, and none of the selections above depend on the seeded account's data. The public VR file pins its own signed-out state, so the session does not touch its baselines. `RUN_VISUAL_REGRESSION=true` adds the `chromium-vr` and `mobile-chrome` projects for the VR file. Tickets are single-use, so mint a fresh one for every Playwright invocation, including the rerun.

Run the selection that matches your change:

```bash
cd tests/web-e2e
RUN_VISUAL_REGRESSION=true BASE_URL=http://localhost:3000 E2E_CLERK_SIGN_IN_TOKEN="$(jq -r .ticket "$TICKET_FILE")" bunx playwright test suites/visual-regression/public-pages.test.ts suites/smoke/<page>.test.ts -g "<page>"           # one route
RUN_VISUAL_REGRESSION=true BASE_URL=http://localhost:3000 E2E_CLERK_SIGN_IN_TOKEN="$(jq -r .ticket "$TICKET_FILE")" bunx playwright test suites/visual-regression/public-pages.test.ts suites/smoke/ -g "@critical|visual snapshot"   # shared surface
```

Do not add `SKIP_AUTH=true` to these commands: with `RUN_VISUAL_REGRESSION=true` it makes `global-setup.ts` write a signed-out state for every project, and the signed-in smoke tests then fail for that reason alone. If no ticket can be minted, run only the VR file (`SKIP_AUTH=true` is fine there) and record smoke as `not measured (no local session)`. Do not point the `/tests/e2e` production credentials at localhost.

### Read the result

- Green: record `passed`.
- A diff on a page you changed that shows exactly your change: regenerate that page's baselines with `BASE_URL=http://localhost:3000 bun run test:vr:update -- -g "<page>"` (the `BASE_URL` is required on this command too; `tests/web-e2e/utils/environment.ts` defaults it to `https://openrouter.ai`, which would capture production without your change), rerun the preceding command once with a fresh ticket, and commit both the `chromium-vr` and `mobile-chrome` PNG files. The run writes baselines only for the OS it runs on (`-linux` or `-darwin`); the daily job reads the `-linux` pair, so a page updated from a Mac alone turns the daily run red after merge (see "Linux baselines without a Linux machine"). Record `baselines updated (<pages>)`.
- A diff you did not intend: fix the change and rerun once. A diff on a page you did not touch is usually baseline provenance or local data (an empty `/models` list, a missing chart), not a regression; check "Regenerate baselines" and "Troubleshooting" before touching that page's baseline. Do not widen a threshold to get green.
- A smoke failure on a behavior you changed: fix the change, or update the test in the same PR when the new behavior is intended, and rerun once. A smoke failure on a page you did not touch: check local data before the test. Do not `test.skip` or loosen an assertion to get green.

One build, one run, at most one rerun after a fix or a baseline update, per tested commit. The cap does not carry a result forward: when a later push changes rendered output or behavior of the PR itself, build and run again from the new HEAD and replace the PR line. Decide the same way as the first run: rerun the pacwich command from "Decide from the dependency tree" (against the merge base, so a merge from `main` counts only the PR's own diff) and inspect the changed files since the last tested commit. A push with no frontend impact (docs, backend-only, a merge or rebase that brings in unrelated `main` commits) keeps the earlier line. If the build fails, the server never answers, or Playwright errors instead of reporting results, record `not measured (<reason>)` and stop; do not fall back to `next dev`, to production (it renders the code without your change), or to hand-made screenshots or manual clicking.

Record one line under "How to test" in the PR description, with the files, the `-g` filter, and the short SHA of the commit you built: `Frontend verification (<filter>, <sha>): VR passed, smoke passed`, with `baselines updated (<pages>)` or `not measured (<reason>)` in place of `passed` for either half. A skipped half is `not measured`, not `passed`. The SHA is what lets a reviewer see whether the line still covers HEAD.

When the run is over, stop the `next start` and proxy processes and run `tilt enable web`.

---

## Architecture overview

The following table lists where each part of the VR setup lives.

| Item | Location |
|------|----------|
| Test suites | `tests/web-e2e/suites/visual-regression/public-pages.test.ts` (public, signed-out) |
|             | `tests/web-e2e/suites/visual-regression/dashboard-pages.test.ts` (authenticated) |
| Baseline snapshots | `*.test.ts-snapshots/` directories next to each suite |
| Snapshot naming | `<name>-<project>-<platform>.png` (for example `homepage-chromium-vr-linux.png`, `homepage-mobile-chrome-linux.png`) |
| Page objects | `tests/web-e2e/pages/` (one class per page, extends `BasePage`) |
| Fixtures | `tests/web-e2e/utils/fixtures.ts` (Playwright fixture wiring) |
| Stability helper | `tests/web-e2e/utils/visual-stability.ts` (`waitForVisualStability`) |
| CSS masking | `tests/web-e2e/utils/screenshot.css` (hides dynamic elements during capture) |
| Playwright config | `tests/web-e2e/playwright.config.ts` (projects: `chromium-vr` + `mobile-chrome`) |
| CI workflow | `.github/workflows/visual-regression-daily.yaml` |
| npm scripts | `tests/web-e2e/package.json` |

### Thresholds

- Static pages (deterministic content): `maxDiffPixelRatio: 0.03` (3%)
- Dynamic pages (live data, charts) and long-form text pages (font subpixel drift): `maxDiffPixelRatio: 0.05` (5%)
- Dashboard pages (user-specific data): `maxDiffPixelRatio: 0.05` (5%)

### Viewports

Every VR test runs in two Playwright projects:

- `chromium-vr`: desktop Chrome
- `mobile-chrome`: Pixel 7 viewport

Both sets of baselines must be committed.

---

## Run VR tests to detect breakage

Run the suites that cover the pages you changed. Failures appear as pixel-diff mismatches.

Public pages (no auth):

```bash
cd tests/web-e2e
bun run test:vr
```

`test:vr` runs the whole `suites/visual-regression/` directory. The dashboard suite skips itself under `SKIP_AUTH=true` (and the mission-control suite skips without `MC_BASE_URL`), so only public pages produce results. Signed-out dashboard captures were never valid: without a session every dashboard route redirects to Clerk sign-in, so `--update-snapshots` used to write the sign-in page as the baseline.

Dashboard pages (needs Clerk credentials from Infisical):

```bash
cd tests/web-e2e
bun run test:vr:dashboard
```

In a non-interactive session, this command exits before Playwright starts if the Infisical CLI has no saved login session and attempts to prompt for `infisical login`. Record that authentication blocker instead of treating it as a visual-regression result.

If the tests pass, your change did not visually regress anything and no snapshot update is needed. Stop here.

### Calibrate before you trust a green run

The viewport frames (1280x720 desktop, 412x839 mobile) exclude anything below the first fold, and every frame is light theme because `playwright.config.ts` sets no `colorScheme`. On a long page a real change can sit entirely below the frame or inside the threshold, so a green run proves less than it looks. Before the first PR that changes a page, measure how far the committed baseline already is from production:

```bash
cd tests/web-e2e
bun run test:vr -- -g "<page> visual snapshot"
```

Playwright prints the diff ratio only when the comparison fails (`N pixels (ratio 0.XX of all image pixels) are different`, rounded up to 0.01); a passing run attaches nothing. To get the number for a page that passes, set that test's `maxDiffPixelRatio` to `0` locally, run it once, read the ratio from the failure, and revert the file with `git checkout`. If a change you know is on the page (a missing column, a new nav item) stays under the threshold, the viewport frames are not discriminating for that page: say so in every PR that touches it, and add an element-scoped baseline for the block that changes. Do not widen a threshold to make a laptop render pass.

### Element-scoped baselines

For a block below the fold (a closing card, a footer row), snapshot the element instead of the viewport so the change has pixel coverage at all:

```typescript
test('<page> <block> visual snapshot', async ({ myNewPage }) => {
  await myNewPage.goto();
  const block = myNewPage.page.getByTestId('<block>');
  await block.scrollIntoViewIfNeeded();
  await waitForVisualStability(myNewPage.page);

  await expect(block).toHaveScreenshot('<page>-<block>.png', {
    maxDiffPixelRatio: STATIC_THRESHOLD,
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
});
```

The `data-testid` goes on a wrapper the page owns, not on a design-system primitive. Element baselines follow the same `<name>-<project>-<platform>.png` naming and the same two-project rule as viewport baselines.

To snapshot an interactive state (an expanded accordion item, an open disclosure), drive it from the page object with `clickUntilAttribute` from `tests/web-e2e/utils/click-until-attribute.ts` (for example `clickUntilAttribute(trigger, { attribute: 'aria-expanded', value: 'true' })`): a click that lands before hydration is silently dropped, so a single `click()` followed by a screenshot flakes.

### Run against a local production build

`BASE_URL` defaults to production. To capture a change before it deploys, build and serve the app as described in "Run it once" and point the suite at it with `BASE_URL=http://localhost:3000`. Do not capture against `next dev`, whose rendering differs from the production build.

## Inspect failures

Playwright writes diff images into `test-results/`. Open the HTML report to compare the expected, actual, and diff images:

```bash
cd tests/web-e2e
bunx playwright show-report
```

Verify that your change caused every difference. If you see unexpected regressions in pages you did not touch, investigate before proceeding.

## Regenerate baselines

After you confirm that all diffs are intentional, regenerate the baselines.

Public pages:

```bash
cd tests/web-e2e
bun run test:vr:update
```

Dashboard pages:

```bash
cd tests/web-e2e
bun run test:vr:dashboard:update
```

This overwrites the PNG files in the `*-snapshots/` directories for both `chromium-vr` and `mobile-chrome`.

The suffix records the OS that rendered the baseline. Both CI jobs (`visual-regression-daily` and `web-e2e-pr`) run on Linux and read `*-linux.png`; the `*-darwin.png` files exist only for local Mac runs. A baseline rendered on a laptop can drift by tens of percent from the same OS on a CI runner (fonts, antialiasing, OS version), so treat a wide diff on pages you did not touch as a provenance problem, not a regression. Check which machine produced the current PNG files before widening thresholds. Read that from GitHub, not `git log`: agent checkouts are shallow clones (`git rev-parse --is-shallow-repository` prints `true`), and a shallow clone attributes every file older than its root commit to that commit.

```bash
gh api "repos/OpenRouterTeam/openrouter-web/commits?path=tests/web-e2e/suites/visual-regression/public-pages.test.ts-snapshots/<name>-chromium-vr-linux.png&sha=main" \
  --jq '.[0] | "\(.sha[:11]) \(.commit.author.date[:10]) \(.commit.author.name)"'
```

### Linux baselines without a Linux machine

The daily workflow renders on Ubuntu against production, so the linux pair can come from it right after your change deploys. Dispatch it by hand and leave `notify_slack` unset:

```bash
gh workflow run visual-regression-daily.yaml
```

A dispatched run uploads `visual-regression-<matrix>-report` artifacts regardless of outcome (`.github/workflows/visual-regression-daily.yaml`, the `upload-artifact` step's `if:`) and skips the Slack post unless `notify_slack` is set, so nothing turns red in `#alerts-tests`. Download the artifact, take the `*-actual.png` for your test, rename each to `<name>-<project>-linux.png`, and commit them with the artifact's diff image attached to the PR. The macOS `node_modules` cannot render linux baselines locally.

## Rerun to confirm green

Run the suites again without `--update-snapshots` to confirm that the new baselines pass:

```bash
cd tests/web-e2e
bun run test:vr          # public pages
bun run test:vr:dashboard  # dashboard pages
```

All tests must pass before you commit.

## Commit updated baselines

Stage only the snapshot files and commit them alongside your feature changes:

```bash
git add tests/web-e2e/suites/visual-regression/*.test.ts-snapshots/
git commit -m "test(vr): update baselines for <description of UI change>"
```

---

## Add VR coverage for a new page

When you add a new page or route, add VR coverage so future changes are caught.

### 1. Create or reuse a page object

Add a page object in `tests/web-e2e/pages/` if one does not exist. Follow the `BasePage` pattern:

```typescript
import { E2EPageUrl } from '../utils/urls';
import { BasePage } from './base-page';

export class MyNewPage extends BasePage {
  get path(): string {
    return E2EPageUrl.MyNewPage; // add to urls.ts
  }
}
```

### 2. Register the fixture

In `tests/web-e2e/utils/fixtures.ts`, follow these steps:

1. Import the page object.
2. Add it to the `PageFixtures` interface.
3. Wire it in the `base.extend<PageFixtures>({...})` block.

### 3. Add the VR test

Add a test to the appropriate suite file (`public-pages.test.ts` or `dashboard-pages.test.ts`):

```typescript
import { SCREENSHOT_TIMEOUT_MS, waitForVisualStability } from '../../utils/visual-stability';

// Threshold constants are defined locally in each suite file:
// public-pages.test.ts  → STATIC_THRESHOLD (0.03), DYNAMIC_THRESHOLD (0.05)
// dashboard-pages.test.ts → DASHBOARD_THRESHOLD (0.05)
const STATIC_THRESHOLD = 0.03;

test('my new page visual snapshot', async ({ myNewPage }) => {
  await myNewPage.goto();
  await waitForVisualStability(myNewPage.page);

  await expect(myNewPage.page).toHaveScreenshot('my-new-page.png', {
    maxDiffPixelRatio: STATIC_THRESHOLD,
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
});
```

Choose the threshold constant to define in your suite:

- `STATIC_THRESHOLD` (0.03) for pages with deterministic content.
- `DYNAMIC_THRESHOLD` (0.05) for public pages with live data, charts, or long-form text subject to font subpixel drift.
- `DASHBOARD_THRESHOLD` (0.05) for authenticated dashboard pages with user-specific data.

### 4. Generate initial baselines

Generate the baselines for the suite you changed:

```bash
cd tests/web-e2e
bun run test:vr:update          # public pages
bun run test:vr:dashboard:update  # dashboard pages
```

### 5. Verify and commit

Run the suite without the update flag:

```bash
cd tests/web-e2e
bun run test:vr          # or bun run test:vr:dashboard
```

Commit both the new test code and the generated PNG baselines.

---

## Mask dynamic content

If a page has volatile data (counters, timestamps, user-specific content) that causes false-positive diffs, mask it with one of the following options.

### Option A: CSS masking (global)

Add selectors to `tests/web-e2e/utils/screenshot.css`. This stylesheet is injected during all VR screenshots. Use `data-testid` attributes for stable selectors:

```css
[data-testid='my-volatile-widget'] {
  visibility: hidden !important;
}
```

### Option B: Per-test Playwright `mask` (scoped)

Pass a `mask` array to `toHaveScreenshot`:

```typescript
await expect(myNewPage.page).toHaveScreenshot('my-new-page.png', {
  maxDiffPixelRatio: DYNAMIC_THRESHOLD,
  timeout: SCREENSHOT_TIMEOUT_MS,
  mask: [
    myNewPage.page.locator('[data-testid="my-volatile-widget"]'),
  ],
});
```

Use Option A for elements that are volatile across many pages. Use Option B for page-specific masking.

---

## Remove VR coverage

When a page is removed, follow these steps:

1. Delete the test from the suite file.
2. Delete the corresponding PNG baselines from both `*-snapshots/` directories.
3. Remove the page object from `tests/web-e2e/pages/` and its fixture wiring in `fixtures.ts` if nothing else uses it.

---

## Troubleshooting

The following table lists common symptoms, their causes, and fixes.

| Symptom | Cause | Fix |
|---------|-------|-----|
| `test:vr` reports dashboard tests as skipped | `SKIP_AUTH=true` skips `dashboard-pages.test.ts` | Expected. Use `test:vr:dashboard` (Infisical Clerk creds) for those pages. |
| `browserType.launch: Executable doesn't exist at .../chromium_headless_shell-<rev>` (or `.../ffmpeg-<rev>/ffmpeg-linux`) | The browser or ffmpeg revision the pinned Playwright expects is not in the cache (`~/.cache/ms-playwright` on Linux, `~/Library/Caches/ms-playwright` on macOS; other tools leave other revisions there). Failing tests record video, so ffmpeg is needed too. | `cd tests/web-e2e && bun run e2e:setup`. If the installer hangs while extracting, kill it, remove `__dirlock` from the cache directory, and rerun `playwright install chromium chromium-headless-shell ffmpeg`; the zips it wants can also be fetched straight from `cdn.playwright.dev` and unzipped into `<cache>/<name>-<rev>/`, then add an empty `INSTALLATION_COMPLETE` file beside them. A partially extracted binary segfaults, so check the unzipped size against `unzip -l`. |
| Snapshot diff on pages you did not change | Font subpixel rendering, CI runner differences | Verify the diff is not a real regression, then mask the volatile element with CSS (see "Mask dynamic content"). Do not widen the threshold. |
| `waitForVisualStability` timeout | Page has persistent `.animate-pulse` skeletons | Increase `skeletonTimeoutMs` in the test, or increase `settleMs`. |
| Test times out entirely | Slow page load (for example `/docs`, `/rankings`) | Add `test.setTimeout(120_000)` before `goto()`. |
| Dashboard tests fail with auth errors | Missing Clerk credentials | Ensure `infisical run` injects `E2E_CLERK_USER` and `E2E_CLERK_PASSWORD` from `/tests/e2e`. |
| `test:vr:dashboard` fails with `Project ID is required when using machine identity` | Infisical machine authentication needs an explicit project ID | Include `--projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173` when invoking `infisical run` directly. |
| `test:vr:dashboard` prints `No valid login session found, triggering login flow` and exits | No local Infisical session and the package script does not pass a token | Export `INFISICAL_TOKEN` from the universal-auth login in the root `AGENTS.md`, then run the direct `infisical run` command in the next row. |
| Dashboard script fails with a missing project ID under machine auth | The package script does not pass the Infisical project ID | Run `infisical run --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 --env=dev --path=/tests/e2e --include-imports=false -- env RUN_VISUAL_REGRESSION=true bunx playwright test suites/visual-regression/dashboard-pages.test.ts`. |
| Local `/models` snapshot is nearly empty | The local KV-backed model cache has no rows | Inspect the rendered model count before treating a passing or failing snapshot as meaningful. Use a data-backed environment for model screenshots. |

## Files typically touched

The following table lists the files a VR change usually touches.

| File | Change |
|------|--------|
| `tests/web-e2e/suites/visual-regression/*.test.ts` | Add, modify, or remove VR tests |
| `tests/web-e2e/suites/visual-regression/*.test.ts-snapshots/*.png` | Updated baseline screenshots |
| `tests/web-e2e/pages/*-page.ts` | New or modified page objects |
| `tests/web-e2e/utils/fixtures.ts` | Fixture wiring for new pages |
| `tests/web-e2e/utils/screenshot.css` | Global dynamic-content masks |
| `tests/web-e2e/utils/urls.ts` | New page URL constants |
