---
name: hex-project-collaboration
user-invocable: true
description: Add cells, inputs, and app tabs to an existing Hex project with the Hex CLI, run and verify them against the Clickhouse connection, and read or post to the project's Hex agent conversation. Use when asked to recreate an analysis in Hex, add a chart or tab to a Hex app, or coordinate with the Hex agent editing the same project.
---

# Hex project collaboration via the Hex CLI

Use the Hex CLI (`hex`), not the browser or raw API. The CLI can export a project as YAML, import edited YAML, create and run cells, and read or continue Hex agent threads.

## Auth and identity

- Everything the token does is owned by the token's user. Read access does not imply write access. Check writability first with `hex cell create <uuid> -t markdown -l "probe" -s "probe" --json`, capture the returned id and remove it with `hex cell delete <id>` right away. If writes return `Forbidden`, ask the project owner for a PAT.
- Headless login: `HEX_API_TOKEN="$TOKEN_ENV_VAR" hex auth login --token-from-env HEX_API_TOKEN` (or `hex auth login default --hostname https://app.hex.tech --token-from-env HEX_CLI_TOKEN`). Bind the token as an env var reference, never print it.
- `hex auth status` and `hex project list` confirm who you are and which projects you can see.

## Discover the target

- `hex project list --json` to find the project UUID.
- `hex project export <uuid> -o export.yaml` gives the whole project: cells with `cellId`, `cellLabel`, SQL and code sources, INPUT configs, `appLayout`, and every app file (`App.js`, `components/*.js`, `components/*.interface.json`).
- `hex connection list` for the data connection id. The OpenRouter workspace has one Clickhouse connection (read-only user). Existing ClickHouse SQL runs unchanged in Hex SQL cells.

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

1. Export: `hex project export <uuid> -o before.yaml`.
2. Inputs: patch the YAML to add INPUT cells, then `hex project import patched.yaml`. If the import rejects new cells without `cellId`, generate UUIDv7 ids and retry.
3. Cells: `hex cell create <uuid> -t {markdown|sql|code} -l "<label>" -s "$(cat file)" [--data-connection-id <conn> --output-dataframe <name>] --json`. Cells append at the end of the notebook. Give every new cell a common label prefix so they are easy to find and remove.
4. Run: `hex cell run <api_cell_id> --with-output --timeout 4m --json` for SQL cells (returns columns, `totalRows`, first 50 rows). `--with-output` is SQL-only; for code cells use `--wait`. Dependencies run automatically. The CLI clamps `--timeout` to 4m40s.
5. App tab: re-export, patch `App.js` (imports, one tab function, the tab registry and any `TAB_VALUES` list) and add new component files as extra `- path: components/X.js` entries, then import. Add a matching `components/X.interface.json` for every new chart component, mirroring the parent chart's file, otherwise the Style panel is empty for that chart.
6. Verify: re-export and grep for the new labels, tab id, and component paths. `hex project run <uuid>` runs the draft. `hex cell list` is paginated (25 per page), so grep the export instead of the list.
7. Publishing is a separate UI action. Do not claim the app is published.

## Id and output gotchas

- `hex cell list` / `hex cell create` return API cell ids. YAML exports use a different `cellId`. `App.js` hooks (`useHexData`, `useHexInput`) need the YAML `cellId`, so resolve by label from a fresh export after creating cells.
- `--json` output is pretty-printed multi-line JSON. Do not parse it line by line, collect the whole object.
- `hex project import` replaces the whole project, including app source. Always import from an export taken immediately before the patch.

## Collaborating with the Hex agent (conversation tab)

- The conversation tab is an agent thread. Its id is the `threadId` query param in the project URL.
- `hex thread get <id>` (status, title, summary), `hex thread messages <id> --json` (full transcript in `content[]`, includes `[Agent thinking]`, `[agent]`, `[user]` entries).
- `hex thread continue <id> "<prompt>"` posts as the token's user and the agent acts on it. There is no passive comment. `hex thread list` needs Manager role.
- The Hex agent and a CLI import edit the same project, and idle check plus import is not atomic: the agent or a human can write between your export and the import, and the import erases those writes. Only import inside an exclusive window agreed with the owner (nobody editing, no pending agent prompt). Sequence: confirm the thread is idle, export, patch, import immediately, re-export and diff against the pre-import export so anything that arrived in between is visible. If exclusivity cannot be guaranteed, do not import: append cells with `hex cell create` (non-destructive) and hand the `App.js` wiring to the owner or the Hex agent via `hex thread continue`.
- The agent may edit files you added. Check the export before assuming your files are unchanged.

## Verification checklist before reporting

- SQL cells return rows through the connection (`hex cell run --with-output`).
- Aggregates reconcile with the source analysis (allow for new data landing since the source was produced).
- New tab, inputs, and components are present in a fresh export.
- Rendering of the app is unverified unless you have a browser login. Say so.
