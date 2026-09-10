# Review Guidelines

## General

Flag these patterns when reviewing any PR.

### 1. Trivial Wrapper Functions

Flag helper functions that merely delegate to another function without adding meaningful logic, type narrowing, validation, or documentation value. These add indirection without abstraction.

```ts
// BAD — just wraps arrayToReadableStream with a fixed argument structure
function jsonlStream(content: string): ReadableStream<Uint8Array> {
  return arrayToReadableStream([content]);
}
```

A helper is justified only if it does at least one of:
- Adds non-trivial logic (branching, error handling, retries, transforms)
- Narrows or strengthens types beyond what the underlying call provides
- Encapsulates multiple coordinated calls that always go together
- Provides a domain-specific name for a genuinely reused pattern (3+ call sites)

If the function body is a single return statement forwarding its arguments (possibly wrapped in an array/object literal), it is almost certainly not useful.

### 2. New Type/Schema Sync Check

When a PR introduces a new type or schema, check whether it is intended to mirror or extend an existing type/schema elsewhere in the codebase. If so, verify the two are kept in sync (shared fields, validation rules, enums, etc.). Flag any drift between the new definition and its counterpart. Prefer using `satisfies ZodShape` and `z.infer` to derive TypeScript types from Zod schemas rather than maintaining separate type definitions. If keeping two types/schemas in sync would introduce a circular dependency, move the shared definition to a common location instead of duplicating it. When moving a definition to a shared location, rewrite all imports to point to the new location rather than re-exporting from the old one. Similarly, if a type/schema is renamed, update all call sites directly instead of using import aliases to paper over the rename.

### 3. Audit Every Optional Field

When a PR adds an interface, type, or Zod schema (or adds fields to an existing one), audit **every** optional field (`?`, `| undefined`, `.optional()`, `.nullish()`). Optionality is frequently added out of convenience rather than because the value is genuinely sometimes absent, and it pushes nonsensical fallbacks to every consumer.

For each optional field, verify:

- **Is it genuinely optional?** If every construction site always provides the value, make it required. Optionality must reflect a real "sometimes absent" state in the domain, not uncertainty about where the value comes from.
- **Is the absent case handled meaningfully?** Flag consumers that paper over absence with arbitrary fallbacks (`?? 0`, `?? ''`, `?? 'unknown'`, `|| []`, non-null assertions `!`). If there is no sensible behavior when the field is missing, the field should be required and the caller should provide it.
- **Is optionality being used to dodge a type error?** Making a field optional so an incomplete object literal compiles is a red flag — fix the construction site instead.
- **Does optionality leak?** A field made optional in one type often forces defensive checks or fallback values across many downstream consumers. Prefer requiring the field at the boundary (parse/validate once) so internal types stay non-optional.

```ts
// BAD — pricing is always known at construction, but the optional
// field forces a nonsensical fallback downstream
interface EndpointInfo {
  pricing?: Pricing;
}
const cost = computeCost(endpoint.pricing ?? DEFAULT_PRICING); // silently wrong

// GOOD — required at the boundary; absence is an error, not a guess
interface EndpointInfo {
  pricing: Pricing;
}
```

If a field is legitimately optional, the consumer must handle the `undefined` case with real behavior (skip, error, distinct UI state) — not a made-up default value.

### 4. Instrumentation and Monitors

Instrumentation is a judgment call the author makes, so do not flag a PR for lacking a metric or an event. What you do hold the author to is signal: instrumentation that is actively harmful, and monitors that do not earn their channel, per `configs/terraform-monitors/AGENTS.md`:

- A metric or event tagged with a user ID, key, URL, prompt, or raw error string, or otherwise high cardinality.
- A captured inline string literal instead of a `PostHogEvent` enum member.
- Metric emission that can throw, or that adds an `await` to a request-serving path.
- A new Terraform Datadog monitor whose PR description does not state all four parts of the monitor bar: the threshold and why that number, the human action the alert triggers, the owner, and a traffic gate. Ask for a dashboard panel instead.
- A new monitor on a brand-new metric, whose threshold cannot come from an observed baseline yet. Ask for a dashboard panel first.
- A new feature monitor routed straight to a paged channel instead of a low-signal one (default `@slack-OpenRouter-test-slack-messages`) without the author asking for that channel.

Refactors, dependency bumps, and docs changes are exempt.

### 5. Dependency Trust Grants

Flag any PR that adds an entry to `trustedDependencies`, `overrides`, or `patchedDependencies` in root `package.json`, and check it against the `trustedDependencies` rule in `AGENTS.md`. A `trustedDependencies` addition is justified only by a genuine install-time build step (native compile or prebuilt-binary download) — never by silencing Bun's untrusted-script prompt, and never for a telemetry, funding, or other cosmetic script. The PR description must state what the lifecycle script does and why it must run, and the `bun.lock` mirror must be updated in the same commit for installed packages. Removals need no flag.

