*Auto top-ups firing _too_ reliably between 2026-03-11 03:38 UTC and 2026-03-13 01:45 UTC*

Impact:
• [336 users](https://openrouter.slack.com/archives/C05F41UHEE7/p1773391495165229?thread_ts=1773357507.379819&cid=C05F41UHEE7) received a double top-up (aggregate $17,802.88 of usage)
    ◦ The additional credits were still reflected in the platform
    ◦ 167 of these users would have needed the second auto top-up by 2026-03-13 08:00 UTC (when we ran the remediation)
• After refunding the users, we are out $17,802.88 - $16,515.00 = $1287.88 in fees
Timeline:
• 2026-03-11 03:38 UTC - I deployed [PR #15580](https://github.com/OpenRouterTeam/openrouter-web/pull/15580) to address [auto top-ups not firing reliably](https://openrouter.slack.com/archives/C05MYP9UPRU/p1773209135666399) after disabling transaction writes to Supabase
    ◦ This is when the race condition was introduced
• 2026-03-12 23:15 UTC - Novelcrafter [notified us](https://openrouter.slack.com/archives/C07CCAFC938/p1773357351928969) that they had been double-billed
• 2026-03-13 01:45 UTC - [PR #15733](https://github.com/OpenRouterTeam/openrouter-web/pull/15733) was deployed
    ◦ This resolved the race condition, preventing future double auto-top-ups
• 2026-03-13 08:44 UTC - @U09M1SL591A (John Krauss) [refunded](https://openrouter.slack.com/archives/C05F41UHEE7/p1773391495165229?thread_ts=1773357507.379819&cid=C05F41UHEE7) the affected users who had not yet spent their surplus credits
Cause:
The auto-top-up mechanism relies on two tables `triggers` (not to be confused with Postgres schema triggers) and `notifications`. The flow of the auto-top-up function looks like this this:
• Check if user's balance is below auto-top-up threshold
• Call the `insert_notification_and_update_trigger`
    ◦ Takes a row lock on the user's auto-top-up `triggers`
    ◦ If  `triggers.pending_notification_id != NULL` , abort/rollback
    ◦ Check user's balance against the auto-top-up threshold again, abort/rollback if no longer below threshold
        ▪︎ *This was disabled by [PR #15580](https://github.com/OpenRouterTeam/openrouter-web/pull/15580) because the check reads from the no longer updated `analytics_users.total_usage` field*
    ◦ Set `triggers.pending_notification_id = new_notification_id`
• Charge the user's payment method
• Set `triggers.pending_notification_id = NULL`
When I disabled the bolded mechanism, I misunderstood the flow - I thought the balance check happened inside the critical section. Without the double-check, the mechanism is in fact vulnerable to a race condition between concurrent auto-top-up attempts if the following occurs:

• A checks balance
• B checks balance
• A takes lock
• A charges user
• A releases lock
• B takes lock
There is also a second vector that makes this more likely to happen. There is a Postgres schema trigger (not to be confused with the `triggers` table) on [credit creation](https://github.com/OpenRouterTeam/openrouter-web/blob/62dbb30a65ce844dd3270f24ea6ae5bd4c178e97/supabase/migrations/20240104224607_credits_trigger.sql#L15) that clears out the user's auto-top-up `triggers.pending_notification_id` , which adds another way for the unlock to happen outside of the flow itself.

Resolution:
The fix was to perform a second balance check with updated credit numbers inside the critical section. The lock will still get taken, but it will be unlocked once the worker realizes it does not need to perform any action.

Follow-ups:
• Simplify the locking mechanism in the auto-top-up mechanism. It's currently spread across Typescript and several functions in the database schema.
