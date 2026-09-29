# Social video templates

This workspace contains the HTML and GSAP social-video pipeline. It is
deliberately separate from `projects/remotion` because it renders plain HTML
with deterministic browser seeking rather than React compositions.

## Quick start

```bash
bun run --filter @openrouter-monorepo/social-video render ori-prime-launch
bun run --filter @openrouter-monorepo/social-video render ori-prime-launch --still 8.3
```

Each video is a typed config file under `videos/`. The renderer validates it,
bundles the browser runtime, serves the page and brand fonts locally, captures
every frame, encodes H.264, reports blank-frame diagnostics, and gates
unsafe-edge content.

## Pipeline behavior

The renderer mounts the repository's brand fonts at stable local URLs. It
captures deterministic browser-seeked frames, encodes H.264, reports
blank-frame diagnostics, and gates unsafe-edge content.

Rendered frames, stills, and videos live under `.render/` and are ignored.
