---
name: core-web-vitals-hunt
description: >-
  Hunt a Core Web Vitals problem in the web app from production Datadog RUM
  field data, ship one narrowly scoped fix, and prove it in the lab and by
  equivalence test before a human reads the PR. Public, indexable routes come
  first because their vitals feed SEO. TRIGGER when: asked to improve LCP, FCP,
  INP, CLS or TTFB, to hunt frontend performance regressions, or run on a
  schedule by the Core Web Vitals automation.
user-invocable: true
last-reviewed: 2026-09-02
---

# Core Web Vitals hunt

Find the highest-value Core Web Vitals problem in `projects/web` from production
RUM, fix exactly one per run, and put the evidence in the PR body so review is
"read the body, skim the diff, merge". Metrics in scope: LCP, FCP, INP, CLS,
TTFB, and the long-task and resource evidence that explains them.

**Public, indexable pages are the priority** — their vitals feed search
ranking. Authenticated pages are in scope but rank behind.

Field data at p75 by route is the truth. A Lighthouse or lab score is
regression detection only and is never presented as field Core Web Vitals
(`projects/web/CLAUDE.md`).

Neighbouring skills: [`debug-prod`](../debug-prod/SKILL.md) for Datadog
conventions, [`next-best-practices`](../next-best-practices/SKILL.md),
[`next-cache-components`](../next-cache-components/SKILL.md),
[`next-loading-skeletons`](../next-loading-skeletons/SKILL.md) and
[`vercel-react-best-practices`](../vercel-react-best-practices/SKILL.md) for the
change itself, [`e2e-testing`](../e2e-testing/SKILL.md) and
[`web-e2e-test-placement`](../web-e2e-test-placement/SKILL.md) for tests,
[`update-visual-regression`](../update-visual-regression/SKILL.md) when a UI
surface moves, [`viz`](../viz/SKILL.md) for the graphic,
[`thermo-nuclear-code-quality-review`](../thermo-nuclear-code-quality-review/SKILL.md)
for the review loop, and [`ask-perry-babysit`](../ask-perry-babysit/SKILL.md) for
the Perry review.

## Datadog RUM access

Site is `us5.datadoghq.com`. Use `$DD_API_KEY` and `$DD_APP_KEY` against
`https://api.us5.datadoghq.com`, and build every user-facing link on
`https://us5.datadoghq.com`. Query RUM through the REST API; the `datadog` MCP
server exposes skill guides and APM change stories, not RUM data. Retry with
backoff on `Too many requests`.

Facts verified 2026-09-02:

- Browser RUM application `openrouter-web`, application id
  `dac3eb8f-42d6-4e2d-a4c1-e6b711a98f50`, `service:openrouter-web`,
  `env:production`.
- Aggregate endpoint is `POST /api/v2/rum/analytics/aggregate` with an
  **unwrapped** body (`{"compute":[...],"filter":{...},"group_by":[...]}`), and
  each compute entry needs `"type":"total"`. A JSON:API-wrapped body is accepted
  but silently ignores `group_by` and every compute after the first. A request
  takes at most 10 computes (`Cannot handle more than 10 computes`), so split
  percentile sets across requests. Buckets come back as
  `data.buckets[].by` / `data.buckets[].computes.c<i>` in compute order. Search
  raw events with `POST /api/v2/rum/events/search`.
- `@type:resource` and `@type:long_task` aggregates grouped by view can come
  back empty even with `trackResources` and `trackLongTasks` on. Try once, then
  place the cost with the view-level facets below instead of chasing them.
- View timing metrics are nanoseconds: `@view.first_contentful_paint`,
  `@view.largest_contentful_paint`, `@view.interaction_to_next_paint`,
  `@view.first_byte`, `@view.dom_interactive`, `@view.time_spent`.
  `@view.cumulative_layout_shift` is unitless.
- `@view.name` is the Next.js route pattern with dynamic segments collapsed
  (set in `projects/web/utils/datadog/config.ts` via `setViewName`), so it is
  the grouping facet. `@view.url_path_group` is Datadog's own grouping and is
  coarser.
