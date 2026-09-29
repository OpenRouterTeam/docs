---
*Analytics undercounting when there were > 2 db timeouts since the chunking algorithm change on July 22*

*Root cause:* bug in the while loop condition when we were proceeding through the day in computing rollup analytics. This meant that, when we had > 2 db timeouts during rollups, we never logged the 3rd timeout and never tracked an error, and ALSO wrote incomplete data to the `analytics_transactions` table.

*Impact:* if we ever had replica issues, overload, or massive days of data recently, there might have been > 2 db timeouts when looping through the day at 11pm. In that case, 0 to 3/4 of the day would have been written to the analytics_transactions table, affecting /rankings data, and app volume primarily:
• analytics for that day/week would be a bit lower than we actually had
• our total analytics for token volume, $ volume, and net revenue are a bit lower than we actually had
• we should think of our margin as an underestimate of what it actually was, until analytics are fully backfilled. cc @U07TEQPJRRR (Chris Clark)
*Resolution:* I’m going to manually fix days this week, but longer term needs are
• optimizing postgres infra
• optimizing our indexes (should be faster than we see)
• maybe moving to Clickhouse
• redoing `analytics_transactions` based on our source of truth
