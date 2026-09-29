# Services

Each module in service should use a prefix denoting which cloud/platform it's being deployed to. A service should not be cloud agnostic, it should focus on building and deploying an entry point to a specific cloud. Shared logics should be moved into `utils` or `packages`.

- `cfw-`: Cloudflare Workers
- `gcp-`: Google Cloud Platform
- `aws-`: Amazon Web Services
- `azr-`: Azure Deployment

## Metrics & instrumentation (required for every new service)

Statsd metrics only flow if a service installs a client at startup. Until
`setStatsd(...)` runs, `getStatsd()` returns a no-op (`StatsdNoop` in
`packages/instrumentation/statsd.ts`) and **every** `openrouter.*` metric —
including the `openrouter.db.*` counters emitted by `packages/db` — is silently
dropped. Nothing shows up in Datadog. Wire this up once, at the top of your
entrypoint, before any DB or request handling:

**Cloud Run / GKE (Node):**

```ts
import { OtelStatsd } from '@openrouter-monorepo/cloudrun/otel-statsd';
import { initializeTelemetry } from '@openrouter-monorepo/cloudrun/telemetry';
import { setStatsd } from '@openrouter-monorepo/instrumentation/statsd';

await initializeTelemetry({ serviceName: 'my-service' });
setStatsd(new OtelStatsd('my-service'));
```

`initializeTelemetry()` needs `DD_API_KEY` in the environment to export at all,
so make sure your Terraform / k8s manifest wires that secret. It defaults
`service.name` from `K_SERVICE` (Cloud Run only); on GKE Jobs neither
`K_SERVICE` nor `K_REVISION` is set, so pass `serviceName` explicitly (or it
falls back to `DD_SERVICE`). Temporal workers also call
`installTemporalRuntimeTelemetry()` for the `temporal.*` runtime metrics — that
is separate from statsd and does not replace `setStatsd()`.

**Cloudflare Workers:**

```ts
import { setBreadcrumbs } from '@openrouter-monorepo/instrumentation/breadcrumbs';
import { cloudflareBreadcrumbs } from '@openrouter-monorepo/instrumentation/cloudflare-breadcrumbs';
import { CloudflareStatsd } from '@openrouter-monorepo/instrumentation/cloudflare-statsd';
import { setStatsd } from '@openrouter-monorepo/instrumentation/statsd';

setStatsd(new CloudflareStatsd(['service:my-worker']));
setBreadcrumbs(cloudflareBreadcrumbs);
```

See `services/cfw-rerank-api/src/index.ts` (Cloudflare) and
`services/gcp-gateway-bench-coord/src/index.ts` (Cloud Run) for reference.
