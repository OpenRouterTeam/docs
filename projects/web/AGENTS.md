# App Route Conventions

## SEO metadata contract

Enforced by `app/seo-canonical-metadata.test.ts` (canonical) and
`app/seo-sitemap-membership.test.ts` (sitemap). Route-level
SEO policy lives in `@openrouter-monorepo/seo/route-policy` — the
single source of truth shared with the runtime SEO monitors under
`tests/web-e2e`.

**Every page is either in the sitemap or noindex. There is no third state.**

| State | Declared by |
| --- | --- |
| Indexable and discoverable | self-referential canonical + an entry in `app/sitemap.ts` |
| Not ready, private, or not worth ranking | `shouldNotIndex` in the page's (or the area's layout's) metadata |

The rule exists because "indexable but unlisted" is not a decision anyone can
read later. Keeping a page out of the sitemap does not keep it out of search:
the sitemap is a discovery hint, so an unlisted page is still crawlable and
indexable through any link to it. A page nobody chose to advertise and nobody
declared unfit for search is simply an unanswered question.

A new page that is neither listed nor noindex fails
`app/seo-sitemap-membership.test.ts` in CI, naming the route. Pick one:
add it to `app/sitemap.ts`, or declare noindex.

When adding or changing a page:

- **Indexable page** — set a self-referential canonical in its metadata:

  ```ts
  createMetadata({
    ...,
    alternates: { canonical: '/your-path' },
  });
  ```

  `createMetadata` derives `og:url` from the canonical; omitting it renders
  no `<link rel=canonical>` and points `og:url` at the site root. For dynamic
  routes, build the canonical from the route params (see
  `app/(marketplace)/[maker-id]/[slug]/model-page-metadata.ts`). Add the page to
  `projects/web/app/sitemap.ts` if it should be discovered via the sitemap.

  If the canonical is set inside a shared metadata helper rather than in the
  route's own files, add the helper's name to `CANONICAL_HELPERS` in
  `app/seo-canonical-metadata.test.ts` — the lint looks for a literal
  `canonical:` key and otherwise flags the route.

- **Page that should not be found** — anything not ready to publish, private,
  or with no server-rendered substance to rank on (lead-capture forms,
  sign-in-gated tools, experiments, superseded legal versions) — declare
  noindex in its own metadata, or in the area's layout so every nested route
  inherits it. Note that `'use client'` alone is not that test: a client
  component is still rendered into the first-pass HTML, so a page whose copy
  is static and whose data arrives after mount does have something to rank on.

  ```ts
  export const metadata: Metadata = {
    robots: { index: false, follow: false },
  };
  ```

  or `shouldNotIndex: true` in a `createMetadata` call. Do NOT maintain any
  hardcoded route list for this — both lints derive exemption from the
  declaration. Note that only a **layout** propagates metadata to nested
  routes; a `metadata.ts` is re-exported by the one page beside it, so a
  content-only MDX subtree (the legal archives) needs its own
  `archive/layout.tsx` to inherit noindex.

- **Indexable page whose URL is not a stable identity** (a per-run output, a
  share link, a page resolving an external URL) — add a justified entry to
  `CANONICAL_EXEMPT_ROUTES` in `packages/seo/route-policy.ts`. That exempts
  the canonical only; the page still owes a sitemap entry or noindex, and
  stale entries fail the lint.

- **Page in a family the sitemap builds by interpolation** (`/rankings/<modality>`)
  — declare the path prefix in `SITEMAP_INTERPOLATED_PREFIXES`. The lint reads
  the sitemap as source, so it cannot see URLs assembled from data.

- **New high-value root page** (e.g. a `/benchmarks`-style launch) — no
  monitor change needed: the weekly production smoke check tests every root
  page in the live sitemap (and samples each dynamic route family), so it is
  covered automatically once it enters the sitemap.

## Page-level SEO principles

Apply these when creating a page; when editing an existing page, only add
what is missing — do not change existing meta titles/descriptions, alt text,
or FAQ copy unless explicitly asked.

- **Meta title + description** on every page, written for the queries users
  and AI agents actually search — no keyword stuffing.
