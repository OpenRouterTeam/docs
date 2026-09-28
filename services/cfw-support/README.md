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
| `GET /user/{entityId}/ownership-signals` | Ownership investigation for lockout tickets: compares claims the customer made against what the server holds and returns one match result per claim. MCP tool `support__get_ownership_signals`. See [Ownership signals](#ownership-signals) |
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
| `POST /zendesk/tickets/{ticketId}/approve` | Execute a reply/status change a human approved in Slack. Requires `zendesk_write` plus a **read** case capability; see "Case dispatch and approval" |
| `POST /zendesk/tickets/{ticketId}/autonomous` | Execute a reply/status change with no human approval when every autonomous gate passes. Requires `zendesk_write`, `case_approve`, and a **read** case capability whose origin's live mode is `auto`; see "Autonomous writes" |

### Zendesk proxy

Agents never hold a Zendesk credential. The worker keeps a confidential Zendesk OAuth client (`ZENDESK_OAUTH_CLIENT_ID` / `ZENDESK_OAUTH_CLIENT_SECRET`, created by the dedicated Zendesk agent user whose identity every write is attributed to), mints a `client_credentials` token scoped to `tickets:read tickets:write ticket_attachments:read ticket_attachments:write users:read` (`users:read` only resolves a new ticket's requester email for intake triage), caches it per isolate until one minute before expiry, and retries once with a fresh token on a 401. Requests go only to the fixed origin `https://openrouter.zendesk.com`, and the proxy exposes no other Zendesk endpoint, so what an agent can reach is the route list above regardless of the token's scope. Ticket and comment payloads are Zod-validated projections, and comment text never enters logs. Comment bodies are sent verbatim: do not append a signature, Zendesk adds the agent's.

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

### Ownership signals

`GET /user/{entityId}/ownership-signals` answers lost-email and 2FA lockout tickets. The
agent passes the claims the customer made as query parameters. Each claim comes back as a
result enum. The API never returns the value it compared against and never decides
ownership. The operator reads the rows and decides. `entityId` must be a `user_...` ID.
A lockout concerns a login identity, and every check is user scoped, so an `org_...` ID
is rejected with 400 rather than reported as `no_match` against member data.

Query parameters, all optional, at least one required:

| Parameter | Claim | Checked against |
| --- | --- | --- |
| `purchase_amount_usd` with `purchase_date` | A purchase the customer remembers | Payment rows in `credits`, excluding zero-revenue goodwill grants. Amount must equal either the credited amount or the gross charge plus sales tax exactly, and the date must fall within 2 days either side (UTC). Both parameters are required together |
| `signup_method` | `email`, `google`, `external_account`, or `web3_wallet` | The earliest Clerk identity the login capture recorded. For accounts created after capture began this is the signup identity. For older accounts it is the identity seen on the first login after capture began, which may be a method linked after signup, so a capture more than a day after the account was created gives `unverifiable` with `source_unavailable`. An account with no captured identity gives the same. The capture stores the identities linked at that moment and a linked external account wins over email, so an email signup that linked Google before its first captured login reads as `google` |
| `signup_month` | `YYYY-MM` (UTC) | The account creation month |
| `generation_id` | A `gen-...` id | ClickHouse, scoped to this entity, with no age cutoff. A malformed id is rejected with 400 |
| `api_key_name` | Exact key name | The entity's API keys, including disabled and deleted ones. Comparison is case sensitive |

Response fields:

| Field | Meaning |
| --- | --- |
| `signals[].claim` | One of `purchase`, `signup_method`, `signup_month`, `generation_id`, `api_key_name`. Every claim appears exactly once in a fixed order |
| `signals[].result` | `match`, `no_match`, `unverifiable`, or `not_checked`. A `no_match` carries nothing that hints at what would have matched |
| `signals[].reason` | Only on `unverifiable` and `not_checked` rows. `no_payment_on_file`, `source_unavailable`, or `not_provided` |
| `signals[].tolerance` | Only on the purchase row. Always `amount_exact_date_within_2_days` |
| `matched` | Rows with result `match` |
| `checked` | Rows with result `match` or `no_match`. Unverifiable rows do not count, so `checked` can be below the number of claims supplied |
| `check_budget_remaining` | Checks left for this entity in the rolling 24 hour window after this call |
| `signal_strength` | `weak` under 2 matches, `moderate` at 2 or 3, `strong` at 4 or more when the purchase claim is among the matches. Counts only, not a verdict |

No field is nullable. Unknown is expressed as `result: unverifiable` with a `reason`, so a
claim the server cannot check is never reported as `no_match`.

Budget: 5 calls per entity per rolling 24 hours, keyed on the entity rather than the
agent, backed by the same rate limiter the write namespace uses. If the limiter is
unavailable the call fails closed with 503. An exhausted budget returns 429 with the
standard error envelope and `Retry-After`.

Record: each call writes one `iLog` line with `entity_id`, the comma separated list of
claims checked, `matched`, `checked`, and `signal_strength`. Claim values are never
logged. There is no durable support action log yet, so this log line is the record.

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

Ticket-scoped Zendesk routes (`/zendesk/tickets/{ticketId}`, `.../requester-tickets`,
`.../comment`) additionally require a ticket-bound case capability in the
`x-support-case-capability` header. It is a stateless token,
`base64url(payload).base64url(HMAC-SHA256(key, payload segment))`, with payload
`{ticket_id, origin: "new_ticket" | "backlog" | "customer_reply", scope: "read" | "write", exp, nonce, kid}`. Read
tokens live four hours and write tokens ten minutes. The token's `ticket_id` must equal the
path ticket and its `scope` must match the namespace (read vs write); any mismatch,
tampering, expiry, or unknown `kid` returns one indistinguishable 403. A valid token is
necessary but not sufficient: on every call the worker re-reads the ticket from Zendesk and
requires `assignee_id == ADA_ZENDESK_USER_ID` and a status other than `solved`/`closed`, so
reassigning or solving the ticket revokes every outstanding token for it on the next call
(403 with a message telling the agent to stop working the ticket). The requester is always
derived from the server-read ticket, never from caller input. Minting logs the nonce as
`token_id` with the ticket and expiry; the token itself is never logged.

On the MCP endpoints the ticket-scoped tools (`support__get_ticket`,
`support__get_satisfaction`, `support__list_requester_tickets`, `support__add_ticket_comment`,
`support__approve_ticket_action`, `support__autonomous_ticket_action`) take a `case_token`
argument, which the handler sends as the capability header. Clients that cannot set a
per-call argument may instead send `x-support-case-capability` on the MCP request; the
handler uses it only when `case_token` is omitted, and rejects the call (400) when both
are present and differ. Verification and the ownership re-read are identical either way.

### Case dispatch and approval

`POST /api/v1/internal/support/read/zendesk/launcher/dispatch` (`launcher` only, not on
MCP) takes `{ticket_id, event?: "customer_replied", comment_id?}` and signs the
`backlog` origin (see [Ada support policy](#ada-support-policy)); it refuses with 403
when `modes.backlog` is `off`. It re-reads the
ticket, requires it to be assigned to `ADA_ZENDESK_USER_ID` and not solved/closed (409
otherwise), mints a four-hour read capability, and POSTs
`{ticket_id: "<id>", case_token, mode[, event, comment_id]}` to
`<ADA_INTAKE_BASE_URL>/slack/support/case` with `X-Ada-Timestamp` and
`X-Ada-Signature: v1=<hex HMAC-SHA256(ADA_CASE_HMAC_SECRET, "<ts>.<raw body>")>`. It
returns `{ticket_id, token_id, exp, ada_status, channel, thread_ts, resumed}`, never the
token. Dispatches share one `launcher-dispatch` write budget (3/min), which paces a backlog
run to one case every ~20 s.

`POST /api/v1/internal/support/write/zendesk/tickets/{ticketId}/approve` (MCP
`support__approve_ticket_action`) takes `{comment_body, public, status?,
expected_updated_at, confidence, confidence_rationale?, tags?, custom_status_id?, approver: {slack_user_id,
slack_team_id, slack_interaction: {body, timestamp, signature}}}` with the case's read
`case_token`. `confidence` (number `0..1` with at most two decimals, required) is Jev's
confidence for the ticket (Ada's playbook step 6: whether the playbook, docs, site pages
and this run's tool output are enough to answer); `confidence_rationale` (optional, at most 500 chars) is logged only by
length because it may quote the customer. `slack_interaction` is the raw
Slack request for the Approve click (form body, `X-Slack-Request-Timestamp`,
`X-Slack-Signature`), verified with `ADA_SLACK_SIGNING_SECRET` inside Slack's five-minute
window. The clicking user and team must match `approver` and the
`SUPPORT_APPROVER_SLACK_*` allowlists, the clicked button's `action_id` must be
`support_case_approve`, and its value must be
`{"ticket_id":<id>,"action_sha256":"<hex>"}` where the digest is SHA-256 of the compact,
non-ASCII-unescaped JSON in fixed key order (Python `json.dumps(d, separators=(",", ":"),
ensure_ascii=False)`, no `sort_keys`)
`{"ticket_id":…,"comment_body":…,"public":…,"status":…|null,"expected_updated_at":…,"confidence_pct":…,"tags":[…],"custom_status_id":…|null}`
with `confidence_pct = round(confidence * 100)` as an integer and `tags` the requested
tags deduplicated and sorted, so float formatting cannot
differ between signers (worked example in `docs/ada-case-action-contract.md`), and so the executed action is exactly the one the human saw, at the
confidence shown to them. The worker
then re-reads the ticket (still Ada's, still open, `updated_at == expected_updated_at`,
else 403/409), mints a ten-minute write capability that never leaves the worker, and
writes with Zendesk `safe_update`, so a replayed approval gets 409 instead of posting
twice. The live mode of the case's origin decides: `off` refuses with 403 (`mode_off`),
`dry_run` verifies everything and writes nothing (`executed: false`), `assist` and
`auto` write.

Both approve and autonomous take optional `tags` (add-only: at most 20, each 1-80 chars of
`[a-z0-9_\-:./]`, merged with the live ticket tags and sent as the full list) and
`custom_status_id` (positive integer, read at request time with
`GET /api/v2/custom_statuses/{id}.json`; unknown or inactive is 400
`custom_status_invalid`, a `status` differing from its `status_category` is 400
`custom_status_mismatch`). Both go into the same `safe_update` ticket PUT as the comment,
so a stale or replayed action writes neither.

`GET /api/v1/internal/support/read/zendesk/tickets/{ticketId}/satisfaction` (MCP
`support__get_satisfaction`, `zendesk_read`, case-bound like `get_ticket`) returns the
case ticket's `satisfaction_rating` projected to `{score, reason_id, reason}` (or
`null`), read from the ticket itself under the existing `tickets:read` scope. The
rating's free-text comment is never returned or logged, and no console-wide
satisfaction, ticket-view or custom-object route exists.

### Ada support policy

The live-config key `support_ada_policy` (Mission Control, "Ada support policy",
schema in `packages/helpers/support-ada-policy-live-config.ts`) is read through
`KV_LIVE_CONFIG` on every case start, approve, and autonomous call:

```
{
  modes: { new_tickets, backlog, customer_replies },   // 'off' | 'dry_run' | 'assist' | 'auto'
  assign_priorities: ZendeskPriority[],                  // new tickets the webhook assigns to Ada
  auto_send_priorities: ZendeskPriority[],               // autonomous writes
  min_confidence: number,                                 // 0..1
  max_auto_replies_per_ticket_per_day: int,              // >= 0, public replies only
  never_auto_send_categories: string[],                  // "Category > Subcategory" or "Category"
  never_auto_send_tags: string[],
}
```

The case token signs the arrival origin (`new_ticket` for a webhook case start,
`backlog` for launcher dispatch, `customer_reply` for a webhook reply continuation), not
the mode; the effective mode is `modes[origin]` read on each request, so a Mission
Control change reaches in-flight cases too. It is not instant: each isolate caches the
policy for about 10s and Cloudflare KV itself can take 60s or more to show a write in
every location, so allow about a minute (including for `off`) before relying on it. The intake payload
still tells Ada the effective mode at dispatch. `off` stops the origin: no new cases and
every write refused with 403. Missing keys fall back to their defaults (every mode
`assist`, both priority lists `low,normal`, `min_confidence` 0.7, cap 3, empty deny
lists), and an invalid stored value serves the full defaults rather than the last good
value, so a bad edit can never produce `auto`. A cold isolate waits for the first KV
read before deciding, so it never acts on the compiled defaults when an operator set
`off`.

### Autonomous writes

`POST /api/v1/internal/support/write/zendesk/tickets/{ticketId}/autonomous` (MCP
`support__autonomous_ticket_action`) takes `{comment_body, public, status?,
expected_updated_at, confidence, confidence_rationale?}` with the case's read
`case_token` and writes with no human approval, plus optional `category`
(`"Category > Subcategory"`, deny list only), `tags` and `custom_status_id` (see above). The caller needs `zendesk_write` and `case_approve`; Ada's
case token and those capabilities are enough, and the live policy is the switch. Every
gate must pass, in this order, with values from the live `support_ada_policy`:

1. The live mode of the case's origin is `auto` (`mode_not_auto`; `off` is `mode_off`,
   which tells Ada to stop rather than request approval).
2. `confidence >= min_confidence` (`confidence_below_threshold`), the request `category`
   is not in `never_auto_send_categories` (`category_not_allowed`), and no request tag
   is in `never_auto_send_tags` (`tag_not_allowed`).
3. The live ticket is still Ada's and open (`ticket_not_active`), its priority is in
   `auto_send_priorities` (`priority_not_allowed`), its own category field is not on the
   deny list, and no tag of the final set the write would leave (live tags plus requested
   tags) is in `never_auto_send_tags` (`tag_not_allowed`). Category entries match case-insensitively with spaces,
   underscores and hyphens equivalent, so `Billing > Refund Request` matches the ticket's
   tagger values `billing` / `refund_request`, and a bare `Billing` denies every
   subcategory under it. While `never_auto_send_categories` is non-empty, a ticket
   whose category cannot be read (malformed field config, or Zendesk omitted the custom
   fields) is refused as `category_unknown`; a ticket that simply has no category set
   is not.
4. `updated_at == expected_updated_at` (409 `ticket_stale`), then a requested
   `custom_status_id` is valid (400 `custom_status_invalid` / `custom_status_mismatch`).
5. A public reply has budget left: at most `max_auto_replies_per_ticket_per_day` per
   ticket in any rolling 24h. Each reply takes one of that many per-ticket Redis slots
   (`SET NX EX 86400`) that frees 24h after that reply, spent only once every gate above
   passed. After claiming, the server counts every held slot up to the schema maximum
   (20) and gives the slot back if that exceeds the cap, so replies taken under a higher
   cap still count; lowering the cap applies at once and `0` refuses every public reply.
   Exhausted is `per_ticket_cap_reached`; an unreachable limiter fails closed as
   `cap_unavailable`. Internal notes (`public: false`) are not customer-facing and are
   not counted, nor are tags or custom statuses on them; approved writes are never
   counted. A public reply that also sets tags or a custom status counts once.

The write then goes through the same internally minted ten-minute write capability and
Zendesk `safe_update` as approve, so a replay or concurrent change is 409
`write_conflict`. Refusals are 403 (409 for `ticket_stale` and `write_conflict`) with
the reason in the message and, except for `mode_off`, an instruction to request Slack
approval for the same action with `support__approve_ticket_action` instead.

`confidence` is Jev's score as reported by Ada. The server enforces the threshold but
cannot verify the score; the signed origin and its live mode, the priority gate, the
category and tag deny lists, ownership and status re-check, staleness check, and
per-ticket cap are the real guardrails.

### Action outcome events

Every approve and autonomous call that reaches a decision logs one
`support_case_action_outcome` event with `agent_id`, `ticket_id`, `token_id` (read
capability nonce), `write_token_id`, `origin`, the live `mode`, `confidence`,
`confidence_rationale_length`, `public`, `status`, the live `priority`, `category`, and
`subcategory`, `origin`, `outcome` (`approved_written`, `dry_run_verified`, `rejected`,
`autonomous_written`, `autonomous_refused`), `reason`, and `approver_slack_user_id`.
Comment bodies and rationale text are never logged. Query these in Datadog to calibrate
`min_confidence` against which approved actions humans accepted.

### Zendesk webhook

`POST /api/v1/internal/support/webhooks/zendesk` receives Zendesk ticket events. It is
authenticated only by Zendesk's webhook signature: no Access application fronts the
webhooks namespace, and no Access JWT or service token is read or needed. The handler
verifies `X-Zendesk-Webhook-Signature` = base64(HMAC-SHA256(`ZENDESK_WEBHOOK_SIGNING_SECRET`,
`<X-Zendesk-Webhook-Signature-Timestamp><raw body>`)) inside a ten-minute window over
the exact raw body (capped at 256 KiB) before parsing it or calling anything else; a
missing, wrong, or stale signature is 401 with no Zendesk, Redis, or Ada call. The auth
middleware admits only this path in the webhooks namespace (any other is 401) and gives
it no capabilities. The payload only names the ticket and comment; the worker re-reads
both from Zendesk before every decision. Webhook deliveries skip the per-agent rate
limit.

- Intake triage (`ticket.created`, before case start and before the Ada assignment
  check): `triageNewTicket` (`src/ada/ticket-intake-triage.ts`) re-reads the ticket and
  its requester's email from Zendesk, resolves the requester to an OpenRouter account
  (falling back to a domain match on non-free email domains), and sets priority and tags
  exactly as cfw-internal's `zd-ticket-created` route (Zendesk webhook "Ticket Created
  v3") did: priority from `determinePriorityForAccount` / `determinePriority`
  (`@openrouter-monorepo/db/users/zendesk-plan-priority`) over lifetime credits and plan
  rows, tags `user_not_found`, `domain_match`, and the account tags. A Redis completion marker (one-year TTL), set only after triage succeeds, makes later deliveries skip triage and go straight to case start. While triage runs it holds a 90-second owner-token lease (released by compare-and-delete, so a late owner never frees a successor's lease) and gives up after 10 seconds (under Zendesk's 12-second webhook timeout and the worker's 15-second request timeout): past the deadline it makes no further Zendesk writes (an in-flight write is cancelled or settles within its 15-second request timeout, still under the lease) fails the delivery with 503 (so Zendesk redelivers it after `Retry-After`), and leaves the lease to expire; the holder re-checks the marker after acquiring the lease. A concurrent `ticket.created`, `ticket.agent_assignment_changed`, or `ticket.priority_changed` delivery that finds the lease gets 503 (and no case start) so Zendesk retries it after triage finishes; tickets with no lease (finished, or created before this shipped) proceed as before. A failed lookup, priority write, tag write, or completion-marker write frees the lease and fails the delivery with a retryable status so Zendesk retries it (a lease that cannot be freed expires on its own); re-running triage rewrites the same tags and priority. Deactivate "Ticket Created v3" once this is live, or both write each ticket.
- Assignment and case start (`ticket.created`): after triage the worker re-reads the
  ticket. `modes.new_tickets` `off` assigns nothing and starts nothing. Otherwise an
  unassigned, unsolved ticket whose re-read priority is in `assign_priorities` is
  assigned to `ADA_ZENDESK_USER_ID` with `safe_update` at the `updated_at` it was read
  at; on a 409 (the ticket changed meanwhile) it re-reads once and decides again, and a
  second 409 fails the delivery with 503 (and `Retry-After`) so Zendesk retries. A
  redelivered `ticket.created` whose case already started assigns nothing, so a ticket
  unassigned after its case started stays unassigned. A ticket a human already holds, or
  one solved or closed, is left alone. Once the ticket is Ada's and active, the case is
  dispatched with origin `new_ticket` under `modes.new_tickets`, once per ticket.
  Disable any Zendesk trigger that assigns tickets to Ada, so assignment follows the
  live `assign_priorities`.
- Case start (`ticket.agent_assignment_changed`, `ticket.priority_changed`): 503 while
  the triage lease is held (above). Otherwise, unless `modes.new_tickets` is `off`, a
  ticket assigned to Ada and not solved/closed gets its `new_ticket` case (whatever its
  priority: someone handed it to Ada), once per ticket; these events never assign, and
  a ticket a human took is ignored.
- Customer reply (`ticket.comment_added`): the ticket must be assigned to Ada and not
  solved/closed; only a public comment authored by the ticket's requester (checked against the ticket's newest 100 comments; the ticket
  description is skipped) is dispatched with `event: "customer_replied"`, its
  `comment_id`, and origin `customer_reply`, once per `(ticket_id, comment_id)`, unless
  `modes.customer_replies` is `off`.

Each side effect is claimed in Redis (`SET NX`, seven-day TTL) before dispatch, so a
Zendesk retry of a delivered event is acknowledged as `duplicate`. A failed dispatch
releases its claim and returns an error, so Zendesk's retry runs it again. Any processing failure at or above 500 (an upstream Zendesk or Ada failure) is answered as 503, and a 429 or 503 carries `Retry-After: 30`, since Zendesk redelivers those statuses only with a `Retry-After` under 60 seconds. If more than 6 seconds of the request (policy read plus triage) have passed before the ticket re-read, the assignment, or the dispatch, the delivery answers 503 without starting it (a refused dispatch releases its claim), so nothing starts that might not finish before Zendesk's 12-second timeout; the redelivery skips completed triage. Other events
are acknowledged as `ignored` so Zendesk does not retry them.

Required worker vars (Infisical path `/services/cfw-support`):

- `CF_ACCESS_TEAM_DOMAIN` — `https://<team>.cloudflareaccess.com` (JWT issuer; JWKS at `<team-domain>/cdn-cgi/access/certs`; the env schema rejects other shapes)
- `CF_ACCESS_AUD_READ` — AUD tag of the support-read Access application
- `CF_ACCESS_AUD_WRITE` — AUD tag of the support-write Access application
- `SUPPORT_AGENT_ALLOWLIST_READ` / `SUPPORT_AGENT_ALLOWLIST_LOCKDOWN` / `SUPPORT_AGENT_ALLOWLIST_REFUND` — capability allowlists of service-token Client IDs
- `SUPPORT_AGENT_ALLOWLIST_ZENDESK_READ` / `SUPPORT_AGENT_ALLOWLIST_ZENDESK_WRITE` — Zendesk proxy capability allowlists
- `SUPPORT_CASE_CAPABILITY_KEYS` — case capability keyring, `kid:secret[,kid2:secret2]` (secrets at least 32 chars); the first key signs, all verify, so a new key can overlap the old during rotation. Unset outside development fails ticket-scoped routes closed (503); malformed fails them with 500
- `ADA_ZENDESK_USER_ID` — Zendesk user ID the support agent works tickets as; empty disables ticket-scoped routes (503)
- `SUPPORT_AGENT_ALLOWLIST_LAUNCHER` — operator identities allowed to search the backlog and dispatch cases
- `ZENDESK_WEBHOOK_SIGNING_SECRET` — the Zendesk webhook's signing secret, its only authentication; unset disables the webhook (503)
- `SUPPORT_AGENT_ALLOWLIST_CASE_APPROVE` — the support agent's own identity; approve also requires it, so no other `zendesk_write` holder can execute Slack-approved writes
- `ADA_INTAKE_BASE_URL` / `ADA_CASE_HMAC_SECRET` — Ada's intake origin (bare `https://` origin) and shared signing secret; either unset disables dispatch (503)
- `ADA_SLACK_SIGNING_SECRET` / `SUPPORT_APPROVER_SLACK_TEAM_ID` / `SUPPORT_APPROVER_SLACK_USER_IDS` — Slack signing secret of the app that renders Ada's Approve button, and the workspace and users allowed to approve; any unset disables approve (503)
- `ZENDESK_OAUTH_CLIENT_ID` / `ZENDESK_OAUTH_CLIENT_SECRET` — confidential Zendesk OAuth client; unset disables the Zendesk routes (503)
- `COINBASE_BUSINESS_API_KEY_ID` / `COINBASE_BUSINESS_API_KEY_SECRET`, the CDP key for the live Coinbase read behind `crypto-payment`

Missing Access configuration outside development fails closed with a 500.

### Deployment runbook

The `wrangler versions upload` / `versions deploy` release path does **not** sync
`routes` from `wrangler.toml`. When rolling out or changing the namespaces, manually
verify in the Cloudflare dashboard that the worker route
`openrouter.ai/api/v1/internal/support/*` is attached, that the Access applications
(`.../support/read`, `.../support/write`) exist with the intended Service Auth
policies, and that the AUD vars and allowlists above are set — before any data
endpoint goes live. `.../support/webhooks` must have no Access application (Zendesk
sends no Access credentials; the signature authenticates it): remove the old one, and
the Zendesk webhook's `CF-Access-Client-Id` / `CF-Access-Client-Secret` custom headers,
after this ships.

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
