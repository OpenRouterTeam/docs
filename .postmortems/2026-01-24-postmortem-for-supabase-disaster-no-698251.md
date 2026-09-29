Postmortem for [Supabase Disaster No. 698251](https://openrouter.slack.com/archives/C05F41UHEE7/p1769222384087699):

RCA: Postgres has an effectively fixed limit of [32TB per relation](https://www.postgresql.org/docs/current/limits.html). Our `transactions` table is now around 40GB, but that includes indexes - at about 2026-01-24 02:30 UTC the main relation for the table hit the 32TB mark, and Postgres stopped allowing inserts into `transactions`. This triggered an [alert](https://openrouter.slack.com/archives/C0594EAV9U6/p1769222278873259) for low database inserts at 2026-01-24 02:37 UTC.

Impact:
• Account usage and budgets stopped updating (starting 2026-01-24 02:30 UTC)
    ◦ Remediated at 2026-01-24 03:45 UTC when backlog cleared
• Recent generations stopped being returned from the `/api/v1/generation` API (starting 2026-01-24 02:30 UTC)
    ◦ Remediated at 2026-01-24 04:15 UTC with deploy of [PR #12717](https://github.com/OpenRouterTeam/openrouter-web/pull/12717) to `cfw-api`
• Recent generations stopped being displayed in activity feed (starting 2026-01-24 02:30 UTC)
    ◦ Remediated at 2026-01-24 06:00 UTC with deploy of [PR #12721](https://github.com/OpenRouterTeam/openrouter-web/pull/12721) to `cfw-api`
Remediation:
• [PR #12716](https://github.com/OpenRouterTeam/openrouter-web/pull/12716) - Created a new table `transactions_2` , with the same trigger and schema
    ◦ Importantly, this updates the same counters as the trigger on the other table, making the accounting affects identical
• [PR #12713](https://github.com/OpenRouterTeam/openrouter-web/pull/12713) - Moved new inserts to `transactions_2` in the GKE queue workers
• [PR #12717](https://github.com/OpenRouterTeam/openrouter-web/pull/12717) - Created a Postgres view `transactions_combined` that unions `transactions` and `transactions_2`, and reads from it for `/api/v1/generation`
• [PR #12721](https://github.com/OpenRouterTeam/openrouter-web/pull/12721) - Uses the `transactions_combined` view for the activity page as well
Sequelae:
• We have two transactions tables effectively, though we've unified the key parts of the read path with the `transactions_combined` views
Further work:
• Construct a solid plan for what to do if another size-related database-stopping barrier shows up prior to the Spanner migration
    ◦ Current options under consideration:
        ▪︎ Just drop `transactions` , accept that activity page history will be limited until Spanner migration is complete
            • Need to be confident that we will have a Supabase backup that we can extract the final table from
                ◦ Main risk is that Supabase can't get the backup somewhere useful before it falls out of the retention window, or they otherwise lose it
        ▪︎ Just drop `transactions`, move activity page reads to CH
            • We can move the activity page reads to CH preemptively if we want to open that workstream
    ◦ I'd like to survey more ideas here from the class, but provisionally we'll drop `transactions` and possibly fast-follow with CH-based activity page
    ◦ I'll write up a more specific plans after we've had some time to discuss
• Get all the rows in `transactions` into Spanner
    ◦ I need to get a [VM with an IPV6 address](http://You%20will%20need%20to%20be%20on%20a%20network%20that%20supports%20IPv6) to access the Supabase backup instance apparently, will do that Saturday (today) and possibly kick off the backfill over the weekend
    ◦ Once we finish the historical backfill but before we move the counters, we can drop `transactions` in Postgres, basically resetting the DB doomsday clock to zero (modulo faster insert rate)
        ▪︎ Can also move `/api/v1/generations` and activity page to Spanner at this point, even if we're still doing accounting in Postgres
• Consider dropping SKUs JSON from Postgres inserts for now
    ◦ This will substantially slow the rate of growth of the DB, making size-related issues take longer to manifest
    ◦ We have no immediate need of them - we can still insert them to Spanner (and currently are)
