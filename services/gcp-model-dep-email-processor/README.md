# GCP Model Deprecation Email Processor

A Cloud Run Job that processes model deprecation emails from Gmail and updates endpoint deprecation dates in the database using a two-step LLM pipeline.

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────┐
│ Cloud Scheduler │────▶│  Cloud Run Job                           │
│ (twice daily    │     │  gcp-model-dep-email-processor           │
│  00:00, 12:00)  │     │                                          │
└─────────────────┘     │                                          │
                        │  1. Load endpoint cache at startup       │
                        │  2. Fetch unread Gmail messages          │
                        │  3. Extract model refs (LLM Step 1)      │
                        │  4. Match to endpoints (LLM Step 2)      │
                        │  5. Update DB (if confidence >= 0.85)    │
                        │  6. Exit                                 │
                        └──────────────────────────────────────────┘
```

## How It Works

### Step 1: Extraction
Extracts structured data from email content:
- Provider identification with confidence scoring
- Model references with version/variant hints
- Deprecation date extraction

### Step 2: Matching
Matches extracted model references to endpoint permaslugs:
- Fetches candidate endpoints from cache
- Uses LLM to find best matches with confidence scores (0-1)
- Only auto-updates endpoints with confidence >= 0.85
- Logs all match attempts with reasoning for audit

## Deployment

### Build and Push Docker Image

Cloud Run requires `linux/amd64` images. On Apple Silicon Macs:

```bash
cd services/gcp-model-dep-email-processor

# Build for GCP (required on ARM Macs)
docker build --platform linux/amd64 -t us-docker.pkg.dev/openrouter-core/openrouter/gcp-model-dep-email-processor:latest -f Dockerfile ../..

# Push to Artifact Registry
docker push us-docker.pkg.dev/openrouter-core/openrouter/gcp-model-dep-email-processor:latest
```

### Deploy Infrastructure

```bash
cd services/gcp-model-dep-email-processor/infra

bun run terraform-or init    # First time only
bun run terraform-or plan    # Preview changes
bun run terraform-or apply   # Deploy
```

### Manual Job Execution

```bash
# Run the job manually
gcloud run jobs execute gcp-model-dep-email-processor --region us-east4

# View logs
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=gcp-model-dep-email-processor" --limit 50
```

## Secrets

Required secrets in GCP Secret Manager (synced from Infisical):

| Secret ID | Description |
|-----------|-------------|
| `GCP_MODEL_DEP_EMAIL_GOOGLE_APPLICATION_CREDENTIALS_JSON` | Gmail API service account JSON |
| `GCP_MODEL_DEP_EMAIL_OPENROUTER_API_KEY` | OpenRouter API key for LLM |
| `GCP_MODEL_DEP_EMAIL_GMAIL_IMPERSONATION_EMAIL` | Email to impersonate via domain-wide delegation |

## Local Development

### Environment Setup

Copy `.env.example` and fill in values:

```bash
cd services/gcp-model-dep-email-processor
cp .env.example .env
# Edit .env with your values
```

### Running Locally

```bash
bun run dev
```

### Running Tests

```bash
bun run test
```

### E2E Test

Requires real credentials (see `.env.example`). Mocks Gmail but calls real LLM and Postgres:

```bash
bun run test src/index.e2e.test.ts
```

## File Structure

```
.
├── infra/
│   ├── config.tf         # Terraform backend/provider
│   ├── cloud-run.tf      # Cloud Run Job + secrets
│   └── scheduler.tf      # Cloud Scheduler trigger
├── src/
│   ├── index.ts          # Entry point, Gmail helpers
│   ├── types.ts          # Shared types
│   ├── extraction.ts     # LLM extraction logic
│   ├── matching.ts       # LLM matching logic
│   ├── endpoint-cache.ts # Endpoint cache
│   └── *.test.ts         # Tests
├── Dockerfile
└── package.json
```
