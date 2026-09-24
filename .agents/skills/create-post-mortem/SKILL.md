---
name: create-post-mortem
description: "Create an incident post-mortem from Slack threads, Devin sessions, PRs, and Datadog metrics — produces a formatted writeup with an incident chart, posts to #post-mortems, and archives to .postmortems/"
user-invocable: true
---

# Create Post-Mortem

Gather incident context from Slack threads, Devin sessions, PRs, and Datadog, then produce a structured post-mortem with an incident chart. Post to `#post-mortems` and archive in `.postmortems/`.

## Trigger

Invoked when a user provides incident context (Slack thread links, Devin session URLs, PR links, or a description) and asks for a post-mortem. Example: `@Devin create post-mortem for the cache-bypass DDoS` or via the `!create_post_mortem` macro.

## Prerequisites

Before starting, verify the required MCP integrations are available:

1. **Slack MCP** — required for reading threads and posting the post-mortem. Run `mcp_tool(command="list_servers")` and confirm `slack` or `slack-remote` is listed. If canvas posting is desired, `slack-remote` is required (it provides `slack_create_canvas`).
2. **Devin MCP** — required if Devin session URLs are provided. Available by default in Devin sessions.
3. **Datadog MCP** — optional, for pulling incident metrics. Check if `datadog` is listed in MCP servers.

If Slack MCP is not available, notify the user and offer to produce the draft as a file attachment only (skip step 8).

## Minimum required input

Before drafting, ensure you have at minimum:
- Incident title or affected system
- Approximate start/end time
- Stated impact
- Mitigation status
- At least one source: Slack thread, PR, Devin session, or detailed user summary

If fewer than two reliable sources are available, ask the user follow-up questions before drafting.

## Accuracy and safety

- Do not invent timestamps, metrics, root causes, impact figures, or participant actions. Every quantitative claim must trace to a Slack message, PR, Datadog query, Devin session, or the user's input.
- For gaps or unknowns, write `Unknown`, `Not confirmed`, or `Inferred — needs verification`.
- Frame writeups blamelessly — describe systems and contributing factors, not personal fault.
- **Hard gate:** Do not post to `#post-mortems`, write files to `.postmortems/`, commit, push, or create a PR until the user explicitly approves the draft. Treat ambiguous responses as not-yet-approved and ask again.

## Steps

### 1. Gather context from all provided sources

