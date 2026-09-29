# user_signals — Agent Guidelines

See the root [AGENTS.md](../../../AGENTS.md) for repo-wide rules and
[migrations/AGENTS.md](../migrations/AGENTS.md) for migration rules.

`default.user_signals` is the shared abuse-signal event stream
(migration `210_add_user_signals.sql`). Producers append one row per
observed event; detectors read the signal-time projection for bounded,
signal-scoped questions.

## Privacy floor (every producer)

- Client IP only as a keyed hash (`client_ip_hash`), never raw.
- API-key identity only as the internal `api_key_id`, never key material.
- `url_path` without query strings.
- `detail` / `payload` carry metadata only: no prompt or completion
  content, no raw IPs, no emails beyond the domain, no key material.
- `signal_name` must be bounded (a fixed vocabulary, no embedded
  uuids/slugs); unbounded values belong in `detail` as JSON.
- Every signal's name, source, and `detail` schema is declared once in
  `catalog/` (one file per source; no barrel file). Producers import the
  definition and emit through `buildSignal` / `scheduleSignal` in
  `emit.ts`, which parse the detail against the cataloged schema. The
  `limiter` source is the exception: its vocabulary lives in
  `packages/rate-limit/limiter-signal-name.ts` because `rate-limit`
  cannot depend on this package (the env-import lint would force
  ClickHouse env vars onto every rate-limit consumer).

Every row carries `data_region` (`'global'`, `'europe'`, or `'us'`, derived
from the request host; `''` only on rows predating the column). Regional
(data-local/HIPAA) requests usually write rows exactly like global ones —
there is no general region gate on the write path. Producers whose row
carries request-derived regional privacy data (location, IP hash) may drop
non-global rows before insert so the global ClickHouse writer never sees
them.

## Signal source: `signup`

Producer: `packages/webhook-handlers/clerk/signup-user-signal.ts`,
scheduled with `waitUntil` from both Clerk webhook hosts after the
webhook response is decided — signup handling never blocks on
ClickHouse, and insert failures only emit the generic
`openrouter.user_signal.insert_failed` metric tagged with `source:signup`,
plus a warning log.

- One row per created account, `signal_name = 'signup.account_created'`,
  `entity_id`/`creator_user_id` = Clerk user id.
- Network identity (continent, country, region, city, IP-derived timezone,
  browser-reported timezone, ASN, keyed IP hash, JA3, JA4) comes from
  the sealed signup Cloudflare metadata relayed through Clerk
  `unsafeMetadata`; all of it is empty when the seal is absent/invalid
  (`detail.seal_status` records which). The browser-reported IANA timezone
  comes from validated Clerk `unsafeMetadata` and is empty when unavailable.
- `detail` JSON carries `email_domain` (lowercased domain of the
  primary email, omitted for email-less signups) and `seal_status`.
  `payload` is empty.

## Signal source: `limiter`

Limiter rejection signals use `signal_source = 'limiter'` and a bounded
`signal_name` from `LIMITER_SIGNAL_NAME` in
[`packages/rate-limit/limiter-signal-name.ts`](../../rate-limit/limiter-signal-name.ts)
(e.g. `limiter.account_rpm`, `limiter.endpoint_rpd`, `limiter.other`).

The raw limiter name and these metadata keys may appear in `detail`:
`limiter`, `kind`, `source`, `limit`, `remaining`, `model`,
`restriction_code`, `restriction_scope`, and `restriction_target`. The
`payload` field is empty. Prompts, completions, raw IPs, and key material must
never be written.

Readers query the raw rows directly: `user_signals WHERE
signal_source = 'limiter'`, one row per rejected request, aggregating over
`detected_at`, `entity_id`, and `signal_name` as needed.

Limiter names ending in `-unavailable` or `-timeout` are deliberately
excluded because they represent fail-closed infrastructure outages, not user
rejection behavior.

## Signal sources: `account` and `billing`

Request-originated account and billing signals emitted by
`services/cfw-frontend-api` carry continent, country, region, city, IP-derived
timezone, colo, ASN, ASN organization, keyed client IP hash, JA3, JA4, CF ray
ID, HTTP method, URL host, and URL path. `client_timezone` stays empty because
it is browser-reported and is not available server-side. `data_region` is
already populated separately. `url_path` contains only the pathname without
query strings, and IP identity is keyed through `client_ip_hash`.

Stripe webhook billing signals are emitted from `packages/webhook-handlers/stripe/handler.ts` and built in `charge-outcome-signals.ts`. `entity_id` is the `clerk_user_id` from charge metadata (or the credit row the existing dispute/EFW handlers already resolve), and emission is skipped when it is absent. Card identity is `card_fingerprint`, the Stripe card fingerprint (an opaque per-card token, not a PAN). Non-card payer identity is `wallet_fingerprint` with its `payment_method_type`: Stripe's opaque Alipay/WeChat Pay `fingerprint`, Cash App `buyer_id`, or crypto `buyer_address`. A wallet fingerprint is only comparable within one `payment_method_type` and never to a card fingerprint; wallet transaction ids are never emitted. Detail keys are all optional and metadata only (no last4, brand, or Stripe free-text fields):

