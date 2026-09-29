WIP Post Mortem: *Gemini token undercounting, and xAI miscounting*

*Gemini*
We aren’t sure the full cost impact of this yet, but it’s at least $40k so far. Causes are:
• we knowingly weren’t charging for long-context prompts
• we weren’t counting thinking tokens on Vertex (so the $40k here so far is undercounting what we lost)
*xAI*
• TODO
*Go forward mitigation steps*
• we need to NOT allow manual accounting in adapters
    ◦ especially for thinking tokens
• We DO need to do normalized reasoning token counts though, so we can set alerting on it
• We also really, really need to make sure we have good datadog monitors on $ loss charts @U06DJ8YS066 (sam) - can you ack my msg in the other thread?
cc @U05AJSRUVPT (Louis Vichy)
