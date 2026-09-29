---
name: pylon-provider-ops
description: >-
  Slack-native ticket management interface for the provider operations team.
  Lets the team view, search, update, and triage Pylon tickets from inference
  provider accounts without switching to the Pylon web UI. Inference providers
  are the companies powering OpenRouter inference (not typical enterprise
  customers) — their tickets are about adding new models, endpoint onboarding
  status, routing questions, provider monitors, and uptime.
  TRIGGER when: user explicitly asks to manage inference provider tickets,
  view the provider ops queue, check on a provider's Pylon issue, update a
  provider ticket state, asks about inference partner onboarding status in
  Pylon, asks to clean up / triage / audit provider tickets, or asks to
  find non-tickets or assignee mismatches.
  Do NOT trigger for general customer support, enterprise account
  questions, billing issues, or non-provider Pylon queries.
user-invocable: true
---

# Pylon Provider Ops

Slack-native ticket management for inference provider accounts in Pylon. You
are a UI layer — the goal is to let the provider ops team manage their ticket
queue conversationally via Slack instead of context-switching to the Pylon
web app.

## What are inference providers?

Inference providers are the companies that supply compute and model endpoints
to OpenRouter (e.g., Together, Fireworks, Lambda, DeepInfra, Novita, GMI
Cloud, CoreWeave, Minimax, Venice). They are tagged "provider" in Pylon.

These are NOT typical enterprise customers. Do not confuse provider-tagged
accounts with enterprise/business accounts that consume OpenRouter's API.

### Provider onboarding lifecycle

1. Provider applies at openrouter.ai/providers/apply
2. Requirements: OpenAI-compatible `/chat/completions` endpoint, a
   `/v1/models` list endpoint (returns model IDs, pricing, context length,
   supported features), automated payment (invoicing/auto top-up), and a
   published privacy/data policy
3. OpenRouter's **provider monitor** system (`packages/provider-monitors/`)
   automatically polls the provider's `/v1/models` endpoint, detects new
   models, auto-stages them, runs baseline capability tests, and unhides
   them when tests pass and pricing is configured
4. Providers can control launch timing with `is_ready: false` in their
   models response (keeps endpoints staged but hidden)

### What provider tickets are typically about

- **Model additions** — "when will our new model X be live on OpenRouter?"
- **Endpoint onboarding status** — "our endpoint was staged but hasn't gone
  live yet" (often a baseline test or pricing issue)
- **Routing and traffic** — "we're not getting traffic", "can we get more
  volume for model Y?", traffic allocation questions
- **Provider monitor issues** — monitor not detecting new models, incorrect
  capability detection, auto-hide triggering incorrectly
- **Uptime and performance** — degraded status, TTFT/throughput concerns,
  Auto Exacto deprioritization (tool-calling traffic routing)
- **Pricing updates** — pricing not reflected on site, tiered pricing setup
- **Rate limits and capacity** — coordinating concurrency limits, 429 handling
- **Branding** — provider name/logo updates on OpenRouter

## Your role

You are a **ticket management interface**, not a ticket resolver. Your job:

- Show the team their queue (filtered, sorted, summarized)
- Fetch issue details and conversation history on demand
- Update ticket state, assignment, and tags as instructed
- Add internal notes when the team asks
- Surface relevant context (account info, Slack channels, Clerk IDs)

Do NOT attempt to resolve provider issues yourself unless explicitly asked.

## Prerequisites

- **`PYLON_API_KEY`** must be available as an environment variable. This is an
  org-level Devin secret. Verify with:
  ```bash
  echo "${PYLON_API_KEY}" | head -c 5
  ```
  If empty, stop and tell the user the key is missing from Infisical.
- **ClickHouse MCP** (`clickhouse-analytics-mcp`) — used for all bulk reads
  (see "ClickHouse Mirror" below). If unavailable, fall back to the Pylon
  API for everything.

## API Basics

- **Base URL:** `https://api.usepylon.com`
- **Auth header:** `Authorization: Bearer $PYLON_API_KEY`
- **Rate limits:** 10–60 req/min depending on endpoint (noted below)
- **Pylon UI link format:** `https://app.usepylon.com/issues?issueNumber=<N>`

## ClickHouse Mirror (prefer for bulk reads)

