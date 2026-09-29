# Information Disclosure Review

This class applies when a change:

- Adds or changes a response payload that carries a model, endpoint, or
  provider object out of KV or Postgres to a client.
- Adds a field to `Endpoint`, `ModelInfo`, or `ProviderInfo`, or to anything
  nested inside them.
- Changes `SANITIZE_SERVER_DATA_BLOCKED_KEYS`, `stripProviderOwnership`, or
  either allowlist in `services/cfw-frontend-api/src/routes/sanitize-coverage.test.ts`.
- Adds or changes a public, unauthenticated route that returns a row from a
  table carrying a visibility flag such as `is_hidden`, `is_private`, or
  `deleted`.
- Points a public, unauthenticated route at a `packages/db` accessor that
  projects every column, whatever the table holds.
- Writes an upstream provider failure reason or error message into a
  client-visible error, message, or status field.

## Rule

**A server object reaches a client only through a filter, and the filter must
name every server-only field on that object.** Both halves fail
independently: a response can skip the filter, and a filter can be applied to
a field it has never heard of. Every incident below is one half or the other.

## Exit early on a field addition

Most field additions to these objects are ordinary schema work. Before
reviewing anything, answer one question: does the new field carry data the
object's clients are not entitled to see, such as a cost, a capacity or
routing signal, an internal identifier, or a moderation setting?

If it does not, report that no server-only field was added and stop. If it
does, the only thing to check is that this same PR blocklists the key or
excludes it from the explicit projection. Do not review the routes.

## Failure modes to reject

### The response never runs through the filter

A handler returns the object it read, verbatim. The endpoint and model objects
served by `cfw-frontend-api` come from the raw endpoint caches, so "verbatim"
means the full internal row.

