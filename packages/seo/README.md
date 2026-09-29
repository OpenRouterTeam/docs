# @openrouter-monorepo/seo

Source of truth for site-wide SEO policy, plus the pure helpers the SEO
checks are built from. If you are deciding whether a page should be
indexable, canonicalized, in the sitemap, or monitored — the answer lives
(or belongs) here.

## Modules

- `route-policy.ts` — route-level SEO policy registry:
  - `CANONICAL_EXEMPT_ROUTES`: indexable routes owing no canonical because
    the URL they serve is not a stable page identity (each entry justified;
    stale entries fail the lint);
  - `SITEMAP_INTERPOLATED_PREFIXES`: path prefixes whose members the sitemap
    builds from data, so a source-level check cannot see them;
  - `SITEMAP_SMOKE_FAMILY_SAMPLE_SIZE` / `SITEMAP_SMOKE_PREFERRED_AUTHORS` /
    `SITEMAP_SMOKE_EXCLUDED_PREFIXES` / `MAX_SITEMAP_SMOKE_URLS`: tunables
    for the weekly production smoke check (all sitemap roots, plus a small
    frontier-preferring sample per dynamic route family);
  - `SITEMAP_FRESHNESS_WATCHES` / `SITEMAP_SWEEP_*` /
    `SITEMAP_LASTMOD_FUTURE_SKEW_HOURS` /
    `SITEMAP_RENDER_TIME_WINDOW_MINUTES`: thresholds for the weekly
    full-sitemap sweep (which surfaces owe a fresh `<lastmod>`, concurrency,
    transient tolerance, URL-count floor);
- `html.ts` — pure first-pass-HTML extractors (canonical, `og:url`, robots
  noindex, title, meta description, H1s/H2s, OG properties, hrefs, JSON-LD,
  tables with their body row counts) used by the runtime SEO monitors.
- `drift.ts` — snapshot + diff layer behind drift detection
  (`buildSeoSnapshot`, `diffSeoSnapshots`): turns a page's HTML into a
  comparable snapshot and classifies each difference against a baseline as
  critical (canonical/schema/H1/title/status), warning (title, description,
  schema shape, `og:url`, OG tags), or info (schema added, H2 structure,
  counts-only meta descriptions, body hash).
- `sitemap.ts` — sitemap smoke-URL selection (deterministic, per-family
  capped).
- `sitemap-integrity.ts` — classifies one probed sitemap URL as missing,
  redirected, server-error, throttled, unreachable or unexpected, names a
  `<loc>` that is not a URL at all (`findMalformedSitemapUrls`), and decides
  whether a sweep's findings should fail (`shouldFailSitemapSweep`): dead,
  malformed and redirecting URLs never tolerated, a few origin blips
  tolerated.
- `sitemap-freshness.ts` — holds the sitemap's own `<lastmod>` dates to
  account: unreadable and future dates, a watched surface whose newest date
  stopped advancing, a watched surface that stopped publishing dates or all
  but vanished from the sitemap, and dates generated at render time rather
  than at content change.
- `indexnow.ts` — IndexNow submission shape (`buildIndexNowSubmission`,
  same-host filtered and capped) and the URL set affected when an endpoint
  goes live (`buildEndpointGoLiveUrls`).

## Consumers

- `projects/web/app/seo-canonical-metadata.test.ts` — build-time lint:
  every indexable route must set a self-referential canonical. Private
  areas declare `robots: noindex` in their own layout and are derived, not
  listed. See `projects/web/AGENTS.md` for the conventions.
- `projects/web/app/seo-sitemap-membership.test.ts` — build-time lint:
  every static route is in the sitemap, under a declared interpolated
  prefix, or declares noindex. There is no indexable-but-unlisted state.
- `tests/web-e2e/suites/seo-crawl` — weekly production crawl over the
  curated URL matrix (`tests/web-e2e/utils/seo-urls.ts`).
- `tests/web-e2e/suites/seo-drift` — weekly baseline diff over the same
  matrix, against the committed `tests/web-e2e/seo-baseline.json`.
- `tests/web-e2e/suites/seo-sitemap` — weekly sitemap-seeded canonical
  smoke check.
- `scripts/check-sitemap.ts` — weekly full-sitemap integrity + freshness
  sweep (every `<loc>`, no browser), run by
  `.github/workflows/seo-sitemap-integrity-weekly.yaml`.
- `packages/db/endpoints/indexnow-notify.ts` — pings IndexNow when an
  endpoint flips `hidden` true → false; the key it submits is served by
  `projects/web/app/indexnow-key.txt`.

Conventions for changing this package live in `AGENTS.md`.