A Fivetran connector syncs Pylon into ClickHouse (`fivetran_pylon` database,
16 tables: `issue`, `message`, `account`, `account_tag`, `contact`,
`issue_thread`, `users`, `tags`, ...), with dbt staging views in
`analytics.stg_pylon_*` (defined in
`openrouter-data-warehouse/dbt/openrouter_data_models/models/staging/pylon/`).
Query via the `clickhouse-analytics-mcp` MCP server.

**Rule of thumb: read from ClickHouse, write through the Pylon API.**

- **Use ClickHouse for:** queue views, provider account ID collection,
  bulk message-thread reads, stale-ticket detection, assignee-mismatch
  analysis, historical/aggregate reporting. This replaces the slowest API
  paths — the 200+ page `GET /accounts` crawl (~4 min) and the
  20/min-limited per-issue `GET /issues/<uuid>/messages` loop (~8 min for
  150 issues) each collapse into a single query.
- **Use the Pylon API for:** all mutations (PATCH/notes/replies/snooze),
  and for re-fetching the latest state of any specific issue you are about
  to act on.

### Freshness caveat

Fivetran syncs periodically — data can be **hours stale**. Check freshness
first and tell the user how stale the data is:

```sql
SELECT max(_fivetran_synced) FROM fivetran_pylon.issue
```

**Never mutate based on ClickHouse state alone.** Before any PATCH (close,
reassign, snooze), re-fetch the issue via `GET /issues/<number>` to confirm
current state — the ticket may have changed since the last sync. If the
decision depends on message contents (e.g. classifying non-tickets, resolved,
or stale tickets, or picking the actual responder for reassignment), also
re-fetch the thread via `GET /issues/<uuid>/messages` for each candidate —
a provider may have replied after the last sync.

### Schema gotchas

- In `stg_pylon_issues`, `account_id`, `assignee_id`, and `requester_id`
  are JSON-encoded strings **with surrounding double quotes** (e.g.
  `"35af3a0d-..."`). Strip them before joining:
  `trim(BOTH '"' FROM i.account_id)`.
- Staging views already filter `_fivetran_deleted` and apply `FINAL`
  (dedup). If querying raw `fivetran_pylon.*` tables directly, add
  `FINAL` and `WHERE NOT _fivetran_deleted` yourself.
- Issue-level UUID is `id`; the human-readable number is `number`.
- `analytics_dev.stg_pylon_*` also exists — use `analytics`.

### Verified queries

Open provider queue (replaces API Steps 1 + 2 below):

```sql
SELECT i.number, i.id, i.state, i.title, a.name AS account,
       i.assignee_id, i.latest_message_time_ts
FROM analytics.stg_pylon_issues i
JOIN analytics.stg_pylon_account_tags t
  ON t.account_id = trim(BOTH '"' FROM i.account_id)
JOIN analytics.stg_pylon_accounts a ON a.id = t.account_id
WHERE t.tags = 'provider' AND i.state != 'closed'
ORDER BY i.latest_message_time_ts DESC
```

All message threads for those issues in one shot (replaces the per-issue
messages loop):

```sql
SELECT m.issue_id, m.author_name, m.author_user_id, m.author_contact_id,
       m.is_private, m.message_ts, m.message_html
FROM analytics.stg_pylon_messages m
WHERE m.issue_id IN (<issue UUIDs from the queue query>)
ORDER BY m.issue_id, m.message_ts
```

`author_user_id` set = internal team member; `author_contact_id` set =
external provider contact — same classification semantics as the API's
`author.user` / `author.contact`.

Team member lookup (replaces `GET /users`): `analytics.stg_pylon_users`
(`id`, `name`, `emails` JSON array, `status`).

## Common Operations

### 1. Get a single issue by number

```bash
curl -s -H "Authorization: Bearer $PYLON_API_KEY" \
  "https://api.usepylon.com/issues/<NUMBER>" | python3 -m json.tool
```

Rate limit: 60/min. Returns full issue object including title, state, account,
assignee, tags, custom_fields, timestamps, and Slack metadata.

### 2. Search provider-tagged account issues

Provider filtering is a **two-step process** because "provider" is an
account-level tag, and the `tags` field in `POST /issues/search` only
filters by issue-level tags.

Rate limit: 20/min for search, 60/min for account fetches.

#### Step 1: Collect provider account IDs

