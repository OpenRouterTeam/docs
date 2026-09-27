---
title: "Subagent: Let Your Model Delegate the Busywork"
date: "2026-06-16"
author: "Kenny Rogers"
teaser: "The openrouter:subagent server tool lets a frontier model hand off self-contained tasks to a smaller, cheaper, faster worker model mid-generation. Summarize a doc, extract structured data, reformat text, all without burning frontier tokens."
headerImage:
  url: "/images/subagent-server-tool.png"
  width: 1536
  height: 864
category: "announcements"
howTo:
  name: "Enable the Subagent Server Tool"
  totalTime: "PT3M"
  steps:
    - name: "Add the subagent tool to your request"
      text: "Include {\"type\": \"openrouter:subagent\", \"parameters\": {\"model\": \"z-ai/glm-5.2\"}} in your tools array alongside your model of choice."
    - name: "Send your request"
      text: "POST to https://openrouter.ai/api/v1/chat/completions with your messages and the tools array. The model will automatically delegate sub-tasks to the worker when appropriate."
    - name: "Receive the result"
      text: "The worker's output arrives as a tool result. Your model integrates it into its final response. You pay worker-model prices for the delegated tokens."
faq:
  - question: "What is the difference between the subagent and advisor tools?"
    answer: "The advisor tool consults a stronger, more expensive model for guidance on hard decisions. The subagent tool delegates routine sub-tasks to a cheaper, faster model. Advisor escalates up; subagent delegates down."
  - question: "Can the subagent worker use its own tools?"
    answer: "Yes. You can give the worker OpenRouter server tools like openrouter:web_search or openrouter:web_fetch. The worker runs as a sub-agent with its own tool loop and returns only its final text to the parent model."
  - question: "How is the worker model chosen?"
    answer: "The worker model is fixed by the parameters.model field on the tool definition. Unlike the advisor tool, the delegating model does not choose the worker per call. If no model is specified, it falls back to the outer request model."
  - question: "Can the subagent call itself recursively?"
    answer: "No. Recursion is blocked by a self-reference check and a depth header. Task executions are also capped at 10 per request to bound cost and latency."
---

Add `openrouter:subagent` to your tools array and your model can delegate self-contained tasks to a smaller, cheaper, faster worker model mid-generation. Summarize a document, extract structured data, draft boilerplate, reformat text: the worker handles it and passes the result back. Your frontier model keeps orchestrating without burning expensive tokens on routine work.

Try it in the [chatroom](https://openrouter.ai/chat), [read the docs](https://openrouter.ai/docs/guides/features/server-tools/subagent), or follow the [cookbook recipe](https://openrouter.ai/docs/cookbook/building-agents/subagent-server-tool) to wire it into your app.

```json
{
  "model": "anthropic/claude-opus-4.8",
  "messages": [{ "role": "user", "content": "Audit this release: summarize the changelog, list breaking changes, and draft the announcement." }],
  "tools": [
    {
      "type": "openrouter:subagent",
      "parameters": { "model": "z-ai/glm-5.2" }
    }
  ]
}
```

The model decides when to delegate. It only invokes the subagent for tasks that don't need its full capability.

## Find subagent opportunities in your codebase

Paste this prompt into your coding agent to have it scan your project for places where subagent delegation would cut costs:

```text
Read through this codebase and identify places where an OpenRouter API call
could benefit from the openrouter:subagent server tool. Look for patterns where
a frontier model is doing mechanical sub-tasks inline: summarization, data
extraction, reformatting, boilerplate generation, or schema conversion.

For each candidate, explain:
1. Which file and function
2. What the sub-task is
3. Why it's a good fit for delegation (self-contained, predictable output, doesn't need the full conversation context)
4. A code snippet showing how to add the subagent tool to that call

Reference docs: https://openrouter.ai/docs/guides/features/server-tools/subagent
Cookbook recipe: https://openrouter.ai/docs/cookbook/building-agents/subagent-server-tool
```

## Frontier brain, budget hands

Claude Opus 4.8 costs $5 per million input tokens. GPT-5.5 costs $5. GLM 5.2 costs $1.40. That's a 3.6x spread on input between frontier and worker, 5.7x on output. (Claude Fable 5 was $10/$50 per M tokens before it got yanked, RIP.)

A frontier model doing a code review doesn't need to spend its own tokens summarizing a 2,000-line changelog or reformatting a JSON blob. Those are mechanical tasks with clear instructions and predictable output. The subagent handles them at GLM prices while the orchestrator focuses on the parts that actually require reasoning.

In a complex agentic workflow with 20 tool calls, maybe 5-8 are subagent delegations: summarization, data extraction, template filling, format conversion. The frontier model orchestrates and judges. You've cut your per-request cost without touching the quality ceiling on the hard parts.

## How it works under the hood

The worker model sees only what the delegating model explicitly passes in the `task_description`. No parent conversation, no prior context, no memory between tasks. Each delegation is a clean, isolated unit of work.

1. **Any model can be the worker.** Pin it with `parameters.model` (anything in the [model catalog](https://openrouter.ai/models) works). Open-source models like `z-ai/glm-5.2` work well for mechanical tasks. If you don't specify a model, it falls back to the outer request model.

2. **Workers get their own tools.** Give the worker `openrouter:web_search` and it can ground its output in fresh sources before responding. The worker runs its own tool loop internally; only the final text comes back to your model.

3. **Recursion is blocked.** The subagent can't call itself. A depth header and self-reference check prevent unbounded nesting, and delegations are capped at 10 per request.

```json
{
  "tools": [
    {
      "type": "openrouter:subagent",
      "parameters": {
        "model": "z-ai/glm-5.2",
        "instructions": "You are a fast, focused worker. Complete the task exactly as described.",
        "tools": [{ "type": "openrouter:web_search" }]
      }
    }
  ]
}
```

## Subagent vs. advisor

These two tools point in opposite directions. The [advisor](https://openrouter.ai/docs/guides/features/server-tools/advisor) escalates hard decisions to a stronger model. The subagent delegates routine work to a cheaper one.

| | Advisor | Subagent |
|---|---|---|
| **Direction** | Up (consult a stronger model) | Down (delegate to a cheaper model) |
| **Worker choice** | Model picks per call | Fixed by tool definition |
| **Use case** | "Help me think through this" | "Do this mechanical task for me" |
| **Memory** | Cross-request transcript replay | None (each task is isolated) |

Use both in the same request. Your frontier model consults the advisor on architectural decisions and delegates summarization to the subagent. Different tools for different kinds of work.

## Billing

Subagent tokens bill at the **worker model's** rates, separate from the orchestrator. If your orchestrator is Claude Opus 4.8 ($5/$25 per M tokens) and the worker is GLM 5.2 ($1.40/$4.40 per M tokens), each model's tokens bill at their own price. Both show up on your [activity page](https://openrouter.ai/activity).

## Get started

One line in your tools array:

```json
{ "type": "openrouter:subagent", "parameters": { "model": "z-ai/glm-5.2" } }
```

The model decides when to use it. [Read the full docs](https://openrouter.ai/docs/guides/features/server-tools/subagent) for all parameters, worker tools, and recursion details, or follow the [cookbook recipe](https://openrouter.ai/docs/cookbook/building-agents/subagent-server-tool) for a working integration.
