## Route placement

Mission Control server actions call `cfw-internal` via `cfwInternalFetch`
(`utils/helpers/cfw-internal-fetch.ts`). Do not add private `cfw-frontend-api`
routes for MC-only data — `cfw-frontend-api` serves the web app only.

## Frontend conventions

Shared frontend guidelines — design tokens, state ownership, layout, and
native-`<form>` submission for text-entry surfaces — live in
[`../../packages/frontend/AGENTS.md`](../../packages/frontend/AGENTS.md) and
apply here.

Before any UI change, read [`../../DESIGN.md`](../../DESIGN.md) and build from the primitives in `packages/frontend/components/ui/` instead of hand-styling elements. The shared guide's Design system rule lists the common bypasses and their replacements.

## Shared data layer

Mission Control uses the same TanStack Query data-layer contract as Web and
shared frontend packages. Before defining or consuming reads, mutations, keys,
options factories, prefetches, or cache updates, read and follow both:

- [`../../packages/frontend/data-layer/AGENTS.md`](../../packages/frontend/data-layer/AGENTS.md)
  for implementation conventions and rationale.
- [`../../packages/frontend/data-layer/REVIEW.md`](../../packages/frontend/data-layer/REVIEW.md)
  for the review checklist.

## Integration tests

`bun run test:integration` runs `integration/` against real local Postgres using the shared DB integration preload. Ordinary test shards exclude that directory; the Postgres CI workflow runs it separately. Keep route tests on the real auth wrapper and DB queries, using only seeded local identities at the middleware-output boundary.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