### 6. Worker Route Placement

Flag any new `cfw-frontend-api` route whose only consumer is Mission Control
— it belongs in `cfw-internal` (see AGENTS.md → Route Placement).

### 7. Net-New Cache API Uses

Flag new `caches.open()` / `caches.default` code in a Worker. For caching a Worker's own responses, [Workers Cache](https://developers.cloudflare.com/workers/cache/) is the default choice: it runs before the Worker, so a hit skips execution entirely, while a Cache API hit only happens once the Worker is already running. Existing uses stay (notably the `edgeCache` middleware in `packages/cloudflare/hono/edge-cache.ts`, which sits behind Workers Cache); a net-new one needs a reason Workers Cache cannot serve — for example caching an intermediate value the handler computes mid-request, rather than the response itself.

## Inference Path Performance

Flag these patterns when reviewing any PR that touches hot inference
paths (`services/cfw-api`, `packages/router`, adapters, skins).

### 1. No Writes in Inference Paths

Database writes (`INSERT`, `UPDATE`, `DELETE`) must not happen in
request-serving code paths. Writes belong in background jobs,
usage-record pipelines, or post-response hooks — never inline with
the latency-sensitive generation flow.

### 2. No Per-Isolate Caching

Do not cache data in module-level `Map`s, `Set`s, or plain objects
inside Cloudflare Worker isolates. Isolate-local caches diverge
across the fleet, are invisible to monitoring, and cause unexpectedly
high query volume when the cached value varies per user or per
request. Per-isolate caches are acceptable **only** for
rarely-updated, request-independent data (e.g., a global feature-flag
set that changes once a day).

### 3. Prefer Auth Service / `getUserByKey` for Per-User Data

Any data that is scoped to a user or organization should be obtained
from the auth service or `getUserByKey` — not queried directly from
the database during inference. The auth service already runs once per
request and its result is available throughout the request lifecycle.

### 4. Use Hyperdrive-Cached Connection for Necessary Hot-Path Queries

When a query genuinely cannot be moved into the auth service and must
execute during inference, use the Hyperdrive-cached connection string
so the connection is pooled and responses are cached at the
Cloudflare edge. Never open a direct database connection from a hot
inference path. **Caveat:** Hyperdrive has shown degraded reliability
under heavy load — timeouts and failed deliveries increase
significantly at high request volumes. Treat it as a last resort, not
a default. Strongly prefer moving data into the auth service or KV
before resorting to Hyperdrive queries on every inference request.

### 5. No Instance-Level References to Request Bodies or Response Data

Flag new class fields (on adapters, routers, plugins, or any
long-lived object in the inference path) that store request bodies,
transformed/serialized requests, or response payloads. Instance
fields live as long as the object does, so a reference held past its
last use retains the payload — including base64 image/audio blobs —
for the whole request lifetime. Thread the data explicitly as
function parameters to the consumers that need it, scoped to the
narrowest lifecycle window.

## Postgres

All database queries must use Kysely `dbRead` / `dbWrite` from `@openrouter-monorepo/db/context`.

If "Supabase" comes up in a PR, see the "Do not mention Supabase" rule in `AGENTS.md`.

## Nested Agent Docs

Guidance for agents working on a specific part of the codebase belongs in a nested `AGENTS.md` (conventions and workflow) and/or `REVIEW.md` (patterns to flag in review) in that directory, not in a nested `README.md`. Flag PRs that add agent-facing conventions or review rules to a nested `README.md` — nested `AGENTS.md` / `REVIEW.md` files are automatically picked up and enforced by agent tooling; READMEs are not.

When reviewing a PR, check each touched directory and its parent directories for nested `REVIEW.md` files and apply their rules to the files under them.

## Fetch Body Cancellation

Every `fetch()` response whose body is not consumed must be cancelled via `response.body?.cancel()`, on every path that does not consume it. See `AGENTS.md` → Async.

## State Management

Flag these in any PR that adds or changes frontend state. The rules are in `packages/frontend/AGENTS.md` → State Management; the items below are the ones a linter cannot decide.

### 1. State With Two Owners

Flag a new field that duplicates something another layer already owns — a query result copied into a store, a context value mirrored into a store (or the reverse), or props copied into state. The tell is a `useEffect` whose only job is to write one source into another: it lags by a render, and the two copies disagree while it does. Read from the owner instead. The live example is `packages/frontend/hooks/use-entity.ts`, which copies Clerk-owned entity state into `packages/frontend/stores/user-store.ts` from an effect.

### 2. Wrong Layer For The State

Flag state placed in a layer that does not match its scope. A new store for state one component subtree consumes belongs in that subtree (component state, or a context if it must be threaded). A new context carrying state that other subtrees mutate, or that changes on every keystroke or stream chunk, belongs in a store.