`models/search` returned `c.json(result.data)` while its siblings
`models/find`, `private/models`, and the models catalog all sanitized. It
leaked `fortuna`, `routing_heuristics`, `owner_clerk_user_id`, and the nested
`provider_info` moderation fields to anonymous callers on an edge-cacheable
route (SEC-104, PR
[#29911](https://github.com/OpenRouterTeam/openrouter-web/pull/29911),
commit `c142dbfb08`).

Fixing one route did not fix the shape. `author-models`, `author-page`, and
`provider-page` were the same public feeds over the same caches, verified
still leaking in production the day after, including 255 occurrences of
`owner_clerk_user_id` on one `provider-page` response (PR
[#30917](https://github.com/OpenRouterTeam/openrouter-web/pull/30917),
commit `2741177224`).

The accepted remedy is `sanitizeServerData` at the response boundary:

```ts
import { sanitizeServerData } from '@openrouter-monorepo/helpers/sanitize-server-data';
```

Evidence: `packages/helpers/sanitize-server-data.ts:29-35`, and the live call
sites `services/cfw-frontend-api/src/routes/catalog/models-search/route.ts:119` and
`services/cfw-frontend-api/src/routes/catalog/catalog-models/route.ts:26`.

Two details from #30917 are worth copying. Put the call at the response
boundary rather than before a cache write, so entries already written
unsanitized are scrubbed on the way out. And for a public feed, add
`stripProviderOwnership`, which drops `provider_info.owners` / `.editors`;
those keys are deliberately not in the global blocklist because Mission
Control's provider editor reads them through the same sanitizer. Evidence:
`services/cfw-frontend-api/src/helpers/sanitize-public-feed-data.ts:6-12`.

### The row's own visibility flags never ran

Field filters decide which columns leave the server; they say nothing about
whether the row should have been served at all. The public app-collection
handler returned the title and per-model usage of `is_hidden` and
`is_private` apps to unauthenticated callers who supplied the app's exact
origin URL, while the sibling app-by-slug handler in the same file already
404ed on those flags (SEC-169, PR
[#33076](https://github.com/OpenRouterTeam/openrouter-web/pull/33076)). The
accepted remedy is the shared `toVisiblePublicApp` helper applied before any
derived query runs, so a hidden or private row yields a masked response and
no analytics read. On a public route, check the row's visibility flags first
and compare against the siblings that already do.

### The public route inherits every column the table has

An accessor that selects every column has no client in mind, so a public
route serving it publishes whatever the table holds and whatever it is given
later. The other incidents in this class are endpoint and model objects out
of KV, but nothing marks an ordinary Postgres row as server data either, and
it reaches anonymous callers the same way.

The unauthenticated `GET /api/frontend/v1/data-policy` route served
`getAllDataPolicies()`, a `selectAll()` accessor it shared with the
authenticated internal Buddy API route, and published the staff
`last_edited_clerk_user_id` on every policy (SEC-181, PR
[#33558](https://github.com/OpenRouterTeam/openrouter-web/pull/33558)).

The accepted remedy is a second accessor with an explicit column list for the
public route, plus a payload type omitting the internal column so the narrowed
shape holds at the type level, leaving the full-row accessor to the
authenticated caller. Evidence: `packages/db/data-policies/queries.ts`. Do not
reach for the blocklist when an admin surface legitimately reads the same key,
since removing it globally breaks that surface. Project at the query the
public route calls instead.

So on a public route, read the accessor and not just the handler. A
`selectAll()` accessor shared with an authenticated route is the signal,
whatever the table.

### The filter has never heard of the field

The blocklist matches exact keys, so a new server-only field is public by
default from the commit that introduces it until someone notices.

Three separate fixes did nothing but name a field that was already live:
`routing_heuristics` (PR
[#27431](https://github.com/OpenRouterTeam/openrouter-web/pull/27431),
commit `4bf9dcfb3e`), the sibling `fortuna` blob left behind by that fix (PR
[#28256](https://github.com/OpenRouterTeam/openrouter-web/pull/28256),
commit `a21036430b`), and the `routing_heuristics_by_tier` /
`routing_heuristics_regional` variants, which carry
`effective_prompt_price` — our post-discount provider cost, next to the list
price in the same object — and which slipped past an already-sanitized route
because the blocklist covered only the unsuffixed key (PR
[#30813](https://github.com/OpenRouterTeam/openrouter-web/pull/30813),
commit `52e5681158`).

Two of the three were reported to us from outside: a third-party dashboard
publishing our derank verdicts, and a provider quoting `capacity_ceiling_rpm`
back to us.

The accepted remedy is to add the key in the same PR that adds the field. PR
[#31291](https://github.com/OpenRouterTeam/openrouter-web/pull/31291),
commit `269a3e5535`, introduced `perf_last_30m` / `perf_last_30m_by_tier` and
blocklisted both in the same change. Evidence:
`packages/helpers/sanitize-server-data.ts:6-22`.

For a client contract that is small and stable, prefer an explicit projection
over the shared blocklist. `cfw-public-api` calls no sanitizer at all: it
maps each endpoint through `toPublicEndpoint`, a Zod-validated allowlist, so a
new `Endpoint` field is private by default there. Evidence:
`services/cfw-public-api/src/routes/endpoints/helpers/to-public-endpoint.ts:19-23`.

### The upstream error text became the client's error text

An error, message, or status field a client can read is a response payload,
and a provider's failure text is a server object: it names the provider, and
can carry our vendor account identifiers, quota numbers, and internal
configuration. Batch finalize stored the provider's rejection text verbatim
under the batch's public `error` key, publishing our OpenAI org id and quota
numbers to callers (PR
[#35526](https://github.com/OpenRouterTeam/openrouter-web/pull/35526)).

The accepted remedy selects our own copy from a normalized error class at the
single writer of the client-visible key, so the key's contract is "public
copy only"; the raw upstream text stays in logs. Evidence:
`services/batch-api/src/public-failure-message.ts` and the redaction note on
`buildBatchResultMetadata` in
`services/batch-api/src/batch-result-metadata.ts:39-48`. Redact at the
writer, not at each reader: a key with several readers and one writer has one
place where the contract can hold.

## What the primitives do not give you

`sanitizeServerData` drops a fixed set of exact, case-sensitive keys at any
depth. It does not know what an object is, so:

- It blocks `api_key` and passes `apiKey` and `API_KEY`.
- It blocks `routing_heuristics` and passes any new suffixed variant.
- It does not block `provider_info.owners` / `.editors`.

It also JSON round-trips the value, so a `Date` becomes a string and a `Map`
becomes `{}`. Verified against the current implementation on 2026-08-03.

`services/cfw-frontend-api/src/routes/sanitize-coverage.test.ts` is a
tripwire, not a control, and it is scoped to `cfw-frontend-api` routes only.
It is a source regex: it proves the call appears in a route directory, never
that it sits on every response path. It only scans routes whose source
matches `ENDPOINT_DATA_PATTERN`, so a route reaching endpoint data through a
new identifier is silently unchecked. This is not hypothetical: the
`catalog-models` feed reached endpoint data through the shared
`getHydratedModels` helper, which the pattern did not name, and leaked
provider `owners` / `editors` Clerk IDs to anonymous callers after the
#30917 sweep (SEC-178, PR
[#33480](https://github.com/OpenRouterTeam/openrouter-web/pull/33480)). A PR
that introduces a new helper or identifier through which a route reaches
endpoint data must extend `ENDPOINT_DATA_PATTERN` in the same change.
Evidence: `services/cfw-frontend-api/src/routes/sanitize-coverage.test.ts:31-32`.

Both allowlists in that file assert a human verified a full response tree.
`REVIEWED_PROJECTION_ROUTES` and `OWNERSHIP_REVIEWED_ROUTES` are the two
places where the guard's answer is "someone checked", so a diff that adds a
route to either one is a review of that claim, not of the diff.
Evidence: `services/cfw-frontend-api/src/routes/sanitize-coverage.test.ts:37-59`.

## Review checklist

1. Which server object does this response carry, and where does it enter the
   response tree?
2. Is a filter applied on every return path, including cache-hit paths?
3. If the change adds a field to a server object, is that field blocklisted or
   excluded by an explicit projection in this same PR?
4. If the route is public, does it also strip provider ownership, and does the
   accessor it calls project columns explicitly rather than selecting all?
5. If the change adds an allowlist entry, does the PR state the verified
   response tree?

## Test requirement

A change in scope ships a test asserting the blocked keys are absent from the
response at every depth they occur — model, endpoint, and provider. Copy
`services/cfw-frontend-api/src/routes/catalog/models-search/route.test.ts` and the
sibling route tests added by #30917. A blocklist change extends
`packages/helpers/sanitize-server-data.test.ts` with the new key. A new
column-projected accessor ships Postgres integration coverage that seeds the
internal column non-null and asserts the returned keys are exactly the public
set, so a later `selectAll()` fails the suite rather than the route. Report a
missing test as `TEST GAP`, not as a vulnerability finding.

## Calibration

`sanitizeServerData` is called from more than a hundred files, most of them
Mission Control server actions, so its presence in a diff is not the signal.
The signal is a client-facing response carrying a raw server object, or a new
field on one of those objects. Counted on 2026-08-03; a count is calibration
evidence, not a review rule.

The severity here is disclosure, not access: every incident in this class was
a read of data the caller was never authorized to see, on routes that were
otherwise behaving correctly. Two of the five were found by outsiders, which
is the argument for the field-addition signal over the route-addition one.
