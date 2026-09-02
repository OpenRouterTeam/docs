# KYC agent guidance

Before you change known-image matching or review code, read [`docs/vendor/roost-coop/phase-1-known-hash.md`](./docs/vendor/roost-coop/phase-1-known-hash.md) for the Phase 1 contract, the three rollout gates, and the launch gaps.

- Treat the live vendor OpenAPI and the pinned deployment image as the HTTP contract. Update Zod schemas, redacted fixtures, and contract tests together when that contract changes.
- Keep vendor clients transport-only. Polling, storage access, retries, policy, regional routing, and workflow orchestration belong to an owning service.
- Return `AsyncResult<T, ErrorT>`, validate vendor responses with Zod, inject `fetch` and base URLs, and consume or cancel every response body.
- Encode every caller-supplied path segment and construct query strings with `URL` and `URLSearchParams`.
- Never include credentials, content, hashes, signed URLs, classifier output, moderation records, report data, or raw vendor bodies in logs or errors.
- Do not add a production trust-and-safety vendor call site without approved security, retention, authorization, and regional-processing controls.
