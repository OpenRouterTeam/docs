---
name: pr-linear-coverage
description: >-
  Audits a person's merged GitHub pull requests against Linear coverage.
  Attributes Devin-generated work to the requesting human, validates textual
  Linear references, reverse-matches existing assigned tickets, correlates
  originating Slack threads, groups stacked PRs into work units, and—only
  after human confirmation—links existing tickets or creates one backfill
  ticket per uncovered work unit.
user-invocable: true
---

# PR → Linear Coverage

Enumerate a person's GitHub pull requests, determine which work is represented
in Linear, and propose safe backfill actions. This is an audit and backfill
runbook, not a title-matching shortcut.

Inputs:

- subject person
- PR time window
- repository or repositories
- optional Linear team override
- output destination

Defaults are the invoking person, the last seven days, merged PRs, the
repository `OpenRouterTeam/openrouter-web`, no team override, and the invoker
as the output destination. The Linear reverse-match lookback defaults to three
times the PR window and may be overridden explicitly. A 90-day backfill must
therefore use a 270-day reverse-match lookback unless the invoker chooses a
different value.

The skill has two parts:

- `scripts/collect-prs.sh` performs deterministic GitHub collection and emits
  newline-delimited JSON.
- This document owns attribution, Linear/Slack lookups, grouping, judgment,
  ticket prose, confirmation, writes, and reporting.

## Guardrails

- Never write to Linear or Slack without explicit confirmation.
- Never close, reassign, relabel, or modify a pre-existing ticket.
- Never auto-link on title similarity alone or create a duplicate.
- Raw regex matches are candidates only: `GPT-5`, `SHA-256`, `UTF-8`, and
  `CVE-2026` are not automatically Linear identifiers.
- Do not commit run output; reports go to the invoker or Slack.

## Inputs and Step 0 — Resolve identity

Defaults are the invoking person, `OpenRouterTeam/openrouter-web`, merged PRs
from the last 7 days, and a Linear reverse-match window of three times the PR
window. Allow overrides for subject, repository or repositories, start date,
end date, PR state, Linear team, reverse-match lookback, and output destination.
The helper's `open`/`all` states use creation time. Apply the selected PR
window to every GitHub query and the selected reverse-match lookback to every
Linear reverse-match query. Do not infer identity from a display name, title,
or session URL.

Read `.github/github-slack-mapping.csv`. The file has `github_name,slack_id`
columns and may contain both a GitHub handle row and display-name rows for the
same Slack ID.

Resolve the subject against `.github/github-slack-mapping.csv` for any person
represented there. Resolve the Slack ID to the CSV row and take its GitHub
handle. If the person is absent, fail loudly and ask for clarification. Do not
guess from email aliases or Slack display names.

Resolve the Linear identity with `list_users` and record the returned user UUID
and email. Do not construct it as `<github_name>@openrouter.ai`: the GitHub
handle and the Linear email routinely diverge, and an email Linear cannot
resolve fails silently on both the read and the write side — see “Linear MCP
request shapes that bite”. Record all three identities: GitHub handle, Slack
ID, and Linear UUID.

## Step 1 — Enumerate and attribute PRs

Run the helper from the repository root:

```bash
.agents/skills/pr-linear-coverage/scripts/collect-prs.sh \
  --handle mindiweik \
  --since 2026-07-20 \
  --repo OpenRouterTeam/openrouter-web \
  --state merged
```

The helper emits one JSON object per PR with:

- `number`, `title`, `description`, `url`, `createdAt`, `mergedAt`
- `author`, `branch`, and `state`
- `requester` from the exact `Requested by:` footer
- `devinSessionId` from the Devin session URL
- `changedFiles`
- raw candidate `candidateIssueIds`

The helper accepts `--since` and an optional `--until` date. Both are strict
calendar dates, and `--until` must not precede `--since`. The bounded date
qualifiers apply to merged PRs and to created PRs for the `open` and `all`
states.

