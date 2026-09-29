# Cloudflare Package Agent Guidelines

Every live-config schema key must have a `.default()`. Every schema passed to
`createGetLiveConfig` must have a colocated test that calls
`validateLiveConfigSchema`. A cold isolate read throws for a key without a
default; there is no KV fallback.

Live-config reads must never block on KV. A cold isolate serves the schema
default and refreshes in the background, so `get` takes no option that waits on
the KV read and a gate that cannot tolerate its default changes the default
instead — see `REVIEW.md`.
