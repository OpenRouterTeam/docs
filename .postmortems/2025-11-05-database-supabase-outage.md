Database (supabase) outage
• We just tried to add a column (nullable, no default value) and it brought our entire database to a standstill until we canceled the following DDL: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS num_video_prompt bigint;` ([PR](https://github.com/OpenRouterTeam/openrouter-web/compare/5494bc02048e...5cdb5b71b7e4))
    ◦ It first timed out in release, then I attempted to apply the migration manually: [thread](https://openrouter.slack.com/archives/C05HMV4J6JE/p1762372833405899)
• This happened due to the XID wraparound protection-spawned vacuum on our 30TB `transactions` table (restarts within a minute after cancelling). The table already has "normal" auto vacuums disabled (the one that is triggered on # of dead rows).
    ◦ ALTERs even though not rewrites will be blocked by the vacuum process:
```"The standard form of VACUUM can run in parallel with production database operations. Commands such as SELECT, INSERT, UPDATE, and DELETE will continue to function as normal, though you will not be able to modify the definition of a table with commands such as ALTER TABLE ADD COLUMN while it is being vacuumed."
https://www.postgresql.org/docs/8.2/routine-vacuuming.html```
• This caused a big dip in BYOK transactions and a smaller drop in non-BYOK transactions
• Drop in rows updated for ~10 minutes
• @U08C04FBGHW (John Colanduoni) has reached out to supabase again to get this `autovacuum_freeze_max_age` increased to give us headroom:
    ◦  https://openrouter.slack.com/archives/C054A8NQM0V/p1762378145176129
• @U09M1SL591A (John Krauss) is working on adding a lint rule to prevent migrations to the transactions table
    ◦ https://openrouter.slack.com/archives/C07UF9XLTFF/p1762378329833989