**Slack threads:**
- Extract `channel_id` from `/archives/{channel_id}/` in the URL.
- If the URL has a `?thread_ts=...` query parameter, use that value as the thread timestamp (it's the parent message).
- Otherwise, take the `/p{digits}` value and insert a dot 6 digits from the end: `p1712345678901234` → `1712345678.901234`.
- Strip query params and trailing slashes before extracting.
- Call `slack_get_thread_replies(channel_id, thread_ts)` to pull each full thread.
- Parse each message: format the Unix timestamp as UTC (`HH:MM` or `YYYY-MM-DD HH:MM` for multi-day incidents), map user ID to display name, extract message text.

**Devin sessions:**
- Use `devin_session_interact(session_id, action="get")` to get session summary and attached files.
- Look for audit reports, investigation findings, or deliverables.

**PRs:**
- Use `gh pr view "$PR_NUMBER" --repo "$REPO" --json title,body,comments,state` to get description, comments, and CI status.
- Extract: what changed, why, quantified impact, and how to test.

**Datadog (if available):**
- Use the incident window plus a 30-minute buffer on each side.
- Query metrics relevant to the affected subsystem (error rate, p95/p99 latency, connection counts, queue depths).
- Record the exact metric names / queries used for attribution in the writeup.
- If Datadog is unavailable, state so and ask the user for impact numbers.

### 2. Resolve Slack user IDs

Read `.github/github-slack-mapping.csv` (columns: `github_name,slack_id`) — it maps GitHub usernames to Slack user IDs.

For any user IDs not in the CSV, use `slack_get_user_profile(user_id)`.

In the final Slack post, use `<@UXXXXXXXXXX>` format for clickable mentions.

### 3. Reconstruct the timeline

Build a chronological timeline from all sources:
- Slack timestamps are already Unix epoch (UTC). Format them as `HH:MM` for single-day incidents or `YYYY-MM-DD HH:MM` for multi-day.
- Include: alerts firing, first human response, root cause identification, mitigation steps, fix deployed, validation complete.
- Attribute each event to the person who acted using their Slack mention.
- Note Devin sessions that were spun up and their findings.

### 4. Identify root cause, impact, and mitigation

Extract from gathered context:
- **Root cause**: Technical explanation of what went wrong.
- **Impact**: Quantified metrics — error rates, duration, affected users/services, query counts, connection saturation, etc.
- **Mitigation**: What was done — PRs, config changes, manual interventions.
- **Follow-ups**: Remaining work to prevent recurrence, prioritized.

### 5. Generate the incident chart

The post-mortem's image is a `/viz` chart of the incident. Read `.agents/skills/viz/SKILL.md` and the `DESIGN.md` Data viz section before drawing, and follow them. Start from `docs/viz-assets/examples/chart.html`: copy it to `$HOME/postmortem-work/incident-chart.html` with a `manifest.json` next to it containing `["incident-chart.html"]`.

- Plot one incident metric (error rate, latency, queue depth) over the incident window, only from a reliable time series gathered in step 1 (a Datadog query, or figures the user supplied). The failing series takes `--negative`; any other series follows the `/viz` color order. Mark alert, mitigation, and fix times with neutral dashed rules, labelled.
- One `data-viz-source` line naming the actual source and time range (the Datadog query, or the user or thread that supplied the figures).
- When no reliable time series exists, skip this step: the post-mortem is text only, and the image parts of steps 7 and 8 do not apply.

Validate, then capture light and dark:

```bash
ROOT="$(git rev-parse --show-toplevel)"
WORK_DIR="${POSTMORTEM_WORK_DIR:-$HOME/postmortem-work}"
bun run --cwd "$ROOT/tests/web-e2e" viz:validate "$WORK_DIR/incident-chart.html"
VIZ_SOURCE_DIR="$WORK_DIR" VIZ_OUTPUT_DIR="$WORK_DIR/output" VIZ_CAPTURE_MODE=framed \
  bun run --cwd "$ROOT/tests/web-e2e" viz:capture
```

The chart is `$WORK_DIR/output/framed/incident-chart/dark.png`; `light.png` is the alternate. Run the `/viz` self-check against both before sharing.

### 6. Draft the post-mortem (two variants)

Generate **two variants** of the writeup:

**Variant A — Slack mrkdwn** (for posting to `#post-mortems`):

Slack does not render markdown tables or `---` horizontal rules. Use bullet lists for the timeline. Escape `&`, `<`, `>` as `&amp;`, `&lt;`, `&gt;` in log snippets and error messages. Use `<{url}|text>` for links.

```text
*{Incident Title} — {Date} Post-Mortem*

*TL;DR*
• *Duration:* ~{X} min/hours customer-visible impact ({start}–{end} UTC)
• *Root cause:* {One-sentence technical explanation}
• *Impact:* {Quantified: error rates, affected services, query counts}
• *Fix:* {What was done}

*Timeline — all times UTC*
• `{HH:MM}` {Event with <@UXXXXXXXXXX> attribution}
• `{HH:MM}` {Event with <@UXXXXXXXXXX> attribution}
(use `YYYY-MM-DD HH:MM` format for multi-day incidents)

*Root Cause*
{Technical explanation}

*Impact*
• {Bullet points with concrete numbers}

*Mitigation*
• {What was done — <{pr_url}|PR #1234>, CF rules, manual steps}

*Follow-ups (priority order)*
1. *{Item}* — {Description}

*Participants:* <@U...>, <@U...>

*References:* <{pr_url}|PR>, <{slack_url}|Thread>, <{devin_url}|Devin session>
```

**Variant B — Standard Markdown** (for `.postmortems/` archive):

Uses standard markdown: tables for timeline, `[text](url)` links, `---` horizontal rules, `##` headings. Include a "What went well / What could be improved" section.

### 6b. Redact sensitive content

Before sharing the draft, scan for and redact:
- API keys, tokens, secrets, credentials
- Customer PII (emails, names, IDs) unless explicitly approved
- Internal IPs, hostnames, and URLs not appropriate for the audience
- Security details that increase exploitability
- Raw log payloads containing sensitive data

Use `[REDACTED]` markers. Apply to both the writeup and the chart.

### 7. Share draft for review

Send the draft as a `.md` **file attachment** (avoids triggering live `<@U...>` notifications during review). Include the dark and light chart images, if step 5 produced them. Wait for explicit approval before proceeding.

### 8. Post to #post-mortems (only after explicit approval)

Post to `#post-mortems` (`C05MYP9UPRU`). Two formats are available:

**Option A — Slack Canvas (preferred for longer post-mortems):**

Use `slack_create_canvas` from the `slack-remote` MCP. Canvas uses standard markdown (not Slack mrkdwn), so convert:
- `*bold*` → `**bold**`
- `<@UXXXXXXXXXX>` → `![](@UXXXXXXXXXX)` (canvas user mention syntax)
- `<#CXXXXXXXXXX>` → `![](#CXXXXXXXXXX)` (canvas channel mention syntax)
- `<url|text>` → `[text](url)`
- Chart image (if step 5 produced one): use `upload_attachment` (Devin runtime tool — non-Devin agents should use whatever file upload mechanism is available) to get a URL, then embed as `![incident chart](url)`

```python
slack_create_canvas(
  channel_id="C05MYP9UPRU",
  title="{Incident Title} — {Date} Post-Mortem",
  content="..."  // Canvas-flavored Markdown
)
```

Then post a short summary message linking to the canvas:
```python
slack_post_message(channel_id="C05MYP9UPRU", text="*{Title}* — post-mortem canvas above")
```

**Option B — Regular Slack message:**

Use `slack_post_message(channel_id="C05MYP9UPRU", text="...")` with the Slack mrkdwn variant.

If step 5 produced a chart, upload it via `upload_attachment` (Devin runtime tool) and include the URL in the message.

### 9. Archive to .postmortems/ (only after explicit approval)

Create a markdown file in `.postmortems/` using the standard markdown variant:
```text
YYYY-MM-DD-kebab-case-summary-of-incident.md
```

Update `.postmortems/README.md` index — detect affected subsystems by case-insensitive whole-word matching against the title, root cause, and impact sections:
`cfw-api`, `billing`, `auth`, `clickhouse`, `postgres`, `spanner`, `pubsub`, `dataflow`, `vercel`, `cloudflare`, `infra`, `routing`, `models`, `sdk`, `monitoring`, `redis`, `secrets`, `email`, `docs`, `plugins`

Add a row to the index table in date order:
```markdown
| YYYY-MM-DD | [Incident Title](filename.md) | `subsystem1`, `subsystem2` |
```

Commit and create a PR:
```bash
git diff --cached --exit-code || { echo 'Error: staged changes detected — clear them before archiving'; exit 1; }
# Set <KEBAB_SUMMARY> to a short kebab-case description (max ~5 words)
git checkout -b "devin/$(date +%Y%m%d)-postmortem-<KEBAB_SUMMARY>"
git add .postmortems/
git commit -m "docs: add post-mortem for <INCIDENT_SUMMARY>"
git push origin HEAD
```

Create a PR with title `docs: add post-mortem for <INCIDENT_SUMMARY>` targeting `main`.

## Reference

| Resource | Location |
|----------|----------|
| `#post-mortems` channel | `C05MYP9UPRU` |
| `#alerts-ci` channel | `C0594EAV9U6` |
| User ID → Slack ID mapping | `.github/github-slack-mapping.csv` (columns: `github_name,slack_id`) |
| Existing postmortems | `.postmortems/` |
| Postmortem README index | `.postmortems/README.md` |
| Incident chart | `/viz` framed capture at 2x; start from `docs/viz-assets/examples/chart.html` |
| Slack mrkdwn formatting | `*bold*`, `_italic_`, `<@U..>` mentions, `<url\|text>` links |
| Slack canvas formatting | Standard markdown with `![](@UXXXXXXXXXX)` for user mentions, `![](#CXXXXXXXXXX)` for channel mentions |
| `upload_attachment` | Devin runtime tool for uploading files to get shareable URLs |
