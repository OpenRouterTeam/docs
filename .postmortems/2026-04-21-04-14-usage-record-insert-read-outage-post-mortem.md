*04-14 Usage Record Insert/Read Outage — Post-Mortem*
Full write-up: [Canvas](https://openrouter.slack.com/docs/T053YQ6R5TR/F0AU4PU36D9)
_TL;DR_
• *Duration:* ~1h 41m customer-visible (13:00–14:41 EDT)
• *Root cause:* PR [#17823](https://github.com/OpenRouterTeam/openrouter-web/pull/17823) added `num_fetches` to generation payload with Supabase migration but no Spanner migration → Dataflow → Spanner writes failed with `Unrecognized name: num_fetches`
• *Impact:* `/activity` logs down, budgets not incremented (max theoretical exposure ~$111.8k, real overspend much lower), 766 users hit errors
• *Fix:* Revert [#18134](https://github.com/OpenRouterTeam/openrouter-web/pull/18134) + forward-fix migration [#18148](https://github.com/OpenRouterTeam/openrouter-web/pull/18148); schema linter [#18163](https://github.com/OpenRouterTeam/openrouter-web/pull/18163) in flight
Top follow-ups: schema-change linter, fleet rollback tooling, insert-success monitor, version-skew alert, DB-change PR checklist. See canvas for full detail + proposed Claude Code rules/skills. *Sent using* @U09JKNEERM4 (Claude)
