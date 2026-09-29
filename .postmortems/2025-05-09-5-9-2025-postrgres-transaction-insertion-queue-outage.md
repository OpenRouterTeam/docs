*[5/9/2025] Postrgres Transaction Insertion Queue Outage*

---

Event timeline (adapted from slack recap)

*High Nacks on Subscription*
• @U0672C4DEV6 (Datadog) reported a high amount of nacks on the "pull-shard-0-insert-transactions" subscription, which was causing issues [[6]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746805893238859), [[7]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808293085429)
• The nack requests over the "pull-shard-0-insert-transactions" subscription were over 2500 on average during the last 15 minutes [[6]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746805893238859), [[7]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808293085429)
• The issue was later resolved as the nack requests dropped below 2500 on average [[7]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808293085429)
*Low Database Transaction Writes*
• @U0672C4DEV6 (Datadog) reported that database transaction writes had been low, and asked the team to investigate the Database Health and Queues dashboards to debug the issue.
• @U08A6AM5L4B (Toven) raised the alarm and started a huddle,  since this specific alert does not fire often
*Subscription Backlog*
• @U0672C4DEV6 (Datadog) reported that the "pull-shard-0-insert-transactions" subscription had a large backlog, and asked the team to investigate the queue worker logs [[10]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746806549502339), [[11]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808531464349)
• The gcp.pubsub.subscription.num_undelivered_messages metric over the "pull-shard-0-insert-transactions" subscription was over 5000 during the last 15 minutes, indicating a large backlog [[10]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746806549502339), [[11]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808531464349)
• The backlog issue was later resolved as the undelivered messages dropped below 5000 [[11]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808531464349)
*CPU and Queue Monitoring*
@U06DJ8YS066 (sam) provided updates on CPU usage, queue processing, and steps taken to address the issues, including temporarily taking down queue workers, getting the supabase team to cancel a long running query, and working through the backlog.

• @U06DJ8YS066 (sam) reported that the initial elevated CPU usage coincided with a ramp-up into the incident, and a subsequent dip in CPU usage was while the team temporarily took down the queue workers [[12]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808546062649)
• @U06DJ8YS066 (sam) mentioned that the second slight elevation in CPU usage corresponded with the team working through the backlog, which also coincided with a higher network rate [[12]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808546062649)
• @U06DJ8YS066 (sam) noted that the time spent on I/O was relatively stable throughout the incident, even while inserting at 6k RPS, which was a good sign for the Supabase ceiling [[13]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746808615193019)
*Test Notification*
• @U0672C4DEV6 (Datadog) sent a test notification for the "Database Transaction Writes Are Low" alert, which was later recovered [[14]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746809939248879), [[15]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746809940365969)
• The test notification was triggered by @U0672C4DEV6 (Datadog) to validate the alert [[14]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746809939248879), [[15]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746809940365969)
• @U06DJ8YS066 (sam) mentioned that the !here tags were enabled on the most critical alerts, including low transaction writes, low queue publishes, and low usage detected [[16]](https://openrouter.slack.com/archives/C0594EAV9U6/p1746809961657169)
---

Granola Notes:

Incident Overview
• Incident started at 12:03:00 on May 9, 2025
    ◦ Mitigated by 12:15
    ◦ Resolved by 12:30
• Database inserts stopped working due to a long-running Hex query
• Duration: ~30 minutes
• Most serious infrastructure incident in recent history
• Primary Impact: Transaction processing halted, affecting credit deductions
• No significant impact on API completions or generation endpoints
Root Cause & Resolution
• Cause: Long-running Hex query on triggers table while attempting to create auto top-up dashboard
• Resolution steps:
    ◦ Paused transaction queue to let DB cool off
    ◦ Identified problematic query (PID: 780267)
    ◦ [Supabase support team killed the query ](https://openrouter.slack.com/archives/C054A8NQM0V/p1746807202710909?thread_ts=1746806508.416569&cid=C054A8NQM0V)after permission issues prevented internal cancellation
    ◦ Gradually restored worker replicas (1 → 2 → 3 → 2),  where 3 was temporary to work through backlog faster
• System Recovery Metrics:
    ◦ Achieved 4,000 inserts per second initially
    ◦ Peaked at 6,000 rows per second during recovery
    ◦ Database CPU levels returned to normal
    ◦ No spike in 4xx or 5xx errors on the chat completions endpoints
Action Items & Learnings
• :white_check_mark: Modify “database writes too low” and other critical alerts with an @ here notification
• :white_check_mark: Asses potential Hex vulnerability - ability to impact Supabase performance (@U07TEQPJRRR (Chris Clark) is [already on it here](https://openrouter.slack.com/archives/C05H3A104BS/p1746807479947869))
• :white_check_mark: Evaluate & execute [Supabase's recommended circuit breaker](https://openrouter.slack.com/archives/C054A8NQM0V/p1746807992755009?thread_ts=1746806508.416569&cid=C054A8NQM0V) for these idle transactions  (@U07MHP3NEF8 (Shashank Goyal))
• :large_yellow_circle: Make sure we are able to kill queries made by other users
