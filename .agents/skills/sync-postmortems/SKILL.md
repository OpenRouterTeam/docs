---
name: sync-postmortems
description: "Pull the latest postmortems from #post-mortems Slack channel, hydrate content, and create a PR"
user-invocable: true
---

# Sync Postmortems

Fetch new postmortems from the `#post-mortems` Slack channel (`C05MYP9UPRU`), create properly formatted archive files in `.postmortems/`, hydrate any linked content, and open a PR.

## Trigger

Invoked manually or on a schedule to keep the postmortem archive up to date. Example: `@Devin sync postmortems` or `@Devin pull latest post-mortems`.

## Steps

### 1. Determine what already exists

List existing files in `.postmortems/` to identify the date of the most recent postmortem. Only fetch messages posted after that date.

```bash
ls .postmortems/*.md | sort | tail -5
```

### 2. Fetch new messages from #post-mortems

Use the Slack MCP to pull channel history from `#post-mortems` (channel ID: `C05MYP9UPRU`).

```python
slack_get_channel_history(channel_id="C05MYP9UPRU", limit=100)
```

Filter to messages posted after the last archived date. Each top-level message becomes one postmortem file.

### 3. Create postmortem files

For each new message, create a markdown file in `.postmortems/` with the naming convention:

```text
YYYY-MM-DD-kebab-case-summary-of-incident-and-affected-systems.md
```

Rules:
- Date comes from the Slack message timestamp
- The kebab-case summary should capture the bug and affected systems/footguns
- Filenames can be long; they serve as context for the `/risk` scoring workflow
- Write the Slack message content as the file body in plain markdown

### 4. Fetch thread replies

For each new postmortem message, check for thread replies:

```python
slack_get_thread_replies(channel_id="C05MYP9UPRU", thread_ts="<message_ts>")
```

Append meaningful thread replies to the file under a `## Thread Discussion` section. Skip bot noise and reactions-only messages.

### 5. Hydrate Notion links

Scan each new file for Notion page links (e.g. `https://www.notion.so/...`). For each unique Notion link:

1. Extract the page ID from the URL (last 32 hex characters)
2. Convert to UUID format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
3. Fetch the page content via Notion MCP. The `notion` MCP server exposes `fetch`, which takes the page URL (or UUID) as `id`:
   ```python
   notion.fetch(id="https://app.notion.com/p/<page-id>")
   ```
4. Clean the content:
   - Remove XML tags (`<empty-block/>`, `<mention-user>`, `<mention-date>`, etc.)
   - Strip S3 signed image URLs (`https://prod-files-secure.s3...`)
   - Remove `<details>` blocks
5. Insert the hydrated content inline, replacing the bare Notion link

If the Notion content is a duplicate of what's already in the Slack message, skip it.

### 6. Resolve Slack user IDs and channel IDs

Replace all Slack user mentions (`@UXXXXXXXXXX` or `<@UXXXXXXXXXX>`) with `@UXXXXXXXXXX (Display Name)` using:

1. The mapping file at `.github/github-slack-mapping.csv` (maps GitHub usernames to Slack IDs)
2. For any IDs not in the CSV, look them up via `slack_get_user_profile(user_id="<id>")`

Replace channel references (`<#CXXXXXXXXXX|>` or `#CXXXXXXXXXX`) with the channel name (e.g. `#bugs`). The `slack-remote` MCP server has no channel-info lookup: resolve an ID by searching for the incident keyword with `slack_search_channels` and matching the permalink's channel ID.

### 7. Strip long monitoring URLs

Remove URLs that add noise without context:
- Datadog URLs: `https://us\d+\.datadoghq\.com/\S{80,}`
- Infisical URLs: `https://app\.infisical\.com/\S{80,}`
- S3 signed image URLs: `https://prod-files-secure\.s3\.\S+`
- Any URL longer than 200 characters (likely dashboard/monitoring links)

Replace each with an empty string, then clean up any resulting double-blank-lines.

### 8. Update the README index

`.postmortems/README.md` serves as an index of all postmortems with affected subsystems. For each new file:

1. Read the file content
2. Detect affected subsystems by matching keywords against this list:
   - `cfw-api`, `billing`, `auth`, `clickhouse`, `postgres`, `spanner`, `pubsub`, `dataflow`, `vercel`, `cloudflare`, `infra`, `routing`, `models`, `sdk`, `monitoring`, `redis`, `secrets`, `email`, `docs`, `plugins`
   - Index tags must come from the README legend, which has no `postgres` or `cfw-frontend-api` row: tag Postgres incidents `supabase` and Hyperdrive incidents `redis`, and keep the incident's own subsystem list in the file body verbatim
3. Add a row to the index table in date order:
   ```markdown
   | YYYY-MM-DD | [Incident Title](filename.md) | `subsystem1`, `subsystem2` |
   ```

See the existing README.md for the subsystem detection patterns and legend.

### 9. Commit and create PR

```bash
git checkout -b devin/$(date +%s)-sync-postmortems
git add .postmortems/
git commit -m "docs: sync postmortems from #post-mortems through YYYY-MM-DD"
git push origin HEAD
```

Create a draft PR with a description listing the new postmortems added.

## Files touched

| File | Change |
|------|--------|
| `.postmortems/*.md` | New postmortem files |
| `.postmortems/README.md` | Updated index with new entries |

## Reference

- Slack channel: `#post-mortems` (`C05MYP9UPRU`)
- User ID mapping: `.github/github-slack-mapping.csv`
