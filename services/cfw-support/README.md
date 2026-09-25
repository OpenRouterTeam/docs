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
| `GET /user` | Look up a customer by email or entity id, including plan tier and startup-program membership (the `clerk_user_id` param accepts `user_...` or `org_...`) |
| `GET /user/{entityId}/generations` | List generations for an entity |
| `GET /generation/{generationId}` | Single generation detail |
| `GET /generation/{generationId}/trace` | Full trace for one generation |
| `GET /user/{entityId}/usage-breakdown` | Usage by model/time |
| `GET /user/{entityId}/errors/summary` | Error counts by type |
| `GET /user/{entityId}/errors/details` | Individual error rows |
| `GET /user/{entityId}/payment-status` | Payment investigation: money events (payments/refunds/chargebacks), payment-method blocks with card detail, Stripe references |
| `GET /user/{entityId}/credit-ledger` | Credit history |
| `GET /user/{entityId}/negative-balance` | Balance discrepancies: live balance and shortfall, the cause where determinable (refund exceeded balance, post-paid usage, failed charge), post-paid allowance, and the refund/chargeback rows that pulled it down |
| `GET /user/{entityId}/promo-redemptions` | Promo codes the entity redeemed: code, redemption time, credit amount, domain-restriction flag, and whether the code is currently assigned to the startup program (current promo-code values) |
| `GET /user/{entityId}/credit-expiry` | Unexpired credit grants with the FIFO portion still unspent, soonest expiry first. `scheduled_expires_at` is the earliest possible removal date, promo grants can be removed up to 30 days later because the expiration workflow guarantees 30 days notice after the first warning email. In practice only promo code grants carry a scheduled date. Purchased credits have none and are absent, and the Terms of Service rule that purchased credits expire after 12 months without usage or further purchases is not computed by this route |
| `GET /user/{entityId}/purchase/{creditId}/refund-state` | Live Stripe refund state for one purchase: status, amount, issued date, and the ARN/STAN the customer gives their bank |
| `GET /user/{entityId}/crypto-payment?tx_hash=0x...` or `?checkout_code=...` | Live Coinbase checkout state for one crypto payment joined to this entity's credit ledger. Answers "I paid but was not credited". See [Crypto payment lookup](#crypto-payment-lookup) |
| `GET /user/{entityId}/invoices` | The customer's own purchases with fresh Stripe hosted invoice and receipt links, plus whether the saved billing details differ from what is stamped on the latest invoice. Read-only, see below |
| `GET /user/{entityId}/chargebacks` | Live Stripe dispute (chargeback) state for the entity: every open and closed dispute with amount, whether it is still open, and whether the cardholder cited an unauthorized payment |
| `GET /user/{entityId}/key-activity` | Per-key usage (leaked-key detection) |
| `GET /user/{entityId}/api-keys` | Key inventory for Security and 401 troubleshooting: name, created time, disabled flag, credit limit and reset cadence, last used time. Newest 2,000 keys with a `truncated` flag. Never the key value or any part of it |
| `GET /user/{entityId}/security-signals` | Anomaly signals (IP spread, spikes) |
| `GET /user/{entityId}/rate-limit-state` | Rate limits and quota: free-model tier and its RPM/RPD (null when the account is exempt from free-model caps), new-account regime boolean, net lifetime credits against the tier threshold |
| `GET /user/{entityId}/account-state` | Live state read at request time: auto top-up trigger, Clerk identity booleans for a user, Clerk-vs-our-database roster and seat usage for an org |
| `GET /user/{entityId}/email-delivery` | Email verification failures, all from Clerk, which owns verification: primary-email verification state, the verification emails Clerk sent for sign-up and sign-in over the last 30 days with invalid attempts and completions. Mailbox delivery and bounce outcomes are not readable from Clerk and are reported as unavailable. Users only. Addresses, codes, and links are withheld |
| `GET /user/{entityId}/data-deletion-scope` | Scope of a data-removal request: whether prompts and completions are currently stored with OpenRouter, and which workspaces and API keys hold stored content, as counts only. Counts are storage-eligible generations and are not reduced by a completed removal. Account deletion progress lives in `deletion-status` |
| `GET /user/{entityId}/sign-in-methods` | Sign-in methods a user can use (Google, GitHub, other OAuth, enterprise SSO, email plus password) and enrolled second factors as live Clerk booleans, plus last enterprise SSO sign-in and last activity. User entities only |
| `GET /user/{entityId}/tax-profile` | Live Stripe tax standing: whether a tax ID is on file (type and country, never the value), when it was added, tax exemption status, billing address country |
| `GET /signup-domain?domain=` | Whether new signups from an email domain are blocked and the block category (compliance, abuse, or none), from the Mission Control domain restrictions |
| `GET /user/{entityId}/routing-config` | Account routing settings that decide model and provider availability in one response: allowed and ignored providers, default sort, the BYOK-only lock, data policy, ZDR enforcement, and the BYOK configuration per provider (active and disabled key counts, whether shared OpenRouter capacity may still serve the provider, fallback-key presence, the customer's ZDR declaration). Keys from every workspace of the entity are combined per provider, and `byok.providers_incomplete` is true when the entity has more keys than the route reads. Never key values, hashes, labels, allowlists, or workspace IDs |
| `GET /user/{entityId}/apps` | Apps the entity owns: slug, title, origin URL, created time, and whether analytics attribution is configured (not private and not hidden), with a `truncated` flag when more than 200 exist |
| `GET /organization/{entityId}` | Organization projection: member count/cap, pending invites with independent availability, roster with masked emails, alert email presence, and owner presence |
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

### Crypto payment lookup

`GET /user/{entityId}/crypto-payment` takes exactly one of two query parameters.
Supplying neither or both is a 400. Over MCP the route is the `support__get_crypto_payment` tool, whose flattened input (`entityId`, `tx_hash`, `checkout_code`) enforces the same exactly-one rule.

- `checkout_code` is the Coinbase checkout ID the customer paid (the id on the hosted
  checkout page, also stored as `credits.coinbase_charge_code`). Letters, digits,
  `_` and `-`, up to 128 characters.
- `tx_hash` is the on-chain transaction hash, `0x` followed by 64 hex digits.

The answer has two independent halves. The processor half is read live from Coinbase
Business (`GET /api/v1/checkouts/{id}`) at request time. The credit half is read from
Postgres, restricted to purchase credits of the requested entity. Either half can be
unavailable without hiding the other.

Bounded lookup. Whenever this entity holds a credit row for the lookup, the row's `coinbase_charge_code` is the checkout read from Coinbase. The caller-supplied `checkout_code` reaches Coinbase only when the ledger has no row for it. Coinbase has no transaction-hash filter, so a `tx_hash` is resolved through the credit row alone. The route never lists or scans Coinbase checkouts. A hash with no credit row for this entity is 404, even if Coinbase saw the transfer, because there is no bounded way to find the checkout. Use `checkout_code` for the uncredited case. A `tx_hash` lookup whose ledger read fails is a 500 rather than a 200 `unresolved`. Without the row there is no checkout to ask Coinbase about, so neither half was answered and the caller should retry. A `checkout_code` lookup with the same ledger failure still answers the Coinbase half and returns 200 with `credit: null`.

Entity scoping. A checkout belongs to the entity when its Coinbase metadata names the entity or the entity holds the credit issued for it. A checkout that resolves but belongs to another entity returns the same 404 as an unknown code. When Coinbase is unavailable and the ledger has no row for this entity, ownership cannot be confirmed and the lookup is also 404. A code Coinbase reports as unknown is 404 even when the ledger read failed. Only a lookup where Coinbase and the ledger both fail returns 200 `unresolved`. Nothing in the response confirms that another account's payment exists.

Response fields and what null means:

| Field | Meaning |
| --- | --- |
| `lookup.by` | `tx_hash` or `checkout_code`, whichever the caller supplied |
| `processor_status` | Coinbase checkout state as a closed enum: `active`, `processing`, `deactivated`, `expired`, `completed`, `failed`, `refunded`, `partially_refunded`. Null when Coinbase was unavailable or returned a state this worker does not know |
| `processor_unavailable` | True when the live Coinbase read failed (network, auth, rate limit, malformed response). Not the same as not found |
| `expected_amount_usd` | Checkout amount. Null when Coinbase was unavailable or the checkout is not denominated in USD or a USD stablecoin |
| `received_amount_usd` | Settled amount Coinbase received. Null unless the checkout has settled |
| `blockchain` | Network of the transfer, from Coinbase or the credit row. Null when neither knows it |
| `transaction_hash` | The customer's own transfer hash, from Coinbase or the credit row. Null when neither knows it |
| `processor_updated_at` | Coinbase's last update time (ISO 8601). Null when Coinbase was unavailable |
| `credit` | Null when the Postgres read failed, so whether the customer was credited is unknown |
| `credit.credited` | True when this entity holds a purchase credit for the payment, false when the ledger was read and has none |
| `credit.credited_amount_usd`, `credit.credited_at` | Credits granted and when. Null when `credited` is false |
| `resolution` | Closed enum computed from `processor_status` and `credit`, see below |

Resolution, in precedence order:

| Value | Condition |
| --- | --- |
| `refunded` | Processor status is `refunded` or `partially_refunded`, regardless of credit |
| `unresolved` | `credit` is null (ledger unreadable). Otherwise, no credit and processor status is null (Coinbase returned a state this worker does not know) |
| `credited` | A credit row exists for this entity |
| `paid_not_credited` | Processor status is `completed` and no credit row exists. The customer paid and needs a manual credit |
| `awaiting_confirmation` | Processor status is `active` or `processing`, no credit |
| `expired_unpaid` | Processor status is `expired` or `deactivated`, no credit |
| `failed` | Processor status is `failed`, no credit |

The worker needs `COINBASE_BUSINESS_API_KEY_ID` and `COINBASE_BUSINESS_API_KEY_SECRET` (same names as `cfw-frontend-api` and `projects/web`). Until they are bound, every Coinbase read fails, so a lookup that reaches Coinbase reports `processor_unavailable: true` and answers from the ledger only, and a lookup with no ledger row is 404.

Action needed: @Abdalla729, bind COINBASE_BUSINESS_API_KEY_ID and COINBASE_BUSINESS_API_KEY_SECRET to cfw-support

### Invoices

`GET /user/{entityId}/invoices?limit=20&before=<credit_id>` lists the entity's
purchases newest first, with `limit` capped at 50 and `before` the `credit_id` of the
last row on the previous page. Goodwill and courtesy credits are excluded, so every row
is money the customer paid. The endpoint resolves the "I lost the PDF" and "my invoice
has the wrong company name" tickets with evidence the agent may repeat to the customer.
It only reads: no Stripe write, no invoice regeneration, and no change to the saved
billing details. Correcting an invoice stays a human task.

Over MCP the route is the `support__get_invoices` tool, with `entityId`, `limit`, and `before` as its input object.

Billing details are reduced to presence booleans (`has_billing_name`, `has_tax_id`,
`has_address`). The name, tax ID, and address themselves never leave the server.
`has_billing_name` reads Stripe's generic customer name, which is a person's name when no company was entered, so it does not say whether a company is on the invoice.

Nullable fields and what null means:

| Field | Null means |
| --- | --- |
| `tax_usd` | No tax figure was recorded for the purchase. It does not mean zero tax was charged |
| `hosted_invoice_url` | No Stripe invoice is recorded for the purchase (the usual case for crypto, sequence, and purchase_order rails, and for card purchases that never requested one), Stripe returned none, or the lookup failed. Null does not prove no invoice exists |
| `receipt_url` | The purchase is not on the Stripe rail, the charge has no receipt, or the lookup failed. Null does not prove no receipt exists |
| `billing_details_on_invoice` | There is no hosted invoice for the purchase or its stamped details could not be read. Never filled in from the currently saved details |
| `current_billing_details` | The entity has no Stripe customer, the customer was deleted in Stripe, or the read failed |
| `future_invoices_will_differ` | Either `current_billing_details` is null or no invoice in the page has known `billing_details_on_invoice` |

`billing_details_on_invoice` is read from the invoice Stripe froze at finalization, so it
is what the customer sees on their PDF. `current_billing_details` is read from the live
Stripe customer, which is what Stripe stamps on the next invoice.
`future_invoices_will_differ` compares the two for the newest invoice in the page with
known details. It compares presence only, so a company name that was corrected from one
value to another reads `false`.

Every lookup failure lands the affected field on null and logs a stable code
(`stripe_invoice_lookup_failed`, `stripe_receipt_lookup_failed`,
`stripe_customer_retrieve_failed`) without the Stripe payload.

Stripe reads are shared within one request. Purchases whose invoice must be found by
walking the customer's invoice history reuse the same pages, and one payment intent is
retrieved once even when several lookups need it. A failed shared read is not retried
within the request. Nothing is cached across requests, so a page of 50 legacy purchases
still costs one invoice-history walk plus one search and one payment-intent read per row.

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
- `COINBASE_BUSINESS_API_KEY_ID` / `COINBASE_BUSINESS_API_KEY_SECRET`, the CDP key for the live Coinbase read behind `crypto-payment`

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
