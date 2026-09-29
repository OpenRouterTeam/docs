---
Postmortem on BYOK Leak @channel

*Summary:* due to poor logic around a shared cache used for looking up BYOK keys,
1. some users’ non-disabled keys were being used to serve requests for other users, if they shared an edge region and provider
2. many BYOK users weren’t able to use their own keys, if they shared an edge region with another BYOK user, regardless of provider
*Root cause:*
• A shared cache called `userProvidedKeyMap` that wasn’t indexed for multiple users and only worked for one
• Premature optimization around searching a list for provider keys
• Only unit-testing one user at a time for BYOK
• A rushed PR review
• Me assigning a junior engineer something that was too security-sensitive
*Impact:*
• This lasted for the entire duration of BYOK, since we launched on
    ◦ starting July 11, from [this PR](https://github.com/OpenRouterTeam/openrouter-web/pull/1215)
    ◦ ending Nov 24, [this PR](https://app.graphite.dev/github/pr/OpenRouterTeam/openrouter-web/2756/BYOK-fixes-continue-logging-shared-state-bug)
• We weren’t tracking the usage of provider keys on transactions, so we don’t have the data to figure out the total number of victims or impact, but we are logging the victims that have been feeling the largest effects recently. Those include
    ◦ Someone who worked here once whose AI Studio key has been used *350k times over the last two weeks for Flash 8b and 55k times for Flash 1.5*, among other paid models
    ◦ The owners of the keys below in Screenshot 1 over just the last two weeks are shown with request counts (includes some free models, though)
*Immediate remediation*
• Patched the two bugs
• Added unit tests
• Confirmed with BYOK users who reached out that it works
*Next steps:*
• @U07MHP3NEF8 (Shashank Goyal) figuring out our estimated impact is really only doable i think if we can either add a pg index on provider_api_key, or have a clickhouse backfill that goes back to October 14th, the date we added logging for it, that includes `provider_api_key_id` like the new generations_v1 does.
    ◦ Can I get your help here?
• I’m going to contact the top victim to get on a call after I’m able to estimate his $ loss and figure out how to reimburse him ^
• *[Feedback requested!]* Considering sending an email to all BYOK users telling them about the bug, reminding them that it was a private beta, and asking them to check their accounts and get back to us for refunds / credit requests.
    ◦ There are *30 emails* currently with active BYOK keys
    ◦ Of those, only about 5 are hitting our alerting logs right now showing they would have been active victims
