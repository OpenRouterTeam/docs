---
name: resolve-pr-comments
description: Drive a PR's unresolved review threads to zero in the current session — fix, reply, resolve, keep the PR description's resolution log current, and escalate only the comments that genuinely need a human. Use after any review pass (thermo-nuclear, Devin Review, Perry, human reviewers) or when asked to "resolve the PR comments", "address the review feedback", or "clear the review threads". Not for "babysit this PR" — that hands off to Perry via ask-perry-babysit.
user-invocable: true
---

# Resolve PR Comments

The follow-through half of a review: a review that leaves 40 open threads has
produced a chore, not an improvement. This skill turns review output into
merged code with an auditable trail, and stops only where a human's judgment
is actually required.

Always invoked explicitly — no review skill starts this one for you, since a
review is frequently wanted without the follow-through. Pairs naturally with
`thermo-nuclear-code-quality-review`, which produces the comments.

## Not `ask-perry-babysit`

"Babysit this PR" belongs to `ask-perry-babysit`, not here. The two look
adjacent and are not interchangeable:

| | `resolve-pr-comments` (this skill) | `ask-perry-babysit` |
|---|---|---|
| Who does the work | You, in the current session | A separate Devin session, triggered from `#agents` Slack |
| Where the feedback comes from | Threads already on the PR, from anyone | Perry, which it also summons to review |
| Ends when | Every thread is fixed, declined, or tagged for the human | Perry approves and CI is green |
| Your branch | You are the only writer | The other session pushes commits and rewrites the description |

Rough rule: **this skill finishes a review that already happened; Perry babysit
procures a review and drives it to approval.** If the request names Perry or
asks for approval, hand off; if it is about the comments already sitting on the
PR, stay here. When it is genuinely ambiguous, ask — the handoff is a
fire-and-forget Slack post that is far more expensive to undo than this loop.

Do not run both on one branch at the same time — two actors pushing to the same
branch and resolving the same threads is the failure mode `ask-perry-babysit`
already warns about. If a babysit session is live on this PR, say so and stop
rather than racing it.

## Preconditions

- A PR exists for the current branch and is not closed. `gh pr view --json number,state,isDraft`
- You are on the PR branch with a clean working tree.
- Note the human to escalate to: the session requester's GitHub username
  (e.g. `@Robinnnnn`), falling back to the PR author.

## The Loop

Repeat until a pass produces no new actionable threads.

### 1. Fetch unresolved threads

Review threads (the primary input) carry resolution state; issue comments do
not. Fetch both, but only threads are tracked to zero.

```bash
read -r OWNER REPO < <(gh repo view --json owner,name -q '[.owner.login,.name] | @tsv')

gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          startLine
          line
          comments(first: 10) {
            nodes { databaseId body author { login } diffHunk }
          }
        }
      }
    }
  }
}' -F owner="$OWNER" -F repo="$REPO" -F pr=<PR> \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)]'
```

Keep each thread's `id` (to resolve) and its last comment's `databaseId` (to
reply). Skim `gh pr view <PR> --json comments` for context; treat a
conversation-level comment as actionable only if it contains an explicit
unaddressed request.

