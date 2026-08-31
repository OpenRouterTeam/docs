# Code Review Patterns

Common patterns identified from PR review feedback. These complement the
existing rules in this directory.

## Comments and Documentation

**Prefer self-documenting code over comments.** If you feel the need to add a
comment, first consider whether the code itself could be clearer through better
naming or structure. Redundant comments add noise without value.

**Use JSDoc for multi-line documentation.** When documentation is necessary
(public APIs, complex algorithms), use JSDoc format rather than inline
comments.

**Link external references.** When referencing RFCs, design documents, or
external resources, include the title and URL so they can be found later:

```typescript
// BAD: Vague reference
// See the RFC for details

// GOOD: Findable reference
// See RFC: "Streaming Response Format" (https://notion.so/...)
```

**Document prerequisites.** Scripts and tools that require setup steps
(authentication, environment configuration) should document these in the
README with exact commands.

## Code Simplification

**Use idiomatic falsy checks.** Prefer `value || undefined` over verbose
length checks:

```typescript
// BAD: Verbose
const result = str.length > 0 ? str : undefined;

// GOOD: Idiomatic
const result = str || undefined;
```

**Use `definedValues()` for object filtering.** When building objects that
may have undefined values, use `definedValues()` at the object level rather
than conditional spreads or ternaries for each field.

**Forward results directly.** When a function returns a Result type, forward
it without rewrapping:

```typescript
// BAD: Unnecessary rewrapping
const result = doSomething();
if (isOk(result)) {
  return ok(result.value);
}
return result;

// GOOD: Direct forwarding
return doSomething();
```

**Use array destructuring.** Prefer destructuring for accessing first
elements:

```typescript
// BAD: Index access
const first = array[0];

// GOOD: Destructuring
const [first] = array;
```

**Keep handlers inline when simple.** Don't lift simple event handlers into
named functions unless they're shared or the extraction meaningfully improves
readability.

## Safe JSON Parsing

**Use `safeParseJson` instead of try/catch.** The codebase provides
`safeParseJson` which returns a Result type:

```typescript
// BAD: try/catch
try {
  const data = JSON.parse(input);
} catch {
  // handle error
}

// GOOD: Result-based
const result = safeParseJson(input);
if (isErr(result)) {
  // handle error
}
```

## Input Validation

**Trim strings before empty checks.** When validating string inputs for
emptiness, call `.trim()` first to handle accidental whitespace:

```typescript
// BAD: Whitespace passes validation
if (input === '') {
  return err('Required');
}

// GOOD: Handles whitespace
if (input.trim() === '') {
  return err('Required');
}
```

## Canonicalize Inputs at the Boundary

**Normalize equivalent representations at the trust or write boundary.**
Normalize whitespace, casing, empty strings versus `null`, and legacy scalar
types before comparison, querying, or persistence. This prevents `''` and
`NULL` from colliding under a `coalesce`-based unique index and prevents
case-sensitive enum membership checks from missing non-canonical values (for
example, a lowercased `'openai'` failing an `isMember(value, ProviderName)`
check). A `'use server'` action must not rely on the client having
pre-sanitized input.

```typescript
// BAD: '' and NULL take different read paths but collide on the unique index
const target = input.target;

// GOOD: one canonical representation at the write boundary
const target = input.target?.trim() || null;
```

## Do Not Silently Discard or Choose Unsupported Input

**Reject ambiguous input when the downstream contract accepts fewer values.**
If a single-valued provider field receives multiple references, return an
actionable error instead of letting `.find()` silently choose the first. If
the loss is deliberate, document the deterministic tie-break at the site.
Likewise, reject a trailing CLI flag instead of parsing it as a positional
value.

```typescript
// BAD: silently drops every video reference after the first
const video = references.find((reference) => reference.type === 'video_url');

// GOOD: reject input the provider cannot represent
const videos = references.filter((reference) => reference.type === 'video_url');
if (videos.length > 1) {
  return err('Only one video_url reference is supported');
}
```