**Prefer ClickHouse** (see "ClickHouse Mirror" above):
`SELECT account_id FROM analytics.stg_pylon_account_tags WHERE tags = 'provider'`
— one query instead of a 200+ page crawl. The API fallback:

Paginate through `GET /accounts` and collect IDs where
`tags` contains `"provider"`:

```bash
# Fetch first page of accounts
curl -s -H "Authorization: Bearer $PYLON_API_KEY" \
  "https://api.usepylon.com/accounts" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data['data']:
    if 'provider' in (a.get('tags') or []):
        print(a['id'], a.get('name') or a.get('domain'))
print('cursor:', data.get('pagination', {}).get('cursor'))
"
# Continue with ?cursor=<cursor> until has_next_page is false
```

Cache these IDs for the session — they rarely change.

**Pagination note:** The accounts endpoint returns 100 per page and there
are 200+ pages. Use `?cursor=<cursor>` pagination with a 1.1s delay
between requests (60 req/min limit). Add retry logic with backoff for
rate-limit responses. Save results to `/tmp/provider_accounts.json` and
`/tmp/provider_ids.json` for reuse throughout the session.

#### Step 2: Search issues by account IDs

The `filter` body is a **single object** with `field`, `operator`, and
`value`/`values`. Combine multiple conditions with `operator: "and"` and
`subfilters` (max depth 3). Docs:
https://docs.usepylon.com/pylon-docs/developer/api/api-reference/issues#post-issues-search

##### All open provider issues (non-closed)

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{
    "filter": {
      "operator": "and",
      "subfilters": [
        {"field": "account_id", "operator": "in", "values": ["<PROVIDER_ACCOUNT_ID_1>", "<PROVIDER_ACCOUNT_ID_2>"]},
        {"field": "state", "operator": "not_in", "values": ["closed"]}
      ]
    }
  }'
```

##### Filter by specific state

Valid states: `new`, `waiting_on_you`, `waiting_on_customer`, `on_hold`, `closed`

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{
    "filter": {
      "operator": "and",
      "subfilters": [
        {"field": "account_id", "operator": "in", "values": ["<PROVIDER_IDS>"]},
        {"field": "state", "operator": "in", "values": ["new", "waiting_on_you"]}
      ]
    }
  }'
```

##### Stale provider issues (no activity in 7+ days)

```bash
# Replace <7D_AGO> with an RFC3339 timestamp, e.g. 2026-06-01T00:00:00Z
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{
    "filter": {
      "operator": "and",
      "subfilters": [
        {"field": "account_id", "operator": "in", "values": ["<PROVIDER_IDS>"]},
        {"field": "state", "operator": "not_in", "values": ["closed"]},
        {"field": "latest_message_activity_at", "operator": "time_is_before", "value": "<7D_AGO>"}
      ]
    }
  }'
```

##### Fuzzy text search within provider issues

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{
    "filter": {
      "field": "account_id",
      "operator": "in",
      "values": ["<PROVIDER_IDS>"]
    },
    "search_text": "rate limit"
  }'
```

##### Single-field filter (no compound needed)

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{
    "filter": {
      "field": "account_id",
      "operator": "equals",
      "value": "<ACCOUNT_UUID>"
    }
  }'
```

#### Pagination

Results return max 100 per page. Use `cursor` from the `pagination` object:

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{
    "filter": { ... },
    "cursor": "<cursor_from_previous_response>"
  }'
```

### 3. Read message thread on an issue

```bash
# Use the issue UUID (not the number) from the issue object's `id` field
curl -s -H "Authorization: Bearer $PYLON_API_KEY" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>/messages" | python3 -m json.tool
```

Rate limit: 20/min. Returns all messages including customer messages, agent
replies, and internal notes. Each message has: `id`, `message_html`, `author`
(with `name`, `user`, `contact`), `timestamp`, `is_private`, `source`,
`thread_id`.

### 4. Update issue state/assignment

```bash
curl -s -X PATCH -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>" \
  -d '{
    "state": "waiting_on_customer",
    "assignee_id": "<USER_UUID>"
  }'
```

Rate limit: 20/min. Updatable fields:
- `state` — new, waiting_on_you, waiting_on_customer, on_hold, closed
- `assignee_id` — Pylon user UUID (empty string to unassign)
- `team_id` — Pylon team UUID (empty string to unassign)
- `tags` — array of tag strings (replaces all existing tags)
- `title` — issue title
- `custom_fields` — array of `{slug, value}` objects
- `type` — "ticket" to upgrade a conversation

### 5. Add an internal note

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>/note" \
  -d '{
    "body_html": "<p>Internal note content here.</p>"
  }'
```

