---
name: add-github-slack-mapping
description: "Add a new GitHub-to-Slack user mapping — append an entry to the CSV, commit, and open a PR. Use when onboarding a new engineer or when someone asks to be added to the GitHub-Slack mapping."
user-invocable: true
---

# Add GitHub-Slack Mapping

Add a new engineer's GitHub username to the GitHub-Slack mapping CSV so that Slack mentions resolve correctly when referencing their GitHub activity.

## Trigger

A new employee (or anyone on the team) asks via Slack or a Devin session, e.g.:

- `@Devin add my github-slack mapping, my GitHub username is robinnnnn`
- `@Devin add github slack mapping for robin`

When triggered from Slack, the requester's Slack user ID is available from the thread context — extract it directly so the user doesn't need to provide it.

## Arguments

- `$GITHUB_USERNAME`: The person's GitHub username (e.g. `Robinnnnn`). Required.
- `$SLACK_ID`: Their Slack member ID (format: `U` followed by 10 uppercase alphanumeric characters, e.g. `U0B5ETBFDPB`). When triggered from Slack, extract this from the thread context automatically. Only ask the user for it if you cannot determine it from context.

## Steps

### 1. Determine the Slack ID

If triggered from Slack, extract the requester's Slack user ID from the thread context. If triggered outside Slack and no Slack ID is provided, ask the requester for it.

When the request is for someone else (e.g. from a release-train thread where a name rendered unmentioned), look them up with the Slack MCP `slack_search_users` and confirm their email matches the git author email of one of their commits.

### 1b. Cover every name the workflows key on

The release workflow keys on the git author *name* of each commit (case-insensitive, `.github/workflows/release.yaml`), not the GitHub login. Add one row per variant that appears in `git log --format='%an'` plus the GitHub login (`gh api repos/OpenRouterTeam/openrouter-web/commits/<sha> --jq .author.login`), and the Slack display name and email prefix, matching existing entries.

For bot-authored commits (`devin-ai-integration[bot]` and friends) the release announcement credits the `Co-authored-by:` human name instead, so the person's Slack *display* name (e.g. `Abhinav Pola`) must be a row too — otherwise they render as unmentioned plain text even though their GitHub login is already mapped.

The lookup is exact after lowercasing, so diacritics are distinct keys: a git author name `Damjan Kužnar` does not cover the ASCII `Damjan Kuznar` that GitHub puts in squash-merge `Co-authored-by:` trailers. Add both spellings when a name has accented characters.

### 2. Validate the inputs

- `$GITHUB_USERNAME` must be non-empty.
- `$SLACK_ID` must match the pattern `U[A-Z0-9]{10}`. If it doesn't look right, ask the requester to confirm.
- If any required input is missing, ask the requester to provide it before proceeding.

### 3. Check for duplicates

Read `.github/github-slack-mapping.csv` and check every key you plan to add (GitHub login, git author names, Slack display name, email prefix) against the `github_name` column, case-insensitive. If a key already maps to the same Slack ID, skip that row. If it maps to a different Slack ID, stop and ask the requester: appending would silently redirect that name's mentions.

### 4. Add the new entries

Append one row per key from step 1b to `.github/github-slack-mapping.csv`:

```csv
$GITHUB_USERNAME,$SLACK_ID
$GIT_AUTHOR_NAME,$SLACK_ID
```

Ensure there is no trailing blank line at the end of the file.

### 5. Commit and push

```bash
git checkout -b devin/$(date +%s)-add-github-slack-mapping
git add .github/github-slack-mapping.csv
git commit -m "chore: add $GITHUB_USERNAME GitHub-Slack mapping"
git push -u origin HEAD
```

### 6. Open a PR

Create a PR to `main` with:

- **Title**: `chore: add $GITHUB_USERNAME GitHub-Slack mapping`
- **Description**: Adds `$GITHUB_USERNAME` → `$SLACK_ID` to the GitHub-Slack user mapping so Slack mentions resolve correctly.

### 7. Confirm

Reply to the requester: "Opened PR #N to add your GitHub-Slack mapping. It'll be live once merged."

## File touched

| File | Change |
|------|--------|
| `.github/github-slack-mapping.csv` | Append row mapping GitHub username to Slack ID |

## Example

Request from Slack: "add my github slack mapping — my GitHub is `robinnnnn`"

(Slack ID `U0B5ETBFDPB` extracted from the Slack thread context)

Diff:

```diff
 quinncembrinski-beep,U0B2PLH5XA6
+robinnnnn,U0B5ETBFDPB
```
