# Abuse rules

An abuse rule is a dynamic allow or restrict rule. Track A evaluates enabled
rules in memory for each request against configuration published through KV.
The inference path never reads these rules from Postgres. A match has
request-scoped effects only: a synthetic restriction, an asynchronous
`rule_hit` signal to ClickHouse `user_signals`, and matched rule ids
persisted on the generation record (capped at 8 per request). Nothing is
ever written to or removed from the account.

Live publication parsing fails open. `invalidPublication` marks a damaged
publication envelope, while `droppedRuleCount` reports malformed rows salvaged
from an otherwise valid publication. A valid empty publication is distinct from
both cases. Operators should inspect `reason:invalid_config`,
`reason:invalid_rule_row`, `reason:empty_rule_set`, and
`reason:all_rules_dropped` in the abuse-rule metrics.

## Lifecycle

Rules move through three enforcement stages:

1. **Preflight** simulates the rule offline in Mission Control against
   Postgres and ClickHouse to show affected-account statistics before the rule
   goes live. Nothing runs on the inference path.
2. **`log_only`** emits rule hits without enforcing a restriction.
3. **`enforce`** adds synthetic restrictions to the current request.

`expires_at` makes a rule ineffective after its expiration timestamp. `version`
is stored with each rule and stamped on emitted hits so a hit can be tied to
the exact rule configuration that produced it.

## Rule shape

- `rule_type` is `allow` or `restrict`.
- `mode` is `log_only` or `enforce`.
- `filters` is a react-querybuilder `RuleGroupType`.
- `restriction_kind` and `restriction_params` describe a restriction on a
  restrict rule. Allow rules must have both fields set to `null`. Database
  CHECKs enforce that allow rules have no `restriction_kind` and that
  `restriction_kind` and `restriction_params` are set together. The Zod schema
  additionally enforces the enforceable-kind subset and that the params match
  the kind, so the database is deliberately looser than Zod and every writer
  must validate with `parseAbuseRule`.

The root filter group has an `and` or `or` `combinator` and 1 to 32 `rules`.
Each entry is a leaf or one nested group. Nested groups contain leaves only, so
there is at most one layer of group nesting and each group has 1 to 32 rules.

## Portable JSON

Mission Control exports and imports rules as a JSON array of portable rows, parsed with `AbuseRulePortableListSchema` from `console-api.ts`. A portable row is the create request (`name`, `description`, `rule_type`, `filters`, `restriction_kind`, `restriction_params`, `expires_at`) plus three optional fields: `id`, `mode`, and `enabled`. Any other key is rejected, so the server-owned `version`, `created_by_clerk_user_id`, `created_at`, and `updated_at` fields are stripped on export and refused on import.

```json
[
  {
    "id": "5f6f1d5a-8e4c-4b8a-9c3d-2f1e0a7b6c5d",
    "name": "Signup burst rate limit",
    "description": null,
    "rule_type": "restrict",
    "mode": "enforce",
    "enabled": true,
    "filters": { "combinator": "and", "rules": [] },
    "restriction_kind": "rate_limit",
    "restriction_params": { "rpm": 1 },
    "expires_at": null
  }
]
```

- **Export** walks every page of the list route (archived rules included only when the archived toggle is on) and writes `abuse-rules.json`.
- **Import** parses the whole document, then matches each row on `id`. A row with an `id` must match a stored rule (archived included) and becomes an update through the existing update route with `expected_version` taken from the stored rule; `mode` and `enabled` fall back to the stored values when omitted. Unknown or duplicate ids fail the whole import before anything is written. A row without an `id` becomes a create through the existing create route, which stores the column defaults (`mode: log_only`, `enabled: true`); when the row sets a different `mode` or `enabled`, the import follows the create with an update so the row lands as written.
- Nothing is written until the operator confirms the preview. Writes run in document order and stop at the first failure, leaving earlier rows applied.

## Filter leaves

Every leaf has `kind`, `field`, `operator`, and `value`. A missing request
dimension or user field never matches an ordinary comparison, including
`not_in` and `neq`. Numeric user comparisons match only when both values are
numbers. An absent risk flag or measurement field never matches, including
under `neq`.

