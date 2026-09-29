# Object Storage

Domain-specific object-storage flows for OpenRouter: managed-skill bundles and R2 audit logging. Uses R2 bucket bindings passed in by callers — no direct cloud-provider SDK dependencies.

## Key Modules

| Directory | Purpose |
|-----------|---------|
| `r2-audit/` | Structured audit events for object-level R2 access (`r2_audit` Datadog stream): event schema, `logR2Audit()`, and the R2 event-notification Zod schema + mapper. R2 has no native object-level audit logs; workers wrap their bucket bindings and consume event notifications to emit these |
| `skill-bundles/` | Managed-skill bundle upload + commit flow using R2 bucket bindings |
| `skill-bundles/bundle-cache.ts` | In-memory bundle cache with TTL for hot reads |
| `skill-bundles/bundle-limits.ts` | Size and count validation for skill bundles |
| `skill-bundles/bundle-path.ts` | Path validation for skill bundles (safe-path checks, traversal prevention) |
| `skill-bundles/bundle-path-vectors.ts` | Vector-based path computation for versioned bundles |
| `skill-bundles/merge-bundles.ts` | Bundle merge logic for multi-file skill uploads |
| `skill-bundles/read-bundle-bytes.ts` | Raw byte-level bundle reads from object storage |
| `skill-bundles/read-version-file.ts` | Reads individual files from a versioned skill bundle |

## Commands

| Command | Description |
|---------|-------------|
| `bun run test` | Run unit tests |
| `bun run typecheck` | Type-check with tsgo |
