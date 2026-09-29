Quick mini post-mortem for this: https://openrouter.slack.com/archives/C0594EAV9U6/p1766098587545689

My PR merged shortly after release was triggered: https://github.com/OpenRouterTeam/openrouter-web/compare/16c7edc751a5...4af27d94b337
It introduced a shape change to our endpoint type and a migration. Unfortunately the change made it into vercel because vercel deploys are triggered off of a branch (main) and not a commit sha but did not make it into cfw-api.

Action item: get vercel deploys to somehow deploy the same code that everything else is deploying
