# Restrictions database domain

This package is the data-centralization layer for entity restrictions. Keep it
focused on storing and retrieving restriction state, not on becoming a policy
engine.

## Adding a restriction kind

When adding a new restriction kind, update every layer in this order:

1. Add the enum value and regenerate the database types (schema layer).
2. Add the Zod `params` schema (this package).
3. Add the `dbWrite` helper (this package).
4. Add the dual-write site (dual-write layer).
5. Add the overlay `case`; the exhaustive `satisfies never` check must force
   this step (overlay layer).
6. If the kind replaces an existing legacy field on `users` or a `*_settings`
   JSON, add the backfill mapping that migrates that legacy state into
   `restrictions`. Brand-new kinds with no legacy equivalent skip this step.
7. Decide whether Sentinel agents may enact the kind and, if so, add it to
   `AGENT_ENACTABLE_KINDS` in the cfw-internal agent enact policy. Kinds not
   listed there are refused on the agent enact path by default.
8. Decide whether the enterprise org-join carveout may revoke domain-fanned
   rows of the kind, and record the decision in
   `DOMAIN_CARVEOUT_REVOCABLE_BY_KIND` (`domain-restriction-mapping.ts`).
   The map is exhaustive over `RestrictionKind`, so the typecheck forces
   this step.

Expired but unrevoked rows still occupy the active unique slot, so a plain
`createRestriction` on such a key returns the typed already-active error. If
the kind can carry an `expires_at`, re-create through
`reclaimExpiredRestrictionInTransaction` or
`createRestrictionsReclaimingExpired`, which revoke the expired row and insert
the new one in the same transaction.

Do not add new ban, limit, or gate columns or flags to `users` or to any
`users` `*_settings` JSON. Those concepts belong in `restrictions`.

`updateRestriction` is an entity-scoped, by-id administrative edit for active rows only.
It returns `null` when the restriction is missing or already revoked, and
returns an error when the stored kind does not match the input kind. A
concurrent revoke therefore cannot have its params rewritten.

## Authorization and data boundaries

These write helpers must sit behind an admin or other authority gate.
`actingClerkUserId` must be the server-derived acting ID, or a fixed
`system`/`compliance` sentinel; it must never come from the client.
`source` is a caller-asserted authority claim and is not verified in this
layer. Keep PII out of `target` and `params`.

`actingClerkUserId` is compiler-enforced through the branded type minted by `mintActingClerkUserId`. Only production callers that sit behind a server-side admin or equivalent internal authority gate may call that mint function: the dual-write gate module's entry points, and the Sentinel ban-candidates handlers (`/enact`, `/review`, `/undo`, `/review/batch`, `/archive`) which mint the actor from the credential cfw-internal itself verified: the Clerk session cookie of an internal admin (Mission Control), or a Devin OIDC token, as the issuer-signed requester it names or else its `devin_id` claim (`devin:<devin_id>`). Request bodies never name an actor; a body carrying one is rejected.

Devin OIDC requests are bounded by the agent enact policy gates: only kinds in
`AGENT_ENACTABLE_KINDS` (never `account_ban`), user targets only, and
non-PAYG/protected accounts refused with fail-closed account and plan lookups.

The Clerk `user.created` webhook handler may mint the actor stored on an
already-gated `domain_restrictions` row when applying that policy at signup;
the row was created by the gated enactment path and is not client-supplied.

The Mission Control `restrictions-history.actions.ts` server actions are also
allowlisted: they sit behind `withContextSA({ requireAdmin: true })` and mint
the actor from the authenticated admin context before direct restriction writes.

The overlay layer must consume restriction state through the auth service or
cache; it must never call `getActiveRestrictionsForEntity` per request on the
inference path.
