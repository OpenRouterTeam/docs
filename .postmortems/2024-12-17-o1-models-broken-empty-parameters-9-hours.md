## O1 Models were not working on OpenRouter from 1 20 AM EST to 10 30 AM EST on 12/17.

Root Cause:
1. Most likely that we are sending empty parameters even if user didnt ask for them
```body {"max_completion_tokens":10,"model":"o1-mini","stream":true,"stream_options":{"include_usage":true},"user":"user_2mG4pMnua3OUlvf7qhm4aErJFl0","messages":[{"role":"user","content":"Yes or no?"}],"seed":null,"logit_bias":{}}```
Impact:
1. No usage on o1 models for 9 hours.
2. ~7200 requests
3. Approximate daily dollar value is $2k so we lost about $1k of usage.
Resolution:
1. [Removed logit_bias](https://openrouter.slack.com/archives/C05HMV4J6JE/p1734448711643369) from supported parameters
Action Item:
1. How do we detect these failures automatically? -- We had no alerts on this.
2. We didnt have any changes last night, something changed on the OpenAI API. -- How do we deal with this.
3. Might need some basic synthetic tests on high value models.
cc @U054ACGRB2R (Alex Atallah) @U06DJ8YS066 (sam) @U07TEQPJRRR (Chris Clark)
