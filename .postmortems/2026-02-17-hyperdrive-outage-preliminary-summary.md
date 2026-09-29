Here's the postmortem compiled from all the Slack messages and threads:
-------------------------
_Postmortem: Hyperdrive / PostgreSQL Outage — February 17, 2026_
_Incident Summary_
| Field | Detail |
| - | - |
| _Date_ | February 17, 2026 |
| _Duration_ | ~45 minutes (05:27 – ~06:12 UTC) |
| _Severity_ | SEV-1 — Full API outage |
| _Impact_ | All API endpoints returned 500s, followed by 401s. Users could not make completions, embeddings, or message requests. The [openrouter.ai](http://openrouter.ai) website also experienced auth failures. Revenue dip detected by monitoring. |
| _Incident Commander_ | John Krauss |
| _Responders_ | Tomas Oliva, John Krauss, Louis Vichy, Alex Atallah, Robert Yeakel, Audrey Lorberfeld, Adrian Hale |
-------------------------
_Timeline (all times UTC)_
| Time | Event |
| - | - |
| ~05:21 | First "experienced Postgres error on read-only query" errors appear in logs (identified retrospectively). |
| ~05:27 | 500 errors begin on API endpoints. |
| ~05:40 | Transaction inserts stop entirely. |
| ~05:42 | Cloudflare Hyperdrive connection errors spike — `write CONNECTION_CLOSED` and `write CONNECT_TIMEOUT` on `*.hyperdrive.local:5432`. Error logs jump from near-zero to _~160k entries/minute_. |
| 05:43 | _Tomas Oliva_ alerts the team: "@here hyperdrive shitting the bed." Shares Cloudflare Main dashboard screenshots showing error spike and latency increase (500ms -> 750ms+). |
| 05:44 | _John Krauss_ confirms the outage, reports 401 errors ("user not found") as a secondary symptom. Asks about switching to replica. |
| 05:47 | _Tomas_ declares: "I think we are fully down now." Pings @channel. |
| 05:48 | _Robert Yeakel_ reports 401 errors from the LLM API. Incident huddle started with 7 participants. |
| 05:49 | _Tomas_ begins updating the public status page. |
| 05:51 | _John_ observes: "api key reads went nuts right at the start of this." |
| 05:58 | _Tomas_ triggers Devin investigation — Devin identifies two concurrent issues: (1) Hyperdrive PostgreSQL connection failures, (2) 401 Unauthorized errors in `getContextSA` (Clerk auth). |
| 06:01 | _Louis Vichy_ shares Hyperdrive cache dashboard URL for `pg2`, showing massive error spike. |
| 06:04 | _John_ scales `queue-worker-insert-transactions-shard-0` replicas to _0_ to relieve DB pressure. Confirms inserts stopped. |
| 06:09 | _John_: "looks like we're partially recovered." |
| 06:11 | _John_: "401s are gone." |
| ~06:12 | Datadog "Recovered" alerts fire for all API routes. |
| 06:17 | _John_ scales workers back to 1 to resume transaction inserts cautiously. Notes partial backup started at ~05:57 UTC. |
| 06:18 | _Tomas_: "We are back online, just letting backlog accumulate." |
| 06:19 | _Tomas_ identifies a spike in index scans at ~05:28 UTC on Supabase. |
| 06:22 | Datadog alert: PubSub backlog at _67,423_ undelivered messages. |
| 06:25 | _John_ identifies "experienced Postgres error on read-only query" as the leading indicator. |
| 06:31–06:43 | Team identifies spammy IPs hitting free models at >20 RPM. _Louis_ traces to user `user_2rvFAeYMX349uNpRvZU3mYwIsla`. |
| 06:47 | _John_: "Postgres health seems ok. Bringing us up to 4 — caches for api_key checks are back." |
| 06:49 | _Tomas_: "We are rate limiting the spammy IP on CloudFlare." |
| 06:50 | _Louis_ adds new Cloudflare rate-limiting rule: block IP for 1 min after 20 req/min on free tier. |
| 07:04 | _John_ scales back to 3 replicas. Backlog fully recovered. |
-------------------------
_Root Cause_
_Primary:_ Cloudflare Hyperdrive (connection-pooling proxy between Cloudflare Workers and PostgreSQL/Supabase) experienced cascading connection failures — `CONNECTION_CLOSED` and `CONNECT_TIMEOUT` errors.
_Contributing factors:_
1. _Index scan spike_ at ~05:28 UTC may have overloaded the PostgreSQL connection pool.
2. _Abusive traffic_ — a single IP hammering free-tier models at >20 RPM, generating uncached `checkRateLimits` and `getUserByKey` DB queries.
3. _Transaction insert queue workers_ adding write pressure concurrently with read-path failures.
_Cascading effect — 401 errors:_ When Hyperdrive couldn't reach PostgreSQL, API key lookups (`getUserByKey`) failed, causing the router to return "User not found" (401) to all users. The 401s were not an auth issue — they were a direct consequence of DB connectivity failure.
-------------------------
_Impact_
• _All API routes_ returned HTTP 500/401 for ~45 minutes
• Affected: `/api/v1/chat/completions`, `/generation`, `/embeddings`, `/messages`
• [_openrouter.ai](http://_openrouter.ai) website_ auth failures
• _Revenue dip_ detected by monitoring
• _Transaction backlog_ of 67,423 messages in PubSub
-------------------------
_Mitigation Actions Taken_
1. Scaled `queue-worker-insert-transactions-shard-0` to 0 replicas (kill writes)
2. Updated public status page
3. Gradual worker scale-up (0 -> 1 -> 2 -> 4 -> 3) while monitoring DB health
4. Identified and rate-limited abusive IPs on Cloudflare
5. Added CF rate-limiting rule: block after 20 req/min on free tier
6. PR #14051 created: `fix(db): add per-instance query timeout to replica routing`
-------------------------
_Open Questions (raised by Audrey Lorberfeld)_
1. What exactly do we use Hyperdrive for vs direct PostgreSQL connections?
2. Why did killing insert workers help resolve 401s — purely DB connection pressure relief?
3. Clarification on `pg2` vs Supabase architecture
-------------------------
_Action Items_
| # | Action | Owner | Priority |
| - | - | - | - |
| 1 | Review and merge PR #14051 (per-instance query timeout) | John Krauss | P0 |
| 2 | Implement caching for `checkRateLimits` | TBD | P1 |
| 3 | Harden free-tier rate limiting beyond specific IPs | Louis Vichy | P1 |
| 4 | Add Hyperdrive connection health monitoring (early alerting) | TBD | P1 |
| 5 | Document DB architecture (Hyperdrive, pg2, Supabase, replicas) | TBD | P2 |
| 6 | Investigate index scan spike root cause | TBD | P2 |
| 7 | Return 503 instead of 401 when DB is unreachable | TBD | P2 |
| 8 | Evaluate Hyperdrive connection pool sizing | TBD | P2 |
-------------------------
_Lessons Learned_
• _Hyperdrive is a single point of failure_ for all DB reads in the Workers path
• _401 errors were misleading_ — should distinguish "user not found" from "unable to verify user"
• _Leading indicator appeared ~20 min before full outage_ — better alerting on "Postgres error on read-only query" could enable earlier intervention
• _Free-tier abuse can cascade into DB pressure_ — edge rate limiting is critical
• _Incident response was effective_ — huddle in 5 min, mitigation in 20 min
