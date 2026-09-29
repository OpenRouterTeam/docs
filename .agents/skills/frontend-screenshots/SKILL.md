---
name: frontend-screenshots
description: Take a screenshot of a frontend change on a PR or branch — covers asking Storybook vs local dev first, story IDs, viewport sizing, and the seed-data check
user-invocable: true
---

# Taking frontend screenshots

This skill applies **only** when the screenshot is tied to a PR or branch (e.g. "screenshot this PR", "show me what the change looks like", "grab a screenshot of the new component"). For general screenshots of existing production pages (e.g. "screenshot the profile page", "show me the settings page"), just navigate to the live site and take the screenshot directly.

## For PR/branch screenshots: ask first

Present a `user_question` with two options. **You must list both options with their descriptions in the message body text itself** (don't rely solely on interactive buttons rendering):

1. **Storybook** — renders the component in isolation with mock data, starts in seconds with no backend/auth/seed dependencies, and the story file persists as living documentation for anyone who needs screenshots later.
2. **Local dev instance** — uses [local-dev-env](../local-dev-env/SKILL.md) with local Postgres and seed data. Better when the screenshot requires cross-page navigation, real auth flows, or data that's hard to mock in a story.

## If the user picks Storybook

**Target: under 1 minute from "user picks Storybook" to screenshot delivered.**

### Setup

1. **Check out the correct branch first.** If the screenshot is for a PR, `git checkout` that PR's branch before launching Storybook.
2. Check if a `.stories.tsx` file already exists for the target component. Search with `find . -name "*.stories.tsx" | grep <component-name>`.
3. If it doesn't exist, create one following the patterns in existing stories (see `packages/frontend/components/ui/` or feature-level stories like `projects/web/features/guardrails/ui/NewGuardrailTakeover.stories.tsx`).

### Launch Storybook

For shared design-system components under `packages/frontend/components/ui`, prefer the dedicated configuration in `packages/frontend/.storybook-ui`: run `bun run storybook:ui --ci` from `packages/frontend` (port **6008**). It loads UI stories and the design-system theme without backend or auth setup. Use port 6008 in the screenshot URLs below for this configuration; use the broader Storybook for feature-level stories.

4. If Storybook is already running on port 6006 (check: `curl -s http://localhost:6006 > /dev/null && echo "up"`), skip to step 7.
   After a branch switch or rebase, if rendered output disagrees with checked-out source, restart Storybook and hard-refresh Chrome before recording final evidence; fresh navigation alone may still reuse stale transforms.
5. Kill any stale process to avoid port-conflict prompts: `fuser -k 6006/tcp 2>/dev/null`
6. Launch in a background shell and wait for readiness:
   ```bash
   cd projects/storybook && npx storybook dev -p 6006
   # Wait for "Storybook ready!" in the output before proceeding (~15-30s)
   ```

### Take the screenshot

7. Connect agent-browser if not already connected: `agent-browser connect 29229`
8. **Derive the story ID** from the `.stories.tsx` file: the ID is `<title>--<export-name>` with spaces/slashes converted to hyphens and lowercased. For example, a story with `title: 'Guardrails/New Guardrail Takeover'` and an export named `Default` becomes `guardrails-new-guardrail-takeover--default`. Open it directly: `agent-browser open "http://localhost:6006/iframe.html?id=<story-id>&viewMode=story"` (skips Storybook's sidebar chrome).
   Stories that render production components using `nuqs` must wrap the story in `NuqsAdapter`; otherwise resolved stories fail during render with the adapter-required error.
9. Prefer `agent-browser --session <name> set viewport 390 844` (or `1280 900`) and verify `innerWidth` / `innerHeight`; CDP viewport emulation supports phone widths without resizing Chrome. Maximize Chrome and bring the tested tab to the foreground before recording; the emulated viewport may occupy only part of the window. Use `--pin-tab` when other agents share the CDP browser so measurements and screenshots stay on the tested page. Native-window fallback: `xdotool getactivewindow windowsize $((DESIRED_WIDTH + 32)) 900`; Chrome will not shrink below ~500px.
10. **Dismiss any Vite error overlays** before screenshotting: `agent-browser eval "document.querySelector('vite-error-overlay')?.remove()"`. These overlays dim the entire page. If one appears, remove it; the story still renders correctly underneath.
11. If you need to navigate the component to a non-default state (e.g., advance a multi-step wizard), use the Desktop computer tool for clicks and typing — `agent-browser eval` won't reliably trigger React synthetic events on controlled inputs.
   For state-transition fixes, first confirm the story uses the production state-owning hook: a preview with independent `useState` can verify static visuals but cannot prove production recovery/reset behavior (for example, `KeySafetyTable.stories.tsx` in Security Center).
12. Take the screenshot: `agent-browser screenshot /path/to/file.png`

Without `agent-browser`, headless Chrome works: `google-chrome --headless=new --no-sandbox --hide-scrollbars --window-size=<w>,<h> --virtual-time-budget=30000 --screenshot=<file> "<iframe url>"`. The first load of a story runs Vite's dependency optimizer and can capture only the loading spinner, so warm each story with one throwaway run before collecting final evidence.

Wait for a story-specific visible element before capturing (`agent-browser wait 'svg'` or `agent-browser wait --text '<expected label>'`): navigation can finish before the first story render. Preserve a full viewport screenshot; do not crop away context. If checking a component's default prop while its story overrides it, Storybook supports `&args=<prop>:!undefined` (for example, `emptyLabel:!undefined`); verify the resulting pixels instead of assuming a URL override applied.

For intentionally empty stories, wait for the mounted decorator under `#storybook-root` and verify it has no component children or text; an initial blank loading canvas is not evidence. At phone widths, measure the story root's width as well as `innerWidth`: fixed-width decorators inside Storybook's centered layout can overflow despite `max-w-full` (e.g. `ApiKeyOriginCard.stories.tsx`, PR #45399). Report fixture clipping separately from production responsiveness; do not silently crop or restyle the evidence.

For expanded-list clipping checks, first measure `scrollHeight > clientHeight`: a 14-row benchmark fixture can fit completely at 900px viewport height. Also test a shorter viewport (for example 720px) to exercise actual wheel scrolling, then verify the final row is fully visible and `scrollTop + clientHeight >= scrollHeight - 2`.

For entitlement-gated UI, set the feature in `localStorage` under `devpanel.entitlement-overrides` on the Storybook origin (for example `{"workspace_budgets":true}`) and reload. See `packages/frontend/hooks/entitlement-overrides-storage.ts`. Storybook evidence is fixture-backed: a correct link href does not prove the destination route works.

## If the user picks local dev

1. **Check out the correct branch first.** If the screenshot is for a PR, `git checkout` that PR's branch.
2. **Check seed data** — before running any server, inspect `postgres/seed.sql` and `postgres/seeds/*.csv` to determine whether the page's data requirements are covered. Look at what tables/entities the target page queries and verify matching seed rows exist.
   For authenticated settings routes, verify seeded organization/entity membership first. Require route-specific rows only when the requested screenshot is meant to show populated data. If the route supports a loaded empty or default state, that state is valid without optional notification, SSO, audit-log, or deployment rows.
3. If seed data is **missing** for the target surface, **stop immediately** and inform the user. Explain which data is missing and suggest switching to Storybook with mock props instead (or ask if they'd like you to create a story file).
4. Start with [local-dev-env](../local-dev-env/SKILL.md) and use the web URL reported by Tilt.
5. Navigate to the page and take the screenshot.

### Mission Control authentication fallback

- Shared `projects/storybook/.storybook/main.ts` discovers Mission Control stories; run `bun run storybook --no-open` in `projects/storybook` for port 6006. If authorized to fall back after an admin sign-in blocker, render the actual component with explicitly labeled fixture inputs and report queue/detail navigation as untested, not as covered by the story.
- For Sentinel data checks, inspect the CLI's resolved target: `scripts/sentinel/ban-candidates.ts list` without `CFW_INTERNAL_URL` can query production while local Mission Control proxies to `localhost:8794`. A successful CLI listing does not establish that the local worker database has those cases.

#### Devin Secrets Needed

- Fixture-only Storybook rendering requires no secrets. Authenticated Mission Control setup uses `INFISICAL_CLIENT` and `INFISICAL_SECRET` through the documented local-dev workflow; a Clerk ticket that returns `needs_second_factor` still requires an authorized second factor.

### Benchmark hub and media benchmark pages

- `/benchmarks` and the media benchmark pages (Images, Videos, Speech, Memes, Sketch, Games) need no sign-in and no Statsig override. VGI-Bench (`vgiBench`) remains gated. To reveal its hub entry, enable it through the dev-panel override in localStorage `devpanel.statsig-gate-overrides` (`projects/web/app/statsig/StatsigGateOverrideAdapter.ts`). This client-only override does not open `/benchmarks/vgi-bench`; that route also requires the server-side Statsig gate to pass.
- `/benchmarks/routers` is also gated. Its hub entry uses the client-side `routerBenchmarks` gate, while the route requires the corresponding server-side gate to pass.
- The Sketch, Games, and Memes landing and challenge routes read from `cfw-frontend-api`, so they render the 404 page without the Tilt stack. To screenshot them without Tilt, run the web app with `DEV_USE_PROD_FRONTEND_API=true CFW_FRONTEND_API_URL=https://openrouter.ai`, which loads public production challenge data. Local seeded slugs (`postgres/seeds`) are then absent, so use slugs that exist in production. The `benchmarks-explore-mediabenchmarknav--artifact-tabs` story covers the nav title, subtitle, and tabs only.

### Provider dashboard report verification

- `packages/provider-dashboard-demo` supplies data, not a standalone dashboard. Check provider ownership in `postgres/seeds/providers_rows.csv` as well as the signed-in account before expecting a seeded provider route to be reachable.
- When a fixture fallback is authorized, mount the real `ProviderReportButton` from `projects/web/app/[locale]/(marketplace)/provider/[name]/dashboard/ProviderMonthlyReportButton.tsx` plus the shared `Toaster`. Intercept only the report request, return the shape in adjacent `provider-report-csv.ts`, and restore fetch on unmount.
- Use a delayed successful response, rejected fetch, and malformed JSON to verify both disabled controls and loading recovery. Inspect downloaded CSV bytes as well as the success toast; a toast alone cannot prove BYOK blanks, subtraction, metadata, or filenames.
- Public/authenticated dashboard VR suites do not necessarily cover provider-owner dashboards. Inspect their routes before treating a green run as feature coverage. Keep fixture screenshots explicitly labeled and report live API integration as untested.

### Guardrails and request-error detail screenshots

- Guardrails are workspace-scoped. `/settings/guardrails` returns a 404; navigate to the workspace first, then open its Guardrails page. To check a policy preview without saving, open the existing Workspace Guardrail → Sensitive Info Detection. A new guardrail wizard can require an API-key assignment before it reaches the policies step. Under Test Your Patterns, toggle Email address and type sample input: Redact renders the preview span, and Flag renders the detected-label span. Don't save a policy when you only need its preview.
- `/logs` opens on Generations. To exercise `RequestDetailSheet.tsx`, switch to **Upstream Requests**. The raw-response disclosure renders only for a failed request that has stored provider-error metadata; a successful generation doesn't render it. If you have permission to seed local data, insert a ClickHouse `endpoint_requests` row whose creator, entity, generation, and workspace IDs match the authenticated account, then store an ERROR observation in the local private-prompt RustFS bucket. `GcsBucket` and `gcsKeyFullJSON` in `packages/prompt-storage/gcs/index.ts` define the bucket and key shape, `packages/prompt-storage/gcs/client.ts` shows the write path, and `packages/prompt-storage/gcs/extract-prompt-log-error.ts` defines the payload contract. Confirm the bucket exists before writing.
- For Datadog privacy changes, assert the DOM attribute in addition to taking screenshots. A readable screenshot doesn't prove that replay masking works, and a zero count of unprotected nodes proves nothing unless you first confirm the sensitive nodes are rendered.