- **Descriptive alt text** on every image.
- **Semantic structure**: exactly one `h1`, `h2` for major sections, `h3`
  within them; `<section>`/`<nav>`/`<footer>`, `<p>`, `<ol>`/`<ul>`.
- **Internal links** to related OpenRouter pages with descriptive link text
  (never "click here").
- **Sitemap inclusion**: add indexable pages to `app/sitemap.ts`; for large
  dynamic families, include only the most valuable URLs (see existing
  patterns there).

## FAQ pattern

FAQs are a deliberate SEO investment — for any page where users have real
recurring questions (pricing, programs, product/entity pages), consider
adding an FAQ section, and consider it for relevant new pages going forward.

- **Static pages**: define a `FaqItem[]` and render it with the shared
  accordion `app/(static)/shared/FAQAccordion.tsx` (see `app/(static)/pricing`,
  `app/(static)/learn/LearnFaq.tsx`, the `app/(static)/startups` family).
- **Entity pages**: follow the model-page pattern —
  `app/(marketplace)/[maker-id]/[slug]/ModelFaqSection.tsx` renders the list and
  emits `FAQPage` JSON-LD via `buildFaqPageJsonLd` + the shared
  `components/seo/JsonLd` component so the questions are eligible for rich
  results.
- Answers should be real prose (linking to relevant pages), not marketing
  filler; skip the section entirely when there are no genuine questions.

## SEO/AEO principles

- **SSR is the source of truth**: rankings and citations come from visible,
  server-rendered first-pass HTML. Structured data must match visible content
  and supports meaning only; it cannot promise Google rich results, AI Overview
  inclusion, or LLM citations from schema alone. Google generally limits
  `FAQPage` rich results to government and health sites, so FAQ JSON-LD is
  semantic reinforcement, not a rich-result promise. The
  `tests/web-e2e` SEO crawl smoke tests enforce the first-pass HTML contract.
- **Dataset markup must be truthful**: use `Dataset` only when a real, stable
  dataset identity exists, including observations, public accessibility, update
  cadence or temporal coverage, methodology or harness version, license, and
  actual distribution. Never invent `distribution`, `license`, or
  `isAccessibleForFree`. Dataset markup targets Google Dataset Search and
  entity grounding for LLMs, not Search rich results.
