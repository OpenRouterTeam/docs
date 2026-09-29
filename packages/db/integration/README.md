## DB Integration Tests

These tests are run in CI whenever packages/db or postgres/ has a change.

## Running Tests Locally

To run the integration tests locally:

```bash
cd packages/db
bun run test:integration
```

These tests require a running local Postgres instance (`bun run db:start`) and will test actual database operations.