Rate limit: 10/min. Not visible to the customer. Posts to the default internal
thread. Optionally specify `thread_id` or `message_id` to reply in a specific
thread.

### 6. Reply to customer (use with caution)

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>/reply" \
  -d '{
    "body_html": "<p>Reply visible to the customer.</p>",
    "message_id": "<MESSAGE_UUID_TO_REPLY_TO>"
  }'
```

Rate limit: 10/min. **This sends a message to the customer** via the issue's
channel (Slack, email, etc.). Always confirm with the user before sending
customer-facing replies.

### 7. Get account details

```bash
curl -s -H "Authorization: Bearer $PYLON_API_KEY" \
  "https://api.usepylon.com/accounts/<ACCOUNT_UUID>" | python3 -m json.tool
```

Rate limit: 60/min. Returns account name, domain, channels (with Slack links),
tags, custom fields (including `account.hubspot.clerk_id` and
`account.hubspot.mission_control_url`).

### 8. Snooze an issue

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>/snooze" \
  -d '{"snooze_until": "2026-06-10T09:00:00Z"}'
```

Rate limit: 20/min. Snoozes the issue until the specified RFC3339 timestamp.

### 9. List all team members

```bash
curl -s -H "Authorization: Bearer $PYLON_API_KEY" \
  "https://api.usepylon.com/users" | python3 -m json.tool
```

Returns all Pylon users with `id`, `name`, `email`, `status`, and `role_id`.
Cache to `/tmp/pylon_users.json` for resolving assignee IDs to names and
for looking up user UUIDs when reassigning tickets.

### 10. List all tags

```bash
curl -s -H "Authorization: Bearer $PYLON_API_KEY" \
  "https://api.usepylon.com/tags" | python3 -m json.tool
```

Returns all tags with their `id`, `value`, `object_type` (account or issue),
and `hex_color`.

## Search Filter Reference

The `POST /issues/search` endpoint accepts a `filter` object. Each filter
is a single object with `field`, `operator`, and `value` (single-valued)
or `values` (multi-valued). To combine conditions, use a compound filter
with `operator: "and"` or `operator: "or"` and a `subfilters` array
(max depth 3).

Docs: https://docs.usepylon.com/pylon-docs/developer/api/api-reference/issues#post-issues-search

**Single filter:**
```json
{"filter": {"field": "state", "operator": "equals", "value": "new"}}
```

**Compound filter (AND):**
```json
{"filter": {"operator": "and", "subfilters": [
  {"field": "state", "operator": "not_in", "values": ["closed"]},
  {"field": "account_id", "operator": "in", "values": ["uuid1", "uuid2"]}
]}}
```

### Filterable fields

| Field | Operators | Value type |
|-------|-----------|------------|
| `state` | equals, in, not_in | string or string[] |
| `tags` | contains, does_not_contain, in, not_in | **issue-level** tag names |
| `account_id` | equals, in, not_in, is_set, is_unset | string or string[] |
| `assignee_id` | equals, in, not_in, is_set, is_unset | string or string[] |
| `team_id` | equals, in, not_in | string or string[] |
| `title` | string_contains, string_does_not_contain | string |
| `body_html` | string_contains, string_does_not_contain | string |
| `created_at` | time_is_after, time_is_before, time_range | RFC3339 string |
| `updated_at` | time_is_after, time_is_before, time_range | RFC3339 string |
| `resolved_at` | time_is_after, time_is_before, time_range | RFC3339 string |
| `latest_message_activity_at` | time_is_after, time_is_before, time_range | RFC3339 string |
| `requester_id` | equals, in, not_in, is_set, is_unset | string or string[] |
| `ticket_form_id` | equals, in, not_in, is_set, is_unset | string or string[] |
| `follower_user_id` | equals, in, not_in | string or string[] |
| `follower_contact_id` | equals, in, not_in | string or string[] |
| `issue_type` | equals, in, not_in, is_set, is_unset | "conversation" or "ticket" |
| `slack_channel_id` | equals, in, not_in | string or string[] |
| Custom field slugs | varies by field type | varies |

