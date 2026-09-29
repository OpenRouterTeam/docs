*API Key Limit Enforcement Delayed*

[tomas flagged a user report](https://openrouter.slack.com/archives/C05F41UHEE7/p1754017033540839) from discord about api key limits not being respected, a user was able to rack up a lot of spend on a limited key within the bounds of 10 minutes

that 10 minute figure was sus, because that's the exact amount of time [for the negative balance user TTL](https://github.com/OpenRouterTeam/openrouter-web/compare/d7e999f9d433...dd2b16744016) that i reverted away from [this original commit](https://github.com/OpenRouterTeam/openrouter-web/compare/579991d62ab4...d2d2de55ae35) that added the negative_balance_limit.   after deploying that revert, it was clear (pic1) that this was the primary root cause.   early user cache revalidations went up and sustained, meaning that while this commit was live,  `user.user.negative_balance_limit === 0` was evaluating to false, even though 0 is the default on the table  (TODO: look into why that field was undefined at runtime).    *this was active for 1 day, and was the primary cause of the limit overages*

for good measure, we also reverted [this commit](https://github.com/OpenRouterTeam/openrouter-web/compare/6bfc00c314c2...599610b69bb3) that added a hint to supabase user lookup (the one that was optimizing for low balance & free model users).   the flow of the current user lookup is:
• get from async cf cache (10s ttl)
• fallthrough to hyperdrive (15s stale-while-revalidate, with 60s max age)
• if <$1 balance or limit on key, force direct supabase lookup  (multiple db queries, redoing work from the hyperdrive query)
so this optimization was trying to be clever in re-using the API key found through the key-hash lookup in the hyperdrive query,  to golf out one query from the direct supabase lookup.   unfortunately,  I had incorrectly assumed that API Key credit usage was returned as part of the getUserJoinAnalytics query that was still being performed, and not as a part of the api-key lookup.   this contributing factor was active for 1w, but only had the effect of causing up to 60s of enforcement delay for the cache to catch up,  which is what prod used to do before about two months ago

action items:
• :white_check_mark: shashank [queried the affected users](https://openrouter.slack.com/archives/C05F41UHEE7/p1754019613404439?thread_ts=1754017033.540839&cid=C05F41UHEE7)  and found that total impact was about $100
• :white_check_mark: sam will pull the emails for those users with >$5 delta and stage a message for alex to send out to them
• :white_check_mark: sam will credit all the affected users with the delta
• :white_check_mark: sam will prio [this pr](https://openrouter.slack.com/archives/C096K0GQXM5/p1753848038121639?thread_ts=1753813913.430519&cid=C096K0GQXM5) to make the free user lookup a single direct query rather than multiple postgREST queries, and eliminate the postgREST fallback entirely afterwards to simplify
• :large_yellow_circle: sam to look into why that negative_balance_limit field was undefined at runtime
