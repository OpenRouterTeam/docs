## Broadcast Integration Tests

Integration tests that validate broadcast destination delivery end-to-end. Each active destination is tested for connection, trace sending, and privacy mode compliance.

## Running Tests

### Locally

```bash
cd packages/broadcast
bun run test:integration
```

Tests automatically skip destinations whose `E2E_*` env vars are missing or set to `REPLACE_ME`. To run a specific destination locally, export its required env vars (see `all-destinations.test.ts` for the full list) or populate them via Infisical / `.env.development.local`.

**OTEL Collector** requires a running collector instance. Options:

- **Tilt (recommended):** `tilt up` (use `TILT_PROFILE=lean tilt up` if encountering OOM) and enable the `otel-collector` resource.
- **Docker Compose:** `cd dev && docker-compose -f docker-compose.otel.yaml up -d`

Then set `E2E_OTEL_COLLECTOR_ENDPOINT=http://localhost:4318/v1/traces` to enable its tests.

### In CI

The `ci-broadcast.yaml` workflow runs automatically on changes to `packages/broadcast/` or the workflow file. Pull requests run deterministic local destinations; manual runs also fetch live-vendor secrets from Infisical (`/tests/e2e/broadcast`). The workflow:

1. Starts ClickHouse, RustFS (S3-compatible), and OTEL Collector as Docker services
2. Runs `bun run test:integration` in `packages/broadcast`

## Adding a New Destination

1. Add a `DestinationTestEntry` to the `destinations` array in `all-destinations.test.ts`
2. Define `requiredEnvVars` (prefixed `E2E_`) and `buildConfig()`
3. Add the env vars to `scripts/infisical/link-broadcast-to-tests-e2e.ts`
4. If the destination needs infrastructure (e.g. table creation), add a `setup()` function
5. Update `ci-broadcast.yaml` if new Docker services are needed
