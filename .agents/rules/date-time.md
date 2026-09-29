# Date and Time Handling

Prefer [Luxon](https://moment.github.io/luxon/) over native `Date` objects.

## When to Use Luxon

- Timezone conversions
- Locale-aware formatting
- Relative time display (e.g., "in 7 days")
- Complex date arithmetic
- Duration calculations

## Common Patterns

```typescript
DateTime.fromJSDate(date)          // Convert JS Date
DateTime.fromISO(isoString)        // Parse ISO string
DateTime.now()                     // Current time
dateTime.plus({ days: 7 })         // Add time
dateTime.minus({ hours: 1 })       // Subtract time
dateTime.diff(other, 'days')       // Calculate difference
dateTime.toLocaleString()          // Locale-aware format
dateTime.toRelative()              // "in 7 days"
dateTime.toUTC().toISO()           // UTC ISO string
```

## Exception: Bundle-sensitive packages

In `services/cfw-api/src/` and `packages/router/`, **luxon imports are banned**
via an Oxlint `no-restricted-imports` lint rule to reduce bundle size (~259 KiB).
Use native `Date`, `Intl.DateTimeFormat` (with `hourCycle: 'h23'` for 24-hour
format), or helpers from `@openrouter-monorepo/helpers/date` instead.

## When Simple Helpers Are Fine

Basic utilities in `@openrouter-monorepo/helpers/date` (like `toDateString`,
`toMidnightOnDate`) are acceptable for simple operations without timezone
handling.