The `files` payload from `gh pr view --json files` is limited to its first
page, so `changedFiles` can be truncated for PRs with more than 100 files.
Do not add pagination to this helper. Treat changed-file overlap as incomplete
evidence for large PRs and report that limitation when grouping or
reverse-matching.

The `commits` payload from `gh pr view --json commits` is likewise limited to
its first page, so commit text can be truncated for PRs with more than 100
commits. A commit-only candidate issue key can therefore be missed. Do not add
pagination to this helper and report this limitation alongside the
changed-file limitation.

Each list-level GitHub search requests at most 1000 results. If a query
returns exactly that many, the helper warns that the result may be truncated.
Do not add pagination. Narrow the PR window and rerun before trusting coverage.

Candidate issue scans are case-insensitive because branch names may contain
lowercase Linear keys. Prefixes must begin with a letter and may contain
letters or digits, with a total prefix length of two to six characters. Keys
with one-character or longer-than-six-character prefixes are outside this
helper's scan bound and require separate handling. Matches are normalized to
uppercase for downstream prefix validation. This can increase the candidate
count by surfacing strings such as `utf-8` or `sha-256`; they remain raw
candidates and must be rejected unless the normalized prefix is confirmed
against a real Linear team.

Use PR author matching as the primary attribution signal. In the measured
`merged:>=2026-07-20` window (2026-07-27 UTC), 919 of 991 merged PRs (92.7%)
were authored by a human account, while 72 (7.3%) were authored by
`app/devin-ai-integration`. The `Requested by:` footer supplements author
matching for that smaller bot-authored slice; it is not the load-bearing path.

Attribute by the union of PR author login matching the handle and:

```regex
(?mi)^\s*Requested by:\s*@?([A-Za-z0-9_.-]+)\s*$
```

Record the session URL, not merely its ID. It is the strongest initial
grouping key. Inspect commit trailers when author attribution is ambiguous:

```text
Co-Authored-By: Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>
```

Do not count a Devin co-author trailer alone; a human-authored PR is
attributable when its author equals the subject handle.

### Attribution coverage limitation

In that same measured window, only 9 of the 72 bot-authored PRs carried a
`Requested by:` footer. The remaining 63 bot-authored PRs had neither a human
author match nor a requester footer, so this skill—and any per-person audit
using these repository signals—cannot attribute them to a human. Report this
unattributable population instead of implying that a per-person result is
exhaustive. Re-measure these counts when the audit window changes.