- `@view.loading_type` separates `initial_load` from `route_change`. They have
  different causes and are never mixed in one measurement.
- `version` on a RUM event is the deployed commit SHA, which is what makes
  before/after cohorts possible.
- Attribution: `@view.largest_contentful_paint_target_selector` and
  `@view.performance.lcp.target_selector_normalized` name the LCP element;
  `@device.type` and `@geo.country` split the population; `@type:resource`
  events carry `@resource.url_path_group`, `@resource.duration` and
  `@resource.type`; `@type:long_task` events carry main-thread blocking.
  `trackResources` and `trackLongTasks` are on.
- `sessionSampleRate` is 10, so every number comes from a 10% session sample.
  Report view counts alongside percentiles and draw no conclusion from a cohort
  below 200 views.

## 1. Find candidates

Work over the last 24 hours of `env:production`, widening the window only if it
yields nothing. Aggregate p75 of each metric grouped by `@view.name`, split by
`@view.loading_type`, and rank by **population-weighted headroom**: view count
times the p75 excess over the "good" threshold (LCP 2.5s, FCP 1.8s, INP 200ms,
CLS 0.1, TTFB 800ms). A slow route nobody visits is not a candidate; a route
just over threshold with very high traffic can be.

Weight a public route's headroom far above an authenticated one's, and fall
through to signed-in surfaces only when no public candidate clears the bar.
Public means a signed-out visitor and a crawler can reach it — marketing and
content surfaces, model, provider and app pages, rankings, docs-adjacent pages.
Decide by the SSR and indexability rules in `projects/web/AGENTS.md` and by
whether the route is in the sitemap and not `noindex`, not by guessing.

For the top candidates, establish the mechanism before touching code:

- Group by `@view.largest_contentful_paint_target_selector` for the LCP element,
  and by `@device.type` to learn whether the problem is mobile-only.
- Read that view's resource events for blocking requests and its long-task
  events for main-thread blocking.
- Compare `@view.first_byte`, `@view.first_contentful_paint` and
  `@view.largest_contentful_paint` on the same view to place the cost: server
  response, render-blocking assets, or post-hydration data arrival.
- Group by `version` over the last few deploys to separate a standing cost from
  a regression. For a regression, name the commit and read what it changed.

Reject a candidate whose signal is explained by traffic mix (a device, country
or bot population shift), whose cohort is below the 200-view floor, or whose
slow metric is inherent to a signed-in, interaction-gated surface with no
server-renderable content.

When TTFB is the only over-threshold metric, no browser-side change moves it,
and RUM cannot say on its own whether the wait is cache state, render time or
an upstream fetch, because APM has no server spans for this app
(`service:openrouter-web` carries only RUM-forwarded `browser.request` spans).
Read the route's own rendering and caching decisions first, as leads rather
than proof: `force-dynamic` or a request API where ISR would serve shared HTML,
awaited server-side fetches during render, and the revalidation interval are
all `projects/web` mechanisms that can set the first byte, and the public-page
rendering rules in `projects/web/CLAUDE.md` say which ones a route owes. A
short `revalidate` on its own explains nothing, since static output can be
cached indefinitely and ISR serves stale HTML while it regenerates. Promote a
lead to a candidate only with evidence that the affected requests really reach
a blocking render or a cache miss, measured on the deployed route rather than
inferred from config. Absent that evidence it is a rejection, reported with
its `@view.first_byte` percentiles and its share of LCP and left to a
server-latency investigation.

## 2. Diagnose in code

Map `@view.name` to its route under `projects/web/app` and name the mechanism in
this codebase's vocabulary before proposing a change. Recurring ones: primary
content arriving only after hydration on an indexable route, a client fetch
waterfall where a server fetch or prefetch belongs, an oversized or
non-tree-shaken chunk on the critical path, an unoptimized or unsized image as
the LCP element, a render-blocking font or third-party script, a skeleton whose
dimensions differ from the content that replaces it, or hydration work showing
up as long tasks and INP.

