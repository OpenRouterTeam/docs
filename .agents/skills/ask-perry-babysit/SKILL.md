---
name: ask-perry-babysit
description: "Hand the current session's PR to Perry for review or babysitting by posting to the #agents-perry-reviews Slack channel. Use when the user asks to have perry review, babysit, or drive a PR to approval (e.g. 'ask perry to babysit this PR', 'have perry review my PR')."
user-invocable: true
---

# Ask Perry to Babysit a PR

Post a message to the `#agents-perry-reviews` Slack channel that hands a PR to **Perry** — either for a one-shot review or for the full "babysit" loop that drives the PR to Perry's approval. Use this after you (or the user) have a PR open and want Perry involved without the user re-typing the Slack incantation.

Perry is an autonomous review agent (`perry-the-pr-maintainer[bot]` on GitHub, `perry` / `U0AQD847T6C` on Slack) that listens in the `#agents-perry-reviews` Slack channel. There are two ways to invoke it, and this skill posts one of them for you.

This skill posts the Perry request. Its near neighbour is `resolve-pr-comments`, which clears the review threads already on a PR from the current session without involving Perry. For a PR this session owns, the approval loop pairs the two: `review` here, then `resolve-pr-comments` on the threads, until Perry approves. Hand off to a `babysit` session only for a PR nobody has a live session on, and never run a babysit session and in-session resolution on the same branch at once.

## Trigger

The user asks, in a Devin session or Slack, e.g.:

- "ask perry to babysit this PR"
- "have perry review my PR"
- "get perry to drive #27306 to approval"

## Arguments

- `$PR_URL`: The GitHub PR to hand off, e.g. `https://github.com/OpenRouterTeam/openrouter-web/pull/27306`. If the current session created exactly one PR, default to that PR's URL without asking. Only ask the user if you cannot determine which PR they mean.
- `$MODE`: `babysit` (default), `review`, or `review stack`.
  - **`babysit`** — spins up a *separate* Devin session that drives the PR to Perry approval (addresses review comments, fixes CI, re-pings Perry until green + approved). Use it only when no live session owns the branch (a bare PR URL dropped in Slack). When the current session authored the PR, use `review` (or `review stack`) and clear the comments here with `resolve-pr-comments` instead: a second driver on a branch you still hold causes shared-branch races and, on a stack, de-syncs the layers.
  - **`review`** — Perry reviews the PR once and posts its verdict; nobody addresses the comments automatically.
  - **`review stack`** — one-shot review of every layer of a stacked PR in one message. Takes `$STACK_URLS`, the PR URLs ordered bottom (base on trunk) to top, instead of `$PR_URL`. Use it when the request is "review the stack"; several PRs named together are a stack, not an ambiguity to ask about.

## Fixed identifiers (not secrets — public Slack/workspace IDs)

| Thing | Value |
|-------|-------|
| `#agents-perry-reviews` channel ID | `C0C3BML1W7N` |
| Perry Slack user ID | `U0AQD847T6C` |
| Devin Slack bot user ID | `U076RQCCF2P` |

These are Slack member/channel IDs, visible to anyone in the workspace. Do **not** put API keys, tokens, or other credentials in this skill or in the posted message.

## Steps

### 1. Resolve the PR URL

Determine `$PR_URL`. If this session created a PR, use it. If there are multiple candidates or none, ask the user for the PR URL/number. Strip any Slack angle-bracket wrapping, link label, or `#issuecomment-...` fragment down to a clean `.../pull/<N>` URL.

For `review stack`, determine `$STACK_URLS` instead: every open layer, ordered bottom to top. Read the order from the PRs' base branches (`gh pr view <N> --json baseRefName,headRefName`) or `gh stack view --json`, not from the order the user typed them, and clean each URL the same way.

### 2. Compose the message

- **babysit** (default):

  ```
  <@U076RQCCF2P>!perry_babysit $PR_URL
  ```

  The `<@U076RQCCF2P>` mention invokes the Devin Slack bot, and `!perry_babysit` selects the org playbook that drives the PR to Perry approval. The mention must be the **first** thing in the message — a leading `!` before it is not picked up (see gotcha below).

- **review** (one-shot):

  ```
  <@U0AQD847T6C> review $PR_URL
  ```

  This is the only shape Perry answers. `!perry_review` is the name of the Devin playbook that posts this message, not a Perry trigger; when a playbook says "ping with `!perry_review`", post the mention shape above.

- **review stack** (one-shot, whole stack):

  ```
  <@U0AQD847T6C> review stack $STACK_URLS
  ```

  URLs space-separated, bottom to top. Perry reviews them in that order and posts a review on each.

### 3. Post to #agents-perry-reviews