Worked example: the Mindi query `merged:>=2026-07-20` found 10 PRs
(#28982, #29408, #29873, #29881, #29995, #30043, #30331, #30391, #30409,
#30419), all authored directly by `mindiweik`, versus the workspace estimate
of approximately 11.

## Step 2 — Build the Linear index

Use the Linear MCP read-only tools to build two indexes:

1. Valid issue identifiers and their teams.
2. GitHub PR URL → Linear issue attachments.

### Team keys are not exposed reliably

Resolve team prefixes before classifying any candidate. For every prefix found
in a PR, query Linear issues and confirm the prefix from their identifiers.
An unresolvable prefix is reported as `unknown`; it is not treated as "not a
Linear key" and must not cause a CREATE proposal by itself.

`list_teams` does **not** return the `key` field. Do not treat team names,
UUIDs, or arbitrary hyphenated strings as prefixes. Resolve each team's prefix
empirically by pulling a couple of that team's issues and reading their
`identifier` with `get_issue`. An optional team override narrows the search,
but does not bypass prefix confirmation.

This non-authoritative fast-path cache may reduce lookup work, but every entry
must be confirmed against Linear during the run and may not be used as the
source of truth:

| Prefix | Team |
| --- | --- |
| `ECO` | Ecosystem |
| `PLA` | Platform |
| `OPE` | OpenRouter |
| `ENT` | Enterprise |
| `DEV` | DevEx |
| `SEO` | SEO / AEO |
| `SEC` | Security |
| `ORI` | ORI |
| `REV` | RevOps |
| `SUP` | Eng Support |
| `DES` | Design |

Rasp, Lenny, Customer Engineering, Data & Analytics, Enterpret Signals, Scaled
Support, Automated Task Sourcing, and Window AI remain unresolved through this
MCP surface. Do not invent their prefixes.

### Text coverage

For every PR, validate candidates from branch, title, body, and commits:

1. Match `<POSSIBLE_TEAM_KEY>-<number>`.
2. Resolve and confirm the prefix before classification.
3. Report an unresolvable prefix as `unknown`, not as a non-key.
4. Call `get_issue` for confirmed candidates and record the issue URL, team,
   state, assignee, and project.

An unvalidated regex match is not coverage. In particular:

```text
GPT-5      SHA-256      UTF-8      CVE-2026
GHSA-8988  CWE-506      MAL-2026
```

must not pass the text signal.

A confirmed candidate counts as text coverage only when the reference is
relevant to the pull request's own work. Apply the same relevance judgment
used for reverse matching by comparing the surrounding PR context with the
issue's title, description, and scope. A mention that is only contextual,
such as a follow-up reference or quoted parent footer, leaves the pull
request uncovered and must continue through attachment and reverse matching.

### Attachment coverage

Do **not** use Linear `get_diff` or `get_diff_threads` for PR linkage. With
real GitHub PR URLs, both returned:

```text
Error: Diff not found
```

This is an integration limitation, not a URL-format problem. Do not keep
retrying those tools as a coverage strategy.

Instead, pull the subject's Linear issues over the configured reverse-match
lookback, which defaults to three times the PR window, paginate with the
tool's `cursor` argument, and inspect every issue's `attachments`. Normalize
each GitHub PR URL and build:

```text
normalized PR URL → [Linear issues whose attachments contain it]
```

The issue attachment path worked for `ECO-2314`, which contained PR #30331.
This is how the dry run discovered coverage that text matching missed.

### Linear MCP request shapes that bite

- Responses truncate near 5,000 characters, mid-string, so a large page comes
  back as unparseable JSON. Page small: roughly 5 issues per `list_issues` call
  and 20 per `list_issue_labels` call, and follow the returned cursor.
- `list_cycles` takes `teamId` with the team's UUID. `team` and a team name are
  both rejected. Get the UUID from `list_teams` or from an issue's `teamId`.
- `list_issues` `fields` rejects `identifier`; issue keys come back in `id`.
- `list_issues` `fields` also rejects `attachments`. List the subject's issues
  with light fields, then hydrate attachments with one `get_issue` per issue,
  in batches of about 10 to stay under the concurrency cap.
- Parallel Linear calls cap at 32 concurrent invocations, and single calls
  occasionally fail with HTTP 500. Both are transient, so retry the individual
  call rather than the batch.
- `save_issue` silently ignores an `assignee` email it cannot resolve: the
  create succeeds and returns a normal issue, unassigned, with no error or
  warning. Resolve the subject with `list_users` and pass the returned user
  UUID rather than an email guessed from a GitHub handle.
- `get_issue` omits the `assignee` key entirely when an issue is unassigned, so
  a missing key is the only signal. Re-read every created issue and confirm
  assignee, state, project, labels, and attachments rather than trusting the
  create response.
- A PR comment containing the issue key did not produce a Linear attachment
  within the observation window, and Linear's GitHub attachment creation is
  webhook-driven, so treat `save_issue` `links` as the durable attachment path.
  Report the PR-side link and the Linear-side attachment as two separate facts.

## Step 3 — Classify each PR

Every PR receives one primary classification:

| Classification | Meaning | Dry-run action |
| --- | --- | --- |
| `covered` | Valid text reference or PR URL in issue attachments | No ticket |
| `existing-unlinked` | A ticket clearly covers the work, but has no PR attachment | Propose LINK |
| `create-candidate` | No credible existing ticket after reverse matching | Propose CREATE |

Text and attachment coverage are independent signals. A PR can be covered by
an attachment even when text coverage is empty.

Example only: one prior run had 0 text-covered and 10 text-uncovered PRs; #30331 was
attached to `ECO-2314`, making the final result 1 covered and 9 requiring
reverse matching. Text-only logic wrongly flagged #30331.

## Step 4 — Reverse-match before creating

Before proposing CREATE, list the subject's Linear issues assigned to the
Linear UUID resolved in Step 0, in the configured reverse-match lookback.
Paginate every result. For the report-only “tracked but not shipped” bucket,
restrict the
default view to active-cycle work:

1. Resolve the current cycle with `list_cycles` separately for every team
   represented in the subject's assigned issues.
2. Include issues in that team's current cycle.
3. Include issues in an In Progress / started state regardless of cycle.
4. Exclude other backlog issues by default.

Support an explicit `--all-open-assigned` override when the invoker wants the
entire open assigned backlog. Subjects may own tickets across several teams,
so a single global current cycle is incorrect. The active-cycle filter makes
the report tractable, but the MCP may still return paginated results without a
compact total; report that limitation honestly.

For each uncovered PR or grouped work unit, compare:

- PR title and body against issue title and description.
- Changed files and package area against the issue's requested scope.
- Explicit PR numbers, branch names, or Devin session URLs.
- Shared originating Slack threads.
- Project, team, assignee, state, and date context.

Classify reverse matches as:

1. **Existing unlinked ticket:** LINK, never CREATE.
2. **No ticket:** CREATE candidate.
3. **Tracked but not shipped:** report-only active-cycle or started ticket
   with no matching PR in the selected PR window.

Example only: #29873, #30391, #30409, and #30419 strongly matched
`ECO-2003` (MongoDB adapters/monitor); #28982 possibly followed up on
`ECO-1318` (medium confidence); and #29408, #29881, #29995, and #30043
remained CREATE candidates. `ECO-2001`, `ECO-2004`, `ECO-2006`, `SEO-47`,
`SEO-49`, `SEO-50`, `SEO-52`, and `SEO-55` were report-only examples when they
met the active-cycle/started-state filter.

Title similarity alone is not sufficient. Auto-link only when the PR number
is explicitly named in the issue or the PR URL is already in attachments.
Use human confirmation for session/file/Slack-based proposed matches.

## Step 5 — Group PRs into work units

Group before writing tickets. Use evidence in this order:

1. Shared primary Devin session URL.
2. Explicit stacked-PR or follow-up references in bodies.
3. Shared changed files/package and related tests.
4. Similar behavior and external/onboarding motivation.
5. Shared originating Slack thread.

Do not group solely on similar wording.

Example grouping: the VoyageAI/MongoDB unit contains #29873, #30391, #30409,
and #30419. The latter three share a session and explicit stack references;
#29873 has a different session but the same provider, monitor, adapter factory,
and onboarding area. Session URL alone is insufficient.

Example units from one prior run were:

```text
VoyageAI/MongoDB onboarding: #29873 #30391 #30409 #30419
Azure MAI launch configuration: #29881 #29995 #30043
Seedance monitor/pricing: #29408
Provider billing snapshot: #28982
```

## Step 6 — Read the diff and correlate Slack

Ticket context must explain actual behavior from the diff:

- What files and package areas changed.
- What routing, pricing, monitoring, or reporting behavior changed.
- Why the change existed.
- Which PRs constitute the work unit.

Do not copy only the PR title.

### Slack tool reality

The native `slack` server supports `slack_list_channels`,
`slack_get_channel_history`, `slack_get_thread_replies`, and
`slack_get_user_profile`, but has **no search**. Search with
`slack_search_public_and_private` on `slack-remote`, then read the thread with
the native server. Search the session ID, PR number, or distinctive domain
phrase and prefer a result containing the same session URL and PR link.

When a search result identifies an originating thread, read the thread and
construct its permalink from the returned channel ID, parent `thread_ts`, and
`cid`. Do not hardcode a channel or a person's thread.

The `slack-remote` tool set varies by session; a 2026-07-31 run had only
posting, canvas, and channel/user lookup tools, with no message search or
thread read. When search is unavailable, recover the originating thread from
the PR's Devin session instead: `devin_session_events` with `action="list"`
then `action="details"`. In that run the initial user message carried
`slack_thread_url`, so start there and fall back to scanning the other events
and the session metadata for the same field before giving up.
That fallback works only for Devin-authored PRs, so state the gap for the rest
rather than reporting Slack correlation as complete.

`devin_session_events` with `action="search"` and query `slack.com/archives`
recovers candidate threads reliably and is cheaper than listing events. It
returns whatever thread the session mentioned, which is not always the
originating one, so report those threads as candidates unless a session yields
exactly one.

## Step 7 — Confirm before writing

Present the plan and wait for an explicit go-ahead.

Keep the plan short. It exists so the human can approve or correct writes, not
to show the audit's work. Budget roughly one screen. Write the full detail to an
untracked file outside the repository working tree and attach that file to the
message, rather than pasting it. Never offer a bare local path, which the
reader cannot open. If the destination cannot take an attachment, say the
detail exists and paste it on request.

- Lead with the counts, one line: covered, link, create, report-only.
- Covered and report-only units get one line each, title plus links, no prose.
- Each proposed link gets one line: PR, issue, confidence, and the evidence
  that matched.
- Each proposed create gets a short block: title, team, project, assignee,
  state, and labels. Name `pr-backfill` plus the meaningful domain label, and
  flag when `pr-backfill` must be created before the issue can be written. Do
  not paste the body. Say what it will contain only if it deviates from the
  standard sections.
- Before presenting the plan, look the label up with read-only
  `list_issue_labels` and state whether `pr-backfill` exists or must be
  created. The tool is read-only, takes `limit` and `cursor`, and has no team
  filter and no free-text query, but it accepts `name` for an exact
  (case-insensitive) match: `{"name": "pr-backfill"}` returns every label with
  that name across scopes in one call. Use that instead of paging the full
  listing. Check both workspace-level and team-level entries in the result. A
  workspace-level match is sufficient for every team, while a team-level match
  counts only for that same team, so a copy scoped to another team still means
  the label must be created for the team being written to. Never create a
  second label with the same name and scope. Do not create the label until
  after confirmation.
- Raise an ambiguity, a limitation, or a confidence caveat only when it could
  change the human's answer. Skip the rest.
- Completeness limitations are always decision-relevant and appear in the plan
  and in every report, whatever the destination, including changed-file and
  commit truncation, paginated Linear results, skipped PRs, and capped
  searches. Only interpretive or stylistic caveats may be trimmed for brevity.
- Do not restate the procedure, the tools used, or the buckets' definitions.

Do not call Linear `save_issue` or `save_comment`, GitHub PR-comment commands,
attachment tools, label/state mutation tools, or Slack posting tools before
confirmation. Read-only lookups such as `list_issue_labels` are allowed before
confirmation. When creating or updating a Linear issue, use `save_issue`; pass
`assignee` (user ID, name, email, or `"me"`), not `assigneeId`. Infer the team
and project from the work and the subject's own Linear membership. Never default
to Ecosystem or another fixed team. State the inferred team and project in the
confirmation plan so the human can correct them.

The only automatic-link exceptions are high-confidence evidence:

- The issue explicitly names the PR number, or
- the PR URL is already in the issue attachments.

Even then, follow the invoker's confirmation policy for this run. The safe
default is still to show the plan first.

## Step 8 — Execute approved actions

### Existing-unlinked: fix the GitHub PR side

The durable LINK action is a comment on the GitHub PR containing the validated
Linear identifier, for example `ECO-2314`, using `gh pr comment` or the GitHub
API. Linear's GitHub integration is what attaches a PR when the issue key is
present in the PR; this is the side that was missing in the original problem.

Example only: a dry run found `ECO-2314` already attached to PR #30331. The repository's
`.github/workflows/linear-project-label.yaml` corroborates the convention: it
parses Linear bot PR comments with `/([A-Z]+-\d+)/`. This is strong repo
evidence for the key-in-PR-comment workflow, but the dry run did not independently
prove that every such comment immediately creates an attachment in Linear.
Report that limitation rather than asserting guaranteed auto-attachment.

After the GitHub comment, optionally add a traceability comment to the Linear
issue with `save_comment`, including the PR URL. A Linear-side comment alone
does not fix the PR-side link.

The dedicated Linear attachment tools are file-upload tools
(`prepare_attachment_upload`, `create_attachment_from_upload`, and deprecated
`create_attachment`), so none of them attaches a plain URL. `save_issue` does:
its `links` parameter takes `[{url, title}]`, is append-only, and creates real
PR attachments on the issue. Pass the work unit's PR URLs there as well as in
the body, which is what makes the normalized-URL idempotency check work on the
next run.

Never create a duplicate or change a pre-existing ticket's state without
separate approval. For `create-candidate`, use `save_issue` once per work unit,
assign with `assignee`, and infer team/project from the touched area with
reasoning stated. Merged work defaults to the team's completed state with date
context; obvious follow-ups stay Todo.

Every created body has these sections:

```markdown
## Summary
## What changed
## Why
## PRs
## Slack thread
## Backfilled-by
```

Apply `pr-backfill` to every created issue together with at least one meaningful
domain label; `Automatically Created by Devin` may accompany them but must not
be the sole label. If the planning lookup found `pr-backfill` missing and the
plan was approved, create it with `create_issue_label` before creating the
issue. The tool takes `name`, `description`, `color`, and optional `teamId`.
Omitting `teamId` creates a workspace-level label, which is preferred over a
team-scoped copy so later runs on other teams find the same label. Match future
runs on normalized PR URLs in bodies and attachments, which is the idempotency
guarantee that does not depend on labels.

## Step 9 — Report

Report:

```text
covered N
linked N
created N
tracked but not shipped N (or “count unavailable; paginated MCP results”)
```

Then one line per created or linked item with its Linear and PR links. The
brevity budget applies to every report. Skip content the reader already saw
only when the report goes solely to the approver. Whenever a report reaches
anyone who did not see the plan, including any Slack post and including a
single report that serves both audiences, it stands alone with PR numbers and
titles, work-unit grouping, the confidence behind each link, and Linear and
Slack links.

If posting to Slack:

- Send exactly one top-level message.
- Put detail in one threaded reply.
- Use `<url|label>` hyperlinks.
- Do not post bare issue identifiers as the only reference.

Example only: one prior run reported one attachment-covered PR (#30331), four strong
MongoDB existing-ticket matches, one medium billing match, and four CREATE
candidates; the complete report-only count was unavailable because Linear
results were paginated.

## Helper script contract

`scripts/collect-prs.sh` requires `gh` and `jq`, preflights GitHub
authentication, and emits only the subject's attributed PRs as NDJSON. It uses
two list-level searches (author and requester footer), unions by PR number, and
views only survivors to collect commits and files. It emits raw candidate
identifiers without claiming they are Linear keys. If it emits no records,
report zero attributed PRs as an explicit finding and verify the handle,
window, repository, state, and authentication before treating the result as
clean coverage. If a per-PR detail fetch fails, the helper warns on stderr and
skips that PR. Treat every skipped PR as an explicit finding to resolve before
trusting the coverage result. Also resolve any list-level cap warning before
trusting coverage.

Example:

```bash
.agents/skills/pr-linear-coverage/scripts/collect-prs.sh \
  --handle mindiweik --since 2026-07-20
```

Do not write this output to a tracked repository file.

## Improve this skill

Skills are living documents. After each run, compare this procedure with what
actually happened. Add durable tool limitations, moved paths, new attribution
formats, or matching failure modes when they would change a future run. Keep
one-time incident details in the run report rather than this document.
