*Post mortem Hyperdrive outage part deux 2026-02-19*

tl;dr: *OpenRouter was partially down from 11:36PM to 11:42PM Pacific, and almost completely down from 11:42PM to 12:11AM.* The immediate cause was Cloudflare's Hyperdrive cache failing, overloading our postgres databases. It _does not appear_ that there was any abuse leading up to the incident. (DD)

*User impact:*
• Degraded availability of all generations requests (eg chat completions, responses, etc.) between 11:36PM and 12:11AM Pacific. Initially users received 500s, but for most of the incident users received 401s ("User not found").
• The chatroom and all endpoints that depended on authorization were similarly degraded and/or unavailable during this period.
*Timeline*
• Starting at 11:16PM, the Hyperdrive cache started to log errors, indicating an inability to connect with the upstream database (Google Cloud SQL) even though that database was healthy (no errors, normal CPU and IOPS).
• These errors spiked at 11:36PM, corresponding with uncaught errors propagated to our end-users as 500s. During this period the database received almost no traffic.
• By 11:42PM Hyperdrive appeared to send all requests straight to the database despite claiming to have a large number of cache hits. The database was not able to keep up with traffic, which timed out with a confusing 401 error code. This continued until 12:11AM, at which point caching returned to normal.
Remediations:
• Add a circuit breaker so that we back off hyperdrive if we see signs of issues and serve data from memory -- I've got a PR for this https://github.com/OpenRouterTeam/openrouter-web/pull/14186 . This also changes our error code handling to not mask our outage with 401 codes. This may expose previously hidden instability in our auth layer, which we should fix if so.
• Move api read traffic off the replica and back to Supabase. We haven't had issues with Hyperdrive's connection to postgres prior to the remediation from the Friday 13 incident where we moved api read traffic to GCP.
Action items:
• Get a circuit breaker PR merged in the morning, once we're mid-incident it's too late. I don't want to rush this out on no sleep, but we need to land this ASAP.
• Follow up again with CF about Hyperdrive -- they had alluded to seeing some issues after the incident on monday
• All engineers need access to the status page and documentation on how to update it
• All engineers need access to the support ticketing system in Cloudflare (this may already be the case, but want to be sure)