## Naming Consistency

**Use short, clear prefixes.** For generated IDs and similar patterns, prefer
short prefixes that are still descriptive:

```typescript
// BAD: Verbose prefix
const id = `gen-anonymous-${nanoid()}`;

// GOOD: Short prefix
const id = `gen-anon-${nanoid()}`;
```

**Match function and output terminology.** If a function is named
`generateFakeId`, the output should use "fake" not "anonymous".

**Rename artifacts when their contents change.** A migration filename,
constant, or helper renamed mid-PR keeps its old name in the diff and
misleads whoever greps for it later. Check that the name still describes
what the thing is — especially a `must-not-be-called` sentinel or a
migration whose columns were renamed after the file was created.

## Testing

**Assert success explicitly.** In tests, explicitly assert that operations
succeeded rather than relying on implicit branch coverage:

```typescript
// BAD: Implicit success
const result = doSomething();
if (isOk(result)) {
  expect(result.value).toBe(expected);
}

// GOOD: Explicit assertion
const result = doSomething();
assertOk(result);
expect(result.value).toBe(expected);
```

**Assert the side effect the test names.** A test named for a call that
should (or should not) happen must assert that call on the mock —
otherwise deleting the production call would still pass every test.
When asserting a negative (`not.toHaveBeenCalled()`), pair it with a
positive control: a sibling test proving the same mock IS called on the
allowed path, so the negative assertion is load-bearing:

```typescript
// BAD: name says "reaches the provider" but nothing asserts it
const result = await route(request);
assertOk(result);

// GOOD: the named side effect is asserted
const result = await route(request);
assertOk(result);
expect(adapterFetch).toHaveBeenCalledTimes(1);
```

**Keep test names true to what the test asserts.** A title that promises
more than the body checks ("for all URL-based video content" when one
case now differs), or a "does not query" name whose stubs return `ok()`
instead of throwing, documents behavior nobody verified. When a diff
narrows an existing case, rename that test in the same diff.

**Put each test in a `describe` that matches it.** A case that sends no
header does not belong under `describe('header-gated ...')`, and a case
wedged at the top level between sibling `describe` blocks is easy to miss.
Give it the describe its subject implies.

## Accessibility

**Add aria labels for interactive elements.** Elements with state changes
(like copy buttons) should have descriptive aria-labels that reflect the
current state:

```tsx
<button
  aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
  onClick={handleCopy}
>
  {copied ? <CheckIcon /> : <CopyIcon />}
</button>
```

**Announce async status and errors to screen readers.** Error and
validation text that appears after an async action needs `role="alert"`
(or `role="status"` for non-error updates) so it is announced. Use one
persistent live region whose content changes — a newly mounted
`aria-live` element is usually skipped by screen readers, so do not
mount a separate live region per loading/error/result branch. Mark
decorative icons next to announced text `aria-hidden="true"`.

## UI Alignment

**Align form elements consistently.** Form inputs should be visually aligned
within their containers. Left-aligned inputs in centered containers often
look off.

## Pending Mutation State

**Gate controls while a mutation is in flight.** The initiating button
gets `disabled` plus visible pending feedback (`isLoading` spinner or a
pending label like "Disabling…"), not a silent `disabled` alone. Also
gate sibling controls that could mutate the same row (an Edit button
while a lifecycle flip is pending, chip remove handlers while a form is
submitting) — an `aria-disabled` attribute without a handler guard does
not prevent the click.

**Confirm destructive bulk actions with the count.** One click that
affects many records needs a confirmation naming the number affected
("Ban 50 users?"), and the success message should include the applied
count.

## Fetch Body Cancellation

**Cancel unconsumed `fetch()` response bodies.** Every code path that
does not consume the body must call `response.body?.cancel()`. See
`.claude/rules/fetch-body-cancellation.md`.

## Migrations

