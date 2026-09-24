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
| `GET /user/{entityId}/negative-balance` | Balance discrepancies: live balance and shortfall, the cause where determinable (refund exceeded balance, post-paid usage, failed charge), post-paid allowance, and the refund/chargeback rows that pulled it down |
| `GET /user/{entityId}/purchase/{creditId}/refund-state` | Live Stripe refund state for one purchase: status, amount, issued date, and the ARN/STAN the customer gives their bank |
| `GET /user/{entityId}/key-activity` | Per-key usage (leaked-key detection) |
| `GET /user/{entityId}/security-signals` | Anomaly signals (IP spread, spikes) |
| `GET /user/{entityId}/account-state` | Live state read at request time: auto top-up trigger, Clerk identity booleans for a user, Clerk-vs-our-database roster and seat usage for an org |
| `GET /user/{entityId}/email-delivery` | Email verification failures, all from Clerk, which owns verification: primary-email verification state, the verification emails Clerk sent for sign-up and sign-in over the last 30 days with invalid attempts and completions. Mailbox delivery and bounce outcomes are not readable from Clerk and are reported as unavailable. Users only. Addresses, codes, and links are withheld |
| `GET /user/{entityId}/data-deletion-scope` | Scope of a data-removal request: whether prompts and completions are currently stored with OpenRouter, and which workspaces and API keys hold stored content, as counts only. Counts are storage-eligible generations and are not reduced by a completed removal. Account deletion progress lives in `deletion-status` |
| `GET /user/{entityId}/sign-in-methods` | Sign-in methods a user can use (Google, GitHub, other OAuth, enterprise SSO, email plus password) and enrolled second factors as live Clerk booleans, plus last enterprise SSO sign-in and last activity. User entities only |
| `GET /user/{entityId}/tax-profile` | Live Stripe tax standing: whether a tax ID is on file (type and country, never the value), when it was added, tax exemption status, billing address country |
| `GET /signup-domain?domain=` | Whether new signups from an email domain are blocked and the block category (compliance, abuse, or none), from the Mission Control domain restrictions |
| `GET /user/{entityId}/routing-config` | Account routing settings that decide model and provider availability in one response: allowed and ignored providers, default sort, the BYOK-only lock, data policy, ZDR enforcement, and the BYOK configuration per provider (active and disabled key counts, whether shared OpenRouter capacity may still serve the provider, fallback-key presence, the customer's ZDR declaration). Keys from every workspace of the entity are combined per provider, and `byok.providers_incomplete` is true when the entity has more keys than the route reads. Never key values, hashes, labels, allowlists, or workspace IDs |
| `GET /zendesk/tickets/{ticketId}` | Zendesk proxy: ticket fields plus the first 100 comments in ascending order (`comments_truncated` flags more). Requires `zendesk_read` |
| `GET /zendesk/tickets/{ticketId}/requester-tickets` | Zendesk proxy: the other tickets opened by the given ticket's requester, newest first, up to 100 (`tickets_truncated` flags more). The requester is resolved from the ticket server-side and each row carries only id, subject, status, created and updated time. Requires `zendesk_read` |

Write (`/api/v1/internal/support/write`):

| Route | Purpose |
| --- | --- |
| `POST /user/{entityId}/refund` | Support refund with caps, reservations, and audit notes |
| `POST /user/{entityId}/lockdown` | Account containment: disable all keys, disable auto top-up, revoke sessions |
| `POST /zendesk/tickets/{ticketId}/comment` | Zendesk proxy: add one public reply or internal note, optionally setting the ticket status. Requires `zendesk_write` |

### Zendesk proxy

Agents never hold a Zendesk credential. The worker keeps a confidential Zendesk OAuth client (`ZENDESK_OAUTH_CLIENT_ID` / `ZENDESK_OAUTH_CLIENT_SECRET`, created by the dedicated Zendesk agent user whose identity every write is attributed to), mints a `client_credentials` token scoped to `tickets:read tickets:write ticket_attachments:read ticket_attachments:write`, caches it per isolate until one minute before expiry, and retries once with a fresh token on a 401. Requests go only to the fixed origin `https://openrouter.zendesk.com`, and the proxy exposes no other Zendesk endpoint, so what an agent can reach is the route list above regardless of the token's scope. Ticket and comment payloads are Zod-validated projections, and comment text never enters logs. Comment bodies are sent verbatim: do not append a signature, Zendesk adds the agent's.

Writes are rate limited per ticket under the `zendesk-ticket:<id>` entity key, sharing
the per-agent write budget with account mutations.

### MCP endpoints

Each namespace also serves a stateless MCP endpoint (Streamable HTTP, JSON responses, one server instance per POST) at `/api/v1/internal/support/read/mcp` and `/api/v1/internal/support/write/mcp`. Every route in the tables above is one tool, named `support__<operation>` (for example `support__get_user`, `support__get_ticket`, `support__lockdown_user`), with the route's request params, query, and body as its input schema and the route's OpenAPI summary as its description. A tool call is turned into the equivalent HTTP request and re-enters the worker through `app.fetch`, so it passes the same Access verification, capability, rate-limit, and validation middleware as a direct call. The MCP endpoints expose nothing that the HTTP routes do not.

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
implicitly also get read; lockdown does not imply refund or vice versa. `zendesk_write`
implies `zendesk_read`. The Zendesk capabilities are disjoint from the account ones: a
ticket-only identity cannot read customer data, and an account identity cannot touch
tickets.

Required worker vars (Infisical path `/services/cfw-support`):

- `CF_ACCESS_TEAM_DOMAIN` — `https://<team>.cloudflareaccess.com` (JWT issuer; JWKS at `<team-domain>/cdn-cgi/access/certs`; the env schema rejects other shapes)
- `CF_ACCESS_AUD_READ` — AUD tag of the support-read Access application
- `CF_ACCESS_AUD_WRITE` — AUD tag of the support-write Access application
- `SUPPORT_AGENT_ALLOWLIST_READ` / `SUPPORT_AGENT_ALLOWLIST_LOCKDOWN` / `SUPPORT_AGENT_ALLOWLIST_REFUND` — capability allowlists of service-token Client IDs
- `SUPPORT_AGENT_ALLOWLIST_ZENDESK_READ` / `SUPPORT_AGENT_ALLOWLIST_ZENDESK_WRITE` — Zendesk proxy capability allowlists
- `ZENDESK_OAUTH_CLIENT_ID` / `ZENDESK_OAUTH_CLIENT_SECRET` — confidential Zendesk OAuth client; unset disables the Zendesk routes (503)

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
