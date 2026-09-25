# Cloud Run bench-worker telemetry runbook

Use this procedure after a deploy. It verifies the telemetry from the native Cloud Run benchmark worker pool.

- **Worker pool:** `bench-worker-native`
- **Project:** `openrouter-core`
- **Region:** `us-central1`
- **Datadog dashboard:** `Temporal SDK Metrics` (`3xb-xgk-r74`)

## How the pieces fit

The benchmark worker has two direct telemetry paths and one Google Cloud integration path:

- The OpenTelemetry SDK sends the `openrouter.*` application metrics and the Temporal SDK metrics directly to Datadog OTLP.
- The Google Cloud integration collects the Cloud Run metrics, such as `gcp.run.container.*`.
- The worker resolves its service name as `process.env.DD_SERVICE ?? BENCH_WORKER_SERVICE_NAME`. The worker gives that same value to the OpenTelemetry SDK and to the Temporal `service` and `service_name` tags. The worker uses `DD_ENV` for the `env` tag. If `DD_ENV` is not set, the worker uses `OR_ENV`.

The `DD_SERVICE=bench-worker` and `DD_ENV=production` blocks in the worker pool are the deployment contract. Both telemetry paths read the same service name. Do not change one path alone.

## Verify the base telemetry

Authenticate a `gcloud` account, then describe the worker pool:

```bash
gcloud beta run worker-pools describe bench-worker-native \
  --project=openrouter-core \
  --region=us-central1 \
  --format='yaml(name,latestCreatedRevision,template.containers)'
```

Expected result: the worker pool exists in `us-central1`. Its revision is the revision you deployed. Its worker container has `DD_SERVICE=bench-worker` and `DD_ENV=production`. If the revision or the environment is wrong, stop the deploy and deploy the correct image. Do not change the Datadog queries to match an incorrect service name.

In Datadog, query the last 30 minutes:

```text
avg:openrouter.runtime.node.mem.rss{service:bench-worker}
avg:openrouter.runtime.node.cpu.utilization{service:bench-worker}
avg:openrouter.db.query_duration_ms{service:bench-worker}
```

Expected result: each query returns points from the new revision. The `openrouter.db.*` query shows that the application metrics path still works. The worker pool has no Datadog agent, so the runtime gauges are the only source of Node process metrics.

Query the Temporal SDK metrics. Today they answer to the `service` tag:

```text
avg:temporal_worker_task_slots_available{service:temporal-core-sdk}
avg:temporal_worker_task_slots_used{service:temporal-core-sdk}
```

Expected result: both series return points under the old `service:temporal-core-sdk` tag. After this change deploys, query the same metric names with `service_name:bench-worker`. The new tag shows that the service name moved with `getBenchWorkerServiceName()`. If the revision is correct and the series still answer only to the old tag, read the telemetry resolver first. Do not change a dashboard query.

Query the Google Cloud container metrics:

```text
avg:gcp.run.container.cpu.utilizations.p99{worker_pool_name:bench-worker-native}
avg:gcp.run.container.memory.utilizations.p99{worker_pool_name:bench-worker-native}
avg:gcp.run.container.instance_count{worker_pool_name:bench-worker-native}
```

Expected result: the two percent series identify the worker pool. The instance-count series shows the active instances. The Google Cloud integration can need about 15 minutes to show a new metric. After 15 minutes, do not accept a missing point as normal delay. Check the integration project scope, the integration region scope, and Cloud Monitoring.

The two telemetry paths use different intervals. The Temporal SDK metrics use the 10-second interval at `metricsExportInterval: '10s'` in `services/gcp-bench-worker/src/telemetry.ts`. The runtime gauges use a 15-second sample interval at `DEFAULT_INTERVAL_MS` in `packages/cloudrun/runtime-metrics.ts`. The `NodeSDK` reader then exports each sample every 5 seconds, at `exportIntervalMillis: 5000` in `packages/cloudrun/telemetry.ts`. The reporter does not report immediately, so the first runtime gauge point appears about 15 to 20 seconds after a healthy worker starts.

A worker that stops before the first 15-second sample sends no runtime gauge at all. For that startup window, read `avg:gcp.run.container.instance_count{worker_pool_name:bench-worker-native}` and the container logs. In all other cases, wait 30 seconds after a healthy worker starts before you diagnose a missing runtime gauge. If no runtime gauge arrives after 2 minutes, read the worker logs. Then check the Datadog OTLP endpoint and the API key configuration.

Terraform does not manage the dashboard. After the revision is healthy, edit dashboard `3xb-xgk-r74` by hand:

1. Change the compute group from `host:gk3-bench-workers*` to `gcp.run.container.*{worker_pool_name:bench-worker-native}`.
2. Add runtime widgets for the `openrouter.runtime.node.*` queries above.
3. Keep the Temporal widgets grouped by `service_name:bench-worker`.
4. Save the dashboard.
5. Reload the dashboard and confirm that the widgets show current points.

If an edit is wrong, restore the previous widget queries from the saved dashboard configuration. Then repeat the edit. Do not add a new Terraform dashboard for this worker pool.

## Troubleshooting and rollback

- **No worker revision:** read the deploy workflow and the Cloud Run revision state. To revert, deploy the last known-good worker image to `bench-worker-native`.
- **No OTLP metrics after 2 minutes:** check `DD_API_KEY`, `TEMPORAL_METRICS_OTEL_URL`, and the worker logs. If the worker is unhealthy, revert to the last known-good worker image.
- **No Google Cloud metrics after 15 minutes:** check that the Datadog integration can read `openrouter-core`. Check that Cloud Monitoring holds the `gcp.run.container.*` series. Integration delay is independent of the worker image, so revert only if the worker is unhealthy.
- **Different service tags on the two paths:** restore `DD_SERVICE=bench-worker` and deploy again. Then run all three Datadog queries again. Do not hide a split service name behind a dashboard filter.
