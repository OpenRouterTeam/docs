# packages/seo

Single source of truth for site-wide SEO policy (route canonical
exemptions, sitemap smoke priorities) and the pure helpers the SEO checks
are built from. See `README.md` for the module map and consumers, and
`projects/web/AGENTS.md` for the route-level SEO conventions this
package backs.

## Conventions

- **Keep this package dependency-free and framework-agnostic.** Helpers
  here operate on strings/data only — never on a live DOM, Next.js, or
  Playwright. Next/React-coupled metadata helpers belong in
  `packages/frontend`; Playwright runners, retries, and e2e-only check
  types stay in `tests/web-e2e`.
- **Every page is in the sitemap or noindex.** There is no indexable-but-
  unlisted state, and no list to park one in: a page that should not be found
  declares noindex, which both lints derive from the declaration. Do not
  reintroduce a sitemap exemption map to silence the membership lint.
- **Policy changes are product decisions.** Every `CANONICAL_EXEMPT_ROUTES`
  entry needs a justification and covers the canonical only, never sitemap
  membership; the build-time lint fails on stale entries.
- **Root pages are covered automatically.** The weekly production smoke
  check tests every root page in the live sitemap plus a small
  frontier-preferring sample of each dynamic route family — a new root only
  needs to enter the sitemap. Tune coverage via the `SITEMAP_SMOKE_*`
  constants in `route-policy.ts`.

## Drift detection (`drift.ts`)

- **Accepting an intentional SEO change is `bun run seo:baseline`**, run
  against production, then commit the regenerated
  `tests/web-e2e/seo-baseline.json`. Never hand-edit the baseline: it is a
  record of what production served, and editing it to match a local
  expectation is how a rule silently stops protecting a page.
- **Compare JSON-LD by shape, not by value.** Model pages embed prices and
  token counts in their schema, so a value hash would change on most deploys
  and the rule would be muted within a month. Each block is fingerprinted as
  `@type{sortedTopLevelKeys}`. Losing a block is critical, the same block
  losing a key is a warning, and comparisons are counted so a page dropping
  from two `Product` blocks to one still reports a removal.
- **Never widen a rule's severity to silence a noisy page.** Add a per-page
  entry to `SEO_DRIFT_EXEMPTIONS` in
  `tests/web-e2e/utils/seo-drift-policy.ts` with the reason the value is
  genuinely volatile. Critical rules are deliberately not exemptable.
- **A new snapshot field needs a capture guard.** Every rule no-ops when its
  baseline field is absent, so a field whose absence disables a critical rule
  must also be rejected by `findSeoCaptureProblems` in
  `tests/web-e2e/utils/seo-baseline.ts`, or a degraded capture will quietly
  become the expected state. Tolerate an absent field only where the crawl
  suite already records the gap via `pending` in `seo-urls.ts`, so the
  tolerance retires with the gap rather than outliving it.
- **Canonical and `og:url` are relativized against the origin under test**, so
  one baseline works anywhere the app emits its own host and a URL on another
  host reads as drift. A preview deploy is only comparable if `metadataBase`
  resolves to the preview host, which is why the suite refuses to run when the
  baseline origin is not the origin under test.
- **Core Web Vitals and Lighthouse deltas are deliberately out of scope.**
  They need field measurements this suite does not collect.
