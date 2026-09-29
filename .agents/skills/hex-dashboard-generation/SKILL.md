---
name: hex-dashboard-generation
user-invocable: true
description: Create a new Hex dashboard (project + app) from scratch under the requesting user's own Hex identity, delegating the app build to the Hex agent via the Hex CLI and verifying it with a fresh export and an independent ClickHouse query. Use when asked to "make a hex dashboard", "build a hex app for X", or "put this analysis in a new hex project". For editing an existing project, use hex-project-collaboration.
---

# Generate a new Hex dashboard via the Hex agent

Create an empty project with the Hex CLI, then hand the whole build to the Hex agent
with `hex thread create`. Prefer this over hand-authoring cells or app YAML for a new
project: `project import` drops the data connection from every SQL cell, so an imported
project needs a `cell update --data-connection-id` pass before it runs (see Gotchas),
while the agent builds, runs, and renders the app under the same identity in one pass.
The CLI's job is identity, project creation, prompting the agent, and verification.

## 1. Pick the identity first

Everything the token does is owned by the token's user. Projects created with the
shared `HEX_CLI_TOKEN` are owned by that token's user, are not visible to the requester,
cannot be shared or deleted via the API, and the requester's own agent threads on them
return `Resource not found`. So a dashboard "for John" must be created with John's PAT.

- Ask the requester for a Hex personal access token (Hex: avatar menu > Account > API
  keys, token starts with `hxtp_`, carries their own permissions). Collect it through
  the secret prompt so it never appears in chat.
- Log in to a named profile, never the default one, and bind the secret as an env var
  reference. `--update` is required if the profile already exists:

  ```bash
  hex auth login <name> --update \
    --hostname https://hc.hex.tech --token-from-env HEX_<NAME>_PAT
  hex --profile <name> project list --json   # real API call; must succeed as the requester
  ```

  `--token-from-env` stores only the variable name, so the profile reads `HEX_<NAME>_PAT`
  from the environment on every call. Give each identity its own variable (the secret's
  own name): profiles that share one variable such as `HEX_API_TOKEN` all resolve to
  whichever token is exported. Without the variable, API calls fail with
  `Not authenticated. Expected the env variable ... to be set`. `hex auth status` prints
  cached profile metadata and succeeds even then, so it is not proof of auth.

- Confirm the identity (`hex --profile <name> auth status` shows the email) before creating anything. A wrong identity here is the one mistake
  that cannot be undone from the CLI.

## 2. Create the empty project

```bash
hex --profile <name> project create "<Title>" --json   # title is positional, there is no --title
```

Capture `id` from the JSON. The project URL is
`https://hc.hex.tech/<workspace>/hex/<slug>/draft/logic`, printed in the response.

## 3. Delegate the build to the Hex agent

```bash
hex --profile <name> thread create --project <project_id> --json "<prompt>"
```

Capture the thread `id`. The prompt must give the agent everything it needs to build
without asking back, because a question from the agent stalls the thread until the next
`hex thread continue`:

- **Data**: connection name (`Clickhouse`, id from `hex connection list`), the exact
  table(s), the grain, and the metric definitions
  (`SUM(requests)`, `SUM(usage) AS spend_usd`, ...). Say that the daily activity mart
  must be aggregated with `GROUP BY`.
- **Inputs**: a date range input (default window, end-exclusive) that drives every query.
- **Charts**: one line per chart with type, axes, sort, and limit. Ask for sort by
  metric and full labels explicitly, otherwise bar charts come back alphabetical with
  truncated labels.
- **Validation**: ask it to run every cell, confirm each chart renders, and report the
  window totals it sees so you can reconcile them (step 5).
- **Scope**: tell it to remove any cells that do not belong, and to leave the project as
  an unpublished draft.
- **Report format**: ask for a short final message listing cells, charts, default window,
  and the totals.

Poll for completion rather than reading messages mid-run:

```bash
hex --profile <name> thread get <thread_id>          # wait for Status: IDLE
hex --profile <name> thread messages <thread_id> --json
```

Iterate with `hex --profile <name> thread continue <thread_id> "<follow-up>"`. Each
continue is a prompt the agent acts on, not a comment.

## 4. Verify the structure with a fresh export

```bash
CONN_ID=$(hex --profile <name> connection list --json | jq -er '.connections[] | select(.name == "Clickhouse") | .id') \
  && [ -n "$CONN_ID" ] \
  && hex --profile <name> project export <project_id> -o final.yaml \
  && SQL_CELLS=$(grep -c 'cellType: SQL' final.yaml) \
  && WIRED=$(grep -cF -- "dataConnectionId: $CONN_ID" final.yaml) \
  && [ "$SQL_CELLS" -gt 0 ] && [ "$SQL_CELLS" -eq "$WIRED" ] \
  && grep -E 'cellType|cellLabel' final.yaml \
  || echo "connection missing, or only $WIRED of $SQL_CELLS SQL cells reference it; stop here"
```

Expect `dataConnectionId` populated on each SQL cell and the connection listed under
`projectAssets.dataConnections` or `sharedAssets.dataConnections`. `hex cell list` does
not print `cellType`, so grep the export, not the list. A `project run` that errors
within a second means the connection is missing.

## 5. Reconcile the numbers independently

Run the same aggregate the agent reported directly against ClickHouse (the ClickHouse MCP
or the repo's analytics access). Build the query from the dashboard's own tables, filters,
grain, and metric expressions (take them from the SQL cells in the export), with the same
window and end-exclusive bounds. Example for a daily-activity dashboard:

```sql
SELECT round(sum(usage), 2) AS spend_usd, sum(requests) AS requests
FROM analytics.mart_generations_activity_daily
WHERE date >= toDateTime('<start>') AND date < toDateTime('<end>')
```

Report a match or the exact discrepancy. Do not report the agent's totals as verified
until this query agrees.

## 6. Report

- Link the draft URL. Say "draft, unpublished". Publishing is a UI action by the owner.
- State what the agent reported about rendering and that you did not view it in a
  browser unless you did.
- State the identity the project is owned by.

## Gotchas

- `hex project import` silently sets `dataConnectionId: null` on every SQL cell and
  empties `sharedAssets.dataConnections`. Reproduced with an unmodified export of a
  working project imported into a new project, and again with the ids patched back into
  that project's own export and re-imported. Rebind afterwards with
  `hex --profile <name> cell update <id> --data-connection-id <connection_id>` using the
  `id` from `hex cell list`; the cell then runs against the connection.
- Exports list a static `cellId`; `hex cell list` returns the concrete `id`. `cell update`
  and `cell run` with the static id return `Forbidden` when that id also exists in a
  project the identity cannot access (e.g. a copy built under another user). That is
  not evidence about connection or project permissions. Use the concrete `id`.
- `hex cell run <id> --with-output` can fail with "Static cell ID resolved to draft cells
  in multiple projects" when two projects share cell ids, even with the concrete `id`.
  Use `hex project run <id> --json` and poll `hex run status` instead. `project run` has
  no `--wait`.
- `hex cell run` takes only a cell id (no `--project`).
- There is no CLI or API path to delete, archive, or share a project. `DELETE` returns
  404, status PATCHes return 400, and a sharing PATCH returns 200 while changing nothing.
  Projects created under the wrong identity can only be cleaned up by that user in the UI.
- `hex thread create` under the requester's PAT works only on projects the requester owns
  or has been shared. On anyone else's project it returns `{"error":"Resource not found"}`.
