---
name: benchmark-run-visibility
description: Use when asked to hide, unhide, or change visibility of benchmark runs, results, workflows, or leaderboard entries. Trigger for requests involving benchmark_results.hidden or benchmark leaderboard visibility.
allowed-tools: Bash
user-invocable: true
---

# Benchmark run visibility

Use the internal cfw-internal visibility endpoint to hide or unhide every
result row belonging to a completed Temporal benchmark workflow.

## Endpoint

```text
POST /api/v1/internal/benchmarks/workflow/{workflowId}/visibility
```

The contract is discoverable from:

```text
GET /api/v1/internal/benchmarks/openapi
```

Send JSON with `hidden` required and `apply` optional:

```json
{ "hidden": true, "apply": false }
```

- Omit `apply` or use `false` for a dry-run preview without writing:

  ```json
  { "applied": false, "preview": { "workflowId": "...", "requestedHidden": true, "matchingRows": [], "rowsToChange": [] } }
  ```

- Use `apply: true` only after reviewing the preview to commit the change:

  ```json
  { "applied": true, "data": { "workflowId": "...", "hidden": true, "matchedCount": 2, "updatedCount": 2, "rows": [] } }
  ```

  `updatedCount: 0` means the rows were already in the requested state — a
  no-op success, not an error. Verify success from this response instead of
  re-querying.
- A missing workflow returns `404`.
- The update covers every `benchmark_results` row for the workflow, including
  aggregate and per-epoch rows.
- `hidden: true` removes the run from public leaderboards; `hidden: false` is
  the exact inverse.

## Authentication

Use the cfw-internal worker admin bearer key:

```http
Authorization: Bearer $ADMIN_API_KEY
```

Never hardcode or print the key. For local/automation use, authenticate to Infisical non-interactively with the helper from [infisical-agent-auth](../infisical-agent-auth/SKILL.md), then read the key into an unexported shell variable that the `curl` commands below expand:

```bash
source scripts/infisical/agent-auth.sh && infisical_auth
infisical_get /services/cfw-internal-api ADMIN_API_KEY ADMIN_API_KEY
```

`infisical_run /services/cfw-internal-api <command>` injects the key into that one child process only, so a later standalone `curl` still sees an empty `$ADMIN_API_KEY`; use `infisical_get` when the requests are separate commands, as here. `ADMIN_API_KEY` is declared for `/services/cfw-internal-api` in `env.manifest.json`. Follow the Infisical guidance in `AGENTS.md`.

## Procedure

1. Confirm each Temporal `workflowId` with the requester. Never guess IDs.
2. Preview first, with `apply` omitted or `false`, and show the user every
   `rowsToChange`.
3. Apply only after explicit confirmation:

   ```bash
   curl -sS -X POST \
     -H "Authorization: Bearer $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     "https://openrouter.ai/api/v1/internal/benchmarks/workflow/$WORKFLOW_ID/visibility" \
     --data '{"hidden":true,"apply":true}'
   ```

4. Re-preview or query the rows afterward to verify the requested state.
5. For many workflow IDs, process a confirmed list in a loop; preview all
   first, then apply only the confirmed IDs. Do not batch guessed IDs.

The endpoint keys on the Temporal `workflow_id` text value, not a
`benchmark_results` UUID. If the requester supplies UUIDs, resolve each one
first:

```sql
SELECT workflow_id FROM benchmark_results WHERE id = '<result-uuid>';
```

Alternatively, use the existing per-row Mission Control toggle or
`setBenchmarkResultHidden` when the request is specifically about one result
UUID.

## Visibility delay

Leaderboard changes are not instant on `openrouter.ai`. The stats-search
leaderboard is cached for about one hour per Cloudflare colo and can remain
stale-while-revalidate for up to about two additional hours. There is no purge
endpoint; report this delay after applying a change.
