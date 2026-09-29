# Postmortem: Responses API SDK Breakage 2026-01-12

tl;dr: A PR updating the responses API to match the OpenAI spec made the `usage` field nullable. The schema and SDK were not updated, causing Zod validation errors for all SDK users.
## Summary
On January 12th, a PR was merged that updated the responses API to more closely match the OpenAI responses API spec. This change allowed the `usage` field on streaming chunks to be nullable (previously it was either a value or undefined). While the API functionality was updated, the schema and documentation were not updated to reflect this change. This caused our SDK to throw Zod validation errors for users, as the SDK strictly validates responses against the published schema.
## Incident Details
- **Date Range:** January 12-13, 2026
- **Severity:** SEV-3 (Medium)
- **Incident Lead:** Matt Apperson
- **Detection Method:** internal usage / dogfooding
- **Users Affected:** All SDK users using callModel or Responses API + Unknown number of direct Responses API users
## Timeline
(All times PST)
**Sunday Jan 12 - 10:45PM**
1. PR [#11862](https://github.com/OpenRouterTeam/openrouter-web/pull/11862) by <mention-user url="user://209d872b-594c-81dc-8d2a-00028f50441a"/>  merged, updating responses API to allow nullable usage field
2. Once that released, all users of the SDK experienced breakage of 100% of all streaming responses API usage, including callModel
**Monday Jan 13**
1. 2:04 PM: The issue was confirmed
2. 3:00 PM: The cause was identified and <mention-user url="user://1eed872b-594c-81f3-8c6c-00029c8cebd8"/> opened a PR to update the SDK spec but it was missing any schema changes from [https://github.com/OpenRouterTeam/openrouter-web/pull/11862](https://github.com/OpenRouterTeam/openrouter-web/pull/11862)
3. \~7:00 PM: <mention-user url="user://23ed872b-594c-81e5-987c-0002ea571946"/> identified that [https://github.com/OpenRouterTeam/openrouter-web/pull/11862](https://github.com/OpenRouterTeam/openrouter-web/pull/11862) did not change any schemas only actual returned shapes… Fix PR [#11958](https://github.com/OpenRouterTeam/openrouter-web/pull/11958) merged to update schema
4. SDK releases published:
	- TypeScript SDK: [PR #148](https://github.com/OpenRouterTeam/typescript-sdk/pull/148)
	- Python SDK: [PR #32](https://github.com/OpenRouterTeam/python-sdk/pull/32)
## Impact
- All prior SDK versions became broken
- Users of the `callModel` feature in the SDK were affected
- Users of the direct responses API within the SDK were affected
- Third-party validators checking against our published schema were affected
## Root Cause
The API was updated to allow `usage` field on chunks to be nullable, but:
1. The OpenAPI schema was not updated to reflect this change
2. The documentation was not updated
3. The SDK's strict Zod validation rejected the `null` value as it didn't match the schema
4. The change was not backwards compatible
## Contributing Factors
1. **Our API does not validate responses against its own stated schema** — the API types create conflicts between `null` and `undefined` due to differences in how OpenAPI handles null versus undefined in TypeScript typings
2. **No process to ensure schema, docs, and API implementation stay in sync**
3. **SDK Zod validation is strict** — on the client side, proper Zod validation is required to ensure that the returned values match the types we promise; in this case, the change broke the SDK
## Resolution
- Published PR [#11958](https://github.com/OpenRouterTeam/openrouter-web/pull/11958) to fix the schema
- Released updated TypeScript SDK ([PR #148](https://github.com/OpenRouterTeam/typescript-sdk/pull/148))
- Released updated Python SDK ([PR #32](https://github.com/OpenRouterTeam/python-sdk/pull/32))
## Action Items
- [ ] Add API output validation against schema (at least in dev environment)
- [ ] Define backwards compatibility policy for maintaining compat with OpenAI spec while not breaking SDK users
## Open Questions
- How do we maintain backwards compatibility while adhering to the upstream OpenAI spec?
- Should we consider loosening Zod validation in the SDK even though this means losing its protective benefits?