The predicate-less `missing` operator is the one way to target absence. Risk flags also accept it, with the semantics described in the `risk_flag` bullet below. It is available on every request dimension, on numeric, string, and email user fields (boolean user fields are always derived). It matches when the field is absent, `null`, or a blank string (empty or whitespace-only); those cases are not distinguished, and a blank string is likewise treated as absent by the ordinary operators. Because react-querybuilder requires a `value` on every rule, a `missing` leaf persists `value: null`; the parser discards whatever value the editor left behind and the schema rejects any other value.

- `request_dim` uses `in`, `not_in`, or `missing` over allowlisted request-time
  dimensions such as `country`, `asn`, `model_permaslug`, `provider`, and
  `http_path`. During Track A2 preflight evaluation, `provider` is absent
  because provider selection has not happened yet, so provider filters never
  match. Provider-scoped synthetic restrictions are dropped rather than
  enforced until a later track supports a resolved provider; A2 does not
  re-evaluate after routing.
  A2 evaluates once against the primary requested model only. The
  `model_permaslug` and `model_author` dimensions, along with model- and
  author-scoped derived restrictions, reflect that model and are not
  re-evaluated for fallback models or after routing resolves a provider.
  The `app_referer` and `app_title` dimensions reuse the generation
  app-attribution semantics (`getAppContext`): `app_referer` is the
  request's referer origin (trailing-slash, path-stripped), `app_title` is
  the client-supplied title header, and both are absent when the request
  does not attribute to an app. `user_agent` is the raw `user-agent` request
  header. Filter values are capped at 256 characters (longer values are
  rejected on save), so full browser user-agent strings cannot be matched;
  target short, distinctive client strings (e.g. `MyApp/1.0`) instead.
  `cf_bot_score` is the request's Cloudflare bot-management score (1-99,
  1-29 likely automated), read from the `cf-bot-score` managed-transform
  header and stringified verbatim. It is absent when the header is missing
  or non-integer, so bot-score filters never match (and never restrict)
  requests without a score. Match exact score values with `in` (e.g.
  `["1"]` for definitely-automated traffic); combine with other
  independent signals such as `app_referer`, `user_agent`, `model_author`,
  and young-account user fields rather than gating on the score alone.
- Free-text request dimensions (`STRING_MATCH_REQUEST_DIMS`: `region`, `city`,
  `asn_organization`, `model_permaslug`, `model_author`, `provider`, `http_path`,
  `app_referer`, `app_title`, `user_agent`) also take `contains_any` and
  `starts_with_any` with a non-empty string list. Matching is
  case-insensitive plain substring / prefix (no regex), bounded by value
  length times needle count. Numeric (`asn`, `cf_bot_score`) and
  fingerprint (`client_ip_hash`, `cf_ja3_hash`, `cf_ja4`) dimensions and
  short fixed codes (`continent`, `country`, `colo`, `http_method`) keep
  exact matching only. A reader that predates an operator rejects the leaf,
  so LiveConfig drops that rule (and an invalid trust-score policy scores
  nothing) instead of matching every request.
- `user_field` compares allowlisted fields fetched from the authenticated
  user or analytics object. Operators and value types are constrained per
  field category: numeric fields (`account_age_ms`, `balance`,
  `total_credits`, `signup_asn`, `signup_multi_accounting_score`, ...) accept `lt`, `lte`, `gt`, `gte`, `eq`,
  and `neq` with number values. Age fields (`account_age_ms`,
  `first_funded_at_age_ms`, `usage_updated_at_age_ms`) are measured back
  from evaluation time. `signup_to_first_funding_ms` is instead
  `users.first_funded_at - users.created_at`, fixed once the account is
  funded, so a rule can target fast time-to-fund at any account age (for
  example `signup_to_first_funding_ms lt 600000`: funded within 10 minutes of
  signup). It is derived at evaluation time, absent while `first_funded_at`
  is null or precedes `created_at` (inconsistent timestamps read as unknown).
  `first_funded_at` is the first positive credit of any type (paid top-up,
  promo code, transfer), so this is not the paid-only time-to-first-payment
  Sentinel shows on ban candidates. `signup_asn` identifies a network rather than
  measuring a quantity, so it additionally accepts `in` and `not_in` with a
  non-empty array of unsigned 32-bit integers; string fields (`signup_country`,
  `signup_sealed_metadata_status`, `onboarding_cf_country`,
  `signup_multi_accounting_risk_level`, `first_topup_card_funding`,
  `first_topup_method`) and
  boolean fields (`is_organization`, `is_enterprise`,
  `wallet_only`, `first_topup_card_country_mismatch`,
  `first_topup_billing_country_mismatch`) accept `eq` and `neq`
  with values of their own type; email
  fields (`email`) accept `eq`, `neq`, `domain_eq`, `domain_in`,
  `ends_with`, and `matches_regex` with string values (`domain_in` takes a
  string array).