`perry-the-pr-reviewer` also puts findings in the review *body* with no inline
thread (two "observations" on #41585 next to an empty thread list). They need
a verdict like any thread; give it in the layer's top-level resolution comment,
since there is nothing to resolve.

cortex is the exception worth reading every pass (seen on #32072): it keeps one
consolidated issue comment that it rewrites in place on every push, and a
finding listed there can be genuinely open while the matching review thread is
already resolved — so an empty unresolved-thread list does not mean zero
findings. Each push also produces fresh file-level threads for whatever the new
diff exposes, including follow-ons to the fix you just pushed, so the loop ends
on cortex's latest consolidated verdict rather than on the first clean fetch.

### 2. Triage every thread into exactly one bucket

- **Fix** — correct, in scope, and the change is clear. Default bucket.
- **Decline** — wrong, already handled elsewhere, or out of scope. You still
  reply with the reasoning and resolve; a declined thread is a resolved thread.
- **Escalate** — needs a human. Reply tagging them, and **leave unresolved**.
  Escalate when, and only when:
  - the fix would reverse or contradict an explicit instruction from the
    requester in this session;
  - two reviewers ask for contradicting things;
  - it is a product/design/naming decision, not a code-quality one;
  - it is a low-severity nit or an edge case whose fix needs substantial new
    code — ask whether they want it rather than expanding the PR silently;
  - the change would widen the PR's blast radius beyond its stated scope
    (schema/migration, public API shape, cross-service refactor).

Never resolve a thread you did not actually address. Never quietly drop one —
every thread ends as fixed, declined, or tagged.

A thread that opens by calling itself a suggestion and not a blocker
(`perry-the-pr-maintainer` labels its own severity this way, seen on #32691)
still needs a verdict, and "non-blocking" is not one. Cheap and in scope means
fix it; duplicating an explanation already on screen means decline it with the
reason. A finding that only claims a risk — a framework constraint, a build
mode, a lock level — is answered with the check that settles it rather than
with reasoning about it, and the reply carries that evidence.

### 3. Fix in batches, then push

Group related fixes into one commit; push after each batch so replies can cite a real SHA. On a fresh checkout, `bun run format` needs the Node in `.node-version` (oxfmt refuses `packages/bench-harness/oxfmt.config.ts` on an older Node), and `services/batch-api` tests need `bun run --filter @openrouter-monorepo/chat-templates compile` first or every suite that reaches token-utils dies with `Cannot find module` (seen on #41583–#41588).

Add or update a test whenever a fix changes behavior (see AGENTS.md Testing).

A readability refactor can still change runtime behavior. Watch for calls to
mocked globals moving out from behind a short circuit: the router fixture
suite pins `Math.random` to a shared counter to make generated item ids
deterministic, so drawing one extra value anywhere in a priced request path
shifts every snapshot in `packages/router/tests/openai-responses-fixtures`.
When a fix touches sampling, ids, clocks, or uuids, run that suite and compare
the pass/fail counts against `origin/main` — it fails partly outside CI, so
zero failures is the wrong bar.

### 4. Reply, then resolve

Reply to the thread's last comment, then resolve it:

```bash
gh api --method POST \
  repos/{owner}/{repo}/pulls/<PR>/comments/<databaseId>/replies \
  -f body='Fixed in <sha>: <one line on what changed>'

gh api graphql -f query='
mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }' \
  -F id='<threadId>'
```

Pass the body via `--input <file.json>` rather than `-f body=@-`; with no
stdin, `gh` posts the literal string `@-` and still returns a comment id.

A Devin session can do both halves in one call instead: `git_comment_on_pr`
with `in_reply_to=<databaseId>` plus `resolve_thread_id=<threadId>` replies and
resolves atomically, so the reply cannot land without the resolve (seen on
#39007). Keep the `gh` commands for shells and for the resolve-only case.
To fix a reply you already posted in a thread, `gh api --method PATCH
repos/{owner}/{repo}/pulls/comments/<databaseId> --input body.json` — Devin's
`git_edit_comment` only edits top-level comments, and its wrapper rejects
`gh pr view`, so read reviewers from `gh api repos/{owner}/{repo}/pulls/<PR>`
(`requested_reviewers`) instead (seen on #41390).

After resolving, react on the original comment so the verdict is visible
without opening the thread: `+1` for a fix, `-1` for a decline
(`gh api -X POST repos/{owner}/{repo}/pulls/comments/<databaseId>/reactions -f content=+1`,
seen on #40794).

Reply first, resolve second — a bare resolve gives the reviewer nothing to
verify. For escalations, reply `@<human> <question>` and skip the mutation.
If the resolve mutation 403s (insufficient permissions on the repo), say so in
the reply and leave the thread unresolved rather than pretending it is done.

The two halves can have different permissions. On a Cursor cloud agent the
`gh` token is read-only for REST writes — the `/replies` POST and the
`/reactions` POST both 403 with `Resource not accessible by integration` —
while the GraphQL `resolveReviewThread` mutation succeeds, so a chained
`reply && resolve` leaves a bare resolve with no verdict on it (seen on
#41917). There, post the reply through the agent's PR tool (`in_reply_to`
= the comment's `databaseId`) and only then run the mutation; if the reply
half fails, do not resolve.

A Cursor cloud agent's `gh` is read-only (`Resource not accessible by
integration` on every POST) and it cannot edit a PR description it did not
create ("not agent-managed"): post, reply, and resolve through the agent's PR
tool instead, and put the resolution-log rows in your report for the author
to paste (seen on #42123).

Run these from a shell, not from a scripted subprocess: the `gh` on PATH is a
wrapper that resolves the token from the shell environment, and a subprocess
that misses it fails with `gh auth login` instead of a permissions error. A
sweep can also exhaust the installation's read quota, which 403s
`gh api repos/.../pulls/<PR>` and `git_view_pr` while replies still post — the
resolution log then has to wait for the reset rather than being skipped.

### 5. Update the PR description as you go

Maintain a resolution log in the description (`git_update_pr`), refreshed at
the end of every batch — not once at the end. One row per thread:

```markdown
## Review resolutions

| Thread | Verdict | Detail |
| --- | --- | --- |
| [file.ts:120](<thread url>) | Fixed | extracted `fooPolicy`, deleted the mode flag — `abc1234` |
| [bar.tsx:44](<thread url>) | Declined | already enforced by the Zod schema at parse time |
| [baz.ts:12](<thread url>) | **Needs @Robinnnnn** | rename touches the public SDK surface |
```

This is the deliverable the human actually reads; keep it accurate over
complete-looking.

On a Cursor cloud agent neither half can write the description: `gh pr edit`
403s (`updatePullRequest`) and the agent's PR tool refuses a body it did not
author. Post the same log as one top-level PR comment per layer instead, and
say in it that the description could not be edited (seen on #40939–#40942).

### 6. Re-check

Pushing triggers re-review (Devin Review, CI, humans), which produces new
threads. Loop back to step 1 after CI settles. Exit when the only unresolved
threads are escalations.

## Reporting

One message at the end: the PR link, the count fixed vs declined, and the
escalations as questions the human can answer inline. Do not narrate per-thread
progress — the description log is the progress report.

When a human has force-rewritten the branches since your last pass (a restack
onto main), sync every local branch to its remote tip first —
`git fetch origin && git reset --keep origin/<branch>` on each — before
committing or pushing anything; a push from the stale local tip silently
undoes the rewrite (seen on the ENT-2003 stack, #40253–#40278).

While restacking, re-check `git merge-base --is-ancestor origin/main <bottom>`
right before the push: tooling in the session (the `gh` wrapper on a Cursor
cloud agent) can run `git fetch origin main --deepen=200` behind you, and a
per-layer `git diff --name-only origin/main <branch>` then counts main's new
files as the layer's (seen on #41583, 20 files reading as 36). Restack once
more if main moved; the rebase is cheap when the layers touch no shared file.

When you are the one restacking a GitHub-native stack whose bottom layer was
squash-merged, `gh stack checkout <pr>` imports it but `gh stack rebase` then
stops with `could not determine the previous base` on every layer. Rebase each
layer by hand, bottom up, with `git rebase --onto <new base tip> <old base tip>
<branch>` — the old base tip is the parent branch's previous remote head, and a
layer whose history still carries copies of lower layers' commits needs the
range cut at the last such copy — then `gh stack push` (per-branch
`--force-with-lease`) and `gh stack unstack --local && gh stack checkout <pr>`
so `gh stack view --json` reads the new heads (seen on the ECO-3188 stack,
#40939–#40942).

CI on a red layer may be red for a reason its own diff cannot show: the
`lint-typecheck-test` runner resolves `.python-version` `3.12` to Ubuntu's
CPython 3.12.3 while `uv python install` gives a later patch release, and
`datetime.replace()` on a subclass behaves differently between them. Build a
second venv on `/usr/bin/python3` (`UV_PROJECT_ENVIRONMENT=... uv sync --frozen
--python /usr/bin/python3`, after `apt-get install python3-dev`) and reproduce
there before touching the code (seen on #40940).

Read CI from the runs, not only from `statusCheckRollup`. A force-push can
trigger two runs for the same head SHA one second apart; the concurrency
group cancels the first, and the rollup reports `FAILURE` for that SHA even
though the surviving run is green. Before calling a PR red, list
`gh run list --branch <head> --json headSha,status,conclusion,workflowName`
and disregard a cancelled run only when the same workflow completed
successfully on the same SHA; a success from a different workflow does not
clear it (seen on #40269).

On a stacked PR, a red check can also be stack drift rather than your
change: `refs/pull/<N>/merge` merges into the base PR's own merge ref, and so
on down to `main`, so a lower layer's fix (or a `main` change a lower layer
already adapted to) that has not been merged upward yet fails only on the upper
PR's CI. Before debugging, diff the failing file between the PR head and the
merge commit CI checked out (`HEAD is now at <sha> Merge <head> into <base>` in
the checkout log) and check `git log HEAD..origin/<lower-layer-branch>` for the
fix; the remedy is a restack, not a commit on the upper layer (seen on #42123,
whose `unit` failure was fixed in the routing layer's `ed5d990f436`).

On a stacked PR, a thread can land on the wrong layer: a stale merge base (or
a base branch force-updated mid-review) makes a lower layer's files appear in
an upper PR's diff, so the bot comments there (seen on #35794, whose watcher
finding belonged to base PR #35793). Fix on the layer that owns the file,
reply on the thread naming that base PR and commit, and log the resolution in
both descriptions.

## Improve this skill

Record it here when: a reviewer bot changes its comment format, a triage call
you made got overturned by the human (adjust the escalate list), or the GraphQL
shape/permissions change. Anchor each note to a PR number.
