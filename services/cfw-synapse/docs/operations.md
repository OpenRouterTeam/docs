# Operations

## Resources

| Resource | Name / binding |
|---|---|
| Worker | `synapse` |
| Public ingress | `https://synapse.openrouter.ai` |
| GitHub webhook | `https://synapse.openrouter.ai/webhooks/github` |
| Queue | `synapse-ingest` via `REVIEW_QUEUE` |
| DLQ | `synapse-dlq` |
| Cron | `*/15 * * * *` |
| Review Postgres | shared fleet via Hyperdrive; `synapse_*` tables |
| Corpus Postgres | dedicated, uncached `CORPUS_DB` Hyperdrive; never platform Postgres |
| Encrypted source blobs | private `CORPUS_RAW_BUCKET`, per-container DEKs |
| Corpus queues | `CORPUS_INGEST_QUEUE`, `CORPUS_INDEX_QUEUE`, `CORPUS_QUERY_QUEUE` |
| Independent privacy journal | `CORPUS_PRIVACY` / `CorpusPrivacyJournal` SQLite Durable Object |
| KV | `KV_LIVE_CONFIG` for DB replica routing |

Deploy caveat: the release train ships steady-state updates via
`wrangler versions upload` + `versions deploy`, which reconciles code and
(via the workflow's `triggers deploy` step) routes/cron — but NOT queue
consumer settings. The first deployment is a bare `wrangler deploy`
(net-new promotion), which applies everything. If `[[queues.consumers]]`
settings change later (batch size, retries, DLQ), run a one-off
`wrangler deploy` (e.g. the hotfix job) so the consumer config lands.

Containers require the Containers feature on the account and a Docker
build at deploy time (`[[containers]]` in wrangler.toml builds
`./containers/synapse-workspace`). The review workspace degrades to the
API fallback toolset per round if a container cannot start — the deploy
does not fail closed, watch `workspace.prime_rejected` after enabling.

Secrets are synced from Infisical `/services/cfw-synapse` as encrypted Worker bindings. Manual GitHub review, automatic GitHub activity, review memory, corpus ingestion and Slack replies are distinct admission paths. Four Statsig worker gates default off: `synapse-webhook-reviews`, `synapse-review-memory`, `synapse-corpus-ingestion`, and `synapse-slack-replies`. Missing bindings, policy, identity, journal state or recovery verification never imply approval.

## Local development

```bash
bun run db:start
bun run db:migrate
cd services/cfw-synapse
bun run cf-typegen
bun run typecheck
bun run test
bun run dev
curl -H "Authorization: Bearer $SYNAPSE_SMOKE_API_TOKEN" http://localhost:8812/health
```

`bun run dev` loads Infisical `/services/cfw-synapse` into memory and runs
Wrangler with shared local state; nothing is written to `.dev.vars`. The Tilt
resource is manual-triggered and depends on `postgres-seed`.

The `[ai]` binding runs against the remote Workers AI service, so a local
Wrangler needs Cloudflare account access. Use `wrangler login`: the stored
OAuth token under your home directory reaches Wrangler. `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` from your shell do not, because every variable in
Wrangler's environment also becomes a Worker binding in local development, and
an account token must not be readable by Worker code.

## Secrets

Infisical path: `/services/cfw-synapse`.

- `OPENROUTER_API_KEY`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PKCS#8)
- `GITHUB_APP_INSTALLATION_ID` (optional only when the App has exactly one installation; required otherwise)
- `GITHUB_WEBHOOK_SECRET`
- `API_TOKENS` (service-issued bearer capabilities for `/api/*`, encoded as
  `token[:userId]` CSV; a nonempty `userId` grants global operator authority,
  not merely a log label — see below)
- `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` for a reviewed Slack app installation.
- `SYNAPSE_CORPUS_KEK_JSON`: `{ "activeVersion": "<reviewed version>", "keys": { "<version>": "<base64 AES-256 wrapping key>" } }`. Keep wrapping keys and their backup/destruction policy outside the corpus database. Do not print them in logs or operator artifacts.

The GitHub App is separate from other OpenRouter apps. Until its secrets are
installed, `/webhooks/github` fails closed with 503.

### Operator capability and audit identity

`API_TOKENS` is trusted service configuration, not a caller identity assertion. `initCreds` captures the bearer-to-actor mapping in the private credential vault; `authorizeApiRequest` verifies the bearer, and the `/api/*` middleware supplies its configured `userId`. Headers, query parameters and JSON fields such as `actor`, `approvedBy`, `verifiedBy` or `requestedBy` cannot choose that identity. The actor is an audit label, not a verified Slack/Clerk principal or per-corpus membership.

Every actor-bearing token grants **global operator authority** over all corpora served by this Worker, including policy approval, recovery, redaction, inventory and readiness. Memory operator routes use the same capability; memory mutations also enforce `REVIEW_REPOS`. There is no per-corpus operator RBAC. Adding `:userId` to a manual-review token is a privilege grant: before enabling private sources, audit token holders and restrict these tokens to trusted service operators, never ordinary Slack users, corpus members or untrusted automation. Remove or rotate a bearer to revoke it.

Bare tokens remain valid for bearer-only routes such as manual review, but receive `403` from corpus and memory operator routes before configuration or database reads. `/health` retains its separate public/authenticated contract. The Worker may accept multiple operator tokens; `corpusOperatorFetch` requires one in the CLI's local environment only to choose an unambiguous outbound bearer. It sends no actor suffix, so the Worker's mapping remains authoritative. Verification lives in `src/creds.ts`, `src/server/http.ts` and `src/server/corpus/routes.ts`.

## Configuration

Runtime switches — Statsig worker gates in the `[WORKERS] OpenRouter`
project, checked via `src/flags.ts` (registry defaults: off):

- `synapse-webhook-reviews`: ALL automatic GitHub-event/cron-driven
  activity — webhook PR events opening rounds AND keep-fresh (push/label
  triggers, cron scan, queued messages). Off = events ack without acting;
  `POST /api/review` still works.
- `synapse-review-memory`: verbatim facts and pattern recall/extraction/confirmation require the gate, D1/Vectorize/AI bindings, and an approved exact repository-scope retention policy. Embedding repair stops when the gate is off; retention, explicit erasure and pending vector deletion continue.
- `synapse-corpus-ingestion`: new Slack evidence admission and indexing. Ordinary channel messages never become questions. Accepted paused work remains retryable; deletion and ACL reconciliation continue.
- `synapse-slack-replies`: mention/DM query execution and output. Replies go only to a verified one-to-one DM with the authenticated asking Slack user. No channel replies or external workflows are enabled by this gate.

Everything else is fixed in code (`src/config.ts`) and changes by PR +
deploy: the repo allowlist (`REVIEW_REPOS`), per-agent/round budgets and
step caps, diff/guideline byte caps, the default model, the roster
(`src/uses/review/agents.ts` `enabled` fields). The workspace (PR checkout +
isolate shell) is the core read surface for live rounds — see
`docs/workspace.md`. GitHub writes are always
armed — fixture (smoke/eval) rounds are hermetic structurally, not via a
dry-run flag.

The one non-secret env var is `SMOKE_ROUTES`: local-only fixture routes;
requires loopback access and an `API_TOKENS` bearer supplied to the runner
as `SYNAPSE_SMOKE_API_TOKEN`.

## Manually triggering one PR review

`POST /api/review` opens a round for one PR at its current head SHA. It
requires a configured `API_TOKENS` bearer and the repo in the checked-in
`REVIEW_REPOS` allowlist — but NOT the `synapse-webhook-reviews` gate, so it
is the way to run targeted reviews while the webhook trigger stays off:

```bash
curl -X POST https://synapse.openrouter.ai/api/review \
  -H "Authorization: Bearer $SYNAPSE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"owner": "OpenRouterTeam", "repo": "openrouter-web", "number": 12345}'
```

`202` returns the round key, head SHA, and the agent roster. Drafts are
reviewed (a manual trigger is explicit intent); closed/merged PRs get `409`.
Repeats share the webhook's one-round-per-head-SHA marker: a second trigger
for the same head SHA returns `200 {deduped: "head_sha"}` instead of fanning
duplicate agent messages into a live round. Pass `"force": true` to bypass the
dedupe and rescue a round the watchdog lost — this may re-run agents whose
running lease has lapsed (extra model spend), so reserve it for stuck rounds.
Rounds post real GitHub comments — there is no dry-run mode; results are
also visible in logs (`run.done`, `finalize.*`).

## Health and verification

`GET /health` returns reviewer schema readiness to anonymous callers. Authorized API-bearer callers additionally see `schemaError`, the live reviewer gates, and the effective agent roster. Readiness requires all four reviewer tables to be readable, a valid immediate use-scoped unique conflict arbiter, and no legacy two-column uniqueness that would block independent uses. It does not certify D1/Vectorize provisioning, GitHub permissions, or launch approval.

Before flipping `synapse-webhook-reviews` on:

1. `/health` is 200 with `schemaOk: true` and both gate values `false`.
2. Wrangler bundle succeeds and reports the expected queue/Hyperdrive/KV bindings.
3. Unit tests are green, and a local fixture round passes. Prerequisites:
   the dev server up on port 8812 (`bun run dev`) with `SMOKE_ROUTES=1` and
   an `API_TOKENS` bearer supplied through Infisical or
   `.env.development.local`; export that bearer to the runner
   as `SYNAPSE_SMOKE_API_TOKEN`. Then run `bun run smoke` (equivalently
   `bun smoke/run.ts`) — hermetic fixture PRs, no GitHub writes, but real
   model calls, so pin `SYNAPSE_SMOKE_MODEL` to a cheap slug.
4. Trigger one manual round on a disposable PR (`POST /api/review`) and
   verify it produces one consolidated comment and only a `COMMENT` review
   event — manual rounds post real comments; there is no dry-run mode.
5. Then flip the gate and verify a signed `synchronize` delivery opens a
   round (webhook deliveries in the App dashboard + `review.round_enqueued`).

## Failure recovery

- Queue failure: 5 retries with bounded backoff, then `synapse-dlq`.
- Stuck agent: watchdog marks the row failed and enqueues finalization.
- Crashed finalize: `last_round_seq > finalized_seq` is requeued after 2 min.
- Missing permissions/unknown GitHub state: fail closed and log.
- Retention currently prunes terminal rounds, resolved line comments, and
  delivery markers. `synapse_pr_state` intentionally remains until a future
  close/merge tombstone is stored; deleting by inactivity alone could erase
  the consolidated-comment identity for a still-open dormant PR.
- Rollback/cutover: turn off `synapse-webhook-reviews` in Statsig — it is
  the brake for ALL automatic activity (webhook review rounds AND keep-fresh,
  including its cron scan and already-queued messages) and takes effect
  without a deploy. Point the GitHub App webhook back to the legacy worker
  if needed. Fully disarming the manual trigger means rotating away the
  `API_TOKENS` bearers or rolling back the deploy.

## Corpus provisioning and admission

Corpus/Slack activation does not enable GitHub review or keep-fresh. Keep all production gates off until the operational approvals below are complete. Local proofs are not a live Slack pilot or a human privacy approval.

1. Provision a dedicated Postgres database with pgvector and an uncached Hyperdrive, private R2 bucket, three processing queues and retained dead-letter queues. Apply `packages/synapse-corpus/migrations` and the `CorpusPrivacyJournal` Durable Object migration. The corpus must not share the review/platform database. Preserve the journal independently of Postgres backups. Apply the raw-intent provenance and author-independent message-membership migrations before admission, with source and cleanup writers stopped and drained; do not mix legacy and current writers. Their guarded downgrades refuse to discard populated provenance or authorless membership, so a code rollback can leave the additive schema in place.
1. Generate deployment configuration with `bun run corpus:bindings --metadata <reviewed-resources.json> --output <generated-wrangler.toml>`. Supply real reviewed Hyperdrive/bucket/queue resources; the tool does not provision or deploy. Processing queue names must be `synapse-corpus-ingest`, `synapse-corpus-index`, and `synapse-corpus-query`. Dead-letter queues deliberately have no automatic consumer: do not attach a log-and-ACK consumer that destroys the redrive payload.
1. Set `SYNAPSE_CORPUS_DATABASE_URL` explicitly and use `bun run corpus:admin provision --config <operator.json>`. The file supplies the corpus, explicit Slack channel scope, trusted canonical-principal/Slack-user mappings and a named relevance scope. No email guessing or automatic identity enrollment occurs. Provisioning returns the default scope ID; use it in the reviewed policy. Relevance scopes never grant source ACLs. Idempotent reprovisioning preserves an existing connection's disabled state; it is not a reactivation command.
1. Run `approve-policy --config <approval.json>` only with named source/identity/retention/routing approval. The policy includes the approved answer model, ZDR requirement, raw retention days, purge deadline, backup/restore policy reference and default scope ID. Explicitly activate the decided `openai/text-embedding-3-small` / 1536-dimensional profile with `activate-embedding --config <decision.json>`; the file contains a reviewed `decisionRef`. Neither command enables a runtime gate.
1. Initialize the independent journal and verify recovery through the authenticated Worker: `journal-initialize --origin <worker-origin> --config <corpus-id.json>`, then `verify-recovery --origin <worker-origin> --config <recovery.json>`. These commands require exactly one `API_TOKENS` entry (`token:actor`) in the CLI environment to select its outbound identity, not a single operator on the Worker. The Worker derives the audit actor from its own secret mapping, never a JSON `verifiedBy` or the CLI's actor suffix. Recovery commands never manufacture a database-only journal.
1. Query `/api/corpus/readiness?teamId=<configured-team>` with an actor-bearing operator token. Policy, explicit source/default scope, production embedding activation and journal/checkpoint readiness must all be true. This is configuration readiness, not evidence of production resource isolation, completed security approval or model answer quality.
1. Generate the HTTP Events API Slack manifest with `manifest --origin <https-origin> --output <new-file>`, then install it in an approved developer sandbox/test workspace. Signed URL challenges work before corpus bindings exist and do not carry a workspace ID. Do not use the coworkers' workspace as a test environment. Approve a small pilot separately before expanding source/channel/user scope.

All non-local database mutations require `--confirm-target` matching the database host. Non-local recovery requests require it to match the Worker host. The operator HTTP capability accepts only loopback or `https://synapse.openrouter.ai`, never an arbitrary credential destination.

## Privacy, recovery and rollback

- Slack ACL freshness is bounded to 300 seconds after a successful complete refresh. Unchanged complete membership renews freshness; partial/failed refresh cannot renew old grants. Missed events therefore deny stale access rather than preserve it indefinitely.
- Verified Slack ingest and cleanup events are persisted in the metadata-only outbox before ACK; queue outages leave durable work for recovery. Recovery pages all enabled Slack connections and rotates bounded eligible pages before external attempts, so an unresolved reply cannot starve later work. Individual failures remain logged and reported without reposting uncertain sends.
- Unarchived channels remain sealed through complete re-import. Restore deliveries are idempotent within one connection/archive generation, including unchanged source content. Finalization reactivates only current source/revision-matched objects with unredacted evidence, retires absent objects and unseals under the same generation fence. A fresh final ACL preserves explicitly configured org visibility without promoting private or unresolved restricted membership. Same-policy reapproval clears recovery verification and requires explicit verification again.
- Fresh source archive/deny observations advance a monotonic archive generation, including multiple transitions in the same millisecond. Duplicate or stale observations preserve it. A live channel forced closed only for unarchive re-import preserves its existing generation; an actually archived or missing channel is a real denial, even when observed by an unarchive handler. Older restorations cannot clear that newer marker.
- New queued restore/reproject attempts require the ingestion gate, approved private-source policy and verified journal readiness before Slack calls. Denied work remains retryable; this does not disable erasure cleanup or cancel previously admitted work.
- Whole-thread history is bound to corpus, principal, channel and thread. A partially revoked assistant turn is dropped in full. Follow-up executions retain all contributing historical evidence IDs, not only newly retrieved citations. Output is reauthorized before sending.
- Successful synthesized answers require matching nonempty inline citation labels and structured evidence references. Missing or inconsistent markers fail synthesis rather than being repaired into an apparently grounded answer.
- Slack requests are refetched at the ledger's exact message timestamp. Long threads never substitute their oldest page for recent context; if bounded context is incomplete, the verified current request remains usable without that optional history.
- Transient query `database_failure` leaves a lease-fenced retryable execution with a 30-second delay; invalid requests or identities remain terminal. A completed reply blocked by journal, binding, identity-lookup or evidence-query uncertainty is not posted or irreversibly suppressed. After lease recovery, delivery repeats authorization without resynthesizing. Confirmed policy/replies/identity denial or loss of any evidence dependency still suppresses the saved output.
- Redaction is archived in the independent journal before Postgres acceptance. The canonical ledger immediately excludes affected evidence. Raw writes, vectors and saved results capture the corpus privacy revision before reading data and recheck it under the corpus fence before committing. No network call runs inside that transaction.
- Claimed embedding writes and cache copies require the exact input/profile/token and a live database-clock lease at persistence. Claims are acquired, used and released per bounded model batch; a stale worker cannot write or release its replacement's claim. External model calls remain at-least-once.
- Physical cleanup includes contaminated raw/normalized/search/embedding copies, root-derived previews, saved answers, descendants and known or uncertain bot replies. A missing Slack marker is not proof that an ambiguous send never committed. Such cleanup stays pending instead of falsely reporting completion.
- Partial redaction pages release their lease for the next invocation. Long external cleanup renews its live owner lease; an expired or reclaimed worker cannot settle work. External deletion remains at-least-once, and Slack `message_not_found` acknowledges an already-completed delete.
- Deploy `20260919010000_redaction_sweep_scheduling.sql` before the updated privacy sweeper. A bounded, locked candidate page rotates only `last_sweep_selected_at` before external work, so persistent failures cannot monopolize later ticks. Selection is not a processing lease and does not change request history, errors, states or erasure fences; execution ownership remains with `processRedaction`. Apply the ordinary index build before admission or in a maintenance window with sweepers stopped.
- Review-memory TTL sweeps share a bounded oldest-first budget across facts, patterns and approved scopes, and recheck the current policy in the erasure transaction. An explicit full-scope purge snapshots prior pending deletion identities even after their D1 facts vanish, preserves earlier purge ownership, and waits for those dependencies. It does not permanently ban or wait on later ingestion.
- Apply D1 migration `0005_memory_policy_revocation.sql` before deploying consent-aware memory code. `POST /api/memory/policy/revoke` accepts `{scope, policyRef}` under the same server-derived operator and `REVIEW_REPOS` boundary as approval. Revocation denies subsequent review-memory admission and cron re-vectorization; approval explicitly reactivates the scope. Previously retained facts and settled vectors are not implicitly purged. Already-dispatched external work may finish, with live upserts covered by durable deletion work; TTL, explicit purge and deletion retries remain active while revoked or globally disabled.
- Before serving canonical repository-memory operations, atomically apply D1 `0006_memory_repository_scopes.sql` after quiescing and draining old-scope writers through their 15-minute execution/lease bound. A policy-alias collision stops the migration without rewriting data; reconcile its grants and retention requirements explicitly before retrying. Do not run individual statements or serve the new scope contract after a failed cutover. Stable fact/pattern IDs and pending erasure dependencies survive; see the [memory scope cutover contract](../src/memory/README.md#scope--vectorize-namespace).
- Before generation-aware review-memory code, apply D1 `0007_memory_consent_generations.sql` after 0001–0006 with old writers stopped and drained. Reapproval creates a new processing generation: old fact/pattern writes, repair snapshots and vector reservations cannot resume under it, even with identical approval timestamps. Existing retained content is not implicitly erased; live old upserts receive durable cleanup fences. Preserve generation columns/triggers and use compatible code for rollback; see the [memory consent contract](../src/memory/README.md#operations).
- Review-memory facts are verbatim approved content, not secret/PII-scrubbed data. PR metadata, summaries, finding text and bounded decline quotes can contain sensitive values. Approve content handling, provider use and retention duration before enabling this feature; invoke source-prefix or scope purge when erasure is required. GitHub source deletion does not automatically purge memory, and successful bounded TTL sweeps are not an instantaneous expiry guarantee.
- Before restoring Postgres, stop new ingestion/replies, drain in-flight work, and run `begin-recovery` against the existing independent journal. Restore the database, then run `replay-recovery` until required cleanup is complete and `verify-recovery` succeeds for the same restore epoch. A restored `recovery_verified_at` alone cannot authorize serving. Never reset/recreate the journal to make a restored database appear current.
- Recovery verification durably prepares the exact checkpoint epoch before closing the independent journal. A failed final database write can be retried without reopening or resetting that journal; new records, pending cleanup, foreign epochs and a changed approval generation still block verification.
- Backup-media erasure and destruction of exported/wrapped key copies remain operator guarantees. Deleting current database rows or overwriting current R2 objects does not prove those guarantees.
- Journal and privacy-generation downgrades refuse every initialized checkpoint, canonical privacy decision and nonzero generation, including zero-initialized checkpoints and unsequenced decisions. Their measured transaction-held locks exclude concurrent readers and writers during reversal. Preserve populated schema for code rollback; never discard recovery state to make a downgrade succeed.
- Rollback by turning off ingestion/replies; keep the Worker, private database, journal, R2 and deletion credentials available for ACL/erasure/retention cleanup. Disabling replies stops new model execution and new Slack posts, but authenticated reconciliation of already-attempted sends continues. Query, privacy-fence, redaction-ledger and raw-encryption down migrations refuse incompatible retained data before teardown, including completed erasure fences, retired key history and scoped raw metadata. Only an offline, compatible unused schema may be reversed; never clear durable ledgers or keys to force a downgrade. Inspect retained DLQ messages and redrive their original metadata-only payload to the original processing queue after fixing the cause. Do not manufacture a new query event or blindly repost `sending`/`delivery_unknown` executions.
- Review `/health` verifies readable reviewer tables and usable run-ledger uniqueness, including missing/invalid/partial/expression/deferrable index rejection. Before GitHub activation, independently verify deployed lease migrations, D1/Vectorize resources and live GitHub authentication/permissions, then run a manual review on an approved disposable PR. A green schema response is not launch approval.

## Local corpus verification

Use an owned isolated database, never a shared developer or production database. The package `db:start` / `db:reset` scripts accept `SYNAPSE_CORPUS_LOCAL_CONTAINER` and `SYNAPSE_CORPUS_LOCAL_PORT`; `db:reset` refuses `SYNAPSE_CORPUS_DATABASE_URL`. For migrations, type generation, integration tests and smoke, provide the explicit local `SYNAPSE_CORPUS_DATABASE_URL`.

```bash
# From packages/synapse-corpus, with the explicit isolated database URL:
bun run db:migrate
bun run db:types
bun run typecheck
bun run test
bun run test:integration

# From services/cfw-synapse; run database suites and smoke sequentially:
bun run typecheck
bun run test
bun run test:corpus-integration
bun run test:integration
bun run smoke:corpus
```

`smoke:corpus` drives the actual signed webhook, outbox, normalization/indexing, query and reply consumers against real local Postgres. Slack/model HTTP and blob bindings are explicitly synthetic; it uses the existing local Cloudflare platform adapter and an explicit test journal. Separate workerd tests exercise real D1, R2 and SQLite Durable Object RPC. The smoke prints identifiers/counts/states, not bodies or credentials, and reports content-free immutable fixture metadata that its scoped teardown cannot delete. Reset only the owned fixture database after inspecting the proof. No local result certifies a live Slack installation or production enablement.
