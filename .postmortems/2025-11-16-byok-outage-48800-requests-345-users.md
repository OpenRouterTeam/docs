# Postmortem: BYOK 2025-11-15

Bring Your Own Key requests (BYOK) were unavailable for all customers on Sat November 15 from 11:28AM to 11:33AM Pacific.
## Impact
Approximately 48,800 BYOK requests to chat/completions across 345 users (counting unique Clerk user IDs) failed (500s).
Another \~20K requests likely fell back from BYOK to non-BYOK but were still serviced.
## Timeline

| Fri Nov 14
9:12PM Pacific
| John Krauss tested [PR 9393](https://github.com/OpenRouterTeam/openrouter-web/pull/9393) [as a ](https://github.com/OpenRouterTeam/openrouter-web/pull/9393)[0% deploy](https://github.com/OpenRouterTeam/openrouter-web/pull/9393), confirming several requests worked.

| Sat Nov 15
11:28AM Pacific
| cfw-api version `15f8bbde-186b-4d6a-b5a7-ee82c0a0392d` rolled out, corresponding to this changelog including [PR 9393](https://github.com/OpenRouterTeam/openrouter-web/pull/9393) “0785355e9 do not use dynamic import for packages/router import in cfw-api”

| 11:28AM Pacific
| **Incident begins

**As the rollout progressed, successful BYOK transactions dropped to 0 as 500s increased to a steady state of \~170 per second. Error message “PROVIDER_ENCRYPTION_KEY is not set in the environment” are prevalent in the 500s.

| 11:29AM Pacific
| Smoke tests [passed](https://github.com/OpenRouterTeam/openrouter-web/actions/runs/19394470330/job/55492650786)

| 11:30AM Pacific
| Warning fired on alerts-api “**Warn: High 500 API Error Rate!****”**

| 11:32AM Pacific
| Alert fired on #alerts-api “**Triggered: High 500 API Error Rate!****”**

| 11:32AM Pacific
| John Krauss responded to the alert that he would roll back the release and initiated a rollback via Cloudflare UI.

| 11:33AM Pacific
| Rollback complete, requests work again as previous version `5da4abd3-a281-416f-b00c-667ebf624499` deploys.

**Incident resolved**

## How this slipped through

## Root cause
[PR 9393](https://github.com/OpenRouterTeam/openrouter-web/pull/9393) changed cfw-api’s import of `packages/router` from an async import that would happen on the first request to a worker to a standard import that would be loaded on startup.
This change caused the cfw-api [env middleware](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-api/src/middlewares/env.ts), which is intended to capture the env variables included with each `fetch` request and place them into `process.env`, to no longer be the first caller to try to cache the env variable `PROVIDER_ENCRYPTION_KEY`. Instead, on module load `packages/router` cached a null `PROVIDER_ENCRYPTION_KEY` and cfw-api was unable to decrypt customers’ BYOK keys.
It doesn’t seem this env caching at load time by `packages/router` was intentional. The mechanism was:
1. services/cfw-api imports Router from [packages/router/index.ts](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/router/index.ts) immediately
2. [packages/router/index.ts:124](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/router/index.ts#L124) imports `getDefaultRoutingErrorMessage`
3. [packages/router/helpers/get-default-routing-error-message.ts:5 ](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/router/helpers/get-default-routing-error-message.ts#L5)calls `getSiteURL()` at module load time
4. [`getSiteURL()`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/helpers/url.ts#L53) calls `ensureEnv()` from [packages/helpers/env.ts](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/helpers/env.ts#L16)
5. `ensureEnv()` validates [process.env and caches the result](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/type-utils/ensure-env.ts#L58)
In a nutshell, the problem was [this line](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/router/helpers/get-default-routing-error-message.ts#L5C1-L6C1) (which calls `getSiteURL()` being run at module load rather than after the first request’s env middleware had run and cached the correct env:
```javascript
const GPT_4_1_REVEAL_MESSAGE = `Quasar and Optimus were stealth models, and revealed on April 14th as early testing versions of GPT 4.1. Check it out: ${getSiteURL()}/openai/gpt-4.1`;
```
When a BYOK request came in, this code would now throw `PROVIDER_ENCRYPTION_KEY is not set in the environment`:
```javascript
if (userProvidedKey) {
  return decrypt(userProvidedKey.cipher, userProvidedKey.nonce);
}
```
## Impact analysis
Of the 345 impacted users, there were:
- 11 that had \>100 impacted requests
- 22 that had \>\$1000 spend in OR in the last month and 10 with \>\$10,000 spend in the last month.
- Of the 10 with \$10,000 spend in the last month, there were 5 with \>100 impacted requests:
	- Kilocode, `org_2uwFc1szZKyZweUX7pX97kXQf2O`, 6680 requests and \$86,047 spend
	- [eliemichele1032@gmail.com](mailto:eliemichele1032@gmail.com), 22287 requests and \$40,120 spend
	- Cline `org_2ue3sRj4x3tXiJ1Dy2aaiheiHnm`, 7495 requests and \$32,032 spend
	- [Blackbox.ai](http://Blackbox.ai) `user_32uoZTHoAVhWjEkzJvRIIVBLVtu`, 1065 requests and \$16,726 spend
	- Roocode `org_2udh5086Gx2BJFrW3OiNUsnwj7x`, 951 requests and \$10,440 spend
	- The other 5 (Kurage.llc, artisan.co, shapes.inc, rrotsted@openai.com, context.wtf, and shandagpt1@gmail.com) all had less than 40 impacted requests
Request volume prior to the incident was \~16k/minute. During the incident it dipped from \~12K/minute to \~9.5K/minute over several minutes.
[image]
The immediate drop suggests that \~4K BYOK requests were immediately diverted to non-BYOK, and that over the course of several minutes downstream applications may have load balanced away from OR. As soon as BYOK service resumed requests returned to normal volume. It’s hard to tell if there was any spike from backoff/retries by clients.
The majority (\~30,400 of 48,800) of failed requests were for `x-ai/grok-code-fast-1`.
[image]
In fact, x-ai/grok-code-fast-1 volume increased \~4x during the incident period, while Gemini volume dropped significantly. It seems the 500s, in addition to rebalancing requests away from BYOK, rebalanced requests to the “last desired model” which then was assigned the 500.
## Action items

| **Action**
| **Urgency**
| **DRI**

| Determine which customers should be notified
| High
|

| Wrap the return of [helpers/ciphers#decrypt](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/helpers/ciphers.ts#L44) to no longer throw?
| Low
|

| Confirm BYOK requests are in the E2E test suite
| Medium
|

| Update the <mention-page url="https://app.notion.com/p/1b92fd57c4dc80d4ab4fd9f967bb9071"/> document to recommend running E2E tests when validating a 0% deployment.
| Medium
|

| Improve E2E tests to make them easier to use, both in terms of getting necessary credentials and executing the tests themselves
| Medium
|

| Turn on `nodejs_compat_populate_process_env` flag so that `process.env` has the values we would expect in a normal node env
| High
|

| Remove code (like the env middleware) in cfw-api that is no longer necessary with `nodejs_compat_populate_process_env`
| Low
|

| Add a BYOK request to smoke tests? What happens if they fail?
|
|

| *Your action item here?*
|
|

## References
Incident thread: [[link removed]
Hex user analysis thread: [Hex - Do more with data, together](https://app.hex.tech/091db13f-d26f-4224-a185-6fce9df76f90/thread/019a8abc-5e37-7003-aa57-db1a30a8e836)
Datadog notebook: [[datadog link]
