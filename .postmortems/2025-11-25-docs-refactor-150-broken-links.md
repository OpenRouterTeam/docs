*Docs Incident*

*Incident timeline:*

11/20:
•  A docs refactor was merged in the following PR https://github.com/OpenRouterTeam/openrouter-web/pull/9735 created by Matt A and reviewed by Shashank
• Over the course of several hours we received an increasing number of reports that links were broken in the docs. Shashank found and used https://www.deadlinkchecker.com/website-dead-link-checker.asp to determine that we had over 150 broken links. Once we realized it was more than a couple of missed redirects, Shashank and Matt A Huddled and decided a revert was the best course of action and was merged in PR https://github.com/OpenRouterTeam/openrouter-web/pull/9781
11/21:
• The Docs were announced on socials, the main thread for the docs redesign having not been alerted of the revert
• A PR to re-release the docs refactor was made by Matt Apperson in PR https://github.com/OpenRouterTeam/openrouter-web/pull/9806 including “fixes” for the vast majority of the broken links. Once deployed https://www.deadlinkchecker.com/website-dead-link-checker.asp was run reporting ~12 broken links (same as pre-docs redesign, though not the same broken links)
11/24
• 8:48am -More doc link errors began being reported
• Tom A (and others) began merging additional PRs to address many of the issue
Ongoing:
• Matt A is monitoring for any straggler issues, and pushing hot fixes
*What happened:*
1. The fern config is a mix of path based routing, declarative path slugs, section name based auto-slug-naming. Steps taken to ensure a lack of breaking changes by this refactor including multiple meetings with the fern team, the details of how this pathing worked and the fact that any url could be made up of all the above paths was not fully understood by Matt A
2. Although manual testing was done by Matt A, it was not extensive enough relative to the number of changed page URLs (the number of changed pages was not fully understood (see point 1)
3. Although there was attention given during the second rollout of the redesign by using the https://www.deadlinkchecker.com tool, however, although the new docs site was deployed, not all dead links were identified by the tool right away due to caching. Fern has since confirmed that the exact content getting served when visiting our docs could be in flux for roughly 10min following a deploy as caches clear.
4. Even still, the AI search feature was not re-indexing and a request to manually re-index had to be sent to fern
5. The current docs.yaml is a mix of generated/injected docs from the SDKs and hand maintained config, this made fixes brittle as things once fixed were getting overwritten.
*Follow up actions:*
1. We should add alerting to Google Analytics when there is a spike in 404 errors on the site and monitoring this should be a part of the release flow
2. Update the Release Workflow documentation to include that if docs were changed in the deploy, they need to be verified 10min after a release to ensure the correct content is being viewed or validated
3. Split up docs.yaml into 1 main file, 1 for the API reference, and 1 for the SDKs, this will make it clear that only the primary docs.yaml is hand-maintained
4. Checks for dead links, manual or automatic once a deploy is done. We need to identify a tool or workflow that allows for crawling the site when running locally and in CI. Some options include:
    a. https://www.npmjs.com/package/markdown-link-check
    b. https://www.npmjs.com/package/@umbrelladocs/linkspector