**Check for lock analysis in the PR description and migration file.**
Every Postgres migration PR must include the extracted locks and a
prod-risk assessment in both the PR description and as SQL comments at
the top of each migration file. If missing, request they be added per
the "Lock analysis" section of `postgres/migrations/AGENTS.md`.

**Flag new tables that will be written or updated on an inference path.**
Postgres is the wrong store for anything written at the volume of
inference requests (`/chat/completions`, `/completions`, embeddings, or
any request-serving endpoint). When reviewing a `CREATE TABLE` migration,
ask whether rows will be inserted or updated O(inference requests); if so,
that data belongs in the usage-record pipeline, ClickHouse, Spanner, KV,
or another high-write-volume store via a background job or post-response
hook — not a synchronous write during request serving. This is the
schema-level counterpart to the "No database writes in inference paths"
rule in `AGENTS.md`. See `postgres/migrations/AGENTS.md` for full
conventions.

## N+1 Queries

**Flag `Promise.all(items.map(item => queryFn(item)))` where `queryFn`
hits the database or makes an HTTP call per item.** Also flag
`for...of` loops with `await` on a query inside the body. Use batch
queries (`WHERE col IN (...)`) or in-memory caches instead. When adding
a new single-key query function, also add a batch sibling that accepts
`readonly string[]` and returns a `Map`.

```typescript
// BAD: N+1
const authors = await Promise.all(
  models.map((m) => getModelAuthor(m.author)),
);

// GOOD: batch
const authorsMap = await findCachedAuthors(
  models.map((m) => m.author),
);
```

## Cache Keys

**Put every input that changes the cached value into the key.** If the
cached payload depends on a flag, a variant, or attached media, a key
built from the identifier alone serves one caller's value to another.
Today's call sites all passing the same flag makes the bug latent, not
absent.

```typescript
// BAD: value depends on the flag, key does not
cache.get(url);

// GOOD: flag is part of the key
cache.get(`${url}::prefix:${excludeDataUriPrefix}`);
```

**Derive a lookup key the way the writers derive it.** A key built by
hand next to a map whose entries are built by a shared helper drifts into
a different key space and silently misses. Call the same helper, and bump
the cache version when the stored shape changes.

**Bound the key space at the boundary.** A value that becomes a cache
variant key needs a real shape check (e.g. `/^[0-9a-f]{64}$/` for a
sha256 hex digest), not a truthiness check — otherwise any caller can
spray unique keys through the cache.

## Documentation Drift

**Keep comments and examples in sync with the code they describe.** When
behavior, schemas, or exit paths change, update the adjacent docblocks,
OpenAPI `example` blocks, and runbook prose in the same PR. Watch for:

- Examples that omit fields a schema now requires
- Docblocks that describe only one of several exit paths
- Prose that contradicts a neighboring code example (e.g. "1 day" next to
  a 2-day range)

## Duplication

**Reuse existing helpers before writing new ones.** Before adding a small
formatting or predicate helper (K/M number abbreviation, redirect-status
checks, etc.), search for an existing util in the monorepo. Prefer shared
enums (e.g. `HTTPStatus`) over magic numeric literals.

**Don't duplicate schema defaults at call sites.** If a Zod schema declares
`.default(x)`, omit the field and let the schema supply it rather than
hardcoding the same literal, which silently drifts if the default changes:

```typescript
// BAD: duplicates the schema's .default('unknown')
const metadata = { author: 'unknown', ...rest };

// GOOD: schema supplies the default at parse time
const metadata = { ...rest };
```

## Consistency Across Siblings

**Apply refactors to all parallel cases.** When extracting a helper or
adopting a convention for one of several sibling code paths (table columns,
adapter branches, fixture files), apply it to the others too — or explain
why not. Partial refactors leave the codebase harder to read than either
the old or new style alone.

## React

**Drop redundant fragments.** `<>...</>` around a single child is noise:

```tsx
// BAD
return (
  <>
    <CellFilterContextMenu {...props} />
  </>
);

// GOOD
return <CellFilterContextMenu {...props} />;
```

## Logging Levels

