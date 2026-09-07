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
2. **Local dev instance** — runs `bun run dev web` against the local Postgres with seed data. Better when the screenshot requires cross-page navigation, real auth flows, or data that's hard to mock in a story.

## If the user picks Storybook

**Target: under 1 minute from "user picks Storybook" to screenshot delivered.**

### Setup

1. **Check out the correct branch first.** If the screenshot is for a PR, `git checkout` that PR's branch before launching Storybook.
2. Check if a `.stories.tsx` file already exists for the target component. Search with `find . -name "*.stories.tsx" | grep <component-name>`.
3. If it doesn't exist, create one following the patterns in existing stories (see `packages/frontend/components/ui/` or feature-level stories like `projects/web/features/guardrails/ui/NewGuardrailTakeover.stories.tsx`).

### Launch Storybook

For shared design-system components under `packages/frontend/components/ui`, prefer the dedicated configuration in `packages/frontend/.storybook-ui`: run `bun run storybook:ui --ci` from `packages/frontend` (port **6008**). It loads UI stories and the design-system theme without backend or auth setup. Use port 6008 in the screenshot URLs below for this configuration; use the broader Storybook for feature-level stories.

4. If Storybook is already running on port 6006 (check: `curl -s http://localhost:6006 > /dev/null && echo "up"`), skip to step 7.
5. Kill any stale process to avoid port-conflict prompts: `fuser -k 6006/tcp 2>/dev/null`
6. Launch in a background shell and wait for readiness:
   ```bash
   cd projects/storybook && npx storybook dev -p 6006
   # Wait for "Storybook ready!" in the output before proceeding (~15-30s)
   ```

### Take the screenshot

7. Connect agent-browser if not already connected: `agent-browser connect 29229`
8. **Derive the story ID** from the `.stories.tsx` file: the ID is `<title>--<export-name>` with spaces/slashes converted to hyphens and lowercased. For example, a story with `title: 'Guardrails/New Guardrail Takeover'` and an export named `Default` becomes `guardrails-new-guardrail-takeover--default`. Open it directly: `agent-browser open "http://localhost:6006/iframe.html?id=<story-id>&viewMode=story"` (skips Storybook's sidebar chrome).
9. Set viewport width: `xdotool getactivewindow windowsize $((DESIRED_WIDTH + 32)) 900` (the +32 accounts for Chrome window chrome; verify with `agent-browser eval "window.innerWidth"`). Chrome will not shrink below ~500px, so for a phone width (~390px) open a local HTML file that embeds the story URL in a `<iframe style="width:390px;height:844px">` and screenshot that instead.
10. **Dismiss any Vite error overlays** before screenshotting: `agent-browser eval "document.querySelector('vite-error-overlay')?.remove()"`. These overlays dim the entire page. If one appears, remove it; the story still renders correctly underneath.
11. If you need to navigate the component to a non-default state (e.g., advance a multi-step wizard), use the Desktop computer tool for clicks and typing — `agent-browser eval` won't reliably trigger React synthetic events on controlled inputs.
12. Take the screenshot: `agent-browser screenshot /path/to/file.png`

Wait for a story-specific visible element before capturing (`agent-browser wait 'svg'` or `agent-browser wait --text '<expected label>'`): navigation can finish before the first story render. Preserve a full viewport screenshot; do not crop away context. If checking a component's default prop while its story overrides it, Storybook supports `&args=<prop>:!undefined` (for example, `emptyLabel:!undefined`); verify the resulting pixels instead of assuming a URL override applied.

## If the user picks local dev

1. **Check out the correct branch first.** If the screenshot is for a PR, `git checkout` that PR's branch.
2. **Check seed data** — before running any server, inspect `postgres/seed.sql` and `postgres/seeds/*.csv` to determine whether the page's data requirements are covered. Look at what tables/entities the target page queries and verify matching seed rows exist.
3. If seed data is **missing** for the target surface, **stop immediately** and inform the user. Explain which data is missing and suggest switching to Storybook with mock props instead (or ask if they'd like you to create a story file).
4. Only after confirming seed data exists: run `bun run db:start` then `bun run dev web` (serves on localhost:3000).
5. Navigate to the page and take the screenshot.