- `risk_flag` references a flag from the risk-flag catalog (`packages/db/risk-flags/catalog.ts`) plus one of that flag's comparable measurement fields. Operators and value types are constrained per field category like `user_field`: numeric fields accept `lt`, `lte`, `gt`, `gte`, `eq`, and `neq` with numbers; string and boolean fields accept `eq` and `neq` with values of their own type. `seen_within_ms` is required on every leaf and bounds how old the entry's `computed_at` (UTC epoch seconds) may be at evaluation time; `null` means any age. An absent flag or measurement field never matches, including under `neq`. A `missing` leaf keeps `seen_within_ms` and matches exactly when a comparison on the same flag, field, and window would find no value: the flag has no entry, the entry is older than the window, or the entry lacks the field. That is how a rule targets accounts without a positive-only flag such as `verified_web_usage`. A risk-flag record or entry that fails validation is dropped before evaluation, so it also reads as absent and matches `missing`. This is a known gap, pinned by the `@existingBuggyBehavior` tests in `match-filters.test.ts`: treating unreadable state as unknown needs an unreadable marker carried from `parseStoredRiskFlags` (and its `packages/auth-data` copy) through the auth user context, the router users cache, and trust-score evidence, none of which keep the raw row. Until that lands, invalid records are visible on the `openrouter.auth.risk_flags.invalid` metric, and a rule that enforces off a risk-flag `missing` leaf should be checked against that metric first. Adding a catalog flag does not require a schema release.

