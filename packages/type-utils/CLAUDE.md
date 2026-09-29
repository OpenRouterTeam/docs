# Shared Type Utilities

This package is where cross-cutting type and object helpers live. Reach for
what is here before writing custom utility logic anywhere in the monorepo,
and add new general-purpose helpers here rather than duplicating them in a
consumer.

## Object and Result helpers

From `@openrouter-monorepo/type-utils`:

- `definedValues(obj)` — drop `undefined` values
- `getNonNullFields(obj)` — drop `null` values
- `omitValue(obj, val)` — drop a specific value
- `omit(obj, keys)` / `pick(obj, keys)` — key selection

From `@openrouter-monorepo/lib-result`:

- `wrap(() => ...)` — turn throwing code into a `Result`
- `unwrap(result)` / `unwrapOr(result, default)` — extract a value
- `isOk(result)` / `isErr(result)` — type guards

From `@openrouter-monorepo/lib-async`:

- `safeRace([...])` — memory-safe `Promise.race` replacement

## Enum membership

Use `isMember()` for runtime membership checks instead of manual
comparisons, so extending an enum cannot leave a stale branch behind and
the value narrows after the check.

```typescript
// BAD — becomes a footgun when the enum gains a value
if (value === MyEnum.A || value === MyEnum.B) { ... }

// BAD — no type narrowing
if ([MyEnum.A, MyEnum.B].includes(value)) { ... }

// GOOD
import { isMember } from '@openrouter-monorepo/type-utils';
if (isMember(value, MyEnum)) { ... }
```

`isMemberOrNull` accepts nullable values, and
`findMemberCaseInsensitive(userInput, MyEnum)` returns the canonical value
or `undefined` for case-insensitive lookups.

## Zod

Import zod and its helpers from `@openrouter-monorepo/lib-zod` (`packages/lib/zod`). That package is the only owner of Zod configuration (the OpenAPI extension and the guard compiler), so new Zod helpers belong there, never redefined per package.
