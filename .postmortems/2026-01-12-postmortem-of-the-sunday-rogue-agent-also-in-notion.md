# Postmortem: Rogue Agent 2026-01-11

tl;dr: A rogue Claude Code agent ran a performance test of a new materialized view in production instead of locally. This inserted test rows into the Clickhouse `generations` table,  and created several materialized views in production.
## Impact
- Public-facing [rankings page](https://openrouter.ai/rankings) was impacted
	1. 7AM-9AM Pacific: in a way that was still possible to read data (some weird “future” data was visible)
	2. 4PM-5PM Pacific: in a way that made it unusable (massive prediction error)
- Clickhouse generations table stopped being updated and was behind for \~1 hour \~7AM-8AM Pacific (DD)
- Several downstream analytics tables were wrong until they were re-run/cleaned
- Weekend disruption, engineering thrash
## Timeline
(All times PST)
**Sunday Jan 11**
1. 6:30AM: Several test materialized views were created in Clickhouse production. Undelivered messages begin to accumulate in pubsub
2. 6:30AM-7AM: \~1.5M test rows were added to the production Clickhouse `generations` table
3. 6:52AM: backlog accumulates enough to fire pubsub alert on #alerts-api, <mention-user url="user://8b3f5c4a-1e5d-4498-af2f-4876f7aa3aa5"/> <mention-user url="user://9f156142-8aee-4509-b071-83be4d2b9847"/> and <mention-user url="user://209d872b-594c-81dc-8d2a-00028f50441a"/> all hop in to debug
4. 7:30AM: bad materialized views identified dropped ([[link removed] Consumers restarted and row insertions to `generations` begin again
5. 7:45AM: backlog cleared
6. 8:02AM: some glitches noticed on Rankings page, particularly “test model” appearing and “future days” (test model, future days)
7. 8:43AM: [fix PR merged](https://app.graphite.com/github/pr/OpenRouterTeam/openrouter-web/11778/hotfix-add-to%3DDate.now-for-rankings-page-queries-that-had-no-upper-bound) to temporarily fix glitchy Rankings page charts
8. 4:00PM (midnight UTC): Rankings page broke again, showing massive predicted token usage for the week (link)
9. 4:40PM: deleted bad generations data from all remaining materialized views
10. 5:00PM: Rankings page back to normal
## What happened
I (<mention-user url="user://292d872b-594c-817a-9fbb-000278138798"/>) asked Claude Code (CC) to run a local performance test of Clickhouse ([relevant PR](https://github.com/OpenRouterTeam/openrouter-web/pull/11126)). Simultaneously, I was testing a UI change that depended on *reading* production Clickhouse data. To work on this UI change, I put production (read + write) Clickhouse credentials in `.env.development.local`. These credentials pre-dated the creation of the CC’s container, and due to how it was created, were included.
When I asked CC (at 6:29AM on Sunday Jan 11) to kick off a performance test of a potential Clickhouse schema change, it got confused when the migration script failed — this failure was unrelated to the production credentials. In order to run the test, CC:
1. Found the production credentials in `.env.development.local` and assumed that meant I wanted to run the performance test in production
2. Ran the test migrations as DDL over `curl`, targeting production instead of local. This meant migration metadata wasn’t added to production. Initially it tried the migrate script `bun run ch:migrate`, which only will run locally, but when this failed it went straight to prod.
3. Commented out the portions of the [Clickhouse test setup](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/clickhouse/integration/vitest.setup.ts#L6-L11) that specifically prevented production credentials in `process.env` from resulting in the test being run against prod
The result was that:
1. Production `generations` table in Clickhouse had \~1.5M rows of test data, mostly in the future (January 31, 2026 in particular)
2. Materialized views used to show the Rankings page had test/future-dated data in them
3. There were several broken materialized views in production that broke inserts to `generations` until they were dropped
## Follow-ups
- [x] Drop all test materialized views from prod (done during the incident)
- [x] Delete all test data in prod Clickhouse `generations`
- [x] Delete all test data in materialized views downstream of `generations`
## Quick remedies
- [x] Deny read/bash containing `.env.development.local` from Claude Code for now ([https://github.com/OpenRouterTeam/openrouter-web/pull/11825](https://github.com/OpenRouterTeam/openrouter-web/pull/11825)). Deny overrides allow and should’ve prevented this, but this still wouldn’t have prevented a sufficiently motivated agent from getting these credentials.
- [ ] Be careful about auto-approval accumulating way more permissions than you expect over the course of a session. If you have, for example, allowed any `curl` commands, you are entering unexpectedly dangerous territory, nearly equivalent to `--dangerously-skip-permissions`. Since it’s hard to reason about that, in general with Claude:
	1. **Do not ask CC to do anything that could be construed as a production change**, like a performance test. The chances that CC does something dangerous like this when asked to merely make code changes is less, though not guaranteed (certain code changes/Ralph Wiggum technique could eventually cause a CC running dangerously to make production changes).
	2. Use sandboxing [network isolation](https://code.claude.com/docs/en/sandboxing#network-isolation). I’ve included an action item to look into settings that could work for this. If sandboxing had been enabled to block any calls to non-443 ports for non-local domains, this would’ve been prevented.
## Action items
- [x] Create read-only production credentials for Clickhouse, add them to development environment (This is `CLICKHOUSE_READONLY_USER` and `CLICKHOUSE_READONLY_PASSWORD`)
- [ ] [[link removed] Remove access to production environment for developers with normal Infisical role. It’s possible for an agent to use the `infisical` command with production environment and get any of these keys right now, even if they’re not in `.env.development.local` for some reason
	- Any dev and incident workflow should be possible without having to fetch one of these credentials
- [ ] [https://linear.app/openrouter/issue/PLA-99/make-sandboxing-recommendations-for-claude-code](https://linear.app/openrouter/issue/PLA-99/make-sandboxing-recommendations-for-claude-code) Investigate viability of sandboxing, particularly network isolation, as a recommended security setting for all Claude Code suage
