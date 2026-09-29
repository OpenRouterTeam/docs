---
name: harness-bug-hunt
description: >-
  Hunt bugs in ori's builtin harness by driving real model turns at a local
  intern: start your own intern slot on the shared stack, run scenarios with
  `bun run intern:drive`, read the manifest, and follow one turn from the
  invoke stream to the request the provider saw. Use when you are looking for
  harness defects, measuring the turn error rate, or reproducing one someone
  else found.
user-invocable: true
---

# Harness bug hunt

The team's goal for ori's builtin harness is that fewer than 1 turn in 100 ends `turn.failed`, and that the ordinary provider problems — 429s, 5xx, stalls, streams that end early — are absorbed by retries the caller never sees. This skill is how you find out whether that is true, and how you turn "something felt wrong" into a finding somebody can act on.

It assumes you have never done this. Read it top to bottom once; after that, the sections stand alone.

You need [`local-intern-chat`](../local-intern-chat/SKILL.md) for the stack itself — what `tilt up -- --interns` brings up, where the telemetry goes, and how to put an unreleased ori build under test. This skill is only about driving turns at it and reading what comes back.

## First: prove the stack can answer at all

**A hunt on a stack that cannot reach a model measures nothing, and it does not
announce itself.** The stack degrades with `local-intern` still answering
`/health` with 200 and every container still `Up`. Measured 2026-09-19: a stack
up 22 hours had had zero model calls reach cfw-api since the previous day —
five workers were down after a lockfile bump on main, and the quick tunnel's
hostname had gone NXDOMAIN while cloudflared retried forever.

