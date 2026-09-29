---
name: hex-project-collaboration
user-invocable: true
description: Add cells, inputs, and app tabs to an existing Hex project with the Hex CLI, run and verify them against the Clickhouse connection, and read or post to the project's Hex agent conversation. Use when asked to recreate an analysis in Hex, add a chart or tab to a Hex app, or coordinate with the Hex agent editing the same project.
---

# Hex project collaboration via the Hex CLI

Use the Hex CLI (`hex`), not the browser or raw API. The CLI can export a project as YAML, import edited YAML, create and run cells, and read or continue Hex agent threads.

For a brand-new dashboard, use `hex-dashboard-generation` instead: it creates the project under the requester's PAT and delegates the build to the Hex agent, because `project import` drops data connections on new SQL cells.

## Auth and identity

- Everything the token does is owned by the token's user, and there is no API path to share, archive, or delete a project afterwards. Use the requester's own personal access token (Hex: avatar menu > Account > API keys, starts with `hxtp_`), collected through the secret prompt. Do not use a shared workspace token for anything that creates or edits.
- Log in to a named profile per identity and pass `--profile <name>` on every command. `--update` is required if the profile exists. Bind the token as an env var reference, never print it:

  ```bash
  hex auth login <name> --update \
    --hostname https://hc.hex.tech --token-from-env HEX_<NAME>_PAT
  hex --profile <name> auth status           # shows the requester's email
  hex --profile <name> project list --json   # real API call; proves the token is bound
  ```

- `--token-from-env` stores only the variable name, so the profile reads `HEX_<NAME>_PAT` from the environment on every call. Use one variable per identity (the secret's own name); profiles that share a variable such as `HEX_API_TOKEN` all resolve to whichever token is exported. Without the variable, API calls fail with `Not authenticated. Expected the env variable ... to be set`, while `hex auth status` still succeeds from cached metadata.

- Read access does not imply write access. Check writability first with `hex --profile <name> cell create <uuid> -t markdown -l "probe" -s "probe" --json`, capture the returned id and remove it with `hex --profile <name> cell delete <id>` right away. If `cell create` returns `Forbidden`, the project is not shared with that user for editing. `cell update` or `cell run` returning `Forbidden` for an id taken from a YAML export means you passed the static `cellId`, which can also resolve to a project the identity cannot access; use the concrete `id` from `cell list`, not evidence about connection access.
- `hex --profile <name> project list` confirms which projects that identity can see.

## Discover the target

- `hex --profile <name> project list --json` to find the project UUID.
- `hex --profile <name> project export <uuid> -o export.yaml` gives the whole project: cells with `cellId`, `cellLabel`, SQL and code sources, INPUT configs, `appLayout`, and every app file (`App.js`, `components/*.js`, `components/*.interface.json`).
- `hex --profile <name> connection list` for the data connection id. The OpenRouter workspace has one Clickhouse connection (read-only user). Existing ClickHouse SQL runs unchanged in Hex SQL cells.

## Porting analysis SQL into Hex

- One SQL cell per CTE-heavy query, CTEs intact. Remove `FORMAT ...` clauses.
- Replace date literals with inputs: `toDateTime({{ window_start }})`. INPUT cells of `inputType: DATE`, `outputType: DATETIME` are added by appending to the exported YAML before `appLayout:` and importing:

  ```yaml
  - cellType: INPUT
    cellLabel: Restriction window start
    config:
      inputType: DATE
      name: window_start
      outputType: DATETIME
      options:
        enableTime: false
        showRelativeDates: false
        useDateRange: false
        enableTimezonePicker: false
      defaultValue:
        dateString: 2026-08-09
  ```

  Reuse existing inputs if the project already has a date range.
- Name output dataframes explicitly (`--output-dataframe by_rest_day`) so code cells can reference them.
- Emit a `series` column from SQL (`multiIf`) rather than mapping in Python so the app and notebook share one grouping.

## Append-only procedure (safe for someone else's project)

1. Export: `hex --profile <name> project export <uuid> -o before.yaml`.
2. Inputs: patch the YAML to add INPUT cells, then `hex --profile <name> project import patched.yaml`. If the import rejects new cells without `cellId`, generate UUIDv7 ids and retry.
3. Cells: `hex --profile <name> cell create <uuid> -t {markdown|sql|code} -l "<label>" -s "$(cat file)" [--data-connection-id <conn> --output-dataframe <name>] --json`. Cells append at the end of the notebook. Give every new cell a common label prefix so they are easy to find and remove.
4. Run: `hex --profile <name> cell run <api_cell_id> --with-output --timeout 4m --json` for SQL cells (returns columns, `totalRows`, first 50 rows). `--with-output` is SQL-only; for code cells use `--wait`. Dependencies run automatically. The CLI clamps `--timeout` to 4m40s.
5. App tab: re-export, patch `App.js` (imports, one tab function, the tab registry and any `TAB_VALUES` list) and add new component files as extra `- path: components/X.js` entries, then import. Add a matching `components/X.interface.json` for every new chart component, mirroring the parent chart's file, otherwise the Style panel is empty for that chart.
6. Verify: re-export and grep for the new labels, tab id, and component paths. `hex --profile <name> project run <uuid>` runs the draft. `hex --profile <name> cell list` is paginated (25 per page), so grep the export instead of the list.
7. Publishing is a separate UI action. Do not claim the app is published.

## Id and output gotchas

- `hex --profile <name> cell list` / `hex --profile <name> cell create` return API cell ids. YAML exports use a different `cellId`. `App.js` hooks (`useHexData`, `useHexInput`) need the YAML `cellId`, so resolve by label from a fresh export after creating cells.
- `--json` output is pretty-printed multi-line JSON. Do not parse it line by line, collect the whole object.
- `hex --profile <name> project import` replaces the whole project, including app source. Always import from an export taken immediately before the patch.

## Collaborating with the Hex agent (conversation tab)

- The conversation tab is an agent thread. Its id is the `threadId` query param in the project URL.
- `hex --profile <name> thread get <id>` (status, title, summary), `hex --profile <name> thread messages <id> --json` (full transcript in `content[]`, includes `[Agent thinking]`, `[agent]`, `[user]` entries).
- `hex --profile <name> thread continue <id> "<prompt>"` posts as the token's user and the agent acts on it. There is no passive comment. `hex --profile <name> thread list` needs Manager role.
- The Hex agent and a CLI import edit the same project, and idle check plus import is not atomic: the agent or a human can write between your export and the import, and the import erases those writes. Only import inside an exclusive window agreed with the owner (nobody editing, no pending agent prompt). Sequence: confirm the thread is idle, export, patch, import immediately, re-export and diff against the pre-import export so anything that arrived in between is visible. If exclusivity cannot be guaranteed, do not import: append cells with `hex --profile <name> cell create` (non-destructive) and hand the `App.js` wiring to the owner or the Hex agent via `hex --profile <name> thread continue`.
- The agent may edit files you added. Check the export before assuming your files are unchanged.

## Verification checklist before reporting

- SQL cells return rows through the connection (`hex --profile <name> cell run --with-output`).
- Aggregates reconcile with the source analysis (allow for new data landing since the source was produced).
- New tab, inputs, and components are present in a fresh export.
- Rendering of the app is unverified unless you have a browser login. Say so.
