*Undefined Environment Variable Outage*

*Incident Huddle Link:* https://openrouter.slack.com/archives/C0594EAV9U6/p1752595217186829
*Type:* Outage and telemetry blackout
*Duration:* 11:55 AM–12:12 PM EDT (approx 17 min)
*Root Cause:*
A file imported at module level had a side-effect: it eagerly constructed a Google classifier instance, which itself constructed a Redis cache. This triggered reading and populating of environment variable state during module import, *before the request context/environment was set up.* As a result, the system "detected" the environment as `undefined`, causing:
• Crucial logic (such as queueing and logging) to no-op or behave incorrectly.
• Telemetry/logging blacked out (telemetry pipeline skipped).
• Essential write operations (DB, Pub/Sub) to be skipped or run in single-threaded fallback modes, overwhelming databases.
*Impact*
• Users were not able to reliably hit our API
• Our website was down
• We lost most of the Clickhouse data during this time.
*User Facing Issues*
• Users were not able to reliably hit our API
• Website did not load
*Supporting Details*
:chains: *Sequence of Discovery*
1. *Outage Manifestation*
• Lack of expected DataDog log/telemetry output.
• Supabase/Postgres become overwhelmed with direct insertions at because tasks that should have been queued instead fell through to "in-process" fallback logic. This reduced the rate of insertions (~1k rows/s → 450 rows/s).
• Clickhouse had very few inserts (~1k rows/s → 2 rows/s)
• API requests failed due to the underlying databases being overwhelmed and the caches being impacted by the incorrect environment.
2. *Initial Hypotheses*
• Suspected issue with failing to enqueue jobs due to failures in fetching/parsing environment variables.
• Possible correlation with addition/removal of table columns/defaults, but ultimately ruled out as not causative.
• Explored backup/fallback visibility in logs. Cloudflare and DataDog logs were insufficient.
3. *Technical Analysis*
• Redis cache was constructed at module/import time (global scope), *not request time*.
• The Redis cache constructor immediately parsed and "cached" environment variable state (for dev/prod detection).
• If import order or timing caused this to run before proper env setup, all subsequent checks (isProd, isDev) would reference a _stale_ (incorrect) copy, *baking in the wrong environment for the lifetime of the worker*.
• Because the system saw itself in "dev mode," it bypassed pub/sub, queued nothing, and did DB operations and telemetry in-process/local only.
4. *Smoking Gun*
• Chain: GoogleClassifier (imported at module time) → RedisCache (constructor) → ensureEnv() [early] → caches incorrect env
• Similar prior incidents noted: rate limiter bugs from global-scope (module-level) construction.
5. *Mitigation and Resolution*
• We started reverting Vercel at 12:04PM, but this did not fix anything since the backend was still, for the most part, down or degraded.
• We turned down the classifier worker count to 0, in case it was causing the outage.
• We applied a forward fix by reverting the classifier change PR. This removes the top-level singleton and allowed the system to recover. This merged at 12:10PM and ultimately rolled out at 12:12PM when we were recovered.
:grey_question: *Questions*
*Why did telemetry black out?*
Because workers thought they were running locally (dev mode), queueing to telemetry/pubsub was skipped; logs that would normally be emitted to the telemetry system were either dropped or written to local stdout (lost in prod). DataDog didn't see these events.
*Why weren’t we quicker to mitigate?*
There were many signals from across the system that didn’t make it clear what was broken. The blast radius seemed much larger than the classifier change could make at first glance, and there was another PR that was deployed with it that changed some worker behavior.
*Why was the environment incorrectly detected?*
Our code for `ensureEnv()` caches the values it reads. When a singleton instance was created at the top level of the file, it ended up running extremely early in the server lifecycle. This lead to an `undefined` value being set for the environment, which was cached and led to the system-wide failures.
*Why was the singleton instance at the top level of the file?*
This slipped through PR. The code seemed innocuous, and it took diving a few layers deep in utility classes we use across our system to find the misbehaving code. Additionally, there are linting rules that could catch this, but they were in ESLint while we were using Biome at the time.
*Why wasn’t this caught locally?*
The behavior for an undefined environment isn’t typically different from the behavior on local development. This made detection during development nearly impossible.
*Why wasn’t this caught automatically?*
We do not have prod smoke tests that run on 0% deploys to sanity check our releases. The automated tests expect to be in a test environment, which does not differ much from development. The misbehavior only manifested when the environment shifted to `production`. If we had a `staging` environment, it also would have caught this environment-name related bug.

:+1: *What Went Well*
• Good swarming on a high severity outage
• Identified immediate solution of reverting (after confirming code was backwards compatible)
• Multi-pronged response when faced with uncertainty - we rolled back code, turned off new workers, and pushed a new code change forward as simultaneous mitigation paths.
:-1: *What Went Poorly*
• We didn’t detect this until prod was already fallen over
• Root causing took almost an hour and a half, with most of the team on the call
• We had no visibility into logs from most services - we had some logs from Supabase and from Vercel, but not from our workers.
:key:  *Key Action Items*
1. *Immediate*
• [ ] *Fix environment variable parsing* so it cannot be "frozen" from an early read.
• [x] *Fix the Google Classifier top-level singleton.* Then roll the code forward and ensure things work.
• [ ] *Audit code for top-level singletons* that are instantiated at import time.
2. *Testing/Guard-Rails*
• [ ] *Add pre-prod smoke test*: Tries to hit our API on a 0% deploy. Block promotion/deploy if it fails.
• [ ] *Add ESLint plugin for detecting singletons*. This doesn’t necessarily need to be run on `main` after merging since it is slow, but should be run as some automated step in the development process before code is merged (CI time, commit hook, etc.)
3. *Reliability Improvements*
• [x] *Implement exponential backoff* for retries in all queue workers, not just immediate retry.
• [ ] *Revisit need for Redis caching at this scope. Ca*n classification cache be in-memory only? Redis global-scope is risky and may be unnecessary if hit rate is low.
• [ ] *Evaluate options to capture stdout as a fallback.* This would have given us information from the workers running, which would have given us better
