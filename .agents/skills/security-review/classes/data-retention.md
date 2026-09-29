# Data Retention Review

This class applies when a change:

- Adds or widens a log context that can carry a secret, a one-time credential,
  or a user identifier.
- Embeds a user-supplied or fetched-resource URL into an error message,
  `rawError`, or log field.
- Passes a header object, or a spread of one, to a log function.
- Puts a raw error object from an auth or token client into log context.
- Lets a credential reach a URL query string or an unvalidated header forwarded
  to `fetch` / `Headers`, where platform-layer logging records it.
- Adds a table, or a column on an existing table, keyed by `clerk_user_id`,
  `entity_id`, or another user identifier.
- Changes `packages/db/users/scrub-user.ts` or the grants that let the scrub
  reach a table.

## Rule

**A sensitive value must not come to rest in a store that has no path to
remove it.** Two stores sit outside the user row and are reached by ordinary
feature work: log context, which is never scrubbed, and user-scoped tables,
which are scrubbed only by name.

## Failure modes to reject

### The credential rides along in the log context

A log line built for debugging takes whatever object is at hand. The auth-code
paths logged the PKCE `code_verifier` and `code_challenge` alongside the code
row, so a single-use credential landed in a log store with a retention window
of its own and an audience wider than the request (PR
[#34897](https://github.com/OpenRouterTeam/openrouter-web/pull/34897)).

The accepted remedy is an explicit field pick over the row, not the row.
Evidence: `packages/db/auth-codes/pkce.ts:86`, whose `pick(code, ['id',
'api_key_id', 'clerk_user_id', 'app_id'])` is the object every `wLog` in that
file and in
`services/cfw-api/src/routes/auth/exchange-auth-code.ts` shares. A verifier, a
challenge, a token, and a key are debugging-adjacent but never debugging data:
their presence or absence is loggable, their value is not.

### The URL carries the credential into the message

A URL embedded verbatim in a `rawError`, error message, or log field leaks
whatever its query string holds. Signed URLs carry credentials in query
params: AWS presigned `AWSAccessKeyId` / `Signature` / `X-Amz-*`,
`token=<JWT>`, Google `key=` / `signature=` (PR
[#37180](https://github.com/OpenRouterTeam/openrouter-web/pull/37180)).

The accepted remedy is query-string redaction before the URL is embedded:
`redactUrlForLogging` from `packages/helpers/url.ts`. Reject any user-supplied
or fetched-resource URL interpolated raw into an error or log string.

### The header object rides along

A whole header object, or a spread of one, passed to `wLog`, `iLog`, or
`eLog` dumps `authorization` and API-key headers. Rare error paths are not an
exception: a single parse-failure branch that logs `normalizedHeaders` leaks
every credential header (PR
[#37181](https://github.com/OpenRouterTeam/openrouter-web/pull/37181)).

The accepted remedy is the same field pick as for rows: name the individual
header fields the line needs, never the object or a spread of it.

### The auth client's error embeds the credential

A raw error object, or `String(error)`, from an auth or token client (GCS
auth, OIDC token clients) can embed request and credential material. The
accepted remedy is `error.message` plus a stable code in the log extra, never
the raw error (PR
[#37185](https://github.com/OpenRouterTeam/openrouter-web/pull/37185)).

### The platform logs it before the application does

Some values are recorded by platform-layer logging with no application log
statement in the diff. A header value containing non-ASCII bytes triggers a
Cloudflare workerd warning that echoes the full header value into Workers
Logs. URL query strings are recorded verbatim by Vercel request logging
before middleware runs.

Treat a credential in a URL query param, and an unvalidated credential header
forwarded to `fetch` or `Headers`, as leaks even when no application code
logs them. The remedy is to keep the credential out of the query string or
header path, not to adjust logging.

### The new user-scoped table never joins the scrub

`scrubPostgresUser` enumerates the columns it nulls and the tables it deletes
from, so a table added after it was written retains its rows through a
deletion request, and nothing fails when it does. The alert platform's
delivery and policy tables were keyed by `entity_id` and untouched by the
scrub (PR
[#33715](https://github.com/OpenRouterTeam/openrouter-web/pull/33715)).

The accepted remedy is to extend the scrub in the same change that adds the
table, and to prefer whole-row deletion when the row's identity-bearing keys
are `NOT NULL` and the data has no financial or audit value — deletion also
survives later migrations that add columns. Evidence:
`packages/db/users/scrub-user.ts`, the `delete-alert-*` blocks, and the
comment above them stating that choice. A table the scrub cannot reach needs a
grant too: `packages/db/infra/grants/pg-us-central1-service-users.sql`.

## What the primitives do not give you

`pick` narrows one call site. It does not stop the next log line in the same
function from passing the whole row, so the pick belongs in a shared variable
that every log in the path uses.

The scrub is a hand-maintained enumeration with no schema-level completeness
check, so nothing tells you a new table is missing from it. `SCRUB_USER_COLUMNS`
covers the `users` row only.

A detection-only scanner is not redaction. A plugin that logs "Detected
<pattern>" metadata does not stop the original payload from being logged
elsewhere; never accept a detector as mitigation for a logging finding.

## Test requirement

A log change in scope proves the value is absent from the emitted context; copy
`packages/db/auth-codes/pkce.test.ts`. A scrub change ships Postgres
integration coverage that seeds the table for the user, runs the scrub, and
asserts the rows are gone or the columns are null, plus grant coverage for the
service role; copy `packages/db/integration/users/scrub-user.test.ts` and
`packages/db/integration/users/scrub-user-grants.test.ts`. Report a missing
proof as `TEST GAP`, never as a vulnerability finding.

## Calibration

Two incidents as of 2026-08-19, both introduced by ordinary feature work
rather than by a change to a security control: neither the log line nor the
new table looked like a security surface at review time. The signal is a
sensitive value entering a secondary store, not the word "log" or "delete" in
a diff.
