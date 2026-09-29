# Postmortem Archive

Incident postmortems archived from the #post-mortems Slack channel. These files provide
historical context for the `/risk` PR scoring workflow, helping the LLM identify patterns
in past incidents when evaluating new changes.

## Index

| Date | Incident | Affected Subsystems |
|------|----------|---------------------|
| 2024-10-21 | [Gemini Usage Metadata Schema Change Causing Queue Backup Due To Undefined](2024-10-21-10-21-gemini-usage-metadata-schema-change-causing-queue-backup-due-to-undefined.md) | `billing`, `models` |
| 2024-10-30 | [Middleware clerk regex change broke oauth2](2024-10-30-10-30-middleware-clerk-regex-change-causing-oauth-key-minting-to-not-work.md) | `auth`, `monitoring` |
| 2024-11-01 | [Committed secrets env](2024-11-01-10-31-committed-secrets-env-to-a-stack.md) | `auth`, `docs`, `secrets` |
| 2024-11-11 | [Analytics undercounting when there were > 2 db timeouts since the chunking algor](2024-11-11-analytics-undercounting-db-timeouts-chunking-algorithm.md) | `billing`, `clickhouse`, `infra`, `supabase` |
| 2024-11-14 | [Adding env variables caused a complete outage for cloudflare (1.5 minutes) and v](2024-11-14-env-variable-addition-caused-cloudflare-vercel-outage.md) | `cloudflare`, `infra`, `monitoring`, `vercel` |
| 2024-11-16 | ["endpoint returned error" before ever making the request](2024-11-16-endpoint-error-before-request-models-cache-issue.md) | `billing`, `redis`, `routing`, `supabase`, `vercel` |
| 2024-11-24 | [Hyperbolic filtered all assistant messages at request transform](2024-11-24-hyperbolic-filtered-all-assistant-messages-at-request-transform.md) | `billing` |
| 2024-11-26 | [Byok Leak Channel](2024-11-26-byok-leak-channel.md) | `auth`, `billing`, `clickhouse`, `email`, `monitoring`, `redis` |
| 2024-11-30 | [Multimodal model on hyperbolic broken without image input on hyperbolic](2024-11-30-multimodal-model-on-hyperbolic-broken-without-image-input-on-hyperbolic.md) | `auth`, `routing` |
| 2024-12-04 | [Sev 1 Ticket With Clickhouse](2024-12-04-sev-1-ticket-with-clickhouse.md) | `billing`, `clickhouse`, `email`, `supabase` |
| 2024-12-07 | [Manual Deranking Never Worked For Variant Endpoint](2024-12-07-manual-deranking-never-worked-for-variant-endpoint.md) | `docs`, `infra`, `routing`, `supabase` |
| 2024-12-15 | [Grok 2 1212 And Grok 2 Vision 1212 Did Not Work On The Models Page](2024-12-15-grok-2-1212-and-grok-2-vision-1212-did-not-work-on-the-models-page.md) | `models` |
| 2024-12-17 | [O1 Models Broken Empty Parameters 9 Hours](2024-12-17-o1-models-broken-empty-parameters-9-hours.md) | `monitoring` |
| 2024-12-24 | [Transaction Creation Interrupted 10Min](2024-12-24-transaction-creation-interrupted-10min.md) | `billing`, `infra`, `monitoring`, `redis`, `routing`, `vercel` |
| 2025-02-04 | [Clickhouse Data Insertion Stopped For 25 Minutes](2025-02-04-clickhouse-data-insertion-stopped-for-25-minutes.md) | `clickhouse`, `monitoring` |
| 2025-02-06 | [Sev1 All Services Down Env Var Missing Cloudflare Vercel](2025-02-06-sev1-all-services-down-env-var-missing-cloudflare-vercel.md) | `auth`, `cloudflare`, `infra`, `monitoring`, `vercel` |
| 2025-02-20 | [Infra Fixes Feb 19 Post Mortem](2025-02-20-infra-fixes-feb-19-post-mortem.md) | `auth`, `infra`, `monitoring`, `redis`, `routing` |
| 2025-03-04 | [Post Mortems For Byok Partial Outage](2025-03-04-post-mortems-for-byok-partial-outage.md) | `auth`, `billing`, `cloudflare`, `monitoring`, `redis` |
| 2025-03-07 | [Bedrock Tools Not Being Parsed Properly](2025-03-07-bedrock-tools-not-being-parsed-properly.md) | `models` |
| 2025-03-20 | [Plugin refactor postmortem](2025-03-20-plugin-refactor-postmortem.md) | `billing`, `clickhouse`, `monitoring`, `plugins` |
| 2025-03-31 | [Autotopup Payments Failed To Credit 176 Users](2025-03-31-autotopup-payments-failed-to-credit-176-users.md) | `billing`, `monitoring` |
| 2025-04-09 | [Moving Sse Merge Out Of Adapter Post Mortem Bug Discussion Here](2025-04-09-moving-sse-merge-out-of-adapter-post-mortem-bug-discussion-here.md) | `models` |
| 2025-04-11 | [Wip Post Mortem Gemini Token Undercounting And Xai Miscounting](2025-04-11-wip-post-mortem-gemini-token-undercounting-and-xai-miscounting.md) | `models`, `monitoring` |
| 2025-04-30 | [Perplexity And Mancer Upstream Cost Undercounting](2025-04-30-perplexity-and-mancer-upstream-cost-undercounting.md) | `models`, `supabase` |
| 2025-05-06 | [Historical Incident Tracking Notes](2025-05-06-historical-incident-tracking-notes.md) | `general` |
| 2025-05-09 | [[5/9/2025] postrgres transaction insertion queue outage](2025-05-09-5-9-2025-postrgres-transaction-insertion-queue-outage.md) | `billing`, `infra`, `monitoring`, `pubsub`, `routing`, `supabase` |
| 2025-05-09 | [Generation Queue Outage Impact Summary](2025-05-09-generation-queue-outage-impact-summary.md) | `auth`, `billing`, `routing`, `supabase` |
| 2025-06-07 | [[sev 1] queue workers unable to spin up](2025-06-07-sev-1-queue-workers-unable-to-spin-up.md) | `auth`, `billing`, `docs`, `infra`, `monitoring`, `pubsub`, `secrets` |
| 2025-06-12 | [Sev 2 — byok “cookie” logic left fallback endpoint active in the api for o1 / o3](2025-06-12-sev-2-byok-cookie-logic-left-fallback-endpoint-active-in-the-api-for-o1-o3-o3.md) | `auth`, `billing`, `monitoring`, `routing` |
| 2025-07-11 | [Sev 2 Image Token Double Counting In Openrouter Billing](2025-07-11-sev-2-image-token-double-counting-in-openrouter-billing.md) | `billing`, `email`, `monitoring`, `routing`, `supabase` |
| 2025-07-16 | [Undefined environment variable outage](2025-07-16-undefined-environment-variable-outage.md) | `clickhouse`, `cloudflare`, `infra`, `monitoring`, `plugins`, `pubsub`, `redis`, `routing`, `supabase`, `vercel` |
| 2025-07-29 | [Google ai studio down from ~ july 28 16:40 to 17:35 pst](2025-07-29-google-ai-studio-down-from-july-28-16-40-to-17-35-pst.md) | `auth`, `models`, `monitoring`, `routing` |
| 2025-08-01 | [Api key limit enforcement delayed](2025-08-01-api-key-limit-enforcement-delayed.md) | `auth`, `billing`, `email`, `redis`, `routing`, `supabase` |
| 2025-08-29 | [Supabase Transactions Table Locked Clickpipe](2025-08-29-supabase-transactions-table-locked-clickpipe.md) | `billing`, `clickhouse`, `monitoring`, `supabase` |
| 2025-09-03 | [Supabase Ssl Handshake Failures Bgp Route Leak](2025-09-03-supabase-ssl-handshake-failures-bgp-route-leak.md) | `auth`, `cloudflare`, `infra`, `monitoring`, `routing`, `supabase` |
| 2025-09-04 | [Aws Bedrock Key Leak Signing Issue](2025-09-04-aws-bedrock-key-leak-signing-issue.md) | `auth`, `email`, `models`, `monitoring`, `secrets` |
| 2025-10-23 | [500S Instead Of 401S For 15 Minutes](2025-10-23-500s-instead-of-401s-for-15-minutes.md) | `redis`, `supabase` |
| 2025-11-05 | [Database Supabase Outage](2025-11-05-database-supabase-outage.md) | `auth`, `billing`, `docs`, `supabase` |
| 2025-11-06 | [Customer Io Email Domain Migration Broken Links](2025-11-06-customer-io-email-domain-migration-broken-links.md) | `docs`, `email` |
| 2025-11-12 | [Responses Api Broken China Singapore Proxy Handler](2025-11-12-responses-api-broken-china-singapore-proxy-handler.md) | `routing`, `sdk` |
| 2025-11-16 | [Postmortem: byok 2025-11-15](2025-11-16-byok-outage-48800-requests-345-users.md) | `auth`, `billing`, `cfw-api`, `cloudflare`, `infra`, `models`, `monitoring`, `redis`, `routing`, `vercel` |
| 2025-11-20 | [Datadog logging outage after syncpack migration](2025-11-20-datadog-logging-outage-syncpack-migration.md) | `cfw-api`, `monitoring` |
| 2025-11-24 | [Supabase 30Min Outage Unrelated To Openrouter](2025-11-24-supabase-30min-outage-unrelated-to-openrouter.md) | `supabase` |
| 2025-11-25 | [Docs incident](2025-11-25-docs-refactor-150-broken-links.md) | `docs`, `monitoring`, `redis`, `routing`, `vercel` |
| 2025-12-05 | [Xai negative usage incident post-mortem](2025-12-05-xai-negative-usage-incident-post-mortem.md) | `auth`, `billing`, `models`, `monitoring`, `redis`, `routing` |
| 2025-12-12 | [5min clickhouse read degraded / write outage](2025-12-12-5min-clickhouse-read-degraded-write-outage.md) | `clickhouse`, `redis`, `vercel` |
| 2025-12-18 | [Vercel Deploy Shape Change Without Cfw Api Deploy](2025-12-18-vercel-deploy-shape-change-without-cfw-api-deploy.md) | `cfw-api`, `routing`, `vercel` |
| 2026-01-12 | [Postmortem: rogue agent 2026-01-11](2026-01-12-postmortem-of-the-sunday-rogue-agent-also-in-notion.md) | `auth`, `clickhouse`, `docs`, `models`, `monitoring`, `pubsub`, `secrets` |
| 2026-01-12 | [Post mortem: strict:true bug](2026-01-12-strict-true-gpt-5x-model-failures.md) | `auth`, `docs`, `models`, `monitoring`, `routing`, `sdk` |
| 2026-01-14 | [Postmortem: responses api sdk breakage 2026-01-12](2026-01-14-responses-api-sdk-breaking-change.md) | `docs`, `sdk` |
| 2026-01-21 | [Postmortem: incorrect model deprecation email ingestion for haiku 4.5](2026-01-21-postmortem-for-incorrect-model-deprecation-ui-update-for-haiku-4-5.md) | `email`, `models`, `monitoring`, `routing`, `secrets`, `supabase` |
| 2026-01-23 | [Postmortem: infisical sync misconfiguration](2026-01-23-postmortem-for-infiscal-secret-sync.md) | `docs`, `infra`, `monitoring`, `secrets`, `vercel` |
| 2026-01-24 | [Postmortem For Supabase Disaster No 698251](2026-01-24-postmortem-for-supabase-disaster-no-698251.md) | `billing`, `cfw-api`, `docs`, `monitoring`, `spanner`, `supabase`, `vercel` |
| 2026-02-14 | [Friday 13 x supabase 2026-02-13](2026-02-14-friday-13-x-supabase-2026-02-13.md) | `auth`, `billing`, `spanner`, `supabase` |
| 2026-02-17 | [Hyperdrive Outage Preliminary Summary](2026-02-17-hyperdrive-outage-preliminary-summary.md) | `auth`, `billing`, `cfw-api`, `cloudflare`, `monitoring`, `pubsub`, `redis`, `routing`, `supabase` |
| 2026-02-19 | [Post mortem hyperdrive outage part deux 2026-02-19](2026-02-19-post-mortem-hyperdrive-outage-part-deux-2026-02-19.md) | `auth`, `cloudflare`, `docs`, `redis`, `routing`, `supabase` |
| 2026-02-23 | [Clerk Auth Outage Query Plan Flip](2026-02-23-clerk-auth-outage-query-plan-flip.md) | `auth`, `supabase` |
| 2026-03-07 | [Vercel Outage Misattributed To Zod Build Cache](2026-03-07-vercel-outage-misattributed-to-zod-build-cache.md) | `redis`, `vercel` |
| 2026-03-11 | [Auto top-ups not reliably firing between 2am and 3:44am utc](2026-03-11-auto-top-ups-not-reliably-firing-between-2am-and-3-44am-utc.md) | `billing`, `monitoring` |
| 2026-03-11 | [Dataflow Generations Stuck 40Min Bad Deploy](2026-03-11-dataflow-generations-stuck-40min-bad-deploy.md) | `billing`, `dataflow`, `infra`, `pubsub`, `spanner`, `supabase`, `vercel` |
| 2026-03-11 | [Til We Have The Routing Package Filter Steps As Well As A Parallel List Nested](2026-03-11-til-we-have-the-routing-package-filter-steps-as-well-as-a-parallel-list-nested.md) | `routing` |
| 2026-03-13 | [Auto top-ups firing _too_ reliably between 2026-03-11 03:38 utc and 2026-03-13 0](2026-03-13-auto-top-ups-firing-too-reliably-between-2026-03-11-03-38-utc-and-2026-03-13.md) | `billing`, `supabase`, `vercel` |
| 2026-04-17 | [Web deployment blockage — 2026-04-02](2026-04-17-web-deployment-blockage-2026-04-02.md) | `auth`, `cloudflare`, `docs`, `monitoring`, `sdk`, `vercel` |
| 2026-04-17 | [Web Search Plugin Down Alerts Api](2026-04-17-web-search-plugin-down-alerts-api.md) | `monitoring`, `plugins` |
| 2026-04-21 | [04-14 usage record insert/read outage — post-mortem](2026-04-21-04-14-usage-record-insert-read-outage-post-mortem.md) | `billing`, `dataflow`, `docs`, `models`, `monitoring`, `spanner`, `supabase` |
| 2026-06-23 | [Fusion Judge Starvation: isPromiseLike RpcPromise Bug](2026-06-23-fusion-judge-starvation-ispromiselike.md) | `cloudflare`, `monitoring`, `plugins`, `routing` |
| 2026-07-17 | [ClickHouse Generations Poison-Batch Backlog](2026-07-17-clickhouse-generations-poison-batch.md) | `clickhouse`, `monitoring`, `plugins`, `pubsub`, `routing` |
| 2026-07-30 | [Cache-hit generations wrote NULL endpoint_id (sentinel fix)](2026-07-30-cache-hit-null-endpoint-sentinel.md) | `cfw-api`, `clickhouse`, `monitoring`, `routing` |
| 2026-09-01 | [Post-mortem: Hyperdrive pool saturation broke the web app 2026-08-28](2026-09-01-hyperdrive-pool-saturation-kv-all-postgres-fallback-broke-web-app-2026-08-28.md) | `billing`, `cfw-api`, `cloudflare`, `infra`, `monitoring`, `redis`, `routing`, `supabase` |
| 2026-09-22 | [NVIDIA SIN Latency Spike (p90 > 1000 ms)](2026-09-22-nvidia-sin-latency-spike-private-endpoints.md) | `cloudflare`, `infra`, `monitoring`, `postgres`, `routing` |

## Subsystem Legend

| Subsystem | Description |
|-----------|-------------|
| `cfw-api` | Cloudflare Worker API gateway |
| `billing` | Payments, transactions, credits, usage records, Stripe |
| `auth` | Authentication, Clerk, OAuth, BYOK, API keys |
| `clickhouse` | ClickHouse analytics database |
| `supabase` | PostgreSQL database (Supabase) |
| `spanner` | Google Cloud Spanner |
| `pubsub` | Google Cloud Pub/Sub message queues |
| `dataflow` | Generation queue and data pipeline |
| `vercel` | Vercel deployments, Next.js frontend |
| `cloudflare` | Cloudflare infrastructure |
| `infra` | Infrastructure, env vars, Terraform, Docker |
| `routing` | Model routing, endpoint selection, provider fallback |
| `models` | Model configuration, provider adapters |
| `sdk` | SDKs, Responses API, OpenAPI schemas |
| `monitoring` | Datadog, alerts, logging |
| `redis` | Redis cache, Hyperdrive |
| `secrets` | Secret management, Infisical, credential leaks |
| `email` | Email notifications, Customer.io |
| `docs` | Documentation, broken links |
| `plugins` | Server tools, web search plugin |
