*Adding env variables caused a complete outage for cloudflare (1.5 minutes) and vercel API (not website) (20 minutes).*
*Root cause -* Right now we mark env variables as required and throw an error if they arent present. Since they were not present in cfw we were throwing the error 100% of the time.
*Impact*
•  No generation traffic for 1.5 minutes
• No vercel redirected generations traffic for 20 minutes.
*Resolution*:
• rolled back cfw
• Added env vars to both places
• Rolled forward
Future improvements:
• *Require new env variables to be optional.*
• Throw elogs if they are expected to be set and are not set
    ◦ This will alert us in sentry fairly quickly
• Allows the rest of the app that does not depend on the vars to function normally.