Write down what you expect the fix to move, and roughly by how much, before
writing it. If the expected effect is not visible in the mechanism you named,
you have the wrong mechanism.

## 3. Implement one change

One narrowly scoped change per run, in the layer the mechanism lives in, with no
unrelated cleanup. If the best candidate cannot be diagnosed because the data
does not exist (missing attribution, an unnamed view, an uninstrumented
interaction), the run's one PR may instead be the narrowest instrumentation
change that makes it diagnosable next run — say so in the PR body.

## 4. Prove it in the lab

Field data cannot validate an unmerged change, so measure locally against the
same baseline:

1. **Route-level lab measurement.** Measure a production build, never `next dev`
   — dev-mode compilation dominates every timing you care about. Bring the
   backing services up with the `local-dev-env` skill (`tilt-testing` for
   readiness) but leave Tilt's `web` resource down, since it runs `next dev`
   through `projects/web/scripts/dev.ts`. Build `projects/web` with `NODE_ENV=production`
   set explicitly — the Infisical shell carries `NODE_ENV=development`, and a
   build that inherits it fails while prerendering `/404`. Serve that build on
   the port the rest of the stack expects — `next start` ignores `WEB_PORT`, so
   pass it through explicitly (`source .env.worktree` when the checkout has
   one, then `PORT="${WEB_PORT:-3000}" bun run --cwd projects/web start`) — and
   confirm the process answering on that port is the production server before
   recording any number.

   Production mode also turns off the local API proxy: `shouldCheckCorsProxy` in
   `projects/web/middlewares/before-auth.ts` is development- and
   preview-only, so same-origin client API calls do not reach the local workers.
   Check the request log of a measurement run, and when the route's critical
   path depends on those responses, take the reading from the deployed preview
   below instead of the local server.

   Drive the route with Playwright (`tests/web-e2e`, page objects in
   `tests/web-e2e/pages`; a standalone harness imports `playwright-core` from
   the root `node_modules`, not from `tests/web-e2e/node_modules`), cold cache,
   with CPU and network throttling reproducing the device class the field data
   pointed at. Collect FCP, LCP, TTFB, CLS and long-task total per run, at least
   10 runs per side, and report medians with spread. The baseline is `main` at
   the branch point, put through the identical build-and-serve lifecycle in the
   same session.

   Decide the route's critical-path request set before the first run and log
   every request against it: the document, same-origin API and auth calls the
   LCP element depends on, and the scripts and fonts that paint it. Third-party
   telemetry beacons, speculative `_rsc` prefetches for other routes, and 3xx
   hops with a `Location` header are not critical-path failures; a critical
   request that fails, or one that is still pending at LCP, invalidates the run.
   Without this list the harness reports "a request failed" on every run and no
   reading can be accepted.
2. **Bundle and payload delta** when the mechanism is asset weight: the size
   change of the affected chunks, and the count and bytes of critical-path
   requests.

A lab result whose direction disagrees with the named mechanism blocks the PR —
investigate instead of shipping it.

Add the `preview` label to the PR so the Vercel preview deploys
(`.github/workflows/preview-vercel.yaml` gates deployment on that label), and
measure the preview URL the same way against production for a
deployed-artifact reading. A preview attaches only public frontend-api paths,
proxied to production (`shouldProxyPathname` in
`packages/frontend/middlewares/utils.ts`); private frontend-api paths and other
worker prefixes are not reachable there either. So before accepting any reading,
local or preview, check the run's requests against the critical-path set defined
above and discard the measurement if one of those failed — a route whose critical path needs
an unattached API cannot be measured in this lab, and the run's evidence has to
rest on the mechanism and payload deltas instead.

