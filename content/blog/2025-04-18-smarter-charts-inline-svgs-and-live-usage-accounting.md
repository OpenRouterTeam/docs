---
title: " Smarter Charts, Inline SVGs, and Live Usage Accounting"
date: "2025-04-18T00:00:00.000Z"
updated: "2026-06-11T20:49:47.000Z"
author: "OpenRouter"
teaser: "Smarter analytics, smoother previews, and instant cost visibility—all now live on OpenRouter. "
category: "announcements"
---

# Quality-of-Life Updates

We’ve rolled out three quality-of-life updates to improve transparency and usability across the board.

## 🔹 Activity Chart Filtering
You can now filter the chart on the Activity page simply by applying filters to the table.  
Whether you're narrowing by model, API key, or provider, the chart updates to match—making trends and spikes easier to analyze.  
See here: <https://openrouter.ai/activity>

## 🖼️ Chatroom SVG Previews
SVG files now preview inline in the chatroom, so you can instantly review diagrams, icons, and vector designs without downloading anything.  
![Chatroom SVG Previews](https://openrouter.ai/cdn-cgi/imagedelivery/Xq3eUzdKO2-MoBklzEEuMQ/e5dc1b47-3455-423c-eb31-5bd5cab47d00/public)

## 📊 In-Stream Usage Accounting
Developers can now receive real-time token and cost data directly in each streamed response.  
Just set `"usage": { "include": true }` in your request and you'll get details like:

```json
"usage": {
  "completion_tokens": 2000,
  "completion_tokens_details": { "reasoning_tokens": 100 },
  "cost": 0.2,
  "prompt_tokens": 194,
  "prompt_tokens_details": { "cached_tokens": 20 },
  "total_tokens": 2194
}
```

No additional API calls required.

## 📚 Learn More  
Quickstart guide: <https://openrouter.ai/docs/quickstart>  
Live demo and updates: <https://x.com/OpenRouterAI/status/1913345350397460758>