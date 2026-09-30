---
title: "Manage and de-risk your API keys with the new Security Center"
date: "2026-10-06T00:00:00.000Z"
author: "OpenRouter"
category: "announcements"
metaTitle: "Manage and de-risk your API keys with the new Security Center"
metaDescription: "The Security Center lists every live API key across your workspaces, including Connect and MCP keys, flags the risky ones, and lets you disable, archive, or cap them in bulk."
teaser: "The Security Center is one place to see every key across your workspaces, know which ones are risky and why, and disable, archive, or cap hundreds at once."
headerImage:
  url: "/images/manage-and-de-risk-your-api-keys-with-new-security-center.png"
  width: 1376
  height: 768
---

Dealing with a leaked key is stressful. The fewer old keys you have lying around, the fewer can leak, so we built the Security Center. It's one place to see every key across your workspaces, know which ones are risky and why, and disable, archive, or cap hundreds at once.

It's available to every OpenRouter account. Try it under [Settings > Security](https://openrouter.ai/settings/security).

## 1,000+ keys across 85 employees

The obvious defense against leaked keys is to have fewer of them. So we audited our own OpenRouter org, and because we build OpenRouter on OpenRouter, there was a lot to audit.

We found over 1,000 active keys for 85 employees. 558 of them never expired. Many had no spend limit or hadn't been used in months, and some belonged to people who had already left the company.

Those keys came from the normal course of work: a quick test key, a key for a demo, a key for a short-lived agent. If a team our size ended up with this much key sprawl, you probably have some too.

## What the Security Center shows you

The Security Center has three tabs: Overview, Key safety, and IP allowlist. The IP allowlist moved here from privacy settings; it limits which IP addresses can use your keys, and organization admins on Pro and Enterprise plans can manage it.

### Overview: see what needs attention

*[add screenshot]*

The Overview counts your keys in four groups: no spend limit, never expires, unused or idle for 90+ days, and safe to remove. Each group with keys in it becomes a recommendation:

- **Remove unused keys.** Ask each owner to confirm, then archive.
- **Set a spend limit.** A limit caps what a leaked key can spend.
- **Review keys without expiration.** Replace them with expiring keys, or remove the ones no one needs.
- **Turn on key spend alerts.** Get an email when a key crosses a share of its spend limit.
- **Enforce a maximum key lifetime.** Requests from keys that never expire, or outlive the limit, get rejected (existing keys included).

If nothing needs attention, the page says so.

### Key safety: every key in one list

Key safety lists every key that can still make requests, across every workspace on your account. Until now, keys lived on each workspace's own page, and Connect keys had no page at all. The list includes Connect, MCP, and management keys, with owner, last use, spend limit, and expiration side by side. Admins see every key; members see the keys they created.

Each key gets a risk score based on what a leaked copy could do, which comes down to its spend limit and expiration.

*[add screenshot]*

Usage sets a separate status label. A key with no recorded usage, or idle for six months with under $1 of lifetime spend, is marked Safe to remove. Recent or meaningful usage is In use. Mixed signals get Review before removing.

You can also take bulk actions. Filter by risk or idle time, then select up to 500 keys and disable, archive, or add a spend limit to all of them. Disabling is reversible; archiving isn't. Adding a limit never overwrites one someone already set.

Admins can also copy a CSV of any recommendation's keys and owners to hand to a script or an agent.

The Security Center works from key metadata, spend, limits, and expiry. It never reads your prompts or completions.

## How we keep our key count down

Here's what we do now, and what we'd suggest:

- **Clean up on a schedule.** Start with Safe to remove keys, confirm with their owners, then archive.
- **Check keys when someone leaves.** Filter by owner and archive the keys no one took over.
- **Give every key a limit and an expiration.** A limit turns a leak into a fixed cost. An expiration means a forgotten key eventually stops working.
- **Rotate keys that stay in use.** The [key rotation guide](https://openrouter.ai/docs/cookbook/administration/api-key-rotation) walks through the order.

Open [Settings > Security](https://openrouter.ai/settings/security) to see where your keys stand.
