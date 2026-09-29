# Restrictions review checklist

Flag any PR that adds a ban, limit, or gate column or flag to `users` or to a
`users` `*_settings` JSON instead of storing that concept in `restrictions`.

Restrictions are the centralized data model. Policy evaluation and
route-specific orchestration belong outside this database domain.

Verify that every write helper is behind an admin or authority gate. The
`actingClerkUserId` must come from the server or be a fixed `system`/`compliance`
sentinel, never from client input. Treat `source` as a caller-asserted
authority claim rather than a value verified by this layer, and keep PII out
of `target` and `params`.
