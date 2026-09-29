# Remotion workspace

This package is the interactive authoring workspace for OpenRouter social
videos. Its brand tokens and layout rules follow the root [`DESIGN.md`](../../DESIGN.md)
and the [`remotion-video-templates` skill](../../.agents/skills/remotion-video-templates/SKILL.md).

## Interactive loop

Start Studio with `bun run --filter @openrouter-monorepo/remotion dev`. Template
compositions are at the top level. Drafts are under the **Video-drafts** folder
and represent one video's slug, aspect, template, and props.

The draft helper renders local outputs and submits the same props to the service:

```bash
bun run --filter @openrouter-monorepo/remotion draft streaming-tool-calls render
bun run --filter @openrouter-monorepo/remotion draft streaming-tool-calls still 150
REMOTION_RENDER_AUTH_TOKEN=dev-token \
  bun run --filter @openrouter-monorepo/remotion draft weekly-api-growth submit
REMOTION_RENDER_AUTH_TOKEN=dev-token \
  bun run --filter @openrouter-monorepo/remotion draft weekly-api-growth submit-still
```

Both submit operations require the render-service layer of this stack. Local
still rendering works without that layer.

Set `REMOTION_RENDER_URL` to override the default `http://localhost:8811`.
The submit operation polls until the service reaches `done` or `error` and
prints the usable output URL.

## Service submissions

Both `/render` for mp4 and `/still` for PNG use the same auth, queue, and
registry validation. Still jobs accept an optional `frame` and default to the
last frame. Outputs are addressed by `/files/<job-id>.mp4` or
`/files/<job-id>.png`, or by their signed GCS URL when storage is configured.
