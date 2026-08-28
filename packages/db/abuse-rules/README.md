# Abuse rules

An abuse rule is a dynamic allow or restrict rule. Track A evaluates enabled
rules in memory for each request against configuration published through KV.
The inference path never reads these rules from Postgres. A match has
request-scoped effects only: a synthetic restriction and an asynchronous
`rule_hit` signal to ClickHouse `user_signals`. Nothing is ever written to or
removed from the account.

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

## Filter leaves

Every leaf has `kind`, `field`, `operator`, and `value`. A missing request
dimension or user field never matches, including `not_in` and `neq`. Numeric
user comparisons match only when both values are numbers. An absent risk flag
or measurement field never matches, including under `neq`.

- `request_dim` uses `in` or `not_in` over allowlisted request-time
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
- `user_field` compares allowlisted fields fetched from the authenticated
  user or analytics object. Operators and value types are constrained per
  field category: numeric fields (`account_age_ms`, `balance`,
  `total_credits`, `signup_asn`, ...) accept `lt`, `lte`, `gt`, `gte`, `eq`,
  and `neq` with number values; string fields (`signup_country`,
  `signup_sealed_metadata_status`) and boolean fields (`is_organization`,
  `wallet_only`) accept `eq` and `neq` with values of their own type; email
  fields (`email`) accept `eq`, `neq`, `domain_eq`, `domain_in`,
  `ends_with`, and `matches_regex` with string values (`domain_in` takes a
  string array).
- `risk_flag` references a flag from the risk-flag catalog
  (`packages/db/risk-flags/catalog.ts`) plus one of that flag's comparable
  measurement fields. Operators and value types are constrained per field
  category like `user_field`: numeric fields accept `lt`, `lte`, `gt`, `gte`,
  `eq`, and `neq` with numbers; string and boolean fields accept `eq` and
  `neq` with values of their own type. `seen_within_ms` bounds how old the
  entry's `computed_at` (UTC epoch seconds) may be at evaluation time
  (`null` = any age);
  windowed-staleness flags require a cutoff while durable flags default to
  `null`. An absent flag or measurement field never matches, including under
  `neq`. Adding a catalog flag does not require a schema release.

The router derives `wallet_only` as `wallet_address` present and `email`
absent. This is an authentication-shape signal, not a stored database
column.

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
        "flag": "signup_ip_burst",
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

This adds forced moderation for users whose `signup_ip_burst` flag has a `count` of at least 5, computed within the last hour.

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
- `RuleHitSignalSchema` and `RuleHitSignal` in `hit.ts` define the
  `user_signals` `rule_hit` detail payload. Track A3 writes hits, and Track D3
  reads them for review.
