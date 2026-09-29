*Google AI Studio down from ~ July 28 16:40 to 17:35 PST*

*Root Cause*
I intended to evaluate the switchover from  /v1beta to /v1 endpoints and didn't realize that I was editing the provider via mission control in prod. /v1 is currently incompatible with our adapters.

*Impact*
Almost all Google AI Studio traffic was getting either 404s (for unsupported models on /v1) or 400s (due to adapter incompatibility). Total error volume during this period was about ~357k + another ~138k from BYOK. Google AI Studio dollar usage dropped from ~$3.21/minute to ~$0.22/minute for the duration.

User facing issues:
1. 404s or 400s from AI Studio.
    a. 404s came from free models: `google/gemma-3n-e2b-it:free, google/gemma-3-4b-it:free, google/gemini-2.0-flash-exp:free, google/gemma-3-27b-it:free, google/gemma-3n-e4b-it:free, google/gemma-3-12b-it:free`
    b. 400s came from fields like `systemInstruction` and `thinkingConfig` being unsupported
*What Went Well*
• The issue was flagged by Khan Academy and relayed into #bugs fairly quickly
*What Went Poorly*
• We didn't have the warning alert in mission control for editing in production for providers or the changelog table
• No datadog alerts since the majority of the volume was from 400s, despite a >95% downturn
*Resolution*
Undid the change in mission control

*Action Items (short term)*
• Add the "editing in prod" alert to providers
• Add the changelog table to providers
*Action Items (long term)*
• We could use smarter alerting because a 95% downturn is a major outage for any provider.