**Match the log level to the path.** Error and abort paths should use
`eLog`/`wLog`, not `iLog`. An info-level log on a failure path hides it
from error-based monitoring.

## Shell and Workflow Scripts

**Clean up temp resources with `trap`.** `mktemp` output cleaned only on
the happy path leaks on interrupt. Use `trap 'rm -rf "$TMP"' EXIT`.

**Keep behavior-critical flags on the same line as the command.** In
multi-line shell continuations (especially CI workflows), a flag that
selects between safe and dangerous behavior (e.g. `--staging`) must not
sit alone on a continuation line, where a clipped backslash silently
drops it.

## Diff Hygiene

**Keep diffs focused.** Avoid reformatting or restructuring code that doesn't
need to change for the feature being implemented. Unrelated changes make
review harder and increase merge conflict risk.

**Avoid unnecessary changes.** If a change doesn't affect behavior or
readability, don't make it. Every line changed is a line that needs review.

## Monitors and Dashboards

**Review Datadog and Terraform monitor definitions like code.** A widget or
monitor title must describe the grouping and metric its query actually uses.
Calling a query grouped `by {config}` "by pool", or naming a resource for a
replication leg it does not measure, is a defect.

**Do not set provider fields that are no-ops for the monitor type.** Remove
configuration that cannot affect the selected Datadog resource rather than
leaving misleading intent in the definition.

**Delay alerts for first-seen groups.** When a monitor groups by a tag whose
values come and go, set `new_group_delay` so a newly observed group is not
alerted on a one-point window.

**Link exclusions to their Linear issue.** Put the issue URL inline next to
each exclusion or suppression, matching the convention used in
`configs/terraform-monitors/`.

## Guard Before Parse

**Check cheap discriminants before parsing.** Put the tool name, event type,
or path prefix guard before schema parsing so hot paths do not run guaranteed
failures or allocate error objects for every streamed chunk.

**Use a discriminant instead of trial parsing.** Do not parse the same value
against several schemas in sequence to discover which one fits when a
discriminant is available:

```typescript
// BAD: Repeatedly parses and allocates failures
const parsed = firstSchema.safeParse(event);
const result = parsed.success ? parsed : secondSchema.safeParse(event);

// GOOD: Selects the schema before parsing
const schema = event.type === 'tool' ? toolSchema : messageSchema;
const result = schema.safeParse(event);
```

## Metric and Event Name Changes

**Treat metric, analytics event, and log event renames as data migrations.**
Every dashboard and query keyed on the old name shows a permanent cliff, and
the new name starts at zero. Call out the rename explicitly and involve the
owner of the affected dashboards.

**Outcome counters must cover every exit path.** The parts of an outcome
family must sum to the total. If `success`, `error`, `timeout`, and
`http_error` are emitted but parse-failure and unexpected-shape returns emit
nothing, the counters silently under-count.

## Paginate List APIs

**Paginate every list request that can exceed one page.** A request with
`per_page=100` and no pagination loop silently truncates larger collections,
and the failure can look complete, such as a missing marker comment or a
secret listing that appears finished. Paginate the response or assert that it
is a full listing.

## Environment-Specific and Generated Artifacts

**Keep machine- and session-specific paths out of committed files.** Do not
commit paths such as a Devin VM location under `/home/ubuntu/...` in docs or
scripts. Use repository-relative paths instead.

**Keep generated patch files free of build-cache artifacts.** When
regenerating a patch, inspect it for cache output before checking it in.

**Cite durable locations in documentation.** A `package.json` line reference
survives dependency changes better than a lockfile line reference, so link to
stable files and symbols where possible.

## Parameter Precision at Call Sites

**Use an object for adjacent same-typed parameters.** When a function takes
several neighboring values of the same primitive type, accept a named object
so a transposed argument becomes a type error instead of a silently wrong
tag value.

**Use domain types at boundaries.** Type a parameter with the enum or union
that represents its domain rather than bare `string`, even when a generated
database type resolves the value to `string`.

