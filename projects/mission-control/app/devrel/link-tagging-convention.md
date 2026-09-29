# DevRel Link-Tagging Convention

Per-effort attribution on the /devrel dashboard only works for links that carry
campaign tags. Referrers cannot identify individual videos or posts (YouTube
strips the video path before the request reaches us), so untagged content is
only measurable as aggregate lift around its publish date.

## Canonical URL format

```text
https://openrouter.ai/<page>?utm_source=<platform>&utm_medium=<format>&utm_campaign=<slug>
```

- `utm_source` — the platform: `youtube`, `x`, `linkedin`, `blog`, `newsletter`, `conference`
- `utm_medium` — the format: `video`, `short`, `post`, `article`, `talk`, `email`
- `utm_campaign` — a stable, readable, unique slug per effort: `<yyyymm>-<topic>`, e.g.
  `202609-structured-outputs-deep-dive`

Example for a YouTube video description:

```text
https://openrouter.ai?utm_source=youtube&utm_medium=video&utm_campaign=202609-structured-outputs-deep-dive
```

## Rules

1. Every published link gets a campaign slug. No exceptions — a missed tag is
   an effort that can never be measured.
2. Slugs are stable. Never rename a slug after publishing; the history splits.
3. One slug per effort, reused across every link for that effort (description,
   pinned comment, blog cross-post) so all clicks aggregate.
4. Deep links keep the tags. Tag `https://openrouter.ai/docs/...` the same way;
   attribution is captured on any landing page.

## What tagged campaigns unlock

The /devrel dashboard's UTM campaign drill-down reports per effort: signups,
API key activation, first request, 7/30-day retention, requests, and usage.
The north-star cohort views then show whether those signups become durable
developer workspaces (second active week, retained 28-day actives).

## Limits to keep in mind

- Tags only capture click-throughs. Viewers who watch and later search arrive
  as Organic Search/Direct; that impact shows up only as aggregate lift around
  publish-date markers.
- Historical content cannot be attributed retroactively — the original
  referrer was stripped in the browser. Tagging starts paying off from the
  next publish onward.
