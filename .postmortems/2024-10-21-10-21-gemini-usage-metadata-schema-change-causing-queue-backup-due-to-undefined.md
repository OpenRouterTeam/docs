*10-21 Gemini Usage metadata schema change causing queue backup due to undefined prompt input*
#bugs thread: https://openrouter.slack.com/archives/C05F41UHEE7/p1729537851748549

Symptoms --
• Queue insertion was failing due to `null` usage being calculated. This is due to a Gemini API update that made `usageMetadata.promptTokenCount` (their upstream usage token) to be optional. Thus, when used to add into our bn, it turned the usage into `undefined` -> `null` (at the tx writing step)
Damages --
• ~90 minutes worth of transactions on Gemini (with image content) had to be coerced to 0 due to usage token turned into `null`
Quick remedies --
2 hotfixes were deployed:
1. https://github.com/OpenRouterTeam/openrouter-web/commit/b07c7cb4f7a448c03646392a801f485f15cfb6c6 -- coerce all null usage/upstream_usage into 0
2. https://github.com/OpenRouterTeam/openrouter-web/commit/423c7096ab6e10f954c09703b16b322aa5365cfa -- fix the root cause within the gemini adapter, where the `promptTokenCount` is now marked as optional and is coerced into 0 accordingly
Action items --
1. (optional) Use the non-native prompt counting (GPT tokenizer) to calculate the user cost in the tx table, on the queue IF usage is null
2. fix the usage coercing logic to use `===` instead of `==` cc @U07MHP3NEF8 (Shashank Goyal)
