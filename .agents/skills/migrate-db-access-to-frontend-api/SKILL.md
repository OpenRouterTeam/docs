---
name: migrate-db-access-to-frontend-api
description: >-
  Playbook for OPE-5618: migrating projects/web server actions
  and RSC loaders that call @openrouter-monorepo/db directly
  onto cfw-frontend-api private routes + the TanStack
  data-layer. Covers the backend route port (auth parity,
  error handling, schemas), integration tests, the client
  queries.ts swap, converting RSC loaders to client reads,
  deletion of the old path, and verification.
user-invocable: false
---

# Migrate direct DB access to cfw-frontend-api

Playbook for the **Stateless Frontend** sub-epic
[OPE-5618](https://linear.app/openrouter/issue/OPE-5618)
(child issues OPE-5619..OPE-5634): every `projects/web`
server action (`'use server'`) or RSC page/loader that
imports a query-executing `@openrouter-monorepo/db/**/queries`
helper moves behind a `cfw-frontend-api` private route, and
the web caller switches to the shared TanStack data-layer.

Reference implementations:

- **PR #29444** (notification settings) — first full
  server-action migration: backend port + web `queries.ts` +
  deletion, including the shared-util extraction pattern.
  Notification-settings paths cited below (the
  `packages/frontend/notification-settings` wrapper, the
  `NotificationsApp.tsx` loader split) ship with that PR.
- **PR #28397** (guardrails) — the client-side TanStack
  pattern (`queries.ts`, `queryOptions`, `useAPIMutation`).
- `services/cfw-frontend-api/src/routes/migrated/api-key-labels.ts`
  and `presets.ts` — the route-definition style to copy.

## Architecture target

```
projects/web (client components)
  useQuery(<thing>Options) / useAPIMutation   ← TanStack data-layer
        │
        ▼
  /api/frontend/v1/private/<domain>   ← cfw-frontend-api (CF Worker)
        │
        ▼
  @openrouter-monorepo/db/**/queries  ← Kysely, unchanged
```

- **All data fetching goes through the TanStack data-layer
  from client components** — including surfaces that are RSCs
  today. An authenticated page whose loader queries the db is
  converted to a client read as part of the migration, not
  ported RSC-to-RSC: a server-side fetch keeps the page
  `force-dynamic` (a billed server render per navigation) and
  keeps the Next server in the data path, defeating the
  stateless-frontend goals (static client shells, running the
  local app against prod APIs). The one carve-out is public
  SEO surfaces — see "RSC surfaces" in Step 4.
- In dev, the web middleware proxies `/api/frontend/v1/`
  to `FRONTEND_API_DEV_PORT`
  (`packages/frontend/middlewares/utils.ts`), so the same
  relative URL works locally (Tilt) and in prod.
- **Never** add routes to `cfw-api` — it is frozen. New
  private routes go in `services/cfw-frontend-api`.
- The Kysely queries themselves do not move. The route
  imports the existing `packages/db` helpers; only the
  *caller* changes.

## Step 0 — Audit the surface

For the domain's `actions.ts` / `*-sa.ts` / `page.tsx`:

1. List each read (→ GET) and mutation (→ POST).
2. Record the auth contract. For server actions this is the
   `withContextSA` options
   (`packages/frontend/server-actions/context.ts`):
   `requiredRole`, and whatever `ctx.user` fields the handler
   uses. The new route must enforce **equivalent** checks —
   this is an acceptance criterion.
3. Record the exact response shapes and error statuses the
   UI branches on (e.g. a meaningful 400 vs a masked 500).
   Parity here is what the integration test asserts.
4. Identify pure transform logic living inside the action —
   it moves to a shared package in Step 1, not into the
   route handler.

## Step 1 — Extract shared logic and break the db import

- Pure aggregate/transform functions move next to the schema
  they operate on (e.g.
  `packages/db/<domain>/aggregate.ts`), exported from the
  domain's index, **with unit tests** and with their original
  JSDoc preserved (those comments usually explain non-obvious
  storage semantics).
- `projects/web` must not import from
  `@openrouter-monorepo/db` at runtime after the migration
  (type-only imports are fine). When the client needs Zod
  schemas at runtime, add a schema-only re-export wrapper:
  `packages/frontend/<domain>/index.ts` re-exporting from
  `@openrouter-monorepo/db/<domain>/schema`. See
  `packages/frontend/notification-settings/index.ts`.

## Step 2 — Port the backend route

New file:
`services/cfw-frontend-api/src/routes/<domain>/route.ts`.

The `migrated/` folder is vestigial from an earlier NextJS HTTP-route migration
and is being retired. New routes follow the established per-route-subdirectory
convention (`<domain>/route.ts`), not a flat file and not `migrated/`. The
sibling examples `api-key-labels.ts`, `presets.ts`, and
`provider-preferences.ts` still live under `migrated/` for now.

### Sub-app and registration

```ts
import { createPrivateRouteApp } from '../../helpers/create-private-route-app';

const app = createPrivateRouteApp();
// ...register routes...
export const <domain>Routes = app;
```

`createPrivateRouteApp` returns an inert leaf router — `app.ts` owns the
private namespace middleware once at `/api/frontend/v1/private/*`
(restricted CORS + `Cache-Control: private, no-store` + Clerk). Then
mount the leaf in its domain's `index.ts` — `app.ts` only composes
domain routers (see `services/cfw-frontend-api/src/routes/AGENTS.md`):

```ts
.route('/private/<domain>', <domain>Routes)
```

Every mount must also be classified in
`services/cfw-frontend-api/src/workspace-endpoint-capabilities.ts`
— usually `AVAILABLE_IN_ALL_MODES`, or under a `WorkspaceCapability`
with `requireWorkspaceCapability` mounted on the route app (see that
file's header comment for the shared-prefix key shape). A colocated
completeness test fails CI on an unclassified mount, so this is
mandatory per route, not a follow-up.

Append each migrated private route path to the migrated list in
`configs/terraform-monitors/monitoring/cfw_frontend_api_migration.tf`;
add explicitly never-migrated private routes to its unmigrated list, and use
the dashboard's unregistered-routes widget to check both lists.

### Route definitions: use `createRoute`, not plain handlers

Match the directory standard (`api-key-labels.ts`,
`presets.ts`, `provider-preferences.ts`): typed
`createRoute({ hide: true, ... })` definitions with named
request/response Zod schemas and `...errorResponses`,
registered via `app.openapi(route, handler)`, with the
handler typed as
`RouteContext<typeof route>` from
`@openrouter-monorepo/cfw-api/utils/hono-route-context`.
Do not add plain `app.get('/', (c: Context) => ...)`
handlers — they skip the response-schema contract and typed
context every other migrated route has.

- Responses use the `{ data: T }` envelope — the client's
  `fetchAPIQuery` unwraps exactly this shape.
- Zod schema constants are `PascalCase`; use `zInt()` /
  `zDouble()` instead of bare `z.number()`.
- Routes are `hide: true` (internal), so OpenAPI examples are
  optional; if the lint rule complains, see the
  `oxlint-disable openrouter/require-openapi-examples` header
  in `migrated-guardrails.ts`.

### Auth

Choose the cheapest helper that covers the handler's needs
(both from `@openrouter-monorepo/cfw-api/auth/...`):

- `getUserIdFromCookie(c)` → `{ entityId, userId, orgId?,
  orgRole? }` — sufficient for most handlers.
- `getUserFromCookie(c)` — only when the handler needs the
  full user record / guardrails.

Role parity with `withContextSA({ requiredRole })`: the old
helper enforced the role **only for org contexts** (personal
accounts pass). The equivalent gate is:

```ts
if (userResult.data.orgId && userResult.data.orgRole !== OrganizationRole.Admin) {
  return forbidden403Err(c, 'You have insufficient role permissions for this action');
}
```

`OrganizationRole` currently has only `Member < Admin`, so
`!== Admin` is exact parity for `requiredRole: Admin` only —
for any other `requiredRole` (e.g. `Member`) this gate would
wrongly 403 org Members. Prefer the dedicated cookie helpers
below over re-extracting the gate; `hasRequiredRole`
(`packages/orgs/helpers/has-org-access.ts`) is the general
solution only when no cookie helper fits (see caveat below).
Each helper resolves the cookie identity and applies the role
gate in one call:

- `requireAccountAdminFromCookie`
  (`../../helpers/require-account-admin-from-cookie`) for
  `requiredRole: Admin`.
- `requireAccountMemberFromCookie`
  (`../../helpers/require-account-member-from-cookie`) for
  `requiredRole: Member` (Member-or-higher; the classifiers
  migration in PR #32686 uses this one).

`hasRequiredRole`
(`packages/orgs/helpers/has-org-access.ts`) takes a
`UserContextNoAnalytics`, not the cookie result, so it is not a
drop-in for a cookie route — reach for it only if a future
`OrganizationRole` value has no dedicated cookie helper (you'd
then pair it with `getUserFromCookie`).

### Error handling — never swallow the `ErrorT`

The single most common review finding. `internalServer500Err`
/ `badRequest400Err` **do not log**; returning them alone
drops the `ErrorT`'s `location`/`rawError`/`internal` context
that the old `errSA` path used to log via `inspectErrorT`.

- Default: `return toHonoErrorResponse(c, result.error)` —
  it calls `inspectErrorT` internally, masks 500 details from
  the client, and **forwards meaningful non-500 statuses**
  (e.g. a db-layer 400 with a useful message) instead of
  flattening them.
- If you need a custom client-facing message or status, log
  first (`eLog`/`wLog` with `error_message`/`error_location`,
  or `inspectErrorT`), then return the `*Err` helper — see
  `presets.ts` for the `eLog` + `internalServer500Err` shape.
- Parse request bodies with
  `wrap(() => c.req.json<unknown>())` then
  `parseSchema(Schema, body)`; either failure →
  `badRequest400Err`. Never call `c.req.json()` unguarded.
  (`api-key-labels.ts` predates this rule and does — copy the
  `wrap(() => c.req.json())` pattern from
  `test-content-filter.ts` instead.)

## Step 3 — Integration test

New file:
`services/cfw-frontend-api/integration/<domain>.test.ts`.
Follow the cfw integration conventions
(`services/cfw-api/integration/AGENTS.md`):
`SELF.fetch` from `cloudflare:test`, real Postgres, production
Zod schemas for assertions, status **and** body checks,
`Date.now()` nonce for IDs, `createTestUser` helpers.

Auth is already mocked in `integration/vitest.setup.mts`
(`getUserIdFromCookie` is a `vi.fn()`); set per-test values
with `vi.mocked(getUserIdFromCookie).mockResolvedValue(ok({...
} satisfies CookieUserIdData))`. Beware the
`mockResolvedValueOnce` queue-leak gotcha documented in that
rule file.

Minimum matrix (auth parity is the point of the test):

1. **Org admin** happy path — full read/write round trip.
2. **Personal account** (no `orgId`) happy path — the role
   gate must not fire.
3. **Org non-admin** → 403 with body assertion.
4. **Unauthenticated** (mock returns `errT` 401) → 401.
5. **Invalid payload** → 400 (for POST routes).
6. Any domain-specific error the old action surfaced
   distinctly (e.g. db-layer validation 400s).

## Step 4 — Client migration (TanStack data-layer)

Read `packages/frontend/data-layer/AGENTS.md` and `README.md`
first — they are the authoritative conventions (options
factories, destructuring, Result-native mutations). Summary
of the per-domain work:

Create one `queries.ts` for the domain:

- **Placement** (governing rule from `data-layer/AGENTS.md`:
  "colocated with the feature that owns it" — that doc is the
  source of truth if this summary drifts):
  - The domain already has a `features/<domain>/` home
    (e.g. guardrails) → `features/<domain>/queries.ts`.
  - The feature's components live entirely in one app route
    directory and no other surface consumes its keys
    (settings-style leaf pages, e.g. notification settings)
    → colocate `queries.ts` in that route dir. Creating
    `features/<domain>/` just to hold one `queries.ts` would
    split the feature across two directories, defeating the
    principle. Consistency comes from the fixed `queries.ts`
    filename and the workspace-unique `createQueryKeys`
    namespace, not the directory.
  - **Promotion trigger**: the moment another surface needs
    the domain's query keys — an org switcher invalidating
    them, a dashboard widget reading them — importing keys
    from deep inside `app/(user)/(dashboard)/...` is the
    smell. Move the domain (keys and queries together) to
    `features/<domain>/` at that point.
- `createQueryKeys('<domain>', ...)` — the namespace is the
  cache partition and must be workspace-unique. **Include the
  entity id in the key** for any per-entity data, so org
  switches repartition the cache.
- Reads: a `queryOptions` factory named `<thing>Options`
  calling `fetchAPIQuery(route, { signal, schema, searchParams })`.
  Pass the response `schema` — new surfaces validate at
  runtime. Call sites use plain `useQuery(<thing>Options(id))`.
- Mutations: `useAPIMutation({ mutationFn, invalidates })`
  where `mutationFn` is a Result-native `fetchJsonResult`
  POST to the same route. `invalidates` is required and
  references keys from the same `queries.ts`. Call sites
  destructure and rename:
  `const { mutate: saveThing, isPending: isSaving } = ...`,
  then `await` the Result and branch with `isErr`.
- `DataLayerProvider` is mounted at the web root — do not mount another.

For components whose local state is derived from the fetched
data, key the subtree on the entity id (or split into a
loader component + a form component receiving `savedSettings`
as props, as `NotificationsApp.tsx` does) so `useState`
initializers re-run on entity switch.

### RSC surfaces

Default: **convert, don't port.** If the domain's UI is an
RSC only because its loader queried the db, move the read
into a client component using the same `queries.ts` as above
(the page becomes a static shell rendering a client
component). Most authenticated dashboard/settings surfaces
fall here.

The exception is a **public page where server-rendered HTML
or metadata materially matters** (SEO surfaces like
marketplace model/author pages). Those stay RSCs and replace
the direct db call with `fetchPublicInternalJsonApi` from
`@openrouter-monorepo/frontend/utils/fetch-internal-api`,
unwrapping the `{ data: T }` envelope and validating with the
shared schema — see
`projects/web/app/(marketplace)/[maker-id]/fetch-author-page-data.ts`.
An *authenticated* RSC read (`fetchInternalApi`, cookie
forwarding) should be rare enough to justify in the PR
description — it keeps the page force-dynamic and the Next
server in the data path.

## Step 5 — Delete the old path

- Delete the server action file (or the db-calling section
  of the RSC loader) and its imports.
- Remove the migrated file's entry from
  `scripts/oxlint/frontend-db-import-baseline.ts`. The
  `openrouter/no-direct-db-imports-in-frontend-entrypoints`
  rule grandfathers baseline paths so the burndown can land
  incrementally; an entry left in after its file is migrated
  silently exempts it, so a re-introduced db import in that
  file would not fail lint. Each migration removes its own
  entries.
- Verify the acceptance criterion for the domain:

```bash
grep -rn "@openrouter-monorepo/db" projects/web/<domain-paths> \
  | grep -v "import type"
```

should return nothing that executes queries. `bun run lint`
enforces the same check at PR time for any non-baseline
frontend entrypoint.

## Step 6 — Verify

1. `bun run typecheck` and `bun run lint` at the repo root.
2. Unit tests for extracted helpers (`bun:test`, colocated).
3. Route integration tests:
   `cd services/cfw-frontend-api && bun run test:integration`.
4. E2E through the local Tilt stack (cfw-frontend-api + web):
   walk the domain's reads and mutations in the browser;
   network tab shows `/api/frontend/v1/private/<domain>` and
   no server-action POSTs to the old path.
5. Parity check against the audit from Step 0: same data
   shapes, same error statuses, same role gating.
6. Re-run after every push, not just at PR creation.

## Gotchas

- **Silent 500s**: any `isErr` branch that returns a bare
  `internalServer500Err(c)` without logging is an
  observability regression vs `errSA` — see Step 2.
- **Flattened 400s**: db-layer helpers often return
  `errT({ status: 400 })` with specific messages
  (per-field validation, membership checks). Forward them via
  `toHonoErrorResponse` rather than replacing with a generic
  message, unless the old action also masked them.
- **Envelope**: route returns `{ data: T }`; `fetchAPIQuery`
  unwraps it for reads, but a mutation's `fetchJsonResult`
  call must declare and unwrap the envelope itself.
- **Query keys without the entity id** serve stale
  cross-entity data after an org switch.
- **`hide: true` still means schemas**: internal routes skip
  the public OpenAPI spec but keep typed contracts — don't
  use plain Hono handlers.
- **Migration-only diff**: don't reformat or restructure
  unrelated code in the domain while porting it.
- **`updateUserUnchecked` and friends resolve `ok(null)`** when
  the `WHERE` clause matches no row. A success response must
  prove a row was written, so treat `null` as a logged, masked
  500 rather than forwarding the old action's silent success.
- **Moving a KMS/GCP call into the worker moves the identity**:
  the worker's credential is a different service account than
  the Next.js server's, so the prod IAM grant on the key ring
  has to be confirmed by a human with GCP access before merge.
  Local Tilt proves the code path, not the prod grant.
