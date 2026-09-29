*Plugin Refactor Postmortem*

We merged a very large and dangerous PR at midnight, causing 4 issues:
• incorrect statuses being sent to users (200s instead of upstream errors)
• loss of provider error messages in datadog
• incorrect `usage_upstream` accounting
• loss of data in clickhouse during a 12 hour period
Core takeaways:
1. We should NEVER do merges this serious when people are going to sleep! cough cough @U05AJSRUVPT (Louis Vichy)
2. We’re adding monitors around CH and event ingestion
3. We’re improving our progressive rollout strategy to be more automatic and cover more PRs
4. We need to improve unit test coverage around critical accounting paths, including `usage_upstream`
