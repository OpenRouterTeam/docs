---
name: security-review
description: Security-review a diff touching caller-supplied row/tenant/workspace IDs; object-storage keys; cfw-frontend-api, packages/db, packages/clickhouse query helpers, user/workspace query filters; 'use server', Next.js route handlers, middleware, rollout flags, email allowlists, kill switches; tunnel-ingress-rules.ts, ingress or reverse-proxy path config; client-IP gates; COALESCE(..., false), ?? false, !isProduction(), OR_ENV; Stripe platform key, OPENROUTER_PROVISIONING_KEY, caller input in vendor SDK calls, platform-wide-key decrypt/sign, service-minted identity tokens, caller-named actor/reviewer fields; read-then-write on balances, caps, credits, promo-codes, primaryPreferred; server-side fetch, interpolated URL hosts, URL/host/region/account schema fields, packages/broadcast/destinations, ssrf-protection.ts host-family predicates; scripts/oxlint/ security rules and baselines; jwtVerify, packages/oidc; validated URL/host fields crossing Temporal activity args or queue payloads before a credential is attached.
user-invocable: true
---

# Security Review

The access half of the security review. It owns four classes: authorization,
SSRF, platform credential, and concurrency. The data-flow half (information
disclosure, data retention, content trust, agent boundary) is
`.agents/skills/security-review-data-trust/SKILL.md`. Both skills share one
method and the class directory `classes/` in this folder.

## When to use this skill

Invoke this skill when a diff touches any of the following. This list is the
full trigger set; the table in the next section maps each signal to its class.

- Caller-supplied row IDs (tenant/workspace) on authenticated routes
- Object-storage access or storage-key construction
- `services/cfw-frontend-api` routes, `packages/db` or `packages/clickhouse`
  query helpers, or caller-supplied user/workspace query filters
- `'use server'` directives, Next.js route handlers, or middleware gating them
- A rollout flag, email allowlist, or kill switch that decides who may reach a
  family of server actions or routes
- An ingress, tunnel, or reverse-proxy config deciding which paths reach a
  service
- A client IP address used to allow, deny, or rate-limit a request, or a
  relay header carrying a client IP to a downstream check
- A security flag or posture read through a `COALESCE`, a `?? false` default,
  or a negated environment predicate over a source that can be absent
- Platform-credential calls (platform Stripe key,
  `OPENROUTER_PROVISIONING_KEY`), caller input in vendor SDK calls,
  platform-wide-key decrypt/sign, or service-minted identity tokens
- A request body field or header naming the acting user, reviewer, or editor on a route authenticated by a shared key, static header, or possession-only bearer token
- Read-then-write on balances/caps, credits, or promo-codes, or a validation
  guard conditioned on a row read that can miss
- Server-side `fetch`, interpolated URL hosts, URL/host/region/account schema
  fields, or broadcast destinations
- A host-family predicate in `packages/helpers/ssrf-protection.ts`, its
  hostname normalization, or the set of validators calling it
- Security lint rules or baselines under `scripts/oxlint/`
- JWT/OIDC token verification parameters
- Validated URL/host fields handed across a serialization boundary (Temporal
  activity args, queue payloads) before a credential is attached

Matched signals dispatch to authorization, SSRF, platform credential, or
concurrency. A diff that also matches a data-flow signal runs the
`security-review-data-trust` skill as well.

## Triage as lookup, not judgment

Match concrete diff signals to a review class:

