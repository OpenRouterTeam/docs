## Shared data layer

Mission Control uses the same TanStack Query data-layer contract as Web and
shared frontend packages. Before defining or consuming reads, mutations, keys,
options factories, prefetches, or cache updates, read and follow both:

- [`../../packages/frontend/data-layer/AGENTS.md`](../../packages/frontend/data-layer/AGENTS.md)
  for implementation conventions and rationale.
- [`../../packages/frontend/data-layer/REVIEW.md`](../../packages/frontend/data-layer/REVIEW.md)
  for the review checklist.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
