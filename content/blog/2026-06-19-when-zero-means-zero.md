---
title: "When Zero Means Zero"
date: "2026-06-24T16:00:00.000Z"
author: "Afzal Jasani"
teaser: "Everyone has a different view on Zero Data Retention. The confusion is real, and vendors aren't rushing to clarify. Here's what ZDR actually means and how OpenRouter enforces it."
category: "insights"
draft: true
headerImage:
  url: /images/when-zero-means-zero.png
  width: 1344
  height: 768
---

This past week Zero Data Retention (ZDR) has come up approximately 15 times. The first time was when my wife and I were looking for something to watch on TV. She suggested we watch the new show, Rooster. But we had already watched the first three episodes! Talk about zero data retention.

The next 14 times were equally exciting because I realized everyone kind of has a different view on zero data retention and what it actually means. It gave me flashbacks to when people would ask for "real-time" data and when I asked them what real time meant they would reply with "oh every 15 minutes would be great". Yeah, not exactly real time.

ZDR generally means a guarantee your data is not stored after processing. Where the nuances come into play are what is included in "data". That confusion around what is "data" is what creates privacy and security risks.

For example you have prompts and responses. Prompts are what you send to the LLM. Depending on the provider and plan, what you send could be stored, accessed, or used to train future models. So it makes sense why companies are concerned about their actual prompts because they might include proprietary information in them.

For example, let's say someone on the engineering team prompted an LLM with "Debug this authentication issue in our product". Without ZDR, that prompt could be stored, and in some cases used as training data, exposing details about your internal systems beyond your control. While your authentication issue might get solved it's not exactly worth that risk. The risk magnifies as you move up in highly regulated industries like healthcare and financial services.

On the response side, the model's output can be just as sensitive. Going off the last example, the LLM could have responded with "Aside from your authentication issue, I also found these other vulnerabilities". If that response is retained, you now have a record of your unpatched weaknesses sitting in a third party's logs, where a breach or misconfiguration could expose it.

![What this looks like if you're on a standard plan with Anthropic/OpenAI](/images/when-zero-means-zero/standard-plan.png)

Then you layer in caching, which is top of mind as everyone moves toward token optimization. Some providers handle implicit caching of prompts automatically. This is where a repeated part of the prompt is kept in an in-memory cache so it doesn't need to be reprocessed, which adds up to significant cost savings. However, caching is not considered data retention because nothing is stored in long term memory. You can also set explicit caching but that requires you to mark which content blocks to cache.

So "data" is really prompts and responses. One caveat is metadata (timestamps, model versions, latency, throughput, cost, etc.) but it is generally considered safe to store since it doesn't include sensitive content.

![With prompt caching and ZDR boundary](/images/when-zero-means-zero/caching-zdr-boundary.png)

At OpenRouter, we address questions around ZDR every day. In fact, our offering of ZDR compliant models has become even more robust since the beginning of this year. ZDR is evolving from a nice to have to a need to have in many cases.

![New models added to OpenRouter with ZDR support](/images/when-zero-means-zero/new-zdr-models.png)

Since January we have added 97 additional models that support ZDR. While availability is important, we have also observed consistent token volume for ZDR models across the board.

The availability shows we have supply and the volume is proof our users utilize it in a meaningful way. This often translates to real production workflows. I support many AI native companies that are able to use ZDR models for both frontier models and open weight models. This flexibility is now a hard requirement.

![Monthly Token Volume on ZDR models](/images/when-zero-means-zero/monthly-token-volume.png)

Our monthly token volume for ZDR-enabled models is up 4.3x since January. ZDR shouldn't cost you model choice. Other providers don't have the ability to support the myriad models we do, so without OpenRouter you might end up locked to one vendor without the optionality that we provide as a default.

This all makes sense though. My [last post](https://openrouter.ai/blog/insights/dinner-is-served/) highlighted model optionality and why companies need it. You can't get everything you need from one provider and standardizing on one might be a death sentence.

![ZDR share of Token Volume](/images/when-zero-means-zero/zdr-share.png)

Roughly half of everything we route is already ZDR. In our Enterprise segment we see many organizations wanting to deeply understand how to actually enforce and enable this.

## How OpenRouter handles ZDR

So how does OpenRouter handle ZDR? We enforce it at three levels, and you pick how much control you want.

**Account level.** Flip ZDR on for an entire provider (Anthropic, OpenAI, Google, or non-frontier models) across your whole account. Set it once and every request inherits it.

**Guardrail level.** Scope enforcement per API key or per org member, so a production key can require ZDR while a sandbox key doesn't. This is how teams keep one strict policy without blocking experimentation.

**Per-request level.** Pass `"provider": {"zdr": true}` on a single call. OpenRouter then routes that request only to ZDR-eligible endpoints, skipping any model or provider that can't satisfy the policy and falling through to the next qualifying option in your list.

![OpenRouter ZDR enforcement: account level, guardrail level, and per-request level](/images/when-zero-means-zero/enforcement-layers.png)

Remember the three things "data" can mean: prompts, responses, and the metadata in between. Whichever of those you actually care about, you can enforce it at the level that fits how your team works.

That's the flexibility regulated teams keep asking us for. The confusion around ZDR is real, and most people asking for it don't know whether they mean prompts, responses, caching, or all three. And vendors aren't exactly rushing to clarify. Next time it comes up, you'll know exactly what to ask for.

You can turn ZDR on today in your account privacy settings, or enforce it per request with `"provider": {"zdr": true}`. See the [Zero Data Retention docs](https://openrouter.ai/docs/guides/features/zdr) for the full setup.
