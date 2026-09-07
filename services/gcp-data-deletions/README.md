# gcp-data-deletions

GDPR / DSR (Data Subject Request) user-deletion service. Runs on
Cloud Run behind `INGRESS_TRAFFIC_INTERNAL_ONLY` + Google OIDC auth.

## Architecture

> **Note:** this service has no R2 bucket bindings, so `del_r2`
> (`delete_r2_prompt_logs`) runs as a `NotImplementedTarget` here and settles
> as failed. New deletions are enqueued through the `cfw-internal`
> `UserDeletionWorkflow`; this service is legacy.


```
                        ┌─────────────┐
  POST /delete  ───────►│  Hono HTTP  │
  (OIDC-authed)         └──────┬──────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │  initiateUserDeletion (Kysely)             │
         │  1. INSERT user_deletions row              │
         │  2. INSERT one user_deletion_tasks row     │
         │     per target (settlement ledger)         │
         │  3. addJob() per target → graphile queue   │
         └─────────────────────┼─────────────────────┘
                               │
                      ┌────────▼────────┐
                      │ graphile-worker  │
                      │ (advisory locks, │
                      │  exp. backoff)   │
                      └────────┬────────┘
                               │
          ┌───────────┬────────┼────────┬───────────┬──────────────┐
          ▼           ▼        ▼        ▼           ▼              ▼
    scrub_spanner  scrub_pg  del_r2  del_gcs  del_clerk  del_customerio
          │           │        │        │           │              │
          └───────────┴────────┼────────┴───────────┴──────────────┘
                               │
                    settleAndRollup()
                    ├─ settle individual task
                    └─ rollup parent → completed / failed
```

### How deletions are initiated

Mission Control (Cloud Run) sends a `POST /delete` with an OIDC token:

1. Mission Control mints a Google OIDC token with `aud = "openrouter-internal-api"`
   (a custom audience, NOT the Cloud Run URL).
2. This service's `custom_audiences = ["openrouter-internal-api"]` in Terraform
   allows the non-URL audience.
3. The middleware validates `aud` and `email` against `GOOGLE_OIDC_AUDIENCE`
   and `GOOGLE_OIDC_ALLOWED_EMAILS` (Infisical).

Currently in `GOOGLE_OIDC_ALLOWED_EMAILS`:

- `mission-control-worker@openrouter-core.iam.gserviceaccount.com`

#### Adding a new caller

1. Grant the caller's SA `roles/iam.serviceAccountTokenCreator` on itself (or to the human/service impersonating it).
2. Add the SA email to `GOOGLE_OIDC_ALLOWED_EMAILS` in Infisical (`/services/gcp-data-deletions`).
3. The caller must mint tokens with `--audiences="openrouter-internal-api"`.

#### Testing manually

Option A — gcloud proxy (uses your user creds):

```bash
gcloud run services proxy gcp-data-deletions \
  --region=us-central1 --project=openrouter-core

# Another terminal:
curl -X POST http://localhost:8080/delete \
  -H "content-type: application/json" \
  -d '{"clerk_user_id": "user_...", ...}'
```

Option B — impersonate the mission-control SA:

```bash
SA=mission-control-worker@openrouter-core.iam.gserviceaccount.com && \
URL=$(gcloud run services describe gcp-data-deletions \
  --project=openrouter-core --region=us-central1 \
  --format='value(status.url)') && \
TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account=$SA \
  --audiences="openrouter-internal-api" \
  --include-email) && \
curl -X POST "$URL/delete" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"clerk_user_id": "user_...", ...}'
```

#### Request format

The `POST /delete` body:

```json
{
  "clerk_user_id": "user_...",
  "deadline_at": "2026-07-01T00:00:00Z",
  "requested_by": "admin@openrouter.ai",
  "notes": "GDPR request #123"
}
```

The service generates a `deleted_<uuid>` replacement user ID
server-side. `initiateUserDeletion` is a state machine that
dispatches on any existing active (pending/failed) row for the
same `clerk_user_id`:

| Existing row state | Action | Jobs enqueued |
|---|---|---|
| (none), `cancelled`, or `completed` | Fresh INSERT + task rows | all targets |
| `failed` | Reset failed tasks → `pending`, parent → `pending` | previously-failed targets only |
| `pending` | Return existing row | still-pending targets (for addJob recovery) |

A UNIQUE partial index (`user_deletions_active_by_clerk_user_id
WHERE status NOT IN ('cancelled', 'completed')`) enforces at most
one active deletion per user. On completion, `clerk_user_id` is
NULLed (GDPR erasure), so the row drops out of the dedup index
and a re-POST for the same user creates a fresh deletion.
Retries of pending/failed deletions reuse the original replacement
ID, preventing scattered `deleted_*` identities.

> **Note:** The `original_clerk_user_id` column was removed
> (PR #22916) because it retained PII indefinitely. The trigger
> now uses `clerk_user_id` and `replacement_user_id` arms.

### Task pipeline

Each graphile task runs through a flat pipeline of named functions
(`tasks.ts`):

1. **`parsePayload`** — validates the job payload via Zod
2. **`invokeHandler`** — calls the target's `execute()`, normalises
   the double-Result (outer `wrap`, inner `Result`) into an outcome
   or a throw-to-retry
3. **`applyOutcome`** — dispatches on the outcome status:
   - `retry` → throw (graphile retries with backoff)
   - `polling` → `reschedulePoll` (re-enqueue with delay)
   - `completed` / `failed` → `settleAndRollup`

### Two schemas

| Schema | Owned by | Purpose |
|---|---|---|
| `graphile_worker.*` | graphile-worker | Job queue: claims, locks, retries, backoff. Rows are transient — completed jobs are deleted. Uses a direct connection (not pgbouncer transaction mode) because graphile relies on `NOTIFY`. |
| `public.user_deletions` / `public.user_deletion_tasks` | This service (via Kysely) | Durable audit ledger. `user_deletion_tasks` records the terminal outcome of each target. `user_deletions` tracks the overall request status, rolled up from its tasks. Rows persist after completion for compliance/audit. |

graphile-worker manages the _execution lifecycle_ (which job runs
next, how many retries remain, advisory-lock-based concurrency).
The `user_deletion_tasks` table manages the _business outcome_
(did this target succeed or fail, and what was the error), and
drives the parent rollup that decides when the entire deletion is
done.

## Local development

```bash
bun run db:start                                       # local Postgres
bun run test:integration                               # integration tests
```