| Diff signal | Class |
| --- | --- |
| New or changed caller-supplied-ID path to a row read or write on any authenticated route regardless of service that touches the query call, scoping predicate, or query argument | `authorization` |
| Caller-supplied ID or workspace or tenant identifier reaches an object-storage `get`, `put`, `delete`, or `list` | `authorization` |
| Added or changed the function that constructs an object-storage key or authorizes the requested tenant or workspace scope | `authorization` |
| Added or changed exported functions with a module-level or function-level `'use server'` directive in any Next.js project including `projects/mission-control`, whether or not the name ends in `SA` | `authorization` |
| Added or changed middleware that exempts server-action requests (`POST` with a `next-action` header) from an authentication gate | `authorization` |
| Added or changed routes under `services/cfw-frontend-api` | `authorization` |
| Added or changed query helpers under `packages/db` or `packages/clickhouse` | `authorization` |
| Added or changed a Next.js API route handler (`app/api/**/route.ts`) in any Next.js project | `authorization` |
| A client-supplied user-id, creator-id, or workspace-id filter passed into an analytics or list query | `authorization` |
| A rollout flag, email allowlist, or kill switch gating a family of server actions or routes, evaluated in layout, RSC, or client code | `authorization` |
| An ingress, tunnel, or reverse-proxy config deciding which paths reach a service | `authorization` |
| A client IP read (`getClientIP`, `cf-connecting-ipv6`, `x-real-ip`, `x-forwarded-for`, a relay header such as `or-client-forwarded-ip`) feeding an allowlist, network-origin check, or rate-limit key | `authorization` |
| A security flag or posture derived from a nullable join column, an optional field with a permissive default, or a negated environment predicate (`!isProduction()`) | `authorization` |
| Caller-supplied identifier or object reaches a call made with a server-held platform credential (platform Stripe key, `OPENROUTER_PROVISIONING_KEY`, a management API client) | `platform-credential` |
| Caller-supplied object spread or forwarded into a vendor SDK call | `platform-credential` |
| A request body field or header (`actingClerkUserId`, `reviewerId`, `X-*-Actor-*`) naming the acting user on a route authenticated by a shared key, static header, or possession-only bearer token, or written into an attribution or audit column | `platform-credential` |
| A balance, count, cap, or already-done marker is read and a dependent write follows (refunds, redemptions, credit grants, quota consumption) | `concurrency` |
| Any change under `packages/db/credits` or `packages/db/promo-codes` | `concurrency` |
| A validation guard conditioned on a row read that can return no row, including a `primaryPreferred` read followed by a write on the primary | `concurrency` |
| Added or changed `fetch` calls, including in Next.js server actions, route handlers, and server-only helpers | `ssrf` |
| A fetch whose URL comes from an upstream provider response (artifact, asset, or content downloads in adapters) | `ssrf` |
| A URL rebuilt or re-parsed from previously validated parts before a fetch or before a credential is attached | `ssrf` |
| Template interpolation in a URL host position | `ssrf` |
| Any change under `packages/broadcast/destinations/` | `ssrf` |
| Functions that construct provider endpoint URLs from a region, host, account, or other configuration value | `ssrf` |
| Zod fields holding a URL, host, region, or account | `ssrf` |
| An added or changed host-family predicate in `packages/helpers/ssrf-protection.ts`, or its hostname normalization | `ssrf` |
| A change to `scripts/oxlint/rules-security.ts` or an entry added to any `scripts/oxlint/*-baseline.ts` | the class the rule enforces: `authorization` for action-wrapper and route-handler-gate baselines, `ssrf` for fetch baselines |
| Caller-influenced input reaches a decrypt or sign operation performed with a platform-wide key, or a service-minted identity token is attached to an outbound request | `platform-credential` |
| A `jwtVerify` call, or a change to its `algorithms`, `issuer`, or `audience` arguments, or any change under `packages/oidc` | `platform-credential` |
| A validated URL, host, or destination field crosses a serialization boundary (Temporal activity args, queue payload, DO RPC) before a credential is attached | `platform-credential` |

These are lookup signals. Do not infer a class from general security intent.

## One pass per matched class

For every matched class, spawn a separate subagent and give it only that
class file as security material. Each subagent reasons in isolation. Reading
several class files into one pass defeats the point.

Run the authorization pass from `classes/authorization.md`, the SSRF pass from
`classes/ssrf.md`, the platform-credential pass from
`classes/platform-credential.md`, and the concurrency pass from
`classes/concurrency.md` independently when more than one class matches.

## Sweep the shape, not the instance

When a pass confirms a finding, do not stop at the diff. Enumerate sibling
call sites that share the same wrong shape: the same helper family, the same
adapter interface method, the same route or actions family. Each sibling is
either fixed in the same change or listed by name as known-unfixed in the
report. Roughly half of recent findings were second instances of an
already-fixed shape, such as an artifact-download guard applied to one
modality's adapters while eleven sibling adapters kept the raw fetch, and a
role predicate fixed in one helper pair while a second pair kept the
short-circuit.

## Stop when nothing matches

If no signal matches, report that no security review class applies and stop.
Do not free-associate about security risks without a matching class. False
positives are what kill adoption.

## How to add a class

Add a class only when two or more independent incidents share one wrong shape
and one accepted safe primitive, and the class collapses to a single sentence.
One incident is not a class. Put it under an existing class as a failure mode,
or record it as a note in the directory where it happened.

Use `classes/_template.md` as the required skeleton. A new class file lives
in `classes/` and is owned by exactly one of the two skills: register its
triage rows, trigger bullets, and description tokens in that skill only.

A class is reachable only if an agent decides to open this skill, and all it
sees before that is this file's `description`. Selection happens on the
description's literal tokens — path prefixes, directive strings, env-var and
column names — so the description carries those identifiers rather than
category names. When a class gains a triage signal, add it to the table, add it
to "When to use this skill", and add its literal identifier to the description
of the skill that owns the class. The description is capped at 1024 characters
(`scripts/ci/lint-skills.ts` enforces it), so adding an identifier usually
means dropping or shortening a lower-value one. An unquoted `: ` inside the
description breaks the YAML.
