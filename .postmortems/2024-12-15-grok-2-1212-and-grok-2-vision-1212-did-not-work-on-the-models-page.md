## Grok 2 1212 and Grok 2 Vision 1212 did not work on the /models page

Root cause:
• The model page for grok-2-vision-1212 and grok-2-1212 was not tested after they were added via Mission Control. They were redirected to the other grok models due to prefix aliasing
Impact:
• https://openrouter.ai/x-ai/grok-2-vision-1212 and https://openrouter.ai/x-ai/grok-2-1212 were resolving to the wrong models from [7PM PT](https://openrouter.slack.com/archives/C067BQEDNHM/p1734232934446049) to [11AM PT](https://openrouter.slack.com/archives/C05F41UHEE7/p1734289859565189?thread_ts=1734288212.280979&cid=C05F41UHEE7)
Resolution:
• Synced the models to add the permaslugs.json
Action item:
• DISCUSSION: Need to decide on whether we should remove the prefix alias slug, or have an alternative mechanism
Thread: https://openrouter.slack.com/archives/C05F41UHEE7/p1734288212280979