**Important:** The `tags` field filters by **issue-level** tags only.
To filter by account-level tags (like "provider"), look up accounts
with that tag via `GET /accounts` and filter issues by `account_id`.

## Presenting Results

When showing tickets to the user via Slack, format concisely:

- Use issue number + title + state as the primary line
- Include the Pylon link for easy click-through
- For queue views, group by state (new → waiting_on_you → waiting_on_customer)
- For single-issue details, include: title, state, account name, created date,
  last message preview, and assignee
- Strip HTML from message bodies for readability (use `python3` to strip tags)

## Workflow: Show the Queue

**Preferred:** run the "Open provider queue" ClickHouse query from the
"ClickHouse Mirror" section (one query, no pagination), report data
freshness (`max(_fivetran_synced)`), and skip to step 3. API fallback:

1. **Collect provider account IDs** (see Step 1 above). Cache for session.

2. **Fetch actionable issues:**
   ```bash
   curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
     -H "Content-Type: application/json" \
     "https://api.usepylon.com/issues/search" \
     -d '{"filter": {"operator": "and", "subfilters": [{"field": "account_id", "operator": "in", "values": ["<PROVIDER_IDS>"]}, {"field": "state", "operator": "in", "values": ["new", "waiting_on_you"]}]}}'
   ```

3. **Present as a summary table** sorted by state, then recency.

4. **On request, drill into a specific issue:**
   - Fetch the issue: `GET /issues/<number>`
   - Read messages: `GET /issues/<uuid>/messages`
   - Look up the account: `GET /accounts/<account_uuid>`
   - Surface the account's Slack channel URL and Mission Control link

## Workflow: Update a Ticket

When the user says things like "close issue 800", "mark 791 as waiting on
customer", "assign 796 to X", "snooze 780 until Monday":

1. Fetch the issue by number to get the UUID
2. Apply the update via `PATCH /issues/<uuid>`
3. Confirm the update back to the user with the new state

## Workflow: Add Context to a Ticket

When the user says "add a note to 791 saying we're waiting on the provider
to deploy":

1. Fetch the issue by number to get the UUID
2. Post an internal note via `POST /issues/<uuid>/note`
3. Confirm the note was added

## Useful Account Custom Fields

When you fetch an account, these custom fields are commonly available:

- `account.hubspot.clerk_id` — The Clerk org ID (e.g., `org_30Ff1EjclmPChWx64BQoW1Rtuu1`)
- `account.hubspot.domain` — Primary domain
- `account.hubspot.mission_control_url` — Link to internal admin (e.g., `https://internal.openrouter.ai/user/org_...`)
- `account.hubspot.usage_____past_90_days` — Dollar usage in last 90 days
- `hubspot.lifecyclestage` — HubSpot lifecycle stage (lead, opportunity, customer)

## Cross-referencing with OpenRouter systems

When a provider asks about onboarding status or traffic issues:

1. **Clerk org ID** — from the Pylon account's `custom_fields.account.hubspot.clerk_id`
2. **Mission Control** — `https://internal.openrouter.ai/user/<clerk_id>` for
   internal admin view of the provider's org
3. **Provider docs page** — `/docs/guides/community/for-providers` covers the
   technical requirements and lifecycle providers must follow
4. **Provider monitor configs** — `packages/provider-monitors/configs/<provider>/`
   holds the per-provider monitor definition (endpoint URL, model mapping, etc.)
5. **Datadog** — use the `debug-prod` skill with a generation ID if the ticket
   involves a specific failed request
6. **Provider dashboard** — providers see their own metrics at the OpenRouter
   provider dashboard (separate from the consumer dashboard)

## Workflow: Identify and Close Non-Tickets

Pylon auto-creates tickets from Slack activity, which means many open
"tickets" are actually automated notifications, accidental creations, or
purely informational messages that don't need action. This workflow
identifies those and closes them.

### Prerequisites

Cache these for the session (see "Collect provider account IDs" above):
- Provider account IDs (`/tmp/provider_ids.json`)
- Pylon user lookup (`/tmp/pylon_users.json` from `GET /users`)

### Step 1: Fetch all open provider issues

