---
name: seo-ssr-content-guardrails
description: >-
  Guardrails for SEO/AEO changes that add or alter server-rendered content
  on public pages in projects/web (crawlable tables, answer capsules,
  summaries, JSON-LD companions). Covers the visible-vs-hidden decision,
  the mandatory full-page desktop and mobile screenshots, the design
  parity check against the existing UI, and the human sign-off required
  before merge. TRIGGER when a change touches a public route under
  projects/web/app/[locale]/(home), (marketplace), or (static) for
  crawlability, answer-engine coverage, structured data, or first-pass
  HTML content.
user-invocable: true
---

# SEO / AEO server-rendered content guardrails

Content added so a crawler can read it is still content every visitor
sees. Treat any SSR addition on a public page as a product UI change
first and an SEO change second.

## 1. Decide, per section: visible or visually hidden

Before writing code, classify every new server-rendered block:

- **Visible.** The block earns its place for a sighted visitor on its
  own. It must then match the design of the interactive UI it sits
  next to: same row component or same column set, same icons and
  logos, same number formatting, same spacing. A plain text table
  beside a designed leaderboard is not acceptable.
- **Visually hidden.** The block repeats data the client UI already
  shows (behind a tab, a chart, a "show more", or a hover). Render it
  with `className='sr-only'` so it is in the first-pass HTML without
  changing the rendered page. Prefer this whenever the interactive UI
  is the canonical view. `sr-only` is not invisible: screen readers
  announce it, so give it a `<caption>` or heading that names it as a
  summary of the interactive view, keep it short, and make sure it
  does not duplicate labels the interactive UI already exposes to
  assistive technology. Do not use a collapsed `<details>` for this;
  its `<summary>` is visible UI and falls under the visible rules.
- **Time-bounded summaries.** When a hidden block picks "the latest complete day/week" from a public API series, judge completeness against the timestamp the response carries (the rankings chart routes return `cachedAt`), not `new Date()` at render. An ISR regeneration and the Workers Cache entry behind it can sit on opposite sides of a period boundary, and the summary must describe the data it was built from.

State the classification for each block in the PR description. If you
cannot decide, ask in the PR before implementing.

## 2. Screenshot the whole page, both viewports

Above-the-fold and viewport-only snapshots miss content stacked below
existing sections. For every affected route:

1. Capture desktop (1280 wide) and mobile (390 wide) **full-page**
   screenshots of the page with the change applied, following
   [frontend-screenshots](../frontend-screenshots/SKILL.md) for setup.
   With `agent-browser`, pass `--full`.
2. Capture the same two shots on `main` for the same route.
3. Put all four in the PR description under `How to test`, labelled
   before/after, desktop/mobile.

A PR with no full-page screenshots is not ready for review.

## 3. Verify the crawler view separately from the visual

```bash
curl -A Googlebot http://localhost:3000/<route> | grep -i '<expected text>'
```

Confirm the expected rows or numbers are in the first-pass HTML. Run
this against a production build as well as the dev server; streaming
and suspense boundaries can differ between the two. This is a separate
check from the screenshots and does not replace them.

Production-build checks:

- Start `next start` with `DEV_USE_PROD_FRONTEND_API=true`, otherwise public `/api/frontend/v1` fetches target a local worker that is not running and every model page renders the noindex not-found shell (`model_lookup_failed` in the server log).
- A route that rendered the shell once stays `x-nextjs-cache: STALE` until its ISR window passes. Re-request it after the fix before reading the HTML.
- The local build rewrites the gitignored next-env.d.ts in projects/web with a `next/navigation-types/compat/navigation` reference, which types `usePathname()` as `string | null` and fails `bun run typecheck` in untouched files. Remove that reference line before re-running typecheck locally. CI does not have it.

## 4. Human sign-off on the visual

Before merging a change with any **visible** block:

1. Post a PR comment that names the surface, links the after screenshots, and @-mentions the product or design owner of that surface. Do not post sign-off requests in Slack.
2. Wait for an explicit approval from that owner on the PR. Agent review (Devin Review, Perry) does not count.

Visually hidden changes need no design sign-off, but the screenshots
must still show no visible difference, and the PR must state what a
screen reader will announce.

## 5. Keep the change reversible

- Keep every new SSR block in its own component file so a revert is a
  clean deletion.
- Files under `projects/web/app` are in fallow's `browser` zone and may not value-import `packages/db/**/index.ts` or other `server-packages` modules, even where an older interactive component beside yours does (those imports are baselined). Reimplement the display rule (for example the `>999%` change cap) with `@openrouter-monorepo/i18n` formatters, and prove parity in the colocated test rather than by import.
- Do not weave SSR content into the interactive component's markup.
- If the VR suite covers the route, regenerate baselines per
  [update-visual-regression](../update-visual-regression/SKILL.md)
  and inspect the diff images. A VR pass with no baseline change on a
  route where you added visible content means the snapshot did not
  see it; say so in the PR.

## PR description checklist

- Per-block classification (visible / visually hidden) with the reason.
- Four full-page screenshots (before/after x desktop/mobile).
- The `curl -A Googlebot` command and what it should match.
- Link to the sign-off PR comment for visible blocks.
