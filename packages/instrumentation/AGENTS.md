# Errors and Logging

This package owns the error and logging primitives the rest of the monorepo
uses. The conventions below apply wherever they are consumed, not only to
code in this directory.

## Overview

Use `Result<T, E>` monads, not try/catch. Errors are typed `ErrorT` values
propagated through `Err<ErrorT>`. Never throw exceptions in business logic.

## Core Types

- **`ErrorT`** - Internal error with `status`, `message`, `location`, `metadata`, `internal`, `debug`, `user`
- **`ErrorResponse`** - Public-facing error shape (masks internal details)
- **`Result<T, E>`** / **`Err<E>`** / **`Ok<T>`** - From `@openrouter-monorepo/type-utils/result-monad`

## Creating Errors

### `errT` - Create `Err<ErrorT>` (most common)

```typescript
return errT({
  location: 'router.parseRequest.validation',
  rawError: validationResult.error,
  status: HTTPStatus.S400_Bad_Request,
  user: this.context.user,
});
```

Fields:
- `rawError` - The original error (`Error`, `string`, `ErrorT`, or `ErrorResponse`)
- `location` - Required when `rawError` is not an `ErrorT`. Optional when `rawError` is already an `ErrorT` (preserves its existing location). Use dot notation (`'module.function'`) or prefix (`'adapter: provider'`)
- `status` - `HTTPStatus` enum value. Omit or `null` for unhandled errors (treated as 500)
- `metadata` - Public data sent to client (e.g. `provider_name`, `raw`). Special field: `metadata.headers` is spread into HTTP response headers by `toHonoErrorResponse`
- `internal` - Private data for logging only, never sent to client
- `debug` - Debug data for logging
- `user` - `{ entityId }` for user attribution

### `makeErrorT` - Create bare `ErrorT` (not wrapped in `Err`)

```typescript
const errorT = makeErrorT({
  location: 'stream-processor:processSSE',
  rawError: chunkResult.error,
});
```

### `errSA` - Next.js server action errors

Calls `inspectErrorT` internally. Returns `Err<ErrorResponse>`:

```typescript
return errSA(HTTPStatus.S502_Bad_Gateway, result.error, 'updateModelSA');
```

Use `errSA` only at genuine Next.js server-action boundaries. Workers and
Hono handlers must not use it: their internal functions return
`AsyncResult<T, ErrorT>`, create failures with `errT`, and preserve that
`ErrorT` until the HTTP boundary.

## Logging

Use `iLog()`, `eLog()`, and `wLog()` from
`@openrouter-monorepo/instrumentation/logger` — never `console.log()`. The
one exception is a shared package where importing the logger would create a
circular dependency; keep those minimal.

- Name events descriptively (`'zodGuardMode'`) and use snake_case context
  fields.
- Log raw diagnostic values, not preformatted strings:
  `iLog('zodGuardMode', { zod_guard_mode_at_startup: mode })`, not an
  interpolated sentence.
- **Every `isErr()` branch logs.** `wLog()` when the code recovers and
  returns a default, `eLog()` when the failure degrades functionality. A
  silent `isErr()` branch is a lost error.
- Pass Error objects through `errorToLogFields(error)`, which extracts
  `error_message` and `error_stack`. `message` and `stack` are
  non-enumerable, so a raw `{ error }` context logs as `{}`.
- `unknownErrorToString(error)` is the string form for messages, e.g.
  `` throw new Error(`Operation failed: ${unknownErrorToString(error)}`) ``.
- **Never log a value you did not assemble for the log line.** Vendor API
  objects, DB rows, request and response bodies, auth/session and user
  objects, webhook events, config objects, and thrown errors go in as named
  scalar fields — never the object itself, a spread of it, or a nested branch
  of it. Error paths are not an exception: log `error.message` and a stable
  code, not the raw error or the object that caused it.
- **Name every field.** Enumerate the identifiers and values the line needs
  (`user_id`, `status`, `amount`) so each field is a deliberate choice. A
  logged object silently gains fields when its upstream shape changes, and
  logs have no deletion path.