Run `bun run verify` plus the scoped tests for what you touched, and the visual
regression suite when a UI surface moves. A single `projects/web` DOM test runs
as `bun test --preload ./bun-test.dom-setup.ts <file>` from `projects/web`;
without the preload Bun treats the path as a filter and the DOM environment is
missing. Authenticated VR suites need a working `sign-in` flow against the local
stack — when `playwright_global_setup_auth_failed` appears, the snapshot did not
run, so do not report it as passed. When `verify` fails only outside the diff,
reproduce the same failure on `main` and report it with that evidence rather
than fixing unrelated files in a performance PR.

## 5. Prove equivalence

The page must behave identically. Prove it with an integration or e2e test
pinning the behavior a reader could plausibly lose to this change, or with a
recorded video of the route working end to end when the change is visual or
interaction-level. Both on a risky change. A change with no equivalence proof
does not ship. Rendering a shared component in a second place (a stencil and
the real surface) needs a test that the copy appears exactly once per state,
not just that it appears.

## 6. Review loops before the human

Run the [`thermo-nuclear-code-quality-review`](../thermo-nuclear-code-quality-review/SKILL.md)
→ fix loop to a maximum of four rounds, recording every finding as fixed,
rejected with a reason, or out of scope. Then hand the PR to Perry with
[`ask-perry-babysit`](../ask-perry-babysit/SKILL.md), which posts to `#agents`.
Both happen before a human reads the PR.

## 7. The PR

Before writing code, search open and closed PRs for the affected route, the
symbols you would touch, and the marker line below; skip the candidate if an
existing PR already covers it. One PR per run.

Fetch the repo PR template and include:

- **TL;DR** — the mechanism and the expected field effect in two or three
  sentences.
- **What changed** — the diff in prose, plus the one line reviewers should stare
  at.
- **Why** — the RUM evidence: the pinned window with explicit
  epoch-millisecond bounds, view counts and p75s per cohort, the LCP element or
  blocking resources, and a copy-pasteable RUM query plus a
  `us5.datadoghq.com` link for each claim. State the 10% sampling caveat.
- **Field success criteria** — the primary metric, the `version` cohorts to
  compare after deploy (the before SHA and the merge SHA), the improvement
  threshold that counts, the minimum view count for a conclusive read, and the
  guardrails that would show the change traded one metric for another (the
  route's other vitals, error rate, and adjacent routes' metrics).
- **Lab proof** — harness, throttling profile, run counts, medians and spread
  for both sides, and the bundle delta.
- **Equivalence proof** — the test or the video, and what it would have caught.
- **Visualization** — one graphic showing the change at a glance, drawn under
  the `viz` rules. Rasterize it, since GitHub strips inline SVG, and embed the
  raster.
- **Thermo-nuclear fix loop** — each round's findings and their dispositions.
- **Perry review** — the outcome.
- **CI** — any failure, with evidence for whether it also fails on `main`.
- The marker line `rum-perf-candidate: <view name> <metric> <mechanism>` so
  later runs can find this work.

Attribute nothing you did not measure, keep observed, inferred and unverified
claims distinct, and include counterevidence you found.

## 8. Report

Post one summary to the channel the invoking automation or user names: the
candidate, whether it is public or authenticated, the mechanism, the expected
effect, the PR link, and the field query to check after deploy. If the run found
nothing worth a PR, post that instead with the ranked candidates you rejected
and why. Never open a PR just to have something to show.

## Improve this skill

Record what the run taught you: a RUM facet or endpoint quirk that cost time, a
mechanism that recurred, a candidate class that always turns out to be a dead
end, a threshold that proved wrong. Keep it at the level of what to check next
time, not the details of one route.

Candidate classes seen so far:

- Authenticated client-rendered routes (`/chat`, `/settings/*`) whose LCP
  element is static copy inside a loading stencil. The fix is to render that
  copy in the stencil, and the lab can only prove the DOM delta, since the
  stencil-to-content transition needs private frontend-api paths.
- Public routes whose p75 TTFB is dominated by a single geography or bot cohort
  — check `@geo.country` and `@session.type` before trusting the headroom.
