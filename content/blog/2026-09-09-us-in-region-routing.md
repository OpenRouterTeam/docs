---
title: "In-Region Routing: Keep your data in the US or EU"
date: "2026-09-09T00:00:00.000Z"
author: "Cailee Moberg"
teaser: "US In-Region Routing is live, joining the EU. Send requests to us.openrouter.ai and they are decrypted only inside the United States and served only by providers running there, across models from OpenAI, Anthropic, Google, NVIDIA, Thinking Machines, DeepSeek, Moonshot, and Qwen."
headerImage:
  url: "/images/us-in-region-routing.png"
  width: 1344
  height: 768
category: "announcements"
metaTitle: "In-Region Routing: keep your data in the US or EU"
metaDescription: "US In-Region Routing is now available alongside the EU. Prompts and completions are decrypted and processed inside the region you choose, across the models available in that region, on Business and Enterprise plans."
faq:
  - question: "How do I use In-Region Routing?"
    answer: "Change your base URL to us.openrouter.ai or eu.openrouter.ai. Your API key, request format, and model IDs stay the same. Requests sent to that hostname are decrypted only inside the region and routed only to providers operating there."
  - question: "Which models are available for US In-Region Routing?"
    answer: "Models available today include GPT-5.6, Claude Opus 5, Gemini 3.6 Flash, Grok 4.6, NVIDIA Nemotron 3 Ultra, Thinking Machines Inkling, DeepSeek V4 Pro, Kimi K3, GLM 5.2, gpt-oss-120b, and Qwen3 Coder. The list grows as providers bring more endpoints in-region. Browse the current one at openrouter.ai/models?region=us, or call /api/v1/models through us.openrouter.ai. Swap us for eu to see the European list."
  - question: "Does the model's lab have to be a US company?"
    answer: "No. What matters is where inference runs, not where the lab is headquartered. DeepSeek V4 Pro, Kimi K3, and GLM 5.2 are available for US In-Region Routing because Baseten, Fireworks, and Azure serve them from US data centers, and GLM 5.2 is available for EU In-Region Routing because Mistral serves it from EU data centers."
  - question: "How is this different from pinning the provider's inference region?"
    answer: "Pinning inference covers the last hop only, so a request can still terminate and be processed outside the region before it reaches the provider. On OpenRouter, requests are decrypted only inside the region you chose and are processed entirely within it at every point in the request lifecycle."
  - question: "What happens if no in-region provider can serve my request?"
    answer: "The request fails rather than routing outside the region. Features that would send prompt or completion data to infrastructure outside the region are disabled on the regional endpoint instead of falling back to global infrastructure."
  - question: "Who can use In-Region Routing?"
    answer: "Business and Enterprise plans. Any organization can switch itself to Business at openrouter.ai/settings/manage-plan. Contact the enterprise team at openrouter.ai/enterprise/form if you need invoicing, SLAs, or volume pricing."
howTo:
  name: "Send a request through In-Region Routing"
  totalTime: "PT5M"
  steps:
    - name: "Get on a plan that includes it"
      text: "In-Region Routing ships with the Business plan, which you can switch to from openrouter.ai/settings/manage-plan, and with Enterprise. Contact the enterprise team at openrouter.ai/enterprise/form for invoicing, SLAs, or volume pricing."
    - name: "Pick an available model"
      text: "Browse openrouter.ai/models?region=us, or call /api/v1/models through us.openrouter.ai, to see which models can be served entirely from the United States. Swap us for eu to see the European list."
    - name: "Swap the base URL"
      text: "Point your client at https://us.openrouter.ai/api/v1 instead of https://openrouter.ai/api/v1. Your API key, request body, and model IDs are unchanged."
---

Today we're launching US In-Region Routing alongside the EU routing we shipped last October, to give you guaranteed control over where your AI workloads are processed. Requests to `us.openrouter.ai` are decrypted inside the US and routed only to US provider endpoints, so your prompts and completions stay in-region for the entire lifecycle of the request. `eu.openrouter.ai` does the same for the EU.

Companies need stronger guarantees around data residency and processing. OpenRouter's In-Region Routing makes it easy to set up for the US or EU.

## How it works

Send API requests through the region-specific base URL instead of `openrouter.ai`:

```
https://us.openrouter.ai/api/v1
https://eu.openrouter.ai/api/v1
```

Your API key, request body, and model IDs are unchanged, and your provider preferences, fallbacks, and privacy settings carry over from your account. You can point one service at `us.openrouter.ai` while the rest of your traffic keeps using `openrouter.ai`.

Requests sent to `us.openrouter.ai` or `eu.openrouter.ai` are decrypted and processed inside that region, and only providers running in that region can serve them. If no in-region provider offers the model, the request fails with a 404 (`No endpoints found supporting your data region.`) rather than being routed outside the region.

