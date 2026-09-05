# cfw-frontend-api routes — agent guide

Registration, layout, and naming rules for this directory.
[`REVIEW.md`](./REVIEW.md) owns the privacy and caching review rules; this file
owns where a route lives and what it is called.

## Registration

`src/app.ts` mounts only domain routers, one per line — every leaf route is
registered inside its domain's `index.ts` with one `.route()` call per leaf.
`src/app.test.ts` enforces this: a leaf mounted on the app fails the build. Add
a new route to the domain router that owns its URL prefix; add a new domain only
when no existing one does.

That test also fails when a route module in this tree is unreachable from
`app.ts`. An unregistered route serves no traffic and no import error says so,
so if it names your new file, mount it in its domain's `index.ts`.

Domain routers and private leaf routers are plain `OpenAPIHono` instances with
no shared middleware of their own. `src/app.ts` owns the private namespace
middleware once at `/api/frontend/v1/private/*`; `createPrivateRouteApp` only
creates an inert leaf router. This keeps composition from multiplying Clerk,
timing, caching, or timeout middleware when several domain routers match a
request. Public routes retain their leaf-app factory.

Registration order is behavior when two paths can match the same request. Keep
literal segments registered before the parameterized siblings they would
otherwise be captured by, and keep the comment explaining why:

```ts
/* BEFORE the `:internId` routes: `archives` is a literal segment. */
.route('/private/interns/archives', workspaceArchivesRoutes)
.route('/private/interns/:internId/archives', internArchivesRoutes)
```

## File layout

The tree mirrors the URL. One directory per leaf route:

```text
src/routes/<domain>/<resource>/
  route.ts                 # route definitions + app, exports <camelResource>Routes
  <resource>-handler.ts    # handler logic
  <resource>-schemas.ts     # Zod request/response contracts, when shared
  *.test.ts                # colocated, moves with the route
```

Flat `src/routes/<resource>.ts` files are legacy; convert one to a directory
when you touch it. Shared auth and context helpers live in `src/helpers/`
(e.g. `src/helpers/require-account-admin-from-cookie.ts`) and shared
middleware in `src/middlewares/` — never copied per domain.

## Naming

URLs:

- kebab-case resource nouns: `/user/api-keys`, not `/getApiKeys` or
  `/get_api_keys`.
- no verbs for reads: `/user/api-keys`, not `/user/get-api-keys`. The
  provider-dashboard `get-*` segments are grandfathered; do not copy them.
- verbs are fine for RPC-style actions that are not a resource read:
  `/apply`, `/reprovision`, `/retry-enqueue`.
- no `-private` suffix under `/private/` — the prefix already says it. Existing
  `*-private` paths are grandfathered.
- never rename a registered path. Frontend `fetchAPIQuery` callers hardcode
  these strings, so a rename is a client-contract change, not a refactor.

Symbols:

- route modules export `<camelResource>Routes` (`apiKeysRoutes`), domain
  indexes export `<camelDomain>Routes` (`providerDashboardRoutes`).
- handlers are `<action><Resource>Handler` (`listApiKeysHandler`,
  `createGuardrailHandler`).
- schemas are colocated as `<resource>-schemas.ts`.
