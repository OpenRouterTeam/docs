# OpenRouter Docs

This directory contains the [Mintlify](https://mintlify.com)-hosted documentation for [openrouter.ai/docs](https://openrouter.ai/docs).

## PR Workflows

- **Validate Docs** — Runs `mint validate` on all PRs touching `projects/docs/**`
- **Docs Preview** — Posts a preview URL as a PR comment for internal PRs (fork PRs cannot access secrets)

## Local Development

To preview docs locally, install the Mintlify CLI and run:

```bash
cd projects/docs
mint dev
```

## Resources

- [Mintlify Documentation](https://mintlify.com/docs)
- [docs.json Configuration](https://mintlify.com/docs/settings/global)
