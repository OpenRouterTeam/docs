:warning: _SEV 2_ — Image-token double counting in OpenRouter billing

_Summary_
 Between 2025-04-03 and 2025-06-26, every image-containing request was billed with its estimated image tokens *twice*. This came from a regression in our billing path—it added our `estimateImageTokens()` routine on top of the provider’s own inclusive token count.

_Root Cause_
 • Providers already return `usage.prompt_tokens` with image tokens included
 • We had an image-token estimator only for missing-usage fallbacks (or for provider that bills per image)
 • On 2025-04-03 (PR #4334) the estimator was not removed when consolidating the upstream and internal estimator
 • Almost every request ran both the native count + our image estimator ⇒ *2× image token bill*

_Impact_
 • *15 140* customers hit
 • *Estimated overcharge*: $ 410_463.92 total
 – > $1 refunds: 15_140 custs
 – > $5 refunds: 6_535 custs
 – > $10 refunds: 4_035 custs

_Timeline (PT)_
 • 2025-04-03 – PR #4334 merged → defect introduced
 • 2025-04-28 – Architecture sync → raised the need to ensure usage line items were accounted properly
 • 2025-05-02 – [Credit Itemization RFC](https://www.notion.so/openrouter/RFC-Cost-Itemization-1e72fd57c4dc80c4aa41ef85d2d51f2c?source=copy_link) introduced → was deferred
 • 2025-05-13 – Onsite, overcharged was flagged
 • 2025-06-26 10:39 – issue flagged in GitHub/Slack and attempted (internal)  https://github.com/OpenRouterTeam/openrouter-web/pull/5883
 • 2025-06-27 10:39 – issue flagged in Slack by Customer (external)
 • 2025-06-27 14:00 – PR #5918 merged (fix)
 • 2025-07-02 18:36 – overcharge scope finalized
 • 2025-07-10 12:35 – refund job ran (152 Supabase batches)
 • 2025-07-10 12:57 – high-refund emails sent
 • 2025-07-11 – unit test PR #6136 merged

_What Needs Improvement_
 • April refactor review missed the regression
 • There were many early signs/hunches about the issue, but concrete fix
 • There was an alignment to defer the issue until cost itemization is done to monitor
 • Lack of cost-itemization pipeline allowed bug to persist ~3 months

_Resolution_
 • PR #5918 ensures `estimateImageTokens()` only runs if `rawUpstream.usage` is null
 • PR #6136 adds a unit test in the accounting path to reject any estimated tokens when upstream data exists
 • $ 410 k one-time credits applied; high-refund users notified same day plus a sub-set of 90 users
 • Continued email communication offering users the option of a full refund

_Action Items_
 *Short term (≤ 30 days)*
 • Add unit test to accounting code to guard against any estimator in the upstream data path (PR #6136)
 • Handle any users who might request a full-refund
*Long term (> 30 days)*
 • Build a _cost itemization_ pipeline to properly reconcile token counts
 • Add more usage accounting to the API
 • Introduce an upstream billing data pull (can start with GCP) to monitor overcharge anomaly

 _Severity Justification_
 *SEV 2* – High financial impact (>$400 k overcharge, 15 k customers), no downtime or data breach, and rapid remediation once identified.
