---
title: "Classifiers: Track What Your Agents Do and What It Costs"
date: "2026-07-24T00:00:00.000Z"
author: "Cailee Moberg"
teaser: "Define a taxonomy and a small model tags every generation in your workspace by department, task type, or agent complexity. Filter your logs and group your Activity analytics by the results."
headerImage:
  url: "/images/classifiers.png"
  width: 1344
  height: 768
category: "announcements"
faq:
  - question: "Do Classifiers add latency to my requests?"
    answer: "No. Classification runs asynchronously after each generation completes, so your API responses return at full speed. If a classification fails, your request is unaffected."
  - question: "How much does classification cost?"
    answer: "Classifier tokens bill like any other generation against your workspace credits. You control cost two ways: pick a small, inexpensive model (we recommend Gemini 3.5 Flash Lite for the best value), and set a sampling rate so you only classify a percentage of requests."
  - question: "Who can create and manage Classifiers?"
    answer: "Workspace admins. Each classifier is scoped to a single workspace, so different workspaces can run different classifiers or none at all."
  - question: "Can I classify requests that already happened?"
    answer: "Yes. Open any past generation in your logs and run one of your classifiers on demand to see how it gets tagged. This requires prompt logging to be enabled so the prompt content is available."
howTo:
  name: "Set up a classifier for your workspace"
  totalTime: "PT5M"
  steps:
    - name: "Open your workspace's Classifiers page"
      text: "Go to your workspace settings and open the Classifiers tab, then click Create classifier."
    - name: "Pick a preset or build your own"
      text: "Start from a preset like Department, Task type, or Agent complexity, or define your own dimensions and values (up to eight dimensions per classifier)."
    - name: "Choose a classification model"
      text: "We recommend Gemini 3.5 Flash Lite for the best value."
    - name: "Set a sampling rate"
      text: "Classify 100% of requests or sample a percentage (like 10%) to balance oversight with cost."
    - name: "Save and check your logs"
      text: "New generations in the workspace get tagged automatically. Open any classified generation in your logs to see its tags."
---

You can now automatically classify your OpenRouter generations with structured metadata for AI usage reporting.

Every request carries information: the type of work, the level of complexity, which department it came from, whether it contains internal data it shouldn't. Classifiers, now available in beta, give you that visibility. Define your criteria (task type, agent complexity, compliance category, cost center). A model of your choice tags each generation, or a sampled subset, against your taxonomy and write the results to your logs. You get continuous visibility into what your agents and users are doing, which models they're using for different tasks, and where the costs go.

[Create a classifier](https://openrouter.ai/workspaces/default/classifiers) in your workspace settings, or read the [docs](https://openrouter.ai/docs/guides/features/classifiers) first.

## Pick a template or define your own taxonomy

A classifier is a small config with four parts: a **taxonomy** (up to eight dimensions, each with the values you choose), a **classification prompt** (instructions sent to the classifier model as a system message), a **model** to read each prompt and apply it, and a **sampling rate**. Classification runs asynchronously after each request completes, so it never adds latency to your inference path.

Choose from six preset templates, customize a template, or build your own from scratch.

| Template | What it tags |
|--------|-------------|
| **Department** | Which business function originated the request: engineering, sales, marketing, legal, and so on. Useful for seeing which parts of the org drive inference cost |
| **Audience** | Who the output is for: internal use, client-facing, regulators, or the public. Feeds compliance workflows that depend on who reads a model's output |
| **Task type** | What the model is doing: coding, agent workflows, data processing, content writing. Useful to check whether the right tier of model is being used for each task |
| **Engineering work** | Feature development, bug fixing, documentation, refactoring, code review. Good for tracking where AI is helping and which models are used for each type of work |
| **Agent complexity** | Difficulty tier (from trivial tool calls to frontier-expert work) plus task family. For teams running agents, where "which model handled a hard task well" is the question that matters |
| **Capitalizable software expense** | Whether AI-assisted engineering work is potentially capitalizable development versus maintenance, operations, or support |

Select your classification model. We recommend [Gemini 3.5 Flash Lite](https://openrouter.ai/google/gemini-3.5-flash-lite) for the best value: cheap, strong accuracy on structured output, good enough for most taxonomies. You can change the model at any time.

At high throughput, the cost of classifying every request adds up. Use the sampling rate to keep costs down. Run a high-fidelity compliance classifier at 100% while a broader cost-attribution classifier samples 10% of the same traffic, keeping costs proportional to the oversight you need.

## Structured tags in your logs

Classifier outputs are coerced into structured formats, constrained to the dimensions and values you define. Every classified generation is tagged in your [logs](https://openrouter.ai/logs), so you can filter requests by classification. For example, you can pull every request tagged `department: legal` or `agent_complexity_difficulty_tier: complex_multistep`. Each tagged generation's detail panel breaks down classified dimensions and values.

You can also run a classifier on demand against any past generation to sanity-check a new taxonomy. Open it in your logs, pick a classifier, and see how it gets tagged.

![Logs filtered by a classifier value, with a generation's detail panel showing its classified dimensions: difficulty tier, task family, and more](/images/classifiers-logs.png)

## Roll it up in Activity

Individual tags on generations answer "what was this request?" The [Activity Explorer](https://openrouter.ai/activity/explore) answers the aggregate questions: group your traffic by any classifier dimension to see which models are being used for each task type or level of agent complexity, and which departments or tasks drive the most spend.

Results are aggregated over time; watch patterns shift in your data and show stakeholders how your AI usage is governed. Classifier filters carry across the Activity tabs so you can see [trends](https://openrouter.ai/activity/trends) and [guardrail](https://openrouter.ai/activity/guardrails) enforcement by any classifier value.

![Activity Explore grouping total usage by the agent complexity classifier's difficulty tier, showing spend per tier from complex_multistep to frontier_expert](/images/classifiers-activity.png)

## Get started

Classifiers are available now in beta. [Create a classifier](https://openrouter.ai/workspaces/default/classifiers) in your workspace or read the [docs](https://openrouter.ai/docs/guides/features/classifiers) to learn more about taxonomy design, billing, and how classification works under the hood. Classifiers work even with input & output logging disabled.

Tell us what you think in [#feedback](https://discord.gg/fVyRaUDgxW) on Discord.
