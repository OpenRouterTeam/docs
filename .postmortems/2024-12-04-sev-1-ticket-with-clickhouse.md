Quick Post Mortem:

Clickhouse DB down for ~25 minutes.
Cause:
1. Manual read queries on the console caused clickhouse cpu to reach 100%.
 Root Cause:
1. True root cause is unknown, while #alerts-clickhouse says the queries are bad. I would hope that queries dont cause the whole db to crash.
Impact:
1. ~18 minutes of backlog on writing transactions to the db. Since writing to supabase and clickhouse are shared right now.
2. Clickhouse has missing data from 5 30 - 6 30 EST
Resolution:
1. Stopped writes to ch, and scaled up.
2. Created a sev 1 ticket with clickhouse. They responded in under 15 minutes on email and slack.
Action Items:
1. Separate the queue for clickhouse and supabase
2. Create a doc with common query patterns so that clickhouse team can recommend schema