**Preferred:** the "Open provider queue" ClickHouse query from the
"ClickHouse Mirror" section. API fallback:

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{"filter": {"operator": "and", "subfilters": [
    {"field": "account_id", "operator": "in", "values": ["<PROVIDER_IDS>"]},
    {"field": "state", "operator": "not_in", "values": ["closed"]}
  ]}}'
```

Paginate with `cursor` until `has_next_page` is false. Save all issues.

### Step 2: Fetch message threads for each issue

**Preferred:** the bulk `stg_pylon_messages` ClickHouse query from the
"ClickHouse Mirror" section — all threads in one query instead of a
20/min API loop. API fallback, per issue:

```bash
curl -s -H "Authorization: Bearer $PYLON_API_KEY" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>/messages"
```

Rate limit: 20/min — add 3s delay between requests.

Each message has:
- `author.user` — present when the author is an internal Pylon user
  (OpenRouter team member)
- `author.contact` — present when the author is an external contact
  (provider)
- `is_private` — true for internal notes
- `message_html` — the message body (strip HTML tags for readability)

### Step 3: Classify using non-ticket heuristics

**Critical: Pylon auto-generates titles from Slack metadata, and they are
often misleading.** A title like "Dashboard error while self-solving" may
actually be a provider requesting manual help, and "Clarification on Slack
Mention" may be a legitimate auth issue. **Never classify based on title
alone.** Always read the message bodies (from Step 2) before classifying.

#### High-confidence structural signals (title-independent)

These signals are based on message structure, not title keywords, and
are reliable for classification:

| Signal | How to verify |
|--------|--------------|
| **Bot-only messages** — only "OpenRouter Updates" posted | Check `author.user` / `author.name` — all messages from bot, 0 external messages, 0 human internal replies |
| **Empty title + single message** — accidental ticket creation | `title` is blank/empty AND the `GET /issues/<UUID>/messages` response has ≤ 1 entry |
| **Automated "endpoint is live" notification** | Title contains "endpoint is live on OpenRouter" AND only bot messages with no human follow-up |

#### Requires message body verification

For these signals, the title may suggest a non-ticket, but you **must
read the actual message bodies** to confirm. The message content may
reveal a legitimate request hidden behind an auto-generated title:

| Title signal | Body verification needed |
|-------------|------------------------|
| Title mentions "Slack mention" or "notification" | Read body — may be a real support request that happened to originate from a mention |
| Title mentions "self-solving" or "resolved" | Read body — provider may still be waiting for manual action |
| Title mentions "feedback" or "testing" | Read body — may contain a real feature request or bug report |
| Title mentions "status update" | Read body — may contain an action item or escalation |

**Verification process:** For each candidate, read the first and last
message body. If the body contains a question, request, or action item
from the provider (external contact), it is a real ticket regardless of
the title.

### Step 4: Present findings and execute

Present non-tickets in paginated batches (e.g., 10 at a time) with:
- Issue number, title, account, state, assignee, link
- Classification reason
- Proposed action: unassign + close

**Always get user approval before closing.** Then execute:

```bash
# Unassign and close
curl -s -X PATCH -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>" \
  -d '{"state": "closed", "assignee_id": ""}'
```

Rate limit: 20/min — add 3s delay between updates.

## Workflow: Detect and Fix Assignee Mismatches

When tickets are auto-created, Pylon assigns a default owner (often
whoever is on rotation or the account owner). But the person who actually
replies and actions the ticket may be someone else. This workflow detects
those mismatches and reassigns tickets to the actual responder.

### Step 1: Fetch issues + messages (same as non-ticket workflow)

Reuse the cached issue list and message threads from the non-ticket
workflow if already fetched.

### Step 2: Identify the actual responder

For each issue's message thread:

1. Filter to non-private messages from internal users
   (`author.user` is present and `is_private` is false) — these are
   customer-facing replies from the OpenRouter team
2. **Exclude bot/system users** (e.g., "OpenRouter Updates") before
   counting — otherwise a thread with many bot notifications plus one
   human reply can crown the bot as "actual responder"
3. Count replies by author name (human users only)
4. The person with the **most replies** is the "actual responder"
5. Skip issues where no human internal user replied (bot-only threads)

### Step 3: Compare to current assignee

A mismatch exists when:
- The issue has an assignee AND
- The actual responder (by reply count) differs from the assignee

Also flag issues where:
- The issue has no assignee but a team member did reply (should be
  assigned to them)

### Step 4: Present findings and execute

Present mismatches in paginated batches with:
- Issue number, title, account, state, link
- Current assignee name
- Suggested assignee name + reply counts
- Reasoning

**Get user approval before reassigning.** Then execute:

```bash
# Reassign to the actual responder
curl -s -X PATCH -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>" \
  -d '{"assignee_id": "<NEW_USER_UUID>"}'
