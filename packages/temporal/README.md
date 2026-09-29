# @openrouter-monorepo/temporal

Core Temporal SDK package for workflow orchestration in the OpenRouter monorepo.

## Overview

This package provides the foundational Temporal infrastructure for running durable, long-running workflows. It contains workflow definitions, activity implementations, schemas, and client utilities that are shared across services.

## Key Concepts

### Workflows vs Activities

**Workflows** are deterministic orchestration functions that coordinate activities. They must be pure and cannot perform I/O directly. Workflows are bundled separately using Temporal's webpack bundler.

**Activities** are the actual work units that perform I/O operations (API calls, file operations, etc.). They run in the worker process and can use any Node.js APIs.

### Task Queues

Task queues route workflows and activities to specific workers. This package defines task queue constants in `task-queues.ts` to ensure consistency across the codebase. The continuous CREMA demand-reporter activity runs on its own dedicated task queue so its long-lived polling does not contend with benchmark execution slots.

## Package Structure

```
src/
  activities/       # Activity implementations (I/O operations)
    index.ts        # Barrel export for activities
    auto-exacto.ts  # Auto-exacto benchmark activities (endpoint pinning, DB queries)
    open-bench.ts   # OpenBench CLI activities
    upload-raw-benchmark-results.ts  # GCS upload for benchmark results
  workflows/        # Workflow definitions (orchestration)
    index.ts        # Barrel export for workflows
    benchmark.ts    # Benchmark workflow definitions
    benchmark-child.ts # Per-run child workflow; reports pending demand continuously (on a separate demand-reporter task queue) so CREMA can autoscale bench workers
    auto-exacto/    # Auto-exacto provider/model/endpoint benchmark workflows with endpoint-ID pinning
    sweep/          # Endpoint benchmark sweep workflow with progress tracking and tally aggregation
  client.ts         # Temporal client factory (Node.js only)
  schemas.ts        # Zod schemas for workflow inputs/outputs
  task-queues.ts    # Task queue constants
  utils.ts          # Shared utilities
  env.ts            # Environment variable configuration
  index.ts          # Main package exports
```

Note: GCS storage utilities are in `packages/clients/gcp/storage.ts` and are used by the upload activities.

## When to Use This Package

Use this package when you need to:

- Define new Temporal workflows or activities
- Import workflow/activity types for type-safe workflow execution
- Access Temporal client utilities from server-side code
- Use shared schemas for workflow inputs/outputs

## Usage Patterns

### Importing in Workflows

Workflows must only import types from activities (not implementations):

```typescript
import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const { myActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
});
```

### Importing in Workers

Workers import actual activity implementations to register them:

```typescript
import * as activities from '@openrouter-monorepo/temporal/activities';
import { getTemporalIdentity } from '@openrouter-monorepo/temporal/identity';

const worker = await Worker.create({
  activities,
  identity: getTemporalIdentity('my-worker'),
  // ...
});
```

### Importing Client (Server-Side Only)

The Temporal client uses gRPC which is Node.js-only. Import from the `/client` subpath:

```typescript
import { getTemporalClient, closeTemporalClient } from '@openrouter-monorepo/temporal/client';

const client = await getTemporalClient();
await client.workflow.start(/* ... */);
```

### Importing Schemas and Types

For type-safe workflow inputs/outputs:

```typescript
import {
  BenchmarkWorkflowInputSchema,
  type BenchmarkWorkflowInput,
} from '@openrouter-monorepo/temporal';
```

## Integration Points

### With Workers (`services/gcp-bench-worker`)

The worker service imports activities from this package and registers them with the Temporal worker. It also loads the pre-built workflow bundle.

### With Mission Control (`projects/mission-control`)

Mission Control uses the client utilities to start workflows and query their status. It imports schemas for type-safe form handling.

### With CLI Scripts (`scripts/temporal/`)

CLI scripts use the client to trigger workflows from the command line for testing and manual execution.

## Adding New Workflows

1. Create workflow file in `src/workflows/`
2. Export from `src/workflows/index.ts`
3. Define input/output schemas in `src/schemas.ts`
4. Create activities in `src/activities/` if needed
5. Export activities from `src/activities/index.ts`
6. Register activities in the worker service

## Adding New Activities

1. Create activity file in `src/activities/`
2. Export from `src/activities/index.ts` (uses wildcard exports)
3. Re-export in worker's `activities.ts` file
4. Import as type in workflows using `import type * as activities`

## Testing

Tests use `@temporalio/testing` with vitest:

```bash
cd packages/temporal
bun run test
```

The test environment provides an in-memory Temporal server for fast, isolated testing.

## Benchmark OpenAPI Spec

`benchmarks.openapi.json` is generated from the benchmark workflow input schemas (plus internal HTTP routes such as benchmark result visibility) so external tooling can validate workflow inputs. The Temporal workflow-start contract itself is not a live HTTP service — start runs with the `temporal` CLI. The spec is served by `services/cfw-internal` behind `ADMIN_API_KEY`:

```bash
bun run generate:benchmark-openapi
```

## Environment Variables

When using the client, these environment variables configure the connection:

| Variable | Description | Default |
|----------|-------------|---------|
| `TEMPORAL_ADDRESS` | Temporal server address | `localhost:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `default` |
| `TEMPORAL_API_KEY` | API key for Temporal Cloud (enables TLS) | - |

## Related Documentation

- [Temporal TypeScript SDK](https://docs.temporal.io/develop/typescript)
- [Workflow Bundling](https://docs.temporal.io/develop/typescript/core-application#workflow-bundling)
- [Testing Workflows](https://docs.temporal.io/develop/typescript/testing-suite)
