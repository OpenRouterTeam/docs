---
Post mortems for BYOK partial outage:

*Root Cause:*
• When moving the user provided keys outside of the UserJoinAnalytics object, the keys was then not included in the user cache on cloudflare. This cause the keys to be removed in subsequent user lookup, causing BYOK to return an empty array
*Impact*
• 35 minutes of BYOK downtime across all models
    ◦ At 5k/mins, we lost about 175,000 BYOK transactions
Resolutions:
• Added the BYOK keys into the CF cache
*Action items:*
• Make an alert on BYOK transaction below 1k/mins cc @U06DJ8YS066 (sam)
