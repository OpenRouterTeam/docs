## Transaction creation was interrupted from 8:41:20AM PT to 8:52:20 PT on Dec 23rd

The [deployment](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/12469940260/job/34804390219#step:4:38) d4ace49d-c18f-41d7-a250-6610c18dc8bb carried a bug that caused getUsage to throw, causing no transactions to be created for 11 minutes

Root Cause:
1. Incorrect type safety assumption, assuming that cacheRead/cacheWrite is always truthy after a proxy condition
    a. The conditions do not ensure the truthiness of each of the cache pricing!
2. Lack of test for the edge case where each of the cache pricing is null
3. Monitoring the wrong graph. Deployer should monitor closely the transaction dashboard while deploying a core-infra PR:  https://openrouter.slack.com/archives/C05H3A104BS/p1734972201727959
Impact:
1. No usage/transactions recorded on every endpoints for 11 minutes
    a. Thankfully, it did not took down the API endpoint. We lost data + money. A loss of data integrity reputation and money
2. ~*70k* requests affected by MONEYSINK count
3. Based on the Transactions by App graph, we lost 280k (peak prior) - 120k (incident) = *160k* requests
4. Based on the dollar usage per model, we lost 686.39 (peak prior) - 329.12 (incident) = *$356.88*
Resolution:
1. Rolled back the worker and vercel deployments @U07MHP3NEF8 (Shashank Goyal)
2. Reverted the change on git @U05AJSRUVPT (Louis Vichy)
Action Item:
1. Add an alert on the MONEYSINK error @U06DJ8YS066 (sam)
2. Fix the faulty check and merge + monitor closely @U05AJSRUVPT (Louis Vichy)
