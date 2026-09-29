Post mortem for perplexity and mancer upstream cost undercounting

We did not account for the modified cost coming from perplexity and mancer's adapter, resulted in an undercounting of cost charged.

Total impact is *~$400*. This impacts mainly the deep research model where it charges "internal reasoning" separately from completions pricing.

Root cause: In the refactor PR (https://github.com/OpenRouterTeam/openrouter-web/pull/4334) to separate out the native token accounting and make it check for upstream token counting first, the cost was not passed down to the final upstream cost. The PR decoupled "token counting" (usage) from "cost calculation" (cost), but didn't refactor out the cost calculation for the specific adapter (perplexity and mancer).

Fix merged: https://github.com/OpenRouterTeam/openrouter-web/pull/4861 -- we separated out the concept of "COST" versus "USAGE" and explicitly return ONLY token counting for the upstream_usage.

There's more TODO that'll be done in: https://github.com/OpenRouterTeam/openrouter-web/pull/4846 @U08C04FBGHW (John Colanduoni)
• Refactor out the upstreamCost calculation to explicitly mark "upstream" vs "quadchar" vs "native-tokenizer" (with gpt/claude)
• Add explicit test for upstream cost accounting
• Be more explicit with "dollar cost" vs "token count" and don't couple them together to cause semantic confusion (we call "tokens count" `usage` in code, but in the DB we use `usage` for dollar cost) -- the PR above will be using the `tokenCount` convention
bug ref: https://openrouter.slack.com/archives/C05F41UHEE7/p1745993174593629
