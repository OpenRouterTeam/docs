*xAI Negative Usage Incident Post-Mortem*

*Incident timeline:*

12/3:
• 2:05 PM EST: [PR #10117](https://github.com/OpenRouterTeam/openrouter-web/pull/10117) ("use cost_in_nano_usd for xAI pricing with token-based fallback") was merged and deployed, adding support for xAI's `cost_in_nano_usd` field to use provider-reported costs instead of token-based calculations
12/4:
• 4:35 PM EST: An employee at Aaru [reported](https://openrouter.slack.com/archives/C08MAKQS46S/p1764884142122589) negative usage values for xAI requests: `usage: -0.0004983`, `usage_cache: -0.00177375` for model `x-ai/grok-4.1-fast` with 11,825 cached tokens ("Some requests seem to be giving us back money...")
• 5:05 PM EST: A [huddle](https://openrouter.slack.com/archives/C05F41UHEE7/p1764885945452889) started and the root cause was identified: xAI's `cost_in_nano_usd` already includes cache discounts, but our code was applying an additional cache discount on top, resulting in double-counting
• 5:14 PM EST: Fix [PR #10301](https://github.com/OpenRouterTeam/openrouter-web/pull/10301) merged and deployed, adding a `shouldApplyCacheUsageToFinalCost()` hook that xAI adapter overrides to prevent double-counting while still reporting accurate `usage_cache` values
Total incident duration: ~27 hours from deploy to fix

*What happened:*

When xAI returns `cost_in_nano_usd` in their API response, this value is already a fully-discounted cost that accounts for cached tokens. Our adapter was treating this as a "base cost" and then `BaseAdapter.getFinalUsage()` was applying our own cache discount calculation on top of it via `getCacheUsage()`.

For heavily cached requests (like the reported case with 11,825 of 12,546 tokens cached), the magnitude of our calculated cache discount exceeded the base cost, resulting in negative final usage values - effectively giving money back to users.

The code path was:
1. `XAIResponsesAdapter.getBaseUsageCost()` returned `cost_in_nano_usd / 1e9` (~$0.00127545)
2. `BaseAdapter.getFinalUsage()` calculated `cacheUsage` = -$0.00177375
3. Final `userCost = baseUsage + cacheUsage` = $0.00127545 + (-$0.00177375) = -$0.0004983
*Impact:*

A [Hex query](https://openrouter.slack.com/archives/C05H3A104BS/p1764894344279499?thread_ts=1764891573.013469&cid=C05H3A104BS) reported a total undercharge of $4,409.53 across 9.5 million xAI requests over the 27-hour incident window. The actual usage charged was $13,608.61 when it should have been $18,018.14.

Note: we initially went off [this Hex query](https://openrouter.slack.com/archives/C05H3A104BS/p1764886310810809?thread_ts=1764885899.869319&cid=C05H3A104BS) which suggested a much higher impact (undercharge of ~$18k), but this query did not filter out BYOK requests (AKA non-null `provider_api_key_id`) which are not applicable to this incident. xAI does not return `cost_in_nano_usd` for BYOK requests so we fallback to our existing token-based logic.

*Follow up actions:*

1. :white_check_mark: Add a floor of 0 to usage calculations. Ensure that final usage values are clamped to a minimum of 0 to prevent negative charges from ever being persisted.
2. Add early alerting via Datadog for negative usage. Set up Datadog alerts to detect when usage calculations would have gone negative (before the floor is applied), so we catch pricing bugs early.
3. Fix @U08C04FBGHW (John Colanduoni)'s feedback: "The way we contort all of pricing so that we can calculate `usage = fake_made_up_usage1 - (fake_made_up_usage2 - real_usage)` is the key problem here"
4. Continue the [Cost Itemization RFC](https://www.notion.so/openrouter/RFC-Cost-Itemization-1e72fd57c4dc80c4aa41ef85d2d51f2c) for detailed, auditable pricing breakdowns.
