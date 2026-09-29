*Hyperbolic filtered all assistant messages at request transform*

*Detection:*
• Hyperbolic flagged that Aider's bench showed vastly different results between calling OpenRouter vs Hyperbolic directly on Nov 24th 2024
*Root Cause:*
```const messages = transformedInput.messages.filter(
  (m) => (m.role === 'user' || m.role === 'system') && m.content !== null,
);```
• The above code in the hyperbolic adapter filtered for only user OR system messages and effectively ignored all assistant messages.
• Code introduced on Oct 16 in https://github.com/OpenRouterTeam/openrouter-web/pull/2257
*Impact:*
• From Nov 24 - Oct 16, all calls to Hyperbolic have been stripping out `assistant` messages, or 39 days
• Affected ~$11827.78 of volume
• 26,942,890 transactions
• 6327 users were affected
• Losing ~10.56B prompt tokens
*Resolution:*
• Separate out the actual condition we want to check for and return false for it: [commit 2](https://github.com/OpenRouterTeam/openrouter-web/commit/01625b66ff859cf998bdc12f2e0a18855a51193f), [commit 1](https://github.com/OpenRouterTeam/openrouter-web/commit/35cdcf1c8bc8a756842aeaff6ca1a630b0bf3777)
*Action Items:*
• Need unit test on the adapter's transform input/output to ensure the shapes are correct