## Keep the PR Description Current

**Update the PR description in the same push as follow-up work.** When later
commits complete a follow-up listed as pending, or replace a widget or
behavior described in the body, update the body with that push.

**Correct figures invalidated by the diff.** If the description quotes a
number that the change no longer supports, such as a row count no longer
covered by a partial index, replace it with the current figure.

## Single-Sourcing and Drift Prevention

**Hoist repeated literals into a shared constant.** When the same literal
(an ID, label, fallback, or regex bound) appears at two or more sites that
must stay in agreement, extract a named constant so the sites can't drift:

```typescript
// BAD: fallback repeated at three call sites
new DBConnectionPool({ application: getServiceName() ?? 'cloudflare-worker' });

// GOOD: single source
const APPLICATION_NAME = getServiceName() ?? 'cloudflare-worker';
```

Exception: keep assertion-side literals in tests independent of fixture
constants, so expectations don't silently track the fixture.

**Derive values from the source of truth instead of restating them.** Derive
field lists in description strings, enum values in `z.enum(...)` at multiple
sites, counts embedded in display copy, and cross-service task names from
the canonical definition, or export them alongside it — don't hand-copy
them:

```typescript
// BAD: drifts when the schema changes
description: 'Valid fields: id, name, created';

// GOOD: derived
description: `Valid fields: ${ModelFieldSchema.options.join(', ')}`;
```

When a value can't be derived (for example, a prose description of enum
modes), add a small sync test asserting that every enum value appears in
the string.

**Reuse existing helpers and types before hand-rolling.** Search the
monorepo for an existing helper (`retryWithExponentialBackoff`,
`errorToLogFields`) before duplicating its logic inline. When the same
block appears three or more times in a diff, extract a parameterized
helper.

## Sibling Consistency

**Match the established sibling pattern.** When you add a variant of
something that already has siblings (an adapter, a branch, a parity test
helper, a guard), mirror the siblings' structure, naming, and idioms — even
when an alternative is equally correct. Examples of nits this prevents:

- One adapter inlining a predicate that all sibling adapters hoist to a
  named `const isModeration = ...`.
- Mixing `?? undefined` and `isDefinedAndNotNull(...)` guards for the same
  field across serialization sites.
- Mixing `.slice()` (copies) and `.subarray()` (view) for the same byte-cap
  operation.
- Error messages that name the concrete endpoint in one guard but say
  "use the other API" vaguely in its mirror.

**Consistency beats local elegance.** Don't introduce a new pattern when you
port code into an area with an established one, even if the new pattern is
nicer — align first, improve across the board later.

**Don't extract single-caller trivia.** Splitting out a function with one
caller, no purity, no tests, and no significant logic adds indirection
without value. Extraction needs a second caller or a testability win.

## Comment Freshness

**Update adjacent comments and docs in the same diff.** When a change alters
behavior, sweep the surrounding docstrings, block comments, and header docs
for statements the change invalidates. Recurring cases:

- A docstring describing a feature flag or parameter the diff removes.
- A doc comment narrower or broader than the predicate it describes.
- A comment enumerating items (capabilities, fields, env vars) that the
  diff adds to or removes from.
- A block comment left stranded away from the code it narrates after an
  insertion — move it with the code.

## Testing Precision

**Pin exact boundaries.** When a comparison is strict (`>` versus `>=`),
add a test at exactly the threshold value so a future operator slip fails a
test. Cover the falsy and empty boundary variants (`''` versus `undefined`)
as separate cases when they take different code paths.

**Assert exact counts, not existence.** Prefer `.filter(...)` +
`toHaveLength(1)` over `.find(...)` when the invariant is "exactly one";
assert length before destructuring (`expect(messages).toHaveLength(1)`
before `const [message] = messages`). Avoid vacuous assertions that can
never fail given the test's own setup.

