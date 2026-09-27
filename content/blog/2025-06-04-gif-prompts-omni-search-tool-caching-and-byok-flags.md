---
title: "GIF Prompts, Omni Search, Tool Caching, and BYOK Flags"
date: "2025-06-04T00:00:00.000Z"
author: "OpenRouter"
teaser: "Faster workflows, smarter tooling, and smoother image support—GIFs, provider search, Anthropic tool-call caching, and BYOK confirmation are all now live. "
category: "announcements"
---

Several highly requested developer features just landed — making OpenRouter smoother, smarter, and faster to build with:

## 🖼️ GIF Support Across Models  
You can now send image/gif prompts to OpenAI, Gemini, Anthropic, and Llama models.  
No need to pre-convert — just send your animations directly.

## 🔍 Provider Pages in Omni-Search  
Press ⌘/Ctrl + K, type any provider name, and jump straight to their page to view available models, pricing, and uptime.

## ⚡ Anthropic Tool-Call Caching  
Tool calls with Anthropic now support caching — significantly reducing both latency and token usage.

## 🔑 `is_byok` Flag in Usage  
When you include `"usage": { "include": true }` in your request, the response now includes an `is_byok` flag.  
This helps confirm whether a BYOK (bring your own key) setup was used.