The regional endpoints serve a subset of the global catalog under the same model IDs. A model is listed for a region if at least one provider can serve it from inside that region. For the live list, call [`/api/v1/models`](https://us.openrouter.ai/api/v1/models) through the regional domain, or filter the models page by In-Region Routing ([US](https://openrouter.ai/models?region=us) or [EU](https://openrouter.ai/models?region=eu)). We will continue to add models and providers to both regions. Tell us which models you want in-region next in [#feedback](https://discord.gg/fVyRaUDgxW) on Discord.

You can also enforce In-Region Routing for a specific workspace, team, or API key with [Guardrails](https://openrouter.ai/docs/guides/features/guardrails). Set the guardrail's allowed data regions to one region, and OpenRouter rejects any covered request that arrives on another hostname. Configure it under Guardrails in your settings or through the [Management API](https://openrouter.ai/docs/api/api-reference/guardrails/list-guardrails).

In-Region Routing is available on the Business and Enterprise plans.

## US/EU models served in-region

Without In-Region Routing, using a model from a lab based in the US or EU doesn't guarantee that a data center in that region serves the request. At global endpoints, models from OpenAI, Anthropic, Google, xAI, Meta, NVIDIA, Thinking Machines, or Mistral can run anywhere the provider serving the request operates. A data residency review asks where your request was decrypted and where inference ran, so a US team using [GPT-5.6](https://openrouter.ai/openai/gpt-5.6-terra), [Claude Opus 5](https://openrouter.ai/anthropic/claude-opus-5), or [Gemini 3.6 Flash](https://openrouter.ai/google/gemini-3.6-flash) on a global endpoint can still fail a compliance review. OpenRouter In-Region Routing ensures the request stays within the region you specify: US or EU.

## Chinese open-weight models available in-region

Open-weight models are improving rapidly, and shifting traffic to them can significantly reduce costs. On OpenRouter, the share of tokens going to open-weight models has risen steadily for requests originating in both the US and EU:

![Two 100% stacked bar charts of monthly token share on open weight versus closed weight models, September 2025 through August 2026. For requests originating in the US, the open weight share rises from 26% to 60%; for requests originating in the EU, it rises from 16% to 65%. Both cross 50% in early 2026.](/images/us-in-region-routing-open-weight-share.png)

Models from US labs, like NVIDIA's [Nemotron 3 Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b) and Thinking Machines' [Inkling](https://openrouter.ai/thinkingmachines/inkling), are part of that growth. But models from Chinese labs are still most of the volume, and procurement approval for those models can be difficult.

In-Region Routing allows teams with data residency requirements to get the price and performance gains from Chinese open-weight models. When a US or EU provider hosts a model, requests go to that provider and the lab is not involved. [DeepSeek V4 Pro](https://openrouter.ai/deepseek/deepseek-v4-pro), [Kimi K3](https://openrouter.ai/moonshotai/kimi-k3), and [GLM 5.2](https://openrouter.ai/z-ai/glm-5.2) are all available for US In-Region Routing because Baseten, Fireworks, and Azure serve them from US data centers. Send a prompt to any of them through `us.openrouter.ai` and it is decrypted and run in the US. GLM 5.2 is also available at `eu.openrouter.ai`, served from Mistral's EU data centers.

## Ensuring end-to-end regional routing

When a gateway offers regional routing, it can mean one of two things. The difference is whether your prompt ever exists in plaintext outside the region.

- **Inference-only regional routing.** The gateway pins the provider's inference to your region. But the request itself is decrypted and processed wherever the gateway runs before it is forwarded to the provider. For that part of the path, your prompts are in plaintext outside your region. Server tools are often overlooked for regionalization, which can lead to your prompt data leaving the jurisdiction. For example, web search sometimes uses global instances on regional inference endpoints.
- **End-to-end regional routing.** This is how OpenRouter's In-Region Routing works. It keeps your data in-region for the full path. Requests to `us.openrouter.ai` or `eu.openrouter.ai` are decrypted inside the region and processed there at every step. Only providers running in that region receive them. If no in-region provider can serve the model, the request fails with a 404 (`No endpoints found supporting your data region.`) It never leaves the region. We comprehensively evaluate server tools and the data jurisdictions they run in before offering them in a specific jurisdiction. Tools that would send data outside the region are disabled rather than falling back to global infrastructure.

When you evaluate any gateway's data residency claim, ask two questions. Where is the request decrypted and processed? And where do its tools run?

## Get started

In-Region Routing is available on our Business and Enterprise plans. Upgrade to Business from your [plan settings](https://openrouter.ai/settings/manage-plan), or [talk to the enterprise team](https://openrouter.ai/enterprise/form).

Then pick a model from the [US](https://openrouter.ai/models?region=us) or [EU](https://openrouter.ai/models?region=eu) list and send your requests to `https://us.openrouter.ai/api/v1` or `https://eu.openrouter.ai/api/v1`.

[Read the docs for more info](https://openrouter.ai/docs/guides/features/in-region-routing).
