# Post Mortem: strict:true bug

# Update
We were unable to fix this bug due in an expedient fashion (and did not receive customer reports about it) due to cascading deprioritizations.
However, Codex has since [deprecated the /chat/completions endpoint](https://github.com/openai/codex/discussions/7782v) ([release](https://github.com/openai/codex/pull/559)), thereby fixing the bug for us.
The fix we would've implemented is [here](https://app.graphite.com/github/pr/OpenRouterTeam/openrouter-web/12576/fix-remove-response-healing-and-strict-coercion-for-OpenAI-endpoints?onboarding_state=not-authorized) (in short, removing the `default(true)` in the `OpenAIResponsesToolSchema` Zod schema) although we got blocked on writing integration tests that could repro the error. The PR was written with `0.77.0` version of Codex in mind, while the newest, fixed version is `0.107.0`.
Related issues opened in Codex here:
- [https://github.com/openai/codex/issues/525#issuecomment-2821528784](https://github.com/openai/codex/issues/525#issuecomment-2821528784)
- [https://github.com/openai/codex/issues/7721#issuecomment-3796570396](https://github.com/openai/codex/issues/7721#issuecomment-3796570396)
- [https://github.com/openai/codex/issues/7721#issuecomment-3668665647](https://github.com/openai/codex/issues/7721#issuecomment-3668665647)
- [https://github.com/openai/codex/issues/11088#issuecomment-3867222008](https://github.com/openai/codex/issues/11088#issuecomment-3867222008)

---

# Recording of PM meeting on 1/12
<file src="file://%7B%22source%22%3A%22attachment%3Ab1746bfb-aaf7-4b61-8594-3357b4136f4d%3APost-mortem_Strict_True_Issue_Recording_Jan_12_2026.mp4%22%2C%22permissionRecord%22%3A%7B%22table%22%3A%22block%22%2C%22id%22%3A%222e62fd57-c4dc-807b-b039-dfba1301407a%22%2C%22spaceId%22%3A%223ca2dde7-b06f-4c41-8d77-2aa5e789af62%22%7D%7D"></file>
## Symptoms
Users reported that OpenAI models weren’t returning results when they previously had, [more here.](/2e42fd57c4dc80ee9431e2f4343e388c?pvs=25#2e42fd57c4dc8081a3a5d34cc245843c)
## Timeline
### 1/5 \~5:00 pm PT
- Original bug reported by Audrey : [https://openrouter.slack.com/archives/C05F41UHEE7/p1767661342191359](https://openrouter.slack.com/archives/C05F41UHEE7/p1767661342191359)
	- Note: this was happening with `gpt-5` not `gpt-4o`
	[image]
```plain text
{"error":{"message":"Provider returned error","code":400,"metadata":{"raw":"{\n "error": {\n "message":

"Invalid schema for function 'shell': In context=(), 'additionalProperties' is required to be supplied and to be false.

",\n "type": "invalid_request_error",\n "param": "tools[0].parameters",\n "code":

"invalid_function_parameters"\n }\n}","provider_name":"Azure"}},"user_id":"org_2uMVNwONqhSdZXQy1QtyWuCjTxZ"}
```
### 1/5
- John puts up PR to fix: `fix: recursively add additionalProperties: false to Responses API tool call schemas` [https://github.com/OpenRouterTeam/openrouter-web/pull/11383](https://github.com/OpenRouterTeam/openrouter-web/pull/11383)

### 1/9 at \~1:40 pm PT:
- Audrey puts up PR b/c still encountering the issue: `fix(schemas): respect strict field in Responses API tool schemas`:  deployed
	- This PR unintentionally changed the behavior of models like gpt-5x that can be called with chat completions but in fact make responses api calls to upstream, introducing `strict: true` when it was not set in underlying tool calls
	- Timing lines up well with "rhokstar"s report that "10 hours ago" (as of 23:40, likely pacific time) things started breaking

### 1/10 9:38 am PT
-  Toven reports user-reported bug from Discord
- [slack message]
	[image]

### 1/10 10:45 am PT
- John rolls back Audrey’s PR: [https://github.com/OpenRouterTeam/openrouter-web/pull/11756](https://github.com/OpenRouterTeam/openrouter-web/pull/11756)

### 1/10 \~3:45 pm PT
- Audrey, Louis, and John get on a huddle to confer [slack message]

## Root causes
- Inconsistencies between openAI API documentation, openAI SDK documentation, and our Zod schema
- Bug in merged PR = added `strict:true` to `/chat/completions` tool calls, which previously had been untouched when sent through OR

## Damages
- Users started reporting on Discord that their OpenAI requests were failing with e.g. this error:
	```json
openai.BadRequestError: Error code: 400 - {'error': {'message': 'Provider returned error', 'code': 400, 'metadata': {'raw': '{\n  "error": {\n    "message": "Invalid schema for function \'youtube_video_search\': In context=(), \'required\' is required to be supplied and to be an array including every key in properties. Missing \'n_results\'.",\n    "type": "invalid_request_error",\n    "param": "tools[2].parameters",\n    "code": "invalid_function_parameters"\n  }\n}', 'provider_name': 'OpenAI'}}, 'user_id': 'user_2mycPxUxpz3AIKBBEcsZijicC7B'}
	```
- \~2k users affected via DD analysis by <mention-user url="user://5178785b-bafd-49fd-9111-69f8384e215d"/>
- Between when the 1st user reports started trickling in (\~9:30 am PT on 1/10) and us rolling back the problematic PR (\~10:45 am PT), it was \~1 hr where OpenAI reqs through OpenRouter were failing
	- I believe this is just for `gpt-5x` models, as per this image from Toven (-Audrey):
		[image]
## Quick remedies
- Rollback PR [https://github.com/OpenRouterTeam/openrouter-web/pull/11756](https://github.com/OpenRouterTeam/openrouter-web/pull/11756) (1/10 10:45 am PT)
	- Why rollback was decided: (from John:) considering the limited automated test coverage and repros in place, plus the fact that 11420 was meant to fix a bug with codex that we mainly encountered internally (and it's a weekend where our ability to follow up on unintended consequences is limited), a rollback is more appropriate than an additional fix

## Action items
- Add in more specific unit test coverage to cover the variety of cases here (eg `[chat completions | responses request] * [chat completions | responses upstream] * [strict | not strict | undefined strict]`)
	- For /responses endpoint models:
		- What happens when user includes `strict:false` —\> should be that the tool call is then not modified
		- What happens when they leave it out —\> should be that defaulted to `strict: true` and healing is done recursively by OpenAI ONLY if coming from /responses
		- What happens in both the cases above, PLUS there are recursive fields in the original request —\> should be that there is no difference, recursive doesn't impact anything
		- we need to set `strict:false` when coming from /chat/completions and going to /responses
	- Same for /chat/completions endpoint models
		- OpenAI does not echo back the response here, so will be harder to test
- ~~Remove that ~~~~`default(true)`~~~~ from the zod responses toolcall schema~~
	- Updated thinking, based on Louis thinking OpenAI does some healing on the request on behalf of the user:
		- If user's request was from chat completions endpoint, we should explicitly set `strict: false` (legacy `/chat/completions` behavior) b/c we send `/chat/completions` to `/responses`; otherwise they’ll be rejected by upstream OpenAI
		- If user's request was from responses endpoint, we should leave it alone and let OpenAI do the healing for us
		- Get rid of all our healing
- kill all the `additionalProperties: false` code (plus adding a buncha tests)
	<callout icon="💡" color="gray_bg">
		- John: should we just get rid of all request healing? Set `strict:false` when it’s ambiguous —\> we want to make sure using OpenAI models via OR is the SAME as doing it direct to OpenAI
	</callout>
- Get OpenAI to fix their docs
	- Louis has reached out to them in our channel w/them:  [slack message]
- Create alerts for provider 400 errors !!
	- Note: 400s are default filtered out from our main dashboard b/c they’re usually user error
	- Confirm anomaly at the time was actually spiky. Would an alert even have caught this? Would an alert that catches this not catch other stuff?
- Use hex agent to crawl through this CSV for users with high spend (in \$), pull out a sample to communicate with about the error
	Users affected:
[https://us5.datadoghq.com/logs?query=env%3Aproduction \*%3A"is required to be supplied" %40extra.model%3A\* %40extra.provider_name%3AOpenAI %40extra.status%3A400 -%40extra.is_byok_required%3Atrue %40extra.is_byok%3Afalse %40extra.provider_name%3AOpenAI %40breadcrumbs.clerk_user_id%3A\* "Endpoint returned error"&agg_m=count&agg_m_source=base&agg_q=%40breadcrumbs.clerk_user_id&agg_t=count&analyticsOptions=\["bars"%2C"dog_classic"%2Cnull%2Cnull%2C"value"\]&clustering_pattern_field_path=message&cols=host%2Cservice%2C%40breadcrumbs.clerk_user_id&flat_group_bys=true&fromUser=true&messageDisplay=inline&refresh_mode=paused&sort_m=count&sort_t=count&storage=hot&stream_sort=time%2Cdesc&top_n=100&top_o=top&viz=query_table&x_missing=true&from_ts=1767991947142&to_ts=1768074274000&live=false]([datadog link]
	<file src="file://%7B%22source%22%3A%22attachment%3A34b2a86b-d227-4bd1-8385-a7572f9f8693%3Aextract-2026-01-10T23_55_55.010Z.csv%22%2C%22permissionRecord%22%3A%7B%22table%22%3A%22block%22%2C%22id%22%3A%222e62fd57-c4dc-80e0-9390-ef23af088789%22%2C%22spaceId%22%3A%223ca2dde7-b06f-4c41-8d77-2aa5e789af62%22%7D%7D"></file>
	- Audrey doing: [https://openrouter.slack.com/archives/C05H3A104BS/p1768089532956809](https://openrouter.slack.com/archives/C05H3A104BS/p1768089532956809)

---

## Misc.:
### Questions to investigate when ppl have time
- what is the `strict` default for `/responses` *IRL*
	- what is it for `/chat/completions`
	- how does this change (if at all) btwn `gpt-5` and `gpt-4o`?
	- Diff btwn OpenAI SDK and OpenAI’s OpenAPI spec?
		- Diff btwn OpenAPI spec and “manual” spec?
- how does codex send the request? how does it differ btwn azure and other providers?
- Historically, why did we make our repo default `strict:true` in our zod schema for `/responses`? —\> Because SDK originally said it was mandatory, right <mention-user url="user://5178785b-bafd-49fd-9111-69f8384e215d"/>?
- Purpose of our`patches/openai.patch`?

### Relevant Slack threads
- Breakage found by user on Discord, reported by Toven on Slack 1/10: [slack message]
- Audrey and John’s debugging thread: [slack message]
- Original bug report by Audrey 1/6: [slack message]

### Examples of conflicting documentation that led to confusion
- Responses API: [https://platform.openai.com/docs/guides/migrate-to-responses#5-update-function-definitions](https://platform.openai.com/docs/guides/migrate-to-responses#5-update-function-definitions)
	[image]
- Strict mode docs: [https://platform.openai.com/docs/guides/function-calling#strict-mode](https://platform.openai.com/docs/guides/function-calling#strict-mode)
- Function docs mentioning `strict` (but not confirming default of `true`): [https://platform.openai.com/docs/guides/function-calling#defining-functions](https://platform.openai.com/docs/guides/function-calling#defining-functions)
- Their SDK defaults strict:true, as noted by Louis: [slack message]
	[image]
- I can confirm here in their most recent OpenAPI spec that `strict` defaults to `false` [https://github.com/openai/openai-openapi?tab=readme-ov-file](https://github.com/openai/openai-openapi?tab=readme-ov-file).
- Look at Codex repo again; looks like `strict` defaults to `true` only when the user provides an external schema (which makes sense) [https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs#L151](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/common.rs#L151)
- Louis pointing out that OpenAI’s API seems to “heal” the response and interpolate `strict:true` when it’s left out by the user: [[link removed]

## Curls
Azure:
```json
curl "https://openrouter-east-us-2.openai.azure.com/openai/responses?api-version=2025-04-01-preview" \
    -H "Content-Type: application/json" \
    -H "Api-Key: $AZURE_EAST_US_2_API_KEY" \
    -d '{
      "model": "gpt-5",
      "input": "What'\''s the weather like in San Francisco?",
      "tools": [
        {
          "type": "function",
          "name": "get_weather",
          "description": "Get the current weather for a location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "The city and state, e.g. San Francisco, CA"
              },
              "unit": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"],
                "description": "Temperature unit"
              },
              "optional_param": {
                "type": "string",
                "description": "This field is intentionally NOT in required array to trigger error"
              }
            },
            "required": ["location", "unit"],
            "additionalProperties": false
          }
        }
      ]
    }'
```

OpenAI
```json
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-5.2",
    "input": "What'\''s the weather like in San Francisco?",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "strict": true,
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "The city and state, e.g. San Francisco, CA"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"],
              "description": "Temperature unit"
            },
            "optional_param": {
              "type": "string",
              "description": "This field is intentionally NOT in required array to trigger error"
            }
          },
          "required": ["location", "unit"],
          "additionalProperties": false
        }
      }
    ]
  }'
```

- cURL John used to confirm when putting up `fix: recursively add additionalProperties: false to Responses API tool call schemas` [https://github.com/OpenRouterTeam/openrouter-web/pull/11383](https://github.com/OpenRouterTeam/openrouter-web/pull/11383)
	```json
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5",
    "messages": [{"role": "user", "content": "Call the shell tool with command echo hi and cwd /tmp"}],
    "stream": true,
    "debug": { "echo_upstream_body": true },
    "provider": { "only": ["azure"] },
    "tools": [{
      "type": "function",
      "function": {
        "name": "shell",
        "strict": true,
        "parameters": {
          "type": "object",
          "properties": {
            "command": { "type": "string" },
            "opts": {
              "type": "object",
              "properties": { "cwd": { "type": "string" } }, "required": ["cwd"]
            }
          }, "required": ["command", "opts"]
        }
      }
    }]
  }'
	```
