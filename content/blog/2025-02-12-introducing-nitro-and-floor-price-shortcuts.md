---
title: "Introducing Nitro and Floor Price Shortcuts"
date: "2025-02-12T00:00:00.000Z"
updated: "2026-06-11T20:49:47.000Z"
author: "OpenRouter"
teaser: "We're rolling out new sorting shortcuts to give you more control over how OpenRouter selects providers "
category: "announcements"
---

## Nitro Variants: Prioritize Speed ⚡

The `:nitro` suffix now works universally across all models! Instead of appearing as separate endpoints, `:nitro` is a shortcut that sorts providers by **throughput** (tokens per second). This allows you to always get the fastest available provider for your chosen model.

### Example using Nitro shortcut:
```json
{
  "model": "meta-llama/llama-3.1-70b-instruct:nitro",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```
This is equivalent to setting `provider.sort` to `"throughput"` in the API.

## Floor Price: Prioritize Cost 💰

Want to minimize costs? The `:floor` shortcut ensures OpenRouter always selects the lowest-priced provider for your model.

### Example using Floor shortcut:
```json
{
  "model": "meta-llama/llama-3.1-70b-instruct:floor",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```
This is equivalent to setting `provider.sort` to `"price"` in the API.

## Advanced Provider Sorting

If you want more explicit control over provider selection, you can set the `sort` field in `provider` preferences. This disables OpenRouter’s default load balancing and orders providers based on your chosen attribute:

- **`"price"`**: Prioritize the lowest-cost provider
- **`"throughput"`**: Prioritize the fastest provider (highest tokens/sec)
- **`"latency"`**: Prioritize the lowest-latency provider

### Example with explicit sorting:
```json
{
  "model": "meta-llama/llama-3.1-70b-instruct",
  "messages": [{ "role": "user", "content": "Hello" }],
  "provider": {
    "sort": "throughput"
  }
}
```

## What’s Next?

- **Improved Throughput Metrics**: We’re shifting from averages to **median throughput**, which means speed ratings will better reflect real-world performance.

Get ready for faster and more cost-effective AI access with these new shortcuts! 🎉
