*5min clickhouse read degraded / write outage*

went to ship a fix last night for a bugs thread on empty analytics data for models with <1 day of activity,
allowing [viewing first 24h activity](https://openrouter.slack.com/archives/C05F41UHEE7/p1765490153566999?thread_ts=1765479690.129139&cid=C05F41UHEE7) as a granular chart rather than a single point

as i understood it:
• immediately after deploy, [saw clickhouse queries start timing out](https://openrouter.slack.com/archives/C05HMV4J6JE/p1765503046370809) for the performance graphs (`source:vercel` on dd logs)
• memory usage spiked and some nodes were cycling at the same time --> more load on a single node
    ◦ combination of
        ▪︎ minute MV aggregating a whole day of data across all colos
        ▪︎ all the daily MV queries changed cache key to include window, so there was a flood of known-non-performant queries that weren't prewarmed into cache)
• there was a ~5m insert outage
• issue resolved after rollback + brief recovery
potential options to land the original change:
• [scope the queries down to specific colos](https://openrouter.slack.com/files/U06DJ8YS066/F0A35FBVDFC/image.png) (fewer clickhouse merges), and use a new feature to make the performance better
• optimizing the materialized view (on my backlog already with [a draft](https://github.com/OpenRouterTeam/openrouter-web/pull/6475), needs to be done anyway)
future action items:
• get some better scaffolding for load testing clickhouse queries against a replica
