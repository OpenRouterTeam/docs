# @openrouter-monorepo/oidc

Generic OIDC token verification for authenticating
internal service requests, and a hono middleware
for those internal services to authenticate such requests.

## How it works

The middleware routes incoming requests by the JWT's `iss` claim:

- **Vercel callers** — Vercel mints OIDC tokens automatically.
  `@vercel/oidc` handles retrieval and refresh in Vercel apps. The service
  verifies tokens via `createRemoteJWKSet` against Vercel's public JWKS endpoint,
  then validates `owner`, `project` and `environment`
  claims against explicit allowlists.

- **Non-Vercel callers (e.g. Cloud Run)** — callers fetch a Google OIDC
  identity token from the GCP metadata server. The service verifies these
  tokens against Google's public JWKS endpoint and validates the `aud` claim
  and caller email against explicit allowlists. Enabled by supplying a
  `googleOidc` config to `createOidcMiddleware`.
