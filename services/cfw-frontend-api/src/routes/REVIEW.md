# Review checklist for route files

Workers Cache sits in front of this worker (opted in via
`[cache] enabled = true` in `wrangler.toml`). `cf-cache-status` headers on
responses come from this layer, not the CDN, so cache behavior changes are
code changes in this worker, not Terraform. Responses from routes built
with `createPublicRouteApp` carry `public` Cache-Control and get cached
globally — **served to every user without re-invoking the worker**.

## The one urgent thing to watch for

**A route that reads caller identity must never be mounted on
`createPublicRouteApp`.** Frontend auth is Clerk *cookies*, and cookies
do not bypass Workers Cache and are not part of the cache key. If a
handler personalizes a response and emits `public` Cache-Control, one
user's data gets cached and served to everyone until it expires.

When reviewing a new or modified route file, flag it if the file (or
any helper it calls) does any of the following while mounting
`createPublicRouteApp`:

- reads Clerk state: `getUserIdFromCookie`, `getUserFromCookie`,
  `clerkMiddleware`, anything from `@openrouter-monorepo/cfw-api/auth/*`
- reads cookies directly: `getCookie` from `hono/cookie`,
  `c.req.header('Cookie')`
- uses auth-gated helpers: `authenticateProviderAccess`
  (provider-dashboard), `adminAuthMiddleware`,
  `requireWorkspaceCapability` (resolves the caller's active workspace
  from the Clerk cookie, so its allow/deny outcome is per user)
- varies the response on any other caller-specific input that is not
  part of the URL (headers, geo, session)

Identity-dependent routes belong under `/api/frontend/v1/private/` on a
`createPrivateRouteApp` leaf. The service root stamps `private, no-store` and
runs Clerk once for that namespace.

A best-effort tripwire exists in
`../helpers/route-privacy-guardrail.test.ts` — it does a substring scan
of route files, so identity reads hidden behind renamed or re-exported
helpers can slip past it. Human/agent review is the real backstop.

Notes:

- Workers Cache does **not** bypass credentialed requests. Under RFC 9111
  a shared cache may store a response to an authenticated request when the
  response carries `public` Cache-Control, so a credentialed request can
  seed a shared cache entry that anonymous callers then hit. Treat
  `Authorization`-header identity exactly like cookie identity.
- Only GET/HEAD responses are cached; `Set-Cookie` responses are never
  cached.
