# Slack app manifests for cfw-internal

Each file here is the manifest of one dedicated internal Slack app that cfw-internal talks to with its own bot token. Create the app at https://api.slack.com/apps with "From an app manifest", paste the JSON, install it to the OpenRouter workspace, then set the worker secrets listed for that app. Manifests are the source of truth for scopes and request URLs. Change the file and re-apply it in the Slack app settings when a route or scope changes.

## task-label-review-manifest.json

Sends one labeled session at a time to the session's owner for review, offers "Review another" after each verdict, and receives the button and modal interactions from `src/routes/task-label-review/`.

| Manifest field                   | Why the code needs it                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `chat:write`, `im:write`         | `conversations.open` plus `chat.postMessage` and `chat.update` for the review DM with a single owner                                      |
| `mpim:write`                     | `conversations.open` with several member ids when `review_group` is set, so the review goes to one group DM                               |
| `users:read`, `users:read.email` | `users.lookupByEmail` to resolve a creator's Slack id, `users.info` to resolve the acting Slack user back to an email for the admin check |
| `interactivity.request_url`      | `POST /api/v1/internal/task-label-review/interactions`, verified with the signing secret, not behind Clerk                                |
| no event subscriptions           | The app never reads messages. It only posts and receives interaction payloads.                                                            |

Secrets to set on the `internal` worker after installing the app (both live in `env.manifest.json` and `src/env.ts`):

```bash
cd services/cfw-internal
bunx wrangler secret put TASK_LABEL_REVIEW_SLACK_BOT_TOKEN      # Bot User OAuth Token, starts with xoxb-
bunx wrangler secret put TASK_LABEL_REVIEW_SLACK_SIGNING_SECRET # Basic Information -> App Credentials -> Signing Secret
```

Without the bot token the `task-label-review-sync` cron skips the whole tick with a `task_label_review_sync_skipped_no_bot_token` warning, because owner resolution needs Slack's email lookup. Without the signing secret the interactions route answers 500 with a `task_label_review_interaction_signing_secret_missing` log line.

Which interns take part, who owns their sessions, and where the messages go is the `task_label_review` live-config key, edited at https://internal.openrouter.ai/admin-utils/live-config?key=task_label_review. Every field defaults to empty, so nobody receives a DM until a workload is added.

- `subscribed_workloads` lists the intern names (the `interns.name` values, which are also ClickHouse `workload_name`) whose labeled sessions the cron assigns and sends. Removing a workload stops new assignments and unresolved-owner retries for it. Its already queued sessions still go out, and every labeled session stays gradeable in Mission Control regardless.
- `fixed_owners` maps a workload name to `{ clerk_user_id, slack_user_id }`. Every session of that workload is owned by that person instead of the intern's creator or the Slack requester. The Clerk id must be an active personal user (`user_...`), never an organization id.
- `review_group` lists Slack member ids. When set, every review message is posted to one group DM with those members instead of each owner's own DM. Only the recorded owner or an `is_admin` user can answer, whoever else is in the group.

Example for a single workload owned by one person and reviewed in a two-person group DM:

```json
{
  "subscribed_workloads": ["rasp"],
  "fixed_owners": { "rasp": { "clerk_user_id": "user_...", "slack_user_id": "U..." } },
  "review_group": ["U...", "U..."]
}
```
