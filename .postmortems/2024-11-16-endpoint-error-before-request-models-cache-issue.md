*"Endpoint returned error" before ever making the request*

This error was being thrown by the runtime during some race-condition-like edge cases in the router
```Cannot perform I/O on behalf of a different request. I/O objects (such as streams, request/response bodies, and others) created in the context of one request handler cannot be accessed from a different request's handler.```
*Root Cause:*
• First request [hits redis for the endpoint's uptime status](https://github.com/OpenRouterTeam/openrouter-web/blob/7c80819c97f8c286ae684b8f168660026e036d12/packages/router/helpers/endpoint-status.ts#L83-L85) --> puts it into an in-memory LRU cache --> continues inference as normal
• Second request lands on the same edge isolate --> grabs the endpoint's uptime status from memory --> continues using that reference --> reference is GC'd by the runtime (or something to that effect) --> error thrown & request failed
*Impact:*
• Failed ~30k transactions over the 7 days. Was only possible on requests to models where there are multiple non-deranked endpoints.
• Possible that blast radius was larger, if we threw this error in other callsites. Above figure is only if it happened to throw inside the `Adapter.fetch()`
• Also possible that this was an issue in vercel all along, but masked as a different error, or failing silently
*Resolution:*  Removed the in-memory LRU cache usage for the endpoint status cache ([commit here](https://github.com/OpenRouterTeam/openrouter-web/commit/7c80819c97f8c286ae684b8f168660026e036d12))

*Action Items:*
• Remove the LRU cache from our codebase since its now a known failure mode  ([Only one usage remains ](https://github.com/OpenRouterTeam/openrouter-web/blob/7c80819c97f8c286ae684b8f168660026e036d12/projects/web/utils/db/users/index.ts#L92-L102)anyhow, so this should be quick)
• Investigate whether this same root cause is a problem for the models/endpoints cache or the "Promise will never complete" bug
context & debugging process in this thread:
https://openrouter.slack.com/archives/C05F41UHEE7/p1731712148346909