**Narrow with `assert(...)`, not `!` or `?.`.** In tests,
`assert(value)` fails loudly at the right line and narrows the type;
`value?.method()` silently no-ops and hangs to timeout, and `value!`
skips the runtime check entirely:

```typescript
// BAD: silent no-op if undefined
resolveOpen?.(cache);
expect(skill).toBeDefined();
expect(skill?.content).toContain(text);

// GOOD: crisp failure + type narrowing
assert(skill);
expect(skill.content).toContain(text);
```

**Prefer `it.each` for input/output matrices.** Looping over cases inside a
single `it()` hides which case failed; table-driven `it.each` reports
per-case and keeps the matrix scannable.

**Cover sibling error branches symmetrically.** When several methods share
an identical guard (for example, `get`, `set`, and `clear` all early-return
on `isErr(cache)`), exercise the failure path of each, not just one.

## Async Hygiene

**Drop `async` when nothing awaits.** An `async` function with no `await`
forces callers to await needlessly. Return the
value (or `ok(...)`/`err(...)`) directly.

**Don't double-wrap `AsyncResult` in `Promise`.** `AsyncResult<T, E>` is
already `Promise<Result<T, E>>`, so annotating a function as
`Promise<AsyncResult<T, E>>` adds one Promise layer too many. It typechecks
only because JS auto-flattens the returned promise — drop the outer
`Promise<>` and annotate `AsyncResult<T, E>`.

## Logging

**Log an `ErrorT` with `errorToLogFields()` (or `inspectErrorT()`), not a
raw `{ error }` or `.message` alone.** Passing a bare `ErrorT` under an
`error` key buries `error_message` and `error_stack` a level down (and a
plain object stringifies to `{}` or `"[object Object]"`); logging only
`error.message` drops `location`, `status`, and `internal`. Use the helper
so every field survives to Datadog — `errorToLogFields()` accepts `unknown`
directly and preserves the stack for a caught `Error`. Use
`unknownErrorToString` only when you need a plain string, for example
inside a message template. For more information, see
`.claude/rules/error-handling.md` and `.claude/rules/logging.md`.

```typescript
// BAD: buries or drops error detail
eLog('charge failed', { error: result.error });
eLog('charge failed', { error_message: result.error.message });

// GOOD: full ErrorT context
eLog('charge failed', errorToLogFields(result.error));
```

**Name logs, metrics, and events for what they actually measure.** A
`*_scrubbed` count that tallies only one of several writes, an event named
`...:success` on an `already_active` branch, or a `count` field that
includes idempotent no-op writes all mislead the queries built on them.
Keep the field or event name matched to the branch it fires on and the
value it holds.

## Database Queries

**Select only the columns the caller uses.** Avoid `selectAll()` and
`.returningAll()` when the consumer reads a subset — list the columns
explicitly so the row shape matches the type it feeds. Drop
`.returningAll()` entirely on a write whose caller discards the returned
row; it is a wasted RETURNING round-trip (use `.execute()`).

**Type raw SQL builders.** ``sql`now()` `` is `RawBuilder<unknown>`.
Annotate the set or returned type so it is explicit and matches sibling
casts:

```typescript
// BAD: untyped
.set({ updated_at: sql`now()` })

// GOOD: typed to the column
.set({ updated_at: sql<string>`now()` })
```

## Avoid Dead and Speculative Code

**Don't add speculative options, params, or exports.** An option or
parameter that no caller passes (only tests exercise the `??` fallback), or
an export nothing outside the file imports, is dead weight until a real
consumer exists. Drop it and add it in the PR that needs it (mirrors the
"Minimal Interface Design" rule in `AGENTS.md`).

**Remove unreachable branches and dead fallbacks.** A `?? fallback` after a
guard that already proved the value non-empty, a `.filter(Boolean)` after
tokens were already filtered, or a `case` an earlier early-return makes
unreachable all read as if they were load-bearing. Delete them — or, if a
branch exists only to narrow a type, restructure (for example, take the
narrowed value as a parameter) so the intent is explicit rather than
looking like dead code.
