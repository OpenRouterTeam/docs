# Route Review Checklist

## Workers Cache and `public` Cache-Control

Workers Cache sits in front of this worker (opted in via
`[cache] enabled = true` in `wrangler.toml`). `cf-cache-status` headers on
responses come from this layer, not the CDN, so cache behavior changes are
code changes in this worker, not Terraform. Responses stamped with the
shared `public` Cache-Control (`setPublicCacheControl` /
`PUBLIC_CACHE_CONTROL` from `src/helpers/public-cache-control.ts`) get
cached — **served to every caller on the same host without re-invoking the
worker**. `Vary: Host` keeps regional hostnames isolated.

**A route that reads caller identity must never stamp the public
header.** If a handler personalizes a response (via `getUser`, cookies,
provisioning keys, or any other caller-specific input not part of the
URL) and emits `public` Cache-Control, one caller's data gets cached and
served to everyone on that host until it expires.

Flag a new or modified route file if it (or any helper it calls) both
stamps `public` Cache-Control and:

- reads identity: `getUser` from `@/auth/get-user`, provisioning-key
  auth, `getCookie` from `hono/cookie`, `c.req.header('Cookie')`
- varies the response on caller-specific headers, geo, or session state

Identity-dependent routes keep the app-level `private, no-store`
default (or their existing explicit `private` header).

A best-effort tripwire exists in
`../helpers/route-privacy-guardrail.test.ts` — it does a substring scan
of route files, so identity reads hidden behind renamed or re-exported
helpers can slip past it. Human/agent review is the real backstop.

Notes:

- Workers Cache does **not** bypass credentialed requests. Under RFC 9111
  a shared cache may store a response to an authenticated request when the
  response carries `public` Cache-Control, so a credentialed request can
  seed a shared cache entry that anonymous callers then hit. Treat
  `Authorization` and `x-api-key` identity exactly like cookie identity.
- Public stamping must go through the guarded helpers
  (`setPublicCacheControl` / `publicCacheHeaders`), which skip stamping
  when the request carries `authorization` or `x-api-key`. Flag any code
  that spreads `PUBLIC_CACHE_HEADERS` directly — it bypasses the guard.
  The guard checks only those two headers, not cookies, so a route that
  reads cookie identity still needs its own review per the rules above.
- Only GET/HEAD responses are cached; `Set-Cookie` responses are never
  cached.

## Datadog monitoring for new routes

When adding or modifying API routes, register them in the `api_error_rate` Terraform module at `configs/terraform-monitors/monitoring/api_error_rate.tf`.

This gives you **traffic-gated error rate monitors** (no false alarms on low volume) and **auto-generated dashboards** for free.

### How to add

Add your routes to an existing group or create a new one in the `route_groups` list:

```hcl
{
  name          = "my-feature"
  display_name  = "My Feature API"
  slack_channel = "alerts-enterprise"   # optional, default "alerts-api"

  routes = [
    {
      method       = "POST"
      path         = "/api/v1/my-feature/action"
      display_name = "Do Action"
      error_monitors = [
        {
          name           = "5xx"
          include_status = "5*"
        }
      ]
    }
  ]
}
```

Routes without `error_monitors` still appear on the group dashboard — you only need `error_monitors` for routes you want alerting on.

### Do NOT create standalone monitor modules

Standalone log-based monitors lack traffic gating and false-alarm on low volume. Always use the `api_error_rate` rails.
