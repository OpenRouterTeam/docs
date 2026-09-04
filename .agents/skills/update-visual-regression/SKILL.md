---
name: update-visual-regression
description: >-
  Update visual regression (VR) test baselines when UI, rendering, or
  UX-flow changes in projects/web would break the daily VR CI check.
  Covers running the suites locally, regenerating snapshots, adding
  coverage for new pages, and masking dynamic content. Note:
  projects/mission-control does not yet have VR coverage.
user-invocable: true
---

# Update Visual Regression Tests

When your changes touch **UI, styling, layout, or UX flow** in
`projects/web/`, the daily visual-regression CI workflow will
fail unless you update the committed screenshot baselines.
This skill tells you how.

> **Note:** `projects/mission-control/` does not yet have VR
> test coverage. If you add or change mission-control pages,
> consider adding a new VR suite following the patterns below
> (see "Adding VR Coverage for a New Page"). Until then,
> mission-control UI changes won't be caught by the daily VR
> CI check.

## When This Applies

Update VR baselines whenever a change affects what appears on
screen:

- Component markup, styling, or Tailwind classes
- Page layout, spacing, or responsive behaviour
- New pages or routes that should be covered
- Removal or renaming of existing pages
- Theme / design-system token changes
- Font or icon changes
- Navigation structure changes

If your change is **API-only, backend-only, or docs-only** with
no rendered output change, VR updates are not needed.

---

## Architecture Overview

| Item | Location |
|------|----------|
| Test suites | `tests/web-e2e/suites/visual-regression/public-pages.test.ts` (public, signed-out) |
|             | `tests/web-e2e/suites/visual-regression/dashboard-pages.test.ts` (authenticated) |
| Baseline snapshots | `*.test.ts-snapshots/` directories next to each suite |
| Snapshot naming | `<name>-<project>-<platform>.png` (e.g. `homepage-chromium-vr-linux.png`, `homepage-mobile-chrome-linux.png`) |
| Page objects | `tests/web-e2e/pages/` (one class per page, extends `BasePage`) |
| Fixtures | `tests/web-e2e/utils/fixtures.ts` (Playwright fixture wiring) |
| Stability helper | `tests/web-e2e/utils/visual-stability.ts` (`waitForVisualStability`) |
| CSS masking | `tests/web-e2e/utils/screenshot.css` (hides dynamic elements during capture) |
| Playwright config | `tests/web-e2e/playwright.config.ts` (projects: `chromium-vr` + `mobile-chrome`) |
| CI workflow | `.github/workflows/visual-regression-daily.yaml` |
| npm scripts | `tests/web-e2e/package.json` |

### Thresholds

- **Static pages** (deterministic content): `maxDiffPixelRatio: 0.03` (3%)
- **Dynamic pages** (live data, charts) and **long-form text pages** (font subpixel drift): `maxDiffPixelRatio: 0.05` (5%)
- **Dashboard pages** (user-specific data): `maxDiffPixelRatio: 0.05` (5%)

### Viewports

Every VR test runs in two Playwright projects:
1. `chromium-vr` -- Desktop Chrome
2. `mobile-chrome` -- Pixel 7 viewport

Both sets of baselines must be committed.

---

## Step 1 -- Run VR Tests to Detect Breakage

Run the suite(s) that cover the pages you changed. Failures
appear as pixel-diff mismatches.

**Public pages (no auth):**

```bash
cd tests/web-e2e
bun run test:vr
```

`test:vr` runs the whole `suites/visual-regression/` directory,
so the dashboard and mission-control suites execute too and fail
signed-out under `SKIP_AUTH=true`. Read the per-suite results,
not the exit code: a non-zero exit whose only failures are in
`dashboard-pages.test.ts` says nothing about public pages. Add
`--grep`, or pass the suite file, to run public pages alone.

**Dashboard pages (needs Clerk credentials from Infisical):**

```bash
cd tests/web-e2e
bun run test:vr:dashboard
```

If tests pass, your change did not visually regress anything
and no snapshot update is needed. Stop here.

## Step 2 -- Inspect Failures

Playwright writes diff images into `test-results/`. Open the
HTML report to compare expected vs actual vs diff:

```bash
cd tests/web-e2e
bunx playwright show-report
```

Verify that every difference is **intentional** (caused by your
change). If you see unexpected regressions in pages you did not
touch, investigate before proceeding.

## Step 3 -- Regenerate Baselines

Once you have confirmed all diffs are intentional, regenerate
the baselines:

**Public pages:**

```bash
cd tests/web-e2e
bun run test:vr:update
```

**Dashboard pages:**

```bash
cd tests/web-e2e
bun run test:vr:dashboard:update
```

This overwrites the `.png` files in the `*-snapshots/`
directories for both `chromium-vr` and `mobile-chrome`.

## Step 4 -- Re-run to Confirm Green

Run the suite(s) again **without** `--update-snapshots` to
confirm the new baselines pass:

```bash
cd tests/web-e2e
bun run test:vr          # public pages
bun run test:vr:dashboard  # dashboard pages
```

All tests must pass before committing.

## Step 5 -- Commit Updated Baselines

Stage only the snapshot files and commit them alongside your
feature changes:

```bash
git add tests/web-e2e/suites/visual-regression/*.test.ts-snapshots/
git commit -m "test(vr): update baselines for <description of UI change>"
```

---

## Adding VR Coverage for a New Page

When you add a new page or route, add VR coverage so future
changes are caught.

### 1. Create or reuse a page object

Add a page object in `tests/web-e2e/pages/` if one does not
exist. Follow the `BasePage` pattern:

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

In `tests/web-e2e/utils/fixtures.ts`:

1. Import the page object.
2. Add it to the `PageFixtures` interface.
3. Wire it in the `base.extend<PageFixtures>({...})` block.

### 3. Add the VR test

Add a test to the appropriate suite file
(`public-pages.test.ts` or `dashboard-pages.test.ts`):

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
- `DYNAMIC_THRESHOLD` (0.05) for public pages with live data, charts,
  or long-form text subject to font subpixel drift.
- `DASHBOARD_THRESHOLD` (0.05) for authenticated dashboard pages with
  user-specific data.

### 4. Generate initial baselines

```bash
cd tests/web-e2e
bun run test:vr:update          # public pages
bun run test:vr:dashboard:update  # dashboard pages
```

### 5. Verify and commit

```bash
cd tests/web-e2e
bun run test:vr          # or bun run test:vr:dashboard
```

Commit both the new test code and the generated `.png` baselines.

---

## Masking Dynamic Content

If a page has volatile data (counters, timestamps, user-specific
content) that causes false-positive diffs:

### Option A -- CSS masking (global)

Add selectors to `tests/web-e2e/utils/screenshot.css`. This
stylesheet is injected during all VR screenshots. Use
`data-testid` attributes for stable selectors:

```css
[data-testid='my-volatile-widget'] {
  visibility: hidden !important;
}
```

### Option B -- Per-test Playwright `mask` (scoped)

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

Use Option A for elements that are volatile across many pages.
Use Option B for page-specific masking.

---

## Removing VR Coverage

When a page is removed:

1. Delete the test from the suite file.
2. Delete the corresponding `.png` baselines from both
   `*-snapshots/` directories.
3. Remove the page object from `tests/web-e2e/pages/` and
   its fixture wiring in `fixtures.ts` if nothing else uses it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `test:vr` exits non-zero with failures only in `dashboard-pages.test.ts` | Authenticated pages ran signed-out under `SKIP_AUTH=true` | Expected. Judge public-page results on their own, and use `test:vr:dashboard` (Infisical Clerk creds) for those pages. |
| Snapshot diff on pages you did not change | Font subpixel rendering, CI runner differences | Widen threshold or add CSS mask. Verify the diff is not a real regression. |
| `waitForVisualStability` timeout | Page has persistent `.animate-pulse` skeletons | Increase `skeletonTimeoutMs` in the test, or increase `settleMs`. |
| Test times out entirely | Slow page load (e.g. `/docs`, `/rankings`) | Add `test.setTimeout(120_000)` before `goto()`. |
| Dashboard tests fail with auth errors | Missing Clerk credentials | Ensure `infisical run` injects `E2E_CLERK_USER` and `E2E_CLERK_PASSWORD` from `/tests/e2e`. |
| `bun run test:vr` reports dashboard auth failures | The package script globs both visual-regression suites while setting `SKIP_AUTH=true` | Run `RUN_VISUAL_REGRESSION=true SKIP_AUTH=true bunx playwright test suites/visual-regression/public-pages.test.ts` to isolate public coverage. |
| `test:vr:dashboard` fails with `Project ID is required when using machine identity` | Infisical machine authentication needs an explicit project ID | Include `--projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173` when invoking `infisical run` directly. |
| Dashboard script fails with a missing project ID under machine auth | The package script does not pass the Infisical project ID | Run `infisical run --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 --env=dev --path=/tests/e2e -- env RUN_VISUAL_REGRESSION=true bunx playwright test suites/visual-regression/dashboard-pages.test.ts`. |
| Local `/models` snapshot is nearly empty | The local KV-backed model cache has no rows | Inspect the rendered model count before treating a passing or failing snapshot as meaningful. Use a data-backed environment for model screenshots. |

## Files Typically Touched

| File | Change |
|------|--------|
| `tests/web-e2e/suites/visual-regression/*.test.ts` | Add, modify, or remove VR tests |
| `tests/web-e2e/suites/visual-regression/*.test.ts-snapshots/*.png` | Updated baseline screenshots |
| `tests/web-e2e/pages/*-page.ts` | New or modified page objects |
| `tests/web-e2e/utils/fixtures.ts` | Fixture wiring for new pages |
| `tests/web-e2e/utils/screenshot.css` | Global dynamic-content masks |
| `tests/web-e2e/utils/urls.ts` | New page URL constants |