Run [`local-intern-chat` → *Before you trust a stack somebody left
running*](../local-intern-chat/SKILL.md#before-you-trust-a-stack-somebody-left-running)
before the first scenario. Then confirm with one turn that costs a tenth of a
cent:

```bash
bun run intern:drive services/cfw-secret-vault/scripts/local-intern-scenarios/plain.json \
  --slot <slot> --tag preflight
```

`turn.succeeded` with `retries: 0` means the whole path works. `retry.scheduled`
carrying `egress_upstream_unreachable` or `VAULT_DESTINATION_NO_DNS_RECORDS`
means the tunnel is dead and **nothing you measure after this point is about the
harness** — every turn will burn its whole retry ladder and then fail. Fix the
stack first; a run against a dead tunnel is slow, costs money, and produces a
failure rate that is entirely the stack's.

Two more that waste a morning each:

- **Never smoke-test with a bare `/api/invoke` body.** An invoke with no `model`
  runs on the daemon's configured default, which on this stack is
  `~anthropic/claude-opus-latest`. The `curl` in `local-intern-chat` is for
  proving the daemon is alive, not for a turn you intend to read — every
  scenario in `local-intern-scenarios/` names a cheap model on purpose.
- **macOS has no `timeout`.** `timeout 60 bun run intern:drive ...` exits 127,
  which reads as the driver failing. Use the scenario's own `turnTimeoutMs`, or
  run it in the background and poll.

## What a run costs, and how to keep it bounded

Turns cost real money at real list prices. A rough scale, measured over about 800 turns on 2026-09-16:

| shape of run | turns | spend |
| --- | --- | --- |
| a smoke turn on a cheap model | 1 | under $0.002 |
| a 100-turn session hunt on cheap models | ~100 | $0.15 |
| a compaction hunt across 7 model families | 114 | $2.03 |
| a 20-step coding hunt across 9 families | 129 | $9.49 |

Three things make a hunt expensive out of proportion to what it tells you, and all three are worth knowing before you write a scenario.

1. **Long sessions on frontier coding models.** Every turn re-sends the whole history. A five-turn Sonnet session on a coding task ran $0.20; the same task on a cheap model ran $0.04.
2. **A tool that returns something huge.** One model read a 1 MB file with a bad offset, the read was capped at 1 MB, and that megabyte was re-sent on every later turn: $1.99 for one run. An uncapped MCP result did the same at $0.23 a call.
3. **Anything that repeats a turn.** A retry, a compaction summary, a `switch-model` child and a structured-output repair run are each an extra billed request.

So: **name a ceiling before you start, and check it as you go.** Every run's `manifest.json` totals its own spend, per model and overall:

```bash
jq '.totals | {costUsd, turns, succeeded, failed, byModel}' .dev/local-intern/drive/*/manifest.json
```

Pick the cheapest model that can do the task. Reach for a frontier model only when the hypothesis is about that model's behaviour — a 20-step coding run, a long history, a provider-specific request shape. For everything about the harness itself (sessions, compaction, cancels, leases, forks, attachments), a cheap model gives the same answer for a fortieth of the money.

## Your own intern, and nothing else

**A shared `tilt up -- --interns` stack runs on this machine and other people are using it.** An intern slot is your own agent container and egress sidecar attached to it, sharing its vault, cfw-api, tunnel, collector and database.

```bash
bun run intern:slot up testbook
bun run intern:slot list
```

Your containers are `openrouter-local-intern-testbook` and `openrouter-local-vault-sidecar-testbook`. You may break those two. When you are finished:

```bash
bun run intern:slot down testbook
```

Never do any of these, whatever a result seems to demand:

- `tilt down`, `tilt up`, `tilt trigger` — the stack is not yours, and `tilt down` removes containers other sessions share.
- Anything to `openrouter-local-intern` or `openrouter-local-vault-sidecar` (no suffix). Those are the base stack's.
- Anything to a container carrying someone else's slot suffix. `bun run intern:slot list` and `docker ps` show whose is whose.
- `bun run services/cfw-secret-vault/scripts/local-fault.ts arm rate-limited` or `arm credential-missing` without `--slot`. Both spend or break shared state, so they hit every intern on the machine, slots included. Since ORI-2007 both are refused on a slot and reported as a blind spot rather than a pass; on the base stack they still work, which is the problem.
- `colima stop` / `colima start`. If the machine is in the state that tempts you, see [the traps](#the-traps-symptom-first).

Faults that *are* yours fire on your slot's vault edge only:

```bash
bun run services/cfw-secret-vault/scripts/local-fault.ts arm vault-5xx --slot testbook
bun run services/cfw-secret-vault/scripts/local-fault.ts disarm --slot testbook
```

To break your own containers mid-turn, prefer `docker pause` / `docker unpause` over `stop` / `start`: pausing keeps the published ports, and it is the cleanest way to make a stream stall on demand.

## Driving turns

Generate the fixtures once per checkout, then run a scenario:

```bash
bun run intern:fixtures
bun run intern:drive services/cfw-secret-vault/scripts/local-intern-scenarios/plain.json --slot testbook
```

`--slot` is what aims the driver at your intern. Without it every turn goes to the base stack's.

A scenario is a JSON file. This is the whole shape:

```json
{
  "runId": "compaction",
  "model": "openai/gpt-5.6-luna",
  "fixture": ".dev/local-intern/scenario-fixtures/compaction",
  "turnTimeoutMs": 600000,
  "turns": [
    { "prompt": "Work only in {{cwd}}. Remember the code word vermilion-otter, then read {{cwd}}/filler-1.txt and reply with its first line." },
    { "prompt": "In one sentence, what have we done so far?", "forceRollover": true },
    { "prompt": "What was the code word? Reply with only the code word.", "expectText": ["vermilion-otter"] }
  ]
}
```

Per turn you can also set `model` (switch mid-session), `sessionId`, `createSession`, `fork`, `outputSchema`, `parameters`, `attachments`, `cancelAfterMs`, `cancelAfterEvent`, `steerAfterEvent` with a `mode`, `hooks` that run a host command at a point in the turn, `waitBeforeMs`, and `expectText`.

Five of those need explaining.

**`{{cwd}}` in a prompt, and `{{sidecar}}` in a hook.** An intern ignores the `cwd` an invoke carries and runs every tool in `/workspace`, which every session on that intern shares. The driver gives each run its own `/workspace/runs/<runKey>` and substitutes it for `{{cwd}}`, so two runs at once cannot overwrite each other's files. Say `{{cwd}}` in every prompt that touches the filesystem. A scenario that does not is not measuring what you think it is: on 2026-09-16 two concurrent runs both wrote `/workspace/slug.ts` and one read the other's answer. A hook's argv gets the same treatment through `{{agent}}` and `{{sidecar}}`, which resolve to the containers of the slot you passed — **never hardcode a container name in a committed scenario**, or it faults whichever slot it names rather than the one running.

**`adoptSession`.** A compaction continues under a *new* session id. By default the next turn follows it, which is what Slack and the chat TUI do. Set `"adoptSession": false` on the run to keep sending the original id instead: that is the openrouter-web chat behaviour that re-compacts on every later turn and forgets (ORI-2014), and it is the only way to reproduce that class here.

**Pin `sessionId` on every turn of a session, or on none of them.** Mixing the
two manufactures the exact shape of the bug you are most likely hunting. The
driver only lets a turn that ran under the *run's own* session redirect the
rest of the run — a turn that pinned its own `sessionId` announces a session of
its own, and the run does not follow it (`recordAnnouncedSession` in
`services/cfw-secret-vault/scripts/local-intern-drive.ts`). So in a scenario whose first turns pin
`sessionId` and whose later turns do not:

- the pinned turn compacts and hands back a new session id;
- the run does not adopt it, because that turn was not running under the run's
  session;
- the next unpinned turn runs under the run's own session, **which no turn has
  ever used**, so the daemon mints a fresh empty one;
- the model answers "Unknown" to the memory oracle.

That reads as a session that forgot everything across a compaction, which is
ORI-2014, and it is entirely the scenario's doing. Measured 2026-09-19: two
concurrency runs both "lost" their code word this way. Driving the repo's own
`compaction.json`, which pins no `sessionId` at all, twice at once instead —
both runs 6/6 with the code word intact.

The manifest is how you tell, before you write the issue. A turn whose `sessionId`
is the run key rather than the id the earlier turns used started a new session:

```bash
jq -r '.turns[] | "\(.commandId) sent=\(.sessionId // "RUN-OWN") adopted=\(.adoptedSessionId // "-")"' "$RUN/manifest.json"
```

Pin ids only when the scenario genuinely needs one it minted — a fork's
`parentSessionId` is the usual reason — and then pin them on every turn that
must stay in that session.

**The run key.** A run is `<runId>-<tag>`, where the tag defaults to the wall clock. It names the run directory, the session and the workspace directory, which is what makes a scenario re-runnable. Pass `--tag control` when you want a run you can name in a report, and use a different tag for the other arm of an A/B.

**`createSession`.** The driver sends `"createSession": true` the first time it uses a session id, and you should never remove that. A session id the daemon has not seen makes it read and decode its whole event log before the turn starts — seconds of latency and hundreds of MB of RSS on a busy journal (ORI-2012). Every latency number you take without it is wrong.

**`hooks`.** A hook runs a host command `afterMs` into the turn, or when an event type first arrives, whichever comes first, once per turn. It is spawned rather than run inline, so a slow `docker pause` cannot stop the driver reading the stream and skew every timestamp after it. **A timed hook whose turn ended before its delay still runs, at the end of that turn**, as long as an earlier hook already fired — a timed hook is almost always the undo of one, and dropping it leaves your container broken for every later turn in the run. A timed hook with nothing fired before it is *not* run early, because it was going to introduce a fault rather than undo one. This is how you fault a turn from outside:

```json
{
  "prompt": "Write a 400-word description of what a vault sidecar does.",
  "hooks": [
    { "afterMs": 5000, "argv": ["docker", "pause", "{{sidecar}}"] },
    { "afterMs": 25000, "argv": ["docker", "unpause", "{{sidecar}}"] }
  ]
}
```

**Put a fault and its undo on the same clock.** Both timed, as above. Pairing an event-triggered fault with a turn-relative undo races, and on 2026-09-16 it lost: the model took 28 s to its first token, the 20 s unpause fired at 20 s against a container nothing had paused yet, the pause landed at 28.8 s, and the sidecar stayed paused for the rest of the run. The manifest is what showed it — `unpause@20001ms pause@28829ms`, in that order.

The field to read is `atMs` on each entry of a turn's `hooks` array — not
`firedAtMs`, which does not exist and silently reads as `null` through `jq`,
turning the one check that catches a fault/undo race into a blank:

```bash
jq -r '.turns[].hooks[]? | "\(.argv|join(" "))@\(.atMs)ms \(.outcome)\(.exitCode)"' "$RUN/manifest.json"
```

That pair is `stall.json`, and it produces the *absorbed* case: a 20 s outage inside one turn, which finishes with **zero** retries and no `content.retracted`. That is the check that a brief sidecar outage costs a caller nothing. To get the other case — `retry.scheduled stream_stalled` and the retraction that follows it — the pause has to outlast the stream's silence deadline, which is about two minutes, so push the unpause hook's `afterMs` past it and expect the turn to take about 150 s longer.

### Reading the manifest

A run leaves a directory under `.dev/local-intern/drive/<runKey>/`:

| file | what is in it |
| --- | --- |
| `manifest.json` | one entry per turn: terminal, failure, timings, usage, generation ids, hooks, and the run's totals |
| `events.ndjson` | every stream line, stamped with milliseconds since the invoke |
| `commands/<commandId>.json` | the exact `agent.invoke` body that was sent |
| `turns/<commandId>.txt` | the turn's assistant text, with retracted text already removed |

Start here every time:

```bash
RUN=.dev/local-intern/drive/compaction-143012
jq '.totals' "$RUN/manifest.json"
jq -r '.turns[] | "\(.commandId) \(.terminal) \(.failure.code // "-") wall=\(.wallMs)ms first_text=\(.firstTextMs)ms cost=\(.costUsd // 0) retries=\(.eventCounts["retry.scheduled"] // 0) missing=\(.expectTextMissing | length)"' "$RUN/manifest.json"
```

The fields worth knowing by name:

- `terminal` is `turn.succeeded`, `turn.failed`, `turn.cancelled`, `turn.interrupted`, or `none`. **`none` is not a synonym for failed** — it means the stream closed without a terminal event, which is what a rejected fork, a cancel, or a frozen daemon looks like. The totals count them separately for that reason.
- `failure` is the whole `{code, kind, stage, retryable, attempts, upstreamStatus, message}`. `stage` says which layer refused: `provider`, `egress`, `harness`.
- `generationIds` is the join key into the router logs — see [the evidence map](#the-evidence-map).
- `adoptedSessionId` is the id the session ended the turn under. **When it differs from `sessionId`, a compaction handed you a new session and the next turn must use it.**
- `expectTextMissing` is the memory oracle: every string the scenario said the answer would contain and it did not. A run with any of these exits non-zero.
- `eventCounts` counts every event type the stream carried, including ones the driver does not understand, so a new event type shows up as a number rather than vanishing.
- `hooks` says what each one did: `outcome` is `exited` with an `exitCode`, `signalled` with the `signal` that killed it, or `spawn-failed`. **Check it whenever a scenario injects a fault** — `docker pause` on a container already paused exits 125, and a fault that never took makes the turn after it look healthy for the wrong reason.

To see the shape of a turn rather than its summary:

```bash
jq -r 'select(.turn == 3) | "\(.t)ms \(.line.event.type // .line.type)"' "$RUN/events.ndjson" | uniq -c
```

## The evidence map

Ports move. With `bun run dev:ports on` nothing is on its default except the base intern's 7070, so read the real numbers off Tilt rather than from here:

```bash
tilt get uiresources -o json | jq -r '.items[] | "\(.metadata.name) \([.status.endpointLinks[]?.url] | join(" "))"'
```

| what you want to know | where | how you find it |
| --- | --- | --- |
| what the caller saw | `events.ndjson` in the run directory | the turn number |
| what ori did internally | `.dev/otel/logs.jsonl` | grep the run id or session id |
| **what ori sent to the model** | `services/dev-fs-logs/.logs/<generationId>/router/original-request.log` | a generation id from the manifest; `json.input` is ori's Responses input |
| what cfw-api turned that into | the same directory's `router/request-body.log` | the converted chat form — **not** what ori sent |
| which host the call arrived on | the same directory's `router/original-request.log` | the URL field |
| the session ori tagged the call with | the same directory's `router/transaction-attempt.log` | `session_id` |
| outcome counts | `curl -s localhost:8889/metrics \| grep ori_` | `ori_agent_runs_total` by `model`, `outcome`, `error_class` |
| daemon errors that never reach the stream | `docker logs --since 10m openrouter-local-intern-testbook` | read the tail |
| the trace | Jaeger, service `ori` | a session-id tag |

Two of those rows carry a warning.

**`original-request.log` versus `request-body.log` is the single most load-bearing distinction here.** Half the harness questions are "did ori send what it thinks it sent", and only `original-request.log` answers it. `request-body.log` is cfw-api's converted chat form, and a difference between the two is a router finding, not a harness one. The cancelled-web-results bug of 9 September was exactly this: ori *did* send `openrouter:web_search` items, and the router's Responses-to-chat fold dropped them.

**A turn's Jaeger trace stops at ori.** It has `ori.run` and `ori.turn` and no model-call span, so you cannot follow a turn to the provider in Jaeger. Use the generation id. And on a turn cfw-api serves through its server-tools path, the reported generation id names the *outer* server-tools generation: that directory has the request ori sent but no `transaction-attempt.log`, and the provider attempt is logged under a separate inner generation. Neither join key reaches the provider request on those turns. Do not spend an hour on it; note it and measure something else.

## The bar for calling something a bug

A finding is worth filing only when all four of these hold, and the report has to show each one.

1. **Reproduced.** Twice, or once with a mechanism that explains why it must happen. Cite run keys and the raw event lines.
2. **Root cause read in code, on `origin/main`.** Not on your branch, not from memory. `git -C ~/c0de/ori fetch origin main` then `git -C ~/c0de/ori show origin/main:<path>`. Quote file:line.
3. **Checked against intent.** Search ori's own docs before deciding it is wrong: `git -C ~/c0de/ori grep -n -i "<term>" origin/main -- docs/engineering docs/rfcs`. If a doc, an RFC or a test says the behaviour is deliberate, it is not a bug. Say which documents you read and what they said.
4. **Every caller of the thing you would change, traced.** Name them. If the fix changes a contract, say who breaks.

**Three issues were cancelled on 2026-09-16 for skipping 3 and 4**, after the code was already being written:

- An intern ignoring the invoke's `cwd` looked obviously wrong. Refusing it needed an `AgentRunConfig` contract change and broke `eval --hermetic`, composed features and `ori tui --cwd`, all of which pass `cwd` deliberately.
- A generic `turn.failed` message ("The model provider rejected the request as invalid") while the daemon log had the real reason looked like lost information. ori's own error standard, in docs/engineering/error-standard.md, forbids quoting upstream text in a user-facing failure.
- Compaction events carrying unrelated run and turn ids looked like a correlation bug. Nothing reads them.

Two more rules that save time:

**Model quality is not a harness bug.** A model doing a task badly from a correct request is a model result. It becomes a finding only if the harness sent it a broken request — and `original-request.log` is how you tell.

**A local-only divergence is not a harness bug either.** See [the traps](#the-traps-symptom-first) for the list.

## Measuring the error rate, and why you still need oracles

The manifest gives you the rate directly, per model:

```bash
jq -r '.totals.byModel | to_entries[] | "\(.key) turns=\(.value.turns) failed=\(.value.failed) rate=\(.value.failedRate) noTerminal=\(.value.noTerminal) $\(.value.costUsd)"' .dev/local-intern/drive/*/manifest.json
```

`failedRate` is failed turns over turns that *settled*, because a turn that never reached a terminal is a different defect from one that failed, and averaging them together hides both.

Now the uncomfortable part. On 2026-09-16, across roughly 800 turns, the turn error rate excluding injected faults and local-only divergences was **zero**. Every real harness bug found that day produced no failed turn at all:

- a session that quietly forgot everything before a compaction, because the caller kept the pre-compaction id and re-compacted on every later turn (ORI-2014);
- a turn that under-reported its own cost by 22%, because the compaction summary's request was not counted (ORI-2006);
- a daemon that took 22 seconds to answer and grew by 3 GB, because a session id arrived without `createSession` (ORI-2012);
- an answer that carried a withdrawn partial from a failed attempt in front of the real one, so a structured-output caller silently ran the whole job twice (ORI-2020);
- a steering message that was never delivered and never answered, leaving the sender waiting five minutes (ORI-2022).

**So a hunt that only counts terminals finds nothing.** Every scenario needs at least one oracle — something outside the turn that says whether the turn was right.

**Did it remember?** Plant a code word in turn 1 and ask for it after the event you are testing, with `expectText`. That is what `compaction.json` does. The driver honours `content.retracted` when it collects the answer, so a withdrawn partial cannot accidentally satisfy the check.

**Never plant a random hex string as the code word.** A model recalls
`vermilion-c4acc9` and writes `vermilion-c4acc` — it drops or transposes a
character of a token that carries no meaning, and `expectText` is an exact
substring match, so the oracle reports the memory as lost. Measured 2026-09-19:
this produced two separate false ORI-2014s in one session, each off by exactly
one trailing character, once across four consecutive compactions (so the
truncation had been written into the compaction summary and then faithfully
repeated) and once after a mid-tool-call container restart. Both looked exactly
like the bug they were imitating.

Use a pair of ordinary words a model cannot mangle without noticing —
`vermilion-otter`, `harbour-lantern` — and when a memory oracle fails, read the
answer in `turns/<commandId>.txt` before you believe it. An answer that is one
character short of the code word is a model result, not a harness defect.

**Did it remember, given what the mode promised?** Two scenario knobs mean the
answer moves, and both produced a false negative before this was written:

- `steerAfterEvent` with `"mode": "queue"` delivers the message **with the next
  prompt**, not into the turn it fired on. A turn-2 steer therefore lands on
  turn 3, and turn 3 answers the steer rather than your question.
- `fork.upToUserMessage` is 0-based and keeps the messages **before** that
  index, so `0` forks a session with no history at all. A fork that answers
  "none" there is correct.

**Did the cost match?** Take the turn's `generationIds` and add up what the router actually billed, then compare with the turn's `costUsd`:

```bash
jq -r '.turns[] | "\(.commandId) reported=\(.costUsd) gens=\(.generationIds | join(","))"' "$RUN/manifest.json"
ls services/dev-fs-logs/.logs/ | grep <generation id>
```

A turn that ran a compaction summary, a retry or a `switch-model` child should report more than one generation. One generation on a turn that visibly compacted is the shape ORI-2006 had.

**Did the next turn work?** End every scenario with a cheap throwaway turn — "reply with the single word still-here" — with `expectText`. It costs a fraction of a cent and it is the check that catches a session the previous turn quietly killed, which is how both image bugs (ORI-2018, ORI-2019) and the MCP name bug (ORI-2021) were found.

**Did the file change?** For a coding scenario, the answer is on disk. The workspace is bind-mounted, so check it from the host, and run the oracle tests the agent never saw:

```bash
docker exec -w /workspace/runs/coding-143012 openrouter-local-intern-testbook sh -c 'bun test ./invoice.test.ts; bun test ./invoice.oracle.ts'
```

`bun test <file>` is a name filter in Bun 1.4. Pass `./<file>` or it reports "had no matches" and exits non-zero on a file that is fine.

## Where the bugs were

Five areas produced nearly every confirmed finding. Start here.

1. **Compaction handoffs.** A rollover runs its continuation under a *new session id*. Everything that is keyed by session id is a candidate: a caller that does not adopt the new id re-compacts forever and forgets (ORI-2014); a message held on the parent's inbox is never drained by the child (ORI-2022); two sessions compacting at once collided on a shared harness slot and one summary fell back to a 4,000-character projection (ORI-2013); the summary request's own cost went unreported (ORI-2006).
2. **Restarts and leases.** A graceful stop during a tool call left the session lease held for 30 seconds, so the follow-up branched from an empty root and the agent said it had never spoken to you (ORI-2015). Drive this with a `hooks` entry on `tool.started`.
3. **Session id changes.** A new id without `createSession` scans the whole journal (ORI-2012). A fork that also carries a `sessionId` is rejected — and used to be rejected with HTTP 200 and an empty body (ORI-2011). `upToUserMessage` is 0-based and must be below the number of user messages so far.
4. **Concurrency.** Two sessions doing the same thing at the same moment is where shared state shows up. Keep it to five concurrent sessions or fewer, for the reason in the traps below.
5. **Images in history.** An image the provider or the egress path refuses stays committed to the session and breaks every later turn, text-only ones included (ORI-2018). Two ordinary screenshots exceed the 10 MiB egress body cap while ori's own limits are 20 MB per turn and 64 MiB per session, so the budget that would shrink the request never engages (ORI-2019). `images.json` is the short version of both.

## The traps, symptom first

**`docker ps` hangs or fails, every published port is refused, and `colima status` still says Running.** The Colima VM OOM-killed something, and the Lima ssh ControlMaster died with it, taking the host's docker socket and every published port. The containers are still running inside the VM. **Stop driving turns, mark everything since as outage-contaminated, and report it.** Do not restart Colima yourself and do not hand-roll ssh forwards. The fix is `colima stop && colima start --cpu 8 --memory 20` plus restarting the stack's containers, and it belongs to whoever owns the stack. **Colima needs 16 GiB or more to run this stack with slots on it**; 8 GiB is where this happened.

**Every new connection anywhere fails with `can't assign requested address` — your turns, `curl`, even `gh`.** The Mac is out of ephemeral ports (about 16k of them). Each streamed delta makes cfw-api's dev-only logging open 0.6 to 0.8 new localhost connections, each holding a port for 30 seconds, so about a dozen concurrent streams exhaust the range (ORI-2023). It is local tooling, not the harness, but it caps how hard you can push. Watch it:

```bash
netstat -an -p tcp | awk '{print $6}' | sort | uniq -c
```

Keep concurrency at five sessions or fewer, and stop and report if `TIME_WAIT` passes 10,000.

**Turn 2 of a session retries forever and never settles after you restarted a container.** Before ORI-2007, `docker stop` / `start` of a slot container moved its published port, and a restarted *sidecar* stranded the agent permanently. `docker pause` / `unpause` keeps the ports and is what you want anyway. The driver re-reads the intern's port from `docker port` before every turn, so it survives a moved agent port on its own; nothing can rescue a moved sidecar port mid-session.

**Every intern on the machine starts failing with 429s, or with a missing credential, and you only armed a fault on your slot.** `rate-limited` and `credential-missing` are shared state: they spend or break the one seeded intern identity the whole stack uses. Since ORI-2007 both are refused with `--slot` and reported as a blind spot rather than a pass. Do not work around that by arming them on the base stack.

**An HTML page with `Retry-After` arrives in the middle of your NDJSON stream, or a server-tool turn stalls for about 60 seconds.** Local only. The model path runs through a trycloudflare quick tunnel, which turns an upstream 502 or 504 into an HTML error page, and locally every server-tools turn loops cfw-api through that tunnel back to itself, so one upstream failure costs about a minute. Never count either against the harness. `stack-fidelity` prints the current divergence list at the top of its log.

**A model slug that works in production is rejected with a 400 "invalid model ID".** The local cfw-api catalog does not carry every slug. Check before you write a scenario around one:

```bash
curl -s localhost:21021/api/v1/models | jq -r '.data[].id' | grep <vendor>
```

**An ori CI check is red on tests that have nothing to do with your diff.** Two known flakes, both arrived with ori#2645 and both fail under CI and merge-queue load while passing locally: the `CliLogSinkLive` and eval-rollup property tests (`Property falsified`), and the `TUI attachment queue` frame tests ("Timed out waiting for frame predicate"). Re-run; do not debug them as your own.

**A finding that is really about the local stack.** Several real defects found this way live in openrouter-web, not ori: the port exhaustion above, the router dropping server-tool results from replayed history, and the workers that never got the collector's port. They are still worth filing — against the right repo.

## Reporting

Report in four parts, in this order:

1. **Confirmed bugs.** One line each saying what a person experiences, not what the mechanism is. Then the reproduction (run keys, models, raw event lines), the root cause as file:line on `origin/main`, which docs you checked and what they said, the callers you traced, the smallest fix, and how a live run would prove the fix.
2. **Observed but not confirmed**, each with the one thing that is missing.
3. **Checked and designed, or not a bug**, one line each with the doc or the reason.
4. **The numbers**: turns driven, turns failed by code, turns with no terminal, retries seen, and spend.

Never file an issue from a symptom alone, and never file one you have not read the code for. Two issues were cancelled within twenty minutes of being written for exactly that.

## Related

- [`local-intern-chat`](../local-intern-chat/SKILL.md) — the stack itself: what `--interns` starts, the telemetry sinks, slots, and building an ori branch into a runtime image.
- `services/cfw-secret-vault/scripts/local-intern-drive.ts` — the driver, and the spec's full field list.
- `services/cfw-secret-vault/scripts/local-intern-scenarios/` — the scenarios and their fixture generator.
- `services/cfw-secret-vault/scripts/local-fidelity/` — the stack fidelity gates, including `intern-turn`, which drives one turn as a startup check.