- `billing.credit_purchase_accepted` (`payment_intent.succeeded`): `amount_usd`, `flow`, `card_fingerprint`, `payment_method_type`, `wallet_fingerprint`, `risk_level`.
- `billing.credit_purchase_rejected` (`payment_intent.payment_failed`) and `billing.payment_method_rejected` (`setup_intent.setup_failed`): `error_code` (Stripe error `code`, e.g. `card_declined`, `setup_intent_authentication_failure`) and `decline_code` (issuer decline code). Stripe sets `decline_code` to `generic_decline` on non-issuer failures such as failed 3DS, so read `error_code` first.
- `billing.charge_declined` (`charge.failed`): `card_fingerprint`, `payment_method_type`, `wallet_fingerprint`, `outcome_type`, `outcome_reason`, `risk_level`, `risk_score`, `decline_code`, `card_country`, `billing_country`, `card_funding`.
- `billing.dispute_opened` (`charge.dispute.created`): `reason`, `status`, `amount_usd`, `card_fingerprint`, `payment_method_type`, `wallet_fingerprint` (only when the event carries an expanded charge).
- `billing.early_fraud_warning` (`radar.early_fraud_warning.created`): `fraud_type`, `actionable`, `card_fingerprint`, `payment_method_type`, `wallet_fingerprint` (only when the event carries an expanded charge).


## Signal source: `moderation`

Producer: `packages/router/helpers/track-moderation-signal.ts`, scheduled with
`waitUntil` from the moderation preflight plugin after a flagged input is denied.
The metadata-only detail carries sorted canonical moderation reasons,
moderators, model, provider, request source, and forced status. Preflight
denials have no generation row, so this signal preserves the event in
`default.user_signals`.

## Signal source: `web`

Producer: `services/cfw-frontend-api/src/routes/user/sensitive-surface-view/`,
a private route called server-to-server by the
`projects/web` middleware (`middlewares/sensitive-surface-signal.ts`) for
signed-in requests that match its sensitive-surface allowlist. The
middleware runs on the Vercel edge and cannot import this package (no
ClickHouse credentials there, and the env-import lint forbids it), so it
computes the request dims itself from the Cloudflare headers on the
end-user request and sends them in the POST body. The route must not
re-derive dims from its own hop: those would describe Vercel's connection
to Cloudflare, not the end user's. The middleware forwards the Clerk
session token as a bearer credential and a Vercel OIDC assertion (header
`x-vercel-oidc-token`) proving the caller is the web app's server-side
middleware, not a browser; the route verifies both independently and uses
the verified Clerk user id as `entity_id`, ignoring any caller-supplied
identity. The middleware fires
the hop through `waitUntil`; the route schedules the insert through
`scheduleSignal` with its own `waitUntil`. Neither the page response nor
the route response waits on ClickHouse.

- One row per sampled matching request, `signal_name =
  'web.sensitive_surface_view'`, `entity_id` = Clerk user id.
- `detail.surface` is a value of `SensitiveWebSurface`
  (`packages/enums/sensitive-web-surface.ts`), the shared bounded vocabulary.
- Dims: country, region, city, IP-derived timezone, ASN, keyed client IP
  hash, JA3, JA4, CF ray id, HTTP method, URL host, URL path (no query).
  `data_region` is `'global'` (the web app serves the global host).
  `client_timezone`, `colo`, and `asn_organization` stay empty because the
  middleware does not observe them.
- Credit-purchase and key-creation API calls are deliberately not in the
  allowlist: `billing.credit_purchase_*` and `account.api_key_created`
  already record them with the same dims.

## Projection read contract

- Projection: `default.user_signals.signal_time_v1` (migration
  `219_add_user_signals_signal_time_projection.sql`), ordered by
  `(signal_name, started_at, entity_id)`.
- Projected columns include `started_at`, `detected_at`, `signal_name`,
  `signal_source`, `creator_user_id`, `entity_id`, `api_key_id`, `url_host`,
  `url_path`, `service`, `continent`, `country`, `region`, `city`, `timezone`,
  `client_timezone`, `colo`, `asn`, `client_ip_hash`, `cf_ja3_hash`, `cf_ja4`,
  and privacy-safe `detail` metadata.
- Detector queries filter `signal_name` plus a bounded `started_at` range and
  touch only projected columns, so ClickHouse can serve them from the
  projection instead of scanning every co-tenant signal in the base order.
- Account counts must use `uniqExact(entity_id)` because webhook redeliveries
  produce duplicate rows. Empty-string or zero identity buckets aggregate rows
  where that identity was unavailable. Detectors must ignore those buckets,
  never treat them as one actor.
- There is no backfill or `MATERIALIZE` operation. Parts written before the
  migration use the base order until the 14-day TTL ages them out; new parts
  receive the projection on insert.
