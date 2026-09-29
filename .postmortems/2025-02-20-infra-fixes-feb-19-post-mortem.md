---
Post-mortem for the infra fixes done on Feb 19th 2025

*Root Cause:*
• The `CancellableAbortController` added on Jan 31st 2025 did not trigger because the pause mechanism canceled the timeout
• The re-arm mechanism for the above trigger was only applied to requests where user asked for SSE stream, and not JSON
•  The sort by cache-control mechanism was overshadowed by the load balancer that came later in the router.submit
*Impact:*
• 10x the number of endpoint errors due to us not aborting and moving to the next endpoint (from 33k min to 374k max)
• *6000* requests missed cache control over 24 hours, spanning 1090 unique clerk user IDs
    ◦ Assuming an average prompt size of 120K tokens: `120000 / 1M * 0.75 * 6000` = *$540* overcharged cache pricing
• All stream:false request were not falling back to the next endpoint
Resolutions:
• Move the sort by cache-control logic next to the load balancer logic and status sorting logic
• Fixed the pause and bumped the mid-stream timeout to 20 seconds + 1ms per token
• Added a quick hack to re-arm the trigger on new SSE payload from upstream
*Action items:*
• Plan out an architecture refactor for the endpoint sorting/filtering logic such that they are done all in one place
    ◦ Without tampering with our logic to eagerly return the status (might need to double check with @U08C04FBGHW (John Colanduoni) -- but if we can hoist the timeout that was used by edge stream to eager return, i.e the preflight controller, it should be safe to do the async stuffs in parseRequest)
• Make more alert/dash that track the quality of user's received responses
