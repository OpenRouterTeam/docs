# New HTTP Routes Do Not Belong Here

**All new HTTP endpoints should be added to `services/cfw-frontend-api`, not to
this Next.js `app/api/` directory.**

`cfw-frontend-api` is a Cloudflare Worker (Hono) that serves read-only frontend
data to `projects/web` and `projects/mission-control`. It reads from KV caches
warmed by `cfw-api` and falls back to the database when KV is unavailable. Routes
benefit from edge caching, admin auth middleware, and CORS handling out of the
box.

## Why?

- **Performance** -- Cloudflare Workers run at the edge with sub-millisecond cold
  starts. Next.js API routes run on a single-region Node server.
- **Separation of concerns** -- Keeps the Next.js app focused on SSR/RSC and
  avoids mixing data-fetching infrastructure into the rendering layer.
- **Consistency** -- All frontend data routes live in `cfw-frontend-api`, so
  callers, auth middleware, and caching have one home.

## What lives here today?

Only the Statsig bootstrap routes below and a dev-only `dev/intern-chat` route
remain under `app/api/`. Do not use them as a pattern to follow.

**Exception:** `app/api/frontend/statsig-bootstrap` and
`app/api/frontend/statsig-customer-bootstrap` are intentionally here, not in
`cfw-frontend-api`. They run the `@statsig/statsig-node-core` napi native
module against a process-resident ruleset singleton, neither of which can load
in `workerd`. See the route headers for the full rationale.

## Where to add your route

1. Create your handler in `services/cfw-frontend-api/src/routes/`.
2. Register it per `services/cfw-frontend-api/src/routes/AGENTS.md` — leaf
   routes mount in their domain's `index.ts`, not directly in `app.ts`.
3. See `services/cfw-frontend-api/README.md` for architecture details and
   existing route examples.

If you have questions, ask in #eng-frontend.
