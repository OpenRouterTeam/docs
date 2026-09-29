---
Bedrock tools not being parsed properly

Root cause:
• Refactor of the adapter request parsing did not have the same behavior before due to not spreading down the rest of the request
Impact
• All tool calling for bedrock was down for 3 days from Feb 28th 12PM PT -> Mar 3rd 1PM PT
Resolutions
• Fixed the root cause by using rawRequestBody in the adapter for tools in the Bedrock adapter instead of using the adapter.request (which is not parsing for tools at this time)
• (Optional) We might consider pulling tools and tool_choice as standard parameters and always parse them by default in the base adapter
