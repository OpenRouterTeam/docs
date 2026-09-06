---
name: security-review
description: Security-review a diff touching caller-supplied row/tenant/workspace IDs on authenticated routes; object-storage get/put/delete/list or storage-key construction; services/cfw-frontend-api routes, packages/db or packages/clickhouse query helpers, caller-supplied user/workspace filters; 'use server', Next.js route handlers or gating middleware; rollout flags or email allowlists gating a server-action family, ingress/tunnel path configs (Cloudflare tunnel `ingress`, `tunnel-ingress-rules.ts`); platform-credential calls (Stripe platform key, OPENROUTER_PROVISIONING_KEY), caller input in vendor SDK calls, platform-key decrypt/sign, service-minted identity tokens; read-then-write on balances/caps, credits, promo-codes, validation guards conditioned on a `primaryPreferred` row read; server-side fetch, interpolated URL hosts, URL/host/region/account schema fields, broadcast destinations, host-family predicates in `packages/helpers/ssrf-protection.ts` (`isInternalDnsHost`, `isKubernetesInternalHost`, `isCloudMetadataHost`, `isCloudflareTunnelHost`); scripts/oxlint/ security rules or baselines; model/endpoint/provider objects, sanitizer blocklists, public-projection allowlists or visibility flags on public routes; unauthenticated Postgres rows; JWT/OIDC verification params; log context or user-scoped tables retaining secrets/PII; user-supplied or fetched URLs interpolated into `rawError`/error/log strings (signed-URL query params, `redactUrlForLogging`), header objects or spreads passed to wLog/iLog/eLog (`normalizedHeaders`), raw auth/token-client errors or `String(error)` in log extra, credentials in URL query strings or unvalidated headers forwarded to fetch/Headers (Cloudflare workerd header warnings, Vercel request logs); prompt-injection detection, its allowlist, CSP directives; upstream provider error/failure-reason text written to client-visible error fields; validated URL/host fields crossing Temporal activity args or queue payloads; caller-supplied text rendered into OG images or other branded artifacts (`/dynamic-og`); caller-supplied regex compiled with `new RegExp`, `packages/helpers/regex-safety.ts` ReDoS detectors, `validateContentFilterPattern`; outside text (CRM fields, repository content, applicant submissions, tool or model output) interpolated into a prompt for a model or agent holding platform credentials or internal data access, `--- BEGIN UNTRUSTED` fences and `neutralizeFenceMarkers`; changes under services/cfw-secret-vault or services/cfw-intern-provisioner, `intern-enqueue-signature.ts`; the set of secrets, tools, or data handed to an agent runtime, a skill it loads, an MCP server, or a subprocess; allowlists keyed on an agent-supplied destination host, statement class, or placeholder name; service accounts, API keys, or signing tokens shared across tenants' agents or derived from a shared master key.
user-invocable: true
---

# Security Review

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
- Platform-credential calls (platform Stripe key,
  `OPENROUTER_PROVISIONING_KEY`), caller input in vendor SDK calls,
  platform-wide-key decrypt/sign, or service-minted identity tokens
- Read-then-write on balances/caps, credits, or promo-codes, or a validation
  guard conditioned on a row read that can miss
- Server-side `fetch`, interpolated URL hosts, URL/host/region/account schema
  fields, or broadcast destinations
- A host-family predicate in `packages/helpers/ssrf-protection.ts`, its
  hostname normalization, or the set of validators calling it
- Security lint rules or baselines under `scripts/oxlint/`
- Model/endpoint/provider objects served to clients, sanitizer blocklists,
  public-projection allowlists, or visibility-flag rows on public routes
- Postgres rows served unauthenticated
- JWT/OIDC token verification parameters
- Log context or new user-scoped tables that can retain secrets or PII past a
  deletion request
- A user-supplied or fetched-resource URL embedded in a `rawError`, error
  message, or log field
- A header object, or a spread of one, passed to a log function
- A raw error object or `String(error)` from an auth or token client in log
  context
- A credential in a URL query string, or an unvalidated credential header
  forwarded to `fetch` / `Headers`
- Prompt-injection detection, its allowlist, and CSP directives
- Upstream provider error or failure-reason text written to a client-visible
  error, message, or status field
- Validated URL/host fields handed across a serialization boundary (Temporal
  activity args, queue payloads) before a credential is attached
- Public routes rendering caller-supplied text into an image, embed, or other
  first-party-branded artifact
- Caller-supplied regex source compiled with `new RegExp`, or any change to the
  ReDoS detectors in `packages/helpers/regex-safety.ts` or to
  `validateContentFilterPattern`
- Outside text (CRM fields, repository content, applicant submissions, tool
  or model output) interpolated into a prompt for a model or agent that runs
  with platform credentials, or a change to an `UNTRUSTED` prompt fence or
  its neutralizer
- Any change under `services/cfw-secret-vault` or
  `services/cfw-intern-provisioner`, or to
  `packages/helpers/intern-enqueue-signature.ts`
- The set of secrets, tools, or data handed to an agent runtime, a skill it
  loads, an MCP server it connects, or a subprocess it spawns
