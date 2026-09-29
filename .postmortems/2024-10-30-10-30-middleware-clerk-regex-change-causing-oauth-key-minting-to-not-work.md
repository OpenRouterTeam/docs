# Middleware Clerk Regex change broke OAuth2

## Symptoms
- OAuth2 apps key minting flow was not working:
	- When trying to create a key via the /auth path
		- Upon clicking the auth button
		- An api call to `/api/keys/code` was made
		- The user was greeted with an alert:
		[image]
## Root causes
1. An update to the path regex used to inject the clerk auth was pushed at <mention-date start="2024-10-29" startTime="13:35" timeZone="America/Los_Angeles"/>
	1. [https://github.com/OpenRouterTeam/openrouter-web/pull/2407](https://github.com/OpenRouterTeam/openrouter-web/pull/2407)
	2. This update bypass ALL public API routes from reading clerk session cookies
	3. The  `/api/keys/code` path was marked as a public route, thus it was not blessed with the clerk cookie auth header
	4. This led to no auth injection, causing the key minting to throw 401 because no account was available to make the key
2. Lack of test coverage on this path e2e as well as unit test —
	1. We have been relying on SillyTavern as a way to test out the flow, however this requires efforts in setting it up
	2. We do not have a unit test that would fail
	3. Need more test on `/api/keys/code` in general, and need to have it somewhere in our middleware.
We have been operating under the premise that all paths were private, and “public” paths are explicit. By inverting that (i.e specifically checking for private path and all paths are considered public by default), we forgot about blessing the `/api/keys/code` path with auth cookie (since it wasn't specified in the needUser regex originally), and thus it fell off the radar.
## Damages
- The OAuth2 sign-up flow was down for \~19 hours
	- Losing about 1400 sign-ups (using an eyeballed avg signup around the incident date
	[image]

## Quick remedies
- Reverted the Clerk path changes to restore it back to the original state
	- [https://github.com/OpenRouterTeam/openrouter-web/pull/2420](https://github.com/OpenRouterTeam/openrouter-web/pull/2420)

## Action items
- Unit test the key minting mechanism
- Redo the clerk auth path refactor, tagging <mention-user url="user://9e1f93c3-e2d7-4404-b8b9-3cd9c375dc1d"/>

---
## Summary
- OAuth2 app key minting flow broke due to a middleware regex change
- Root cause: Update bypassed public API routes from reading clerk session cookies
- Quick fix: Reverted Clerk path changes to original state
- Lesson learned: Need more comprehensive testing and careful consideration of auth implications when modifying middleware
- Action items: Implement unit tests for key minting, redo clerk auth path refactor
- Impact: OAuth2 sign-up flow down for \~19 hours, estimated 1400 lost sign-ups
