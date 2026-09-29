*Auto top-ups not reliably firing between 2AM and 3:44AM UTC*

User impact:
• Users who hit their auto top up threshold between 2AM and 3:44AM UTC may have been allowed to run low or out of credits.
• 4 non-enterprise users (in :thread:) hit limits in this period and bursted 402s due to running out of funds.
• 402s may have been elevated following the outage, but it's hard to be sure due to unrelated fluctuations in 402s. We dug into several users who ran a higher rate of 402s after, but all of them were paying manually.
Cause:
• We (as planned) stopped updating total_usage on the `user_analytics` table after turning off writes to `transactions_2`
• There was a [redundant check inside](https://github.com/OpenRouterTeam/openrouter-web/pull/15580) the auto top up RPC that was still checking usage from `user_analytics` -- this could prevent auto-top up from firing
Detection:
• @U08C04FBGHW (John Colanduoni) noticed the dependency on `total_usage` inside the RPC when we were checking in on metrics post release, in particular digging into an increase in "Auto top up triggered"
• We didn't identify the dependency as an issue immediately, especially as auto top ups were still succeeding at a normal pace after the deployment. It became obvious it was an urgent issue after looking at the DD dashboard later and seeing a very low auto top up success rate.
Resolution:
• [Disabling the redundant check](https://github.com/OpenRouterTeam/openrouter-web/pull/15580)
Follow-ups:
• Add an alert for low rate of auto top ups -- <10 in the last ten minutes should be a good start, can adjust if flaky (https://github.com/OpenRouterTeam/openrouter-web/pull/15581)
• Propose a more reliable auto-top system. The current one is hard to reason about and has some rough edges.
