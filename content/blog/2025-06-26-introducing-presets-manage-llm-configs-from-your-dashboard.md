---
title: "Introducing Presets: Manage LLM Configs from Your Dashboard!"
date: "2025-06-26T00:00:00.000Z"
updated: "2026-06-11T20:49:47.000Z"
author: "OpenRouter"
teaser: "Centralize your LLM logic, iterate faster, and clean up your code. Presets are now live on OpenRouter. "
category: "announcements"
---

We’re excited to launch **Presets**, a powerful new feature that lets you separate your LLM configuration from your code!  
Create, manage, and update model settings, system prompts, and routing rules directly from your OpenRouter dashboard.

## 🚀 Why Use Presets?

- Define model selection, provider routing, system prompts, and generation parameters all in one place.  

- Easily A/B test models or parameters, or update prompts on the fly without code changes.

- Focus your codebase on product logic while offloading config complexity to your presets.

## 🛠️ How to Use Presets in API Calls

You can reference presets in a few flexible ways:

- Directly as a model:  ``model: @preset/your-preset-slug``

- With model override:  ``model: google/gemini-2.0-flash-001@preset/your-preset-slug``

- Using the new dedicated field:  ``preset: your-preset-slug``

## 📘 Docs & Details  
<https://openrouter.ai/docs/features/presets>