User fields are derived by `buildUserRuleFields` (`build-user-fields.ts`) from the authenticated user row. `wallet_only` is `wallet_address` present and `email` absent, an authentication-shape signal rather than a stored column. `is_enterprise` mirrors the `users.is_enterprise` column and is always present, `false` for non-enterprise accounts. `first_topup_card_country_mismatch` compares `signup_country` with `first_topup_country` (the card's issuing country) and `first_topup_billing_country_mismatch` compares `signup_country` with `first_topup_billing_country` (the billing address on the charge). Both are absent (never `false`) when either side is unknown or is a Cloudflare unresolved sentinel (`XX`, `T1`), so a missing top-up is not evidence either way. They are the only boolean fields that take the `missing` operator, so a rule can test for that absent state. `onboarding_cf_country` is the Cloudflare country on the request that completed browser onboarding, absent when onboarding never completed, the request carried no country header, or the row was scrubbed by a data subject request, so `missing` targets accounts without a recorded browser onboarding. `signup_sealed_metadata_status` is `ok`, `invalid`, `absent` (no seal, no exemption), or the exemption for an unsealed signup: `provisioned`, `sso`, `invitation`, `org_membership`, or `scim`. `first_topup_method` is the payment rail of the account's first positive payment credit with a recognized rail, as stamped by the `set_users_first_topup_fields` trigger through `public.credit_first_topup_method`: one of `stripe`, `crypto`, `sequence`, or `purchase_order`, absent until a first top-up exists. A Stripe crypto payment (`credits.payment_method_type = 'crypto'`) reads as `crypto`, not `stripe`. All `first_topup_*` fields share the trigger's caveat: an account funded before the trigger existed, or whose first Stripe crypto top-up predates the corrected derivation, carries interim values until the reviewed `backfill-first-topup-fields` task recomputes the row from its earliest qualifying credits, so rules that enforce off these fields should wait for that backfill.

## Multi-rule composition

Each request evaluates every enabled, non-expired rule. There is no first-match
exit. Every match emits one rule hit, including allow rules and log-only rules.

```text
request
  |
  v
evaluate all enabled rules against KV-published config
  |
  +-- any matching allow rule? -- yes --> skip all rule-derived restrictions
  |                                      stored account restrictions unchanged
  |
  +-- no --> every matching enforce restrict rule contributes a synthetic
             restriction to the request restriction set
                         |
                         v
       merge by restriction kind, then process the combined set
```

This is the contract Track A implements. `evaluateRules` evaluates all
matching rules, emits deterministic hits, merges enforceable restrictions, and
applies enforcing allow exemptions. Filters are not re-parsed per request.
Restriction params are re-validated for each matching enforce rule to correlate
`restriction_kind` with the uncorrelated `restriction_params` union type.
Restriction merging is commutative and idempotent, so outcomes do not depend
on rule order. Rate limits use the minimum value for each defined field. Ban
and `forced_moderation` kinds merge by presence. Log-only matches emit their
own hits but contribute no enforced restriction. A matching `log_only` allow
emits a hit but does not exempt the request. Only a matching `enforce` allow
skips restrictions that rules would add for the request. They do not alter
stored account restrictions. Restrictions are returned in the fixed
`ENFORCEABLE_RULE_RESTRICTION_KINDS` order and hits are sorted deterministically,
independent of input rule order.

## Working examples

Each example is a complete row-shaped value accepted by `parseAbuseRule`.

### 1. Partner ASN allow rule

```json
{
  "id": "0192f7e0-7c4a-7b1a-8d10-6f4f7b3f8a12",
  "name": "Partner ASN exemption",
  "description": "Exempt traffic from the partner network.",
  "rule_type": "allow",
  "mode": "enforce",
  "enabled": true,
  "filters": {
    "combinator": "and",
    "rules": [
      {
        "kind": "request_dim",
        "field": "asn",
        "operator": "in",
        "value": ["64500"]
      }
    ]
  },
  "restriction_kind": null,
  "restriction_params": null,
  "expires_at": null,
  "version": 1,
  "created_by_clerk_user_id": null,
  "created_at": "2026-08-22T17:00:00.000Z",
  "updated_at": "2026-08-22T17:00:00.000Z"
}
```

This exempts matching partner ASN traffic from rule-derived restrictions.

### 2. Young account model rate limit

```json
{
  "id": "0192f7e0-7c4a-7b1a-8d10-6f4f7b3f8a13",
  "name": "Young account model limit",
  "description": "Limit new accounts on the target model.",
  "rule_type": "restrict",
  "mode": "enforce",
  "enabled": true,
  "filters": {
    "combinator": "and",
    "rules": [
      {
        "kind": "request_dim",
        "field": "model_permaslug",
        "operator": "in",
        "value": ["openai/gpt-4o"]
      },
      {
        "kind": "user_field",
        "field": "account_age_ms",
        "operator": "lt",
        "value": 604800000
      }
    ]
  },
  "restriction_kind": "rate_limit",
  "restriction_params": {
    "rpm": 4
  },
  "expires_at": null,
  "version": 1,
  "created_by_clerk_user_id": null,
  "created_at": "2026-08-22T17:00:00.000Z",
  "updated_at": "2026-08-22T17:00:00.000Z"
}
```

This limits young accounts to four requests per minute on the target model.

### 3. Signup burst forced moderation

```json
{
  "id": "0192f7e0-7c4a-7b1a-8d10-6f4f7b3f8a14",
  "name": "Signup burst moderation",
  "description": "Route signup bursts through forced moderation.",
  "rule_type": "restrict",
  "mode": "enforce",
  "enabled": true,
  "filters": {
    "combinator": "and",
    "rules": [
      {
        "kind": "risk_flag",
        "flag": "autobuy_funding_burst",
        "field": "count",
        "operator": "gte",
        "value": 5,
        "seen_within_ms": 3600000
      }
    ]
  },
  "restriction_kind": "forced_moderation",
  "restriction_params": {},
  "expires_at": null,
  "version": 1,
  "created_by_clerk_user_id": null,
  "created_at": "2026-08-22T17:00:00.000Z",
  "updated_at": "2026-08-22T17:00:00.000Z"
}
```

This adds forced moderation for users whose `autobuy_funding_burst` flag has a `count` of at least 5, computed within the last hour.

### 4. Model restriction with a nested OR group

```json
{
  "id": "0192f7e0-7c4a-7b1a-8d10-6f4f7b3f8a15",
  "name": "Model abuse restriction",
  "description": "Restrict the model for selected authors or low-balance users.",
  "rule_type": "restrict",
  "mode": "enforce",
  "enabled": true,
  "filters": {
    "combinator": "and",
    "rules": [
      {
        "kind": "request_dim",
        "field": "model_permaslug",
        "operator": "in",
        "value": ["anthropic/claude-3.5-sonnet"]
      },
      {
        "combinator": "or",
        "rules": [
          {
            "kind": "request_dim",
            "field": "model_author",
            "operator": "in",
            "value": ["anthropic"]
          },
          {
            "kind": "user_field",
            "field": "balance",
            "operator": "lte",
            "value": 0
          }
        ]
      }
    ]
  },
  "restriction_kind": "model_ban",
  "restriction_params": {},
  "expires_at": null,
  "version": 1,
  "created_by_clerk_user_id": null,
  "created_at": "2026-08-22T17:00:00.000Z",
  "updated_at": "2026-08-22T17:00:00.000Z"
}
```

This adds a model restriction when the target model is used by the selected
author or by an account with a non-positive balance.

### 5. Log-only provider rate-limit warning

```json
{
  "id": "0192f7e0-7c4a-7b1a-8d10-6f4f7b3f8a16",
  "name": "Provider risk warning",
  "description": "Observe traffic to the provider before enforcing a limit.",
  "rule_type": "restrict",
  "mode": "log_only",
  "enabled": true,
  "filters": {
    "combinator": "and",
    "rules": [
      {
        "kind": "request_dim",
        "field": "provider",
        "operator": "in",
        "value": ["provider.example"]
      }
    ]
  },
  "restriction_kind": "provider_rate_limit",
  "restriction_params": {
    "rpm": 4
  },
  "expires_at": null,
  "version": 1,
  "created_by_clerk_user_id": null,
  "created_at": "2026-08-22T17:00:00.000Z",
  "updated_at": "2026-08-22T17:00:00.000Z"
}
```

This emits warning-tier hits for provider traffic without enforcing the
provider rate limit.

## Restriction vocabulary

`restriction_kind` reuses the shared `public.restriction_kind` PostgreSQL
enum. `ENFORCEABLE_RULE_RESTRICTION_KINDS` is the narrower rule-model subset.
It excludes `account_ban`, `spend_cap`, and `inference_block`, which stay
reserved for durable human-reviewed account enforcement rather than
request-scoped synthetic restrictions. Every allowed restriction kind must
have matching parameters and a commutative, idempotent merge at its enforcement
site.

Rule hits are reviewed in Mission Control. Permanent enforcement is performed
through Sentinel promotion, not by writing a synthetic restriction back to the
account.

## Cross-track contracts

These implementations keep downstream tracks building against stable
cross-track interfaces:

- `evaluateRules` in `evaluate.ts` evaluates filters, emits deterministic hits,
  merges restrictions, and applies enforcing allow exemptions.
- `publishRules` and `fetchPublishedRules` in `publish.ts` publish and fetch the
  complete versioned rule set under one KV key. Fetch is fail-open: transport
  and validation failures log and return `null`. Publish logs and throws on
  read or write failures, and rejects a lower version than the stored set while
  allowing equal and higher versions. The A1 transport uses the
  Cloudflare REST API; isolate-cached binding reads belong to later router
  wiring. Track D1 calls `publishRules` on save.
- `RuleHitSignalSchema` in `schemas.ts` and `RuleHitSignal` in `hit.ts` define the
  `user_signals` `rule_hit` detail payload. Track A3 writes hits, and Track D3
  reads them for review.
