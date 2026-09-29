---
name: security-review-data-trust
description: Security-review diffs touching Endpoint, ModelInfo, ProviderInfo fields, SANITIZE_SERVER_DATA_BLOCKED_KEYS, stripProviderOwnership, is_hidden, is_private, deleted, selectAll, returningAll on public routes; upstream error text in client-visible fields; secrets or whole rows in wLog, iLog, eLog; URLs in rawError, redactUrlForLogging; normalizedHeaders spreads in logs; String(error); credentials in URL query strings or headers forwarded to fetch or Headers; tables keyed by clerk_user_id or entity_id, scrub-user.ts; detect-prompt-injection, CSP directives; caller text in OG images (/dynamic-og); new RegExp, regex-safety.ts, validateContentFilterPattern; outside text in prompts for agents with platform credentials, BEGIN UNTRUSTED, neutralizeFenceMarkers; cfw-secret-vault, cfw-intern-provisioner, intern-enqueue-signature.ts; secrets, tools, data, or MCP servers handed to an agent runtime; allowlists keyed on an agent-supplied host or placeholder; cross-tenant service accounts or signing tokens, shared master keys.
user-invocable: true
---

# Security Review: data flow and trust boundaries

The data-flow half of the security review. It owns four classes:
information disclosure, data retention, content trust, and agent boundary.
The access half (authorization, SSRF, platform credential, concurrency) is
`.agents/skills/security-review/SKILL.md`. Both skills share one method and
one class directory, `.agents/skills/security-review/classes/`.

## When to use this skill

Invoke this skill when a diff touches any of the following. This list is the
full trigger set; the table in the next section maps each signal to its class.

- Model/endpoint/provider objects served to clients, sanitizer blocklists,
  public-projection allowlists, or visibility-flag rows on public routes
- Postgres rows served unauthenticated
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
- Public routes rendering caller-supplied text into an image, embed, or other
  first-party-branded artifact
- Caller-supplied regex source compiled with `new RegExp`, or any change to the
  ReDoS detectors in `packages/lib/regex-safety/regex-safety.ts` or to
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

Matched signals dispatch to information disclosure, data retention, content
trust, or agent boundary. A diff that also matches an access signal runs the
`security-review` skill as well.

## Triage as lookup, not judgment

Match concrete diff signals to a review class:

| Diff signal | Class |
| --- | --- |
| A log context that can carry a secret, a one-time credential, or a token value, including a whole row passed to `wLog`, `iLog`, or `eLog` | `data-retention` |
| A user-supplied or fetched-resource URL embedded verbatim in a `rawError`, error message, or log field | `data-retention` |
| A header object, or a spread of one, passed to `wLog`, `iLog`, or `eLog`, on any path including error branches | `data-retention` |
| A raw error object or `String(error)` from an auth or token client passed into log extra | `data-retention` |
| A credential reaches a URL query string, or an unvalidated credential header is forwarded to `fetch` or `Headers`, even with no log statement in the diff | `data-retention` |
| A new table or column keyed by `clerk_user_id`, `entity_id`, or another user identifier, or any change to `packages/db/users/scrub-user.ts` | `data-retention` |
| Any change under `packages/guardrails/use-cases/detect-prompt-injection/` | `content-trust` |
| An origin, wildcard host, or wildcard port added to a CSP directive in `projects/web/next.config.ts` | `content-trust` |
| An upstream provider failure reason or error message reaches a client-visible error, message, or status field | `info-disclosure` |
| A public route renders caller-supplied text into an image, embed, or other branded artifact | `content-trust` |
| A caller-supplied pattern string reaches `new RegExp`, or a change touches `packages/lib/regex-safety/regex-safety.ts` or `packages/guardrails/helpers/validate-content-filter-pattern.ts` | `content-trust` |
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

Run the information-disclosure pass from
`.agents/skills/security-review/classes/info-disclosure.md`, the
data-retention pass from
`.agents/skills/security-review/classes/data-retention.md`, the content-trust
pass from `.agents/skills/security-review/classes/content-trust.md`, and the
agent-boundary pass from
`.agents/skills/security-review/classes/agent-boundary.md` independently when
more than one class matches.

## Sweep the shape, stop when nothing matches, add a class

Follow the same three sections in `.agents/skills/security-review/SKILL.md`:
enumerate sibling call sites that share a confirmed wrong shape, report that
no class applies when no signal matches, and add a class only from
`.agents/skills/security-review/classes/_template.md` when two or more
incidents share one wrong shape.

A class is reachable only if an agent decides to open this skill, and all it
sees before that is this file's `description`. Selection happens on the
description's literal tokens, so when one of these four classes gains a triage
signal, add it to the table, add it to "When to use this skill", and add its
literal identifier to this description. The description is capped at 1024
characters (`scripts/ci/lint-skills.ts` enforces it). An unquoted `: ` inside
the description breaks the YAML.