- **Crawler policy is nuanced**: distinguish search/retrieval crawlers
  (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`) from training crawlers
  (`GPTBot`, `ClaudeBot`). `Google-Extended` controls certain Gemini uses,
  not Google Search or AI Overviews. Training-access decisions belong to
  Legal/Marketing; do not add bot-specific `robots.ts` rules ad hoc. The
  current policy record is `app/robots.ts`: allow all, disallow `/seo/`, and
  point crawlers to the sitemap.
- **Launch discovery**: Google's sitemap ping endpoint is deprecated; never add
  it. Publish SSR content, update sitemaps and internal hubs, use IndexNow for
  supported engines (not Google), request indexing manually in GSC only for
  exceptional launches, and monitor in GSC.
- **Performance**: Lighthouse is lab-only regression detection. Real Core Web
  Vitals come from field data (GSC, CrUX, or RUM) at p75 by route family; do not
  cite Lighthouse scores as field CWV.
- **Shared structured data**: reuse `components/seo/JsonLd.tsx` and its
  `serializeJsonLd` renderer, plus the `schema.ts` builders for
  `Organization`, `WebSite`, `BreadcrumbList`, and `CollectionPage`. New
  JSON-LD must use the shared renderer/serializer, and each new builder gets a
  colocated test, following the repository test convention.

## Public page rendering

- **Server-render every public-facing splash page.** Any indexable public
  route (home, model catalog and detail pages, rankings, apps, discover,
  collections, providers, marketing/static pages) must include its primary
  content — the rows, names, and numbers a visitor or crawler comes for — in
  the first-pass server HTML. Do not gate primary content behind
  `dynamic(..., { ssr: false })`, a client-only wrapper, or a fetch that
  resolves only after hydration; a skeleton in first-pass HTML is acceptable
  only for genuinely personalized or interaction-dependent surfaces.
- **Follow the server-fetch pattern** in
  `app/(marketplace)/providers/fetch-providers-listing.ts`: server-side fetch
  of the private frontend API, successful-result-only cache, awaited in the
  RSC, real rows rendered. Auth- or user-dependent variants layer on
  client-side over the SSR'd public default view. `/providers` remains
  `force-dynamic` and will migrate separately.
- **Use ISR for public indexable listing routes.** Set an explicit `revalidate`
  so HTML is served from the shared cache instead of re-rendering per request.
- **Pair route caching with a successful-result-only data cache.** The
  `unstable_cache` callback must throw on error so transient upstream failures
  are retried rather than stored, following the "Don't cache transient lookup
  failures" rule in `projects/web/REVIEW.md`.
- **Keep guarded routes statically prerenderable.** Routes listed in
  `projects/web/scripts/verify-static-routes.ts` must not use `force-dynamic`
  or server-side request APIs such as `searchParams`, `cookies`, or `headers`.
- **Bound the server payload for first paint.** The `/models` route passes a
  bounded 20-row `initialListing` to the client list, while the client query
  owns the authoritative full listing. Keep this partial projection out of
  the shared TanStack Query cache so it cannot be mistaken for complete data.
- **Data reads use TanStack Query via the shared data layer**
  (`packages/frontend/data-layer/AGENTS.md`). Do not add SWR usage.

## DOM tests

- Run `bun run --cwd projects/web test::dom` for web DOM tests.

## Responsive and mobile conventions

Some of the mobile experience is rendered by mobile-only components that never
appear in the desktop DOM tree, so a desktop check or a search of the desktop
render will not surface them. Every change therefore has to be exercised at
both a phone width (~390px) and a desktop width.

- **Use a mobile-specific surface when responsive CSS is not enough.** For
  example, the section navigation renders a `lg:hidden` sticky dropdown
  alongside its `hidden lg:block` sidebar
  (`packages/frontend/components/SectionNav/SectionNav.tsx`), the dashboard
  and Fusion run pages provide mobile drawer components (`MobileSidebar`,
  `MobileRunDrawer`), and `TaskSpendChart` renders a purpose-built
  one-category-at-a-time treemap below its breakpoint. When you add a nav
  entry, a control, or a section, verify the mobile surface as well.
- **Prefer responsive CSS that collapses to one column** (the rankings tables
  and leaderboards do this). Reach for a distinct mobile presentation only when
  a visualization is too dense to read or tap when narrowed.
- **Never satisfy a narrow viewport with a fixed-width, horizontally scrolling
  chart or table.** A `min-w-*` inside `overflow-x-auto` hides the content
  rather than adapting it; scope the minimum width to `md` and up and restack
  below it. Absolutely positioned labels and axis ticks need the container to
  keep horizontal room for them once the plot is full-width.
  When a dense multi-series time-series chart would be unreadable at a phone
  width, keep it full-width and reduce the data instead — default narrow
  viewports to a shorter time range (the model-page pricing chart defaults
  to 3D below `lg`), cap tooltip items, and let the chart's own reduced tick
  count carry the rest.
- **`hidden md:*` is only for content that is genuinely redundant on a phone**,
  such as a section subtitle whose heading already carries the meaning. Data,
  controls, and navigation need a mobile equivalent.

## Pricing display conventions

- Route pricing displays through the shared semantics in
  `components/pricing/display-pricing.ts` and the field-to-unit metadata in
  `packages/helpers/pricing-line-items.ts`. The important shared decisions are
  the display unit and whether the model is actually free, not numeric
  formatting.
- Zero legacy token prices do not prove that a model is free. Image and video
  endpoints can carry their real prices in display pricing while those legacy
  fields remain zero. The endpoint free flag identifies a free variant or
  stealth model, so it must not be treated as authoritative in both directions.
- Legacy token fields remain valid inputs for ranking, sorting, filtering, and
  billing. These conventions govern presentation only.
- Compare is intentionally separate where its tier selection, blended pricing,
  and slash separator differ from the generic display helpers. Do not add
  caller-specific flags to force those semantics together.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
