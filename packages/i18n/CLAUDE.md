# i18n

## Ownership

This package owns locale-aware human display. Every pure function takes an explicit supported locale. React bindings live in `packages/frontend/i18n`; route parameter readers and content-readiness policy live in each application.

## Formatting contracts

Never read navigator, storage, browser timezone, or the current clock. Instants require an explicit timezone; relative formatting also requires a reference instant. Date-only values are validated calendar dates and do not shift with a timezone.

Keep exact decimal arithmetic through the final output. Currency formatters own symbols and spacing. Missing, malformed, non-finite, and out-of-domain display values return undefined; boundary parsers return Results. Feature components decide how unknown values render.

Calendar displays support Gregorian years 0001–9999, including after applying the explicit timezone; era-ambiguous dates are unknown. Timezone inputs must be UTC or named region/link identifiers, including Etc zones; abbreviations are rejected even if an ICU version aliases them to a region. Numeric instant offsets follow the RFC 3339 hour/minute grammar through ±23:59. Generic currency balance formatting validates the currency and uses its native minor units; USD-specific pricing presets remain separate.

Add reviewed fixtures for every supported locale when introducing a preset. Choose semantic presets for product displays. `formatFixed` is for domain-selected precision and `getNumberFormatOptions` overrides are for third-party component adapters. Do not introduce arbitrary Intl options at feature call sites.

General helpers may not import this package. Import numeric arithmetic through `@openrouter-monorepo/lib-bignumber`; do not import feature code, React, Next.js, message catalogs, or data access. Cache Intl instances only in bounded locale-bound factories, never mutable current-locale state.
