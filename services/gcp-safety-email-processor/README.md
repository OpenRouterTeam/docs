# GCP Safety Email Processor

A Cloud Run Job that ingests OpenAI Trust & Safety alerts from Gmail and stores
them as provider abuse reports through the public API.

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────┐
│ Cloud Scheduler │────▶│  Cloud Run Job                           │
│ (hourly)        │     │  gcp-safety-email-processor              │
└─────────────────┘     │                                          │
                        │  1. List matching Gmail messages         │
                        │  2. Parse + verify each alert's sender    │
                        │  3. Map the OpenAI category to abuse_type│
                        │  4. POST /providers/openai/abuse-reports │
                        │  5. Exit                                 │
                        └──────────────────────────────────────────┘
```

Submission is idempotent: the API deduplicates on
`(provider_name, report_ref)`, and `report_ref` is the OpenAI case reference, so
re-ingesting an alert the query still matches is a no-op.

### Processed label

When `GCP_SAFETY_EMAIL_GMAIL_PROCESSED_LABEL` is set, the job applies that Gmail label to a message once the API accepts its report and appends `-label:<name>` to the search query, so later runs only fetch alerts that have not been submitted yet. The label is created on first use (hidden from the mailbox UI) and is only applied after a successful submission, so failed or rate-limited messages stay unlabeled and are retried on the next run. The name must resolve to a user label. A name that matches a Gmail system label such as `INBOX` or `UNREAD` fails the run at startup instead of hiding unsubmitted mail from the query. A label write that fails after the API accepted the report is counted as `mark_failed` in the run summary, and the next run re-submits that message, which the API dedupes on the case reference. Labeling needs the `gmail.modify` scope, which the processor service account's domain-wide delegation grant in Google Workspace admin must include before the variable is set. Without the grant the delegated token request is rejected and every run errors. Unset the variable to fall back to read-only re-ingestion of the whole `newer_than` window. To re-submit an alert, remove the label from the message.

Terraform sets the variable from `gmail_processed_label` in `infra/config.tf` (default `openrouter-safety-processed`). Setting that default to an empty string turns labeling off and drops the `gmail.modify` scope request.

## Deployment

The image is built and pushed by the manual
`Deploy Email Processor (Manual)` workflow (select `gcp-safety-email-processor`
as the job), which then updates only the Cloud Run Job's image tag. Everything
else (env, secrets, schedule) is Terraform-managed:

```bash
cd services/gcp-safety-email-processor/infra

bun run terraform-or init    # First time only
bun run terraform-or plan    # Preview changes
bun run terraform-or apply   # Deploy
```

### Manual Job Execution

```bash
gcloud run jobs execute gcp-safety-email-processor --region us-central1

gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=gcp-safety-email-processor" --limit 50
```

## Secrets

Required secrets in GCP Secret Manager (synced from Infisical
`/services/gcp-safety-email-processor`). Terraform reads them as data sources,
so they must exist before the first apply. The sync prefixes the Infisical name
with `GCP_SAFETY_EMAIL_PROCESSOR_`, so the Infisical folder holds the
unprefixed names listed in `env.manifest.json` while Terraform reads the
prefixed secret IDs:

| Secret ID                                                        | Infisical name                        | Description                                                |
| ---------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `GCP_SAFETY_EMAIL_PROCESSOR_GOOGLE_APPLICATION_CREDENTIALS_JSON` | `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Gmail API service account JSON (domain-wide delegation)    |
| `GCP_SAFETY_EMAIL_PROCESSOR_GMAIL_IMPERSONATION_EMAIL`           | `GMAIL_IMPERSONATION_EMAIL`           | Mailbox to impersonate, i.e. where OpenAI's alerts land    |
| `GCP_SAFETY_EMAIL_PROCESSOR_OPENROUTER_API_KEY`                  | `OPENROUTER_API_KEY`                  | Internal-admin OpenRouter key authorized to submit reports |
| `GCP_SAFETY_EMAIL_PROCESSOR_DD_API_KEY`                          | `DD_API_KEY`                          | Datadog API key for OTLP metric export                     |

## Configuration

| Env var                                        | Default                                             | Purpose                              |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| `GCP_SAFETY_EMAIL_OPENROUTER_API_BASE_URL`     | set by Terraform to `https://openrouter.ai/api/v1`  | API the reports are submitted to     |
| `GCP_SAFETY_EMAIL_GMAIL_QUERY`                 | see `DEFAULT_QUERY` in `src/index.ts`               | Gmail search query                   |
| `GCP_SAFETY_EMAIL_GMAIL_MAX_MESSAGES`          | `500`                                               | Cap on messages processed per run     |
| `GCP_SAFETY_EMAIL_GMAIL_PROCESSED_LABEL`       | `openrouter-safety-processed` via `gmail_processed_label` in Terraform | Label marking submitted alerts (letters, digits, `_`, `-`, `/` only), see [Processed label](#processed-label) |

Widening `GCP_SAFETY_EMAIL_GMAIL_QUERY` (e.g. dropping `newer_than`) is how a
backfill of historical alerts is run.

## Local Development

```bash
bun run dev
bun run test
```

## File Structure

```
.
├── infra/
│   ├── config.tf         # Terraform backend/provider
│   ├── cloud-run.tf      # Cloud Run Job + secrets
│   └── scheduler.tf      # Hourly Cloud Scheduler trigger
├── src/
│   ├── index.ts          # Entry point, Gmail polling, submission loop
│   ├── parser.ts         # Sender verification + alert parsing
│   ├── category-mapping.ts
│   ├── submission-client.ts
│   ├── types.ts
│   └── *.test.ts
├── Dockerfile
└── package.json
```
