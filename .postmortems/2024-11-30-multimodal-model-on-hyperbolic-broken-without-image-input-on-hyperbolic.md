---
*Multimodal model on Hyperbolic broken without image input on Hyperbolic*

This error was returned by Hyperbolic on Chatroom and our API if users send requests without images to QwenVL models:
```Error 400
(Hyperbolic) Provider returned error: {"object": "error", "message": "Qwen/Qwen2-VL-7-2B-Instruct does not support completions.", "type": "", "param": null, "code": 40302}```
*Root causes:*
• Testing was limited to the base instruct model (which showed the original error), as well as the image model, but without the test case where we send just text input.
• Commit that triggered the issue:
    ◦ https://github.com/OpenRouterTeam/openrouter-web/commit/05367ac1a47eaa8309c98c29aa753549326c69b5
    ◦ 3 days ago
*Impact:*
• During the 3 days:
    ◦ 1212 requests were rejected due to this specific error
    ◦ We couldn't find the exact amount of unique user who were affected by this
• Based on the activity chart, I queried for the activity before the commit and after the commit:
    ◦ We lost 180K requests each day
        ▪︎ At 3 days with a 7% growth rate, that's ~ 661K requests lost
    ◦ We lost ~300M tokens each day, which translated roughly to about $*11* of volume
        ▪︎ At 3 days and with a growth rate of 7% a day, we would be looking at a max loss of 1B tokens on these models or ~*$36* of volume
• Users who wanted to send just text input received the error above, leading to broken chatroom for these models
*Quick fixes:*
1. Merged this PR to resume the special handling for Hyperbolic: [[link removed]
*Action items:*
1. Merge in vendor test fix and vendor test on Mission Control
    a. Derive automatic recovery or some sort of resiliency against endpoint changes
    b. Add tests for multimodal models for both text-only and text+image cases
    c. See this PR: https://openrouter.slack.com/archives/C05H0Q56R7S/p1732994464791969?thread_ts=1732946706.355249&cid=C05H0Q56R7S
2. Discussion: Might be safer to always route to chat/completions for text+image->text models?
    a. Or we add has_completions and has_chat_completions to the endpoint and switch based on that logic
3. Need to surface the clerk_user_id that received provider error
ref: https://openrouter.slack.com/archives/C05F41UHEE7/p1732995124759439
