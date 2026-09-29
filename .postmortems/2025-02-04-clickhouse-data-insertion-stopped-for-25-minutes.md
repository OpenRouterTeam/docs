Clickhouse Data Insertion Stopped for 25 minutes

*Root Cause:*
Added a Materialized View with a query that had an error. The error caused all inserts to clickhouse to fail.

Impact:
1. Metric charts on the site were delayed by 25 minutes. Since it was late night impact was probably not too bad.
What went well:
1. We had an alert on queue inserts and backlog
2. Was caught early and engineers were around to fix it
3. Currently no production critical flows are on clickhouse
What went poorly
1. Migrations which can be generally risky was merged late at night -- possible could have caused issues when people were asleep.
2. Should wait for a review on migrations.
Resolution:
1. Dropped the MV in the console
Action Items:
1. Better integration testing with null values.
2. Only merge migrations during work hours.
3. Maybe create some sort of migration checklist