- An allowlist gate keyed on a value the agent's own request supplies (a
  destination host, a statement class, a placeholder name)
- A platform identity (service account, API key, signing token) shared across
  tenants' agents or derived from a shared master key

Matched signals dispatch to authorization, SSRF, information disclosure,
platform credential, concurrency, data retention, content trust, or agent
boundary.

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
| Caller-supplied identifier or object reaches a call made with a server-held platform credential (platform Stripe key, `OPENROUTER_PROVISIONING_KEY`, a management API client) | `platform-credential` |
| Caller-supplied object spread or forwarded into a vendor SDK call | `platform-credential` |
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
| A log context that can carry a secret, a one-time credential, or a token value, including a whole row passed to `wLog`, `iLog`, or `eLog` | `data-retention` |
| A user-supplied or fetched-resource URL embedded verbatim in a `rawError`, error message, or log field | `data-retention` |
| A header object, or a spread of one, passed to `wLog`, `iLog`, or `eLog`, on any path including error branches | `data-retention` |
| A raw error object or `String(error)` from an auth or token client passed into log extra | `data-retention` |
| A credential reaches a URL query string, or an unvalidated credential header is forwarded to `fetch` or `Headers`, even with no log statement in the diff | `data-retention` |
| A new table or column keyed by `clerk_user_id`, `entity_id`, or another user identifier, or any change to `packages/db/users/scrub-user.ts` | `data-retention` |
| Any change under `packages/guardrails/use-cases/detect-prompt-injection/` | `content-trust` |
| An origin, wildcard host, or wildcard port added to a CSP directive in `projects/web/next.config.ts` | `content-trust` |
| An upstream provider failure reason or error message reaches a client-visible error, message, or status field | `info-disclosure` |
| A validated URL, host, or destination field crosses a serialization boundary (Temporal activity args, queue payload, DO RPC) before a credential is attached | `platform-credential` |
| A public route renders caller-supplied text into an image, embed, or other branded artifact | `content-trust` |
| A caller-supplied pattern string reaches `new RegExp`, or a change touches `packages/helpers/regex-safety.ts` or `packages/guardrails/helpers/validate-content-filter-pattern.ts` | `content-trust` |
| A response payload that carries a model, endpoint, or provider object out of KV or Postgres to a client | `info-disclosure` |
| A field added to `Endpoint`, `ModelInfo`, or `ProviderInfo`, or to anything nested inside them | `info-disclosure` |
| Any change to `SANITIZE_SERVER_DATA_BLOCKED_KEYS`, `stripProviderOwnership`, or either allowlist in `services/cfw-frontend-api/src/routes/sanitize-coverage.test.ts` | `info-disclosure` |
| A public, unauthenticated route returns a row from a table carrying a visibility flag such as `is_hidden`, `is_private`, or `deleted` | `info-disclosure` |
| A public, unauthenticated route reads a `packages/db` accessor that projects every column (`selectAll`, `returningAll`), whether or not the table holds model, endpoint, or provider data | `info-disclosure` |
| Outside text (CRM fields, repository content, applicant submissions, tool or model output) interpolated into a prompt for a model or agent that runs with platform credentials or internal data access, or a change to an `UNTRUSTED` prompt fence or `neutralizeFenceMarkers` | `agent-boundary` |
| Any change under `services/cfw-secret-vault` or `services/cfw-intern-provisioner`, or to `packages/helpers/intern-enqueue-signature.ts` | `agent-boundary` |
| The set of secrets, tools, or data handed to an agent runtime, a skill it loads, an MCP server it connects, or a subprocess it spawns | `agent-boundary` |
| An allowlist gate keyed on a value the agent's own request supplies (a destination host, a statement class, a placeholder name) rather than on a binding made when the resource was provisioned | `agent-boundary` |
| A platform identity (service account, API key, signing token) shared across more than one tenant's agent, or a per-tenant credential derived from a shared master key | `agent-boundary` |

These are lookup signals. Do not infer a class from general security intent.

## One pass per matched class

For every matched class, spawn a separate subagent and give it only that
class file as security material. Each subagent reasons in isolation. Reading
several class files into one pass defeats the point.

Run the authorization pass from `classes/authorization.md`, the SSRF pass from
`classes/ssrf.md`, the information-disclosure pass from
`classes/info-disclosure.md`, the platform-credential pass from
`classes/platform-credential.md`, the concurrency pass from
`classes/concurrency.md`, the data-retention pass from
`classes/data-retention.md`, the content-trust pass from
`classes/content-trust.md`, and the agent-boundary pass from
`classes/agent-boundary.md` independently when more than one class matches.

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

Use `classes/_template.md` as the required skeleton.

A class is reachable only if an agent decides to open this skill, and all it
sees before that is this file's `description`. Selection happens on the
description's literal tokens — path prefixes, directive strings, env-var and
column names — so the description carries those identifiers rather than
category names. When a class gains a triage signal, add it to the table, add it
to "When to use this skill", and add its literal identifier to the description.
