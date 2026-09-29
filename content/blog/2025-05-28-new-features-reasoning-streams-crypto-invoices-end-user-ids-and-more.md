---
title: "New Features: Reasoning Streams, Crypto Invoices, End-User IDs & More"
date: "2025-05-28T00:00:00.000Z"
updated: "2026-06-11T20:49:47.000Z"
author: "OpenRouter"
teaser: "Stream reasoning summaries, protect your rate limits, pay with crypto, and lock down your keys—now all live on OpenRouter. "
category: "announcements"
---

We're actively expanding Claude 4 and Gemini 2.5 capacity — but in the meantime, several highly requested features are now available:

## 🧠 o3 Reasoning Summary Streaming  
OpenAI’s o3 and o4-mini models now support streaming reasoning summaries via the OpenRouter Chat Completions API.  
Watch it in action: <https://x.com/OpenRouterAI/status/1927755349030793504>

## 🧑‍🤝‍🧑 Submit End-User IDs  
You can now include optional user fields with each request to help prevent abuse, improve moderation, and enable per-user usage tracking.  
Docs: <https://openrouter.ai/docs/api/reference/chat-completion#request.body.user>

## 📜 Crypto Invoices  
You can now generate an invoice in one click to pay with crypto directly from the /credits page.

## 🔑 Require Your 3rd-Party Key  
Ensure only your API key is used for a specific provider (e.g., your own OpenAI key) by toggling this setting from the model config.

## 🛠️ Additional Features  
- 2FA Support — Configure two-factor authentication and Passkeys in your account settings for stronger security.  
- AI SDK Updates — Now includes usage accounting and PDF parsing support.