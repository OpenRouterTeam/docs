# Web/RSS connector (PR10) deferrals

## Implemented in this package

- Versioned Web/RSS connector manifest/config/cursor/snapshot Zod schemas
- Injected `SsrfSafeFetchClient` interface only (no arbitrary network access)
- Injected `WebContentPolicy` interface for robots.txt and license/retention
- Pure HTTPS URL canonicalization + non-empty allowlisted host validation
- Reject credentials, all private IP ranges (RFC1918, CGNAT, link-local, loopback,
  metadata, 0/8, IPv6 ULA/link-local/mapped-v4), non-HTTPS
- `response.finalUrl` revalidated fully against allowlist/HTTPS/no-credentials/private
- Bounded bytes (5MB) and MIME type validation
- `respectRobots` enforcement: when true and injected policy denies → fail closed
- `fullRetention` enforcement: requires explicit license from injected policy;
  without license → excerpt-only with `retentionPolicy: 'excerpt_only'`
- Source ordering via source-authoritative timestamp (`Last-Modified` /
  `publishedAt` / `lastBuildDate`, epoch sentinel when absent) + canonical
  content hash (never lexicographic ETag comparison, never fetch wall-clock —
  the runtime revalidates re-fetched snapshots against the accepted envelope)
- Publication time != observed time separation
- External citation via canonical URL
- Poll enumeration from configured feeds/pages
- Conformance harness and fixture-backed unit tests
- Removed pages (404/410): `fetch` returns null and the ingestion runtime
  routes delete-capable connectors through the delete lifecycle
  (`commitDeleteDelivery` with `classifiedDelete`), de-indexing the object

## DNS/per-hop guard note

`isPrivateIp` checks literal hostnames only. DNS rebinding attacks (where a
hostname resolves to a private IP) are guarded by the injected `SsrfSafeFetchClient`
adapter, which MUST resolve DNS and validate the resolved IP address before
connecting. This is documented in the `SsrfSafeFetchClient` interface contract.

## Explicitly deferred

| Item | Why | Target |
|---|---|---|
| HTTP adapter implementation | Connector receives interface only; keeps package network-free | `services/cfw-synapse` |
| `robots.txt` fetching/parsing | Requires HTTP adapter; connector receives `robotsAllowed` from policy | future worker PR |
| RSS/Atom/JSON Feed XML parsing | Requires parser dependency; interface only in PR10 | future worker PR |
| Full HTML content extraction | Requires readability/parser; excerpts only | future worker PR |
| `services/cfw-synapse` route/queue wiring | Service absent on branch | future worker PR |
| Backfill/provisioning automation | Administrative workflow | PR11 |
| Redirect following with validation | Bounded to 3 HTTPS-only hops in production adapter | worker adapter |
| Production embedding model selection | Owned by PR5 bake-off | PR5 follow-up |