### 3. Store Without An Owner

Flag a new store whose state has no clear domain owner, or that overlaps an existing store's domain. Extend the store that owns the domain rather than adding a parallel one.

## Test Assertions

Flag these patterns when reviewing PRs that add or modify tests.

### 1. No Assertions

Test calls code but never asserts on the result — passes as long as nothing throws.

Recognized assertion forms (do NOT flag): `expect()`, `assertOk()`/`assertErr()`, wrapper helpers (`runXxxTest()`, `expectXxx()`), Zod `.parse()`.

### 2. Weak Assertions Only

Every `expect()` in the test uses only `toBeDefined()`/`toBeTruthy()`/`toBeFalsy()` — no value checks. Acceptable only as a type-narrowing guard before deeper assertions.

### 3. Status-Only Checks

API tests that assert only `expect(res.status).toBe(4xx)` without checking response body or error message.

### 4. Mocking the Function Under Test

Never mock the function the test is supposed to exercise. Mock its dependencies instead (except the DB layer — see the mock-based DB test ban in `AGENTS.md`).

### 5. Untagged Tests That Pin a Known Bug

A passing test that asserts pre-existing buggy behavior (often flagged in the PR's reviewer-focus notes) must carry a `/** @existingBuggyBehavior */` comment and be followed by an `it.failing` (`it.fails` under vitest) asserting the intended behavior. Flag an untagged `it` that pins a bug, and flag a paired `it.failing` body that does not assert the actually intended behavior.

## Unit Test Writing

Guidelines for writing and reviewing unit tests. Flag violations of these patterns in any PR that adds or modifies test files.

### 1. Test Name Accuracy

- Each test name (`it(...)` / `test(...)`) must accurately describe the behavior under test, not the implementation.
- Bad: `it('calls processData')` — describes implementation.
- Good: `it('returns normalized output for valid input')` — describes behavior.

### 2. Arrange-Act-Assert Structure

- Every test must follow the Arrange-Act-Assert pattern: set up inputs (arrange), execute the function (act), verify the result (assert).
- Mocks must be set up before the action and cleaned up properly (e.g., `afterEach`, `vi.restoreAllMocks()`).
- **Never mock the function under test.** Mock its underlying dependencies instead and test the real function's logic flow (but never mock the DB layer — see `AGENTS.md`).
- When creating test helper classes that extend adapters or other classes, do NOT create wrapper methods for public methods. Only create wrappers for protected/private methods that need exposure for testing. Public methods can be called directly on the instance.

### 3. No Logical Branching in Tests

- Tests must be flat and linear — no `if/else`, `switch`, ternary operators, or conditional logic.
- The human reading the test should not have to trace control flow.
- Use assertion functions (e.g., `assert(value !== undefined)`) to narrow types rather than `expect` followed by conditional code.

### 4. Necessary and Sufficient Assertions

- Each test case must read like a proof: every assertion must be necessary (removing it would weaken the test), and collectively they must be sufficient (they fully prove the behavior).
- Remove redundant assertions that test the same thing twice.
- Add missing assertions where the test doesn't fully verify the behavior.

### 5. Test Fragmentation

- Combine tests that could trivially be merged — e.g., two tests each asserting one property of the same return object.
- Use inline snapshots (`toMatchInlineSnapshot`) for complex objects where practical, instead of asserting individual properties in separate tests.
- Do NOT combine tests that test genuinely different behaviors or different code paths.

### 6. `describe` Block Usage

- A single top-level `describe` wrapping all tests in a file is fine — that is the codebase convention.
- Flag and remove unnecessary *nested* `describe` blocks that add no organizational value — e.g., a nested `describe` that repeats the function name or groups only one or two tests without shared setup.
- Keep nested `describe` blocks when they genuinely group related tests with shared setup (`beforeEach`) or when the file tests multiple distinct functions/behaviors that benefit from visual separation.

### 7. Branch Coverage

- Check for missing edge cases: error paths, null/undefined inputs, boundary conditions, empty arrays.
- Read the source file being tested to identify untested branches and add tests for missing important branches.

### 8. Type Assertions in Tests

- **Real object > existing fake > typed factory.** A cast in test setup is a fixture problem: build the value for real, else reuse a shared fake, else add a `createMockX` factory in one canonical place. Module mocks are banned.
- **Statically-invalid input uses `@ts-expect-error`, not a cast.** A cast claims the value is valid, so the test keeps passing once the type moves; `@ts-expect-error` fails the day the input becomes legal. Pass the literal malformed value, directive on the one offending line.

```typescript
// BAD: laundered through the type the code is supposed to reject
await handler({ role: 'nope' } as ChatMessage);

// GOOD: the illegality is compiler-verified
// @ts-expect-error - role must be rejected at runtime
await handler({ role: 'nope' });
```

## Unknown Values

When the honest answer is "we do not know", the code must return or render *unknown*, never the nearest plausible value. Most substitutions arrive as a fallback (`a ?? b`, a default, a repair, an empty render). The test: does `b` answer the **same question** as `a`? If not, it is a wrong answer, not a fallback.

```ts
// BAD — booted answers "what did it start on", not "what is it on now"
const running = runningImage ?? bootedImage;

// GOOD — null means unknown, and the caller renders it as unknown
const running = runningImage ?? (hasNeverSwapped ? bootedImage : null);
```

The same mistake arrives as a comparison. Ask what happens to the thing nobody touched, and look for asymmetric recovery: if one branch resolves on the next tick and the other cannot resolve at all, the second is not a stricter check, it is a permanent one.

```ts
// BAD — permanent after a rebuild re-stamps a content-derived version
const isCurrent = rowRequestVersion === vmVersion;

// GOOD — a rebuilt machine carries no outstanding request to be stale against
const isCurrent = isProvisioned(vmVersion) || rowRequestVersion === vmVersion;
```

In practice:

- **Parsing untrusted input** — reject, do not repair. A repairing parser turns a malformed request into an actionable one. Use `JSON.parse` through `wrap()`, not a lenient parser built for model output.
- **Labels and columns** — render `—`. A dash reads as unknown, a stale value does not.
- **Error states** — an error is not an empty state. If a failed read renders the same as "nothing to report", an operator cannot tell a broken dependency from a healthy system.
- **Pairs of derived values** — when one value is presented two ways (short and full, label and tooltip), derive both from one place so they cannot disagree.
- **Read-then-write** — code that writes what it read claims nothing changed in between. Re-check the precondition before the write, and drop the write when it no longer holds.

When a fallback is genuinely correct, say which condition makes it so, in the code.

## Comments and Documentation

<!-- src: #39594 jamespsterling 2026-09-02 -->
<!-- src: #39654 jamespsterling 2026-09-03 -->
<!-- src: #39678 Cybourgeoisie 2026-09-02 -->
<!-- src: #39739 Cybourgeoisie 2026-09-03 -->
<!-- src: #39083 talos 2026-09-01 -->
<!-- src: #39104 talos 2026-09-01 -->
<!-- src: #39425 talos 2026-09-02 -->
<!-- src: #39285 Cybourgeoisie 2026-09-01 -->
<!-- src: #39511 talos 2026-09-02 -->

Prefer self-documenting code over comments: if a comment feels necessary, first check whether better naming or structure would carry it. Use JSDoc for multi-line documentation of public APIs and complex algorithms rather than a stack of inline comments. When referencing an RFC, design doc, or external resource, include the title and URL so it can be found later. Scripts and tools that need setup (authentication, environment configuration) document the exact commands in their README.

Keep comments, docblocks, and examples in sync with the code they describe, in the same diff. Recurring cases:

- Examples that omit fields a schema now requires, or OpenAPI `example` blocks left behind by a schema change.
- Docblocks describing only one of several exit paths, or narrower or broader than the predicate they sit on.
- A docstring naming a flag, parameter, or capability the diff removes, or a comment enumerating items the diff adds to.
- A block comment stranded away from the code it narrates after an insertion — move it with the code.
- Prose contradicting a neighboring code example, e.g. "1 day" next to a 2-day range.
- A `{@link}` target, a nested `AGENTS.md` path, a test allowlist key, or a `describe` title that names a symbol or file the diff deletes, renames, or makes module-private. Grep the old name across docs and tests and fix every hit in the same diff.

Documentation should cite durable locations: a `package.json` line reference survives dependency changes better than a lockfile line reference.

## Code Simplification

- **Idiomatic falsy checks.** `value || undefined` over `value.length > 0 ? value : undefined`.
- **`definedValues()` at the object level** instead of a conditional spread or ternary per field.
- **Forward Results directly.** `return doSomething()` instead of unwrapping and rewrapping with `ok()`.
- **Destructure.** `const [first] = array` over `array[0]`.
- **Keep simple handlers inline.** Do not lift an event handler into a named function unless it is shared or the extraction genuinely reads better.
- **Do not extract single-caller trivia.** A function with one caller, no purity, no tests, and no significant logic adds indirection. Extraction needs a second caller or a testability win.
- **Use `safeParseJson`** rather than `try`/`catch` around `JSON.parse`; it returns a Result.

## Avoid Dead and Speculative Code

Flag an option, parameter, or export that no caller uses — one only tests exercise, or an export nothing outside the file imports. Drop it and add it in the PR that needs it (this mirrors Minimal Interface Design in `AGENTS.md`).

Remove unreachable branches and dead fallbacks: a `?? fallback` after a guard that already proved the value non-empty, a `.filter(Boolean)` over already-filtered tokens, a `case` an earlier early-return makes unreachable. If a branch exists only to narrow a type, restructure it (for example take the narrowed value as a parameter) so the intent is explicit.

## Input Boundaries

<!-- src: #38792 talos 2026-08-31 -->
<!-- src: #38667 talos 2026-08-31 -->
<!-- src: #38541 talos 2026-08-29 -->
<!-- src: #38800 talos 2026-08-31 -->
<!-- src: #38814 talos 2026-08-31 -->
<!-- src: #37816 talos 2026-08-31 -->

**Canonicalize at the trust or write boundary.** Normalize whitespace, casing, empty string versus `null`, and legacy scalar types before comparison, querying, or persistence. This is what keeps `''` and `NULL` from colliding under a `coalesce`-based unique index, and a lowercased `'openai'` from failing an `isMember(value, ProviderName)` check. A `'use server'` action must not rely on the client having pre-sanitized input. Trim strings before an emptiness check.

```typescript
// BAD: '' and NULL take different read paths but collide on the unique index
const target = input.target;

// GOOD: one canonical representation at the write boundary
const target = input.target?.trim() || null;
```

**Do not silently discard or choose unsupported input.** If a single-valued provider field receives multiple references, return an actionable error instead of letting `.find()` pick the first. Reject a trailing CLI flag rather than parsing it as a positional value. If the loss is deliberate, document the deterministic tie-break at the site.

```typescript
// BAD: silently drops every video reference after the first
const video = references.find((reference) => reference.type === 'video_url');

// GOOD: reject input the provider cannot represent
const videos = references.filter((reference) => reference.type === 'video_url');
if (videos.length > 1) {
  return err('Only one video_url reference is supported');
}
```

**Keep a missing value distinguishable from a real one under `z.coerce`.** `z.coerce.number()` turns `null`, `''`, and `false` into `0`, so an absent measurement parses as a real zero instead of failing the row. Accept the narrow input type first, then coerce.

```typescript
// BAD: a missing measurement reads as 0
ratio: z.coerce.number(),

// GOOD: a missing measurement fails the parse
ratio: z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number()),
```

**Reject an impossible range instead of returning an empty result.** A query whose `created_to` precedes its `created_from` matches nothing, which the caller cannot tell from a filter that legitimately matched nothing. Add a `.refine()` naming the offending field so the caller gets a 400.

**Match the datetime schema to the inputs you accept.** `z.iso.datetime()` rejects numeric offsets by default, so `2026-08-30T00:00:00+02:00` fails. Pass `{ offset: true }` when clients can send an offset, and name the case the test actually guards. This includes internal consumers: a service that forwards a Postgres row via `to_jsonb` emits `timestamptz` as `+00:00`, so a consumer schema without `{ offset: true }` passes while the column is `NULL` and fails the first time it is populated (batch-api key-lookup, PR #40381).

**Name the field and the direction in a rejection message.** One constant message for a handler with several parameters, or for both directions of a paired constraint, leaves the caller unable to tell which input to fix. Forward the parse error, or name the field and say what is required.

```typescript
// BAD: five params, one message
return err('Invalid cohort filter');

// GOOD: the caller can act on it
return err(parsed.error.message);
```

**Guard before parse.** Check cheap discriminants (tool name, event type, path prefix) before schema parsing so hot paths do not run guaranteed failures or allocate an error object per streamed chunk. Select the schema from the discriminant instead of trial-parsing against several in sequence.

**Paginate every list request that can exceed one page.** `per_page=100` with no pagination loop silently truncates, and the truncation looks like a complete answer — a missing marker comment, a secret listing that appears finished. Paginate, or assert the response is a full listing.

**Make truncation visible to the operator, not only to the caller.** A handler that returns `truncated` without logging it, or a list view whose heading reads "Recent policies" at the cap, hides a dropped tail. Log the flag with the row count on the success path, and label the view so a clipped list cannot pass for a complete one.

**Set a cap above the structural bound, and order before you truncate.** A cap equal to the maximum the query can produce makes a complete result and a truncated one identical. Set the cap higher, treat hitting it as an error, and add an `ORDER BY` so the rows you keep are the rows you meant to keep rather than whichever ones arrived first.

**Parameter precision at call sites.** Accept a named object for several adjacent same-typed parameters so a transposed argument is a type error rather than a wrong tag value. Type a parameter with the enum or union that represents its domain rather than bare `string`, even when the generated database type resolves to `string`.

## Naming Consistency

Prefer short but still descriptive prefixes for generated IDs (`gen-anon-` over `gen-anonymous-`). Match function and output terminology: `generateFakeId` emits "fake", not "anonymous". Rename artifacts when their contents change — a migration filename, constant, or `must-not-be-called` sentinel renamed mid-PR keeps its old name in the diff and misleads whoever greps for it later.

## Single-Sourcing and Drift Prevention

**Hoist repeated literals into a shared constant** when the same ID, label, fallback, or regex bound appears at two or more sites that must agree. Exception: keep assertion-side literals in tests independent of fixture constants, so expectations do not silently track the fixture.

**Derive values from the source of truth instead of restating them** — field lists in description strings, enum values repeated in `z.enum(...)`, counts embedded in display copy, cross-service task names:

```typescript
// BAD: drifts when the schema changes
description: 'Valid fields: id, name, created';

// GOOD: derived
description: `Valid fields: ${ModelFieldSchema.options.join(', ')}`;
```

When a value cannot be derived (a prose description of enum modes, say), add a small sync test asserting every enum value appears in the string.

**Reuse existing helpers, types, and enums before hand-rolling.** Search the monorepo before adding a formatting or predicate helper (K/M abbreviation, redirect-status checks, `retryWithExponentialBackoff`, `errorToLogFields`), and prefer a shared enum such as `HTTPStatus` over magic numeric literals. When the same block appears three or more times in a diff, extract a parameterized helper. Do not duplicate a Zod schema's `.default(x)` at a call site — omit the field and let the schema supply it. Import the schema that owns a value rather than respelling its fields, because a restated schema drifts looser than the owner and admits a value the owner rejects at read time.

**Match the established sibling pattern.** A new adapter, branch, guard, or parity-test helper mirrors its siblings' structure, naming, and idioms even when an alternative is equally correct: one adapter inlining a predicate the others hoist to a named const, mixed `?? undefined` and `isDefinedAndNotNull(...)` guards for the same field, mixed `.slice()` and `.subarray()` for the same byte cap, an error message naming the concrete endpoint in one guard and saying "use the other API" in its mirror. Consistency beats local elegance — align first, improve across the board later. Apply a refactor to all parallel cases in the same PR, or say why not.

## Testing Precision

<!-- src: #38431 jamespsterling 2026-08-30 -->
<!-- src: #37816 talos 2026-08-31 -->
<!-- src: #37061 talos 2026-08-31 -->
<!-- src: #37753 talos 2026-08-31 -->
<!-- src: #37753 talos 2026-09-01 -->
<!-- src: #39070 talos 2026-09-01 -->
<!-- src: #37787 talos 2026-09-01 -->
<!-- src: #38969 jamespsterling 2026-08-31 -->

**Assert success explicitly** with `assertOk(result)` before reading `result.value`, rather than wrapping assertions in `if (isOk(result))`.

**Assert the side effect the test names.** A test named for a call that should or should not happen must assert that call on the mock, otherwise deleting the production call still passes. Pair a `not.toHaveBeenCalled()` with a positive control proving the same mock is called on the allowed path.

**Keep test names and `describe` blocks true to the body.** A title that promises more than the body checks, or a "does not query" name whose stubs return `ok()` instead of throwing, documents behavior nobody verified. When a diff narrows a case, rename the test in the same diff. A case that sends no header does not belong under `describe('header-gated ...')`.

**Pin exact boundaries.** For a strict comparison (`>` versus `>=`), test exactly at the threshold. Cover falsy and empty variants (`''` versus `undefined`) separately when they take different paths.

**Assert exact counts, not existence.** Prefer `.filter(...)` plus `toHaveLength(1)` over `.find(...)` when the invariant is "exactly one", and assert length before destructuring. Avoid assertions that cannot fail given the test's own setup.

**Narrow with `assert(...)`, not `!` or `?.`.** `assert(value)` fails loudly at the right line and narrows the type; `value?.method()` silently no-ops and hangs to timeout, and `value!` skips the check entirely.

```typescript
// BAD: silent no-op if undefined
resolveOpen?.(cache);
expect(skill?.content).toContain(text);

// GOOD: crisp failure and type narrowing
assert(skill);
expect(skill.content).toContain(text);
```

**Assert the whole shape, not a hand-listed subset.** A test that lists the fields it expects to change passes when the code changes a field nobody remembered to list. Compare the whole object against the input plus the expected deltas, so an unlisted field fails the test.

```typescript
// BAD: only the fields someone remembered
expect(result.author_icon_uri).toBeUndefined();

// GOOD: every field, in both directions
expect(result).toStrictEqual({ ...model, author_icon_uri: undefined });
```

**Do not pin an order the query does not guarantee.** A `SELECT` with no `ORDER BY` returns rows in whatever order the engine produces, so an expectation that matches today pins observed output rather than designed output. Sort before comparing, or compare as a multiset.

**Keep expectations independent of the runner's timezone.** `new Date('2031-02-03T04:05')` parses as local time, so a hardcoded ISO expectation is green only on a UTC runner. Compute the expected value the same way, or pin `TZ` for the suite.

**Prefer `it.each` for input/output matrices** — a loop inside one `it()` hides which case failed.

**Do not cast a value the code is meant to reject** — see Unit Test Writing → Type Assertions in Tests.

**Cover sibling error branches symmetrically.** When `get`, `set`, and `clear` share an `isErr(cache)` guard, exercise each failure path, not one.

**Type a fixture as the shape the code under test consumes.** A fixture wider than the production input (a `UserJoinAnalytics` where the handler receives `User`, or `Record<string, unknown>` for a typed row) lets the test pass on a field production never carries, and a misspelled column compiles and silently no-ops. Build the narrower type, and give a factory the narrowest return type that is true of what it builds.

**Feed the test an input the transform must change.** A normalizer tested only on already-normalized input, or a counter asserted only at `1`, still passes when the transform is deleted or the value is hardcoded. Use an input the code has to rewrite (`'2026-08-22 17:00:00+00'` for an ISO normalizer) and assert a count above `1`.

## Async Hygiene

**Drop `async` when nothing awaits** — it forces callers to await needlessly. Return the value (or `ok(...)` / `err(...)`) directly.

**Do not double-wrap `AsyncResult` in `Promise`.** `AsyncResult<T, E>` is already `Promise<Result<T, E>>`; annotating `Promise<AsyncResult<T, E>>` adds a layer and only typechecks because JS flattens the returned promise.

## Logging

**Match the level to the path.** Error and abort paths use `eLog` / `wLog`. An info-level log on a failure path hides it from error-based monitoring.

**Log an `ErrorT` with `errorToLogFields()` (or `inspectErrorT()`)**, not a raw `{ error }` or `.message` alone. A bare `ErrorT` under an `error` key buries `error_message` and `error_stack` a level down (and a plain object stringifies to `{}`); logging only `error.message` drops `location`, `status`, and `internal`. `errorToLogFields()` accepts `unknown` and preserves the stack of a caught `Error`. Use `unknownErrorToString` only where a plain string is needed, such as a message template. See `packages/instrumentation/AGENTS.md`.

```typescript
// BAD: buries or drops error detail
eLog('charge failed', { error: result.error });
eLog('charge failed', { error_message: result.error.message });

// GOOD: full ErrorT context
eLog('charge failed', errorToLogFields(result.error));
```

**Name logs, metrics, and events for what they actually measure.** A `*_scrubbed` count tallying one of several writes, an event named `...:success` on an `already_active` branch, or a `count` field including idempotent no-op writes all mislead the queries built on them.

**Treat a metric, analytics event, or log event rename as a data migration.** Every dashboard and query keyed on the old name shows a permanent cliff and the new name starts at zero. Call the rename out explicitly and involve the owner of the affected dashboards.

**Outcome counters must cover every exit path.** If `success`, `error`, `timeout`, and `http_error` are emitted but parse-failure and unexpected-shape returns emit nothing, the family no longer sums to the total.

## Database Queries

<!-- src: #38814 talos 2026-08-31 -->

**Flag N+1 access.** `Promise.all(items.map((item) => queryFn(item)))` where `queryFn` hits the database or makes an HTTP call per item, and `for...of` loops awaiting a query in the body. Use a batch query (`WHERE col IN (...)`) or an in-memory cache. When adding a single-key query function, add a batch sibling taking `readonly string[]` and returning a `Map`.

```typescript
// BAD: N+1
const authors = await Promise.all(models.map((m) => getModelAuthor(m.author)));

// GOOD: batch
const authorsMap = await findCachedAuthors(models.map((m) => m.author));
```

**Select only the columns the caller uses.** Avoid `selectAll()` and `.returningAll()` when the consumer reads a subset, so the row shape matches the type it feeds. Drop `.returningAll()` entirely on a write whose caller discards the row — use `.execute()`.

**Back an `ORDER BY` with an index.** Sorting a table on an unindexed column costs a sequential scan plus a top-N sort on every read. Check the migration for a supporting index, and prefer an indexed column that gives the same order — a `uuidv7()` primary key sorts by creation time and seeks the index for free.

```typescript
// BAD: no index on created_at
.orderBy('created_at', 'desc')

// GOOD: same order, served by the primary key
.orderBy('id', 'desc')
```

**Type raw SQL builders.** ``sql`now()` `` is `RawBuilder<unknown>`; annotate it (``sql<string>`now()` ``) so it matches sibling casts.

## Cache Keys

**Every input that changes the cached value belongs in the key.** If the payload depends on a flag, a variant, or attached media, a key built from the identifier alone serves one caller's value to another. All of today's call sites passing the same flag makes the bug latent, not absent.

```typescript
// BAD: value depends on the flag, key does not
cache.get(url);

// GOOD: flag is part of the key
cache.get(`${url}::prefix:${excludeDataUriPrefix}`);
```

**Derive a lookup key the way the writers derive it.** A hand-built key next to a map whose entries come from a shared helper drifts into a different key space and misses silently. Call the same helper, and bump the cache version when the stored shape changes.

**Bound the key space at the boundary.** A value that becomes a cache variant key needs a real shape check (`/^[0-9a-f]{64}$/` for a sha256 digest), not a truthiness check, or any caller can spray unique keys through the cache.

## Shell and Workflow Scripts

Clean up temp resources with `trap 'rm -rf "$TMP"' EXIT` — `mktemp` output cleaned only on the happy path leaks on interrupt.

Keep behavior-critical flags on the same line as their command. In a multi-line continuation, a flag selecting between safe and dangerous behavior (`--staging`) must not sit alone on a continuation line, where a clipped backslash silently drops it.

## Committed Artifacts

Keep machine- and session-specific paths (`/home/ubuntu/...`) out of committed files; use repository-relative paths. Inspect a regenerated patch file for build-cache output before checking it in.

## Diff Hygiene and PR Description

Keep diffs focused: no reformatting or restructuring that the change does not require, and no change that affects neither behavior nor readability. Every line changed is a line to review.

Update the PR description in the same push as follow-up work — when later commits complete something the body lists as pending, or replace a behavior it describes. Correct figures the diff invalidates, such as a row count no longer covered by a partial index.

## Reviewer Norms

Norms our engineers repeatedly ask for in review, across every layer. Apply them while writing the code, not after review. UI-specific norms live next to the code they govern: user-visible copy and in-flight mutations in `projects/web/REVIEW.md`, shared client state in `packages/frontend/REVIEW.md`.

### Every `isErr` Fallback Logs Once, At The Layer That Owns It

The mechanics of `errT` / `inspectErrorT` / `errSA` and `errorToLogFields` are in `AGENTS.md` (Style Principles, Logging). What those sections do not say is which failures get silently dropped:

- `void wrap(...)` and `void promise` discard the failure entirely. Keep the Result and log it.
- A toast is not a log. A recoverable fallback that hides a feature (returning `null`, dropping a card) still needs `wLog` with `errorToLogFields(error)`.
- A `null` storage object is a failed write, not a success. Optional chaining inside `wrap()` returns `Ok(undefined)` and silences the log.

### Fixed Sets Fail Closed, And Are Never Hand-Maintained

- An unmodelled value must not read as the permissive case. A predicate over a vendor status, a route allowlist, or a capability gate returns the restrictive answer for anything it does not recognize.
- Do not mirror a canonical set into a second literal list (filter options against an enum, route allowlists against their consumers). If a mirror is unavoidable, add a completeness test against the canonical set — typecheck will not catch drift.
- Key on the exported union, not `Record<string, T>`: exhaustiveness turns a new variant into a build error instead of a `??` fallback.

```ts
// BAD: a new status silently renders as 'secondary'
const VARIANTS: Record<string, BadgeVariant> = { draft: 'outline' };

// GOOD: adding a status fails the build here
const VARIANTS: Record<SocialPostStatus, BadgeVariant> = { draft: 'outline' };
```

### Cover The Path You Changed, And Prove The Test Discriminates

- The new branch gets a colocated test — including error captures and param serializers.
- Before claiming coverage, mutate the implementation and confirm the test fails. Tests that pass for the wrong reason are why regressions survive a review round: fakes that model behavior the real dependency never performs, counters no local fake increments, an assertion omitted on one case of three.
- Extract inline serializers and param builders so they can be tested directly.
- Wait deterministically. Do not tune a `setTimeout` until enough microtasks have flushed — see `packages/frontend/REVIEW.md` → Deterministic timers in tests and `AGENTS.md` → Testing.

### Reuse The Primitive; Keep One Copy Of A Rule

- Search for an existing component, hook, or helper before writing one (`ExternalLink`, the shared validation policy). For UI specifically, `packages/frontend/AGENTS.md` names which library to prefer once you have found it.
- Async state belongs in TanStack Query via the shared data layer, not in hand-rolled `useState` loading/error triplets.
- A predicate duplicated at a second call site is two rules that will drift. Extract it and apply it everywhere it belongs — a predicate that is defined but never applied is dead.
- Presentational components take resolved inputs. Hydration, permission, and data-source decisions belong to their container.

### Fix The Class, Not The Instance

When a defect comes from a pattern, grep for the pattern and fix every reachable site in the same PR. Reviewers audit sibling call sites, and a guarded read next to three unguarded ones in the same tree fixes nothing.

### Delete What Your Change Orphans

Removing the last production consumer of a helper orphans it, and the remaining test keeps it looking alive. CI runs `knip --production`, which drops non-`!` entry patterns — so a test-only export *is* reported as an unused export, but `knip.json` sets `exports: "warn"`, so the run still exits 0 and the warning scrolls past. Remove the helper and its tests, or say why it is being kept.
