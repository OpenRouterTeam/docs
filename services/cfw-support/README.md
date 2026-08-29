# cfw-support

Dedicated Cloudflare Worker serving the Support Agent Internal API — the tenant-scoped
investigation, refund, and account-lockdown endpoints used by OpenRouter's AI support
agents. Split out of `cfw-internal` so the support surface has its own deployment,
secrets, and authentication boundary.

The worker serves two sibling route namespaces so each can sit behind its own
Cloudflare Access application:

- `/api/v1/internal/support/read` — investigation endpoints
- `/api/v1/internal/support/write` — guarded mutations (lockdown, refund)

## Endpoints

Read (`/api/v1/internal/support/read`):

| Route | Purpose |
| --- | --- |
| `GET /user` | Look up a customer by email or entity id (the `clerk_user_id` param accepts `user_...` or `org_...`) |
| `GET /user/{entityId}/generations` | List generations for an entity |
| `GET /generation/{generationId}` | Single generation detail |
| `GET /generation/{generationId}/trace` | Full trace for one generation |
| `GET /user/{entityId}/usage-breakdown` | Usage by model/time |
| `GET /user/{entityId}/errors/summary` | Error counts by type |
| `GET /user/{entityId}/errors/details` | Individual error rows |
| `GET /user/{entityId}/payment-status` | Payment investigation: money events (payments/refunds/chargebacks), payment-method blocks with card detail, Stripe references |
| `GET /user/{entityId}/credit-ledger` | Credit history |
| `GET /user/{entityId}/key-activity` | Per-key usage (leaked-key detection) |
| `GET /user/{entityId}/security-signals` | Anomaly signals (IP spread, spikes) |
| `GET /user/{entityId}/account-state` | Live state read at request time: auto top-up trigger, Clerk identity booleans for a user, Clerk-vs-our-database roster and seat usage for an org |

Write (`/api/v1/internal/support/write`):

| Route | Purpose |
| --- | --- |
| `POST /user/{entityId}/refund` | Support refund with caps, reservations, and audit notes |
| `POST /user/{entityId}/lockdown` | Account containment: disable all keys, disable auto top-up, revoke sessions |

## Authentication

Production requests must come through one of two Cloudflare Access applications:

- **support-read** on `openrouter.ai/api/v1/internal/support/read` — Service Auth
  policy containing read and write service tokens (write-holding agents investigate
  before they contain)
- **support-write** on `openrouter.ai/api/v1/internal/support/write` — Service Auth
  policy containing only write service tokens

Each AI agent holds its own Access **service token** (`CF-Access-Client-Id` /
`CF-Access-Client-Secret` headers). The Access edge validates the pair and replaces
it with a signed `Cf-Access-Jwt-Assertion` JWT minted for that application's AUD.

The worker then independently verifies that JWT (signature against the team JWKS,
issuer, expiry, RS256 only, and the audience matching the request's namespace) via
`@openrouter-monorepo/oidc/verify-cf-access-token`, so callers that bypass the edge
(e.g. service bindings) are still rejected, and a read-application JWT replayed at a
write route fails audience validation. The verified `common_name` claim — the service
token's Client ID — is the audit identity used for rate limiting, metrics, refund
notes, and lockdown audit logs. The `X-Agent-Id` header is never trusted in production.

Authorization is capability-based and fails closed. Each verified identity maps to
capabilities via comma-separated allowlists; an identity on none of the lists is
rejected with 401 even when its service token is admitted by an Access policy, and
an unset list grants that capability to nobody. Lockdown and refund identities
implicitly also get read; lockdown does not imply refund or vice versa.

Required worker vars (Infisical path `/services/cfw-support`):

- `CF_ACCESS_TEAM_DOMAIN` — `https://<team>.cloudflareaccess.com` (JWT issuer; JWKS at `<team-domain>/cdn-cgi/access/certs`; the env schema rejects other shapes)
- `CF_ACCESS_AUD_READ` — AUD tag of the support-read Access application
- `CF_ACCESS_AUD_WRITE` — AUD tag of the support-write Access application
- `SUPPORT_AGENT_ALLOWLIST_READ` / `SUPPORT_AGENT_ALLOWLIST_LOCKDOWN` / `SUPPORT_AGENT_ALLOWLIST_REFUND` — capability allowlists of service-token Client IDs

Missing Access configuration outside development fails closed with a 500.

### Deployment runbook

The `wrangler versions upload` / `versions deploy` release path does **not** sync
`routes` from `wrangler.toml`. When rolling out or changing the namespaces, manually
verify in the Cloudflare dashboard that the worker route
`openrouter.ai/api/v1/internal/support/*` is attached, that both Access applications
(`.../support/read` and `.../support/write`) exist with the intended Service Auth
policies, and that the AUD vars and allowlists above are set — before any data
endpoint goes live.

## Local development

Auth is bypassed only when `isDev()` AND the explicit `SUPPORT_DEV_AUTH_BYPASS=true`
opt-in are both set (this worker's `bun run dev` script sets the flag; it is never
present in deployed configuration). `X-Agent-Id` is informational only and defaults
to `dev-agent`.

```bash
tilt up                 # postgres, clickhouse, seeds, usage-record, ...
tilt trigger support    # this worker (manual-trigger resource, port 8817)

curl "http://localhost:8817/api/v1/internal/support/read/user?email=someone@example.com" \
  -H "X-Agent-Id: my-local-agent"
```

## Guardrails

- Per-agent read budget (60/min) and write budget (5/min), plus a per-billing-entity
  write budget; writes fail closed if the limiter backend is unavailable.
- Refunds: $500 auto-execute cap bounded by live balance, rolling 24h count/amount
  caps, courtesy refunds capped at 15% of lifetime purchases, one refund slot per
  purchase, auto top-up disabled on success.
- Lockdown requires a `ticket_ref` and is idempotent.