```

To find the user UUID, look up the name in the `/users` response
(cached in `/tmp/pylon_users.json`).

## Workflow: Close Stale Tickets

Provider tickets often go stale when neither side follows up. This
workflow finds tickets past a staleness threshold (e.g., 7 business days)
and closes them.

### Step 1: Search for stale open tickets

Use the `latest_message_activity_at` time filter to find open provider
tickets with no activity past the threshold:

```bash
curl -s -X POST -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/search" \
  -d '{
    "filter": {
      "operator": "and",
      "subfilters": [
        {"field": "account_id", "operator": "in", "values": ["<PROVIDER_ACCOUNT_IDS>"]},
        {"field": "state", "operator": "not_in", "values": ["closed"]},
        {"field": "latest_message_activity_at", "operator": "time_is_before", "value": "<CUTOFF_ISO8601>"}
      ]
    }
  }'
```

Calculate the cutoff by subtracting 7 business days from today
(skip Sat/Sun when counting backwards).

**Caveat:** The `latest_message_activity_at` filter works correctly for
searching, but the field value may come back empty in the search response
payload. If you need the actual timestamp, fetch individual issues via
`GET /issues/<number>`.

Similarly, `account.name` may be missing in search results — only
`account.id` is reliably present. Cross-reference with your cached
account data from `GET /accounts`.

### Step 2: Fetch messages and classify

For each stale ticket, fetch the message thread (Step 2 from the
non-ticket workflow). Classify based on who sent the last **public,
human** message:

**Important:** Ignore private internal notes (`is_private: true`) and
bot/system messages (e.g., "OpenRouter Updates") when determining the
last message. A private note after the provider's last public request
does NOT count as "we replied" — the provider never saw it.

| Last public human message from | Classification | Meaning |
|-------------------------------|---------------|---------|
| Internal team member (non-private) | **Resolved** | We replied publicly, provider never followed up — issue likely handled |
| External contact (provider) | **Stale** | Provider sent a message and we never followed up publicly |
| No messages / bot only | **Stale** | No real conversation happened |

### Step 3: Present findings and close

Present stale tickets grouped by classification with:
- Issue number, title, account, last activity date
- Who sent the last message
- Classification (resolved vs stale)

**Get user approval before closing.** Then close with:

```bash
curl -s -X PATCH -H "Authorization: Bearer $PYLON_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.usepylon.com/issues/<ISSUE_UUID>" \
  -d '{"state": "closed"}'
```

Note: There is no separate close reason field — just set state to
`closed`. Rate limit: 20/min — add 3s delay between updates.

## API Field Reference

Key fields returned by the search endpoint that differ from what you
might expect:

| Expected | Actual field | Notes |
|----------|-------------|-------|
| `issue_number` | `number` | Integer issue number |
| `assignee.name` | — | Assignee only has `id`; resolve via `GET /users` |
| `latest_message_activity_at` | `latest_message_time` | RFC3339 timestamp of last message |
| `body_html` | `body_html` | HTML body of the opening message |
| `link` | `link` | Direct Pylon UI link |

The `GET /users` endpoint returns all team members with `id`, `name`,
`email`, and `status`. Cache this for the session.

## Tips

- The `tags` field in issue search filters by **issue-level** tags only.
  "provider" is an **account-level** tag — you cannot use it directly in
  `POST /issues/search`. Instead, look up provider accounts via
  `GET /accounts` and filter by `account_id`.
- Issue UUIDs (the `id` field) are needed for messages/update/note endpoints.
  Issue numbers work only for `GET /issues/<number>`.
- The Pylon UI link for any issue is:
  `https://app.usepylon.com/issues?issueNumber=<N>`
- Account Slack channels are in `account.channels[].channel_url` — useful for
  finding the relevant Slack Connect channel for a provider.
- Rate limits are strict (especially 10/min on replies/notes). Space requests
  if doing bulk operations.
- Always confirm with the user before sending customer-facing replies. Internal
  notes are safe to add without confirmation.