Post the composed message to channel `C0C3BML1W7N` using the `slack-remote` MCP tool `slack_send_message` — params `channel_id` and `message`. Do not use `message_user` or the built-in `slack` tool for this: both post as the Devin bot, which Perry ignores. If `slack-remote` is missing or fails for lack of a token, stop and tell the user the message was not sent and that they need to connect Slack in the MCP marketplace (or post it themselves). Post it as a new top-level message in `#agents-perry-reviews` (no `thread_ts`). The response's `message_context.message_ts` is the parent `ts`; keep it for the next step.

### 4. Confirm pickup

Read the resulting thread with `slack_read_thread` — params `channel_id` and `message_ts` (the parent `ts` from step 3). Confirm that Perry (or the Devin bot, for babysit) acknowledged — pickup is typically within ~10 seconds. For `review`, Perry replies in-thread within about a minute with a `Reviewing #N ...` progress checklist, then posts the verdict in the same thread and as a `perry-the-pr-maintainer[bot]` review on the PR a few minutes later. Poll the thread, not only the PR. For `review stack`, Perry acknowledges once, then posts a `Reviewing #N` / `review complete` pair per PR in the order given and a final `Stack review complete` summary; confirm every layer got its pair before reporting. For babysit, the Devin bot replies with an "On it" line naming the PR (wording varies, e.g. "On it, driving PR #N to Perry approval.") plus a Devin session Webapp link. Report both the Slack thread link and the Devin session link back to the user.

**Never post the handoff a second time.** A missing acknowledgment does not mean no session was started — the session can be running silently and only surface in the thread much later, so a re-post buys you two sessions racing on one branch (see the gotcha below). If nothing appears, wait and re-read the thread; the handoff is a fire-and-forget action, and the recovery for a genuinely lost one belongs to the human. If the thread is still silent after ~15 minutes, check the PR itself for babysit activity (new commits, a Perry review, resolved threads) and report the silence to the user rather than re-posting.

If you have confirmed from the PR that no session ever started, the fixed identifiers above may be stale (workspace re-provisioning, bot re-install). Re-verify them against the live workspace — look up the `#agents-perry-reviews` channel and the Perry/Devin bot users via the Slack tool — and update this skill if they changed.

## Notes

