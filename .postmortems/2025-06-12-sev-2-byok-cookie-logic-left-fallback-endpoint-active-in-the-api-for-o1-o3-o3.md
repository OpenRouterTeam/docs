*SEV 2 — BYOK “cookie” logic left fallback endpoint active in the API for o1 / o3 / o3-pro*
 _All times Pacific_
*Root Cause*
• Added “cookie” flow for the OpenAI's byok only models, but never removed the fallback endpoint that routes to our chatroom key: `OPENAI_WEB_ONLY_API_KEY`.
• Tests only checked for missing-key. They never tested *“invalid key + fallback present”*, so bogus keys silently succeeded.
• First confirmed abuse:
    ◦ o1: 2024-12-08
    ◦ o3: 2025-05-05
    ◦ o3-pro: 2025-06-11
*Impact*
```o1     : 50 196 requests |  $7 488.31 internal |  $7 534.67 upstream | 192 476 420 tokens
o3     : 50 391 requests |  $3 462.61 internal |  $3 498.77 upstream | 433 836 709 tokens
o3-pro :    546 requests |    $210.35 internal |    $217.80 upstream |   9 452 015 tokens```
• _Material reputation risk with OpenAI._
*Last unauthorized occurrence by model*
```o3-pro-2025-06-10 : 2025-06-11 18:49:33 PT (gen-1749659702-JnRQlI5j6hXl4PetVC4Y)
o3-2025-04-16     : 2025-06-11 18:49:24 PT (gen-1747064283-Cqf8pmWlspWHv3qX4lot)```
*SQL used to pull numbers*
```SELECT
    g.model_permaslug,
    SUM(g.usage)                   AS total_usage,
    SUM(g.usage_upstream)          AS total_usage_upstream,
    SUM(COALESCE(g.tokens_prompt,0)+COALESCE(g.tokens_completion,0)) AS total_tokens,
    COUNT(generation_id)           AS total_request_count
FROM generations AS g
WHERE g.provider_api_key_id IS NULL
  AND g.origin != 'https://openrouter.ai/'
  AND g.model_permaslug IN ('openai/o3-pro-2025-06-10', 'openai/o3-2025-04-16',)
  AND g.created_at >= today() - INTERVAL 1 YEAR
GROUP BY g.model_permaslug;```
*Timeline*
 • *10:07 06-11* — Discord user reports “any key can hit o3-pro”.
 • *10:15* — @U08A6AM5L4B (Toven) relays issue in Slack, tags eng team.
 • 10:20 – 11:10 — Datadog queries confirm fallback traffic.
 • *11:19* — @U05AJSRUVPT (Louis Vichy) PR _openrouter-web #5610_ opened (remove fallback & add guard).
 • 11:23 — @U08C04FBGHW (John Colanduoni) Code review approved.
 • *11:32* — PR merged & deployed.
 • 11:40 — Datadog shows zero BYOK-model requests with `provider_api_key_id = NULL`.

*What Went Poorly*
 • Logic change enabled BYOK but left fallback endpoint alive.
 • Test plan missed “invalid key succeeds” scenario.
 • No CI policy enforcing “BYOK-only models must have zero non-BYOK endpoints”.
 • Issue ran undetected for months, risking vendor trust.

*Resolution (2025-06-11)*
 • Removed fallback endpoints; added `hasCookie` + BYOK checks before routing (PR #5610).
 • Verified Datadog: BYOK models no longer accept NULL `provider_api_key_id`.

*Action Items*
 _Short term_
• Unit test: invalid BYOK keys with no cookie must error out, and should not allow any fallback
• Reconcile with OpenAI (?) re: non-chatroom usage of o1/o3/o3-pro
_Long term_
• Integration tests for “invalid key + fallback absent” across BYOK endpoints.
• Move BYOK adding logic to the routing layer, reconcile the BYOK gating and the BYOK adding itself
