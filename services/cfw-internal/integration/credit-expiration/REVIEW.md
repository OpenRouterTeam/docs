# Credit Expiration Integration Review

Mocking database query functions is forbidden by `AGENTS.md` and `packages/db/REVIEW.md`.
The single `expireCreditsBatch` spy in `lifecycle.test.ts` is the lone deliberate
exception for failure injection. New tests must use real queries against local
Postgres and must not mock query functions.
