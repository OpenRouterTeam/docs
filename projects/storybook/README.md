# Storybook

Unified Storybook build for OpenRouter's component library. Consolidates stories from `packages/frontend`, `projects/web`, and `projects/mission-control` into a single project deployed as a Cloudflare Worker with static assets.

## Architecture

```mermaid
graph TD
    Stories["Stories\npackages/frontend\nprojects/web\nprojects/mission-control"] --> Build["Storybook Build\n.storybook/main.ts"]
    Build --> Static["storybook-static/"]
    Static --> Worker["Cloudflare Worker\nwrangler.toml"]
    Worker --> Prod["Production\nstorybook.openrouter.workers.dev"]
    Worker --> Preview["PR Previews\nstorybook-preview-pr-N"]
    CI["deploy-storybook.yaml"] --> Worker
```

## Commands

| Command | Description |
|---------|-------------|
| `bun run storybook` | Start dev server on port 6006 |
| `bun run storybook:build` | Build static output to `storybook-static/` |
| `bun run typecheck` | Type-check with tsgo |

## Deployment

- **Production**: Deploys to `storybook.openrouter.workers.dev` on push to `main` (gated to storybook config and story file paths)
- **PR previews**: Deploy as `storybook-preview-pr-{number}` workers when the `storybook-preview` label is applied; torn down on PR close
- Uses existing `CF_WORKERS_API_TOKEN` (no new secrets needed)