- **Keep sensitive and unbounded values out.** No prompts or completions,
  keys or tokens, emails, names, addresses, payment details, or base64
  blobs; log an ID or a hash for correlation.
  `openrouter/no-stripe-payloads-in-logs` enforces this for Stripe
  resources. It is a floor, not the boundary of the rule.

```typescript
// BAD - silent error handling
if (isErr(result)) {
  return defaultValue;
}

// GOOD - with logging
if (isErr(result)) {
  wLog('operation-failed', errorToLogFields(result.error));
  return defaultValue;
}
```

## Logging Errors

### `inspectErrorT` - Log `ErrorT` to observability

Auto-determines severity:
- Critical (5xx non-adapter, null status, cron errors) -> `eLog`
- Non-critical (client errors, adapter errors) -> `wLog`

```typescript
if (isErr(result)) {
  inspectErrorT(result.error);
}
```

With sampling: `inspectErrorT(errorT, { samplingRate: 0.1 });`

**When to call:**
- Call at the point where you **handle** the error, not where you create it
- Do NOT call if returning `errT` for the caller to handle
- `errSA` calls it internally - do not double-log
- `toHonoErrorResponse` calls it internally (unless `shouldSkipInspectErrT` is set)
- `toNextErrorResponse` does NOT call it - log manually before calling

### `captureException` - Record raw exceptions on trace spans

For raw `unknown` errors (not `ErrorT`):

```typescript
captureException(rawError, {
  isCauseKnown: false,
  log: 'failed to submit generation',
});
```

- `isCauseKnown: true` - Expected (stream cancellation, timeouts)
- `isCauseKnown: false` - Unexpected, needs investigation

### `captureExceptionAndFallback` - Try with fallback

```typescript
const safeValue = captureExceptionAndFallback(
  () => riskyOperation(),
  () => fallbackValue,
);
```

## Converting Errors for Responses

### `toErrorResponse` - `ErrorT` to public `ErrorResponse`

Masks 500 errors. Non-500 includes message and metadata:

```typescript
const payload = toErrorResponse(errorT);
```

### `toNextErrorResponse` - To Next.js `Response`

Does NOT call `inspectErrorT` - log manually first:

```typescript
inspectErrorT(errorT);
return toNextErrorResponse(errTResult);
```

### `to500NextErrorResponse` - Generic 500 from Next.js API route

Wraps `rawError` in `errT` and converts to 500 Response:

```typescript
return to500NextErrorResponse('myRoute', rawError);
```

### `toHonoErrorResponse` - To Hono response (cfw-api)

Calls `inspectErrorT` internally:

```typescript
const result = await runWorkerOperation();
if (isErr(result)) {
  return toHonoErrorResponse(c, result.error);
}
```

Pass the original `ErrorT` directly. Do not convert it to `ErrorResponse` and
back, and do not inspect it before this call: either step can discard its
location/diagnostics or log the same failure twice.

## Decision Guide

- Expected throwing operation -> `wrap(() => riskyAsyncOperation())`, not try/catch

- Return error from a function returning `Result` -> `errT`
- Need bare `ErrorT` value (not in a `Result`) -> `makeErrorT`
- Return error from a genuine Next.js server action -> `errSA`
- Return error from Worker/Hono business logic -> `errT`, preserving `ErrorT`
- Log an `ErrorT` to observability -> `inspectErrorT`
- Record a raw exception on a trace span -> `captureException`
- Try something with a fallback value -> `captureExceptionAndFallback`
- Convert `ErrorT` to API response payload -> `toErrorResponse`
- Convert `ErrorT` to Next.js Response -> `toNextErrorResponse`
- Return a generic 500 from a Next.js API route -> `to500NextErrorResponse`
- Convert `ErrorT` to Hono response -> `toHonoErrorResponse`
- Log an unknown error for observability -> `errorToLogFields`
- Convert unknown error to string -> `unknownErrorToString`

Error helpers import from `@openrouter-monorepo/instrumentation/error`,
except `toHonoErrorResponse` from `@openrouter-monorepo/routing/errors`;
Result helpers from `@openrouter-monorepo/type-utils/result-monad`.
