# Postmortem: Incorrect Model Deprecation Email ingestion for Haiku 4.5

**Slack Thread**
- [https://openrouter.slack.com/archives/C09BZ6AR53R/p1768961293824789](https://openrouter.slack.com/archives/C09BZ6AR53R/p1768961293824789)

## TLDR
- We ingested a model deprecation email from Anthropic announcing haiku 3.5 deprecation and recommending users transition to 4.5. However, the email-parser mistakingly ingested 4.5 haiku as a model-deprecation, showing incorrect info on our model page
## Incident Details
- **Date Range:** January 20, 2026
- **Severity:** SEV-4 (Low)
- **Incident Lead:** Charles Rockhead
- **Detection Method:** public discourse on twitter
- **Users Affected:** users monitoring our model page for news updates
## Timeline
Tues Jan 20 (All times EST)

**7:00 PM**
- cloudrun job ran erroneously marking Haiku 4.5 as being deprecated on February 16, 2026

**7:43-8:00 PM**
- AI / software content creators made posts based on this information some users flagged the  OpenRouter UI bug from the logic that
**9:00-9:30 pm**
- Toven / Tomas flagged incorrect ori updated and reverted it, then discovered tweets
- Shashank preemptively removed auto-hiding to address concerns of misclassification → hiding incorrect models and instead using
- Shashank published updated tweet
## Impact
- Community commentary + reputational damage for publicizing incorrect model deprecation information (for 2 hours)
- No endpoint was hidden so no traffic was disrupted

## Root Cause
- model deprecation job didn’t incorporate fallbacks on the applicability of a model should be deprecated
	- only had fallbacks (flags for manual review) if there was difficulty in matching an email-provided endpoint to an existing endpoint in our database
- as such, when there was a valid match just in the email for the transition model (haiku 4.5) it was added to the eligibility list for models to be deprecated
- because of poor visibility (dashboard, signal noise from alert-providers-low-signal), this misclassification wasn’t quickly identified leading to community comments on this misinformation

## Contributing Factors
1. Poor visibility on slack updates in #alert-low-signals channel
	1. original idea was to monitor for reliability and cut-over once confident but this should’ve just been in #alert-providers given public exposure +
	2. manual monitoring of channel to evaluate issue
2. Bug in in the model deprecations dashboard which I deprioritized further decreased visibility

## Resolution
- Model Deprecation slack updates will CC myself for increased visibility regardless of whichever channel ([PR #12425](https://github.com/OpenRouterTeam/openrouter-web/pull/12425))
- Addressed a bug in [https://internal.openrouter.ai/endpoints/deprecation](https://internal.openrouter.ai/endpoints/deprecation) that shows pending and updated model deprecations ([PR #12455](https://github.com/OpenRouterTeam/openrouter-web/pull/12455))
- Added guardrails to flag transition models and a fallback for model uncertainty if a model should be deprecated or not
 ([PR #12427](https://github.com/OpenRouterTeam/openrouter-web/pull/12427))
## Action Items
- [x] Move model-deprecation slack updates from #alerts-providers-low-signal to #alert-providers to increase visibility (implicitly)
- [ ] Wrap up model uncertainty fallback ([PR #12427](https://github.com/OpenRouterTeam/openrouter-web/pull/12427))
	- [x] deployed to cloudrun already
- [ ] Make slack user id from ([PR #12425](https://github.com/OpenRouterTeam/openrouter-web/pull/12425))  an Infisical env

## Open Questions
- Should we still have auto-hiding on T remain as manual? ([ Shashank’s hotfix](https://github.com/OpenRouterTeam/openrouter-web/compare/2f0d619095ef...ce9d99e9fea8) )?
	-  adjusted the cron logic to send an slack update to hide endpoints
		- with an @ecosystem tag this does increase visibility but adds to mental overhead and is anti-automation
		- but this also exposes us to the risk of disrupting user experience if they are pinned to model that is about to be deprecated
		- the root cause of the issue was poor extraction logics and fallbacks allowing the model make consequential assumptions
	- *potential alternative: *
		- reinstate auto-hiding but add recurring slack updates leading up to the actions (T-3 → T-1 → T (morning) final update→ T(night) hide)
- How can we facilitate automation while having through visibility without the mental overhead of monitoring?