- "Babysit" from the authoring session means `review` (or `review stack`) plus in-session `resolve-pr-comments`, re-pinging Perry yourself until approved. Post the `babysit` macro only when handing off a PR this session does not own. If the user asks for the macro anyway, say which shape you are posting and why.
- Perry keys off the sender as well as the content: it ignores any message authored by a Slack bot. `slack-remote` posts as the user who connected it (Slack shows a "Sent using Devin" footer), which Perry accepts. The babysit session spawned by the macro pings Perry the same way, as the user who posted the macro, so babysit only works when that user has Slack connected.
- A `Comments / questions` verdict is a `COMMENTED` GitHub review and stays that way after you answer and resolve every thread; Perry does not revisit a PR on its own. Re-post the same `review` or `review stack` once the threads are clear, even with no new commits, to turn it into an `APPROVED` review. Its approving re-review can still carry one inline question per PR, which `resolve-pr-comments` answers as usual.
- A `Request changes` review this session submitted itself (a `thermo-nuclear-code-quality-review` or `louis` pass) keeps the PR's `reviewDecision` at `CHANGES_REQUESTED` even after every thread is resolved and Perry has approved. Once its findings are fixed, dismiss it: `gh api -X PUT repos/<owner>/<repo>/pulls/<N>/reviews/<review_id>/dismissals -f message='...'` (verified 2026-09-28, PR #47446).
- Do not merge the PR yourself. After a `babysit` handoff, do not resolve Perry's review threads either, since the separate session owns them. After `review` or `review stack` on a PR this session owns, resolving them in-session with `resolve-pr-comments` is the expected next step.
- The babysit session writes to your PR: it pushes commits to your branch and rewrites the PR description. So after handing off, treat the branch and the description as shared. Re-`git fetch` before any push (a `--force-with-lease` prepared before the handoff will be rejected as stale, and rebasing must start from the remote head so its commits are not dropped), and re-read the description before trusting it — `git_update_pr` refuses to overwrite its edits without `force=true`. If you then change what its commits did, the description it wrote is stale and needs correcting. While the babysit session is live, observe a GitHub-native stack only with `git fetch` and `gh stack view`; do not run `gh stack sync` or `gh stack rebase`. After it finishes, follow [`stacked-prs`](../stacked-prs/SKILL.md) §Handling review feedback.
- Its commits are review-bearing but unreviewed by you. Read them end-to-end like any other diff before parking the PR: they implement Perry's suggestions literally, which can miss local convention (e.g. adding a paging Datadog monitor to a file whose monitors all deliberately omit the page mention until a consumer-enable flip).
- **Stopping a live babysit session** (verified 2026-08-21, PRs #35793/#35794): reply in that PR's handoff thread with a message that starts with the Devin bot mention and says to stop and not push further commits to the branch, e.g. `<@U076RQCCF2P> please stop this babysit session — <name> is taking over PR <N> manually. Do not push any more commits to <branch>.` Both sessions acknowledged within ~20s, summarized their final state, and stopped. Do this per PR — a session only listens to its own thread. Sessions that already reached Perry approval have exited on their own and need no stop. After stopping, `git fetch` before touching the branches: the sessions may have rebased, restacked, or appended commits you don't have locally.
- **Babysitting a stack de-syncs it.** Per-PR sessions rebase/append on their own branches independently (one may rebase the bottom layer onto latest main while another appends to a middle layer), so after parallel babysits expect layers to sit on divergent lineages. Verify with `git merge-base --is-ancestor <base> <top>` per adjacent pair and restack manually once the sessions are stopped or finished — and check the *timestamps*: a session can push to a base layer after another session restacked on top of it, so "restacked once" does not mean "consistent now".

## Examples

### Owned PR: `review` plus in-session resolution

Request: "Please babysit the PR." (this session created the PR)

Posted to `#agents-perry-reviews` (`C0C3BML1W7N`) via `slack_send_message`:

```
<@U0AQD847T6C> review https://github.com/OpenRouterTeam/openrouter-web/pull/44448
```

Perry replies in-thread with its verdict. Clear any threads with `resolve-pr-comments`, then re-post the same `review` message until Perry approves and CI is green. Report the thread link to the user.

### Unowned PR: `babysit` handoff (verified 2026-07-21, PR #29640)

Request: "Please babysit the PR." (bare PR URL, no live session on the branch)

```
<@U076RQCCF2P>!perry_babysit https://github.com/OpenRouterTeam/openrouter-web/pull/29640
```

~10s later the Devin bot replied in-thread: "On it — babysitting PR #29640 through to Perry approval." with a Devin session Webapp link. Reported the thread link and session link back to the user.

Handing off several unowned PRs at once is fine — post one top-level message per PR; each gets its own babysit session.

For a one-shot review of a whole stack, use the `review stack` mode above (verified 2026-09-12, #42329–#42331 and the ECO-3188 stack #40939–#40942). Prefer it over one babysit post per layer when the request is a review: parallel babysit sessions restack their own layers independently and de-sync the stack (see Notes below).

Note: the raw message body must contain the literal mention markup `<@U076RQCCF2P>!perry_babysit` — Slack renders it as `@Devin!perry_babysit`. The `!` immediately before the playbook name is required; do not drop it.

## Gotchas

- **No leading `!` before the mention** (verified 2026-07-27, PR #30879). A message starting with `!` (e.g. `!<@U076RQCCF2P>!perry_babysit <url>`, or `! <@U076RQCCF2P>!…`) is silently ignored — no thread reply, no session. Two such posts in `#agents` that day got zero pickup, while `<@U076RQCCF2P>!perry_babysit <url>` was acknowledged in ~13s. Start the message with the mention.
- **Silence in the thread is not a dropped post** (verified 2026-07-31, PR #31589). A correctly shaped post posted no acknowledgment for 13 minutes; treating it as dropped and re-posting produced a second babysit session, and the first one then woke up and posted its own Perry ping 17 minutes after its trigger. Two sessions ended up pushing commits to the same branch and pinging Perry separately for the same PR, which is exactly the outcome the handoff is supposed to avoid. Some babysit sessions never post an "On it" line at all and first appear in the thread only when they ping Perry, so absence of an ack proves nothing. Post once and wait.
- **A `review` run Perry itself reports as failed or interrupted is safe to re-post** (verified 2026-08-31, PR #38929). The post-once rule covers a *silent* handoff, not a one-shot review Perry has already declared failed. Confirm the PR carries no review, then post the same message again as a fresh top-level message. This does not extend to `babysit`: a failed Perry review inside a babysit run leaves that driver session alive, so stop it first (see below) rather than re-posting into a race.
- **Keep the PR URL on its own line, followed by a blank line** (seen 2026-09-13, PR #42469). Text on the very next line after the URL gets folded into the auto-link's label (`<…/pull/42469\nFollow-up|…>`). Perry still parsed the review request, but the rendered message is mangled; a blank line before any context sentence avoids it.
- **`review` pickup can take several minutes, not seconds** (seen 2026-09-28, PR #47477): first "On it" reply landed 7 min after the post and the `Reviewing #N` checklist a minute later, with the clone step alone at ~6 min. Keep polling the thread; do not treat a few silent minutes as a dropped post.
- **Verify pickup by re-reading the thread**, not by assuming. Acknowledgment is a `U076RQCCF2P` reply starting with "On it" and naming the PR, with a Webapp session link. Match on the sender and the link, not on exact wording. If nothing appears within ~60s, check recent `#agents-perry-reviews` history for the exact message shape other successful invocations used before touching the fixed IDs — the IDs are usually fine; the message shape is what drifts.
